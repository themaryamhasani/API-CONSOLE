# PostgreSQL persistence (Prisma multi-schema)

API Console can persist the in-memory document store to **PostgreSQL** while keeping **FILE** and **SQLITE** as drop-in backends.

## Schemas

| Schema | Purpose |
| --- | --- |
| `identity` | Users, roles, memberships, JIT grants, login events, access denials |
| `workspace` | Origins, workspaces, access policy, sync state |
| `catalog` | Collections, requests, references, examples, docs, contract baselines |
| `runtime` | Runtime profiles, discovery snapshots, operations |
| `execution` | Environments, runners, executions, queue, test runs, mocks |
| `governance` | Shares, consumers, portal tokens, org policies, branding |
| `observability` | Audit log, usage events, notifications |

Columns are the source of truth (no global `payload_json` blob). Nested documents use `jsonb` plus a narrow `extra` column for forward compatibility.

## Production deploy

For the full cutover (Compose api/web/redis, **external** Postgres via `DATABASE_URL`, nginx, SSO domain, v1 IS-off policy) see **[docs/deploy/PRODUCTION.md](../deploy/PRODUCTION.md)**.

```bash
# 1. Ensure PostgreSQL is reachable (external server or local). Database must exist.
# createdb api_console

# 2. Configure env (.env.production for Compose)
# API_CONSOLE_STORE_BACKEND=POSTGRES
# DATABASE_URL=postgresql://user:pass@postgres-host:5432/api_console?schema=public
#
# Main docker-compose.yml does NOT start Postgres — only Redis + api + web.
# Optional local infra (Postgres+Redis containers): docker-compose.infra.yml / npm run prod:local

# 3. Create schemas/tables (works without Prisma engine binaries)
npm run db:bootstrap -w @api-console/api

# 4. Generate Prisma client (needs network to binaries.prisma.sh once)
npm run db:generate -w @api-console/api
# Or full migrate tooling once engines are available:
# npm run db:migrate:dev -w @api-console/api -- --name init

# 5. Optional: import existing FILE/SQLITE store
npm run migrate:pg -w @api-console/api

# 6. Start API with POSTGRES backend
# Compose: npm run compose:up  (entrypoint migrates automatically)
# Host: set API_CONSOLE_STORE_BACKEND=POSTGRES in .env && npm run backend
```

## SSO deploy note

Cookie-forward CDE SSO requires the console to be hosted on the **same registrable domain** as CDE (e.g. `api-console.edus.ir` ↔ `cde.edus.ir`). On localhost, use the phone/password form.

## Adapter behaviour

- `loadAsync()` hydrates the same in-memory shape used by FILE/SQLITE.
- `save(store)` is **synchronous** for call-site compatibility: it enqueues a transactional flush (hash-diff upsert/delete).
- HTTP returns `503 STORE_NOT_READY` until `initializeStore()` completes (wired in `apps/api/src/main.cjs`).
- Redis sessions are unchanged; Postgres stores `identity.login_events` for SSO probes.

## Backup / restore

- Prefer `pg_dump` / `pg_restore` of the seven schemas.
- Keep the secret vault files (`api-console-secrets.json` + key) separately.
- To roll back to FILE: set `API_CONSOLE_STORE_BACKEND=FILE` and restore `api-console-store.json`.

## Tests

```bash
# Unit helpers always run
npm run test:workspace -w @api-console/api
npm run test:sso -w @api-console/api

# Integration against a real DB (optional)
DATABASE_URL_TEST=postgresql://postgres:1234@localhost:5432/API-CONSOLE_TEST npm run test:postgres -w @api-console/api
```
