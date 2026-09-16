# Test Coverage Matrix

Living matrix of automated tests in this repository. Status reflects what each file exercises today—not aspirational coverage.

## Backend (`apps/api/test`)

| Test file | npm script | Covers | Notes |
| --- | --- | --- | --- |
| `admin-access.test.cjs` | `test:admin` | Directory users, SYSTEM_ADMIN grant/revoke, share-review RBAC | Legacy context header |
| `session-trust.test.cjs` | `test:session` | Session cookie trust | S02.01 |
| `environments.test.cjs` | `test:environments` | Environment CRUD | E10 |
| `runtime-discovery.test.cjs` | `test:runtime` | Runtime profiles / discovery | |
| `runtime-promote.test.cjs` | `test:promote` | Profile promotion | S12.02 |
| `phase2-collab.test.cjs` | `test:phase2` | Collab / runner / checklist | E15–E18 |
| `phase3-platform.test.cjs` | `test:phase3` | Portal / mocks / JIT / compliance | E24–E31 |
| `vault-provider.test.cjs` | `test:vault` | Vault + org policy | E06, E08 |
| `persistence.test.cjs` | `test:persist` | FILE/SQLITE adapter | E01 |
| `object-store.test.cjs` | `test:object-store` | Large body blob put/get/cleanup | **S01.03** |
| `cde-sso.test.cjs` | `test:sso` | Cookie forward SSO | |
| `workspace-access.test.cjs` | `test:workspace` | Workspace gate | |
| `local-auth.test.cjs` | `test:local-auth` | Local Directory | E34 |
| `postgres-store.test.cjs` | `test:postgres` | Prisma round-trip (optional DB) | |
| `system-smoke.test.cjs` | `test:system` | Scope + SSRF smoke | S23.01 |
| `is-flag.test.cjs` | `test:is-flag` | IS feature flag default off | v1 |

## Frontend (`scripts/test-web-smoke.cjs` + Playwright)

| Check | npm script | Covers |
| --- | --- | --- |
| Workspace route mapping | `test:web` | `/` → requests, `/runtime`, … |
| Extracted modules exist | `test:web` | Repository/Reviews/Users/Response/Runtime/… |
| App registers routes | `test:web` | `WORKSPACE_ROUTE_PATHS` in `App.tsx` |
| Playwright e2e | `test:e2e` | Login UI, auth gate, local login, sidebar routes, portal, logout, health proxy, IS disabled |

```bash
npm run test:web
npm run test:e2e
# Local (system Chrome): E2E_BROWSER=chrome npm run test:e2e
# CI installs bundled Chromium
```

## Aggregate

```bash
npm run test:all -w @api-console/api
npm run test:web
npm run test:e2e
# or: npm run test:all   # api + web smoke (not e2e)
```

## Known gaps (remaining optional)

- Further splitting of the Requests editor JSX still composed inside `OnlineApiConsolePage` shell
- Broader Playwright coverage of collection CRUD / execute flows (needs richer seed data)

## Related commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Web TypeScript |
| `npm run test:e2e` | Playwright browser e2e (Chrome locally / Chromium in CI) |
| `npm run self-check -w @api-console/api` | Parser/docs/vault smoke |
| `npm run zone-worker -w @api-console/api` | Zone execution worker |
