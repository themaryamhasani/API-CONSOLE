# API Console

Standalone Online API Console. **ورود فعلی: CDE.** رویکردهای Local Directory و Integrated Systems در PRD طراحی شده‌اند.

## Quick start

```bash
cd d:\AllApp\API-CONSOLE
copy .env.example .env
npm install
npm run ports:check      # وضعیت پورت‌های این پروژه (بدون kill پروژه‌های دیگر)
npm run backend          # API — پیش‌فرض :5281 (اگر اشغال بود خودکار بعدی)
npm run dev              # Web — پیش‌فرض :5280 (Vite در صورت اشغال جابه‌جا می‌شود)
```

- Web: http://localhost:5280 (اگر اشغال باشد Vite پورت بعدی را می‌گیرد)
- API: http://localhost:5281 (اگر اشغال باشد خودکار پورت آزاد بعدی)
- Swagger: http://localhost:5281/api/docs
- Portal: http://localhost:5280/portal

پورت‌های پیش‌فرض طوری انتخاب شده‌اند که با Integrated Systems (`5173`, `4000`, `3002`, …) تداخل نکنند.  
`npm run dev:kill-ports` فقط listenerهای **همین ریپو** را روی پورت‌های API Console می‌بندد و پروسه‌های پروژهٔ دیگر را دست نمی‌زند.

## Auth (امروز)

1. Open the app and connect with CDE cellphone + password (optional multi-origin picker).
2. Projects load from CDE; project selection is optional for **free / PERSONAL** requests.
3. Identity and role for API calls come from the **server session** — browser context headers are not trusted (opt-in legacy only via `API_CONSOLE_ALLOW_LEGACY_CONTEXT` outside production).

Role allowlists (comma-separated CDE login names, e.g. `9121234567`):

- `API_CONSOLE_ADMIN_LOGINS` → bootstrap SYSTEM_ADMIN
- `API_CONSOLE_QA_LEAD_LOGINS` → QA_LEAD
- everyone else → DEVELOPER until a System Administrator assigns another directory role

After CDE login, display name and cellphone sync into the local directory. Admins grant roles in **Users**. Authentication itself still happens only through CDE until **E34 (Local)** / **E35 (IS)** ship.

### Planned approaches

| Approach | Who | Status |
| --- | --- | --- |
| CDE | تیم‌های کنترل‌پلن CDE | Implemented |
| Local Directory | کاربران با یوزر/پسورد تعریف‌شده توسط مدیر | PRD + Backlog E34 |
| Integrated Systems | پل با Gateway/SSO در `D:\AllApp\IS\integrated-systems` | **Implemented** (login + systems + Gateway cookie forward) |

See [docs/PRD.md](docs/PRD.md) and [docs/approaches/](docs/approaches/README.md).

## Work modes

- **Free / Postman-like** (`sourceApproach=FREE`, optional `PERSONAL` collection): arbitrary HTTP with org destination policy.
- **CDE Discovery** (`CDE_DISCOVERY`): scan → Runtime Profile → sync → execute `ds/` / `fr/`.

## Data

File or SQLite store under `runtime/api-console/` (+ secret vault). See `docs/persistence/`.

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

| Doc | Purpose |
| --- | --- |
| [docs/README.md](docs/README.md) | Index |
| [docs/PRD.md](docs/PRD.md) | Full PRD — flows, stories, diagrams, approaches |
| [docs/approaches/](docs/approaches/README.md) | CDE / Local / IS |
| [docs/ONLINE_API_CONSOLE.md](docs/ONLINE_API_CONSOLE.md) | Implementation reference |
| [docs/OPENAPI.md](docs/OPENAPI.md) | Host Swagger & ds/fr |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Epics & AC |
| [docs/TEST_COVERAGE_MATRIX.md](docs/TEST_COVERAGE_MATRIX.md) | Automated tests |
