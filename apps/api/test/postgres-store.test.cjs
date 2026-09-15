'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Postgres store tests run only when DATABASE_URL_TEST is set.
 * Example: DATABASE_URL_TEST=postgresql://postgres:1234@localhost:5432/API-CONSOLE_TEST
 */
const enabled = Boolean(process.env.DATABASE_URL_TEST);

describe('postgres-store', { skip: !enabled }, () => {
  it('round-trips a minimal store document', async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
    const { createPostgresStore } = require('../src/modules/api-console/infrastructure/persistence/postgres-store.cjs');
    const handle = createPostgresStore();
    const store = {
      version: 2,
      collections: [{
        id: 'col-pg-test-1',
        name: 'PG Test',
        applicationId: 'medu-ai',
        ownerId: 'user-1',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      requests: [],
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
      directoryUsers: [{
        id: 'user-1',
        fullName: 'Test User',
        phoneNumber: '9121234567',
        source: 'CDE',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      directoryRoleAssignments: [],
      runtimeProfiles: [],
      discoverySnapshots: [],
      environments: [],
      runners: [],
      globalVariables: [],
      auditLog: [],
      testRuns: [],
      mocks: [],
      mockCallLogs: [],
      jitAccessGrants: [],
      contractBaselines: [],
      portalShareTokens: [],
      orgPolicies: { destinationAllowlist: [], updatedAt: new Date().toISOString() },
      dualApprovals: [],
      itsmWebhookQueue: [],
      executionQueue: [],
      zoneWorkerHeartbeat: null,
    };
    handle.save(store);
    await handle.drain();
    const loaded = await handle.loadAsync();
    assert.ok(loaded.collections.some(item => item.id === 'col-pg-test-1'));
    assert.ok(loaded.directoryUsers.some(item => item.id === 'user-1'));
    await handle.close();
  });
});

if (!enabled) {
  describe('postgres-store (skipped placeholder)', () => {
    it('skips when DATABASE_URL_TEST is unset', () => {
      assert.equal(enabled, false);
    });
  });
}
