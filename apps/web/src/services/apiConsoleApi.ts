import type { ActiveContext, ApplicationScopeFilter, PaginatedResponse } from '../types';
import { getCsrfToken } from './cdeApi';
import type {
  ApiCollection,
  ApiConsoleDirectoryUser,
  ApiConsolePermissionPolicy,
  ApiCurlImportPreview,
  ApiEffectiveRequestSnapshot,
  ApiEnvironmentProfile,
  ApiExecutionMode,
  ApiExecutionRunner,
  ApiExportDialect,
  ApiManualResponseExample,
  ApiPostmanCollectionExport,
  ApiConsoleReference,
  ApiConsumerCandidate,
  ApiRepositoryItem,
  ApiRequestDefinition,
  ApiRequestExecution,
  ApiShareRequest,
  ApiUsageReport,
  ApiVersionConsumer,
  ApiDocumentationResult,
  ApiAuthenticationDocumentationProfile,
  NormalizedApiRequest,
  RuntimeProfile,
  RuntimeSessionStatus,
  ApiDiscoverySnapshot,
  DiscoverySyncResult,
  RuntimeCurlExport,
  DiscoveredOperation,
} from '../types/apiConsole';

const API_BASE = (import.meta.env.VITE_API_CONSOLE_BASE_URL || '/api/api-console').replace(/\/$/, '');

const API_CONSOLE_POLICY: ApiConsolePermissionPolicy = {
  canView: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'SECURITY_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER', 'DEVELOPER'],
  canCreate: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'TECH_LEAD', 'DEVELOPER'],
  canEdit: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'TECH_LEAD', 'DEVELOPER'],
  canExecute: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'SECURITY_REVIEWER', 'TECH_LEAD', 'DEVELOPER'],
  canExecuteProduction: ['SYSTEM_ADMIN', 'TECH_LEAD', 'QA_LEAD'],
  canExecuteCommand: ['SYSTEM_ADMIN', 'QA_LEAD', 'TECH_LEAD'],
  canExecuteProductionCommand: ['SYSTEM_ADMIN', 'TECH_LEAD'],
  canDelete: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'SECURITY_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER', 'DEVELOPER'],
  canGenerateDocumentation: ['SYSTEM_ADMIN', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'SECURITY_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER', 'DEVELOPER'],
};

type ApiConsoleRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown | undefined;
  context?: ActiveContext | undefined;
  deduplicate?: boolean | undefined;
};

type CoreValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

type ParserSelfCheckResult = {
  passed: number;
  failed: number;
  details: Array<{ name: string; passed: boolean; message?: string }>;
};

type RuntimeProfileInput = Omit<Partial<RuntimeProfile>, 'dataService'> & {
  dataService?: Partial<RuntimeProfile['dataService']> & { authSecret?: string };
};

const API_ERROR_CATEGORY_LABELS: Record<string, string> = {
  CURL_PARSE_ERROR: 'خطای خواندن cURL',
  INVALID_URL: 'آدرس یا مسیر نامعتبر',
  UNSUPPORTED_CURL_OPTION: 'گزینه cURL پشتیبانی نمی‌شود',
  VARIABLE_RESOLUTION_ERROR: 'خطای جایگذاری متغیر',
  SECRET_RESOLUTION_ERROR: 'خطای مقدار محرمانه',
  AUTHENTICATION_ERROR: 'خطای دسترسی',
  DNS_ERROR: 'خطای DNS',
  TLS_ERROR: 'خطای TLS',
  CONNECTION_TIMEOUT: 'پایان زمان اتصال',
  READ_TIMEOUT: 'پایان زمان خواندن',
  RESPONSE_TOO_LARGE: 'حجم پاسخ بیش از حد مجاز',
  REDIRECT_BLOCKED: 'تغییر مسیر مسدود شد',
  DESTINATION_NOT_ALLOWED: 'مقصد مجاز نیست',
  CORE_VALIDATION_ERROR: 'خطای اعتبارسنجی',
  HTTP_ERROR: 'خطای HTTP',
  EXECUTION_CANCELLED: 'اجرا لغو شد',
  INTERNAL_EXECUTION_ERROR: 'خطای داخلی اجرا',
  RUNTIME_PROFILE_INVALID: 'تنظیمات Runtime نامعتبر',
  RUNTIME_ORIGIN_INVALID: 'Origin نامعتبر',
  RUNTIME_ORIGIN_NOT_ALLOWED: 'Origin خارج از allowlist',
  RUNTIME_SSRF_BLOCKED: 'مقصد Runtime مسدود',
  RUNTIME_SESSION_REQUIRED: 'ورود Runtime لازم است',
  RUNTIME_SESSION_EXPIRED: 'نشست Runtime منقضی شده',
  RUNTIME_COMMAND_CONFIRMATION_REQUIRED: 'تأیید Command لازم است',
  RUNTIME_SERVICE_ID_REQUIRED: 'Service ID تأیید نشده',
  DISCOVERY_NOT_FOUND: 'Discovery موجود نیست',
  DATA_SERVICE_EXECUTION_BLOCKED: 'اجرای Data Service مسدود است',
};

