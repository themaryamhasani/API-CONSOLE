const CSRF_STORAGE_KEY = 'api-console-csrf';

export type CdeBranchSelector =
  | { kind: 'PUBLIC' }
  | { kind: 'PERSONAL'; randId?: string; index?: number };

export interface CdeConnectionStatus {
  connected: boolean;
  reconnectRequired?: boolean;
  nextStep?: string;
  challenge?: string;
  ecreq?: boolean;
  csrfToken?: string;
  user?: { id?: string; firstName: string; lastName: string; displayName: string; userLoginName?: string } | null;
}

export interface CdePackageSummary {
  id: string;
  branches: Array<{
    selector: CdeBranchSelector;
    versionId?: string | null;
    editable?: boolean;
    meta?: Record<string, unknown>;
    configured?: boolean;
  }>;
}

export interface CdeCatalogRepository {
  type: 'WEB_UI' | 'DATA_SERVICE' | 'API_MODULE' | 'MESSAGE_CONSUMER' | 'TESTS';
  repoName: string;
  packages: CdePackageSummary[];
  error?: { code: string; message: string };
}

export interface CdeCatalog {
  applicationId?: string;
  projectKey: string;
  approach?: 'GATEWAY' | 'DATA_SERVICE';
  repositories: CdeCatalogRepository[];
}

export interface CdePackageContent {
  applicationId?: string;
  projectKey?: string;
  repositoryType: CdeCatalogRepository['type'];
  repoName: string;
  packId: string;
  branches: Array<{
    selector: CdeBranchSelector;
    versionId?: string | null;
    editable?: boolean;
    meta?: Record<string, unknown>;
  }>;
  branch: {
    selector: CdeBranchSelector;
    versionId?: string | null;
    editable: boolean;
    meta?: Record<string, unknown>;
  };
  files: Array<{ path: string; code: string; language?: string; readOnly: boolean }>;
}

export interface CdeProjectDescriptor {
  projectKey: string;
  repositories: Record<'WEB_UI' | 'DATA_SERVICE' | 'API_MODULE' | 'MESSAGE_CONSUMER', string>;
  editorUrls: {
    webUi: string;
    dataService: string;
    gateway: string;
  };
}

export interface CdeOriginOption {
  id: string;
  label: string;
  baseUrl: string;
}

export class PlatformApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

export function getCsrfToken(): string {
  return storage()?.getItem(CSRF_STORAGE_KEY) || '';
}

export function setCsrfToken(value?: string | null): void {
  const target = storage();
  if (!target) return;
  if (value) target.setItem(CSRF_STORAGE_KEY, value);
  else target.removeItem(CSRF_STORAGE_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const csrf = getCsrfToken();
  if (csrf && !['GET', 'HEAD'].includes(String(init.method || 'GET').toUpperCase())) {
    headers.set('x-csrf-token', csrf);
  }
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = payload?.error || {};
    throw new PlatformApiError(error.category || 'PLATFORM_API_ERROR', error.message || response.statusText, response.status, error.details);
  }
  if (payload?.csrfToken) setCsrfToken(payload.csrfToken);
  return payload as T;
}

export const sessionApi = {
  current: () => request<{
    authenticated: boolean;
    cdeConnected: boolean;
    csrfToken: string;
    activeContext: import('../types').ActiveContext | null;
    applicationId: string | null;
    projects: string[];
  }>('/api/session'),
  selectContext: (projectKey: string, projects?: string[]) =>
    request<{ activeContext: import('../types').ActiveContext; csrfToken: string }>('/api/session/context', {
      method: 'POST',
      body: JSON.stringify({ projectKey, applicationId: projectKey, projects }),
    }),
  logout: async () => {
    try {
      await request('/api/session/logout', { method: 'POST', body: '{}' });
    } finally {
      setCsrfToken(null);
    }
  },
};

export const cdeApi = {
  status: () => request<CdeConnectionStatus>('/api/cde/session'),
  startLogin: (userLoginName: string) => request<CdeConnectionStatus>('/api/cde/session/start', {
    method: 'POST', body: JSON.stringify({ userLoginName }),
  }),
  finishPassword: (challenge: string, password: string) => request<CdeConnectionStatus>('/api/cde/session/password', {
    method: 'POST', body: JSON.stringify({ challenge, password }),
  }),
  disconnect: () => request<CdeConnectionStatus>('/api/cde/session', { method: 'DELETE' }),
  listOrigins: () => request<{ data: CdeOriginOption[] }>('/api/cde/origins').then(payload => payload.data || []),
  selectOrigin: (originId: string) => request<{ selected: CdeOriginOption }>('/api/cde/origins/select', {
    method: 'POST', body: JSON.stringify({ originId }),
  }),
  projects: () => request<CdeProjectDescriptor[]>('/api/cde/projects'),
  projectCatalog: (projectKey: string) => request<CdeCatalog>(`/api/cde/projects/${encodeURIComponent(projectKey)}/catalog`),
  projectPackage: (projectKey: string, data: {
    repositoryType: Exclude<CdeCatalogRepository['type'], 'TESTS'>;
    packId: string;
    branch?: CdeBranchSelector;
  }) => request<CdePackageContent>(`/api/cde/projects/${encodeURIComponent(projectKey)}/package`, {
    method: 'POST', body: JSON.stringify(data),
  }),
};
