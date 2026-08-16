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

## Docs

- [ONLINE_API_CONSOLE.md](docs/ONLINE_API_CONSOLE.md)
- [OPENAPI.md](docs/OPENAPI.md)
