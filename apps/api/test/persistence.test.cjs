'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveBackend,
  createStoreAdapter,
  createSqliteHandle,
  countStoreEntities,
  loadStoreViaAdapter,
  saveStoreToSqlite,
  loadStoreFromSqlite,
} = require('../src/modules/api-console/infrastructure/persistence/store-adapter.cjs');

const hasNodeSqlite = (() => {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
})();

describe('persistence adapter (E01)', () => {
  it('defaults backend to FILE', () => {
    assert.equal(resolveBackend({}), 'FILE');
    assert.equal(resolveBackend({ API_CONSOLE_STORE_BACKEND: 'file' }), 'FILE');
    assert.equal(resolveBackend({ API_CONSOLE_STORE_BACKEND: 'SQLITE' }), 'SQLITE');
    assert.equal(resolveBackend({ API_CONSOLE_STORE_BACKEND: 'DB' }), 'SQLITE');
  });

  it('FILE adapter delegates to injected load/save', () => {
    let saved = null;
    const sample = { version: 2, collections: [{ id: 'c1' }], requests: [] };
    const adapter = createStoreAdapter({
      backend: 'FILE',
      loadStore: () => sample,
      saveStore: store => { saved = store; },
    });
    assert.equal(adapter.backend, 'FILE');
    assert.deepEqual(adapter.load(), sample);
    adapter.save({ ...sample, collections: [{ id: 'c2' }] });
    assert.equal(saved.collections[0].id, 'c2');
  });

  it('loadStoreViaAdapter FILE path uses existing code shape', () => {
    const sample = { version: 2, collections: [], requests: [] };
    const { adapter, store } = loadStoreViaAdapter({
      backend: 'FILE',
      loadStore: () => sample,
      saveStore: () => {},
    });
    assert.equal(adapter.backend, 'FILE');
    assert.equal(store.version, 2);
  });
});

describe('SQLite persistence', { skip: !hasNodeSqlite }, () => {
  let tmpDir;
  let dbPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-persist-'));
    dbPath = path.join(tmpDir, 'api-console.sqlite');
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('migrates blob + entity tables idempotently', () => {
    const store = {
      version: 2,
      collections: [{ id: 'col-1', applicationId: 'app-a', name: 'Demo', originId: 'origin-1' }],
      requests: [{
        id: 'req-1',
        collectionId: 'col-1',
        applicationId: 'app-a',
        name: 'Ping',
        method: 'GET',
        headers: [{ name: 'accept', valueTemplate: 'application/json' }],
        cookies: [],
        assertions: [{ assertionType: 'EXPECTED_HTTP_STATUS' }],
      }],
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
      directoryUsers: [{ id: 'u1', fullName: 'User One', isActive: true }],
      directoryRoleAssignments: [],
      runtimeProfiles: [],
      discoverySnapshots: [],
      environments: [{ id: 'env-1', name: 'Dev', kind: 'DEVELOPMENT', variables: [] }],
      runners: [{ id: 'runner-1', name: 'Public', networkZone: 'PUBLIC', enabled: true }],
      globalVariables: [],
      auditLog: [{ id: 'audit-1', eventType: 'TEST', actorUserId: 'u1', details: { ok: true } }],
      testRuns: [],
      mocks: [],
      jitAccessGrants: [],
      branding: { activeTemplateId: 'default', templates: [{ id: 'default', name: 'Default' }] },
    };

    const handle = createSqliteHandle({ sqliteFile: dbPath });
    try {
      saveStoreToSqlite(handle.db, store);
      saveStoreToSqlite(handle.db, store); // idempotent second pass

      const loaded = loadStoreFromSqlite(handle.db);
      assert.equal(loaded.collections[0].id, 'col-1');
      assert.equal(loaded.requests[0].method, 'GET');
      assert.equal(loaded.branding.activeTemplateId, 'default');

      const collectionCount = handle.db.prepare('SELECT COUNT(*) AS c FROM collections').get().c;
      const requestCount = handle.db.prepare('SELECT COUNT(*) AS c FROM requests').get().c;
      const brandingCount = handle.db.prepare('SELECT COUNT(*) AS c FROM branding_meta').get().c;
      assert.equal(collectionCount, 1);
      assert.equal(requestCount, 1);
      assert.equal(brandingCount, 1);

      const origin = handle.db.prepare('SELECT origin_id FROM collections WHERE id = ?').get('col-1');
      assert.equal(origin.origin_id, 'origin-1');

      const counts = countStoreEntities(loaded);
      assert.equal(counts.collections, 1);
      assert.equal(counts.requests, 1);
      assert.equal(counts.branding, 1);
    } finally {
      handle.close();
    }
  });

  it('SQLITE adapter round-trips via loadStoreViaAdapter', () => {
    const sqliteFile = path.join(tmpDir, 'roundtrip.sqlite');
    const seed = {
      version: 2,
      collections: [{ id: 'c-rt', name: 'RT' }],
      requests: [],
      executions: [],
      environments: [],
      runners: [],
      auditLog: [],
    };
    const { adapter, store } = loadStoreViaAdapter({
      backend: 'SQLITE',
      sqliteFile,
      defaultStore: () => seed,
      normalizeStore: raw => raw,
    });
    assert.equal(adapter.backend, 'SQLITE');
    assert.equal(store.collections[0].id, 'c-rt');
    store.collections.push({ id: 'c-rt-2', name: 'Two' });
    adapter.save(store);
    const again = adapter.load();
    assert.equal(again.collections.length, 2);
    adapter.close();
  });
});
