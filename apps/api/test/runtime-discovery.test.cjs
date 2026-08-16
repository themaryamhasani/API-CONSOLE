const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CryptoJS = require('crypto-js');

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-runtime-'));
process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;
process.env.API_CONSOLE_REQUIRE_CSRF = 'true';

const {
  executeCoreOperation,
  finishRuntimeLogin,
  isPrivateIp,
  secretForClientId,
  startRuntimeLogin,
  validateRuntimeOrigin,
} = require('../src/modules/runtime/runtime-core-client.cjs');
const { discoverProjectSources } = require('../src/modules/cde/api-discovery.cjs');
const {
  buildRuntimeCurlExport,
  buildRuntimePostmanCollection,
  createServer,
  mergeDiscoveredRequest,
  runtimeOpenApiDocument,
  sourceControlledDefinition,
} = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');

test.after(() => fs.rmSync(testDataDirectory, { recursive: true, force: true }));

function jsonResponse(value, options = {}) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', ...(options.headers || {}) });
  for (const cookie of options.cookies || []) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(value), { status: options.status || 200, headers });
}

function encryptedResponse(result, clientId, options = {}) {
  const token = CryptoJS.AES.encrypt(JSON.stringify(result), secretForClientId(clientId)).toString();
  return jsonResponse({ token }, options);
}

function decryptOutbound(body, clientId) {
  const parsed = JSON.parse(body || '{}');
  if (!parsed.reqtoken) return parsed;
  const plaintext = CryptoJS.AES.decrypt(parsed.reqtoken, secretForClientId(clientId)).toString(CryptoJS.enc.Utf8);
  return JSON.parse(plaintext);
}

const profile = {
  id: 'runtime-profile-test',
  origin: 'https://soha.m.edus.ir',
  coreBasePath: '/core-api/v1',
  loginPath: '/devlogin',
  appRefererPath: '/community',
  runtimeServiceId: 'soha.m.edus.ir',
  projectServiceId: 'medu-community.medu.ir',
  userSource: 'medugovir',
  prostage: 'develop',
};
const publicLookup = async () => [{ address: '188.213.65.227', family: 4 }];

test('runtime login honors nextStep, locks host serviceId, rotates cookies, and keeps a stable client-id', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const clientId = init.headers['client-id'];
    const payload = init.body ? decryptOutbound(init.body, clientId) : null;
    calls.push({ url: String(url), init, payload });
    switch (calls.length) {
      case 1:
        return new Response('<html>devlogin</html>', { status: 200, headers: { 'set-cookie': '_cdesc=first; Path=/; Secure' } });
      case 2:
        return jsonResponse({ Result: { IsUserLogin: false, ecreq: false } });
      case 3:
        return jsonResponse({ Result: { nextStep: 'password', IsUserLogin: true, LoginUser: { username: 'msu:test' }, ecreq: true } }, { cookies: ['_cdesc=rotated; Path=/; Secure'] });
      case 4:
        return encryptedResponse({ nextStep: 'loggedin', IsUserLogin: true, LoginUser: { username: 'msu:test' }, ecreq: true }, clientId);
      case 5:
        return encryptedResponse({ IsUserLogin: true, LoginUser: { username: 'msu:test', firstName: 'Test' }, ecreq: true }, clientId);
      case 6:
        return encryptedResponse({ ok: true, ecreq: true }, clientId);
      default:
        throw new Error('Unexpected call');
    }
  };

  const started = await startRuntimeLogin(profile, '9100000000', { fetchImpl, lookup: publicLookup });
  assert.equal(started.status.nextStep, 'password');
  assert.equal(started.status.connected, false, 'nextStep=password must win even when IsUserLogin is true');
  assert.equal(calls[1].payload.serviceId, 'soha.m.edus.ir');
  assert.deepEqual(calls[2].payload, {
    serviceId: 'soha.m.edus.ir',
    formId: 'auth/signin/iran-cellphone',
    data: { userSource: 'medugovir', userLoginName: '9100000000' },
  });

  const finished = await finishRuntimeLogin(started.state, profile, 'runtime-password-never-store', { fetchImpl, lookup: publicLookup });
  assert.equal(finished.status.connected, true);
  assert.equal(JSON.stringify(finished.state).includes('runtime-password-never-store'), false);
  assert.equal(calls[3].payload.data.userSource, 'medugovir');
  assert.match(String(calls[3].init.headers.cookie), /_cdesc=rotated/);
  assert.equal(new Set(calls.map(call => call.init.headers['client-id'])).size, 1);
  assert.equal(calls[3].init.headers.prostage, undefined, 'login forms must not receive prostage');

  const operation = { type: 'CORE_COMMAND', sourceId: 'fr/community/set-role' };
  const executed = await executeCoreOperation(finished.state, profile, operation, { nid: 'masked' }, { fetchImpl, lookup: publicLookup });
  assert.equal(executed.response.Result.ok, true);
  assert.equal(calls[5].payload.serviceId, 'medu-community.medu.ir');
  assert.equal(calls[5].payload.formId, 'community/set-role');
  assert.equal(calls[5].init.headers.prostage, 'develop');
  assert.equal(calls[5].init.headers.referer, 'https://soha.m.edus.ir/community');
});

