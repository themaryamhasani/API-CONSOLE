'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.API_CONSOLE_STORE_BACKEND = 'FILE';
process.env.API_CONSOLE_REQUIRED_WORKSPACES = 'medu-ai';
process.env.API_CONSOLE_CDE_SSO_MODE = 'COOKIE_FORWARD';
process.env.API_CONSOLE_CDE_SSO_COOKIE_NAMES = 'ASP.NET_SessionId,cde-auth';
process.env.API_CONSOLE_CSRF_SECRET = 'test-csrf-secret-at-least-32-characters!!';
process.env.CDE_SESSION_ENCRYPTION_KEY = 'test-cde-session-key-at-least-32-chars!!';
process.env.RUNTIME_SESSION_ENCRYPTION_KEY = 'test-runtime-session-key-32chars!!';

const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-sso-'));
process.env.API_CONSOLE_DATA_DIR = testDataDirectory;

const {
  extractCdeBrowserCookies,
  isSameSiteHost,
  ssoConfig,
  allowedCookieNames,
} = require('../src/modules/cde/cde-sso.cjs');
const { createServer, initializeStore } = require('../src/modules/api-console/infrastructure/http/api-console-server.cjs');

function request(server, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = text; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('cde-sso helpers', () => {
  it('only forwards allowlisted cookie names and skips api_console_session', () => {
    const req = {
      headers: {
        cookie: 'api_console_session=secret; ASP.NET_SessionId=abc; evil=1; cde-auth=tok',
      },
    };
    const picked = extractCdeBrowserCookies(req, {
      API_CONSOLE_CDE_SSO_COOKIE_NAMES: 'ASP.NET_SessionId,cde-auth',
      API_CONSOLE_SESSION_COOKIE: 'api_console_session',
    });
    assert.deepEqual(picked, {
      'ASP.NET_SessionId': 'abc',
      'cde-auth': 'tok',
    });
    assert.ok(!picked.api_console_session);
    assert.ok(!picked.evil);
  });

  it('star allowlist forwards all non-console cookies', () => {
    const req = {
      headers: { cookie: 'api_console_session=secret; foo=1; bar=2' },
    };
    const picked = extractCdeBrowserCookies(req, {
      API_CONSOLE_CDE_SSO_COOKIE_NAMES: '*',
      API_CONSOLE_SESSION_COOKIE: 'api_console_session',
    });
    assert.deepEqual(picked, { foo: '1', bar: '2' });
  });

  it('detects same-site under shared registrable domain', () => {
    assert.equal(isSameSiteHost('api-console.edus.ir', 'https://cde.edus.ir'), true);
    assert.equal(isSameSiteHost('localhost', 'https://cde.edus.ir'), false);
  });

  it('exposes default cookie allowlist as star', () => {
    assert.deepEqual(allowedCookieNames({}), ['*']);
  });
});

describe('cde-sso HTTP', () => {
  let server;

  before(async () => {
    await initializeStore();
    server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(testDataDirectory, { recursive: true, force: true });
  });

  it('returns SSO config', async () => {
    const session = await request(server, 'GET', '/api/session');
    assert.equal(session.status, 200);
    const config = await request(server, 'GET', '/api/cde/sso/config', {
      headers: { cookie: session.headers['set-cookie']?.[0]?.split(';')[0] || '' },
    });
    assert.equal(config.status, 200);
    assert.equal(config.body.enabled, true);
    assert.ok(config.body.loginUrl);
    assert.equal(config.body.cookieForwardAvailable, false);
  });

  it('probe on localhost returns SSO_NOT_SAME_SITE', async () => {
    const session = await request(server, 'GET', '/api/session');
    const cookie = String(session.headers['set-cookie'] || '').split(';')[0];
    const csrf = session.body.csrfToken;
    const probe = await request(server, 'POST', '/api/cde/session/sso', {
      headers: { cookie, 'x-csrf-token': csrf, host: 'localhost:5281' },
      body: {},
    });
    assert.equal(probe.status, 200);
    assert.equal(probe.body.connected, false);
    assert.equal(probe.body.reason, 'SSO_NOT_SAME_SITE');
  });

  it('ssoConfig reports sameSiteEligible false on localhost', async () => {
    const cfg = ssoConfig({
      headers: { host: 'localhost:5280' },
      apiConsoleSession: { cdeOriginId: 'default' },
    }, {
      CDE_CORE_BASE_URL: 'https://cde.edus.ir',
      API_CONSOLE_CDE_SSO_MODE: 'COOKIE_FORWARD',
      NODE_ENV: 'test',
    });
    assert.equal(cfg.sameSiteEligible, false);
    assert.equal(cfg.cookieForwardAvailable, false);
  });

  it('ssoConfig treats X-Forwarded-Host api-console.edus.ir as same-site', async () => {
    const cfg = ssoConfig({
      headers: {
        host: '127.0.0.1:5281',
        'x-forwarded-host': 'api-console.edus.ir',
        'x-forwarded-proto': 'https',
      },
      apiConsoleSession: { cdeOriginId: 'default' },
    }, {
      CDE_CORE_BASE_URL: 'https://cde.edus.ir',
      API_CONSOLE_CDE_SSO_MODE: 'COOKIE_FORWARD',
      NODE_ENV: 'test',
    });
    assert.equal(cfg.sameSiteEligible, true);
    assert.equal(cfg.cookieForwardAvailable, true);
  });

  it('ssoConfig falls back to PUBLIC_URL when Host is loopback', async () => {
    const cfg = ssoConfig({
      headers: { host: '127.0.0.1:5281' },
      apiConsoleSession: { cdeOriginId: 'default' },
    }, {
      CDE_CORE_BASE_URL: 'https://cde.edus.ir',
      API_CONSOLE_CDE_SSO_MODE: 'COOKIE_FORWARD',
      API_CONSOLE_PUBLIC_URL: 'https://api-console.edus.ir',
      NODE_ENV: 'test',
    });
    assert.equal(cfg.sameSiteEligible, true);
    assert.equal(cfg.cookieForwardAvailable, true);
  });
});
