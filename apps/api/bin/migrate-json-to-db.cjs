#!/usr/bin/env node
'use strict';

/**
 * Migrate api-console-store.json → SQLite (blob + entity tables).
 *
 * Usage:
 *   node apps/api/bin/migrate-json-to-db.cjs [--dry-run] [--json <path>] [--sqlite <path>]
 *
 * Env:
 *   API_CONSOLE_STORE_FILE      (default runtime/api-console/api-console-store.json)
 *   API_CONSOLE_SQLITE_FILE     (default runtime/api-console/api-console.sqlite)
 *   API_CONSOLE_DATA_DIR        (default runtime/api-console)
 */

const fs = require('fs');
const path = require('path');
const {
  resolveSqlitePath,
  createSqliteHandle,
  countStoreEntities,
  saveStoreToSqlite,
} = require('../src/modules/api-console/infrastructure/persistence/store-adapter.cjs');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function resolvePath(value, fallbackRelative) {
  if (!value) return path.join(REPO_ROOT, fallbackRelative);
  return path.isAbsolute(value) ? value : path.join(REPO_ROOT, value);
}

function parseArgs(argv) {
  const out = { dryRun: false, json: null, sqlite: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = argv[++i];
    else if (arg === '--sqlite') out.sqlite = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node apps/api/bin/migrate-json-to-db.cjs [--dry-run] [--json <path>] [--sqlite <path>]`);
    process.exit(0);
  }

  const dataDir = resolvePath(process.env.API_CONSOLE_DATA_DIR, 'runtime/api-console');
  const jsonPath = resolvePath(
    args.json || process.env.API_CONSOLE_STORE_FILE,
    path.join(path.relative(REPO_ROOT, dataDir) || 'runtime/api-console', 'api-console-store.json'),
  );
  const sqlitePath = args.sqlite
    ? resolvePath(args.sqlite, args.sqlite)
    : resolveSqlitePath(process.env, dataDir);

  if (!fs.existsSync(jsonPath)) {
    console.error(`JSON store not found: ${jsonPath}`);
    process.exit(1);
  }

  const store = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const counts = countStoreEntities(store);
  const report = {
    source: jsonPath,
    target: sqlitePath,
    dryRun: args.dryRun,
    counts,
  };

  if (args.dryRun) {
    console.log(JSON.stringify({ ok: true, ...report, message: 'Dry-run only; no SQLite writes.' }, null, 2));
    process.exit(0);
  }

  const handle = createSqliteHandle({ sqliteFile: sqlitePath, dataDir });
  try {
    // Idempotent: replace blob + rebuild entity projection.
    saveStoreToSqlite(handle.db, store);
    const reloaded = handle.load();
    const after = countStoreEntities(reloaded || {});
    console.log(JSON.stringify({
      ok: true,
      ...report,
      after,
      message: 'Migrated JSON store into SQLite (store_blob + entity tables). Re-run is safe (upsert/replace).',
    }, null, 2));
  } finally {
    handle.close();
  }
}

main();
