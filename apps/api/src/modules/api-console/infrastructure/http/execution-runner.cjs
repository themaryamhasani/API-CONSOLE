'use strict';

/**
 * HTTP execution / redirect / IS gateway recovery for API Console.
 * Factory follows the same deps-injection pattern as phase2-routes.cjs / curl-parser.cjs.
 */

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

function createExecutionRunner(deps) {
  const {
    ApiConsoleError,
    makeId,
    nowIso,
    safeClone,
    sanitizeText,
    createHeader,
    createCookie,
    hasBody,
    LIMITS,
    validateDestination,
    isCorporateRemappedAddress,
    roleAllowed,
    API_CONSOLE_POLICY,
    getStore,
    saveStore,
    reloadStoreFromDisk,
    audit,
    logUsageEvent,
    findEnvironment,
    createDefaultScripts,
    resolveRequest,
    validateProductionPolicy,
    createBlockedExecution,
    createExecutionFromError,
    selectRunner,
    runnerHostTag,
    zoneWorkerHeartbeatFresh,
    sleep,
    evaluateAssertions,
    runPreRequestScript,
    runPostResponseScript,
    businessResultFromAssertions,
    putBlob,
  } = deps;

  function parseSetCookie(value) {
    const rows = Array.isArray(value) ? value : [value].filter(Boolean);
    return rows.map((row, index) => {
      const parts = String(row || '').split(';').map(part => part.trim());
      const first = parts.shift() || '';
      const eq = first.indexOf('=');
      const cookie = createCookie(eq >= 0 ? first.slice(0, eq) : first, eq >= 0 ? first.slice(eq + 1) : '', index, 'SYSTEM');
      parts.forEach(part => {
        const [key, ...rest] = part.split('=');
        const lower = key.toLowerCase();
        const val = rest.join('=');
        if (lower === 'domain') cookie.domain = val;
        if (lower === 'path') cookie.path = val;
        if (lower === 'expires') cookie.expiresAt = val;
      });
      return cookie;
    });
  }

  function responsePreviewMode(contentType) {
    const normalized = String(contentType || '').toLowerCase();
    if (normalized.includes('json')) return 'JSON';
    if (normalized.includes('html')) return 'SANDBOXED_HTML';
    if (normalized.includes('text') || normalized.includes('xml')) return 'TEXT';
    return 'DOWNLOAD_ONLY';
  }

  function normalizeResponseHeaders(headers) {
    const result = [];
    let index = 0;
    for (const [name, raw] of Object.entries(headers || {})) {
      if (name.toLowerCase() === 'set-cookie') continue;
      const value = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '');
      result.push(createHeader(name, value, index, 'SYSTEM'));
      index += 1;
    }
    return result;
  }

  function decompressBody(buffer, headers) {
    const encoding = String(headers['content-encoding'] || '').toLowerCase();
    if (encoding.includes('gzip')) return zlib.gunzipSync(buffer);
    if (encoding.includes('br')) return zlib.brotliDecompressSync(buffer);
    if (encoding.includes('deflate')) return zlib.inflateSync(buffer);
    return buffer;
  }

  function isTlsTransportError(error) {
    const tlsCodes = new Set([
      'CERT_CHAIN_TOO_LONG',
      'CERT_COMMON_NAME_INVALID',
      'CERT_DATE_INVALID',
      'CERT_HAS_EXPIRED',
      'CERT_NOT_YET_VALID',
      'CERT_REVOKED',
      'CERT_UNTRUSTED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'HOSTNAME_MISMATCH',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_GET_ISSUER_CERT',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    ]);
    return tlsCodes.has(error?.code) || /certificate|cert|tls|hostname\/ip does not match/i.test(error?.message || '');
  }

  function tlsErrorMessage(error) {
    const message = sanitizeText(error?.message || 'TLS certificate validation failed.');
    if (error?.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /hostname\/ip does not match/i.test(message)) {
      return `${message} The target certificate does not match the requested hostname. Use --insecure or disable Verify TLS certificate only when policy allows it.`;
    }
    return message;
  }

  async function performHttpRequest(transport, validation, redirectHistory, signalState) {
    const url = validation.parsed;
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const headers = {};
    transport.headers.forEach(header => {
      if (!header.enabled) return;
      headers[header.name] = header.valueTemplate;
    });
    if (transport.cookies.length) {
      const cookieValue = transport.cookies.map(cookie => `${cookie.name}=${cookie.valueReference}`).join('; ');
      headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${cookieValue}` : cookieValue;
    }
    const bodyBuffer = hasBody(transport.body) ? Buffer.from(transport.body.raw || '', 'utf8') : null;
    if (bodyBuffer) headers['Content-Length'] = String(bodyBuffer.length);

    return new Promise((resolve, reject) => {
      const start = Date.now();
      const req = client.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: transport.method,
        headers,
        rejectUnauthorized: transport.tls.verifyCertificate,
        servername: url.hostname,
        lookup: (_hostname, options, callback) => {
          const cb = typeof options === 'function' ? options : callback;
          const lookupOptions = typeof options === 'function' ? {} : (options || {});
          if (lookupOptions.all) {
            cb(null, [{ address: validation.address, family: validation.family }]);
            return;
          }
          cb(null, validation.address, validation.family);
        },
      }, res => {
        const chunks = [];
        let total = 0;
        res.on('data', chunk => {
          total += chunk.length;
          if (total > LIMITS.responseBytes) {
            req.destroy(new ApiConsoleError('RESPONSE_TOO_LARGE', `Response exceeded ${LIMITS.responseBytes} bytes.`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            const rawBuffer = Buffer.concat(chunks);
            const decoded = decompressBody(rawBuffer, res.headers);
            if (decoded.length > LIMITS.responseBytes) {
              reject(new ApiConsoleError('RESPONSE_TOO_LARGE', `Decoded response exceeded ${LIMITS.responseBytes} bytes.`));
              return;
            }
            const contentType = String(res.headers['content-type'] || '');
            const bodyPreview = decoded.toString('utf8');
            resolve({
              statusCode: res.statusCode,
              statusText: res.statusMessage,
              headers: normalizeResponseHeaders(res.headers),
              cookies: parseSetCookie(res.headers['set-cookie']),
              bodyPreview: sanitizeText(bodyPreview),
              bodyReference: (() => {
                if (decoded.length <= 64 * 1024) return undefined;
                const bodyId = makeId('body');
                putBlob({ id: bodyId, contentType, bodyBuffer: decoded });
                return `/api/api-console/object-storage/${bodyId}`;
              })(),
              contentType,
              responseSize: decoded.length,
              durationMs: Date.now() - start,
              resolvedIpAddress: validation.address,
              redirectHistory,
              tlsVerified: transport.tls.verifyCertificate,
              safePreviewMode: responsePreviewMode(contentType),
              rawLocation: res.headers.location,
              ...(transport.captureSensitiveJson ? { internalBody: bodyPreview } : {}),
            });
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('socket', socket => {
        socket.setTimeout(LIMITS.readTimeoutMs, () => {
          req.destroy(new ApiConsoleError('READ_TIMEOUT', 'The target API did not finish reading within the configured timeout.'));
        });
      });
      req.setTimeout(LIMITS.connectTimeoutMs, () => {
        req.destroy(new ApiConsoleError('CONNECTION_TIMEOUT', 'The target API connection timed out.'));
      });
      req.on('error', error => {
        if (signalState.timedOut) {
          reject(new ApiConsoleError('READ_TIMEOUT', 'The API Console total execution timeout was reached.'));
        } else if (error instanceof ApiConsoleError) {
          reject(error);
        } else if (isTlsTransportError(error)) {
          reject(new ApiConsoleError('TLS_ERROR', tlsErrorMessage(error)));
        } else if (/ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/i.test(error.message || '')) {
          const target = `${validation.address}:${url.port || (isHttps ? 443 : 80)}`;
          const remapped = isCorporateRemappedAddress(validation.address);
          reject(new ApiConsoleError(
            'HTTP_ERROR',
            remapped
              ? `${sanitizeText(error.message || 'HTTP request failed.')} — مقصد ${target} شبیه نگاشت DNS سازمانی است؛ اتصال از این شبکه برقرار نشد.`
              : sanitizeText(error.message || `HTTP request failed (${target}).`),
          ));
        } else {
          reject(new ApiConsoleError('HTTP_ERROR', sanitizeText(error.message || 'HTTP request failed.')));
        }
      });
      if (bodyBuffer) req.write(bodyBuffer);
      req.end();
    });
  }

  async function executeWithRedirects(transport) {
    const started = Date.now();
    const initialOrigin = new URL(transport.url).origin;
    const redirectHistory = [];
    let current = safeClone(transport);
    let validation = await validateDestination(current.url);
    const signalState = { timedOut: false };
    const totalTimer = setTimeout(() => {
      signalState.timedOut = true;
    }, LIMITS.totalTimeoutMs);

    try {
      for (let i = 0; i <= LIMITS.maxRedirects; i += 1) {
        if (Date.now() - started > LIMITS.totalTimeoutMs || signalState.timedOut) {
          throw new ApiConsoleError('READ_TIMEOUT', 'The API Console total execution timeout was reached.');
        }
        const response = await performHttpRequest(current, validation, redirectHistory, signalState);
        const isRedirect = response.statusCode >= 300 && response.statusCode < 400 && response.rawLocation;
        if (!isRedirect) {
          delete response.rawLocation;
          response.durationMs = Date.now() - started;
          return response;
        }
        if (redirectHistory.length >= LIMITS.maxRedirects) {
          throw new ApiConsoleError('REDIRECT_BLOCKED', 'Maximum redirect count was exceeded.');
        }
        const from = current.url;
        const to = new URL(response.rawLocation, current.url).toString();
        if (transport.sameOriginRedirectsOnly && new URL(to).origin !== initialOrigin) {
          throw new ApiConsoleError('REDIRECT_BLOCKED', 'A cross-origin redirect was rejected.', 502);
        }
        const nextValidation = await validateDestination(to);
        redirectHistory.push({ from, to, statusCode: response.statusCode, allowed: true });
        current.url = to;
        if (response.statusCode === 303) {
          current.method = 'GET';
          current.body = { type: 'none', value: null, raw: '' };
        }
        validation = nextValidation;
      }
      throw new ApiConsoleError('REDIRECT_BLOCKED', 'Maximum redirect count was exceeded.');
    } finally {
      clearTimeout(totalTimer);
    }
  }

  function applyIsGatewayAuth(transport, context) {
    if (!transport || context?.authApproach !== 'IS' || !context.isGatewayCookie) return transport;
    const gateway = String(context.isGatewayBaseUrl || process.env.API_CONSOLE_IS_GATEWAY_URL || 'http://127.0.0.1:4000')
      .trim()
      .replace(/\/+$/, '')
      .replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
    const url = String(transport.url || '').replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
    if (!gateway || !url.startsWith(gateway)) return transport;
    const headers = Array.isArray(transport.headers) ? [...transport.headers] : [];
    const hasCookie = headers.some(header =>
      header && header.enabled !== false && String(header.name || '').toLowerCase() === 'cookie'
    );
    if (!hasCookie) {
      headers.push(createHeader('Cookie', context.isGatewayCookie, headers.length, 'SYSTEM'));
    }
    transport.headers = headers;
    return transport;
  }

  function isIsGatewayAccessDeniedResponse(response) {
    if (!response || Number(response.statusCode) !== 403) return false;
    const body = String(response.bodyPreview || response.internalBody || response.bodyText || response.body || '');
    return /دسترسی به این مسیر مجاز نیست|شما دسترسی به این مسیر را ندارید|Forbidden/i.test(body);
  }

  function isIsAutoEnsureAccessRulesEnabled() {
    const raw = String(process.env.API_CONSOLE_IS_AUTO_ENSURE_ACCESS_RULES || 'true').trim().toLowerCase();
    return !(raw === 'false' || raw === '0' || raw === 'off' || raw === 'no');
  }

  async function ensureIsGatewayAccessRule(context, transport) {
    if (!isIsAutoEnsureAccessRulesEnabled()) return { ok: false, skipped: true };
    if (!context?.isGatewayCookie) return { ok: false, error: 'missing gateway cookie' };
    let parsed;
    try {
      parsed = new URL(String(transport.url || ''));
    } catch {
      return { ok: false, error: 'invalid url' };
    }
    const gateway = String(context.isGatewayBaseUrl || process.env.API_CONSOLE_IS_GATEWAY_URL || 'http://127.0.0.1:4000')
      .trim()
      .replace(/\/+$/, '')
      .replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
    if (!gateway || !String(transport.url || '').replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1').startsWith(gateway)) {
      return { ok: false, error: 'not gateway url' };
    }
    const pathPrefix = parsed.pathname || '/';
    const method = String(transport.method || 'GET').toUpperCase();
    const rulesUrl = `${gateway}/api/v1/iam/rules`;
    try {
      const response = await fetch(rulesUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          cookie: context.isGatewayCookie,
        },
        body: JSON.stringify({
          path_prefix: pathPrefix,
          method,
          allowed_roles: [],
          is_public: true,
        }),
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      if (response.ok || response.status === 409) {
        return { ok: true, status: response.status, data };
      }
      return { ok: false, status: response.status, data, error: data?.message || response.statusText };
    } catch (error) {
      return { ok: false, error: error.message || 'ensure rule failed' };
    }
  }

  async function executeIsTransportWithAccessRecovery(transport, context) {
    let response = await executeWithRedirects(transport);
    if (!isIsGatewayAccessDeniedResponse(response)) return response;
    const ensured = await ensureIsGatewayAccessRule(context, transport);
    if (!ensured.ok) return response;
    return executeWithRedirects(transport);
  }

  async function executeRequest(requestId, context, options = {}) {
    if (!roleAllowed(context.role, API_CONSOLE_POLICY.canExecute)) {
      throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to execute API requests.', 403);
    }
    const request = getStore().requests.find(item => item.id === requestId);
    if (!request) throw new ApiConsoleError('INVALID_URL', 'Request not found.', 404);
    if (request.classification.type === 'CORE_COMMAND' && !roleAllowed(context.role, API_CONSOLE_POLICY.canExecuteCommand)) {
      throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Core Command execution requires elevated permission.', 403);
    }

    const environment = findEnvironment(options.environmentId || request.environmentId);
    const executionRequest = safeClone({
      ...request,
      scripts: { ...createDefaultScripts(), ...(request.scripts || {}) },
      executionMode: options.executionMode || request.executionMode,
    });
    const preScript = runPreRequestScript(executionRequest, executionRequest.scripts, options.executionVariables);
    const resolved = resolveRequest(
      preScript.request,
      environment,
      options.executionMode || request.executionMode,
      preScript.variables
    );
    if (preScript.results.some(result => result.result === 'FAILED')) {
      const execution = createBlockedExecution(request, resolved.snapshot, environment, context.userId, 'CORE_VALIDATION_ERROR', 'Pre-request script failed.', options.businessJustification, preScript.results);
      getStore().executions.unshift(execution);
      audit('API_REQUEST_EXECUTION_BLOCKED', context, { requestId, category: 'CORE_VALIDATION_ERROR', reason: 'PRE_REQUEST_SCRIPT' });
      saveStore(getStore());
      return safeClone(execution);
    }
    if (resolved.errors.length) {
      const first = resolved.errors[0];
      const execution = createBlockedExecution(request, resolved.snapshot, environment, context.userId, first.category, resolved.errors.map(item => item.message).join(' '), options.businessJustification, preScript.results);
      getStore().executions.unshift(execution);
      audit('API_REQUEST_EXECUTION_BLOCKED', context, { requestId, category: first.category });
      saveStore(getStore());
      return safeClone(execution);
    }

    const productionPolicy = validateProductionPolicy(request, environment, context, options);
    if (!productionPolicy.allowed) {
      const execution = createBlockedExecution(request, resolved.snapshot, environment, context.userId, productionPolicy.category, productionPolicy.message, options.businessJustification, preScript.results);
      getStore().executions.unshift(execution);
      audit('API_REQUEST_EXECUTION_BLOCKED', context, { requestId, category: productionPolicy.category });
      saveStore(getStore());
      return safeClone(execution);
    }

    const startedAt = nowIso();
    const preferredRunnerId = options.runnerId || request.runnerId;
    let runner;
    try {
      runner = selectRunner(environment, null, preferredRunnerId, resolved.snapshot?.url || resolved.transport?.url);
    } catch (error) {
      const execution = createBlockedExecution(
        request,
        resolved.snapshot,
        environment,
        context.userId,
        error.category || 'DESTINATION_NOT_ALLOWED',
        error.message || 'Runner zone unavailable.',
        options.businessJustification,
        preScript.results
      );
      execution.runnerHost = runnerHostTag();
      getStore().executions.unshift(execution);
      audit('API_REQUEST_EXECUTION_BLOCKED', context, { requestId, category: execution.errorCategory });
      saveStore(getStore());
      return safeClone(execution);
    }

    if (String(process.env.API_CONSOLE_ZONE_WORKER || '').toLowerCase() === 'true') {
      if (!zoneWorkerHeartbeatFresh()) {
        const execution = createBlockedExecution(
          request,
          resolved.snapshot,
          environment,
          context.userId,
          'ZONE_WORKER_UNAVAILABLE',
          'Zone worker is not running. Start with: npm run zone-worker -w @api-console/api',
          options.businessJustification,
          preScript.results
        );
        execution.runnerId = runner.id;
        execution.networkZone = runner.networkZone;
        execution.runnerHost = runnerHostTag();
        getStore().executions.unshift(execution);
        audit('API_REQUEST_EXECUTION_BLOCKED', context, { requestId, category: 'ZONE_WORKER_UNAVAILABLE' });
        saveStore(getStore());
        return safeClone(execution);
      }
      const queueJobId = makeId('zq');
      const job = {
        id: queueJobId,
        status: 'PENDING',
        requestId: request.id,
        collectionId: request.collectionId,
        environmentId: environment.id,
        environmentName: environment.name,
        runnerId: runner.id,
        networkZone: runner.networkZone,
        runnerHost: runnerHostTag(),
        executedBy: context.userId,
        startedAt,
        businessJustification: options.businessJustification,
        requestSnapshot: resolved.snapshot,
        transport: resolved.transport,
        assertions: request.assertions || [],
        scripts: executionRequest.scripts,
        preScriptResults: preScript.results,
        createdAt: nowIso(),
      };
      if (!Array.isArray(getStore().executionQueue)) getStore().executionQueue = [];
      getStore().executionQueue.push(job);
      saveStore(getStore());
      const deadline = Date.now() + Number(process.env.API_CONSOLE_ZONE_WORKER_WAIT_MS || 15000);
      while (Date.now() < deadline) {
        await sleep(250);
        reloadStoreFromDisk();
        const done = (getStore().executions || []).find(item => item.queueJobId === queueJobId);
        if (done) return safeClone(done);
        const current = (getStore().executionQueue || []).find(item => item.id === queueJobId);
        if (current?.status === 'FAILED') {
          const failed = createBlockedExecution(
            request,
            resolved.snapshot,
            environment,
            context.userId,
            current.errorCategory || 'INTERNAL_EXECUTION_ERROR',
            current.errorMessage || 'Zone worker failed to execute request.',
            options.businessJustification,
            preScript.results
          );
          failed.queueJobId = queueJobId;
          failed.runnerId = runner.id;
          failed.networkZone = runner.networkZone;
          failed.runnerHost = runnerHostTag();
          getStore().executions.unshift(failed);
          getStore().executionQueue = (getStore().executionQueue || []).filter(item => item.id !== queueJobId);
          saveStore(getStore());
          return safeClone(failed);
        }
      }
      const timedOut = createBlockedExecution(
        request,
        resolved.snapshot,
        environment,
        context.userId,
        'ZONE_WORKER_TIMEOUT',
        'Zone worker did not complete the queued execution in time.',
        options.businessJustification,
        preScript.results
      );
      timedOut.queueJobId = queueJobId;
      timedOut.runnerId = runner.id;
      timedOut.networkZone = runner.networkZone;
      timedOut.runnerHost = runnerHostTag();
      getStore().executions.unshift(timedOut);
      saveStore(getStore());
      return safeClone(timedOut);
    }

    try {
      const transport = applyIsGatewayAuth(safeClone(resolved.transport), context);
      const response = (context?.authApproach === 'IS' || context?.identitySource === 'IS')
        ? await executeIsTransportWithAccessRecovery(transport, context)
        : await executeWithRedirects(transport);
      runner = selectRunner(environment, response.resolvedIpAddress, preferredRunnerId, resolved.snapshot?.url || resolved.transport?.url);
      const assertionResults = evaluateAssertions(request, response);
      const postScriptResults = runPostResponseScript(executionRequest.scripts, response);
      const scriptAssertionResults = postScriptResults.map(result => ({
        assertionId: `script-${result.phase}-${result.line}`,
        assertionType: 'SCRIPT_TEST',
        result: result.result,
        message: `line ${result.line}: ${result.message}`,
      }));
      const scriptResults = [...preScript.results, ...postScriptResults];
      const businessResult = businessResultFromAssertions([...assertionResults, ...scriptAssertionResults]);
      const execution = {
        id: makeId('api-exec'),
        requestId: request.id,
        collectionId: request.collectionId,
        environmentId: environment.id,
        runnerId: runner.id,
        networkZone: runner.networkZone,
        runnerHost: runnerHostTag(),
        executedBy: context.userId,
        startedAt,
        completedAt: nowIso(),
        durationMs: response.durationMs,
        status: 'COMPLETED',
        statusCode: response.statusCode,
        responseSize: response.responseSize,
        responseContentType: response.contentType,
        requestSnapshot: resolved.snapshot,
        response,
        tlsVerification: resolved.snapshot.tls.verifyCertificate,
        transportResult: response.statusCode && response.statusCode < 400 ? 'SUCCESS' : 'FAILED',
        businessResult,
        assertionResults,
        scriptResults,
        correlationId: makeId('api-corr'),
        errorCategory: response.statusCode && response.statusCode >= 400 ? 'HTTP_ERROR' : undefined,
        sanitizedError: response.statusCode && response.statusCode >= 400 ? `HTTP ${response.statusCode} ${response.statusText}` : undefined,
        environmentName: environment.name,
        evidenceType: 'ACTUAL_EXECUTION',
        businessJustification: options.businessJustification,
      };
      getStore().executions.unshift(execution);
      logUsageEvent('API_EXECUTED', context, request, {
        environmentId: environment.id,
        correlationId: execution.correlationId,
        referenceId: request.referenceId,
      });
      audit('API_REQUEST_EXECUTED', context, { requestId, statusCode: execution.statusCode, runnerId: runner.id, runnerHost: execution.runnerHost });
      saveStore(getStore());
      return safeClone(execution);
    } catch (error) {
      const execution = createExecutionFromError(request, resolved, environment, context, error, options.businessJustification, preScript.results);
      execution.runnerHost = runnerHostTag();
      if (runner) {
        execution.runnerId = runner.id;
        execution.networkZone = runner.networkZone;
      }
      getStore().executions.unshift(execution);
      audit('API_REQUEST_EXECUTION_FAILED', context, { requestId, category: execution.errorCategory });
      saveStore(getStore());
      return safeClone(execution);
    }
  }

  return {
    parseSetCookie,
    responsePreviewMode,
    normalizeResponseHeaders,
    decompressBody,
    isTlsTransportError,
    tlsErrorMessage,
    performHttpRequest,
    executeWithRedirects,
    applyIsGatewayAuth,
    isIsGatewayAccessDeniedResponse,
    isIsAutoEnsureAccessRulesEnabled,
    ensureIsGatewayAccessRule,
    executeIsTransportWithAccessRecovery,
    executeRequest,
  };
}

module.exports = {
  createExecutionRunner,
};
