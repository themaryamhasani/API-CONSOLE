'use strict';

/**
 * Frontend smoke tests (no Vitest required — works offline).
 * Covers workspace route mapping + extracted module presence.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');

const webRoot = path.resolve(__dirname, '../apps/web');

const WORKSPACE_PATHS = {
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

function workspaceViewFromPath(pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/' || normalized === '/api-console') return 'requests';
  const entry = Object.entries(WORKSPACE_PATHS).find(([, p]) => p === normalized);
  return entry ? entry[0] : null;
}

describe('workspace routing', () => {
  it('maps aliases to requests', () => {
    assert.equal(workspaceViewFromPath('/'), 'requests');
    assert.equal(workspaceViewFromPath('/api-console'), 'requests');
    assert.equal(workspaceViewFromPath('/api-console/'), 'requests');
  });

  it('maps workspace paths', () => {
    assert.equal(workspaceViewFromPath('/runtime'), 'runtime');
    assert.equal(workspaceViewFromPath('/repository'), 'repository');
    assert.equal(workspaceViewFromPath('/reviews'), 'reviews');
    assert.equal(workspaceViewFromPath('/users'), 'users');
    assert.equal(workspaceViewFromPath('/reports'), 'reports');
  });

  it('returns null for unknown paths', () => {
    assert.equal(workspaceViewFromPath('/unknown'), null);
  });
});

describe('extracted frontend modules', () => {
  const required = [
    'src/components/api-console/RepositorySection.tsx',
    'src/components/api-console/ShareReviewSection.tsx',
    'src/components/api-console/UserManagementSection.tsx',
    'src/components/api-console/ResponsePanel.tsx',
    'src/components/api-console/ImportCurlModal.tsx',
    'src/components/api-console/DocumentationModal.tsx',
    'src/components/api-console/RuntimeWorkspace.tsx',
    'src/pages/workspaceRouting.ts',
  ];

  for (const rel of required) {
    it(`exists: ${rel}`, () => {
      assert.ok(fs.existsSync(path.join(webRoot, rel)), rel);
    });
  }
});

describe('App routes register workspace paths', () => {
  it('App.tsx includes WORKSPACE_ROUTE_PATHS', () => {
    const app = fs.readFileSync(path.join(webRoot, 'src/App.tsx'), 'utf8');
    assert.match(app, /WORKSPACE_ROUTE_PATHS/);
    assert.match(app, /\/requests|WORKSPACE_ROUTE_PATHS\.map/);
  });
});
