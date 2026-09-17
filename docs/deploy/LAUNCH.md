# Launch — split build / run (external Postgres)

Operator checklist for API Console v1. Full production notes: [PRODUCTION.md](./PRODUCTION.md).

**Stack on the run host:** `redis` + `api` + `web` via [`docker-compose.yml`](../../docker-compose.yml).  
**Postgres:** external only — set `DATABASE_URL` (not in compose).  
**Images:** built on a separate build host with plain **`docker build`** ([`docker/Dockerfile.api`](../../docker/Dockerfile.api), [`docker/Dockerfile.web`](../../docker/Dockerfile.web)).

```text
Build host  →  docker build (api + web images)  →  save/load (or registry)
Run host    →  docker compose up  →  redis + api + web  →  external Postgres
```

---

## Build host

Needs: Docker, repo checkout. For a full in-Docker build, the daemon needs outbound HTTPS to `registry.npmjs.org` and `binaries.prisma.sh`.

1. Clone the repo and `cd` to the root.
2. Optional: set `API_IMAGE` / `WEB_IMAGE` if you override tags. Full secrets are **not** required to build.
3. Build both images with **`docker build`** (not compose):

```bash
npm run docker:build
# equivalent:
# docker build -f docker/Dockerfile.api -t api-console-api:latest .
# docker build -f docker/Dockerfile.web -t api-console-web:latest .
```

If Docker cannot reach npm (restricted Windows hosts), the script can still build the **web** image from host `apps/web/dist` (`--target runtime-prebuilt`). The **API** image must be built on a host with registry access.

Single image:

```bash
npm run docker:build:api
npm run docker:build:web
# offline web only:
# npm run build:web
# docker build -f docker/Dockerfile.web --target runtime-prebuilt -t api-console-web:latest .
```

4. Export a tarball:

```bash
npm run images:save
# → api-console-images.tar (api-console-api:latest + api-console-web:latest by default)
```

5. Copy `api-console-images.tar` to the run host (scp, artifact store, etc.).  
   Alternative: push/pull the same tags from a registry instead of save/load.

---

## Run host

Needs: Docker Compose, the compose + env files, loaded images. Full app source is optional once images are loaded.

1. Place at least:
   - [`docker-compose.yml`](../../docker-compose.yml)
   - [`.env.production.example`](../../.env.production.example) (or a prepared `.env.production`)
   - `api-console-images.tar` (if using save/load)

2. Configure env:

```bash
cp .env.production.example .env.production
# set DATABASE_URL to your external Postgres (reachable from this host/containers)
# fill secrets (CSRF, vault, session keys), PUBLIC_URL, CORS, ADMIN_LOGINS
# match API_IMAGE / WEB_IMAGE to the tags you built
```

3. Load images (if not using a registry):

```bash
npm run images:load
# equivalent: docker load -i api-console-images.tar
```

4. Ready-check and start (**no image build on the run host**):

```bash
npm run prod:check
npm run compose:up
# alias: npm run compose:up:images
```

5. Smoke:

```bash
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/api/health
# expect: storeBackend POSTGRES, isEnabled false, release v1-cde-local
```

Logs / stop:

```bash
npm run compose:logs
npm run compose:down
```

---

## Network notes

- **Postgres:** open TCP from the run host (API container network) to the remote DB. `DATABASE_URL` must not use the example `USER:PASSWORD@postgres-host` placeholder.
- **Redis:** provided by compose (`redis://redis:6379`); do not point production compose at the infra-only Postgres file.
- **Edge TLS:** terminate in front of `WEB_PUBLISH_PORT` (default `8080`); forward `X-Forwarded-*` headers.

---

## Same-machine shortcut

If build and run share one host (images already local):

```bash
npm run docker:build
# configure .env.production with external DATABASE_URL + secrets
npm run prod:check
npm run compose:up
```

No save/load required.
