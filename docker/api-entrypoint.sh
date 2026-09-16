#!/bin/sh
set -eu

echo "[entrypoint] NODE_ENV=${NODE_ENV:-} STORE=${API_CONSOLE_STORE_BACKEND:-FILE} IS=${API_CONSOLE_IS_ENABLED:-false}"

if [ "${API_CONSOLE_STORE_BACKEND:-FILE}" = "POSTGRES" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] DATABASE_URL is required when API_CONSOLE_STORE_BACKEND=POSTGRES" >&2
    exit 1
  fi
  echo "[entrypoint] Waiting for Postgres..."
  node <<'NODE'
const { Client } = require('pg');
const url = process.env.DATABASE_URL;
const deadline = Date.now() + 90_000;
(async () => {
  let last;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      process.exit(0);
    } catch (error) {
      last = error;
      try { await client.end(); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('[entrypoint] Postgres not ready:', last && last.message);
  process.exit(1);
})();
NODE
  echo "[entrypoint] Bootstrap + migrate Postgres..."
  npm run db:bootstrap -w @api-console/api
  npm run db:migrate -w @api-console/api || true
fi

if [ -n "${REDIS_URL:-}" ]; then
  echo "[entrypoint] Redis configured: ${REDIS_URL}"
fi

exec "$@"