const API_ERROR_MESSAGE_TRANSLATIONS: Record<string, string> = {
  'API Console request failed.': 'درخواست API Console ناموفق بود.',
  'Internal API Console error.': 'خطای داخلی API Console رخ داد.',
  'Invalid JSON request body.': 'بدنه JSON درخواست معتبر نیست.',
  'ActiveContext is required.': 'انتخاب نقش و سامانه فعال الزامی است.',
  'Endpoint not found.': 'مسیر API Console پیدا نشد.',
  'API Console endpoint not found.': 'مسیر API Console پیدا نشد.',
  'Request payload is required.': 'ارسال اطلاعات درخواست الزامی است.',
  'Empty cURL input.': 'متن cURL خالی است.',
  'cURL input did not contain a URL.': 'در متن cURL آدرس URL پیدا نشد.',
  'The effective request URL is invalid.': 'آدرس نهایی درخواست معتبر نیست.',
  'Only HTTP and HTTPS destinations are allowed.': 'فقط مقصدهای HTTP و HTTPS مجاز هستند.',
  'Localhost and local-network hostnames are blocked by policy.': 'مقصد localhost یا شبکه داخلی طبق سیاست امنیتی مسدود است.',
  'Private, loopback, and cloud metadata destinations are blocked.': 'مقصدهای خصوصی، loopback و metadata ابری مسدود هستند.',
  'DNS lookup returned no records.': 'برای این مقصد رکورد DNS پیدا نشد.',
  'DNS resolved to a blocked private, loopback, or metadata address.': 'DNS به آدرس خصوصی، loopback یا metadata مسدودشده اشاره می‌کند.',
  'The target API did not finish reading within the configured timeout.': 'API مقصد در زمان مجاز پاسخ کامل نداد.',
  'The target API connection timed out.': 'اتصال به API مقصد به پایان زمان مجاز رسید.',
  'The API Console total execution timeout was reached.': 'زمان کل اجرای API Console به پایان رسید.',
  'Maximum redirect count was exceeded.': 'تعداد تغییر مسیر از حد مجاز بیشتر شد.',
  'Script contains an unclosed string literal.': 'در اسکریپت یک رشته بسته نشده است.',
  'Script is too long. Maximum 150 lines are allowed.': 'اسکریپت بیش از حد طولانی است. حداکثر ۱۵۰ خط مجاز است.',
  'setJsonBody requires a JSON path such as $.data.id.': 'برای setJsonBody باید مسیر JSON مانند $.data.id وارد شود.',
  'setVar requires key and value.': 'برای setVar وارد کردن کلید و مقدار الزامی است.',
  'setHeader requires name and value.': 'برای setHeader وارد کردن نام و مقدار الزامی است.',
  'setQuery requires name and value.': 'برای setQuery وارد کردن نام و مقدار الزامی است.',
  'Pre-request script is invalid.': 'اسکریپت پیش از اجرا معتبر نیست.',
  'Pre-request script failed.': 'اجرای اسکریپت پیش از اجرا ناموفق بود.',
  'Post-response script is invalid.': 'اسکریپت پس از پاسخ معتبر نیست.',
  'Post-response script failed.': 'اجرای اسکریپت پس از پاسخ ناموفق بود.',
  'Production execution requires elevated permission.': 'اجرای Production به دسترسی بالاتر نیاز دارد.',
  'Production Core Command execution requires elevated permission.': 'اجرای Core Command در Production به دسترسی بالاتر نیاز دارد.',
  'Production Core Command requires confirmation and business justification.': 'اجرای Core Command در Production به تأیید و دلیل کسب‌وکاری نیاز دارد.',
  'Insecure TLS is prohibited in production environments.': 'TLS ناامن در محیط Production مجاز نیست.',
  'User is not authorized to execute API requests.': 'شما مجوز اجرای درخواست‌های API را ندارید.',
  'Request not found.': 'درخواست پیدا نشد.',
  'Core Command execution requires elevated permission.': 'اجرای Core Command به دسترسی بالاتر نیاز دارد.',
  'API usage report requires System Admin, Tech Lead or QA Lead role.': 'گزارش مصرف API فقط برای مدیر سیستم، سرپرست فنی یا سرپرست QA مجاز است.',
  'Only System Administrators can manage users and approve shared API requests.': 'فقط مدیرسیستم می‌تواند کاربران و درخواست‌های اشتراک API را مدیریت کند.',
  'CDE directory user not found.': 'کاربر در فهرست همگام‌شده CDE پیدا نشد.',
  'Bootstrap System Administrator access is controlled by API_CONSOLE_ADMIN_LOGINS.': 'دسترسی مدیر اولیه فقط از تنظیم API_CONSOLE_ADMIN_LOGINS قابل تغییر است.',
  'At least one active System Administrator must remain.': 'حداقل یک مدیرسیستم فعال باید باقی بماند.',
  'Share review request not found.': 'درخواست بررسی اشتراک پیدا نشد.',
  'Share request is outside active application scope.': 'درخواست اشتراک خارج از محدوده سامانه فعال است.',
  'Source request not found.': 'درخواست مبدا پیدا نشد.',
  'Reference not found.': 'Reference پیدا نشد.',
  'Shared API version not found.': 'نسخه API اشتراک‌گذاری‌شده پیدا نشد.',
  'User is not authorized to update API consumers.': 'شما مجوز ویرایش مصرف‌کنندگان این API را ندارید.',
  'User is not authorized to export API collections.': 'شما مجوز گرفتن خروجی از Collectionهای API را ندارید.',
  'User is not authorized to view API collections.': 'شما مجوز مشاهده Collectionهای API را ندارید.',
  'User is not authorized to create API collections.': 'شما مجوز ساخت Collection API را ندارید.',
  'User is not authorized to view API requests.': 'شما مجوز مشاهده درخواست‌های API را ندارید.',
  'User is not authorized to create API requests.': 'شما مجوز ساخت درخواست API را ندارید.',
  'User is not authorized to edit API requests.': 'شما مجوز ویرایش درخواست API را ندارید.',
  'User is not authorized to archive API requests.': 'شما مجوز آرشیو کردن درخواست API را ندارید.',
  'User is not authorized to generate documentation.': 'شما مجوز ساخت مستندات API را ندارید.',
  'Collection not found.': 'Collection پیدا نشد.',
  'Target API collection does not belong to the active user.': 'Collection مقصد متعلق به کاربر فعال نیست.',
  'Request does not belong to the active user.': 'این درخواست متعلق به کاربر فعال نیست.',
  'Change Log برای Version جدید الزامی است.': 'گزارش تغییرات برای نسخه جدید الزامی است.',
  'DOCX template central directory was not found.': 'ساختار مرکزی قالب DOCX پیدا نشد.',
  'Invalid DOCX central directory.': 'ساختار مرکزی قالب DOCX معتبر نیست.',
  'DOCX template does not contain word/document.xml.': 'قالب DOCX فایل word/document.xml را ندارد.',
};

