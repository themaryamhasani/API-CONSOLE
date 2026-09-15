'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  projectKeyFromRepoItem,
  projectKeysFromMyRepoResponse,
} = require('../src/modules/cde/repo-projects.cjs');

describe('repo-projects', () => {
  it('reads plain string project keys', () => {
    assert.equal(projectKeyFromRepoItem('medu-ai'), 'medu-ai');
    assert.equal(projectKeyFromRepoItem(' medu-ai/gateway '), 'medu-ai');
    assert.equal(projectKeyFromRepoItem('medu-ai>App'), 'medu-ai');
  });

  it('reads object repo items from CDE', () => {
    assert.equal(projectKeyFromRepoItem({ id: 'medu-ai', name: 'Medu AI' }), 'medu-ai');
    assert.equal(projectKeyFromRepoItem({ projectKey: 'medu-ai' }), 'medu-ai');
    assert.equal(projectKeyFromRepoItem({ workspace: 'medu-ai' }), 'medu-ai');
  });

  it('normalizes my-repo array responses', () => {
    const keys = projectKeysFromMyRepoResponse({
      Result: ['medu-ai', { id: 'pages-app' }],
    });
    assert.deepEqual(keys, ['medu-ai', 'pages-app']);
  });

  it('normalizes my-repo object map responses', () => {
    const keys = projectKeysFromMyRepoResponse({
      Result: {
        'medu-ai': { id: 'medu-ai' },
        'pages-app': { id: 'pages-app' },
      },
    });
    assert.deepEqual(keys, ['medu-ai', 'pages-app']);
  });

  it('normalizes nested workspace arrays', () => {
    const keys = projectKeysFromMyRepoResponse({
      Result: {
        workspaces: [{ key: 'medu-ai' }, { key: 'mosharekatha-apps' }],
      },
    });
    assert.deepEqual(keys, ['medu-ai', 'mosharekatha-apps']);
  });
});
