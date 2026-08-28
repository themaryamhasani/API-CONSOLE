'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-vault-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT = 'true';
process.env.API_CONSOLE_ADMIN_LOGINS = '9111111111,9222222222';
process.env.API_CONSOLE_VAULT_PROVIDER = 'local';
delete process.env.API_CONSOLE_DUAL_APPROVAL;

const {
  getProvider,
  createLocalProvider,
  createEnvProvider,
  envKeyForRef,
} = require('../src/modules/api-console/infrastructure/security/vault-provider.cjs');

test('local vault provider encrypts and resolves', () => {
  const provider = createLocalProvider();
  assert.equal(provider.name, 'local');
  const ref = 'secret://api-console/11111111-2222-3333-4444-555555555555';
  provider.store(ref, 'top-secret-value');
  assert.equal(provider.resolve(ref), 'top-secret-value');
  const vaultPath = path.join(testDataDirectory, 'api-console-secrets.json');
  assert.ok(fs.existsSync(vaultPath));
  const raw = fs.readFileSync(vaultPath, 'utf8');
  assert.doesNotMatch(raw, /top-secret-value/);
  assert.equal(provider.delete(ref), true);
  assert.equal(provider.resolve(ref), null);
});

test('env vault provider resolves process.env and API_CONSOLE_SECRET_*', () => {
  const env = {};
  const provider = createEnvProvider({ env });
  assert.equal(provider.name, 'env');
  const ref = 'secret://api-console/abcdef12-3456-7890-abcd-ef1234567890';
  const key = envKeyForRef(ref);
  env[key] = 'from-prefixed-env';
  assert.equal(provider.resolve(ref), 'from-prefixed-env');
  env[ref] = 'from-direct-env';
  assert.equal(provider.resolve(ref), 'from-direct-env');
  provider.store(ref, 'stored-in-env');
  assert.equal(env[key], 'stored-in-env');
  assert.equal(provider.delete(ref), true);
  assert.equal(provider.resolve(ref), null);
});

test('getProvider selects by API_CONSOLE_VAULT_PROVIDER', () => {
  const previous = process.env.API_CONSOLE_VAULT_PROVIDER;
  process.env.API_CONSOLE_VAULT_PROVIDER = 'env';
  assert.equal(getProvider().name, 'env');
  process.env.API_CONSOLE_VAULT_PROVIDER = 'local';
  assert.equal(getProvider().name, 'local');
  process.env.API_CONSOLE_VAULT_PROVIDER = previous || 'local';
});

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

test('org policy and dual approval flow', async (t) => {
  const { createServer } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testDataDirectory, { recursive: true, force: true });
  });

  await request(server, 'POST', '/api/api-console/__test/reset', { body: {} });

  const adminHeaders = {
    'x-api-console-context': contextHeader({
      userId: 'admin-1',
      phoneNumber: '9111111111',
      fullName: 'Admin',
      role: 'SYSTEM_ADMIN',
    }),
  };
  const leadHeaders = {
    'x-api-console-context': contextHeader({
      userId: 'lead-1',
      phoneNumber: '9222222222',
      fullName: 'Tech Lead',
      role: 'TECH_LEAD',
    }),
  };

  const getPolicy = await request(server, 'GET', '/api/api-console/admin/org-policy', { headers: adminHeaders });
  assert.equal(getPolicy.status, 200, JSON.stringify(getPolicy.data));
  assert.equal(getPolicy.data.dualApprovalProductionCommand, false);
  assert.ok(Array.isArray(getPolicy.data.privateDestinationAllowlist));

  const putPolicy = await request(server, 'PUT', '/api/api-console/admin/org-policy', {
    headers: adminHeaders,
    body: {
      data: {
        privateDestinationAllowlist: ['http://10.0.0.5:8080'],
        dualApprovalProductionCommand: true,
        forbidInsecureTlsInProduction: true,
        forbidExactModeInProduction: true,
      },
    },
  });
  assert.equal(putPolicy.status, 200, JSON.stringify(putPolicy.data));
  assert.equal(putPolicy.data.dualApprovalProductionCommand, true);
  assert.deepEqual(putPolicy.data.privateDestinationAllowlist, ['http://10.0.0.5:8080']);

  const collectionRes = await request(server, 'POST', '/api/api-console/collections', {
    headers: leadHeaders,
    body: { data: { name: 'Vault Col', applicationId: 'app-demo' } },
  });
  assert.equal(collectionRes.status, 200, JSON.stringify(collectionRes.data));

  const blankRes = await request(server, 'POST', '/api/api-console/requests/blank', {
    headers: leadHeaders,
    body: { data: { collectionId: collectionRes.data.id, applicationId: 'app-demo', environmentId: 'env-production' } },
  });
  assert.equal(blankRes.status, 200, JSON.stringify(blankRes.data));
  const requestId = blankRes.data.id;

  const putReq = await request(server, 'PUT', `/api/api-console/requests/${requestId}`, {
    headers: leadHeaders,
    body: {
      data: {
        ...blankRes.data,
        name: 'Prod Command',
        method: 'POST',
        urlTemplate: 'https://example.com/core-api/v1/data-provider/store-form-data',
        bodyType: 'json',
        bodyTemplate: JSON.stringify({ serviceId: 'svc', formId: 'path/op', data: {} }),
        classification: { type: 'CORE_COMMAND', serviceId: 'svc', operationPath: 'path/op', coreOperationType: 'COMMAND' },
        tls: { verifyCertificate: true },
        environmentId: 'env-production',
      },
    },
  });
  assert.ok([200, 422].includes(putReq.status), JSON.stringify(putReq.data));

  const dualReq = await request(server, 'POST', `/api/api-console/requests/${requestId}/dual-approvals`, {
    headers: leadHeaders,
    body: { data: { reason: 'need production execute window' } },
  });
  assert.equal(dualReq.status, 200, JSON.stringify(dualReq.data));
  assert.equal(dualReq.data.status, 'PENDING');

  const selfApprove = await request(server, 'POST', `/api/api-console/dual-approvals/${dualReq.data.id}/approve`, {
    headers: leadHeaders,
    body: {},
  });
  assert.equal(selfApprove.status, 422);

  const approve = await request(server, 'POST', `/api/api-console/dual-approvals/${dualReq.data.id}/approve`, {
    headers: adminHeaders,
    body: { ttlMinutes: 30 },
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.data));
  assert.equal(approve.data.status, 'ACTIVE');
  assert.equal(approve.data.approvedBy, 'admin-1');
});
