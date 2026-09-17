---
name: agent-orchestration
description: >-
  Coordinate API Console subagents for multi-surface work. Use when a task spans
  api/web/persistence/security, needs parallel investigation, verification gates,
  or risk-based human escalation. Skip for trivial single-file edits.
---

# Agent Orchestration

Main agent is the coordinator. Project specialists: `api-security`, `api-backend`, `web-console`, `persistence`, `verifier`, `console-reviewer`. See `AGENTS.md`. Do **not** create an orchestrator subagent hop for trivial work.

## 1. Classify

Labels (multi-OK): Feature | Bug | Refactor | Database | Infrastructure | Security | Performance | Investigation | Review.

Risk:

- **LOW** — docs, typo, isolated UI copy, formatting
- **MEDIUM** — normal API/UI feature, local schema change, refactor
- **HIGH** — auth/CSRF/vault/SSO/SSRF/workspace gate, IS flag, deploy/prod migrate, destructive DB, large monolith rewrite

## 2. Bypass (main agent only)

Do not delegate: rename one symbol, fix typo, one import, tiny docs, isolated formatting.

## 3. Graph

Build a dependency graph from ownership in `AGENTS.md`. Default patterns:

| Class | Order |
| --- | --- |
| Feature (API+DB+UI) | Investigate in parallel → `persistence` edits → `api-backend` (+ `api-security` if AuthZ) → `web-console` (needs API contract) → `verifier` → `console-reviewer` |
| Bug | Owner specialist → `verifier` → retry owner ≤2 → `console-reviewer` |
| Database | `persistence` first → handoff summary → `api-backend` → optional `web-console` → `verifier` |
| Security | `api-security` first → implementers → `verifier` → `console-reviewer` |
| Infrastructure | Main proposes only; human gate; no auto cutover |
| Review | `console-reviewer` (+ `verifier` if user asked to verify) |
| Investigation | Prefer built-in `explore`; then one specialist if needed |

**Serialize edits** on `api-console-server.cjs` and `OnlineApiConsolePage.tsx`. Parallelize read-only investigation freely. Parallelize edits only when file ownership is disjoint.

## 4. Context budget

`DISCOVER → SUMMARIZE → DELEGATE → IMPLEMENT → VERIFY`

Never dump full chat or whole files into every subagent. Prefer built-in `explore` once; reuse summaries.

Handoff payload (pass this, not prose dumps):

```json
{
  "task": "...",
  "scope": ["..."],
  "relevant_files": ["..."],
  "findings": ["..."],
  "constraints": ["IS off", "surgical monolith", "human-gated deploy"],
  "dependencies": ["..."],
  "verification_required": true
}
```

Examples of slim handoffs:

- persistence → backend: new fields, migration path, model paths
- backend → web: HTTP method/path, request/response shape, CSRF need — not server internals

## 5. Gates

Substantive work is incomplete until:

1. Implementers report structured results
2. `verifier` PASS (smallest sufficient matrix)
3. `console-reviewer` has no Critical findings

HIGH: also ensure `api-security` reviewed or owned the auth-sensitive surface.

On verifier FAIL: return to owning implementer (max **2** retries). Then escalate to human.

## 6. Human escalation (must ask)

Ambiguous product/architecture choice; production or non-local migrate/deploy; secrets; enabling IS; weakening destination policy; convention conflict; unexplained test failures after 2 retries.

## 7. Subagent output contract

Expect every specialist to return: Summary, Findings, Files, Decisions, Risks, Verification, Recommendations, Blockers. Subagents return to **parent only** — no peer re-dispatch.

## 8. Skills

- End-to-end console feature → `add-console-capability`
- Bugs → `bug-fix`
- Schema/store → `database-change`
