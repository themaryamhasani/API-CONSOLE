const { randomBytes } = require('crypto');
const CryptoJS = require('crypto-js');
const { CookieJar } = require('tough-cookie');

function getCdeOrigin() {
  return String(process.env.CDE_CORE_BASE_URL || 'https://cde.edus.ir').replace(/\/$/, '');
}
function getServiceId() {
  try {
    return new URL(getCdeOrigin()).host;
  } catch {
    return 'cde.edus.ir';
  }
}
const CDE_ORIGIN = getCdeOrigin();
const SERVICE_ID = getServiceId();
const DATA_SOURCE_URL = `${CDE_ORIGIN}/core-api/v1/data-provider/get-data-source`;
const STORE_FORM_URL = `${CDE_ORIGIN}/core-api/v1/data-provider/store-form-data`;
const MAX_BODY_BYTES = Number(process.env.CDE_MAX_BODY_BYTES || 32 * 1024 * 1024);
const REQUEST_TIMEOUT_MS = Number(process.env.CDE_REQUEST_TIMEOUT_MS || 60_000);

const ALLOWED_DATA_KEYS = new Set([
  'pages-app/who-am-i',
  'cde/repository/list/my-repo',
  'cde/repository/web-ui/list/fetch',
  'cde/repository/data-service/list/fetch',
  'cde/repository/api-module/list/fetch',
  'cde/repository/message-consumer/list/fetch',
  'cde/package/any/one/fetch',
]);

const ALLOWED_FORM_IDS = new Set([
  'auth/signin/iran-cellphone',
  'auth/signin/check-password',
]);

class CoreClientError extends Error {
  constructor(category, message, statusCode = 502, details) {
    super(message);
    this.category = category;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function randomSegment() {
  return randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8).padEnd(8, '0');
}

function createClientId() {
  return [Date.now().toString(36), randomSegment(), randomSegment(), randomSegment(), randomSegment()].join('-');
}

function createCdeState() {
  return {
    clientId: createClientId(),
    cookieJar: new CookieJar().serializeSync(),
    ecreq: false,
    connectedAt: new Date().toISOString(),
  };
}

function secretForClientId(clientId) {
  return String(clientId || '').split('-').sort().join('%');
}

function encryptRequest(payload, clientId) {
  return CryptoJS.AES.encrypt(JSON.stringify(payload), secretForClientId(clientId)).toString();
}

function decryptResponse(token, clientId) {
  const plaintext = CryptoJS.AES.decrypt(String(token), secretForClientId(clientId)).toString(CryptoJS.enc.Utf8);
  if (!plaintext) throw new CoreClientError('CDE_DECRYPTION_FAILED', 'CDE returned an encrypted response that could not be decrypted.');
  let value = JSON.parse(plaintext);
  if (typeof value === 'string') value = JSON.parse(value);
  return { Result: value };
}

function stripProviderPrefix(value, prefix) {
  return String(value || '').replace(new RegExp(`^${prefix}/`), '');
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,]+=)/g);
}

function responseLogicalError(response) {
  const result = response?.Result;
  if (!response || typeof response !== 'object') return 'CDE response was not a JSON object.';
  if (response.error) return String(response.error);
  if (result?.error) return typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
  if (result?.success === false) return String(result.message || 'CDE operation failed.');
  if (result?.serverMessage?.type === 'error' || result?.serverMessage?.type === 'danger') {
    return String(result.serverMessage.text || 'CDE operation failed.');
  }
  return null;
}

function assertLogicalSuccess(response) {
  const logicalError = responseLogicalError(response);
  if (logicalError) throw new CoreClientError('CDE_LOGICAL_ERROR', logicalError, 502);
  return response;
}

async function readBoundedJson(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) {
    throw new CoreClientError('CDE_RESPONSE_TOO_LARGE', 'CDE response exceeded the configured size limit.', 502);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) {
    throw new CoreClientError('CDE_RESPONSE_TOO_LARGE', 'CDE response exceeded the configured size limit.', 502);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new CoreClientError('CDE_INVALID_JSON', 'CDE returned invalid JSON.', 502);
  }
}