test('runtime origin validation blocks private DNS answers and credentials', async () => {
  await assert.rejects(
    () => validateRuntimeOrigin('https://soha.m.edus.ir', { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }),
    error => error.category === 'RUNTIME_SSRF_BLOCKED'
  );
  await assert.rejects(
    () => validateRuntimeOrigin('https://user:pass@soha.m.edus.ir', { lookup: publicLookup }),
    error => error.category === 'RUNTIME_ORIGIN_INVALID'
  );
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('188.213.65.227'), false);
  await assert.rejects(
    () => startRuntimeLogin(profile, '9100000000', {
      lookup: publicLookup,
      fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://evil.example/devlogin' } }),
    }),
    error => error.category === 'RUNTIME_CROSS_ORIGIN_REDIRECT'
  );
});

test('static discovery extracts service ID evidence, ds/fr payloads, OpenAPI, and literal routes without executing code', () => {
  delete global.__discoveryExecuted;
  const sources = [
    {
      repositoryType: 'WEB_UI', packId: 'community-ui', branch: { selector: { kind: 'PUBLIC' } }, files: [{ path: 'config.js', code: `
        window.ClientAppConfig.APP_RAYA_SERVICE_ID = 'medu-community.medu.ir';
        global.__discoveryExecuted = true;
        page.ds({ key: 'ds/community/list', params: { page: 1 } });
        page.fr({ formId: 'fr/community/save', data: { title: 'example' } });
      ` }],
    },
    { repositoryType: 'API_MODULE', packId: 'ds/community/list', branch: { selector: { kind: 'PUBLIC' } }, files: [{ path: 'list.js', code: 'throw new Error("must not run")' }] },
    { repositoryType: 'API_MODULE', packId: 'fr/community/save', branch: { selector: { kind: 'PERSONAL', index: 0 } }, files: [{ path: 'save.js', code: '' }] },
    { repositoryType: 'API_MODULE', packId: 'other/ignored', branch: { selector: { kind: 'PUBLIC' } }, files: [{ path: 'ignored.js', code: '' }] },
    {
      repositoryType: 'DATA_SERVICE', packId: 'community-data', branch: { selector: { kind: 'PUBLIC' } }, files: [
        { path: 'swagger.json', code: JSON.stringify({ openapi: '3.0.0', paths: { '/people': { post: { operationId: 'createPerson', requestBody: { content: { 'application/json': { schema: { type: 'object' }, example: { name: 'sample' } } } } } } } }) },
        { path: 'routes.js', code: `router.get('/health', handler); router.post(prefix + '/dynamic', handler);` },
      ],
    },
  ];
  const result = discoverProjectSources('community', sources);
  assert.equal(global.__discoveryExecuted, undefined);
  assert.equal(result.serviceIdStatus, 'RESOLVED');
  assert.equal(result.projectServiceIdCandidates[0].value, 'medu-community.medu.ir');
  assert.equal(result.operations.find(item => item.sourceId === 'ds/community/list').payloadExample.page, 1);
  assert.equal(result.operations.find(item => item.sourceId === 'fr/community/save').payloadExample.title, 'example');
  assert.ok(result.operations.some(item => item.sourceId === 'POST /people'));
  assert.ok(result.operations.some(item => item.sourceId === 'GET /health'));
  assert.ok(result.warnings.some(item => item.code === 'API_MODULE_PREFIX_UNSUPPORTED'));
  assert.ok(result.warnings.some(item => item.code === 'DATA_SERVICE_DYNAMIC_ROUTE'));
  const evidence = result.projectServiceIdCandidates[0].evidence[0];
  assert.equal(evidence.file, 'config.js');
  assert.ok(evidence.line > 0);
});

