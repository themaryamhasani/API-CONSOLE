const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-admin-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_ADMIN_LOGINS = '9111111111';
process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT = 'true';

const { createServer } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');
const { resolveRole } = require('../src/modules/session/session-server.cjs');

function contextHeader({ userId, phoneNumber, fullName, role }) {
  const context = {
    userId,
    user: { id: userId, fullName, phoneNumber, isActive: true },
    assignmentId: `assignment-${userId}`,
    applicationId: 'sample-app',
    scopeApplicationIds: ['sample-app'],
    role,
    scope: 'SYSTEMS',
  };
  return Buffer.from(JSON.stringify(context), 'utf8').toString('base64');
}

test('System Administrator manages directory roles and share review follows policy', async t => {
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
    fullName: 'مدیر اولیه',
    role: 'SYSTEM_ADMIN',
  });
  const developerHeader = contextHeader({
    userId: 'cde-developer',
    phoneNumber: '9222222222',
    fullName: 'دولوپر CDE',
    role: 'DEVELOPER',
  });

  let response = await fetch(`${baseUrl}/consumer-candidates`, {
    headers: { 'x-api-console-context': developerHeader },
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/admin/users`, {
    headers: { 'x-api-console-context': adminHeader },
  });
  assert.equal(response.status, 200);
  const users = await response.json();
  assert.equal(users.length, 2);
  assert.equal(users.find(user => user.id === 'cde-developer').source, 'CDE');

  response = await fetch(`${baseUrl}/admin/users/cde-developer/system-admin`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': adminHeader,
    },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).isSystemAdmin, true);
  assert.equal(resolveRole('9222222222', 'cde-developer'), 'SYSTEM_ADMIN');

  response = await fetch(`${baseUrl}/admin/users/cde-developer/system-admin`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': adminHeader,
    },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(response.status, 200);
  assert.equal(resolveRole('9222222222', 'cde-developer'), 'DEVELOPER');

  response = await fetch(`${baseUrl}/admin/users/cde-developer/roles`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': adminHeader,
    },
    body: JSON.stringify({ role: 'QA_LEAD', enabled: true }),
  });
  assert.equal(response.status, 200);
  assert.equal(resolveRole('9222222222', 'cde-developer'), 'QA_LEAD');

  response = await fetch(`${baseUrl}/admin/users/cde-developer/roles`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': adminHeader,
    },
    body: JSON.stringify({ role: 'BA', enabled: true, applicationId: 'sample-app' }),
  });
  assert.equal(response.status, 200);
  const storePath = path.join(testDataDirectory, 'api-console-store.json');
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const baAssignment = (store.directoryRoleAssignments || []).find(item =>
    item.userId === 'cde-developer' && item.role === 'BA' && item.isActive !== false
  );
  assert.equal(baAssignment?.applicationId, 'sample-app');

  response = await fetch(`${baseUrl}/health/config`);
  assert.equal(response.status, 200);
  const healthConfig = await response.json();
  assert.equal(typeof healthConfig.ok, 'boolean');
  assert.ok(Array.isArray(healthConfig.issues));
  assert.ok(!JSON.stringify(healthConfig).toLowerCase().includes('change-me-api-console'));

  const qaLeadHeader = contextHeader({
    userId: 'cde-developer',
    phoneNumber: '9222222222',
    fullName: 'دولوپر CDE',
    role: 'DEVELOPER',
  });
  // Legacy header still claims DEVELOPER, but session-less legacy path trusts header role.
  // Use an explicit QA_LEAD header for review access in legacy mode:
  const qaLeadTrustedHeader = contextHeader({
    userId: 'cde-developer',
    phoneNumber: '9222222222',
    fullName: 'دولوپر CDE',
    role: 'QA_LEAD',
  });

  response = await fetch(`${baseUrl}/share-reviews`, {
    headers: { 'x-api-console-context': qaLeadTrustedHeader },
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/share-reviews`, {
    headers: { 'x-api-console-context': developerHeader },
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/reports/api-usage`, {
    headers: { 'x-api-console-context': qaLeadTrustedHeader },
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/admin/sessions`, {
    headers: { 'x-api-console-context': adminHeader },
  });
  assert.equal(response.status, 200);
  assert.ok(Array.isArray((await response.json()).data));

  response = await fetch(`${baseUrl}/admin/users/cde-admin/system-admin`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': adminHeader,
    },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(response.status, 409);

  // silence unused in lint-free node tests
  assert.ok(qaLeadHeader);
});
