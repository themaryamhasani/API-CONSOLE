'use strict';

/**
 * Local production stack when Docker image builds cannot reach npm/apt:
 *   1) Postgres + Redis via docker-compose.infra.yml
 *   2) API on host (NODE_ENV=production)
 *   3) Static web + /api proxy on WEB_PUBLISH_PORT (default 8080)
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env.production');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath}. Run: node scripts/generate-production-env.cjs`);
  }
  const map = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map[key] = value;
    process.env[key] = value;
  }
  return map;
}

function run(cmd, opts = {}) {
  console.log(`[prod:local] $ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env, shell: true, ...opts });
}

async function waitForPostgres(databaseUrl, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      last = error;
      try { await client.end(); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw last || new Error('Postgres not ready');
}

function startProxyStatic(webPort, apiPort, distDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${webPort}`);
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const target = `http://127.0.0.1:${apiPort}${url.pathname}${url.search}`;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      try {
        const headers = { ...req.headers, host: `127.0.0.1:${apiPort}` };
        delete headers['content-length'];
        const upstream = await fetch(target, {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : body,
          redirect: 'manual',
        });
        const outHeaders = {};
        upstream.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'transfer-encoding') return;
          outHeaders[key] = value;
        });
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, outHeaders);
        res.end(buf);
      } catch (error) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message || 'bad gateway' } }));
      }
      return;
    }

    let filePath = path.join(distDir, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || !path.extname(filePath)) {
      const candidate = path.extname(filePath) ? filePath : path.join(filePath, 'index.html');
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) filePath = candidate;
      else filePath = path.join(distDir, 'index.html');
    }
    if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': mime[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  server.listen(webPort, '0.0.0.0', () => {
    console.log(`[prod:local] Web+proxy http://localhost:${webPort} → API :${apiPort}`);
  });
  return server;
}

async function main() {
  loadEnvFile(envFile);
  run('node scripts/prod-ready-check.cjs');

  // Host-side connections for infra compose (local Postgres+Redis containers only).
  // Main docker-compose.yml uses external DATABASE_URL instead.
  const pgPass = process.env.POSTGRES_PASSWORD;
  if (!pgPass || pgPass.includes('REPLACE_ME')) {
    throw new Error(
      'prod:local needs POSTGRES_PASSWORD in .env.production (uncomment the infra section). '
      + 'For server deploy with external Postgres, use: npm run compose:up',
    );
  }
  const pgUser = process.env.POSTGRES_USER || 'apiconsole';
  const pgDb = process.env.POSTGRES_DB || 'api_console';
  const pgPort = process.env.POSTGRES_PUBLISH_PORT || '15432';
  const redisPort = process.env.REDIS_PUBLISH_PORT || '16379';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(pgUser)}:${encodeURIComponent(pgPass)}@127.0.0.1:${pgPort}/${pgDb}?schema=public`;
  process.env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
  process.env.API_CONSOLE_STORE_BACKEND = 'POSTGRES';
  process.env.NODE_ENV = 'production';
  process.env.API_CONSOLE_IS_ENABLED = 'false';
  process.env.API_CONSOLE_PORT = process.env.API_CONSOLE_PORT || '5281';
  process.env.API_CONSOLE_BIND_HOST = '127.0.0.1';
  process.env.API_CONSOLE_DATA_DIR = path.join(root, 'runtime', 'api-console-prod');
  fs.mkdirSync(process.env.API_CONSOLE_DATA_DIR, { recursive: true });

  run('docker compose -f docker-compose.infra.yml --env-file .env.production up -d');
  console.log('[prod:local] Waiting for Postgres...');
  await waitForPostgres(process.env.DATABASE_URL);
  console.log('[prod:local] Postgres ready');

  try {
    run('npm run db:generate -w @api-console/api');
  } catch (error) {
    console.warn('[prod:local] db:generate skipped (engine may be locked by running API):', error.message);
  }
  run('npm run db:bootstrap -w @api-console/api');
  try {
    run('npm run db:migrate -w @api-console/api');
  } catch {
    console.warn('[prod:local] db:migrate skipped/failed — bootstrap may be enough');
  }

  const distDir = path.join(root, 'apps', 'web', 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    run('npm run build:web');
  }

  const api = spawn(process.execPath, ['apps/api/src/main.cjs'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  const webPort = Number(process.env.WEB_PUBLISH_PORT || 8080);
  const apiPort = Number(process.env.API_CONSOLE_PORT || 5281);
  startProxyStatic(webPort, apiPort, distDir);

  const shutdown = () => {
    try { api.kill('SIGTERM'); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  api.on('exit', code => {
    console.error(`[prod:local] API exited with code ${code}`);
    process.exit(code || 1);
  });

  // Smoke after short delay
  setTimeout(async () => {
    try {
      const health = await fetch(`http://127.0.0.1:${webPort}/api/health`);
      const json = await health.json();
      console.log('[prod:local] smoke /api/health', json);
    } catch (error) {
      console.warn('[prod:local] smoke pending:', error.message);
    }
  }, 4000);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
