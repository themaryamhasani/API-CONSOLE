/**
 * Maps workspace nav ids ↔ URL paths for E22 internal routes.
 */
import type { WorkspaceNavId } from '../components/layout/AppShell';

export const WORKSPACE_PATHS: Record<WorkspaceNavId, string> = {
  requests: '/requests',
  repository: '/repository',
  runtime: '/runtime',
  environments: '/environments',
  activity: '/activity',
  mocks: '/mocks',
  jit: '/jit',
  reports: '/reports',
  reviews: '/reviews',
  users: '/users',
  runners: '/runners',
  branding: '/branding',
  'org-policy': '/org-policy',
  compliance: '/compliance',
  audit: '/audit',
};

const PATH_TO_VIEW = Object.fromEntries(
  Object.entries(WORKSPACE_PATHS).map(([id, path]) => [path, id as WorkspaceNavId]),
) as Record<string, WorkspaceNavId>;

export function pathForWorkspaceView(view: WorkspaceNavId): string {
  return WORKSPACE_PATHS[view] || '/requests';
}

export function workspaceViewFromPath(pathname: string): WorkspaceNavId | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/' || normalized === '/api-console') return 'requests';
  return PATH_TO_VIEW[normalized] || null;
}

export const WORKSPACE_ROUTE_PATHS = Object.values(WORKSPACE_PATHS);
