import { getCsrfToken, PlatformApiError, setCsrfToken } from './cdeApi';

async function isRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new PlatformApiError(
      error.category || 'PLATFORM_API_ERROR',
      error.message || response.statusText,
      response.status,
      error.details,
    );
  }
  if (payload?.csrfToken) setCsrfToken(payload.csrfToken);
  return payload as T;
}

export interface IsAuthConfig {
  enabled: boolean;
  gatewayBaseUrl: string;
  sessionCookieName?: string;
  passwordLoginEnabled?: boolean;
  passwordLoginDisabledMessageFa?: string | null;
  externalProviders?: Array<{ id: string; displayName: string; startPath: string }>;
  gatewayReachable?: boolean;
  message?: string;
}

export interface IsWorkspaceDescriptor {
  workspaceIndex: number;
  rootPath: string;
  slug: string;
  title: string;
  description?: string;
  categories?: Array<{ slug: string; title?: string; description?: string }>;
  productCount?: number;
}

export interface IsSystemDescriptor {
  applicationId: string;
  serviceKey: string;
  label: string;
  basePath: string;
  gatewayBaseUrl: string;
  description?: string;
  team?: string | null;
  teamSlug?: string | null;
  source?: string;
  sortOrder?: number;
  specFolder?: string | null;
  category?: string | null;
  categoryTitle?: string | null;
  workspaceIndex?: number;
  workspaceSlug?: string;
  workspaceTitle?: string;
  actionCount?: number;
}

export interface IsDiscoveryWarning {
  code: string;
  message: string;
  specFolder?: string;
}

export interface IsOperationDescriptor {
  id: string;
  serviceKey: string;
  method: string;
  path: string;
  name: string;
  description?: string;
  enabled?: boolean;
  sourceKind?: string;
  sourceFingerprint?: string;
  folderPath?: string[];
  lastSeenAt?: string | null;
  operationId?: string | null;
  controllerName?: string;
  actionName?: string;
  specFolder?: string;
}

export interface IsSystemsResponse {
  gatewayBaseUrl: string;
  systems: IsSystemDescriptor[];
  products?: IsSystemDescriptor[];
  workspaces?: IsWorkspaceDescriptor[];
  warnings?: IsDiscoveryWarning[];
  discoveredAt?: string;
  source?: string;
}

export interface IsProductsResponse {
  gatewayBaseUrl: string;
  workspaces: IsWorkspaceDescriptor[];
  products: IsSystemDescriptor[];
  warnings?: IsDiscoveryWarning[];
  discoveredAt?: string;
  source?: string;
}

export interface IsApisResponse {
  serviceKey: string;
  applicationId: string;
  gatewayBaseUrl: string;
  basePath: string;
  operations: IsOperationDescriptor[];
  counts: { total: number; specs: number; gateway: number; openapi: number };
  warnings: IsDiscoveryWarning[];
  discoveredAt: string;
  product?: IsSystemDescriptor | null;
  source?: string;
}

export interface IsSyncResult {
  serviceKey: string;
  applicationId: string;
  collectionId: string;
  collectionName: string;
  discovered: { total: number; specs?: number; gateway: number; openapi: number };
  warnings: IsDiscoveryWarning[];
  created: number;
  updated: number;
  skipped: number;
  syncedRequestIds: string[];
  operations: IsOperationDescriptor[];
  product?: IsSystemDescriptor | null;
}

export interface IsLoginResult {
  connected: boolean;
  authApproach: 'IS';
  csrfToken?: string;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    userLoginName?: string;
    roles?: string[];
  };
  activeContext?: import('../types').ActiveContext | null;
  systems?: IsSystemDescriptor[];
  workspaces?: IsWorkspaceDescriptor[];
  applicationId?: string | null;
  projects?: string[];
  environmentId?: string | null;
  environmentName?: string | null;
}

export const isApi = {
  config: () => isRequest<IsAuthConfig>('/api/auth/is/config'),
  login: (cellphone: string, password: string) =>
    isRequest<IsLoginResult>('/api/auth/is/login', {
      method: 'POST',
      body: JSON.stringify({ cellphone, password }),
    }),
  bridge: (gatewayCookie: string) =>
    isRequest<IsLoginResult>('/api/auth/is/session/bridge', {
      method: 'POST',
      body: JSON.stringify({ gatewayCookie }),
    }),
  status: () => isRequest<{
    connected: boolean;
    enabled?: boolean;
    authApproach?: string | null;
    reconnectRequired?: boolean;
    gatewayBaseUrl?: string;
    user?: IsLoginResult['user'];
    csrfToken?: string;
  }>('/api/auth/is/session'),
  disconnect: () =>
    isRequest<{ connected: boolean }>('/api/auth/is/session/logout', {
      method: 'POST',
      body: '{}',
    }),
  systems: () => isRequest<IsSystemsResponse>('/api/api-console/is/systems'),
  workspaces: () => isRequest<{ workspaces: IsWorkspaceDescriptor[]; gatewayBaseUrl: string }>(
    '/api/api-console/is/workspaces',
  ),
  products: (params?: { workspace?: number; category?: string }) => {
    const query = new URLSearchParams();
    if (params?.workspace !== undefined) query.set('workspace', String(params.workspace));
    if (params?.category) query.set('category', params.category);
    const suffix = query.toString() ? `?${query}` : '';
    return isRequest<IsProductsResponse>(`/api/api-console/is/products${suffix}`);
  },
  systemApis: (serviceKey: string, params?: { workspace?: number; specFolder?: string }) => {
    const query = new URLSearchParams();
    if (params?.workspace !== undefined) query.set('workspace', String(params.workspace));
    if (params?.specFolder) query.set('specFolder', params.specFolder);
    const suffix = query.toString() ? `?${query}` : '';
    return isRequest<IsApisResponse>(
      `/api/api-console/is/systems/${encodeURIComponent(serviceKey)}/apis${suffix}`,
    );
  },
  syncSystem: (
    serviceKey: string,
    data?: {
      label?: string;
      collectionId?: string;
      operationIds?: string[];
      specFolder?: string;
      workspaceIndex?: number;
    },
  ) =>
    isRequest<IsSyncResult>(`/api/api-console/is/systems/${encodeURIComponent(serviceKey)}/sync`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
};
