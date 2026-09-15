#!/usr/bin/env node
'use strict';

/**
 * Apply prisma/migrations/.../migration.sql using node-postgres (no Prisma engines required).
 * Usage: node bin/bootstrap-postgres.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* optional */ }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    throw new Error('Install pg: npm install pg -w @api-console/api');
  }

  const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
  const dirs = fs.readdirSync(migrationsDir).filter(name => {
    const full = path.join(migrationsDir, name);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'migration.sql'));
  }).sort();

  if (!dirs.length) throw new Error('No migrations found');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const dir of dirs) {
      const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`[bootstrap-postgres] applying ${dir}…`);
      await client.query(sql);
      console.log(`[bootstrap-postgres] applied ${dir}`);
    }
  } finally {
    await client.end();
  }
  console.log('[bootstrap-postgres] done');
}

main().catch(error => {
  console.error('[bootstrap-postgres] failed:', error.message || error);
  process.exit(1);
});
