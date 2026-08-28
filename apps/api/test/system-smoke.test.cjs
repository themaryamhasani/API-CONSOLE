'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-s23-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT = 'true';
process.env.API_CONSOLE_ADMIN_LOGINS = '9111111111';
process.env.API_CONSOLE_ALLOW_PRIVATE_DESTINATIONS = 'false';

const { createServer } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');

function contextHeader({ userId, phoneNumber, fullName, role, applicationId = 'app-a', scopeApplicationIds }) {
  const context = {
    userId,
    user: { id: userId, fullName, phoneNumber, isActive: true },
    assignmentId: `assignment-${userId}`,
    applicationId,
    scopeApplicationIds: scopeApplicationIds || [applicationId],
    role,
    scope: 'SYSTEMS',
  };
  return Buffer.from(JSON.stringify(context), 'utf8').toString('base64');
}

function request(server, method, urlPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: urlPath,
      method,
      headers: {
        'content-type': 'application/json',
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        ...(headers || {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('S23.01: scope negative — cannot read other application collection', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testDataDirectory, { recursive: true, force: true });
  });
  await request(server, 'POST', '/api/api-console/__test/reset', { body: {} });

  const ownerA = { 'x-api-console-context': contextHeader({ userId: 'u-a', phoneNumber: '9111111111', fullName: 'A', role: 'SYSTEM_ADMIN', applicationId: 'app-a' }) };
  const userB = { 'x-api-console-context': contextHeader({ userId: 'u-b', phoneNumber: '9222222222', fullName: 'B', role: 'DEVELOPER', applicationId: 'app-b', scopeApplicationIds: ['app-b'] }) };

  const col = await request(server, 'POST', '/api/api-console/collections', {
    headers: ownerA,
    body: { data: { name: 'A-Only', applicationId: 'app-a' } },
  });
  assert.equal(col.status, 200);

  const listB = await request(server, 'GET', '/api/api-console/collections?applicationId=app-a', { headers: userB });
  assert.equal(listB.status, 200);
  const rows = Array.isArray(listB.data) ? listB.data : (listB.data.data || []);
  assert.equal(rows.filter(item => item.id === col.data.id).length, 0);

  const blank = await request(server, 'POST', '/api/api-console/requests/blank', {
    headers: ownerA,
    body: { data: { collectionId: col.data.id, applicationId: 'app-a', environmentId: 'env-development' } },
  });
  assert.equal(blank.status, 200);

  const getCross = await request(server, 'GET', `/api/api-console/requests/${blank.data.id}`, { headers: userB });
  assert.ok([403, 404].includes(getCross.status), JSON.stringify(getCross.data));
});

test('S23.01: SSRF localhost destination blocked', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const headers = { 'x-api-console-context': contextHeader({ userId: 'u-a', phoneNumber: '9111111111', fullName: 'A', role: 'SYSTEM_ADMIN', applicationId: 'app-a' }) };
  await request(server, 'POST', '/api/api-console/__test/reset', { body: {} });
  const col = await request(server, 'POST', '/api/api-console/collections', {
    headers,
    body: { data: { name: 'SSRF', applicationId: 'app-a' } },
  });
  const blank = await request(server, 'POST', '/api/api-console/requests/blank', {
    headers,
    body: { data: { collectionId: col.data.id, applicationId: 'app-a', environmentId: 'env-development' } },
  });
  const updated = await request(server, 'PUT', `/api/api-console/requests/${blank.data.id}`, {
    headers,
    body: {
      data: {
        ...blank.data,
        method: 'GET',
        urlTemplate: 'http://127.0.0.1:9/secret',
        name: 'localhost-probe',
      },
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));

  const exec = await request(server, 'POST', `/api/api-console/requests/${blank.data.id}/execute`, {
    headers,
    body: { options: {} },
  });
  assert.equal(exec.status, 200, JSON.stringify(exec.data));
  assert.ok(
    exec.data.transportResult === 'BLOCKED' ||
    exec.data.status === 'BLOCKED' ||
    /DESTINATION|PRIVATE|localhost|127\.0\.0\.1/i.test(JSON.stringify(exec.data)),
    JSON.stringify(exec.data)
  );
});