test('static discovery reports conflicting service IDs and NEEDS_INPUT for unknown payloads', () => {
  const result = discoverProjectSources('conflict-project', [
    { repositoryType: 'WEB_UI', packId: 'a', branch: { selector: { kind: 'PUBLIC' } }, files: [{ path: 'a.js', code: `window.ClientAppConfig.APP_RAYA_SERVICE_ID='one.m.edus.ir'` }] },
    { repositoryType: 'WEB_UI', packId: 'b', branch: { selector: { kind: 'PERSONAL', index: 0 } }, files: [{ path: 'b.js', code: `const cfg={APP_RAYA_SERVICE_ID:'two.m.edus.ir'}` }] },
    { repositoryType: 'API_MODULE', packId: 'ds/unknown', branch: { selector: { kind: 'PUBLIC' } }, files: [{ path: 'unknown.js', code: '' }] },
  ]);
  assert.equal(result.serviceIdStatus, 'CONFLICT');
  assert.equal(result.projectServiceIdCandidates.length, 2);
  assert.equal(result.operations[0].schemaCompleteness, 'NEEDS_INPUT');
  assert.deepEqual(result.operations[0].payloadExample, {});
});

test('runtime OpenAPI, Postman, and cURL outputs contain bindings and placeholders but no stored secrets', () => {
  const operations = [
    { id: 'op-query', projectKey: 'community', sourceKind: 'API_MODULE', sourceId: 'ds/community/list', type: 'CORE_QUERY', name: 'List', payloadExample: { page: 1 }, schemaCompleteness: 'COMPLETE', evidence: [], sourceFingerprint: 'fp-query' },
    { id: 'op-command', projectKey: 'community', sourceKind: 'API_MODULE', sourceId: 'fr/community/save', type: 'CORE_COMMAND', name: 'Save', payloadExample: {}, schemaCompleteness: 'NEEDS_INPUT', evidence: [], sourceFingerprint: 'fp-command' },
  ];
  const snapshot = { operations };
  const postman = buildRuntimePostmanCollection('community', profile, snapshot);
  const postmanText = JSON.stringify(postman);
  assert.match(postmanText, /Runtime Login/);
  assert.match(postmanText, /Core Queries/);
  assert.match(postmanText, /Core Commands/);
  assert.match(postmanText, /\{\{password\}\}/);
  assert.doesNotMatch(postmanText, /_cdesc=/);
  assert.doesNotMatch(postmanText, /runtime-password-never-store/);

  const curl = buildRuntimeCurlExport('community', profile, snapshot, 'op-command', 'bundle');
  assert.match(curl.value, /--cookie-jar/);
  assert.match(curl.value, /post_runtime/);
  assert.match(curl.ecreqHelper, /CryptoJS\.AES/);
  assert.doesNotMatch(curl.value, /_cdesc=/);
  assert.doesNotMatch(curl.value, /runtime-password-never-store/);

  const openapi = runtimeOpenApiDocument('community', profile, snapshot);
  assert.ok(openapi.paths['/api/api-console/runtime/operations/op-query/execute']);
  assert.equal(JSON.stringify(openapi).includes('/core-api/v1/data-provider/get-data-source'), false);
});

test('three-way discovery merge preserves local edits and reports a source conflict', () => {
  const oldOperation = { id: 'op-query', projectKey: 'community', sourceKind: 'API_MODULE', sourceId: 'ds/community/list', type: 'CORE_QUERY', name: 'Old source name', payloadExample: { page: 1 }, sourceFingerprint: 'old' };
  const incomingOperation = { ...oldOperation, name: 'New source name', payloadExample: { page: 2 }, sourceFingerprint: 'new' };
  const base = sourceControlledDefinition(oldOperation, profile);
  const existing = {
    id: 'request-1',
    ...base,
    name: 'My local name',
    runtimeBinding: { runtimeProfileId: profile.id, projectServiceId: profile.projectServiceId, sourceFingerprint: 'old' },
    sourceSync: { status: 'SYNCED', sourceFingerprint: 'old', baseDefinition: base, conflicts: [] },
    documentation: {},
    version: 1,
  };
  const merged = mergeDiscoveredRequest(existing, incomingOperation, profile, { userId: 'developer' });
  assert.equal(merged.name, 'My local name');
  assert.equal(merged.sourceSync.status, 'CONFLICT');
  assert.ok(merged.sourceSync.conflicts.some(conflict => conflict.field === 'name'));
  assert.match(merged.bodyTemplate, /"page": 2/);
});

