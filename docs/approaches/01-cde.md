# Approach: CDE (Control Plane)

**وضعیت:** پیاده‌سازی‌شده و مسیر پیش‌فرض فعلی.

## مخاطب

توسعه‌دهندگان و QA که روی پروژه‌های CDE (`cde.edus.ir` یا multi-origin) کار می‌کنند و باید عملیات `ds/` / `fr/` و سرویس واقعی پروژه را کشف و اجرا کنند.

## ورود

```mermaid
sequenceDiagram
  actor U as کاربر
  participant W as Web :5173
  participant S as Session API
  participant C as CDE Bridge
  participant CP as CDE Core
  U->>W: باز کردن اپ
  W->>C: GET /api/cde/origins
  U->>W: انتخاب origin + موبایل
  W->>C: POST /api/cde/session/start
  C->>CP: challenge
  U->>W: رمز CDE
  W->>C: POST /api/cde/session/password
  C->>CP: login + cookie jar
  C->>S: session authenticated + directory sync
  U->>W: انتخاب پروژه
  W->>S: POST /api/session/context
  W->>W: ورود به Console / Runtime
```

### مسیرها

| مرحله | مسیر |
| --- | --- |
| Origins | `GET /api/cde/origins` |
| Start | `POST /api/cde/session/start` |
| Password | `POST /api/cde/session/password` |
| Projects | `GET /api/cde/projects` |
| Context | `POST /api/session/context` |
| Bootstrap admins | `API_CONSOLE_ADMIN_LOGINS` / `API_CONSOLE_QA_LEAD_LOGINS` |

## دو حالت کار بعد از ورود

1. **درخواست آزاد (`sourceApproach=FREE`)** — Postman-like؛ Collection روی پروژه CDE یا `PERSONAL`.
2. **کشف CDE (`sourceApproach=CDE` / `sourceType=CDE_DISCOVERY`)** — Scan بسته، Runtime Profile، Sync به Collection، Execute از طریق Runtime proxy.

```mermaid
flowchart TB
  Login[ورود CDE + انتخاب پروژه] --> Mode{حالت Runtime}
  Mode -->|درخواست آزاد| Free[Blank / cURL / Postman import]
  Mode -->|کشف CDE| Scan[Discovery scan]
  Scan --> Profile[Runtime Profile + session]
  Profile --> Sync[Sync operations → Collection]
  Sync --> Exec[Execute ds/fr / HTTP]
  Free --> Runner[Node HTTP Runner]
  Exec --> Runner
```

## User Stories کلیدی

| ID | Story |
| --- | --- |
| US-CDE-01 | به‌عنوان توسعه‌دهنده CDE می‌خواهم با موبایل/رمز وارد شوم تا پروژه‌هایم را ببینم. |
| US-CDE-02 | به‌عنوان Tech Lead می‌خواهم چند Runtime Origin مجاز Development را برای یک، چند یا همهٔ سامانه‌ها provision کنم تا توسعه‌دهنده از طریق `/devlogin` به میزبان درست متصل شود. |
| US-CDE-03 | به‌عنوان QA می‌خواهم عملیات کشف‌شده را Sync و Regression روی Collection اجرا کنم. |
| US-CDE-04 | به‌عنوان توسعه‌دهنده می‌خواهم بدون وابستگی به CDE Discovery هم درخواست HTTP آزاد بزنم (`PERSONAL` یا پروژه). |

## فایل‌های مرجع

- `apps/web/src/pages/CdeLoginPage.tsx`
- `apps/api/src/modules/cde/`
- `apps/web/src/components/api-console/RuntimeWorkspace.tsx`
- `docs/OPENAPI.md` — ds/fr mapping
