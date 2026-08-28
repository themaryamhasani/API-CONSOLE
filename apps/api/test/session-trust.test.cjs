const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-session-trust-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_ADMIN_LOGINS = '9111111111';
delete process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT;

const { createServer } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');
const {
  COOKIE_NAME,
  createSessionRecord,
  markCdeConnected,
  saveSession,
  setSelectedProject,
} = require('../src/modules/session/session-server.cjs');

function forgedAdminHeader(userId = 'cde-developer') {
  const context = {
    userId,
    user: { id: userId, fullName: 'Forged Admin', phoneNumber: '9222222222', isActive: true },
    assignmentId: `assignment-${userId}`,
    applicationId: 'sample-app',
    scopeApplicationIds: ['sample-app'],
    role: 'SYSTEM_ADMIN',
    scope: 'SYSTEMS',
  };
  return Buffer.from(JSON.stringify(context), 'utf8').toString('base64');
}

async function provisionDeveloperSession() {
  const session = createSessionRecord();
  await markCdeConnected(session, {
    id: 'cde-developer',
    userLoginName: '9222222222',
    firstName: 'Dev',
    lastName: 'User',
    displayName: 'Dev User',
  });
  await setSelectedProject(session, 'sample-app');
  await saveSession(session);
  return session;
}

test('forged SYSTEM_ADMIN header cannot escalate without legacy context or session role', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testDataDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/api-console`;

  let response = await fetch(`${baseUrl}/admin/users`, {
    headers: { 'x-api-console-context': forgedAdminHeader() },
  });
  assert.equal(response.status, 401);

  const session = await provisionDeveloperSession();
  response = await fetch(`${baseUrl}/admin/users`, {
    headers: {
      cookie: `${COOKIE_NAME}=${encodeURIComponent(session.id)}`,
      'x-api-console-context': forgedAdminHeader('cde-developer'),
    },
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/share-reviews`, {
    headers: {
      cookie: `${COOKIE_NAME}=${encodeURIComponent(session.id)}`,
      'x-api-console-context': forgedAdminHeader('cde-developer'),
    },
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/policy`, {
    headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(session.id)}` },
  });
  assert.equal(response.status, 200);
  const policy = await response.json();
  assert.ok(Array.isArray(policy.canReviewShares));
  assert.ok(policy.canReviewShares.includes('QA_LEAD'));
});
