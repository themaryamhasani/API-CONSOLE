'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-phase2-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT = 'true';
process.env.API_CONSOLE_ADMIN_LOGINS = '9111111111';

const { createServer } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');

function contextHeader({ userId, phoneNumber, fullName, role }) {
  const context = {
    userId,
    user: { id: userId, fullName, phoneNumber, isActive: true },
    assignmentId: `assignment-${userId}`,
    applicationId: 'app-demo',
    scopeApplicationIds: ['app-demo'],
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

test('Phase 2: shared visibility, ownership, activity, collection run, checklist, version', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testDataDirectory, { recursive: true, force: true });
  });

  await request(server, 'POST', '/api/api-console/__test/reset', { body: {} });

  const admin = contextHeader({
    userId: 'user-owner',
    phoneNumber: '9111111111',
    fullName: 'Owner',
    role: 'SYSTEM_ADMIN',
  });
  const peer = contextHeader({
    userId: 'user-peer',
    phoneNumber: '9222222222',
    fullName: 'Peer',
    role: 'DEVELOPER',
  });
  const headers = { 'x-api-console-context': admin };
  const peerHeaders = { 'x-api-console-context': peer };

  const collectionRes = await request(server, 'POST', '/api/api-console/collections', {
    headers,
    body: { data: { name: 'Team Col', applicationId: 'app-demo', visibility: 'PROJECT_SHARED' } },
  });
  assert.equal(collectionRes.status, 200, JSON.stringify(collectionRes.data));
  assert.equal(collectionRes.data.visibility, 'PROJECT_SHARED');
  const collectionId = collectionRes.data.id;

  const blankRes = await request(server, 'POST', '/api/api-console/requests/blank', {
    headers,
    body: { data: { collectionId, applicationId: 'app-demo', environmentId: 'env-development' } },
  });
  assert.equal(blankRes.status, 200, JSON.stringify(blankRes.data));
  const requestId = blankRes.data.id;

  const visibilityRes = await request(server, 'PUT', `/api/api-console/requests/${requestId}/visibility`, {
    headers,
    body: { visibility: 'PROJECT_SHARED' },
  });
  assert.equal(visibilityRes.status, 200, JSON.stringify(visibilityRes.data));
  assert.equal(visibilityRes.data.visibility, 'PROJECT_SHARED');

  const listRes = await request(server, 'GET', `/api/api-console/requests?applicationId=app-demo&collectionId=${encodeURIComponent(collectionId)}`, { headers: peerHeaders });
  assert.equal(listRes.status, 200, JSON.stringify(listRes.data));
  const rows = listRes.data.data || listRes.data;
  assert.ok(Array.isArray(rows) && rows.some(item => item.id === requestId));

  const coOwnersRes = await request(server, 'PUT', `/api/api-console/requests/${requestId}/co-owners`, {
    headers,
    body: { coOwnerIds: ['user-peer'] },
  });
  assert.equal(coOwnersRes.status, 200, JSON.stringify(coOwnersRes.data));
  assert.deepEqual(coOwnersRes.data.coOwnerIds, ['user-peer']);

  const transferRes = await request(server, 'POST', `/api/api-console/requests/${requestId}/transfer`, {
    headers,
    body: { targetUserId: 'user-peer' },
  });
  assert.equal(transferRes.status, 200, JSON.stringify(transferRes.data));
  assert.equal(transferRes.data.createdBy, 'user-peer');

  const activityRes = await request(server, 'GET', '/api/api-console/activity?applicationId=app-demo', { headers });
  assert.equal(activityRes.status, 200, JSON.stringify(activityRes.data));
  assert.ok(Array.isArray(activityRes.data.data));
  assert.ok(activityRes.data.data.length > 0);

  const runRes = await request(server, 'POST', `/api/api-console/collections/${collectionId}/run`, {
    headers: peerHeaders,
    body: { options: { stopOnFail: true, requestIds: [requestId] } },
  });
  assert.equal(runRes.status, 200, JSON.stringify(runRes.data));
  assert.ok(runRes.data.id);
  assert.ok(runRes.data.summary);

  const shareSubmit = await request(server, 'POST', `/api/api-console/requests/${requestId}/share`, {
    headers: peerHeaders,
    body: { data: { purpose: 'pub', introduction: 'intro', description: 'desc' } },
  });
  assert.equal(shareSubmit.status, 200, JSON.stringify(shareSubmit.data));
  const shareId = shareSubmit.data.id;

  const checklistFail = await request(server, 'POST', `/api/api-console/share-reviews/${shareId}/approve`, {
    headers,
    body: {
      consumers: [{ consumerType: 'USER', userId: 'user-consumer', applicationId: 'app-demo' }],
      checklist: { docsComplete: true, noSecrets: true, classificationOk: false, consumersSpecified: true },
    },
  });
  assert.ok([400, 422].includes(checklistFail.status), JSON.stringify(checklistFail.data));

  const checklistPut = await request(server, 'PUT', `/api/api-console/share-reviews/${shareId}/checklist`, {
    headers,
    body: { checklist: { docsComplete: true, noSecrets: true, classificationOk: true, consumersSpecified: true } },
  });
  assert.equal(checklistPut.status, 200, JSON.stringify(checklistPut.data));

  const commentRes = await request(server, 'POST', `/api/api-console/share-reviews/${shareId}/comments`, {
    headers,
    body: { text: 'Looks good after checklist' },
  });
  assert.equal(commentRes.status, 200, JSON.stringify(commentRes.data));
  assert.ok((commentRes.data.comments || []).length >= 1);

  const versionRes = await request(server, 'POST', `/api/api-console/requests/${requestId}/versions`, {
    headers: peerHeaders,
    body: { data: { version: '1.1.0', changeLog: 'breaking bump', breakingChange: true, migrationNote: 'Update clients' } },
  });
  assert.equal(versionRes.status, 200, JSON.stringify(versionRes.data));
  assert.equal(versionRes.data.breakingChange, true);

  const runnersRes = await request(server, 'GET', '/api/api-console/runners', { headers });
  assert.equal(runnersRes.status, 200);
  assert.ok(Array.isArray(runnersRes.data));
  assert.ok(runnersRes.data.length >= 1);
});