async function postCore(state, url, payload, options = {}) {
  if (!state?.clientId || !state?.cookieJar) throw new CoreClientError('CDE_SESSION_INVALID', 'CDE session state is invalid.', 401);
  const origin = getCdeOrigin();
  const jar = CookieJar.deserializeSync(state.cookieJar);
  const outbound = state.ecreq === true ? { reqtoken: encryptRequest(payload, state.clientId) } : payload;
  const serialized = JSON.stringify(outbound);
  if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) {
    throw new CoreClientError('CDE_REQUEST_TOO_LARGE', 'CDE request exceeded the configured size limit.', 413);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = {
    accept: '*/*',
    'content-type': 'application/json; charset=UTF-8',
    'client-id': state.clientId,
    origin,
    referer: options.editor ? `${origin}/second-editor` : `${origin}/`,
  };
  const cookie = await jar.getCookieString(url);
  if (cookie) headers.cookie = cookie;
  if (options.prostage) headers.prostage = String(options.prostage);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: serialized,
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (error) {
    const timeoutError = error?.name === 'AbortError';
    throw new CoreClientError(timeoutError ? 'CDE_TIMEOUT' : 'CDE_UNAVAILABLE', timeoutError
      ? 'CDE request timed out.'
      : 'CDE could not be reached.', timeoutError ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location || new URL(location, origin).origin !== origin) {
      throw new CoreClientError('CDE_REDIRECT_REJECTED', 'CDE returned an unsafe redirect.', 502);
    }
    throw new CoreClientError('CDE_REDIRECT_REJECTED', 'Unexpected CDE redirect was rejected.', 502);
  }
  if (!response.ok) throw new CoreClientError('CDE_HTTP_ERROR', `CDE returned HTTP ${response.status}.`, 502);

  for (const value of setCookieValues(response.headers)) {
    await jar.setCookie(value, url, { ignoreError: true });
  }
  let parsed = await readBoundedJson(response);
  if (parsed?.token) parsed = decryptResponse(parsed.token, state.clientId);
  state.cookieJar = jar.serializeSync();
  if (typeof parsed?.Result?.ecreq === 'boolean') state.ecreq = parsed.Result.ecreq;
  state.lastUsedAt = new Date().toISOString();
  return { response: parsed, state };
}

async function getDataSource(state, provider, params = {}, options = {}) {
  const key = stripProviderPrefix(provider, 'ds');
  if (!ALLOWED_DATA_KEYS.has(key)) throw new CoreClientError('CDE_PROVIDER_NOT_ALLOWED', 'CDE data provider is not allowlisted.', 403);
  const origin = getCdeOrigin();
  return postCore(state, `${origin}/core-api/v1/data-provider/get-data-source`, { serviceId: getServiceId(), key, params: params || {} }, {
    editor: key.startsWith('cde/'),
    ...options,
  });
}

async function storeFormData(state, provider, data = {}, options = {}) {
  const formId = stripProviderPrefix(provider, 'fr');
  if (!ALLOWED_FORM_IDS.has(formId)) throw new CoreClientError('CDE_PROVIDER_NOT_ALLOWED', 'CDE form provider is not allowlisted.', 403);
  const origin = getCdeOrigin();
  return postCore(state, `${origin}/core-api/v1/data-provider/store-form-data`, { serviceId: getServiceId(), formId, data: data || {} }, {
    editor: formId.startsWith('cde/'),
    prostage: formId.startsWith('cde/') ? 'develop' : undefined,
    ...options,
  });
}

module.exports = {
  ALLOWED_DATA_KEYS,
  ALLOWED_FORM_IDS,
  CoreClientError,
  SERVICE_ID,
  assertLogicalSuccess,
  createCdeState,
  decryptResponse,
  encryptRequest,
  getCdeOrigin,
  getDataSource,
  getServiceId,
  responseLogicalError,
  secretForClientId,
  storeFormData,
};
