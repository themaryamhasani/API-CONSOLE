# Launch — split build / run (external Postgres)

Operator checklist for API Console v1. Full production notes: [PRODUCTION.md](./PRODUCTION.md).

**Stack on the run host:** `redis` + `api` + `web` via [`docker-compose.yml`](../../docker-compose.yml).  
**Postgres:** external only — set `DATABASE_URL` (not in compose).  
**Images:** built on a separate build host via [`docker-compose.build.yml`](../../docker-compose.build.yml).

```text
Build host  →  api-console-api + api-console-web images  →  save/load (or registry)
Run host    →  docker compose up  →  redis + api + web  →  external Postgres
```

---

## Build host

Needs: Docker, repo checkout (Node not required for Docker-only build).

1. Clone the repo and `cd` to the root.
2. Optional: copy [`.env.production.example`](../../.env.production.example) → `.env.production` and set only `API_IMAGE` / `WEB_IMAGE` if you override tags. Full secrets are **not** required to build.
3. Build both images:

```bash
npm run compose:build
# equivalent:
# docker compose -f docker-compose.build.yml --env-file .env.production build
```

Or without an env file (default tags):

```bash
docker compose -f docker-compose.build.yml build
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

4. Ready-check and start (**no build**):

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
npm run compose:build
# configure .env.production with external DATABASE_URL + secrets
npm run prod:check
npm run compose:up
```

No save/load required.
