import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  Copy,
  Download,
  Edit3,
  Eye,
  FileText,
  History,
  PlayCircle,
  Plus,
  FolderPlus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
  Users,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ROLE_LABELS } from '../types';
import type { ActiveContext, ApiAuditEvent, Notification, NotificationListResponse, PaginatedResponse, UserRole } from '../types';
import { AppShell, buildWorkspaceNav, type WorkspaceNavId } from '../components/layout/AppShell';
import { pathForWorkspaceView, workspaceViewFromPath } from './workspaceRouting';
import { Header, HeaderIconButton, HeaderMenuItem } from '../components/layout/Header';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, StatCard } from '../components/ui/Card';
import { Input, Select, Textarea } from '../components/ui/Input';
import { JalaliDateField } from '../components/ui/JalaliDateField';
import { ApplicationSelect } from '../components/ui/ApplicationSelect';
import { LoadingState, MinimalLoader } from '../components/ui/Loading';
import { Modal } from '../components/ui/Modal';
import { Table, Pagination } from '../components/ui/Table';
import { toast } from '../components/ui/Toast';
import { RuntimeWorkspace } from '../components/api-console/RuntimeWorkspace';
import { EnvironmentManagerSection } from '../components/api-console/EnvironmentManagerSection';
import { ActivityFeedPanel } from '../components/api-console/ActivityFeedPanel';
import { RunnersAdminSection } from '../components/api-console/RunnersAdminSection';
import { BrandingAdminSection } from '../components/api-console/BrandingAdminSection';
import { OrgPolicySection } from '../components/api-console/OrgPolicySection';
import { ComplianceReportSection } from '../components/api-console/ComplianceReportSection';
import { JitAccessSection } from '../components/api-console/JitAccessSection';
import { MocksSection } from '../components/api-console/MocksSection';
import { RepositorySection } from '../components/api-console/RepositorySection';
import { ShareReviewSection } from '../components/api-console/ShareReviewSection';
import { UserManagementSection } from '../components/api-console/UserManagementSection';
import { ResponsePanel } from '../components/api-console/ResponsePanel';
import { ImportCurlModal } from '../components/api-console/ImportCurlModal';
import { DocumentationModal } from '../components/api-console/DocumentationModal';
import { useAuthStore, useSessionStore } from '../stores/authStore';
import { useDataScope } from '../utils/useDataScope';
import { useApplicationLookup } from '../utils/useApplicationLookup';
import { apiConsoleApi } from '../services/apiConsoleApi';
import { API_SHARING_STATUS_LABELS, PERSONAL_APPLICATION_ID, PERSONAL_APPLICATION_LABEL } from '../types/apiConsole';
import type {
  ApiActivityEvent,
  ApiClassification,
  ApiClassificationType,
  ApiCollection,
  ApiConsoleDirectoryUser,
  ApiConsumerCandidate,
  ApiCurlImportPreview,
  ApiDocLanguage,
  ApiEffectiveRequestSnapshot,
  ApiEnvironmentProfile,
  ApiExecutionMode,
  ApiExportDialect,
  ApiHeaderCategory,
  ApiHttpMethod,
  ApiKeyValueParameter,
  ApiManualResponseExample,
  ApiAuthenticationDocumentation,
  ApiDocumentationAllowedValue,
  ApiDocumentationMetadata,
  ApiDocumentationParameter,
  ApiDocumentationResponseCode,
  ApiRepositoryItem,
  ApiRequestAssertion,
  ApiRequestCookie,
  ApiRequestDefinition,
  ApiRequestHeader,
  ApiRequestExecution,
  ApiReviewChecklist,
  ApiShareRequest,
  ApiSharingStatus,
  ApiTestRun,
  ApiUsageReport,
  ApiVariable,
  ApiVersionConsumer,
  ApiVisibility,
  NormalizedApiRequest,
} from '../types/apiConsole';

type EditorTab =
  | 'response'
  | 'params'
  | 'headers'
  | 'cookies'
  | 'body'
  | 'auth'
  | 'core'
  | 'scripts'
  | 'settings'
  | 'assertions'
  | 'documentation'
  | 'curl'
  | 'history';

type PageMode = 'list' | 'editor';
type WorkspaceView =
  | 'requests'
  | 'repository'
  | 'runtime'
  | 'reports'
  | 'environments'
  | 'reviews'
  | 'users'
  | 'audit'
  | 'activity'
  | 'runners'
  | 'branding'
  | 'org-policy'
  | 'compliance'
  | 'jit'
  | 'mocks';

const EMPTY_REVIEW_CHECKLIST: ApiReviewChecklist = {
  docsComplete: false,
  noSecrets: false,
  classificationOk: false,
  consumersSpecified: false,
};

const REVIEW_CHECKLIST_LABELS: Array<{ key: keyof ApiReviewChecklist; label: string }> = [
  { key: 'docsComplete', label: 'مستندات کامل است' },
  { key: 'noSecrets', label: 'Secret خام در تعریف نیست' },
  { key: 'classificationOk', label: 'Classification صحیح است' },
  { key: 'consumersSpecified', label: 'مصرف‌کنندگان مشخص شده‌اند' },
];
type ParserSelfCheckDetail = { name: string; passed: boolean; message?: string };
type PostmanImportRequestPreview = {
  name: string;
  folderPath: string[];
  method: ApiHttpMethod;
  url: string;
  headerCount: number;
  queryCount: number;
  bodyType: NormalizedApiRequest['body']['type'];
  warningCount: number;
  warnings: string[];
  normalizedRequest: NormalizedApiRequest;
  description?: string;
};
type PostmanCollectionImportPreview = {
  name: string;
  description: string;
  requestCount: number;
  variables: ApiCollection['variables'];
  requests: PostmanImportRequestPreview[];
  warnings: string[];
};

const METHOD_OPTIONS: ApiHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const TAB_LABELS: Array<{ id: EditorTab; label: string }> = [
  { id: 'response', label: 'response' },
  { id: 'params', label: 'پارامترها' },
  { id: 'headers', label: 'Headerها' },
  { id: 'cookies', label: 'Cookieها' },
  { id: 'body', label: 'Body' },
  { id: 'auth', label: 'Authentication' },
  { id: 'core', label: 'Core Details' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'settings', label: 'تنظیمات' },
  { id: 'assertions', label: 'Assertions' },
  { id: 'documentation', label: 'مستندات' },
  { id: 'curl', label: 'cURL' },
  { id: 'history', label: 'History اجرا' },
];

const CLASSIFICATION_LABELS: Record<ApiClassificationType, string> = {
  GENERIC_HTTP: 'Generic HTTP',
  CORE_QUERY: 'Core Query',
  CORE_COMMAND: 'Core Command',
};

const HEADER_CATEGORY_LABELS: Record<ApiHeaderCategory, string> = {
  USER_BUSINESS: 'Business',
  BROWSER_GENERATED: 'Browser',
  TRANSPORT_GENERATED: 'Transport',
  AUTHENTICATION: 'Authentication',
  ENVIRONMENT: 'Environment',
};

const CONSUMER_TYPE_LABELS: Record<'USER' | 'ROLE', string> = {
  USER: 'کاربر',
  ROLE: 'نقش',
};

function roleLabel(role?: string): string {
  return role ? ROLE_LABELS[role as UserRole] || role : '-';
}

function consumerIdOf(consumer: Pick<ApiVersionConsumer, 'consumerType' | 'userId' | 'roleKey'>): string {
  return consumer.consumerType === 'USER'
    ? `USER:${consumer.userId || ''}`
    : `ROLE:${consumer.roleKey || ''}`;
}

function consumerCandidateLabel(candidate: ApiConsumerCandidate): string {
  return candidate.consumerType === 'ROLE' ? roleLabel(candidate.roleKey) : candidate.label;
}

function consumerCandidateDescription(candidate: ApiConsumerCandidate): string {
  if (candidate.consumerType === 'ROLE') {
    return `همه کاربران دارای نقش ${roleLabel(candidate.roleKey)} در سامانه مجاز.`;
  }
  return candidate.description || candidate.userId || '';
}

function consumerDisplayLabel(
  consumer: ApiVersionConsumer,
  candidates: ApiConsumerCandidate[] = []
): string {
  const candidate = candidates.find(item => item.id === consumerIdOf(consumer));
  if (candidate) return consumerCandidateLabel(candidate);
  return consumer.consumerType === 'ROLE' ? roleLabel(consumer.roleKey) : consumer.userId || '-';
}

function consumerDisplayDescription(
  consumer: ApiVersionConsumer,
  candidates: ApiConsumerCandidate[] = []
): string {
  const candidate = candidates.find(item => item.id === consumerIdOf(consumer));
  if (candidate) return consumerCandidateDescription(candidate);
  if (consumer.consumerType === 'ROLE') return `دسترسی نقش ${roleLabel(consumer.roleKey)}`;
  return consumer.userId || '';
}

function defaultScripts() {
  return {
    preRequest: [
      '// Pre-request script',
      '// setVar("page", "0")',
      '// setHeader("x-trace-id", "{{traceId}}")',
    ].join('\n'),
    postResponse: [
      '// Post-response tests',
      '// testStatus(200)',
      '// testJsonPath("$.data")',
      '// testResponseTimeBelow(5000)',
    ].join('\n'),
    preRequestEnabled: false,
    postResponseEnabled: false,
  };
}

function cloneRequest(request: ApiRequestDefinition): ApiRequestDefinition {
  const cloned = JSON.parse(JSON.stringify(request));
  cloned.scripts = { ...defaultScripts(), ...(cloned.scripts || {}) };
  return cloned;
}

function derivedRequestKey(request: ApiRequestDefinition): string {
  return [request.id, request.environmentId || '', request.executionMode || ''].join('|');
}

function makeParam(): ApiKeyValueParameter {
  return {
    id: `ui-param-${crypto.randomUUID()}`,
    name: '',
    value: '',
    enabled: true,
    sensitive: false,
    source: 'USER',
    displayOrder: 0,
  };
}

function makeHeader(order: number): ApiRequestHeader {
  return {
    id: `ui-header-${crypto.randomUUID()}`,
    name: '',
    valueTemplate: '',
    enabled: true,
    sensitive: false,
    source: 'USER',
    category: 'USER_BUSINESS',
    description: 'Header تعریف‌شده توسط کاربر.',
    maskedValue: '',
    displayOrder: order,
  };
}

function makeCookie(order: number): ApiRequestCookie {
  return {
    id: `ui-cookie-${crypto.randomUUID()}`,
    name: '',
    valueReference: '',
    enabled: true,
    sensitive: true,
    maskedValue: '',
    source: 'USER',
    displayOrder: order,
  };
}

function makeAssertion(): ApiRequestAssertion {
  return {
    id: `ui-assert-${crypto.randomUUID()}`,
    assertionType: 'REQUIRED_JSON_PATH',
    configuration: { jsonPath: '$.data' },
    enabled: true,
  };
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false; message: string; line?: number; column?: number } {
  try {
    return { ok: true, value: value.trim() ? JSON.parse(value) : {} };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON نامعتبر است';
    const match = message.match(/position\s+(\d+)/i);
    if (match) {
      const position = Number(match[1]);
      const lines = value.slice(0, position).split(/\r?\n/);
      return { ok: false, message, line: lines.length, column: (lines.at(-1) ?? '').length + 1 };
    }
    return { ok: false, message };
  }
}

