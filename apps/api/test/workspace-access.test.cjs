'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateWorkspaceAccess,
  filterProjectsByPolicy,
  assertWorkspaceAccess,
  requiredWorkspaces,
  allowlistMode,
  WorkspaceAccessError,
} = require('../src/modules/access/workspace-access.cjs');

describe('workspace-access', () => {
  it('defaults required workspace to medu-ai outside test', () => {
    assert.deepEqual(requiredWorkspaces({ NODE_ENV: 'development' }), ['medu-ai']);
  });

  it('disables gate in test when env var is unset', () => {
    assert.deepEqual(requiredWorkspaces({ NODE_ENV: 'test' }), []);
  });

  it('allows users who have medu-ai', () => {
    const result = evaluateWorkspaceAccess(['foo', 'medu-ai', 'bar'], {
      API_CONSOLE_REQUIRED_WORKSPACES: 'medu-ai',
    });
    assert.equal(result.allowed, true);
    assert.deepEqual(result.grantedWorkspaces, ['medu-ai']);
  });

  it('matches required workspaces case-insensitively', () => {
    const result = evaluateWorkspaceAccess(['Medu-AI'], {
      API_CONSOLE_REQUIRED_WORKSPACES: 'medu-ai',
    });
    assert.equal(result.allowed, true);
    assert.deepEqual(result.grantedWorkspaces, ['medu-ai']);
  });

  it('denies users without medu-ai', () => {
    const result = evaluateWorkspaceAccess(['other-project'], {
      API_CONSOLE_REQUIRED_WORKSPACES: 'medu-ai',
    });
    assert.equal(result.allowed, false);
    assert.deepEqual(result.grantedWorkspaces, []);
  });

  it('throws WORKSPACE_ACCESS_DENIED with details', () => {
    assert.throws(
      () => assertWorkspaceAccess(['x'], { API_CONSOLE_REQUIRED_WORKSPACES: 'medu-ai' }),
      error => error instanceof WorkspaceAccessError
        && error.category === 'WORKSPACE_ACCESS_DENIED'
        && error.statusCode === 403
        && Array.isArray(error.details.requiredWorkspaces),
    );
  });

  it('defaults allowlist mode to GATE_ONLY', () => {
    assert.equal(allowlistMode({}), 'GATE_ONLY');
  });

  it('RESTRICT mode filters to allowlisted workspaces only', () => {
    const filtered = filterProjectsByPolicy(['medu-ai', 'other'], {
      API_CONSOLE_REQUIRED_WORKSPACES: 'medu-ai',
      API_CONSOLE_WORKSPACE_ALLOWLIST_MODE: 'RESTRICT',
    });
    assert.deepEqual(filtered, ['medu-ai']);
  });

  it('GATE_ONLY mode keeps all projects when membership exists', () => {
    const filtered = filterProjectsByPolicy(['medu-ai', 'other'], {
      API_CONSOLE_REQUIRED_WORKSPACES: 'medu-ai',
      API_CONSOLE_WORKSPACE_ALLOWLIST_MODE: 'GATE_ONLY',
    });
    assert.deepEqual(filtered, ['medu-ai', 'other']);
  });

  it('default mode keeps all projects when membership exists', () => {
    const filtered = filterProjectsByPolicy(['medu-ai', 'other'], {
      API_CONSOLE_REQUIRED_WORKSPACES: 'medu-ai',
    });
    assert.deepEqual(filtered, ['medu-ai', 'other']);
  });

  it('empty required list allows all projects', () => {
    const result = evaluateWorkspaceAccess(['any'], {
      NODE_ENV: 'test',
      API_CONSOLE_REQUIRED_WORKSPACES: '',
    });
    assert.equal(result.allowed, true);
  });

  it('empty env outside test still defaults to medu-ai gate', () => {
    assert.deepEqual(requiredWorkspaces({
      NODE_ENV: 'development',
      API_CONSOLE_REQUIRED_WORKSPACES: '',
    }), ['medu-ai']);
  });

  it('GATE_ONLY does not filter other projects after membership', () => {
    const filtered = filterProjectsByPolicy(['alpha', 'medu-ai', 'beta'], {
      API_CONSOLE_REQUIRED_WORKSPACES: 'medu-ai',
      API_CONSOLE_WORKSPACE_ALLOWLIST_MODE: 'GATE_ONLY',
    });
    assert.deepEqual(filtered, ['alpha', 'medu-ai', 'beta']);
  });
});
