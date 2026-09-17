# API Console

Standalone Online API Console. **v1 delivery: CDE + Local Directory.** Integrated Systems (IS) is implemented in code but **deferred** until after go-live under load (`API_CONSOLE_IS_ENABLED=false`).

## Quick start (local)

```bash
cd d:\AllApp\API-CONSOLE
copy .env.example .env
npm install
npm run ports:check
npm run backend          # API — default :5281
npm run dev              # Web — default :5280
```

- Web: [http://localhost:5280](http://localhost:5280)
- API: [http://localhost:5281](http://localhost:5281)
- Swagger: [http://localhost:5281/api/docs](http://localhost:5281/api/docs)
- Portal: [http://localhost:5280/portal](http://localhost:5280/portal)

## Production (v1)

See **[docs/deploy/PRODUCTION.md](docs/deploy/PRODUCTION.md)**.

Compose runs **api + web + redis**. Postgres is **external** — set `DATABASE_URL` in `.env.production` to your Postgres server.

### Dockerfiles

| File | Image (default) |
| --- | --- |
| [`docker/Dockerfile.api`](docker/Dockerfile.api) | `api-console-api:latest` |
| [`docker/Dockerfile.web`](docker/Dockerfile.web) | `api-console-web:latest` |

Build from repo root:

```bash
docker build -f docker/Dockerfile.api -t api-console-api:latest .
docker build -f docker/Dockerfile.web -t api-console-web:latest .
# or: npm run compose:build
```

### Deploy (server)

```bash
cp .env.production.example .env.production
# set DATABASE_URL=postgresql://user:pass@postgres-host:5432/api_console?schema=public
# fill secrets (CSRF, vault, session keys), PUBLIC_URL, CORS, ADMIN_LOGINS
npm run prod:check
npm run compose:build          # build api + web images
npm run compose:up:images      # run redis + api + web from those images
# or one step (build + up): npm run compose:up
```

- App: [http://localhost:8080](http://localhost:8080) (override with `WEB_PUBLISH_PORT`)
- Health: `GET /healthz`, `GET /api/health`
- Optional image tags: `API_IMAGE`, `WEB_IMAGE` in `.env.production`

```bash
npm run compose:logs
npm run compose:down
```

### Local fallback (Windows / blocked Docker builds)

If image builds fail on this machine, use infra Postgres+Redis in Docker and run API+Web on the host:

```bash
npm run prod:env          # once — creates .env.production with secrets
# uncomment POSTGRES_* in .env.production for docker-compose.infra.yml
npm run prod:check
npm run prod:local         # → http://localhost:8080
```

## Auth (v1)

1. Open `/` → `/login`. Tabs: **CDE** | **Local** (IS tab not shipped in v1).
2. **CDE:** On same-site `*.edus.ir`, cookie SSO may detect a session (`POST /api/cde/session/sso`). Otherwise use the CDE popup or cellphone + password. Access is **gated** by `API_CONSOLE_REQUIRED_WORKSPACES` (default: `medu-ai`).
3. **Local (E34):** SYSTEM_ADMIN creates users under **ادمین → کاربران**. Login → `authApproach=LOCAL`, workspace `PERSONAL` (FREE only).
4. Identity and role come from the **server session** — browser context headers are not trusted.

Role allowlists:

- `API_CONSOLE_ADMIN_LOGINS` → bootstrap SYSTEM_ADMIN
- `API_CONSOLE_QA_LEAD_LOGINS` → QA_LEAD
- everyone else → DEVELOPER until an admin assigns a directory role

**SSO note:** Cookie-forward SSO only works when the console is hosted on the same registrable domain as CDE (e.g. `api-console.edus.ir`).

### Approaches


| Approach           | Who                                       | Status                                      |
| ------------------ | ----------------------------------------- | ------------------------------------------- |
| CDE                | تیم‌های کنترل‌پلن CDE                     | **Supported (v1)**                          |
| Local Directory    | کاربران یوزر/پسورد ادمین                  | **Supported (v1)** — E34                    |
| Integrated Systems | پل Gateway/SSO                            | **Deferred post-v1** — flag off by default  |


See [docs/PRD.md](docs/PRD.md), [docs/approaches/](docs/approaches/README.md), [docs/deploy/PRODUCTION.md](docs/deploy/PRODUCTION.md).

## Work modes

- **Free / Postman-like** (`sourceApproach=FREE`, optional `PERSONAL`): arbitrary HTTP with org destination policy.
- **CDE Discovery** (`CDE_DISCOVERY`): scan → Runtime Profile → sync → execute `ds/` / `fr/`.

## Data

`API_CONSOLE_STORE_BACKEND=FILE|SQLITE|POSTGRES` (local default `FILE`; **production Compose uses POSTGRES** via external `DATABASE_URL`).

```bash
npm run db:generate -w @api-console/api
npm run db:bootstrap -w @api-console/api
npm run db:migrate -w @api-console/api
npm run migrate:pg -w @api-console/api   # optional import from FILE/SQLITE
```

See [docs/persistence/POSTGRES.md](docs/persistence/POSTGRES.md).

## CDE origin

`CDE_CORE_BASE_URL` defaults to `https://cde.edus.ir`. Multi-origin: `API_CONSOLE_CDE_ORIGINS` JSON array (see `.env.example`).

DNS fallback: `API_CONSOLE_DNS_SERVERS=8.8.8.8,1.1.1.1`.

## Docs map

| Doc | Role |
| --- | --- |
| [docs/deploy/PRODUCTION.md](docs/deploy/PRODUCTION.md) | **Production cutover / Compose / smoke** |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Epics / stories |
| [docs/ONLINE_API_CONSOLE.md](docs/ONLINE_API_CONSOLE.md) | Technical implementation |