function translateApiErrorMessage(message: string): string {
  const normalized = (message || '').trim();
  const exact = API_ERROR_MESSAGE_TRANSLATIONS[normalized];
  if (exact) return exact;

  const dynamicTranslations: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Request body exceeded (\d+) bytes\.$/, match => `حجم بدنه درخواست از حد مجاز ${match[1]} بایت بیشتر است.`],
    [/^Response exceeded (\d+) bytes\.$/, match => `حجم پاسخ از حد مجاز ${match[1]} بایت بیشتر است.`],
    [/^Decoded response exceeded (\d+) bytes\.$/, match => `حجم پاسخ پس از decode از حد مجاز ${match[1]} بایت بیشتر است.`],
    [/^Unsupported script syntax: (.+)$/, match => `ساختار اسکریپت پشتیبانی نمی‌شود: ${match[1]}`],
    [/^Unsupported pre-request command "(.+)"\.$/, match => `دستور pre-request پشتیبانی نمی‌شود: ${match[1]}`],
    [/^Unsupported post-response command "(.+)"\.$/, match => `دستور post-response پشتیبانی نمی‌شود: ${match[1]}`],
    [/^Invalid DOCX local header for (.+)\.$/, match => `هدر داخلی DOCX برای ${match[1]} معتبر نیست.`],
    [/^Unsupported DOCX compression method (.+)\.$/, match => `روش فشرده‌سازی DOCX پشتیبانی نمی‌شود: ${match[1]}`],
    [/^DOCX template not found: (.+)$/, match => `قالب DOCX پیدا نشد: ${match[1]}`],
    [/^Secret reference "(.+)" could not be decrypted by the API Console backend\.$/, match => `Secret با شناسه ${match[1]} قابل رمزگشایی نیست.`],
    [/^Secret reference "(.+)" could not be resolved by the API Console backend\.$/, match => `Secret با شناسه ${match[1]} پیدا یا resolve نشد.`],
    [/^Sensitive variable "(.+)" must resolve through secret storage\.$/, match => `متغیر حساس ${match[1]} باید از مسیر Secret Storage مقداردهی شود.`],
    [/^Variable "(.+)" could not be resolved\.$/, match => `متغیر ${match[1]} مقداردهی نشده یا قابل resolve نیست.`],
  ];

  for (const [pattern, translate] of dynamicTranslations) {
    const match = normalized.match(pattern);
    if (match) return translate(match);
  }

  return normalized || 'خطای نامشخص رخ داد.';
}

