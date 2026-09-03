# OpenAPI / Swagger

The standalone API process serves:

- OpenAPI document: `GET /api/openapi.json`
- Swagger UI: `GET /api/docs`
- Runtime Swagger (per project/profile, after Discovery): `GET /api/api-console/projects/{projectKey}/runtime-profiles/{profileId}/docs`

Covered surfaces:

- Session (`/api/session*`)
- CDE bridge (`/api/cde/session*`, projects, catalog, package)
- Online API Console (`/api/api-console/*`)

Planned (E34/E35 — not in host OpenAPI until implemented):

- Local auth: `/api/auth/local/*`
- IS bridge: `/api/auth/is/*`, `/api/api-console/is/*`

This Swagger UI documents the **host APIs**. Per-request markdown/DOCX documentation inside the Online API Console UI is unchanged. Product approaches: [approaches/README.md](./approaches/README.md).

## Quick start (Try it out)

1. Start API: `npm run backend` (preferred `:5281`, auto-fallback if busy)
2. Log in via web UI: `http://localhost:5280` (CDE or IS)
3. Open Swagger: `http://localhost:5281/api/docs`
4. Call `GET /api/session` — confirm `authenticated: true`
5. Use prefilled examples on `POST /api/api-console/curl/parse` or `POST /api/api-console/validate-core`

Swagger sends the session cookie and `x-csrf-token` automatically after login.

No-auth smoke test: `GET /api/health` or `GET /api/api-console/health/config`.

## CDE ds/fr mapping

| CDE module | Type | Runtime endpoint | Payload fields |
|------------|------|------------------|----------------|
| `ds/...` | CORE_QUERY | `.../data-provider/get-data-source` | `serviceId`, `key` (path without `ds/`), `params` |
| `fr/...` | CORE_COMMAND | `.../data-provider/store-form-data` | `serviceId`, `formId` (path without `fr/`), `data` |

Fixture examples used in tests and Swagger samples:

- `ds/community/list` → `key: "community/list"`, `params: { "page": 1 }`
- `fr/community/save` → `formId: "community/save"`, `data: { "title": "example" }`
- Sanity query: `pages-app/who-am-i` with empty `params`

Replace `YOUR_PROJECT_SERVICE_ID`, `YOUR_PROJECT_KEY`, and `YOUR_RUNTIME_PROFILE_ID` with values from Discovery and Runtime settings in the UI.

## Runtime execution flow

1. Discovery scan: `POST /api/api-console/projects/{projectKey}/discovery/scan`
2. List operations: `GET /api/api-console/projects/{projectKey}/discovery/latest`
3. Connect Runtime profile in the UI
4. Execute: `POST /api/api-console/runtime/operations/{operationId}/execute`  
   - ds: body `{ projectKey, runtimeProfileId, input: { ... } }`  
   - fr: add `"confirmed": true`

Or open Runtime Swagger at `.../runtime-profiles/{profileId}/docs` for generated execute endpoints per discovered operation.

## Free request execution

`POST /api/api-console/requests/{id}/execute` runs the Node runner with destination policy + optional public DNS fallback (`API_CONSOLE_DNS_SERVERS`). Filter lists with `?sourceApproach=FREE|CDE`.
