'use strict';

/**
 * cURL import / normalization helpers for API Console.
 * Factory follows the same deps-injection pattern as phase2-routes.cjs.
 */

const { URL } = require('url');

const PARSER_VERSION = 'api-console-curl-parser/2.0.0';
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const BODY_OPTIONS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode']);
const FORM_OPTIONS = new Set(['-F', '--form']);
const HEADER_OPTIONS = new Set(['-H', '--header']);
const COOKIE_OPTIONS = new Set(['-b', '--cookie']);
const REQUEST_OPTIONS = new Set(['-X', '--request']);
const URL_OPTIONS = new Set(['--url']);
const LOCATION_OPTIONS = new Set(['--location', '-L']);
const UNSUPPORTED_OPTIONS_WITH_VALUE = new Set([
  '--cert',
  '--key',
  '--cacert',
  '--connect-timeout',
  '--max-time',
  '--proxy',
  '--resolve',
  '--user-agent',
  '-A',
  '-u',
  '--user',
]);
const UNSUPPORTED_FLAGS = new Set([
  '--compressed',
  '--http1.1',
  '--http2',
  '--include',
  '-i',
  '--silent',
  '-s',
  '--verbose',
  '-v',
]);

function createCurlParser(deps) {
  const {
    ApiConsoleError,
    makeId,
    nowIso,
    createHeader,
    createCookie,
    buildClassification,
    detectCoreClassification,
    parseJsonSafely,
    isSensitiveName,
    sanitizeText,
    protectRequestSecrets,
    refreshDocumentationMetadata,
  } = deps;

  function normalizeWindowsCmdCurl(input) {
    const withoutLineContinuation = input.replace(/\^\r?\n/g, ' ');
    let normalized = '';
    for (let i = 0; i < withoutLineContinuation.length; i += 1) {
      const char = withoutLineContinuation[i];
      if (char === '^' && i + 1 < withoutLineContinuation.length) {
        normalized += withoutLineContinuation[i + 1];
        i += 1;
      } else {
        normalized += char;
      }
    }
    return normalized;
  }

  function normalizePowerShellCurl(input) {
    return input
      .replace(/`\r?\n/g, ' ')
      .replace(/`(["'`$])/g, '$1');
  }

  function normalizeBashCurl(input) {
    return input.replace(/\\\r?\n/g, ' ');
  }

  function stripWrappingQuote(input) {
    const trimmed = String(input || '').trim();
    if (trimmed.length < 2) return input;
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last && trimmed.slice(1).trimStart().toLowerCase().startsWith('curl')) {
      return trimmed.slice(1, -1);
    }
    return input;
  }

  function detectCurlDialect(input) {
    const normalized = stripWrappingQuote(input);
    const lower = normalized.toLowerCase();
    if (/\^\r?\n|(\s|^)\^\S|curl\.exe/i.test(normalized)) return 'WINDOWS_CMD';
    if (/`\r?\n|invoke-webrequest|invoke-restmethod/i.test(normalized)) return 'POWERSHELL';
    if (lower.includes('sec-ch-ua') || lower.includes('sec-fetch-') || lower.includes('--compressed')) return 'CHROME_EDGE';
    if (/curl\s+'https?:\/\//i.test(normalized) || normalized.includes("\\\n")) return 'BASH';
    if (/curl\s+https?:\/\//i.test(normalized)) return 'LINUX_MAC';
    return 'UNKNOWN';
  }

  function normalizeCurlText(input, dialect) {
    const unwrapped = stripWrappingQuote(input);
    if (dialect === 'WINDOWS_CMD') return normalizeWindowsCmdCurl(unwrapped);
    if (dialect === 'POWERSHELL') return normalizePowerShellCurl(unwrapped);
    return normalizeBashCurl(unwrapped);
  }

  function tokenizeCurl(input) {
    const tokens = [];
    let current = '';
    let quote = null;
    let escaping = false;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (escaping) {
        current += char;
        escaping = false;
        continue;
      }
      if (char === '\\' && quote !== "'") {
        escaping = true;
        continue;
      }
      if ((char === '"' || char === "'") && !quote) {
        quote = char;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      if (!quote && /\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }
      current += char;
    }

    if (escaping) current += '\\';
    if (current) tokens.push(current);
    return tokens;
  }

  function splitOptionToken(token) {
    const eqIndex = token.indexOf('=');
    if (eqIndex > 2 && token.startsWith('--')) {
      return { option: token.slice(0, eqIndex), value: token.slice(eqIndex + 1) };
    }
    return { option: token };
  }

  function parseHeaderLine(line) {
    const index = String(line || '').indexOf(':');
    if (index <= 0) return null;
    return {
      name: line.slice(0, index).trim(),
      value: line.slice(index + 1).trim(),
    };
  }

  function parseCookieHeader(value) {
    return String(value || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const eq = part.indexOf('=');
        if (eq === -1) return { name: part, value: '' };
        return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
      })
      .filter(cookie => cookie.name.length > 0);
  }

  function createQueryParametersFromUrl(urlText) {
    try {
      const parsed = new URL(urlText);
      const params = [];
      let order = 0;
      parsed.searchParams.forEach((value, name) => {
        params.push({
          id: makeId('qp'),
          name,
          value,
          enabled: true,
          sensitive: isSensitiveName(name),
          source: 'IMPORTED_CURL',
          displayOrder: order,
        });
        order += 1;
      });
      parsed.search = '';
      return { urlWithoutQuery: parsed.toString().replace(/\/$/, parsed.pathname === '/' ? '/' : ''), queryParameters: params };
    } catch {
      return { urlWithoutQuery: urlText, queryParameters: [] };
    }
  }

  function inferBody(dataParts, formParts, headers) {
    if (formParts.length > 0) {
      return {
        type: 'multipart',
        value: formParts.map(part => {
          const eq = part.indexOf('=');
          return eq === -1 ? { name: part, value: '' } : { name: part.slice(0, eq), value: part.slice(eq + 1) };
        }),
        raw: formParts.join('\n'),
        contentType: 'multipart/form-data',
      };
    }

    if (dataParts.length === 0) {
      return { type: 'none', value: null, raw: '' };
    }

    const raw = dataParts.join('&');
    const contentType = headers.find(header => header.name.toLowerCase() === 'content-type')?.valueTemplate.toLowerCase() || '';
    const json = parseJsonSafely(raw);
    if (json.ok) {
      return { type: 'json', value: json.value, raw, contentType: 'application/json' };
    }
    if (contentType.includes('json')) {
      return { type: 'json', value: null, raw, contentType: 'application/json' };
    }
    if (contentType.includes('xml') || raw.trim().startsWith('<')) {
      return { type: 'xml', value: raw, raw, contentType: contentType || 'application/xml' };
    }
    if (contentType.includes('x-www-form-urlencoded') || /^[^=&\s]+=[\s\S]*/.test(raw)) {
      const value = Object.fromEntries(new URLSearchParams(raw));
      return { type: 'form-urlencoded', value, raw, contentType: 'application/x-www-form-urlencoded' };
    }
    return { type: 'raw', value: raw, raw, contentType: contentType || 'text/plain' };
  }

  function normalizeMethod(method) {
    const normalized = String(method || '').trim().toUpperCase();
    if (!normalized) return undefined;
    return HTTP_METHODS.includes(normalized) ? normalized : undefined;
  }

  function dedupeCookies(cookies) {
    const map = new Map();
    cookies.forEach(cookie => map.set(cookie.name, cookie));
    return Array.from(map.values()).map((cookie, index) => ({ ...cookie, displayOrder: index }));
  }

  function createDefaultAssertions() {
    return [
      {
        id: makeId('asrt'),
        assertionType: 'EXPECTED_HTTP_STATUS',
        configuration: { expectedHttpStatuses: [200] },
        enabled: true,
      },
      {
        id: makeId('asrt'),
        assertionType: 'MAX_RESPONSE_TIME',
        configuration: { maximumResponseTimeMs: 5000 },
        enabled: true,
      },
    ];
  }

  function createDefaultScripts() {
    return {
      preRequest: [
        '// Pre-request script امن API Console',
        '// نمونه: setVar("page", "0")',
        '// نمونه: setHeader("x-trace-id", "{{traceId}}")',
      ].join('\n'),
      postResponse: [
        '// Post-response script برای تست API',
        '// نمونه: testStatus(200)',
        '// نمونه: testJsonPath("$.data")',
        '// نمونه: testResponseTimeBelow(5000)',
      ].join('\n'),
      preRequestEnabled: false,
      postResponseEnabled: false,
    };
  }

  function createBlankNormalizedRequest(url = 'https://example.com/api/health') {
    return {
      method: 'GET',
      url,
      queryParameters: [],
      headers: [createHeader('accept', 'application/json', 0, 'USER')],
      cookies: [],
      body: { type: 'none', value: null, raw: '' },
      authentication: { type: 'none' },
      tls: { verifyCertificate: true },
      executionMode: 'RECOMMENDED',
      classification: buildClassification('GENERIC_HTTP', null, null),
    };
  }

  function parseCurlInternal(originalCurl) {
    if (!String(originalCurl || '').trim()) {
      throw new ApiConsoleError('CURL_PARSE_ERROR', 'Empty cURL input.');
    }

    const dialect = detectCurlDialect(originalCurl);
    const normalizedText = normalizeCurlText(originalCurl, dialect);
    const tokens = tokenizeCurl(normalizedText);
    const curlIndex = tokens.findIndex(token => ['curl', 'curl.exe'].includes(token.toLowerCase()));
    const requestTokens = curlIndex >= 0 ? tokens.slice(curlIndex + 1) : tokens;
    const warnings = [];
    const unsupportedOptions = [];
    const headers = [];
    const cookies = [];
    const dataParts = [];
    const formParts = [];
    let explicitMethod;
    let urlText = '';
    let tlsVerifyCertificate = true;
    let authentication = { type: 'none' };

    const readValue = (index, inline) => {
      if (inline !== undefined) return { value: inline, nextIndex: index };
      return { value: requestTokens[index + 1] || '', nextIndex: index + 1 };
    };

    for (let i = 0; i < requestTokens.length; i += 1) {
      const rawToken = requestTokens[i];
      const { option, value: inlineValue } = splitOptionToken(rawToken);

      if (REQUEST_OPTIONS.has(option)) {
        const { value, nextIndex } = readValue(i, inlineValue);
        explicitMethod = normalizeMethod(value);
        if (!explicitMethod) warnings.push(`Unsupported HTTP method "${value}" imported as editable value.`);
        i = nextIndex;
        continue;
      }

      if (HEADER_OPTIONS.has(option)) {
        const { value, nextIndex } = readValue(i, inlineValue);
        const parsed = parseHeaderLine(value);
        if (parsed) {
          const header = createHeader(parsed.name, parsed.value, headers.length, 'IMPORTED_CURL');
          if (parsed.name.toLowerCase() === 'cookie') {
            header.enabled = false;
            header.replayNote = 'Parsed into the cookie editor to avoid duplicate Cookie transmission in recommended replay.';
            parseCookieHeader(parsed.value).forEach(cookie => cookies.push(createCookie(cookie.name, cookie.value, cookies.length)));
          }
          headers.push(header);
        } else {
          warnings.push(`Ignored malformed header: ${value}`);
        }
        i = nextIndex;
        continue;
      }

      if (COOKIE_OPTIONS.has(option)) {
        const { value, nextIndex } = readValue(i, inlineValue);
        parseCookieHeader(value).forEach(cookie => cookies.push(createCookie(cookie.name, cookie.value, cookies.length)));
        i = nextIndex;
        continue;
      }

      if (BODY_OPTIONS.has(option)) {
        const { value, nextIndex } = readValue(i, inlineValue);
        dataParts.push(value);
        i = nextIndex;
        continue;
      }

      if (FORM_OPTIONS.has(option)) {
        const { value, nextIndex } = readValue(i, inlineValue);
        formParts.push(value);
        i = nextIndex;
        continue;
      }

      if (URL_OPTIONS.has(option)) {
        const { value, nextIndex } = readValue(i, inlineValue);
        urlText = value;
        i = nextIndex;
        continue;
      }

      if (option === '--insecure' || option === '-k') {
        tlsVerifyCertificate = false;
        warnings.push('TLS certificate verification is disabled by imported --insecure/-k.');
        continue;
      }

      if (LOCATION_OPTIONS.has(option)) {
        warnings.push('Redirect following was imported from --location/-L and is handled by the backend Runner.');
        continue;
      }

      if (option === '-u' || option === '--user') {
        const { value, nextIndex } = readValue(i, inlineValue);
        const [username] = value.split(':');
        authentication = {
          type: 'basic',
          basicUsername: username,
          basicPasswordReference: '{{basicPassword}}',
        };
        unsupportedOptions.push(option);
        warnings.push('Basic credentials were converted to a secret reference.');
        i = nextIndex;
        continue;
      }

      if (UNSUPPORTED_OPTIONS_WITH_VALUE.has(option)) {
        const { nextIndex } = readValue(i, inlineValue);
        unsupportedOptions.push(option);
        i = nextIndex;
        continue;
      }

      if (UNSUPPORTED_FLAGS.has(option)) {
        unsupportedOptions.push(option);
        continue;
      }

      if (option.startsWith('-')) {
        unsupportedOptions.push(option);
        continue;
      }

      if (!urlText) {
        urlText = rawToken;
      } else {
        warnings.push(`Unrecognized positional token ignored: ${rawToken}`);
      }
    }

    if (!urlText) {
      throw new ApiConsoleError('INVALID_URL', 'cURL input did not contain a URL.');
    }

    const { urlWithoutQuery, queryParameters } = createQueryParametersFromUrl(urlText);
    const body = inferBody(dataParts, formParts, headers);
    const method = explicitMethod || ((dataParts.length || formParts.length) ? 'POST' : 'GET');

    if (body.type === 'json' && !headers.some(header => header.name.toLowerCase() === 'content-type')) {
      headers.push(createHeader('content-type', 'application/json', headers.length, 'SYSTEM'));
    }

    const classification = detectCoreClassification(urlWithoutQuery, body);
    const jsonValidity = body.type === 'json'
      ? (() => {
          const result = parseJsonSafely(body.raw);
          return result.ok ? { valid: true } : { valid: false, error: result.error, line: result.line, column: result.column };
        })()
      : { valid: true };

    if (unsupportedOptions.length) {
      warnings.push(`Unsupported cURL options kept as warnings: ${Array.from(new Set(unsupportedOptions)).join(', ')}`);
    }

    const normalizedRequest = {
      method,
      url: urlWithoutQuery,
      queryParameters,
      headers,
      cookies: dedupeCookies(cookies),
      body,
      authentication,
      tls: {
        verifyCertificate: tlsVerifyCertificate,
        importedInsecureFlag: !tlsVerifyCertificate,
      },
      executionMode: 'RECOMMENDED',
      classification,
    };

    return {
      id: makeId('curl-preview'),
      originalCurl,
      detectedDialect: dialect,
      normalizedRequest,
      effectiveMethod: method,
      url: urlWithoutQuery,
      headerCount: headers.length,
      cookieCount: normalizedRequest.cookies.length,
      bodyType: body.type,
      jsonValidity,
      tlsVerification: tlsVerifyCertificate,
      warnings,
      unsupportedOptions: Array.from(new Set(unsupportedOptions)),
      parserVersion: PARSER_VERSION,
      importedAt: nowIso(),
    };
  }

  function bodyTemplateFromBody(body) {
    if (!body || body.type === 'none') return '';
    if (body.raw) return body.raw;
    if (body.type === 'json') return JSON.stringify(body.value ?? {}, null, 2);
    if (typeof body.value === 'string') return body.value;
    return JSON.stringify(body.value ?? '', null, 2);
  }

  function definitionFromNormalized(normalized, data) {
    const now = nowIso();
    const requestId = data.id || makeId('api-req');
    const semanticVersion = data.semanticVersion || normalized.semanticVersion || data.versionLabel || '1.0.0';
    const bodyTemplate = bodyTemplateFromBody(normalized.body);
    const request = {
      id: requestId,
      collectionId: data.collectionId,
      applicationId: data.applicationId,
      apiId: data.apiId || requestId,
      semanticVersion,
      sharingStatus: data.sharingStatus || 'DRAFT',
      sourceType: data.sourceType || 'ORIGINAL',
      referenceId: data.referenceId,
      sourceRequestId: data.sourceRequestId,
      shareRequestId: data.shareRequestId,
      name: data.name,
      description: data.description,
      method: normalized.method,
      urlTemplate: normalized.url,
      folderPath: Array.isArray(data.folderPath)
        ? data.folderPath.map(part => String(part || '').trim()).filter(Boolean)
        : [],
      queryParameters: normalized.queryParameters || [],
      headers: normalized.headers || [],
      cookies: normalized.cookies || [],
      bodyType: normalized.body?.type || 'none',
      bodyTemplate,
      authentication: normalized.authentication || { type: 'none' },
      tls: normalized.tls || { verifyCertificate: true },
      executionMode: normalized.executionMode || 'RECOMMENDED',
      classification: detectCoreClassification(normalized.url, { ...normalized.body, raw: bodyTemplate }),
      environmentId: data.environmentId,
      assertions: normalized.assertions || createDefaultAssertions(),
      scripts: data.scripts || normalized.scripts || createDefaultScripts(),
      documentation: {
        title: data.name,
        description: data.description || '',
        authenticationProfileId: data.authenticationDocumentationProfileId,
        providerApplication: data.applicationId,
        version: semanticVersion,
        owner: data.userName || data.userId,
        supportContact: 'quality-team@example.local',
        changeHistory: [{ version: semanticVersion, changedAt: now, summary: data.changeLog || 'Initial API Console request definition.' }],
      },
      version: 1,
      status: 'ACTIVE',
      originalImportedCurl: data.originalImportedCurl ? sanitizeText(data.originalImportedCurl) : undefined,
      importedCurlId: data.importedCurlId,
      createdBy: data.userId,
      createdAt: now,
      updatedBy: data.userId,
      updatedAt: now,
    };
    request.documentation = refreshDocumentationMetadata(request);
    return protectRequestSecrets(request);
  }

  return {
    PARSER_VERSION,
    parseHeaderLine,
    createDefaultAssertions,
    createDefaultScripts,
    createBlankNormalizedRequest,
    parseCurlInternal,
    bodyTemplateFromBody,
    definitionFromNormalized,
  };
}

module.exports = {
  createCurlParser,
  PARSER_VERSION,
};