function formatApiError(category: string, message: string): Error {
  const categoryLabel = API_ERROR_CATEGORY_LABELS[category] || 'خطای API Console';
  const translatedMessage = translateApiErrorMessage(message);
  return new Error(`${categoryLabel}: ${translatedMessage}`);
}

function compactContext(context?: ActiveContext) {
  if (!context) return undefined;
  return {
    userId: context.userId,
    user: context.user ? { id: context.user.id, fullName: context.user.fullName } : undefined,
    assignmentId: context.assignmentId,
    applicationId: context.applicationId,
    scopeApplicationIds: context.scopeApplicationIds,
    role: context.role,
    scope: context.scope,
    automatedTestsEnabled: context.automatedTestsEnabled,
  };
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function contextHeader(context?: ActiveContext): Record<string, string> {
  const compact = compactContext(context);
  if (!compact) return {};
  const encoded = encodeBase64Utf8(JSON.stringify(compact));
  return {
    'x-utms-context': encoded,
    'x-api-console-context': encoded,
  };
}

function applicationScopeParam(scope: ApplicationScopeFilter): string {
  if (!scope || scope === 'ALL') return 'ALL';
  if (Array.isArray(scope)) return JSON.stringify([...scope].sort());
  return scope;
}

async function parseApiError(response: Response): Promise<Error> {
  try {
    const payload = await response.json();
    const category = payload?.error?.category || 'INTERNAL_EXECUTION_ERROR';
    const message = payload?.error?.message || response.statusText || 'API Console request failed.';
    return formatApiError(category, message);
  } catch {
    return formatApiError('INTERNAL_EXECUTION_ERROR', response.statusText || 'API Console request failed.');
  }
}

async function requestJson<T>(path: string, options: ApiConsoleRequestOptions = {}): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    ...contextHeader(options.context),
  };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    const csrf = getCsrfToken();
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const requestInit: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };
  if (method !== 'GET') {
    requestInit.body = JSON.stringify(options.body || {});
  }
  const url = `${API_BASE}${path}`;
  const inFlightKey = method === 'GET' && options.deduplicate !== false ? makeInFlightGetKey(url, headers) : null;
  if (inFlightKey) {
    const current = inFlightGetRequests.get(inFlightKey);
    if (current) return current as Promise<T>;
  }

  const responsePromise = fetch(url, requestInit).then(async response => {
    if (!response.ok) {
      throw await parseApiError(response);
    }

    return response.json() as Promise<T>;
  });

  if (inFlightKey) {
    const key = inFlightKey;
    let trackedPromise: Promise<T>;
    trackedPromise = responsePromise.finally(() => {
      if (inFlightGetRequests.get(key) === trackedPromise) {
        inFlightGetRequests.delete(key);
      }
    });
    inFlightGetRequests.set(key, trackedPromise);
    return trackedPromise;
  }

  return responsePromise;
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).sort(([left], [right]) => left.localeCompare(right)).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

const inFlightGetRequests = new Map<string, Promise<unknown>>();

