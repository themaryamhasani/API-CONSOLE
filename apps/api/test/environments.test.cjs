const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-env-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_ADMIN_LOGINS = '9111111111';
process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT = 'true';

const { createServer } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');

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

test('Environment CRUD is hidden from developers, allows environment managers, and protects production', async t => {
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
  const developerHeader = contextHeader({
    userId: 'cde-dev',
    phoneNumber: '9222222222',
    fullName: 'Developer',
    role: 'DEVELOPER',
  });
  const techLeadHeader = contextHeader({
    userId: 'cde-tech-lead',
    phoneNumber: '9333333333',
    fullName: 'Tech Lead',
    role: 'TECH_LEAD',
  });

  let response = await fetch(`${baseUrl}/environments`, {
    headers: { 'x-api-console-context': developerHeader },
  });
  assert.equal(response.status, 200);
  const initial = await response.json();
  assert.ok(initial.length >= 4);

  response = await fetch(`${baseUrl}/environments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': developerHeader,
    },
    body: JSON.stringify({
      data: {
        name: 'Local Staging',
        kind: 'CUSTOM',
        baseUrl: 'https://staging.example.com',
        variables: [{ key: 'baseUrl', currentValue: 'https://staging.example.com', sensitive: false }],
      },
    }),
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/environments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': techLeadHeader,
    },
    body: JSON.stringify({
      data: {
        name: 'Local Staging',
        kind: 'CUSTOM',
        baseUrl: 'https://staging.example.com',
        variables: [{ key: 'baseUrl', currentValue: 'https://staging.example.com', sensitive: false }],
      },
    }),
  });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.name, 'Local Staging');

  response = await fetch(`${baseUrl}/environments/${created.id}/clone`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': techLeadHeader,
    },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 200);
  const cloned = await response.json();
  assert.match(cloned.name, /Copy/);

  response = await fetch(`${baseUrl}/environments/env-production`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': developerHeader,
    },
    body: JSON.stringify({ data: { name: 'Hacked Prod', baseUrl: 'https://evil.example.com' } }),
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/environments/env-production`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': adminHeader,
    },
    body: JSON.stringify({
      data: {
        name: 'Production',
        kind: 'PRODUCTION',
        baseUrl: 'https://api.example.com',
        productionProtected: true,
        variables: [{ key: 'baseUrl', currentValue: 'https://api.example.com', sensitive: false }],
      },
    }),
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/environments/${cloned.id}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': developerHeader,
    },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 403);

  response = await fetch(`${baseUrl}/environments/${cloned.id}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      'x-api-console-context': techLeadHeader,
    },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).archived, true);
});
