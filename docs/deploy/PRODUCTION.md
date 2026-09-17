# Production deploy — API Console v1 (CDE + Local)

**Release scope:** CDE login + Local Directory. **Integrated Systems (IS) is deferred** until the service is under load. Keep `API_CONSOLE_IS_ENABLED=false`.

Related: [LAUNCH.md](./LAUNCH.md) (split build/run checklist), [POSTGRES.md](../persistence/POSTGRES.md), [BACKUP_RESTORE.md](../persistence/BACKUP_RESTORE.md), [`.env.production.example`](../../.env.production.example), [root README](../../README.md).

---

## Architecture

```text
Build host → docker build (api + web images) → save/load (or registry)
Run host:
Browser  →  nginx (web:80)  →  static SPA
                 └─ /api/*  →  api:5281  →  external Postgres + Redis (compose)
```

| Service | Role |
| --- | --- |
| `web` | nginx — SPA + reverse proxy `/api` — pre-built image (`WEB_IMAGE`) |
| `api` | Node `main.cjs` — Postgres store, Redis sessions — pre-built image (`API_IMAGE`) |
| `redis` | CDE + runtime session encryption store (in **run** compose) |
| Postgres | **External** — not in `docker-compose.yml`; set `DATABASE_URL` |

Published port default: `WEB_PUBLISH_PORT=8080` → put TLS terminator / edge reverse proxy in front (`https://api-console.edus.ir`).

Default image tags: `api-console-api:latest`, `api-console-web:latest` (override with `API_IMAGE` / `WEB_IMAGE`).

---

## Dockerfiles and run compose

| File | Role |
| --- | --- |
| [`docker/Dockerfile.api`](../../docker/Dockerfile.api) | Build API image (`docker build`) |
| [`docker/Dockerfile.web`](../../docker/Dockerfile.web) | Build web (nginx) image (`docker build`) |
| [`docker-compose.yml`](../../docker-compose.yml) | **Run host** — `redis` + `api` + `web`; **no** `build:`; **no** Postgres |

Build from **repo root** with plain **`docker build`** (not `docker compose build`):

```bash
npm run docker:build
# or:
# docker build -f docker/Dockerfile.api -t api-console-api:latest .
# docker build -f docker/Dockerfile.web -t api-console-web:latest .
```

Entrypoint on `api` ([`docker/api-entrypoint.sh`](../../docker/api-entrypoint.sh)) waits for external `DATABASE_URL`, runs `db:bootstrap` + `db:migrate`, then starts `node apps/api/src/main.cjs`.

---

## Checklist before first deploy

1. Host console on **same registrable domain** as CDE (e.g. `api-console.edus.ir` ↔ `cde.edus.ir`) for cookie-forward SSO.
2. Ensure an external Postgres 16+ database is reachable from the **run host** API container network.
3. On the run host, copy env and fill secrets (min 32 chars, no `change-me` / `REPLACE_ME`):

```bash
cp .env.production.example .env.production
# set DATABASE_URL=postgresql://user:pass@postgres-host:5432/api_console?schema=public
# edit secrets, ADMIN_LOGINS, PUBLIC_URL, CORS
npm run prod:check
```

4. Confirm IS stays off:

```bash
# must print Production readiness OK and "IS off"
grep API_CONSOLE_IS_ENABLED .env.production
```

5. Edge TLS must set `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-For` when proxying to nginx.

---

## Deploy with Docker (split build / run)

Prefer the short checklist in **[LAUNCH.md](./LAUNCH.md)**.

**Build host** (repo + Docker; secrets not required to build):

```bash
npm run docker:build           # plain docker build (Dockerfile.api + Dockerfile.web)
npm run images:save            # → api-console-images.tar
# copy tarball (or push registry tags) to the run host
```

**Run host** (images + compose + `.env.production`; no image build):

```bash
cp .env.production.example .env.production
# set DATABASE_URL to external Postgres; fill secrets
npm run images:load            # if using the tarball
npm run prod:check
npm run compose:up              # redis + api + web (no --build)
```

