# Test Coverage Matrix

Living matrix of automated tests in this repository (`apps/api/test`). Status reflects what each file exercises today—not aspirational coverage.

| Test file | npm script | Covers | Notes |
| --- | --- | --- | --- |
| `admin-access.test.cjs` | `test:admin` | Directory users, SYSTEM_ADMIN grant/revoke, `PUT /admin/users/:id/roles`, share-review RBAC (`QA_LEAD` vs `DEVELOPER`), usage report access | Uses legacy context header (`API_CONSOLE_ALLOW_LEGACY_CONTEXT`) |
| `session-trust.test.cjs` | `test:session` | Session cookie trust; forged `SYSTEM_ADMIN` header cannot escalate a DEVELOPER session | Primary S02.01 regression |
| `environments.test.cjs` | `test:environments` | Environment CRUD, clone, force-delete, production-protected rules | E10 |
| `runtime-discovery.test.cjs` | `test:runtime` | Runtime profiles, discovery sync, SSRF/destination policy smoke | Larger integration surface |
| `runtime-promote.test.cjs` | `test:promote` | Runtime profile promotion without copying secrets; role gates | S12.02 |
| `phase2-collab.test.cjs` | `test:phase2` | Shared visibility, activity, ownership/co-owners, collection runner / test runs, review comments/checklist | E15–E18, E33 |
| `phase3-platform.test.cjs` | `test:phase3` | Portal, OpenAPI export, mocks, JIT, compliance, branding, ITSM hooks, contract suite/baseline smoke | E24–E31 surface |
| `vault-provider.test.cjs` | `test:vault` | Vault provider (`local`/`env`), org policy + dual approval flow | E06, E08 |
| `persistence.test.cjs` | `test:persist` | Store adapter FILE vs SQLITE, migrate blob/entity tables | E01 |
| `system-smoke.test.cjs` | `test:system` | Scope-negative collection/request; SSRF localhost block | S23.01 |

## Aggregate runner

```bash
npm run test:all -w @api-console/api
```

Includes: phase2, phase3, persist, vault, promote, environments, session, system-smoke, admin.

`test:runtime` remains available individually (longer / more env-sensitive).

## Known gaps

- Frontend unit/e2e tests (none in this repo yet)
- Full split of `OnlineApiConsolePage` / curl-parser monolith (E22 PARTIAL)
- Dedicated object-store for very large response blobs (S01.03 PARTIAL)

## Related commands

| Command | Purpose |
| --- | --- |
| `npm run self-check -w @api-console/api` | In-process self-check (parser/docs/vault smoke) |
| `npm run typecheck` | Workspace TypeScript check (`apps/web`) |
| `npm run migrate:db -w @api-console/api` | JSON store → SQLite |
| `npm run zone-worker -w @api-console/api` | Zone execution worker process |
| `npm run backend:session-check` | Root alias for `test:session` |
| `npm run dev:kill-ports` | Kill listeners on WEB/API ports (+ project node on Windows) |

## Product docs

PRD and multi-approach identity (CDE / Local / IS): [`PRD.md`](./PRD.md), [`approaches/`](./approaches/README.md). When E34/E35 land, add dedicated auth tests to this matrix.

