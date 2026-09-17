---
name: add-console-capability
description: Add an end-to-end API Console capability (API route + optional OpenAPI + web client + surgical UI + verification). Use when implementing a new console feature that spans apps/api and apps/web.
---

# Add Console Capability

Cross-cutting workflow for a new console capability. Use with `agent-orchestration` (classify, handoff JSON, gates). Prefer existing patterns; stay surgical on monoliths. IS remains off for v1.

## Steps

1. **Clarify** authApproach / sourceApproach impact (CDE vs Local / FREE vs CDE_DISCOVERY). Skip IS. Assign risk (AuthZ → HIGH).
2. **Persistence first** (if new entities/fields) — `persistence`; then slim handoff to API (fields, migration path, store keys). Local migrate only with human OK.
3. **API** — Delegate to `api-backend` (or `api-security` if AuthZ/CSRF/destination-related) with handoff JSON:
   - Add/adjust handler under `apps/api/src/modules/…`
   - Surgical edit to `api-console-server.cjs` only if wiring requires it
   - Update `apps/api/src/openapi/` inventory/docs if the public API surface changes
   - Add `apps/api/test/*.cjs` coverage
4. **Web** — Delegate to `web-console` with **API contract only** (not server internals):
   - Extend `apiConsoleApi.ts` / `cdeApi.ts` with CSRF + `credentials: 'include'`
   - Prefer a section under `components/api-console/`; touch `OnlineApiConsolePage.tsx` only if required
   - Respect RTL + LTR technical fields
5. **Verify** — `verifier` with the smallest sufficient matrix.
6. **Review** — `console-reviewer` before merge.

## Do not

- Enable `API_CONSOLE_IS_ENABLED`
- Opportunistically split monoliths (E22)
- Run non-local DB migrates or production compose cutover
- Forge AuthZ via browser context headers

## Done when

API + UI behave correctly under session/CSRF, tests chosen by `verifier` pass, and `console-reviewer` has no Critical findings.
