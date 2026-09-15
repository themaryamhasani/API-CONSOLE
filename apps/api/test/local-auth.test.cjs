'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before, after } = require('node:test');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-local-auth-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_ADMIN_LOGINS = '09022849799';
process.env.API_CONSOLE_REQUIRED_WORKSPACES = '';
delete process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT;

const { hashPassword, verifyPassword } = require('../src/modules/auth/password-hash.cjs');
const {
  createLocalDirectoryUser,
  patchLocalDirectoryUser,
  resetLocalPassword,
  listLocalDirectoryUsers,
} = require('../src/modules/auth/local-auth.cjs');
const {
  isBootstrapSystemAdmin,
  comparableLogin,
  createSessionRecord,
  markLocalConnected,
  saveSession,
  COOKIE_NAME,
} = require('../src/modules/session/session-server.cjs');
const { createServer } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');

describe('local-auth', () => {
  it('hashes and verifies passwords with scrypt', async () => {
    const encoded = await hashPassword('correct-horse');
    assert.match(encoded, /^scrypt\$/);
    assert.equal(await verifyPassword('correct-horse', encoded), true);
    assert.equal(await verifyPassword('wrong', encoded), false);
  });

  it('normalizes bootstrap admin phone 09022849799', () => {
    assert.equal(comparableLogin('09022849799'), comparableLogin('9022849799'));
    assert.equal(isBootstrapSystemAdmin('09022849799'), true);
    assert.equal(isBootstrapSystemAdmin('9022849799'), true);
  });

  it('creates patches and resets local directory users', async () => {
    const store = { directoryUsers: [], directoryRoleAssignments: [] };
    const helpers = {
      makeId: prefix => `${prefix}-1`,
      audit: () => undefined,
      saveStore: () => undefined,
      USER_ROLES: ['SYSTEM_ADMIN', 'DEVELOPER', 'QA_LEAD', 'QA_SPECIALIST', 'BA', 'SECURITY_REVIEWER', 'TECH_LEAD', 'PRODUCT_OWNER'],
      systemAdministratorCount: () => 1,
      directoryUserView: user => ({
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        source: user.source,
        isActive: user.isActive !== false,
        hasPassword: Boolean(user.passwordHash),
        passwordHash: undefined,
        roles: ['DEVELOPER'],
        isSystemAdmin: false,
        isBootstrapAdmin: false,
      }),
    };
    const created = await createLocalDirectoryUser(store, {
      username: 'contractor1',
      password: 'password123',
      fullName: 'Contractor',
      role: 'DEVELOPER',
    }, { userId: 'admin', role: 'SYSTEM_ADMIN' }, helpers);
    assert.equal(created.username, 'contractor1');
    assert.equal(store.directoryUsers[0].source, 'LOCAL');
    assert.ok(store.directoryUsers[0].passwordHash);

    const disabled = await patchLocalDirectoryUser(store, created.id, { isActive: false }, { userId: 'admin' }, helpers);
    assert.equal(disabled.isActive, false);

    await resetLocalPassword(store, created.id, 'newpassword1', { userId: 'admin' }, helpers);
    assert.equal(await verifyPassword('newpassword1', store.directoryUsers[0].passwordHash), true);

    const listed = listLocalDirectoryUsers(store, helpers);
    assert.equal(listed.length, 1);
  });

  it('local login endpoint authenticates and rejects bad password', async (t) => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(testDataDirectory, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    // Seed local user via create helper against live store by logging in after admin creates through module registration.
    // Use direct store mutation through createLocalDirectoryUser after grabbing store via admin is hard;
    // instead login will fail until we POST create — use bootstrap admin session with forged role via markLocalConnected + ADMIN_LOGINS.
    const admin = createSessionRecord();
    await markLocalConnected(admin, {
      id: 'bootstrap-admin',
      username: '09022849799',
      userLoginName: '09022849799',
      displayName: 'Admin',
    });
    admin.role = 'SYSTEM_ADMIN';
    await saveSession(admin);
    const adminCookie = `${COOKIE_NAME}=${encodeURIComponent(admin.id)}`;

    let response = await fetch(`${base}/api/session`, { headers: { cookie: adminCookie } });
    assert.equal(response.status, 200);
    const sessionPayload = await response.json();
    // Ensure context for SYSTEM_ADMIN bootstrap
    if (!sessionPayload.activeContext) {
      response = await fetch(`${base}/api/session/context`, {
        method: 'POST',
        headers: {
          cookie: adminCookie,
          'content-type': 'application/json',
          'x-csrf-token': sessionPayload.csrfToken,
        },
        body: JSON.stringify({ projectKey: 'PERSONAL', applicationId: 'PERSONAL' }),
      });
      assert.equal(response.status, 200);
    }
    response = await fetch(`${base}/api/session`, { headers: { cookie: adminCookie } });
    const ready = await response.json();
    assert.ok(ready.csrfToken);

    response = await fetch(`${base}/api/api-console/admin/local-users`, {
      method: 'POST',
      headers: {
        cookie: adminCookie,
        'content-type': 'application/json',
        'x-csrf-token': ready.csrfToken,
      },
      body: JSON.stringify({
        username: 'bob',
        password: 'password123',
        fullName: 'Bob Local',
        role: 'DEVELOPER',
      }),
    });
    const createBody = await response.text();
    assert.equal(response.status, 200, createBody);
    const created = JSON.parse(createBody);
    assert.equal(created.username, 'bob');
    assert.equal(created.hasPassword, true);

    response = await fetch(`${base}/api/auth/local/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'bad' }),
    });
    assert.equal(response.status, 401);

    response = await fetch(`${base}/api/auth/local/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'password123' }),
    });
    assert.equal(response.status, 200);
    const login = await response.json();
    assert.equal(login.authApproach, 'LOCAL');
    assert.equal(login.applicationId, 'PERSONAL');
    assert.ok(login.csrfToken);
  });
});
