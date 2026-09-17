# API Console — Agent Guide

Standalone Online API Console. npm workspaces: `@api-console/api` + `@api-console/web`.

## Architecture (short)

| Layer | Path | Notes |
| --- | --- | --- |
| API | `apps/api` | CommonJS Node, raw `http`, entry `src/main.cjs` |
| Web | `apps/web` | React 19 + Vite + Zustand + Tailwind, `lang=fa` RTL |
| Persistence | `apps/api` store backends | `FILE` (local default) \| `SQLITE` \| `POSTGRES` (prod) |
| Sessions | Redis when `REDIS_URL` | Cookie `api_console_session` + CSRF |
| Docs | `docs/` | SoT: `ONLINE_API_CONSOLE.md`, `deploy/PRODUCTION.md`, `persistence/` |

```
Browser → web (:5280 / nginx :8080) → /api → api (:5281) → Postgres + Redis
```

Auth trust comes from the **server session**, never from forgeable browser context headers. Mutations need `x-csrf-token`.

## v1 policies (non-negotiable)

1. **IS frozen:** Keep `API_CONSOLE_IS_ENABLED=false`. Inspect / fix clear IS regressions only. Do not expand IS UX or enable the flag.
2. **Surgical monolith:** Edit `api-console-server.cjs` and `OnlineApiConsolePage.tsx` only as needed for the task. No opportunistic E22 splits.
3. **Deploy human-gated:** Propose Docker/compose/script changes; run local checks only. Never migrate/up/down against non-local DBs. Never invent or print secrets. Production cutover is human-only.

## Local commands

```bash
npm install
npm run ports:check
npm run backend          # API :5281
npm run dev              # Web :5280
```

- Swagger: `http://localhost:5281/api/docs`
- Portal: `http://localhost:5280/portal`

Verification (pick the smallest sufficient set; see `verifier` agent):

- `npm run typecheck`
- `npm run test:all -w @api-console/api`
- `npm run test:web`
- `npm run test:e2e -w @api-console/web` (login/gate/routing)

## Approaches

| Approach | Status | Notes |
| --- | --- | --- |
| CDE | Supported | Cookie SSO (same-site) or phone/password; workspace gate |
| Local Directory | Supported | Admin-created users; `PERSONAL` / FREE |
| Integrated Systems | Deferred | Code present; flag off |

## Delegation model

Main agent owns intake, planning, trivial edits, synthesis, and **orchestration**. Read skill `agent-orchestration` for multi-surface work. Delegate specialists:

| Subagent | Delegate when | Parallelize with | Depends on |
| --- | --- | --- | --- |
| `api-security` | Session, CSRF, vault, SSO, SSRF destination policy, workspace gate, role allowlists | `web-console` (analysis; edits if disjoint files) | — |
| `api-backend` | HTTP routes, execution/queue/zones, runtime, OpenAPI inventory, API module logic | `web-console` if no shared files | `persistence` when schema required; `api-security` when AuthZ/destination |
| `web-console` | React console UI, stores, fetch clients, RTL/Persian UX, Playwright | `api-backend` / `api-security` for analysis | API **contract** from backend/security |
| `persistence` | Prisma multi-schema, store adapters, local migrations, persistence docs | other agents for **read-only** investigation | human OK for non-local migrate |
| `verifier` | After substantive changes — choose and run the right test matrix | never while implementers still editing | implementers done |
| `console-reviewer` | Before merge / after a feature — project-invariant review | after implementers; prefers verifier results | implementers done |

**Serialize edits** on `api-console-server.cjs` and `OnlineApiConsolePage.tsx` across agents.

Do not create circular delegation. Subagents return findings to the parent; they do not re-dispatch each other unless the parent asks.

### Task classes → default graph

| Class | Default flow |
| --- | --- |
| Feature (API+DB+UI) | Parallel investigate → `persistence` → `api-backend` (+ `api-security` if AuthZ) → `web-console` → `verifier` → `console-reviewer` |
| Bug | Owner specialist → `verifier` → retry owner ≤2 → `console-reviewer` |
| Database | `persistence` → handoff → `api-backend` → optional `web-console` → `verifier` |
| Security | `api-security` first → implementers → `verifier` → `console-reviewer` |
| Infrastructure | Main proposes; human gate; no auto cutover |
| Review | `console-reviewer` (+ `verifier` if asked to verify) |
| Investigation | Built-in `explore`, then one specialist if needed |

Workflow skills: `add-console-capability`, `bug-fix`, `database-change`, `agent-orchestration`.

### When not to delegate

Typo, single import, one-line docs, rename-one-symbol, isolated formatting — main agent only.

### Risk and escalation

- **LOW / MEDIUM / HIGH** — HIGH includes auth/CSRF/vault/SSO/SSRF/IS/deploy/destructive migrate.
- HIGH requires security ownership or review, `verifier`, and human approval before destructive/prod actions.
- Ask the human for: ambiguous product/architecture choice, non-local DB/deploy, secrets, enabling IS, policy conflicts, unexplained failures after **2** fix retries.

### Subagent output contract

Every specialist returns concise: Summary, Findings, Files, Decisions, Risks, Verification, Recommendations, Blockers. Prefer handoff JSON (task, scope, relevant_files, findings, constraints, dependencies) over full transcripts.

### Context budget

`DISCOVER → SUMMARIZE → DELEGATE → IMPLEMENT → VERIFY` — do not re-explore architecture in every agent.

## What the main agent keeps

- Product / backlog decisions
- Orchestration across subagents (no dedicated orchestrator subagent)
- Docs-only or single-file trivial edits
- Escalating production deploy and secret handling to a human
