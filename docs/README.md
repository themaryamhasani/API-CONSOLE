# مستندات API Console

نقشهٔ اسناد محصول standalone در `d:\AllApp\API-CONSOLE`.

| سند | نقش |
| --- | --- |
| [PRD.md](./PRD.md) | **منبع حقیقت محصول** — چشم‌انداز، Personas، User Stories، User Flows، معماری، رویکردهای ورود، دیاگرام‌ها |
| [approaches/](./approaches/README.md) | سه رویکرد کار با سامانه: **CDE**، **Local Directory**، **Integrated Systems (IS)** |
| [ONLINE_API_CONSOLE.md](./ONLINE_API_CONSOLE.md) | سند پیاده‌سازی فنی (UI، Runner، SSRF، RBAC، persistence) |
| [OPENAPI.md](./OPENAPI.md) | Swagger میزبان، ds/fr، Runtime execute |
| [BACKLOG.md](./BACKLOG.md) | Epic/Story و Acceptance Criteria |
| [TEST_COVERAGE_MATRIX.md](./TEST_COVERAGE_MATRIX.md) | ماتریس تست‌های خودکار |
| [persistence/STORE_MAPPING.md](./persistence/STORE_MAPPING.md) | نگاشت JSON store → SQLite |
| [persistence/BACKUP_RESTORE.md](./persistence/BACKUP_RESTORE.md) | پشتیبان‌گیری و بازیابی |

## شروع سریع

```bash
npm install
npm run ports:check
npm run backend          # :5281 (+ fallback)
npm run dev              # :5280 (+ Vite bump)
npm run dev:kill-ports   # فقط پروسه‌های همین پروژه
```

- Web: http://localhost:5280  
- API: http://localhost:5281  
- Swagger: http://localhost:5281/api/docs  
- Portal عمومی (توکن): http://localhost:5280/portal/shared/:token  

پورت‌ها از محدودهٔ IS (`5173`, `4000`, …) جدا هستند؛ اگر اشغال باشند خودکار پورت آزاد بعدی انتخاب می‌شود و `dev:kill-ports` فقط listenerهای همین ریپو را می‌بندد.

## وضعیت رویکردهای ورود (خلاصه)

| رویکرد | وضعیت | مخاطب |
| --- | --- | --- |
| CDE | **پیاده‌سازی‌شده** | تیم‌هایی که روی محیط CDE کار می‌کنند |
| Local Directory (یوزر/پسورد مدیر) | **طراحی‌شده در PRD / Backlog E34** | کاربران غیر-CDE؛ تمرکز روی درخواست آزاد Postman-like |
| Integrated Systems (IS) | **پیاده‌سازی‌شده** (لاگین + systems + Cookie Gateway) | تیم‌های پلتفرم IS (`D:\AllApp\IS\integrated-systems`) |

جزئیات: [approaches/README.md](./approaches/README.md) و [PRD.md](./PRD.md).
