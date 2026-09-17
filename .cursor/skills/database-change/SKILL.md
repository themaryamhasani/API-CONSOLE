---
name: database-change
description: >-
  Change API Console persistence (Prisma multi-schema, FILE/SQLITE/POSTGRES
  adapters, mappings). Use for migrations, new fields/entities, or store-backend
  work. Never migrate non-local databases without human approval.
---

# Database Change

Follow `agent-orchestration`. Read `docs/persistence/` as needed.

## Steps

1. **Scope** — Which backends must stay compatible (`FILE` / `SQLITE` / `POSTGRES`)? Risk is HIGH if destructive or non-local.
2. **Investigate** — Delegate read-only discovery to `persistence` (and `explore` if locating call sites).
3. **Implement schema/adapters** — `persistence` only:
   - Update `apps/api/prisma/` + adapters under `…/infrastructure/persistence/`
   - Update `docs/persistence/STORE_MAPPING.md` when shape changes
   - `npm run db:generate -w @api-console/api`
   - Local migrate **only** with explicit human OK; otherwise stop after migration files/docs
4. **Handoff to API** — Pass slim contract to `api-backend`:

```text
DB change: <table/model> adds <fields>
Migration: <path or pending>
Store keys affected: <…>
```

5. **UI** — If contract affects clients, hand API shape to `web-console` (not Prisma internals).
6. **Verify** — `verifier` → `test:persist` / `test:postgres` when applicable, plus API tests for call sites.
7. **Review** — `console-reviewer` for MEDIUM/HIGH.

## Do not

- Run migrate/deploy against staging/production or unknown hosts
- Invent `DATABASE_URL` / print secrets
- Change vault keys as part of schema work
- Parallel-edit schema with backend writing conflicting store shapes

## Done when

Generate succeeds, mapping docs aligned, verifier PASS for persistence + affected API, human approved any non-local apply.