function classifyDraft(request: ApiRequestDefinition): ApiClassification {
  let pathname = request.urlTemplate;
  try {
    pathname = new URL(request.urlTemplate).pathname;
  } catch {
    pathname = request.urlTemplate;
  }
  const parsed = parseJson(request.bodyTemplate);
  const body = parsed.ok ? asRecord(parsed.value) : {};
  if (
    pathname.endsWith('/core-api/v1/data-provider/store-form-data') &&
    typeof body.serviceId === 'string' &&
    typeof body.formId === 'string' &&
    'data' in body
  ) {
    return {
      type: 'CORE_COMMAND',
      serviceId: body.serviceId,
      operationPath: body.formId,
      coreOperationType: 'COMMAND',
      endpoint: '/core-api/v1/data-provider/store-form-data',
    };
  }
  if (
    pathname.endsWith('/core-api/v1/data-provider/get-data-source') &&
    typeof body.serviceId === 'string' &&
    typeof body.key === 'string' &&
    'params' in body
  ) {
    return {
      type: 'CORE_QUERY',
      serviceId: body.serviceId,
      operationPath: body.key,
      coreOperationType: 'QUERY',
      endpoint: '/core-api/v1/data-provider/get-data-source',
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

function normalizedFromPreview(preview: ApiCurlImportPreview): NormalizedApiRequest {
  return preview.normalizedRequest;
}

function bodyTemplateFromNormalized(body: NormalizedApiRequest['body']): string {
  if (body.type === 'none') return '';
  if (body.raw) return body.raw;
  if (body.type === 'json') return JSON.stringify(body.value ?? {}, null, 2);
  if (typeof body.value === 'string') return body.value;
  return JSON.stringify(body.value ?? '', null, 2);
}

function applyNormalizedToRequest(
  request: ApiRequestDefinition,
  preview: ApiCurlImportPreview
): ApiRequestDefinition {
  const normalized = normalizedFromPreview(preview);
  return {
    ...request,
    method: normalized.method,
    urlTemplate: normalized.url,
    queryParameters: normalized.queryParameters,
    headers: normalized.headers,
    cookies: normalized.cookies,
    bodyType: normalized.body.type,
    bodyTemplate: bodyTemplateFromNormalized(normalized.body),
    authentication: normalized.authentication,
    tls: normalized.tls,
    executionMode: normalized.executionMode,
    classification: normalized.classification,
    originalImportedCurl: preview.originalCurl,
    importedCurlId: preview.id,
  };
}

function classBadgeVariant(type: ApiClassificationType) {
  if (type === 'CORE_COMMAND') return 'danger' as const;
  if (type === 'CORE_QUERY') return 'info' as const;
  return 'default' as const;
}

function resultBadgeVariant(result?: string) {
  if (['SUCCESS', 'PASSED', 'COMPLETED'].includes(result || '')) return 'success' as const;
  if (['FAILED', 'BLOCKED'].includes(result || '')) return 'danger' as const;
  if (['WARNING', 'PENDING', 'RUNNING'].includes(result || '')) return 'warning' as const;
  return 'default' as const;
}

function sharingBadgeVariant(status?: ApiSharingStatus) {
  if (status === 'APPROVED') return 'success' as const;
  if (status === 'PENDING_REVIEW') return 'warning' as const;
  if (status === 'RETURNED') return 'danger' as const;
  if (status === 'DEPRECATED') return 'default' as const;
  return 'secondary' as const;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('fa-IR') : '-';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function textFromPostmanDescription(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  return asText(record.content || record.description || record.text, '');
}

function makeImportedParam(name: string, value: string, order: number, description = ''): ApiKeyValueParameter {
  return {
    id: `postman-param-${crypto.randomUUID()}`,
    name,
    value,
    enabled: true,
    sensitive: isSensitiveFieldName(name),
    source: 'USER',
    description,
    displayOrder: order,
  };
}

function makeImportedHeader(name: string, value: string, order: number, description = ''): ApiRequestHeader {
  const sensitive = isSensitiveFieldName(name);
  return {
    id: `postman-header-${crypto.randomUUID()}`,
    name,
    valueTemplate: value,
    enabled: true,
    sensitive,
    source: 'USER',
    category: /authorization|api[-_]?key|token/i.test(name) ? 'AUTHENTICATION' : 'USER_BUSINESS',
    description: description || 'Header واردشده از Postman Collection.',
    maskedValue: sensitive ? '***' : value,
    displayOrder: order,
  };
}

function makeImportedCookie(name: string, value: string, order: number): ApiRequestCookie {
  const sensitive = isSensitiveFieldName(name) || !/^(_ga|_gid|utm_)/i.test(name);
  return {
    id: `postman-cookie-${crypto.randomUUID()}`,
    name,
    valueReference: value,
    enabled: true,
    sensitive,
    maskedValue: sensitive ? '***' : value,
    source: 'USER',
    displayOrder: order,
  };
}

function isSensitiveFieldName(name: string): boolean {
  return /authorization|cookie|token|secret|password|passwd|session|api[-_]?key|apikey|access[-_]?key/i.test(name);
}

function normalizePostmanMethod(value: unknown, warnings: string[]): ApiHttpMethod {
  const method = asText(value, 'GET').trim().toUpperCase();
  const allowed: ApiHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  if (allowed.includes(method as ApiHttpMethod)) return method as ApiHttpMethod;
  warnings.push(`Method ${method || '-'} پشتیبانی نمی‌شود و به GET تبدیل شد.`);
  return 'GET';
}

function parsePostmanKeyValueRows(value: unknown): Array<{ key: string; value: string; description: string; disabled: boolean }> {
  return asArray<Record<string, unknown>>(value)
    .map(row => ({
      key: asText(row.key || row.name, '').trim(),
      value: asText(row.value, ''),
      description: textFromPostmanDescription(row.description),
      disabled: row.disabled === true,
    }))
    .filter(row => row.key);
}

function splitPostmanUrl(value: unknown, warnings: string[]) {
  const record = asRecord(value);
  let raw = typeof value === 'string' ? value : asText(record.raw, '');
  if (!raw && Object.keys(record).length) {
    const protocol = asText(record.protocol, '').replace(/:$/, '');
    const host = asArray(record.host).map(part => asText(part, '')).filter(Boolean).join('.') || asText(record.host, '');
    const path = asArray(record.path).map(part => encodeURIComponent(asText(part, ''))).filter(Boolean).join('/');
    raw = `${protocol ? `${protocol}://` : ''}${host}${path ? `/${path}` : ''}`;
  }
  const splitUrl = raw.split(/\?(.+)/, 2);
  const baseUrl = splitUrl[0] || '';
  const rawQuery = splitUrl[1] || '';
  const params: ApiKeyValueParameter[] = [];
  const seen = new Set<string>();
  if (rawQuery) {
    new URLSearchParams(rawQuery).forEach((paramValue, paramName) => {
      const key = `${paramName}\u0000${paramValue}`;
      if (!seen.has(key)) {
        seen.add(key);
        params.push(makeImportedParam(paramName, paramValue, params.length));
      }
    });
  }
  parsePostmanKeyValueRows(record.query).forEach(row => {
    if (row.disabled) return;
    const key = `${row.key}\u0000${row.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      params.push(makeImportedParam(row.key, row.value, params.length, row.description));
    }
  });
  if (!baseUrl.trim()) warnings.push('URL این Request در Postman خالی است.');
  return { url: baseUrl.trim() || raw.trim() || 'https://example.com', queryParameters: params };
}

function parseCookieHeader(value: string): ApiRequestCookie[] {
  return value
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const separatorIndex = part.indexOf('=');
      const name = separatorIndex >= 0 ? part.slice(0, separatorIndex).trim() : part;
      const cookieValue = separatorIndex >= 0 ? part.slice(separatorIndex + 1).trim() : '';
      return makeImportedCookie(name, cookieValue, index);
    })
    .filter(cookie => cookie.name);
}

function parsePostmanHeaders(value: unknown) {
  const headers: ApiRequestHeader[] = [];
  const cookies: ApiRequestCookie[] = [];
  parsePostmanKeyValueRows(value).forEach(row => {
    if (row.disabled) return;
    if (/^cookie$/i.test(row.key)) {
      cookies.push(...parseCookieHeader(row.value).map((cookie, index) => ({ ...cookie, displayOrder: cookies.length + index })));
      return;
    }
    headers.push(makeImportedHeader(row.key, row.value, headers.length, row.description));
  });
  return { headers, cookies };
}

function contentTypeFromHeaders(headers: ApiRequestHeader[]): string {
  return headers.find(header => /^content-type$/i.test(header.name))?.valueTemplate || '';
}

function parsePostmanBody(value: unknown, headers: ApiRequestHeader[], warnings: string[]): NormalizedApiRequest['body'] {
  const body = asRecord(value);
  const mode = asText(body.mode, '').toLowerCase();
  const contentType = contentTypeFromHeaders(headers);
  if (!mode) return { type: 'none', value: null, raw: '' };
  if (mode === 'raw') {
    const raw = asText(body.raw, '');
    const language = asText(asRecord(asRecord(body.options).raw).language, '').toLowerCase();
    if (/json/i.test(contentType) || language === 'json') {
      const parsed = parseJson(raw);
      if (parsed.ok) return { type: 'json', value: parsed.value, raw, contentType: contentType || 'application/json' };
      warnings.push(`JSON body نامعتبر است: ${parsed.message}`);
      return { type: 'raw', value: raw, raw, contentType: contentType || 'text/plain' };
    }
    if (/xml/i.test(contentType) || language === 'xml') return { type: 'xml', value: raw, raw, contentType: contentType || 'application/xml' };
    return { type: 'raw', value: raw, raw, contentType: contentType || 'text/plain' };
  }
  if (mode === 'urlencoded') {
    const params = parsePostmanKeyValueRows(body.urlencoded).filter(row => !row.disabled);
    const raw = new URLSearchParams(params.map(row => [row.key, row.value])).toString();
    return { type: 'form-urlencoded', value: params.reduce<Record<string, string>>((acc, row) => ({ ...acc, [row.key]: row.value }), {}), raw, contentType: contentType || 'application/x-www-form-urlencoded' };
  }
  if (mode === 'formdata') {
    const rows = parsePostmanKeyValueRows(body.formdata).filter(row => !row.disabled);
    return { type: 'multipart', value: rows, raw: rows.map(row => `${row.key}=${row.value}`).join('\n'), contentType: contentType || 'multipart/form-data' };
  }
  if (mode === 'file') {
    warnings.push('Postman file body به صورت binary reference وارد شد؛ فایل واقعی داخل Collection JSON وجود ندارد.');
    return { type: 'binary', value: body.file || null, raw: JSON.stringify(body.file || {}, null, 2), contentType };
  }
  if (mode === 'graphql') {
    const graphql = asRecord(body.graphql);
    const raw = JSON.stringify({ query: graphql.query || '', variables: graphql.variables || {} }, null, 2);
    return { type: 'json', value: { query: graphql.query || '', variables: graphql.variables || {} }, raw, contentType: contentType || 'application/json' };
  }
  warnings.push(`Body mode ${mode} پشتیبانی کامل ندارد و به raw تبدیل شد.`);
  return { type: 'raw', value: body[mode] || '', raw: asText(body[mode], ''), contentType };
}

function postmanAuthEntries(auth: Record<string, unknown>, type: string): Record<string, string> {
  const source = auth[type];
  const entries = Array.isArray(source) ? source : Object.entries(asRecord(source)).map(([key, value]) => ({ key, value }));
  return asArray<Record<string, unknown>>(entries).reduce<Record<string, string>>((acc, item) => {
    const key = asText(item.key || item.name, '').trim();
    if (key) acc[key] = asText(item.value, '');
    return acc;
  }, {});
}

function resolvePostmanAuth(authValue: unknown, inheritedAuth: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!authValue) return inheritedAuth;
  const auth = asRecord(authValue);
  const type = asText(auth.type, '').toLowerCase();
  if (!type || type === 'inherit') return inheritedAuth;
  return auth;
}

function parsePostmanAuth(auth: Record<string, unknown> | null): {
  authentication: NormalizedApiRequest['authentication'];
  headers: ApiRequestHeader[];
  queryParameters: ApiKeyValueParameter[];
} {
  const authentication: NormalizedApiRequest['authentication'] = { type: 'none' };
  const headers: ApiRequestHeader[] = [];
  const queryParameters: ApiKeyValueParameter[] = [];
  if (!auth) return { authentication, headers, queryParameters };
  const type = asText(auth.type, '').toLowerCase();
  if (!type || type === 'noauth') return { authentication, headers, queryParameters };
  if (type === 'bearer') {
    const token = postmanAuthEntries(auth, 'bearer').token || '';
    return { authentication: { type: 'bearer', bearerTokenReference: token }, headers, queryParameters };
  }
  if (type === 'basic') {
    const basic = postmanAuthEntries(auth, 'basic');
    return { authentication: { type: 'basic', basicUsername: basic.username || '', basicPasswordReference: basic.password || '' }, headers, queryParameters };
  }
  if (type === 'apikey') {
    const apiKey = postmanAuthEntries(auth, 'apikey');
    const name = apiKey.key || apiKey.name || 'x-api-key';
    const value = apiKey.value || '';
    if ((apiKey.in || '').toLowerCase() === 'query') {
      queryParameters.push(makeImportedParam(name, value, 0));
    } else {
      headers.push(makeImportedHeader(name, value, 0, 'API key واردشده از Postman auth.'));
    }
    return { authentication: { type: 'api-key', apiKeyName: name, apiKeyValueReference: value }, headers, queryParameters };
  }
  headers.push(makeImportedHeader('Authorization', `{{${type}_auth}}`, 0, `Auth type ${type} از Postman به صورت placeholder وارد شد.`));
  return { authentication: { type: 'custom-headers', customHeaderReferences: [{ name: 'Authorization', valueReference: `{{${type}_auth}}` }] }, headers, queryParameters };
}

function classifyNormalizedPostmanRequest(url: string, body: NormalizedApiRequest['body']): ApiClassification {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split('?')[0] || url;
  }
  let bodyRecord = asRecord(body.value);
  if (!Object.keys(bodyRecord).length && body.raw) {
    const parsed = parseJson(body.raw);
    bodyRecord = parsed.ok ? asRecord(parsed.value) : {};
  }
  if (
    pathname.endsWith('/core-api/v1/data-provider/store-form-data') &&
    typeof bodyRecord.serviceId === 'string' &&
    typeof bodyRecord.formId === 'string' &&
    'data' in bodyRecord
  ) {
    return { type: 'CORE_COMMAND', serviceId: bodyRecord.serviceId, operationPath: bodyRecord.formId, coreOperationType: 'COMMAND', endpoint: '/core-api/v1/data-provider/store-form-data' };
  }
  if (
    pathname.endsWith('/core-api/v1/data-provider/get-data-source') &&
    typeof bodyRecord.serviceId === 'string' &&
    typeof bodyRecord.key === 'string' &&
    'params' in bodyRecord
  ) {
    return { type: 'CORE_QUERY', serviceId: bodyRecord.serviceId, operationPath: bodyRecord.key, coreOperationType: 'QUERY', endpoint: '/core-api/v1/data-provider/get-data-source' };
  }
  return { type: 'GENERIC_HTTP', serviceId: null, operationPath: null, coreOperationType: null, endpoint: null };
}

function collectPostmanScriptWarnings(item: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const events = asArray<Record<string, unknown>>(item.event);
  for (const event of events) {
    const script = asRecord(event.script);
    const execLines = asArray(script.exec).map(line => String(line || ''));
    const execText = execLines.join('\n');
    if (/\bpm\./.test(execText)) {
      warnings.push('اسکریپت Postman شامل pm.* است و در Online API Console پشتیبانی نمی‌شود؛ به Scripts امن کنسول مهاجرت دهید.');
      break;
    }
  }
  return warnings;
}

function parsePostmanRequestItem(
  item: Record<string, unknown>,
  folderPath: string[],
  inheritedAuth: Record<string, unknown> | null
): PostmanImportRequestPreview | null {
  const requestValue = item.request;
  if (!requestValue) return null;
  const warnings: string[] = [...collectPostmanScriptWarnings(item)];
  const request = typeof requestValue === 'string' ? { url: requestValue, method: 'GET' } : asRecord(requestValue);
  const method = normalizePostmanMethod(request.method, warnings);
  const { url, queryParameters } = splitPostmanUrl(request.url, warnings);
  const parsedHeaders = parsePostmanHeaders(request.header);
  const auth = parsePostmanAuth(resolvePostmanAuth(request.auth, inheritedAuth));
  const headers = [
    ...parsedHeaders.headers,
    ...auth.headers.map((header, index) => ({ ...header, displayOrder: parsedHeaders.headers.length + index })),
  ];
  const cookies = parsedHeaders.cookies;
  const body = parsePostmanBody(request.body, headers, warnings);
  const allQueryParameters = [
    ...queryParameters,
    ...auth.queryParameters.map((param, index) => ({ ...param, displayOrder: queryParameters.length + index })),
  ];
  const normalizedRequest: NormalizedApiRequest = {
    method,
    url,
    queryParameters: allQueryParameters,
    headers,
    cookies,
    body,
    authentication: auth.authentication,
    tls: { verifyCertificate: true },
    executionMode: 'RECOMMENDED',
    classification: classifyNormalizedPostmanRequest(url, body),
  };
  return {
    name: asText(item.name, `${method} ${url}`),
    folderPath,
    method,
    url,
    headerCount: headers.length,
    queryCount: allQueryParameters.length,
    bodyType: body.type,
    warningCount: warnings.length,
    warnings,
    normalizedRequest,
    description: textFromPostmanDescription(request.description || item.description),
  };
}

function collectPostmanRequests(
  items: unknown,
  folderPath: string[] = [],
  inheritedAuth: Record<string, unknown> | null = null
): PostmanImportRequestPreview[] {
  return asArray<Record<string, unknown>>(items).flatMap(item => {
    const itemName = asText(item.name, '').trim();
    const itemAuth = resolvePostmanAuth(item.auth, inheritedAuth);
    const nested = asArray(item.item);
    if (nested.length) return collectPostmanRequests(nested, itemName ? [...folderPath, itemName] : folderPath, itemAuth);
    const parsed = parsePostmanRequestItem(item, folderPath, itemAuth);
    return parsed ? [parsed] : [];
  });
}

function parsePostmanVariables(value: unknown): ApiCollection['variables'] {
  return parsePostmanKeyValueRows(value)
    .filter(row => !row.disabled)
    .map(row => ({
      id: `postman-var-${crypto.randomUUID()}`,
      key: row.key,
      currentValue: row.value,
      initialValue: row.value,
      sensitive: isSensitiveFieldName(row.key),
      scope: 'COLLECTION' as const,
      description: row.description,
    }));
}

function parsePostmanCollectionImport(value: string): PostmanCollectionImportPreview {
  const parsed = JSON.parse(value) as unknown;
  const root = asRecord(parsed);
  const info = asRecord(root.info);
  const name = asText(info.name, 'Imported Postman Collection').trim() || 'Imported Postman Collection';
  const description = textFromPostmanDescription(info.description);
  const auth = resolvePostmanAuth(root.auth, null);
  const requests = collectPostmanRequests(root.item, [], auth);
  const warnings: string[] = [];
  if (!asText(info.schema, '').includes('postman')) warnings.push('Schema رسمی Postman Collection در info.schema پیدا نشد، اما ساختار itemها parse شد.');
  if (!requests.length) warnings.push('هیچ Request قابل import در Collection پیدا نشد.');
  return {
    name,
    description,
    requestCount: requests.length,
    variables: parsePostmanVariables(root.variable),
    requests,
    warnings,
  };
}

function asText(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function prettySnapshot(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeFileName(value: string): string {
  return String(value || 'api-document')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'api-document';
}

function markdownToWordHtml(markdown: string, title: string): string {
  const lines = String(markdown || '').split(/\r?\n/);
  const body: string[] = [];
  let inCode = false;
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      body.push('</ul>');
      listOpen = false;
    }
  };

  lines.forEach(line => {
    if (line.trim().startsWith('```')) {
      closeList();
      if (inCode) {
        body.push('</pre>');
        inCode = false;
      } else {
        body.push('<pre>');
        inCode = true;
      }
      return;
    }
    if (inCode) {
      body.push(`${escapeHtml(line)}\n`);
      return;
    }
    if (!line.trim()) {
      closeList();
      body.push('<p>&nbsp;</p>');
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min((heading[1] ?? '').length, 4);
      body.push(`<h${level}>${escapeHtml(heading[2] ?? '')}</h${level}>`);
      return;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        body.push('<ul>');
        listOpen = true;
      }
      body.push(`<li>${escapeHtml(bullet[1] ?? '')}</li>`);
      return;
    }
    closeList();
    body.push(`<p>${escapeHtml(line)}</p>`);
  });
  closeList();
  if (inCode) body.push('</pre>');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { direction: rtl; font-family: Tahoma, Arial, sans-serif; color: #111827; line-height: 1.7; }
    h1, h2, h3, h4 { color: #1f2937; }
    pre { direction: ltr; text-align: left; background: #f3f4f6; border: 1px solid #d1d5db; padding: 10px; white-space: pre-wrap; font-family: Consolas, monospace; }
    p, li { font-size: 11pt; }
  </style>
</head>
<body>
  ${body.join('\n')}
</body>
</html>`;
}

function downloadWordDocument(markdown: string, title: string) {
  const html = markdownToWordHtml(markdown, title);
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFileName(title)}-${new Date().toISOString().split('T')[0]}.doc`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBase64File(base64: string, fileName: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadJsonFile(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName || 'api-console.postman_collection.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadTextFile(content: string, fileName: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowsToCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [headers.map(escapeCsvCell).join(','), ...rows.map(row => row.map(escapeCsvCell).join(','))].join('\n');
}

function safeBodyPreview(execution: ApiRequestExecution | null): string {
  if (!execution?.response?.bodyPreview) return '';
  const raw = execution.response.bodyPreview;
  const contentType = `${execution.response.contentType || execution.responseContentType || ''}`.toLowerCase();
  const looksLikeJson = execution.response.safePreviewMode === 'JSON' ||
    contentType.includes('json') ||
    /^[\s\uFEFF]*[\[{]/.test(raw);

  if (!looksLikeJson) return raw;

  try {
    return JSON.stringify(JSON.parse(raw.replace(/^\uFEFF/, '')), null, 2);
  } catch {
    return raw;
  }
}

function isJsonResponsePreview(execution: ApiRequestExecution | null): boolean {
  if (!execution?.response?.bodyPreview) return false;
  const raw = execution.response.bodyPreview;
  const contentType = `${execution.response.contentType || execution.responseContentType || ''}`.toLowerCase();
  return execution.response.safePreviewMode === 'JSON' ||
    contentType.includes('json') ||
    /^[\s\uFEFF]*[\[{]/.test(raw);
}

function bodySearchCount(body: string, search: string): number {
  if (!search.trim()) return 0;
  return body.toLowerCase().split(search.toLowerCase()).length - 1;
}

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</span>
);

const CodeBlock = ({ value, minHeight = 'min-h-28' }: { value: string; minHeight?: string }) => (
  <pre className={`${minHeight} overflow-auto rounded-lg border border-gray-200 bg-gray-950 p-3 text-left text-xs text-gray-100`} dir="ltr">
    {value || '-'}
  </pre>
);

const JsonResponseViewer = ({ value }: { value: string }) => {
  const [fontSize, setFontSize] = useState(12);
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => (value || '-').split(/\r?\n/), [value]);
  const isLarge = lines.length > 80 || value.length > 12000;
  const lineHeight = 1.55;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-950" dir="ltr">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-300">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-gray-800 px-2 py-1 font-mono text-gray-100">JSON</span>
          <span className="rounded bg-gray-800 px-2 py-1">lines: {lines.length}</span>
          {isLarge && <span className="rounded bg-amber-900/50 px-2 py-1 text-amber-100">large response</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => setFontSize(size => Math.max(10, size - 1))}
            className="rounded-md p-1.5 text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-12 text-center font-mono">{fontSize}px</span>
          <button
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => setFontSize(size => Math.min(20, size + 1))}
            className="rounded-md p-1.5 text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          {isLarge && (
            <button
              type="button"
              onClick={() => setExpanded(open => !open)}
              className="rounded-md border border-gray-700 px-2 py-1 text-gray-200 hover:bg-gray-800"
            >
              {expanded ? 'Compact' : 'Expand'}
            </button>
          )}
        </div>
      </div>
      <div className={`${expanded ? 'max-h-[72vh]' : 'max-h-[460px]'} overflow-auto`}>
        <div className="grid min-w-max grid-cols-[4rem_minmax(0,1fr)]">
          <div
            className="select-none border-r border-gray-800 bg-gray-900 py-3 text-right font-mono text-gray-500"
            style={{ fontSize, lineHeight }}
          >
            {lines.map((_, index) => (
              <div key={index} className="px-3">
                {index + 1}
              </div>
            ))}
          </div>
          <pre
            className="whitespace-pre p-3 font-mono text-gray-100"
            style={{ fontSize, lineHeight }}
          >
            {value || '-'}
          </pre>
        </div>
      </div>
    </div>
  );
};

const Toggle = ({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => { if (!disabled) onChange(!checked); }}
    className={`flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
  >
    <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}>
      <span className={`theme-switch-thumb inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? '-translate-x-4' : '-translate-x-1'}`} />
    </span>
    {label}
  </button>
);

const JsonEditor = ({
  value,
  onChange,
  onFormat,
  onCopy,
}: {
  value: string;
  onChange: (value: string) => void;
  onFormat: () => void;
  onCopy: () => void;
}) => {
  const [search, setSearch] = useState('');
  const validation = parseJson(value);
  const lines = value.split(/\r?\n/).length || 1;
  const matchCount = bodySearchCount(value, search);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onFormat}>Format</Button>
        <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={onCopy}>کپی</Button>
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pr-9 pl-3 text-sm"
            placeholder="جستجو در JSON body"
          />
        </label>
        <Badge variant={validation.ok ? 'success' : 'danger'} size="sm">
          {validation.ok ? 'JSON معتبر' : `JSON نامعتبر${validation.line ? ` در ${validation.line}:${validation.column}` : ''}`}
        </Badge>
        {search && <Badge variant="info" size="sm">{matchCount} مورد</Badge>}
      </div>
      {!validation.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {validation.message}
        </div>
      )}
      <div className="grid max-h-[520px] grid-cols-[3.5rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-gray-300 bg-gray-950" dir="ltr">
        <pre className="select-none overflow-hidden border-r border-gray-700 bg-gray-900 p-3 text-right text-xs leading-5 text-gray-500">
          {Array.from({ length: lines }, (_, index) => index + 1).join('\n')}
        </pre>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="min-h-[340px] resize-y bg-gray-950 p-3 font-mono text-xs leading-5 text-gray-100 outline-none"
        />
      </div>
    </div>
  );
};

export const OnlineApiConsolePage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeContext, projects, selectProject } = useAuthStore();
  const { appId, initialApplicationIdForCreate } = useDataScope();
  const { getApplicationName } = useApplicationLookup();
  const [collections, setCollections] = useState<ApiCollection[]>([]);
  const [environments, setEnvironments] = useState<ApiEnvironmentProfile[]>([]);
  const [requests, setRequests] = useState<PaginatedResponse<ApiRequestDefinition> | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ApiRequestDefinition | null>(null);
  const [savedRequest, setSavedRequest] = useState<ApiRequestDefinition | null>(null);
  const [pageMode, setPageMode] = useState<PageMode>('list');
  const [filters, setFilters] = useState({
    page: 1,
    limit: 10,
    search: '',
    collectionId: '',
    classificationType: '',
    folderPath: '',
    systemFilter: '',
    sourceApproach: '' as '' | 'FREE' | 'CDE',
  });
  const [knownFolders, setKnownFolders] = useState<string[]>([]);
  const [folderDraft, setFolderDraft] = useState('');
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchHits, setGlobalSearchHits] = useState<Array<{ kind: 'request' | 'repository' | 'discovery'; id: string; title: string; subtitle: string }>>([]);
  const [historyStatusFilter, setHistoryStatusFilter] = useState('');
  const [historyCompareIds, setHistoryCompareIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectingRequestId, setSelectingRequestId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>('params');
  const [curlModalOpen, setCurlModalOpen] = useState(false);
  const [curlText, setCurlText] = useState('');
  const [curlPreview, setCurlPreview] = useState<ApiCurlImportPreview | null>(null);
  const [importTitle, setImportTitle] = useState('');
  const [importCollectionId, setImportCollectionId] = useState('');
  const [previewSubtab, setPreviewSubtab] = useState<'summary' | 'original' | 'normalized' | 'warnings'>('summary');
  const [postmanModalOpen, setPostmanModalOpen] = useState(false);
  const [postmanText, setPostmanText] = useState('');
  const [postmanFileName, setPostmanFileName] = useState('');
  const [postmanPreview, setPostmanPreview] = useState<PostmanCollectionImportPreview | null>(null);
  const [postmanImporting, setPostmanImporting] = useState(false);
  const [postmanApplicationId, setPostmanApplicationId] = useState('');
  const [editCurlModalOpen, setEditCurlModalOpen] = useState(false);
  const [editCurlText, setEditCurlText] = useState('');
  const [editCurlPreview, setEditCurlPreview] = useState<ApiCurlImportPreview | null>(null);
  const [editCurlPreviewSubtab, setEditCurlPreviewSubtab] = useState<'summary' | 'original' | 'normalized' | 'warnings'>('summary');
  const [effectiveRequest, setEffectiveRequest] = useState<ApiEffectiveRequestSnapshot | null>(null);
  const [historyRows, setHistoryRows] = useState<ApiRequestExecution[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<ApiRequestExecution | null>(null);
  const [exports, setExports] = useState<Record<ApiExportDialect, string>>({ bash: '', 'windows-cmd': '', powershell: '' });
  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [documentation, setDocumentation] = useState('');
  const [documentationWarnings, setDocumentationWarnings] = useState<string[]>([]);
  const [documentationRefreshing, setDocumentationRefreshing] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualResponses, setManualResponses] = useState<ApiManualResponseExample[]>([]);
  const [manualForm, setManualForm] = useState({ statusCode: 200, headersText: 'content-type: application/json', body: '{\n  "ok": true\n}', source: '', reason: '' });
  const [productionModalOpen, setProductionModalOpen] = useState(false);
  const [productionForm, setProductionForm] = useState({ confirmed: false, reason: '' });
  const [dualApprovalStatus, setDualApprovalStatus] = useState<'UNKNOWN' | 'MISSING' | 'PENDING' | 'ACTIVE'>('UNKNOWN');
  const [dualApprovalBusy, setDualApprovalBusy] = useState(false);
  const [corePresentationEnabled, setCorePresentationEnabled] = useState(true);
  const [selfCheckOpen, setSelfCheckOpen] = useState(false);
  const [selfCheck, setSelfCheck] = useState<{ passed: number; failed: number; details: ParserSelfCheckDetail[] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiRequestDefinition | null>(null);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [collectionForm, setCollectionForm] = useState({
    applicationId: PERSONAL_APPLICATION_ID,
    name: '',
    description: '',
    bindMode: 'free' as 'free' | 'system',
  });
  const [collectionAdvancedOpen, setCollectionAdvancedOpen] = useState(false);
  const [exportingCollectionId, setExportingCollectionId] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(
    () => workspaceViewFromPath(typeof window !== 'undefined' ? window.location.pathname : '/') || 'requests',
  );

  useEffect(() => {
    const fromPath = workspaceViewFromPath(location.pathname);
    if (fromPath && fromPath !== workspaceView) {
      setWorkspaceView(fromPath);
      setPageMode('list');
    }
  }, [location.pathname]);

  const goWorkspace = (id: WorkspaceNavId) => {
    setPageMode('list');
    setWorkspaceView(id);
    const nextPath = pathForWorkspaceView(id);
    if (location.pathname !== nextPath) {
      navigate(nextPath);
    }
  };
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [requestsMoreOpen, setRequestsMoreOpen] = useState(false);
  const [repositoryRows, setRepositoryRows] = useState<PaginatedResponse<ApiRepositoryItem> | null>(null);
  const [repositoryLoading, setRepositoryLoading] = useState(false);
  const [repositoryFilters, setRepositoryFilters] = useState({ page: 1, limit: 10, search: '' });
  const [repositoryDetail, setRepositoryDetail] = useState<ApiRepositoryItem | null>(null);
  const [repositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [repositoryConsumerIds, setRepositoryConsumerIds] = useState<string[]>([]);
  const [repositoryConsumerEditMode, setRepositoryConsumerEditMode] = useState(false);
  const [repositoryConsumersSaving, setRepositoryConsumersSaving] = useState(false);
  const [shareReviews, setShareReviews] = useState<PaginatedResponse<ApiShareRequest> | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewFilters, setReviewFilters] = useState({ page: 1, limit: 10, search: '', status: '' });
  const [reviewDetail, setReviewDetail] = useState<ApiShareRequest | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [consumerCandidates, setConsumerCandidates] = useState<ApiConsumerCandidate[]>([]);
  const [selectedConsumerIds, setSelectedConsumerIds] = useState<string[]>([]);
  const [shareTarget, setShareTarget] = useState<ApiRequestDefinition | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareConfirmOpen, setShareConfirmOpen] = useState(false);
  const [shareForm, setShareForm] = useState({ purpose: '', introduction: '', description: '', ticketId: '', ticketUrl: '' });
  const [sharing, setSharing] = useState(false);
  const [docLanguage, setDocLanguage] = useState<ApiDocLanguage>('FA');
  const [reviewTicketForm, setReviewTicketForm] = useState({ ticketId: '', ticketUrl: '' });
  const [reviewTicketSaving, setReviewTicketSaving] = useState(false);
  const [creatingMock, setCreatingMock] = useState(false);
  const [contractSuiteLoading, setContractSuiteLoading] = useState(false);
  const [exportingOpenApiId, setExportingOpenApiId] = useState<string | null>(null);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [reviewActionLoading, setReviewActionLoading] = useState(false);
  const [adminUsers, setAdminUsers] = useState<ApiConsoleDirectoryUser[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [adminRoleTarget, setAdminRoleTarget] = useState<{
    user: ApiConsoleDirectoryUser;
    role: UserRole;
    enabled: boolean;
    applicationId: string;
  } | null>(null);
  const [adminRoleSaving, setAdminRoleSaving] = useState(false);
  const [usageReport, setUsageReport] = useState<ApiUsageReport | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageFilters, setUsageFilters] = useState({
    page: 1,
    limit: 10,
    eventType: '',
    apiId: '',
    userId: '',
    dateFrom: '',
    dateTo: '',
  });
  const [auditRows, setAuditRows] = useState<PaginatedResponse<ApiAuditEvent> | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilters, setAuditFilters] = useState({ page: 1, limit: 20, action: '', userId: '' });
  const [notificationFeed, setNotificationFeed] = useState<NotificationListResponse | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionForm, setVersionForm] = useState({ version: '', changeLog: '', breakingChange: false, migrationNote: '' });
  const [versioning, setVersioning] = useState(false);
  const [runtimeConnected, setRuntimeConnected] = useState(false);
  const [activityRows, setActivityRows] = useState<PaginatedResponse<ApiActivityEvent> | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilters, setActivityFilters] = useState({ page: 1, limit: 30 });
  const [collectionRunModalOpen, setCollectionRunModalOpen] = useState(false);
  const [collectionRunStopOnFail, setCollectionRunStopOnFail] = useState(true);
  const [collectionRunning, setCollectionRunning] = useState(false);
  const [latestCollectionRun, setLatestCollectionRun] = useState<ApiTestRun | null>(null);
  const [recentTestRuns, setRecentTestRuns] = useState<ApiTestRun[]>([]);
  const [reviewChecklist, setReviewChecklist] = useState<ApiReviewChecklist>(EMPTY_REVIEW_CHECKLIST);
  const [reviewCommentText, setReviewCommentText] = useState('');
  const [reviewCommentSaving, setReviewCommentSaving] = useState(false);
  const [deprecateModalOpen, setDeprecateModalOpen] = useState(false);
  const [deprecateForm, setDeprecateForm] = useState({ reason: '', effectiveAt: '' });
  const [deprecating, setDeprecating] = useState(false);
  const [ownershipTransferUserId, setOwnershipTransferUserId] = useState('');
  const [coOwnersInput, setCoOwnersInput] = useState('');
  const [ownershipSaving, setOwnershipSaving] = useState(false);
  const derivedRequestSeqRef = useRef(0);
  const loadAllSeqRef = useRef(0);
  const reloadRequestsSeqRef = useRef(0);
  const repositorySeqRef = useRef(0);
  const reviewSeqRef = useRef(0);
  const selectRequestSeqRef = useRef(0);
  const suppressNextDerivedRefreshRef = useRef<string | null>(null);

  const policy = apiConsoleApi.policy;
  const role = activeContext?.role;
  const canCreate = !!role && (role === 'SYSTEM_ADMIN' || policy.canCreate.includes(role));
  const canEdit = !!role && (role === 'SYSTEM_ADMIN' || policy.canEdit.includes(role));
  const canExecute = !!role && (role === 'SYSTEM_ADMIN' || policy.canExecute.includes(role));
  const canDocument = !!role && (role === 'SYSTEM_ADMIN' || policy.canGenerateDocumentation.includes(role));
  const canDelete = !!role && (role === 'SYSTEM_ADMIN' || policy.canDelete.includes(role));
  const canManageGeneralSettings = !!role && (role === 'SYSTEM_ADMIN' || policy.canManageUsers.includes(role));
  const canReviewShares = !!role && (role === 'SYSTEM_ADMIN' || policy.canReviewShares.includes(role));
  const canViewUsageReports = !!role && (role === 'SYSTEM_ADMIN' || policy.canViewUsageReports.includes(role));
  const isSystemAdmin = role === 'SYSTEM_ADMIN';

  const authApproach = useSessionStore(state => state.authApproach);
  const canManageProtectedEnvironments = !!role && (role === 'SYSTEM_ADMIN' || policy.canManageProtectedEnvironments.includes(role));
  const canManageEnvironments = !!role && (role === 'SYSTEM_ADMIN' || policy.canManageEnvironments.includes(role));

  const navGroups = useMemo(
    () => buildWorkspaceNav({
      canManageEnvironments,
      canEdit,
      canReviewShares,
      canManageGeneralSettings,
      isSystemAdmin,
      canViewUsageReports,
      authApproach,
    }),
    [canManageEnvironments, canEdit, canReviewShares, canManageGeneralSettings, isSystemAdmin, canViewUsageReports, authApproach],
  );

  const workspaceTitle = useMemo(() => {
    const labels: Record<WorkspaceView, string> = {
      requests: 'درخواست‌ها',
      repository: 'مخزن',
      runtime: 'Runtime',
      environments: 'محیط‌ها',
      activity: 'فعالیت',
      mocks: 'Mock',
      jit: 'دسترسی JIT',
      reports: 'گزارش‌ها',
      reviews: 'بازبینی Share',
      users: 'کاربران',
      runners: 'Runnerها',
      branding: 'برندینگ',
      'org-policy': 'سیاست سازمان',
      compliance: 'انطباق',
      audit: 'ممیزی',
    };
    return labels[workspaceView] || 'Workspace';
  }, [workspaceView]);

  const visibleTabs = useMemo(
    () => TAB_LABELS.filter(tab => tab.id !== 'settings' || canEdit),
    [canEdit]
  );

  const selectedEnvironment = useMemo(
    () => environments.find(environment => environment.id === selectedRequest?.environmentId) || environments[0],
    [environments, selectedRequest?.environmentId]
  );

  const topUsageApis = useMemo(() => {
    const counts = new Map<string, { apiId: string; apiTitle: string; executed: number; added: number }>();
    for (const row of usageReport?.data || []) {
      const key = String(row.apiId || '');
      if (!key) continue;
      const current = counts.get(key) || {
        apiId: key,
        apiTitle: row.apiTitle || key,
        executed: 0,
        added: 0,
      };
      if (row.eventType === 'API_EXECUTED') current.executed += 1;
      if (row.eventType === 'ADDED_TO_CONSOLE') current.added += 1;
      if (row.apiTitle) current.apiTitle = row.apiTitle;
      counts.set(key, current);
    }
    return Array.from(counts.values())
      .sort((left, right) => right.executed - left.executed || right.added - left.added)
      .slice(0, 10);
  }, [usageReport]);

  const latestExecution = selectedExecution || historyRows[0] || null;
  const hasUnsavedChanges = useMemo(() => {
    if (!selectedRequest || !savedRequest) return false;
    return JSON.stringify(selectedRequest) !== JSON.stringify(savedRequest);
  }, [selectedRequest, savedRequest]);

  const requestsScope = filters.systemFilter || 'ALL';

  useEffect(() => {
    if (activeContext) {
      loadAll();
    }
  }, [activeContext, appId, filters.page, filters.limit, filters.collectionId, filters.classificationType, filters.folderPath, filters.systemFilter, filters.sourceApproach]);

  const searchEffectSkipRef = useRef(true);
  useEffect(() => {
    if (!activeContext) return;
    if (searchEffectSkipRef.current) {
      searchEffectSkipRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void reloadRequests();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!activeContext) {
      setRuntimeConnected(false);
      return;
    }
    let cancelled = false;
    apiConsoleApi.getRuntimeProfiles(activeContext.applicationId, activeContext)
      .then(rows => Promise.all(rows.map(profile => apiConsoleApi.getRuntimeSession(profile.id, activeContext).catch(() => null))))
      .then(statuses => { if (!cancelled) setRuntimeConnected(statuses.some(status => status?.connected)); })
      .catch(() => { if (!cancelled) setRuntimeConnected(false); });
    return () => { cancelled = true; };
  }, [activeContext?.contextId, activeContext?.applicationId]);

  useEffect(() => {
    if (activeContext && workspaceView === 'repository') {
      loadRepository();
    }
  }, [activeContext, appId, workspaceView, repositoryFilters.page, repositoryFilters.limit]);

  useEffect(() => {
    if (activeContext && workspaceView === 'reviews' && canReviewShares) {
      loadShareReviews();
    }
  }, [activeContext, appId, workspaceView, reviewFilters.page, reviewFilters.limit, reviewFilters.status]);

  useEffect(() => {
    if (activeContext && workspaceView === 'users' && canManageGeneralSettings) {
      loadAdminUsers();
    }
  }, [activeContext, workspaceView, canManageGeneralSettings]);

  useEffect(() => {
    if (activeContext && workspaceView === 'reports' && canViewUsageReports) {
      loadUsageReport();
    }
  }, [activeContext, appId, workspaceView, canViewUsageReports, usageFilters.page, usageFilters.limit, usageFilters.eventType, usageFilters.apiId, usageFilters.userId, usageFilters.dateFrom, usageFilters.dateTo]);

  useEffect(() => {
    if (activeContext && workspaceView === 'audit' && canManageGeneralSettings) {
      loadAuditLog();
    }
  }, [activeContext, appId, workspaceView, canManageGeneralSettings, auditFilters.page, auditFilters.limit, auditFilters.action, auditFilters.userId]);

  useEffect(() => {
    if (activeContext && workspaceView === 'activity') {
      void loadActivity();
    }
  }, [activeContext, appId, workspaceView, activityFilters.page, activityFilters.limit]);

  useEffect(() => {
    if (activeContext) {
      loadNotifications();
    }
  }, [activeContext?.contextId]);

  useEffect(() => {
    if (!canEdit && activeTab === 'settings') {
      setActiveTab('params');
    }
  }, [canEdit, activeTab]);

  useEffect(() => {
    setCoOwnersInput((selectedRequest?.coOwnerIds || []).join(', '));
    setOwnershipTransferUserId('');
  }, [selectedRequest?.id]);

  useEffect(() => {
    if (!selectedRequest) {
      derivedRequestSeqRef.current += 1;
      return;
    }
    const requestKey = derivedRequestKey(selectedRequest);
    if (suppressNextDerivedRefreshRef.current === requestKey) {
      suppressNextDerivedRefreshRef.current = null;
      return;
    }
    refreshDerivedViews(selectedRequest, true);
  }, [selectedRequest?.id, selectedRequest?.environmentId, selectedRequest?.executionMode]);

  const loadAll = async () => {
    if (!activeContext) return;
    const loadSeq = ++loadAllSeqRef.current;
    setLoading(true);
    try {
      const [collectionRows, environmentRows, requestRows, repositorySummary, reviewSummary] = await Promise.all([
        apiConsoleApi.getCollections(requestsScope, activeContext),
        apiConsoleApi.getEnvironments(),
        apiConsoleApi.getRequests(requestsScope, filters, activeContext),
        apiConsoleApi
          .getRepository({ ...repositoryFilters, applicationId: appId }, activeContext)
          .catch(() => null),
        canReviewShares
          ? apiConsoleApi
              .getShareReviews({ ...reviewFilters, applicationId: appId }, activeContext)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      if (loadSeq !== loadAllSeqRef.current) return;
      setCollections(collectionRows);
      setEnvironments(environmentRows);
      setRequests(requestRows);
      if (repositorySummary) {
        setRepositoryRows(repositorySummary);
      }
      if (reviewSummary) {
        setShareReviews(reviewSummary);
      }
      if (selectedRequest && !requestRows.data.some(request => request.id === selectedRequest.id)) {
        setSelectedRequest(null);
        setSavedRequest(null);
        setPageMode('list');
      }
    } catch (error) {
      if (loadSeq === loadAllSeqRef.current) {
        toast.error(error instanceof Error ? error.message : 'بارگذاری داده‌های API Console ناموفق بود.');
      }
    } finally {
      if (loadSeq === loadAllSeqRef.current) {
        setLoading(false);
      }
    }
  };

  const loadRepository = async () => {
    if (!activeContext) return;
    const repositorySeq = ++repositorySeqRef.current;
    setRepositoryLoading(true);
    try {
      const rows = await apiConsoleApi.getRepository({ ...repositoryFilters, applicationId: appId }, activeContext);
      if (repositorySeq !== repositorySeqRef.current) return;
      setRepositoryRows(rows);
    } catch (error) {
      if (repositorySeq === repositorySeqRef.current) {
        toast.error(error instanceof Error ? error.message : 'بارگذاری Repository ناموفق بود.');
      }
    } finally {
      if (repositorySeq === repositorySeqRef.current) {
        setRepositoryLoading(false);
      }
    }
  };

  const loadShareReviews = async () => {
    if (!activeContext || !canReviewShares) return;
    const reviewSeq = ++reviewSeqRef.current;
    setReviewsLoading(true);
    try {
      const rows = await apiConsoleApi.getShareReviews({ ...reviewFilters, applicationId: appId }, activeContext);
      if (reviewSeq !== reviewSeqRef.current) return;
      setShareReviews(rows);
    } catch (error) {
      if (reviewSeq === reviewSeqRef.current) {
        toast.error(error instanceof Error ? error.message : 'بارگذاری درخواست‌های اشتراک ناموفق بود.');
      }
    } finally {
      if (reviewSeq === reviewSeqRef.current) {
        setReviewsLoading(false);
      }
    }
  };

  const loadAdminUsers = async () => {
    if (!activeContext || !canManageGeneralSettings) return;
    setAdminUsersLoading(true);
    try {
      setAdminUsers(await apiConsoleApi.getAdminUsers(activeContext));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری کاربران CDE ناموفق بود.');
    } finally {
      setAdminUsersLoading(false);
    }
  };

  const loadActivity = async () => {
    if (!activeContext) return;
    setActivityLoading(true);
    try {
      const rows = await apiConsoleApi.getActivity({
        applicationId: typeof appId === 'string' && appId !== 'ALL' ? appId : activeContext.applicationId,
        page: activityFilters.page,
        limit: activityFilters.limit,
      }, activeContext);
      setActivityRows(rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری Activity ناموفق بود.');
    } finally {
      setActivityLoading(false);
    }
  };

  const loadRecentTestRuns = async (collectionId: string) => {
    if (!activeContext || !collectionId) {
      setRecentTestRuns([]);
      return;
    }
    try {
      const rows = await apiConsoleApi.getTestRuns({ collectionId, page: 1, limit: 5 }, activeContext);
      setRecentTestRuns(rows.data || []);
    } catch {
      setRecentTestRuns([]);
    }
  };

  const handleSystemAdminChange = async () => {
    if (!activeContext || !adminRoleTarget) return;
    setAdminRoleSaving(true);
    try {
      const updated = await apiConsoleApi.setDirectoryRole(
        adminRoleTarget.user.id,
        adminRoleTarget.role,
        adminRoleTarget.enabled,
        activeContext,
        adminRoleTarget.enabled
          ? { applicationId: adminRoleTarget.applicationId || 'ALL' }
          : {}
      );
      setAdminUsers(previous => previous.map(user => user.id === updated.id ? updated : user));
      toast.success(adminRoleTarget.enabled
        ? `نقش «${roleLabel(adminRoleTarget.role)}» برای «${updated.fullName}» فعال شد.`
        : `نقش «${roleLabel(adminRoleTarget.role)}» از «${updated.fullName}» گرفته شد.`);
      setAdminRoleTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تغییر نقش کاربر ناموفق بود.');
    } finally {
      setAdminRoleSaving(false);
    }
  };

  const loadUsageReport = async () => {
    if (!activeContext || !canViewUsageReports) {
      setUsageReport(null);
      return;
    }
    setUsageLoading(true);
    try {
      const report = await apiConsoleApi.getApiUsageReport({
        page: usageFilters.page,
        limit: usageFilters.limit,
        applicationId: appId,
        eventType: usageFilters.eventType || undefined,
        apiId: usageFilters.apiId || undefined,
        userId: usageFilters.userId || undefined,
        dateFrom: usageFilters.dateFrom || undefined,
        dateTo: usageFilters.dateTo || undefined,
      }, activeContext);
      setUsageReport(report);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری گزارش مصرف ناموفق بود.');
      setUsageReport(null);
    } finally {
      setUsageLoading(false);
    }
  };

  const loadAuditLog = async () => {
    if (!activeContext || !canManageGeneralSettings) {
      setAuditRows(null);
      return;
    }
    setAuditLoading(true);
    try {
      setAuditRows(await apiConsoleApi.getAuditLog({
        page: auditFilters.page,
        limit: auditFilters.limit,
        action: auditFilters.action || undefined,
        userId: auditFilters.userId || undefined,
        applicationId: appId,
      }, activeContext));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری Audit ناموفق بود.');
      setAuditRows(null);
    } finally {
      setAuditLoading(false);
    }
  };

  const loadNotifications = async () => {
    if (!activeContext) {
      setNotificationFeed(null);
      return;
    }
    try {
      setNotificationFeed(await apiConsoleApi.getNotifications({ page: 1, limit: 15 }, activeContext));
    } catch {
      setNotificationFeed(null);
    }
  };

  const handleMarkNotificationRead = async (item: Notification) => {
    if (!activeContext || item.isRead) return;
    try {
      await apiConsoleApi.markNotificationRead(item.id, activeContext);
      await loadNotifications();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'خواندن اعلان ناموفق بود.');
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    if (!activeContext) return;
    try {
      await apiConsoleApi.markAllNotificationsRead(activeContext);
      await loadNotifications();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'خواندن همه اعلان‌ها ناموفق بود.');
    }
  };

  const refreshDerivedViews = async (
    request: ApiRequestDefinition,
    showLoading = false,
    preferredExecution: ApiRequestExecution | null = null,
  ) => {
    if (!activeContext) return;
    const requestSeq = ++derivedRequestSeqRef.current;
    if (showLoading) setDetailsLoading(true);
    try {
      const [effective, history, manual, bash, cmd, ps] = await Promise.all([
        apiConsoleApi.getEffectiveRequest(request.id, request.environmentId, request.executionMode, activeContext),
        apiConsoleApi.getExecutionHistory(request.id, activeContext, { fresh: Boolean(preferredExecution) }),
        apiConsoleApi.getManualResponses(request.id, activeContext),
        apiConsoleApi.exportCurl(request.id, 'bash', { context: activeContext }).catch(() => ''),
        apiConsoleApi.exportCurl(request.id, 'windows-cmd', { context: activeContext }).catch(() => ''),
        apiConsoleApi.exportCurl(request.id, 'powershell', { context: activeContext }).catch(() => ''),
      ]);
      if (requestSeq !== derivedRequestSeqRef.current) return;
      setEffectiveRequest(effective);
      const nextHistory = preferredExecution && !history.some(execution => execution.id === preferredExecution.id)
        ? [preferredExecution, ...history]
        : history;
      setHistoryRows(nextHistory);
      setManualResponses(manual);
      setExports({ bash, 'windows-cmd': cmd, powershell: ps });
      setSelectedExecution(preferredExecution || nextHistory[0] || null);
    } catch (error) {
      if (requestSeq !== derivedRequestSeqRef.current) return;
      toast.error(error instanceof Error ? error.message : 'بارگذاری جزئیات Request ناموفق بود.');
    } finally {
      if (requestSeq !== derivedRequestSeqRef.current) return;
      // A non-blocking refresh can supersede a loading refresh. The newest
      // request always owns the final loading state, regardless of how it began.
      setDetailsLoading(false);
      setSelectingRequestId(prev => prev === request.id ? null : prev);
    }
  };

  const reloadRequests = async (selectId?: string) => {
    if (!activeContext) return;
    const reloadSeq = ++reloadRequestsSeqRef.current;
    if (selectId) selectRequestSeqRef.current += 1;
    const response = await apiConsoleApi.getRequests(requestsScope, filters, activeContext);
    if (reloadSeq !== reloadRequestsSeqRef.current) return;
    setRequests(response);
    setKnownFolders(prev => {
      const next = new Set(prev);
      response.data.forEach(item => {
        const path = (item.folderPath || []).join('/');
        if (path) next.add(path);
      });
      return Array.from(next).sort((a, b) => a.localeCompare(b, 'fa'));
    });
    if (selectId) {
      const request = response.data.find(item => item.id === selectId) || await apiConsoleApi.getRequest(selectId, activeContext);
      if (reloadSeq !== reloadRequestsSeqRef.current) return;
      if (request) {
        setSelectingRequestId(request.id);
        setEffectiveRequest(null);
        setHistoryRows([]);
        setManualResponses([]);
        setSelectedExecution(null);
        setExports({ bash: '', 'windows-cmd': '', powershell: '' });
        suppressNextDerivedRefreshRef.current = derivedRequestKey(request);
        setSelectedRequest(cloneRequest(request));
        setSavedRequest(cloneRequest(request));
        setPageMode('editor');
        await refreshDerivedViews(request, true);
      }
    }
  };

  const runGlobalSearch = async () => {
    if (!activeContext || !globalSearchQuery.trim()) {
      setGlobalSearchHits([]);
      return;
    }
    setGlobalSearchLoading(true);
    try {
      const term = globalSearchQuery.trim();
      const [requestRows, repoRows, profiles] = await Promise.all([
        apiConsoleApi.getRequests(appId, { page: 1, limit: 20, search: term }, activeContext),
        apiConsoleApi.getRepository({ page: 1, limit: 10, search: term, applicationId: appId }, activeContext).catch(() => null),
        apiConsoleApi.getRuntimeProfiles(activeContext.applicationId, activeContext).catch(() => []),
      ]);
      const discovery = profiles[0]
        ? await apiConsoleApi.getLatestProjectDiscovery(activeContext.applicationId, activeContext).catch(() => null)
        : null;
      const discoveryHits = (discovery?.operations || [])
        .filter(op => [op.name, op.sourceId, op.path, op.moduleId].some(value => String(value || '').toLowerCase().includes(term.toLowerCase())))
        .slice(0, 10)
        .map(op => ({
          kind: 'discovery' as const,
          id: op.id,
          title: op.sourceId || op.name,
          subtitle: `${op.type} · ${op.path || op.moduleId || ''}`,
        }));
      setGlobalSearchHits([
        ...requestRows.data.map(item => ({
          kind: 'request' as const,
          id: item.id,
          title: item.name,
          subtitle: `${item.method} ${item.urlTemplate}${(item.folderPath || []).length ? ` · ${(item.folderPath || []).join('/')}` : ''}`,
        })),
        ...(repoRows?.data || []).map(item => ({
          kind: 'repository' as const,
          id: item.id,
          title: item.title,
          subtitle: `${item.apiId} @ ${item.version}`,
        })),
        ...discoveryHits,
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'جستجوی سراسری ناموفق بود.');
      setGlobalSearchHits([]);
    } finally {
      setGlobalSearchLoading(false);
    }
  };

  const moveRequestToFolder = async (request: ApiRequestDefinition, folderPath: string[]) => {
    if (!activeContext || !canEdit) return;
    try {
      const updated = await apiConsoleApi.updateRequest(request.id, { folderPath }, activeContext);
      if (updated) {
        toast.success('Folder Request به‌روز شد.');
        if ((folderPath || []).length) {
          setKnownFolders(prev => Array.from(new Set([...prev, folderPath.join('/')])).sort((a, b) => a.localeCompare(b, 'fa')));
        }
        await reloadRequests(selectedRequest?.id === request.id ? request.id : undefined);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'جابجایی Request ناموفق بود.');
    }
  };

  const createFolder = () => {
    const name = folderDraft.trim();
    if (!name) return;
    const path = name.split('/').map(part => part.trim()).filter(Boolean);
    if (!path.length) return;
    const key = path.join('/');
    setKnownFolders(prev => Array.from(new Set([...prev, key])).sort((a, b) => a.localeCompare(b, 'fa')));
    setFilters(prev => ({ ...prev, folderPath: key, page: 1 }));
    setFolderDraft('');
    toast.success(`Folder «${key}» آماده است. Requestها را به آن منتقل کنید.`);
  };

  const updateDraft = (updater: (request: ApiRequestDefinition) => ApiRequestDefinition) => {
    setSelectedRequest(prev => {
      if (!prev) return prev;
      const next = updater(cloneRequest(prev));
      next.classification = classifyDraft(next);
      return next;
    });
  };

  const handleSelectRequest = async (request: ApiRequestDefinition) => {
    if (selectingRequestId === request.id) return;
    const selectSeq = ++selectRequestSeqRef.current;
    setSelectingRequestId(request.id);
    setDetailsLoading(true);
    setEffectiveRequest(null);
    setHistoryRows([]);
    setManualResponses([]);
    setSelectedExecution(null);
    setExports({ bash: '', 'windows-cmd': '', powershell: '' });
    try {
      const fullRequest = activeContext ? await apiConsoleApi.getRequest(request.id, activeContext) : request;
      if (selectSeq !== selectRequestSeqRef.current) return;
      const next = fullRequest || request;
      setSelectedRequest(cloneRequest(next));
      setSavedRequest(cloneRequest(next));
      setActiveTab('params');
      setPageMode('editor');
    } catch (error) {
      if (selectSeq !== selectRequestSeqRef.current) return;
      toast.error(error instanceof Error ? error.message : 'باز کردن Request ناموفق بود.');
      setSelectingRequestId(null);
      setDetailsLoading(false);
    }
  };

  const openImportCurl = () => {
    setCurlText('');
    setCurlPreview(null);
    setImportTitle('');
    setImportCollectionId(filters.collectionId || '');
    setPreviewSubtab('summary');
    setCurlModalOpen(true);
  };

  const closeImportPostmanCollection = () => {
    if (postmanImporting) return;
    setPostmanModalOpen(false);
    setPostmanText('');
    setPostmanFileName('');
    setPostmanPreview(null);
  };

  const openImportPostmanCollection = () => {
    setPostmanText('');
    setPostmanFileName('');
    setPostmanPreview(null);
    setPostmanApplicationId(PERSONAL_APPLICATION_ID);
    setPostmanModalOpen(true);
  };

  const openCreateCollection = () => {
    setCollectionForm({
      applicationId: PERSONAL_APPLICATION_ID,
      name: '',
      description: '',
      bindMode: 'free',
    });
    setCollectionAdvancedOpen(false);
    setCollectionModalOpen(true);
  };

  const handlePostmanFileSelected = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setPostmanFileName(file.name);
      setPostmanText(text);
      setPostmanPreview(null);
    } catch {
      toast.error('خواندن فایل Postman Collection ناموفق بود.');
    }
  };

  const ensureCollectionForApplication = async (applicationId: string, preferredName?: string) => {
    if (!activeContext) throw new Error('نشست فعال نیست.');
    const name = preferredName
      || (applicationId === PERSONAL_APPLICATION_ID ? 'درخواست‌های آزاد' : `Collection ${applicationId}`);
    const existing = collections.find(collection =>
      collection.applicationId === applicationId
      && (preferredName
        ? collection.name.trim().toLowerCase() === preferredName.trim().toLowerCase()
        : true)
    ) || collections.find(collection => collection.applicationId === applicationId);
    if (existing) return existing;
    const collection = await apiConsoleApi.createCollection({
      applicationId,
      name,
      description: applicationId === PERSONAL_APPLICATION_ID
        ? 'درخواست‌های شخصی و HTTP عمومی (بدون الزام CDE)'
        : undefined,
    }, activeContext);
    setCollections(prev => [collection, ...prev]);
    return collection;
  };

  const handleNewRequest = async (preferredApplicationId?: string) => {
    if (!activeContext || !canCreate) return;
    const selectedCollection = filters.collectionId
      ? collections.find(collection => collection.id === filters.collectionId)
      : undefined;

    let targetCollection = selectedCollection;
    if (!targetCollection) {
      const applicationId = preferredApplicationId
        || filters.systemFilter
        || (filters.sourceApproach === 'FREE' ? PERSONAL_APPLICATION_ID : '')
        || initialApplicationIdForCreate
        || PERSONAL_APPLICATION_ID;
      try {
        targetCollection = await ensureCollectionForApplication(applicationId);
        setFilters(prev => ({ ...prev, collectionId: targetCollection!.id, systemFilter: applicationId === PERSONAL_APPLICATION_ID ? PERSONAL_APPLICATION_ID : prev.systemFilter, page: 1 }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ساخت Collection برای درخواست جدید ناموفق بود.');
        openCreateCollection();
        return;
      }
    }

    const folderPath = filters.folderPath && filters.folderPath !== '__root__'
      ? filters.folderPath.split('/').map(part => part.trim()).filter(Boolean)
      : [];
    try {
      const request = await apiConsoleApi.createBlankRequest(
        targetCollection.id,
        targetCollection.applicationId,
        environments[0]?.id || 'env-development',
        activeContext,
        folderPath,
      );
      toast.success(targetCollection.applicationId === PERSONAL_APPLICATION_ID
        ? 'درخواست آزاد ساخته شد — URL را مثل Postman تنظیم کنید.'
        : 'Request جدید ساخته شد.');
      await reloadRequests(request.id);
      setPageMode('editor');
      setWorkspaceView('requests');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ساخت Request ناموفق بود.');
    }
  };

  const handleParseCurl = async () => {
    if (!activeContext || !curlText.trim()) return;
    try {
      const preview = await apiConsoleApi.parseCurl(curlText, activeContext.userId, activeContext);
      setCurlPreview(preview);
      setPreviewSubtab('summary');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Parse کردن cURL ناموفق بود.');
    }
  };

  const handleParsePostmanCollection = async () => {
    if (!postmanText.trim()) return;
    try {
      const preview = parsePostmanCollectionImport(postmanText);
      if (activeContext) {
        try {
          const scan = await apiConsoleApi.secretScan(postmanText, activeContext);
          if (scan.findings?.length) {
            preview.warnings = [
              ...(preview.warnings || []),
              ...scan.findings.map(id => `Potential secret pattern detected: ${id}`),
            ];
            if (scan.mode === 'block') {
              toast.error('Secret در Collection شناسایی شد؛ Import مسدود است.');
              setPostmanPreview({ ...preview, requestCount: 0, requests: [] });
              return;
            }
            toast.warning('الگوی secret در Postman Collection پیدا شد؛ قبل از Import بررسی کنید.');
          }
        } catch (scanError) {
          if (scanError instanceof Error && /Secret patterns detected/i.test(scanError.message)) {
            toast.error(scanError.message);
            setPostmanPreview(null);
            return;
          }
        }
      }
      setPostmanPreview(preview);
      if (preview.requestCount) {
        toast.success(`${preview.requestCount} Request از Collection خوانده شد.`);
      } else {
        toast.warning('هیچ Request قابل import در Collection پیدا نشد.');
      }
    } catch (error) {
      setPostmanPreview(null);
      toast.error(error instanceof Error ? error.message : 'فرمت Postman Collection معتبر نیست.');
    }
  };

  const handleImportPostmanCollection = async () => {
    if (!activeContext || !postmanPreview || !postmanPreview.requestCount || !postmanApplicationId || !canCreate) return;
    setPostmanImporting(true);
    try {
      const baseName = postmanPreview.name.trim() || 'Imported Postman Collection';
      const existingNames = new Set(collections.map(collection => collection.name.trim().toLowerCase()));
      const collectionName = existingNames.has(baseName.toLowerCase())
        ? `${baseName} - Import ${new Date().toLocaleString('fa-IR')}`
        : baseName;
      const collection = await apiConsoleApi.createCollection({
        applicationId: postmanApplicationId,
        name: collectionName,
        description: postmanPreview.description || `Imported from ${postmanFileName || 'Postman Collection JSON'}`,
        variables: postmanPreview.variables,
      }, activeContext);
      const createdRequests: ApiRequestDefinition[] = [];
      for (const item of postmanPreview.requests) {
        const request = await apiConsoleApi.createRequest({
          name: item.name,
          ...(item.description ? { description: item.description } : {}),
          collectionId: collection.id,
          applicationId: collection.applicationId,
          environmentId: environments[0]?.id || 'env-development',
          folderPath: item.folderPath || [],
          normalizedRequest: item.normalizedRequest,
        }, activeContext);
        createdRequests.push(request);
      }
      setCollections(prev => [collection, ...prev.filter(item => item.id !== collection.id)]);
      setFilters(prev => ({ ...prev, collectionId: collection.id, page: 1 }));
      setPostmanModalOpen(false);
      setPostmanText('');
      setPostmanFileName('');
      setPostmanPreview(null);
      toast.success(`${createdRequests.length} Request از Postman Collection ایمپورت شد.`);
      await reloadRequests(createdRequests[0]?.id);
      if (createdRequests[0]) setPageMode('editor');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import کردن Postman Collection ناموفق بود.');
    } finally {
      setPostmanImporting(false);
    }
  };

  const handleImportPreview = async () => {
    if (!activeContext || !curlPreview) return;
    const selectedCollection = importCollectionId
      ? collections.find(collection => collection.id === importCollectionId)
      : undefined;
    if (!selectedCollection) {
      toast.warning('برای Import کردن cURL یک Collection مشخص انتخاب کنید؛ سامانه از همان Collection تعیین می‌شود.');
      return;
    }
    const collection = selectedCollection;
    const normalized = normalizedFromPreview(curlPreview);
    const request = await apiConsoleApi.createRequest({
      name: importTitle.trim() || `${normalized.method} ${new URL(normalized.url).pathname || normalized.url}`,
      collectionId: collection.id,
      applicationId: collection.applicationId,
      environmentId: environments[0]?.id || 'env-development',
      normalizedRequest: normalized,
      originalImportedCurl: curlPreview.originalCurl,
      importedCurlId: curlPreview.id,
    }, activeContext);
    setCurlModalOpen(false);
    setCurlText('');
    setCurlPreview(null);
    setImportTitle('');
    setImportCollectionId('');
    toast.success('cURL به عنوان Request ذخیره‌شده Import شد.');
    await reloadRequests(request.id);
    setPageMode('editor');
  };

  const openEditCurl = () => {
    if (!selectedRequest) return;
    setEditCurlText(selectedRequest.originalImportedCurl || exports.bash || '');
    setEditCurlPreview(null);
    setEditCurlPreviewSubtab('summary');
    setEditCurlModalOpen(true);
  };

  const handleParseEditCurl = async () => {
    if (!activeContext || !editCurlText.trim()) return;
    try {
      const preview = await apiConsoleApi.parseCurl(editCurlText, activeContext.userId, activeContext);
      setEditCurlPreview(preview);
      setEditCurlPreviewSubtab('summary');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Parse کردن cURL ناموفق بود.');
    }
  };

  const handleApplyEditedCurl = async () => {
    if (!activeContext || !selectedRequest || !editCurlPreview || !canEdit) return;
    setSaving(true);
    try {
      const patched = applyNormalizedToRequest(selectedRequest, editCurlPreview);
      const updated = await apiConsoleApi.updateRequest(selectedRequest.id, patched, activeContext);
      if (updated) {
        setSelectedRequest(cloneRequest(updated));
        setSavedRequest(cloneRequest(updated));
        setActiveTab('params');
        setEditCurlModalOpen(false);
        setEditCurlText('');
        setEditCurlPreview(null);
        toast.success('cURL و Request به‌روزرسانی شدند.');
        await reloadRequests(updated.id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'اعمال cURL روی Request ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const handleBackToList = async () => {
    setPageMode('list');
    await reloadRequests();
  };

  const handleCreateCollection = async () => {
    if (!activeContext || !canCreate || !collectionForm.name.trim()) return;
    const applicationId = collectionForm.bindMode === 'free'
      ? PERSONAL_APPLICATION_ID
      : collectionForm.applicationId;
    if (!applicationId || (collectionForm.bindMode === 'system' && applicationId === PERSONAL_APPLICATION_ID)) {
      toast.warning('برای Collection سامانه‌ای، یک سامانه انتخاب کنید.');
      return;
    }
    const normalizedName = collectionForm.name.trim().toLowerCase();
    const existingCollection = collections.find(collection =>
      collection.applicationId === applicationId
      && collection.name.trim().toLowerCase() === normalizedName
    );
    if (existingCollection) {
      setFilters(prev => ({ ...prev, collectionId: existingCollection.id, systemFilter: applicationId, page: 1 }));
      setImportCollectionId(existingCollection.id);
      setCollectionModalOpen(false);
      setCollectionForm({ applicationId: PERSONAL_APPLICATION_ID, name: '', description: '', bindMode: 'free' });
      toast.info('این Collection قبلاً وجود دارد و همان انتخاب شد.');
      return;
    }
    try {
      const collection = await apiConsoleApi.createCollection({
        applicationId,
        name: collectionForm.name.trim(),
        description: collectionForm.description.trim() || undefined,
      }, activeContext);
      setCollections(prev => [collection, ...prev]);
      setFilters(prev => ({ ...prev, collectionId: collection.id, systemFilter: applicationId, page: 1 }));
      setImportCollectionId(collection.id);
      setCollectionModalOpen(false);
      setCollectionForm({ applicationId: PERSONAL_APPLICATION_ID, name: '', description: '', bindMode: 'free' });
      toast.success('Collection جدید ساخته شد.');
      await reloadRequests();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ساخت Collection ناموفق بود.');
    }
  };

  const handleExportPostmanCollection = async (collectionId = filters.collectionId) => {
    if (!activeContext) return;
    if (!collectionId) {
      toast.warning('برای خروجی Postman ابتدا یک Collection انتخاب کنید.');
      return;
    }
    setExportingCollectionId(collectionId);
    try {
      const result = await apiConsoleApi.exportPostmanCollection(collectionId, activeContext);
      downloadJsonFile(result.collection, result.fileName);
      toast.success(`خروجی Postman با ${result.requestCount} Request آماده شد.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'خروجی Postman Collection ناموفق بود.');
    } finally {
      setExportingCollectionId(null);
    }
  };

  const handleExportCollectionOpenApi = async (collectionId = filters.collectionId) => {
    if (!collectionId) {
      toast.warning('برای خروجی OpenAPI ابتدا یک Collection انتخاب کنید.');
      return;
    }
    setExportingOpenApiId(collectionId);
    try {
      await apiConsoleApi.downloadCollectionOpenApi(collectionId);
      toast.success('خروجی OpenAPI آماده شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'خروجی OpenAPI ناموفق بود.');
    } finally {
      setExportingOpenApiId(null);
    }
  };

  const handleExportRepositoryOpenApi = async (apiId: string, version: string) => {
    setExportingOpenApiId(`${apiId}:${version}`);
    try {
      await apiConsoleApi.downloadRepositoryOpenApi(apiId, version);
      toast.success('خروجی OpenAPI Repository آماده شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'خروجی OpenAPI ناموفق بود.');
    } finally {
      setExportingOpenApiId(null);
    }
  };

  const handleCreateContractSuite = async (collectionId = filters.collectionId) => {
    if (!activeContext || !collectionId || !canEdit) return;
    setContractSuiteLoading(true);
    try {
      const result = await apiConsoleApi.createContractSuite({ collectionId }, activeContext);
      toast.success(`Contract Suite: ${result.assertionCount} assertion روی ${result.updatedRequests} Request اضافه شد.`);
      await reloadRequests(selectedRequest?.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ساخت Contract Suite ناموفق بود.');
    } finally {
      setContractSuiteLoading(false);
    }
  };

  const handleCreateMock = async () => {
    if (!activeContext || !selectedRequest || !canEdit) return;
    setCreatingMock(true);
    try {
      const mock = await apiConsoleApi.createMock({
        requestId: selectedRequest.id,
        environmentId: selectedRequest.environmentId,
      }, activeContext);
      toast.success(`Mock ساخته شد: ${apiConsoleApi.mockServeUrl(mock.id)}`);
      setWorkspaceView('mocks');
      setPageMode('list');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ساخت Mock ناموفق بود.');
    } finally {
      setCreatingMock(false);
    }
  };

  const handleConfirmSoftDelete = async () => {
    if (!activeContext || !deleteTarget || !canDelete) return;
    try {
      await apiConsoleApi.archiveRequest(deleteTarget.id, activeContext);
      toast.success('Request حذف شد.');
      if (selectedRequest?.id === deleteTarget.id) {
        setSelectedRequest(null);
        setSavedRequest(null);
        setPageMode('list');
      }
      setDeleteTarget(null);
      await reloadRequests();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'حذف Request ناموفق بود.');
    }
  };

  const handleSave = async () => {
    if (!activeContext || !selectedRequest || !canEdit) return;
    setSaving(true);
    try {
      const updated = await apiConsoleApi.updateRequest(selectedRequest.id, selectedRequest, activeContext);
      if (updated) {
        setSelectedRequest(cloneRequest(updated));
        setSavedRequest(cloneRequest(updated));
        toast.success('Request ذخیره شد.');
        await reloadRequests(updated.id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ذخیره درخواست ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const executeSelected = async (options?: { productionCommandConfirmed?: boolean; businessJustification?: string }) => {
    if (!activeContext || !selectedRequest || !canExecute) return;
    setExecuting(true);
    try {
      let requestToExecute = selectedRequest;
      if (hasUnsavedChanges) {
        const saved = await apiConsoleApi.updateRequest(selectedRequest.id, selectedRequest, activeContext);
        if (saved) {
          requestToExecute = saved;
          setSelectedRequest(cloneRequest(saved));
          setSavedRequest(cloneRequest(saved));
        }
      }
      const executionOptions = {
        environmentId: requestToExecute.environmentId,
        executionMode: requestToExecute.executionMode,
        ...(options?.productionCommandConfirmed === undefined ? {} : { productionCommandConfirmed: options.productionCommandConfirmed }),
        ...(options?.businessJustification === undefined ? {} : { businessJustification: options.businessJustification }),
      };
      const execution = await apiConsoleApi.executeRequest(requestToExecute.id, activeContext, executionOptions);
      setSelectedExecution(execution);
      setDetailsLoading(false);
      setActiveTab('response');
      await refreshDerivedViews(requestToExecute, false, execution);
      if (execution.transportResult === 'SUCCESS') {
        toast.success('Request اجرا شد.');
      } else {
        toast.warning(execution.sanitizedError || 'Execution با warning تمام شد.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Execution ناموفق بود.');
    } finally {
      setExecuting(false);
      setProductionModalOpen(false);
      setProductionForm({ confirmed: false, reason: '' });
    }
  };

  const handleSend = () => {
    if (!selectedRequest || !selectedEnvironment) return;
    if (selectedRequest.classification.type === 'CORE_COMMAND' && (selectedRequest.runtimeBinding?.runtimeProfileId || selectedEnvironment.kind === 'PRODUCTION') && selectedRequest.sourceType !== 'IS_DISCOVERY' && !selectedRequest.isGatewayBinding) {
      setProductionModalOpen(true);
      return;
    }
    executeSelected();
  };

  const handleDisableTlsAndRetry = async () => {
    if (!activeContext || !selectedRequest || !canEdit || !canExecute) return;
    if (selectedEnvironment?.kind === 'PRODUCTION') {
      toast.warning('Insecure TLS برای Production مجاز نیست.');
      return;
    }
    setExecuting(true);
    try {
      const patched: ApiRequestDefinition = {
        ...cloneRequest(selectedRequest),
        tls: {
          ...selectedRequest.tls,
          verifyCertificate: false,
        },
      };
      const saved = await apiConsoleApi.updateRequest(patched.id, patched, activeContext);
      if (!saved) return;
      setSelectedRequest(cloneRequest(saved));
      setSavedRequest(cloneRequest(saved));
      const execution = await apiConsoleApi.executeRequest(saved.id, activeContext, {
        environmentId: saved.environmentId,
        executionMode: saved.executionMode,
      });
      setSelectedExecution(execution);
      setDetailsLoading(false);
      setActiveTab('response');
      await refreshDerivedViews(saved, false, execution);
      if (execution.transportResult === 'SUCCESS') {
        toast.success('Request با Verify TLS certificate خاموش اجرا شد.');
      } else {
        toast.warning(execution.sanitizedError || 'Execution با warning تمام شد.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Retry با Insecure TLS ناموفق بود.');
    } finally {
      setExecuting(false);
    }
  };

  const handleRefreshDocumentation = async () => {
    if (!activeContext || !selectedRequest || !canEdit) return;
    setDocumentationRefreshing(true);
    try {
      let current = selectedRequest;
      if (hasUnsavedChanges) {
        const saved = await apiConsoleApi.updateRequest(selectedRequest.id, selectedRequest, activeContext);
        if (saved) current = saved;
      }
      const refreshed = await apiConsoleApi.refreshDocumentationMetadata(current.id, activeContext);
      setSelectedRequest(cloneRequest(refreshed));
      setSavedRequest(cloneRequest(refreshed));
      toast.success('فیلدهای مستندات از Request و آخرین Response به‌روزرسانی شدند.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'به‌روزرسانی اطلاعات مستندات ناموفق بود.');
    } finally {
      setDocumentationRefreshing(false);
    }
  };

  const handleGenerateDocs = async (final = false) => {
    if (!activeContext || !selectedRequest || !canDocument) return;
    try {
      let requestForDocument = selectedRequest;
      if (hasUnsavedChanges && canEdit) {
        const saved = await apiConsoleApi.updateRequest(selectedRequest.id, selectedRequest, activeContext);
        if (saved) {
          requestForDocument = saved;
          setSelectedRequest(cloneRequest(saved));
          setSavedRequest(cloneRequest(saved));
        }
      }
      const result = final
        ? await apiConsoleApi.generateDocumentationFinal(requestForDocument.id, activeContext, docLanguage)
        : await apiConsoleApi.generateDocumentationPreview(requestForDocument.id, activeContext);
      if (final) {
        if (result.wordDocumentBase64) {
          downloadBase64File(
            result.wordDocumentBase64,
            result.wordFileName || `${safeFileName(requestForDocument.name)}.docx`,
            result.wordMimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          );
        } else {
          downloadWordDocument(result.markdown, result.requestId ? requestForDocument.name : 'api-document');
        }
        toast.success(`سند نهایی Word (${docLanguage}) بر اساس template تولید شد.`);
        return;
      }
      setDocumentation(result.markdown);
      setDocumentationWarnings(result.warnings);
      setDocsModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ساخت Documentation ناموفق بود.');
    }
  };

  const handleManualResponse = async () => {
    if (!activeContext || !selectedRequest) return;
    try {
      await apiConsoleApi.addManualResponse(selectedRequest.id, {
        ...manualForm,
        claimedEnvironmentId: selectedRequest.environmentId,
      }, activeContext);
      setManualModalOpen(false);
      setManualForm({ statusCode: 200, headersText: 'content-type: application/json', body: '{\n  "ok": true\n}', source: '', reason: '' });
      toast.success('Manual response example ذخیره شد.');
      await refreshDerivedViews(selectedRequest);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ذخیره Manual response ناموفق بود.');
    }
  };

  const openShareModal = (request: ApiRequestDefinition) => {
    setShareTarget(request);
    setShareForm({
      purpose: '',
      introduction: '',
      description: request.latestReturnReason ? `دلیل بازگردانی قبلی: ${request.latestReturnReason}` : '',
      ticketId: request.ticketId || '',
      ticketUrl: request.ticketUrl || '',
    });
    setShareModalOpen(true);
  };

  const handleShareSubmit = () => {
    if (!shareForm.purpose.trim() || !shareForm.introduction.trim() || !shareForm.description.trim()) {
      toast.warning('هدف، مقدمه و توضیحات برای اشتراک API الزامی است.');
      return;
    }
    setShareConfirmOpen(true);
  };

  const handleConfirmShare = async () => {
    if (!activeContext || !shareTarget) return;
    setSharing(true);
    try {
      await apiConsoleApi.shareRequest(shareTarget.id, shareForm, activeContext);
      toast.success('درخواست اشتراک API با موفقیت ارسال شد.');
      setShareConfirmOpen(false);
      setShareModalOpen(false);
      setShareTarget(null);
      setShareForm({ purpose: '', introduction: '', description: '', ticketId: '', ticketUrl: '' });
      await Promise.all([reloadRequests(shareTarget.id), loadShareReviews(), loadRepository()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ارسال درخواست اشتراک API ناموفق بود.');
    } finally {
      setSharing(false);
    }
  };

  const openRepositoryDetail = async (item: ApiRepositoryItem) => {
    if (!activeContext) return;
    setRepositoryModalOpen(true);
    setRepositoryDetail(item);
    setRepositoryConsumerEditMode(false);
    setRepositoryConsumerIds(item.consumers.map(consumerIdOf));
    try {
      const [detail, candidates] = await Promise.all([
        apiConsoleApi.getRepositoryVersion(item.apiId, item.version, activeContext),
        apiConsoleApi.getConsumerCandidates(activeContext),
      ]);
      setRepositoryDetail(detail);
      setConsumerCandidates(candidates);
      setRepositoryConsumerIds(detail.consumers.map(consumerIdOf));
      if (detail.isNewForUser) {
        await apiConsoleApi.markRepositoryVersionViewed(detail.apiId, detail.version, activeContext);
        await loadRepository();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری جزئیات Repository ناموفق بود.');
    }
  };

  const handleAddRepositoryVersion = async () => {
    if (!activeContext || !repositoryDetail) return;
    if (repositoryDetail.sharingStatus === 'DEPRECATED') {
      toast.warning('نسخه منسوخ‌شده را نمی‌توان به Console اضافه کرد.');
      return;
    }
    try {
      const result = await apiConsoleApi.addRepositoryVersionToConsole(
        repositoryDetail.apiId,
        repositoryDetail.version,
        collections[0]?.id,
        activeContext
      );
      toast.success('Reference این API به Online API Console شما اضافه شد.');
      setRepositoryModalOpen(false);
      setRepositoryDetail(null);
      setWorkspaceView('requests');
      await Promise.all([reloadRequests(result.request.id), loadRepository()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'افزودن API به Console ناموفق بود.');
    }
  };

  const openReviewDetail = async (share: ApiShareRequest) => {
    if (!activeContext) return;
    setReviewModalOpen(true);
    setReviewDetail(share);
    setReviewTicketForm({ ticketId: share.ticketId || '', ticketUrl: share.ticketUrl || '' });
    setSelectedConsumerIds([]);
    setReviewCommentText('');
    setReviewChecklist({
      ...EMPTY_REVIEW_CHECKLIST,
      ...(share.checklist || {}),
      consumersSpecified: (share.consumers || []).length > 0 || share.checklist?.consumersSpecified === true,
    });
    try {
      const [detail, candidates] = await Promise.all([
        apiConsoleApi.getShareReview(share.id, activeContext),
        apiConsoleApi.getConsumerCandidates(activeContext),
      ]);
      setReviewDetail(detail);
      setReviewTicketForm({ ticketId: detail.ticketId || '', ticketUrl: detail.ticketUrl || '' });
      setConsumerCandidates(candidates);
      setSelectedConsumerIds((detail.consumers || []).map(consumer =>
        consumer.consumerType === 'USER' ? `USER:${consumer.userId}` : `ROLE:${consumer.roleKey}`
      ));
      setReviewChecklist({
        ...EMPTY_REVIEW_CHECKLIST,
        ...(detail.checklist || {}),
        consumersSpecified: (detail.consumers || []).length > 0 || detail.checklist?.consumersSpecified === true,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری جزئیات درخواست اشتراک ناموفق بود.');
    }
  };

  const handleSaveReviewTicket = async () => {
    if (!activeContext || !reviewDetail) return;
    setReviewTicketSaving(true);
    try {
      const updated = await apiConsoleApi.updateShareReviewTicket(reviewDetail.id, {
        ticketId: reviewTicketForm.ticketId.trim() || undefined,
        ticketUrl: reviewTicketForm.ticketUrl.trim() || undefined,
      }, activeContext);
      setReviewDetail(updated);
      setReviewTicketForm({ ticketId: updated.ticketId || '', ticketUrl: updated.ticketUrl || '' });
      toast.success('اطلاعات Ticket ذخیره شد.');
      await loadShareReviews();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ذخیره Ticket ناموفق بود.');
    } finally {
      setReviewTicketSaving(false);
    }
  };

  const consumersFromCandidateIds = (
    ids: string[],
    target: Pick<ApiRepositoryItem | ApiShareRequest, 'apiId' | 'version' | 'applicationId'>
  ): ApiVersionConsumer[] => {
    if (!activeContext) return [];
    return consumerCandidates
      .filter(candidate => ids.includes(candidate.id))
      .map(candidate => ({
        id: '',
        apiId: target.apiId,
        version: target.version,
        consumerType: candidate.consumerType,
        userId: candidate.userId,
        roleKey: candidate.roleKey,
        applicationId: candidate.applicationId || target.applicationId,
        status: 'ACTIVE',
        createdBy: activeContext.userId,
        createdAt: new Date().toISOString(),
      }));
  };

  const selectedConsumers = (): ApiVersionConsumer[] => {
    if (!reviewDetail) return [];
    return consumersFromCandidateIds(selectedConsumerIds, reviewDetail);
  };

  const handleRepositoryConsumersSave = async () => {
    if (!activeContext || !repositoryDetail) return;
    const consumers = consumersFromCandidateIds(repositoryConsumerIds, repositoryDetail);
    if (!consumers.length) {
      toast.warning('انتخاب حداقل یک مصرف‌کننده الزامی است.');
      return;
    }
    setRepositoryConsumersSaving(true);
    try {
      const updatedConsumers = await apiConsoleApi.updateConsumers(
        repositoryDetail.apiId,
        repositoryDetail.version,
        consumers,
        activeContext
      );
      setRepositoryDetail(prev => prev ? { ...prev, consumers: updatedConsumers } : prev);
      setRepositoryRows(prev => prev ? {
        ...prev,
        data: prev.data.map(item =>
          item.id === repositoryDetail.id ? { ...item, consumers: updatedConsumers } : item
        ),
      } : prev);
      setRepositoryConsumerIds(updatedConsumers.map(consumerIdOf));
      setRepositoryConsumerEditMode(false);
      toast.success('دسترسی مصرف‌کنندگان API به‌روزرسانی شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'به‌روزرسانی مصرف‌کنندگان API ناموفق بود.');
    } finally {
      setRepositoryConsumersSaving(false);
    }
  };

  const handleApproveReview = async () => {
    if (!activeContext || !reviewDetail) return;
    const consumers = selectedConsumers();
    if (!consumers.length) {
      toast.warning('انتخاب حداقل یک Consumer الزامی است.');
      return;
    }
    const checklist: ApiReviewChecklist = {
      ...reviewChecklist,
      consumersSpecified: true,
    };
    if (!REVIEW_CHECKLIST_LABELS.every(item => checklist[item.key])) {
      toast.warning('تأیید بدون تکمیل چک‌لیست Review ممکن نیست.');
      return;
    }
    setReviewActionLoading(true);
    try {
      await apiConsoleApi.approveShareReview(reviewDetail.id, consumers, reviewDetail.rowVersion, activeContext, checklist);
      toast.success('درخواست اشتراک API تأیید شد و در Repository منتشر شد.');
      setApproveModalOpen(false);
      setReviewModalOpen(false);
      setReviewDetail(null);
      await Promise.all([loadShareReviews(), reloadRequests(), loadRepository()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تأیید درخواست ناموفق بود.');
    } finally {
      setReviewActionLoading(false);
    }
  };

  const handleReturnReview = async () => {
    if (!activeContext || !reviewDetail) return;
    if (!returnReason.trim()) {
      toast.warning('دلیل بازگردانی الزامی است.');
      return;
    }
    setReviewActionLoading(true);
    try {
      await apiConsoleApi.returnShareReview(reviewDetail.id, returnReason, reviewDetail.rowVersion, activeContext);
      toast.success('درخواست اشتراک API بازگردانده شد.');
      setReturnModalOpen(false);
      setReviewModalOpen(false);
      setReviewDetail(null);
      setReturnReason('');
      await Promise.all([loadShareReviews(), reloadRequests(), loadRepository()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بازگردانی درخواست ناموفق بود.');
    } finally {
      setReviewActionLoading(false);
    }
  };

  const handleCreateVersion = async () => {
    if (!activeContext || !selectedRequest) return;
    if (!versionForm.version.trim() || !versionForm.changeLog.trim()) {
      toast.warning('Version جدید و Change Log الزامی هستند.');
      return;
    }
    if (versionForm.breakingChange && !versionForm.migrationNote.trim()) {
      toast.warning('برای Breaking Change، Migration Note الزامی است.');
      return;
    }
    setVersioning(true);
    try {
      const created = await apiConsoleApi.createVersion(selectedRequest.id, {
        version: versionForm.version.trim(),
        changeLog: versionForm.changeLog.trim(),
        breakingChange: versionForm.breakingChange,
        migrationNote: versionForm.migrationNote.trim() || undefined,
      }, activeContext);
      toast.success('Version جدید API ساخته شد و برای انتشار باید ارسال شود.');
      setVersionModalOpen(false);
      setVersionForm({ version: '', changeLog: '', breakingChange: false, migrationNote: '' });
      await reloadRequests(created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ساخت Version جدید ناموفق بود.');
    } finally {
      setVersioning(false);
    }
  };

  const handleCollectionRun = async () => {
    if (!activeContext || !filters.collectionId) return;
    setCollectionRunning(true);
    try {
      const result = await apiConsoleApi.runCollection(filters.collectionId, {
        stopOnFail: collectionRunStopOnFail,
        environmentId: selectedEnvironment?.id,
      }, activeContext);
      setLatestCollectionRun(result);
      toast.success(`اجرای Collection: ${result.summary.passed} موفق، ${result.summary.failed} ناموفق`);
      await loadRecentTestRuns(filters.collectionId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'اجرای Collection ناموفق بود.');
    } finally {
      setCollectionRunning(false);
    }
  };

  const openCollectionRunModal = async () => {
    if (!filters.collectionId) {
      toast.warning('ابتدا یک Collection انتخاب کنید.');
      return;
    }
    setLatestCollectionRun(null);
    setCollectionRunStopOnFail(true);
    setCollectionRunModalOpen(true);
    await loadRecentTestRuns(filters.collectionId);
  };

  const handleRequestVisibilityChange = async (visibility: ApiVisibility) => {
    if (!activeContext || !selectedRequest) return;
    setOwnershipSaving(true);
    try {
      const updated = await apiConsoleApi.updateRequestVisibility(selectedRequest.id, visibility, activeContext);
      setSelectedRequest(updated);
      setSavedRequest(updated);
      toast.success(visibility === 'PROJECT_SHARED' ? 'Visibility روی Project Shared تنظیم شد.' : 'Visibility روی Private تنظیم شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تغییر Visibility ناموفق بود.');
    } finally {
      setOwnershipSaving(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!activeContext || !selectedRequest) return;
    if (!ownershipTransferUserId.trim()) {
      toast.warning('شناسه کاربر مقصد الزامی است.');
      return;
    }
    setOwnershipSaving(true);
    try {
      const updated = await apiConsoleApi.transferRequestOwnership(selectedRequest.id, ownershipTransferUserId.trim(), activeContext);
      setSelectedRequest(updated);
      setSavedRequest(updated);
      setOwnershipTransferUserId('');
      toast.success('مالکیت Request منتقل شد.');
      await reloadRequests(updated.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'انتقال مالکیت ناموفق بود.');
    } finally {
      setOwnershipSaving(false);
    }
  };

  const handleSaveCoOwners = async () => {
    if (!activeContext || !selectedRequest) return;
    const coOwnerIds = coOwnersInput.split(',').map(item => item.trim()).filter(Boolean);
    setOwnershipSaving(true);
    try {
      const updated = await apiConsoleApi.setRequestCoOwners(selectedRequest.id, coOwnerIds, activeContext);
      setSelectedRequest(updated);
      setSavedRequest(updated);
      setCoOwnersInput((updated.coOwnerIds || []).join(', '));
      toast.success('لیست Co-ownerها ذخیره شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ذخیره Co-ownerها ناموفق بود.');
    } finally {
      setOwnershipSaving(false);
    }
  };

  const handleAddReviewComment = async () => {
    if (!activeContext || !reviewDetail) return;
    if (!reviewCommentText.trim()) {
      toast.warning('متن نظر الزامی است.');
      return;
    }
    setReviewCommentSaving(true);
    try {
      const updated = await apiConsoleApi.addShareReviewComment(reviewDetail.id, reviewCommentText.trim(), activeContext);
      setReviewDetail(updated);
      setReviewCommentText('');
      toast.success('نظر ثبت شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ثبت نظر ناموفق بود.');
    } finally {
      setReviewCommentSaving(false);
    }
  };

  const handleReviewChecklistChange = async (patch: Partial<ApiReviewChecklist>) => {
    if (!activeContext || !reviewDetail) return;
    const next = { ...reviewChecklist, ...patch };
    setReviewChecklist(next);
    try {
      const updated = await apiConsoleApi.updateShareReviewChecklist(reviewDetail.id, next, activeContext);
      setReviewDetail(updated);
      setReviewChecklist({ ...EMPTY_REVIEW_CHECKLIST, ...(updated.checklist || next) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ذخیره چک‌لیست ناموفق بود.');
    }
  };

  const handleDeprecateVersion = async () => {
    if (!activeContext || !repositoryDetail) return;
    if (!deprecateForm.reason.trim()) {
      toast.warning('دلیل منسوخ‌سازی الزامی است.');
      return;
    }
    setDeprecating(true);
    try {
      await apiConsoleApi.deprecateRepositoryVersion(
        repositoryDetail.apiId,
        repositoryDetail.version,
        {
          reason: deprecateForm.reason.trim(),
          effectiveAt: deprecateForm.effectiveAt.trim() || undefined,
        },
        activeContext
      );
      toast.success('نسخه API منسوخ شد.');
      setDeprecateModalOpen(false);
      setDeprecateForm({ reason: '', effectiveAt: '' });
      setRepositoryModalOpen(false);
      setRepositoryDetail(null);
      await loadRepository();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'منسوخ‌سازی نسخه ناموفق بود.');
    } finally {
      setDeprecating(false);
    }
  };

  const runSelfCheck = async () => {
    const result = await apiConsoleApi.runParserSelfCheck();
    setSelfCheck(result);
    setSelfCheckOpen(true);
  };

  const updateCoreBody = (patch: Record<string, unknown>) => {
    updateDraft(request => {
      const parsed = parseJson(request.bodyTemplate);
      const body = parsed.ok && typeof parsed.value === 'object' && parsed.value !== null ? parsed.value : {};
      const nextBody = { ...body, ...patch };
      request.bodyType = 'json';
      request.method = 'POST';
      request.bodyTemplate = JSON.stringify(nextBody, null, 2);
      return request;
    });
  };

  const updateCorePayload = (field: 'data' | 'params', raw: string) => {
    const parsed = parseJson(raw);
    updateCoreBody({ [field]: parsed.ok ? parsed.value : raw });
  };

  if (!activeContext) return null;

  const canUpdateRepositoryConsumers = !!repositoryDetail && activeContext.role === 'SYSTEM_ADMIN';

  const stats = {
    total: requests?.total || 0,
    coreQuery: requests?.data.filter(request => request.classification.type === 'CORE_QUERY').length || 0,
    coreCommand: requests?.data.filter(request => request.classification.type === 'CORE_COMMAND').length || 0,
    history: historyRows.length,
    approved: requests?.data.filter(request => request.sharingStatus === 'APPROVED').length || 0,
    pendingReview: shareReviews?.total || 0,
  };

  const requestColumns = [
    {
      key: 'name',
      title: 'Request',
      render: (item: ApiRequestDefinition) => (
        <div>
          <div
            draggable={canEdit}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/request-id', item.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
          >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default" size="sm">{item.method}</Badge>
            <span className="font-medium text-gray-900">{item.name}</span>
            {item.sourceType === 'CDE_DISCOVERY' && <Badge variant="info" size="sm">CDE</Badge>}
            {item.applicationId === PERSONAL_APPLICATION_ID && <Badge variant="success" size="sm">آزاد</Badge>}
            {item.sourceSync?.status === 'STALE' && <Badge variant="danger" size="sm">STALE</Badge>}
            {item.sourceSync?.status === 'CONFLICT' && <Badge variant="warning" size="sm">Conflict</Badge>}
            {item.latestReturnReason && <Badge variant="danger" size="sm">بازگردانی</Badge>}
            {selectingRequestId === item.id && (
              <MinimalLoader size="xs" className="text-blue-600" />
            )}
          </div>
          <p className="mt-1 max-w-[28rem] truncate text-left font-mono text-xs text-gray-500" dir="ltr">
            {item.urlTemplate}
          </p>
          {(item.folderPath || []).length > 0 && (
            <p className="mt-1 text-xs text-gray-500" dir="ltr">{(item.folderPath || []).join(' / ')}</p>
          )}
          </div>
        </div>
      ),
    },
    {
      key: 'folder',
      title: 'Folder',
      render: (item: ApiRequestDefinition) => (
        <select
          className="max-w-[10rem] rounded border border-gray-300 px-2 py-1 text-xs"
          value={(item.folderPath || []).join('/')}
          disabled={!canEdit}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const value = event.target.value;
            void moveRequestToFolder(item, value ? value.split('/').filter(Boolean) : []);
          }}
        >
          <option value="">(root)</option>
          {knownFolders.map(folder => (
            <option key={folder} value={folder}>{folder}</option>
          ))}
        </select>
      ),
    },
    {
      key: 'applicationId',
      title: 'سامانه',
      render: (item: ApiRequestDefinition) => (
        <span className="text-xs text-gray-700">
          {item.applicationId === PERSONAL_APPLICATION_ID
            ? PERSONAL_APPLICATION_LABEL
            : getApplicationName(item.applicationId)}
        </span>
      ),
    },
    {
      key: 'sharingStatus',
      title: 'وضعیت',
      render: (item: ApiRequestDefinition) => (
        <Badge variant={sharingBadgeVariant(item.sharingStatus)} size="sm">
          {API_SHARING_STATUS_LABELS[item.sharingStatus || 'DRAFT']}
        </Badge>
      ),
    },
    {
      key: 'updatedAt',
      title: 'آخرین تغییر',
      render: (item: ApiRequestDefinition) => <span className="text-xs text-gray-500">{formatDate(item.updatedAt)}</span>,
    },
    {
      key: 'actions',
      title: 'عملیات',
      className: 'w-px whitespace-nowrap',
      render: (item: ApiRequestDefinition) => (
        <div className="flex flex-nowrap justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          {item.sourceType !== 'REFERENCE' && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Upload className="h-4 w-4" />}
              disabled={!canEdit || item.sharingStatus === 'PENDING_REVIEW' || item.sharingStatus === 'APPROVED'}
              onClick={() => openShareModal(item)}
            >
              اشتراک
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="h-4 w-4" />}
            disabled={!canDelete}
            onClick={() => setDeleteTarget(item)}
          >
            حذف
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
    <AppShell
      activeView={workspaceView}
      onNavigate={(id: WorkspaceNavId) => {
        goWorkspace(id);
      }}
      navGroups={navGroups}
      mobileOpen={mobileNavOpen}
      onMobileClose={() => setMobileNavOpen(false)}
      topBar={(
      <Header
        title={pageMode === 'editor' ? (selectedRequest?.name || 'ویرایش درخواست') : workspaceTitle}
        subtitle={undefined}
        onRefresh={loadAll}
        refreshing={loading}
        onMenuClick={() => setMobileNavOpen(true)}
        menuExtras={canManageGeneralSettings ? (
          <HeaderMenuItem icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={runSelfCheck}>
            Self-check
          </HeaderMenuItem>
        ) : undefined}
        actions={(
          <div className="relative flex items-center gap-0.5">
            <HeaderIconButton label="جستجوی سراسری (Ctrl+K)" onClick={() => setGlobalSearchOpen(true)}>
              <Search className="h-4 w-4" />
            </HeaderIconButton>

            <div className="relative">
              <HeaderIconButton
                label="اعلان‌ها"
                onClick={() => {
                  setNotificationsOpen(open => !open);
                  void loadNotifications();
                }}
              >
                <span className="relative inline-flex">
                  <Bell className="h-4 w-4" />
                  {(notificationFeed?.unreadCount || 0) > 0 ? (
                    <span className="absolute -left-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--theme-danger)] px-0.5 text-[9px] font-semibold text-white">
                      {(notificationFeed?.unreadCount || 0) > 9 ? '9+' : notificationFeed?.unreadCount}
                    </span>
                  ) : null}
                </span>
              </HeaderIconButton>
              {notificationsOpen && (
                <div className="absolute left-0 z-30 mt-2 w-80 rounded-[var(--theme-radius)] border border-[var(--theme-border)] bg-[var(--theme-surface-raised)] p-2 shadow-lg sm:left-auto sm:right-0">
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <p className="text-sm font-medium text-[var(--theme-text)]">صندوق اعلان</p>
                    <Button size="sm" variant="ghost" onClick={() => { void handleMarkAllNotificationsRead(); }}>
                      همه خوانده
                    </Button>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-auto">
                    {(notificationFeed?.data || []).length === 0 ? (
                      <p className="px-2 py-4 text-center text-xs text-[var(--theme-text-subtle)]">اعلانی نیست</p>
                    ) : (
                      (notificationFeed?.data || []).map(item => (
                        <button
                          key={item.id}
                          type="button"
                          className={`w-full rounded-md border px-2 py-2 text-right text-xs ${item.isRead ? 'border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-muted)]' : 'border-[var(--theme-accent)]/25 bg-[var(--theme-accent-soft)] text-[var(--theme-text)]'}`}
                          onClick={() => { void handleMarkNotificationRead(item); }}
                        >
                          <p className="font-medium">{item.title}</p>
                          <p className="mt-1 text-[var(--theme-text-muted)]">{item.message}</p>
                          <p className="mt-1 font-mono text-[10px] text-[var(--theme-text-subtle)]" dir="ltr">{item.createdAt}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              title={runtimeConnected ? 'Runtime متصل — رفتن به Runtime' : 'Runtime قطع — رفتن به Runtime'}
              aria-label={runtimeConnected ? 'Runtime متصل' : 'Runtime قطع'}
              onClick={() => {
                setPageMode('list');
                setWorkspaceView('runtime');
              }}
              className={`ms-1 inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition-colors ${
                runtimeConnected
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400'
                  : 'border-[var(--theme-border)] bg-[var(--theme-surface-muted)] text-[var(--theme-text-subtle)] hover:bg-[var(--theme-surface-subtle)]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${runtimeConnected ? 'bg-emerald-500' : 'bg-[var(--theme-danger)]'}`} />
              <span className="hidden sm:inline">Runtime</span>
            </button>
          </div>
        )}
      />
      )}
    >
      <main className={pageMode === 'list' && workspaceView === 'requests' ? 'ac-workspace-fill' : 'min-h-0 min-w-0 max-w-full'}>
        {pageMode === 'list' ? (
          <section className={workspaceView === 'requests' ? 'ac-workspace-fill animate-fadeIn' : 'min-w-0 space-y-3 animate-fadeIn'}>
            {workspaceView === 'requests' && (
              <>
            <Card padding="sm" className="shrink-0">
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] flex-[1.6]">
                    <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--theme-text-subtle)]" />
                    <Input
                      aria-label="جستجوی Request"
                      value={filters.search}
                      onChange={(event) => setFilters(prev => ({ ...prev, search: event.target.value, page: 1 }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void reloadRequests();
                      }}
                      placeholder="جستجو: نام یا URL…"
                      className="py-1.5 ps-8 text-sm"
                    />
                  </div>
                  <div className="min-w-[160px] flex-1">
                    <ApplicationSelect
                      label="فیلتر سامانه"
                      value={filters.systemFilter}
                      onChange={(systemFilter) => setFilters(prev => ({ ...prev, systemFilter, collectionId: '', page: 1 }))}
                      includeEmptyOption
                      emptyOptionLabel="همه"
                      includePersonalOption
                      personalOptionLabel={PERSONAL_APPLICATION_LABEL}
                      size="sm"
                      clearable
                      className="[&_label]:sr-only"
                      placeholder="همه سامانه‌ها"
                      searchPlaceholder="جستجوی سامانه…"
                    />
                  </div>
                  <div className="min-w-[150px] flex-1">
                    <Select
                      aria-label="Collection"
                      value={filters.collectionId}
                      onChange={(event) => setFilters(prev => ({ ...prev, collectionId: event.target.value, folderPath: '', page: 1 }))}
                      className="py-1.5 text-sm"
                      options={[
                        { value: '', label: 'همه Collectionها' },
                        ...collections
                          .filter(collection => !filters.systemFilter || collection.applicationId === filters.systemFilter)
                          .map(collection => ({
                            value: collection.id,
                            label: collection.name,
                          })),
                      ]}
                    />
                  </div>
                  <div className="relative ms-auto flex flex-wrap items-center justify-end gap-1.5">
                    <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => void handleNewRequest()} disabled={!canCreate}>
                      درخواست جدید
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<PlayCircle className="h-4 w-4" />}
                      onClick={() => void openCollectionRunModal()}
                      disabled={!filters.collectionId || !canExecute}
                      className="hidden sm:inline-flex"
                    >
                      اجرای Collection
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setRequestsMoreOpen(open => !open)} aria-expanded={requestsMoreOpen}>
                      بیشتر
                    </Button>
                    {requestsMoreOpen ? (
                      <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-[var(--theme-radius)] border border-[var(--theme-border)] bg-[var(--theme-surface-raised)] p-1 shadow-lg">
                        <button type="button" className="ac-nav-item !text-[var(--theme-text-muted)] hover:!bg-[var(--theme-surface-muted)] sm:hidden" disabled={!filters.collectionId || !canExecute} onClick={() => { setRequestsMoreOpen(false); void openCollectionRunModal(); }}>اجرای Collection</button>
                        <button type="button" className="ac-nav-item !text-[var(--theme-text-muted)] hover:!bg-[var(--theme-surface-muted)]" disabled={!canCreate} onClick={() => { setRequestsMoreOpen(false); openCreateCollection(); }}>Collection جدید</button>
                        <button type="button" className="ac-nav-item !text-[var(--theme-text-muted)] hover:!bg-[var(--theme-surface-muted)]" disabled={!canCreate} onClick={() => { setRequestsMoreOpen(false); openImportCurl(); }}>Import cURL</button>
                        <button type="button" className="ac-nav-item !text-[var(--theme-text-muted)] hover:!bg-[var(--theme-surface-muted)]" disabled={!canCreate} onClick={() => { setRequestsMoreOpen(false); openImportPostmanCollection(); }}>Import Collection</button>
                        <button type="button" className="ac-nav-item !text-[var(--theme-text-muted)] hover:!bg-[var(--theme-surface-muted)]" disabled={!collections.length} onClick={() => { setRequestsMoreOpen(false); handleExportPostmanCollection(); }}>Export Postman</button>
                        <button type="button" className="ac-nav-item !text-[var(--theme-text-muted)] hover:!bg-[var(--theme-surface-muted)]" disabled={!filters.collectionId} onClick={() => { setRequestsMoreOpen(false); void handleExportCollectionOpenApi(); }}>Export OpenAPI</button>
                        <button type="button" className="ac-nav-item !text-[var(--theme-text-muted)] hover:!bg-[var(--theme-surface-muted)]" disabled={!filters.collectionId || !canEdit} onClick={() => { setRequestsMoreOpen(false); void handleCreateContractSuite(); }}>Contract Suite</button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ['', 'همه'],
                    ['FREE', 'آزاد'],
                    ['CDE', 'CDE'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value || 'all'}
                      type="button"
                      onClick={() => setFilters(prev => ({ ...prev, sourceApproach: value, page: 1 }))}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        filters.sourceApproach === value
                          ? 'bg-[var(--theme-text)] text-[var(--theme-surface)]'
                          : 'bg-[var(--theme-surface-muted)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-subtle)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="mx-1 self-center text-[var(--theme-border-strong)]">|</span>
                  {([
                    ['', 'همه انواع'],
                    ['GENERIC_HTTP', 'HTTP'],
                    ['CORE_QUERY', 'Query'],
                    ['CORE_COMMAND', 'Command'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value || 'all-type'}
                      type="button"
                      onClick={() => setFilters(prev => ({ ...prev, classificationType: value, page: 1 }))}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        filters.classificationType === value
                          ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-ink)]'
                          : 'bg-[var(--theme-surface-muted)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-subtle)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            <div className="ac-fill-panel grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)]">
              <Card padding="sm" className="flex min-h-0 flex-col overflow-hidden">
                <div className="mb-2 shrink-0 space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--theme-text)]">پوشه‌ها</h3>
                  <div className="flex gap-1">
                    <Input
                      aria-label="Folder جدید"
                      value={folderDraft}
                      onChange={(event) => setFolderDraft(event.target.value)}
                      placeholder="auth/login"
                      className="py-1 text-xs"
                      dir="ltr"
                    />
                    <Button size="sm" variant="secondary" onClick={createFolder} disabled={!canEdit}>+</Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pe-1">
                  <button type="button" className={`w-full rounded-md px-2 py-1.5 text-right text-xs ${!filters.folderPath ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-ink)]' : 'hover:bg-[var(--theme-surface-muted)]'}`} onClick={() => setFilters(prev => ({ ...prev, folderPath: '', page: 1 }))}>همه</button>
                  <button type="button" className={`w-full rounded-md px-2 py-1.5 text-right text-xs ${filters.folderPath === '__root__' ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-ink)]' : 'hover:bg-[var(--theme-surface-muted)]'}`} onClick={() => setFilters(prev => ({ ...prev, folderPath: '__root__', page: 1 }))}>(root)</button>
                  {knownFolders.map(folder => (
                    <div key={folder} className="flex items-center gap-1">
                      <button
                        type="button"
                        className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left font-mono text-xs ${filters.folderPath === folder ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-ink)]' : 'hover:bg-[var(--theme-surface-muted)]'}`}
                        dir="ltr"
                        onClick={() => setFilters(prev => ({ ...prev, folderPath: folder, page: 1 }))}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const requestId = event.dataTransfer.getData('text/request-id');
                          const request = (requests?.data || []).find(item => item.id === requestId);
                          if (request) void moveRequestToFolder(request, folder.split('/').filter(Boolean));
                        }}
                      >
                        {folder}
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          className="rounded px-1 text-xs text-[var(--theme-text-subtle)] hover:bg-red-50 hover:text-red-600"
                          title="حذف Folder خالی از فهرست"
                          onClick={() => {
                            const nextName = window.prompt('تغییرنام Folder (خالی = حذف از فهرست):', folder);
                            if (nextName === null) return;
                            const trimmed = nextName.trim();
                            if (!trimmed) {
                              setKnownFolders(prev => prev.filter(item => item !== folder));
                              if (filters.folderPath === folder) setFilters(prev => ({ ...prev, folderPath: '', page: 1 }));
                              return;
                            }
                            const parts = trimmed.split('/').map(part => part.trim()).filter(Boolean);
                            const key = parts.join('/');
                            setKnownFolders(prev => Array.from(new Set([...prev.filter(item => item !== folder), key])).sort((a, b) => a.localeCompare(b, 'fa')));
                            const toMove = (requests?.data || []).filter(item => (item.folderPath || []).join('/') === folder);
                            void Promise.all(toMove.map(item => moveRequestToFolder(item, parts)));
                            if (filters.folderPath === folder) setFilters(prev => ({ ...prev, folderPath: key, page: 1 }));
                          }}
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
              <div className="ac-table-shell min-w-0">
                <div className="ac-table-body">
            <Table
              columns={requestColumns}
              data={requests?.data || []}
              loading={loading}
              emptyMessage="Request ذخیره‌شده‌ای وجود ندارد"
              onRowClick={handleSelectRequest}
              enableClientFilter={false}
              enableColumnChooser={false}
              enableExport={false}
              bordered={false}
              rowClassName={(item) => selectingRequestId === item.id ? 'bg-[var(--theme-accent-soft)] opacity-80' : selectedRequest?.id === item.id ? 'bg-[var(--theme-accent-soft)]' : ''}
            />
                </div>
            {requests && (
              <div className="ac-table-foot">
              <Pagination
                page={requests.page}
                totalPages={requests.totalPages}
                total={requests.total}
                limit={requests.limit}
                onPageChange={(page) => setFilters(prev => ({ ...prev, page }))}
                onLimitChange={(limit) => setFilters(prev => ({ ...prev, page: 1, limit }))}
              />
              </div>
            )}
              </div>
            </div>
              </>
            )}

            {workspaceView === 'repository' && (
              <RepositorySection
                rows={repositoryRows}
                loading={repositoryLoading}
                filters={repositoryFilters}
                onFilters={setRepositoryFilters}
                onRefresh={loadRepository}
                onOpen={openRepositoryDetail}
              />
            )}

            {workspaceView === 'reviews' && canReviewShares && (
              <ShareReviewSection
                rows={shareReviews}
                loading={reviewsLoading}
                filters={reviewFilters}
                onFilters={setReviewFilters}
                onRefresh={loadShareReviews}
                onOpen={openReviewDetail}
                getApplicationName={getApplicationName}
              />
            )}

            {workspaceView === 'environments' && canManageEnvironments && activeContext && (
              <EnvironmentManagerSection
                environments={environments}
                canManageProtected={canManageProtectedEnvironments}
                onChanged={async () => {
                  const rows = await apiConsoleApi.getEnvironments();
                  setEnvironments(rows);
                }}
                context={activeContext}
              />
            )}

            {workspaceView === 'activity' && (
              <ActivityFeedPanel
                rows={activityRows}
                loading={activityLoading}
                page={activityFilters.page}
                limit={activityFilters.limit}
                onRefresh={() => void loadActivity()}
                onPageChange={(page) => setActivityFilters(prev => ({ ...prev, page }))}
                onLimitChange={(limit) => setActivityFilters(prev => ({ ...prev, page: 1, limit }))}
              />
            )}

            {workspaceView === 'runners' && isSystemAdmin && activeContext && (
              <RunnersAdminSection context={activeContext} />
            )}

            {workspaceView === 'branding' && isSystemAdmin && activeContext && (
              <BrandingAdminSection context={activeContext} />
            )}

            {workspaceView === 'org-policy' && isSystemAdmin && activeContext && (
              <OrgPolicySection context={activeContext} />
            )}

            {workspaceView === 'compliance' && (canViewUsageReports || isSystemAdmin) && activeContext && (
              <ComplianceReportSection context={activeContext} />
            )}

            {workspaceView === 'jit' && activeContext && (
              <JitAccessSection
                context={activeContext}
                canApprove={isSystemAdmin || canManageProtectedEnvironments}
              />
            )}

            {workspaceView === 'mocks' && canEdit && activeContext && (
              <MocksSection context={activeContext} applicationId={typeof appId === 'string' ? appId : undefined} />
            )}

            {workspaceView === 'users' && canManageGeneralSettings && activeContext && (
              <UserManagementSection
                users={adminUsers}
                loading={adminUsersLoading}
                search={adminUserSearch}
                onSearch={setAdminUserSearch}
                onRefresh={loadAdminUsers}
                onUsersChange={setAdminUsers}
                activeContext={activeContext}
                onChangeRole={(user, role, enabled) => setAdminRoleTarget({
                  user,
                  role,
                  enabled,
                  applicationId: typeof appId === 'string' && appId ? appId : 'ALL',
                })}
              />
            )}

            {workspaceView === 'audit' && canManageGeneralSettings && (
              <Card padding="sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Audit Explorer</h2>
                    <p className="text-xs text-gray-500">رویدادهای امنیتی و عملیاتی — بدون secret خام.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Download className="h-4 w-4" />}
                      disabled={!auditRows?.data?.length}
                      onClick={() => {
                        const rows = auditRows?.data || [];
                        downloadJsonFile(rows, `audit-export-${new Date().toISOString().slice(0, 10)}.json`);
                      }}
                    >
                      Export JSON
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Download className="h-4 w-4" />}
                      disabled={!auditRows?.data?.length}
                      onClick={() => {
                        const rows = auditRows?.data || [];
                        const csv = rowsToCsv(
                          ['createdAt', 'eventType', 'actorUserId', 'actorRole', 'details'],
                          rows.map(row => [
                            row.createdAt,
                            row.eventType,
                            row.actorUserId,
                            row.actorRole,
                            JSON.stringify(row.details || {}),
                          ])
                        );
                        downloadTextFile(csv, `audit-export-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
                      }}
                    >
                      Export CSV
                    </Button>
                    <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={loadAuditLog} loading={auditLoading}>
                      Refresh
                    </Button>
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Input
                    label="Action"
                    value={auditFilters.action}
                    onChange={(event) => setAuditFilters(prev => ({ ...prev, page: 1, action: event.target.value }))}
                    dir="ltr"
                  />
                  <Input
                    label="User ID"
                    value={auditFilters.userId}
                    onChange={(event) => setAuditFilters(prev => ({ ...prev, page: 1, userId: event.target.value }))}
                    dir="ltr"
                  />
                </div>
                <Table
                  columns={[
                    {
                      key: 'createdAt',
                      title: 'زمان',
                      render: (row: ApiAuditEvent) => <span className="font-mono text-xs" dir="ltr">{row.createdAt}</span>,
                    },
                    {
                      key: 'eventType',
                      title: 'Action',
                      render: (row: ApiAuditEvent) => <Badge size="sm">{row.eventType}</Badge>,
                    },
                    {
                      key: 'actor',
                      title: 'Actor',
                      render: (row: ApiAuditEvent) => (
                        <div>
                          <p className="font-mono text-xs" dir="ltr">{row.actorUserId}</p>
                          <p className="text-xs text-gray-500">{roleLabel(row.actorRole)}</p>
                        </div>
                      ),
                    },
                    {
                      key: 'details',
                      title: 'Details',
                      render: (row: ApiAuditEvent) => {
                        const requestId = typeof row.details?.requestId === 'string' ? row.details.requestId : '';
                        return (
                          <div className="space-y-2">
                            <pre className="max-w-md overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-gray-600" dir="ltr">
                              {JSON.stringify(row.details || {}, null, 2)}
                            </pre>
                            {requestId ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={async () => {
                                  try {
                                    setWorkspaceView('requests');
                                    await reloadRequests(requestId);
                                  } catch (error) {
                                    toast.error(error instanceof Error ? error.message : 'باز کردن Request ناموفق بود.');
                                  }
                                }}
                              >
                                باز کردن Request
                              </Button>
                            ) : null}
                          </div>
                        );
                      },
                    },
                  ]}
                  data={auditRows?.data || []}
                  loading={auditLoading}
                  emptyMessage="رویداد Audit ثبت نشده است"
                  enableClientFilter={false}
                  enableColumnChooser={false}
                  enableExport={false}
                />
                {auditRows && (
                  <Pagination
                    page={auditRows.page}
                    totalPages={auditRows.totalPages}
                    total={auditRows.total}
                    limit={auditRows.limit}
                    onPageChange={(page) => setAuditFilters(prev => ({ ...prev, page }))}
                    onLimitChange={(limit) => setAuditFilters(prev => ({ ...prev, page: 1, limit }))}
                  />
                )}
              </Card>
            )}

            {workspaceView === 'reports' && (
              <div className="space-y-4">
                <Card padding="sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">وضعیت workspace</h2>
                      <p className="text-xs text-gray-500">متریک‌های محلی صفحه جاری — جدا از گزارش مصرف Repository.</p>
                    </div>
                    <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={loadAll} loading={loading}>
                      Refresh
                    </Button>
                  </div>
                  <div className="overflow-auto rounded-lg border border-gray-200" dir="ltr">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Metric</th>
                          <th className="px-3 py-2 font-medium">Value</th>
                          <th className="px-3 py-2 font-medium">Scope</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white font-mono text-xs text-gray-800">
                        <tr>
                          <td className="px-3 py-2">saved_requests</td>
                          <td className="px-3 py-2">{stats.total}</td>
                          <td className="px-3 py-2 text-gray-500">current project</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2">core_query</td>
                          <td className="px-3 py-2">{stats.coreQuery}</td>
                          <td className="px-3 py-2 text-gray-500">loaded page</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2">core_command</td>
                          <td className="px-3 py-2">{stats.coreCommand}</td>
                          <td className="px-3 py-2 text-gray-500">loaded page</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2">repository_approved</td>
                          <td className="px-3 py-2">{stats.approved}</td>
                          <td className="px-3 py-2 text-gray-500">loaded page</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2">pending_share_reviews</td>
                          <td className="px-3 py-2">{stats.pendingReview}</td>
                          <td className="px-3 py-2 text-gray-500">admin queue</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2">runtime_session</td>
                          <td className="px-3 py-2">{runtimeConnected ? 'connected' : 'disconnected'}</td>
                          <td className="px-3 py-2 text-gray-500">active profile</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2">role</td>
                          <td className="px-3 py-2">{activeContext?.role || '—'}</td>
                          <td className="px-3 py-2 text-gray-500">session</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card padding="sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">گزارش مصرف APIها</h2>
                      <p className="text-xs text-gray-500">رویدادهای Repository از backend — فقط برای نقش‌های مجاز.</p>
                    </div>
                    {canViewUsageReports && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Download className="h-4 w-4" />}
                          disabled={!usageReport?.data?.length}
                          onClick={() => {
                            const rows = usageReport?.data || [];
                            const csv = rowsToCsv(
                              ['eventAt', 'eventType', 'apiId', 'apiTitle', 'version', 'userId', 'userDisplayName', 'activeRole'],
                              rows.map(row => [
                                row.eventAt,
                                row.eventType,
                                row.apiId,
                                row.apiTitle,
                                row.version,
                                row.userId,
                                row.userDisplayName,
                                row.activeRole,
                              ])
                            );
                            downloadTextFile(csv, `usage-report-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
                          }}
                        >
                          Export CSV
                        </Button>
                        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={loadUsageReport} loading={usageLoading}>
                          Refresh
                        </Button>
                      </div>
                    )}
                  </div>
                  {!canViewUsageReports ? (
                    <p className="text-sm text-gray-500">برای مشاهده گزارش مصرف به نقش مدیرسیستم، سرپرست فنی یا سرپرست QA نیاز است.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                        <Select
                          label="نوع رویداد"
                          value={usageFilters.eventType}
                          onChange={(event) => setUsageFilters(prev => ({ ...prev, page: 1, eventType: event.target.value }))}
                          options={[
                            { value: '', label: 'همه' },
                            { value: 'ADDED_TO_CONSOLE', label: 'ADDED_TO_CONSOLE' },
                            { value: 'API_OPENED', label: 'API_OPENED' },
                            { value: 'API_EXECUTED', label: 'API_EXECUTED' },
                            { value: 'REMOVED_FROM_CONSOLE', label: 'REMOVED_FROM_CONSOLE' },
                            { value: 'NEW_VERSION_VIEWED', label: 'NEW_VERSION_VIEWED' },
                          ]}
                        />
                        <Input
                          label="API ID"
                          value={usageFilters.apiId}
                          onChange={(event) => setUsageFilters(prev => ({ ...prev, page: 1, apiId: event.target.value }))}
                          dir="ltr"
                        />
                        <Input
                          label="User ID"
                          value={usageFilters.userId}
                          onChange={(event) => setUsageFilters(prev => ({ ...prev, page: 1, userId: event.target.value }))}
                          dir="ltr"
                        />
                        <JalaliDateField
                          label="از تاریخ"
                          value={usageFilters.dateFrom}
                          onChange={(value) => setUsageFilters(prev => ({ ...prev, page: 1, dateFrom: value }))}
                        />
                        <JalaliDateField
                          label="تا تاریخ"
                          value={usageFilters.dateTo}
                          onChange={(value) => setUsageFilters(prev => ({ ...prev, page: 1, dateTo: value }))}
                        />
                      </div>
                      {usageReport && (
                        <div className="flex flex-wrap gap-3 text-xs text-gray-600" dir="ltr">
                          <span>total: {usageReport.summary.total}</span>
                          <span>uniqueApis: {usageReport.summary.uniqueApis}</span>
                          <span>uniqueUsers: {usageReport.summary.uniqueUsers}</span>
                        </div>
                      )}
                      {topUsageApis.length > 0 && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <p className="mb-2 text-sm font-semibold text-gray-900">Top APIs (صفحه جاری)</p>
                          <ul className="space-y-1 text-xs text-gray-700" dir="ltr">
                            {topUsageApis.map(item => (
                              <li key={item.apiId} className="flex flex-wrap justify-between gap-2 font-mono">
                                <span>{item.apiTitle} ({item.apiId})</span>
                                <span>API_EXECUTED: {item.executed} · ADDED_TO_CONSOLE: {item.added}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <Table
                        columns={[
                          {
                            key: 'eventAt',
                            title: 'زمان',
                            render: (row: ApiUsageReport['data'][number]) => (
                              <span className="font-mono text-xs" dir="ltr">{row.eventAt}</span>
                            ),
                          },
                          {
                            key: 'eventType',
                            title: 'رویداد',
                            render: (row: ApiUsageReport['data'][number]) => <Badge size="sm">{row.eventType}</Badge>,
                          },
                          {
                            key: 'apiTitle',
                            title: 'API',
                            render: (row: ApiUsageReport['data'][number]) => (
                              <div>
                                <p className="font-medium text-gray-900">{row.apiTitle || row.apiId}</p>
                                <p className="font-mono text-xs text-gray-500" dir="ltr">{row.apiId} @ {row.version}</p>
                              </div>
                            ),
                          },
                          {
                            key: 'user',
                            title: 'کاربر',
                            render: (row: ApiUsageReport['data'][number]) => (
                              <div>
                                <p>{row.userDisplayName || row.userId}</p>
                                <p className="text-xs text-gray-500">{roleLabel(row.activeRole)}</p>
                              </div>
                            ),
                          },
                        ]}
                        data={usageReport?.data || []}
                        loading={usageLoading}
                        emptyMessage="رویدادی برای فیلتر فعلی ثبت نشده است"
                        enableClientFilter={false}
                        enableColumnChooser={false}
                        enableExport={false}
                      />
                      {usageReport && (
                        <Pagination
                          page={usageReport.page}
                          totalPages={usageReport.totalPages}
                          total={usageReport.total}
                          limit={usageReport.limit}
                          onPageChange={(page) => setUsageFilters(prev => ({ ...prev, page }))}
                          onLimitChange={(limit) => setUsageFilters(prev => ({ ...prev, page: 1, limit }))}
                        />
                      )}
                    </div>
                  )}
                </Card>
              </div>
            )}

            {workspaceView === 'runtime' && activeContext && (
              <RuntimeWorkspace
                context={activeContext}
                projectKey={activeContext.applicationId}
                collections={collections}
                isSystemAdmin={canManageGeneralSettings}
                onSynced={reloadRequests}
                onConnectionChange={setRuntimeConnected}
                canCreateFreeRequest={canCreate}
                projects={projects}
                onSelectProject={async (projectKey) => {
                  await selectProject(projectKey);
                }}
                onCreateFreeRequest={async (applicationId) => {
                  await handleNewRequest(applicationId || PERSONAL_APPLICATION_ID);
                }}
                onOpenRequest={async (requestId) => {
                  setWorkspaceView('requests');
                  await reloadRequests(requestId);
                }}
              />
            )}
          </section>
        ) : (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" size="sm" onClick={handleBackToList}>
                بازگشت به جدول Requestها
              </Button>
              {selectedRequest && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" icon={<Terminal className="h-4 w-4" />} onClick={openEditCurl} disabled={!canEdit}>
                    ویرایش cURL
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download className="h-4 w-4" />}
                    onClick={() => handleExportPostmanCollection(selectedRequest.collectionId)}
                    loading={exportingCollectionId === selectedRequest.collectionId}
                    disabled={!selectedRequest.collectionId}
                  >
                    Export Collection
                  </Button>
                  <Button variant="secondary" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => handleGenerateDocs(false)} disabled={!canDocument}>
                    پیش‌نمایش سند
                  </Button>
                  {selectedRequest.sourceType !== 'REFERENCE' && (
                    <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setVersionModalOpen(true)} disabled={!canEdit}>
                      Version جدید
                    </Button>
                  )}
                  <Select
                    aria-label="زبان سند"
                    value={docLanguage}
                    onChange={(event) => setDocLanguage(event.target.value as ApiDocLanguage)}
                    className="min-w-[110px] py-1.5 text-sm"
                    options={[
                      { value: 'FA', label: 'سند FA' },
                      { value: 'EN', label: 'سند EN' },
                    ]}
                  />
                  <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => handleGenerateDocs(true)} disabled={!canDocument}>
                    تولید سند نهایی
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Terminal className="h-4 w-4" />}
                    onClick={() => { void handleCreateMock(); }}
                    loading={creatingMock}
                    disabled={!canEdit}
                  >
                    ساخت Mock
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 className="h-4 w-4" />}
                    disabled={!canDelete}
                    onClick={() => selectedRequest && setDeleteTarget(selectedRequest)}
                  >
                    حذف
                  </Button>
                </div>
              )}
            </div>
            {detailsLoading && (
              <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-sm text-blue-700">
                <MinimalLoader size="xs" />
                <span>در حال بارگذاری جزئیات Request...</span>
              </div>
            )}
            {!selectedRequest ? (
              <Card className="p-8 text-center">
                <Terminal className="mx-auto mb-3 h-10 w-10 text-gray-400" />
                <h3 className="text-lg font-semibold text-gray-900">Request انتخاب نشده است</h3>
                <p className="mt-1 text-sm text-gray-500">برای شروع، یک cURL را Import کنید یا Request جدید بسازید.</p>
              </Card>
            ) : (
              <>
                <Card>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_160px_1.5fr_auto]">
                    <Input
                      label="نام Request"
                      value={selectedRequest.name}
                      onChange={(event) => updateDraft(request => ({ ...request, name: event.target.value }))}
                    />
                    <Select
                      label="Method"
                      value={selectedRequest.method}
                      onChange={(event) => updateDraft(request => ({ ...request, method: event.target.value as ApiHttpMethod }))}
                      options={METHOD_OPTIONS.map(method => ({ value: method, label: method }))}
                    />
                    <Input
                      label="URL"
                      value={selectedRequest.urlTemplate}
                      dir="ltr"
                      className="text-left font-mono"
                      onChange={(event) => updateDraft(request => ({ ...request, urlTemplate: event.target.value }))}
                    />
                    <div className="flex flex-col items-stretch justify-end gap-1">
                      <div className="flex items-end gap-2">
                        <Button
                          variant="secondary"
                          icon={<Save className="h-4 w-4" />}
                          onClick={handleSave}
                          loading={saving}
                          disabled={!canEdit}
                        >
                          ذخیره
                        </Button>
                        {canExecute ? (
                          <Button
                            icon={<PlayCircle className="h-4 w-4" />}
                            onClick={handleSend}
                            loading={executing}
                          >
                            ارسال
                          </Button>
                        ) : (
                          <Button
                            icon={<PlayCircle className="h-4 w-4" />}
                            disabled
                            title="نقش شما اجازه اجرای Request را ندارد"
                          >
                            ارسال
                          </Button>
                        )}
                      </div>
                      {!canExecute && (
                        <p className="text-xs text-amber-700">
                          نقش «{roleLabel(role)}» فقط‌خواندنی است و اجازه اجرای API را ندارد.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
                    <Select
                      label="Collection"
                      value={selectedRequest.collectionId}
                      onChange={(event) => updateDraft(request => ({ ...request, collectionId: event.target.value }))}
                      options={collections.map(collection => ({ value: collection.id, label: collection.name }))}
                    />
                    <Select
                      label="Environment"
                      value={selectedRequest.environmentId}
                      onChange={(event) => updateDraft(request => ({ ...request, environmentId: event.target.value }))}
                      options={environments.map(environment => ({ value: environment.id, label: environment.name }))}
                    />
                    <Select
                      label="استراتژی Replay"
                      value={selectedRequest.executionMode}
                      onChange={(event) => updateDraft(request => ({ ...request, executionMode: event.target.value as ApiExecutionMode }))}
                      options={[
                        { value: 'RECOMMENDED', label: 'Recommended' },
                        { value: 'EXACT', label: 'Exact replay' },
                      ]}
                    />
                    <div>
                      <FieldLabel>نوع Request</FieldLabel>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={classBadgeVariant(selectedRequest.classification.type)}>
                          {CLASSIFICATION_LABELS[selectedRequest.classification.type]}
                        </Badge>
                        <Badge variant={sharingBadgeVariant(selectedRequest.sharingStatus)}>
                          {API_SHARING_STATUS_LABELS[selectedRequest.sharingStatus || 'DRAFT']}
                        </Badge>
                        <Badge variant="default">v{selectedRequest.semanticVersion || selectedRequest.documentation?.version || '1.0.0'}</Badge>
                        {selectedRequest.sourceType === 'REFERENCE' && <Badge variant="info">Reference</Badge>}
                        {selectedRequest.sourceType === 'CDE_DISCOVERY' && <Badge variant="info">CDE Sync</Badge>}
                        {selectedRequest.sourceSync?.status === 'STALE' && <Badge variant="danger">STALE</Badge>}
                        {selectedRequest.sourceSync?.status === 'CONFLICT' && <Badge variant="warning">Sync Conflict</Badge>}
                        {selectedRequest.tls.importedInsecureFlag && (
                          <Badge variant="warning">واردشده با --insecure</Badge>
                        )}
                        {hasUnsavedChanges && <Badge variant="warning">تغییرات ذخیره‌نشده</Badge>}
                      </div>
                    </div>
                  </div>

                  {selectedEnvironment?.kind === 'PRODUCTION' && selectedRequest.classification.type === 'CORE_COMMAND' && (
                    <div className="mt-4 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      <p>اجرای Production Core Command نیازمند permission بالاتر، confirmation و business justification است.</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={dualApprovalBusy}
                          onClick={() => {
                            void (async () => {
                              if (!activeContext || !selectedRequest) return;
                              setDualApprovalBusy(true);
                              try {
                                const rows = await apiConsoleApi.getDualApprovals(selectedRequest.id, activeContext);
                                const mine = (rows.data || []).filter(item => item.userId === activeContext.userId);
                                const active = mine.find(item => item.status === 'ACTIVE');
                                const pending = mine.find(item => item.status === 'PENDING');
                                setDualApprovalStatus(active ? 'ACTIVE' : pending ? 'PENDING' : 'MISSING');
                              } catch {
                                setDualApprovalStatus('UNKNOWN');
                              } finally {
                                setDualApprovalBusy(false);
                              }
                            })();
                          }}
                        >
                          وضعیت Dual Approval
                        </Button>
                        <Button
                          size="sm"
                          loading={dualApprovalBusy}
                          onClick={() => {
                            void (async () => {
                              if (!activeContext || !selectedRequest) return;
                              const reason = window.prompt('دلیل درخواست Dual Approval');
                              if (!reason?.trim()) return;
                              setDualApprovalBusy(true);
                              try {
                                await apiConsoleApi.requestDualApproval(selectedRequest.id, reason.trim(), activeContext);
                                setDualApprovalStatus('PENDING');
                                toast.success('درخواست Dual Approval ثبت شد.');
                              } catch (error) {
                                toast.error(error instanceof Error ? error.message : 'ثبت Dual Approval ناموفق بود.');
                              } finally {
                                setDualApprovalBusy(false);
                              }
                            })();
                          }}
                        >
                          درخواست Dual Approval
                        </Button>
                        {dualApprovalStatus !== 'UNKNOWN' && (
                          <Badge size="sm" variant={dualApprovalStatus === 'ACTIVE' ? 'success' : dualApprovalStatus === 'PENDING' ? 'warning' : 'secondary'}>
                            {dualApprovalStatus}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedRequest.isGatewayBinding || selectedRequest.sourceType === 'IS_DISCOVERY' ? (
                    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                      <div className="font-semibold">IS Gateway binding</div>
                      <div className="mt-1 font-mono text-xs" dir="ltr">
                        service={selectedRequest.isGatewayBinding?.serviceKey || '—'}
                        {' · '}
                        path={selectedRequest.isGatewayBinding?.gatewayPath || selectedRequest.urlTemplate || '—'}
                        {' · '}
                        source={selectedRequest.isGatewayBinding?.sourceKind || 'SPEC_SERVICE'}
                      </div>
                      {(selectedRequest.isGatewayBinding?.specFolder || selectedRequest.isGatewayBinding?.controllerName) ? (
                        <div className="mt-1 font-mono text-[11px] text-emerald-800/80" dir="ltr">
                          spec={selectedRequest.isGatewayBinding?.specFolder || '—'}
                          {selectedRequest.isGatewayBinding?.controllerName ? ` · ${selectedRequest.isGatewayBinding.controllerName}` : ''}
                          {selectedRequest.isGatewayBinding?.actionName ? `/${selectedRequest.isGatewayBinding.actionName}` : ''}
                        </div>
                      ) : null}
                      <div className="mt-1 text-xs">
                        کوکی نشست Gateway (`_lsr`) در Request ذخیره نمی‌شود و هنگام اجرا فقط در backend تزریق می‌شود. Environment پیشنهادی: IS Gateway.
                      </div>
                    </div>
                  ) : selectedRequest.runtimeBinding?.runtimeProfileId ? (
                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                      <div className="font-semibold">Runtime binding ثبت‌شده</div>
                      <div className="mt-1 font-mono text-xs" dir="ltr">
                        profile={selectedRequest.runtimeBinding.runtimeProfileId} · operation={selectedRequest.runtimeBinding.operationId} · source={selectedRequest.runtimeBinding.sourceKind}
                      </div>
                      <div className="mt-1 text-xs">Cookie و client-id در این Request ذخیره نشده‌اند و هنگام اجرا فقط در backend تزریق می‌شوند.</div>
                    </div>
                  ) : null}
                  {selectedRequest.latestReturnReason && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <span className="font-semibold">دلیل بازگردانی مدیرسیستم: </span>
                      {selectedRequest.latestReturnReason}
                    </div>
                  )}
                </Card>

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                  <div className="flex min-w-max gap-1 p-2">
                    {visibleTabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                          activeTab === tab.id ? 'bg-[var(--theme-accent)] text-white' : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {activeTab === 'response' ? (
                  <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                    <EffectiveRequestPanel request={selectedRequest} effectiveRequest={effectiveRequest} loading={detailsLoading} />
                    <ResponsePanel
                      execution={latestExecution}
                      loading={detailsLoading}
                      canDisableTls={canEdit && canExecute && selectedEnvironment?.kind !== 'PRODUCTION'}
                      onDisableTlsAndRetry={handleDisableTlsAndRetry}
                    />
                  </div>
                ) : (
                  <Card>
                    {activeTab === 'params' && (
                      <div className="space-y-6">
                        {(selectedRequest.classification.type === 'CORE_QUERY' || selectedRequest.classification.type === 'CORE_COMMAND') && (
                          <div className="space-y-3">
                            <div>
                              <h3 className="font-semibold text-gray-900">
                                {selectedRequest.classification.type === 'CORE_COMMAND' ? 'Data (fr)' : 'Params (ds)'}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {selectedRequest.classification.type === 'CORE_COMMAND'
                                  ? 'این آبجکت به‌عنوان data در body درخواست store-form-data ارسال می‌شود.'
                                  : 'این آبجکت به‌عنوان params در body درخواست get-data-source ارسال می‌شود (مثلاً viewerRole، limit، offset).'}
                              </p>
                            </div>
                            <Textarea
                              label={selectedRequest.classification.type === 'CORE_COMMAND' ? 'Data payload' : 'Params payload'}
                              value={(() => {
                                const parsed = parseJson(selectedRequest.bodyTemplate);
                                const body = parsed.ok ? asRecord(parsed.value) : {};
                                return JSON.stringify(
                                  selectedRequest.classification.type === 'CORE_COMMAND' ? body.data || {} : body.params || {},
                                  null,
                                  2,
                                );
                              })()}
                              onChange={(event) => updateCorePayload(
                                selectedRequest.classification.type === 'CORE_COMMAND' ? 'data' : 'params',
                                event.target.value,
                              )}
                              className="min-h-72 text-left font-mono"
                              dir="ltr"
                            />
                          </div>
                        )}
                        <KeyValueEditor
                          rows={selectedRequest.queryParameters}
                          onChange={(rows) => updateDraft(request => ({ ...request, queryParameters: rows }))}
                          onAdd={() => updateDraft(request => ({ ...request, queryParameters: [...request.queryParameters, { ...makeParam(), displayOrder: request.queryParameters.length }] }))}
                          valueKey="value"
                          title={(selectedRequest.classification.type === 'CORE_QUERY' || selectedRequest.classification.type === 'CORE_COMMAND')
                            ? 'Query parameters (URL)'
                            : 'Query parameters'}
                        />
                      </div>
                    )}

                    {activeTab === 'headers' && (
                      <HeaderEditor
                        rows={selectedRequest.headers}
                        onChange={(rows) => updateDraft(request => ({ ...request, headers: rows }))}
                        onAdd={() => updateDraft(request => ({ ...request, headers: [...request.headers, makeHeader(request.headers.length)] }))}
                      />
                    )}

                    {activeTab === 'cookies' && (
                      <CookieEditor
                        rows={selectedRequest.cookies}
                        onChange={(rows) => updateDraft(request => ({ ...request, cookies: rows }))}
                        onAdd={() => updateDraft(request => ({ ...request, cookies: [...request.cookies, makeCookie(request.cookies.length)] }))}
                      />
                    )}

                    {activeTab === 'body' && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                          <Select
                            label="نوع Body"
                            value={selectedRequest.bodyType}
                            onChange={(event) => updateDraft(request => ({
                              ...request,
                              bodyType: event.target.value as ApiRequestDefinition['bodyType'],
                              bodyTemplate: event.target.value === 'none' ? '' : request.bodyTemplate,
                            }))}
                            options={[
                              { value: 'none', label: 'None' },
                              { value: 'json', label: 'JSON' },
                              { value: 'raw', label: 'Raw text' },
                              { value: 'xml', label: 'XML' },
                              { value: 'form-urlencoded', label: 'Form URL encoded' },
                              { value: 'multipart', label: 'Multipart form-data' },
                              { value: 'binary', label: 'Binary/file reference' },
                            ]}
                          />
                        </div>
                        {selectedRequest.bodyType === 'json' ? (
                          <JsonEditor
                            value={selectedRequest.bodyTemplate}
                            onChange={(value) => updateDraft(request => ({ ...request, bodyTemplate: value }))}
                            onFormat={() => {
                              const parsed = parseJson(selectedRequest.bodyTemplate);
                              if (parsed.ok) {
                                updateDraft(request => ({ ...request, bodyTemplate: JSON.stringify(parsed.value, null, 2), bodyType: 'json' }));
                              } else {
                                toast.error(parsed.message);
                              }
                            }}
                            onCopy={() => {
                              navigator.clipboard?.writeText(selectedRequest.bodyTemplate);
                                toast.success('Body کپی شد.');
                            }}
                          />
                        ) : (
                          <Textarea
                            label="Body"
                            value={selectedRequest.bodyTemplate}
                            onChange={(event) => updateDraft(request => ({ ...request, bodyTemplate: event.target.value }))}
                            className="min-h-48 text-left font-mono sm:min-h-[320px]"
                            dir="ltr"
                          />
                        )}
                      </div>
                    )}

                    {activeTab === 'auth' && (
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <Select
                            label="نوع Authentication"
                          value={selectedRequest.authentication.type}
                          onChange={(event) => updateDraft(request => ({
                            ...request,
                            authentication: { type: event.target.value as ApiRequestDefinition['authentication']['type'] },
                          }))}
                          options={[
                            { value: 'none', label: 'بدون Authentication' },
                            { value: 'bearer', label: 'Bearer Token' },
                            { value: 'basic', label: 'Basic Authentication' },
                            { value: 'api-key', label: 'API Key Header' },
                            { value: 'cookie-session', label: 'Cookie Session' },
                            { value: 'custom-headers', label: 'Custom Headers' },
                            { value: 'environment-secret', label: 'Environment Secret Reference' },
                          ]}
                        />
                        <Input
                          label="Secret reference / variable"
                          value={
                            selectedRequest.authentication.bearerTokenReference ||
                            selectedRequest.authentication.apiKeyValueReference ||
                            selectedRequest.authentication.cookieValueReference ||
                            selectedRequest.authentication.basicPasswordReference ||
                            ''
                          }
                          placeholder="{{token}} یا secret-reference"
                          onChange={(event) => updateDraft(request => ({
                            ...request,
                            authentication: {
                              ...request.authentication,
                              bearerTokenReference: event.target.value,
                              apiKeyValueReference: event.target.value,
                              cookieValueReference: event.target.value,
                              basicPasswordReference: event.target.value,
                            },
                          }))}
                        />
                        <Input
                          label="نام API key/header/cookie"
                          value={selectedRequest.authentication.apiKeyName || selectedRequest.authentication.cookieName || ''}
                          onChange={(event) => updateDraft(request => ({
                            ...request,
                            authentication: {
                              ...request.authentication,
                              apiKeyName: event.target.value,
                              cookieName: event.target.value,
                            },
                          }))}
                        />
                        <Input
                          label="Basic username"
                          value={selectedRequest.authentication.basicUsername || ''}
                          onChange={(event) => updateDraft(request => ({
                            ...request,
                            authentication: { ...request.authentication, basicUsername: event.target.value },
                          }))}
                        />
                      </div>
                    )}

                    {activeTab === 'core' && (
                      <CoreDetailsEditor
                        request={selectedRequest}
                        enabled={corePresentationEnabled}
                        onToggle={setCorePresentationEnabled}
                        onCorePatch={updateCoreBody}
                        onPayloadPatch={updateCorePayload}
                      />
                    )}

                    {activeTab === 'scripts' && (
                      <ScriptsPanel
                        scripts={selectedRequest.scripts || defaultScripts()}
                        onChange={(scripts) => updateDraft(request => ({ ...request, scripts }))}
                      />
                    )}

                    {activeTab === 'settings' && canEdit && (
                      <SettingsPanel
                        request={selectedRequest}
                        environment={selectedEnvironment}
                        collection={collections.find(item => item.id === selectedRequest.collectionId)}
                        effectiveRequest={effectiveRequest}
                        canManageTls={canManageGeneralSettings}
                        ownershipSaving={ownershipSaving}
                        transferUserId={ownershipTransferUserId}
                        coOwnersInput={coOwnersInput}
                        onTransferUserIdChange={setOwnershipTransferUserId}
                        onCoOwnersInputChange={setCoOwnersInput}
                        onVisibilityChange={handleRequestVisibilityChange}
                        onTransfer={handleTransferOwnership}
                        onSaveCoOwners={handleSaveCoOwners}
                        onChange={(patch) => updateDraft(request => ({ ...request, ...patch }))}
                      />
                    )}

                    {activeTab === 'assertions' && (
                      <AssertionEditor
                        rows={selectedRequest.assertions}
                        onChange={(rows) => updateDraft(request => ({ ...request, assertions: rows }))}
                        onAdd={() => updateDraft(request => ({ ...request, assertions: [...request.assertions, makeAssertion()] }))}
                      />
                    )}

                    {activeTab === 'documentation' && (
                      <DocumentationMetadataEditor
                        metadata={selectedRequest.documentation}
                        onChange={(documentationMetadata) => updateDraft(request => ({ ...request, documentation: documentationMetadata }))}
                        onRefresh={handleRefreshDocumentation}
                        refreshing={documentationRefreshing}
                        disabled={!canEdit}
                      />
                    )}

                    {activeTab === 'curl' && (
                      <GeneratedCurlPanel
                        exports={exports}
                        originalCurl={selectedRequest.originalImportedCurl}
                        loading={detailsLoading}
                        onRefresh={() => {
                          const request = savedRequest || selectedRequest;
                          if (request) refreshDerivedViews(request, true);
                        }}
                      />
                    )}

                    {activeTab === 'history' && (
                      <HistoryPanel
                        rows={historyRows}
                        selected={selectedExecution}
                        manualResponses={manualResponses}
                        loading={detailsLoading}
                        statusFilter={historyStatusFilter}
                        onStatusFilter={setHistoryStatusFilter}
                        compareIds={historyCompareIds}
                        onToggleCompare={(id) => setHistoryCompareIds(prev => (
                          prev.includes(id) ? prev.filter(item => item !== id) : prev.length >= 2 ? [prev[1]!, id] : [...prev, id]
                        ))}
                        onSelect={setSelectedExecution}
                        onManual={() => setManualModalOpen(true)}
                      />
                    )}
                  </Card>
                )}

                {activeTab === 'history' && selectedExecution && (
                  <ResponsePanel
                    execution={selectedExecution}
                    loading={detailsLoading}
                    canDisableTls={canEdit && canExecute && selectedEnvironment?.kind !== 'PRODUCTION'}
                    onDisableTlsAndRetry={handleDisableTlsAndRetry}
                  />
                )}
              </>
            )}
          </section>
        )}
      </main>
    </AppShell>

      <ImportCurlModal
        open={curlModalOpen}
        title="Import cURL"
        primaryActionLabel="Import"
        curlText={curlText}
        requestTitle={importTitle}
        collections={collections.map(collection => ({ ...collection, name: `${collection.name} — ${getApplicationName(collection.applicationId)}` }))}
        selectedCollectionId={importCollectionId}
        preview={curlPreview}
        previewSubtab={previewSubtab}
        onSubtab={setPreviewSubtab}
        onText={setCurlText}
        onRequestTitle={setImportTitle}
        onCollectionChange={setImportCollectionId}
        onParse={handleParseCurl}
        onImport={handleImportPreview}
        onClose={() => {
          setCurlModalOpen(false);
          setCurlPreview(null);
          setImportTitle('');
          setImportCollectionId('');
        }}
      />

      <ImportPostmanCollectionModal
        open={postmanModalOpen}
        text={postmanText}
        fileName={postmanFileName}
        preview={postmanPreview}
        importing={postmanImporting}
        applicationId={postmanApplicationId}
        onText={(value) => {
          setPostmanText(value);
          setPostmanPreview(null);
        }}
        onFile={handlePostmanFileSelected}
        onApplicationChange={setPostmanApplicationId}
        onParse={handleParsePostmanCollection}
        onImport={handleImportPostmanCollection}
        onClose={closeImportPostmanCollection}
      />

      <ImportCurlModal
        open={editCurlModalOpen}
        title="Edit cURL"
        primaryActionLabel="اعمال روی Request"
        curlText={editCurlText}
        preview={editCurlPreview}
        previewSubtab={editCurlPreviewSubtab}
        onSubtab={setEditCurlPreviewSubtab}
        onText={setEditCurlText}
        onParse={handleParseEditCurl}
        onImport={handleApplyEditedCurl}
        onClose={() => {
          setEditCurlModalOpen(false);
          setEditCurlPreview(null);
          setEditCurlText('');
        }}
      />

      <DocumentationModal
        open={docsModalOpen}
        markdown={documentation}
        warnings={documentationWarnings}
        onClose={() => setDocsModalOpen(false)}
      />

      <Modal isOpen={shareModalOpen} onClose={() => setShareModalOpen(false)} title="اشتراک API با دیگران" size="lg">
        <div className="space-y-4">
          {shareTarget && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-gray-900">{shareTarget.name}</p>
                <Badge variant="default">v{shareTarget.semanticVersion}</Badge>
                <Badge variant={classBadgeVariant(shareTarget.classification.type)}>{CLASSIFICATION_LABELS[shareTarget.classification.type]}</Badge>
              </div>
              <p className="mt-1 font-mono text-xs text-gray-500" dir="ltr">{shareTarget.method} {shareTarget.urlTemplate}</p>
            </div>
          )}
          <Textarea
            label="هدف"
            value={shareForm.purpose}
            onChange={(event) => setShareForm(prev => ({ ...prev, purpose: event.target.value }))}
            className="min-h-24"
            showCounter
          />
          <Textarea
            label="مقدمه"
            value={shareForm.introduction}
            onChange={(event) => setShareForm(prev => ({ ...prev, introduction: event.target.value }))}
            className="min-h-24"
            showCounter
          />
          <Textarea
            label="توضیحات"
            value={shareForm.description}
            maxLength={700}
            showCounter
            onChange={(event) => setShareForm(prev => ({ ...prev, description: event.target.value }))}
            className="min-h-32"
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label="شناسه Ticket (اختیاری)"
              value={shareForm.ticketId}
              onChange={(event) => setShareForm(prev => ({ ...prev, ticketId: event.target.value }))}
              dir="ltr"
              className="text-left font-mono"
              placeholder="INC-12345"
            />
            <Input
              label="آدرس Ticket (اختیاری)"
              value={shareForm.ticketUrl}
              onChange={(event) => setShareForm(prev => ({ ...prev, ticketUrl: event.target.value }))}
              dir="ltr"
              className="text-left font-mono"
              placeholder="https://itsm.example/ticket/123"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShareModalOpen(false)}>انصراف</Button>
            <Button icon={<Upload className="h-4 w-4" />} onClick={handleShareSubmit}>ثبت درخواست</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={shareConfirmOpen} onClose={() => setShareConfirmOpen(false)} title="ارسال برای تأیید مدیرسیستم" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">آیا از ارسال درخواست اشتراک برای بررسی مطمئن هستید؟</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShareConfirmOpen(false)} disabled={sharing}>انصراف</Button>
            <Button onClick={handleConfirmShare} loading={sharing}>ارسال برای بررسی</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={repositoryModalOpen} onClose={() => setRepositoryModalOpen(false)} title="Preview API Repository" size="wide">
        {repositoryDetail ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr]">
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-gray-900">{repositoryDetail.title}</h3>
                  <Badge variant="default">v{repositoryDetail.version}</Badge>
                  <Badge variant={sharingBadgeVariant(repositoryDetail.sharingStatus)}>
                    {API_SHARING_STATUS_LABELS[repositoryDetail.sharingStatus]}
                  </Badge>
                  {repositoryDetail.sharingStatus === 'DEPRECATED' && <Badge variant="danger">DEPRECATED</Badge>}
                  {repositoryDetail.breakingChange || repositoryDetail.request?.breakingChange ? <Badge variant="warning">Breaking</Badge> : null}
                  {repositoryDetail.isNewForUser && <Badge variant="success">جدید</Badge>}
                  {repositoryDetail.hasNewerVersion && <Badge variant="warning">نسخه جدید موجود است</Badge>}
                </div>
                <p className="mt-2 text-sm text-gray-600">{repositoryDetail.description || '-'}</p>
                <p className="mt-2 font-mono text-xs text-gray-500" dir="ltr">{repositoryDetail.method} {repositoryDetail.urlTemplate}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoTile label="API ID" value={repositoryDetail.apiId} />
                <InfoTile label="Version" value={repositoryDetail.version} />
                <InfoTile label="Classification" value={repositoryDetail.classification.type} />
                <InfoTile label="Latest" value={repositoryDetail.latestVersion} />
                <InfoTile label="Ticket ID" value={repositoryDetail.ticketId || repositoryDetail.shareRequest?.ticketId || '-'} />
                <InfoTile
                  label="Ticket URL"
                  value={repositoryDetail.ticketUrl || repositoryDetail.shareRequest?.ticketUrl || '-'}
                />
              </div>
              {repositoryDetail.changeLog && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                  <span className="font-semibold">Change Log: </span>{repositoryDetail.changeLog}
                </div>
              )}
                  {repositoryDetail.breakingChange || repositoryDetail.request?.breakingChange ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <span className="font-semibold">Breaking Change</span>
                  {(repositoryDetail.migrationNote || repositoryDetail.request?.migrationNote) && (
                    <p className="mt-1"><span className="font-semibold">Migration: </span>{repositoryDetail.migrationNote || repositoryDetail.request?.migrationNote}</p>
                  )}
                </div>
              ) : null}
              {repositoryDetail.sharingStatus === 'DEPRECATED' && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <span className="font-semibold">منسوخ‌شده: </span>
                  {repositoryDetail.deprecationReason || repositoryDetail.request?.deprecationReason || 'این نسخه DEPRECATED است و قابل افزودن به Console نیست.'}
                </div>
              )}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-blue-600" />
                    <FieldLabel>مصرف‌کنندگان مجاز</FieldLabel>
                  </div>
                  {canUpdateRepositoryConsumers && (
                    <Button
                      size="sm"
                      variant={repositoryConsumerEditMode ? 'secondary' : 'ghost'}
                      icon={<Edit3 className="h-4 w-4" />}
                      onClick={() => {
                        setRepositoryConsumerIds(repositoryDetail.consumers.map(consumerIdOf));
                        setRepositoryConsumerEditMode(value => !value);
                      }}
                      disabled={repositoryConsumersSaving}
                    >
                      {repositoryConsumerEditMode ? 'لغو ویرایش' : 'ویرایش دسترسی'}
                    </Button>
                  )}
                </div>
                {repositoryConsumerEditMode ? (
                  <div className="space-y-3">
                    <ConsumerPicker
                      candidates={consumerCandidates}
                      selectedIds={repositoryConsumerIds}
                      onToggle={(id) => setRepositoryConsumerIds(prev =>
                        prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
                      )}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setRepositoryConsumerIds(repositoryDetail.consumers.map(consumerIdOf));
                          setRepositoryConsumerEditMode(false);
                        }}
                        disabled={repositoryConsumersSaving}
                      >
                        انصراف
                      </Button>
                      <Button onClick={handleRepositoryConsumersSave} loading={repositoryConsumersSaving} disabled={!repositoryConsumerIds.length}>
                        ذخیره دسترسی‌ها
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ConsumerAccessList consumers={repositoryDetail.consumers} candidates={consumerCandidates} />
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setRepositoryModalOpen(false)}>بستن</Button>
                <Button
                  variant="secondary"
                  icon={<Download className="h-4 w-4" />}
                  loading={exportingOpenApiId === `${repositoryDetail.apiId}:${repositoryDetail.version}`}
                  onClick={() => { void handleExportRepositoryOpenApi(repositoryDetail.apiId, repositoryDetail.version); }}
                >
                  OpenAPI
                </Button>
                {repositoryDetail.sharingStatus !== 'DEPRECATED' && canReviewShares && (
                  <Button
                    variant="warning"
                    onClick={() => {
                      setDeprecateForm({ reason: '', effectiveAt: '' });
                      setDeprecateModalOpen(true);
                    }}
                  >
                    Deprecate
                  </Button>
                )}
                <Button
                  onClick={handleAddRepositoryVersion}
                  disabled={!!repositoryDetail.referenceId || repositoryDetail.sharingStatus === 'DEPRECATED'}
                >
                  {repositoryDetail.sharingStatus === 'DEPRECATED'
                    ? 'منسوخ‌شده'
                    : repositoryDetail.referenceId
                      ? 'قبلاً اضافه شده'
                      : 'استفاده از API'}
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              <FieldLabel>Snapshot فنی</FieldLabel>
              <RepositoryTechnicalSnapshotPanel item={repositoryDetail} />
            </div>
          </div>
        ) : (
          <LoadingState label="در حال بارگذاری Repository item..." className="py-10" />
        )}
      </Modal>

      <Modal isOpen={reviewModalOpen} onClose={() => setReviewModalOpen(false)} title="بررسی درخواست اشتراک API" size="wide">
        {reviewDetail ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr]">
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-gray-900">{reviewDetail.apiTitle}</h3>
                  <Badge variant={sharingBadgeVariant(reviewDetail.status)}>{API_SHARING_STATUS_LABELS[reviewDetail.status]}</Badge>
                  <Badge variant="default">v{reviewDetail.version}</Badge>
                </div>
                <p className="mt-2 text-sm text-gray-600">ثبت‌کننده: {reviewDetail.submittedByName || reviewDetail.submittedBy}</p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <InfoTile label="API ID" value={reviewDetail.apiId} />
                <InfoTile label="Revision" value={String(reviewDetail.currentRevisionNumber)} />
                <InfoTile label="Row Version" value={reviewDetail.rowVersion} />
              </div>
              <div className="space-y-2 text-sm text-gray-700">
                <p><span className="font-semibold">هدف: </span>{reviewDetail.purpose || '-'}</p>
                <p><span className="font-semibold">مقدمه: </span>{reviewDetail.introduction || '-'}</p>
                <p><span className="font-semibold">توضیحات: </span>{reviewDetail.description || '-'}</p>
              </div>
              <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
                <FieldLabel>Ticket / ITSM</FieldLabel>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Input
                    label="شناسه Ticket"
                    value={reviewTicketForm.ticketId}
                    onChange={(event) => setReviewTicketForm(prev => ({ ...prev, ticketId: event.target.value }))}
                    dir="ltr"
                    className="text-left font-mono"
                  />
                  <Input
                    label="آدرس Ticket"
                    value={reviewTicketForm.ticketUrl}
                    onChange={(event) => setReviewTicketForm(prev => ({ ...prev, ticketUrl: event.target.value }))}
                    dir="ltr"
                    className="text-left font-mono"
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => { void handleSaveReviewTicket(); }} loading={reviewTicketSaving}>
                    ذخیره Ticket
                  </Button>
                </div>
              </div>
              <div>
                <FieldLabel>Consumerها</FieldLabel>
                <div className="max-h-60 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {consumerCandidates.map(candidate => (
                    <label key={candidate.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedConsumerIds.includes(candidate.id)}
                        onChange={() => setSelectedConsumerIds(prev =>
                          prev.includes(candidate.id) ? prev.filter(id => id !== candidate.id) : [...prev, candidate.id]
                        )}
                        className="mt-1 rounded border-gray-300 text-blue-600"
                      />
                      <span>
                        <span className="font-medium text-gray-900">{consumerCandidateLabel(candidate)}</span>
                        <span className="mr-2 text-xs text-gray-500">{CONSUMER_TYPE_LABELS[candidate.consumerType]}</span>
                        <span className="block text-xs text-gray-500">{consumerCandidateDescription(candidate)}</span>
                      </span>
                    </label>
                  ))}
                  {!consumerCandidates.length && <p className="p-3 text-sm text-gray-500">هنوز دولوپری از طریق ورود CDE در دایرکتوری این سامانه همگام نشده است.</p>}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <FieldLabel>چک‌لیست Review</FieldLabel>
                <div className="mt-2 space-y-2">
                  {REVIEW_CHECKLIST_LABELS.map(item => (
                    <label key={item.key} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={reviewChecklist[item.key]}
                        disabled={reviewDetail.status !== 'PENDING_REVIEW'}
                        onChange={(event) => void handleReviewChecklistChange({ [item.key]: event.target.checked })}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <FieldLabel>نظرات</FieldLabel>
                <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                  {(reviewDetail.comments || []).map(comment => (
                    <div key={comment.id} className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-sm">
                      <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                        <span>{comment.authorName || comment.authorId}</span>
                        <span dir="ltr">{formatDate(comment.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-gray-800">{comment.text}</p>
                    </div>
                  ))}
                  {!reviewDetail.comments?.length && <p className="text-xs text-gray-500">هنوز نظری ثبت نشده است.</p>}
                </div>
                <div className="mt-3 space-y-2">
                  <Textarea
                    label="نظر جدید"
                    value={reviewCommentText}
                    onChange={(event) => setReviewCommentText(event.target.value)}
                    className="min-h-20"
                  />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => void handleAddReviewComment()} loading={reviewCommentSaving}>
                      ثبت نظر
                    </Button>
                  </div>
                </div>
              </div>
              {reviewDetail.status === 'PENDING_REVIEW' && (
                <div className="flex justify-end gap-2">
                  <Button variant="warning" onClick={() => setReturnModalOpen(true)}>بازگردانی</Button>
                  <Button
                    onClick={() => setApproveModalOpen(true)}
                    disabled={!selectedConsumerIds.length || !REVIEW_CHECKLIST_LABELS.every(item => reviewChecklist[item.key])}
                  >
                    تأیید و انتشار
                  </Button>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <RevisionSnapshotPanel review={reviewDetail} />
            </div>
          </div>
        ) : (
          <LoadingState label="در حال بارگذاری review..." className="py-10" />
        )}
      </Modal>

      <Modal isOpen={approveModalOpen} onClose={() => setApproveModalOpen(false)} title="تأیید انتشار API" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Approval نیازمند تکمیل چک‌لیست و انتخاب حداقل یک Consumer است. بعد از تأیید، نسخه در Repository منتشر می‌شود.</p>
          <ul className="space-y-1 text-xs text-gray-600">
            {REVIEW_CHECKLIST_LABELS.map(item => (
              <li key={item.key}>{reviewChecklist[item.key] ? '✓' : '○'} {item.label}</li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setApproveModalOpen(false)} disabled={reviewActionLoading}>انصراف</Button>
            <Button onClick={handleApproveReview} loading={reviewActionLoading}>تأیید</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={returnModalOpen} onClose={() => setReturnModalOpen(false)} title="بازگردانی درخواست اشتراک" size="md">
        <div className="space-y-4">
          <Textarea
            label="دلیل بازگردانی"
            value={returnReason}
            onChange={(event) => setReturnReason(event.target.value)}
            className="min-h-32"
            showCounter
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReturnModalOpen(false)} disabled={reviewActionLoading}>انصراف</Button>
            <Button variant="warning" onClick={handleReturnReview} loading={reviewActionLoading}>بازگردانی</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!adminRoleTarget}
        onClose={() => setAdminRoleTarget(null)}
        title={adminRoleTarget?.enabled ? `افزودن نقش ${roleLabel(adminRoleTarget.role)}` : `لغو نقش ${roleLabel(adminRoleTarget?.role || 'DEVELOPER')}`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {adminRoleTarget?.enabled
              ? `آیا نقش «${roleLabel(adminRoleTarget.role)}» برای «${adminRoleTarget.user.fullName}» فعال شود؟`
              : `آیا نقش «${roleLabel(adminRoleTarget?.role || 'DEVELOPER')}» از «${adminRoleTarget?.user.fullName || ''}» گرفته شود؟`}
          </p>
          {adminRoleTarget?.enabled && adminRoleTarget.role !== 'SYSTEM_ADMIN' && (
            <ApplicationSelect
              label="محدوده سامانه"
              value={adminRoleTarget.applicationId}
              onChange={(applicationId) => setAdminRoleTarget(prev => prev ? { ...prev, applicationId } : prev)}
              includeAllOption
              hint="می‌توانید نقش را به یک سامانه محدود کنید یا ALL را برای همه نگه دارید."
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdminRoleTarget(null)} disabled={adminRoleSaving}>انصراف</Button>
            <Button
              variant={adminRoleTarget?.enabled ? 'primary' : 'danger'}
              onClick={handleSystemAdminChange}
              loading={adminRoleSaving}
            >
              {adminRoleTarget?.enabled ? 'تأیید و افزودن' : 'لغو نقش'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={versionModalOpen} onClose={() => setVersionModalOpen(false)} title="ایجاد Version جدید API" size="md">
        <div className="space-y-4">
          <Input
            label="Version جدید"
            value={versionForm.version}
            onChange={(event) => setVersionForm(prev => ({ ...prev, version: event.target.value }))}
            placeholder="مثلاً 1.1.0"
            hint="فرمت باید SemVer باشد و از Version فعلی بزرگ‌تر باشد."
            dir="ltr"
          />
          <Textarea
            label="Change Log"
            value={versionForm.changeLog}
            onChange={(event) => setVersionForm(prev => ({ ...prev, changeLog: event.target.value }))}
            className="min-h-32"
            showCounter
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={versionForm.breakingChange}
              onChange={(event) => setVersionForm(prev => ({ ...prev, breakingChange: event.target.checked }))}
              className="rounded border-gray-300 text-blue-600"
            />
            Breaking Change
          </label>
          {versionForm.breakingChange && (
            <Textarea
              label="Migration Note"
              value={versionForm.migrationNote}
              onChange={(event) => setVersionForm(prev => ({ ...prev, migrationNote: event.target.value }))}
              className="min-h-24"
              hint="برای Breaking Change الزامی است."
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setVersionModalOpen(false)} disabled={versioning}>انصراف</Button>
            <Button onClick={handleCreateVersion} loading={versioning}>ساخت Version</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={collectionRunModalOpen} onClose={() => setCollectionRunModalOpen(false)} title="اجرای Collection" size="lg">
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={collectionRunStopOnFail}
              onChange={(event) => setCollectionRunStopOnFail(event.target.checked)}
              className="rounded border-gray-300 text-blue-600"
            />
            توقف در اولین شکست (stopOnFail)
          </label>
          <div className="flex justify-end">
            <Button icon={<PlayCircle className="h-4 w-4" />} onClick={() => void handleCollectionRun()} loading={collectionRunning}>
              Run
            </Button>
          </div>
          {latestCollectionRun && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <p className="font-semibold text-gray-900">خلاصه اجرا</p>
              <p className="mt-1 text-gray-700">
                کل: {latestCollectionRun.summary.total} · موفق: {latestCollectionRun.summary.passed} · ناموفق: {latestCollectionRun.summary.failed} · ردشده: {latestCollectionRun.summary.skipped}
              </p>
              <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                {latestCollectionRun.results.map(result => (
                  <div key={`${result.requestId}-${result.status}`} className="flex items-center justify-between gap-2 font-mono text-xs" dir="ltr">
                    <span>{result.name}</span>
                    <Badge size="sm" variant={result.status === 'PASSED' ? 'success' : result.status === 'FAILED' ? 'danger' : 'default'}>
                      {result.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <FieldLabel>اجراهای اخیر</FieldLabel>
            <div className="mt-2 space-y-2">
              {recentTestRuns.map(run => (
                <div key={run.id} className="rounded border border-gray-200 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono" dir="ltr">{run.id}</span>
                    <span dir="ltr">{formatDate(run.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-gray-600">
                    passed {run.summary.passed} / failed {run.summary.failed} / skipped {run.summary.skipped}
                  </p>
                </div>
              ))}
              {!recentTestRuns.length && <p className="text-sm text-gray-500">هنوز Test Run ثبت نشده است.</p>}
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={deprecateModalOpen} onClose={() => setDeprecateModalOpen(false)} title="منسوخ‌سازی نسخه API" size="md">
        <div className="space-y-4">
          <Textarea
            label="دلیل منسوخ‌سازی"
            value={deprecateForm.reason}
            onChange={(event) => setDeprecateForm(prev => ({ ...prev, reason: event.target.value }))}
            className="min-h-28"
          />
          <Input
            label="تاریخ اعمال (اختیاری)"
            value={deprecateForm.effectiveAt}
            onChange={(event) => setDeprecateForm(prev => ({ ...prev, effectiveAt: event.target.value }))}
            placeholder="ISO datetime"
            dir="ltr"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeprecateModalOpen(false)} disabled={deprecating}>انصراف</Button>
            <Button variant="warning" onClick={() => void handleDeprecateVersion()} loading={deprecating}>Deprecate</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} title="جستجوی سراسری Workspace" size="lg">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              aria-label="عبارت جستجو"
              autoFocus
              value={globalSearchQuery}
              onChange={(event) => setGlobalSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runGlobalSearch();
              }}
              placeholder="Request / Repository / Discovery — Ctrl+K"
              dir="ltr"
            />
            <Button onClick={() => { void runGlobalSearch(); }} loading={globalSearchLoading}>جستجو</Button>
          </div>
          <div className="max-h-96 space-y-2 overflow-auto">
            {globalSearchHits.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">{globalSearchLoading ? 'در حال جستجو…' : 'نتیجه‌ای نیست'}</p>
            ) : (
              globalSearchHits.map(hit => (
                <button
                  key={`${hit.kind}-${hit.id}`}
                  type="button"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-right hover:bg-gray-50"
                  onClick={() => {
                    setGlobalSearchOpen(false);
                    if (hit.kind === 'request') {
                      setWorkspaceView('requests');
                      void reloadRequests(hit.id);
                    } else if (hit.kind === 'repository') {
                      setWorkspaceView('repository');
                      setRepositoryFilters(prev => ({ ...prev, search: hit.title, page: 1 }));
                    } else {
                      setWorkspaceView('runtime');
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Badge size="sm" variant={hit.kind === 'request' ? 'info' : hit.kind === 'repository' ? 'success' : 'warning'}>{hit.kind}</Badge>
                    <span className="font-medium text-gray-900">{hit.title}</span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-gray-500" dir="ltr">{hit.subtitle}</p>
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={collectionModalOpen} onClose={() => setCollectionModalOpen(false)} title="Collection جدید" size="md">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-[var(--theme-text)]">نوع Collection</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setCollectionForm(prev => ({
                  ...prev,
                  bindMode: 'free',
                  applicationId: PERSONAL_APPLICATION_ID,
                }))}
                className={`rounded-xl border px-3 py-3 text-right transition ${
                  collectionForm.bindMode === 'free'
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
                    : 'border-[var(--theme-border)] hover:bg-[var(--theme-surface-muted)]'
                }`}
              >
                <div className="text-sm font-semibold text-[var(--theme-text)]">آزاد / شخصی</div>
                <div className="mt-1 text-xs text-[var(--theme-text-subtle)]">مثل Postman — بدون الزام سامانه CDE</div>
              </button>
              <button
                type="button"
                onClick={() => setCollectionForm(prev => ({
                  ...prev,
                  bindMode: 'system',
                  applicationId: prev.applicationId === PERSONAL_APPLICATION_ID ? '' : prev.applicationId,
                }))}
                className={`rounded-xl border px-3 py-3 text-right transition ${
                  collectionForm.bindMode === 'system'
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
                    : 'border-[var(--theme-border)] hover:bg-[var(--theme-surface-muted)]'
                }`}
              >
                <div className="text-sm font-semibold text-[var(--theme-text)]">متصل به سامانه</div>
                <div className="mt-1 text-xs text-[var(--theme-text-subtle)]">برای همگام‌سازی و Requestهای CDE</div>
              </button>
            </div>
          </div>

          {collectionForm.bindMode === 'system' ? (
            <ApplicationSelect
              label="سامانه"
              required
              value={collectionForm.applicationId}
              onChange={(applicationId) => setCollectionForm(prev => ({ ...prev, applicationId }))}
              placeholder="جستجو و انتخاب سامانه"
              searchPlaceholder="نام سامانه را تایپ کنید…"
              hint="فقط وقتی لازم است Requestها به یک پروژه CDE وصل شوند."
            />
          ) : null}

          <Input
            label="نام Collection"
            value={collectionForm.name}
            onChange={(event) => setCollectionForm(prev => ({ ...prev, name: event.target.value }))}
            placeholder={collectionForm.bindMode === 'free' ? 'مثلاً نقشه و موقعیت مکانی' : 'مثلاً Core Queries'}
          />

          <div>
            <button
              type="button"
              className="text-xs text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
              onClick={() => setCollectionAdvancedOpen(open => !open)}
            >
              {collectionAdvancedOpen ? 'بستن توضیحات' : 'توضیحات (اختیاری)'}
            </button>
            {collectionAdvancedOpen ? (
              <Textarea
                className="mt-2 min-h-20"
                value={collectionForm.description}
                onChange={(event) => setCollectionForm(prev => ({ ...prev, description: event.target.value }))}
                placeholder="توضیح کوتاه برای این گروه از Requestها"
              />
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCollectionModalOpen(false)}>انصراف</Button>
            <Button
              icon={<FolderPlus className="h-4 w-4" />}
              onClick={handleCreateCollection}
              disabled={
                !canCreate
                || !collectionForm.name.trim()
                || (collectionForm.bindMode === 'system' && !collectionForm.applicationId)
              }
            >
              ساخت Collection
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="حذف Request" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            این Request از جدول فعال حذف می‌شود اما برای audit و history به‌صورت Archived نگه‌داری خواهد شد.
          </p>
          {deleteTarget && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-900">{deleteTarget.name}</p>
              <p className="mt-1 truncate text-left font-mono text-xs text-gray-500" dir="ltr">{deleteTarget.method} {deleteTarget.urlTemplate}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>انصراف</Button>
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={handleConfirmSoftDelete} disabled={!canDelete}>
              حذف
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={manualModalOpen} onClose={() => setManualModalOpen(false)} title="نمونه Response دستی" size="xl">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Input
            label="Status code"
            type="number"
            value={manualForm.statusCode}
            onChange={(event) => setManualForm(prev => ({ ...prev, statusCode: Number(event.target.value) }))}
          />
          <Input
            label="Source"
            value={manualForm.source}
            onChange={(event) => setManualForm(prev => ({ ...prev, source: event.target.value }))}
            placeholder="Ticket، analyst، imported evidence یا vendor email"
          />
          <Textarea
            label="Headers"
            value={manualForm.headersText}
            onChange={(event) => setManualForm(prev => ({ ...prev, headersText: event.target.value }))}
            className="min-h-32 text-left font-mono"
            dir="ltr"
          />
          <Textarea
            label="دلیل Manual entry"
            value={manualForm.reason}
            onChange={(event) => setManualForm(prev => ({ ...prev, reason: event.target.value }))}
            className="min-h-32"
          />
          <div className="lg:col-span-2">
            <Textarea
              label="Body"
              value={manualForm.body}
              onChange={(event) => setManualForm(prev => ({ ...prev, body: event.target.value }))}
              className="min-h-72 text-left font-mono"
              dir="ltr"
            />
          </div>
          <div className="flex justify-end gap-2 lg:col-span-2">
            <Button variant="secondary" onClick={() => setManualModalOpen(false)}>انصراف</Button>
            <Button onClick={handleManualResponse}>ذخیره Manual Example</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={productionModalOpen} onClose={() => setProductionModalOpen(false)} title={selectedRequest?.runtimeBinding ? 'Runtime Core Command Confirmation' : 'Production Core Command Confirmation'} size="lg">
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            این Request به عنوان {selectedRequest?.runtimeBinding ? 'Runtime Core Command' : 'Production Core Command'} تشخیص داده شده است. قبل از Execution مقصد، Service ID و operation path را تأیید کنید.
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <FieldLabel>Environment</FieldLabel>
              <p className="font-medium text-gray-900">{selectedEnvironment?.name}</p>
            </div>
            <div>
              <FieldLabel>Service ID</FieldLabel>
              <p className="font-mono text-sm text-gray-900" dir="ltr">{selectedRequest?.classification.serviceId || '-'}</p>
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Operation path</FieldLabel>
              <p className="font-mono text-sm text-gray-900" dir="ltr">{selectedRequest?.classification.operationPath || '-'}</p>
            </div>
          </div>
          <Textarea
            label="دلیل کسب‌وکاری"
            value={productionForm.reason}
            onChange={(event) => setProductionForm(prev => ({ ...prev, reason: event.target.value }))}
            className="min-h-32"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={productionForm.confirmed}
              onChange={(event) => setProductionForm(prev => ({ ...prev, confirmed: event.target.checked }))}
              className="rounded border-gray-300"
            />
            تأیید می‌کنم این Core Command روی محیط انتخاب‌شده مجاز است.
          </label>
          {selectedEnvironment?.kind === 'PRODUCTION' && selectedRequest?.classification.type === 'CORE_COMMAND' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-2">در صورت فعال بودن Dual Approval، قبل از اجرا باید تأیید نفر دوم را داشته باشید.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={dualApprovalBusy}
                  onClick={() => {
                    void (async () => {
                      if (!activeContext || !selectedRequest) return;
                      const reason = productionForm.reason.trim() || window.prompt('دلیل Dual Approval') || '';
                      if (!reason.trim()) {
                        toast.warning('دلیل Dual Approval الزامی است.');
                        return;
                      }
                      setDualApprovalBusy(true);
                      try {
                        await apiConsoleApi.requestDualApproval(selectedRequest.id, reason.trim(), activeContext);
                        setDualApprovalStatus('PENDING');
                        toast.success('درخواست Dual Approval ثبت شد.');
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : 'ثبت Dual Approval ناموفق بود.');
                      } finally {
                        setDualApprovalBusy(false);
                      }
                    })();
                  }}
                >
                  درخواست Dual Approval
                </Button>
                {dualApprovalStatus !== 'UNKNOWN' && (
                  <Badge size="sm" variant={dualApprovalStatus === 'ACTIVE' ? 'success' : 'warning'}>{dualApprovalStatus}</Badge>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setProductionModalOpen(false)}>انصراف</Button>
            <Button
              variant="danger"
              disabled={!productionForm.confirmed || (!selectedRequest?.runtimeBinding && !productionForm.reason.trim())}
              onClick={() => executeSelected({ productionCommandConfirmed: productionForm.confirmed, businessJustification: productionForm.reason })}
            >
              اجرای Command
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={selfCheckOpen} onClose={() => setSelfCheckOpen(false)} title="تست داخلی API Console" size="xl">
        {selfCheck && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StatCard title="Passed" value={selfCheck.passed} variant="success" icon={<CheckCircle className="h-6 w-6" />} />
              <StatCard title="Failed" value={selfCheck.failed} variant={selfCheck.failed ? 'danger' : 'success'} icon={<XCircle className="h-6 w-6" />} />
            </div>
            <Table
              columns={[
                { key: 'name', title: 'Check', render: (item: ParserSelfCheckDetail) => item.name },
                { key: 'passed', title: 'Result', render: (item: ParserSelfCheckDetail) => <Badge variant={item.passed ? 'success' : 'danger'}>{item.passed ? 'Passed' : 'Failed'}</Badge> },
                { key: 'message', title: 'Message', render: (item: ParserSelfCheckDetail) => item.message || '-' },
              ]}
              data={selfCheck.details}
              enableClientFilter={false}
              enableColumnChooser={false}
              enableExport={false}
            />
          </div>
        )}
      </Modal>
    </>
  );
};

const KeyValueEditor = ({
  rows,
  onChange,
  onAdd,
  valueKey,
  title,
}: {
  rows: ApiKeyValueParameter[];
  onChange: (rows: ApiKeyValueParameter[]) => void;
  onAdd: () => void;
  valueKey: 'value';
  title: string;
}) => {
  const update = (id: string, patch: Partial<ApiKeyValueParameter>) =>
    onChange(rows.map(row => row.id === id ? { ...row, ...patch } : row));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>افزودن</Button>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-2 lg:grid-cols-[44px_1fr_1fr_100px_44px]">
            <input type="checkbox" checked={row.enabled} onChange={(event) => update(row.id, { enabled: event.target.checked })} className="m-auto" />
            <input value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} placeholder="name" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <input value={row[valueKey]} onChange={(event) => update(row.id, { [valueKey]: event.target.value })} placeholder="value" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={!!row.sensitive} onChange={(event) => update(row.id, { sensitive: event.target.checked })} />
              Sensitive
            </label>
            <button type="button" onClick={() => onChange(rows.filter(item => item.id !== row.id).map((item, idx) => ({ ...item, displayOrder: idx })))} className="rounded-lg text-red-600 hover:bg-red-50">
              <Trash2 className="mx-auto h-4 w-4" />
            </button>
            <input type="hidden" value={index} readOnly />
          </div>
        ))}
      </div>
    </div>
  );
};

const HeaderEditor = ({ rows, onChange, onAdd }: { rows: ApiRequestHeader[]; onChange: (rows: ApiRequestHeader[]) => void; onAdd: () => void }) => {
  const update = (id: string, patch: Partial<ApiRequestHeader>) =>
    onChange(rows.map(row => row.id === id ? { ...row, ...patch, maskedValue: patch.valueTemplate ?? row.maskedValue } : row));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">Headers</h3>
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>افزودن</Button>
      </div>
      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.id} className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 lg:grid-cols-[44px_1fr_1.5fr_150px_110px_44px]">
            <input type="checkbox" checked={row.enabled} onChange={(event) => update(row.id, { enabled: event.target.checked })} className="m-auto" />
            <input value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} placeholder="نام Header" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <input value={row.valueTemplate} onChange={(event) => update(row.id, { valueTemplate: event.target.value })} placeholder="Value یا {{variable}}" className="rounded border border-gray-300 px-2 py-1 text-left font-mono text-sm" dir="ltr" />
            <Select
              value={row.category}
              onChange={(event) => update(row.id, { category: event.target.value as ApiHeaderCategory })}
              options={Object.entries(HEADER_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={row.sensitive} onChange={(event) => update(row.id, { sensitive: event.target.checked })} />
              Sensitive
            </label>
            <button type="button" onClick={() => onChange(rows.filter(item => item.id !== row.id))} className="rounded-lg text-red-600 hover:bg-red-50">
              <Trash2 className="mx-auto h-4 w-4" />
            </button>
            <p className="text-xs text-gray-500 lg:col-span-6">{row.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const CookieEditor = ({ rows, onChange, onAdd }: { rows: ApiRequestCookie[]; onChange: (rows: ApiRequestCookie[]) => void; onAdd: () => void }) => {
  const update = (id: string, patch: Partial<ApiRequestCookie>) =>
    onChange(rows.map(row => row.id === id ? { ...row, ...patch } : row));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">Cookies</h3>
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>افزودن</Button>
      </div>
      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.id} className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 lg:grid-cols-[44px_1fr_1.5fr_1fr_1fr_110px_44px]">
            <input type="checkbox" checked={row.enabled} onChange={(event) => update(row.id, { enabled: event.target.checked })} className="m-auto" />
            <input value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} placeholder="نام Cookie" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <input value={row.valueReference} onChange={(event) => update(row.id, { valueReference: event.target.value })} placeholder="Value یا {{secret}}" className="rounded border border-gray-300 px-2 py-1 text-left font-mono text-sm" dir="ltr" />
            <input value={row.domain || ''} onChange={(event) => update(row.id, { domain: event.target.value })} placeholder="Domain" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <input value={row.path || ''} onChange={(event) => update(row.id, { path: event.target.value })} placeholder="Path" className="rounded border border-gray-300 px-2 py-1 text-sm" />
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={row.sensitive} onChange={(event) => update(row.id, { sensitive: event.target.checked })} />
              Sensitive
            </label>
            <button type="button" onClick={() => onChange(rows.filter(item => item.id !== row.id))} className="rounded-lg text-red-600 hover:bg-red-50">
              <Trash2 className="mx-auto h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const CoreDetailsEditor = ({
  request,
  enabled,
  onToggle,
  onCorePatch,
  onPayloadPatch,
}: {
  request: ApiRequestDefinition;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onCorePatch: (patch: Record<string, unknown>) => void;
  onPayloadPatch: (field: 'data' | 'params', raw: string) => void;
}) => {
  const parsed = parseJson(request.bodyTemplate);
  const body = parsed.ok ? asRecord(parsed.value) : {};
  const isCommand = request.classification.type === 'CORE_COMMAND';
  const isQuery = request.classification.type === 'CORE_QUERY';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">Core-aware presentation</h3>
          <p className="text-sm text-gray-500">Core form و raw JSON editor روی همان request body مشترک کار می‌کنند.</p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} label={enabled ? 'فعال' : 'فقط Generic editor'} />
      </div>
      {!enabled && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          Core-aware UI مخفی است. این Request همچنان مثل HTTP معمولی قابل edit و execution است.
        </div>
      )}
      {enabled && request.classification.type === 'GENERIC_HTTP' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          این Request با conventionهای Core Query یا Core Command match نیست. برای edit به شکل Generic HTTP از تب Body استفاده کنید.
        </div>
      )}
      {enabled && request.classification.type !== 'GENERIC_HTTP' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <FieldLabel>Core type</FieldLabel>
              <Badge variant={isCommand ? 'danger' : 'info'}>{isCommand ? 'Command' : 'Query'}</Badge>
            </div>
            <Input
              label="Service ID"
              value={String(body.serviceId || '')}
              onChange={(event) => onCorePatch({ serviceId: event.target.value })}
              dir="ltr"
              className="text-left font-mono"
            />
            <Input
              label="Core endpoint"
              value={request.classification.endpoint || ''}
              readOnly
              dir="ltr"
              className="text-left font-mono"
            />
            {isCommand && (
              <Input
                label="Form ID"
                value={String(body.formId || '')}
                onChange={(event) => onCorePatch({ formId: event.target.value })}
                dir="ltr"
                className="text-left font-mono"
              />
            )}
            {isQuery && (
              <Input
                label="Key"
                value={String(body.key || '')}
                onChange={(event) => onCorePatch({ key: event.target.value })}
                dir="ltr"
                className="text-left font-mono"
              />
            )}
          </div>
          <Textarea
            label={isCommand ? 'Data payload (fr)' : 'Params payload (ds)'}
            value={JSON.stringify(isCommand ? body.data || {} : body.params || {}, null, 2)}
            onChange={(event) => onPayloadPatch(isCommand ? 'data' : 'params', event.target.value)}
            className="min-h-72 text-left font-mono"
            dir="ltr"
            hint={isCommand
              ? 'مثال: { "id": "...", "actor_role": "hq", "repositoryId": "..." }'
              : 'مثال: { "viewerRole": "hq", "sortBy": "published_at", "sortOrder": "DESC", "limit": 20, "offset": 0 }'}
          />
        </div>
      )}
    </div>
  );
};

const ScriptsPanel = ({
  scripts,
  onChange,
}: {
  scripts: ReturnType<typeof defaultScripts>;
  onChange: (scripts: ReturnType<typeof defaultScripts>) => void;
}) => {
  const update = (patch: Partial<ReturnType<typeof defaultScripts>>) => onChange({ ...scripts, ...patch });

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        Scriptها روی backend Runner با commandهای امن اجرا می‌شوند؛ JavaScript آزاد، eval و دسترسی به سیستم‌عامل پشتیبانی نمی‌شود.
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-gray-900">Pre-request</h3>
              <p className="text-xs text-gray-500">قبل از resolve variables و ارسال Request اجرا می‌شود.</p>
            </div>
            <Toggle checked={scripts.preRequestEnabled} onChange={(checked) => update({ preRequestEnabled: checked })} label="فعال" />
          </div>
          <Textarea
            value={scripts.preRequest}
            onChange={(event) => update({ preRequest: event.target.value })}
            className="min-h-48 text-left font-mono sm:min-h-[360px]"
            dir="ltr"
          />
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            <p className="font-semibold text-gray-800">Commandهای مجاز:</p>
            <CodeBlock
              minHeight="min-h-20"
              value={[
                'setVar("page", "0")',
                'setHeader("x-trace-id", "{{traceId}}")',
                'setQuery("page", "1")',
                'setJsonBody("$.params.page", 0)',
                'setCookie("session", "{{token}}")',
              ].join('\n')}
            />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-gray-900">Post-response</h3>
              <p className="text-xs text-gray-500">بعد از دریافت Response اجرا می‌شود و روی Business result اثر می‌گذارد.</p>
            </div>
            <Toggle checked={scripts.postResponseEnabled} onChange={(checked) => update({ postResponseEnabled: checked })} label="فعال" />
          </div>
          <Textarea
            value={scripts.postResponse}
            onChange={(event) => update({ postResponse: event.target.value })}
            className="min-h-48 text-left font-mono sm:min-h-[360px]"
            dir="ltr"
          />
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            <p className="font-semibold text-gray-800">Commandهای تست:</p>
            <CodeBlock
              minHeight="min-h-20"
              value={[
                'testStatus(200)',
                'testStatusIn(200, 201, 204)',
                'testResponseTimeBelow(5000)',
                'testHeaderContains("content-type", "json")',
                'testJsonPath("$.data")',
                'testJsonEquals("$.status", "OK")',
                'testBodyContains("success")',
              ].join('\n')}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const SettingsPanel = ({
  request,
  environment,
  collection,
  effectiveRequest,
  canManageTls,
  ownershipSaving,
  transferUserId,
  coOwnersInput,
  onTransferUserIdChange,
  onCoOwnersInputChange,
  onVisibilityChange,
  onTransfer,
  onSaveCoOwners,
  onChange,
}: {
  request: ApiRequestDefinition;
  environment?: ApiEnvironmentProfile | undefined;
  collection?: ApiCollection | undefined;
  effectiveRequest: ApiEffectiveRequestSnapshot | null;
  canManageTls: boolean;
  ownershipSaving: boolean;
  transferUserId: string;
  coOwnersInput: string;
  onTransferUserIdChange: (value: string) => void;
  onCoOwnersInputChange: (value: string) => void;
  onVisibilityChange: (visibility: ApiVisibility) => void;
  onTransfer: () => void;
  onSaveCoOwners: () => void;
  onChange: (patch: Partial<ApiRequestDefinition>) => void;
}) => {
  const precedenceRows = [
    { scope: 'Collection', hint: collection?.name || 'Collection', items: (collection?.variables || []).map(item => ({ key: item.key, value: item.currentValue, sensitive: item.sensitive })) },
    { scope: 'Environment', hint: environment?.name || 'Environment', items: (environment?.variables || []).map(item => ({ key: item.key, value: item.currentValue, sensitive: item.sensitive })) },
  ];
  const resolvedPreview = new Map<string, { value: string; source: string }>();
  [...precedenceRows].reverse().forEach(layer => {
    layer.items.forEach(item => {
      if (!item.key) return;
      resolvedPreview.set(item.key, {
        value: item.sensitive ? '••••••' : item.value,
        source: layer.scope,
      });
    });
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Toggle
          checked={request.tls.verifyCertificate}
          onChange={(checked) => onChange({ tls: { ...request.tls, verifyCertificate: checked } })}
          label="Verify TLS certificate"
          disabled={!canManageTls}
        />
        <Toggle
          checked={request.executionMode === 'EXACT'}
          onChange={(checked) => onChange({ executionMode: checked ? 'EXACT' : 'RECOMMENDED' })}
          label="Exact replay mode"
          disabled={!canManageTls}
        />
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          Timeout: 30s connect، 60s read، 90s total. Max response: 1 MB در backend Runner.
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 p-4 space-y-4">
        <div>
          <h3 className="font-semibold text-gray-900">Visibility و مالکیت</h3>
          <p className="text-xs text-gray-500">PRIVATE فقط مالک/همکاران؛ PROJECT_SHARED برای اعضای پروژه با نقش ویرایش.</p>
        </div>
        <Toggle
          checked={(request.visibility || 'PRIVATE') === 'PROJECT_SHARED'}
          onChange={(checked) => onVisibilityChange(checked ? 'PROJECT_SHARED' : 'PRIVATE')}
          label="Project Shared"
          disabled={ownershipSaving}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
          <Input
            label="انتقال مالکیت (User ID)"
            value={transferUserId}
            onChange={(event) => onTransferUserIdChange(event.target.value)}
            dir="ltr"
            placeholder="target-user-id"
          />
          <div className="flex items-end">
            <Button size="sm" variant="secondary" onClick={onTransfer} loading={ownershipSaving}>انتقال</Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
          <Input
            label="Co-owners (با کاما)"
            value={coOwnersInput}
            onChange={(event) => onCoOwnersInputChange(event.target.value)}
            dir="ltr"
            placeholder="user-1, user-2"
            hint={`مالک فعلی: ${request.ownerId || request.createdBy}`}
          />
          <div className="flex items-end">
            <Button size="sm" variant="secondary" onClick={onSaveCoOwners} loading={ownershipSaving}>ذخیره</Button>
          </div>
        </div>
      </div>
      {!request.tls.verifyCertificate && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Insecure TLS در UI نمایش داده می‌شود، audit می‌شود و طبق policy برای Production execution block است.
        </div>
      )}
      <div>
        <h3 className="mb-1 font-semibold text-gray-900">Variable Inspector</h3>
        <p className="mb-3 text-xs text-gray-500">اولویت: Execution → Request → Collection → Environment → Global</p>
        <div className="mb-4 overflow-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-100 text-xs" dir="ltr">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Resolved</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 bg-white font-mono text-gray-800">
              {Array.from(resolvedPreview.entries()).length === 0 ? (
                <tr><td className="px-3 py-3 text-gray-400" colSpan={3}>متغیری برای foreshadow وجود ندارد</td></tr>
              ) : (
                Array.from(resolvedPreview.entries()).map(([key, item]) => (
                  <tr key={key}>
                    <td className="px-3 py-2">{key}</td>
                    <td className="px-3 py-2 break-all">{item.value || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{item.source}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {precedenceRows.map(layer => (
            <div key={layer.scope} className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-gray-900">{layer.scope}</h4>
                <span className="text-[11px] text-gray-500">{layer.hint}</span>
              </div>
              {layer.items.length === 0 ? (
                <p className="text-xs text-gray-400">خالی</p>
              ) : (
                <div className="space-y-2">
                  {layer.items.map(item => (
                    <div key={`${layer.scope}-${item.key}`} className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-gray-900" dir="ltr">{item.key}</span>
                        {item.sensitive && <Badge variant="warning" size="sm">Sensitive</Badge>}
                      </div>
                      <p className="mt-1 break-all font-mono text-[11px] text-gray-500" dir="ltr">
                        {item.sensitive ? '••••••' : (item.value || '—')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {effectiveRequest?.omittedHeaders.length ? (
        <div>
          <h3 className="mb-3 font-semibold text-gray-900">Headerهای تغییرکرده یا حذف‌شده توسط Runner</h3>
          <div className="space-y-2">
            {effectiveRequest.omittedHeaders.map((header, index) => (
              <div key={`${header.name}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm">
                <span className="font-mono" dir="ltr">{header.name}</span>
                <span className="text-gray-500"> - {header.reason}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const AssertionEditor = ({ rows, onChange, onAdd }: { rows: ApiRequestAssertion[]; onChange: (rows: ApiRequestAssertion[]) => void; onAdd: () => void }) => {
  const update = (id: string, patch: Partial<ApiRequestAssertion>) =>
    onChange(rows.map(row => row.id === id ? { ...row, ...patch } : row));
  const updateConfig = (id: string, key: string, value: unknown) =>
    onChange(rows.map(row => row.id === id ? { ...row, configuration: { ...row.configuration, [key]: value } } : row));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">Assertions</h3>
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>افزودن</Button>
      </div>
      {rows.map(row => (
        <div key={row.id} className="space-y-2 rounded-lg border border-gray-200 p-3">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[44px_260px_1fr_44px]">
            <input type="checkbox" checked={row.enabled} onChange={(event) => update(row.id, { enabled: event.target.checked })} className="m-auto" />
            <Select
              value={row.assertionType}
              onChange={(event) => update(row.id, { assertionType: event.target.value as ApiRequestAssertion['assertionType'] })}
              options={[
                { value: 'EXPECTED_HTTP_STATUS', label: 'Status مورد انتظار' },
                { value: 'MAX_RESPONSE_TIME', label: 'حداکثر زمان پاسخ' },
                { value: 'EXPECTED_CONTENT_TYPE', label: 'Expected Content-Type' },
                { value: 'REQUIRED_JSON_PATH', label: 'JSON path الزامی' },
                { value: 'HEADER_VALUE', label: 'Header assertion' },
                { value: 'BUSINESS_EXPRESSION', label: 'شرط Business success' },
                { value: 'JSON_SCHEMA', label: 'JSON Schema validation' },
              ]}
            />
            {row.assertionType === 'JSON_SCHEMA' ? (
              <span className="self-center text-xs text-gray-500">Schema در کادر زیر ویرایش می‌شود (ارزیابی سمت سرور).</span>
            ) : (
              <input
                value={JSON.stringify(row.configuration)}
                onChange={(event) => {
                  const parsed = parseJson(event.target.value);
                  if (parsed.ok) update(row.id, { configuration: asRecord(parsed.value) });
                  else updateConfig(row.id, 'raw', event.target.value);
                }}
                className="rounded border border-gray-300 px-2 py-1 text-left font-mono text-sm"
                dir="ltr"
              />
            )}
            <button type="button" onClick={() => onChange(rows.filter(item => item.id !== row.id))} className="rounded-lg text-red-600 hover:bg-red-50">
              <Trash2 className="mx-auto h-4 w-4" />
            </button>
          </div>
          {row.assertionType === 'JSON_SCHEMA' && (
            <Textarea
              label="JSON Schema"
              value={typeof row.configuration.schema === 'string'
                ? row.configuration.schema
                : JSON.stringify(row.configuration.schema ?? {}, null, 2)}
              onChange={(event) => {
                const raw = event.target.value;
                const parsed = parseJson(raw);
                if (parsed.ok) updateConfig(row.id, 'schema', parsed.value);
                else updateConfig(row.id, 'schema', raw);
              }}
              className="min-h-36 text-left font-mono"
              dir="ltr"
            />
          )}
        </div>
      ))}
    </div>
  );
};

const GeneratedCurlPanel = ({
  exports,
  originalCurl,
  loading,
  onRefresh,
}: {
  exports: Record<ApiExportDialect, string>;
  originalCurl?: string | undefined;
  loading: boolean;
  onRefresh: () => void;
}) => (
  <div className="space-y-4">
    <div className="flex justify-between gap-2">
      <div>
        <h3 className="font-semibold text-gray-900">cURLها</h3>
        <p className="text-xs text-gray-500">cURL اصلی و exportهای قابل استفاده در Bash، Windows CMD و PowerShell</p>
      </div>
      <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh} loading={loading}>به‌روزرسانی</Button>
    </div>
    {loading && <LoadingState label="در حال ساخت cURL..." className="py-4" />}
    {originalCurl && (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>cURL واردشده</FieldLabel>
          <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={() => {
            navigator.clipboard?.writeText(originalCurl);
            toast.success('cURL کپی شد.');
          }}>
            کپی
          </Button>
        </div>
        <CodeBlock value={originalCurl} />
      </div>
    )}
    {Object.entries(exports).filter(([, value]) => value.trim()).map(([dialect, value]) => (
      <div key={dialect} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>{dialect}</FieldLabel>
          <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={() => {
            navigator.clipboard?.writeText(value);
            toast.success('cURL کپی شد.');
          }}>
            کپی
          </Button>
        </div>
        <CodeBlock value={value} />
      </div>
    ))}
    {!loading && !originalCurl && !Object.values(exports).some(value => value.trim()) && (
      <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
        هنوز cURL برای این Request ساخته نشده است. روی «به‌روزرسانی» بزنید.
      </p>
    )}
  </div>
);

const HistoryPanel = ({
  rows,
  selected,
  manualResponses,
  loading,
  statusFilter,
  onStatusFilter,
  compareIds,
  onToggleCompare,
  onSelect,
  onManual,
}: {
  rows: ApiRequestExecution[];
  selected: ApiRequestExecution | null;
  manualResponses: ApiManualResponseExample[];
  loading: boolean;
  statusFilter: string;
  onStatusFilter: (value: string) => void;
  compareIds: string[];
  onToggleCompare: (id: string) => void;
  onSelect: (execution: ApiRequestExecution) => void;
  onManual: () => void;
}) => {
  const filtered = statusFilter
    ? rows.filter(row => row.transportResult === statusFilter || String(row.statusCode || '') === statusFilter)
    : rows;
  const compareRows = compareIds
    .map(id => rows.find(row => row.id === id))
    .filter((row): row is ApiRequestExecution => Boolean(row));

  return (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-gray-900">History اجرا</h3>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-gray-300 px-2 py-1 text-xs"
          value={statusFilter}
          onChange={(event) => onStatusFilter(event.target.value)}
        >
          <option value="">همه وضعیت‌ها</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="ERROR">ERROR</option>
          <option value="TIMEOUT">TIMEOUT</option>
          <option value="200">HTTP 200</option>
          <option value="401">HTTP 401</option>
          <option value="500">HTTP 500</option>
        </select>
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onManual}>Response دستی</Button>
      </div>
    </div>
    {compareRows.length === 2 && (
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {compareRows.map(row => (
          <div key={row.id} className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
            <div className="flex flex-wrap gap-2">
              <Badge variant={resultBadgeVariant(row.transportResult)}>{row.transportResult}</Badge>
              <span>HTTP {row.statusCode || '-'}</span>
              <span>{row.durationMs || 0}ms</span>
            </div>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]" dir="ltr">{String(row.response?.bodyPreview || row.sanitizedError || '-').slice(0, 1200)}</pre>
          </div>
        ))}
      </div>
    )}
    <Table
      columns={[
        { key: 'status', title: 'وضعیت', render: (item: ApiRequestExecution) => <Badge variant={resultBadgeVariant(item.transportResult)}>{item.transportResult}</Badge> },
        { key: 'code', title: 'HTTP', render: (item: ApiRequestExecution) => item.statusCode || '-' },
        { key: 'business', title: 'Business', render: (item: ApiRequestExecution) => <Badge variant={resultBadgeVariant(item.businessResult)}>{item.businessResult}</Badge> },
        { key: 'duration', title: 'زمان پاسخ', render: (item: ApiRequestExecution) => `${item.durationMs || 0}ms` },
        { key: 'runner', title: 'Runner', render: (item: ApiRequestExecution) => item.runnerId },
        { key: 'time', title: 'زمان', render: (item: ApiRequestExecution) => formatDate(item.startedAt) },
        { key: 'actions', title: '', render: (item: ApiRequestExecution) => (
          <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
            <Button size="sm" variant={compareIds.includes(item.id) ? 'primary' : 'ghost'} onClick={() => onToggleCompare(item.id)}>
              Compare
            </Button>
            <Button size="sm" variant={selected?.id === item.id ? 'primary' : 'ghost'} icon={<Eye className="h-4 w-4" />} onClick={() => onSelect(item)}>
              مشاهده
            </Button>
          </div>
        ) },
      ]}
      data={filtered}
      loading={loading}
      enableClientFilter={false}
      enableColumnChooser={false}
      enableExport={false}
      emptyMessage="Execution history وجود ندارد"
      onRowClick={onSelect}
    />
    {manualResponses.length > 0 && (
      <div>
        <h4 className="mb-2 text-sm font-semibold text-gray-900">Manual / imported response examples</h4>
        <div className="space-y-2">
          {manualResponses.map(example => (
            <div key={example.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="info">MANUAL_EXAMPLE</Badge>
                <span>Status {example.statusCode}</span>
                <Badge variant={example.reviewStatus === 'APPROVED' ? 'success' : 'warning'}>{example.reviewStatus}</Badge>
              </div>
              <p className="mt-1 text-gray-500">{example.reason}</p>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
  );
};

const EffectiveRequestPanel = ({
  request,
  effectiveRequest,
  loading,
}: {
  request: ApiRequestDefinition;
  effectiveRequest: ApiEffectiveRequestSnapshot | null;
  loading: boolean;
}) => (
  <Card>
    <div className="mb-4 flex items-center justify-between gap-2">
      <h3 className="font-semibold text-gray-900">Request نهایی</h3>
      <Badge variant="info">{request.executionMode}</Badge>
    </div>
    {loading ? (
      <LoadingState label="در حال بارگذاری effective request..." className="py-10" />
    ) : (
    <div className="space-y-3">
      <div>
        <FieldLabel>Transport نهایی</FieldLabel>
        <CodeBlock value={effectiveRequest ? `${effectiveRequest.method} ${effectiveRequest.url}\nTLS verify: ${effectiveRequest.tls.verifyCertificate}` : 'برای ساخت effective snapshot ابتدا Request را ذخیره کنید.'} minHeight="min-h-20" />
      </div>
      {effectiveRequest && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div>
            <FieldLabel>Headers</FieldLabel>
            <CodeBlock value={effectiveRequest.headers.map(header => `${header.name}: ${header.sensitive ? header.maskedValue : header.valueTemplate}`).join('\n')} />
          </div>
          <div>
            <FieldLabel>Cookies</FieldLabel>
            <CodeBlock value={effectiveRequest.cookies.map(cookie => `${cookie.name}=${cookie.sensitive ? cookie.maskedValue : cookie.valueReference}`).join('\n')} />
          </div>
          <div>
            <FieldLabel>Body</FieldLabel>
            <CodeBlock value={effectiveRequest.body.raw || '-'} />
          </div>
        </div>
      )}
    </div>
    )}
  </Card>
);


const InfoTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
    <p className="text-xs text-gray-500">{label}</p>
    <p className="mt-1 truncate font-mono text-sm text-gray-900" dir="ltr" title={value}>{value}</p>
  </div>
);

const SnapshotMetric = ({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-3">
    <p className="text-xs text-gray-500">{label}</p>
    <p className={`mt-1 truncate text-sm font-semibold text-gray-900 ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : 'rtl'} title={value}>
      {value}
    </p>
  </div>
);

const SnapshotSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-gray-200 bg-white p-3">
    <h4 className="mb-3 text-sm font-semibold text-gray-900">{title}</h4>
    {children}
  </section>
);

const ConsumerAccessList = ({
  consumers,
  candidates,
}: {
  consumers: ApiVersionConsumer[];
  candidates: ApiConsumerCandidate[];
}) => {
  if (!consumers.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
        مصرف‌کننده‌ای برای این نسخه ثبت نشده است.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {consumers.map(consumer => (
        <div key={consumer.id || consumerIdOf(consumer)} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">{consumerDisplayLabel(consumer, candidates)}</p>
            <p className="mt-1 text-xs text-gray-500">{consumerDisplayDescription(consumer, candidates)}</p>
          </div>
          <Badge variant={consumer.consumerType === 'ROLE' ? 'info' : 'secondary'} size="sm">
            {CONSUMER_TYPE_LABELS[consumer.consumerType]}
          </Badge>
        </div>
      ))}
    </div>
  );
};

const ConsumerPicker = ({
  candidates,
  selectedIds,
  onToggle,
}: {
  candidates: ApiConsumerCandidate[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) => (
  <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
    {candidates.map(candidate => (
      <label key={candidate.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-gray-50">
        <input
          type="checkbox"
          checked={selectedIds.includes(candidate.id)}
          onChange={() => onToggle(candidate.id)}
          className="mt-1 rounded border-gray-300 text-blue-600"
        />
        <span className="min-w-0">
          <span className="font-medium text-gray-900">{consumerCandidateLabel(candidate)}</span>
          <span className="mr-2 text-xs text-gray-500">{CONSUMER_TYPE_LABELS[candidate.consumerType]}</span>
          <span className="block text-xs text-gray-500">{consumerCandidateDescription(candidate)}</span>
        </span>
      </label>
    ))}
    {!candidates.length && <p className="p-3 text-sm text-gray-500">هنوز کاربر یا نقشی برای انتخاب ثبت نشده است.</p>}
  </div>
);

const RevisionSnapshotPanel = ({ review }: { review: ApiShareRequest }) => {
  const revisions = (review.revisions || []).slice().sort((left, right) => right.revisionNumber - left.revisionNumber);
  const currentRevision = revisions.find(item => item.revisionNumber === review.currentRevisionNumber) || revisions[0];

  if (!currentRevision) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
        Snapshot برای این Revision ثبت نشده است.
      </div>
    );
  }

  const snapshot = asRecord(currentRevision.snapshot);
  const effectiveRequest = asRecord(snapshot.effectiveRequest);
  const classification = asRecord(snapshot.classification);
  const requestBody = asRecord(snapshot.requestBody || effectiveRequest.body);
  const authentication = asRecord(snapshot.authentication);
  const tls = asRecord(snapshot.tls || effectiveRequest.tls);
  const documentation = asRecord(snapshot.documentation);
  const queryParameters = asArray<Record<string, unknown>>(snapshot.queryParameters);
  const headers = asArray<Record<string, unknown>>(snapshot.headers);
  const cookies = asArray<Record<string, unknown>>(snapshot.cookies);
  const assertions = asArray<Record<string, unknown>>(snapshot.assertions);
  const executions = asArray<Record<string, unknown>>(snapshot.executionEvidence);
  const manualResponses = asArray<Record<string, unknown>>(snapshot.manualResponses);
  const variableResolution = asArray<Record<string, unknown>>(asRecord(effectiveRequest).variableResolution);
  const method = asText(snapshot.method || effectiveRequest.method || 'GET');
  const url = asText(snapshot.url || effectiveRequest.url);
  const documentationPreview = asText(snapshot.documentationPreview, '');
  const generatedCurl = asText(snapshot.generatedCurl, '');
  const headerPreview = headers
    .map(header => `${asText(header.name)}: ${header.sensitive ? asText(header.maskedValue) : asText(header.valueTemplate)}`)
    .join('\n');
  const queryPreview = queryParameters
    .map(param => `${asText(param.name)}=${param.sensitive ? '***' : asText(param.value)}`)
    .join('\n');
  const cookiePreview = cookies
    .map(cookie => `${asText(cookie.name)}=${cookie.sensitive ? asText(cookie.maskedValue) : asText(cookie.valueReference)}`)
    .join('\n');
  const latestExecution = executions[0];

  return (
    <div className="space-y-3 xl:max-h-[calc(100dvh-13rem)] xl:overflow-y-auto xl:pl-1">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-gray-900">Revision Snapshot</h3>
              <Badge variant={sharingBadgeVariant(currentRevision.status)} size="sm">
                {API_SHARING_STATUS_LABELS[currentRevision.status]}
              </Badge>
              <Badge variant="default" size="sm">Revision {currentRevision.revisionNumber}</Badge>
            </div>
            <p className="mt-1 text-xs text-gray-600">ارسال‌شده در {formatDate(currentRevision.submittedAt)}</p>
          </div>
          <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => {
            navigator.clipboard?.writeText(JSON.stringify(currentRevision, null, 2));
            toast.success('Revision Snapshot کپی شد.');
          }}>
            کپی
          </Button>
        </div>
        <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={method === 'GET' ? 'info' : method === 'POST' ? 'success' : 'warning'}>{method}</Badge>
            <span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-gray-900" dir="ltr" title={url}>{url}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SnapshotMetric label="API ID" value={asText(snapshot.apiId || review.apiId)} />
        <SnapshotMetric label="Version" value={`v${asText(snapshot.version || review.version)}`} />
        <SnapshotMetric label="Environment" value={asText(snapshot.environmentId)} />
        <SnapshotMetric label="Captured" value={formatDate(asText(snapshot.capturedAt, ''))} mono={false} />
      </div>

      <SnapshotSection title="متن ارسال‌شده برای Share">
        <div className="space-y-3 text-sm text-gray-700">
          <div>
            <p className="text-xs font-semibold text-gray-500">هدف</p>
            <p className="mt-1 leading-6">{currentRevision.purpose || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500">Introduction</p>
            <p className="mt-1 leading-6">{currentRevision.introduction || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500">توضیحات</p>
            <p className="mt-1 leading-6">{currentRevision.description || '-'}</p>
          </div>
        </div>
      </SnapshotSection>

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        <SnapshotSection title="Classification و Transport">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <SnapshotMetric label="Type" value={asText(classification.type)} />
            <SnapshotMetric label="Service ID" value={asText(classification.serviceId)} />
            <SnapshotMetric label="Operation" value={asText(classification.operationPath)} />
            <SnapshotMetric label="TLS" value={tls.verifyCertificate === false ? 'Insecure' : 'Verified'} />
          </div>
          {classification.reason ? <p className="mt-3 text-sm text-gray-600">{asText(classification.reason, '')}</p> : null}
        </SnapshotSection>

        <SnapshotSection title="Evidence">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <SnapshotMetric label="Execution" value={String(executions.length)} />
            <SnapshotMetric label="Manual Response" value={String(manualResponses.length)} />
            <SnapshotMetric label="Assertions" value={String(assertions.length)} />
            <SnapshotMetric label="Variables" value={String(variableResolution.length)} />
          </div>
          {latestExecution ? (
            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-800">آخرین Execution: </span>
              <span>{asText(latestExecution.transportResult || latestExecution.status)} / HTTP {asText(latestExecution.statusCode)}</span>
              <span className="mr-2">{formatDate(asText(latestExecution.startedAt, ''))}</span>
            </div>
          ) : null}
        </SnapshotSection>
      </div>

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        <SnapshotSection title="Headers و Query">
          <div className="space-y-3">
            <div>
              <FieldLabel>Headers</FieldLabel>
              <CodeBlock value={headerPreview || '-'} minHeight="max-h-44 min-h-24" />
            </div>
            <div>
              <FieldLabel>Query Parameters</FieldLabel>
              <CodeBlock value={queryPreview || '-'} minHeight="max-h-36 min-h-20" />
            </div>
            {cookiePreview ? (
              <div>
                <FieldLabel>Cookies</FieldLabel>
                <CodeBlock value={cookiePreview} minHeight="max-h-32 min-h-20" />
              </div>
            ) : null}
          </div>
        </SnapshotSection>

        <SnapshotSection title="Body و Authentication">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <SnapshotMetric label="Body Type" value={asText(requestBody.type || snapshot.bodyType || '-')} />
              <SnapshotMetric label="Auth Type" value={asText(authentication.type || 'none')} />
            </div>
            <div>
              <FieldLabel>Body</FieldLabel>
              <CodeBlock value={prettySnapshot(requestBody.raw || requestBody.template || snapshot.bodyTemplate || requestBody)} minHeight="max-h-64 min-h-32" />
            </div>
          </div>
        </SnapshotSection>
      </div>

      {documentationPreview || generatedCurl ? (
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          {documentationPreview ? (
            <SnapshotSection title="Documentation Preview">
              <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <SnapshotMetric label="Title" value={asText(documentation.title || snapshot.title || review.apiTitle)} mono={false} />
                <SnapshotMetric label="Owner" value={asText(documentation.owner)} />
              </div>
              <CodeBlock value={documentationPreview} minHeight="max-h-72 min-h-40" />
            </SnapshotSection>
          ) : null}
          {generatedCurl ? (
            <SnapshotSection title="Generated cURL">
              <div className="mb-2 flex justify-end">
                <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={() => {
                  navigator.clipboard?.writeText(generatedCurl);
                  toast.success('cURL کپی شد.');
                }}>
                  کپی cURL
                </Button>
              </div>
              <CodeBlock value={generatedCurl} minHeight="max-h-72 min-h-40" />
            </SnapshotSection>
          ) : null}
        </div>
      ) : null}

      <SnapshotSection title="Revision History">
        <div className="space-y-2">
          {revisions.map(revision => (
            <div key={revision.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={revision.revisionNumber === currentRevision.revisionNumber ? 'info' : 'default'} size="sm">
                  Revision {revision.revisionNumber}
                </Badge>
                <Badge variant={sharingBadgeVariant(revision.status)} size="sm">{API_SHARING_STATUS_LABELS[revision.status]}</Badge>
              </div>
              <span className="text-xs text-gray-500">{formatDate(revision.submittedAt)}</span>
            </div>
          ))}
        </div>
      </SnapshotSection>

      <details className="rounded-lg border border-gray-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-gray-900">Raw JSON برای Audit</summary>
        <div className="mt-3">
          <CodeBlock value={JSON.stringify(currentRevision, null, 2)} minHeight="max-h-96 min-h-52" />
        </div>
      </details>
    </div>
  );
};

const RepositoryTechnicalSnapshotPanel = ({ item }: { item: ApiRepositoryItem }) => {
  if (item.shareRequest?.revisions?.length) {
    return <RevisionSnapshotPanel review={{ ...item.shareRequest, consumers: item.consumers }} />;
  }

  const request = item.request;
  if (!request) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
        Snapshot فنی برای این نسخه هنوز بارگذاری نشده است.
      </div>
    );
  }

  const headerPreview = request.headers
    .map(header => `${header.name}: ${header.sensitive ? header.maskedValue : header.valueTemplate}`)
    .join('\n');
  const queryPreview = request.queryParameters
    .map(param => `${param.name}=${param.sensitive ? '***' : param.value}`)
    .join('\n');
  const cookiePreview = request.cookies
    .map(cookie => `${cookie.name}=${cookie.sensitive ? cookie.maskedValue : cookie.valueReference}`)
    .join('\n');

  return (
    <div className="space-y-3 xl:max-h-[calc(100dvh-13rem)] xl:overflow-y-auto xl:pl-1">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={request.method === 'GET' ? 'info' : request.method === 'POST' ? 'success' : 'warning'}>
            {request.method}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-gray-900" dir="ltr" title={request.urlTemplate}>
            {request.urlTemplate}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SnapshotMetric label="API ID" value={item.apiId} />
        <SnapshotMetric label="Version" value={`v${item.version}`} />
        <SnapshotMetric label="Environment" value={request.environmentId} />
        <SnapshotMetric label="Captured" value={formatDate(request.updatedAt)} mono={false} />
      </div>

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        <SnapshotSection title="طبقه‌بندی و انتقال">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <SnapshotMetric label="نوع API" value={CLASSIFICATION_LABELS[request.classification.type]} mono={false} />
            <SnapshotMetric label="Service ID" value={request.classification.serviceId || '-'} />
            <SnapshotMetric label="Operation" value={request.classification.operationPath || '-'} />
            <SnapshotMetric label="TLS" value={request.tls.verifyCertificate ? 'تأیید گواهی فعال' : 'بدون تأیید گواهی'} mono={false} />
          </div>
        </SnapshotSection>

        <SnapshotSection title="مستندات">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <SnapshotMetric label="عنوان" value={request.documentation.title || item.title} mono={false} />
            <SnapshotMetric label="مالک" value={request.documentation.owner || request.createdBy} mono={false} />
            <SnapshotMetric label="نسخه سند" value={request.documentation.version || item.version} />
            <SnapshotMetric label="آخرین تغییر" value={formatDate(request.updatedAt)} mono={false} />
          </div>
        </SnapshotSection>
      </div>

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        <SnapshotSection title="Header، Query و Cookie">
          <div className="space-y-3">
            <div>
              <FieldLabel>Headers</FieldLabel>
              <CodeBlock value={headerPreview || '-'} minHeight="max-h-44 min-h-24" />
            </div>
            <div>
              <FieldLabel>Query Parameters</FieldLabel>
              <CodeBlock value={queryPreview || '-'} minHeight="max-h-36 min-h-20" />
            </div>
            {cookiePreview ? (
              <div>
                <FieldLabel>Cookies</FieldLabel>
                <CodeBlock value={cookiePreview} minHeight="max-h-32 min-h-20" />
              </div>
            ) : null}
          </div>
        </SnapshotSection>

        <SnapshotSection title="Body و Authentication">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <SnapshotMetric label="Body Type" value={request.bodyType || '-'} />
              <SnapshotMetric label="Auth Type" value={request.authentication.type || 'none'} />
            </div>
            <div>
              <FieldLabel>Body</FieldLabel>
              <CodeBlock value={prettySnapshot(request.bodyTemplate || '-')} minHeight="max-h-64 min-h-32" />
            </div>
          </div>
        </SnapshotSection>
      </div>

      <details className="rounded-lg border border-gray-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-gray-900">Raw JSON برای Audit</summary>
        <div className="mt-3">
          <CodeBlock value={JSON.stringify({ request, consumers: item.consumers }, null, 2)} minHeight="max-h-96 min-h-52" />
        </div>
      </details>
    </div>
  );
};



const ASSIGNABLE_DIRECTORY_ROLES: UserRole[] = [
  'SYSTEM_ADMIN',
  'TECH_LEAD',
  'QA_LEAD',
  'QA_SPECIALIST',
  'BA',
  'SECURITY_REVIEWER',
  'PRODUCT_OWNER',
  'DEVELOPER',
];


const ImportPostmanCollectionModal = ({
  open,
  text,
  fileName,
  preview,
  importing,
  applicationId,
  onText,
  onFile,
  onApplicationChange,
  onParse,
  onImport,
  onClose,
}: {
  open: boolean;
  text: string;
  fileName: string;
  preview: PostmanCollectionImportPreview | null;
  importing: boolean;
  applicationId: string;
  onText: (value: string) => void;
  onFile: (file: File | null) => void;
  onApplicationChange: (applicationId: string) => void;
  onParse: () => void;
  onImport: () => void;
  onClose: () => void;
}) => (
  <Modal isOpen={open} onClose={onClose} title="Import Postman Collection" size="wide">
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3">
        <ApplicationSelect
          label="سامانه مقصد"
          value={applicationId}
          onChange={onApplicationChange}
          disabled={importing}
          includePersonalOption
          personalOptionLabel={PERSONAL_APPLICATION_LABEL}
          placeholder="جستجو و انتخاب سامانه"
          searchPlaceholder="نام سامانه را تایپ کنید…"
          hint="آزاد = بدون CDE. یا یک سامانه برای Import متصل به پروژه."
        />
        <label className="block space-y-2">
          <span className="text-sm font-medium text-gray-700">فایل Postman Collection</span>
          <input
            type="file"
            accept=".json,.postman_collection.json,application/json"
            onChange={(event) => onFile(event.target.files?.[0] || null)}
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          />
          {fileName && <span className="block text-xs text-gray-500">{fileName}</span>}
        </label>
        <Textarea
          label="یا JSON کالکشن را paste کنید"
          value={text}
          onChange={(event) => onText(event.target.value)}
          className="min-h-48 text-left font-mono sm:min-h-[420px]"
          dir="ltr"
        />
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700">
          فرمت‌های Postman Collection v2 و v2.1 پشتیبانی می‌شوند. Folderها حفظ می‌شوند و هر item به یک Request داخل Online API Console تبدیل می‌شود.
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={importing}>انصراف</Button>
          <Button icon={<Upload className="h-4 w-4" />} onClick={onParse} disabled={!text.trim() || importing}>Preview</Button>
        </div>
      </div>
      <div className="space-y-3">
        {!preview ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 sm:min-h-[520px]">
            فایل یا JSON را وارد کنید و Preview بزنید.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoTile label="Collection" value={preview.name} />
              <InfoTile label="Requests" value={String(preview.requestCount)} />
              <InfoTile label="Variables" value={String(preview.variables.length)} />
              <InfoTile label="Warnings" value={String(preview.warnings.length + preview.requests.reduce((sum, item) => sum + item.warningCount, 0))} />
            </div>
            {preview.description && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                {preview.description}
              </div>
            )}
            <div className="max-h-[360px] overflow-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">نام</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Method</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">URL</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Body</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {preview.requests.map((item, index) => (
                    <tr key={`${item.name}-${index}`}>
                      <td className="px-3 py-2 text-gray-900">
                        <div className="font-medium">{item.name}</div>
                        {item.folderPath.length > 0 && <div className="text-xs text-gray-500">{item.folderPath.join(' / ')}</div>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{item.method}</td>
                      <td className="max-w-[20rem] truncate px-3 py-2 font-mono text-xs text-gray-600" dir="ltr">{item.url}</td>
                      <td className="px-3 py-2 text-gray-600">{item.bodyType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(preview.warnings.length || preview.requests.some(item => item.warnings.length)) && (
              <div className="max-h-36 overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {[...preview.warnings, ...preview.requests.flatMap(item => item.warnings.map(warning => `${item.name}: ${warning}`))].map((warning, index) => (
                  <div key={`${warning}-${index}`}>{warning}</div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
              <Button variant="secondary" onClick={onClose} disabled={importing}>انصراف</Button>
              <Button icon={<CheckCircle className="h-4 w-4" />} onClick={onImport} loading={importing} disabled={!applicationId || !preview.requestCount}>
                Import {preview.requestCount} Request
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  </Modal>
);


function makeDocumentationParameter(location: ApiDocumentationParameter['location']): ApiDocumentationParameter {
  return {
    id: `ui-doc-param-${crypto.randomUUID()}`,
    name: '',
    location,
    dataType: 'string',
    required: null,
    description: '',
    displayOrder: 0,
    enabled: true,
    source: 'MANUAL',
  };
}

function emptyAuthenticationDocumentation(): ApiAuthenticationDocumentation {
  return {
    enabled: false,
    title: 'سرویس احراز هویت',
    introduction: '',
    baseUrl: '',
    endpoint: '',
    method: 'POST',
    contentType: 'application/json',
    headerParameters: [],
    inputParameters: [],
    outputParameters: [],
    curlExample: '',
    responseExample: '',
  };
}

const DocumentationAllowedValuesEditor = ({ rows, onChange, disabled }: {
  rows: ApiDocumentationAllowedValue[];
  onChange: (rows: ApiDocumentationAllowedValue[]) => void;
  disabled: boolean;
}) => {
  const patchRow = (index: number, patch: Partial<ApiDocumentationAllowedValue>) => {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };
  return (
    <div className="space-y-2 rounded-lg border border-blue-100 bg-white p-2 xl:col-span-12">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700">مقادیر مجاز این فیلد</span>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onChange([
          ...rows,
          { id: `ui-doc-allowed-${crypto.randomUUID()}`, value: '', description: '', enabled: true, displayOrder: rows.length },
        ])}>افزودن مقدار مجاز</Button>
      </div>
      {rows.length === 0 && <p className="text-xs text-gray-400">برای فیلدهای کددار مانند deposit_status، کد و توضیح را اینجا ثبت کنید.</p>}
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-1 gap-2 md:grid-cols-12">
          <label className="flex items-center gap-2 text-xs text-gray-600 md:col-span-1">
            <input type="checkbox" checked={row.enabled} disabled={disabled} onChange={(event) => patchRow(index, { enabled: event.target.checked })} /> فعال
          </label>
          <Input aria-label={`کد مقدار مجاز ${index + 1}`} value={row.value} disabled={disabled} dir="ltr" className="text-left font-mono md:col-span-2" placeholder="0" onChange={(event) => patchRow(index, { value: event.target.value })} />
          <Input aria-label={`توضیح مقدار مجاز ${index + 1}`} value={row.description} disabled={disabled} className="md:col-span-7" placeholder="توضیحات" onChange={(event) => patchRow(index, { description: event.target.value })} />
          <Input aria-label={`ترتیب مقدار مجاز ${index + 1}`} type="number" value={row.displayOrder} disabled={disabled} dir="ltr" className="text-left md:col-span-1" onChange={(event) => patchRow(index, { displayOrder: Number(event.target.value) })} />
          <Button size="sm" variant="danger" disabled={disabled} className="md:col-span-1" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>حذف</Button>
        </div>
      ))}
    </div>
  );
};

const DocumentationParameterEditor = ({
  title,
  rows,
  kind,
  onChange,
  disabled,
}: {
  title: string;
  rows: ApiDocumentationParameter[];
  kind: 'HEADER' | 'INPUT' | 'OUTPUT';
  onChange: (rows: ApiDocumentationParameter[]) => void;
  disabled: boolean;
}) => {
  const patchRow = (index: number, patch: Partial<ApiDocumentationParameter>) => {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };
  const defaultLocation = kind === 'HEADER' ? 'HEADER' : kind === 'OUTPUT' ? 'RESPONSE' : 'BODY';
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-gray-900">{title}</h4>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus className="h-4 w-4" />}
          disabled={disabled}
          onClick={() => onChange([...rows, { ...makeDocumentationParameter(defaultLocation), displayOrder: rows.length }])}
        >
          افزودن فیلد
        </Button>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-gray-500">فیلدی ثبت نشده است.</p>}
        {rows.map((row, index) => (
          <div key={row.id} className={`grid grid-cols-1 gap-2 rounded-lg border p-2 ${row.deprecated ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'} xl:grid-cols-12`}>
            <label className="flex items-center gap-2 text-xs text-gray-600 xl:col-span-1">
              <input type="checkbox" checked={row.enabled !== false} disabled={disabled} onChange={(event) => patchRow(index, { enabled: event.target.checked })} />
              فعال
            </label>
            <Input
              aria-label={`${title} نام ${index + 1}`}
              value={row.name}
              disabled={disabled}
              className="text-left font-mono xl:col-span-2"
              dir="ltr"
              placeholder="نام یا field.path"
              onChange={(event) => patchRow(index, { name: event.target.value, deprecated: false })}
            />
            {kind === 'INPUT' && (
              <Select
                aria-label={`${title} محل ${index + 1}`}
                value={row.location}
                disabled={disabled}
                className="xl:col-span-1"
                onChange={(event) => patchRow(index, { location: event.target.value as ApiDocumentationParameter['location'] })}
                options={[
                  { value: 'QUERY', label: 'Query' },
                  { value: 'PATH', label: 'Path' },
                  { value: 'BODY', label: 'Body' },
                ]}
              />
            )}
            <Input
              aria-label={`${title} نوع ${index + 1}`}
              value={row.dataType}
              disabled={disabled}
              className="text-left font-mono xl:col-span-2"
              dir="ltr"
              placeholder="string"
              onChange={(event) => patchRow(index, { dataType: event.target.value })}
            />
            {kind === 'HEADER' && (
              <Input
                aria-label={`${title} نمونه ${index + 1}`}
                value={row.exampleValue || ''}
                disabled={disabled}
                className="text-left font-mono xl:col-span-2"
                dir="ltr"
                placeholder="مقدار نمونه ماسک‌شده"
                onChange={(event) => patchRow(index, { exampleValue: event.target.value })}
              />
            )}
            {kind === 'INPUT' && (
              <Select
                aria-label={`${title} الزامی ${index + 1}`}
                value={row.required === true ? 'true' : row.required === false ? 'false' : 'unknown'}
                disabled={disabled}
                className="xl:col-span-1"
                onChange={(event) => patchRow(index, { required: event.target.value === 'true' ? true : event.target.value === 'false' ? false : null })}
                options={[
                  { value: 'unknown', label: 'نامشخص' },
                  { value: 'true', label: 'بله' },
                  { value: 'false', label: 'خیر' },
                ]}
              />
            )}
            <Input
              aria-label={`${title} توضیحات ${index + 1}`}
              value={row.description}
              disabled={disabled}
              className={kind === 'OUTPUT' ? 'xl:col-span-5' : kind === 'HEADER' ? 'xl:col-span-4' : 'xl:col-span-4'}
              placeholder="—"
              onChange={(event) => patchRow(index, { description: event.target.value })}
            />
            <Input
              aria-label={`${title} ترتیب ${index + 1}`}
              type="number"
              value={row.displayOrder}
              disabled={disabled}
              className="text-left xl:col-span-1"
              dir="ltr"
              onChange={(event) => patchRow(index, { displayOrder: Number(event.target.value) })}
            />
            <Button
              size="sm"
              variant="danger"
              disabled={disabled}
              className="xl:col-span-1"
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
            >
              حذف
            </Button>
            {kind === 'OUTPUT' && (
              <DocumentationAllowedValuesEditor
                rows={row.allowedValues || []}
                disabled={disabled}
                onChange={(allowedValues) => patchRow(index, { allowedValues, allowedValuesCustomized: true })}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const DocumentationResponseCodeEditor = ({ rows, onChange, disabled }: {
  rows: ApiDocumentationResponseCode[];
  onChange: (rows: ApiDocumentationResponseCode[]) => void;
  disabled: boolean;
}) => {
  const patchRow = (index: number, patch: Partial<ApiDocumentationResponseCode>) => {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-gray-900">مرجع کدهای پاسخ و خطا</h4>
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={disabled} onClick={() => onChange([
          ...rows,
          { code: 0, message: '', description: '', enabled: true, displayOrder: rows.length },
        ])}>افزودن کد</Button>
      </div>
      <div className="max-h-[520px] space-y-2 overflow-y-auto">
        {rows.map((row, index) => (
          <div key={`${row.code}-${index}`} className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 lg:grid-cols-12">
            <label className="flex items-center gap-2 text-xs text-gray-600 lg:col-span-1">
              <input type="checkbox" checked={row.enabled} disabled={disabled} onChange={(event) => patchRow(index, { enabled: event.target.checked })} /> فعال
            </label>
            <Input type="number" aria-label={`کد پاسخ ${index + 1}`} value={row.code} disabled={disabled} dir="ltr" className="text-left lg:col-span-1" onChange={(event) => patchRow(index, { code: Number(event.target.value) })} />
            <Input aria-label={`پیام پاسخ ${index + 1}`} value={row.message} disabled={disabled} dir="ltr" className="text-left font-mono lg:col-span-3" onChange={(event) => patchRow(index, { message: event.target.value })} />
            <Input aria-label={`توضیح پاسخ ${index + 1}`} value={row.description} disabled={disabled} className="lg:col-span-5" onChange={(event) => patchRow(index, { description: event.target.value })} />
            <Input type="number" aria-label={`ترتیب پاسخ ${index + 1}`} value={row.displayOrder} disabled={disabled} dir="ltr" className="text-left lg:col-span-1" onChange={(event) => patchRow(index, { displayOrder: Number(event.target.value) })} />
            <Button size="sm" variant="danger" disabled={disabled} className="lg:col-span-1" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>حذف</Button>
          </div>
        ))}
      </div>
    </div>
  );
};

const DocumentationMetadataEditor = ({ metadata, onChange, onRefresh, refreshing, disabled }: {
  metadata: ApiDocumentationMetadata;
  onChange: (metadata: ApiDocumentationMetadata) => void;
  onRefresh: () => void;
  refreshing: boolean;
  disabled: boolean;
}) => {
  const authentication = metadata.authenticationDocumentation || emptyAuthenticationDocumentation();
  const patchMetadata = (patch: Partial<ApiDocumentationMetadata>) => onChange({ ...metadata, ...patch });
  const patchAuthentication = (patch: Partial<ApiAuthenticationDocumentation>) => patchMetadata({
    authenticationDocumentation: { ...authentication, ...patch },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
        <p className="text-sm text-blue-800">Refresh فیلدهای جدید را اضافه می‌کند، توضیحات و وضعیت الزامی ویرایش‌شده را نگه می‌دارد و فیلدهای حذف‌شده را غیرفعال علامت می‌زند.</p>
        <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh} loading={refreshing} disabled={disabled}>Refresh از Request/Response</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 p-3 md:grid-cols-2 xl:grid-cols-4">
        <Input label="عنوان سند" value={metadata.title || ''} disabled={disabled} onChange={(event) => patchMetadata({ title: event.target.value })} />
        <Input label="ویرایش سند" value={metadata.documentRevision || metadata.version || ''} disabled={disabled} dir="ltr" className="text-left" onChange={(event) => patchMetadata({ documentRevision: event.target.value, version: event.target.value })} />
        <Input label="سازمان" value={metadata.organizationName || ''} disabled={disabled} onChange={(event) => patchMetadata({ organizationName: event.target.value })} />
        <Input label="واحد سازمانی" value={metadata.departmentName || ''} disabled={disabled} onChange={(event) => patchMetadata({ departmentName: event.target.value })} />
        <JalaliDateField
          label="تاریخ سند"
          value={metadata.documentDate || ''}
          disabled={disabled}
          onChange={(documentDate) => patchMetadata({ documentDate })}
        />
        <Input label="Base URL" value={metadata.baseUrl || ''} disabled={disabled} dir="ltr" className="text-left font-mono md:col-span-1 xl:col-span-3" onChange={(event) => patchMetadata({ baseUrl: event.target.value.replace(/\s+/g, '') })} />
        <Textarea label="مقدمه سرویس" value={metadata.serviceIntroduction || metadata.description || ''} disabled={disabled} className="min-h-28 md:col-span-2 xl:col-span-4" onChange={(event) => patchMetadata({ serviceIntroduction: event.target.value })} />
      </div>

      <DocumentationParameterEditor title="پارامترهای Header" rows={metadata.headerParameters || []} kind="HEADER" disabled={disabled} onChange={(rows) => patchMetadata({ headerParameters: rows })} />
      <DocumentationParameterEditor title="پارامترهای ورودی" rows={metadata.inputParameters || []} kind="INPUT" disabled={disabled} onChange={(rows) => patchMetadata({ inputParameters: rows })} />
      <DocumentationParameterEditor title="پارامترهای خروجی" rows={metadata.outputParameters || []} kind="OUTPUT" disabled={disabled} onChange={(rows) => patchMetadata({ outputParameters: rows })} />

      <div className="space-y-4 rounded-lg border border-gray-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-semibold text-gray-900">مستندات احراز هویت</h4>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={authentication.enabled} disabled={disabled} onChange={(event) => patchAuthentication({ enabled: event.target.checked })} />
            نمایش بخش احراز هویت
          </label>
        </div>
        <Select
          label="پروفایل قابل استفاده مجدد"
          value={metadata.authenticationProfileId || authentication.profileId || ''}
          disabled={disabled}
          onChange={(event) => patchMetadata({
            authenticationProfileId: event.target.value || undefined,
            authenticationDocumentation: event.target.value ? undefined : { ...authentication, profileId: undefined },
          })}
          options={[
            { value: '', label: 'بدون پروفایل' },
            { value: 'ministry-esb', label: 'Ministry ESB' },
          ]}
        />
        <p className="text-xs text-gray-500">پس از انتخاب پروفایل، Refresh را بزنید تا مقادیر مرکزی پروفایل اعمال شود.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Input label="عنوان احراز هویت" value={authentication.title} disabled={disabled} onChange={(event) => patchAuthentication({ title: event.target.value })} />
          <Input label="Base URL احراز هویت" value={authentication.baseUrl} disabled={disabled} dir="ltr" className="text-left font-mono" onChange={(event) => patchAuthentication({ baseUrl: event.target.value.replace(/\s+/g, '') })} />
          <Input label="Endpoint احراز هویت" value={authentication.endpoint} disabled={disabled} dir="ltr" className="text-left font-mono" onChange={(event) => patchAuthentication({ endpoint: event.target.value.replace(/\s+/g, '') })} />
          <Input label="Method" value={authentication.method} disabled={disabled} dir="ltr" className="text-left font-mono" onChange={(event) => patchAuthentication({ method: event.target.value.toUpperCase() })} />
          <Input label="Content-Type" value={authentication.contentType} disabled={disabled} dir="ltr" className="text-left font-mono" onChange={(event) => patchAuthentication({ contentType: event.target.value })} />
          <Textarea label="مقدمه احراز هویت" value={authentication.introduction} disabled={disabled} className="min-h-24 md:col-span-2 xl:col-span-3" onChange={(event) => patchAuthentication({ introduction: event.target.value })} />
        </div>
        <DocumentationParameterEditor title="Headerهای احراز هویت" rows={authentication.headerParameters || []} kind="HEADER" disabled={disabled} onChange={(rows) => patchAuthentication({ headerParameters: rows })} />
        <DocumentationParameterEditor title="ورودی‌های احراز هویت" rows={authentication.inputParameters} kind="INPUT" disabled={disabled} onChange={(rows) => patchAuthentication({ inputParameters: rows })} />
        <DocumentationParameterEditor title="خروجی‌های احراز هویت" rows={authentication.outputParameters} kind="OUTPUT" disabled={disabled} onChange={(rows) => patchAuthentication({ outputParameters: rows })} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Textarea label="نمونه cURL احراز هویت (مقادیر حساس ماسک شوند)" value={authentication.curlExample || ''} disabled={disabled} dir="ltr" className="min-h-48 text-left font-mono" onChange={(event) => patchAuthentication({ curlExample: event.target.value })} />
          <Textarea label="نمونه پاسخ احراز هویت" value={authentication.responseExample || ''} disabled={disabled} dir="ltr" className="min-h-48 text-left font-mono" onChange={(event) => patchAuthentication({ responseExample: event.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Textarea label="نمونه cURL سرویس (اختیاری)" value={metadata.curlExample || ''} disabled={disabled} dir="ltr" className="min-h-56 text-left font-mono" onChange={(event) => patchMetadata({ curlExample: event.target.value })} />
        <Textarea label="نمونه پاسخ موفق (اختیاری)" value={metadata.responseExample || ''} disabled={disabled} dir="ltr" className="min-h-56 text-left font-mono" onChange={(event) => patchMetadata({ responseExample: event.target.value })} />
      </div>

      <DocumentationResponseCodeEditor rows={metadata.responseCodes || []} disabled={disabled} onChange={(responseCodes) => patchMetadata({ responseCodes })} />
    </div>
  );
};