Compose file: [`docker-compose.yml`](../../docker-compose.yml) — services `redis`, `api`, `web` only (image tags via `API_IMAGE` / `WEB_IMAGE`).

Health:

```bash
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/api/health
# expect: "release":"v1-cde-local", "isEnabled":false, "storeBackend":"POSTGRES"
curl -fsS http://localhost:8080/api/api-console/health/config
# expect: { "ok": true, "issues": [] }
```

Logs / stop:

```bash
npm run compose:logs
npm run compose:down
```

---

## Local fallback (restricted networks / Windows host)

If image builds fail (blocked `deb.debian.org` / npm inside Docker), use **infra + host**:

```bash
cp .env.production.example .env.production   # or: npm run prod:env
# uncomment POSTGRES_* / REDIS_PUBLISH_PORT in .env.production for infra compose
npm run prod:check
npm run prod:local
# → http://localhost:8080
```

This starts **Postgres + Redis** via [`docker-compose.infra.yml`](../../docker-compose.infra.yml) and runs **API + SPA proxy on the host**. Main production compose does **not** include Postgres.

---

## Deploy without Docker (host Node)

Requirements: Node 22+, Postgres 16+, Redis 7+, reverse proxy for SPA + `/api`.

```bash
cp .env.production.example .env.production
# set DATABASE_URL / REDIS_URL to host addresses
npm ci
npm run prod:check
npm run db:generate -w @api-console/api
npm run db:bootstrap -w @api-console/api
npm run db:migrate -w @api-console/api
npm run build:web
NODE_ENV=production npm run start:api
# serve apps/web/dist behind nginx with /api → API_CONSOLE_PORT
```

Nginx sketch (host install):

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:5281;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
location / {
  root /var/www/api-console;
  try_files $uri /index.html;
}
```

Use the checked-in template: [`docker/nginx.conf`](../../docker/nginx.conf).

---

## Auth modes in v1

| Approach | Status |
| --- | --- |
| CDE | **Supported** — phone/password + same-site SSO |
| Local Directory | **Supported** — admin creates users; FREE only |
| Integrated Systems | **Deferred** — code present, flag off, routes return `403 IS_DISABLED` |

Bootstrap admins: `API_CONSOLE_ADMIN_LOGINS` (CDE cellphones). After first CDE login, manage Local users under **ادمین → کاربران**.

Workspace gate: `API_CONSOLE_REQUIRED_WORKSPACES` (default `medu-ai`).

---

## Backup / restore

- **Postgres (external):** `pg_dump` / `pg_restore` (seven schemas) — see [POSTGRES.md](../persistence/POSTGRES.md).
- **Vault files:** volume `api_console_data` (`/app/runtime/api-console`) — secrets + key files.
- **Redis:** AOF volume `api_console_redis` (sessions; can rebuild by re-login).
- FILE/SQLITE cold backup notes: [BACKUP_RESTORE.md](../persistence/BACKUP_RESTORE.md).

---

## Smoke test after go-live

1. Open `https://api-console.edus.ir/login` — tabs **CDE** and **Local** only (no IS).
2. CDE SSO on `*.edus.ir` or phone/password; workspace gate allows `medu-ai` members.
3. Create Local user as SYSTEM_ADMIN; login; Send a FREE request.
4. Share → Review → Portal token download works.
5. `GET /api/health` shows `isEnabled: false`.
6. `POST /api/auth/is/login` returns `403 IS_DISABLED`.

---

## Enabling IS later (post-v1)

Only after the stack is stable under load:

1. Set `API_CONSOLE_IS_ENABLED=true` (compose env + `.env.production`).
2. Configure `API_CONSOLE_IS_GATEWAY_URL` and `API_CONSOLE_IS_SPECS_ROOT` (mounted specs if needed).
3. Redeploy API; add IS login tab / UX as needed.
4. See [approaches/03-integrated-systems.md](../approaches/03-integrated-systems.md).

Until then keep the flag **false**.
