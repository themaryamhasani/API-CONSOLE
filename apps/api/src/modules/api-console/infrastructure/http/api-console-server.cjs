const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns').promises;
const zlib = require('zlib');
const { monitorEventLoopDelay } = require('perf_hooks');
const { createHash, randomUUID } = require('crypto');
const {
  isLegacyContextEnabled,
  attachSession,
  attachConsoleContext,
  assertCsrf,
  canHandleSession,
  handleSession,
  isBootstrapSystemAdmin,
  loginListIncludes,
  listActiveSessions,
  requireSession,
  registerDirectoryProvider,
  isSessionAuthenticated,
} = require('../../../session/session-server.cjs');
const { canHandleCde, collectProjectSourceFiles, handleCde, normalizeCdeLoginName } = require('../../../cde/cde-server.cjs');
const { registerLoginEventRecorder } = require('../../../cde/cde-sso.cjs');
const { evaluateWorkspaceAccess } = require('../../../access/workspace-access.cjs');
const { canHandleIs, handleIs } = require('../../../is/is-auth-server.cjs');
const {
  LocalAuthError,
  canHandleLocalAuth,
  handleLocalAuth,
  registerLocalAuthStore,
  createLocalDirectoryUser,
  patchLocalDirectoryUser,
  resetLocalPassword,
  listLocalDirectoryUsers,
} = require('../../../auth/local-auth.cjs');
const { discoverProjectSources } = require('../../../cde/api-discovery.cjs');
const { createPhase2Router } = require('./phase2-routes.cjs');
const { createPhase3Router, deliverWebhook: deliverItsmWebhook, scanTextForSecrets, parseConfiguredOrigins } = require('./phase3-routes.cjs');
const { createSharingRouter } = require('./sharing-routes.cjs');
const { createRuntimeHttpRouter } = require('./runtime-http-routes.cjs');
const { createCurlParser } = require('./curl-parser.cjs');
const { createExecutionRunner } = require('./execution-runner.cjs');
const { createObjectStore } = require('../persistence/object-store.cjs');
const {
  executeCoreOperation,
  finishRuntimeLogin,
  normalizedProfile,
  publicRuntimeStatus,
  runtimeWhoAmI,
  startRuntimeLogin,
  validateRuntimeOrigin,
} = require('../../../runtime/runtime-core-client.cjs');
const {
  deleteRuntimeSession,
  findConnectedRuntimeSession,
  getRuntimeSession,
  setRuntimeSession,
} = require('../../../runtime/runtime-session-store.cjs');
const { serveOpenApiDocs } = require('../../../../openapi/serve-docs.cjs');
const vaultProviderModule = require('../security/vault-provider.cjs');
const { assertProductionSecrets, inspectProductionSecrets } = require('../security/production-secrets.cjs');
const {
  resolveBackend: resolveStoreBackend,
  resolveSqlitePath,
  createStoreAdapter,
  loadStoreViaAdapter,
  writeStoreViaAdapter,
} = require('../persistence/store-adapter.cjs');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../../../../..');
const resolveRepositoryPath = value => path.isAbsolute(value) ? value : path.join(REPOSITORY_ROOT, value);
const PORT = Number(process.env.API_CONSOLE_PORT || 5281);
const DATA_DIR = resolveRepositoryPath(process.env.API_CONSOLE_DATA_DIR || path.join('runtime', 'api-console'));
const STORE_FILE = process.env.API_CONSOLE_STORE_FILE || path.join(DATA_DIR, 'api-console-store.json');
const STORE_BACKEND = resolveStoreBackend();
const SQLITE_FILE = process.env.API_CONSOLE_SQLITE_FILE
  ? resolveRepositoryPath(process.env.API_CONSOLE_SQLITE_FILE)
  : resolveSqlitePath(process.env, DATA_DIR);
/** @type {null | { backend: string, load: Function, save: Function, close?: Function, loadAsync?: Function, drain?: Function, recordLoginEvent?: Function }} */
let activeStoreAdapter = null;
let storeReady = false;
const SECRET_VAULT_FILE = process.env.API_CONSOLE_SECRET_VAULT_FILE || path.join(DATA_DIR, 'api-console-secrets.json');
const SECRET_KEY_FILE = process.env.API_CONSOLE_SECRET_KEY_FILE || path.join(DATA_DIR, 'api-console-secret.key');
const DOCX_TEMPLATE_FILE = process.env.API_CONSOLE_DOCX_TEMPLATE_FILE || path.join(__dirname, '..', 'templates', 'api-console-document-template.docx');
const CORE_COMMAND_ENDPOINT = '/core-api/v1/data-provider/store-form-data';
const CORE_QUERY_ENDPOINT = '/core-api/v1/data-provider/get-data-source';
const BROWSER_HEADERS = new Set([
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'priority',
  'user-agent',
  'accept-language',
]);
const TRANSPORT_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding']);
const AUTH_HEADERS = new Set(['authorization', 'proxy-authorization']);
const ENVIRONMENT_HEADER_HINTS = new Set(['client-id', 'prostage', 'x-client-id', 'x-api-key', 'x-stage']);
const SENSITIVE_NAME_PARTS = [
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'access_token',
  'refresh_token',
  'password',
  'secret',
  'api-key',
  'apikey',
  'client-secret',
  'client-id',
  'session',
  'cdesc',
  'national-code',
  'nationalcode',
];
const ANALYTICS_COOKIES = new Set(['_ga', '_gid', '_gat', '_gcl_au']);
const PRODUCTION_KINDS = new Set(['PRODUCTION']);
const PROTECTED_HOSTS = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);
const METADATA_HOSTS = new Set(['metadata.google.internal']);
const METADATA_IPS = new Set(['169.254.169.254', 'fd00:ec2::254']);

const DEFAULT_DOCUMENT_ORGANIZATION = 'وزارت آموزش و پرورش';
const DEFAULT_DOCUMENT_DEPARTMENT = 'مرکز توسعه آموزش مجازی، فناوری و امنیت اطلاعات';
const DEFAULT_RESPONSE_CODE_CATALOG = [
  [200, 'OK', 'درخواست با موفقیت پردازش شد.'],
  [202, 'Accepted', 'درخواست پذیرفته شده و پردازش آن در حال انجام است.'],
  [302, 'Found', 'منبع به صورت موقت در نشانی دیگری در دسترس است.'],
  [311, 'Redirect', 'برای ادامه پردازش، تغییر مسیر اعلام‌شده توسط سرویس باید بررسی شود.'],
  [330, 'Request Failed', 'درخواست در لایه سرویس‌دهنده قابل تکمیل نبوده است.'],
  [400, 'Bad Request', 'ساختار یا مقادیر درخواست نامعتبر است.'],
  [401, 'Unauthorized', 'اطلاعات احراز هویت ارسال نشده یا معتبر نیست.'],
  [402, 'Payment Required', 'انجام عملیات به مجوز یا شرط مالی وابسته است.'],
  [403, 'Forbidden', 'کاربر احراز هویت شده مجوز دسترسی به این عملیات را ندارد.'],
  [404, 'Not Found', 'منبع یا مسیر درخواست‌شده یافت نشد.'],
  [405, 'Method Not Allowed', 'متد HTTP برای این مسیر پشتیبانی نمی‌شود.'],
  [406, 'Not Acceptable', 'سرویس قادر به تولید پاسخ با قالب درخواستی نیست.'],
  [408, 'Request Timeout', 'مهلت دریافت یا پردازش درخواست پایان یافته است.'],
  [409, 'Conflict', 'درخواست با وضعیت فعلی منبع تعارض دارد.'],
  [410, 'Gone', 'منبع درخواست‌شده دیگر در دسترس نیست.'],
  [415, 'Unsupported Media Type', 'نوع محتوای بدنه درخواست پشتیبانی نمی‌شود.'],
  [422, 'Unprocessable Entity', 'ساختار درخواست معتبر است اما اعتبارسنجی داده‌ها ناموفق بود.'],
  [429, 'Too Many Requests', 'تعداد درخواست‌ها از محدودیت مجاز عبور کرده است.'],
  [451, 'Unavailable For Legal Reasons', 'دسترسی به منبع به دلایل قانونی محدود شده است.'],
  [499, 'Client Closed Request', 'ارتباط پیش از تکمیل پاسخ از سمت کارخواه بسته شده است.'],
  [500, 'Internal Server Error', 'خطای پیش‌بینی‌نشده در سرویس رخ داده است.'],
  [502, 'Bad Gateway', 'پاسخ نامعتبر از سرویس بالادستی دریافت شده است.'],
  [503, 'Service Unavailable', 'سرویس به صورت موقت در دسترس نیست.'],
  [504, 'Gateway Timeout', 'مهلت دریافت پاسخ از سرویس بالادستی پایان یافته است.'],
  [521, 'Web Server Is Down', 'سرور مقصد در دسترس یا آماده پاسخ‌گویی نیست.'],
  [599, 'Network Connect Timeout Error', 'برقراری ارتباط شبکه با سرویس مقصد با وقفه مواجه شد.'],
  [600, 'Business Error', 'خطای کسب‌وکاری اعلام‌شده توسط سرویس رخ داده است.'],
  [999, 'Unknown Error', 'خطای طبقه‌بندی‌نشده رخ داده و نیازمند بررسی فنی است.'],
].map(([code, message, description], displayOrder) => ({ code, message, description, enabled: true, displayOrder }));

const DEFAULT_DEPOSIT_STATUS_ALLOWED_VALUES = [
  ['0', 'عادی (بدون تغییر)'],
  ['1', 'عضویت/پرتفه جدید'],
  ['2', 'عادی (افزایش سپرده)'],
  ['3', 'انتقالی از ...'],
  ['4', 'برقراری سپرده‌گذاری'],
  ['5', 'عادی (کاهش سپرده)'],
  ['6', 'توقف سپرده‌گذاری'],
  ['7', 'بازنشسته در منطقه'],
  ['8', 'از کارافتاده در منطقه'],
  ['9', 'فوت در منطقه'],
  ['10', 'بازخرید در منطقه'],
  ['11', 'انصراف در منطقه'],
];
const DEFAULT_DOCUMENTATION_ALLOWED_VALUE_CATALOGS = {
  depositstatus: DEFAULT_DEPOSIT_STATUS_ALLOWED_VALUES,
  depositestatus: DEFAULT_DEPOSIT_STATUS_ALLOWED_VALUES,
};

const AUTHENTICATION_DOCUMENTATION_PROFILES = [
  {
    id: 'ministry-esb',
    enabled: true,
    title: 'احراز هویت ESB وزارت آموزش و پرورش',
    introduction: 'برای فراخوانی سرویس‌های ESB ابتدا توکن دسترسی از سرویس احراز هویت دریافت و سپس در سرایند token ارسال می‌شود.',
    baseUrl: 'https://esb.medu.ir',
    endpoint: 'https://esb.medu.ir/user/login/GetToken',
    method: 'POST',
    contentType: 'multipart/form-data',
    headerParameters: [
      { id: 'auth-header-content-type', name: 'Content-Type', location: 'HEADER', dataType: 'multipart/form-data', required: true, description: 'نوع محتوای درخواست احراز هویت', exampleValue: 'multipart/form-data', displayOrder: 0, enabled: true, source: 'PROFILE' },
    ],
    inputParameters: [
      { id: 'auth-input-username', name: 'username', location: 'BODY', dataType: 'string', required: true, description: 'نام کاربری سرویس', exampleValue: '****', displayOrder: 0, enabled: true, source: 'PROFILE' },
      { id: 'auth-input-password', name: 'password', location: 'BODY', dataType: 'string', required: true, description: 'رمز عبور سرویس', exampleValue: '****', displayOrder: 1, enabled: true, source: 'PROFILE' },
    ],
    outputParameters: [
      { id: 'auth-output-status', name: 'Status', location: 'RESPONSE', dataType: 'boolean', required: null, description: 'وضعیت اجرای درخواست', displayOrder: 0, enabled: true, source: 'PROFILE' },
      { id: 'auth-output-message', name: 'Message', location: 'RESPONSE', dataType: 'string', required: null, description: 'پیام سرویس', displayOrder: 1, enabled: true, source: 'PROFILE' },
      { id: 'auth-output-token', name: 'Token', location: 'RESPONSE', dataType: 'string', required: null, description: 'توکن دسترسی', exampleValue: '****', displayOrder: 2, enabled: true, source: 'PROFILE' },
      { id: 'auth-output-expiration', name: 'ExpirationDate', location: 'RESPONSE', dataType: 'string', required: null, description: 'تاریخ انقضای توکن', displayOrder: 3, enabled: true, source: 'PROFILE' },
      { id: 'auth-output-ip', name: 'ClientIPAddress', location: 'RESPONSE', dataType: 'string', required: null, description: 'نشانی IP کارخواه', displayOrder: 4, enabled: true, source: 'PROFILE' },
    ],
    curlExample: "curl --request POST \\\n  --url https://esb.medu.ir/user/login/GetToken \\\n  --header 'Content-Type: multipart/form-data' \\\n  --form 'username=****' \\\n  --form 'password=****'",
    responseExample: '{\n  "Status": true,\n  "Message": "موفق",\n  "Token": "****",\n  "ExpirationDate": "—",\n  "ClientIPAddress": "***.***.***.***"\n}',
  },
];

const LIMITS = {
  requestBodyBytes: Number(process.env.API_CONSOLE_MAX_REQUEST_BODY || 2 * 1024 * 1024),
  domainRpcRequestBodyBytes: Number(process.env.DOMAIN_RPC_MAX_REQUEST_BODY || 16 * 1024 * 1024),
  responseBytes: Number(process.env.API_CONSOLE_MAX_RESPONSE_BODY || 1024 * 1024),
  maxRedirects: Number(process.env.API_CONSOLE_MAX_REDIRECTS || 5),
  connectTimeoutMs: Number(process.env.API_CONSOLE_CONNECT_TIMEOUT_MS || 30000),
  readTimeoutMs: Number(process.env.API_CONSOLE_READ_TIMEOUT_MS || 60000),
  totalTimeoutMs: Number(process.env.API_CONSOLE_TOTAL_TIMEOUT_MS || 90000),
};

const API_CONSOLE_POLICY = {
  canView: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'SECURITY_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER', 'DEVELOPER'],
  canCreate: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'TECH_LEAD', 'DEVELOPER'],
  canEdit: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'TECH_LEAD', 'DEVELOPER'],
  canExecute: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'SECURITY_REVIEWER', 'TECH_LEAD', 'DEVELOPER'],
  canExecuteProduction: ['SYSTEM_ADMIN', 'TECH_LEAD', 'QA_LEAD'],
  canExecuteCommand: ['SYSTEM_ADMIN', 'QA_LEAD', 'TECH_LEAD'],
  canExecuteProductionCommand: ['SYSTEM_ADMIN', 'TECH_LEAD'],
  canDelete: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'SECURITY_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER', 'DEVELOPER'],
  canGenerateDocumentation: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'SECURITY_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER', 'DEVELOPER'],
  canReviewShares: ['SYSTEM_ADMIN', 'TECH_LEAD', 'QA_LEAD'],
  canViewUsageReports: ['SYSTEM_ADMIN', 'TECH_LEAD', 'QA_LEAD'],
  canManageUsers: ['SYSTEM_ADMIN'],
  canManageDevelopmentRuntimeProfiles: ['SYSTEM_ADMIN', 'TECH_LEAD'],
  canManageEnvironments: ['SYSTEM_ADMIN', 'TECH_LEAD', 'QA_LEAD'],
  canManageProtectedEnvironments: ['SYSTEM_ADMIN', 'TECH_LEAD', 'QA_LEAD'],
};

const USER_ROLES = ['SYSTEM_ADMIN', 'DEVELOPER', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'SECURITY_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER'];
const ROLE_LABELS = {
  SYSTEM_ADMIN: 'مدیر سیستم',
  DEVELOPER: 'توسعه‌دهنده',
  QA_LEAD: 'سرپرست QA',
  QA_SPECIALIST: 'متخصص QA',
  BA: 'تحلیلگر کسب‌وکار',
  SECURITY_REVIEWER: 'بازبین امنیت',
  TECH_LEAD: 'سرپرست فنی',
  PRODUCT_OWNER: 'مالک محصول',
};
const SHARE_STATUSES = new Set(['DRAFT', 'PENDING_REVIEW', 'RETURNED', 'APPROVED', 'DEPRECATED', 'UNLISTED', 'REMOVED']);
/** Statuses that appear in Repository / Portal listings. UNLISTED and REMOVED stay out of display. */
const REPOSITORY_VISIBLE_STATUSES = new Set(['APPROVED', 'DEPRECATED']);
const USAGE_EVENT_TYPES = new Set(['ADDED_TO_CONSOLE', 'API_OPENED', 'API_EXECUTED', 'REMOVED_FROM_CONSOLE', 'NEW_VERSION_VIEWED']);
const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const runtimeSecrets = new Map();
let cachedSecretKey = null;
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

class ApiConsoleError extends Error {
  constructor(category, message, statusCode = 400) {
    super(message);
    this.category = category;
    this.statusCode = statusCode;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function performanceMetricsSnapshot() {
  const memory = process.memoryUsage();
  return {
    status: 'ok',
    service: 'utms-api',
    checkedAt: nowIso(),
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    memory: {
      rssBytes: memory.rss,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
    },
    eventLoop: {
      minMs: Math.round(eventLoopDelay.min / 1e6 * 100) / 100,
      meanMs: Math.round(eventLoopDelay.mean / 1e6 * 100) / 100,
      maxMs: Math.round(eventLoopDelay.max / 1e6 * 100) / 100,
      p95Ms: Math.round(eventLoopDelay.percentile(95) / 1e6 * 100) / 100,
      p99Ms: Math.round(eventLoopDelay.percentile(99) / 1e6 * 100) / 100,
    },
    activeHandles: typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : null,
    activeRequests: typeof process._getActiveRequests === 'function' ? process._getActiveRequests().length : null,
  };
}

function makeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function safeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function byteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

function roleAllowed(role, allowed) {
  return role === 'SYSTEM_ADMIN' || allowed.includes(role);
}

function maskValue(value, visible = 4) {
  const text = String(value || '');
  if (!text) return '';
  if (text.includes('{{') && text.includes('}}')) return text;
  if (isSecretReference(text)) return '{{secret}}';
  if (text.length <= visible * 2) return '*'.repeat(Math.max(text.length, 6));
  return `${text.slice(0, visible)}${'*'.repeat(Math.min(16, Math.max(8, text.length - visible * 2)))}${text.slice(-visible)}`;
}

function isSensitiveName(name) {
  const normalized = String(name || '').toLowerCase();
  return SENSITIVE_NAME_PARTS.some(part => normalized.includes(part));
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s'"\\]+/gi, '$1{{token}}')
    .replace(/(authorization\s*:\s*basic\s+)[^\s'"\\]+/gi, '$1{{basicCredentials}}')
    .replace(/(cookie\s*:\s*)[^'"\\\r\n]+/gi, '$1{{cookies}}')
    .replace(/([?&](?:token|access_token|refresh_token|password|api_key|apikey|client_secret)=)[^&\s'"\\]+/gi, '$1{{secret}}')
    .replace(/((?:token|access_token|refresh_token|password|client-secret|api-key|client-id|national-code)\s*["']?\s*[:=]\s*["'])[^"',\s}]+/gi, '$1{{secret}}');
}

function sanitizeJsonForPreview(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => (typeof item === 'string' ? sanitizeText(item) : item)));
}

function prettyJsonPreview(value) {
  try {
    return JSON.stringify(sanitizeJsonForPreview(value), null, 2);
  } catch {
    return sanitizeText(typeof value === 'string' ? value : JSON.stringify(value));
  }
}

async function ensureRuntimeSessionStillConnected(appSessionId, profile, state) {
  try {
    const probe = await runtimeWhoAmI(state, profile);
    if (probe.response?.Result?.IsUserLogin === true) {
      return { connected: true, state: probe.state };
    }
    await deleteRuntimeSession(appSessionId, profile.id);
    return { connected: false, state: probe.state };
  } catch {
    // Keep the cookie jar from the business call. A transient who-am-i failure must not force re-login.
    return { connected: true, state };
  }
}

function isSecretReference(value) {
  const text = String(value || '');
  return text.startsWith('secret://') || text.startsWith('secret/');
}

function ensureDataDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getVaultProvider() {
  return vaultProviderModule.getProvider();
}

function loadOrCreateSecretKey() {
  if (cachedSecretKey) return cachedSecretKey;
  try {
    cachedSecretKey = vaultProviderModule.loadOrCreateSecretKey();
  } catch (error) {
    throw new ApiConsoleError('SECRET_RESOLUTION_ERROR', error.message || 'API Console secret key must be 32 bytes in base64 form.');
  }
  return cachedSecretKey;
}

function loadSecretVault() {
  return vaultProviderModule.loadSecretVault();
}

function saveSecretVault(vault) {
  vaultProviderModule.saveSecretVault(vault);
}

function encryptSecretValue(value) {
  return vaultProviderModule.encryptSecretValue(value);
}

function decryptSecretValue(record) {
  try {
    return vaultProviderModule.decryptSecretValue(record);
  } catch (error) {
    throw new ApiConsoleError('SECRET_RESOLUTION_ERROR', error.message || 'Unsupported API Console secret record.');
  }
}

function rememberSecret(value) {
  const ref = `secret://api-console/${randomUUID()}`;
  const normalizedValue = String(value || '');
  runtimeSecrets.set(ref, normalizedValue);
  getVaultProvider().store(ref, normalizedValue);
  return ref;
}

function protectSensitiveScalar(name, value) {
  const text = String(value ?? '');
  if (!text || text.includes('{{') || isSecretReference(text) || !isSensitiveName(name)) return text;
  return rememberSecret(text);
}

function protectJsonSecrets(value) {
  if (Array.isArray(value)) return value.map(item => protectJsonSecrets(item));
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveName(key) && val !== null && typeof val !== 'object') {
        next[key] = protectSensitiveScalar(key, val);
      } else {
        next[key] = protectJsonSecrets(val);
      }
    }
    return next;
  }
  return value;
}

function protectBodySecrets(bodyType, bodyTemplate) {
  if (bodyType === 'json' && bodyTemplate) {
    const parsed = parseJsonSafely(bodyTemplate);
    if (parsed.ok) {
      return JSON.stringify(protectJsonSecrets(parsed.value), null, 2);
    }
  }
  if (bodyType === 'form-urlencoded' && bodyTemplate) {
    const params = new URLSearchParams(bodyTemplate);
    for (const key of Array.from(params.keys())) {
      if (isSensitiveName(key)) params.set(key, protectSensitiveScalar(key, params.get(key) || ''));
    }
    return params.toString();
  }
  return bodyTemplate || '';
}

function headerCategory(name) {
  const normalized = String(name || '').toLowerCase();
  if (AUTH_HEADERS.has(normalized) || normalized === 'cookie') return 'AUTHENTICATION';
  if (TRANSPORT_HEADERS.has(normalized)) return 'TRANSPORT_GENERATED';
  if (BROWSER_HEADERS.has(normalized)) return 'BROWSER_GENERATED';
  if (ENVIRONMENT_HEADER_HINTS.has(normalized)) return 'ENVIRONMENT';
  return 'USER_BUSINESS';
}

function headerDescription(name, category) {
  const normalized = String(name || '').toLowerCase();
  if (category === 'TRANSPORT_GENERATED') return 'Managed by the selected HTTP transport and recalculated at execution time.';
  if (category === 'BROWSER_GENERATED') return 'Browser-only compatibility header imported from a copied browser request.';
  if (category === 'AUTHENTICATION') return 'Authentication header. Values are masked and excluded from generated documentation.';
  if (category === 'ENVIRONMENT') return 'Environment or application routing header.';
  if (normalized === 'content-type') return 'Declares the request body media type.';
  if (normalized === 'accept') return 'Declares preferred response media type.';
  return 'Application or business header.';
}

function createHeader(name, value, displayOrder, source = 'IMPORTED_CURL', executionMode = 'RECOMMENDED') {
  const category = headerCategory(name);
  const sensitive = isSensitiveName(name);
  const normalized = String(name || '').toLowerCase();
  const transportGenerated = category === 'TRANSPORT_GENERATED';
  const browserGenerated = category === 'BROWSER_GENERATED';
  const enabled = executionMode === 'EXACT'
    ? !['content-length'].includes(normalized)
    : !(transportGenerated || browserGenerated);
  return {
    id: makeId('hdr'),
    name,
    valueTemplate: value,
    enabled,
    sensitive,
    source,
    category,
    description: headerDescription(name, category),
    maskedValue: sensitive ? maskValue(value) : value,
    displayOrder,
    cannotTransmitExactly: ['content-length', 'connection'].includes(normalized),
    replayNote: ['content-length', 'connection'].includes(normalized)
      ? 'Recalculated or controlled by the HTTP client.'
      : browserGenerated
        ? 'Kept for traceability. Disabled in recommended replay.'
        : undefined,
  };
}

function createCookie(name, value, displayOrder, source = 'IMPORTED_CURL') {
  const sensitive = isSensitiveName(name) || !ANALYTICS_COOKIES.has(String(name || '').toLowerCase());
  return {
    id: makeId('ck'),
    name,
    valueReference: value,
    enabled: true,
    sensitive,
    maskedValue: sensitive ? maskValue(value) : value,
    source,
    displayOrder,
  };
}

function parseJsonSafely(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    const match = message.match(/position\s+(\d+)/i);
    if (match) {
      const position = Number(match[1]);
      const until = String(raw || '').slice(0, position);
      const lines = until.split(/\r?\n/);
      return { ok: false, error: message, line: lines.length, column: lines[lines.length - 1].length + 1 };
    }
    return { ok: false, error: message };
  }
}

function buildClassification(type, body, endpoint) {
  if (type === 'CORE_COMMAND') {
    return {
      type,
      serviceId: body?.serviceId || null,
      operationPath: body?.formId || null,
      coreOperationType: 'COMMAND',
      endpoint,
    };
  }
  if (type === 'CORE_QUERY') {
    return {
      type,
      serviceId: body?.serviceId || null,
      operationPath: body?.key || null,
      coreOperationType: 'QUERY',
      endpoint,
    };
  }
  return {
    type: 'GENERIC_HTTP',
    serviceId: null,
    operationPath: null,
    coreOperationType: null,
    endpoint: null,
  };
}

function detectCoreClassification(urlText, body) {
  let pathname = '';
  try {
    pathname = new URL(urlText).pathname;
  } catch {
    pathname = urlText;
  }
  const jsonBody = body && typeof body.value === 'object' && body.value !== null ? body.value : null;
  if (pathname.endsWith(CORE_COMMAND_ENDPOINT) && jsonBody && typeof jsonBody.serviceId === 'string' && typeof jsonBody.formId === 'string' && Object.prototype.hasOwnProperty.call(jsonBody, 'data')) {
    return buildClassification('CORE_COMMAND', jsonBody, CORE_COMMAND_ENDPOINT);
  }
  if (pathname.endsWith(CORE_QUERY_ENDPOINT) && jsonBody && typeof jsonBody.serviceId === 'string' && typeof jsonBody.key === 'string' && Object.prototype.hasOwnProperty.call(jsonBody, 'params')) {
    return buildClassification('CORE_QUERY', jsonBody, CORE_QUERY_ENDPOINT);
  }
  return buildClassification('GENERIC_HTTP', null, null);
}

const curlParser = createCurlParser({
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
});
const {
  PARSER_VERSION,
  parseHeaderLine,
  createDefaultAssertions,
  createDefaultScripts,
  createBlankNormalizedRequest,
  parseCurlInternal,
  definitionFromNormalized,
} = curlParser;

const OBJECT_STORE_TTL_DAYS = Number(process.env.API_CONSOLE_OBJECT_STORE_TTL_DAYS || 7);
const OBJECT_STORE_MAX_BYTES = Number(process.env.API_CONSOLE_OBJECT_STORE_MAX_BYTES || 0);
const objectStore = createObjectStore({
  rootDir: process.env.API_CONSOLE_OBJECT_STORE_DIR
    ? resolveRepositoryPath(process.env.API_CONSOLE_OBJECT_STORE_DIR)
    : path.join(DATA_DIR, 'object-storage'),
});
let objectStoreCleanupTimer = null;

function runObjectStoreCleanup() {
  try {
    return objectStore.cleanupExpired({
      maxAgeMs: Math.max(1, OBJECT_STORE_TTL_DAYS) * 24 * 60 * 60 * 1000,
      ...(OBJECT_STORE_MAX_BYTES > 0 ? { maxTotalBytes: OBJECT_STORE_MAX_BYTES } : {}),
    });
  } catch (error) {
    console.error('[api-console] object-store cleanup failed:', error?.message || error);
    return null;
  }
}

function startObjectStoreCleanupInterval() {
  if (objectStoreCleanupTimer) return objectStoreCleanupTimer;
  runObjectStoreCleanup();
  objectStoreCleanupTimer = setInterval(runObjectStoreCleanup, 60 * 60 * 1000);
  if (typeof objectStoreCleanupTimer.unref === 'function') objectStoreCleanupTimer.unref();
  return objectStoreCleanupTimer;
}

const executionRunner = createExecutionRunner({
  ApiConsoleError,
  makeId,
  nowIso,
  safeClone,
  sanitizeText,
  createHeader,
  createCookie,
  hasBody: (...args) => hasBody(...args),
  LIMITS,
  validateDestination: (...args) => validateDestination(...args),
  isCorporateRemappedAddress: (...args) => isCorporateRemappedAddress(...args),
  roleAllowed,
  API_CONSOLE_POLICY,
  getStore: () => store,
  saveStore,
  reloadStoreFromDisk: (...args) => reloadStoreFromDisk(...args),
  audit,
  logUsageEvent: (...args) => logUsageEvent(...args),
  findEnvironment: (...args) => findEnvironment(...args),
  createDefaultScripts,
  resolveRequest: (...args) => resolveRequest(...args),
  validateProductionPolicy: (...args) => validateProductionPolicy(...args),
  createBlockedExecution: (...args) => createBlockedExecution(...args),
  createExecutionFromError: (...args) => createExecutionFromError(...args),
  selectRunner: (...args) => selectRunner(...args),
  runnerHostTag: (...args) => runnerHostTag(...args),
  zoneWorkerHeartbeatFresh: (...args) => zoneWorkerHeartbeatFresh(...args),
  sleep: (...args) => sleep(...args),
  evaluateAssertions: (...args) => evaluateAssertions(...args),
  runPreRequestScript: (...args) => runPreRequestScript(...args),
  runPostResponseScript: (...args) => runPostResponseScript(...args),
  businessResultFromAssertions: (...args) => businessResultFromAssertions(...args),
  putBlob: (...args) => objectStore.putBlob(...args),
});
const {
  parseSetCookie,
  performHttpRequest,
  executeWithRedirects,
  applyIsGatewayAuth,
  executeIsTransportWithAccessRecovery,
  executeRequest,
  isTlsTransportError,
  tlsErrorMessage,
  responsePreviewMode,
  decompressBody,
} = executionRunner;

function requestBodyFromDefinition(request) {
  if (request.bodyType === 'none') return { type: 'none', value: null, raw: '' };
  if (request.bodyType === 'json') {
    const parsed = parseJsonSafely(request.bodyTemplate || '');
    return {
      type: 'json',
      value: parsed.ok ? parsed.value : null,
      raw: request.bodyTemplate || '',
      contentType: 'application/json',
    };
  }
  if (request.bodyType === 'form-urlencoded') {
    return {
      type: 'form-urlencoded',
      value: Object.fromEntries(new URLSearchParams(request.bodyTemplate || '')),
      raw: request.bodyTemplate || '',
      contentType: 'application/x-www-form-urlencoded',
    };
  }
  if (request.bodyType === 'xml') {
    return { type: 'xml', value: request.bodyTemplate || '', raw: request.bodyTemplate || '', contentType: 'application/xml' };
  }
  if (request.bodyType === 'multipart') {
    return { type: 'multipart', value: request.bodyTemplate || '', raw: request.bodyTemplate || '', contentType: 'multipart/form-data' };
  }
  return { type: request.bodyType, value: request.bodyTemplate || '', raw: request.bodyTemplate || '' };
}

function normalizedFromDefinition(request) {
  const body = requestBodyFromDefinition(request);
  return {
    method: request.method,
    url: request.urlTemplate,
    queryParameters: request.queryParameters || [],
    headers: request.headers || [],
    cookies: request.cookies || [],
    body,
    authentication: request.authentication || { type: 'none' },
    tls: request.tls || { verifyCertificate: true },
    executionMode: request.executionMode || 'RECOMMENDED',
    classification: detectCoreClassification(request.urlTemplate, body),
  };
}

function protectRequestSecrets(request) {
  const next = safeClone(request);
  next.headers = (next.headers || []).map((header, index) => {
    const sensitive = header.sensitive || isSensitiveName(header.name);
    const valueTemplate = sensitive ? protectSensitiveScalar(header.name, header.valueTemplate) : header.valueTemplate;
    return {
      ...header,
      sensitive,
      valueTemplate,
      maskedValue: sensitive ? maskValue(valueTemplate) : valueTemplate,
      displayOrder: header.displayOrder ?? index,
    };
  });
  next.cookies = (next.cookies || []).map((cookie, index) => {
    const sensitive = cookie.sensitive || isSensitiveName(cookie.name) || !ANALYTICS_COOKIES.has(String(cookie.name || '').toLowerCase());
    const valueReference = sensitive ? protectSensitiveScalar(cookie.name, cookie.valueReference) : cookie.valueReference;
    return {
      ...cookie,
      sensitive,
      valueReference,
      maskedValue: sensitive ? maskValue(valueReference) : valueReference,
      displayOrder: cookie.displayOrder ?? index,
    };
  });
  next.queryParameters = (next.queryParameters || []).map((param, index) => {
    const sensitive = param.sensitive || isSensitiveName(param.name);
    return {
      ...param,
      sensitive,
      value: sensitive ? protectSensitiveScalar(param.name, param.value) : param.value,
      displayOrder: param.displayOrder ?? index,
    };
  });
  next.bodyTemplate = protectBodySecrets(next.bodyType, next.bodyTemplate);
  next.bodyType = next.bodyType || 'none';
  next.scripts = { ...createDefaultScripts(), ...(next.scripts || {}) };
  const body = requestBodyFromDefinition(next);
  next.classification = detectCoreClassification(next.urlTemplate, body);
  return next;
}

function buildUrlWithQuery(baseUrl, params) {
  const enabled = (params || []).filter(param => param.enabled && param.name);
  if (!enabled.length) return baseUrl;
  try {
    const url = new URL(baseUrl);
    enabled.forEach(param => url.searchParams.set(param.name, param.value));
    return url.toString();
  } catch {
    const query = enabled
      .map(param => `${encodeURIComponent(param.name)}=${encodeURIComponent(param.value)}`)
      .join('&');
    return `${baseUrl}${String(baseUrl).includes('?') ? '&' : '?'}${query}`;
  }
}

function hasBody(body) {
  return body && body.type !== 'none' && String(body.raw || '').length > 0;
}

function requestBodyContentType(body) {
  if (!hasBody(body)) return '';
  return body.contentType ||
    (body.type === 'json' ? 'application/json'
      : body.type === 'xml' ? 'application/xml'
        : body.type === 'form-urlencoded' ? 'application/x-www-form-urlencoded'
          : body.type === 'multipart' ? 'multipart/form-data'
            : 'text/plain');
}

function requestHeadersWithBodyContentType(request) {
  const enabledHeaders = (request.headers || []).filter(header => header.enabled);
  const body = requestBodyFromDefinition(request);
  const hasContentType = enabledHeaders.some(header => String(header.name || '').toLowerCase() === 'content-type');
  const contentType = requestBodyContentType(body);
  if (contentType && !hasContentType) {
    return [
      ...enabledHeaders,
      {
        id: 'doc-content-type',
        name: 'content-type',
        valueTemplate: contentType,
        enabled: true,
        sensitive: false,
        source: 'SYSTEM',
        category: 'TRANSPORT_GENERATED',
        description: 'Derived from Body type for the request payload.',
        maskedValue: contentType,
        displayOrder: enabledHeaders.length,
      },
    ];
  }
  return enabledHeaders;
}

function documentedRequestHeaders(request) {
  return requestHeadersWithBodyContentType(request).filter(header => {
    const name = String(header.name || '').trim().toLowerCase();
    if (!name || name === 'content-length') return false;
    if (BROWSER_HEADERS.has(name) || TRANSPORT_HEADERS.has(name)) return name === 'content-type';
    return header.enabled !== false;
  });
}

function cleanDocumentationUrl(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function documentationUrlParts(value) {
  const endpoint = cleanDocumentationUrl(value);
  try {
    const parsed = new URL(endpoint);
    return { endpoint, baseUrl: `${parsed.protocol}//${parsed.host}`, operationPath: parsed.pathname || '/' };
  } catch {
    return { endpoint, baseUrl: '', operationPath: endpoint || '/' };
  }
}

function inferDocumentationDataType(value) {
  if (value === null || value === undefined) return 'unknown';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'Integer' : 'Number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

function normalizedDocumentationFieldKey(location, name) {
  const pathValue = String(name || '').trim();
  return `${location}:${location === 'HEADER' ? pathValue.toLowerCase() : pathValue}`;
}

function isSensitiveDocumentationSampleName(name) {
  const normalized = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return isSensitiveName(name) ||
    normalized.includes('nationalcode') || normalized.includes('employeecode') || normalized.includes('personnelcode') ||
    normalized.includes('payableprice') || normalized.includes('sumprice') || normalized.includes('amount');
}

function maskPersonallyIdentifiableValue(name, value) {
  const normalized = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const text = String(value ?? '');
  if (!text) return '';
  if (text.includes('*')) return text;
  if (isSecretReference(text) || text.includes('{{')) return '****';
  if (normalized.includes('nationalcode')) {
    return text.length > 7 ? `${text.slice(0, 4)}***${text.slice(-3)}` : '****';
  }
  if (normalized.includes('employeecode') || normalized.includes('personnelcode')) {
    return text.length > 4 ? `${text.slice(0, 2)}****${text.slice(-2)}` : '****';
  }
  if (normalized.includes('payableprice') || normalized.includes('sumprice') || normalized.includes('amount')) {
    return text.length > 6 ? `${text.slice(0, Math.max(1, text.length - 5))}**${text.slice(-3)}` : '****';
  }
  if (isSensitiveName(name)) return maskValue(text);
  return value;
}

function maskDocumentationSecret(value) {
  const text = String(value || '');
  if (!text || isSecretReference(text) || text.includes('{{')) return '****';
  if (text.includes('*')) return text;
  const bearer = text.match(/^Bearer\s+(.+)$/i);
  if (bearer) return `Bearer ${maskDocumentationSecret(bearer[1])}`;
  if (text.length <= 18) return '******';
  return `${text.slice(0, 8)}...****...${text.slice(-6)}`;
}

function documentationExampleValue(name, value) {
  if (value === null || value === undefined || typeof value === 'object') return undefined;
  const masked = maskPersonallyIdentifiableValue(name, value);
  return typeof masked === 'string' ? sanitizeText(masked) : String(masked);
}

function defaultAllowedValuesForDocumentationField(name) {
  const fieldName = String(name || '').split('.').at(-1)?.replace(/\[\]$/g, '') || '';
  const normalized = fieldName.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return (DEFAULT_DOCUMENTATION_ALLOWED_VALUE_CATALOGS[normalized] || []).map(([value, description], displayOrder) => ({
    id: `doc-allowed-${normalized}-${value}`,
    value,
    description,
    enabled: true,
    displayOrder,
  }));
}

function makeDocumentationParameter({ name, location, value, dataType, required = null, description = '', displayOrder = 0, id, source = 'AUTO', allowedValues }) {
  return {
    id: id || `doc-${String(location || '').toLowerCase()}-${String(name || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || displayOrder}`,
    name: String(name || ''),
    location,
    dataType: dataType || inferDocumentationDataType(value),
    required: required === true ? true : required === false ? false : null,
    description: String(description || ''),
    ...(documentationExampleValue(name, value) === undefined ? {} : { exampleValue: documentationExampleValue(name, value) }),
    parentPath: String(name || '').includes('.') ? String(name).replace(/\.[^.]+$/, '') : undefined,
    displayOrder,
    enabled: true,
    deprecated: false,
    source,
    allowedValues: location === 'RESPONSE' ? (allowedValues || defaultAllowedValuesForDocumentationField(name)) : (allowedValues || []),
    allowedValuesCustomized: false,
  };
}

function inferStructuredDocumentationParameters(value, location) {
  const rows = [];
  const visitChildren = (container, prefix) => {
    if (!container || typeof container !== 'object') return;
    const entries = Array.isArray(container) ? Object.entries(container[0] && typeof container[0] === 'object' ? container[0] : {}) : Object.entries(container);
    for (const [key, childValue] of entries) {
      const pathValue = prefix ? `${prefix}.${key}` : key;
      const documentedPath = Array.isArray(childValue) ? `${pathValue}[]` : pathValue;
      rows.push(makeDocumentationParameter({ name: documentedPath, location, value: childValue, displayOrder: rows.length }));
      if (Array.isArray(childValue)) {
        const sample = childValue.find(item => item !== null && item !== undefined);
        if (sample && typeof sample === 'object') visitChildren(sample, documentedPath);
      } else if (childValue && typeof childValue === 'object') {
        visitChildren(childValue, pathValue);
      }
    }
  };
  if (Array.isArray(value)) {
    const sample = value.find(item => item !== null && item !== undefined);
    if (sample && typeof sample === 'object') visitChildren(sample, '[]');
  } else {
    visitChildren(value, '');
  }
  return rows;
}

function inferRequestDocumentationParameters(request) {
  const rows = [];
  (request.queryParameters || []).filter(item => item.enabled && item.name).forEach(item => {
    rows.push(makeDocumentationParameter({
      name: item.name,
      location: 'QUERY',
      value: item.value,
      dataType: 'string',
      description: item.description || '',
      displayOrder: rows.length,
    }));
  });

  const seenPathNames = new Set();
  const pathMatches = String(request.urlTemplate || '').matchAll(/\{\{?([^{}]+)\}\}?|:([A-Za-z_][A-Za-z0-9_]*)/g);
  for (const match of pathMatches) {
    const name = match[1] || match[2];
    if (!name || seenPathNames.has(name)) continue;
    seenPathNames.add(name);
    rows.push(makeDocumentationParameter({ name, location: 'PATH', dataType: 'string', displayOrder: rows.length }));
  }

  if (request.bodyType === 'json' && request.bodyTemplate) {
    const parsed = parseJsonSafely(request.bodyTemplate);
    if (parsed.ok) {
      inferStructuredDocumentationParameters(parsed.value, 'BODY').forEach(row => rows.push({ ...row, displayOrder: rows.length }));
    }
  } else if (['form-urlencoded', 'multipart'].includes(request.bodyType) && request.bodyTemplate) {
    try {
      const pairs = request.bodyType === 'form-urlencoded'
        ? Array.from(new URLSearchParams(request.bodyTemplate).entries())
        : String(request.bodyTemplate).split(/\r?\n|&/).map(line => {
            const separator = line.indexOf('=');
            return separator >= 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : ['', ''];
          });
      pairs.filter(([name]) => name).forEach(([name, value]) => rows.push(makeDocumentationParameter({
        name,
        location: 'BODY',
        value,
        dataType: 'string',
        displayOrder: rows.length,
      })));
    } catch {
      // Raw body remains available as the request example when form parsing is unsafe.
    }
  }
  return rows;
}

function meaningfulHeaderDescription(header) {
  const description = String(header?.description || '').trim();
  const generatedDescriptions = new Set([
    'Application or business header.',
    'Managed by the selected HTTP transport and recalculated at execution time.',
    'Browser-only compatibility header imported from a copied browser request.',
    'Authentication header. Values are masked and excluded from generated documentation.',
    'Environment or application routing header.',
  ]);
  return generatedDescriptions.has(description) ? '' : description;
}

function inferHeaderDocumentationParameters(request) {
  return documentedRequestHeaders(request).map((header, index) => makeDocumentationParameter({
    id: header.id ? `doc-${header.id}` : undefined,
    name: header.name,
    location: 'HEADER',
    value: header.sensitive || isSensitiveName(header.name)
      ? maskDocumentationSecret(header.valueTemplate)
      : header.valueTemplate,
    dataType: String(header.name || '').toLowerCase() === 'content-type' ? (header.valueTemplate || 'string') : 'string',
    description: meaningfulHeaderDescription(header),
    displayOrder: index,
  }));
}

function normalizeDocumentationParameter(raw, fallbackLocation, index) {
  const location = ['HEADER', 'QUERY', 'PATH', 'BODY', 'RESPONSE'].includes(raw?.location) ? raw.location : fallbackLocation;
  const name = String(raw?.name || '').trim();
  const sensitive = location === 'HEADER' ? isSensitiveName(name) : isSensitiveDocumentationSampleName(name);
  let exampleValue = raw?.exampleValue === undefined ? undefined : String(raw.exampleValue);
  if (sensitive && exampleValue) exampleValue = String(maskPersonallyIdentifiableValue(name, exampleValue));
  if (isSecretReference(exampleValue)) exampleValue = '****';
  const allowedValues = Array.isArray(raw?.allowedValues)
    ? raw.allowedValues.map((item, allowedIndex) => ({
        id: String(item?.id || makeId('doc-allowed-value')),
        value: sanitizeText(String(item?.value ?? '')),
        description: sanitizeText(String(item?.description || '')),
        enabled: item?.enabled !== false,
        displayOrder: Number.isFinite(Number(item?.displayOrder)) ? Number(item.displayOrder) : allowedIndex,
      })).sort((left, right) => left.displayOrder - right.displayOrder)
    : [];
  const inferredParentPath = name.includes('.') ? name.replace(/\.[^.]+$/, '') : undefined;
  return {
    id: String(raw?.id || makeId('doc-param')),
    name,
    location,
    dataType: String(raw?.dataType || 'unknown'),
    required: raw?.required === true ? true : raw?.required === false ? false : null,
    description: sanitizeText(String(raw?.description || '')),
    ...(exampleValue === undefined ? {} : { exampleValue: sanitizeText(exampleValue) }),
    parentPath: raw?.parentPath ? String(raw.parentPath) : inferredParentPath,
    displayOrder: Number.isFinite(Number(raw?.displayOrder)) ? Number(raw.displayOrder) : index,
    enabled: raw?.enabled !== false,
    deprecated: !!raw?.deprecated,
    source: raw?.source || 'MANUAL',
    allowedValues,
    allowedValuesCustomized: !!raw?.allowedValuesCustomized,
  };
}

function mergeDocumentationParameters(existing, discovered, fallbackLocation) {
  const existingRows = Array.isArray(existing)
    ? existing.map((row, index) => normalizeDocumentationParameter(row, fallbackLocation, index)).filter(row => row.name)
    : [];
  const byKey = new Map(existingRows.map(row => [normalizedDocumentationFieldKey(row.location, row.name), row]));
  const discoveredKeys = new Set();
  const merged = discovered.map((row, index) => {
    const normalized = normalizeDocumentationParameter(row, fallbackLocation, index);
    const key = normalizedDocumentationFieldKey(normalized.location, normalized.name);
    discoveredKeys.add(key);
    const previous = byKey.get(key);
    if (!previous) return normalized;
    return {
      ...normalized,
      id: previous.id,
      dataType: previous.dataType || normalized.dataType,
      required: previous.required,
      description: previous.description,
      exampleValue: previous.exampleValue ?? normalized.exampleValue,
      allowedValues: previous.allowedValuesCustomized
        ? previous.allowedValues
        : previous.allowedValues?.length ? previous.allowedValues : normalized.allowedValues,
      allowedValuesCustomized: previous.allowedValuesCustomized,
      displayOrder: previous.displayOrder,
      enabled: previous.enabled,
      deprecated: false,
      source: previous.source,
    };
  });
  existingRows.filter(row => !discoveredKeys.has(normalizedDocumentationFieldKey(row.location, row.name))).forEach(row => {
    merged.push(row.source === 'AUTO'
      ? { ...row, enabled: false, deprecated: true }
      : row);
  });
  return merged.sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name));
}

function defaultResponseCodes() {
  return DEFAULT_RESPONSE_CODE_CATALOG.map(row => ({ ...row }));
}

function normalizeResponseCodes(rows) {
  const source = Array.isArray(rows) ? rows : defaultResponseCodes();
  return source.map((row, index) => ({
    code: Number.isFinite(Number(row?.code)) ? Number(row.code) : 0,
    message: sanitizeText(String(row?.message || '')),
    description: sanitizeText(String(row?.description || '')),
    enabled: row?.enabled !== false,
    displayOrder: Number.isFinite(Number(row?.displayOrder)) ? Number(row.displayOrder) : index,
  })).sort((left, right) => left.displayOrder - right.displayOrder || left.code - right.code);
}

function authenticationProfile(profileId) {
  const profile = AUTHENTICATION_DOCUMENTATION_PROFILES.find(item => item.id === profileId);
  return profile ? safeClone(profile) : null;
}

function authenticationApplicable(request) {
  const hasAuthenticationHeader = (request.headers || []).some(header => ['token', 'authorization'].includes(String(header.name || '').toLowerCase()));
  return request.authentication?.type !== 'none' || hasAuthenticationHeader;
}

function normalizeAuthenticationDocumentation(raw, request, profileId) {
  const urlParts = documentationUrlParts(request.urlTemplate);
  const selectedProfileId = profileId || raw?.profileId || (urlParts.baseUrl === 'https://esb.medu.ir' && authenticationApplicable(request) ? 'ministry-esb' : '');
  const profile = authenticationProfile(selectedProfileId);
  const source = { ...(profile || {}), ...(raw || {}) };
  const enabled = source.enabled === true || (!raw && !!profile && authenticationApplicable(request));
  return {
    profileId: selectedProfileId || undefined,
    enabled,
    title: sanitizeText(String(source.title || 'سرویس احراز هویت')),
    introduction: sanitizeText(String(source.introduction || '')),
    baseUrl: cleanDocumentationUrl(source.baseUrl || ''),
    endpoint: cleanDocumentationUrl(source.endpoint || ''),
    method: String(source.method || 'POST').toUpperCase(),
    contentType: String(source.contentType || 'application/json'),
    headerParameters: (source.headerParameters || []).map((row, index) => normalizeDocumentationParameter(row, 'HEADER', index)),
    inputParameters: (source.inputParameters || []).map((row, index) => normalizeDocumentationParameter(row, 'BODY', index)),
    outputParameters: (source.outputParameters || []).map((row, index) => normalizeDocumentationParameter(row, 'RESPONSE', index)),
    curlExample: sanitizeDocumentationCurl(source.curlExample || ''),
    responseExample: sanitizeDocumentationResponseExample(source.responseExample || ''),
  };
}

function sanitizeDocumentationJsonValue(value, pathValue = '', parameterRows = []) {
  if (Array.isArray(value)) return value.map(item => sanitizeDocumentationJsonValue(item, `${pathValue}[]`, parameterRows));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      const childPath = pathValue ? `${pathValue}.${key}` : key;
      return [key, sanitizeDocumentationJsonValue(child, childPath, parameterRows)];
    }));
  }
  const fieldName = pathValue.split('.').at(-1)?.replace(/\[\]$/g, '') || pathValue;
  const metadata = parameterRows.find(row => row.name === pathValue || row.name === fieldName);
  if (isSecretReference(value) || isSensitiveDocumentationSampleName(fieldName)) {
    return metadata?.exampleValue || maskPersonallyIdentifiableValue(fieldName, value) || '****';
  }
  return value;
}

function sanitizeDocumentationResponseExample(text, parameterRows = []) {
  const value = String(text || '').trim();
  if (!value) return '';
  const parsed = parseJsonSafely(value);
  if (parsed.ok) return JSON.stringify(sanitizeDocumentationJsonValue(parsed.value, '', parameterRows), null, 2);
  return sanitizeText(value).replace(/secret:\/\/api-console\/[0-9a-f-]+/gi, '****');
}

function sanitizeDocumentationCurl(text) {
  const withoutContentLength = String(text || '')
    .split(/\r?\n/)
    .filter(line => !(/^\s*(?:--header|-H)\s+/i.test(line) && /content-length\s*:/i.test(line)))
    .join('\n')
    .replace(/\s+(?:--header|-H)\s+(?:'Content-Length:[^']*'|"Content-Length:[^"]*")/gi, '');
  return sanitizeText(withoutContentLength)
    .replace(/secret:\/\/api-console\/[0-9a-f-]+/gi, '****')
    .replace(/secret%3A%2F%2Fapi-console%2F[0-9a-f-]+/gi, '****')
    .replace(/((?:--header|-H)\s+['"]?(?:authorization|token|access_token|refresh_token|client-secret|api-key|x-api-key)\s*:\s*)([^'"\\\r\n]+)/gi,
      (_match, prefix, value) => `${prefix}${maskDocumentationSecret(String(value).trim())}`)
    .replace(/((?:--form|--data-urlencode)\s+['"]?(?:password|token|access_token|client-secret|api-key)\s*=)[^'"\s]+/gi, '$1****')
    .replace(/((?:national[_-]?code|employee[_-]?code|personnel[_-]?code|NetPayablePrice|DeductionsSumPrice)\s*["']?\s*:\s*["'])([^"',}\s]+)/gi,
      (_match, prefix, value) => `${prefix}${maskPersonallyIdentifiableValue(prefix, value)}`);
}

function latestDocumentationEvidence(request, executions, manualExamples) {
  const execution = (executions || [])
    .filter(item => {
      const statusCode = Number(item.response?.statusCode || item.statusCode || 0);
      return item.requestId === request.id && item.transportResult === 'SUCCESS' && item.response && statusCode >= 200 && statusCode < 300;
    })
    .sort((left, right) => String(right.completedAt || right.startedAt || '').localeCompare(String(left.completedAt || left.startedAt || '')))[0];
  const manual = (manualExamples || [])
    .filter(item => item.requestId === request.id && item.reviewStatus !== 'REJECTED' && Number(item.statusCode || 0) >= 200 && Number(item.statusCode || 0) < 300)
    .sort((left, right) => String(right.enteredAt || '').localeCompare(String(left.enteredAt || '')))[0];
  const executionAt = new Date(execution?.completedAt || execution?.startedAt || 0).getTime();
  const manualAt = new Date(manual?.enteredAt || 0).getTime();
  const useManual = !!manual && (!execution || manualAt >= executionAt);
  const responseText = useManual ? manual.body : execution?.response?.bodyPreview || manual?.body || '';
  return { execution, manual, responseText, source: useManual ? 'MANUAL_EXAMPLE' : execution ? 'ACTUAL_EXECUTION' : null };
}

function refreshDocumentationMetadata(request, executions = [], manualExamples = []) {
  const existing = request.documentation || {};
  const urlParts = documentationUrlParts(request.urlTemplate);
  const evidence = latestDocumentationEvidence(request, executions, manualExamples);
  const responseParsed = parseJsonSafely(evidence.responseText || '');
  const discoveredOutputs = responseParsed.ok
    ? inferStructuredDocumentationParameters(responseParsed.value, 'RESPONSE')
    : [];
  const headerParameters = mergeDocumentationParameters(existing.headerParameters, inferHeaderDocumentationParameters(request), 'HEADER');
  const inputParameters = mergeDocumentationParameters(existing.inputParameters, inferRequestDocumentationParameters(request), 'BODY');
  const outputParameters = evidence.responseText
    ? mergeDocumentationParameters(existing.outputParameters, discoveredOutputs, 'RESPONSE')
    : (existing.outputParameters || []).map((row, index) => normalizeDocumentationParameter(row, 'RESPONSE', index));
  const serviceIntroduction = String(existing.serviceIntroduction ?? existing.description ?? request.description ?? '');
  const documentRevision = String(existing.documentRevision || existing.version || request.semanticVersion || '1.0.0');
  const documentDate = String(existing.documentDate || nowIso().slice(0, 10));
  const metadata = {
    ...existing,
    title: sanitizeText(String(existing.title || request.name || 'Untitled API Request')),
    description: sanitizeText(String(existing.description ?? request.description ?? '')),
    serviceIntroduction: sanitizeText(serviceIntroduction),
    baseUrl: cleanDocumentationUrl(existing.baseUrl || urlParts.baseUrl),
    operationPath: cleanDocumentationUrl(existing.operationPath || urlParts.operationPath),
    endpoint: urlParts.endpoint,
    method: request.method,
    providerApplication: existing.providerApplication || request.applicationId,
    version: existing.version || documentRevision,
    documentRevision,
    organizationName: sanitizeText(String(existing.organizationName || DEFAULT_DOCUMENT_ORGANIZATION)),
    departmentName: sanitizeText(String(existing.departmentName || DEFAULT_DOCUMENT_DEPARTMENT)),
    documentDate,
    headerParameters,
    inputParameters,
    outputParameters,
    authenticationProfileId: existing.authenticationProfileId || undefined,
    authenticationDocumentation: normalizeAuthenticationDocumentation(existing.authenticationDocumentation, request, existing.authenticationProfileId),
    responseCodes: normalizeResponseCodes(existing.responseCodes),
    curlExample: sanitizeDocumentationCurl(existing.curlExample || ''),
    responseExample: sanitizeDocumentationResponseExample(existing.responseExample || '', outputParameters),
  };
  return metadata;
}

function requiredStatusLabel(value) {
  if (value === true) return 'بله';
  if (value === false) return 'خیر';
  return 'نامشخص';
}

function defaultGlobalVariables() {
  return [
    {
      id: makeId('var'),
      key: 'baseUrl',
      currentValue: 'https://api.example.com',
      initialValue: 'https://api.example.com',
      sensitive: false,
      scope: 'GLOBAL',
      description: 'Global API base URL fallback.',
    },
  ];
}

function defaultEnvironments() {
  const mkHeader = (name, value, order) => createHeader(name, value, order, 'ENVIRONMENT');
  const makeEnv = (id, name, kind, baseUrl, stage, productionProtected) => ({
    id,
    name,
    kind,
    baseUrl,
    variables: [
      { id: makeId('var'), key: 'stage', currentValue: stage, initialValue: stage, sensitive: false, scope: 'ENVIRONMENT', description: `${name} stage header.` },
      { id: makeId('var'), key: 'baseUrl', currentValue: baseUrl, initialValue: baseUrl, sensitive: false, scope: 'ENVIRONMENT', description: `${name} base URL.` },
    ],
    defaultHeaders: [mkHeader('prostage', '{{stage}}', 0), mkHeader('accept', 'application/json', 1)],
    secretReferences: {},
    productionProtected,
    archived: false,
    seeded: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  return [
    makeEnv('env-development', 'Development', 'DEVELOPMENT', 'https://dev.example.com', 'develop', false),
    makeEnv('env-test', 'Test', 'TEST', 'https://test.example.com', 'test', false),
    makeEnv('env-preprod', 'Pre-production', 'PRE_PRODUCTION', 'https://preprod.example.com', 'preprod', true),
    makeEnv('env-production', 'Production', 'PRODUCTION', 'https://api.example.com', 'production', true),
  ];
}

function defaultRunners() {
  return [
    { id: 'runner-public', name: 'Public Network Runner', networkZone: 'PUBLIC', allowedOriginPatterns: ['*'], enabled: true },
    { id: 'runner-internal', name: 'Internal Network Runner', networkZone: 'INTERNAL', allowedOriginPatterns: ['*'], enabled: true },
    { id: 'runner-restricted', name: 'Restricted Network Runner', networkZone: 'RESTRICTED', allowedOriginPatterns: ['*'], enabled: true },
    { id: 'runner-test', name: 'Test Network Runner', networkZone: 'TEST', allowedOriginPatterns: ['*'], enabled: true },
  ];
}

function defaultOrgPolicies() {
  return {
    privateDestinationAllowlist: [],
    dualApprovalProductionCommand: false,
    forbidInsecureTlsInProduction: true,
    forbidExactModeInProduction: true,
    maxPortalShareTtlHours: 168,
    allowAnonymousPortalShare: true,
    updatedAt: null,
    updatedBy: null,
  };
}

function defaultStore() {
  return {
    version: 2,
    collections: [],
    requests: [],
    executions: [],
    importedCurls: [],
    manualExamples: [],
    documentationResults: [],
    shareRequests: [],
    consumers: [],
    references: [],
    usageEvents: [],
    readReceipts: [],
    notifications: [],
    directoryUsers: [],
    directoryRoleAssignments: [],
    runtimeProfiles: [],
    discoverySnapshots: [],
    environments: defaultEnvironments(),
    runners: defaultRunners(),
    globalVariables: defaultGlobalVariables(),
    auditLog: [],
    testRuns: [],
    orgPolicies: defaultOrgPolicies(),
    dualApprovals: [],
    portalShareTokens: [],
    contractBaselines: [],
    executionQueue: [],
    zoneWorkerHeartbeat: null,
  };
}

function semanticVersionOf(request) {
  return String(request?.semanticVersion || request?.documentation?.version || '1.0.0');
}

function stableApiIdOf(request) {
  return String(request?.apiId || request?.sourceApiId || request?.id || makeId('api'));
}

function ensureRequestApiFields(request) {
  const apiId = stableApiIdOf(request);
  const semanticVersion = semanticVersionOf(request);
  const legacyDocumentation = {
    ...(request.documentation || {}),
    title: request.documentation?.title || request.name || 'Untitled API Request',
    description: request.documentation?.description || request.description || '',
    providerApplication: request.documentation?.providerApplication || request.applicationId,
    version: semanticVersion,
    changeHistory: request.documentation?.changeHistory?.length
      ? request.documentation.changeHistory
      : [{ version: semanticVersion, changedAt: request.createdAt || nowIso(), summary: 'Initial API Console request definition.' }],
  };
  const next = {
    ...request,
    apiId,
    semanticVersion,
    folderPath: Array.isArray(request.folderPath)
      ? request.folderPath.map(part => String(part || '').trim()).filter(Boolean)
      : [],
    visibility: request.visibility === 'PROJECT_SHARED' ? 'PROJECT_SHARED' : 'PRIVATE',
    coOwnerIds: Array.isArray(request.coOwnerIds)
      ? [...new Set(request.coOwnerIds.map(id => String(id || '').trim()).filter(Boolean))].slice(0, 5)
      : [],
    ownerId: request.ownerId || request.createdBy,
    runnerId: request.runnerId || undefined,
    breakingChange: request.breakingChange === true,
    migrationNote: request.migrationNote ? String(request.migrationNote) : undefined,
    sharingStatus: SHARE_STATUSES.has(request.sharingStatus) ? request.sharingStatus : 'DRAFT',
    sourceType: request.sourceType || 'ORIGINAL',
    originId: request.originId || 'default',
    documentation: legacyDocumentation,
  };
  next.documentation = refreshDocumentationMetadata(next);
  return next;
}

function normalizeStoreShape(raw) {
  const base = defaultStore();
  const next = {
    ...base,
    ...raw,
    collections: Array.isArray(raw.collections) ? raw.collections : [],
    requests: Array.isArray(raw.requests) ? raw.requests.map(ensureRequestApiFields) : [],
    executions: Array.isArray(raw.executions) ? raw.executions : [],
    importedCurls: Array.isArray(raw.importedCurls) ? raw.importedCurls : [],
    manualExamples: Array.isArray(raw.manualExamples) ? raw.manualExamples : [],
    documentationResults: Array.isArray(raw.documentationResults) ? raw.documentationResults : [],
    shareRequests: Array.isArray(raw.shareRequests) ? raw.shareRequests : [],
    consumers: Array.isArray(raw.consumers) ? raw.consumers : [],
    references: Array.isArray(raw.references) ? raw.references : [],
    usageEvents: Array.isArray(raw.usageEvents) ? raw.usageEvents : [],
    readReceipts: Array.isArray(raw.readReceipts) ? raw.readReceipts : [],
    notifications: Array.isArray(raw.notifications) ? raw.notifications : [],
    directoryUsers: Array.isArray(raw.directoryUsers) ? raw.directoryUsers : [],
    directoryRoleAssignments: Array.isArray(raw.directoryRoleAssignments) ? raw.directoryRoleAssignments : [],
    runtimeProfiles: Array.isArray(raw.runtimeProfiles)
      ? raw.runtimeProfiles.map(profile => ({ ...profile, originId: profile.originId || 'default' }))
      : [],
    discoverySnapshots: Array.isArray(raw.discoverySnapshots)
      ? raw.discoverySnapshots.map(snapshot => ({ ...snapshot, originId: snapshot.originId || 'default' }))
      : [],
    environments: (raw.environments?.length ? raw.environments : defaultEnvironments()).map(env => ({
      archived: false,
      ...env,
      seeded: Boolean(env.seeded) || ['env-development', 'env-test', 'env-preprod', 'env-production'].includes(env.id),
      variables: Array.isArray(env.variables) ? env.variables : [],
      defaultHeaders: Array.isArray(env.defaultHeaders) ? env.defaultHeaders : [],
      secretReferences: env.secretReferences && typeof env.secretReferences === 'object' ? env.secretReferences : {},
    })),
    runners: (raw.runners?.length ? raw.runners : defaultRunners()).map(runner => ({
      allowedOriginPatterns: Array.isArray(runner.allowedOriginPatterns) ? runner.allowedOriginPatterns : ['*'],
      enabled: runner.enabled !== false,
      ...runner,
    })),
    globalVariables: raw.globalVariables?.length ? raw.globalVariables : defaultGlobalVariables(),
    auditLog: Array.isArray(raw.auditLog) ? raw.auditLog : [],
    testRuns: Array.isArray(raw.testRuns) ? raw.testRuns : [],
    orgPolicies: {
      ...defaultOrgPolicies(),
      ...(raw.orgPolicies && typeof raw.orgPolicies === 'object' ? raw.orgPolicies : {}),
      privateDestinationAllowlist: Array.isArray(raw.orgPolicies?.privateDestinationAllowlist)
        ? raw.orgPolicies.privateDestinationAllowlist.map(item => String(item || '').trim()).filter(Boolean)
        : [],
      dualApprovalProductionCommand: raw.orgPolicies?.dualApprovalProductionCommand === true,
      forbidInsecureTlsInProduction: raw.orgPolicies?.forbidInsecureTlsInProduction !== false,
      forbidExactModeInProduction: raw.orgPolicies?.forbidExactModeInProduction !== false,
      maxPortalShareTtlHours: Number(raw.orgPolicies?.maxPortalShareTtlHours || 168),
      allowAnonymousPortalShare: raw.orgPolicies?.allowAnonymousPortalShare !== false,
    },
    dualApprovals: Array.isArray(raw.dualApprovals) ? raw.dualApprovals : [],
    portalShareTokens: Array.isArray(raw.portalShareTokens) ? raw.portalShareTokens : [],
    contractBaselines: Array.isArray(raw.contractBaselines) ? raw.contractBaselines : [],
    executionQueue: Array.isArray(raw.executionQueue) ? raw.executionQueue : [],
    zoneWorkerHeartbeat: raw.zoneWorkerHeartbeat || null,
    version: 2,
  };
  next.collections = next.collections.map(collection => ({
    visibility: collection.visibility === 'PROJECT_SHARED' ? 'PROJECT_SHARED' : 'PRIVATE',
    ...collection,
    originId: collection.originId || 'default',
  }));
  const knownRequestIds = new Set(next.requests.map(request => request.id));
  next.references = next.references.filter(reference => !reference.requestId || knownRequestIds.has(reference.requestId));
  return next;
}

function loadStoreFromFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    const next = normalizeStoreShape(defaultStore());
    saveStoreToFile(next);
    return next;
  }
  const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  return normalizeStoreShape(parsed);
}

function saveStoreToFile(nextStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(nextStore, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_FILE);
}

/**
 * Low-risk persistence entry: FILE keeps current JSON behavior; SQLITE loads
 * store_blob into the same in-memory shape; POSTGRES uses Prisma with async init.
 */
function loadStore() {
  if (STORE_BACKEND === 'POSTGRES') {
    activeStoreAdapter = createStoreAdapter({
      backend: 'POSTGRES',
      normalizeStore: normalizeStoreShape,
      defaultStore,
    });
    storeReady = false;
    return normalizeStoreShape(defaultStore());
  }
  if (STORE_BACKEND === 'SQLITE') {
    const { adapter, store: loaded } = loadStoreViaAdapter({
      backend: 'SQLITE',
      dataDir: DATA_DIR,
      sqliteFile: SQLITE_FILE,
      normalizeStore: normalizeStoreShape,
      defaultStore,
      loadStore: () => {
        if (fs.existsSync(STORE_FILE)) {
          return normalizeStoreShape(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')));
        }
        return normalizeStoreShape(defaultStore());
      },
    });
    activeStoreAdapter = adapter;
    storeReady = true;
    return loaded;
  }
  activeStoreAdapter = createStoreAdapter({
    backend: 'FILE',
    loadStore: loadStoreFromFile,
    saveStore: saveStoreToFile,
  });
  storeReady = true;
  return activeStoreAdapter.load();
}

function saveStore(nextStore) {
  if (activeStoreAdapter) {
    writeStoreViaAdapter(activeStoreAdapter, nextStore);
    return;
  }
  saveStoreToFile(nextStore);
}

async function initializeStore() {
  if (STORE_BACKEND === 'POSTGRES' && activeStoreAdapter && typeof activeStoreAdapter.loadAsync === 'function') {
    store = await activeStoreAdapter.loadAsync();
    if (typeof activeStoreAdapter.recordLoginEvent === 'function') {
      registerLoginEventRecorder(event => activeStoreAdapter.recordLoginEvent(event));
    }
  }
  registerDirectoryProvider(() => ({
    directoryUsers: store.directoryUsers || [],
    directoryRoleAssignments: store.directoryRoleAssignments || [],
  }));
  registerLocalAuthStore({
    getStore: () => store,
    saveStore,
    audit,
    makeId,
    directoryUserView,
    USER_ROLES,
    systemAdministratorCount,
  });
  storeReady = true;
  startObjectStoreCleanupInterval();
  return store;
}

function isStoreReady() {
  return storeReady;
}

let store = loadStore();
registerDirectoryProvider(() => ({
  directoryUsers: store.directoryUsers || [],
  directoryRoleAssignments: store.directoryRoleAssignments || [],
}));
registerLocalAuthStore({
  getStore: () => store,
  saveStore,
  audit,
  makeId,
  directoryUserView,
  USER_ROLES,
  systemAdministratorCount,
});
if (STORE_BACKEND !== 'POSTGRES') storeReady = true;

const tryHandlePhase2 = createPhase2Router({
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
  contextApplicationIds,
  matchesApplicationScope,
  paginate,
  audit,
  notifyUser,
  saveStore,
  getStore: () => store,
  setStoreField: (key, value) => { store[key] = value; },
  belongsToUser,
  ensureRequestApiFields,
  protectRequestSecrets,
  semanticVersionOf,
  consumersForVersion,
  executeRequest: (...args) => executeRequest(...args),
  findEnvironment,
  assertCanReviewShares,
});

const tryHandlePhase3 = createPhase3Router({
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
  getStore: () => store,
  setStoreField: (key, value) => { store[key] = value; },
  belongsToUser,
  semanticVersionOf,
  consumersForVersion,
  findEnvironment,
  assertCanReviewShares,
  DATA_DIR,
  DOCX_TEMPLATE_FILE,
  generateDocumentationMarkdown,
  buildDocxFromTemplate,
  docxFileName,
});

const tryHandleSharing = createSharingRouter({
  ApiConsoleError,
  makeId,
  nowIso,
  safeClone,
  requireContext,
  assertCanReviewShares,
  matchesApplicationScope,
  paginate,
  audit,
  notifyUser,
  saveStore,
  getStore: () => store,
  consumersForVersion,
  normalizeConsumers: (...args) => normalizeConsumers(...args),
  deliverItsmWebhook,
});

const tryHandleRuntimeHttp = createRuntimeHttpRouter({
  ApiConsoleError,
  makeId,
  nowIso,
  safeClone,
  requireContext,
  assertCsrf,
  requireSession,
  getStore: () => store,
  saveStore,
  audit,
  assertRuntimeProjectAccess: (...args) => assertRuntimeProjectAccess(...args),
  ensureDefaultRuntimeProfiles: (...args) => ensureDefaultRuntimeProfiles(...args),
  resolveListOriginFilter: (...args) => resolveListOriginFilter(...args),
  matchesOriginId: (...args) => matchesOriginId(...args),
  runtimeProfileView: (...args) => runtimeProfileView(...args),
  findRuntimeProfile: (...args) => findRuntimeProfile(...args),
  runtimeSessionIdentity: (...args) => runtimeSessionIdentity(...args),
  getRuntimeSession,
  deleteRuntimeSession,
  setRuntimeSession,
  publicRuntimeStatus,
  startRuntimeLogin,
  finishRuntimeLogin,
  normalizeCdeLoginName,
  promoteRuntimeProfile: (...args) => promoteRuntimeProfile(...args),
  canManageDevelopmentRuntimeProfiles: (...args) => canManageDevelopmentRuntimeProfiles(...args),
  assertSystemAdministrator: (...args) => assertSystemAdministrator(...args),
  runtimeProfileMutationInput: (...args) => runtimeProfileMutationInput(...args),
  createRuntimeProfilesFromInput: (...args) => createRuntimeProfilesFromInput(...args),
  normalizeRuntimeProfileInput: (...args) => normalizeRuntimeProfileInput(...args),
  assertCanManageRuntimeProfile: (...args) => assertCanManageRuntimeProfile(...args),
  validateRuntimeOrigin,
  latestDiscovery: (...args) => latestDiscovery(...args),
  runtimeOpenApiDocument: (...args) => runtimeOpenApiDocument(...args),
  runtimeDocsHtml: (...args) => runtimeDocsHtml(...args),
  buildRuntimePostmanCollection: (...args) => buildRuntimePostmanCollection(...args),
  buildRuntimeCurlExport: (...args) => buildRuntimeCurlExport(...args),
  executeRuntimeDiscoveredOperation: (...args) => executeRuntimeDiscoveredOperation(...args),
});

function audit(eventType, actor, details = {}) {
  store.auditLog.unshift({
    id: makeId('audit'),
    eventType,
    actorUserId: actor?.userId || actor?.id || 'anonymous',
    actorRole: actor?.role || 'UNKNOWN',
    originId: actor?.cdeOriginId || details.originId || undefined,
    details: JSON.parse(JSON.stringify({
      ...details,
      ...(actor?.cdeOriginId ? { originId: actor.cdeOriginId } : {}),
    }, (_, value) => typeof value === 'string' ? sanitizeText(value) : value)),
    createdAt: nowIso(),
  });
  store.auditLog = store.auditLog.slice(0, 500);
}

function sanitizeObject(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'string' ? sanitizeText(item) : item));
}

function trackDirectoryContext(context) {
  if (!context?.userId) return false;
  let changed = false;
  const fullName = context.user?.fullName || context.userName || context.userId;
  const userIndex = store.directoryUsers.findIndex(user => user.id === context.userId);
  const user = {
    id: context.userId,
    fullName,
    email: context.user?.email,
    phoneNumber: context.user?.phoneNumber,
    source: context.authApproach || context.identitySource || 'CDE',
    isActive: context.user?.isActive !== false,
  };
  if (userIndex >= 0) {
    const current = store.directoryUsers[userIndex];
    const profileChanged = Object.entries(user).some(([key, value]) => current[key] !== value);
    if (profileChanged) {
      store.directoryUsers[userIndex] = { ...current, ...user, updatedAt: nowIso() };
      changed = true;
    }
  } else {
    store.directoryUsers.unshift({ ...user, createdAt: nowIso(), updatedAt: nowIso() });
    changed = true;
  }

  // Never elevate from client/session-claimed role. Only ensure a SESSION_SYNC DEVELOPER
  // membership exists so consumer directories can discover synced CDE users.
  if (context.applicationId) {
    const appIds = context.scopeApplicationIds?.length ? context.scopeApplicationIds : [context.applicationId];
    appIds.forEach(applicationId => {
      const exists = store.directoryRoleAssignments.some(item =>
        item.userId === context.userId &&
        item.role === 'DEVELOPER' &&
        item.applicationId === applicationId &&
        item.isActive !== false
      );
      if (!exists) {
        store.directoryRoleAssignments.unshift({
          id: makeId('dir-role'),
          userId: context.userId,
          role: 'DEVELOPER',
          applicationId,
          isActive: true,
          source: 'SESSION_SYNC',
          createdAt: nowIso(),
        });
        changed = true;
      }
    });
  }
  return changed;
}

function assertSystemAdministrator(context) {
  if (!roleAllowed(context.role, API_CONSOLE_POLICY.canManageUsers)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only System Administrators can manage users.', 403);
  }
}

function assertCanReviewShares(context) {
  if (!roleAllowed(context.role, API_CONSOLE_POLICY.canReviewShares)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to review shared API requests.', 403);
  }
}

function activeRolesForDirectoryUser(userId) {
  return Array.from(new Set(store.directoryRoleAssignments
    .filter(assignment =>
      assignment.userId === userId &&
      assignment.isActive !== false &&
      (
        (assignment.role === 'SYSTEM_ADMIN' && assignment.source === 'ADMIN_APPROVAL') ||
        (assignment.role !== 'SYSTEM_ADMIN' && assignment.role !== 'DEVELOPER' && assignment.source === 'ADMIN_APPROVAL') ||
        (assignment.role === 'DEVELOPER' && (assignment.source === 'SESSION_SYNC' || assignment.source === 'ADMIN_APPROVAL'))
      )
    )
    .map(assignment => assignment.role)
    .filter(role => USER_ROLES.includes(role))));
}

function activeRoleAssignmentsForDirectoryUser(userId) {
  return (Array.isArray(store.directoryRoleAssignments) ? store.directoryRoleAssignments : [])
    .filter(assignment =>
      assignment.userId === userId &&
      assignment.isActive !== false &&
      (
        (assignment.role === 'SYSTEM_ADMIN' && assignment.source === 'ADMIN_APPROVAL') ||
        (assignment.role !== 'SYSTEM_ADMIN' && assignment.role !== 'DEVELOPER' && assignment.source === 'ADMIN_APPROVAL') ||
        (assignment.role === 'DEVELOPER' && (assignment.source === 'SESSION_SYNC' || assignment.source === 'ADMIN_APPROVAL'))
      ) &&
      USER_ROLES.includes(assignment.role)
    )
    .map(assignment => ({
      id: assignment.id,
      role: assignment.role,
      applicationId: assignment.applicationId || 'ALL',
      source: assignment.source,
    }));
}

function directoryUserView(user) {
  const roles = activeRolesForDirectoryUser(user.id);
  const roleAssignments = activeRoleAssignmentsForDirectoryUser(user.id);
  const bootstrapLogin = user.phoneNumber || user.username || '';
  const bootstrapAdmin = isBootstrapSystemAdmin(bootstrapLogin);
  const bootstrapQaLead = loginListIncludes(process.env.API_CONSOLE_QA_LEAD_LOGINS, bootstrapLogin);
  if (bootstrapAdmin && !roles.includes('SYSTEM_ADMIN')) roles.unshift('SYSTEM_ADMIN');
  if (bootstrapQaLead && !roles.includes('QA_LEAD') && !roles.includes('SYSTEM_ADMIN')) roles.push('QA_LEAD');
  if (!roles.length) roles.push('DEVELOPER');
  const {
    passwordHash: _passwordHash,
    ...safeUser
  } = user;
  return {
    ...safeUser,
    source: user.source || 'CDE',
    username: user.username || null,
    hasPassword: Boolean(user.passwordHash),
    lastLoginAt: user.lastLoginAt || null,
    passwordUpdatedAt: user.passwordUpdatedAt || null,
    roles: Array.from(new Set(roles)),
    roleAssignments,
    isSystemAdmin: bootstrapAdmin || roles.includes('SYSTEM_ADMIN'),
    isBootstrapAdmin: bootstrapAdmin,
    isBootstrapQaLead: bootstrapQaLead,
  };
}

function systemAdministratorCount() {
  const users = store.directoryUsers.filter(user => user.isActive !== false);
  return users.filter(user => directoryUserView(user).isSystemAdmin).length;
}

function setManagedSystemAdministrator(userId, enabled, context) {
  assertSystemAdministrator(context);
  const user = store.directoryUsers.find(item => item.id === userId && item.isActive !== false);
  if (!user) throw new ApiConsoleError('INVALID_URL', 'CDE directory user not found.', 404);
  if (!enabled && isBootstrapSystemAdmin(user.phoneNumber)) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Bootstrap System Administrator access is controlled by API_CONSOLE_ADMIN_LOGINS.', 409);
  }
  if (!enabled && directoryUserView(user).isSystemAdmin && systemAdministratorCount() <= 1) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'At least one active System Administrator must remain.', 409);
  }

  const assignments = store.directoryRoleAssignments.filter(assignment =>
    assignment.userId === user.id && assignment.role === 'SYSTEM_ADMIN'
  );
  const changedAt = nowIso();
  if (enabled) {
    const approvedActive = assignments.find(assignment =>
      assignment.isActive !== false && assignment.source === 'ADMIN_APPROVAL'
    );
    if (!approvedActive) {
      const reusable = assignments[0];
      if (reusable) {
        reusable.isActive = true;
        reusable.applicationId = 'ALL';
        reusable.scope = 'APP';
        reusable.source = 'ADMIN_APPROVAL';
        reusable.updatedAt = changedAt;
        reusable.updatedBy = context.userId;
      } else {
        store.directoryRoleAssignments.unshift({
          id: makeId('dir-role'),
          userId: user.id,
          role: 'SYSTEM_ADMIN',
          applicationId: 'ALL',
          scope: 'APP',
          isActive: true,
          source: 'ADMIN_APPROVAL',
          createdAt: changedAt,
          createdBy: context.userId,
        });
      }
    }
  } else {
    assignments.forEach(assignment => {
      assignment.isActive = false;
      assignment.updatedAt = changedAt;
      assignment.updatedBy = context.userId;
    });
  }
  audit(enabled ? 'SYSTEM_ADMIN_GRANTED' : 'SYSTEM_ADMIN_REVOKED', context, {
    targetUserId: user.id,
    targetUserName: user.fullName,
  });
  saveStore(store);
  return directoryUserView(user);
}

function setManagedDirectoryRole(userId, role, enabled, context, options = {}) {
  assertSystemAdministrator(context);
  const normalizedRole = String(role || '').trim();
  if (!USER_ROLES.includes(normalizedRole)) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Unsupported directory role.', 422);
  }
  if (normalizedRole === 'SYSTEM_ADMIN') {
    return setManagedSystemAdministrator(userId, enabled, context);
  }
  if (normalizedRole === 'DEVELOPER' && !enabled) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'DEVELOPER is the default role and cannot be revoked from the directory UI.', 409);
  }

  const user = store.directoryUsers.find(item => item.id === userId && item.isActive !== false);
  if (!user) throw new ApiConsoleError('INVALID_URL', 'CDE directory user not found.', 404);
  if (normalizedRole === 'QA_LEAD' && !enabled && loginListIncludes(process.env.API_CONSOLE_QA_LEAD_LOGINS, user.phoneNumber)) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Bootstrap QA Lead access is controlled by API_CONSOLE_QA_LEAD_LOGINS.', 409);
  }

  const requestedApps = normalizeRoleApplicationIds(options.applicationIds ?? options.applicationId);
  const explicitApplicationScope = options.applicationId != null || options.applicationIds != null;
  const assignments = store.directoryRoleAssignments.filter(assignment =>
    assignment.userId === user.id && assignment.role === normalizedRole
  );
  const changedAt = nowIso();
  if (enabled) {
    requestedApps.forEach(applicationId => {
      const approvedActive = assignments.find(assignment =>
        assignment.isActive !== false &&
        assignment.source === 'ADMIN_APPROVAL' &&
        String(assignment.applicationId || 'ALL') === applicationId
      );
      if (approvedActive) return;
      const reusable = assignments.find(assignment =>
        assignment.source === 'ADMIN_APPROVAL' &&
        String(assignment.applicationId || 'ALL') === applicationId
      ) || assignments.find(assignment => assignment.source === 'ADMIN_APPROVAL' && assignment.isActive === false);
      if (reusable && reusable.source === 'ADMIN_APPROVAL') {
        reusable.isActive = true;
        reusable.applicationId = applicationId;
        reusable.scope = 'APP';
        reusable.source = 'ADMIN_APPROVAL';
        reusable.updatedAt = changedAt;
        reusable.updatedBy = context.userId;
      } else {
        store.directoryRoleAssignments.unshift({
          id: makeId('dir-role'),
          userId: user.id,
          role: normalizedRole,
          applicationId,
          scope: 'APP',
          isActive: true,
          source: 'ADMIN_APPROVAL',
          createdAt: changedAt,
          createdBy: context.userId,
        });
      }
    });
  } else {
    assignments
      .filter(assignment => assignment.source === 'ADMIN_APPROVAL')
      .filter(assignment => !explicitApplicationScope || requestedApps.includes(String(assignment.applicationId || 'ALL')))
      .forEach(assignment => {
        assignment.isActive = false;
        assignment.updatedAt = changedAt;
        assignment.updatedBy = context.userId;
      });
  }
  audit(enabled ? 'DIRECTORY_ROLE_GRANTED' : 'DIRECTORY_ROLE_REVOKED', context, {
    targetUserId: user.id,
    targetUserName: user.fullName,
    role: normalizedRole,
    applicationIds: requestedApps,
  });
  saveStore(store);
  return directoryUserView(user);
}

function normalizeRoleApplicationIds(value) {
  if (Array.isArray(value)) {
    const ids = value.map(item => String(item || '').trim()).filter(Boolean);
    return ids.length ? Array.from(new Set(ids)) : ['ALL'];
  }
  const single = String(value || '').trim();
  return [single || 'ALL'];
}

function notifyUser(userId, title, message, entityType, entityId, correlationId) {
  if (!userId) return;
  store.notifications.unshift({
    id: makeId('notif'),
    userId,
    title,
    message: sanitizeText(message),
    type: 'INFO',
    entityType,
    entityId,
    channels: ['IN_APP'],
    deliveryStatus: 'QUEUED',
    correlationId,
    isRead: false,
    createdAt: nowIso(),
  });
  store.notifications = store.notifications.slice(0, 1000);
}

function parseSemVer(value) {
  const text = String(value || '').trim();
  if (!SEMVER_REGEX.test(text)) return null;
  const [main, prerelease = ''] = text.split('+')[0].split('-');
  const [major, minor, patch] = main.split('.').map(Number);
  return { major, minor, patch, prerelease };
}

function compareSemVer(a, b) {
  const left = parseSemVer(a);
  const right = parseSemVer(b);
  if (!left || !right) return String(a || '').localeCompare(String(b || ''));
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && right.prerelease) return 1;
  return left.prerelease.localeCompare(right.prerelease);
}

function requireSemVerGreater(nextVersion, currentVersion) {
  if (!SEMVER_REGEX.test(String(nextVersion || '').trim())) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'فرمت نسخه معتبر نیست. نسخه باید مطابق Semantic Versioning باشد.');
  }
  if (compareSemVer(nextVersion, currentVersion) <= 0) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'نسخه جدید باید از نسخه فعلی بزرگ‌تر باشد.');
  }
}

function consumersForVersion(apiId, version) {
  return store.consumers.filter(consumer =>
    consumer.apiId === apiId &&
    consumer.version === version &&
    consumer.status !== 'REVOKED'
  );
}

function normalizeConsumers(consumers, request, context) {
  return (consumers || [])
    .map(item => ({
      id: item.id || makeId('api-consumer'),
      apiId: request.apiId,
      version: semanticVersionOf(request),
      consumerType: item.consumerType,
      userId: item.consumerType === 'USER' ? item.userId : undefined,
      roleKey: item.consumerType === 'ROLE' ? item.roleKey : undefined,
      applicationId: item.applicationId || request.applicationId,
      status: 'ACTIVE',
      createdBy: item.createdBy || context.userId,
      createdAt: item.createdAt || nowIso(),
      updatedBy: context.userId,
      updatedAt: nowIso(),
    }))
    .filter(item =>
      (item.consumerType === 'USER' && item.userId) ||
      (item.consumerType === 'ROLE' && item.roleKey)
    );
}

function consumerMatchesContext(consumer, context) {
  const scope = context.scopeApplicationIds?.length ? context.scopeApplicationIds : [context.applicationId];
  const inScope = !consumer.applicationId || consumer.applicationId === 'ALL' || scope.includes(consumer.applicationId);
  if (!inScope) return false;
  if (consumer.consumerType === 'USER') return consumer.userId === context.userId;
  if (consumer.consumerType === 'ROLE') return consumer.roleKey === context.role;
  return false;
}

function canAccessRepositoryRequest(request, context) {
  if (!context) return false;
  if (context.role === 'SYSTEM_ADMIN') return true;
  if (request.createdBy === context.userId) return true;
  if (context.role === 'QA_LEAD' && matchesApplicationScope(request.applicationId, context.scopeApplicationIds || context.applicationId)) return true;
  return consumersForVersion(request.apiId, semanticVersionOf(request)).some(consumer => consumerMatchesContext(consumer, context));
}

function latestApprovedVersion(apiId) {
  return store.requests
    .filter(request => request.apiId === apiId && request.sharingStatus === 'APPROVED' && request.sourceType !== 'REFERENCE')
    .sort((a, b) => compareSemVer(semanticVersionOf(b), semanticVersionOf(a)))[0] || null;
}

function readReceiptFor(context, apiId, version) {
  return store.readReceipts.find(item => item.userId === context.userId && item.apiId === apiId && item.version === version);
}

function repositoryItemFromRequest(request, context) {
  const version = semanticVersionOf(request);
  const latest = latestApprovedVersion(request.apiId);
  const receipt = readReceiptFor(context, request.apiId, version);
  const activeReference = store.references.find(reference =>
    reference.createdBy === context.userId &&
    reference.apiId === request.apiId &&
    reference.version === version &&
    reference.status === 'ACTIVE'
  );
  return {
    id: `${request.apiId}:${version}`,
    apiId: request.apiId,
    requestId: request.id,
    title: request.name,
    description: request.description || request.documentation?.description || '',
    applicationId: request.applicationId,
    version,
    method: request.method,
    urlTemplate: request.urlTemplate,
    classification: request.classification,
    sharingStatus: request.sharingStatus,
    ownerId: request.createdBy,
    approvedAt: request.approvedAt,
    consumers: consumersForVersion(request.apiId, version),
    referenceId: activeReference?.id,
    referenceRequestId: activeReference?.requestId,
    hasNewerVersion: !!latest && compareSemVer(semanticVersionOf(latest), version) > 0,
    latestVersion: latest ? semanticVersionOf(latest) : version,
    isNewForUser: !!receipt && !receipt.viewedAt,
    changeLog: request.documentation?.changeHistory?.slice(-1)[0]?.summary || '',
    breakingChange: request.breakingChange === true,
    migrationNote: request.migrationNote || '',
    deprecationReason: request.deprecationReason || '',
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function logUsageEvent(eventType, context, request, extra = {}) {
  if (!USAGE_EVENT_TYPES.has(eventType) || !request) return;
  const event = {
    id: makeId('api-usage'),
    eventType,
    userId: context.userId,
    userDisplayName: context.user?.fullName || context.userName || context.userId,
    activeRole: context.role,
    applicationId: request.applicationId,
    apiId: request.apiId,
    apiTitle: request.name,
    version: semanticVersionOf(request),
    referenceId: request.referenceId || extra.referenceId,
    eventAt: nowIso(),
    environmentId: extra.environmentId,
    correlationId: extra.correlationId,
  };
  store.usageEvents.unshift(event);
  store.usageEvents = store.usageEvents.slice(0, 5000);
}

function buildShareSnapshot(request, context) {
  const environment = findEnvironment(request.environmentId);
  const resolved = resolveRequest(request, environment, request.executionMode).snapshot;
  const documentation = generateDocumentationMarkdown(request, store.executions, store.manualExamples, context.user?.fullName || context.userId);
  return sanitizeObject({
    requestId: request.id,
    apiId: request.apiId,
    version: semanticVersionOf(request),
    title: request.name,
    description: request.description || '',
    applicationId: request.applicationId,
    method: request.method,
    url: request.urlTemplate,
    queryParameters: request.queryParameters,
    headers: request.headers,
    cookies: request.cookies,
    requestBody: requestBodyFromDefinition(request),
    authentication: request.authentication,
    tls: request.tls,
    environmentId: request.environmentId,
    classification: request.classification,
    effectiveRequest: resolved,
    assertions: request.assertions,
    scripts: request.scripts,
    documentation: request.documentation,
    documentationPreview: documentation.markdown,
    generatedCurl: exportRequestAsCurl(request, 'bash'),
    executionEvidence: store.executions.filter(execution => execution.requestId === request.id).slice(0, 5),
    manualResponses: store.manualExamples.filter(example => example.requestId === request.id),
    capturedAt: nowIso(),
  });
}

function findEnvironment(id) {
  return store.environments.find(item => item.id === id && item.archived !== true) || store.environments.find(item => item.archived !== true) || store.environments[0];
}

function listActiveEnvironments() {
  return store.environments.filter(item => item.archived !== true);
}

function assertCanMutateEnvironment(context, environment, creating = false) {
  if (!roleAllowed(context.role, API_CONSOLE_POLICY.canManageEnvironments)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to manage environments.', 403);
  }
  const protectedEnv = creating
    ? Boolean(environment?.productionProtected) || ['PRE_PRODUCTION', 'PRODUCTION'].includes(environment?.kind)
    : Boolean(environment?.productionProtected) || environment?.kind === 'PRODUCTION' || environment?.kind === 'PRE_PRODUCTION';
  if (protectedEnv && !roleAllowed(context.role, API_CONSOLE_POLICY.canManageProtectedEnvironments)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Protected environments require System Admin, Tech Lead or QA Lead.', 403);
  }
}

function normalizeEnvironmentInput(data = {}, existing = null) {
  const kind = String(data.kind || existing?.kind || 'CUSTOM').toUpperCase();
  const allowedKinds = ['DEVELOPMENT', 'TEST', 'PRE_PRODUCTION', 'PRODUCTION', 'CUSTOM'];
  if (!allowedKinds.includes(kind)) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Unsupported environment kind.', 422);
  }
  const name = String(data.name || existing?.name || '').trim();
  if (!name) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Environment name is required.', 422);
  const baseUrl = String(data.baseUrl || existing?.baseUrl || '').trim();
  if (!baseUrl) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Environment baseUrl is required.', 422);
  const productionProtected = data.productionProtected != null
    ? data.productionProtected === true
    : Boolean(existing?.productionProtected) || kind === 'PRODUCTION' || kind === 'PRE_PRODUCTION';
  const variables = Array.isArray(data.variables)
    ? data.variables.map((item, index) => ({
      id: item.id || makeId('var'),
      key: String(item.key || '').trim(),
      currentValue: String(item.currentValue ?? ''),
      initialValue: item.initialValue != null ? String(item.initialValue) : String(item.currentValue ?? ''),
      sensitive: item.sensitive === true,
      scope: 'ENVIRONMENT',
      description: String(item.description || ''),
      displayOrder: index,
    })).filter(item => item.key)
    : (existing?.variables || []);
  const defaultHeaders = Array.isArray(data.defaultHeaders)
    ? data.defaultHeaders.map((item, index) => createHeader(
      String(item.name || ''),
      String(item.valueTemplate || item.value || ''),
      index,
      'ENVIRONMENT'
    )).filter(item => item.name)
    : (existing?.defaultHeaders || []);
  const secretReferences = data.secretReferences && typeof data.secretReferences === 'object'
    ? Object.fromEntries(Object.entries(data.secretReferences).map(([key, value]) => [String(key), String(value)]))
    : (existing?.secretReferences || {});
  return {
    name,
    kind,
    baseUrl,
    variables,
    defaultHeaders,
    secretReferences,
    productionProtected,
    authenticationDocumentationProfileId: data.authenticationDocumentationProfileId || existing?.authenticationDocumentationProfileId,
  };
}

function createEnvironment(data, context) {
  const normalized = normalizeEnvironmentInput(data);
  assertCanMutateEnvironment(context, normalized, true);
  if (listActiveEnvironments().some(item => item.name.toLowerCase() === normalized.name.toLowerCase())) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'An environment with this name already exists.', 409);
  }
  const environment = {
    id: makeId('env'),
    ...normalized,
    archived: false,
    seeded: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: context.userId,
  };
  store.environments.unshift(environment);
  audit('ENVIRONMENT_CREATED', context, { environmentId: environment.id, name: environment.name, kind: environment.kind });
  saveStore(store);
  return environment;
}

function updateEnvironment(id, data, context) {
  const environment = store.environments.find(item => item.id === id);
  if (!environment || environment.archived) throw new ApiConsoleError('INVALID_URL', 'Environment not found.', 404);
  assertCanMutateEnvironment(context, environment);
  const normalized = normalizeEnvironmentInput(data, environment);
  assertCanMutateEnvironment(context, normalized, true);
  Object.assign(environment, normalized, { updatedAt: nowIso(), updatedBy: context.userId });
  audit('ENVIRONMENT_UPDATED', context, { environmentId: environment.id, name: environment.name });
  saveStore(store);
  return environment;
}

function cloneEnvironment(id, context) {
  const source = store.environments.find(item => item.id === id);
  if (!source || source.archived) throw new ApiConsoleError('INVALID_URL', 'Environment not found.', 404);
  assertCanMutateEnvironment(context, { ...source, productionProtected: false, kind: source.kind === 'PRODUCTION' ? 'CUSTOM' : source.kind }, true);
  const baseName = `${source.name} Copy`;
  let name = baseName;
  let suffix = 2;
  while (listActiveEnvironments().some(item => item.name.toLowerCase() === name.toLowerCase())) {
    name = `${baseName} ${suffix}`;
    suffix += 1;
  }
  const cloned = {
    id: makeId('env'),
    name,
    kind: source.kind === 'PRODUCTION' || source.kind === 'PRE_PRODUCTION' ? 'CUSTOM' : source.kind,
    baseUrl: source.baseUrl,
    variables: (source.variables || []).map(variable => ({
      ...safeClone(variable),
      id: makeId('var'),
      currentValue: variable.sensitive ? '' : variable.currentValue,
      initialValue: variable.sensitive ? '' : (variable.initialValue || variable.currentValue),
    })),
    defaultHeaders: safeClone(source.defaultHeaders || []),
    secretReferences: {},
    productionProtected: false,
    archived: false,
    seeded: false,
    clonedFrom: source.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: context.userId,
  };
  store.environments.unshift(cloned);
  audit('ENVIRONMENT_CLONED', context, { environmentId: cloned.id, sourceEnvironmentId: source.id, name: cloned.name });
  saveStore(store);
  return cloned;
}

function archiveEnvironment(id, context, { force = false } = {}) {
  const environment = store.environments.find(item => item.id === id);
  if (!environment || environment.archived) throw new ApiConsoleError('INVALID_URL', 'Environment not found.', 404);
  assertCanMutateEnvironment(context, environment);
  if (environment.seeded && !force) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Seeded environments require force=true to archive.', 409);
  }
  const inUse = store.requests.some(request => request.environmentId === id && request.status !== 'ARCHIVED');
  if (inUse && !force) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Environment is in use by one or more requests. Pass force=true to archive anyway.', 409);
  }
  environment.archived = true;
  environment.updatedAt = nowIso();
  environment.updatedBy = context.userId;
  audit('ENVIRONMENT_ARCHIVED', context, { environmentId: environment.id, name: environment.name, forced: Boolean(force), inUse });
  saveStore(store);
  return environment;
}

function selectRunner(environment, resolvedAddress, preferredRunnerId, requestUrl) {
  const preferredId = preferredRunnerId || environment?.runnerId;
  let runner;
  if (preferredId) {
    runner = store.runners.find(item => item.id === preferredId);
    if (!runner || runner.enabled === false) {
      throw new ApiConsoleError('DESTINATION_NOT_ALLOWED', 'Runner zone انتخاب‌شده در دسترس نیست یا غیرفعال است.', 409);
    }
  } else if (resolvedAddress && isPrivateNetworkAddress(resolvedAddress)) {
    runner = store.runners.find(item => item.networkZone === 'INTERNAL' && item.enabled !== false) || store.runners[0];
  } else if (environment.kind === 'PRODUCTION') {
    runner = store.runners.find(item => item.networkZone === 'RESTRICTED' && item.enabled !== false) || store.runners[0];
  } else if (environment.kind === 'TEST') {
    runner = store.runners.find(item => item.networkZone === 'TEST' && item.enabled !== false) || store.runners[0];
  } else {
    runner = store.runners.find(item => item.networkZone === 'PUBLIC' && item.enabled !== false) || store.runners[0];
  }
  if (!runner || runner.enabled === false) {
    throw new ApiConsoleError('DESTINATION_NOT_ALLOWED', 'هیچ Runner Zone فعالی برای این محیط در دسترس نیست.', 409);
  }
  const patterns = Array.isArray(runner.allowedOriginPatterns) ? runner.allowedOriginPatterns : ['*'];
  if (requestUrl && patterns.length && !patterns.includes('*')) {
    let hostname = '';
    try { hostname = new URL(requestUrl).hostname.toLowerCase(); } catch {}
    const allowed = patterns.some(pattern => {
      const normalized = String(pattern || '').toLowerCase();
      if (!normalized) return false;
      if (normalized.startsWith('*.')) return hostname === normalized.slice(2) || hostname.endsWith(normalized.slice(1));
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
    if (!allowed) {
      throw new ApiConsoleError('DESTINATION_NOT_ALLOWED', `مقصد خارج از allowedOriginPatterns برای Runner «${runner.name}» است.`, 409);
    }
  }
  return runner;
}

function parseApplicationScope(value) {
  if (!value || value === 'ALL') return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed === 'ALL') return undefined;
  } catch {}
  if (String(value).includes(',')) return String(value).split(',').map(item => item.trim()).filter(Boolean);
  return [String(value)];
}

function matchesApplicationScope(applicationId, scopeValue) {
  const ids = parseApplicationScope(scopeValue);
  if (!ids || !ids.length) return true;
  return ids.includes(applicationId);
}

const PERSONAL_APPLICATION_ID = 'PERSONAL';

function contextApplicationIds(context) {
  const ids = Array.isArray(context?.scopeApplicationIds)
    ? context.scopeApplicationIds
    : parseApplicationScope(context?.scopeApplicationIds);
  let scoped = [];
  if (ids?.length) scoped = [...new Set(ids.map(String).filter(id => id && id !== 'ALL'))];
  else if (context?.applicationId && context.applicationId !== 'ALL') scoped = [String(context.applicationId)];
  // Free-form / personal collections are always in scope for the signed-in user.
  return [...new Set([...scoped, PERSONAL_APPLICATION_ID])];
}

function assertApplicationInContext(applicationId, context) {
  const normalized = String(applicationId || '').trim();
  if (!normalized || normalized === 'ALL' || normalized.includes(',')) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'انتخاب یک سامانه معتبر الزامی است.', 422);
  }
  // Free-form / Postman-like collections are always allowed for authenticated users.
  if (normalized.toUpperCase() === PERSONAL_APPLICATION_ID) return PERSONAL_APPLICATION_ID;
  // IS systems discovered after login may not yet be in the initial session project list.
  if ((context.authApproach === 'IS' || context.identitySource === 'IS') && normalized.startsWith('is:')) {
    return normalized;
  }
  if (!contextApplicationIds(context).includes(normalized)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'سامانه خارج از محدوده دسترسی فعال است.', 403);
  }
  return normalized;
}

function belongsToUser(entity, context) {
  if (!context?.userId) return true;
  if (entity.ownerId === context.userId || entity.createdBy === context.userId) return true;
  if ((entity.coOwnerIds || []).includes(context.userId)) return true;
  if (entity.visibility === 'PROJECT_SHARED') {
    const appId = String(entity.applicationId || '').trim();
    if (appId && contextApplicationIds(context).includes(appId)) return true;
  }
  return false;
}

function resolveOriginId(context) {
  return String(context?.cdeOriginId || 'default');
}

function resolveListOriginFilter(context, parsedUrl) {
  const queryOrigin = String(parsedUrl?.searchParams?.get('originId') || '').trim();
  if (context?.role === 'SYSTEM_ADMIN' && queryOrigin.toUpperCase() === 'ALL') return null;
  if (context?.role === 'SYSTEM_ADMIN' && queryOrigin) return queryOrigin;
  return resolveOriginId(context);
}

function matchesOriginId(entity, originFilter) {
  if (originFilter == null) return true;
  return String(entity?.originId || 'default') === String(originFilter);
}

function runnerHostTag() {
  return process.env.API_CONSOLE_RUNNER_HOST || os.hostname();
}

function reloadStoreFromDisk() {
  if (STORE_BACKEND === 'POSTGRES') {
    if (activeStoreAdapter && typeof activeStoreAdapter.loadAsync === 'function') {
      activeStoreAdapter.loadAsync().then(loaded => {
        store = loaded;
      }).catch(() => undefined);
    }
    return;
  }
  if (STORE_BACKEND === 'SQLITE' && activeStoreAdapter) {
    try {
      store = normalizeStoreShape(activeStoreAdapter.load());
    } catch {}
    return;
  }
  if (!fs.existsSync(STORE_FILE)) return;
  try {
    store = normalizeStoreShape(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')));
  } catch {}
}

function zoneWorkerHeartbeatFresh(maxAgeMs = 45000) {
  const heartbeat = store.zoneWorkerHeartbeat;
  if (!heartbeat) return false;
  const age = Date.now() - new Date(heartbeat).getTime();
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function paginate(data, page = 1, limit = 30) {
  const currentPage = Math.max(1, Number(page) || 1);
  const pageSize = Math.max(1, Number(limit) || 30);
  const start = (currentPage - 1) * pageSize;
  return {
    data: data.slice(start, start + pageSize),
    total: data.length,
    page: currentPage,
    limit: pageSize,
    totalPages: Math.max(1, Math.ceil(data.length / pageSize)),
  };
}

function resolveSecretReference(ref, errors) {
  if (runtimeSecrets.has(ref)) return runtimeSecrets.get(ref);
  try {
    const value = getVaultProvider().resolve(ref);
    if (value != null && value !== '') {
      runtimeSecrets.set(ref, value);
      return value;
    }
  } catch (error) {
    errors.push({ category: 'SECRET_RESOLUTION_ERROR', message: `Secret reference "${ref}" could not be decrypted by the API Console backend.` });
    return ref;
  }
  errors.push({ category: 'SECRET_RESOLUTION_ERROR', message: `Secret reference "${ref}" could not be resolved by the API Console backend.` });
  return ref;
}

function resolveTemplate(value, request, environment, executionVariables = {}) {
  const collection = store.collections.find(item => item.id === request.collectionId);
  const buckets = [
    {
      scope: 'EXECUTION',
      vars: Object.fromEntries(Object.entries(executionVariables || {}).map(([key, val]) => [key, { value: String(val), sensitive: isSensitiveName(key) }])),
    },
    { scope: 'REQUEST', vars: {} },
    { scope: 'COLLECTION', vars: Object.fromEntries((collection?.variables || []).map(variable => [variable.key, { value: variable.currentValue, sensitive: variable.sensitive }])) },
    { scope: 'ENVIRONMENT', vars: Object.fromEntries((environment.variables || []).map(variable => [variable.key, { value: variable.currentValue, sensitive: variable.sensitive }])) },
    { scope: 'GLOBAL', vars: Object.fromEntries((store.globalVariables || []).map(variable => [variable.key, { value: variable.currentValue, sensitive: variable.sensitive }])) },
  ];
  const resolutions = [];
  const errors = [];
  let transportValue = String(value || '');
  let snapshotValue = String(value || '');

  transportValue = transportValue.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    for (const bucket of buckets) {
      const found = bucket.vars[key];
      if (found) {
        resolutions.push({ key, source: bucket.scope, sensitive: found.sensitive });
        if (found.sensitive) {
          if (isSecretReference(found.value)) return resolveSecretReference(found.value, errors);
          errors.push({ category: 'SECRET_RESOLUTION_ERROR', message: `Sensitive variable "${key}" must resolve through secret storage.` });
          return found.value;
        }
        return found.value;
      }
    }
    errors.push({ category: 'VARIABLE_RESOLUTION_ERROR', message: `Variable "${key}" could not be resolved.` });
    return match;
  });

  snapshotValue = snapshotValue.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    for (const bucket of buckets) {
      const found = bucket.vars[key];
      if (found) return found.sensitive ? `{{${key}}}` : found.value;
    }
    return match;
  });

  transportValue = transportValue.replace(/secret:\/\/api-console\/[0-9a-f-]+/gi, ref => resolveSecretReference(ref, errors));
  snapshotValue = snapshotValue.replace(/secret:\/\/api-console\/[0-9a-f-]+/gi, '{{secret}}');
  if (/secret\/[^\s'"\\]+/i.test(transportValue)) {
    errors.push({ category: 'SECRET_RESOLUTION_ERROR', message: 'External secret reference requires the project secret-management integration.' });
  }

  return { transportValue, snapshotValue, resolutions, errors };
}

function mergeResolution(target, result) {
  target.variableResolution.push(...result.resolutions);
  target.errors.push(...result.errors);
}

function resolveRequest(request, environment, executionMode = request.executionMode, executionVariables = {}) {
  const context = { variableResolution: [], errors: [] };
  const resolve = value => {
    const result = resolveTemplate(value, request, environment, executionVariables);
    mergeResolution(context, result);
    return result;
  };

  const urlResolved = resolve(request.urlTemplate);
  const resolvedParams = (request.queryParameters || []).map(param => {
    const result = resolve(param.value);
    return {
      transport: { ...param, value: result.transportValue },
      snapshot: { ...param, value: param.sensitive ? '{{secret}}' : result.snapshotValue },
    };
  });
  const transportUrl = buildUrlWithQuery(urlResolved.transportValue, resolvedParams.map(item => item.transport));
  const snapshotUrl = buildUrlWithQuery(urlResolved.snapshotValue, resolvedParams.map(item => item.snapshot));

  const envHeaders = (environment.defaultHeaders || []).map((header, index) => ({
    ...header,
    id: makeId('env-hdr'),
    source: 'ENVIRONMENT',
    displayOrder: (request.headers || []).length + index,
  }));
  const mergedHeaders = [...envHeaders, ...(request.headers || [])];
  const omittedHeaders = [];
  const transportHeaders = [];
  const snapshotHeaders = [];

  mergedHeaders.forEach((header) => {
    const normalized = String(header.name || '').toLowerCase();
    if (!header.enabled) {
      omittedHeaders.push({ name: header.name, reason: 'Header is disabled in the request editor.' });
      return;
    }
    if (normalized === 'content-length') {
      omittedHeaders.push({ name: header.name, reason: 'Content-Length is recalculated by the runner.' });
      return;
    }
    if (normalized === 'connection') {
      omittedHeaders.push({ name: header.name, reason: 'Connection is controlled by the HTTP transport.' });
      return;
    }
    if (header.category === 'BROWSER_GENERATED' && executionMode === 'RECOMMENDED') {
      omittedHeaders.push({ name: header.name, reason: 'Browser-generated header disabled in recommended replay.' });
      return;
    }
    const resolved = resolve(header.valueTemplate);
    const sensitive = header.sensitive || isSensitiveName(header.name);
    transportHeaders.push({
      ...header,
      valueTemplate: resolved.transportValue,
      maskedValue: sensitive ? maskValue(resolved.snapshotValue) : resolved.snapshotValue,
    });
    snapshotHeaders.push({
      ...header,
      valueTemplate: sensitive ? maskValue(resolved.snapshotValue) : resolved.snapshotValue,
      maskedValue: sensitive ? maskValue(resolved.snapshotValue) : resolved.snapshotValue,
      sensitive,
    });
  });

  const body = requestBodyFromDefinition(request);
  const resolvedBody = resolve(body.raw || '');
  const transportBody = { ...body, raw: resolvedBody.transportValue };
  const snapshotBody = { ...body, raw: sanitizeText(resolvedBody.snapshotValue) };
  if (body.type === 'json') {
    const transportParsed = parseJsonSafely(transportBody.raw);
    const snapshotParsed = parseJsonSafely(snapshotBody.raw);
    transportBody.value = transportParsed.ok ? transportParsed.value : null;
    snapshotBody.value = snapshotParsed.ok ? snapshotParsed.value : null;
  }

  if (hasBody(transportBody) && !transportHeaders.some(header => header.name.toLowerCase() === 'content-type')) {
    const contentType = body.contentType || (body.type === 'json' ? 'application/json' : body.type === 'xml' ? 'application/xml' : body.type === 'form-urlencoded' ? 'application/x-www-form-urlencoded' : 'text/plain');
    const header = createHeader('content-type', contentType, transportHeaders.length, 'SYSTEM', executionMode);
    header.enabled = true;
    transportHeaders.push(header);
    snapshotHeaders.push(header);
  }
  if (hasBody(transportBody)) {
    omittedHeaders.push({ name: 'content-length', reason: 'Runner recalculates Content-Length immediately before sending.' });
  }

  const transportCookies = [];
  const snapshotCookies = [];
  (request.cookies || []).filter(cookie => cookie.enabled).forEach(cookie => {
    const resolved = resolve(cookie.valueReference);
    transportCookies.push({
      ...cookie,
      valueReference: resolved.transportValue,
      maskedValue: cookie.sensitive ? maskValue(resolved.snapshotValue) : resolved.snapshotValue,
    });
    snapshotCookies.push({
      ...cookie,
      valueReference: cookie.sensitive ? maskValue(resolved.snapshotValue) : resolved.snapshotValue,
      maskedValue: cookie.sensitive ? maskValue(resolved.snapshotValue) : resolved.snapshotValue,
    });
  });

  return {
    snapshot: {
      method: request.method,
      url: snapshotUrl,
      headers: snapshotHeaders.map((header, index) => ({ ...header, displayOrder: index })),
      cookies: snapshotCookies,
      body: snapshotBody,
      tls: request.tls,
      omittedHeaders,
      variableResolution: context.variableResolution,
    },
    transport: {
      method: request.method,
      url: transportUrl,
      headers: transportHeaders.map((header, index) => ({ ...header, displayOrder: index })),
      cookies: transportCookies,
      body: transportBody,
      tls: request.tls,
    },
    errors: context.errors,
  };
}

function ipv4ToNumber(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function isAllowlistEligiblePrivateIPv4(host) {
  const value = ipv4ToNumber(host);
  if (value === null) return false;
  const a = Number(host.split('.')[0]);
  const b = Number(host.split('.')[1]);
  return a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

function isHardBlockedIPv4(host) {
  const value = ipv4ToNumber(host);
  if (value === null) return false;
  const a = Number(host.split('.')[0]);
  const b = Number(host.split('.')[1]);
  return a === 127 ||
    a === 0 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254);
}

function normalizedIPv6(host) {
  return String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
}

function isAllowlistEligiblePrivateIPv6(host) {
  const lower = normalizedIPv6(host);
  // Unique local (fc00::/7) and deprecated site-local (fec0::/10)
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fec0:');
}

function extractEmbeddedIpv4FromIpv6(host) {
  const lower = normalizedIPv6(host);
  const mapped = lower.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  // Corporate DNS often encodes private IPv4 as decimal-looking trailing hextets, e.g.
  // 2001:4188:2:600:10:10:34:35 → 10.10.34.35 (NOT hex 0x10 → 16).
  const parts = lower.split(':').filter(Boolean);
  if (parts.length >= 4) {
    const tail = parts.slice(-4);
    if (tail.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
      return tail.map(Number).join('.');
    }
  }
  return null;
}

function isPrivateNetworkAddress(host) {
  if (isAllowlistEligiblePrivateIPv4(host) || isAllowlistEligiblePrivateIPv6(host)) return true;
  const embedded = extractEmbeddedIpv4FromIpv6(host);
  if (!embedded) return false;
  return isAllowlistEligiblePrivateIPv4(embedded) || isHardBlockedIPv4(embedded);
}

function isHardBlockedIPv6(host) {
  const lower = normalizedIPv6(host);
  if (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fe80:') ||
    lower.startsWith('ff') ||
    lower.startsWith('::ffff:') ||
    lower.startsWith('0:0:0:0:0:ffff:')
  ) {
    return true;
  }
  const embedded = extractEmbeddedIpv4FromIpv6(host);
  return Boolean(embedded && isHardBlockedIPv4(embedded));
}

function parsePrivateDestinationOrigin(candidate) {
  const text = String(candidate || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text.includes('://') ? text : `https://${text}`);
    const isOriginOnly = (parsed.pathname === '/' || parsed.pathname === '') && !parsed.search && !parsed.hash;
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && isOriginOnly) {
      return parsed.origin.toLowerCase();
    }
  } catch {
    // Invalid entries never grant/deny network access.
  }
  return null;
}

function parseDestinationPattern(candidate) {
  const text = String(candidate || '').trim().toLowerCase();
  if (!text) return null;
  const origin = parsePrivateDestinationOrigin(text);
  if (origin) return { kind: 'origin', value: origin };
  // hostname-only patterns (example.com or *.example.com)
  if (/^\*?[a-z0-9.-]+(?::\d+)?$/i.test(text.replace(/^\*\./, ''))) {
    return { kind: 'host', value: text.replace(/^\*\./, '*.') };
  }
  return null;
}

function configuredDestinationAllowlist() {
  const patterns = [];
  // Optional restrictive allowlist from env (legacy name kept).
  for (const value of String(process.env.API_CONSOLE_PRIVATE_DESTINATION_ALLOWLIST || '').split(',')) {
    const pattern = parseDestinationPattern(value);
    if (pattern) patterns.push(pattern);
  }
  // Explicit org allowlist only. Empty = open (any public/private destination except hard blocks / blocklist).
  const orgAllow = Array.isArray(store?.orgPolicies?.destinationAllowlist)
    ? store.orgPolicies.destinationAllowlist
    : [];
  for (const value of orgAllow) {
    const pattern = parseDestinationPattern(value);
    if (pattern) patterns.push(pattern);
  }
  return patterns;
}

function configuredDestinationBlocklist() {
  const patterns = [];
  for (const value of String(process.env.API_CONSOLE_DESTINATION_BLOCKLIST || '').split(',')) {
    const pattern = parseDestinationPattern(value);
    if (pattern) patterns.push(pattern);
  }
  const orgBlock = Array.isArray(store?.orgPolicies?.destinationBlocklist) ? store.orgPolicies.destinationBlocklist : [];
  for (const value of orgBlock) {
    const pattern = parseDestinationPattern(value);
    if (pattern) patterns.push(pattern);
  }
  return patterns;
}

function destinationMatchesPattern(parsedUrl, pattern) {
  if (!pattern) return false;
  const origin = parsedUrl.origin.toLowerCase();
  const host = parsedUrl.hostname.toLowerCase().replace(/\.$/, '');
  if (pattern.kind === 'origin') return origin === pattern.value;
  const raw = String(pattern.value || '').toLowerCase();
  if (raw.startsWith('*.')) {
    const suffix = raw.slice(1); // .example.com
    return host.endsWith(suffix) || host === raw.slice(2);
  }
  const hostOnly = raw.split(':')[0];
  const port = raw.includes(':') ? raw.split(':')[1] : null;
  if (port && String(parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80')) !== port) return false;
  return host === hostOnly;
}

function assertDestinationAddressAllowed(address, resolvedByDns = false) {
  const normalized = normalizedIPv6(address);
  if (METADATA_IPS.has(normalized) || isHardBlockedIPv4(normalized) || isHardBlockedIPv6(normalized)) {
    throw new ApiConsoleError(
      'DESTINATION_NOT_ALLOWED',
      `${resolvedByDns ? 'DNS resolved to' : 'The destination is'} a blocked loopback, link-local, carrier-grade, multicast, or metadata address.`,
    );
  }
}

function isLiteralIpHost(host) {
  return /^[0-9.]+$/.test(host) || host.includes(':');
}

function isUsableDestinationAddress(address) {
  try {
    assertDestinationAddressAllowed(address, true);
    return true;
  } catch {
    return false;
  }
}

function isCorporateRemappedAddress(address) {
  return isPrivateNetworkAddress(address);
}

function rankDestinationAddress(address, family = 4) {
  if (!isUsableDestinationAddress(address)) return 99;
  if (isCorporateRemappedAddress(address)) return 50;
  // Prefer IPv4 for outbound HTTPS from Windows/corp networks (IPv6 often ENETUNREACH).
  if (family === 6) return 10;
  return 1;
}

function configuredDohEndpoints() {
  return String(process.env.API_CONSOLE_DOH_URLS || 'https://cloudflare-dns.com/dns-query,https://dns.google/resolve')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * DNS-over-HTTPS fallback when UDP to public resolvers is blocked by corporate firewalls.
 * Returns A records only (IPv4) — enough to escape IPv6/private sinkholes.
 */
async function resolveDestinationAddressesViaDoh(host) {
  const endpoints = configuredDohEndpoints();
  const collected = [];
  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set('name', host);
      url.searchParams.set('type', 'A');
      const payload = await new Promise((resolve, reject) => {
        const req = https.get(url, {
          headers: { accept: 'application/dns-json' },
          timeout: 4500,
          rejectUnauthorized: true,
        }, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`DoH HTTP ${res.statusCode}`));
              return;
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('DoH timeout'));
        });
      });
      const parsed = JSON.parse(payload);
      const answers = Array.isArray(parsed.Answer) ? parsed.Answer : [];
      for (const answer of answers) {
        if (Number(answer.type) === 1 && answer.data && /^[0-9.]+$/.test(String(answer.data))) {
          collected.push({ address: String(answer.data), family: 4 });
        }
      }
      if (collected.length) break;
    } catch {
      // try next DoH endpoint
    }
  }
  return collected;
}

async function resolveDestinationAddresses(host) {
  if (isLiteralIpHost(host)) {
    const address = host.includes(':') ? normalizedIPv6(host) : host;
    assertDestinationAddressAllowed(address);
    return [{ address, family: host.includes(':') ? 6 : 4 }];
  }

  const safeLookup = async (fn) => {
    try {
      return await fn();
    } catch {
      return [];
    }
  };

  const prefer = (rows) => [...rows]
    .filter(row => isUsableDestinationAddress(row.address))
    .sort((left, right) => rankDestinationAddress(left.address, left.family) - rankDestinationAddress(right.address, right.family)
      || left.family - right.family);

  const onlyPublic = (rows) => prefer(rows).filter(row => !isCorporateRemappedAddress(row.address));
  const onlyPublicV4 = (rows) => onlyPublic(rows).filter(row => row.family === 4);

  let records = prefer(await safeLookup(() => dns.lookup(host, { all: true, verbatim: false })));
  const onlyRemapped = records.length > 0 && records.every(row => isCorporateRemappedAddress(row.address));
  const hasPublicV4 = onlyPublicV4(records).length > 0;

  // Corporate DNS often remaps public hostnames to private/IPv6 sinkholes (e.g. 10.10.34.35).
  // Prefer public IPv4 via public resolvers whenever system DNS looks remapped or IPv6-only.
  if (!records.length || onlyRemapped || !hasPublicV4) {
    const servers = String(process.env.API_CONSOLE_DNS_SERVERS || '8.8.8.8,1.1.1.1')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    if (servers.length) {
      const resolver = new dns.Resolver();
      resolver.setServers(servers);
      const [v4, v6] = await Promise.all([
        safeLookup(async () => (await resolver.resolve4(host)).map(address => ({ address, family: 4 }))),
        safeLookup(async () => (await resolver.resolve6(host)).map(address => ({ address, family: 6 }))),
      ]);
      const alternatePublicV4 = onlyPublicV4([...v4, ...v6]);
      if (alternatePublicV4.length) {
        records = alternatePublicV4;
      } else {
        const alternatePublic = onlyPublic([...v4, ...v6]);
        if (alternatePublic.length) records = alternatePublic;
      }
    }
  }

  // When UDP to 8.8.8.8/1.1.1.1 is blocked, fall back to DNS-over-HTTPS.
  if (!onlyPublicV4(records).length) {
    const dohRecords = onlyPublicV4(await resolveDestinationAddressesViaDoh(host));
    if (dohRecords.length) records = dohRecords;
  }

  // Never connect through corporate remapped private IPs for hostname targets.
  const publicV4 = onlyPublicV4(records);
  if (publicV4.length) return publicV4;
  const publicAny = onlyPublic(records);
  if (publicAny.length) return publicAny;

  if (records.length && records.every(row => isCorporateRemappedAddress(row.address))) {
    throw new ApiConsoleError(
      'DNS_ERROR',
      `DNS برای ${host} فقط به IP خصوصی/سازمانی (sinkhole) نگاشت شد و هیچ IPv4 عمومی از resolver/DoH به‌دست نیامد. اتصال عمداً برقرار نشد.`,
    );
  }

  throw new ApiConsoleError('DNS_ERROR', `DNS lookup for ${host} returned no usable records.`);
}

async function validateDestination(urlText) {
  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    throw new ApiConsoleError('INVALID_URL', 'The effective request URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiConsoleError('DESTINATION_NOT_ALLOWED', 'Only HTTP and HTTPS destinations are allowed.');
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');

  // Allow the configured Integrated Systems Gateway (often localhost:4000) when IS approach is enabled.
  try {
    const { isEnabled: isIsEnabled, gatewayBaseUrl } = require('../../../is/is-auth-server.cjs');
    if (isIsEnabled()) {
      const gw = new URL(gatewayBaseUrl());
      const normHost = value => String(value || '').toLowerCase().replace(/^\[|\]$/g, '').replace('localhost', '127.0.0.1');
      const normPort = (url) => url.port || (url.protocol === 'https:' ? '443' : '80');
      if (
        parsed.protocol === gw.protocol
        && normHost(parsed.hostname) === normHost(gw.hostname)
        && normPort(parsed) === normPort(gw)
      ) {
        const address = normHost(parsed.hostname);
        return {
          parsed,
          address,
          family: address.includes(':') ? 6 : 4,
          addresses: [{ address, family: address.includes(':') ? 6 : 4 }],
          isIsGateway: true,
        };
      }
    }
  } catch {
    // ignore IS config errors and continue with default policy
  }

  if (PROTECTED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.localhost')) {
    throw new ApiConsoleError('DESTINATION_NOT_ALLOWED', 'Localhost and local-network hostnames are blocked by policy.');
  }
  if (METADATA_HOSTS.has(host)) {
    throw new ApiConsoleError('DESTINATION_NOT_ALLOWED', 'Cloud metadata destinations are blocked by policy.');
  }

  const blocklist = configuredDestinationBlocklist();
  if (blocklist.some(pattern => destinationMatchesPattern(parsed, pattern))) {
    throw new ApiConsoleError('DESTINATION_NOT_ALLOWED', `مقصد در blocklist بک‌آفیس مسدود است: ${parsed.origin}`);
  }

  const allowlist = configuredDestinationAllowlist();
  if (allowlist.length > 0 && !allowlist.some(pattern => destinationMatchesPattern(parsed, pattern))) {
    throw new ApiConsoleError(
      'DESTINATION_NOT_ALLOWED',
      `مقصد خارج از allowlist بک‌آفیس است: ${parsed.origin}`,
    );
  }

  const records = await resolveDestinationAddresses(host);
  return { parsed, address: records[0].address, family: records[0].family, addresses: records };
}

function validateCoreRequest(requestOrNormalized) {
  const normalized = requestOrNormalized.urlTemplate ? normalizedFromDefinition(requestOrNormalized) : requestOrNormalized;
  const errors = [];
  const warnings = [];
  const classification = detectCoreClassification(normalized.url, normalized.body);

  if (classification.type === 'GENERIC_HTTP') {
    return { valid: true, errors, warnings: ['Request is generic HTTP. Core-specific validation is not applied.'] };
  }

  if (normalized.method !== 'POST') errors.push('Core requests must remain HTTP POST.');
  const body = normalized.body.value;
  if (!body || typeof body !== 'object') errors.push('Core request body must be a JSON object.');
  if (!body?.serviceId || typeof body.serviceId !== 'string') errors.push('serviceId must be a non-empty string.');

  if (classification.type === 'CORE_COMMAND') {
    if (!body?.formId || typeof body.formId !== 'string') errors.push('formId must be a non-empty string.');
    if (!Object.prototype.hasOwnProperty.call(body || {}, 'data') || typeof body?.data !== 'object' || body?.data === null || Array.isArray(body?.data)) {
      errors.push('data must exist and be an object.');
    }
  }

  if (classification.type === 'CORE_QUERY') {
    if (!body?.key || typeof body.key !== 'string') errors.push('key must be a non-empty string.');
    if (!Object.prototype.hasOwnProperty.call(body || {}, 'params') || typeof body?.params !== 'object' || body?.params === null || Array.isArray(body?.params)) {
      errors.push('params must exist and be an object.');
    }
  }

  if (!normalized.tls.verifyCertificate) warnings.push('TLS certificate verification is disabled.');
  return { valid: errors.length === 0, errors, warnings };
}

function evaluateAssertions(request, response) {
  return (request.assertions || []).filter(assertion => assertion.enabled).map(assertion => {
    switch (assertion.assertionType) {
      case 'EXPECTED_HTTP_STATUS': {
        const expected = assertion.configuration.expectedHttpStatuses || [200];
        const passed = response.statusCode && expected.includes(response.statusCode);
        return {
          assertionId: assertion.id,
          assertionType: assertion.assertionType,
          result: passed ? 'PASSED' : 'FAILED',
          message: passed ? 'HTTP status matched.' : `Expected ${expected.join(', ')}, got ${response.statusCode || 'none'}.`,
        };
      }
      case 'MAX_RESPONSE_TIME': {
        const max = Number(assertion.configuration.maximumResponseTimeMs || 5000);
        const passed = response.durationMs <= max;
        return {
          assertionId: assertion.id,
          assertionType: assertion.assertionType,
          result: passed ? 'PASSED' : 'FAILED',
          message: passed ? 'Response time is within threshold.' : `Response time ${response.durationMs}ms exceeded ${max}ms.`,
        };
      }
      case 'EXPECTED_CONTENT_TYPE': {
        const expected = String(assertion.configuration.expectedContentType || '').toLowerCase();
        const actual = String(response.contentType || '').toLowerCase();
        const passed = expected ? actual.includes(expected) : true;
        return {
          assertionId: assertion.id,
          assertionType: assertion.assertionType,
          result: passed ? 'PASSED' : 'FAILED',
          message: passed ? 'Content-Type matched.' : `Expected Content-Type containing ${expected}, got ${actual}.`,
        };
      }
      case 'REQUIRED_JSON_PATH': {
        const pathValue = String(assertion.configuration.jsonPath || assertion.configuration.path || '');
        const passed = pathValue ? simpleJsonPathExists(response.bodyPreview, pathValue) : true;
        return {
          assertionId: assertion.id,
          assertionType: assertion.assertionType,
          result: passed ? 'PASSED' : 'FAILED',
          message: passed ? `${pathValue} exists.` : `${pathValue} was not found.`,
        };
      }
      case 'JSON_SCHEMA': {
        const schema = assertion.configuration.schema || assertion.configuration.jsonSchema || assertion.configuration;
        const validation = evaluateJsonSchemaAssertion(response.bodyPreview, schema);
        return {
          assertionId: assertion.id,
          assertionType: assertion.assertionType,
          result: validation.passed ? 'PASSED' : 'FAILED',
          message: validation.message,
        };
      }
      default:
        return {
          assertionId: assertion.id,
          assertionType: assertion.assertionType,
          result: 'NOT_EVALUATED',
          message: 'Assertion type is saved but not evaluated by this runner.',
        };
    }
  });
}

function evaluateJsonSchemaAssertion(body, schemaInput) {
  const parsed = parseJsonSafely(body);
  if (!parsed.ok) {
    return { passed: false, message: 'Response body is not valid JSON for schema assertion.' };
  }
  let schema = schemaInput;
  if (typeof schema === 'string') {
    const schemaParsed = parseJsonSafely(schema);
    if (!schemaParsed.ok) return { passed: false, message: 'Configured JSON Schema is invalid.' };
    schema = schemaParsed.value;
  }
  if (!schema || typeof schema !== 'object') {
    return { passed: false, message: 'JSON Schema configuration is missing.' };
  }
  if (schema.type === 'object' && (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value))) {
    return { passed: false, message: 'Expected JSON object response.' };
  }
  if (schema.type === 'array' && !Array.isArray(parsed.value)) {
    return { passed: false, message: 'Expected JSON array response.' };
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!parsed.value || typeof parsed.value !== 'object' || !Object.prototype.hasOwnProperty.call(parsed.value, key)) {
      return { passed: false, message: `Required schema property "${key}" is missing.` };
    }
  }
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  for (const [key, propSchema] of Object.entries(properties)) {
    if (!parsed.value || !Object.prototype.hasOwnProperty.call(parsed.value, key)) continue;
    const expectedType = propSchema && typeof propSchema === 'object' ? propSchema.type : undefined;
    if (!expectedType) continue;
    const actual = parsed.value[key];
    const actualType = Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual;
    if (expectedType !== actualType) {
      return { passed: false, message: `Property "${key}" expected type ${expectedType}, got ${actualType}.` };
    }
  }
  return { passed: true, message: 'JSON Schema assertion passed.' };
}

function simpleJsonPathExists(body, pathValue) {
  const parsed = parseJsonSafely(body);
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return false;
  const parts = pathValue.replace(/^\$\./, '').split('.').filter(Boolean);
  let cursor = parsed.value;
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && Object.prototype.hasOwnProperty.call(cursor, part)) {
      cursor = cursor[part];
    } else {
      return false;
    }
  }
  return true;
}

function splitScriptArgs(raw) {
  const args = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const char of String(raw || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ',') {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (quote) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Script contains an unclosed string literal.');
  if (current.trim() || raw.trim()) args.push(current.trim());
  return args.map(value => {
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    return value;
  });
}

function parseScriptLines(source) {
  const lines = String(source || '').slice(0, 20000).split(/\r?\n/);
  if (lines.length > 150) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Script is too long. Maximum 150 lines are allowed.');
  return lines
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(item => item.raw && !item.raw.startsWith('//') && !item.raw.startsWith('#'));
}

function parseScriptCommand(raw) {
  const match = raw.match(/^([a-zA-Z][\w]*)\s*\(([\s\S]*)\)\s*;?$/);
  if (!match) throw new ApiConsoleError('CORE_VALIDATION_ERROR', `Unsupported script syntax: ${raw}`);
  return { name: match[1], args: splitScriptArgs(match[2]) };
}

function scriptResult(phase, line, command, result, message) {
  return { phase, line, command, result, message: sanitizeText(message) };
}

function upsertScriptHeader(request, name, value) {
  const normalized = String(name || '').toLowerCase();
  const headers = request.headers || [];
  const index = headers.findIndex(header => String(header.name || '').toLowerCase() === normalized);
  if (index >= 0) {
    headers[index] = {
      ...headers[index],
      valueTemplate: String(value ?? ''),
      enabled: true,
      source: 'USER',
    };
  } else {
    const header = createHeader(String(name), String(value ?? ''), headers.length, 'USER', request.executionMode || 'RECOMMENDED');
    header.enabled = true;
    headers.push(header);
  }
  request.headers = headers;
}

function upsertScriptQuery(request, name, value) {
  const params = request.queryParameters || [];
  const index = params.findIndex(param => param.name === name);
  const next = {
    id: makeId('param'),
    name: String(name),
    value: String(value ?? ''),
    enabled: true,
    sensitive: isSensitiveName(name),
    source: 'USER',
    displayOrder: params.length,
  };
  if (index >= 0) params[index] = { ...params[index], ...next, id: params[index].id, displayOrder: params[index].displayOrder ?? index };
  else params.push(next);
  request.queryParameters = params;
}

function setJsonBodyPath(request, pathValue, value) {
  const body = requestBodyFromDefinition(request);
  const parsed = body.type === 'json' ? parseJsonSafely(body.raw || '{}') : { ok: true, value: {} };
  const root = parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value) ? parsed.value : {};
  const parts = String(pathValue || '').replace(/^\$\./, '').split('.').filter(Boolean);
  if (!parts.length) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'setJsonBody requires a JSON path such as $.data.id.');
  let cursor = root;
  parts.slice(0, -1).forEach(part => {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
  request.bodyType = 'json';
  request.bodyTemplate = JSON.stringify(root, null, 2);
}

function runPreRequestScript(request, scripts, executionVariables = {}) {
  const results = [];
  const variables = { ...(executionVariables || {}) };
  if (!scripts?.preRequestEnabled || !String(scripts.preRequest || '').trim()) return { request, variables, results };
  let lines;
  try {
    lines = parseScriptLines(scripts.preRequest);
  } catch (error) {
    results.push(scriptResult('PRE_REQUEST', 0, 'script', 'FAILED', error.message || 'Pre-request script is invalid.'));
    return { request, variables, results };
  }
  for (const item of lines) {
    try {
      const command = parseScriptCommand(item.raw);
      if (command.name === 'setVar') {
        const [key, value] = command.args;
        if (!key) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'setVar requires key and value.');
        variables[String(key)] = String(value ?? '');
        results.push(scriptResult('PRE_REQUEST', item.line, command.name, 'PASSED', `Variable "${key}" set for this execution.`));
      } else if (command.name === 'setHeader') {
        const [name, value] = command.args;
        if (!name) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'setHeader requires name and value.');
        upsertScriptHeader(request, name, value);
        results.push(scriptResult('PRE_REQUEST', item.line, command.name, 'PASSED', `Header "${name}" updated.`));
      } else if (command.name === 'setQuery') {
        const [name, value] = command.args;
        if (!name) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'setQuery requires name and value.');
        upsertScriptQuery(request, name, value);
        results.push(scriptResult('PRE_REQUEST', item.line, command.name, 'PASSED', `Query parameter "${name}" updated.`));
      } else if (command.name === 'setJsonBody') {
        const [pathValue, value] = command.args;
        setJsonBodyPath(request, pathValue, value);
        results.push(scriptResult('PRE_REQUEST', item.line, command.name, 'PASSED', `JSON body path "${pathValue}" updated.`));
      } else if (command.name === 'setCookie') {
        const [name, value] = command.args;
        if (!name) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'setCookie requires name and value.');
        const cookies = Array.isArray(request.cookies) ? request.cookies : [];
        const index = cookies.findIndex(cookie => String(cookie.name || '').toLowerCase() === String(name).toLowerCase());
        const nextCookie = {
          id: index >= 0 ? cookies[index].id : makeId('cookie'),
          name: String(name),
          valueReference: String(value ?? ''),
          enabled: true,
          sensitive: false,
          source: 'USER',
        };
        if (index >= 0) cookies[index] = { ...cookies[index], ...nextCookie };
        else cookies.push(nextCookie);
        request.cookies = cookies;
        results.push(scriptResult('PRE_REQUEST', item.line, command.name, 'PASSED', `Cookie "${name}" updated.`));
      } else {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', `Unsupported pre-request command "${command.name}".`);
      }
    } catch (error) {
      results.push(scriptResult('PRE_REQUEST', item.line, 'script', 'FAILED', error.message || 'Pre-request script failed.'));
      break;
    }
  }
  return { request, variables, results };
}

function responseHeaderValue(response, name) {
  const header = (response.headers || []).find(item => String(item.name || '').toLowerCase() === String(name || '').toLowerCase());
  return header ? String(header.valueTemplate || '') : '';
}

function runPostResponseScript(scripts, response) {
  const results = [];
  if (!scripts?.postResponseEnabled || !String(scripts.postResponse || '').trim()) return results;
  let lines;
  try {
    lines = parseScriptLines(scripts.postResponse);
  } catch (error) {
    return [scriptResult('POST_RESPONSE', 0, 'script', 'FAILED', error.message || 'Post-response script is invalid.')];
  }
  for (const item of lines) {
    try {
      const command = parseScriptCommand(item.raw);
      let passed = true;
      let message = 'Script test passed.';
      if (command.name === 'testStatus') {
        const expected = command.args.map(Number).filter(value => !Number.isNaN(value));
        passed = expected.length ? expected.includes(Number(response.statusCode)) : true;
        message = passed ? `HTTP status ${response.statusCode} matched.` : `Expected status ${expected.join(', ')}, got ${response.statusCode || 'none'}.`;
      } else if (command.name === 'testResponseTimeBelow') {
        const max = Number(command.args[0] || 5000);
        passed = response.durationMs <= max;
        message = passed ? `Response time ${response.durationMs}ms is below ${max}ms.` : `Response time ${response.durationMs}ms exceeded ${max}ms.`;
      } else if (command.name === 'testHeaderContains') {
        const [name, expected] = command.args;
        const actual = responseHeaderValue(response, name).toLowerCase();
        passed = actual.includes(String(expected || '').toLowerCase());
        message = passed ? `Header "${name}" contains expected value.` : `Header "${name}" did not contain "${expected}".`;
      } else if (command.name === 'testJsonPath') {
        const [pathValue] = command.args;
        passed = simpleJsonPathExists(response.bodyPreview, String(pathValue || ''));
        message = passed ? `${pathValue} exists.` : `${pathValue} was not found.`;
      } else if (command.name === 'testJsonEquals') {
        const [pathValue, expected] = command.args;
        const parsed = parseJsonSafely(response.bodyPreview);
        let actual;
        if (parsed.ok && pathValue) {
          const parts = String(pathValue).replace(/^\$\./, '').split('.').filter(Boolean);
          actual = parsed.value;
          for (const part of parts) {
            if (actual && typeof actual === 'object' && Object.prototype.hasOwnProperty.call(actual, part)) actual = actual[part];
            else { actual = undefined; break; }
          }
        }
        passed = String(actual) === String(expected);
        message = passed ? `${pathValue} equals expected value.` : `${pathValue} expected "${expected}", got "${actual}".`;
      } else if (command.name === 'testStatusIn') {
        const expected = command.args.map(Number).filter(value => !Number.isNaN(value));
        passed = expected.length ? expected.includes(Number(response.statusCode)) : true;
        message = passed ? `HTTP status ${response.statusCode} matched.` : `Expected status in [${expected.join(', ')}], got ${response.statusCode || 'none'}.`;
      } else if (command.name === 'testBodyContains') {
        const [expected] = command.args;
        passed = String(response.bodyPreview || '').includes(String(expected || ''));
        message = passed ? 'Body contains expected text.' : `Body did not contain "${expected}".`;
      } else {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', `Unsupported post-response command "${command.name}".`);
      }
      results.push(scriptResult('POST_RESPONSE', item.line, command.name, passed ? 'PASSED' : 'FAILED', message));
    } catch (error) {
      results.push(scriptResult('POST_RESPONSE', item.line, 'script', 'FAILED', error.message || 'Post-response script failed.'));
    }
  }
  return results;
}

function businessResultFromAssertions(results) {
  if (!results.length) return 'NOT_EVALUATED';
  if (results.some(result => result.result === 'FAILED')) return 'FAILED';
  if (results.some(result => result.result === 'WARNING')) return 'WARNING';
  return 'PASSED';
}

function createBlockedExecution(request, snapshot, environment, userId, category, message, businessJustification, scriptResults = []) {
  const now = nowIso();
  return {
    id: makeId('api-exec'),
    requestId: request.id,
    collectionId: request.collectionId,
    environmentId: environment.id,
    runnerId: selectRunner(environment).id,
    executedBy: userId,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    status: 'BLOCKED',
    requestSnapshot: snapshot,
    tlsVerification: snapshot.tls.verifyCertificate,
    transportResult: 'BLOCKED',
    businessResult: 'NOT_EVALUATED',
    assertionResults: [],
    scriptResults,
    correlationId: makeId('api-corr'),
    errorCategory: category,
    sanitizedError: sanitizeText(message),
    environmentName: environment.name,
    evidenceType: 'ACTUAL_EXECUTION',
    businessJustification,
  };
}

function dualApprovalRequired() {
  const orgEnabled = store?.orgPolicies?.dualApprovalProductionCommand === true;
  const envEnabled = String(process.env.API_CONSOLE_DUAL_APPROVAL || '').toLowerCase() === 'true';
  return orgEnabled || envEnabled;
}

function findActiveDualApproval(requestId, userId) {
  const now = Date.now();
  return (store.dualApprovals || []).find(grant =>
    grant.requestId === requestId &&
    grant.userId === userId &&
    grant.status === 'ACTIVE' &&
    (!grant.expiresAt || new Date(grant.expiresAt).getTime() > now)
  );
}

function validateProductionPolicy(request, environment, context, options) {
  const isProduction = PRODUCTION_KINDS.has(environment.kind);
  if (!isProduction) return { allowed: true };
  const orgPolicies = store.orgPolicies || defaultOrgPolicies();
  const hasJit = Array.isArray(store.jitAccessGrants) && store.jitAccessGrants.some(grant =>
    grant.userId === context.userId &&
    grant.applicationId === (request.applicationId || context.applicationId) &&
    grant.status === 'ACTIVE' &&
    grant.expiresAt &&
    new Date(grant.expiresAt).getTime() > Date.now()
  );
  if (!roleAllowed(context.role, API_CONSOLE_POLICY.canExecuteProduction) && !hasJit) {
    return { allowed: false, category: 'AUTHENTICATION_ERROR', message: 'Production execution requires elevated permission یا JIT access فعال.' };
  }
  if (request.classification.type === 'CORE_COMMAND') {
    if (!roleAllowed(context.role, API_CONSOLE_POLICY.canExecuteProductionCommand) && !hasJit) {
      return { allowed: false, category: 'AUTHENTICATION_ERROR', message: 'Production Core Command execution requires elevated permission یا JIT access فعال.' };
    }
    if (!options?.productionCommandConfirmed || !options.businessJustification?.trim()) {
      return { allowed: false, category: 'CORE_VALIDATION_ERROR', message: 'Production Core Command requires confirmation and business justification.' };
    }
    if (dualApprovalRequired() && !findActiveDualApproval(request.id, context.userId)) {
      return {
        allowed: false,
        category: 'CORE_VALIDATION_ERROR',
        message: 'Production Core Command requires an approved dual-approval grant for this request and user.',
      };
    }
  }
  const forbidInsecureTls = orgPolicies.forbidInsecureTlsInProduction !== false;
  if (forbidInsecureTls && !request.tls.verifyCertificate) {
    return { allowed: false, category: 'TLS_ERROR', message: 'Insecure TLS is prohibited in production environments.' };
  }
  const executionMode = options?.executionMode || request.executionMode;
  if (orgPolicies.forbidExactModeInProduction !== false && executionMode === 'EXACT') {
    return { allowed: false, category: 'CORE_VALIDATION_ERROR', message: 'EXACT execution mode is prohibited in production environments.' };
  }
  return { allowed: true };
}

function bashQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function cmdQuote(value) {
  const escaped = String(value).replace(/([&|<>^%!])/g, '^$1').replace(/"/g, '^"');
  return `"${escaped}"`;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function formatCurlValue(value, dialect) {
  if (dialect === 'windows-cmd') return cmdQuote(value);
  if (dialect === 'powershell') return psQuote(value);
  return bashQuote(value);
}

function lineContinuation(dialect) {
  if (dialect === 'windows-cmd') return ' ^\n  ';
  if (dialect === 'powershell') return ' `\n  ';
  return ' \\\n  ';
}

function sensitiveExportValue(name, value, exposeSecrets) {
  if (exposeSecrets || !isSensitiveName(name)) return value;
  const normalized = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `{{${normalized || 'secret'}}}`;
}

function exportRequestAsCurl(request, dialect, exposeSecrets = false) {
  const continuation = lineContinuation(dialect);
  const curl = dialect === 'windows-cmd' ? 'curl.exe' : 'curl';
  const parts = [curl, '-X', request.method, formatCurlValue(buildUrlWithQuery(request.urlTemplate, request.queryParameters || []), dialect)];
  requestHeadersWithBodyContentType(request)
    .forEach(header => {
      const value = sensitiveExportValue(header.name, header.valueTemplate, exposeSecrets);
      parts.push('-H', formatCurlValue(`${header.name}: ${value}`, dialect));
    });
  const enabledCookies = (request.cookies || []).filter(cookie => cookie.enabled);
  if (enabledCookies.length) {
    const cookieValue = enabledCookies
      .map(cookie => `${cookie.name}=${sensitiveExportValue(cookie.name, cookie.valueReference, exposeSecrets)}`)
      .join('; ');
    parts.push('-b', formatCurlValue(cookieValue, dialect));
  }
  if (request.bodyType !== 'none' && request.bodyTemplate) {
    parts.push('--data-raw', formatCurlValue(sanitizeText(request.bodyTemplate), dialect));
  }
  if (!request.tls.verifyCertificate) parts.push('--insecure');

  const grouped = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === '-X' || part === '-H' || part === '-b' || part === '--data-raw') {
      grouped.push(`${part} ${parts[i + 1]}`);
      i += 1;
    } else {
      grouped.push(part);
    }
  }
  return grouped.join(continuation);
}

function postmanSafeValue(name, value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (isSecretReference(text)) return '{{secret}}';
  if (isSensitiveName(name)) return maskValue(text);
  return sanitizeText(text).replace(/secret:\/\/api-console\/[0-9a-f-]+/gi, '{{secret}}');
}

function postmanSafeJsonValue(value, key = '') {
  if (Array.isArray(value)) return value.map(item => postmanSafeJsonValue(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, postmanSafeJsonValue(childValue, childKey)]));
  }
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return postmanSafeValue(key, value);
  return isSensitiveName(key) ? postmanSafeValue(key, value) : value;
}

function postmanSafeBodyRaw(request) {
  const raw = String(request.bodyTemplate || '');
  if (!raw) return '';
  if (request.bodyType === 'json') {
    const parsed = parseJsonSafely(raw);
    if (parsed.ok) return JSON.stringify(postmanSafeJsonValue(parsed.value), null, 2);
  }
  if (request.bodyType === 'form-urlencoded') {
    const params = new URLSearchParams(raw);
    const safe = new URLSearchParams();
    for (const [key, value] of params.entries()) safe.append(key, postmanSafeValue(key, value));
    return safe.toString();
  }
  return sanitizeText(raw).replace(/secret:\/\/api-console\/[0-9a-f-]+/gi, '{{secret}}');
}

function parsePostmanBodyPairs(raw) {
  return String(raw || '')
    .split(/\r?\n|&/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const eq = line.indexOf('=');
      const key = eq >= 0 ? line.slice(0, eq) : line;
      const value = eq >= 0 ? line.slice(eq + 1) : '';
      return { key, value: postmanSafeValue(key, value), type: 'text' };
    });
}

function postmanBodyFromRequest(request) {
  if (request.bodyType === 'none' || !request.bodyTemplate) return undefined;
  if (request.bodyType === 'multipart') {
    return {
      mode: 'formdata',
      formdata: parsePostmanBodyPairs(request.bodyTemplate),
    };
  }
  if (request.bodyType === 'form-urlencoded') {
    const params = new URLSearchParams(request.bodyTemplate || '');
    return {
      mode: 'urlencoded',
      urlencoded: Array.from(params.entries()).map(([key, value]) => ({
        key,
        value: postmanSafeValue(key, value),
        type: 'text',
      })),
    };
  }
  const language = request.bodyType === 'json' ? 'json' : request.bodyType === 'xml' ? 'xml' : 'text';
  return {
    mode: 'raw',
    raw: postmanSafeBodyRaw(request),
    options: {
      raw: { language },
    },
  };
}

function safeQueryParametersForPostman(request) {
  return (request.queryParameters || [])
    .filter(param => param.enabled && param.name)
    .map(param => ({
      key: param.name,
      value: param.sensitive ? postmanSafeValue(param.name, param.value) : postmanSafeValue('', param.value),
    }));
}

function postmanUrlFromRequest(request) {
  const queryParams = safeQueryParametersForPostman(request);
  const rawUrl = buildUrlWithQuery(request.urlTemplate, queryParams.map(param => ({
    name: param.key,
    value: param.value,
    enabled: true,
  })));
  try {
    const parsed = new URL(rawUrl);
    const url = {
      raw: rawUrl,
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname.split('.'),
      path: parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent),
    };
    if (queryParams.length) url.query = queryParams;
    return url;
  } catch {
    return queryParams.length ? { raw: rawUrl, query: queryParams } : { raw: rawUrl };
  }
}

function postmanHeadersFromRequest(request) {
  const headers = requestHeadersWithBodyContentType(request)
    .filter(header => header.enabled !== false)
    .map(header => ({
      key: header.name,
      value: header.sensitive ? (header.maskedValue || postmanSafeValue(header.name, header.valueTemplate)) : postmanSafeValue('', header.valueTemplate),
    }));
  const cookies = (request.cookies || []).filter(cookie => cookie.enabled);
  if (cookies.length) {
    headers.push({
      key: 'Cookie',
      value: cookies.map(cookie => `${cookie.name}=${cookie.sensitive ? (cookie.maskedValue || postmanSafeValue(cookie.name, cookie.valueReference)) : postmanSafeValue('', cookie.valueReference)}`).join('; '),
    });
  }
  return headers;
}

function postmanItemFromRequest(request) {
  const postmanRequest = {
    method: request.method,
    header: postmanHeadersFromRequest(request),
    url: postmanUrlFromRequest(request),
  };
  const body = postmanBodyFromRequest(request);
  if (body) postmanRequest.body = body;
  return {
    name: request.name || `${request.method} ${request.urlTemplate}`,
    request: postmanRequest,
    response: [],
  };
}

function nestPostmanItemsByFolder(requests) {
  const root = [];
  const folderNodes = new Map();

  function ensureFolder(pathParts) {
    if (!pathParts.length) return root;
    const key = pathParts.join('\u0000');
    if (folderNodes.has(key)) return folderNodes.get(key).item;
    const node = { name: pathParts[pathParts.length - 1], item: [] };
    folderNodes.set(key, node);
    const parentItems = ensureFolder(pathParts.slice(0, -1));
    parentItems.push(node);
    return node.item;
  }

  requests.forEach(request => {
    const pathParts = Array.isArray(request.folderPath)
      ? request.folderPath.map(part => String(part || '').trim()).filter(Boolean)
      : [];
    const bucket = ensureFolder(pathParts);
    bucket.push(postmanItemFromRequest(request));
  });
  return root;
}

function postmanIdFromCollection(collection) {
  const match = String(collection.id || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : randomUUID();
}

function postmanFileName(collection) {
  return `${String(collection.name || 'api-console-collection').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'api-console-collection'}.postman_collection.json`;
}

function buildPostmanCollectionExport(collection, requests) {
  const postmanId = postmanIdFromCollection(collection);
  return {
    fileName: postmanFileName(collection),
    requestCount: requests.length,
    collection: {
      info: {
        _postman_id: postmanId,
        name: collection.name || 'API Console Collection',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        _exporter_id: 'UTMS-Online-API-Console',
        _collection_link: `utms://api-console/collections/${collection.id}`,
      },
      item: nestPostmanItemsByFolder(requests),
    },
  };
}

function enabledDocumentationRows(rows) {
  return (rows || []).filter(row => row.enabled !== false && !row.deprecated).sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name));
}

function documentationRequestExample(request, inputParameters) {
  const raw = String(request.bodyTemplate || '');
  if (!raw) return '';
  if (request.bodyType === 'json') {
    const parsed = parseJsonSafely(raw);
    if (parsed.ok) return JSON.stringify(sanitizeDocumentationJsonValue(parsed.value, '', inputParameters), null, 2);
  }
  if (request.bodyType === 'form-urlencoded') {
    const params = new URLSearchParams(raw);
    for (const key of Array.from(params.keys())) {
      const metadata = inputParameters.find(row => row.name === key);
      if (isSensitiveName(key) || isSecretReference(params.get(key))) params.set(key, metadata?.exampleValue || '****');
    }
    return params.toString();
  }
  return sanitizeText(raw).replace(/secret:\/\/api-console\/[0-9a-f-]+/gi, '****');
}

function documentationCurlExample(request, metadata, inputParameters) {
  if (metadata.curlExample) return sanitizeDocumentationCurl(metadata.curlExample);
  const safeQueryParameters = (request.queryParameters || []).map(parameter => {
    const row = inputParameters.find(item => item.location === 'QUERY' && item.name === parameter.name);
    return {
      ...parameter,
      value: parameter.sensitive || isSensitiveName(parameter.name) || isSecretReference(parameter.value)
        ? (row?.exampleValue || '****')
        : parameter.value,
    };
  });
  const url = cleanDocumentationUrl(buildUrlWithQuery(request.urlTemplate, safeQueryParameters));
  const parts = [`curl --request ${request.method}`, `--url ${url}`];
  enabledDocumentationRows(metadata.headerParameters).forEach(header => {
    if (String(header.name).toLowerCase() === 'content-length') return;
    const sourceHeader = documentedRequestHeaders(request).find(item => String(item.name).toLowerCase() === String(header.name).toLowerCase());
    const sensitive = isSensitiveName(header.name) || sourceHeader?.sensitive;
    const value = sensitive
      ? (header.exampleValue || sourceHeader?.maskedValue || '****')
      : (header.exampleValue || sourceHeader?.valueTemplate || header.dataType || '—');
    parts.push(`--header ${bashQuote(`${header.name}: ${value}`)}`);
  });
  const body = documentationRequestExample(request, inputParameters);
  if (body) parts.push(`--data ${bashQuote(body)}`);
  return sanitizeDocumentationCurl(parts.join(' \\\n  '));
}

function buildDocumentationViewModel(request, executions, manualExamples, generatedAt = nowIso()) {
  const metadata = refreshDocumentationMetadata(request, executions, manualExamples);
  const evidence = latestDocumentationEvidence(request, executions, manualExamples);
  const headers = enabledDocumentationRows(metadata.headerParameters);
  const inputs = enabledDocumentationRows(metadata.inputParameters);
  const outputs = enabledDocumentationRows(metadata.outputParameters);
  const responseExample = metadata.responseExample || sanitizeDocumentationResponseExample(evidence.responseText, outputs);
  const curlExample = documentationCurlExample(request, metadata, inputs);
  return {
    requestId: request.id,
    generatedAt,
    title: metadata.title,
    serviceIntroduction: metadata.serviceIntroduction || 'ثبت نشده است',
    baseUrl: metadata.baseUrl,
    endpoint: cleanDocumentationUrl(request.urlTemplate),
    operationPath: metadata.operationPath,
    method: request.method,
    organizationName: metadata.organizationName,
    departmentName: metadata.departmentName,
    documentRevision: metadata.documentRevision,
    documentDate: metadata.documentDate,
    generationDate: new Date(generatedAt).toLocaleDateString('fa-IR'),
    headers,
    inputs,
    outputs,
    authentication: metadata.authenticationDocumentation,
    responseCodes: normalizeResponseCodes(metadata.responseCodes).filter(row => row.enabled),
    curlExample,
    responseExample,
    rawRequestExample: request.bodyType !== 'none' ? documentationRequestExample(request, inputs) : '',
    requestBodyType: request.bodyType,
    requestContentType: requestBodyContentType(requestBodyFromDefinition(request)),
    hasResponseEvidence: !!evidence.responseText,
  };
}

function markdownCell(value) {
  const text = String(value ?? '').trim() || '—';
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function markdownTable(headers, rows) {
  const normalizedRows = rows.length ? rows : [headers.map((_, index) => index === headers.length - 1 ? 'ثبت نشده است' : '—')];
  return [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...normalizedRows.map(row => `| ${row.map(markdownCell).join(' | ')} |`),
  ].join('\n');
}

function addressRows(view) {
  return [
    ['۱', 'URL', view.endpoint || '—'],
    ['۲', 'Method', view.method || '—'],
  ];
}

function headerRows(rows) {
  return enabledDocumentationRows(rows).map((row, index) => [
    String(index + 1), row.name, row.exampleValue || row.dataType || '—', row.description || '—',
  ]);
}

function inputRows(rows) {
  return enabledDocumentationRows(rows).map((row, index) => [
    String(index + 1), row.name, row.dataType || 'unknown', requiredStatusLabel(row.required), row.description || '—',
  ]);
}

function outputParameterGroups(rows) {
  const groups = new Map();
  enabledDocumentationRows(rows).forEach(row => {
    const parentPath = row.parentPath || '';
    if (!groups.has(parentPath)) groups.set(parentPath, []);
    groups.get(parentPath).push(row);
  });
  return Array.from(groups.entries())
    .map(([parentPath, parameters]) => ({
      parentPath,
      titlePath: parentPath.replace(/\[\]/g, ''),
      parameters,
      displayOrder: Math.min(...parameters.map(row => row.displayOrder)),
    }))
    .sort((left, right) => {
      if (!left.parentPath) return -1;
      if (!right.parentPath) return 1;
      return left.displayOrder - right.displayOrder || left.parentPath.localeCompare(right.parentPath);
    });
}

function relativeOutputParameterName(name, parentPath) {
  if (!parentPath) return name;
  const prefix = `${parentPath}.`;
  return String(name).startsWith(prefix) ? String(name).slice(prefix.length) : name;
}

function outputRows(rows, parentPath = '') {
  return enabledDocumentationRows(rows).map((row, index) => [
    String(index + 1), relativeOutputParameterName(row.name, parentPath), row.dataType || 'unknown', row.description || '—',
  ]);
}

function allowedValueRows(parameter) {
  return (parameter.allowedValues || [])
    .filter(item => item.enabled !== false)
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map(item => [item.value || '—', item.description || '—']);
}

function outputAllowedValueTitle(parameter) {
  return String(parameter.name || '').split('.').at(-1)?.replace(/\[\]$/g, '') || parameter.name;
}

function markdownOutputParameterSections(rows) {
  const sections = [];
  const groups = outputParameterGroups(rows);
  if (!groups.length) {
    return [
      '### پارامترهای خروجی', '',
      markdownTable(['ردیف', 'نام پارامتر', 'نوع', 'توضیحات'], []), '',
    ];
  }
  groups.forEach(group => {
    sections.push(
      group.parentPath ? `### پارامترهای خروجی ${group.titlePath}:` : '### پارامترهای خروجی', '',
      markdownTable(['ردیف', 'نام پارامتر', 'نوع', 'توضیحات'], outputRows(group.parameters, group.parentPath)), ''
    );
    group.parameters.forEach(parameter => {
      const values = allowedValueRows(parameter);
      if (!values.length) return;
      sections.push(
        `#### مقادیر مجاز برای فیلد ${outputAllowedValueTitle(parameter)}:`, '',
        markdownTable(['کد', 'توضیحات'], values), ''
      );
    });
  });
  return sections;
}

function generateDocumentationMarkdown(request, executions, manualExamples, generatedBy) {
  const generatedAt = nowIso();
  const view = buildDocumentationViewModel(request, executions, manualExamples, generatedAt);
  const warnings = [];
  if (!view.hasResponseEvidence && !request.documentation?.responseExample) warnings.push('نمونه پاسخ موفق ثبت نشده است.');
  if ((request.cookies || []).some(cookie => cookie.sensitive)) warnings.push('Cookieهای نشست از مستندات حذف شده‌اند.');
  const docs = [
    '# مستندات بهره برداری',
    '',
    `## «${view.title}»`,
    '',
    `- سازمان: ${view.organizationName}`,
    `- واحد سازمانی: ${view.departmentName}`,
    `- ویرایش سند: ${view.documentRevision}`,
    `- تاریخ سند: ${view.documentDate}`,
    `- تاریخ تولید: ${view.generationDate}`,
    '',
  ];

  if (view.authentication?.enabled) {
    const auth = view.authentication;
    docs.push(
      '# مقدمه سرویس احراز هویت', '',
      `Base url: ${auth.baseUrl || '—'}`, '',
      auth.introduction || 'ثبت نشده است', '',
      '# سرویس احراز هویت', '',
      '## ورودی ها', '',
      '### ادرس و متد درخواست', '',
      markdownTable(['ردیف', 'نام پارامتر', 'توضیحات'], [
        ['۱', 'URL', auth.endpoint || '—'], ['۲', 'Method', auth.method || '—'],
      ]), '',
      '### پارامتر های سرایند', '',
      markdownTable(['ردیف', 'نام پارامتر', 'نوع یا مقدار نمونه', 'توضیحات'], headerRows(auth.headerParameters)), '',
      '### پارامتر های ورودی', '',
      markdownTable(['ردیف', 'نام پارامتر', 'نوع', 'الزامی', 'توضیحات'], inputRows(auth.inputParameters)), '',
      '## خروجی ها', '',
      ...markdownOutputParameterSections(auth.outputParameters),
      '## نمونه فراخوانی سرویس احراز هویت', '', '```bash', auth.curlExample || 'ثبت نشده است', '```', '',
      '## نمونه تست سرویس احراز هویت', '', '```json', auth.responseExample || 'ثبت نشده است', '```', ''
    );
  }

  docs.push(
    `# مقدمه دسترسی به استعلام جزئیات وب سرویس ${view.title}`, '',
    `Base url: ${view.baseUrl || '—'}`, '',
    view.serviceIntroduction, '',
    `# جزئیات وب سرویس ${view.title}`, '',
    '## ورودی ها', '',
    '### ادرس و متد درخواست', '',
    markdownTable(['ردیف', 'نام پارامتر', 'توضیحات'], addressRows(view)), '',
    '### پارامتر های سرایند', '',
    markdownTable(['ردیف', 'نام پارامتر', 'نوع یا مقدار نمونه', 'توضیحات'], headerRows(view.headers)), '',
    '### پارامتر های ورودی', '',
    markdownTable(['ردیف', 'نام پارامتر', 'نوع', 'الزامی', 'توضیحات'], inputRows(view.inputs)), ''
  );
  if (view.rawRequestExample && view.requestBodyType !== 'json') {
    docs.push('### نمونه بدنه درخواست', '', '```text', view.rawRequestExample, '```', '');
  }
  docs.push(
    '## خروجی ها', '',
    ...markdownOutputParameterSections(view.outputs),
    `## نمونه فراخوانی دریافت جزئیات وب سرویس ${view.title}`, '',
    '```bash', view.curlExample || 'ثبت نشده است', '```', '',
    `## نمونه تست موفق دریافت جزئیات وب سرویس ${view.title}`, '',
    '```json', view.responseExample || 'ثبت نشده است', '```', '',
    `# پیوست – مرجع کدهای پاسخ و خطا وب سرویس ${view.title}`, '',
    `## کدهای پاسخ HTTPS وب سرویس ${view.title}`, '',
    markdownTable(['Code', 'Message', 'توضیحات'], view.responseCodes.map(row => [String(row.code), row.message, row.description])), '',
    `تولیدکننده سند: ${generatedBy}`,
    `زمان تولید: ${generatedAt}`,
    ''
  );
  return {
    requestId: request.id,
    generatedAt,
    generatedBy,
    approved: false,
    markdown: docs.join('\n'),
    warnings,
  };
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new ApiConsoleError('INTERNAL_EXECUTION_ERROR', 'DOCX template central directory was not found.');
}

function readZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const total = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let offset = centralOffset;
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new ApiConsoleError('INTERNAL_EXECUTION_ERROR', 'Invalid DOCX central directory.');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const modTime = buffer.readUInt16LE(offset + 12);
    const modDate = buffer.readUInt16LE(offset + 14);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttrs = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ApiConsoleError('INTERNAL_EXECUTION_ERROR', `Invalid DOCX local header for ${name}.`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressedData = buffer.slice(dataStart, dataStart + compressedSize);
    entries.push({ name, flags, method, modTime, modDate, crc, compressedSize, uncompressedSize, externalAttrs, compressedData });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inflateZipEntry(entry) {
  if (entry.method === 0) return entry.compressedData;
  if (entry.method === 8) return zlib.inflateRawSync(entry.compressedData);
  throw new ApiConsoleError('INTERNAL_EXECUTION_ERROR', `Unsupported DOCX compression method ${entry.method}.`);
}

function makeZipEntry(name, data, templateEntry) {
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const compressedData = zlib.deflateRawSync(raw);
  return {
    name,
    flags: 0x0800,
    method: 8,
    modTime: templateEntry?.modTime || 0,
    modDate: templateEntry?.modDate || 0,
    crc: crc32(raw),
    compressedSize: compressedData.length,
    uncompressedSize: raw.length,
    externalAttrs: templateEntry?.externalAttrs || 0,
    compressedData,
  };
}

function writeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags || 0, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(entry.modTime || 0, 10);
    local.writeUInt16LE(entry.modDate || 0, 12);
    local.writeUInt32LE(entry.crc >>> 0, 14);
    local.writeUInt32LE(entry.compressedSize >>> 0, 18);
    local.writeUInt32LE(entry.uncompressedSize >>> 0, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, entry.compressedData);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags || 0, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt16LE(entry.modTime || 0, 12);
    central.writeUInt16LE(entry.modDate || 0, 14);
    central.writeUInt32LE(entry.crc >>> 0, 16);
    central.writeUInt32LE(entry.compressedSize >>> 0, 20);
    central.writeUInt32LE(entry.uncompressedSize >>> 0, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.externalAttrs || 0, 38);
    central.writeUInt32LE(offset >>> 0, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + entry.compressedData.length;
  }
  const centralOffset = offset;
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length >>> 0, 12);
  eocd.writeUInt32LE(centralOffset >>> 0, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

function docxRun(text, options = {}) {
  const font = options.font || (options.ltr ? 'Consolas' : 'B Nazanin');
  const size = options.size || 24;
  const bold = options.bold ? '<w:b/><w:bCs/>' : '';
  const direction = options.ltr ? '<w:rtl w:val="0"/>' : '<w:rtl/>';
  return `<w:r><w:rPr><w:rFonts w:ascii="${xmlEscape(font)}" w:hAnsi="${xmlEscape(font)}" w:cs="${xmlEscape(font)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${direction}${bold}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function docxParagraph(text, options = {}) {
  const style = options.style ? `<w:pStyle w:val="${xmlEscape(options.style)}"/>` : '';
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : `<w:jc w:val="${options.ltr ? 'left' : 'right'}"/>`;
  const spacing = options.after === undefined ? '<w:spacing w:after="120"/>' : `<w:spacing w:after="${options.after}"/>`;
  const direction = options.ltr ? '<w:bidi w:val="0"/>' : '<w:bidi/>';
  const keepNext = options.keepNext ? '<w:keepNext/>' : '';
  const pageBreakBefore = options.pageBreakBefore ? '<w:pageBreakBefore/>' : '';
  return `<w:p><w:pPr>${direction}${style}${spacing}${align}${keepNext}${pageBreakBefore}</w:pPr>${docxRun(text, options)}</w:p>`;
}

function docxPageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function docxCodeBlock(value) {
  const lines = String(value || '-').split(/\r?\n/);
  const runs = [];
  lines.forEach((line, index) => {
    if (index) runs.push('<w:br/>');
    runs.push(`<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`);
  });
  return `<w:p><w:pPr><w:bidi w:val="0"/><w:spacing w:before="80" w:after="180"/><w:jc w:val="left"/><w:keepLines/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:rtl w:val="0"/><w:noProof/></w:rPr>${runs.join('')}</w:r></w:p>`;
}

function docxCell(content, options = {}) {
  const fill = options.header ? '<w:shd w:fill="D9EAF7"/>' : '';
  const text = Array.isArray(content) ? content.join('\n') : String(content ?? '-');
  const ltr = options.ltr ?? (/^(?:https?:\/\/|[A-Za-z0-9_.\[\]{}:/?&=+*'-]+)$/u.test(text) && !/[\u0600-\u06FF]/u.test(text));
  return `<w:tc><w:tcPr><w:tcW w:w="${options.width || 2400}" w:type="dxa"/>${fill}<w:vAlign w:val="center"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>${docxParagraph(text || '—', { bold: options.header, size: options.header ? 21 : 20, after: 0, ltr, align: ltr ? 'left' : 'right', font: ltr ? 'Arial' : 'B Nazanin' })}</w:tc>`;
}

function docxTable(rows, options = {}) {
  const border = '<w:tblBorders><w:top w:val="single" w:sz="6" w:color="8EAADB"/><w:left w:val="single" w:sz="6" w:color="8EAADB"/><w:bottom w:val="single" w:sz="6" w:color="8EAADB"/><w:right w:val="single" w:sz="6" w:color="8EAADB"/><w:insideH w:val="single" w:sz="4" w:color="D9E2F3"/><w:insideV w:val="single" w:sz="4" w:color="D9E2F3"/></w:tblBorders>';
  const widths = options.widths || [];
  const body = rows.map((row, rowIndex) => {
    const rowProperties = rowIndex === 0 ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>';
    return `<w:tr>${rowProperties}${row.map((cell, columnIndex) => docxCell(cell, { header: rowIndex === 0, width: widths[columnIndex] })).join('')}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/>${border}<w:tblLook w:firstRow="1" w:noHBand="0" w:noVBand="1"/></w:tblPr>${body}</w:tbl><w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>`;
}

function prettyJsonText(text) {
  const parsed = parseJsonSafely(text || '');
  return parsed.ok ? JSON.stringify(parsed.value, null, 2) : String(text || '-');
}

function requestDocxRows(view) {
  return [
    ['ردیف', 'نام پارامتر', 'توضیحات'],
    ...addressRows(view),
  ];
}

function headerRowsForDocx(rows) {
  const values = headerRows(rows);
  return [
    ['ردیف', 'نام پارامتر', 'نوع یا مقدار نمونه', 'توضیحات'],
    ...(values.length ? values : [['—', '—', '—', 'ثبت نشده است']]),
  ];
}

function inputRowsForDocx(rows) {
  const values = inputRows(rows);
  return [
    ['ردیف', 'نام پارامتر', 'نوع', 'الزامی', 'توضیحات'],
    ...(values.length ? values : [['—', '—', '—', 'نامشخص', 'ثبت نشده است']]),
  ];
}

function outputRowsForDocx(rows, parentPath = '') {
  const values = outputRows(rows, parentPath);
  return [
    ['ردیف', 'نام پارامتر', 'نوع', 'توضیحات'],
    ...(values.length ? values : [['—', '—', '—', 'ثبت نشده است']]),
  ];
}

function allowedValueRowsForDocx(parameter) {
  const values = allowedValueRows(parameter);
  return [
    ['کد', 'توضیحات'],
    ...(values.length ? values : [['—', 'ثبت نشده است']]),
  ];
}

function responseCodeRowsForDocx(rows) {
  return [
    ['Code', 'Message', 'توضیحات'],
    ...rows.map(row => [String(row.code), row.message || '—', row.description || '—']),
  ];
}

function docxHeading(text, level = 1, options = {}) {
  const size = level === 1 ? 30 : level === 2 ? 27 : level === 3 ? 24 : 22;
  return docxParagraph(text, { style: `Heading${level}`, bold: true, size, font: 'B Titr', keepNext: true, ...options });
}

function docxOutputParameterSections(rows) {
  const groups = outputParameterGroups(rows);
  if (!groups.length) {
    return `${docxHeading('پارامترهای خروجی', 3)}${docxTable(outputRowsForDocx([]), { widths: [650, 2200, 1500, 4200] })}`;
  }
  return groups.map(group => {
    const section = [
      docxHeading(group.parentPath ? `پارامترهای خروجی ${group.titlePath}:` : 'پارامترهای خروجی', 3),
      docxTable(outputRowsForDocx(group.parameters, group.parentPath), { widths: [650, 2200, 1500, 4200] }),
    ];
    group.parameters.forEach(parameter => {
      if (!allowedValueRows(parameter).length) return;
      section.push(
        docxHeading(`مقادیر مجاز برای فیلد ${outputAllowedValueTitle(parameter)}:`, 4),
        docxTable(allowedValueRowsForDocx(parameter), { widths: [1800, 6500] })
      );
    });
    return section.join('');
  }).join('');
}

function docxTableOfContents() {
  return [
    docxParagraph('فهرست مطالب', { style: 'TOCHeading', bold: true, size: 30, font: 'B Titr', keepNext: true }),
    '<w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>',
    '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>',
    '<w:r><w:instrText xml:space="preserve"> TOC \\o &quot;1-3&quot; \\h \\z \\u </w:instrText></w:r>',
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    docxRun('برای نمایش شماره صفحات، فهرست را در Microsoft Word به‌روزرسانی کنید.'),
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
  ].join('');
}

function forceA4SectionProperties(sectPr) {
  let next = String(sectPr || '');
  if (/<w:pgSz\b[^>]*\/>/.test(next)) {
    next = next.replace(/<w:pgSz\b[^>]*\/>/, '<w:pgSz w:w="11906" w:h="16838"/>');
  } else {
    next = next.replace(/<w:sectPr([^>]*)>/, '<w:sectPr$1><w:pgSz w:w="11906" w:h="16838"/>');
  }
  if (/<w:pgMar\b[^>]*\/>/.test(next)) {
    next = next.replace(/<w:pgMar\b[^>]*\/>/, '<w:pgMar w:top="1440" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/>');
  }
  return next;
}

function docxAuthenticationSection(authentication) {
  if (!authentication?.enabled) return '';
  const address = {
    endpoint: authentication.endpoint,
    method: authentication.method,
  };
  return [
    docxHeading('مقدمه سرویس احراز هویت', 1),
    docxParagraph(`Base url: ${authentication.baseUrl || '—'}`, { ltr: true, font: 'Arial' }),
    docxParagraph(authentication.introduction || 'ثبت نشده است'),
    docxHeading('سرویس احراز هویت', 1),
    docxHeading('ورودی ها', 2),
    docxHeading('ادرس و متد درخواست', 3),
    docxTable(requestDocxRows(address), { widths: [700, 1800, 6500] }),
    docxHeading('پارامتر های سرایند', 3),
    docxTable(headerRowsForDocx(authentication.headerParameters), { widths: [650, 1800, 2500, 4000] }),
    docxHeading('پارامتر های ورودی', 3),
    docxTable(inputRowsForDocx(authentication.inputParameters), { widths: [600, 1700, 1300, 1100, 3800] }),
    docxHeading('خروجی ها', 2),
    docxOutputParameterSections(authentication.outputParameters),
    docxHeading('نمونه فراخوانی سرویس احراز هویت', 2),
    docxCodeBlock(authentication.curlExample || 'ثبت نشده است'),
    docxHeading('نمونه تست سرویس احراز هویت', 2),
    docxCodeBlock(authentication.responseExample || 'ثبت نشده است'),
  ].join('');
}

function templateCoverArtwork(templateXml) {
  const bodyMatch = String(templateXml || '').match(/<w:body>([\s\S]*?)<w:sectPr\b/);
  if (!bodyMatch) return '';
  const paragraphs = bodyMatch[1].match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
  return paragraphs.find(paragraph => paragraph.includes('<w:drawing>') && /r:embed="[^"]+"/.test(paragraph)) || '';
}

function buildDocxDocumentXml(templateXml, request, markdownResult, executions, manualExamples) {
  const bodyOpen = templateXml.indexOf('<w:body>');
  const start = bodyOpen >= 0
    ? templateXml.slice(0, bodyOpen + '<w:body>'.length)
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>';
  const sectMatch = templateXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  const sectPr = forceA4SectionProperties(sectMatch ? sectMatch[0] : '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1620" w:right="1016" w:bottom="720" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>');
  const view = buildDocumentationViewModel(request, executions, manualExamples, markdownResult.generatedAt);
  const coverArtwork = templateCoverArtwork(templateXml);

  const content = [
    coverArtwork,
    docxParagraph('مستندات بهره برداری', { align: 'center', bold: true, size: 36, font: 'B Titr', after: 0 }),
    docxParagraph(`«${view.title}»`, { align: 'center', bold: true, size: 32, font: 'B Titr', after: 0 }),
    docxParagraph(view.organizationName, { align: 'center', bold: true, size: 27, font: 'B Titr', after: 0 }),
    docxParagraph(view.departmentName, { align: 'center', bold: true, size: 24, font: 'B Titr', after: 0 }),
    docxParagraph(`ویرایش سند: ${view.documentRevision}`, { align: 'center', size: 24, font: 'B Nazanin' }),
    docxParagraph(`تاریخ سند: ${view.documentDate}`, { align: 'center', size: 22 }),
    docxParagraph(`تاریخ تولید: ${view.generationDate}`, { align: 'center', size: 22 }),
    docxPageBreak(),
    docxTableOfContents(),
    docxPageBreak(),
    docxAuthenticationSection(view.authentication),
    docxHeading(`مقدمه دسترسی به استعلام جزئیات وب سرویس ${view.title}`, 1),
    docxParagraph(`Base url: ${view.baseUrl || '—'}`, { ltr: true, font: 'Arial' }),
    docxParagraph(view.serviceIntroduction),
    docxHeading(`جزئیات وب سرویس ${view.title}`, 1),
    docxHeading('ورودی ها', 2),
    docxHeading('ادرس و متد درخواست', 3),
    docxTable(requestDocxRows(view), { widths: [700, 1800, 6500] }),
    docxHeading('پارامتر های سرایند', 3),
    docxTable(headerRowsForDocx(view.headers), { widths: [650, 1800, 2500, 4000] }),
    docxHeading('پارامتر های ورودی', 3),
    docxTable(inputRowsForDocx(view.inputs), { widths: [600, 1700, 1300, 1100, 3800] }),
    view.rawRequestExample && view.requestBodyType !== 'json'
      ? `${docxHeading('نمونه بدنه درخواست', 3)}${docxCodeBlock(view.rawRequestExample)}`
      : '',
    docxHeading('خروجی ها', 2),
    docxOutputParameterSections(view.outputs),
    docxHeading(`نمونه فراخوانی دریافت جزئیات وب سرویس ${view.title}`, 2),
    docxCodeBlock(view.curlExample || 'ثبت نشده است'),
    docxHeading(`نمونه تست موفق دریافت جزئیات وب سرویس ${view.title}`, 2),
    docxCodeBlock(view.responseExample || 'ثبت نشده است'),
    docxHeading(`پیوست – مرجع کدهای پاسخ و خطا وب سرویس ${view.title}`, 1),
    docxHeading(`کدهای پاسخ HTTPS وب سرویس ${view.title}`, 2),
    docxTable(responseCodeRowsForDocx(view.responseCodes), { widths: [1000, 2500, 5000] }),
  ].join('');

  return `${start}${content}${sectPr}</w:body></w:document>`;
}

function buildDocxFromTemplate(request, markdownResult, executions, manualExamples, templateFile = DOCX_TEMPLATE_FILE) {
  const templatePath = templateFile || DOCX_TEMPLATE_FILE;
  if (!fs.existsSync(templatePath)) {
    throw new ApiConsoleError('INTERNAL_EXECUTION_ERROR', `DOCX template not found: ${templatePath}`);
  }
  const templateBuffer = fs.readFileSync(templatePath);
  const entries = readZipEntries(templateBuffer);
  const documentEntry = entries.find(entry => entry.name === 'word/document.xml');
  if (!documentEntry) throw new ApiConsoleError('INTERNAL_EXECUTION_ERROR', 'DOCX template does not contain word/document.xml.');
  const templateXml = inflateZipEntry(documentEntry).toString('utf8');
  const documentXml = buildDocxDocumentXml(templateXml, request, markdownResult, executions, manualExamples);
  const updatedEntries = entries.map(entry => {
    if (entry.name === 'word/document.xml') return makeZipEntry(entry.name, documentXml, entry);
    if (entry.name === 'word/settings.xml') {
      const settingsXml = inflateZipEntry(entry).toString('utf8');
      const nextSettings = /<w:updateFields\b/.test(settingsXml)
        ? settingsXml.replace(/<w:updateFields\b[^>]*\/>/, '<w:updateFields w:val="true"/>')
        : settingsXml.replace('</w:settings>', '<w:updateFields w:val="true"/></w:settings>');
      return makeZipEntry(entry.name, nextSettings, entry);
    }
    return entry;
  });
  return writeZip(updatedEntries);
}

function docxFileName(request) {
  const raw = `${request.name || 'api-document'} ${request.documentation?.version || '1.0.0'}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return `${raw || 'api-document'}.docx`;
}

function createExecutionFromError(request, resolved, environment, context, error, businessJustification, scriptResults = []) {
  const category = error.category || 'INTERNAL_EXECUTION_ERROR';
  return createBlockedExecution(request, resolved.snapshot, environment, context.userId, category, error.message || 'Execution failed.', businessJustification, scriptResults);
}

function contextFromRequest(req, body) {
  if (req.utmsContext) return req.utmsContext;
  if (req.consoleContext) return req.consoleContext;
  if (!isLegacyContextEnabled()) return null;
  if (body?.context) return body.context;
  const encoded = req.headers['x-api-console-context'] || req.headers['x-utms-context'];
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(String(encoded), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function requireContext(req, body) {
  const context = contextFromRequest(req, body);
  if (!context?.userId || !context?.role) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'ActiveContext is required.', 401);
  }
  if (trackDirectoryContext(context)) saveStore(store);
  return context;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendRaw(res, statusCode, contentType, body, headers = {}) {
  const value = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': value.length,
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(value);
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  const details = error.details && typeof error.details === 'object'
    ? JSON.parse(JSON.stringify(error.details, (key, value) => {
      if (/password|cookie|token|secret/i.test(key)) return '[REDACTED]';
      return typeof value === 'string' ? sanitizeText(value) : value;
    }))
    : undefined;
  sendJson(res, statusCode, {
    error: {
      category: error.category || 'INTERNAL_EXECUTION_ERROR',
      message: sanitizeText(error.message || 'Internal API Console error.'),
      ...(details ? { details } : {}),
    },
  });
}

async function readJsonBody(req, maxBytes = LIMITS.requestBodyBytes) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new ApiConsoleError('REQUEST_TOO_LARGE', `Request body exceeded ${maxBytes} bytes.`, 413);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiConsoleError('CURL_PARSE_ERROR', 'Invalid JSON request body.');
  }
}

function getPathParts(pathname) {
  if (pathname.startsWith('/api/reports')) {
    return pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  }
  return pathname.replace(/^\/api\/api-console\/?/, '').split('/').filter(Boolean);
}

const RUNTIME_KINDS = new Set(['DEVELOPMENT', 'TEST', 'PRE_PRODUCTION', 'PRODUCTION']);
const DATA_SERVICE_AUTH_MODES = new Set(['NONE', 'BEARER', 'BASIC', 'TOKEN_ENDPOINT']);
const DEFAULT_RUNTIME_ORIGIN = 'https://soha.m.edus.ir';

function configuredDefaultRuntimeOrigins() {
  return Array.from(new Set(String(process.env.RUNTIME_DEFAULT_ORIGINS || DEFAULT_RUNTIME_ORIGIN)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)));
}

function runtimeKindLabel(kind) {
  return ({
    DEVELOPMENT: 'Development',
    TEST: 'Test',
    PRE_PRODUCTION: 'Pre-production',
    PRODUCTION: 'Production',
  })[kind] || 'Runtime';
}

function assertRuntimeProjectAccess(projectKey, context) {
  assertCdeAuthApproach(context);
  const key = String(projectKey || '').trim();
  if (!key) throw new ApiConsoleError('RUNTIME_PROJECT_REQUIRED', 'Runtime projectKey is required.', 422);
  assertApplicationInContext(key, context);
  return key;
}

function assertCdeAuthApproach(context) {
  if (context?.authApproach && context.authApproach !== 'CDE') {
    throw new ApiConsoleError(
      'CDE_APPROACH_REQUIRED',
      'CDE discovery and Runtime are only available for CDE sessions.',
      403,
      { authApproach: context.authApproach },
    );
  }
}

function canManageDevelopmentRuntimeProfiles(context) {
  return roleAllowed(context.role, API_CONSOLE_POLICY.canManageDevelopmentRuntimeProfiles);
}

function isSystemAdministratorContext(context) {
  return roleAllowed(context.role, API_CONSOLE_POLICY.canManageUsers);
}

function assertCanManageRuntimeProfile(context, kind) {
  if (isSystemAdministratorContext(context)) return;
  if (!canManageDevelopmentRuntimeProfiles(context) || kind !== 'DEVELOPMENT') {
    throw new ApiConsoleError(
      'AUTHENTICATION_ERROR',
      'Only System Admin or Tech Lead can manage Development Runtime origins.',
      403,
    );
  }
}

function normalizeRuntimeOriginList(input) {
  const raw = [];
  if (Array.isArray(input?.origins)) raw.push(...input.origins);
  if (input?.origin != null && input.origin !== '') raw.push(input.origin);
  const origins = [...new Set(raw
    .flatMap(value => String(value || '').split(/[\n,]+/))
    .map(value => value.trim())
    .filter(Boolean))];
  if (!origins.length) {
    throw new ApiConsoleError('RUNTIME_ORIGIN_REQUIRED', 'At least one Runtime origin is required.', 422);
  }
  return origins;
}

function normalizeRuntimeApplicationIdList(input, context, current = null) {
  const raw = [];
  if (Array.isArray(input?.applicationIds)) raw.push(...input.applicationIds);
  if (input?.applicationId != null && input.applicationId !== '') raw.push(input.applicationId);
  if (input?.projectKey != null && input.projectKey !== '') raw.push(input.projectKey);
  if (current?.applicationId) raw.push(current.applicationId);

  const expanded = [];
  for (const value of raw) {
    const token = String(value || '').trim();
    if (!token) continue;
    if (token === 'ALL') {
      const scope = contextApplicationIds(context).filter(id => id && id !== PERSONAL_APPLICATION_ID);
      if (!scope.length) {
        throw new ApiConsoleError('RUNTIME_PROJECT_REQUIRED', 'No accessible systems are available for ALL.', 422);
      }
      expanded.push(...scope);
      continue;
    }
    expanded.push(token);
  }

  const applicationIds = [...new Set(expanded.map(id => assertRuntimeProjectAccess(id, context)))];
  if (!applicationIds.length) {
    throw new ApiConsoleError('RUNTIME_PROJECT_REQUIRED', 'Runtime projectKey is required.', 422);
  }
  return applicationIds;
}

function runtimeProfileMutationInput(data, context, current = null) {
  const input = data && typeof data === 'object' ? data : {};
  const kind = String(input.kind || current?.kind || 'DEVELOPMENT').toUpperCase();
  assertCanManageRuntimeProfile(context, kind);
  if (isSystemAdministratorContext(context)) return input;

  const applicationIds = normalizeRuntimeApplicationIdList(input, context, current);
  const applicationId = current?.applicationId || applicationIds[0];
  if (current && applicationId !== current.applicationId) {
    throw new ApiConsoleError(
      'AUTHENTICATION_ERROR',
      'Non-administrators cannot move a Runtime Profile to another project.',
      403,
    );
  }

  const leadFields = new Set(['applicationId', 'applicationIds', 'projectKey', 'name', 'kind', 'origin', 'origins', 'rowVersion']);
  const protectedFields = Object.keys(input).filter(key => !leadFields.has(key));
  if (protectedFields.length) {
    throw new ApiConsoleError(
      'AUTHENTICATION_ERROR',
      'Tech Lead can only change the name and origin of a Development Runtime Profile.',
      403,
    );
  }

  return {
    applicationId,
    projectKey: applicationId,
    applicationIds,
    name: input.name ?? current?.name,
    kind: 'DEVELOPMENT',
    origin: input.origin ?? current?.origin,
    origins: input.origins,
  };
}

function createRuntimeProfilesFromInput(input, context) {
  const origins = normalizeRuntimeOriginList(input);
  const applicationIds = normalizeRuntimeApplicationIdList(input, context);
  const created = [];
  const skipped = [];

  for (const applicationId of applicationIds) {
    for (const origin of origins) {
      const profileInput = {
        ...input,
        applicationId,
        projectKey: applicationId,
        origin,
        kind: isSystemAdministratorContext(context) ? (input.kind || 'DEVELOPMENT') : 'DEVELOPMENT',
        name: input.name || undefined,
      };
      delete profileInput.origins;
      delete profileInput.applicationIds;
      const profile = normalizeRuntimeProfileInput(profileInput, context);
      const duplicate = store.runtimeProfiles.some(item =>
        item.applicationId === profile.applicationId
        && item.origin === profile.origin
        && item.kind === profile.kind
        && item.enabled !== false
      );
      if (duplicate) {
        skipped.push({ applicationId: profile.applicationId, origin: profile.origin, kind: profile.kind });
        continue;
      }
      store.runtimeProfiles.unshift(profile);
      audit('RUNTIME_PROFILE_CREATED', context, {
        profileId: profile.id,
        applicationId: profile.applicationId,
        origin: profile.origin,
      });
      created.push(runtimeProfileView(profile));
    }
  }

  if (!created.length) {
    throw new ApiConsoleError(
      'RUNTIME_PROFILE_DUPLICATE',
      'An active Runtime Profile with this project, origin, and kind already exists.',
      409,
      { skipped },
    );
  }
  saveStore(store);
  return { created, skipped, profiles: created };
}

function latestDiscovery(projectKey, originFilter) {
  return store.discoverySnapshots
    .filter(snapshot => snapshot.projectKey === projectKey && matchesOriginId(snapshot, originFilter === undefined ? null : originFilter))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
}

function runtimeProfileView(profile) {
  return {
    ...profile,
    dataService: profile.dataService ? {
      ...profile.dataService,
      authConfigured: Boolean(profile.dataService.authSecretRef || profile.dataService.authMode === 'NONE'),
      authSecretRef: undefined,
    } : undefined,
  };
}

function normalizeServiceId(value) {
  const serviceId = String(value || '').trim().toLowerCase();
  if (!serviceId) return '';
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(serviceId) || serviceId.includes('..')) {
    throw new ApiConsoleError('RUNTIME_SERVICE_ID_INVALID', 'projectServiceId must be a host-style service identifier.', 422);
  }
  return serviceId;
}

function normalizeDataServiceProfile(input, current = {}) {
  const data = input && typeof input === 'object' ? input : {};
  const authMode = String(data.authMode || current.authMode || 'NONE').toUpperCase();
  if (!DATA_SERVICE_AUTH_MODES.has(authMode)) {
    throw new ApiConsoleError('DATA_SERVICE_AUTH_INVALID', 'Unsupported Data Service authentication mode.', 422);
  }
  let baseUrl = String(data.baseUrl ?? current.baseUrl ?? '').trim();
  if (baseUrl) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ApiConsoleError('DATA_SERVICE_BASE_URL_INVALID', 'Data Service base URL is invalid.', 422);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new ApiConsoleError('DATA_SERVICE_BASE_URL_INVALID', 'Data Service base URL must use HTTPS and cannot contain credentials, query, or fragment.', 422);
    }
    baseUrl = parsed.toString().replace(/\/$/, '');
  }
  let authSecretRef = current.authSecretRef;
  if (Object.prototype.hasOwnProperty.call(data, 'authSecret')) {
    authSecretRef = data.authSecret ? rememberSecret(String(data.authSecret)) : undefined;
  }
  return {
    baseUrl,
    authMode,
    username: String(data.username ?? current.username ?? ''),
    tokenPath: String(data.tokenPath ?? current.tokenPath ?? '/auth/getToken'),
    authSecretRef,
    executionEnabled: Boolean(baseUrl && (authMode === 'NONE' || authSecretRef) && (authMode !== 'TOKEN_ENDPOINT' || String(data.username ?? current.username ?? '').trim())),
  };
}

function normalizeRuntimeProfileInput(data, context, current = null) {
  const applicationId = String(data.applicationId || data.projectKey || current?.applicationId || '').trim();
  assertRuntimeProjectAccess(applicationId, context);
  const kind = String(data.kind || current?.kind || 'DEVELOPMENT').toUpperCase();
  if (!RUNTIME_KINDS.has(kind)) throw new ApiConsoleError('RUNTIME_PROFILE_INVALID', 'Runtime environment kind is invalid.', 422);
  const normalized = normalizedProfile({
    ...current,
    ...data,
    id: current?.id || data.id || makeId('runtime-profile'),
    applicationId,
    projectKey: applicationId,
  });
  const projectServiceId = normalizeServiceId(data.projectServiceId ?? current?.projectServiceId);
  const latest = latestDiscovery(applicationId);
  const candidate = latest?.projectServiceIdCandidates?.find(item => String(item.value).toLowerCase() === projectServiceId);
  let evidence = data.serviceIdEvidence ?? current?.serviceIdEvidence;
  if (candidate && !evidence) evidence = candidate.evidence;
  if (projectServiceId && (!Array.isArray(evidence) || !evidence.length)) {
    throw new ApiConsoleError('RUNTIME_SERVICE_ID_EVIDENCE_REQUIRED', 'Evidence is required before approving projectServiceId.', 422);
  }
  const now = nowIso();
  return {
    id: normalized.id,
    applicationId,
    projectKey: applicationId,
    name: String(data.name ?? current?.name ?? `${applicationId} ${runtimeKindLabel(kind)}`).trim(),
    kind,
    origin: normalized.origin,
    originId: data.originId || current?.originId || resolveOriginId(context),
    coreBasePath: normalized.coreBasePath,
    loginPath: normalized.loginPath,
    appRefererPath: normalized.appRefererPath,
    runtimeServiceId: normalized.runtimeServiceId,
    projectServiceId: projectServiceId || undefined,
    serviceIdEvidence: projectServiceId ? safeClone(evidence) : [],
    serviceIdApprovedAt: projectServiceId ? (current?.projectServiceId === projectServiceId ? current.serviceIdApprovedAt : now) : undefined,
    serviceIdApprovedBy: projectServiceId ? context.userId : undefined,
    userSource: normalized.userSource,
    prostage: String(data.prostage ?? current?.prostage ?? (kind === 'DEVELOPMENT' ? 'develop' : '')).trim() || undefined,
    dataService: normalizeDataServiceProfile(data.dataService, current?.dataService),
    enabled: data.enabled === undefined ? current?.enabled !== false : data.enabled === true,
    rowVersion: makeId('row'),
    createdAt: current?.createdAt || now,
    createdBy: current?.createdBy || context.userId,
    updatedAt: now,
    updatedBy: context.userId,
  };
}

function ensureDefaultRuntimeProfiles(applicationId, context) {
  let changed = false;
  for (const origin of configuredDefaultRuntimeOrigins()) {
    let normalizedOrigin;
    try {
      normalizedOrigin = normalizedProfile({ origin }).origin;
    } catch (error) {
      throw new ApiConsoleError(
        'RUNTIME_DEFAULT_ORIGIN_INVALID',
        `RUNTIME_DEFAULT_ORIGINS contains an invalid or disallowed origin: ${origin}`,
        500,
        { cause: error?.category || error?.message },
      );
    }
    // A disabled profile is an explicit administrator decision and must not be recreated.
    if (store.runtimeProfiles.some(profile => profile.applicationId === applicationId && profile.origin === normalizedOrigin)) continue;
    const profile = normalizeRuntimeProfileInput({ applicationId, origin: normalizedOrigin }, context);
    profile.createdBy = 'SYSTEM_DEFAULT';
    profile.updatedBy = 'SYSTEM_DEFAULT';
    store.runtimeProfiles.push(profile);
    audit('RUNTIME_PROFILE_DEFAULT_PROVISIONED', { userId: 'SYSTEM_DEFAULT', role: 'SYSTEM' }, {
      applicationId,
      profileId: profile.id,
      origin: profile.origin,
    });
    changed = true;
  }
  if (changed) saveStore(store);
}

function findRuntimeProfile(profileId, context, options = {}) {
  const profile = store.runtimeProfiles.find(item => item.id === String(profileId));
  if (!profile || (!options.includeDisabled && profile.enabled === false)) {
    throw new ApiConsoleError('RUNTIME_PROFILE_NOT_FOUND', 'Runtime Profile was not found.', 404);
  }
  assertRuntimeProjectAccess(profile.applicationId, context);
  return profile;
}

function assertCanPromoteRuntimeProfile(context) {
  if (!roleAllowed(context.role, API_CONSOLE_POLICY.canManageProtectedEnvironments)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Protected environments require System Admin, Tech Lead or QA Lead.', 403);
  }
}

function promoteRuntimeProfile(profileId, targetKindInput, context) {
  assertCanPromoteRuntimeProfile(context);
  const targetKind = String(targetKindInput || '').trim().toUpperCase();
  if (!RUNTIME_KINDS.has(targetKind)) {
    throw new ApiConsoleError('RUNTIME_PROFILE_INVALID', 'Runtime environment kind is invalid.', 422);
  }
  const source = findRuntimeProfile(profileId, context);
  if (source.kind === targetKind) {
    throw new ApiConsoleError('RUNTIME_PROFILE_INVALID', 'Target kind must differ from the source Runtime Profile kind.', 422);
  }

  const hadSecret = Boolean(
    source.dataService?.authSecretRef
    || source.dataService?.clientSecret
    || source.dataService?.password
    || source.dataService?.authSecret
  );
  const dataServiceInput = {
    baseUrl: source.dataService?.baseUrl || '',
    authMode: source.dataService?.authMode || 'NONE',
    username: source.dataService?.username || '',
    tokenPath: source.dataService?.tokenPath || '/auth/getToken',
  };

  const existingTarget = store.runtimeProfiles.find(item =>
    item.id !== source.id
    && item.applicationId === source.applicationId
    && item.kind === targetKind
    && item.origin === source.origin
    && item.enabled !== false
  );

  const payload = {
    applicationId: source.applicationId,
    name: String(source.name || `${source.applicationId} ${runtimeKindLabel(source.kind)}`)
      .replace(new RegExp(`\\b${runtimeKindLabel(source.kind)}\\b`, 'i'), runtimeKindLabel(targetKind))
      .trim() || `${source.applicationId} ${runtimeKindLabel(targetKind)}`,
    kind: targetKind,
    origin: source.origin,
    coreBasePath: source.coreBasePath,
    loginPath: source.loginPath,
    appRefererPath: source.appRefererPath,
    runtimeServiceId: source.runtimeServiceId,
    projectServiceId: source.projectServiceId,
    serviceIdEvidence: safeClone(source.serviceIdEvidence || []),
    userSource: source.userSource,
    prostage: targetKind === 'DEVELOPMENT' ? (source.prostage || 'develop') : (source.prostage || undefined),
    dataService: dataServiceInput,
    enabled: true,
  };

  // Never carry secrets into the promoted profile; force re-entry when a secret existed.
  const sanitizedCurrent = existingTarget
    ? {
      ...existingTarget,
      dataService: existingTarget.dataService
        ? {
          ...existingTarget.dataService,
          authSecretRef: undefined,
          authSecret: undefined,
          clientSecret: undefined,
          password: undefined,
        }
        : undefined,
    }
    : null;

  const promoted = normalizeRuntimeProfileInput(payload, context, sanitizedCurrent);
  if (promoted.dataService) {
    promoted.dataService.authSecretRef = undefined;
    delete promoted.dataService.authSecret;
    delete promoted.dataService.clientSecret;
    delete promoted.dataService.password;
    if (hadSecret) {
      promoted.dataService.executionEnabled = false;
    } else {
      promoted.dataService.executionEnabled = Boolean(
        promoted.dataService.baseUrl
        && (promoted.dataService.authMode === 'NONE' || promoted.dataService.authSecretRef)
        && (promoted.dataService.authMode !== 'TOKEN_ENDPOINT' || String(promoted.dataService.username || '').trim())
      );
    }
  }

  const duplicate = store.runtimeProfiles.some(item =>
    item.id !== promoted.id
    && item.applicationId === promoted.applicationId
    && item.origin === promoted.origin
    && item.kind === promoted.kind
    && item.enabled !== false
  );
  if (duplicate) {
    throw new ApiConsoleError('RUNTIME_PROFILE_DUPLICATE', 'An active Runtime Profile with this project, origin, and kind already exists.', 409);
  }

  if (existingTarget) {
    store.runtimeProfiles[store.runtimeProfiles.indexOf(existingTarget)] = promoted;
  } else {
    store.runtimeProfiles.unshift(promoted);
  }

  audit('RUNTIME_PROFILE_PROMOTED', context, {
    profileId: promoted.id,
    sourceProfileId: source.id,
    applicationId: promoted.applicationId,
    sourceKind: source.kind,
    targetKind: promoted.kind,
    origin: promoted.origin,
  });
  saveStore(store);
  return runtimeProfileView(promoted);
}

function runtimeSessionIdentity(req, context) {
  const appSession = requireSession(req);
  const phone = normalizeCdeLoginName(context.user?.phoneNumber || appSession.userLoginName);
  if (!phone) throw new ApiConsoleError('RUNTIME_IDENTITY_REQUIRED', 'The connected CDE account does not expose a valid cellphone number.', 409);
  return { appSession, phone };
}

function discoveryPreview(current, previous) {
  const oldById = new Map((previous?.operations || []).map(operation => [operation.id, operation]));
  const nextById = new Map((current.operations || []).map(operation => [operation.id, operation]));
  const operations = current.operations.map(operation => ({
    ...operation,
    previewState: !oldById.has(operation.id)
      ? 'NEW'
      : oldById.get(operation.id).sourceFingerprint === operation.sourceFingerprint ? 'UNCHANGED' : 'CHANGED',
  }));
  const removed = (previous?.operations || [])
    .filter(operation => !nextById.has(operation.id))
    .map(operation => ({ ...operation, previewState: 'REMOVED' }));
  const all = [...operations, ...removed];
  return {
    operations,
    removedOperations: removed,
    counts: {
      new: all.filter(item => item.previewState === 'NEW').length,
      changed: all.filter(item => item.previewState === 'CHANGED').length,
      unchanged: all.filter(item => item.previewState === 'UNCHANGED').length,
      removed: removed.length,
      needsInput: operations.filter(item => item.schemaCompleteness === 'NEEDS_INPUT').length,
    },
  };
}

function discoverySourceFingerprint(operations) {
  const fingerprints = (Array.isArray(operations) ? operations : [])
    .map(item => String(item?.sourceFingerprint || ''))
    .sort();
  return createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex');
}

async function scanRuntimeDiscovery(req, projectKey, context) {
  assertCsrf(req);
  assertRuntimeProjectAccess(projectKey, context);
  const previous = latestDiscovery(projectKey);
  const collected = await collectProjectSourceFiles(req, projectKey);
  const discovered = discoverProjectSources(projectKey, collected.sources);
  const preview = discoveryPreview(discovered, previous);
  const snapshot = {
    id: makeId('discovery'),
    projectKey,
    applicationId: projectKey,
    originId: resolveOriginId(context),
    status: discovered.serviceIdStatus === 'RESOLVED' ? 'READY' : 'BLOCKED_SERVICE_ID',
    parserVersion: discovered.parserVersion,
    serviceIdStatus: discovered.serviceIdStatus,
    projectServiceIdCandidates: discovered.projectServiceIdCandidates,
    operations: preview.operations,
    removedOperations: preview.removedOperations,
    warnings: [...collected.warnings, ...discovered.warnings],
    stats: { ...discovered.stats, ...preview.counts },
    scannedBy: context.userId,
    createdAt: nowIso(),
    sourceFingerprint: discoverySourceFingerprint(discovered.operations),
  };
  store.discoverySnapshots.unshift(snapshot);
  const keepIds = new Set(store.discoverySnapshots.filter(item => item.projectKey === projectKey).slice(0, 20).map(item => item.id));
  store.discoverySnapshots = store.discoverySnapshots.filter(item => item.projectKey !== projectKey || keepIds.has(item.id));
  audit('CDE_API_DISCOVERY_SCANNED', context, { projectKey, snapshotId: snapshot.id, operationCount: snapshot.operations.length, serviceIdStatus: snapshot.serviceIdStatus });
  saveStore(store);
  return safeClone(snapshot);
}

function normalizedRequestForDiscoveredOperation(operation, profile) {
  const normalized = createBlankNormalizedRequest();
  normalized.method = operation.type === 'REST' ? operation.method : 'POST';
  if (operation.type === 'CORE_QUERY') {
    normalized.url = `${profile.origin}${profile.coreBasePath}/data-provider/get-data-source`;
    normalized.body = {
      type: 'json',
      contentType: 'application/json',
      value: { serviceId: profile.projectServiceId || '{{projectServiceId}}', key: operation.sourceId.replace(/^ds\//, ''), params: operation.payloadExample || {} },
      raw: JSON.stringify({ serviceId: profile.projectServiceId || '{{projectServiceId}}', key: operation.sourceId.replace(/^ds\//, ''), params: operation.payloadExample || {} }, null, 2),
    };
  } else if (operation.type === 'CORE_COMMAND') {
    normalized.url = `${profile.origin}${profile.coreBasePath}/data-provider/store-form-data`;
    normalized.body = {
      type: 'json',
      contentType: 'application/json',
      value: { serviceId: profile.projectServiceId || '{{projectServiceId}}', formId: operation.sourceId.replace(/^fr\//, ''), data: operation.payloadExample || {} },
      raw: JSON.stringify({ serviceId: profile.projectServiceId || '{{projectServiceId}}', formId: operation.sourceId.replace(/^fr\//, ''), data: operation.payloadExample || {} }, null, 2),
    };
  } else {
    normalized.url = `${profile.dataService?.baseUrl || '{{dataServiceBaseUrl}}'}${operation.path}`;
    if (!['GET', 'HEAD'].includes(operation.method)) {
      normalized.body = {
        type: 'json',
        contentType: 'application/json',
        value: operation.payloadExample || {},
        raw: JSON.stringify(operation.payloadExample || {}, null, 2),
      };
    }
  }
  normalized.headers = [
    createHeader('accept', 'application/json', 0, 'DISCOVERY'),
    ...(!['GET', 'HEAD'].includes(normalized.method) ? [createHeader('content-type', 'application/json; charset=UTF-8', 1, 'DISCOVERY')] : []),
  ];
  return normalized;
}

function sourceControlledDefinition(operation, profile) {
  const normalized = normalizedRequestForDiscoveredOperation(operation, profile);
  return {
    name: operation.name || operation.sourceId,
    description: `Discovered from ${operation.sourceKind}: ${operation.sourceId}`,
    method: normalized.method,
    urlTemplate: normalized.url,
    bodyType: normalized.body?.type || 'none',
    bodyTemplate: normalized.body?.raw || '',
    classification: operation.type === 'CORE_QUERY'
      ? buildClassification('CORE_QUERY', { serviceId: profile.projectServiceId, key: operation.sourceId.replace(/^ds\//, '') }, CORE_QUERY_ENDPOINT)
      : operation.type === 'CORE_COMMAND'
        ? buildClassification('CORE_COMMAND', { serviceId: profile.projectServiceId, formId: operation.sourceId.replace(/^fr\//, '') }, CORE_COMMAND_ENDPOINT)
        : buildClassification('GENERIC_HTTP', null, null),
  };
}

function equalSourceField(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeDiscoveredRequest(existing, operation, profile, context) {
  const incoming = sourceControlledDefinition(operation, profile);
  const base = existing.sourceSync?.baseDefinition || {};
  const conflicts = [];
  const next = { ...existing };
  for (const [field, incomingValue] of Object.entries(incoming)) {
    const localValue = existing[field];
    const baseValue = base[field];
    const localChanged = !equalSourceField(localValue, baseValue);
    const sourceChanged = !equalSourceField(incomingValue, baseValue);
    if (localChanged && sourceChanged && !equalSourceField(localValue, incomingValue)) {
      conflicts.push({ field, base: baseValue, local: localValue, incoming: incomingValue });
    } else if (!localChanged) {
      next[field] = incomingValue;
    }
  }
  next.runtimeBinding = {
    ...existing.runtimeBinding,
    runtimeProfileId: profile.id,
    projectServiceId: profile.projectServiceId,
    sourceFingerprint: operation.sourceFingerprint,
  };
  next.sourceSync = {
    status: conflicts.length ? 'CONFLICT' : 'SYNCED',
    sourceFingerprint: operation.sourceFingerprint,
    baseDefinition: conflicts.length ? base : incoming,
    incomingDefinition: conflicts.length ? incoming : undefined,
    conflicts,
    syncedAt: nowIso(),
    syncedBy: context.userId,
  };
  next.updatedAt = nowIso();
  next.updatedBy = context.userId;
  next.version = Number(existing.version || 1) + 1;
  next.documentation = refreshDocumentationMetadata(next);
  return next;
}

function syncDiscoverySnapshot(snapshot, body, context) {
  const collectionId = String(body.collectionId || '');
  const collection = store.collections.find(item => item.id === collectionId);
  if (!collection || !belongsToUser(collection, context) || collection.applicationId !== snapshot.projectKey) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Select one of your Collections for the discovered project.', 403);
  }
  const profile = findRuntimeProfile(body.runtimeProfileId, context);
  if (profile.applicationId !== snapshot.projectKey) throw new ApiConsoleError('RUNTIME_BINDING_INVALID', 'Runtime Profile and discovery project do not match.', 422);
  const selectedIds = new Set(Array.isArray(body.operationIds) && body.operationIds.length ? body.operationIds.map(String) : snapshot.operations.map(item => item.id));
  const result = { created: [], updated: [], unchanged: [], conflicts: [], stale: [] };
  for (const operation of snapshot.operations.filter(item => selectedIds.has(item.id))) {
    const existing = store.requests.find(request =>
      request.collectionId === collectionId &&
      request.runtimeBinding?.operationId === operation.id &&
      request.status !== 'ARCHIVED'
    );
    if (!existing) {
      const normalized = normalizedRequestForDiscoveredOperation(operation, profile);
      const request = definitionFromNormalized(normalized, {
        id: makeId('api-req'),
        applicationId: snapshot.projectKey,
        collectionId,
        environmentId: collection.environmentId || 'env-development',
        name: operation.name || operation.sourceId,
        description: `Discovered from ${operation.sourceKind}: ${operation.sourceId}`,
        userId: context.userId,
        userName: context.user?.fullName || context.userId,
      });
      const controlled = sourceControlledDefinition(operation, profile);
      Object.assign(request, controlled);
      request.sourceType = 'CDE_DISCOVERY';
      request.runtimeBinding = {
        runtimeProfileId: profile.id,
        projectKey: snapshot.projectKey,
        projectServiceId: profile.projectServiceId,
        sourceKind: operation.sourceKind,
        operationId: operation.id,
        moduleId: operation.moduleId,
        sourceFingerprint: operation.sourceFingerprint,
        requiresRuntimeSession: operation.sourceKind === 'API_MODULE',
      };
      request.sourceSync = { status: 'SYNCED', sourceFingerprint: operation.sourceFingerprint, baseDefinition: controlled, conflicts: [], syncedAt: nowIso(), syncedBy: context.userId };
      request.schemaCompleteness = operation.schemaCompleteness;
      request.sourceEvidence = operation.evidence;
      store.requests.unshift(request);
      result.created.push(request.id);
      continue;
    }
    const conflictResolution = body.conflictResolutions?.[existing.id];
    if (existing.sourceSync?.status === 'CONFLICT' && conflictResolution && typeof conflictResolution === 'object') {
      const incoming = sourceControlledDefinition(operation, profile);
      const conflictFields = (existing.sourceSync.conflicts || []).map(conflict => conflict.field);
      const complete = conflictFields.every(field => ['SOURCE', 'LOCAL'].includes(conflictResolution[field]));
      if (complete) {
        conflictFields.forEach(field => {
          if (conflictResolution[field] === 'SOURCE') existing[field] = safeClone(incoming[field]);
        });
        existing.runtimeBinding = {
          ...existing.runtimeBinding,
          runtimeProfileId: profile.id,
          projectServiceId: profile.projectServiceId,
          sourceFingerprint: operation.sourceFingerprint,
        };
        existing.sourceSync = {
          status: 'SYNCED',
          sourceFingerprint: operation.sourceFingerprint,
          baseDefinition: incoming,
          conflicts: [],
          syncedAt: nowIso(),
          syncedBy: context.userId,
        };
        existing.updatedAt = nowIso();
        existing.updatedBy = context.userId;
        existing.version = Number(existing.version || 1) + 1;
        existing.documentation = refreshDocumentationMetadata(existing);
        result.updated.push(existing.id);
        continue;
      }
    }
    if (existing.runtimeBinding.sourceFingerprint === operation.sourceFingerprint &&
      existing.runtimeBinding.runtimeProfileId === profile.id &&
      existing.runtimeBinding.projectServiceId === profile.projectServiceId &&
      existing.sourceSync?.status === 'SYNCED') {
      result.unchanged.push(existing.id);
      continue;
    }
    const merged = mergeDiscoveredRequest(existing, operation, profile, context);
    store.requests[store.requests.indexOf(existing)] = merged;
    if (merged.sourceSync.status === 'CONFLICT') result.conflicts.push({ requestId: existing.id, conflicts: merged.sourceSync.conflicts });
    else result.updated.push(existing.id);
  }
  const currentOperationIds = new Set(snapshot.operations.map(item => item.id));
  store.requests.filter(request =>
    request.collectionId === collectionId &&
    request.runtimeBinding?.projectKey === snapshot.projectKey &&
    request.sourceType === 'CDE_DISCOVERY' &&
    request.status !== 'ARCHIVED' &&
    !currentOperationIds.has(request.runtimeBinding.operationId)
  ).forEach(request => {
    request.sourceSync = { ...(request.sourceSync || {}), status: 'STALE', staleAt: nowIso(), syncedBy: context.userId };
    request.updatedAt = nowIso();
    result.stale.push(request.id);
    notifyUser(
      request.createdBy || request.ownerId,
      'منبع Discovery حذف شد',
      `${request.name} به‌خاطر حذف منبع در CDE به وضعیت STALE رفت.`,
      'API_REQUEST',
      request.id,
      makeId('api-corr')
    );
  });
  audit('CDE_API_DISCOVERY_SYNCED', context, { snapshotId: snapshot.id, collectionId, profileId: profile.id, counts: Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.length])) });
  saveStore(store);
  return result;
}

async function executeDataServiceOperation(profile, operation, input) {
  const config = profile.dataService || {};
  if (!config.executionEnabled || !config.baseUrl) {
    throw new ApiConsoleError('DATA_SERVICE_EXECUTION_BLOCKED', 'Data Service execution requires an administrator-approved base URL and authentication secret.', 409);
  }
  const url = new URL(operation.path, `${config.baseUrl}/`).toString();
  const approvedBase = new URL(`${config.baseUrl}/`);
  const target = new URL(url);
  if (target.origin !== approvedBase.origin || !target.pathname.startsWith(approvedBase.pathname)) {
    throw new ApiConsoleError('RUNTIME_BINDING_INVALID', 'Data Service operation escaped the approved base URL.', 422);
  }
  const headers = [createHeader('accept', 'application/json', 0, 'RUNTIME')];
  if (!['GET', 'HEAD'].includes(operation.method)) headers.push(createHeader('content-type', 'application/json; charset=UTF-8', 1, 'RUNTIME'));
  if (config.authMode !== 'NONE') {
    const errors = [];
    const secret = resolveSecretReference(config.authSecretRef, errors);
    if (errors.length || !secret) throw new ApiConsoleError('DATA_SERVICE_AUTH_REQUIRED', 'Data Service authentication secret is unavailable.', 409);
    if (config.authMode === 'BEARER') headers.push(createHeader('authorization', `Bearer ${secret}`, headers.length, 'RUNTIME'));
    if (config.authMode === 'BASIC') headers.push(createHeader('authorization', `Basic ${Buffer.from(`${config.username}:${secret}`).toString('base64')}`, headers.length, 'RUNTIME'));
    if (config.authMode === 'TOKEN_ENDPOINT') {
      const tokenUrl = new URL(config.tokenPath || '/auth/getToken', `${config.baseUrl}/`);
      if (tokenUrl.origin !== approvedBase.origin) throw new ApiConsoleError('DATA_SERVICE_AUTH_INVALID', 'Data Service token endpoint must stay on the approved origin.', 422);
      const authResponse = await executeWithRedirects({
        method: 'POST',
        url: tokenUrl.toString(),
        headers: [createHeader('accept', 'application/json', 0, 'RUNTIME'), createHeader('content-type', 'application/json; charset=UTF-8', 1, 'RUNTIME')],
        cookies: [],
        body: { type: 'json', value: null, raw: JSON.stringify({ username: config.username, password: secret }), contentType: 'application/json' },
        tls: { verifyCertificate: true },
        sameOriginRedirectsOnly: true,
        captureSensitiveJson: true,
      });
      let token;
      try {
        const parsed = JSON.parse(authResponse.internalBody || '{}');
        token = parsed.token || parsed.accessToken || parsed.access_token || parsed.Result?.token;
      } catch {
        token = undefined;
      }
      delete authResponse.internalBody;
      if (authResponse.statusCode >= 400 || !token) throw new ApiConsoleError('DATA_SERVICE_AUTH_REQUIRED', 'Data Service token endpoint did not return a usable token.', 401);
      headers.push(createHeader('authorization', `Bearer ${token}`, headers.length, 'RUNTIME'));
    }
  }
  const body = ['GET', 'HEAD'].includes(operation.method)
    ? { type: 'none', value: null, raw: '' }
    : { type: 'json', value: input || {}, raw: JSON.stringify(input || {}), contentType: 'application/json' };
  return executeWithRedirects({
    method: operation.method,
    url,
    headers,
    cookies: [],
    body,
    tls: { verifyCertificate: true },
    sameOriginRedirectsOnly: true,
  });
}

async function executeRuntimeDiscoveredOperation(req, operationId, body, context) {
  assertCsrf(req);
  if (!roleAllowed(context.role, API_CONSOLE_POLICY.canExecute)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to execute Runtime operations.', 403);
  }
  const projectKey = String(body.projectKey || context.applicationId || '');
  assertRuntimeProjectAccess(projectKey, context);
  const snapshot = latestDiscovery(projectKey);
  const operation = snapshot?.operations?.find(item => item.id === operationId);
  if (!operation) throw new ApiConsoleError('RUNTIME_OPERATION_NOT_FOUND', 'The operation is not present in the latest discovery snapshot.', 404);
  const profile = findRuntimeProfile(body.runtimeProfileId, context);
  if (profile.applicationId !== projectKey) throw new ApiConsoleError('RUNTIME_BINDING_INVALID', 'Runtime Profile, project, and operation do not match.', 422);
  if (body.expectedProjectServiceId && profile.projectServiceId !== body.expectedProjectServiceId) {
    throw new ApiConsoleError('RUNTIME_BINDING_INVALID', 'The approved project service ID changed after this Request was synced. Sync discovery again.', 409);
  }
  if (['PRE_PRODUCTION', 'PRODUCTION'].includes(profile.kind) && !roleAllowed(context.role, API_CONSOLE_POLICY.canExecuteProduction)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'This Runtime environment requires elevated execution permission.', 403);
  }
  if (!profile.projectServiceId && operation.sourceKind === 'API_MODULE') {
    throw new ApiConsoleError('RUNTIME_SERVICE_ID_REQUIRED', 'A System Administrator must approve projectServiceId before Runtime execution.', 409);
  }
  if (operation.type === 'CORE_COMMAND') {
    if (body.confirmed !== true) throw new ApiConsoleError('RUNTIME_COMMAND_CONFIRMATION_REQUIRED', 'Confirm this Core Command before execution.', 409);
    if (context.role === 'DEVELOPER' && profile.kind !== 'DEVELOPMENT') {
      throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Developers may execute Core Commands only on DEVELOPMENT Runtime Profiles.', 403);
    }
    if (context.role !== 'DEVELOPER' && !roleAllowed(context.role, API_CONSOLE_POLICY.canExecuteCommand)) {
      throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Core Command execution requires elevated permission.', 403);
    }
    if (['PRE_PRODUCTION', 'PRODUCTION'].includes(profile.kind) && !roleAllowed(context.role, API_CONSOLE_POLICY.canExecuteProductionCommand)) {
      throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Core Command execution on this Runtime environment requires elevated permission.', 403);
    }
    if (profile.kind === 'PRODUCTION' && !String(body.businessJustification || '').trim()) {
      throw new ApiConsoleError('RUNTIME_COMMAND_CONFIRMATION_REQUIRED', 'Production Core Command requires a business justification.', 409);
    }
  }
  const startedAt = nowIso();
  let response;
  if (operation.sourceKind === 'DATA_SERVICE') {
    response = await executeDataServiceOperation(profile, operation, body.input);
    try {
      const parsedBody = JSON.parse(String(response.bodyPreview || '').replace(/^\uFEFF/, ''));
      response = {
        ...response,
        bodyPreview: prettyJsonPreview(parsedBody),
        safePreviewMode: 'JSON',
      };
    } catch {
      // Keep original text preview when the body is not JSON.
    }
  } else {
    const { appSession, phone } = runtimeSessionIdentity(req, context);
    let state = await getRuntimeSession(appSession.id, profile.id);
    if (!state || state.phase !== 'CONNECTED' || normalizeCdeLoginName(state.loginName) !== phone) {
      const recovered = await findConnectedRuntimeSession(profile.id, phone, appSession.id);
      if (recovered) {
        state = recovered.state;
        // Rebind the encrypted Runtime state to the app session used by this
        // request so subsequent Swagger calls take the normal direct path.
        await setRuntimeSession(appSession.id, profile.id, state);
      }
    }
    if (!state || state.phase !== 'CONNECTED' || normalizeCdeLoginName(state.loginName) !== phone) {
      throw new ApiConsoleError('RUNTIME_SESSION_REQUIRED', 'Connect this Runtime Profile with the same CDE cellphone before execution.', 401);
    }
    const call = await executeCoreOperation(state, profile, operation, body.input || {});
    let runtimeState = call.state;
    // Business ds/fr payloads often omit IsUserLogin or leave it false even while the
    // cookie session is still valid. Only drop the Runtime session after who-am-i confirms logout.
    if (call.response?.Result && typeof call.response.Result === 'object' && !Array.isArray(call.response.Result) && call.response.Result.IsUserLogin === false) {
      const probe = await ensureRuntimeSessionStillConnected(appSession.id, profile, runtimeState);
      if (!probe.connected) {
        throw new ApiConsoleError('RUNTIME_SESSION_EXPIRED', 'Runtime session expired. Connect again.', 401);
      }
      runtimeState = probe.state;
    }
    await setRuntimeSession(appSession.id, profile.id, runtimeState);
    const serialized = prettyJsonPreview(call.response);
    response = {
      statusCode: 200,
      statusText: 'OK',
      headers: [{ name: 'content-type', value: 'application/json; charset=utf-8' }],
      cookies: [],
      bodyPreview: serialized,
      contentType: 'application/json; charset=utf-8',
      responseSize: Buffer.byteLength(serialized),
      durationMs: Date.now() - new Date(startedAt).getTime(),
      redirectHistory: [],
      tlsVerified: true,
      safePreviewMode: 'JSON',
    };
  }
  const execution = {
    id: makeId('runtime-exec'),
    operationId: operation.id,
    requestId: body.requestId,
    applicationId: projectKey,
    runtimeProfileId: profile.id,
    sourceKind: operation.sourceKind,
    executedBy: context.userId,
    startedAt,
    completedAt: nowIso(),
    status: 'COMPLETED',
    statusCode: response.statusCode,
    responseSize: response.responseSize,
    responseContentType: response.contentType,
    response,
    transportResult: response.statusCode < 400 ? 'SUCCESS' : 'FAILED',
    evidenceType: 'RUNTIME_EXECUTION',
    correlationId: makeId('api-corr'),
  };
  store.executions.unshift(execution);
  audit('RUNTIME_OPERATION_EXECUTED', context, { operationId, profileId: profile.id, projectKey, statusCode: response.statusCode });
  saveStore(store);
  return safeClone(execution);
}

function runtimeOpenApiDocument(projectKey, profile, snapshot) {
  const paths = {};
  for (const operation of snapshot.operations || []) {
    const proxyPath = `/api/api-console/runtime/operations/${operation.id}/execute`;
    paths[proxyPath] = {
      post: {
        tags: [operation.type === 'CORE_QUERY' ? 'Core Queries' : operation.type === 'CORE_COMMAND' ? 'Core Commands' : 'Data Service'],
        operationId: `execute_${operation.id.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        summary: operation.name || operation.sourceId,
        description: `${operation.sourceKind} ${operation.sourceId}. Credentials and Runtime cookies are injected only by the API Console backend.`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectKey', 'runtimeProfileId', 'input'],
                properties: {
                  projectKey: { type: 'string', const: projectKey, default: projectKey },
                  runtimeProfileId: { type: 'string', const: profile.id, default: profile.id },
                  input: operation.schema || { type: 'object', additionalProperties: true },
                  ...(operation.type === 'CORE_COMMAND' ? { confirmed: { type: 'boolean', const: true, default: true } } : {}),
                },
              },
              example: {
                projectKey,
                runtimeProfileId: profile.id,
                input: operation.payloadExample || {},
                ...(operation.type === 'CORE_COMMAND' ? { confirmed: true } : {}),
              },
            },
          },
        },
        responses: {
          200: { description: 'Runtime execution result' },
          401: { description: 'Runtime session is missing or expired' },
          403: { description: 'Role, CSRF, or environment policy rejected the operation' },
          409: { description: 'Profile configuration, confirmation, or Data Service credentials are incomplete' },
        },
        security: [{ appSession: [], csrfToken: [] }],
        'x-runtime-binding': { profileId: profile.id, projectKey, operationId: operation.id, sourceFingerprint: operation.sourceFingerprint },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: `${projectKey} Runtime API`, version: '1.0.0', description: `Secure proxy operations for ${profile.name}.` },
    servers: [{ url: '/' }],
    tags: [{ name: 'Core Queries' }, { name: 'Core Commands' }, { name: 'Data Service' }],
    paths,
    components: {
      securitySchemes: {
        appSession: { type: 'apiKey', in: 'cookie', name: process.env.API_CONSOLE_SESSION_COOKIE || 'api_console_session' },
        csrfToken: { type: 'apiKey', in: 'header', name: 'x-csrf-token', description: 'Injected automatically from the active API Console session.' },
      },
    },
  };
}

function runtimeDocsHtml(projectKey, profile) {
  const specUrl = `/api/api-console/projects/${encodeURIComponent(projectKey)}/runtime-profiles/${encodeURIComponent(profile.id)}/openapi.json`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${sanitizeText(projectKey)} Runtime API</title><link rel="stylesheet" href="/api/docs/swagger-ui.css"/></head>
<body><div id="swagger-ui"></div><script src="/api/docs/swagger-ui-bundle.js"></script><script src="/api/docs/swagger-ui-standalone-preset.js"></script>
<script>(async function(){
  const session = await fetch('/api/session',{credentials:'same-origin'}).then(r=>r.json());
  window.ui=SwaggerUIBundle({url:${JSON.stringify(specUrl).replace(/</g, '\\u003c')},dom_id:'#swagger-ui',presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:'StandaloneLayout',persistAuthorization:true,requestInterceptor:function(request){request.credentials='same-origin';request.headers=request.headers||{};request.headers['x-csrf-token']=session.csrfToken||'';return request;},onComplete:function(){if(session.csrfToken)window.ui.preauthorizeApiKey('csrfToken',session.csrfToken);}});
})().catch(function(error){document.body.textContent='Swagger initialization failed: '+error.message;});</script></body></html>`;
}

function runtimeHeaders(profile, login = false) {
  return [
    { key: 'accept', value: '*/*', type: 'text' },
    { key: 'content-type', value: 'application/json; charset=UTF-8', type: 'text' },
    { key: 'client-id', value: '{{clientId}}', type: 'text' },
    { key: 'origin', value: '{{runtimeOrigin}}', type: 'text' },
    { key: 'referer', value: login ? '{{runtimeOrigin}}{{loginPath}}' : '{{runtimeOrigin}}{{appRefererPath}}', type: 'text' },
    ...(!login && profile.prostage ? [{ key: 'prostage', value: '{{prostage}}', type: 'text' }] : []),
  ];
}

function postmanRuntimeRequest(name, path, body, profile, options = {}) {
  return {
    name,
    event: [
      {
        listen: 'prerequest',
        script: { type: 'text/javascript', exec: [
          "if (!pm.collectionVariables.get('clientId')) { const part=()=>Math.random().toString(36).slice(2,10).padEnd(8,'0'); pm.collectionVariables.set('clientId',[Date.now().toString(36),part(),part(),part(),part()].join('-')); }",
          "if (pm.collectionVariables.get('ecreq') === 'true' && pm.request.body && pm.request.body.raw) {",
          "  const CryptoJS = pm.require('npm:crypto-js@4.2.0');",
          "  const id = pm.collectionVariables.get('clientId'); const secret = id.split('-').sort().join('%');",
          "  pm.request.body.raw = JSON.stringify({reqtoken: CryptoJS.AES.encrypt(pm.request.body.raw, secret).toString()});",
          "}",
        ] },
      },
      {
        listen: 'test',
        script: { type: 'text/javascript', exec: [
          "let value; try { value = pm.response.json(); } catch (_) { value = null; }",
          "if (value && value.token) { const CryptoJS = pm.require('npm:crypto-js@4.2.0'); const id=pm.collectionVariables.get('clientId'); const text=CryptoJS.AES.decrypt(value.token,id.split('-').sort().join('%')).toString(CryptoJS.enc.Utf8); pm.collectionVariables.set('lastDecryptedResponse',text); try { let decoded=JSON.parse(text); if(typeof decoded==='string') decoded=JSON.parse(decoded); value={Result:decoded}; } catch (_) {} }",
          "if (value && value.Result && typeof value.Result.ecreq === 'boolean') pm.collectionVariables.set('ecreq', String(value.Result.ecreq));",
        ] },
      },
    ],
    request: {
      method: options.method || 'POST',
      header: options.method === 'GET' ? runtimeHeaders(profile, options.login).filter(item => item.key !== 'content-type') : runtimeHeaders(profile, options.login),
      ...(body === undefined ? {} : { body: { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } } }),
      url: { raw: `{{runtimeOrigin}}${path}` },
      description: options.description,
    },
  };
}

function buildRuntimePostmanCollection(projectKey, profile, snapshot) {
  const queryPath = `${profile.coreBasePath}/data-provider/get-data-source`;
  const commandPath = `${profile.coreBasePath}/data-provider/store-form-data`;
  const whoAmI = { serviceId: '{{runtimeServiceId}}', key: 'pages-app/who-am-i', params: {} };
  const folders = {
    query: { name: 'Core Queries', item: [] },
    command: { name: 'Core Commands', item: [] },
    data: { name: 'DATA_SERVICE', item: [] },
  };
  for (const operation of snapshot.operations || []) {
    if (operation.type === 'CORE_QUERY') {
      folders.query.item.push(postmanRuntimeRequest(operation.name || operation.sourceId, queryPath, { serviceId: '{{projectServiceId}}', key: operation.sourceId.replace(/^ds\//, ''), params: operation.payloadExample || {} }, profile));
    } else if (operation.type === 'CORE_COMMAND') {
      folders.command.item.push(postmanRuntimeRequest(operation.name || operation.sourceId, commandPath, { serviceId: '{{projectServiceId}}', formId: operation.sourceId.replace(/^fr\//, ''), data: operation.payloadExample || {} }, profile));
    } else {
      folders.data.item.push({
        name: operation.name || operation.sourceId,
        request: {
          method: operation.method,
          header: [
            { key: 'accept', value: 'application/json', type: 'text' },
            ...(!['GET', 'HEAD'].includes(operation.method) ? [{ key: 'content-type', value: 'application/json', type: 'text' }] : []),
            ...(['BEARER', 'TOKEN_ENDPOINT'].includes(profile.dataService?.authMode) ? [{ key: 'authorization', value: 'Bearer {{dataServiceToken}}', type: 'text' }] : []),
          ],
          ...(profile.dataService?.authMode === 'BASIC' ? { auth: { type: 'basic', basic: [{ key: 'username', value: '{{dataServiceUsername}}', type: 'string' }, { key: 'password', value: '{{dataServicePassword}}', type: 'string' }] } } : {}),
          ...(!['GET', 'HEAD'].includes(operation.method) ? { body: { mode: 'raw', raw: JSON.stringify(operation.payloadExample || {}, null, 2), options: { raw: { language: 'json' } } } } : {}),
          url: `{{dataServiceBaseUrl}}${operation.path}`,
          description: 'Set Data Service authentication in Postman locally. Stored API Console credentials are never exported.',
        },
      });
    }
  }
  if (profile.dataService?.authMode === 'TOKEN_ENDPOINT') {
    folders.data.item.unshift({
      name: 'DATA_SERVICE Login',
      event: [{ listen: 'test', script: { type: 'text/javascript', exec: ["const value=pm.response.json(); if(value.token) pm.collectionVariables.set('dataServiceToken', value.token);"] } }],
      request: {
        method: 'POST',
        header: [{ key: 'accept', value: 'application/json', type: 'text' }, { key: 'content-type', value: 'application/json', type: 'text' }],
        body: { mode: 'raw', raw: JSON.stringify({ username: '{{dataServiceUsername}}', password: '{{dataServicePassword}}' }, null, 2), options: { raw: { language: 'json' } } },
        url: `{{dataServiceBaseUrl}}${profile.dataService.tokenPath || '/auth/getToken'}`,
        description: 'Credentials remain empty in the export and must be supplied locally.',
      },
    });
  }
  const collection = {
    info: { _postman_id: randomUUID(), name: `${projectKey} - ${profile.name} Runtime`, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [
      { key: 'runtimeOrigin', value: profile.origin, type: 'string' },
      { key: 'coreBasePath', value: profile.coreBasePath, type: 'string' },
      { key: 'loginPath', value: profile.loginPath, type: 'string' },
      { key: 'appRefererPath', value: profile.appRefererPath, type: 'string' },
      { key: 'runtimeServiceId', value: profile.runtimeServiceId, type: 'string' },
      { key: 'projectServiceId', value: profile.projectServiceId || '', type: 'string' },
      { key: 'prostage', value: profile.prostage || '', type: 'string' },
      { key: 'dataServiceBaseUrl', value: profile.dataService?.baseUrl || '', type: 'string' },
      { key: 'dataServiceToken', value: '', type: 'string' },
      { key: 'dataServiceUsername', value: '', type: 'string' },
      { key: 'dataServicePassword', value: '', type: 'string' },
      { key: 'phone', value: '', type: 'string' },
      { key: 'password', value: '', type: 'string' },
      { key: 'clientId', value: '', type: 'string' },
      { key: 'ecreq', value: 'false', type: 'string' },
      { key: 'lastDecryptedResponse', value: '', type: 'string' },
    ],
    item: [
      { name: 'Runtime Login', item: [
        postmanRuntimeRequest('Initialize Cookie Jar', profile.loginPath, undefined, profile, { method: 'GET', login: true }),
        postmanRuntimeRequest('Who Am I (before login)', queryPath, whoAmI, profile, { login: true }),
        postmanRuntimeRequest('Submit Cellphone', commandPath, { serviceId: '{{runtimeServiceId}}', formId: 'auth/signin/iran-cellphone', data: { userSource: profile.userSource, userLoginName: '{{phone}}' } }, profile, { login: true }),
        postmanRuntimeRequest('Submit Password', commandPath, { serviceId: '{{runtimeServiceId}}', formId: 'auth/signin/check-password', data: { userSource: profile.userSource, userLoginName: '{{phone}}', contact: 'iran-cellphone', password: '{{password}}' } }, profile, { login: true }),
      ] },
      { name: 'Who Am I', item: [postmanRuntimeRequest('Who Am I (authenticated)', queryPath, whoAmI, profile, { login: true })] },
      folders.query,
      folders.command,
      folders.data,
    ],
  };
  return { fileName: `${projectKey}-${profile.name}`.replace(/[^a-zA-Z0-9._-]+/g, '-') + '.postman_collection.json', requestCount: (snapshot.operations || []).length + 5 + (profile.dataService?.authMode === 'TOKEN_ENDPOINT' ? 1 : 0), collection };
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function buildRuntimeCurlExport(projectKey, profile, snapshot, operationId, mode = 'sample') {
  const operation = (snapshot.operations || []).find(item => item.id === operationId) || snapshot.operations?.[0];
  if (!operation) throw new ApiConsoleError('RUNTIME_OPERATION_NOT_FOUND', 'No discovered operation is available for cURL export.', 404);
  const queryPath = `${profile.coreBasePath}/data-provider/get-data-source`;
  const commandPath = `${profile.coreBasePath}/data-provider/store-form-data`;
  const requestBody = operation.type === 'CORE_QUERY'
    ? { serviceId: profile.projectServiceId || '{{projectServiceId}}', key: operation.sourceId.replace(/^ds\//, ''), params: operation.payloadExample || {} }
    : operation.type === 'CORE_COMMAND'
      ? { serviceId: profile.projectServiceId || '{{projectServiceId}}', formId: operation.sourceId.replace(/^fr\//, ''), data: operation.payloadExample || {} }
      : operation.payloadExample || {};
  const operationUrl = operation.type === 'CORE_QUERY' ? `${profile.origin}${queryPath}` : operation.type === 'CORE_COMMAND' ? `${profile.origin}${commandPath}` : `${profile.dataService?.baseUrl || 'https://data-service.example.invalid'}${operation.path}`;
  const headers = operation.sourceKind === 'API_MODULE'
    ? [`-H 'accept: */*'`, `-H 'content-type: application/json; charset=UTF-8'`, `-H "client-id: $CLIENT_ID"`, `-H 'origin: ${profile.origin}'`, `-H 'referer: ${profile.origin}${profile.appRefererPath}'`, ...(profile.prostage ? [`-H 'prostage: ${profile.prostage}'`] : [])]
    : [
      `-H 'accept: application/json'`,
      `-H 'content-type: application/json'`,
      ...(['BEARER', 'TOKEN_ENDPOINT'].includes(profile.dataService?.authMode) ? [`-H "authorization: Bearer $DATA_SERVICE_TOKEN"`] : []),
      ...(profile.dataService?.authMode === 'BASIC' ? [`-u "$DATA_SERVICE_USERNAME:$DATA_SERVICE_PASSWORD"`] : []),
    ];
  const directLines = [`curl --request ${operation.method || 'POST'} \\`, `  --url ${shellSingleQuote(operationUrl)} \\`, ...headers.map(header => `  ${header} \\`), ...(operation.sourceKind === 'API_MODULE' ? [`  --cookie "$COOKIE_JAR" \\`] : [])];
  if (!['GET', 'HEAD'].includes(operation.method)) directLines.push(`  --data ${shellSingleQuote(JSON.stringify(requestBody))}`);
  else directLines[directLines.length - 1] = directLines[directLines.length - 1].replace(/ \\$/, '');
  const direct = directLines.join('\n');
  if (mode !== 'bundle' || operation.sourceKind !== 'API_MODULE') {
    return { fileName: `${operation.id}.sh`, mode: 'sample', value: `# Safe sample: no stored cookie, password, or secret is included.\nCLIENT_ID='replace-with-stable-client-id'\nCOOKIE_JAR='./runtime.cookies'\nDATA_SERVICE_TOKEN=''\nDATA_SERVICE_USERNAME=''\nDATA_SERVICE_PASSWORD=''\n${direct}\n` };
  }
  const who = JSON.stringify({ serviceId: profile.runtimeServiceId, key: 'pages-app/who-am-i', params: {} });
  const phone = JSON.stringify({ serviceId: profile.runtimeServiceId, formId: 'auth/signin/iran-cellphone', data: { userSource: profile.userSource, userLoginName: '${PHONE}' } }).replace('"${PHONE}"', '"' + '${PHONE}' + '"');
  const password = JSON.stringify({ serviceId: profile.runtimeServiceId, formId: 'auth/signin/check-password', data: { userSource: profile.userSource, userLoginName: '${PHONE}', contact: 'iran-cellphone', password: '${PASSWORD}' } }).replace('"${PHONE}"', '"' + '${PHONE}' + '"').replace('"${PASSWORD}"', '"' + '${PASSWORD}' + '"');
  const value = `#!/usr/bin/env bash
set -euo pipefail
: "\${PHONE:?Set PHONE to the connected CDE cellphone}"
: "\${PASSWORD:?Set PASSWORD at execution time}"
CLIENT_ID="\${CLIENT_ID:-$(node -e "console.log(Date.now().toString(36)+'-'+require('crypto').randomBytes(24).toString('hex').match(/.{1,8}/g).slice(0,4).join('-'))")}";
COOKIE_JAR="\${COOKIE_JAR:-./runtime.cookies}"
ECREQ_HELPER="\${ECREQ_HELPER:-./runtime-ecreq-helper.cjs}"
ECREQ=false
post_runtime() {
  local payload="$1" url="$2" referer="$3" stage="\${4:-}" response decoded flag
  if [[ "$ECREQ" == "true" ]]; then payload="$(node "$ECREQ_HELPER" encode "$CLIENT_ID" "$payload")"; fi
  local headers=(-H 'accept: */*' -H 'content-type: application/json; charset=UTF-8' -H "client-id: $CLIENT_ID" -H 'origin: ${profile.origin}' -H "referer: $referer")
  if [[ -n "$stage" ]]; then headers+=(-H "prostage: $stage"); fi
  response="$(curl --silent --show-error --cookie-jar "$COOKIE_JAR" --cookie "$COOKIE_JAR" "\${headers[@]}" --data "$payload" "$url")"
  decoded="$(node "$ECREQ_HELPER" decode "$CLIENT_ID" "$response")"
  printf '%s\n' "$decoded"
  flag="$(node "$ECREQ_HELPER" flag "$CLIENT_ID" "$response")"
  if [[ -n "$flag" ]]; then ECREQ="$flag"; fi
}
curl --silent --show-error --cookie-jar "$COOKIE_JAR" --cookie "$COOKIE_JAR" -H "client-id: $CLIENT_ID" ${shellSingleQuote(`${profile.origin}${profile.loginPath}`)} >/dev/null
post_runtime ${shellSingleQuote(who)} ${shellSingleQuote(`${profile.origin}${queryPath}`)} ${shellSingleQuote(`${profile.origin}${profile.loginPath}`)}
post_runtime "${phone.replace(/"/g, '\\"')}" ${shellSingleQuote(`${profile.origin}${commandPath}`)} ${shellSingleQuote(`${profile.origin}${profile.loginPath}`)}
post_runtime "${password.replace(/"/g, '\\"')}" ${shellSingleQuote(`${profile.origin}${commandPath}`)} ${shellSingleQuote(`${profile.origin}${profile.loginPath}`)}
post_runtime ${shellSingleQuote(who)} ${shellSingleQuote(`${profile.origin}${queryPath}`)} ${shellSingleQuote(`${profile.origin}${profile.loginPath}`)}
post_runtime ${shellSingleQuote(JSON.stringify(requestBody))} ${shellSingleQuote(operationUrl)} ${shellSingleQuote(`${profile.origin}${profile.appRefererPath}`)} ${shellSingleQuote(profile.prostage || '')}
`;
  const helper = `// Requires: npm install crypto-js\nconst CryptoJS=require('crypto-js');\nconst [,,mode,id,input]=process.argv;\nconst secret=String(id||'').split('-').sort().join('%');\nfunction decoded(){ const envelope=JSON.parse(input||'{}'); if(!envelope.token) return envelope; const text=CryptoJS.AES.decrypt(String(envelope.token),secret).toString(CryptoJS.enc.Utf8); let value=JSON.parse(text); if(typeof value==='string') value=JSON.parse(value); return {Result:value}; }\nif(mode==='encode') process.stdout.write(JSON.stringify({reqtoken:CryptoJS.AES.encrypt(String(input||''),secret).toString()}));\nelse if(mode==='decode') process.stdout.write(JSON.stringify(decoded()));\nelse if(mode==='flag'){ const value=decoded(); const flag=value&&value.Result&&value.Result.ecreq; if(typeof flag==='boolean') process.stdout.write(String(flag)); }\nelse { console.error('mode must be encode, decode, or flag'); process.exit(2); }`;
  return { fileName: `${projectKey}-${operation.id}-runtime-login.sh`, mode: 'bundle', value, helperFileName: 'runtime-ecreq-helper.cjs', ecreqHelper: helper, note: 'The included helper automatically encrypts subsequent JSON bodies and decrypts token responses when ecreq is enabled.' };
}

function upsertRequestWithPatch(existing, data, context) {
  const merged = {
    ...existing,
    ...data,
    id: existing.id,
    version: (existing.version || 1) + 1,
    updatedBy: context.userId,
    updatedAt: nowIso(),
  };
  if (Object.prototype.hasOwnProperty.call(data, 'folderPath')) {
    merged.folderPath = Array.isArray(data.folderPath)
      ? data.folderPath.map(part => String(part || '').trim()).filter(Boolean)
      : [];
  } else if (!Array.isArray(merged.folderPath)) {
    merged.folderPath = [];
  }
  merged.documentation = refreshDocumentationMetadata(merged);
  return protectRequestSecrets(merged);
}

function consumerCandidates(context) {
  const scope = context.scopeApplicationIds?.length ? context.scopeApplicationIds : [context.applicationId];
  const developerUserIds = new Set(store.directoryRoleAssignments
    .filter(assignment =>
      assignment.role === 'DEVELOPER' &&
      assignment.isActive !== false &&
      (assignment.applicationId === 'ALL' || scope.includes(assignment.applicationId))
    )
    .map(assignment => assignment.userId));
  const users = store.directoryUsers
    .filter(user => user.isActive !== false && developerUserIds.has(user.id))
    .map(user => ({
      id: `USER:${user.id}`,
      consumerType: 'USER',
      userId: user.id,
      label: user.fullName || user.id,
      description: [user.phoneNumber, user.source === 'CDE' ? 'کاربر CDE' : ''].filter(Boolean).join(' — ') || user.id,
    }));
  const roles = USER_ROLES.map(role => ({
    id: `ROLE:${role}`,
    consumerType: 'ROLE',
    roleKey: role,
    applicationId: scope[0] || context.applicationId,
    label: ROLE_LABELS[role] || role,
    description: `همه کاربران دارای نقش ${ROLE_LABELS[role] || role}`,
  }));
  return [...users, ...roles];
}

function filterUsageEvents(context, parsedUrl) {
  if (!roleAllowed(context.role, API_CONSOLE_POLICY.canViewUsageReports)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'API usage report requires System Admin, Tech Lead or QA Lead role.', 403);
  }
  const scope = parsedUrl.searchParams.get('applicationId') || 'ALL';
  const filters = {
    page: Number(parsedUrl.searchParams.get('page') || 1),
    limit: Number(parsedUrl.searchParams.get('limit') || 30),
    apiId: parsedUrl.searchParams.get('apiId') || '',
    version: parsedUrl.searchParams.get('version') || '',
    userId: parsedUrl.searchParams.get('userId') || '',
    role: parsedUrl.searchParams.get('role') || '',
    eventType: parsedUrl.searchParams.get('eventType') || '',
    dateFrom: parsedUrl.searchParams.get('dateFrom') || '',
    dateTo: parsedUrl.searchParams.get('dateTo') || '',
  };
  let rows = store.usageEvents.filter(event => matchesApplicationScope(event.applicationId, scope));
  if (filters.apiId) rows = rows.filter(event => event.apiId === filters.apiId);
  if (filters.version) rows = rows.filter(event => event.version === filters.version);
  if (filters.userId) rows = rows.filter(event => event.userId === filters.userId);
  if (filters.role) rows = rows.filter(event => event.activeRole === filters.role);
  if (filters.eventType) rows = rows.filter(event => event.eventType === filters.eventType);
  if (filters.dateFrom) rows = rows.filter(event => new Date(event.eventAt) >= new Date(filters.dateFrom));
  if (filters.dateTo) rows = rows.filter(event => new Date(event.eventAt) <= new Date(`${filters.dateTo}T23:59:59`));
  rows = rows.sort((a, b) => b.eventAt.localeCompare(a.eventAt));
  const byType = {};
  rows.forEach(row => {
    byType[row.eventType] = (byType[row.eventType] || 0) + 1;
  });
  const uniqueApis = new Set(rows.map(row => row.apiId)).size;
  const uniqueUsers = new Set(rows.map(row => row.userId)).size;
  return {
    summary: {
      total: rows.length,
      uniqueApis,
      uniqueUsers,
      byType,
    },
    ...paginate(rows, filters.page, filters.limit),
  };
}

function filterAuditEvents(context, parsedUrl) {
  assertSystemAdministrator(context);
  const filters = {
    page: Number(parsedUrl.searchParams.get('page') || 1),
    limit: Number(parsedUrl.searchParams.get('limit') || 30),
    userId: parsedUrl.searchParams.get('userId') || '',
    action: parsedUrl.searchParams.get('action') || parsedUrl.searchParams.get('eventType') || '',
    applicationId: parsedUrl.searchParams.get('applicationId') || '',
    correlationId: parsedUrl.searchParams.get('correlationId') || '',
    dateFrom: parsedUrl.searchParams.get('dateFrom') || '',
    dateTo: parsedUrl.searchParams.get('dateTo') || '',
  };
  let rows = Array.isArray(store.auditLog) ? [...store.auditLog] : [];
  if (filters.userId) rows = rows.filter(item => item.actorUserId === filters.userId);
  if (filters.action) {
    const action = filters.action.toLowerCase();
    rows = rows.filter(item => String(item.eventType || '').toLowerCase().includes(action));
  }
  if (filters.correlationId) {
    rows = rows.filter(item => String(item.details?.correlationId || '') === filters.correlationId);
  }
  if (filters.applicationId && filters.applicationId !== 'ALL') {
    rows = rows.filter(item => {
      const appId = item.details?.applicationId || item.details?.scopeApplicationId;
      return !appId || matchesApplicationScope(appId, filters.applicationId);
    });
  }
  if (filters.dateFrom) rows = rows.filter(item => new Date(item.createdAt) >= new Date(filters.dateFrom));
  if (filters.dateTo) rows = rows.filter(item => new Date(item.createdAt) <= new Date(`${filters.dateTo}T23:59:59`));
  rows = rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return paginate(rows, filters.page, filters.limit);
}

function listNotificationsForUser(context, parsedUrl) {
  const filters = {
    page: Number(parsedUrl.searchParams.get('page') || 1),
    limit: Number(parsedUrl.searchParams.get('limit') || 20),
    unreadOnly: parsedUrl.searchParams.get('unreadOnly') === 'true',
  };
  let rows = store.notifications.filter(item => item.userId === context.userId);
  if (filters.unreadOnly) rows = rows.filter(item => item.isRead !== true);
  rows = rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const unreadCount = store.notifications.filter(item => item.userId === context.userId && item.isRead !== true).length;
  return {
    unreadCount,
    ...paginate(rows, filters.page, filters.limit),
  };
}

function markNotificationRead(notificationId, context) {
  const item = store.notifications.find(row => row.id === notificationId && row.userId === context.userId);
  if (!item) throw new ApiConsoleError('INVALID_URL', 'Notification not found.', 404);
  item.isRead = true;
  item.readAt = nowIso();
  saveStore(store);
  return item;
}

function markAllNotificationsRead(context) {
  const now = nowIso();
  let changed = 0;
  store.notifications.forEach(item => {
    if (item.userId === context.userId && item.isRead !== true) {
      item.isRead = true;
      item.readAt = now;
      changed += 1;
    }
  });
  if (changed) saveStore(store);
  return { updated: changed };
}

function ensureIsGatewayEnvironment(gatewayUrl) {
  const base = String(gatewayUrl || process.env.API_CONSOLE_IS_GATEWAY_URL || 'http://127.0.0.1:4000')
    .trim()
    .replace(/\/+$/, '')
    .replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
  const envId = 'env-is-gateway';
  let environment = store.environments.find(item => item.id === envId || item.name === 'IS Gateway');
  if (!environment) {
    environment = {
      id: envId,
      name: 'IS Gateway',
      kind: 'DEVELOPMENT',
      baseUrl: base,
      variables: [
        { id: makeId('var'), key: 'baseUrl', currentValue: base, initialValue: base, sensitive: false, scope: 'ENVIRONMENT', description: 'Integrated Systems Gateway base URL' },
        { id: makeId('var'), key: 'gatewayBaseUrl', currentValue: base, initialValue: base, sensitive: false, scope: 'ENVIRONMENT', description: 'Alias for Gateway origin' },
        { id: makeId('var'), key: 'stage', currentValue: 'is-local', initialValue: 'is-local', sensitive: false, scope: 'ENVIRONMENT', description: 'IS local stage label' },
      ],
      defaultHeaders: [
        createHeader('accept', 'application/json', 0, 'ENVIRONMENT'),
      ],
      secretReferences: {},
      productionProtected: false,
      archived: false,
      seeded: true,
      sourceApproach: 'IS',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.environments.unshift(environment);
  } else {
    environment.baseUrl = base;
    environment.sourceApproach = 'IS';
    environment.archived = false;
    const upsertVar = (key, value, description) => {
      const existing = (environment.variables || []).find(item => item.key === key);
      if (existing) {
        existing.currentValue = value;
        existing.initialValue = value;
      } else {
        environment.variables = [
          ...(environment.variables || []),
          { id: makeId('var'), key, currentValue: value, initialValue: value, sensitive: false, scope: 'ENVIRONMENT', description },
        ];
      }
    };
    upsertVar('baseUrl', base, 'Integrated Systems Gateway base URL');
    upsertVar('gatewayBaseUrl', base, 'Alias for Gateway origin');
    environment.updatedAt = nowIso();
  }
  saveStore(store);
  migrateLegacyIsRequestBindings(environment);
  return environment;
}

function migrateLegacyIsRequestBindings(isEnvironment) {
  let changed = 0;
  for (const request of store.requests || []) {
    if (request.sourceType !== 'IS_DISCOVERY') continue;
    const legacy = request.runtimeBinding && !request.runtimeBinding.runtimeProfileId ? request.runtimeBinding : null;
    if (!request.isGatewayBinding && legacy) {
      request.isGatewayBinding = buildIsGatewayBinding({
        sourceFingerprint: legacy.sourceFingerprint,
        serviceKey: legacy.serviceKey,
        path: legacy.gatewayPath || request.urlTemplate,
        sourceKind: request.sourceSync?.sourceKind || 'SPEC_SERVICE',
        controllerName: legacy.controllerName,
        actionName: legacy.actionName,
        specFolder: legacy.specFolder,
      }, {
        serviceKey: legacy.serviceKey,
        applicationId: request.applicationId,
        gatewayBaseUrl: isEnvironment?.baseUrl || gatewayBaseUrlFromEnv(),
        specFolder: legacy.specFolder,
      });
      delete request.runtimeBinding;
      changed += 1;
    } else if (request.isGatewayBinding && request.runtimeBinding && !request.runtimeBinding.runtimeProfileId) {
      delete request.runtimeBinding;
      changed += 1;
    }
    if (isEnvironment?.id && request.environmentId !== isEnvironment.id) {
      request.environmentId = isEnvironment.id;
      changed += 1;
    }
  }
  if (changed) saveStore(store);
  return changed;
}

function buildIsGatewayBinding(operation, meta = {}) {
  const fingerprint = operation.sourceFingerprint || operation.id;
  const serviceKey = String(operation.serviceKey || meta.serviceKey || '');
  const gatewayBase = String(meta.gatewayBaseUrl || gatewayBaseUrlFromEnv()).replace(/\/+$/, '');
  return {
    approach: 'IS',
    sourceKind: String(operation.sourceKind || 'SPEC_SERVICE'),
    sourceFingerprint: fingerprint,
    serviceKey,
    gatewayPath: String(operation.path || ''),
    gatewayBaseUrl: gatewayBase,
    applicationId: String(meta.applicationId || `is:${serviceKey}`),
    specFolder: meta.specFolder || operation.specFolder || null,
    controllerName: operation.controllerName || null,
    actionName: operation.actionName || null,
    requiresIsSession: true,
    secretsInjectedAtExecute: true,
  };
}

function gatewayBaseUrlFromEnv() {
  return String(process.env.API_CONSOLE_IS_GATEWAY_URL || 'http://127.0.0.1:4000')
    .trim()
    .replace(/\/+$/, '')
    .replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
}

function ensureIsDiscoveryCollection(applicationId, serviceKey, label, context, meta = {}) {
  const existing = store.collections.find(collection =>
    collection.applicationId === applicationId
    && collection.status === 'ACTIVE'
    && (collection.sourceApproach === 'IS' || String(collection.name || '').startsWith('IS ·'))
    && belongsToUser(collection, context)
  );
  if (existing) return existing;
  const specHint = meta.specFolder ? ` · spec ${meta.specFolder}` : '';
  const collection = {
    id: makeId('api-col'),
    applicationId,
    workspaceName: 'Integrated Systems',
    name: `IS · ${label || serviceKey}`,
    description: `Synced from IS specs (${serviceKey}${specHint})`,
    ownerId: context.userId,
    visibility: 'PRIVATE',
    status: 'ACTIVE',
    sourceApproach: 'IS',
    variables: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    originId: resolveOriginId(context),
  };
  store.collections.unshift(collection);
  return collection;
}

function normalizedRequestForIsOperation(operation) {
  const { buildAbsoluteGatewayUrl } = require('../../../is/is-discovery.cjs');
  const normalized = createBlankNormalizedRequest(buildAbsoluteGatewayUrl(operation.path));
  normalized.method = String(operation.method || 'GET').toUpperCase();
  normalized.headers = [
    createHeader('accept', 'application/json', 0, 'DISCOVERY'),
    ...(!['GET', 'HEAD'].includes(normalized.method)
      ? [createHeader('content-type', 'application/json', 1, 'DISCOVERY')]
      : []),
  ];
  if (!['GET', 'HEAD'].includes(normalized.method)) {
    normalized.body = {
      type: 'json',
      contentType: 'application/json',
      value: {},
      raw: '{\n  \n}',
    };
  }
  return normalized;
}

async function syncIsSystemDiscovery(serviceKey, body, context, session) {
  if (context.authApproach !== 'IS' && session?.authApproach !== 'IS') {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'IS discovery sync requires IS login.', 403);
  }
  const key = String(serviceKey || body?.serviceKey || body?.specFolder || '').trim();
  if (!key) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'serviceKey is required.', 422);

  const { discoverSystemApis, applicationIdForService } = require('../../../is/is-discovery.cjs');
  const discovery = await discoverSystemApis(key, session?.isGatewayCookie || '', {
    specFolder: body?.specFolder,
    workspaceIndex: body?.workspaceIndex,
  });
  const resolvedKey = discovery.serviceKey || key;
  const applicationId = assertApplicationInContext(
    discovery.applicationId || applicationIdForService(resolvedKey),
    context,
  );
  const isEnvironment = ensureIsGatewayEnvironment(discovery.gatewayBaseUrl || gatewayBaseUrlFromEnv());
  const label = body?.label || discovery.product?.label || resolvedKey;
  const collection = body?.collectionId
    ? store.collections.find(item => item.id === body.collectionId)
    : ensureIsDiscoveryCollection(applicationId, resolvedKey, label, context, {
      specFolder: discovery.product?.specFolder || body?.specFolder,
    });
  if (!collection || !belongsToUser(collection, context)) {
    throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Target collection is not accessible.', 403);
  }
  if (collection.applicationId !== applicationId) {
    throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Collection application does not match IS system.', 422);
  }

  const selectedIds = Array.isArray(body?.operationIds) && body.operationIds.length
    ? new Set(body.operationIds.map(String))
    : null;
  const operations = discovery.operations.filter(op => !selectedIds || selectedIds.has(op.id));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const syncedRequestIds = [];

  for (const operation of operations) {
    if (operation.enabled === false) {
      skipped += 1;
      continue;
    }
    const fingerprint = operation.sourceFingerprint || operation.id;
    const existing = store.requests.find(request =>
      request.applicationId === applicationId
      && request.sourceType === 'IS_DISCOVERY'
      && request.status !== 'ARCHIVED'
      && (
        request.sourceSync?.sourceFingerprint === fingerprint
        || request.isGatewayBinding?.sourceFingerprint === fingerprint
        || request.runtimeBinding?.sourceFingerprint === fingerprint
      )
      && belongsToUser(request, context)
    );

    const normalized = normalizedRequestForIsOperation(operation);
    const folderPath = Array.isArray(operation.folderPath) && operation.folderPath.length
      ? operation.folderPath
      : ['specs'];
    const isBinding = buildIsGatewayBinding(operation, {
      serviceKey: resolvedKey,
      applicationId,
      gatewayBaseUrl: discovery.gatewayBaseUrl || gatewayBaseUrlFromEnv(),
      specFolder: discovery.product?.specFolder || operation.specFolder || body?.specFolder,
    });
    if (existing) {
      existing.name = operation.name || existing.name;
      existing.description = operation.description || existing.description;
      existing.method = normalized.method;
      existing.urlTemplate = normalized.url;
      existing.folderPath = folderPath;
      existing.headers = normalized.headers;
      existing.bodyType = normalized.body?.type || existing.bodyType;
      existing.bodyTemplate = normalized.body?.raw || existing.bodyTemplate;
      existing.collectionId = collection.id;
      existing.environmentId = body?.environmentId || isEnvironment.id;
      existing.sourceSync = {
        status: 'SYNCED',
        sourceFingerprint: fingerprint,
        sourceKind: operation.sourceKind,
        syncedAt: nowIso(),
        syncedBy: context.userId,
      };
      existing.isGatewayBinding = isBinding;
      // Clear CDE Runtime binding leftovers so UI/execute stay on IS path.
      delete existing.runtimeBinding;
      existing.updatedAt = nowIso();
      existing.updatedBy = context.userId;
      existing.version = Number(existing.version || 1) + 1;
      existing.documentation = refreshDocumentationMetadata(existing);
      updated += 1;
      syncedRequestIds.push(existing.id);
    } else {
      const request = definitionFromNormalized(normalized, {
        applicationId,
        collectionId: collection.id,
        environmentId: body?.environmentId || isEnvironment.id,
        name: operation.name || `${operation.method} ${operation.path}`,
        description: operation.description || '',
        folderPath,
        userId: context.userId,
        userName: context.user?.fullName || context.userName,
        sourceType: 'IS_DISCOVERY',
      });
      request.sourceSync = {
        status: 'SYNCED',
        sourceFingerprint: fingerprint,
        sourceKind: operation.sourceKind,
        syncedAt: nowIso(),
        syncedBy: context.userId,
      };
      request.isGatewayBinding = isBinding;
      request.originId = resolveOriginId(context);
      store.requests.unshift(request);
      created += 1;
      syncedRequestIds.push(request.id);
    }
  }

  audit('IS_API_DISCOVERY_SYNCED', context, {
    serviceKey: resolvedKey,
    specFolder: discovery.product?.specFolder || null,
    collectionId: collection.id,
    created,
    updated,
    skipped,
    discovered: discovery.operations.length,
  });
  saveStore(store);
  return {
    serviceKey: resolvedKey,
    applicationId,
    collectionId: collection.id,
    collectionName: collection.name,
    product: discovery.product || null,
    discovered: discovery.counts,
    warnings: discovery.warnings,
    created,
    updated,
    skipped,
    syncedRequestIds,
    operations: discovery.operations,
  };
}

async function routeRequest(req, parsedUrl, body) {
  const parts = getPathParts(parsedUrl.pathname);
  const [first, second, third, fourth, fifth] = parts;

  if (!parts.length || first === 'health') {
    if (second === 'config' && req.method === 'GET') {
      return inspectProductionSecrets();
    }
    return { ok: true, service: 'api-console', parserVersion: PARSER_VERSION, now: nowIso() };
  }

  if (first === '__test' && second === 'reset' && req.method === 'POST') {
    if (process.env.NODE_ENV !== 'test') {
      throw new ApiConsoleError('INVALID_URL', 'Endpoint not found.', 404);
    }
    store = normalizeStoreShape(defaultStore());
    runtimeSecrets.clear();
    [SECRET_VAULT_FILE, SECRET_KEY_FILE].forEach(file => {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    });
    cachedSecretKey = null;
    saveStore(store);
    return { reset: true, storeVersion: store.version };
  }

  if (first === 'policy' && req.method === 'GET') return API_CONSOLE_POLICY;

  if (first === 'object-storage' && second && !third && req.method === 'GET') {
    requireContext(req, body);
    const blob = objectStore.getBlob(decodeURIComponent(second));
    if (!blob) throw new ApiConsoleError('INVALID_URL', 'Object storage blob not found.', 404);
    return {
      __rawResponse: {
        contentType: blob.contentType || 'application/octet-stream',
        body: blob.body,
      },
    };
  }

  const phase2Result = await tryHandlePhase2(req, parsedUrl, body, parts);
  if (phase2Result !== undefined) return phase2Result;

  const phase3Result = await tryHandlePhase3(req, parsedUrl, body, parts);
  if (phase3Result !== undefined) return phase3Result;

  const runtimeHttpResult = await tryHandleRuntimeHttp(req, parsedUrl, body, parts);
  if (runtimeHttpResult !== undefined) return runtimeHttpResult;

  const sharingResult = await tryHandleSharing(req, parsedUrl, body, parts);
  if (sharingResult !== undefined) return sharingResult;

  if (first === 'is') {
    const { isEnabled: isIsEnabled } = require('../../../is/is-auth-server.cjs');
    if (!isIsEnabled()) {
      throw new ApiConsoleError('IS_DISABLED', 'رویکرد Integrated Systems در نسخهٔ فعلی غیرفعال است.', 403);
    }
  }

  if (first === 'is' && second === 'systems' && third && fourth === 'apis' && req.method === 'GET') {
    const session = requireSession(req);
    if (session.authApproach !== 'IS' && !session.cdeConnected) {
      throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Login required.', 401);
    }
    const { discoverSystemApis } = require('../../../is/is-discovery.cjs');
    return discoverSystemApis(decodeURIComponent(third), session.isGatewayCookie || '', {
      specFolder: parsedUrl.searchParams.get('specFolder') || undefined,
      workspaceIndex: (() => {
        const raw = parsedUrl.searchParams.get('workspace');
        return raw == null || raw === '' ? undefined : Number(raw);
      })(),
    });
  }

  if (first === 'is' && second === 'workspaces' && !third && req.method === 'GET') {
    requireSession(req);
    const { listWorkspaces } = require('../../../is/is-discovery.cjs');
    const { gatewayBaseUrl } = require('../../../is/is-auth-server.cjs');
    return {
      gatewayBaseUrl: gatewayBaseUrl(),
      workspaces: listWorkspaces(),
      discoveredAt: nowIso(),
      source: 'specs-disk',
    };
  }

  if (first === 'is' && second === 'products' && !third && req.method === 'GET') {
    requireSession(req);
    const { listProductsFromDisk } = require('../../../is/is-discovery.cjs');
    const workspaceRaw = parsedUrl.searchParams.get('workspace');
    return listProductsFromDisk({
      workspaceIndex: workspaceRaw == null || workspaceRaw === '' ? undefined : Number(workspaceRaw),
      category: parsedUrl.searchParams.get('category') || undefined,
    });
  }

  if (first === 'is' && second === 'systems' && third && fourth === 'sync' && req.method === 'POST') {
    const context = requireContext(req, body);
    assertCsrf(req);
    const session = requireSession(req);
    return syncIsSystemDiscovery(decodeURIComponent(third), body?.data || body || {}, context, session);
  }

  if (first === 'projects' && second && third === 'discovery') {
    const projectKey = decodeURIComponent(second);
    const context = requireContext(req, body);
    assertRuntimeProjectAccess(projectKey, context);
    if (fourth === 'scan' && req.method === 'POST') return scanRuntimeDiscovery(req, projectKey, context);
    if (fourth === 'latest' && req.method === 'GET') {
      const originFilter = resolveListOriginFilter(context, parsedUrl);
      const snapshot = latestDiscovery(projectKey, originFilter);
      if (!snapshot) throw new ApiConsoleError('DISCOVERY_NOT_FOUND', 'No discovery snapshot exists for this project.', 404);
      return safeClone(snapshot);
    }
    if (fourth && fifth === 'sync' && req.method === 'POST') {
      assertCsrf(req);
      const snapshot = store.discoverySnapshots.find(item => item.id === fourth && item.projectKey === projectKey);
      if (!snapshot) throw new ApiConsoleError('DISCOVERY_NOT_FOUND', 'Discovery snapshot was not found.', 404);
      return safeClone(syncDiscoverySnapshot(snapshot, body.data || body, context));
    }
    throw new ApiConsoleError('INVALID_URL', 'Discovery endpoint not found.', 404);
  }

  if (first === 'admin' && second === 'users') {
    const context = requireContext(req, body);
    assertSystemAdministrator(context);
    if (!third && req.method === 'GET') {
      return safeClone(store.directoryUsers
        .map(directoryUserView)
        .sort((left, right) => Number(right.isSystemAdmin) - Number(left.isSystemAdmin) ||
          Number(right.isActive !== false) - Number(left.isActive !== false) ||
          String(left.fullName || left.username || left.id).localeCompare(String(right.fullName || right.username || right.id), 'fa')));
    }
    if (third && fourth === 'system-admin' && req.method === 'PUT') {
      return safeClone(setManagedSystemAdministrator(decodeURIComponent(third), body.enabled === true, context));
    }
    if (third && fourth === 'roles' && req.method === 'PUT') {
      return safeClone(setManagedDirectoryRole(
        decodeURIComponent(third),
        body.role,
        body.enabled === true,
        context,
        {
          applicationId: body.applicationId,
          applicationIds: body.applicationIds,
        }
      ));
    }
    throw new ApiConsoleError('INVALID_URL', 'User management endpoint not found.', 404);
  }

  if (first === 'admin' && second === 'local-users') {
    const context = requireContext(req, body);
    assertSystemAdministrator(context);
    const helpers = {
      makeId,
      audit,
      saveStore,
      directoryUserView,
      USER_ROLES,
      systemAdministratorCount,
    };
    try {
      if (!third && req.method === 'GET') {
        return safeClone(listLocalDirectoryUsers(store, helpers));
      }
      if (!third && req.method === 'POST') {
        assertCsrf(req);
        return safeClone(await createLocalDirectoryUser(store, body.data || body, context, helpers));
      }
      if (third && !fourth && req.method === 'PATCH') {
        assertCsrf(req);
        return safeClone(await patchLocalDirectoryUser(store, decodeURIComponent(third), body.data || body, context, helpers));
      }
      if (third && fourth === 'reset-password' && req.method === 'POST') {
        assertCsrf(req);
        return safeClone(await resetLocalPassword(
          store,
          decodeURIComponent(third),
          String((body.data || body).password || ''),
          context,
          helpers,
        ));
      }
    } catch (error) {
      if (error instanceof LocalAuthError) {
        throw new ApiConsoleError(error.category, error.message, error.statusCode || 400);
      }
      throw error;
    }
    throw new ApiConsoleError('INVALID_URL', 'Local user management endpoint not found.', 404);
  }

  if (first === 'admin' && second === 'sessions' && req.method === 'GET') {
    const context = requireContext(req, body);
    assertSystemAdministrator(context);
    return { data: await listActiveSessions() };
  }

  if (first === 'admin' && second === 'audit' && req.method === 'GET') {
    const context = requireContext(req, body);
    return safeClone(filterAuditEvents(context, parsedUrl));
  }

  if (first === 'notifications') {
    const context = requireContext(req, body);
    if (!second && req.method === 'GET') {
      return safeClone(listNotificationsForUser(context, parsedUrl));
    }
    if (second === 'read-all' && req.method === 'POST') {
      assertCsrf(req);
      return markAllNotificationsRead(context);
    }
    if (second && third === 'read' && req.method === 'POST') {
      assertCsrf(req);
      return safeClone(markNotificationRead(decodeURIComponent(second), context));
    }
    throw new ApiConsoleError('INVALID_URL', 'Notifications endpoint not found.', 404);
  }

  if (first === 'documentation' && second === 'authentication-profiles' && req.method === 'GET') {
    return safeClone(AUTHENTICATION_DOCUMENTATION_PROFILES);
  }

  if (first === 'environments') {
    if (req.method === 'GET') {
      const includeArchived = parsedUrl.searchParams.get('includeArchived') === 'true';
      const rows = includeArchived ? store.environments : listActiveEnvironments();
      return safeClone(rows);
    }
    const context = requireContext(req, body);
    if (!second && req.method === 'POST') {
      assertCsrf(req);
      return safeClone(createEnvironment(body.data || body, context));
    }
    if (second && !third && req.method === 'PUT') {
      assertCsrf(req);
      return safeClone(updateEnvironment(decodeURIComponent(second), body.data || body, context));
    }
    if (second && third === 'clone' && req.method === 'POST') {
      assertCsrf(req);
      return safeClone(cloneEnvironment(decodeURIComponent(second), context));
    }
    if (second && !third && req.method === 'DELETE') {
      assertCsrf(req);
      return safeClone(archiveEnvironment(decodeURIComponent(second), context, {
        force: body.force === true || parsedUrl.searchParams.get('force') === 'true',
      }));
    }
    throw new ApiConsoleError('INVALID_URL', 'Environments endpoint not found.', 404);
  }
  if (first === 'runners' && req.method === 'GET') return safeClone(store.runners);

  if (first === 'self-check' && req.method === 'GET') return runSelfCheck();

  if (first === 'validate-core' && req.method === 'POST') {
    if (!body.request) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Request payload is required.');
    return validateCoreRequest(body.request);
  }

  if (first === 'consumer-candidates' && req.method === 'GET') {
    const context = requireContext(req, body);
    return safeClone(consumerCandidates(context));
  }

  if (first === 'reports' && second === 'api-usage' && req.method === 'GET') {
    const context = requireContext(req, body);
    return safeClone(filterUsageEvents(context, parsedUrl));
  }

  if (first === 'repository') {
    const context = requireContext(req, body);
    if (req.method === 'GET' && !second) {
      const scope = parsedUrl.searchParams.get('applicationId') || 'ALL';
      const search = (parsedUrl.searchParams.get('search') || '').toLowerCase();
      let rows = store.requests
        .filter(request =>
          request.sourceType !== 'REFERENCE' &&
          REPOSITORY_VISIBLE_STATUSES.has(request.sharingStatus) &&
          request.status !== 'ARCHIVED' &&
          matchesApplicationScope(request.applicationId, scope) &&
          canAccessRepositoryRequest(request, context)
        )
        .map(request => repositoryItemFromRequest(request, context));
      if (search) {
        rows = rows.filter(item => [item.title, item.description, item.apiId, item.version, item.classification?.serviceId, item.classification?.operationPath]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(search)));
      }
      rows = rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return safeClone(paginate(rows, Number(parsedUrl.searchParams.get('page') || 1), Number(parsedUrl.searchParams.get('limit') || 30)));
    }

    const apiId = decodeURIComponent(second || '');
    if (apiId && third === 'versions' && req.method === 'GET' && !fourth) {
      const rows = store.requests
        .filter(request =>
          request.apiId === apiId &&
          request.sourceType !== 'REFERENCE' &&
          REPOSITORY_VISIBLE_STATUSES.has(request.sharingStatus) &&
          request.status !== 'ARCHIVED' &&
          canAccessRepositoryRequest(request, context)
        )
        .sort((a, b) => compareSemVer(semanticVersionOf(b), semanticVersionOf(a)))
        .map(request => repositoryItemFromRequest(request, context));
      return safeClone(rows);
    }

    if (apiId && third === 'versions' && fourth) {
      const version = decodeURIComponent(fourth);
      const sourceRequest = store.requests.find(request =>
        request.apiId === apiId &&
        semanticVersionOf(request) === version &&
        request.sourceType !== 'REFERENCE' &&
        REPOSITORY_VISIBLE_STATUSES.has(request.sharingStatus) &&
        request.status !== 'ARCHIVED'
      );
      if (!sourceRequest || !canAccessRepositoryRequest(sourceRequest, context)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'شما مجوز استفاده از این API را ندارید.', 403);
      }
      if (!fifth && req.method === 'GET') {
        return safeClone({
          ...repositoryItemFromRequest(sourceRequest, context),
          request: sourceRequest,
          shareRequest: store.shareRequests.find(share => share.id === sourceRequest.shareRequestId),
          executions: store.executions.filter(execution => execution.requestId === sourceRequest.id).slice(0, 5),
          manualResponses: store.manualExamples.filter(example => example.requestId === sourceRequest.id),
        });
      }
      if (fifth === 'add-to-console' && req.method === 'POST') {
        if (sourceRequest.sharingStatus === 'DEPRECATED' && !(context.role === 'SYSTEM_ADMIN' && (body.force === true || body.data?.force === true))) {
          throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'نسخه منسوخ‌شده را نمی‌توان به Console اضافه کرد (ادمین می‌تواند با force=true عبور کند).', 409);
        }
        const existing = store.references.find(reference =>
          reference.createdBy === context.userId &&
          reference.apiId === apiId &&
          reference.version === version &&
          reference.status === 'ACTIVE'
        );
        if (existing) {
          throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'این نسخه از API قبلاً به Online API Console شما اضافه شده است.', 409);
        }
        const requestedCollectionId = body.collectionId || body.data?.collectionId;
        let collection = requestedCollectionId ? store.collections.find(item => item.id === requestedCollectionId && belongsToUser(item, context)) : null;
        if (!collection) {
          collection = store.collections.find(item => item.ownerId === context.userId && item.applicationId === sourceRequest.applicationId && item.status === 'ACTIVE');
        }
        if (!collection) {
          collection = {
            id: makeId('api-col'),
            applicationId: sourceRequest.applicationId,
            workspaceName: 'UTMS API Workspace',
            name: 'Repository References',
            ownerId: context.userId,
            status: 'ACTIVE',
            variables: [],
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          store.collections.unshift(collection);
        }
        const reference = {
          id: makeId('api-ref'),
          apiId,
          version,
          sourceRequestId: sourceRequest.id,
          requestId: undefined,
          collectionId: collection.id,
          applicationId: sourceRequest.applicationId,
          createdBy: context.userId,
          createdAt: nowIso(),
          status: 'ACTIVE',
        };
        const referenceRequest = safeClone(sourceRequest);
        referenceRequest.id = makeId('api-req');
        referenceRequest.collectionId = collection.id;
        referenceRequest.createdBy = context.userId;
        referenceRequest.createdAt = nowIso();
        referenceRequest.updatedBy = context.userId;
        referenceRequest.updatedAt = nowIso();
        referenceRequest.sourceType = 'REFERENCE';
        referenceRequest.sourceRequestId = sourceRequest.id;
        referenceRequest.referenceId = reference.id;
        referenceRequest.status = 'ACTIVE';
        referenceRequest.sharingStatus = 'APPROVED';
        referenceRequest.name = `${sourceRequest.name} (${version})`;
        reference.requestId = referenceRequest.id;
        store.references.unshift(reference);
        store.requests.unshift(referenceRequest);
        logUsageEvent('ADDED_TO_CONSOLE', context, referenceRequest, { referenceId: reference.id });
        audit('API_REFERENCE_ADDED', context, { referenceId: reference.id, apiId, version, sourceRequestId: sourceRequest.id });
        saveStore(store);
        return safeClone({ reference, request: referenceRequest });
      }
      if (fifth === 'mark-viewed' && req.method === 'POST') {
        let receipt = readReceiptFor(context, apiId, version);
        if (!receipt) {
          receipt = { id: makeId('read'), userId: context.userId, apiId, version, notifiedAt: nowIso() };
          store.readReceipts.unshift(receipt);
        }
        receipt.viewedAt = nowIso();
        logUsageEvent('NEW_VERSION_VIEWED', context, sourceRequest);
        audit('API_NEW_VERSION_VIEWED', context, { apiId, version });
        saveStore(store);
        return safeClone(receipt);
      }
    }
  }

  if (first === 'references') {
    const context = requireContext(req, body);
    if (!second && req.method === 'GET') {
      const rows = store.references
        .filter(reference => reference.createdBy === context.userId && reference.status === 'ACTIVE')
        .map(reference => ({
          ...reference,
          request: store.requests.find(request => request.id === reference.requestId),
          sourceRequest: store.requests.find(request => request.id === reference.sourceRequestId),
        }));
      return safeClone(rows);
    }
    if (second && req.method === 'DELETE') {
      const reference = store.references.find(item => item.id === second);
      if (!reference || reference.createdBy !== context.userId) {
        throw new ApiConsoleError('INVALID_URL', 'Reference not found.', 404);
      }
      reference.status = 'REMOVED';
      reference.removedAt = nowIso();
      const request = store.requests.find(item => item.id === reference.requestId);
      if (request) {
        request.status = 'ARCHIVED';
        request.updatedBy = context.userId;
        request.updatedAt = nowIso();
      }
      logUsageEvent('REMOVED_FROM_CONSOLE', context, request || { ...reference, name: reference.apiId, apiId: reference.apiId, semanticVersion: reference.version }, { referenceId: reference.id });
      audit('API_REFERENCE_REMOVED', context, { referenceId: reference.id, apiId: reference.apiId, version: reference.version });
      saveStore(store);
      return safeClone(reference);
    }
  }

  if (first === 'shared-apis' && second && third === 'versions' && fourth && fifth === 'consumers' && req.method === 'PUT') {
    const context = requireContext(req, body);
    const apiId = decodeURIComponent(second);
    const version = decodeURIComponent(fourth);
    const sourceRequest = store.requests.find(request =>
      request.apiId === apiId &&
      semanticVersionOf(request) === version &&
      request.sourceType !== 'REFERENCE' &&
      request.sharingStatus === 'APPROVED'
    );
    if (!sourceRequest) throw new ApiConsoleError('INVALID_URL', 'Shared API version not found.', 404);
    if (context.role !== 'SYSTEM_ADMIN') {
      throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to update API consumers.', 403);
    }
    const consumers = normalizeConsumers(body.consumers || body.data?.consumers || [], sourceRequest, context);
    if (!consumers.length) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'انتخاب حداقل یک مصرف‌کننده الزامی است.');
    store.consumers = store.consumers.filter(consumer => !(consumer.apiId === apiId && consumer.version === version));
    store.consumers.unshift(...consumers);
    audit('API_CONSUMERS_UPDATED', context, { apiId, version, consumers });
    saveStore(store);
    return safeClone(consumers);
  }

  if (first === 'collections') {
    if (second && third === 'export-postman' && req.method === 'GET') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canView)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to export API collections.', 403);
      const collection = store.collections.find(item => item.id === second && item.status === 'ACTIVE');
      if (!collection || !belongsToUser(collection, context)) {
        throw new ApiConsoleError('INVALID_URL', 'Collection not found.', 404);
      }
      assertApplicationInContext(collection.applicationId, context);
      const rows = store.requests
        .filter(request =>
          request.collectionId === collection.id &&
          request.status !== 'ARCHIVED' &&
          belongsToUser(request, context)
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const result = buildPostmanCollectionExport(collection, rows);
      audit('API_COLLECTION_EXPORTED_POSTMAN', context, { collectionId: collection.id, requestCount: rows.length });
      saveStore(store);
      return safeClone(result);
    }
    if (req.method === 'GET' && !second) {
      const scope = parsedUrl.searchParams.get('applicationId') || 'ALL';
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canView)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to view API collections.', 403);
      const originFilter = resolveListOriginFilter(context, parsedUrl);
      return safeClone(store.collections.filter(collection =>
        collection.status === 'ACTIVE' &&
        matchesApplicationScope(collection.applicationId, scope) &&
        contextApplicationIds(context).includes(collection.applicationId) &&
        belongsToUser(collection, context) &&
        matchesOriginId(collection, originFilter)
      ));
    }
    if (req.method === 'POST') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canCreate)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to create API collections.', 403);
      const data = body.data || body;
      const applicationId = assertApplicationInContext(data.applicationId, context);
      const collection = {
        id: makeId('api-col'),
        applicationId,
        workspaceName: data.workspaceName || 'UTMS API Workspace',
        name: data.name || 'New Collection',
        description: data.description,
        ownerId: context.userId,
        visibility: data.visibility === 'PROJECT_SHARED' ? 'PROJECT_SHARED' : 'PRIVATE',
        status: 'ACTIVE',
        variables: data.variables || [],
        authenticationDocumentationProfileId: data.authenticationDocumentationProfileId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.collections.unshift(collection);
      audit('API_COLLECTION_CREATED', context, { collectionId: collection.id });
      saveStore(store);
      return safeClone(collection);
    }
  }

  if (first === 'curl' && second === 'parse' && req.method === 'POST') {
    const context = contextFromRequest(req, body) || { userId: body.userId || 'anonymous', role: 'UNKNOWN' };
    const curlText = body.curlText || body.originalCurl || '';
    const secretFindings = scanTextForSecrets(curlText);
    const scanMode = String(process.env.API_CONSOLE_SECRET_SCAN_MODE || 'warn').toLowerCase();
    if (secretFindings.length && scanMode === 'block') {
      throw new ApiConsoleError('CORE_VALIDATION_ERROR', `Secret patterns detected (${secretFindings.join(', ')}). Remove secrets before import.`, 422);
    }
    const preview = parseCurlInternal(curlText);
    preview.secretScan = { findings: secretFindings, mode: scanMode };
    if (secretFindings.length) {
      preview.warnings = [...(preview.warnings || []), ...secretFindings.map(id => `Potential secret pattern detected: ${id}`)];
    }
    store.importedCurls.unshift({
      id: preview.id,
      requestId: undefined,
      originalTextReference: `server://api-console/imported-curl/${preview.id}`,
      sanitizedPreview: sanitizeText(preview.originalCurl),
      detectedDialect: preview.detectedDialect,
      parserVersion: preview.parserVersion,
      importedBy: context.userId,
      importedAt: preview.importedAt,
    });
    audit('API_CURL_IMPORTED', context, { importedCurlId: preview.id, detectedDialect: preview.detectedDialect });
    saveStore(store);
    return safeClone(preview);
  }

  if (first === 'requests' && !second) {
    if (req.method === 'GET') {
      const scope = parsedUrl.searchParams.get('applicationId') || 'ALL';
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canView)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to view API requests.', 403);
      const filters = {
        page: Number(parsedUrl.searchParams.get('page') || 1),
        limit: Number(parsedUrl.searchParams.get('limit') || 30),
        search: parsedUrl.searchParams.get('search') || '',
        collectionId: parsedUrl.searchParams.get('collectionId') || '',
        classificationType: parsedUrl.searchParams.get('classificationType') || '',
        status: parsedUrl.searchParams.get('status') || '',
        folderPath: parsedUrl.searchParams.get('folderPath') || '',
        sourceApproach: String(parsedUrl.searchParams.get('sourceApproach') || '').toUpperCase(),
      };
      const originFilter = resolveListOriginFilter(context, parsedUrl);
      let rows = store.requests.filter(request =>
        matchesApplicationScope(request.applicationId, scope) &&
        contextApplicationIds(context).includes(request.applicationId) &&
        request.status !== 'ARCHIVED' &&
        belongsToUser(request, context) &&
        matchesOriginId(request, originFilter)
      );
      if (filters.collectionId) rows = rows.filter(request => request.collectionId === filters.collectionId);
      if (filters.classificationType) rows = rows.filter(request => request.classification.type === filters.classificationType);
      if (filters.status) rows = rows.filter(request => request.status === filters.status);
      if (filters.sourceApproach === 'CDE') {
        rows = rows.filter(request => request.sourceType === 'CDE_DISCOVERY');
      } else if (filters.sourceApproach === 'IS') {
        rows = rows.filter(request => request.sourceType === 'IS_DISCOVERY');
      } else if (filters.sourceApproach === 'FREE') {
        rows = rows.filter(request => request.sourceType !== 'CDE_DISCOVERY' && request.sourceType !== 'IS_DISCOVERY');
      }
      if (filters.folderPath) {
        const wanted = filters.folderPath === '__root__'
          ? []
          : filters.folderPath.split('/').map(part => decodeURIComponent(part.trim())).filter(Boolean);
        rows = rows.filter(request => {
          const path = Array.isArray(request.folderPath) ? request.folderPath : [];
          if (wanted.length === 0) return path.length === 0;
          return path.length === wanted.length && path.every((part, index) => part === wanted[index]);
        });
      }
      if (filters.search.trim()) {
        const search = filters.search.toLowerCase();
        rows = rows.filter(request =>
          [request.name, request.description, request.urlTemplate, request.classification.serviceId, request.classification.operationPath, ...(request.folderPath || [])]
            .filter(Boolean)
            .some(value => String(value).toLowerCase().includes(search))
        );
      }
      rows = rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return safeClone(paginate(rows, filters.page, filters.limit));
    }
    if (req.method === 'POST') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canCreate)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to create API requests.', 403);
      const data = body.data || body;
      const collection = store.collections.find(item => item.id === data.collectionId);
      if (!collection || !belongsToUser(collection, context)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Target API collection does not belong to the active user.', 403);
      }
      assertApplicationInContext(collection.applicationId, context);
      if (data.applicationId && data.applicationId !== collection.applicationId) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'سامانه Request باید با سامانه Collection یکسان باشد.', 422);
      }
      const request = definitionFromNormalized(data.normalizedRequest || createBlankNormalizedRequest(), {
        id: makeId('api-req'),
        applicationId: collection.applicationId,
        collectionId: data.collectionId,
        environmentId: data.environmentId,
        name: data.name || 'Untitled API Request',
        description: data.description,
        folderPath: Array.isArray(data.folderPath) ? data.folderPath : [],
        userId: context.userId,
        userName: context.user?.fullName || context.userName,
        originalImportedCurl: data.originalImportedCurl,
        importedCurlId: data.importedCurlId,
        authenticationDocumentationProfileId: data.authenticationDocumentationProfileId ||
          collection.authenticationDocumentationProfileId ||
          findEnvironment(data.environmentId)?.authenticationDocumentationProfileId,
      });
      request.originId = resolveOriginId(context);
      store.requests.unshift(request);
      store.importedCurls = store.importedCurls.map(record => record.id === data.importedCurlId ? { ...record, requestId: request.id } : record);
      audit('API_REQUEST_CREATED', context, { requestId: request.id, classification: request.classification.type });
      saveStore(store);
      return safeClone(request);
    }
  }

  if (first === 'requests' && second === 'blank' && req.method === 'POST') {
    const context = requireContext(req, body);
    const data = body.data || body;
    return routeRequest(req, new URL('/api/api-console/requests', 'http://localhost'), {
      ...body,
      data: {
        name: 'Untitled API Request',
        collectionId: data.collectionId,
        applicationId: data.applicationId,
        environmentId: data.environmentId,
        folderPath: Array.isArray(data.folderPath) ? data.folderPath : [],
        normalizedRequest: createBlankNormalizedRequest(),
      },
      context,
    });
  }

  if (first === 'requests' && second) {
    const request = store.requests.find(item => item.id === second);
    if (!request) throw new ApiConsoleError('INVALID_URL', 'Request not found.', 404);
    const viewContext = requireContext(req, body);
    if (!roleAllowed(viewContext.role, API_CONSOLE_POLICY.canView)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to view API requests.', 403);
    if (!belongsToUser(request, viewContext)) {
      throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Request does not belong to the active user.', 403);
    }
    assertApplicationInContext(request.applicationId, viewContext);

    if (!third && req.method === 'GET') {
      logUsageEvent('API_OPENED', viewContext, request, { referenceId: request.referenceId });
      saveStore(store);
      return safeClone(request);
    }
    if (!third && req.method === 'PUT') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canEdit)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to edit API requests.', 403);
      const patch = body.data || body;
      if (patch.collectionId) {
        const collection = store.collections.find(item => item.id === patch.collectionId);
        if (!collection || !belongsToUser(collection, context)) {
          throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Target API collection does not belong to the active user.', 403);
        }
        assertApplicationInContext(collection.applicationId, context);
        if (collection.applicationId !== request.applicationId) {
          throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'انتقال Request بین سامانه‌ها مجاز نیست.', 422);
        }
      }
      if (patch.applicationId && patch.applicationId !== request.applicationId) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'سامانه Request پس از ایجاد قابل تغییر نیست.', 422);
      }
      const index = store.requests.findIndex(item => item.id === second);
      store.requests[index] = upsertRequestWithPatch(request, patch, context);
      audit('API_REQUEST_EDITED', context, { requestId: second });
      saveStore(store);
      return safeClone(store.requests[index]);
    }
    if (!third && req.method === 'DELETE') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canDelete)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to archive API requests.', 403);
      request.status = 'ARCHIVED';
      request.updatedBy = context.userId;
      request.updatedAt = nowIso();
      audit('API_REQUEST_ARCHIVED', context, { requestId: second });
      saveStore(store);
      return safeClone(request);
    }
    if (third === 'share' && req.method === 'POST') {
      const context = requireContext(req, body);
      if (request.sourceType === 'REFERENCE') {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Reference دریافتی از Repository قابل اشتراک‌گذاری مجدد نیست.');
      }
      if (request.createdBy !== context.userId && context.role !== 'SYSTEM_ADMIN') {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'فقط مالک API می‌تواند درخواست اشتراک ارسال کند.', 403);
      }
      if (request.sharingStatus === 'PENDING_REVIEW') {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'ارسال دوباره در وضعیت PENDING_REVIEW مجاز نیست.', 409);
      }
      const data = body.data || body;
      const purpose = String(data.purpose || '').trim();
      const introduction = String(data.introduction || '').trim();
      const description = String(data.description || '').trim();
      const ticketId = String(data.ticketId || '').trim();
      const ticketUrl = String(data.ticketUrl || '').trim();
      if (!purpose || !introduction || !description) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'هدف، مقدمه و توضیحات برای اشتراک API الزامی هستند.');
      }
      if (description.length > 700) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'توضیحات اشتراک API نمی‌تواند بیشتر از ۷۰۰ کاراکتر باشد.');
      }
      if (ticketUrl) {
        const allow = String(process.env.API_CONSOLE_ITSM_URL_ALLOWLIST || '').split(',').map(item => item.trim()).filter(Boolean);
        if (allow.length) {
          try {
            const host = new URL(ticketUrl).hostname.toLowerCase();
            const ok = allow.some(pattern => host === pattern.toLowerCase() || host.endsWith(`.${pattern.toLowerCase()}`));
            if (!ok) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'ticketUrl خارج از allowlist است.', 422);
          } catch (error) {
            if (error instanceof ApiConsoleError) throw error;
            throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'ticketUrl نامعتبر است.', 422);
          }
        }
      }
      let share = store.shareRequests.find(item => item.requestId === request.id && item.status === 'RETURNED');
      if (!share) {
        share = {
          id: makeId('api-share'),
          requestId: request.id,
          apiId: request.apiId,
          apiTitle: request.name,
          applicationId: request.applicationId,
          version: semanticVersionOf(request),
          submittedBy: context.userId,
          submittedByName: context.user?.fullName || context.userId,
          status: 'DRAFT',
          currentRevisionNumber: 0,
          revisions: [],
          rowVersion: makeId('row'),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        store.shareRequests.unshift(share);
      }
      const revisionNumber = (share.revisions || []).length + 1;
      const revision = {
        id: makeId('api-share-rev'),
        shareRequestId: share.id,
        revisionNumber,
        purpose: sanitizeText(purpose),
        introduction: sanitizeText(introduction),
        description: sanitizeText(description),
        snapshot: buildShareSnapshot(request, context),
        submittedBy: context.userId,
        submittedAt: nowIso(),
        status: 'PENDING_REVIEW',
        documentationReference: `server://api-console/share/${share.id}/revision/${revisionNumber}`,
        rowVersion: makeId('row'),
      };
      share.apiTitle = request.name;
      share.version = semanticVersionOf(request);
      share.status = 'PENDING_REVIEW';
      share.currentRevisionNumber = revisionNumber;
      share.purpose = revision.purpose;
      share.introduction = revision.introduction;
      share.description = revision.description;
      share.ticketId = ticketId || share.ticketId;
      share.ticketUrl = ticketUrl || share.ticketUrl;
      share.returnReason = undefined;
      share.rowVersion = makeId('row');
      share.updatedAt = nowIso();
      share.revisions = [...(share.revisions || []), revision];
      request.sharingStatus = 'PENDING_REVIEW';
      request.shareRequestId = share.id;
      request.ticketId = share.ticketId;
      request.ticketUrl = share.ticketUrl;
      request.latestReturnReason = undefined;
      request.updatedAt = nowIso();
      audit(revisionNumber > 1 ? 'API_SHARE_RESUBMITTED' : 'API_SHARE_SUBMITTED', context, {
        shareRequestId: share.id,
        requestId: request.id,
        apiId: request.apiId,
        version: semanticVersionOf(request),
        revisionNumber,
      });
      saveStore(store);
      return safeClone(share);
    }
    if (third === 'versions' && req.method === 'POST') {
      const context = requireContext(req, body);
      if (request.sourceType === 'REFERENCE') {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'برای Reference دریافتی نمی‌توان Version جدید ساخت.');
      }
      if (request.createdBy !== context.userId && context.role !== 'SYSTEM_ADMIN') {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'فقط مالک API می‌تواند Version جدید بسازد.', 403);
      }
      const data = body.data || body;
      const nextVersion = String(data.version || '').trim();
      const changeLog = String(data.changeLog || '').trim();
      const breakingChange = data.breakingChange === true || data.breaking === true;
      const migrationNote = String(data.migrationNote || '').trim();
      requireSemVerGreater(nextVersion, semanticVersionOf(request));
      if (!changeLog) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'Change Log برای Version جدید الزامی است.');
      if (breakingChange && !migrationNote) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'برای Breaking Change، Migration Note الزامی است.');
      }
      const duplicate = store.requests.some(item =>
        item.apiId === request.apiId &&
        semanticVersionOf(item) === nextVersion &&
        item.sourceType !== 'REFERENCE' &&
        item.status !== 'ARCHIVED'
      );
      if (duplicate) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'این Version برای API قبلاً وجود دارد.', 409);
      }
      const next = safeClone(request);
      next.id = makeId('api-req');
      next.semanticVersion = nextVersion;
      next.sharingStatus = 'DRAFT';
      next.shareRequestId = undefined;
      next.latestReturnReason = undefined;
      next.approvedAt = undefined;
      next.approvedBy = undefined;
      next.sourceType = 'ORIGINAL';
      next.referenceId = undefined;
      next.sourceRequestId = undefined;
      next.breakingChange = breakingChange;
      next.migrationNote = migrationNote || undefined;
      next.createdBy = context.userId;
      next.ownerId = context.userId;
      next.createdAt = nowIso();
      next.updatedBy = context.userId;
      next.updatedAt = nowIso();
      next.version = 1;
      next.documentation = {
        ...(next.documentation || {}),
        version: nextVersion,
        changeHistory: [
          ...(next.documentation?.changeHistory || []),
          { version: nextVersion, changedAt: nowIso(), summary: sanitizeText(changeLog) },
        ],
      };
      store.requests.unshift(protectRequestSecrets(next));
      if (breakingChange) {
        const correlationId = makeId('api-corr');
        consumersForVersion(request.apiId, semanticVersionOf(request)).forEach(consumer => {
          if (consumer.consumerType === 'USER' && consumer.userId) {
            notifyUser(consumer.userId, 'Breaking Change در API', `${request.name} نسخه ${nextVersion}: ${migrationNote}`, 'API_REQUEST', next.id, correlationId);
          }
        });
      }
      audit('API_VERSION_CREATED', context, { requestId: next.id, apiId: next.apiId, version: nextVersion, changeLog, breakingChange, migrationNote });
      saveStore(store);
      return safeClone(next);
    }
    if (third === 'execute' && req.method === 'POST') {
      const context = requireContext(req, body);
      // CDE Runtime path only when a full Runtime Profile binding exists (not IS Gateway bindings).
      if (
        request.runtimeBinding?.operationId
        && request.runtimeBinding?.runtimeProfileId
        && request.sourceType !== 'IS_DISCOVERY'
        && !request.isGatewayBinding
      ) {
        const options = body.options || body;
        if (options.runtimeProfileId && options.runtimeProfileId !== request.runtimeBinding.runtimeProfileId) {
          throw new ApiConsoleError('RUNTIME_BINDING_INVALID', 'Request execution cannot override its synced Runtime Profile binding.', 422);
        }
        const parsedBody = parseJsonSafely(request.bodyTemplate || '{}');
        const bodyValue = parsedBody.ok && parsedBody.value && typeof parsedBody.value === 'object' ? parsedBody.value : {};
        const input = options.input || (request.classification.type === 'CORE_COMMAND' ? bodyValue.data : request.classification.type === 'CORE_QUERY' ? bodyValue.params : bodyValue);
        return executeRuntimeDiscoveredOperation(req, request.runtimeBinding.operationId, {
          ...options,
          requestId: request.id,
          projectKey: request.runtimeBinding.projectKey,
          runtimeProfileId: request.runtimeBinding.runtimeProfileId,
          expectedProjectServiceId: request.runtimeBinding.projectServiceId,
          confirmed: options.confirmed ?? options.productionCommandConfirmed,
          input,
        }, context);
      }
      return executeRequest(second, context, body.options || body);
    }
    if (third === 'executions' && req.method === 'GET') {
      return safeClone(store.executions.filter(execution => execution.requestId === second));
    }
    if (third === 'export-curl' && req.method === 'POST') {
      const context = contextFromRequest(req, body);
      if (request.runtimeBinding?.operationId) {
        const runtimeContext = context || viewContext;
        const profile = findRuntimeProfile(body.runtimeProfileId || request.runtimeBinding.runtimeProfileId, runtimeContext);
        const snapshot = latestDiscovery(request.runtimeBinding.projectKey);
        if (!snapshot) throw new ApiConsoleError('DISCOVERY_NOT_FOUND', 'The discovery snapshot for this Runtime request is unavailable.', 404);
        return buildRuntimeCurlExport(request.runtimeBinding.projectKey, profile, snapshot, request.runtimeBinding.operationId, body.mode || 'sample');
      }
      const dialect = body.dialect || 'bash';
      const exposeSecrets = !!body.exposeSecrets && context && roleAllowed(context.role, ['SYSTEM_ADMIN']);
      return { value: exportRequestAsCurl(request, dialect, exposeSecrets) };
    }
    if (third === 'validate-core') {
      return validateCoreRequest(request);
    }
    if (third === 'effective-request' && req.method === 'GET') {
      const environment = findEnvironment(parsedUrl.searchParams.get('environmentId') || request.environmentId);
      const executionMode = parsedUrl.searchParams.get('executionMode') || request.executionMode;
      return safeClone(resolveRequest(request, environment, executionMode).snapshot);
    }
    if (third === 'manual-responses') {
      if (req.method === 'GET') return safeClone(store.manualExamples.filter(example => example.requestId === second));
      if (req.method === 'POST') {
        const context = requireContext(req, body);
        const data = body.data || body;
        const headers = String(data.headersText || '')
          .split(/\r?\n/)
          .map(line => parseHeaderLine(line))
          .filter(Boolean)
          .map((header, index) => createHeader(header.name, header.value, index, 'USER'));
        const example = {
          id: makeId('manual-response'),
          requestId: second,
          statusCode: Number(data.statusCode || 200),
          headers,
          body: sanitizeText(data.body || ''),
          claimedEnvironmentId: data.claimedEnvironmentId,
          source: data.source,
          reason: data.reason,
          enteredBy: context.userId,
          enteredAt: nowIso(),
          reviewStatus: 'PENDING',
        };
        store.manualExamples.unshift(example);
        audit('API_MANUAL_RESPONSE_ADDED', context, { requestId: second, manualResponseId: example.id });
        saveStore(store);
        return safeClone(example);
      }
    }
    if (third === 'documentation' && fourth === 'refresh' && req.method === 'POST') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canEdit)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to edit API documentation.', 403);
      request.documentation = refreshDocumentationMetadata(request, store.executions, store.manualExamples);
      request.updatedBy = context.userId;
      request.updatedAt = nowIso();
      request.version = (request.version || 1) + 1;
      audit('API_DOCUMENTATION_METADATA_REFRESHED', context, { requestId: second });
      saveStore(store);
      return safeClone(request);
    }
    if (third === 'documentation' && fourth === 'preview' && req.method === 'POST') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canGenerateDocumentation)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to generate documentation.', 403);
      const result = generateDocumentationMarkdown(request, store.executions, store.manualExamples, context.user?.fullName || context.userId);
      audit('API_DOCUMENTATION_PREVIEWED', context, { requestId: second });
      saveStore(store);
      return safeClone(result);
    }
    if (third === 'documentation' && fourth === 'final' && req.method === 'POST') {
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canGenerateDocumentation)) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to generate documentation.', 403);
      const language = String(body.language || body.data?.language || 'FA').toUpperCase() === 'EN' ? 'EN' : 'FA';
      const result = generateDocumentationMarkdown(request, store.executions, store.manualExamples, context.user?.fullName || context.userId);
      if (language === 'EN') {
        result.language = 'EN';
        result.sectionLabels = {
          title: 'API Operations Guide',
          introduction: 'Introduction',
          method: 'Method',
          endpoint: 'Endpoint',
          headers: 'Header parameters',
          inputs: 'Input parameters',
          outputs: 'Output parameters',
          sample: 'Sample call',
        };
      } else {
        result.language = 'FA';
        result.sectionLabels = {
          title: 'مستندات بهره‌برداری',
          introduction: 'مقدمه',
          method: 'متد',
          endpoint: 'آدرس',
          headers: 'پارامترهای سرایند',
          inputs: 'پارامترهای ورودی',
          outputs: 'پارامترهای خروجی',
          sample: 'نمونه فراخوانی',
        };
      }
      const activeTemplate = store.branding?.templates?.find(item => item.id === store.branding?.activeTemplateId);
      const templatePath = activeTemplate?.filePath && fs.existsSync(activeTemplate.filePath)
        ? activeTemplate.filePath
        : DOCX_TEMPLATE_FILE;
      const docxBuffer = buildDocxFromTemplate(request, result, store.executions, store.manualExamples, templatePath);
      const finalResult = { ...result, approved: roleAllowed(context.role, ['SYSTEM_ADMIN', 'TECH_LEAD', 'QA_LEAD']) };
      finalResult.wordDocumentBase64 = docxBuffer.toString('base64');
      finalResult.wordFileName = docxFileName(request);
      finalResult.wordMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      finalResult.templateId = activeTemplate?.id || 'default';
      store.documentationResults.unshift(finalResult);
      audit('API_DOCUMENTATION_GENERATED', context, { requestId: second, approved: finalResult.approved, language, templateId: finalResult.templateId });
      saveStore(store);
      return safeClone(finalResult);
    }
  }

  if (first === 'executions' && second) {
    const execution = store.executions.find(item => item.id === second);
    if (!execution) throw new ApiConsoleError('INVALID_URL', 'Execution not found.', 404);
    if (!third && req.method === 'GET') return safeClone(execution);
    if (third === 'cancel' && req.method === 'POST') {
      const context = requireContext(req, body);
      if (!['PENDING', 'RUNNING'].includes(execution.status)) return safeClone(execution);
      execution.status = 'CANCELLED';
      execution.transportResult = 'CANCELLED';
      execution.businessResult = 'NOT_EVALUATED';
      execution.completedAt = nowIso();
      execution.errorCategory = 'EXECUTION_CANCELLED';
      execution.sanitizedError = `Execution cancelled by ${context.user?.fullName || context.userId}.`;
      audit('API_REQUEST_EXECUTION_CANCELLED', context, { executionId: second });
      saveStore(store);
      return safeClone(execution);
    }
  }

  throw new ApiConsoleError('INVALID_URL', 'API Console endpoint not found.', 404);
}

function createDocumentationAcceptanceFixture() {
  const normalized = createBlankNormalizedRequest();
  normalized.method = 'POST';
  normalized.url = 'https://esb.medu.ir/TeacherUniversityFunds/GetTeacherUniversityFundData';
  normalized.headers = [
    createHeader('Content-Type', 'application/json', 0, 'USER'),
    createHeader('token', 'gBLon4YS-real-secret-token-jpMQ==', 1, 'USER'),
    createHeader('Content-Length', '1234', 2, 'IMPORTED_CURL'),
  ];
  normalized.body = {
    type: 'json',
    value: { nationalCode: '3651113262' },
    raw: '{"nationalCode":"3651113262"}',
    contentType: 'application/json',
  };
  const request = definitionFromNormalized(normalized, {
    applicationId: 'app',
    collectionId: 'col',
    environmentId: 'env-test',
    name: 'وب سرویس استعلام کسورات دانشجو معلم',
    description: 'این سرویس جزئیات کسورات دانشجو معلم را استعلام می‌کند.',
    userId: 'u',
  });
  const nationalCode = request.documentation.inputParameters.find(row => row.name === 'nationalCode');
  nationalCode.required = true;
  nationalCode.description = 'کدملی فرد مورد نظر';
  const manualExamples = [{
    id: 'manual-doc',
    requestId: request.id,
    statusCode: 200,
    reviewStatus: 'APPROVED',
    body: JSON.stringify({
      EmployeeCode: '82123484',
      WorkPlaceCode: 4911,
      WorkPlaceTitle: 'زرآباد',
      NetPayablePrice: '304156763',
      DeductionsSumPrice: '13745265',
    }),
  }];
  request.documentation = refreshDocumentationMetadata(request, [], manualExamples);
  const descriptions = {
    WorkPlaceCode: ['Integer', 'کد منطقه'],
    EmployeeCode: ['Integer', 'کد پرسنلی'],
    WorkPlaceTitle: ['string', 'نام منطقه'],
    NetPayablePrice: ['Integer', 'مجموع استعلامی'],
    DeductionsSumPrice: ['Integer', 'مجموع کسورات'],
  };
  request.documentation.outputParameters = request.documentation.outputParameters.map(row => descriptions[row.name]
    ? { ...row, dataType: descriptions[row.name][0], description: descriptions[row.name][1] }
    : row);
  return { request, manualExamples };
}

function runSelfCheck() {
  const cases = [
    { name: 'Bash GET cURL import', run: () => parseCurlInternal('curl https://example.com').effectiveMethod === 'GET' },
    { name: 'Wrapped Bash cURL import', run: () => parseCurlInternal(`"curl --location 'https://example.com/api' --header 'Cookie: sid=abc; _ga=GA1' --data '{"ok":true}'"`).normalizedRequest.cookies.length === 2 },
    { name: 'Bash POST JSON import', run: () => parseCurlInternal(`curl https://example.com -H 'content-type: application/json' --data-raw '{"id":1}'`).normalizedRequest.body.type === 'json' },
    { name: 'Windows CMD caret escaping', run: () => parseCurlInternal('curl "https://example.com" -H ^"client-id: abc^" --data-raw ^"{^\\^"id^\\^":1^}"').effectiveMethod === 'POST' },
    { name: 'PowerShell import', run: () => parseCurlInternal("curl 'https://example.com' -H 'accept: application/json'").detectedDialect !== 'WINDOWS_CMD' },
    { name: '--data-raw method inference', run: () => parseCurlInternal(`curl https://example.com --data-raw '{"id":1}'`).effectiveMethod === 'POST' },
    { name: 'Explicit -X method priority', run: () => parseCurlInternal(`curl -X GET https://example.com --data-raw '{"id":1}'`).effectiveMethod === 'GET' },
    { name: '--insecure parsing', run: () => parseCurlInternal('curl -k https://example.com').normalizedRequest.tls.verifyCertificate === false },
    { name: '--location parsing', run: () => parseCurlInternal('curl --location https://example.com').unsupportedOptions.length === 0 },
    { name: 'Core Command detection', run: () => parseCurlInternal(`curl https://host/core-api/v1/data-provider/store-form-data --data-raw '{"serviceId":"svc","formId":"path/delete","data":{}}'`).normalizedRequest.classification.type === 'CORE_COMMAND' },
    { name: 'Core Query detection', run: () => parseCurlInternal(`curl https://host/core-api/v1/data-provider/get-data-source --data-raw '{"serviceId":"svc","key":"path/load","params":{}}'`).normalizedRequest.classification.type === 'CORE_QUERY' },
    { name: 'Generic POST remains generic', run: () => parseCurlInternal(`curl https://example.com/users --data-raw '{"name":"Example"}'`).normalizedRequest.classification.type === 'GENERIC_HTTP' },
    { name: 'Generic GET remains generic', run: () => parseCurlInternal('curl https://example.com/users').normalizedRequest.classification.type === 'GENERIC_HTTP' },
    { name: 'Secret masking', run: () => createHeader('authorization', 'Bearer abcdefgh', 0).maskedValue.includes('*') },
    { name: 'Secret vault persistence', run: () => {
      const ref = rememberSecret('persisted-secret-value');
      runtimeSecrets.delete(ref);
      const errors = [];
      return resolveSecretReference(ref, errors) === 'persisted-secret-value' && errors.length === 0;
    } },
    { name: 'TLS hostname mismatch categorization', run: () => isTlsTransportError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: "Hostname/IP does not match certificate's altnames" }) },
    { name: 'Pre-request script mutation', run: () => {
      const request = definitionFromNormalized(createBlankNormalizedRequest(), { applicationId: 'app', collectionId: 'col', environmentId: 'env-development', name: 'script', userId: 'u' });
      const result = runPreRequestScript(request, { preRequestEnabled: true, preRequest: 'setQuery("page", "2")\nsetHeader("x-test", "ok")' }, {});
      return result.results.every(item => item.result === 'PASSED') &&
        result.request.queryParameters.some(param => param.name === 'page' && param.value === '2') &&
        result.request.headers.some(header => header.name === 'x-test' && header.valueTemplate === 'ok');
    } },
    { name: 'Post-response script tests', run: () => {
      const response = { statusCode: 200, durationMs: 42, contentType: 'application/json', bodyPreview: '{"data":{"id":1}}', headers: [createHeader('content-type', 'application/json', 0, 'SYSTEM')] };
      const results = runPostResponseScript({ postResponseEnabled: true, postResponse: 'testStatus(200)\ntestJsonPath("$.data.id")\ntestHeaderContains("content-type", "json")' }, response);
      return results.length === 3 && results.every(item => item.result === 'PASSED');
    } },
    { name: 'Template DOCX generation', run: () => {
      const request = definitionFromNormalized(createBlankNormalizedRequest(), { applicationId: 'app', collectionId: 'col', environmentId: 'env-development', name: 'docx', userId: 'u' });
      const result = generateDocumentationMarkdown(request, [], [], 'self-check');
      const buffer = buildDocxFromTemplate(request, result, [], []);
      return buffer.slice(0, 2).toString('utf8') === 'PK' && buffer.length > 10000;
    } },
    { name: 'Documentation includes Body Content-Type header', run: () => {
      const normalized = createBlankNormalizedRequest();
      normalized.method = 'POST';
      normalized.body = { type: 'json', value: { id: 1 }, raw: '{"id":1}', contentType: 'application/json' };
      normalized.headers = [];
      const request = definitionFromNormalized(normalized, { applicationId: 'app', collectionId: 'col', environmentId: 'env-development', name: 'doc', userId: 'u' });
      const markdown = generateDocumentationMarkdown(request, [], [], 'self-check').markdown;
      return markdown.includes('پارامتر های سرایند') &&
        markdown.toLowerCase().includes('content-type') &&
        markdown.includes('application/json');
    } },
    { name: 'Documentation JSON field extraction and type inference', run: () => {
      const rows = inferStructuredDocumentationParameters({ student: { nationalCode: '1234567890', active: true }, items: [{ amount: 12.5 }], count: 2, empty: null }, 'BODY');
      const byName = Object.fromEntries(rows.map(row => [row.name, row]));
      return byName.student.dataType === 'object' &&
        byName['student.nationalCode'].dataType === 'string' &&
        byName['student.active'].dataType === 'boolean' &&
        byName['items[]'].dataType === 'array' &&
        byName['items[].amount'].dataType === 'Number' &&
        byName.count.dataType === 'Integer' &&
        byName.empty.dataType === 'unknown' &&
        rows.every(row => row.required === null);
    } },
    { name: 'Documentation refresh preserves manual descriptions and required status', run: () => {
      const normalized = createBlankNormalizedRequest();
      normalized.method = 'POST';
      normalized.body = { type: 'json', value: { student: { id: 1 } }, raw: '{"student":{"id":1}}', contentType: 'application/json' };
      const request = definitionFromNormalized(normalized, { applicationId: 'app', collectionId: 'col', environmentId: 'env-test', name: 'refresh', userId: 'u' });
      request.documentation.inputParameters = request.documentation.inputParameters.map(row => row.name === 'student.id'
        ? { ...row, required: true, description: 'شناسه دانش‌آموز' }
        : row);
      request.bodyTemplate = '{"student":{"id":1,"name":"علی"}}';
      const refreshed = refreshDocumentationMetadata(request);
      const id = refreshed.inputParameters.find(row => row.name === 'student.id');
      return id.required === true && id.description === 'شناسه دانش‌آموز' && refreshed.inputParameters.some(row => row.name === 'student.name');
    } },
    { name: 'Documentation header filtering keeps business and masked authentication headers', run: () => {
      const normalized = createBlankNormalizedRequest();
      normalized.headers = [
        createHeader('Host', 'example.com', 0), createHeader('Connection', 'keep-alive', 1),
        createHeader('Content-Length', '20', 2), createHeader('User-Agent', 'browser', 3),
        createHeader('token', 'actual-token-value', 4), createHeader('x-business-unit', 'education', 5),
      ];
      const request = definitionFromNormalized(normalized, { applicationId: 'app', collectionId: 'col', environmentId: 'env-test', name: 'headers', userId: 'u' });
      const rows = inferHeaderDocumentationParameters(request);
      return rows.some(row => row.name === 'token' && row.exampleValue.includes('*')) &&
        rows.some(row => row.name === 'x-business-unit') &&
        !rows.some(row => ['Host', 'Connection', 'Content-Length', 'User-Agent'].includes(row.name));
    } },
    { name: 'Documentation cURL masking removes Content-Length and secrets', run: () => {
      const safe = sanitizeDocumentationCurl("curl --header 'Content-Length: 99' --header 'token: actual-secret-token' --data '{\"password\":\"real-password\"}' https://example.com");
      return !/content-length/i.test(safe) && !safe.includes('actual-secret-token') && !safe.includes('real-password') && safe.includes('****');
    } },
    { name: 'Documentation response schema is not execution metadata', run: () => {
      const { request, manualExamples } = createDocumentationAcceptanceFixture();
      const view = buildDocumentationViewModel(request, [], manualExamples);
      const names = view.outputs.map(row => row.name);
      return names.includes('WorkPlaceCode') && names.includes('EmployeeCode') &&
        !names.some(name => ['Duration', 'Response Size', 'Evidence Type', 'HTTP Status'].includes(name));
    } },
    { name: 'Documentation groups nested output arrays and renders allowed values', run: () => {
      const request = definitionFromNormalized(createBlankNormalizedRequest(), {
        applicationId: 'app', collectionId: 'col', environmentId: 'env-test', name: 'سپرده کارکنان', userId: 'u',
      });
      const responseBody = {
        data: [{
          personnel_code: '12345', area_code: '1001', month: '04', year: '1405', sep_jari: '100000', percent: '3', isnew: '1',
          deposit_status: '0', sanavat: '12', total_count: 25, page_count: 3, data: [],
        }],
        total_count: 25,
        page_count: 3,
      };
      const manualExamples = [{
        requestId: request.id, statusCode: 200, reviewStatus: 'APPROVED', enteredAt: nowIso(), body: JSON.stringify(responseBody),
      }];
      request.documentation = refreshDocumentationMetadata(request, [], manualExamples);
      const descriptions = {
        'data[]': ['string', 'لیستی از اطلاعات درخواست شده'],
        total_count: ['integer', 'مجموع ردیف ها'],
        page_count: ['integer', 'مجموع صفحات'],
        'data[].personnel_code': ['string', 'کد پرسنلی'],
        'data[].area_code': ['string', 'کد منطقه'],
        'data[].month': ['string', 'ماه'],
        'data[].year': ['string', 'سال'],
        'data[].sep_jari': ['string', 'حق عضویت (مبلغی که ماهانه از حقوق کسر می‌شود)'],
        'data[].percent': ['string', 'درصد حق عضویت (۲، ۳، ۴، ۵ درصد)'],
        'data[].isnew': ['string', 'شامل (۰: قدیمی، ۱: جدید)'],
        'data[].deposit_status': ['string', 'وضعیت سپرده (براساس جدول کدها)'],
        'data[].sanavat': ['string', 'سنوات'],
        'data[].total_count': ['integer', 'مجموع ردیف ها'],
        'data[].page_count': ['integer', 'مجموع صفحات'],
        'data[].data[]': ['list', 'لیستی از اطلاعات درخواست شده'],
      };
      request.documentation.outputParameters = request.documentation.outputParameters.map(row => descriptions[row.name]
        ? { ...row, dataType: descriptions[row.name][0], description: descriptions[row.name][1] }
        : row);
      const depositStatus = request.documentation.outputParameters.find(row => row.name === 'data[].deposit_status');
      const result = generateDocumentationMarkdown(request, [], manualExamples, 'self-check');
      const buffer = buildDocxFromTemplate(request, result, [], manualExamples);
      const documentXml = inflateZipEntry(readZipEntries(buffer).find(entry => entry.name === 'word/document.xml')).toString('utf8');
      return request.documentation.outputParameters.some(row => row.name === 'data[]' && !row.parentPath) &&
        request.documentation.outputParameters.some(row => row.name === 'data[].personnel_code' && row.parentPath === 'data[]') &&
        depositStatus.allowedValues.length === 12 && depositStatus.allowedValues[11].value === '11' &&
        result.markdown.includes('### پارامترهای خروجی data:') &&
        result.markdown.includes('| 1 | personnel_code | string | کد پرسنلی |') &&
        result.markdown.includes('#### مقادیر مجاز برای فیلد deposit_status:') &&
        result.markdown.includes('| 0 | عادی (بدون تغییر) |') && result.markdown.includes('| 11 | انصراف در منطقه |') &&
        documentXml.includes('پارامترهای خروجی data:') && documentXml.includes('مقادیر مجاز برای فیلد deposit_status:') &&
        !documentXml.includes('data[].personnel_code');
    } },
    { name: 'Documentation metadata remains backward compatible', run: () => {
      const legacy = {
        id: 'legacy', name: 'Legacy API', description: 'Legacy description', method: 'GET', urlTemplate: 'https://example.com/legacy',
        headers: [], queryParameters: [], cookies: [], bodyType: 'none', bodyTemplate: '', authentication: { type: 'none' },
        tls: { verifyCertificate: true }, executionMode: 'RECOMMENDED', classification: { type: 'GENERIC_HTTP' },
        applicationId: 'app', collectionId: 'col', environmentId: 'env-test', version: 1, documentation: { title: 'Legacy API', description: 'Legacy description' },
      };
      const normalized = ensureRequestApiFields(legacy);
      return normalized.documentation.serviceIntroduction === 'Legacy description' &&
        Array.isArray(normalized.documentation.responseCodes) && normalized.documentation.responseCodes.length === 28 &&
        Array.isArray(normalized.documentation.inputParameters);
    } },
    { name: 'Persian operational DOCX structure, TOC, tables, appendix and redaction', run: () => {
      const { request, manualExamples } = createDocumentationAcceptanceFixture();
      const result = generateDocumentationMarkdown(request, [], manualExamples, 'self-check');
      const buffer = buildDocxFromTemplate(request, result, [], manualExamples);
      const entries = readZipEntries(buffer);
      const documentEntry = entries.find(entry => entry.name === 'word/document.xml');
      const settingsEntry = entries.find(entry => entry.name === 'word/settings.xml');
      const xml = inflateZipEntry(documentEntry).toString('utf8');
      const settings = inflateZipEntry(settingsEntry).toString('utf8');
      const entryNames = new Set(entries.map(entry => entry.name));
      const headings = [
        'مستندات بهره برداری', 'مقدمه سرویس احراز هویت', 'سرویس احراز هویت',
        'ورودی ها', 'ادرس و متد درخواست', 'پارامتر های سرایند', 'پارامتر های ورودی',
        'خروجی ها', 'پارامترهای خروجی', 'نمونه فراخوانی دریافت جزئیات وب سرویس',
        'نمونه تست موفق دریافت جزئیات وب سرویس', 'پیوست – مرجع کدهای پاسخ و خطا', 'کدهای پاسخ HTTPS وب سرویس',
      ];
      return buffer.slice(0, 2).toString('utf8') === 'PK' &&
        ['[Content_Types].xml', 'word/styles.xml', 'word/header1.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels', 'word/media/image1.jpeg'].every(name => entryNames.has(name)) &&
        xml.includes('r:embed="rId8"') &&
        headings.every(heading => xml.includes(heading)) &&
        ['ردیف', 'نام پارامتر', 'نوع یا مقدار نمونه', 'نوع', 'الزامی', 'توضیحات'].every(column => xml.includes(column)) &&
        xml.includes('TOC \\o') && settings.includes('<w:updateFields w:val="true"/>') &&
        !xml.includes('gBLon4YS-real-secret-token-jpMQ==') && !xml.includes('3651113262') && !xml.includes('82123484') &&
        result.markdown.includes('کدهای پاسخ HTTPS') && result.markdown.includes('3651***262') &&
        result.markdown.includes('gBLon4YS...****...jpMQ==') && result.markdown.includes('82****84') &&
        result.markdown.includes('3041**763') && result.markdown.includes('137**265');
    } },
    { name: 'Postman collection export masks secrets', run: () => {
      const normalized = createBlankNormalizedRequest();
      normalized.method = 'POST';
      normalized.url = 'https://esb.medu.ir/TeacherUniversityFunds/GetTeacherUniversityFundData';
      normalized.headers = [createHeader('Token', 'Q2oB0wJBmldnwLMwSecretTokenValue', 0, 'USER')];
      normalized.body = { type: 'json', value: { nationalCode: '3651113262' }, raw: '{"nationalCode":"3651113262"}', contentType: 'application/json' };
      const request = definitionFromNormalized(normalized, { applicationId: 'app', collectionId: 'col', environmentId: 'env-development', name: 'GetTeacherUniversityFundData', userId: 'u' });
      const exported = buildPostmanCollectionExport({ id: 'api-col-011a6723-ec6e-45bf-9ef2-65a4bb57f594', name: 'GetTeacherUniversityFundData' }, [request]).collection;
      const text = JSON.stringify(exported);
      return text.includes('https://schema.getpostman.com/json/collection/v2.1.0/collection.json') &&
        text.includes('content-type') &&
        text.includes('Token') &&
        !text.includes('Q2oB0wJBmldnwLMwSecretTokenValue') &&
        !text.includes('3651113262');
    } },
    { name: 'SSRF localhost protection', run: async () => {
      try {
        await validateDestination('http://127.0.0.1:80');
        return false;
      } catch (error) {
        return error.category === 'DESTINATION_NOT_ALLOWED';
      }
    } },
    { name: 'Bash cURL export masks secrets', run: () => exportRequestAsCurl(definitionFromNormalized(createBlankNormalizedRequest(), { applicationId: 'app', collectionId: 'col', environmentId: 'env-development', name: 'x', userId: 'u' }), 'bash').includes('curl') },
  ];
  return Promise.all(cases.map(async item => {
    try {
      return { name: item.name, passed: await item.run() };
    } catch (error) {
      return { name: item.name, passed: false, message: error.message };
    }
  })).then(details => ({
    passed: details.filter(item => item.passed).length,
    failed: details.filter(item => !item.passed).length,
    details,
  }));
}

function resolveCorsOrigin(req) {
  const configured = String(process.env.API_CONSOLE_CORS_ORIGIN || '').trim();
  const requestOrigin = String(req.headers.origin || '').trim();
  const env = process.env.NODE_ENV || 'development';
  // In local/dev, reflect Vite origin so auto-bumped ports keep working,
  // and reflect the local SSO proxy host (https://api-console.edus.ir).
  if (env === 'development' || env === 'test') {
    if (requestOrigin.startsWith('http://localhost:')) return requestOrigin;
    if (requestOrigin.startsWith('http://127.0.0.1:')) return requestOrigin;
    try {
      const originHost = new URL(requestOrigin).hostname.toLowerCase();
      if (originHost === 'api-console.edus.ir' || originHost === 'cde.edus.ir' || originHost.endsWith('.edus.ir')) {
        return requestOrigin;
      }
    } catch {
      // fall through
    }
  }
  if (configured) return configured;
  return `http://localhost:${Number(process.env.WEB_PORT || 5280)}`;
}

function createServer() {
  assertProductionSecrets();
  startObjectStoreCleanupInterval();
  return http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', resolveCorsOrigin(req));
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type,x-csrf-token,x-utms-context,x-api-console-context');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (await serveOpenApiDocs(req, res, parsedUrl)) return;

      if (!storeReady && parsedUrl.pathname !== '/api/health') {
        throw new ApiConsoleError('STORE_NOT_READY', 'Persistence layer is still initializing.', 503);
      }

      await attachSession(req, res);
      attachConsoleContext(req);

      if (parsedUrl.pathname === '/api/health' && req.method === 'GET') {
        const { isEnabled: isIsEnabled } = require('../../../is/is-auth-server.cjs');
        sendJson(res, 200, {
          status: storeReady ? 'ok' : 'starting',
          service: 'api-console',
          release: 'v1-cde-local',
          storeBackend: STORE_BACKEND,
          storeReady,
          isEnabled: isIsEnabled(),
          checkedAt: nowIso(),
          modules: ['api-console', 'cde-bridge', 'local-auth', 'session'],
        });
        return;
      }
      if (parsedUrl.pathname === '/api/__perf/metrics' && req.method === 'GET') {
        if (!['test', 'performance', 'development'].includes(process.env.NODE_ENV || 'development')) {
          throw new ApiConsoleError('INVALID_URL', 'Endpoint not found.', 404);
        }
        sendJson(res, 200, performanceMetricsSnapshot());
        return;
      }
      if (canHandleSession(parsedUrl.pathname)) {
        const body = await readJsonBody(req, 1024 * 1024);
        const result = await handleSession(req, parsedUrl, body, res);
        sendJson(res, 200, result);
        return;
      }
      if (canHandleLocalAuth(parsedUrl.pathname)) {
        const body = await readJsonBody(req, 1024 * 1024);
        try {
          const result = await handleLocalAuth(req, parsedUrl, body);
          sendJson(res, 200, result);
        } catch (error) {
          if (error instanceof LocalAuthError) {
            sendJson(res, error.statusCode || 400, {
              error: {
                category: error.category,
                message: error.message,
                ...(error.details ? { details: error.details } : {}),
              },
            });
            return;
          }
          throw error;
        }
        return;
      }
      if (canHandleCde(parsedUrl.pathname)) {
        const body = await readJsonBody(req, Number(process.env.CDE_MAX_BODY_BYTES || 32 * 1024 * 1024));
        const result = await handleCde(req, parsedUrl, body);
        sendJson(res, 200, result);
        return;
      }
      if (canHandleIs(parsedUrl.pathname)) {
        const body = await readJsonBody(req, 1024 * 1024);
        const result = await handleIs(req, parsedUrl, body);
        sendJson(res, 200, result);
        return;
      }
      if (!parsedUrl.pathname.startsWith('/api/api-console') && !parsedUrl.pathname.startsWith('/api/reports')) {
        throw new ApiConsoleError('INVALID_URL', 'Endpoint not found.', 404);
      }
      const isPublicApiPath = /^\/api\/api-console\/portal\/shared\/[^/]+(?:\/download)?$/.test(parsedUrl.pathname)
        || /^\/api\/api-console\/mock-serve\/[^/]+$/.test(parsedUrl.pathname)
        || /^\/api\/api-console\/health(?:\/config)?$/.test(parsedUrl.pathname);
      if (!req.utmsContext && !isLegacyContextEnabled() && !isPublicApiPath) {
        const session = req.apiConsoleSession;
        if (session && isSessionAuthenticated(session) && session.authApproach === 'CDE') {
          const access = evaluateWorkspaceAccess(session.projects || []);
          if (!access.allowed) {
            throw new ApiConsoleError(
              'WORKSPACE_ACCESS_DENIED',
              `دسترسی فقط برای دارندگان ورک‌اسپیس‌های ${access.requiredWorkspaces.join('، ')} مجاز است.`,
              403,
              access,
            );
          }
        }
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Login and workspace selection are required.', 401);
      }
      const body = await readJsonBody(req);
      const result = await routeRequest(req, parsedUrl, body);
      if (result?.__rawResponse) {
        sendRaw(res, result.__rawResponse.statusCode || 200, result.__rawResponse.contentType || 'text/plain; charset=utf-8', result.__rawResponse.body, result.__rawResponse.headers);
        return;
      }
      sendJson(res, 200, result);
    } catch (error) {
      sendError(res, error);
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`Online API Console backend listening on http://localhost:${PORT}`);
  });
}

module.exports = {
  createServer,
  parseCurlInternal,
  validateDestination,
  exportRequestAsCurl,
  createBlankNormalizedRequest,
  definitionFromNormalized,
  inferDocumentationDataType,
  inferStructuredDocumentationParameters,
  inferRequestDocumentationParameters,
  inferHeaderDocumentationParameters,
  refreshDocumentationMetadata,
  buildDocumentationViewModel,
  generateDocumentationMarkdown,
  buildDocxDocumentXml,
  buildDocxFromTemplate,
  buildRuntimeCurlExport,
  buildRuntimePostmanCollection,
  runtimeOpenApiDocument,
  discoverySourceFingerprint,
  mergeDiscoveredRequest,
  sourceControlledDefinition,
  sanitizeDocumentationCurl,
  sanitizeDocumentationResponseExample,
  DEFAULT_RESPONSE_CODE_CATALOG,
  AUTHENTICATION_DOCUMENTATION_PROFILES,
  runSelfCheck,
  API_CONSOLE_POLICY,
  assertProductionSecrets,
  inspectProductionSecrets,
  // E01 persistence helpers (FILE default; SQLITE / POSTGRES via env)
  resolveStoreBackend,
  createStoreAdapter,
  loadStoreViaAdapter,
  writeStoreViaAdapter,
  loadStoreFromFile,
  saveStoreToFile,
  initializeStore,
  isStoreReady,
  STORE_BACKEND,
  SQLITE_FILE,
  ensureIsGatewayEnvironment,
};