function makeInFlightGetKey(url: string, headers: Record<string, string>): string {
  return JSON.stringify({
    method: 'GET',
    url,
    context: headers['x-utms-context'] || '',
  });
}

export const apiConsoleApi = {
  policy: API_CONSOLE_POLICY,

  getEnvironments(): Promise<ApiEnvironmentProfile[]> {
    return requestJson('/environments');
  },

  getRunners(): Promise<ApiExecutionRunner[]> {
    return requestJson('/runners');
  },

  getRuntimeProfiles(applicationId: string, context: ActiveContext): Promise<RuntimeProfile[]> {
    return requestJson(withQuery('/runtime-profiles', { applicationId }), { context });
  },

  createRuntimeProfile(data: RuntimeProfileInput, context: ActiveContext): Promise<RuntimeProfile> {
    return requestJson('/admin/runtime-profiles', { method: 'POST', context, body: { data } });
  },

  updateRuntimeProfile(id: string, data: RuntimeProfileInput, context: ActiveContext): Promise<RuntimeProfile> {
    return requestJson(`/admin/runtime-profiles/${encodeURIComponent(id)}`, { method: 'PUT', context, body: { data, rowVersion: data.rowVersion } });
  },

  disableRuntimeProfile(id: string, context: ActiveContext): Promise<RuntimeProfile> {
    return requestJson(`/admin/runtime-profiles/${encodeURIComponent(id)}`, { method: 'DELETE', context, body: {} });
  },

  validateRuntimeProfile(id: string, context: ActiveContext): Promise<{ profile: RuntimeProfile; validation: { valid: boolean; addresses: string[]; checkedAt: string } }> {
    return requestJson(`/admin/runtime-profiles/${encodeURIComponent(id)}/validate`, { method: 'POST', context, body: {} });
  },

  getRuntimeSession(profileId: string, context: ActiveContext): Promise<RuntimeSessionStatus> {
    return requestJson(`/runtime-profiles/${encodeURIComponent(profileId)}/session`, { context });
  },

  startRuntimeSession(profileId: string, context: ActiveContext): Promise<RuntimeSessionStatus> {
    return requestJson(`/runtime-profiles/${encodeURIComponent(profileId)}/session/start`, { method: 'POST', context, body: {} });
  },

  finishRuntimeSession(profileId: string, password: string, context: ActiveContext): Promise<RuntimeSessionStatus> {
    return requestJson(`/runtime-profiles/${encodeURIComponent(profileId)}/session/password`, { method: 'POST', context, body: { password } });
  },

  disconnectRuntimeSession(profileId: string, context: ActiveContext): Promise<RuntimeSessionStatus> {
    return requestJson(`/runtime-profiles/${encodeURIComponent(profileId)}/session`, { method: 'DELETE', context, body: {} });
  },

  scanProjectDiscovery(projectKey: string, context: ActiveContext): Promise<ApiDiscoverySnapshot> {
    return requestJson(`/projects/${encodeURIComponent(projectKey)}/discovery/scan`, { method: 'POST', context, body: {} });
  },

  getLatestProjectDiscovery(projectKey: string, context: ActiveContext): Promise<ApiDiscoverySnapshot> {
    return requestJson(`/projects/${encodeURIComponent(projectKey)}/discovery/latest`, { context });
  },

  syncProjectDiscovery(projectKey: string, snapshotId: string, data: { collectionId: string; runtimeProfileId: string; operationIds?: string[]; conflictResolutions?: Record<string, Record<string, 'SOURCE' | 'LOCAL'>> }, context: ActiveContext): Promise<DiscoverySyncResult> {
    return requestJson(`/projects/${encodeURIComponent(projectKey)}/discovery/${encodeURIComponent(snapshotId)}/sync`, { method: 'POST', context, body: data });
  },

  executeRuntimeOperation(operation: DiscoveredOperation, data: { projectKey: string; runtimeProfileId: string; input?: Record<string, unknown>; confirmed?: boolean; businessJustification?: string }, context: ActiveContext): Promise<ApiRequestExecution> {
    return requestJson(`/runtime/operations/${encodeURIComponent(operation.id)}/execute`, { method: 'POST', context, body: data });
  },

  getRuntimePostman(projectKey: string, profileId: string, context: ActiveContext): Promise<ApiPostmanCollectionExport> {
    return requestJson(`/projects/${encodeURIComponent(projectKey)}/runtime-profiles/${encodeURIComponent(profileId)}/postman`, { context });
  },

  getRuntimeCurl(projectKey: string, profileId: string, operationId: string, mode: 'sample' | 'bundle', context: ActiveContext): Promise<RuntimeCurlExport> {
    return requestJson(withQuery(`/projects/${encodeURIComponent(projectKey)}/runtime-profiles/${encodeURIComponent(profileId)}/curl`, { operationId, mode }), { context });
  },

  runtimeDocsUrl(projectKey: string, profileId: string): string {
    return `${API_BASE}/projects/${encodeURIComponent(projectKey)}/runtime-profiles/${encodeURIComponent(profileId)}/docs`;
  },

  getAuthenticationDocumentationProfiles(): Promise<ApiAuthenticationDocumentationProfile[]> {
    return requestJson('/documentation/authentication-profiles');
  },

  getCollections(applicationId: ApplicationScopeFilter, context?: ActiveContext): Promise<ApiCollection[]> {
    return requestJson(withQuery('/collections', { applicationId: applicationScopeParam(applicationId) }), { context });
  },

  createCollection(data: Partial<ApiCollection>, context: ActiveContext): Promise<ApiCollection> {
    return requestJson('/collections', {
      method: 'POST',
      context,
      body: { data },
    });
  },

  exportPostmanCollection(collectionId: string, context: ActiveContext): Promise<ApiPostmanCollectionExport> {
    return requestJson(`/collections/${encodeURIComponent(collectionId)}/export-postman`, { context });
  },

  parseCurl(curlText: string, userId: string, context?: ActiveContext): Promise<ApiCurlImportPreview> {
    return requestJson('/curl/parse', {
      method: 'POST',
      context,
      body: { curlText, userId },
    });
  },

  createRequest(
    data: {
      name: string;
      description?: string;
      collectionId: string;
      applicationId: string;
      environmentId: string;
      normalizedRequest: NormalizedApiRequest;
      originalImportedCurl?: string;
      importedCurlId?: string;
      authenticationDocumentationProfileId?: string;
    },
    context: ActiveContext
  ): Promise<ApiRequestDefinition> {
    return requestJson('/requests', {
      method: 'POST',
      context,
      body: { data },
    });
  },

  createBlankRequest(collectionId: string, applicationId: string, environmentId: string, context: ActiveContext): Promise<ApiRequestDefinition> {
    return requestJson('/requests/blank', {
      method: 'POST',
      context,
      body: { data: { collectionId, applicationId, environmentId } },
    });
  },

  updateRequest(id: string, data: Partial<ApiRequestDefinition>, context: ActiveContext): Promise<ApiRequestDefinition | null> {
    return requestJson(`/requests/${encodeURIComponent(id)}`, {
      method: 'PUT',
      context,
      body: { data },
    });
  },

  getRequests(
    applicationId: ApplicationScopeFilter,
    filters: { page: number; limit: number; search?: string; collectionId?: string; classificationType?: string; status?: string },
    context?: ActiveContext
  ): Promise<PaginatedResponse<ApiRequestDefinition>> {
    return requestJson(withQuery('/requests', {
      applicationId: applicationScopeParam(applicationId),
      page: filters.page,
      limit: filters.limit,
      search: filters.search,
      collectionId: filters.collectionId,
      classificationType: filters.classificationType,
      status: filters.status,
    }), { context });
  },

  getRequest(id: string, context?: ActiveContext): Promise<ApiRequestDefinition | null> {
    return requestJson(`/requests/${encodeURIComponent(id)}`, { context });
  },

  archiveRequest(id: string, context: ActiveContext): Promise<ApiRequestDefinition | null> {
    return requestJson(`/requests/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      context,
      body: {},
    });
  },

  shareRequest(
    requestId: string,
    data: { purpose: string; introduction: string; description: string },
    context: ActiveContext
  ): Promise<ApiShareRequest> {
    return requestJson(`/requests/${encodeURIComponent(requestId)}/share`, {
      method: 'POST',
      context,
      body: { data },
    });
  },

  createVersion(
    requestId: string,
    data: { version: string; changeLog: string },
    context: ActiveContext
  ): Promise<ApiRequestDefinition> {
    return requestJson(`/requests/${encodeURIComponent(requestId)}/versions`, {
      method: 'POST',
      context,
      body: { data },
    });
  },

  getShareReviews(
    filters: { page: number; limit: number; search?: string; status?: string; submittedBy?: string; version?: string; applicationId?: ApplicationScopeFilter },
    context: ActiveContext
  ): Promise<PaginatedResponse<ApiShareRequest>> {
    return requestJson(withQuery('/share-reviews', {
      applicationId: applicationScopeParam(filters.applicationId ?? 'ALL'),
      page: filters.page,
      limit: filters.limit,
      search: filters.search,
      status: filters.status,
      submittedBy: filters.submittedBy,
      version: filters.version,
    }), { context });
  },

  getShareReview(id: string, context: ActiveContext): Promise<ApiShareRequest> {
    return requestJson(`/share-reviews/${encodeURIComponent(id)}`, { context });
  },

  approveShareReview(id: string, consumers: ApiVersionConsumer[], rowVersion: string, context: ActiveContext): Promise<ApiShareRequest> {
    return requestJson(`/share-reviews/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      context,
      body: { consumers, rowVersion },
    });
  },

  returnShareReview(id: string, reason: string, rowVersion: string, context: ActiveContext): Promise<ApiShareRequest> {
    return requestJson(`/share-reviews/${encodeURIComponent(id)}/return`, {
      method: 'POST',
      context,
      body: { reason, rowVersion },
    });
  },

  getConsumerCandidates(context: ActiveContext): Promise<ApiConsumerCandidate[]> {
    return requestJson('/consumer-candidates', { context });
  },

  getAdminUsers(context: ActiveContext): Promise<ApiConsoleDirectoryUser[]> {
    return requestJson('/admin/users', { context });
  },

  setSystemAdmin(userId: string, enabled: boolean, context: ActiveContext): Promise<ApiConsoleDirectoryUser> {
    return requestJson(`/admin/users/${encodeURIComponent(userId)}/system-admin`, {
      method: 'PUT',
      context,
      body: { enabled },
    });
  },

  getRepository(
    filters: { page: number; limit: number; search?: string; applicationId?: ApplicationScopeFilter },
    context: ActiveContext
  ): Promise<PaginatedResponse<ApiRepositoryItem>> {
    return requestJson(withQuery('/repository', {
      applicationId: applicationScopeParam(filters.applicationId ?? 'ALL'),
      page: filters.page,
      limit: filters.limit,
      search: filters.search,
    }), { context });
  },

  getRepositoryVersions(apiId: string, context: ActiveContext): Promise<ApiRepositoryItem[]> {
    return requestJson(`/repository/${encodeURIComponent(apiId)}/versions`, { context });
  },

  getRepositoryVersion(apiId: string, version: string, context: ActiveContext): Promise<ApiRepositoryItem> {
    return requestJson(`/repository/${encodeURIComponent(apiId)}/versions/${encodeURIComponent(version)}`, { context });
  },

  addRepositoryVersionToConsole(apiId: string, version: string, collectionId: string | undefined, context: ActiveContext): Promise<{ reference: ApiConsoleReference; request: ApiRequestDefinition }> {
    return requestJson(`/repository/${encodeURIComponent(apiId)}/versions/${encodeURIComponent(version)}/add-to-console`, {
      method: 'POST',
      context,
      body: { collectionId },
    });
  },

  markRepositoryVersionViewed(apiId: string, version: string, context: ActiveContext): Promise<{ viewedAt?: string }> {
    return requestJson(`/repository/${encodeURIComponent(apiId)}/versions/${encodeURIComponent(version)}/mark-viewed`, {
      method: 'POST',
      context,
      body: {},
    });
  },

  getReferences(context: ActiveContext): Promise<ApiConsoleReference[]> {
    return requestJson('/references', { context });
  },

  removeReference(referenceId: string, context: ActiveContext): Promise<ApiConsoleReference> {
    return requestJson(`/references/${encodeURIComponent(referenceId)}`, {
      method: 'DELETE',
      context,
      body: {},
    });
  },

  updateConsumers(apiId: string, version: string, consumers: ApiVersionConsumer[], context: ActiveContext): Promise<ApiVersionConsumer[]> {
    return requestJson(`/shared-apis/${encodeURIComponent(apiId)}/versions/${encodeURIComponent(version)}/consumers`, {
      method: 'PUT',
      context,
      body: { consumers },
    });
  },

  getApiUsageReport(
    filters: {
      page: number;
      limit: number;
      applicationId?: ApplicationScopeFilter;
      apiId?: string;
      version?: string;
      userId?: string;
      role?: string;
      eventType?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    context: ActiveContext
  ): Promise<ApiUsageReport> {
    return requestJson(withQuery('/reports/api-usage', {
      applicationId: applicationScopeParam(filters.applicationId ?? 'ALL'),
      page: filters.page,
      limit: filters.limit,
      apiId: filters.apiId,
      version: filters.version,
      userId: filters.userId,
      role: filters.role,
      eventType: filters.eventType,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    }), { context });
  },

  validateCoreRequest(requestOrId: string | ApiRequestDefinition | NormalizedApiRequest, context?: ActiveContext): Promise<CoreValidationResult> {
    if (typeof requestOrId === 'string') {
      return requestJson(`/requests/${encodeURIComponent(requestOrId)}/validate-core`, { method: 'POST', context });
    }
    return requestJson('/validate-core', {
      method: 'POST',
      context,
      body: { request: requestOrId },
    });
  },

  executeRequest(
    requestId: string,
    context: ActiveContext,
    options?: {
      environmentId?: string;
      executionMode?: ApiExecutionMode;
      productionCommandConfirmed?: boolean;
      businessJustification?: string;
      executionVariables?: Record<string, string>;
    }
  ): Promise<ApiRequestExecution> {
    return requestJson(`/requests/${encodeURIComponent(requestId)}/execute`, {
      method: 'POST',
      context,
      body: { options: options || {} },
    });
  },

  cancelExecution(executionId: string, context: ActiveContext): Promise<ApiRequestExecution | null> {
    return requestJson(`/executions/${encodeURIComponent(executionId)}/cancel`, {
      method: 'POST',
      context,
      body: {},
    });
  },

  getExecution(executionId: string, context?: ActiveContext): Promise<ApiRequestExecution | null> {
    return requestJson(`/executions/${encodeURIComponent(executionId)}`, { context });
  },

  getExecutionHistory(requestId: string, context?: ActiveContext, options: { fresh?: boolean } = {}): Promise<ApiRequestExecution[]> {
    return requestJson(`/requests/${encodeURIComponent(requestId)}/executions`, {
      context,
      deduplicate: !options.fresh,
    });
  },

  async exportCurl(requestId: string, dialect: ApiExportDialect, options?: { exposeSecrets?: boolean; context?: ActiveContext }): Promise<string> {
    const response = await requestJson<{ value: string }>(`/requests/${encodeURIComponent(requestId)}/export-curl`, {
      method: 'POST',
      context: options?.context,
      body: { dialect, exposeSecrets: options?.exposeSecrets },
    });
    return response.value;
  },

  addManualResponse(
    requestId: string,
    data: {
      statusCode: number;
      headersText: string;
      body: string;
      claimedEnvironmentId: string;
      source: string;
      reason: string;
    },
    context: ActiveContext
  ): Promise<ApiManualResponseExample> {
    return requestJson(`/requests/${encodeURIComponent(requestId)}/manual-responses`, {
      method: 'POST',
      context,
      body: { data },
    });
  },

  getManualResponses(requestId: string, context?: ActiveContext): Promise<ApiManualResponseExample[]> {
    return requestJson(`/requests/${encodeURIComponent(requestId)}/manual-responses`, { context });
  },

  generateDocumentationPreview(requestId: string, context: ActiveContext): Promise<ApiDocumentationResult> {
    return requestJson(`/requests/${encodeURIComponent(requestId)}/documentation/preview`, {
      method: 'POST',
      context,
      body: {},
    });
  },

  refreshDocumentationMetadata(requestId: string, context: ActiveContext): Promise<ApiRequestDefinition> {
    return requestJson(`/requests/${encodeURIComponent(requestId)}/documentation/refresh`, {
      method: 'POST',
      context,
      body: {},
    });
  },

  generateDocumentationFinal(requestId: string, context: ActiveContext): Promise<ApiDocumentationResult> {
    return requestJson(`/requests/${encodeURIComponent(requestId)}/documentation/final`, {
      method: 'POST',
      context,
      body: {},
    });
  },

  getEffectiveRequest(requestId: string, environmentId?: string, executionMode?: ApiExecutionMode, context?: ActiveContext): Promise<ApiEffectiveRequestSnapshot | null> {
    return requestJson(withQuery(`/requests/${encodeURIComponent(requestId)}/effective-request`, {
      environmentId,
      executionMode,
    }), { context });
  },

  runParserSelfCheck(): Promise<ParserSelfCheckResult> {
    return requestJson('/self-check');
  },
};
