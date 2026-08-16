# API Console

Standalone Online API Console with CDE login. No dependency on UTMS.

## Quick start

```bash
cd d:\AllApp\API-CONSOLE
copy .env.example .env
npm install
npm run backend
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4274
- Swagger: http://localhost:4274/api/docs

## Auth

1. Open the app and connect with CDE cellphone + password.
2. Projects load from CDE; select a project (application scope).
3. Online API Console UI is unchanged from UTMS.

Role allowlists (comma-separated CDE login names, e.g. `9121234567`):

- `API_CONSOLE_ADMIN_LOGINS` → bootstrap SYSTEM_ADMIN (at least one initial administrator)
- `API_CONSOLE_QA_LEAD_LOGINS` → QA_LEAD
- everyone else → DEVELOPER

After a successful CDE login, the user's CDE display name and cellphone are synced into the local console directory. A System Administrator can open **مدیریت کاربران** and grant another synced CDE user the `SYSTEM_ADMIN` role. Managed assignments are persisted in `api-console-store.json`; authentication still happens only through CDE.

Only `SYSTEM_ADMIN` can approve/return API sharing requests and choose the synced CDE developers who may consume the approved API. Bootstrap administrators remain controlled by `API_CONSOLE_ADMIN_LOGINS` and cannot be revoked from the UI.

## Data

File store under `runtime/api-console/` (JSON store + secret vault). No Prisma required.

Optional: copy existing UTMS `runtime/api-console/*` files into this folder to migrate console data.

## CDE origin

`CDE_CORE_BASE_URL` defaults to `https://cde.edus.ir`. Change this later to add other origins.

## Runtime discovery and execution

The CDE connection is the control-plane login. Project APIs execute through one of the project's administrator-approved Runtime Profiles instead:

1. Open **Runtime و Discovery**, run the static CDE scan, and review `APP_RAYA_SERVICE_ID` evidence.
2. The system automatically provisions a Development Runtime Profile for each selected project and every origin in `RUNTIME_DEFAULT_ORIGINS` (default: `https://soha.m.edus.ir`). A `SYSTEM_ADMIN` only needs to add or change an HTTPS origin; `/core-api/v1`, `/devlogin`, `/`, `medugovir`, and `prostage=develop` are applied automatically and remain available as advanced overrides.
3. The administrator selects the discovered project service ID. The runtime host service ID remains separate and is derived from the approved origin.
4. Each developer connects the profile using the cellphone already attached to their CDE session and a runtime password. Passwords are never persisted; cookies and `client-id` are encrypted in Redis (or the development-only memory fallback).
5. Previewed `ds/`, `fr/`, OpenAPI and literal Data Service operations can be synced idempotently to a Collection. Removed source operations become `STALE`; manual changes are preserved or reported as merge conflicts.

Runtime origins must match `RUNTIME_ORIGIN_ALLOWLIST` and resolve only to public addresses. Cross-origin redirects, URL credentials and private/metadata destinations are rejected. Configure a unique `RUNTIME_SESSION_ENCRYPTION_KEY` in production.

Runtime Swagger uses the authenticated API Console proxy. Postman and cURL exports contain the direct login/cookie-jar flow with empty phone/password variables and never export a stored cookie or credential. Data Service execution remains blocked until an administrator supplies an HTTPS base URL and vault-backed authentication configuration.

## Docs

- [ONLINE_API_CONSOLE.md](docs/ONLINE_API_CONSOLE.md)
- [OPENAPI.md](docs/OPENAPI.md)
