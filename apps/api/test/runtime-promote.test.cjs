const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-promote-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_ADMIN_LOGINS = '9111111111';
process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT = 'true';
process.env.API_CONSOLE_REQUIRE_CSRF = 'true';
process.env.RUNTIME_DEFAULT_ORIGINS = 'https://soha.m.edus.ir';

const { createServer } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');

function contextHeader({ userId, phoneNumber, fullName, role, applicationId = 'community' }) {
  const context = {
    userId,
    user: { id: userId, fullName, phoneNumber, isActive: true },
    assignmentId: `assignment-${userId}`,
    applicationId,
    scopeApplicationIds: [applicationId],
    role,
    scope: 'SYSTEMS',
  };
  return Buffer.from(JSON.stringify(context), 'utf8').toString('base64');
}

test('Runtime profile promote copies non-secrets and requires protected roles', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testDataDirectory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/api-console`;
  const adminHeader = contextHeader({
    userId: 'cde-admin',
    phoneNumber: '9111111111',
    fullName: 'Admin',
    role: 'SYSTEM_ADMIN',
  });
  const techLeadHeader = contextHeader({
    userId: 'cde-tech',
    phoneNumber: '9333333333',
    fullName: 'Tech Lead',
    role: 'TECH_LEAD',
  });
  const developerHeader = contextHeader({
    userId: 'cde-dev',
    phoneNumber: '9222222222',
    fullName: 'Developer',
    role: 'DEVELOPER',
  });

  let response = await fetch(`http://127.0.0.1:${server.address().port}/api/session`);
  assert.equal(response.status, 200);
  const session = await response.json();
  const cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  const csrfHeaders = {
    'content-type': 'application/json',
    'x-csrf-token': session.csrfToken,
    cookie,
  };

  response = await fetch(`${baseUrl}/runtime-profiles?applicationId=community`, {
    headers: { 'x-api-console-context': adminHeader },
  });
  assert.equal(response.status, 200);
  const profiles = await response.json();
  assert.ok(profiles.length >= 1);
  const source = profiles[0];
  assert.equal(source.kind, 'DEVELOPMENT');

  const secret = 'promote-secret-value-not-copied';
  response = await fetch(`${baseUrl}/admin/runtime-profiles/${encodeURIComponent(source.id)}`, {
    method: 'PUT',
    headers: { ...csrfHeaders, 'x-api-console-context': adminHeader },
    body: JSON.stringify({
      data: {
        ...source,
        dataService: {
          baseUrl: 'https://data.m.edus.ir/api',
          authMode: 'BEARER',
          authSecret: secret,
          username: '',
          tokenPath: '/auth/getToken',
        },
      },
      rowVersion: source.rowVersion,
    }),
  });
  assert.equal(response.status, 200);
  const withSecret = await response.json();
  assert.equal(withSecret.dataService.authConfigured, true);
  assert.equal(withSecret.dataService.authSecretRef, undefined);
  assert.equal(withSecret.dataService.executionEnabled, true);

  response = await fetch(`${baseUrl}/admin/runtime-profiles/${encodeURIComponent(withSecret.id)}/promote`, {
    method: 'POST',
    headers: { ...csrfHeaders, 'x-api-console-context': developerHeader },
    body: JSON.stringify({ targetKind: 'TEST' }),
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/admin/runtime-profiles/${encodeURIComponent(withSecret.id)}/promote`, {
    method: 'POST',
    headers: { ...csrfHeaders, 'x-api-console-context': techLeadHeader },
    body: JSON.stringify({ targetKind: 'TEST' }),
  });
  assert.equal(response.status, 200);
  const promoted = await response.json();
  assert.equal(promoted.kind, 'TEST');
  assert.equal(promoted.applicationId, withSecret.applicationId);
  assert.equal(promoted.origin, withSecret.origin);
  assert.equal(promoted.dataService.baseUrl, 'https://data.m.edus.ir/api');
  assert.equal(promoted.dataService.authMode, 'BEARER');
  assert.equal(promoted.dataService.authSecretRef, undefined);
  assert.equal(promoted.dataService.executionEnabled, false);
  assert.doesNotMatch(JSON.stringify(promoted), new RegExp(secret));
  assert.notEqual(promoted.id, withSecret.id);

  response = await fetch(`${baseUrl}/admin/runtime-profiles/${encodeURIComponent(withSecret.id)}/promote`, {
    method: 'POST',
    headers: { ...csrfHeaders, 'x-api-console-context': techLeadHeader },
    body: JSON.stringify({ targetKind: 'TEST' }),
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.id, promoted.id);
  assert.equal(updated.kind, 'TEST');
  assert.equal(updated.dataService.executionEnabled, false);
});
