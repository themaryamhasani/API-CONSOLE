#!/usr/bin/env node
'use strict';

/**
 * Migrate API Console FILE/SQLITE store into PostgreSQL (Prisma multi-schema).
 * Usage: npm run migrate:pg -w @api-console/api
 * Requires DATABASE_URL and a generated Prisma client.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* optional */ }
}

const { createPostgresStore } = require('../src/modules/api-console/infrastructure/persistence/postgres-store.cjs');
const { loadStoreFromSqlite, resolveSqlitePath } = require('../src/modules/api-console/infrastructure/persistence/store-adapter.cjs');

function resolveStorePath() {
  const dataDir = process.env.API_CONSOLE_DATA_DIR || path.join(ROOT, 'runtime', 'api-console');
  const abs = path.isAbsolute(dataDir) ? dataDir : path.join(ROOT, dataDir);
  if (process.env.API_CONSOLE_STORE_FILE) {
    return path.isAbsolute(process.env.API_CONSOLE_STORE_FILE)
      ? process.env.API_CONSOLE_STORE_FILE
      : path.join(ROOT, process.env.API_CONSOLE_STORE_FILE);
  }
  return path.join(abs, 'api-console-store.json');
}

function loadSourceStore() {
  const backend = String(process.env.API_CONSOLE_STORE_BACKEND || 'FILE').toUpperCase();
  if (backend === 'SQLITE' || backend === 'DB') {
    const sqliteFile = process.env.API_CONSOLE_SQLITE_FILE
      ? (path.isAbsolute(process.env.API_CONSOLE_SQLITE_FILE)
        ? process.env.API_CONSOLE_SQLITE_FILE
        : path.join(ROOT, process.env.API_CONSOLE_SQLITE_FILE))
      : resolveSqlitePath(process.env, path.join(ROOT, 'runtime', 'api-console'));
    const { tryOpenSqlite, migrateSchema } = require('../src/modules/api-console/infrastructure/persistence/store-adapter.cjs');
    const db = tryOpenSqlite(sqliteFile);
    migrateSchema(db);
    const store = loadStoreFromSqlite(db);
    db.close();
    if (!store) throw new Error(`No store_blob found in ${sqliteFile}`);
    return store;
  }
  const file = resolveStorePath();
  if (!fs.existsSync(file)) throw new Error(`Store file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required (e.g. postgresql://postgres:1234@localhost:5432/API-CONSOLE)');
  }
  const store = loadSourceStore();
  console.log(`[migrate:pg] loaded store version=${store.version} collections=${(store.collections || []).length} requests=${(store.requests || []).length}`);
  const handle = createPostgresStore();
  handle.save(store);
  await handle.drain();
  await handle.close();
  console.log('[migrate:pg] done — data flushed to PostgreSQL');
}

main().catch(error => {
  console.error('[migrate:pg] failed:', error.message || error);
  process.exit(1);
});
