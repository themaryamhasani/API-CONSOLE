---
name: bug-fix
description: >-
  Fix API Console bugs with owner routing, targeted tests, verifier gates, and
  retry limits. Use for login failures, runtime errors, incorrect API/UI behavior,
  or failing tests.
---

# Bug Fix

Follow `agent-orchestration` for classification and handoffs. IS stays off; surgical monolith edits only.

## Steps

1. **Reproduce / locate** — Prefer built-in `explore` or one targeted read. Capture error, path, and failing test name if any.
2. **Classify owner**
   - Session/CSRF/SSO/vault/SSRF/workspace → `api-security`
   - Routes/execution/runtime/OpenAPI → `api-backend`
   - UI/stores/clients/e2e → `web-console`
   - Prisma/adapters/store shape → `persistence`
3. **Handoff** slim JSON (`task`, `relevant_files`, `findings`, `constraints`). Do not paste entire logs unless necessary (trim).
4. **Implement** via owner agent. If the bug is HIGH security, `api-security` goes first even when UI also needs a fix.
5. **Verify** — `verifier` with the smallest matrix (often one `test:*` + related smoke).
6. **Retry** — On FAIL, return to the same owner with failure summary (max **2**). Then ask the human.
7. **Review** — `console-reviewer` for MEDIUM/HIGH or multi-file fixes.

## Do not

- Re-explore the whole repo in every agent
- Parallel-edit the same monolith file
- Enable IS or weaken destination policy to “make tests pass”
- Infinite fix loops

## Done when

Root cause addressed, verifier PASS, no Critical reviewer findings (when review ran), Blockers empty.
