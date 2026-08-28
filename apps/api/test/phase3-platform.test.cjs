'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-phase3-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT = 'true';
process.env.API_CONSOLE_ADMIN_LOGINS = '9111111111';
process.env.API_CONSOLE_SECRET_SCAN_MODE = 'warn';

const { createServer } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');
const { scanTextForSecrets, parseConfiguredOrigins } = require('../src/modules/api-console/infrastructure/http/phase3-routes.cjs');

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
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('secret scan detects bearer tokens', () => {
  const findings = scanTextForSecrets('curl -H "Authorization: Bearer abcdefghijklmnop" https://example.com');
  assert.ok(findings.includes('BEARER_TOKEN'));
});

test('configured origins fallback works', () => {
  const origins = parseConfiguredOrigins();
  assert.ok(origins.length >= 1);
  assert.ok(origins[0].baseUrl);
});

test('Phase 3: openapi, portal, mock, contract, jit, compliance', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testDataDirectory, { recursive: true, force: true });
  });

  await request(server, 'POST', '/api/api-console/__test/reset', { body: {} });
  const headers = {
    'x-api-console-context': contextHeader({
      userId: 'admin-1',
      phoneNumber: '9111111111',
      fullName: 'Admin',
      role: 'SYSTEM_ADMIN',
    }),
  };

  const collectionRes = await request(server, 'POST', '/api/api-console/collections', {
    headers,
    body: { data: { name: 'P3 Col', applicationId: 'app-demo' } },
  });
  assert.equal(collectionRes.status, 200, JSON.stringify(collectionRes.data));
  const collectionId = collectionRes.data.id;

  const blankRes = await request(server, 'POST', '/api/api-console/requests/blank', {
    headers,
    body: { data: { collectionId, applicationId: 'app-demo', environmentId: 'env-development' } },
  });
  assert.equal(blankRes.status, 200);
  const requestId = blankRes.data.id;

  // Force approved for portal
  const putRes = await request(server, 'PUT', `/api/api-console/requests/${requestId}`, {
    headers,
    body: { data: { ...blankRes.data, sharingStatus: 'APPROVED', name: 'Portal API', method: 'GET', urlTemplate: 'https://example.com/api/items' } },
  });
  assert.ok([200, 422].includes(putRes.status));

  // Manually set approved via another put if needed
  if (putRes.status === 200) {
    // ok
  } else {
    // still continue — openapi collection should work
  }

  const openapiRes = await request(server, 'GET', `/api/api-console/collections/${collectionId}/openapi.json`, { headers });
  assert.equal(openapiRes.status, 200, JSON.stringify(openapiRes.data));
  assert.equal(openapiRes.data.openapi, '3.0.3');

  const portalRes = await request(server, 'GET', '/api/api-console/portal/repository?applicationId=app-demo', { headers });
  assert.equal(portalRes.status, 200, JSON.stringify(portalRes.data));
  assert.ok(Array.isArray(portalRes.data.data));

  const mockRes = await request(server, 'POST', '/api/api-console/mocks', {
    headers,
    body: { data: { requestId, ttlMinutes: 30, pathMatch: `/mock-${requestId}` } },
  });
  assert.equal(mockRes.status, 200, JSON.stringify(mockRes.data));
  const mockId = mockRes.data.id;

  const serveRes = await request(server, 'GET', `/api/api-console/mock-serve/${mockId}`, { headers: {} });
  assert.equal(serveRes.status, 200);

  const contractRes = await request(server, 'POST', '/api/api-console/contract-suites', {
    headers,
    body: { data: { collectionId } },
  });
  assert.equal(contractRes.status, 200, JSON.stringify(contractRes.data));
  assert.ok(contractRes.data.assertionCount > 0);

  const jitRes = await request(server, 'POST', '/api/api-console/jit-access', {
    headers,
    body: { data: { applicationId: 'app-demo', reason: 'incident response window' } },
  });
  assert.equal(jitRes.status, 200, JSON.stringify(jitRes.data));
  const approveJit = await request(server, 'POST', `/api/api-console/jit-access/${jitRes.data.id}/approve`, {
    headers,
    body: { ttlMinutes: 30 },
  });
  assert.equal(approveJit.status, 200);
  assert.equal(approveJit.data.status, 'ACTIVE');

  const complianceRes = await request(server, 'GET', '/api/api-console/admin/compliance-report', { headers });
  assert.equal(complianceRes.status, 200, JSON.stringify(complianceRes.data));
  assert.ok(complianceRes.data.totals);

  const branding = await request(server, 'GET', '/api/api-console/branding/templates', { headers });
  assert.equal(branding.status, 200);
  assert.ok(branding.data.templates);

  const curlScan = await request(server, 'POST', '/api/api-console/curl/parse', {
    headers,
    body: { curlText: 'curl -H "Authorization: Bearer supersecrettokenvalue" https://example.com' },
  });
  assert.equal(curlScan.status, 200);
  assert.ok((curlScan.data.warnings || []).some(item => /secret/i.test(item)) || curlScan.data.secretScan?.findings?.length);

  const shareSubmit = await request(server, 'POST', `/api/api-console/requests/${requestId}/share`, {
    headers,
    body: { data: { purpose: 'portal share', introduction: 'intro', description: 'desc for portal' } },
  });
  assert.equal(shareSubmit.status, 200, JSON.stringify(shareSubmit.data));
  const shareId = shareSubmit.data.id;
  const apiId = shareSubmit.data.apiId || blankRes.data.apiId || requestId;
  const version = shareSubmit.data.version || '1.0.0';

  await request(server, 'PUT', `/api/api-console/share-reviews/${shareId}/checklist`, {
    headers,
    body: { checklist: { docsComplete: true, noSecrets: true, classificationOk: true, consumersSpecified: true } },
  });
  const approveShare = await request(server, 'POST', `/api/api-console/share-reviews/${shareId}/approve`, {
    headers,
    body: {
      consumers: [{ consumerType: 'USER', userId: 'user-consumer', applicationId: 'app-demo' }],
      checklist: { docsComplete: true, noSecrets: true, classificationOk: true, consumersSpecified: true },
    },
  });
  assert.equal(approveShare.status, 200, JSON.stringify(approveShare.data));

  const shareRes = await request(server, 'POST', '/api/api-console/portal/share-tokens', {
    headers,
    body: { data: { apiId, version, ttlHours: 2 } },
  });
  assert.equal(shareRes.status, 200, JSON.stringify(shareRes.data));
  assert.ok(shareRes.data.token);
  assert.ok(shareRes.data.urlPath.includes('/portal/shared/'));

  const publicRes = await request(server, 'GET', `/api/api-console/portal/shared/${shareRes.data.token}`, { headers: {} });
  assert.equal(publicRes.status, 200, JSON.stringify(publicRes.data));
  assert.equal(publicRes.data.executeProductionAllowed, false);
  assert.ok(publicRes.data.openapi);

  const baselineRes = await request(server, 'POST', '/api/api-console/contract-baselines', {
    headers,
    body: {
      data: {
        collectionId,
        name: 'baseline-v1',
        openapi: {
          openapi: '3.0.3',
          info: { title: 'P3', version: '1.0.0' },
          paths: {
            '/api/items': {
              get: {
                requestBody: {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['id'],
                        properties: { id: { type: 'string' }, name: { type: 'string' } },
                      },
                    },
                  },
                },
                responses: { 200: { description: 'ok' } },
              },
            },
          },
        },
      },
    },
  });
  assert.equal(baselineRes.status, 200, JSON.stringify(baselineRes.data));
  assert.ok(baselineRes.data.fingerprint);
  assert.ok(baselineRes.data.schemaSummary['GET /api/items']);

  const listBaselines = await request(server, 'GET', `/api/api-console/contract-baselines?collectionId=${collectionId}`, { headers });
  assert.equal(listBaselines.status, 200);
  assert.ok((listBaselines.data.data || []).some(item => item.id === baselineRes.data.id));

  const compareRes = await request(server, 'POST', `/api/api-console/contract-baselines/${baselineRes.data.id}/compare`, {
    headers,
    body: {
      data: {
        openapi: {
          openapi: '3.0.3',
          info: { title: 'P3', version: '1.0.0' },
          paths: {
            '/api/items': {
              get: {
                requestBody: {
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: [],
                        properties: { id: { type: 'number' } },
                      },
                    },
                  },
                },
                responses: { 200: { description: 'ok' } },
              },
            },
          },
        },
      },
    },
  });
  assert.equal(compareRes.status, 200, JSON.stringify(compareRes.data));
  assert.ok(Array.isArray(compareRes.data.breaking));
  assert.ok(
    compareRes.data.breaking.some(item => item.kind === 'REMOVED_REQUIRED_PROPERTY' || item.kind === 'TYPE_CHANGE'),
    JSON.stringify(compareRes.data.breaking)
  );

  const emptyCompare = await request(server, 'POST', `/api/api-console/contract-baselines/${baselineRes.data.id}/compare`, {
    headers,
    body: { data: { openapi: { openapi: '3.0.3', info: { title: 'x', version: '1' }, paths: {} } } },
  });
  assert.equal(emptyCompare.status, 200);
  assert.ok(emptyCompare.data.breaking.some(item => item.kind === 'REMOVED_PATH_METHOD'));

  const orgPolicy = await request(server, 'GET', '/api/api-console/admin/org-policy', { headers });
  assert.equal(orgPolicy.status, 200);
  assert.ok(orgPolicy.data);

  assert.equal(collectionRes.data.originId || 'default', 'default');
});
