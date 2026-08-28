'use strict';

/**
 * Phase 3 platform routes (E24–E31 + remainders).
 * Returns result or undefined to fall through.
 */

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { URL } = require('url');

function deliverWebhook(url, secret, payload) {
  if (!url) return Promise.resolve({ skipped: true });
  const body = JSON.stringify(payload);
  const signature = secret
    ? crypto.createHmac('sha256', secret).update(body).digest('hex')
    : '';
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? https : http;
  const attempt = () => new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(signature ? { 'x-api-console-signature': `sha256=${signature}` } : {}),
      },
      timeout: 8000,
    }, (res) => {
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, statusCode: res.statusCode });
      else reject(new Error(`Webhook HTTP ${res.statusCode}`));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
    req.write(body);
    req.end();
  });
  return (async () => {
    let lastError = null;
    for (let i = 0; i < 3; i += 1) {
      try { return await attempt(); } catch (error) { lastError = error; }
    }
    return { ok: false, error: lastError?.message || 'Webhook failed' };
  })();
}

function redactSecretsDeep(value) {
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1***')
      .replace(/(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*["']?[^\s"'&]+/gi, '$1=***');
  }
  if (Array.isArray(value)) return value.map(redactSecretsDeep);
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (/password|secret|token|authorization|cookie/i.test(key)) next[key] = '***';
      else next[key] = redactSecretsDeep(item);
    }
    return next;
  }
  return value;
}

function scanTextForSecrets(text) {
  const findings = [];
  const raw = String(text || '');
  const patterns = [
    { id: 'BEARER_TOKEN', re: /Bearer\s+[A-Za-z0-9\-._~+/]{12,}=*/i },
    { id: 'PASSWORD_FLAG', re: /(?:-u|--user)\s+[^\s:]+:[^\s]+/i },
    { id: 'API_KEY_HEADER', re: /(?:api[_-]?key|x-api-key)\s*[:=]\s*["']?[A-Za-z0-9\-_]{8,}/i },
    { id: 'COOKIE_HEADER', re: /(?:^|\n|;)\s*Cookie:\s*[^\n]+/i },
    { id: 'JWT', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  ];
  patterns.forEach(pattern => {
    if (pattern.re.test(raw)) findings.push(pattern.id);
  });
  return [...new Set(findings)];
}

function parseConfiguredOrigins() {
  const raw = process.env.API_CONSOLE_CDE_ORIGINS || '';
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((item, index) => ({
          id: String(item.id || `origin-${index + 1}`),
          label: String(item.label || item.baseUrl || item.id || `Origin ${index + 1}`),
          baseUrl: String(item.baseUrl || '').replace(/\/$/, ''),
        })).filter(item => item.baseUrl);
      }
    } catch {}
  }
  const fallback = String(process.env.CDE_CORE_BASE_URL || 'https://cde.edus.ir').replace(/\/$/, '');
  return [{ id: 'default', label: 'Default CDE', baseUrl: fallback }];
}

