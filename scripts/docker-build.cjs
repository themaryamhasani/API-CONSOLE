'use strict';

/**
 * Build API + web images with plain `docker build` (not docker compose).
 *
 * Usage (repo root):
 *   node scripts/docker-build.cjs
 *   npm run docker:build
 *
 * Env:
 *   API_IMAGE / WEB_IMAGE  — image tags (defaults *:latest)
 *   DOCKER_BUILD_MODE=auto|online|offline
 *     auto (default): web falls back to host dist; API requires npm+Prisma CDN in Docker
 *     online: both images built fully inside Docker
 *     offline: web from host dist only (API skipped with error — needs Linux build host)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const apiImage = process.env.API_IMAGE || 'api-console-api:latest';
const webImage = process.env.WEB_IMAGE || 'api-console-web:latest';
const mode = String(process.env.DOCKER_BUILD_MODE || 'auto').toLowerCase();

function run(cmd, args) {
  console.log(`[docker:build] ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (result.error) {
    console.error(`[docker:build] ${result.error.message}`);
    return { ok: false, status: 1 };
  }
  return { ok: result.status === 0, status: result.status || 0 };
}

function dockerBuild(args) {
  return run('docker', ['build', ...args]);
}

function ensureWebDist() {
  const distIndex = path.join(root, 'apps', 'web', 'dist', 'index.html');
  if (fs.existsSync(distIndex)) {
    console.log('[docker:build] using existing apps/web/dist');
    return true;
  }
  console.log('[docker:build] apps/web/dist missing — running npm run build:web');
  return run('npm', ['run', 'build:web']).ok;
}

function buildWebOnline() {
  return dockerBuild(['-f', 'docker/Dockerfile.web', '--target', 'runtime', '-t', webImage, '.']);
}

function buildWebOffline() {
  if (!ensureWebDist()) return { ok: false, status: 1 };
  return dockerBuild([
    '-f',
    'docker/Dockerfile.web',
    '--target',
    'runtime-prebuilt',
    '-t',
    webImage,
    '.',
  ]);
}

function buildApiOnline() {
  return dockerBuild(['-f', 'docker/Dockerfile.api', '-t', apiImage, '.']);
}

function buildWeb() {
  if (mode === 'offline') return buildWebOffline();
  if (mode === 'online') return buildWebOnline();
  // auto: prefer offline when dist already exists (common on restricted Windows hosts)
  if (fs.existsSync(path.join(root, 'apps', 'web', 'dist', 'index.html'))) {
    const offline = buildWebOffline();
    if (offline.ok) return offline;
  }
  const online = buildWebOnline();
  if (online.ok) return online;
  console.warn('[docker:build] online web build failed — falling back to host dist');
  return buildWebOffline();
}

function buildApi() {
  if (mode === 'offline') {
    console.error(
      [
        '[docker:build] API image needs a build host that can reach registry.npmjs.org + binaries.prisma.sh',
        '  docker build -f docker/Dockerfile.api -t api-console-api:latest .',
      ].join('\n'),
    );
    return { ok: false, status: 1 };
  }
  const result = buildApiOnline();
  if (!result.ok) {
    console.error(
      [
        '[docker:build] API docker build failed.',
        'Docker on this machine cannot reach npm/Prisma CDN (common on locked-down Windows).',
        'Build the API image on a Linux build host with outbound HTTPS, then:',
        '  npm run images:save   # or docker save / registry push',
        '  # transfer to run host → npm run images:load && npm run compose:up',
      ].join('\n'),
    );
  }
  return result;
}

const only = process.argv.includes('--web-only')
  ? 'web'
  : process.argv.includes('--api-only')
    ? 'api'
    : 'all';

if (only === 'web' || only === 'all') {
  const web = buildWeb();
  if (!web.ok) process.exit(web.status || 1);
  if (only === 'web') {
    console.log(`[docker:build] OK → ${webImage}`);
    process.exit(0);
  }
}

if (only === 'api' || only === 'all') {
  const api = buildApi();
  if (!api.ok) {
    if (only === 'all') console.warn(`[docker:build] web OK → ${webImage}`);
    console.warn('[docker:build] api FAILED — see message above');
    process.exit(api.status || 1);
  }
}

console.log(`[docker:build] OK → ${apiImage}, ${webImage}`);
