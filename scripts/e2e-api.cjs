'use strict';

/**
 * Starts API Console API for Playwright e2e on a fixed port, seeds a LOCAL user.
 * Env:
 *   E2E_API_PORT=5291
 *   E2E_DATA_DIR=...
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = Number(process.env.E2E_API_PORT || 5291);
const DATA_DIR = process.env.E2E_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-e2e-'));

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.API_CONSOLE_PORT = String(PORT);
process.env.API_CONSOLE_BIND_HOST = '127.0.0.1';
process.env.API_CONSOLE_DATA_DIR = DATA_DIR;
process.env.API_CONSOLE_STORE_BACKEND = 'FILE';
process.env.API_CONSOLE_IS_ENABLED = 'false';
process.env.API_CONSOLE_REQUIRED_WORKSPACES = '';
process.env.API_CONSOLE_ADMIN_LOGINS = '09022849799';
process.env.API_CONSOLE_CSRF_SECRET = process.env.API_CONSOLE_CSRF_SECRET || 'e2e-csrf-secret-at-least-32-characters!!';
process.env.API_CONSOLE_SECRET_KEY = process.env.API_CONSOLE_SECRET_KEY || 'e2e-vault-secret-key-at-least-32-chars!';
process.env.CDE_SESSION_ENCRYPTION_KEY = process.env.CDE_SESSION_ENCRYPTION_KEY || 'e2e-cde-session-key-at-least-32-chars!';
process.env.RUNTIME_SESSION_ENCRYPTION_KEY = process.env.RUNTIME_SESSION_ENCRYPTION_KEY || 'e2e-runtime-session-key-at-least-32!!';
process.env.API_CONSOLE_CORS_ORIGIN = process.env.API_CONSOLE_CORS_ORIGIN || 'http://127.0.0.1:5290';
process.env.API_CONSOLE_PUBLIC_URL = process.env.API_CONSOLE_PUBLIC_URL || 'http://127.0.0.1:5290';
process.env.API_CONSOLE_COOKIE_SECURE = 'false';
delete process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT;
delete process.env.REDIS_URL;

fs.mkdirSync(DATA_DIR, { recursive: true });

const { createServer, initializeStore } = require('../apps/api/src/modules/api-console/infrastructure/http/api-console-server.cjs');
const {
  createSessionRecord,
  markLocalConnected,
  saveSession,
  COOKIE_NAME,
} = require('../apps/api/src/modules/session/session-server.cjs');

async function seedLocalUser(baseUrl) {
  const admin = createSessionRecord();
  await markLocalConnected(admin, {
    id: 'e2e-bootstrap-admin',
    username: '09022849799',
    userLoginName: '09022849799',
    displayName: 'E2E Admin',
  });
  admin.role = 'SYSTEM_ADMIN';
  await saveSession(admin);
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(admin.id)}`;

  let response = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  let session = await response.json();
  if (!session.activeContext) {
    response = await fetch(`${baseUrl}/api/session/context`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-csrf-token': session.csrfToken,
      },
      body: JSON.stringify({ projectKey: 'PERSONAL', applicationId: 'PERSONAL' }),
    });
    if (!response.ok) {
      throw new Error(`context failed: ${response.status} ${await response.text()}`);
    }
    response = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
    session = await response.json();
  }

  response = await fetch(`${baseUrl}/api/api-console/admin/local-users`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-csrf-token': session.csrfToken,
    },
    body: JSON.stringify({
      username: 'e2e.user',
      password: 'e2e-password-123',
      fullName: 'E2E Local User',
      role: 'DEVELOPER',
    }),
  });
  if (response.status === 409) {
    console.log('[e2e-api] local user already exists');
    return;
  }
  if (!response.ok) {
    throw new Error(`seed user failed: ${response.status} ${await response.text()}`);
  }
  console.log('[e2e-api] seeded local user e2e.user');
}

async function main() {
  await initializeStore();
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${PORT}`;
  console.log(`[e2e-api] listening ${baseUrl}`);
  console.log(`[e2e-api] data ${DATA_DIR}`);
  await seedLocalUser(baseUrl);

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