function createPhase3Router(deps) {
  const {
    ApiConsoleError,
    makeId,
    nowIso,
    safeClone,
    sanitizeText,
    requireContext,
    assertCsrf,
    roleAllowed,
    API_CONSOLE_POLICY,
    assertApplicationInContext,
    matchesApplicationScope,
    paginate,
    audit,
    notifyUser,
    saveStore,
    getStore,
    setStoreField,
    belongsToUser,
    semanticVersionOf,
    consumersForVersion,
    findEnvironment,
    assertCanReviewShares,
    DATA_DIR,
    DOCX_TEMPLATE_FILE,
  } = deps;

  function store() {
    return getStore();
  }

  function ensurePhase3Collections() {
    if (!Array.isArray(store().mocks)) setStoreField('mocks', []);
    if (!Array.isArray(store().mockCallLogs)) setStoreField('mockCallLogs', []);
    if (!Array.isArray(store().jitAccessGrants)) setStoreField('jitAccessGrants', []);
    if (!Array.isArray(store().itsmWebhookQueue)) setStoreField('itsmWebhookQueue', []);
    if (!Array.isArray(store().portalShareTokens)) setStoreField('portalShareTokens', []);
    if (!Array.isArray(store().contractBaselines)) setStoreField('contractBaselines', []);
    if (!Array.isArray(store().executionQueue)) setStoreField('executionQueue', []);
    if (!Array.isArray(store().dualApprovals)) setStoreField('dualApprovals', []);
    if (!store().orgPolicies || typeof store().orgPolicies !== 'object' || Array.isArray(store().orgPolicies)) {
      setStoreField('orgPolicies', {
        privateDestinationAllowlist: [],
        dualApprovalProductionCommand: false,
        forbidInsecureTlsInProduction: true,
        forbidExactModeInProduction: true,
        maxPortalShareTtlHours: 168,
        allowAnonymousPortalShare: true,
        updatedAt: null,
        updatedBy: null,
      });
    } else if (store().orgPolicies.maxPortalShareTtlHours == null) {
      store().orgPolicies.maxPortalShareTtlHours = 168;
      store().orgPolicies.allowAnonymousPortalShare = store().orgPolicies.allowAnonymousPortalShare !== false;
    }
    if (!store().branding) {
      setStoreField('branding', {
        activeTemplateId: 'default',
        templates: [{
          id: 'default',
          name: 'Default DOCX',
          language: 'FA',
          filePath: DOCX_TEMPLATE_FILE,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }],
      });
    }
  }

  function inferJsonSchemaFromValue(value) {
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) {
      return { type: 'array', items: value.length ? inferJsonSchemaFromValue(value[0]) : {} };
    }
    if (typeof value === 'object') {
      const properties = {};
      const required = [];
      Object.entries(value).forEach(([key, item]) => {
        properties[key] = inferJsonSchemaFromValue(item);
        required.push(key);
      });
      return { type: 'object', properties, required };
    }
    return { type: typeof value };
  }

  function schemaSummaryFromOpenApi(spec) {
    const summary = {};
    for (const [pathname, methods] of Object.entries(spec?.paths || {})) {
      for (const [method, operation] of Object.entries(methods || {})) {
        if (!operation || typeof operation !== 'object' || String(method).startsWith('x-')) continue;
        const content = operation.requestBody?.content?.['application/json']
          || operation.responses?.['200']?.content?.['application/json']
          || {};
        let schema = content.schema;
        if ((!schema || !schema.properties) && content.example && typeof content.example === 'object') {
          schema = inferJsonSchemaFromValue(content.example);
        }
        schema = schema || { type: 'object', properties: {}, required: [] };
        const properties = {};
        Object.entries(schema.properties || {}).forEach(([key, prop]) => {
          properties[key] = String(prop?.type || (prop?.$ref ? 'ref' : 'object'));
        });
        summary[`${String(method).toUpperCase()} ${pathname}`] = {
          required: Array.isArray(schema.required) ? [...schema.required].sort() : [],
          properties,
        };
      }
    }
    return summary;
  }

  function fingerprintSchemaSummary(summary) {
    return crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex');
  }

  function compareSchemaSummaries(baselineSummary, currentSummary) {
    const breaking = [];
    const nonBreaking = [];
    const baseline = baselineSummary || {};
    const current = currentSummary || {};
    for (const key of Object.keys(baseline)) {
      if (!current[key]) {
        breaking.push({ kind: 'REMOVED_PATH_METHOD', pathMethod: key });
        continue;
      }
      const base = baseline[key];
      const next = current[key];
      for (const prop of base.required || []) {
        if (!(prop in (next.properties || {}))) {
          breaking.push({ kind: 'REMOVED_REQUIRED_PROPERTY', pathMethod: key, property: prop });
        }
      }
      for (const [prop, type] of Object.entries(base.properties || {})) {
        if (!(prop in (next.properties || {}))) {
          if ((base.required || []).includes(prop)) continue;
          nonBreaking.push({ kind: 'REMOVED_OPTIONAL_PROPERTY', pathMethod: key, property: prop });
        } else if (String(next.properties[prop]) !== String(type)) {
          breaking.push({
            kind: 'TYPE_CHANGE',
            pathMethod: key,
            property: prop,
            from: type,
            to: next.properties[prop],
          });
        }
      }
      for (const [prop, type] of Object.entries(next.properties || {})) {
        if (!(prop in (base.properties || {}))) {
          nonBreaking.push({ kind: 'ADDED_PROPERTY', pathMethod: key, property: prop, type });
        }
      }
      for (const prop of next.required || []) {
        if (!(base.required || []).includes(prop)) {
          nonBreaking.push({ kind: 'ADDED_REQUIRED_PROPERTY', pathMethod: key, property: prop });
        }
      }
    }
    for (const key of Object.keys(current)) {
      if (!baseline[key]) nonBreaking.push({ kind: 'ADDED_PATH_METHOD', pathMethod: key });
    }
    return { breaking, nonBreaking };
  }

  function buildOpenApiFromRequests(title, version, requests) {
    const paths = {};
    for (const request of requests) {
      const method = String(request.method || 'GET').toLowerCase();
      let pathname = '/';
      try {
        const url = new URL(String(request.urlTemplate || 'https://example.local/'), 'https://example.local');
        pathname = url.pathname || '/';
      } catch {
        pathname = `/${encodeURIComponent(request.name || request.id)}`;
      }
      if (!paths[pathname]) paths[pathname] = {};
      const classification = request.classification || {};
      paths[pathname][method] = redactSecretsDeep({
        operationId: String(request.apiId || request.id).replace(/[^a-zA-Z0-9_]/g, '_'),
        summary: request.name,
        description: request.description || request.documentation?.description || '',
        tags: [classification.type || 'GENERIC_HTTP'],
        parameters: (request.queryParameters || []).filter(row => row.enabled !== false).map(row => ({
          name: row.key,
          in: 'query',
          required: false,
          schema: { type: 'string' },
          example: /secret|token|password/i.test(row.key) ? '***' : row.value,
        })),
        requestBody: request.bodyTemplate ? {
          content: {
            'application/json': (() => {
              let example = { raw: '***' };
              try { example = redactSecretsDeep(JSON.parse(request.bodyTemplate)); } catch {}
              const schema = typeof example === 'object' && example && !example.raw
                ? inferJsonSchemaFromValue(example)
                : { type: 'object', additionalProperties: true };
              return { schema, example };
            })(),
          },
        } : undefined,
        responses: {
          200: { description: 'Successful response' },
          default: { description: 'Error response' },
        },
        'x-core-serviceId': classification.serviceId || undefined,
        'x-core-operationPath': classification.operationPath || undefined,
        'x-core-operationType': classification.coreOperationType || undefined,
        'x-api-console-requestId': request.id,
        'x-breaking-change': request.breakingChange === true || undefined,
        'x-migration-note': request.migrationNote || undefined,
      });
    }
    return {
      openapi: '3.0.3',
      info: {
        title: title || 'API Console Collection',
        version: version || '1.0.0',
        description: 'Generated by Online API Console. Secrets are redacted.',
      },
      servers: [{ url: '/' }],
      paths,
    };
  }

  function generateContractAssertionsFromOpenApi(spec) {
    const assertions = [];
    for (const [pathname, methods] of Object.entries(spec.paths || {})) {
      for (const [method, operation] of Object.entries(methods || {})) {
        assertions.push({
          id: makeId('assert'),
          assertionType: 'EXPECTED_HTTP_STATUS',
          enabled: true,
          configuration: { expectedHttpStatuses: [200], path: pathname, method },
        });
        const example = operation?.requestBody?.content?.['application/json']?.example;
        if (example && typeof example === 'object' && !Array.isArray(example)) {
          Object.keys(example).slice(0, 5).forEach(key => {
            assertions.push({
              id: makeId('assert'),
              assertionType: 'REQUIRED_JSON_PATH',
              enabled: true,
              configuration: { jsonPath: `$.${key}`, path: pathname, method },
            });
          });
        }
        assertions.push({
          id: makeId('assert'),
          assertionType: 'JSON_SCHEMA',
          enabled: true,
          configuration: {
            schema: {
              type: 'object',
              additionalProperties: true,
            },
            path: pathname,
            method,
          },
        });
      }
    }
    return assertions;
  }

  function activeJitGrant(userId, applicationId) {
    const now = Date.now();
    return (store().jitAccessGrants || []).find(grant =>
      grant.userId === userId &&
      grant.applicationId === applicationId &&
      grant.status === 'ACTIVE' &&
      new Date(grant.expiresAt).getTime() > now
    );
  }

  function ticketAllowlisted(url) {
    const allow = String(process.env.API_CONSOLE_ITSM_URL_ALLOWLIST || '').split(',').map(item => item.trim()).filter(Boolean);
    if (!allow.length) return true;
    try {
      const host = new URL(url).hostname.toLowerCase();
      return allow.some(pattern => host === pattern.toLowerCase() || host.endsWith(`.${pattern.toLowerCase()}`));
    } catch {
      return false;
    }
  }

  async function enqueueItsmEvent(eventType, payload) {
    ensurePhase3Collections();
    const url = process.env.API_CONSOLE_ITSM_WEBHOOK_URL || '';
    const secret = process.env.API_CONSOLE_ITSM_WEBHOOK_SECRET || '';
    const item = {
      id: makeId('itsm'),
      eventType,
      payload,
      createdAt: nowIso(),
      attempts: 0,
      status: url ? 'PENDING' : 'SKIPPED',
      lastError: null,
    };
    store().itsmWebhookQueue.unshift(item);
    store().itsmWebhookQueue = store().itsmWebhookQueue.slice(0, 200);
    if (!url) return item;
    item.attempts = 1;
    const delivery = await deliverWebhook(url, secret, { event: eventType, ...payload });
    item.status = delivery.ok ? 'DELIVERED' : 'FAILED';
    item.lastError = delivery.error || null;
    item.deliveredAt = nowIso();
    return item;
  }

  return async function tryHandlePhase3(req, parsedUrl, body, parts) {
    const [first, second, third, fourth, fifth] = parts;
    ensurePhase3Collections();

    if (first === 'cde-origins' && req.method === 'GET') {
      return safeClone({ data: parseConfiguredOrigins() });
    }

    if (first === 'portal' && second === 'share-tokens' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canView)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to create portal share tokens.', 403);
      }
      const data = body.data || body;
      const apiId = String(data.apiId || '').trim();
      const version = String(data.version || '').trim();
      const ttlHours = Math.min(
        Number(store().orgPolicies?.maxPortalShareTtlHours || 168),
        Math.max(1, Number(data.ttlHours || 24))
      );
      if (!apiId || !version) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'apiId and version are required.');
      const request = store().requests.find(item =>
        item.apiId === apiId &&
        semanticVersionOf(item) === version &&
        item.sourceType !== 'REFERENCE' &&
        ['APPROVED', 'DEPRECATED'].includes(item.sharingStatus)
      );
      if (!request) throw new ApiConsoleError('INVALID_URL', 'Approved portal document not found.', 404);
      assertApplicationInContext(request.applicationId, context);
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
      const record = {
        id: makeId('pshare'),
        token,
        apiId,
        version,
        requestId: request.id,
        applicationId: request.applicationId,
        originId: context.cdeOriginId || request.originId || 'default',
        expiresAt,
        createdBy: context.userId,
        createdAt: nowIso(),
        urlPath: `/portal/shared/${token}`,
      };
      store().portalShareTokens.unshift(record);
      store().portalShareTokens = store().portalShareTokens.slice(0, 500);
      audit('PORTAL_SHARE_TOKEN_CREATED', context, { apiId, version, expiresAt, tokenId: record.id });
      saveStore(store());
      return safeClone({ token, expiresAt, urlPath: record.urlPath, id: record.id });
    }

    if (first === 'portal' && second === 'shared' && third && req.method === 'GET') {
      const token = decodeURIComponent(third);
      const record = (store().portalShareTokens || []).find(item => item.token === token);
      if (!record) throw new ApiConsoleError('INVALID_URL', 'Share link not found.', 404);
      if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
        throw new ApiConsoleError('INVALID_URL', 'Share link expired.', 410);
      }
      const request = store().requests.find(item =>
        item.id === record.requestId ||
        (item.apiId === record.apiId && semanticVersionOf(item) === record.version)
      );
      if (!request || !['APPROVED', 'DEPRECATED'].includes(request.sharingStatus)) {
        throw new ApiConsoleError('INVALID_URL', 'Shared document not found.', 404);
      }
      return safeClone({
        apiId: request.apiId,
        version: semanticVersionOf(request),
        name: request.name,
        method: request.method,
        urlTemplate: request.urlTemplate,
        description: request.documentation?.description || request.description || '',
        documentation: request.documentation,
        classification: request.classification,
        sharingStatus: request.sharingStatus,
        breakingChange: request.breakingChange === true,
        migrationNote: request.migrationNote,
        openapi: buildOpenApiFromRequests(request.name, semanticVersionOf(request), [request]),
        executeProductionAllowed: false,
        expiresAt: record.expiresAt,
        readOnly: true,
      });
    }

    if (first === 'portal' && second === 'repository' && req.method === 'GET') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canView)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Login required to view portal.', 403);
      }
      const search = String(parsedUrl.searchParams.get('search') || '').toLowerCase();
      const classificationType = parsedUrl.searchParams.get('classificationType') || '';
      const serviceId = String(parsedUrl.searchParams.get('serviceId') || '').toLowerCase();
      const applicationId = parsedUrl.searchParams.get('applicationId') || context.applicationId || 'ALL';
      let rows = store().requests.filter(request =>
        request.sourceType !== 'REFERENCE' &&
        ['APPROVED', 'DEPRECATED'].includes(request.sharingStatus) &&
        matchesApplicationScope(request.applicationId, applicationId) &&
        matchesApplicationScope(request.applicationId, context.scopeApplicationIds || context.applicationId)
      );
      if (classificationType) rows = rows.filter(request => request.classification?.type === classificationType);
      if (serviceId) rows = rows.filter(request => String(request.classification?.serviceId || '').toLowerCase().includes(serviceId));
      if (search) {
        rows = rows.filter(request => [request.name, request.apiId, request.description, request.urlTemplate]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(search)));
      }
      rows = rows
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .map(request => ({
          id: request.id,
          apiId: request.apiId,
          title: request.name,
          version: semanticVersionOf(request),
          applicationId: request.applicationId,
          method: request.method,
          urlTemplate: request.urlTemplate,
          classification: request.classification,
          sharingStatus: request.sharingStatus,
          breakingChange: request.breakingChange === true,
          migrationNote: request.migrationNote,
          ticketId: request.ticketId,
          ticketUrl: request.ticketUrl,
          description: request.documentation?.description || request.description || '',
          executeProductionAllowed: false,
        }));
      return safeClone(paginate(rows, Number(parsedUrl.searchParams.get('page') || 1), Number(parsedUrl.searchParams.get('limit') || 30)));
    }

    if (first === 'portal' && second === 'repository' && third && fourth === 'versions' && fifth && req.method === 'GET') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canView)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Login required to view portal.', 403);
      }
      const apiId = decodeURIComponent(third);
      const version = decodeURIComponent(fifth);
      const request = store().requests.find(item =>
        item.apiId === apiId &&
        semanticVersionOf(item) === version &&
        item.sourceType !== 'REFERENCE' &&
        ['APPROVED', 'DEPRECATED'].includes(item.sharingStatus)
      );
      if (!request) throw new ApiConsoleError('INVALID_URL', 'Portal document not found.', 404);
      assertApplicationInContext(request.applicationId, context);
      return safeClone({
        ...request,
        openapi: buildOpenApiFromRequests(request.name, version, [request]),
        executeProductionAllowed: false,
      });
    }

    if (first === 'collections' && second && third === 'openapi.json' && req.method === 'GET') {
      const context = requireContext(req, body);
      const collection = store().collections.find(item => item.id === second && item.status === 'ACTIVE');
      if (!collection || !belongsToUser(collection, context)) throw new ApiConsoleError('INVALID_URL', 'Collection not found.', 404);
      const rows = store().requests.filter(request =>
        request.collectionId === collection.id &&
        request.status !== 'ARCHIVED' &&
        belongsToUser(request, context)
      );
      const spec = buildOpenApiFromRequests(collection.name, '1.0.0', rows);
      audit('OPENAPI_EXPORTED', context, { applicationId: collection.applicationId, collectionId: collection.id, requestCount: rows.length });
      saveStore(store());
      return {
        __rawResponse: {
          statusCode: 200,
          contentType: 'application/json; charset=utf-8',
          headers: { 'content-disposition': `attachment; filename="${collection.name.replace(/[^\w.-]+/g, '_')}.openapi.json"` },
          body: JSON.stringify(spec, null, 2),
        },
      };
    }

    if (first === 'repository' && second && third === 'versions' && fourth && fifth === 'openapi.json' && req.method === 'GET') {
      const context = requireContext(req, body);
      const apiId = decodeURIComponent(second);
      const version = decodeURIComponent(fourth);
      const request = store().requests.find(item =>
        item.apiId === apiId &&
        semanticVersionOf(item) === version &&
        item.sourceType !== 'REFERENCE' &&
        ['APPROVED', 'DEPRECATED'].includes(item.sharingStatus)
      );
      if (!request) throw new ApiConsoleError('INVALID_URL', 'Repository version not found.', 404);
      assertApplicationInContext(request.applicationId, context);
      const spec = buildOpenApiFromRequests(request.name, version, [request]);
      audit('OPENAPI_EXPORTED', context, { applicationId: request.applicationId, apiId, version });
      saveStore(store());
      return {
        __rawResponse: {
          statusCode: 200,
          contentType: 'application/json; charset=utf-8',
          headers: { 'content-disposition': `attachment; filename="${apiId}-${version}.openapi.json"` },
          body: JSON.stringify(spec, null, 2),
        },
      };
    }

    if (first === 'secret-scan' && req.method === 'POST') {
      const context = requireContext(req, body);
      const text = String(body.text || body.curlText || body.data?.text || '');
      const findings = scanTextForSecrets(text);
      const mode = String(process.env.API_CONSOLE_SECRET_SCAN_MODE || 'warn').toLowerCase();
      if (findings.length && mode === 'block') {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', `Secret patterns detected (${findings.join(', ')}). Remove secrets before import.`, 422);
      }
      audit('SECRET_SCAN_PERFORMED', context, { findings, mode });
      saveStore(store());
      return safeClone({ findings, mode, blocked: false, warnings: findings.map(id => `Potential secret pattern: ${id}`) });
    }

    if (first === 'branding' && second === 'templates') {
      const context = requireContext(req, body);
      if (context.role !== 'SYSTEM_ADMIN') throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only SYSTEM_ADMIN can manage branding.', 403);
      if (!third && req.method === 'GET') return safeClone(store().branding);
      if (!third && req.method === 'POST') {
        assertCsrf(req);
        const data = body.data || body;
        const name = String(data.name || 'Custom template').trim();
        const language = String(data.language || 'FA').toUpperCase() === 'EN' ? 'EN' : 'FA';
        const base64 = String(data.fileBase64 || '').trim();
        if (!base64) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'fileBase64 is required.');
        const templatesDir = path.join(DATA_DIR, 'docx-templates');
        fs.mkdirSync(templatesDir, { recursive: true });
        const id = makeId('tpl');
        const filePath = path.join(templatesDir, `${id}.docx`);
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
        const template = { id, name, language, filePath, createdAt: nowIso(), updatedAt: nowIso(), createdBy: context.userId };
        store().branding.templates.unshift(template);
        store().branding.activeTemplateId = id;
        audit('DOCX_TEMPLATE_CHANGED', context, { templateId: id, name, language });
        saveStore(store());
        return safeClone(template);
      }
      if (third === 'activate' && req.method === 'POST') {
        assertCsrf(req);
        const templateId = String(body.templateId || body.data?.templateId || '');
        const template = store().branding.templates.find(item => item.id === templateId);
        if (!template) throw new ApiConsoleError('INVALID_URL', 'Template not found.', 404);
        store().branding.activeTemplateId = template.id;
        audit('DOCX_TEMPLATE_CHANGED', context, { templateId: template.id, activated: true });
        saveStore(store());
        return safeClone(store().branding);
      }
      if (third === 'preview' && req.method === 'POST') {
        assertCsrf(req);
        const language = String(body.language || body.data?.language || 'FA').toUpperCase() === 'EN' ? 'EN' : 'FA';
        const labels = language === 'EN'
          ? { title: 'API Operations Guide', intro: 'Sample preview document', method: 'Method', endpoint: 'Endpoint' }
          : { title: 'مستندات بهره‌برداری', intro: 'پیش‌نمایش نمونه سند', method: 'متد', endpoint: 'آدرس' };
        return safeClone({
          language,
          labels,
          sample: {
            title: language === 'EN' ? 'Sample API' : 'نمونه API',
            method: 'POST',
            endpoint: '/api/sample',
          },
        });
      }
    }

    if (first === 'mocks') {
      const context = requireContext(req, body);
      if (!second && req.method === 'GET') {
        const applicationId = parsedUrl.searchParams.get('applicationId') || context.applicationId;
        const rows = (store().mocks || []).filter(mock =>
          mock.status !== 'REMOVED' &&
          matchesApplicationScope(mock.applicationId, applicationId)
        );
        return safeClone(paginate(rows, Number(parsedUrl.searchParams.get('page') || 1), Number(parsedUrl.searchParams.get('limit') || 30)));
      }
      if (!second && req.method === 'POST') {
        assertCsrf(req);
        if (!roleAllowed(context.role, API_CONSOLE_POLICY.canEdit)) {
          throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to create mocks.', 403);
        }
        const data = body.data || body;
        const request = store().requests.find(item => item.id === String(data.requestId || ''));
        if (!request || !belongsToUser(request, context)) throw new ApiConsoleError('INVALID_URL', 'Request not found.', 404);
        const environment = findEnvironment(data.environmentId || request.environmentId);
        if (environment?.kind === 'PRODUCTION' && context.role !== 'SYSTEM_ADMIN') {
          throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Mock در Production فقط با SYSTEM_ADMIN مجاز است.', 403);
        }
        const example = (store().manualExamples || []).find(item => item.id === data.manualExampleId && item.requestId === request.id)
          || (store().manualExamples || []).find(item => item.requestId === request.id);
        const lastSuccess = (store().executions || []).find(item =>
          item.requestId === request.id && item.transportResult === 'SUCCESS'
        );
        const responseBody = example?.body || lastSuccess?.response?.bodyPreview || '{"ok":true}';
        const statusCode = Number(example?.statusCode || lastSuccess?.statusCode || 200);
        const ttlMinutes = Math.max(5, Number(data.ttlMinutes || 60));
        const mock = {
          id: makeId('mock'),
          requestId: request.id,
          collectionId: request.collectionId,
          applicationId: request.applicationId,
          environmentId: environment?.id,
          method: request.method,
          pathMatch: String(data.pathMatch || `/${request.id}`),
          statusCode,
          responseBody: String(responseBody).slice(0, 200000),
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
          createdBy: context.userId,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          hitCount: 0,
        };
        store().mocks.unshift(mock);
        audit('MOCK_CREATED', context, { mockId: mock.id, requestId: request.id, applicationId: request.applicationId });
        saveStore(store());
        return safeClone(mock);
      }
      if (second && req.method === 'DELETE') {
        assertCsrf(req);
        const mock = store().mocks.find(item => item.id === second);
        if (!mock) throw new ApiConsoleError('INVALID_URL', 'Mock not found.', 404);
        mock.status = 'DISABLED';
        mock.updatedAt = nowIso();
        audit('MOCK_DISABLED', context, { mockId: mock.id });
        saveStore(store());
        return safeClone(mock);
      }
    }

    if (first === 'mock-serve' && second) {
      const mock = store().mocks.find(item => item.id === second && item.status === 'ACTIVE');
      if (!mock) throw new ApiConsoleError('INVALID_URL', 'Mock not found or disabled.', 404);
      if (mock.expiresAt && new Date(mock.expiresAt).getTime() < Date.now()) {
        mock.status = 'EXPIRED';
        saveStore(store());
        throw new ApiConsoleError('INVALID_URL', 'Mock expired.', 410);
      }
      mock.hitCount = Number(mock.hitCount || 0) + 1;
      store().mockCallLogs.unshift({
        id: makeId('mocklog'),
        mockId: mock.id,
        method: req.method,
        path: parsedUrl.pathname,
        at: nowIso(),
      });
      store().mockCallLogs = store().mockCallLogs.slice(0, 500);
      saveStore(store());
      return {
        __rawResponse: {
          statusCode: mock.statusCode || 200,
          contentType: 'application/json; charset=utf-8',
          body: mock.responseBody || '{}',
        },
      };
    }

    if (first === 'contract-baselines') {
      if (!second && req.method === 'GET') {
        const context = requireContext(req, body);
        const collectionId = String(parsedUrl.searchParams.get('collectionId') || '');
        let rows = store().contractBaselines || [];
        if (collectionId) rows = rows.filter(item => item.collectionId === collectionId);
        rows = rows.filter(item => {
          const collection = store().collections.find(row => row.id === item.collectionId);
          return collection && belongsToUser(collection, context);
        });
        return safeClone(paginate(rows, Number(parsedUrl.searchParams.get('page') || 1), Number(parsedUrl.searchParams.get('limit') || 30)));
      }
      if (!second && req.method === 'POST') {
        assertCsrf(req);
        const context = requireContext(req, body);
        if (!roleAllowed(context.role, API_CONSOLE_POLICY.canEdit)) {
          throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to create contract baselines.', 403);
        }
        const data = body.data || body;
        const collectionId = String(data.collectionId || '');
        const collection = store().collections.find(item => item.id === collectionId && item.status === 'ACTIVE');
        if (!collection || !belongsToUser(collection, context)) throw new ApiConsoleError('INVALID_URL', 'Collection not found.', 404);
        const rows = store().requests.filter(item => item.collectionId === collectionId && item.status !== 'ARCHIVED');
        const openapi = data.openapi || buildOpenApiFromRequests(collection.name, '1.0.0', rows);
        const schemaSummary = schemaSummaryFromOpenApi(openapi);
        const baseline = {
          id: makeId('cbase'),
          collectionId,
          name: String(data.name || `${collection.name} baseline`).trim(),
          fingerprint: fingerprintSchemaSummary(schemaSummary),
          schemaSummary,
          openapi,
          originId: context.cdeOriginId || collection.originId || 'default',
          createdBy: context.userId,
          createdAt: nowIso(),
        };
        store().contractBaselines.unshift(baseline);
        audit('CONTRACT_BASELINE_CREATED', context, { baselineId: baseline.id, collectionId, fingerprint: baseline.fingerprint });
        saveStore(store());
        return safeClone(baseline);
      }
      if (second && third === 'compare' && req.method === 'POST') {
        assertCsrf(req);
        const context = requireContext(req, body);
        const baseline = (store().contractBaselines || []).find(item => item.id === second);
        if (!baseline) throw new ApiConsoleError('INVALID_URL', 'Contract baseline not found.', 404);
        const collection = store().collections.find(item => item.id === baseline.collectionId);
        if (!collection || !belongsToUser(collection, context)) throw new ApiConsoleError('INVALID_URL', 'Collection not found.', 404);
        const data = body.data || body;
        let openapi = data.openapi;
        if (!openapi) {
          const rows = store().requests.filter(item => item.collectionId === baseline.collectionId && item.status !== 'ARCHIVED');
          openapi = buildOpenApiFromRequests(collection.name, '1.0.0', rows);
        }
        const currentSummary = schemaSummaryFromOpenApi(openapi);
        const diff = compareSchemaSummaries(baseline.schemaSummary, currentSummary);
        audit('CONTRACT_BASELINE_COMPARED', context, {
          baselineId: baseline.id,
          breaking: diff.breaking.length,
          nonBreaking: diff.nonBreaking.length,
        });
        saveStore(store());
        return safeClone({
          baselineId: baseline.id,
          fingerprint: baseline.fingerprint,
          currentFingerprint: fingerprintSchemaSummary(currentSummary),
          breaking: diff.breaking,
          nonBreaking: diff.nonBreaking,
        });
      }
    }

    if (first === 'contract-suites' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canEdit)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to create contract suites.', 403);
      }
      const data = body.data || body;
      const collectionId = String(data.collectionId || '');
      const collection = store().collections.find(item => item.id === collectionId && item.status === 'ACTIVE');
      if (!collection || !belongsToUser(collection, context)) throw new ApiConsoleError('INVALID_URL', 'Collection not found.', 404);
      let spec = data.openapi;
      if (!spec && data.requestId) {
        const request = store().requests.find(item => item.id === data.requestId);
        if (!request) throw new ApiConsoleError('INVALID_URL', 'Request not found.', 404);
        spec = buildOpenApiFromRequests(request.name, semanticVersionOf(request), [request]);
      }
      if (!spec) {
        const rows = store().requests.filter(item => item.collectionId === collectionId && item.status !== 'ARCHIVED');
        spec = buildOpenApiFromRequests(collection.name, '1.0.0', rows);
      }
      const assertions = generateContractAssertionsFromOpenApi(spec);
      const targetRequests = store().requests.filter(item => item.collectionId === collectionId && item.status !== 'ARCHIVED' && belongsToUser(item, context));
      let updated = 0;
      targetRequests.forEach(request => {
        request.assertions = [...(request.assertions || []), ...assertions.slice(0, 8).map(item => ({ ...item, id: makeId('assert') }))];
        request.updatedAt = nowIso();
        request.updatedBy = context.userId;
        updated += 1;
      });
      audit('CONTRACT_SUITE_GENERATED', context, { collectionId, assertionCount: assertions.length, updated });
      saveStore(store());
      return safeClone({ collectionId, assertionCount: assertions.length, updatedRequests: updated, openapi: spec });
    }

    if (first === 'jit-access') {
      const context = requireContext(req, body);
      if (!second && req.method === 'GET') {
        const rows = (store().jitAccessGrants || []).filter(grant =>
          grant.userId === context.userId || context.role === 'SYSTEM_ADMIN'
        );
        return safeClone(paginate(rows, 1, 50));
      }
      if (!second && req.method === 'POST') {
        assertCsrf(req);
        const data = body.data || body;
        const applicationId = assertApplicationInContext(data.applicationId || context.applicationId, context);
        const grant = {
          id: makeId('jit'),
          userId: context.userId,
          applicationId,
          reason: sanitizeText(String(data.reason || '')),
          status: 'PENDING',
          requestedAt: nowIso(),
          expiresAt: null,
          approvedBy: null,
          approvedAt: null,
        };
        if (!grant.reason) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'دلیل درخواست JIT الزامی است.');
        store().jitAccessGrants.unshift(grant);
        audit('JIT_ACCESS_REQUESTED', context, { grantId: grant.id, applicationId });
        saveStore(store());
        return safeClone(grant);
      }
      if (second && third === 'approve' && req.method === 'POST') {
        assertCsrf(req);
        if (context.role !== 'SYSTEM_ADMIN' && !roleAllowed(context.role, API_CONSOLE_POLICY.canManageProtectedEnvironments)) {
          throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to approve JIT access.', 403);
        }
        const grant = store().jitAccessGrants.find(item => item.id === second);
        if (!grant) throw new ApiConsoleError('INVALID_URL', 'JIT grant not found.', 404);
        const minutes = Math.min(24 * 60, Math.max(15, Number(body.ttlMinutes || body.data?.ttlMinutes || 60)));
        grant.status = 'ACTIVE';
        grant.approvedBy = context.userId;
        grant.approvedAt = nowIso();
        grant.expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
        notifyUser(grant.userId, 'دسترسی موقت Production', `تا ${grant.expiresAt} فعال است.`, 'JIT_ACCESS', grant.id, makeId('api-corr'));
        audit('JIT_ACCESS_APPROVED', context, { grantId: grant.id, expiresAt: grant.expiresAt });
        saveStore(store());
        return safeClone(grant);
      }
      if (second && third === 'revoke' && req.method === 'POST') {
        assertCsrf(req);
        const grant = store().jitAccessGrants.find(item => item.id === second);
        if (!grant) throw new ApiConsoleError('INVALID_URL', 'JIT grant not found.', 404);
        grant.status = 'REVOKED';
        grant.revokedAt = nowIso();
        audit('JIT_ACCESS_REVOKED', context, { grantId: grant.id });
        saveStore(store());
        return safeClone(grant);
      }
    }

    if (first === 'admin' && second === 'org-policy') {
      const context = requireContext(req, body);
      if (req.method === 'GET') {
        if (context.role !== 'SYSTEM_ADMIN' && !roleAllowed(context.role, API_CONSOLE_POLICY.canManageProtectedEnvironments)) {
          throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to view org policy.', 403);
        }
        return safeClone({
          ...store().orgPolicies,
          envPrivateDestinationAllowlist: String(process.env.API_CONSOLE_PRIVATE_DESTINATION_ALLOWLIST || '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean),
          envDualApproval: String(process.env.API_CONSOLE_DUAL_APPROVAL || '').toLowerCase() === 'true',
        });
      }
      if (req.method === 'PUT') {
        assertCsrf(req);
        if (context.role !== 'SYSTEM_ADMIN') {
          throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only SYSTEM_ADMIN can update org policy.', 403);
        }
        const data = body.data || body;
        const allowlist = Array.isArray(data.privateDestinationAllowlist)
          ? data.privateDestinationAllowlist.map(item => String(item || '').trim()).filter(Boolean)
          : store().orgPolicies.privateDestinationAllowlist;
        for (const origin of allowlist) {
          try {
            const parsed = new URL(origin);
            const isOriginOnly = (parsed.pathname === '/' || parsed.pathname === '') && !parsed.search && !parsed.hash;
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !isOriginOnly) {
              throw new ApiConsoleError('CORE_VALIDATION_ERROR', `Invalid private destination origin: ${origin}`, 422);
            }
            if (/\*/.test(origin)) {
              throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Wildcard origins are not allowed in private destination allowlist.', 422);
            }
          } catch (error) {
            if (error instanceof ApiConsoleError) throw error;
            throw new ApiConsoleError('CORE_VALIDATION_ERROR', `Invalid private destination origin: ${origin}`, 422);
          }
        }
        store().orgPolicies = {
          privateDestinationAllowlist: allowlist,
          dualApprovalProductionCommand: data.dualApprovalProductionCommand === true,
          forbidInsecureTlsInProduction: data.forbidInsecureTlsInProduction !== false,
          forbidExactModeInProduction: data.forbidExactModeInProduction !== false,
          maxPortalShareTtlHours: Math.min(720, Math.max(1, Number(data.maxPortalShareTtlHours ?? store().orgPolicies.maxPortalShareTtlHours ?? 168))),
          allowAnonymousPortalShare: data.allowAnonymousPortalShare !== false,
          updatedAt: nowIso(),
          updatedBy: context.userId,
        };
        audit('ORG_POLICY_UPDATED', context, {
          dualApprovalProductionCommand: store().orgPolicies.dualApprovalProductionCommand,
          forbidInsecureTlsInProduction: store().orgPolicies.forbidInsecureTlsInProduction,
          forbidExactModeInProduction: store().orgPolicies.forbidExactModeInProduction,
          allowlistCount: allowlist.length,
        });
        saveStore(store());
        return safeClone(store().orgPolicies);
      }
    }

    if (first === 'requests' && second && third === 'dual-approvals' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canExecuteCommand)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to request dual approval.', 403);
      }
      const request = store().requests.find(item => item.id === second);
      if (!request || !belongsToUser(request, context)) {
        throw new ApiConsoleError('INVALID_URL', 'Request not found.', 404);
      }
      if (request.classification?.type !== 'CORE_COMMAND') {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Dual approval applies only to Core Command requests.', 422);
      }
      const data = body.data || body;
      const reason = sanitizeText(String(data.reason || ''));
      if (!reason.trim()) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'دلیل درخواست dual approval الزامی است.');
      }
      const grant = {
        id: makeId('dual'),
        requestId: request.id,
        userId: context.userId,
        applicationId: request.applicationId,
        reason,
        status: 'PENDING',
        requestedAt: nowIso(),
        approvedBy: null,
        approvedAt: null,
        expiresAt: null,
      };
      store().dualApprovals.unshift(grant);
      store().dualApprovals = store().dualApprovals.slice(0, 500);
      audit('DUAL_APPROVAL_REQUESTED', context, { grantId: grant.id, requestId: request.id });
      saveStore(store());
      return safeClone(grant);
    }

    if (first === 'dual-approvals') {
      const context = requireContext(req, body);
      if (!second && req.method === 'GET') {
        const requestId = parsedUrl.searchParams.get('requestId');
        const rows = (store().dualApprovals || []).filter(grant => {
          if (requestId && grant.requestId !== requestId) return false;
          return grant.userId === context.userId ||
            context.role === 'SYSTEM_ADMIN' ||
            roleAllowed(context.role, API_CONSOLE_POLICY.canExecuteProductionCommand);
        });
        return safeClone(paginate(rows, 1, 50));
      }
      if (second && third === 'approve' && req.method === 'POST') {
        assertCsrf(req);
        if (context.role !== 'SYSTEM_ADMIN' && !roleAllowed(context.role, API_CONSOLE_POLICY.canExecuteProductionCommand)) {
          throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to approve dual approval.', 403);
        }
        const grant = store().dualApprovals.find(item => item.id === second);
        if (!grant) throw new ApiConsoleError('INVALID_URL', 'Dual approval grant not found.', 404);
        if (grant.status !== 'PENDING') {
          throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Only PENDING dual approvals can be approved.', 422);
        }
        if (grant.userId === context.userId) {
          throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Approver must be a different elevated user.', 422);
        }
        const minutes = Math.min(24 * 60, Math.max(15, Number(body.ttlMinutes || body.data?.ttlMinutes || 60)));
        grant.status = 'ACTIVE';
        grant.approvedBy = context.userId;
        grant.approvedAt = nowIso();
        grant.expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
        notifyUser(grant.userId, 'تأیید دو مرحله‌ای', `اجرای Production Command تا ${grant.expiresAt} تأیید شد.`, 'DUAL_APPROVAL', grant.id, makeId('api-corr'));
        audit('DUAL_APPROVAL_APPROVED', context, { grantId: grant.id, requestId: grant.requestId, expiresAt: grant.expiresAt });
        saveStore(store());
        return safeClone(grant);
      }
    }

    if (first === 'admin' && second === 'compliance-report' && req.method === 'GET') {
      const context = requireContext(req, body);
      if (context.role !== 'SYSTEM_ADMIN' && !roleAllowed(context.role, API_CONSOLE_POLICY.canViewUsageReports)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized for compliance report.', 403);
      }
      const dateFrom = parsedUrl.searchParams.get('dateFrom');
      const dateTo = parsedUrl.searchParams.get('dateTo');
      const inRange = (iso) => {
        if (!iso) return true;
        if (dateFrom && iso < dateFrom) return false;
        if (dateTo && iso > dateTo) return false;
        return true;
      };
      const executions = (store().executions || []).filter(item => inRange(item.startedAt));
      const tlsInsecure = executions.filter(item => item.tlsVerification === false);
      const exactMode = (store().requests || []).filter(item => item.executionMode === 'EXACT');
      const prodCommands = executions.filter(item =>
        item.environmentName && /prod/i.test(item.environmentName) &&
        (item.requestSnapshot?.classification?.type === 'CORE_COMMAND' || false)
      );
      const sharesWithoutConsumers = (store().shareRequests || []).filter(share => {
        if (share.status !== 'APPROVED') return false;
        return consumersForVersion(share.apiId, share.version).length === 0;
      });
      const report = {
        generatedAt: nowIso(),
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        totals: {
          tlsInsecureExecutions: tlsInsecure.length,
          exactModeRequests: exactMode.length,
          productionCommandExecutions: prodCommands.length,
          approvedSharesWithoutConsumers: sharesWithoutConsumers.length,
        },
        samples: {
          tlsInsecure: tlsInsecure.slice(0, 20),
          exactModeRequestIds: exactMode.slice(0, 20).map(item => item.id),
          productionCommands: prodCommands.slice(0, 20).map(item => ({ id: item.id, requestId: item.requestId, startedAt: item.startedAt })),
          sharesWithoutConsumers: sharesWithoutConsumers.slice(0, 20).map(item => ({ id: item.id, apiId: item.apiId, version: item.version })),
        },
      };
      audit('COMPLIANCE_REPORT_VIEWED', context, { totals: report.totals });
      saveStore(store());
      return safeClone(report);
    }

    if (first === 'share-reviews' && second && third === 'ticket' && req.method === 'PUT') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const share = store().shareRequests.find(item => item.id === second);
      if (!share) throw new ApiConsoleError('INVALID_URL', 'Share review not found.', 404);
      const isOwner = share.submittedBy === context.userId;
      const isReviewer = roleAllowed(context.role, API_CONSOLE_POLICY.canReviewShares);
      if (!isOwner && !isReviewer) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized.', 403);
      const ticketId = String(body.ticketId || body.data?.ticketId || '').trim();
      const ticketUrl = String(body.ticketUrl || body.data?.ticketUrl || '').trim();
      if (ticketUrl && !ticketAllowlisted(ticketUrl)) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'ticketUrl خارج از allowlist است.', 422);
      }
      share.ticketId = ticketId || undefined;
      share.ticketUrl = ticketUrl || undefined;
      share.updatedAt = nowIso();
      const request = store().requests.find(item => item.id === share.requestId);
      if (request) {
        request.ticketId = share.ticketId;
        request.ticketUrl = share.ticketUrl;
      }
      audit('API_SHARE_TICKET_UPDATED', context, { shareRequestId: share.id, ticketId, ticketUrl });
      saveStore(store());
      return safeClone(share);
    }

    return undefined;
  };
}