test('Runtime Profile HTTP API is admin-only and never returns or stores plaintext auth secrets', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/api-console`;
  const context = role => Buffer.from(JSON.stringify({
    userId: role === 'SYSTEM_ADMIN' ? 'admin-runtime' : 'developer-runtime',
    user: { id: role === 'SYSTEM_ADMIN' ? 'admin-runtime' : 'developer-runtime', phoneNumber: '9100000000', fullName: role },
    applicationId: 'community',
    scopeApplicationIds: ['community'],
    role,
    scope: 'SYSTEMS',
  }), 'utf8').toString('base64');
  const secret = 'vault-only-auth-secret-value';
  let response = await fetch(`http://127.0.0.1:${server.address().port}/api/session`);
  assert.equal(response.status, 200);
  const session = await response.json();
  const cookie = String(response.headers.get('set-cookie') || '').split(';')[0];

  response = await fetch(`${baseUrl}/runtime-profiles?applicationId=community`, { headers: { 'x-api-console-context': context('DEVELOPER') } });
  assert.equal(response.status, 200);
  const defaults = await response.json();
  assert.equal(defaults.length, 1);
  assert.deepEqual({
    applicationId: defaults[0].applicationId,
    projectKey: defaults[0].projectKey,
    name: defaults[0].name,
    kind: defaults[0].kind,
    origin: defaults[0].origin,
    coreBasePath: defaults[0].coreBasePath,
    loginPath: defaults[0].loginPath,
    appRefererPath: defaults[0].appRefererPath,
    runtimeServiceId: defaults[0].runtimeServiceId,
    projectServiceId: defaults[0].projectServiceId,
    serviceIdEvidence: defaults[0].serviceIdEvidence,
    userSource: defaults[0].userSource,
    prostage: defaults[0].prostage,
    dataService: defaults[0].dataService,
    enabled: defaults[0].enabled,
  }, {
    applicationId: 'community',
    projectKey: 'community',
    name: 'community Development',
    kind: 'DEVELOPMENT',
    origin: 'https://soha.m.edus.ir',
    coreBasePath: '/core-api/v1',
    loginPath: '/devlogin',
    appRefererPath: '/',
    runtimeServiceId: 'soha.m.edus.ir',
    projectServiceId: undefined,
    serviceIdEvidence: [],
    userSource: 'medugovir',
    prostage: 'develop',
    dataService: {
      baseUrl: '',
      authMode: 'NONE',
      username: '',
      tokenPath: '/auth/getToken',
      executionEnabled: false,
      authConfigured: true,
    },
    enabled: true,
  });

  response = await fetch(`${baseUrl}/admin/runtime-profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-console-context': context('SYSTEM_ADMIN'), cookie },
    body: JSON.stringify({ data: {} }),
  });
  assert.equal(response.status, 403, 'mutating Runtime routes require CSRF');

  response = await fetch(`${baseUrl}/admin/runtime-profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-console-context': context('SYSTEM_ADMIN'), 'x-csrf-token': session.csrfToken, cookie },
    body: JSON.stringify({ data: {
      applicationId: 'community',
      origin: 'https://adib.m.edus.ir',
      projectServiceId: 'medu-community.medu.ir',
      serviceIdEvidence: [{ repositoryType: 'WEB_UI', file: 'config.js', line: 1 }],
      dataService: { baseUrl: 'https://data.m.edus.ir/api', authMode: 'BEARER', authSecret: secret },
    } }),
  });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.runtimeServiceId, 'adib.m.edus.ir');
  assert.equal(created.name, 'community Development');
  assert.equal(created.kind, 'DEVELOPMENT');
  assert.equal(created.coreBasePath, '/core-api/v1');
  assert.equal(created.loginPath, '/devlogin');
  assert.equal(created.appRefererPath, '/');
  assert.equal(created.userSource, 'medugovir');
  assert.equal(created.prostage, 'develop');
  assert.equal(created.dataService.authConfigured, true);
  assert.equal(created.dataService.authSecretRef, undefined);
  assert.doesNotMatch(JSON.stringify(created), new RegExp(secret));

  response = await fetch(`${baseUrl}/runtime-profiles?applicationId=community`, { headers: { 'x-api-console-context': context('DEVELOPER') } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).length, 2);

  response = await fetch(`${baseUrl}/admin/runtime-profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-console-context': context('DEVELOPER') },
    body: JSON.stringify({ data: {} }),
  });
  assert.equal(response.status, 403);

  const storeText = fs.readFileSync(path.join(testDataDirectory, 'api-console-store.json'), 'utf8');
  const vaultText = fs.readFileSync(path.join(testDataDirectory, 'api-console-secrets.json'), 'utf8');
  assert.doesNotMatch(storeText, new RegExp(secret));
  assert.doesNotMatch(vaultText, new RegExp(secret));
});
