# API Console

Standalone Online API Console. **ورود: CDE + Local Directory (E34).** رویکرد Integrated Systems هم موجود است (feature flag).

## Quick start

```bash
cd d:\AllApp\API-CONSOLE
copy .env.example .env
npm install
npm run ports:check      # وضعیت پورت‌های این پروژه (بدون kill پروژه‌های دیگر)
npm run backend          # API — پیش‌فرض :5281 (اگر اشغال بود خودکار بعدی)
npm run dev              # Web — پیش‌فرض :5280 (Vite در صورت اشغال جابه‌جا می‌شود)
```

- Web: [http://localhost:5280](http://localhost:5280) (اگر اشغال باشد Vite پورت بعدی را می‌گیرد)
- API: [http://localhost:5281](http://localhost:5281) (اگر اشغال باشد خودکار پورت آزاد بعدی)
- Swagger: [http://localhost:5281/api/docs](http://localhost:5281/api/docs)
- Portal: [http://localhost:5280/portal](http://localhost:5280/portal)

پورت‌های پیش‌فرض طوری انتخاب شده‌اند که با Integrated Systems (`5173`, `4000`, `3002`, …) تداخل نکنند.  
`npm run dev:kill-ports` فقط listenerهای **همین ریپو** را روی پورت‌های API Console می‌بندد و پروسه‌های پروژهٔ دیگر را دست نمی‌زند.

## Auth (امروز)

1. Open `/` → redirect to `/login`. Tabs: **CDE** | **Local**.
2. **CDE:** On same-site `*.edus.ir`, cookie SSO may detect a session (`POST /api/cde/session/sso`). Otherwise use the CDE popup or cellphone + password. Access is **gated** by `API_CONSOLE_REQUIRED_WORKSPACES` (default: `medu-ai`). With `GATE_ONLY`, after login **all** CDE projects remain visible.
3. **Local (E34):** SYSTEM_ADMIN creates users under **ادمین → کاربران**. Login with username/password → `authApproach=LOCAL`, workspace `PERSONAL` (FREE only; no CDE Discovery/Runtime).
4. Identity and role for API calls come from the **server session** — browser context headers are not trusted (opt-in legacy only via `API_CONSOLE_ALLOW_LEGACY_CONTEXT` outside production).

Role allowlists (comma-separated CDE login names, e.g. `09022849799`):

- `API_CONSOLE_ADMIN_LOGINS` → bootstrap SYSTEM_ADMIN
- `API_CONSOLE_QA_LEAD_LOGINS` → QA_LEAD
- everyone else → DEVELOPER until a System Administrator assigns another directory role

After CDE login, display name and cellphone sync into the local directory. Admins grant roles (and manage local accounts) in **Users**.

**SSO note:** Cookie-forward SSO only works when the console is hosted on the same registrable domain as CDE (e.g. `api-console.edus.ir`). Local development uses the phone/password form or Local Directory accounts.

### Planned approaches


| Approach           | Who                                                    | Status                                                     |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| CDE                | تیم‌های کنترل‌پلن CDE                                  | Implemented                                                |
| Local Directory    | کاربران با یوزر/پسورد تعریف‌شده توسط مدیر              | **Implemented** (E34)                                      |
| Integrated Systems | پل با Gateway/SSO در `D:\AllApp\IS\integrated-systems` | **Implemented** (login + systems + Gateway cookie forward) |


See [docs/PRD.md](docs/PRD.md) and [docs/approaches/](docs/approaches/README.md).

## Work modes

- **Free / Postman-like** (`sourceApproach=FREE`, optional `PERSONAL` collection): arbitrary HTTP with org destination policy.
- **CDE Discovery** (`CDE_DISCOVERY`): scan → Runtime Profile → sync → execute `ds/` / `fr/`.



## Data

`API_CONSOLE_STORE_BACKEND=FILE|SQLITE|POSTGRES` (default `FILE`).

- **FILE / SQLITE** — store under `runtime/api-console/` (+ secret vault).
- **POSTGRES** — Prisma multi-schema (`identity`, `workspace`, `catalog`, `runtime`, `execution`, `governance`, `observability`). Set `DATABASE_URL`, then:

```bash
npm run db:generate -w @api-console/api
npm run db:bootstrap -w @api-console/api   # SQL schemas/tables (no engine download)
npm run db:migrate:dev -w @api-console/api -- --name init
npm run migrate:pg -w @api-console/api   # optional import from FILE/SQLITE
```

See [docs/persistence/POSTGRES.md](docs/persistence/POSTGRES.md).

## CDE origin

`CDE_CORE_BASE_URL` defaults to `https://cde.edus.ir`. Multi-origin: `API_CONSOLE_CDE_ORIGINS` JSON array (see `.env.example`).

DNS fallback when corporate DNS remaps public hosts: `API_CONSOLE_DNS_SERVERS=8.8.8.8,1.1.1.1`.

## Collection runner CLI (CI)

```bash
npm run cli:run -w @api-console/api -- --collection <id> --cookie "api_console_session=..." --junit results.xml
```



## Runtime discovery (summary)

Control-plane login is CDE; project APIs execute through **Runtime Profiles**. System Admins and Tech Leads can provision one or more allowlisted Development origins (including the `/devlogin` target) for one, several, or all accessible systems. Developers can select and use provisioned origins but cannot manage them. Protected environments and Data Service settings remain administrator-controlled. Details: [docs/OPENAPI.md](docs/OPENAPI.md), [docs/ONLINE_API_CONSOLE.md](docs/ONLINE_API_CONSOLE.md).

## Docs


| Doc                                                          | Purpose                                         |
| ------------------------------------------------------------ | ----------------------------------------------- |
| [docs/README.md](docs/README.md)                             | Index                                           |
| [docs/PRD.md](docs/PRD.md)                                   | Full PRD — flows, stories, diagrams, approaches |
| [docs/approaches/](docs/approaches/README.md)                | CDE / Local / IS                                |
| [docs/ONLINE_API_CONSOLE.md](docs/ONLINE_API_CONSOLE.md)     | Implementation reference                        |
| [docs/OPENAPI.md](docs/OPENAPI.md)                           | Host Swagger & ds/fr                            |
| [docs/BACKLOG.md](docs/BACKLOG.md)                           | Epics & AC                                      |
| [docs/TEST_COVERAGE_MATRIX.md](docs/TEST_COVERAGE_MATRIX.md) | Automated tests                                 |


