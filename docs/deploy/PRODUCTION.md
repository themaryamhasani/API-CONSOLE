# Production deploy — API Console v1 (CDE + Local)

**Release scope:** CDE login + Local Directory. **Integrated Systems (IS) is deferred** until the service is under load. Keep `API_CONSOLE_IS_ENABLED=false`.

Related: [POSTGRES.md](../persistence/POSTGRES.md), [BACKUP_RESTORE.md](../persistence/BACKUP_RESTORE.md), [`.env.production.example`](../../.env.production.example).

---

## Architecture (compose)

```text
Browser  →  nginx (web:80)  →  static SPA
                 └─ /api/*  →  api:5281  →  Postgres + Redis
```

| Service | Role |
| --- | --- |
| `web` | nginx — SPA + reverse proxy `/api` |
| `api` | Node `main.cjs` — Postgres store, Redis sessions |
| `postgres` | Prisma multi-schema persistence |
| `redis` | CDE + runtime session encryption store |

Published port default: `WEB_PUBLISH_PORT=8080` → put TLS terminator / edge reverse proxy in front (`https://api-console.edus.ir`).

---

## Checklist before first deploy

1. Host console on **same registrable domain** as CDE (e.g. `api-console.edus.ir` ↔ `cde.edus.ir`) for cookie-forward SSO.
2. Copy env and fill secrets (min 32 chars, no `change-me` / `REPLACE_ME`):

```bash
cp .env.production.example .env.production
# edit secrets, ADMIN_LOGINS, PUBLIC_URL, CORS, POSTGRES_PASSWORD
npm run prod:check
```

3. Confirm IS stays off:

```bash
# must print Production readiness OK and "IS off"
grep API_CONSOLE_IS_ENABLED .env.production
```

4. Edge TLS must set `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-For` when proxying to nginx.

---

## Deploy with Docker (restricted networks / Windows host)

If `npm run compose:up` fails building API/web images (blocked `deb.debian.org` / npm inside Docker), use the **infra + host** path:

```bash
cp .env.production.example .env.production   # or: npm run prod:env
# fill secrets; keep POSTGRES_PUBLISH_PORT=15432 (avoids local Postgres on 5432)
npm run prod:check
npm run prod:local
# → http://localhost:8080
```

This starts **Postgres + Redis in Docker**, and runs **API + SPA proxy on the host**.

Full in-container Compose remains for servers with normal outbound network: `npm run compose:up`.


Health:

```bash
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/api/health
# expect: "release":"v1-cde-local", "isEnabled":false, "storeBackend":"POSTGRES"
curl -fsS http://localhost:8080/api/api-console/health/config
# expect: { "ok": true, "issues": [] }
```

Logs:

```bash
npm run compose:logs
```

Stop:

```bash
npm run compose:down
```

Entrypoint on `api` waits for Postgres, runs `db:bootstrap` + `db:migrate`, then starts `node apps/api/src/main.cjs`.

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

- **Postgres:** `pg_dump` / `pg_restore` (seven schemas) — see [POSTGRES.md](../persistence/POSTGRES.md).
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