module.exports = {
  createPhase3Router,
  deliverWebhook,
  scanTextForSecrets,
  parseConfiguredOrigins,
  schemaSummaryFromOpenApi: (spec) => {
    const summary = {};
    for (const [pathname, methods] of Object.entries(spec?.paths || {})) {
      for (const [method, operation] of Object.entries(methods || {})) {
        if (!operation || typeof operation !== 'object' || String(method).startsWith('x-')) continue;
        const schema = operation.requestBody?.content?.['application/json']?.schema
          || operation.responses?.['200']?.content?.['application/json']?.schema
          || { type: 'object', properties: {}, required: [] };
        const properties = {};
        Object.entries(schema.properties || {}).forEach(([key, prop]) => {
          properties[key] = String(prop?.type || 'object');
        });
        summary[`${String(method).toUpperCase()} ${pathname}`] = {
          required: Array.isArray(schema.required) ? [...schema.required].sort() : [],
          properties,
        };
      }
    }
    return summary;
  },
  compareSchemaSummaries: (baselineSummary, currentSummary) => {
    const breaking = [];
    const nonBreaking = [];
    const baseline = baselineSummary || {};
    const current = currentSummary || {};
    for (const key of Object.keys(baseline)) {
      if (!current[key]) {
        breaking.push({ kind: 'REMOVED_PATH_METHOD', pathMethod: key });
        continue;
      }
      const base = baseline[key];
      const next = current[key];
      for (const prop of base.required || []) {
        if (!(prop in (next.properties || {}))) {
          breaking.push({ kind: 'REMOVED_REQUIRED_PROPERTY', pathMethod: key, property: prop });
        }
      }
      for (const [prop, type] of Object.entries(base.properties || {})) {
        if (prop in (next.properties || {}) && String(next.properties[prop]) !== String(type)) {
          breaking.push({ kind: 'TYPE_CHANGE', pathMethod: key, property: prop, from: type, to: next.properties[prop] });
        }
      }
    }
    for (const key of Object.keys(current)) {
      if (!baseline[key]) nonBreaking.push({ kind: 'ADDED_PATH_METHOD', pathMethod: key });
    }
    return { breaking, nonBreaking };
  },
  buildOpenApiFromRequests: (title, version, requests) => {
    // thin re-export helper for tests without full router
    const paths = {};
    for (const request of requests || []) {
      const method = String(request.method || 'GET').toLowerCase();
      let pathname = `/${request.id}`;
      try {
        pathname = new URL(String(request.urlTemplate || 'https://example.local/'), 'https://example.local').pathname || pathname;
      } catch {}
      if (!paths[pathname]) paths[pathname] = {};
      paths[pathname][method] = { summary: request.name, responses: { 200: { description: 'ok' } } };
    }
    return { openapi: '3.0.3', info: { title, version }, paths };
  },
};
