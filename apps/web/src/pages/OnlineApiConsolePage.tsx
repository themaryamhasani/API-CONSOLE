import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  AlertTriangle,
  Braces,
  CheckCircle,
  Clock,
  Copy,
  Download,
  Edit3,
  Eye,
  FileText,
  FolderPlus,
  History,
  PlayCircle,
  Plus,
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
import type { PaginatedResponse, UserRole } from '../types';
import { Header } from '../components/layout/Header';
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
import { useAuthStore } from '../stores/authStore';
import { useDataScope } from '../utils/useDataScope';
import { useApplicationLookup } from '../utils/useApplicationLookup';
import { apiConsoleApi } from '../services/apiConsoleApi';
import { API_SHARING_STATUS_LABELS } from '../types/apiConsole';
import type {
  ApiClassification,
  ApiClassificationType,
  ApiCollection,
  ApiConsoleDirectoryUser,
  ApiConsumerCandidate,
  ApiCurlImportPreview,
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
  ApiShareRequest,
  ApiSharingStatus,
  ApiVersionConsumer,
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
type WorkspaceView = 'requests' | 'repository' | 'reviews' | 'users' | 'runtime';
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

const METHOD_OPTIONS: ApiHttpMethod[] = ['GET', 'POST'];
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

function parsePostmanRequestItem(
  item: Record<string, unknown>,
  folderPath: string[],
  inheritedAuth: Record<string, unknown> | null
): PostmanImportRequestPreview | null {
  const requestValue = item.request;
  if (!requestValue) return null;
  const warnings: string[] = [];
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

const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
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
  const { activeContext } = useAuthStore();
  const { appId, initialApplicationIdForCreate } = useDataScope();
  const { shouldShowSystemColumn, getApplicationName } = useApplicationLookup();
  const [collections, setCollections] = useState<ApiCollection[]>([]);
  const [environments, setEnvironments] = useState<ApiEnvironmentProfile[]>([]);
  const [requests, setRequests] = useState<PaginatedResponse<ApiRequestDefinition> | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ApiRequestDefinition | null>(null);
  const [savedRequest, setSavedRequest] = useState<ApiRequestDefinition | null>(null);
  const [pageMode, setPageMode] = useState<PageMode>('list');
  const [filters, setFilters] = useState({ page: 1, limit: 10, search: '', collectionId: '', classificationType: '' });
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
  const [corePresentationEnabled, setCorePresentationEnabled] = useState(true);
  const [selfCheckOpen, setSelfCheckOpen] = useState(false);
  const [selfCheck, setSelfCheck] = useState<{ passed: number; failed: number; details: ParserSelfCheckDetail[] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiRequestDefinition | null>(null);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [collectionForm, setCollectionForm] = useState({ applicationId: '', name: '', description: '' });
  const [exportingCollectionId, setExportingCollectionId] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('requests');
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
  const [shareForm, setShareForm] = useState({ purpose: '', introduction: '', description: '' });
  const [sharing, setSharing] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [reviewActionLoading, setReviewActionLoading] = useState(false);
  const [adminUsers, setAdminUsers] = useState<ApiConsoleDirectoryUser[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [adminRoleTarget, setAdminRoleTarget] = useState<{ user: ApiConsoleDirectoryUser; enabled: boolean } | null>(null);
  const [adminRoleSaving, setAdminRoleSaving] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionForm, setVersionForm] = useState({ version: '', changeLog: '' });
  const [versioning, setVersioning] = useState(false);
  const [runtimeConnected, setRuntimeConnected] = useState(false);
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
  const canManageGeneralSettings = role === 'SYSTEM_ADMIN';
  const canReviewShares = role === 'SYSTEM_ADMIN';

  const visibleTabs = useMemo(
    () => TAB_LABELS.filter(tab => tab.id !== 'settings' || canManageGeneralSettings),
    [canManageGeneralSettings]
  );

  const selectedEnvironment = useMemo(
    () => environments.find(environment => environment.id === selectedRequest?.environmentId) || environments[0],
    [environments, selectedRequest?.environmentId]
  );

  const latestExecution = selectedExecution || historyRows[0] || null;
  const hasUnsavedChanges = useMemo(() => {
    if (!selectedRequest || !savedRequest) return false;
    return JSON.stringify(selectedRequest) !== JSON.stringify(savedRequest);
  }, [selectedRequest, savedRequest]);

  useEffect(() => {
    if (activeContext) {
      loadAll();
    }
  }, [activeContext, appId, filters.page, filters.limit, filters.collectionId, filters.classificationType]);

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
    if (!canManageGeneralSettings && activeTab === 'settings') {
      setActiveTab('params');
    }
  }, [canManageGeneralSettings, activeTab]);

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
        apiConsoleApi.getCollections(appId, activeContext),
        apiConsoleApi.getEnvironments(),
        apiConsoleApi.getRequests(appId, filters, activeContext),
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

  const handleSystemAdminChange = async () => {
    if (!activeContext || !adminRoleTarget) return;
    setAdminRoleSaving(true);
    try {
      const updated = await apiConsoleApi.setSystemAdmin(
        adminRoleTarget.user.id,
        adminRoleTarget.enabled,
        activeContext
      );
      setAdminUsers(previous => previous.map(user => user.id === updated.id ? updated : user));
      toast.success(adminRoleTarget.enabled
        ? `نقش مدیرسیستم برای «${updated.fullName}» فعال شد.`
        : `نقش مدیرسیستم از «${updated.fullName}» گرفته شد.`);
      setAdminRoleTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تغییر نقش مدیرسیستم ناموفق بود.');
    } finally {
      setAdminRoleSaving(false);
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
    const response = await apiConsoleApi.getRequests(appId, filters, activeContext);
    if (reloadSeq !== reloadRequestsSeqRef.current) return;
    setRequests(response);
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
    setPostmanApplicationId(initialApplicationIdForCreate);
    setPostmanModalOpen(true);
  };

  const openCreateCollection = () => {
    setCollectionForm({ applicationId: initialApplicationIdForCreate, name: '', description: '' });
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

  const handleNewRequest = async () => {
    if (!activeContext || !canCreate) return;
    const selectedCollection = filters.collectionId
      ? collections.find(collection => collection.id === filters.collectionId)
      : undefined;
    if (!selectedCollection) {
      toast.info('برای ساخت Request ابتدا Collection و سامانه آن را انتخاب یا ایجاد کنید.');
      openCreateCollection();
      return;
    }
    const request = await apiConsoleApi.createBlankRequest(selectedCollection.id, selectedCollection.applicationId, environments[0]?.id || 'env-development', activeContext);
    toast.success('Request جدید ساخته شد.');
    await reloadRequests(request.id);
    setPageMode('editor');
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

  const handleParsePostmanCollection = () => {
    if (!postmanText.trim()) return;
    try {
      const preview = parsePostmanCollectionImport(postmanText);
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
          name: item.folderPath.length ? `${item.folderPath.join(' / ')} / ${item.name}` : item.name,
          ...(item.description ? { description: item.description } : {}),
          collectionId: collection.id,
          applicationId: collection.applicationId,
          environmentId: environments[0]?.id || 'env-development',
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
    if (!activeContext || !canCreate || !collectionForm.applicationId || !collectionForm.name.trim()) return;
    const normalizedName = collectionForm.name.trim().toLowerCase();
    const existingCollection = collections.find(collection =>
      collection.applicationId === collectionForm.applicationId
      && collection.name.trim().toLowerCase() === normalizedName
    );
    if (existingCollection) {
      setFilters(prev => ({ ...prev, collectionId: existingCollection.id, page: 1 }));
      setImportCollectionId(existingCollection.id);
      setCollectionModalOpen(false);
      setCollectionForm({ applicationId: initialApplicationIdForCreate, name: '', description: '' });
      toast.info('این Collection قبلاً وجود دارد و همان انتخاب شد.');
      return;
    }
    try {
      const collection = await apiConsoleApi.createCollection({
        applicationId: collectionForm.applicationId,
        name: collectionForm.name.trim(),
        description: collectionForm.description.trim() || undefined,
      }, activeContext);
      setCollections(prev => [collection, ...prev]);
      setFilters(prev => ({ ...prev, collectionId: collection.id, page: 1 }));
      setImportCollectionId(collection.id);
      setCollectionModalOpen(false);
      setCollectionForm({ applicationId: initialApplicationIdForCreate, name: '', description: '' });
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
    if (selectedRequest.classification.type === 'CORE_COMMAND' && (selectedRequest.runtimeBinding || selectedEnvironment.kind === 'PRODUCTION')) {
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
        ? await apiConsoleApi.generateDocumentationFinal(requestForDocument.id, activeContext)
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
        toast.success('سند نهایی Word بر اساس template تولید شد.');
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
      setShareForm({ purpose: '', introduction: '', description: '' });
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
    setSelectedConsumerIds([]);
    try {
      const [detail, candidates] = await Promise.all([
        apiConsoleApi.getShareReview(share.id, activeContext),
        apiConsoleApi.getConsumerCandidates(activeContext),
      ]);
      setReviewDetail(detail);
      setConsumerCandidates(candidates);
      setSelectedConsumerIds((detail.consumers || []).map(consumer =>
        consumer.consumerType === 'USER' ? `USER:${consumer.userId}` : `ROLE:${consumer.roleKey}`
      ));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری جزئیات درخواست اشتراک ناموفق بود.');
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
    setReviewActionLoading(true);
    try {
      await apiConsoleApi.approveShareReview(reviewDetail.id, consumers, reviewDetail.rowVersion, activeContext);
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
    setVersioning(true);
    try {
      const created = await apiConsoleApi.createVersion(selectedRequest.id, versionForm, activeContext);
      toast.success('Version جدید API ساخته شد و برای انتشار باید ارسال شود.');
      setVersionModalOpen(false);
      setVersionForm({ version: '', changeLog: '' });
      await reloadRequests(created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ساخت Version جدید ناموفق بود.');
    } finally {
      setVersioning(false);
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900">{item.name}</span>
            <Badge variant={classBadgeVariant(item.classification.type)} size="sm">
              {CLASSIFICATION_LABELS[item.classification.type]}
            </Badge>
            <Badge variant="default" size="sm">v{item.semanticVersion || item.documentation?.version || '1.0.0'}</Badge>
            {item.sourceType === 'REFERENCE' && <Badge variant="info" size="sm">Reference</Badge>}
            {item.sourceType === 'CDE_DISCOVERY' && <Badge variant="info" size="sm">CDE Sync</Badge>}
            {item.sourceSync?.status === 'STALE' && <Badge variant="danger" size="sm">STALE</Badge>}
            {item.sourceSync?.status === 'CONFLICT' && <Badge variant="warning" size="sm">Sync Conflict</Badge>}
            {item.latestReturnReason && <Badge variant="danger" size="sm">بازگردانی</Badge>}
            {selectingRequestId === item.id && (
              <MinimalLoader size="xs" className="text-blue-600" />
            )}
          </div>
          <p className="mt-1 max-w-[18rem] truncate text-left font-mono text-xs text-gray-500" dir="ltr">
            {item.method} {item.urlTemplate}
          </p>
        </div>
      ),
    },
    {
      key: 'apiId',
      title: 'API ID',
      render: (item: ApiRequestDefinition) => (
        <span className="font-mono text-xs text-gray-600" dir="ltr">{item.apiId || item.id}</span>
      ),
    },
    ...(shouldShowSystemColumn ? [{
      key: 'applicationId',
      title: 'سامانه',
      render: (item: ApiRequestDefinition) => getApplicationName(item.applicationId),
    }] : []),
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
    <div className="min-h-screen bg-gray-50">
      <Header
        title="Online API Console"
        onRefresh={loadAll}
        refreshing={loading}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant={runtimeConnected ? 'secondary' : 'ghost'} size="sm" icon={<PlayCircle className="h-4 w-4" />} onClick={() => { setPageMode('list'); setWorkspaceView('runtime'); }}>
              Runtime: {runtimeConnected ? 'متصل' : 'قطع'}
            </Button>
            {canManageGeneralSettings && <Button variant="secondary" size="sm" icon={<ShieldCheck className="h-4 w-4" />} onClick={runSelfCheck}>تست parser</Button>}
          </div>
        )}
      />

      <main className="space-y-6 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard title="Requestهای ذخیره‌شده" value={stats.total} icon={<Braces className="h-6 w-6" />} />
          <StatCard title="Core Query" value={stats.coreQuery} icon={<FileText className="h-6 w-6" />} variant="primary" />
          <StatCard title="Core Command" value={stats.coreCommand} icon={<AlertTriangle className="h-6 w-6" />} variant="danger" />
          <StatCard title="منتشرشده در Repository" value={stats.approved} icon={<ShieldCheck className="h-6 w-6" />} variant="success" />
          <StatCard title="در انتظار تأیید مدیرسیستم" value={stats.pendingReview} icon={<Clock className="h-6 w-6" />} variant="warning" />
          <StatCard title="History همین Request" value={stats.history} icon={<History className="h-6 w-6" />} />
        </div>

        {pageMode === 'list' ? (
          <section className="space-y-4">
            <Card padding="sm">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { id: 'requests' as const, label: 'Requestهای من', count: requests?.total || 0 },
                  { id: 'repository' as const, label: 'Repository APIها', count: repositoryRows?.total || 0 },
                  { id: 'runtime' as const, label: 'Runtime و Discovery', count: runtimeConnected ? 1 : 0 },
                  { id: 'reviews' as const, label: 'تأیید اشتراک API', count: shareReviews?.total || 0, hidden: !canReviewShares },
                  { id: 'users' as const, label: 'مدیریت کاربران', count: adminUsers.length, hidden: !canManageGeneralSettings },
                ].filter(item => !item.hidden).map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setWorkspaceView(item.id)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      workspaceView === item.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className={`min-w-6 rounded-full px-2 py-0.5 text-center text-xs ${workspaceView === item.id ? 'bg-white/20' : 'bg-white'}`}>
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            </Card>

            {workspaceView === 'requests' && (
              <>
            <Card padding="sm">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Requestهای من</h2>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<FolderPlus className="h-4 w-4" />}
                      onClick={openCreateCollection}
                      disabled={!canCreate}
                    >
                      Collection جدید
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Download className="h-4 w-4" />}
                      onClick={() => handleExportPostmanCollection()}
                      loading={!!filters.collectionId && exportingCollectionId === filters.collectionId}
                      disabled={!collections.length}
                    >
                      Export Postman
                    </Button>
                    <Button size="sm" variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={openImportCurl} disabled={!canCreate}>
                      Import cURL
                    </Button>
                    <Button size="sm" variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={openImportPostmanCollection} disabled={!canCreate}>
                      Import Collection
                    </Button>
                    <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={handleNewRequest} disabled={!canCreate}>
                      Request جدید
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(220px,1fr)_180px_180px_auto]">
                  <Input
                    aria-label="جستجوی Request"
                    value={filters.search}
                    onChange={(event) => setFilters(prev => ({ ...prev, search: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') reloadRequests();
                    }}
                    placeholder="جستجو در نام، URL، Service ID یا operation path"
                    className="py-1.5 text-sm"
                  />
                  <Select
                    aria-label="Collection"
                    value={filters.collectionId}
                    onChange={(event) => setFilters(prev => ({ ...prev, collectionId: event.target.value, page: 1 }))}
                    className="py-1.5 text-sm"
                    options={[
                      { value: '', label: 'همه Collectionها' },
                      ...collections.map(collection => ({ value: collection.id, label: `${collection.name} — ${getApplicationName(collection.applicationId)}` })),
                    ]}
                  />
                  <Select
                    aria-label="Classification"
                    value={filters.classificationType}
                    onChange={(event) => setFilters(prev => ({ ...prev, classificationType: event.target.value, page: 1 }))}
                    className="py-1.5 text-sm"
                    options={[
                      { value: '', label: 'همه نوع‌ها' },
                      { value: 'GENERIC_HTTP', label: 'Generic HTTP' },
                      { value: 'CORE_QUERY', label: 'Core Query' },
                      { value: 'CORE_COMMAND', label: 'Core Command' },
                    ]}
                  />
                  <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => reloadRequests()}>
                    فیلتر
                  </Button>
                </div>
              </div>
            </Card>

            <Table
              columns={requestColumns}
              data={requests?.data || []}
              loading={loading}
              emptyMessage="Request ذخیره‌شده‌ای وجود ندارد"
              onRowClick={handleSelectRequest}
              enableClientFilter={false}
              enableColumnChooser={false}
              enableExport={false}
              rowClassName={(item) => selectingRequestId === item.id ? 'bg-blue-50 opacity-80' : selectedRequest?.id === item.id ? 'bg-blue-50' : ''}
            />
            {requests && (
              <Pagination
                page={requests.page}
                totalPages={requests.totalPages}
                total={requests.total}
                limit={requests.limit}
                onPageChange={(page) => setFilters(prev => ({ ...prev, page }))}
                onLimitChange={(limit) => setFilters(prev => ({ ...prev, page: 1, limit }))}
              />
            )}
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

            {workspaceView === 'users' && canManageGeneralSettings && (
              <UserManagementSection
                users={adminUsers}
                loading={adminUsersLoading}
                search={adminUserSearch}
                onSearch={setAdminUserSearch}
                onRefresh={loadAdminUsers}
                onChangeSystemAdmin={(user, enabled) => setAdminRoleTarget({ user, enabled })}
              />
            )}

            {workspaceView === 'runtime' && activeContext && (
              <RuntimeWorkspace
                context={activeContext}
                projectKey={activeContext.applicationId}
                collections={collections}
                isSystemAdmin={canManageGeneralSettings}
                onSynced={reloadRequests}
                onConnectionChange={setRuntimeConnected}
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
                  <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => handleGenerateDocs(true)} disabled={!canDocument}>
                    تولید سند نهایی
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
                      <Button
                        icon={<PlayCircle className="h-4 w-4" />}
                        onClick={handleSend}
                        loading={executing}
                        disabled={!canExecute}
                      >
                        ارسال
                      </Button>
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
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      اجرای Production Core Command نیازمند permission بالاتر، confirmation و business justification است.
                    </div>
                  )}
                  {selectedRequest.runtimeBinding && (
                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                      <div className="font-semibold">Runtime binding ثبت‌شده</div>
                      <div className="mt-1 font-mono text-xs" dir="ltr">
                        profile={selectedRequest.runtimeBinding.runtimeProfileId} · operation={selectedRequest.runtimeBinding.operationId} · source={selectedRequest.runtimeBinding.sourceKind}
                      </div>
                      <div className="mt-1 text-xs">Cookie و client-id در این Request ذخیره نشده‌اند و هنگام اجرا فقط در backend تزریق می‌شوند.</div>
                    </div>
                  )}
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
                          activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
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
                      <KeyValueEditor
                        rows={selectedRequest.queryParameters}
                        onChange={(rows) => updateDraft(request => ({ ...request, queryParameters: rows }))}
                        onAdd={() => updateDraft(request => ({ ...request, queryParameters: [...request.queryParameters, { ...makeParam(), displayOrder: request.queryParameters.length }] }))}
                        valueKey="value"
                        title="Query parameters"
                      />
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

                    {activeTab === 'settings' && canManageGeneralSettings && (
                      <SettingsPanel
                        request={selectedRequest}
                        environment={selectedEnvironment}
                        effectiveRequest={effectiveRequest}
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
              </div>
              {repositoryDetail.changeLog && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                  <span className="font-semibold">Change Log: </span>{repositoryDetail.changeLog}
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
                <Button onClick={handleAddRepositoryVersion} disabled={!!repositoryDetail.referenceId}>
                  {repositoryDetail.referenceId ? 'قبلاً اضافه شده' : 'استفاده از API'}
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
              {reviewDetail.status === 'PENDING_REVIEW' && (
                <div className="flex justify-end gap-2">
                  <Button variant="warning" onClick={() => setReturnModalOpen(true)}>بازگردانی</Button>
                  <Button onClick={() => setApproveModalOpen(true)} disabled={!selectedConsumerIds.length}>تأیید و انتشار</Button>
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
          <p className="text-sm text-gray-600">Approval بدون Consumer مجاز نیست. بعد از تأیید، نسخه در Repository برای Consumerهای انتخاب‌شده قابل مشاهده می‌شود.</p>
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
        title={adminRoleTarget?.enabled ? 'افزودن مدیرسیستم' : 'لغو نقش مدیرسیستم'}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {adminRoleTarget?.enabled
              ? `آیا «${adminRoleTarget.user.fullName}» به‌عنوان مدیرسیستم تأیید شود؟ این شخص امکان تأیید اشتراک API و مدیریت کاربران را خواهد داشت.`
              : `آیا نقش مدیرسیستم از «${adminRoleTarget?.user.fullName || ''}» گرفته شود؟`}
          </p>
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
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setVersionModalOpen(false)} disabled={versioning}>انصراف</Button>
            <Button onClick={handleCreateVersion} loading={versioning}>ساخت Version</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={collectionModalOpen} onClose={() => setCollectionModalOpen(false)} title="Collection جدید" size="md">
        <div className="space-y-4">
          <ApplicationSelect
            label="سامانه Collection"
            required
            value={collectionForm.applicationId}
            onChange={(applicationId) => setCollectionForm(prev => ({ ...prev, applicationId }))}
            hint="تمام Requestهای این Collection به همین سامانه تعلق دارند."
          />
          <Input
            label="نام Collection"
            value={collectionForm.name}
            onChange={(event) => setCollectionForm(prev => ({ ...prev, name: event.target.value }))}
            placeholder="مثلاً سرویس‌های Core مدرسه"
          />
          <Textarea
            label="توضیحات Collection"
            value={collectionForm.description}
            onChange={(event) => setCollectionForm(prev => ({ ...prev, description: event.target.value }))}
            className="min-h-28"
            placeholder="توضیح کوتاه برای گروه‌بندی Requestها"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCollectionModalOpen(false)}>انصراف</Button>
            <Button icon={<FolderPlus className="h-4 w-4" />} onClick={handleCreateCollection} disabled={!collectionForm.applicationId || !collectionForm.name.trim() || !canCreate}>
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
    </div>
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
            label={isCommand ? 'Data payload' : 'Params payload'}
            value={JSON.stringify(isCommand ? body.data || {} : body.params || {}, null, 2)}
            onChange={(event) => onPayloadPatch(isCommand ? 'data' : 'params', event.target.value)}
            className="min-h-72 text-left font-mono"
            dir="ltr"
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
                'testResponseTimeBelow(5000)',
                'testHeaderContains("content-type", "json")',
                'testJsonPath("$.data")',
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
  effectiveRequest,
  onChange,
}: {
  request: ApiRequestDefinition;
  environment?: ApiEnvironmentProfile | undefined;
  effectiveRequest: ApiEffectiveRequestSnapshot | null;
  onChange: (patch: Partial<ApiRequestDefinition>) => void;
}) => (
  <div className="space-y-5">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Toggle
        checked={request.tls.verifyCertificate}
        onChange={(checked) => onChange({ tls: { ...request.tls, verifyCertificate: checked } })}
        label="Verify TLS certificate"
      />
      <Toggle
        checked={request.executionMode === 'EXACT'}
        onChange={(checked) => onChange({ executionMode: checked ? 'EXACT' : 'RECOMMENDED' })}
        label="Exact replay mode"
      />
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
        Timeout: 30s connect، 60s read، 90s total. Max response: 1 MB در backend Runner.
      </div>
    </div>
    {!request.tls.verifyCertificate && (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
        Insecure TLS در UI نمایش داده می‌شود، audit می‌شود و طبق policy برای Production execution block است.
      </div>
    )}
    {environment && (
      <div>
        <h3 className="mb-3 font-semibold text-gray-900">Environment variables</h3>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {environment.variables.map(variable => (
            <div key={variable.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-gray-900" dir="ltr">{variable.key}</span>
                {variable.sensitive && <Badge variant="warning" size="sm">Sensitive</Badge>}
              </div>
              <p className="mt-1 break-all text-left font-mono text-xs text-gray-500" dir="ltr">
                {variable.sensitive ? '{{secret-reference}}' : variable.currentValue}
              </p>
              <p className="mt-1 text-xs text-gray-500">{variable.description}</p>
            </div>
          ))}
        </div>
      </div>
    )}
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
        <div key={row.id} className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 lg:grid-cols-[44px_260px_1fr_44px]">
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
          <button type="button" onClick={() => onChange(rows.filter(item => item.id !== row.id))} className="rounded-lg text-red-600 hover:bg-red-50">
            <Trash2 className="mx-auto h-4 w-4" />
          </button>
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
  onSelect,
  onManual,
}: {
  rows: ApiRequestExecution[];
  selected: ApiRequestExecution | null;
  manualResponses: ApiManualResponseExample[];
  loading: boolean;
  onSelect: (execution: ApiRequestExecution) => void;
  onManual: () => void;
}) => (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-gray-900">History اجرا</h3>
      <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={onManual}>Response دستی</Button>
    </div>
    <Table
      columns={[
        { key: 'status', title: 'وضعیت', render: (item: ApiRequestExecution) => <Badge variant={resultBadgeVariant(item.transportResult)}>{item.transportResult}</Badge> },
        { key: 'code', title: 'HTTP', render: (item: ApiRequestExecution) => item.statusCode || '-' },
        { key: 'business', title: 'Business', render: (item: ApiRequestExecution) => <Badge variant={resultBadgeVariant(item.businessResult)}>{item.businessResult}</Badge> },
        { key: 'duration', title: 'زمان پاسخ', render: (item: ApiRequestExecution) => `${item.durationMs || 0}ms` },
        { key: 'runner', title: 'Runner', render: (item: ApiRequestExecution) => item.runnerId },
        { key: 'time', title: 'زمان', render: (item: ApiRequestExecution) => formatDate(item.startedAt) },
        { key: 'actions', title: '', render: (item: ApiRequestExecution) => (
          <Button size="sm" variant={selected?.id === item.id ? 'primary' : 'ghost'} icon={<Eye className="h-4 w-4" />} onClick={(event) => {
            event.stopPropagation();
            onSelect(item);
          }}>
            مشاهده
          </Button>
        ) },
      ]}
      data={rows}
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

const ResponsePanel = ({
  execution,
  loading,
  canDisableTls,
  onDisableTlsAndRetry,
}: {
  execution: ApiRequestExecution | null;
  loading: boolean;
  canDisableTls: boolean;
  onDisableTlsAndRetry: () => void;
}) => {
  const body = safeBodyPreview(execution);
  const isJsonBody = isJsonResponsePreview(execution);
  const canRetryInsecure = execution?.errorCategory === 'TLS_ERROR' && execution.requestSnapshot.tls.verifyCertificate && canDisableTls;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">نمایش Response</h3>
        {loading ? (
          <Badge variant="info">Loading</Badge>
        ) : execution ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant={resultBadgeVariant(execution.transportResult)}>{execution.transportResult}</Badge>
            <Badge variant={resultBadgeVariant(execution.businessResult)}>Business: {execution.businessResult}</Badge>
          </div>
        ) : <Badge>Execution ندارد</Badge>}
      </div>
      {loading ? (
        <LoadingState label="در حال بارگذاری response و metadata..." className="py-10" />
      ) : !execution ? (
        <p className="text-sm text-gray-500">برای مشاهده response metadata و body، Request را Execute کنید.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <InfoTile label="HTTP" value={execution.statusCode ? String(execution.statusCode) : '-'} />
            <InfoTile label="Duration" value={`${execution.durationMs || 0}ms`} />
            <InfoTile label="Size" value={`${execution.responseSize || 0} bytes`} />
            <InfoTile label="Runner" value={execution.runnerId} />
            <InfoTile label="Resolved IP" value={execution.response?.resolvedIpAddress || '-'} />
            <InfoTile label="TLS" value={execution.tlsVerification ? 'Verified' : 'Insecure'} />
            <InfoTile label="Correlation" value={execution.correlationId} />
            <InfoTile label="Evidence" value={execution.evidenceType} />
          </div>
          {execution.sanitizedError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <div>{execution.errorCategory}: {execution.sanitizedError}</div>
              {canRetryInsecure && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-red-700">
                    برای این target، certificate با hostname match نیست. فقط برای محیط غیر Production می‌توانید TLS verification را آگاهانه خاموش کنید.
                  </span>
                  <Button size="sm" variant="danger" icon={<AlertTriangle className="h-4 w-4" />} onClick={onDisableTlsAndRetry}>
                    خاموش کردن Verify TLS و Retry
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <FieldLabel>Response headers</FieldLabel>
              <CodeBlock value={execution.response?.headers.map(header => `${header.name}: ${header.valueTemplate}`).join('\n') || '-'} />
            </div>
            <div>
              <FieldLabel>Assertions</FieldLabel>
              <CodeBlock value={execution.assertionResults.map(result => `${result.result}: ${result.message}`).join('\n') || 'ارزیابی نشده'} />
            </div>
          </div>
          {execution.scriptResults?.length ? (
            <div>
              <FieldLabel>Script results</FieldLabel>
              <div className="space-y-2">
                {execution.scriptResults.map((result, index) => (
                  <div key={`${result.phase}-${result.line}-${index}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm">
                    <Badge variant={result.result === 'PASSED' ? 'success' : result.result === 'FAILED' ? 'danger' : 'warning'} size="sm">
                      {result.result}
                    </Badge>
                    <span className="font-mono text-xs text-gray-500" dir="ltr">{result.phase} line {result.line}</span>
                    <span className="text-gray-700">{result.message}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <FieldLabel>Body ({execution.response?.safePreviewMode || 'TEXT'})</FieldLabel>
            {execution.response?.safePreviewMode === 'SANDBOXED_HTML' ? (
              <iframe title="API response sandbox" srcDoc={body} sandbox="" className="theme-light-preview h-64 w-full rounded-lg border border-gray-200 bg-white" />
            ) : isJsonBody ? (
              <JsonResponseViewer value={body} />
            ) : (
              <CodeBlock value={body} minHeight="min-h-64" />
            )}
          </div>
        </div>
      )}
    </Card>
  );
};

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

const RepositorySection = ({
  rows,
  loading,
  filters,
  onFilters,
  onRefresh,
  onOpen,
}: {
  rows: PaginatedResponse<ApiRepositoryItem> | null;
  loading: boolean;
  filters: { page: number; limit: number; search: string };
  onFilters: Dispatch<SetStateAction<{ page: number; limit: number; search: string }>>;
  onRefresh: () => void;
  onOpen: (item: ApiRepositoryItem) => void;
}) => (
  <div className="space-y-4">
    <Card padding="sm">
      <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(220px,1fr)_auto]">
        <Input
          aria-label="جستجوی Repository"
          value={filters.search}
          onChange={(event) => onFilters(prev => ({ ...prev, search: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRefresh();
          }}
          placeholder="جستجو در API ID، نام، Service ID یا operation path"
          className="py-1.5 text-sm"
        />
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
          فیلتر
        </Button>
      </div>
    </Card>
    <Table
      columns={[
        {
          key: 'title',
          title: 'API',
          render: (item: ApiRepositoryItem) => (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{item.title}</span>
                <Badge variant="default" size="sm">v{item.version}</Badge>
                <Badge variant={classBadgeVariant(item.classification.type)} size="sm">{CLASSIFICATION_LABELS[item.classification.type]}</Badge>
                {item.isNewForUser && <Badge variant="success" size="sm">جدید</Badge>}
                {item.hasNewerVersion && <Badge variant="warning" size="sm">نسخه جدید موجود است</Badge>}
              </div>
              <p className="mt-1 max-w-[26rem] truncate font-mono text-xs text-gray-500" dir="ltr">{item.method} {item.urlTemplate}</p>
            </div>
          ),
        },
        { key: 'apiId', title: 'API ID', render: (item: ApiRepositoryItem) => <span className="font-mono text-xs" dir="ltr">{item.apiId}</span> },
        { key: 'consumers', title: 'Consumer', render: (item: ApiRepositoryItem) => item.consumers.length },
        { key: 'updatedAt', title: 'آخرین تغییر', render: (item: ApiRepositoryItem) => formatDate(item.updatedAt) },
        {
          key: 'actions',
          title: 'عملیات',
          render: (item: ApiRepositoryItem) => (
            <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={(event) => {
              event.stopPropagation();
              onOpen(item);
            }}>
              Preview
            </Button>
          ),
        },
      ]}
      data={rows?.data || []}
      loading={loading}
      emptyMessage="API قابل استفاده‌ای در Repository وجود ندارد"
      onRowClick={onOpen}
      enableClientFilter={false}
      enableColumnChooser={false}
      enableExport={false}
    />
    {rows && (
      <Pagination
        page={rows.page}
        totalPages={rows.totalPages}
        total={rows.total}
        limit={rows.limit}
        onPageChange={(page) => onFilters(prev => ({ ...prev, page }))}
        onLimitChange={(limit) => onFilters(prev => ({ ...prev, page: 1, limit }))}
      />
    )}
  </div>
);

const ShareReviewSection = ({
  rows,
  loading,
  filters,
  onFilters,
  onRefresh,
  onOpen,
  getApplicationName,
}: {
  rows: PaginatedResponse<ApiShareRequest> | null;
  loading: boolean;
  filters: { page: number; limit: number; search: string; status: string };
  onFilters: Dispatch<SetStateAction<{ page: number; limit: number; search: string; status: string }>>;
  onRefresh: () => void;
  onOpen: (item: ApiShareRequest) => void;
  getApplicationName: (applicationId?: string) => string;
}) => (
  <div className="space-y-4">
    <Card padding="sm">
      <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(220px,1fr)_180px_auto]">
        <Input
          aria-label="جستجوی درخواست اشتراک"
          value={filters.search}
          onChange={(event) => onFilters(prev => ({ ...prev, search: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRefresh();
          }}
          placeholder="جستجو در عنوان API، API ID یا ثبت‌کننده"
          className="py-1.5 text-sm"
        />
        <Select
          aria-label="وضعیت بررسی"
          value={filters.status}
          onChange={(event) => onFilters(prev => ({ ...prev, status: event.target.value, page: 1 }))}
          className="py-1.5 text-sm"
          options={[
            { value: '', label: 'همه وضعیت‌ها' },
            { value: 'PENDING_REVIEW', label: 'در انتظار بررسی' },
            { value: 'APPROVED', label: 'تأییدشده' },
            { value: 'RETURNED', label: 'بازگردانده‌شده' },
          ]}
        />
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
          فیلتر
        </Button>
      </div>
    </Card>
    <Table
      columns={[
        {
          key: 'apiTitle',
          title: 'عنوان API',
          render: (item: ApiShareRequest) => (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{item.apiTitle}</span>
                <Badge variant="default" size="sm">v{item.version}</Badge>
              </div>
              <p className="mt-1 font-mono text-xs text-gray-500" dir="ltr">{item.apiId}</p>
            </div>
          ),
        },
        {
          key: 'status',
          title: 'وضعیت',
          render: (item: ApiShareRequest) => (
            <Badge variant={sharingBadgeVariant(item.status)} size="sm">{API_SHARING_STATUS_LABELS[item.status]}</Badge>
          ),
        },
        { key: 'applicationId', title: 'سامانه', render: (item: ApiShareRequest) => getApplicationName(item.applicationId) },
        { key: 'submittedBy', title: 'ثبت‌کننده', render: (item: ApiShareRequest) => item.submittedByName || item.submittedBy },
        { key: 'revision', title: 'Revision', render: (item: ApiShareRequest) => item.currentRevisionNumber },
        { key: 'updatedAt', title: 'زمان', render: (item: ApiShareRequest) => formatDate(item.updatedAt) },
        {
          key: 'actions',
          title: 'عملیات',
          render: (item: ApiShareRequest) => (
            <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={(event) => {
              event.stopPropagation();
              onOpen(item);
            }}>
              بررسی
            </Button>
          ),
        },
      ]}
      data={rows?.data || []}
      loading={loading}
      emptyMessage="درخواست اشتراک API برای بررسی وجود ندارد"
      onRowClick={onOpen}
      enableClientFilter={false}
      enableColumnChooser={false}
      enableExport={false}
    />
    {rows && (
      <Pagination
        page={rows.page}
        totalPages={rows.totalPages}
        total={rows.total}
        limit={rows.limit}
        onPageChange={(page) => onFilters(prev => ({ ...prev, page }))}
        onLimitChange={(limit) => onFilters(prev => ({ ...prev, page: 1, limit }))}
      />
    )}
  </div>
);

const UserManagementSection = ({
  users,
  loading,
  search,
  onSearch,
  onRefresh,
  onChangeSystemAdmin,
}: {
  users: ApiConsoleDirectoryUser[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onChangeSystemAdmin: (user: ApiConsoleDirectoryUser, enabled: boolean) => void;
}) => {
  const normalizedSearch = search.trim().toLocaleLowerCase('fa-IR');
  const filteredUsers = normalizedSearch
    ? users.filter(user => [user.fullName, user.phoneNumber, ...user.roles.map(roleLabel)]
        .filter(Boolean)
        .some(value => String(value).toLocaleLowerCase('fa-IR').includes(normalizedSearch)))
    : users;

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">مدیریت کاربران CDE</h2>
              <p className="mt-1 text-sm text-gray-500">
                هویت دولوپرها بعد از نخستین ورود موفق به این کنسول با حساب CDE به‌صورت خودکار همگام می‌شود.
              </p>
            </div>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh} loading={loading}>
              بروزرسانی فهرست
            </Button>
          </div>
          <Input
            aria-label="جستجوی کاربران CDE"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="جستجو بر اساس نام، شماره همراه یا نقش"
            className="py-1.5 text-sm"
          />
        </div>
      </Card>

      <Table
        columns={[
          {
            key: 'fullName',
            title: 'نام کاربر',
            render: (user: ApiConsoleDirectoryUser) => (
              <div>
                <p className="font-medium text-gray-900">{user.fullName || user.id}</p>
                <p className="mt-1 font-mono text-xs text-gray-500" dir="ltr">{user.phoneNumber || '-'}</p>
              </div>
            ),
          },
          {
            key: 'source',
            title: 'منبع هویت',
            render: (user: ApiConsoleDirectoryUser) => <Badge variant="info" size="sm">{user.source === 'CDE' ? 'CDE' : user.source}</Badge>,
          },
          {
            key: 'roles',
            title: 'نقش‌های فعال',
            render: (user: ApiConsoleDirectoryUser) => (
              <div className="flex flex-wrap gap-1">
                {user.roles.map(role => (
                  <Badge key={role} variant={role === 'SYSTEM_ADMIN' ? 'success' : 'secondary'} size="sm">{roleLabel(role)}</Badge>
                ))}
                {user.isBootstrapAdmin && <Badge variant="warning" size="sm">مدیر اولیه تنظیمات سرور</Badge>}
              </div>
            ),
          },
          {
            key: 'actions',
            title: 'عملیات',
            render: (user: ApiConsoleDirectoryUser) => user.isSystemAdmin ? (
              <Button
                size="sm"
                variant="danger"
                disabled={user.isBootstrapAdmin}
                onClick={(event) => {
                  event.stopPropagation();
                  onChangeSystemAdmin(user, false);
                }}
              >
                {user.isBootstrapAdmin ? 'مدیر اولیه' : 'لغو نقش مدیرسیستم'}
              </Button>
            ) : (
              <Button
                size="sm"
                icon={<ShieldCheck className="h-4 w-4" />}
                onClick={(event) => {
                  event.stopPropagation();
                  onChangeSystemAdmin(user, true);
                }}
              >
                افزودن به‌عنوان مدیرسیستم
              </Button>
            ),
          },
        ]}
        data={filteredUsers}
        loading={loading}
        emptyMessage="هنوز کاربری از CDE همگام نشده است"
        enableClientFilter={false}
        enableColumnChooser={false}
        enableExport={false}
      />
    </div>
  );
};

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
          label="سامانه Collection"
          required
          value={applicationId}
          onChange={onApplicationChange}
          disabled={importing}
          hint="Collection و تمام Requestهای Importشده به این سامانه متصل می‌شوند."
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

const ImportCurlModal = ({
  open,
  title = 'Import cURL',
  primaryActionLabel = 'Import',
  curlText,
  requestTitle = '',
  collections = [],
  selectedCollectionId = '',
  preview,
  previewSubtab,
  onSubtab,
  onText,
  onRequestTitle,
  onCollectionChange,
  onParse,
  onImport,
  onClose,
}: {
  open: boolean;
  title?: string;
  primaryActionLabel?: string;
  curlText: string;
  requestTitle?: string;
  collections?: ApiCollection[];
  selectedCollectionId?: string;
  preview: ApiCurlImportPreview | null;
  previewSubtab: 'summary' | 'original' | 'normalized' | 'warnings';
  onSubtab: (tab: 'summary' | 'original' | 'normalized' | 'warnings') => void;
  onText: (value: string) => void;
  onRequestTitle?: (value: string) => void;
  onCollectionChange?: (value: string) => void;
  onParse: () => void;
  onImport: () => void;
  onClose: () => void;
}) => (
  <Modal isOpen={open} onClose={onClose} title={title} size="wide">
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3">
        {(onRequestTitle || onCollectionChange) && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {onRequestTitle && (
              <Input
                label="عنوان Web Service"
                value={requestTitle}
                onChange={(event) => onRequestTitle(event.target.value)}
                placeholder="مثلاً دریافت لیست کمپ‌های مدرسه"
              />
            )}
            {onCollectionChange && (
              <Select
                label="Collection"
                value={selectedCollectionId}
                onChange={(event) => onCollectionChange(event.target.value)}
                options={[
                  { value: '', label: 'یک Collection انتخاب کنید *' },
                  ...collections.map(collection => ({ value: collection.id, label: collection.name })),
                ]}
              />
            )}
          </div>
        )}
        <Textarea
          label="cURL command را وارد کنید"
          value={curlText}
          onChange={(event) => onText(event.target.value)}
          className="min-h-48 text-left font-mono sm:min-h-[420px]"
          dir="ltr"
        />
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          Importer متن cURL را مستقیم tokenize می‌کند و هیچ‌وقت shell، command prompt، PowerShell، eval یا child process اجرا نمی‌کند.
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>انصراف</Button>
          <Button icon={<Upload className="h-4 w-4" />} onClick={onParse} disabled={!curlText.trim()}>Parse Preview</Button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['summary', 'original', 'normalized', 'warnings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => onSubtab(tab)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${previewSubtab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {tab}
            </button>
          ))}
        </div>
        {!preview ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 sm:min-h-[420px]">
            برای review کردن normalized request قبل از Import، یک cURL command را Parse کنید.
          </div>
        ) : (
          <div className="space-y-3">
            {previewSubtab === 'summary' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoTile label="Dialect" value={preview.detectedDialect} />
                <InfoTile label="Method" value={preview.effectiveMethod} />
                <InfoTile label="URL" value={preview.url} />
                <InfoTile label="Headers" value={String(preview.headerCount)} />
                <InfoTile label="Cookies" value={String(preview.cookieCount)} />
                <InfoTile label="Body type" value={preview.bodyType} />
                <InfoTile label="JSON validity" value={preview.jsonValidity.valid ? 'valid' : preview.jsonValidity.error || 'invalid'} />
                <InfoTile label="TLS verify" value={preview.tlsVerification ? 'true' : 'false'} />
                <InfoTile label="Classification" value={preview.normalizedRequest.classification.type} />
                <InfoTile label="Service ID" value={preview.normalizedRequest.classification.serviceId || '-'} />
                <InfoTile label="Operation path" value={preview.normalizedRequest.classification.operationPath || '-'} />
                <InfoTile label="Parser" value={preview.parserVersion} />
              </div>
            )}
            {previewSubtab === 'original' && <CodeBlock value={preview.originalCurl} minHeight="min-h-48 sm:min-h-[420px]" />}
            {previewSubtab === 'normalized' && <CodeBlock value={JSON.stringify(preview.normalizedRequest, null, 2)} minHeight="min-h-48 sm:min-h-[420px]" />}
            {previewSubtab === 'warnings' && (
              <div className="min-h-48 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:min-h-[420px]">
                {preview.warnings.length || preview.unsupportedOptions.length ? (
                  [...preview.warnings, ...preview.unsupportedOptions.map(option => `Unsupported option: ${option}`)].map((warning, index) => (
                    <div key={`${warning}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-700">
                      {warning}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">Parser warning وجود ندارد.</p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
              <Button variant="secondary" onClick={onClose}>انصراف</Button>
              <Button icon={<CheckCircle className="h-4 w-4" />} onClick={onImport} disabled={!!onCollectionChange && !selectedCollectionId}>{primaryActionLabel}</Button>
            </div>
          </div>
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

const DocumentationModal = ({
  open,
  markdown,
  warnings,
  onClose,
}: {
  open: boolean;
  markdown: string;
  warnings: string[];
  onClose: () => void;
}) => (
  <Modal isOpen={open} onClose={onClose} title="سند تولیدشده API" size="wide">
    <div className="space-y-4">
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((warning, index) => (
            <div key={`${warning}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-700">
              {warning}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => {
          navigator.clipboard?.writeText(markdown);
          toast.success('Documentation کپی شد.');
        }}>
          کپی Markdown
        </Button>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => {
          const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `api-console-doc-${new Date().toISOString().split('T')[0]}.md`;
          a.click();
          URL.revokeObjectURL(url);
        }}>
          Markdown
        </Button>
      </div>
      <CodeBlock value={markdown} minHeight="min-h-48 sm:min-h-[560px]" />
    </div>
  </Modal>
);
