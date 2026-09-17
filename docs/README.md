# مستندات API Console

نقشهٔ اسناد محصول standalone.

| سند | نقش |
| --- | --- |
| [deploy/PRODUCTION.md](./deploy/PRODUCTION.md) | **استقرار production نسخهٔ v1** (Compose: api/web/redis؛ Postgres خارجی؛ SSO) |
| [PRD.md](./PRD.md) | منبع حقیقت محصول — چشم‌انداز، Personas، User Stories |
| [approaches/](./approaches/README.md) | رویکردهای ورود: **CDE**، **Local Directory**، **IS (پس از v1)** |
| [ONLINE_API_CONSOLE.md](./ONLINE_API_CONSOLE.md) | سند پیاده‌سازی فنی |
| [OPENAPI.md](./OPENAPI.md) | Swagger میزبان، ds/fr، Runtime execute |
| [BACKLOG.md](./BACKLOG.md) | Epic/Story و Acceptance Criteria |
| [TEST_COVERAGE_MATRIX.md](./TEST_COVERAGE_MATRIX.md) | ماتریس تست‌های خودکار |
| [persistence/STORE_MAPPING.md](./persistence/STORE_MAPPING.md) | نگاشت JSON store → SQLite |
| [persistence/POSTGRES.md](./persistence/POSTGRES.md) | PostgreSQL / Prisma |
| [persistence/BACKUP_RESTORE.md](./persistence/BACKUP_RESTORE.md) | پشتیبان‌گیری و بازیابی |

## شروع سریع (لوکال)

```bash
npm install
npm run ports:check
npm run backend          # :5281 (+ fallback)
npm run dev              # :5280 (+ Vite bump)
npm run dev:kill-ports   # فقط پروسه‌های همین پروژه
```

## استقرار production (v1)

Compose فقط **redis + api + web** را بالا می‌آورد. Postgres روی سرور دیگر است (`DATABASE_URL`).

Dockerfileها (بیلد با `docker build`، نه compose):

- [`docker/Dockerfile.api`](../docker/Dockerfile.api) → `api-console-api:latest`
- [`docker/Dockerfile.web`](../docker/Dockerfile.web) → `api-console-web:latest`

```bash
# Build host
npm run docker:build
npm run images:save

# Run host
cp .env.production.example .env.production
# DATABASE_URL را به Postgres خارجی تنظیم کنید
npm run images:load
npm run prod:check
npm run compose:up
```

جزئیات: [deploy/PRODUCTION.md](./deploy/PRODUCTION.md) و [deploy/LAUNCH.md](./deploy/LAUNCH.md).

## وضعیت رویکردهای ورود

| رویکرد | وضعیت | مخاطب |
| --- | --- | --- |
| CDE | **پشتیبانی‌شده (v1)** | تیم‌های محیط CDE |
| Local Directory | **پشتیبانی‌شده (v1)** — E34 | کاربران غیر-CDE؛ درخواست آزاد |
| Integrated Systems (IS) | **عمداً خاموش تا پس از go-live** — E35 در کد هست | تیم پلتفرم IS؛ فعال‌سازی بعد از پایداری زیر بار |

`API_CONSOLE_IS_ENABLED=false` پیش‌فرض و الزام v1 است. ورود UI فقط **CDE | Local**.
