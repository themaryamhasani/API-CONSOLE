const path = require('path');
const fs = require('fs');

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const {
  loadDotEnv,
  preferredApiPort,
  preferredWebPort,
  writeRuntimePorts,
  DEFAULT_API_PORT,
  DEFAULT_WEB_PORT,
  FOREIGN_DEFAULT_PORTS,
} = require('../../../scripts/dev-ports.cjs');

loadDotEnv();

// Prefer .env.production when present and NODE_ENV=production (non-Docker local prod runs).
if (process.env.NODE_ENV === 'production') {
  const prodEnv = path.resolve(__dirname, '../../../.env.production');
  if (fs.existsSync(prodEnv) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(prodEnv);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

const { createServer, initializeStore, STORE_BACKEND } = require('./modules/api-console/infrastructure/http/api-console-server.cjs');
const { assertProductionSecrets } = require('./modules/api-console/infrastructure/security/production-secrets.cjs');
const { isEnabled: isIsEnabled } = require('./modules/is/is-auth-server.cjs');

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';
assertProductionSecrets();

// v1 delivery hard-gate: never silently enable IS in production.
if (process.env.NODE_ENV === 'production' && isIsEnabled()) {
  console.warn('[release] WARNING: API_CONSOLE_IS_ENABLED=true in production — v1 delivery expects IS off.');
}

function listenOnPort(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function listenProduction() {
  await initializeStore();
  console.log(`[store] backend=${STORE_BACKEND} ready`);
  console.log(`[release] v1-cde-local isEnabled=${isIsEnabled()}`);

  const port = preferredApiPort();
  const host = String(process.env.API_CONSOLE_BIND_HOST || '0.0.0.0').trim() || '0.0.0.0';
  const server = createServer();
  await listenOnPort(server, port, host);
  process.env.API_CONSOLE_PORT = String(port);
  console.log(`API Console listening on http://${host}:${port}`);
  console.log(`Swagger UI: http://${host}:${port}/api/docs`);
  console.log(`Health: http://${host}:${port}/api/health`);
}

async function listenWithFallback() {
  await initializeStore();
  console.log(`[store] backend=${STORE_BACKEND} ready`);
  console.log(`[release] isEnabled=${isIsEnabled()}`);

  const preferred = preferredApiPort();
  const webPreferred = preferredWebPort();
  if (!process.env.API_CONSOLE_CORS_ORIGIN) {
    process.env.API_CONSOLE_CORS_ORIGIN = `http://localhost:${webPreferred}`;
  }

  let lastError;
  for (let offset = 0; offset < 25; offset += 1) {
    const port = preferred + offset;
    if (offset > 0 && FOREIGN_DEFAULT_PORTS.has(port)) continue;
    const server = createServer();
    try {
      await listenOnPort(server, port, '0.0.0.0');
      if (port !== preferred) {
        console.warn(`[ports] Preferred API port ${preferred} is busy — using ${port} instead.`);
      }
      process.env.API_CONSOLE_PORT = String(port);
      writeRuntimePorts({
        api: port,
        apiPreferred: preferred,
        webPreferred,
        corsOrigin: process.env.API_CONSOLE_CORS_ORIGIN,
        defaults: { web: DEFAULT_WEB_PORT, api: DEFAULT_API_PORT },
        updatedAt: new Date().toISOString(),
      });
      console.log(`API Console listening on http://localhost:${port}`);
      console.log(`Swagger UI: http://localhost:${port}/api/docs`);
      console.log(`Web preferred: http://localhost:${webPreferred} (Vite may bump if busy)`);
      return;
    } catch (error) {
      lastError = error;
      try { server.close(); } catch { /* ignore */ }
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw lastError || new Error(`No free API port near ${preferred}`);
}

const start = process.env.NODE_ENV === 'production' ? listenProduction : listenWithFallback;
start().catch(error => {
  console.error(error);
  process.exit(1);
});
