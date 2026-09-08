# API Console — Product Backlog

منبع: تحلیل معماری/BA روی وضعیت فعلی سیستم (standalone Online API Console با ورود CDE) + گسترش Identity به Local و IS طبق [`PRD.md`](./PRD.md).

قرارداد اولویت:

| Priority | معنی |
| --- | --- |
| P0 | بقا، اعتماد سازمانی، Production-ready |
| P1 | ارزش روزانه تیم‌ها |
| P2 | تمایز محصول و مقیاس بلندمدت |

قرارداد وضعیت Story:

| Status | معنی |
| --- | --- |
| `TODO` | هنوز پیاده نشده / نیمه‌کاره نسبت به معیار پذیرش |
| `PARTIAL` | بخشی از رفتار در کد هست؛ Story برای تکمیل است |
| `DONE` | معیار پذیرش فعلی را پوشش می‌دهد (برای ردیابی) |

شناسه‌گذاری: `E##` = Epic ، `S##.##` = Story داخل همان Epic.

---

## نقشه Epicها

| Epic | عنوان | Priority | فاز پیشنهادی |
| --- | --- | --- | --- |
| E01 | Persistence و مقیاس داده | P0 | فاز 0 |
| E02 | Identity، Session Trust و CSRF | P0 | فاز 0 |
| E03 | RBAC قابل مدیریت | P0 | فاز 0 |
| E04 | Audit Explorer | P0 | فاز 0 |
| E05 | Notification Center | P0 | فاز 0 |
| E06 | Org Policy و کنترل Production | P0 | فاز 0 |
| E07 | Reports واقعی (Usage Telemetry UI) | P0 | فاز 0 |
| E08 | Secret Management سازمانی | P0 | فاز 0 |
| E09 | HTTP Methods کامل در UI | P1 | فاز 1 |
| E10 | Environment Manager | P1 | فاز 1 |
| E11 | Collection Folders و ساختار درختی | P1 | فاز 1 |
| E12 | Runtime Matrix و Multi-Environment | P1 | فاز 1 |
| E13 | Data Service First-Class Onboarding | P1 | فاز 1 |
| E14 | Discovery Drift و Conflict UX | P1 | فاز 1 |
| E15 | Team / Shared Workspace | P1 | فاز 2 |
| E16 | Repository Lifecycle پیشرفته | P1 | فاز 2 |
| E17 | Share Review غنی | P1 | فاز 2 |
| E18 | Collection Runner و Regression | P1 | فاز 2 |
| E19 | CI Integration | P1/P2 | فاز 2 |
| E20 | Scripts و Assertions پیشرفته | P1/P2 | فاز 2 |
| E21 | جستجو و DX Editor | P1 | فاز 1 |
| E22 | شکستن مونولیت Frontend/Backend | P1 | فاز 1–2 |
| E23 | Test Coverage سیستمی | P0/P1 | فاز 0–1 |
| E24 | API Documentation Portal | P2 | فاز 3 |
| E25 | OpenAPI Export از Collection/Repository | P2 | فاز 3 |
| E26 | DOCX/Branding قابل تنظیم | P2 | فاز 3 |
| E27 | ITSM / Ticket Integration | P2 | فاز 3 |
| E28 | Multi-Origin Control Plane (CDE+) | P2 | فاز 3 |
| E29 | Mock / Stub Server | P2 | فاز 3 |
| E30 | Contract Tests | P2 | فاز 3 |
| E31 | Security Hardening پیشرفته | P0/P1 | فاز 0–2 |
| E32 | Runner Zones و جداسازی شبکه | P1 | فاز 2 |
| E33 | Ownership و Collaboration روی Request | P1 | فاز 2 |
| E34 | ورود Local Directory (غیر-CDE) | P0 | فاز 0–1 |
| E35 | Approach Integrated Systems (Gateway/SSO/Spec) | P1 | فاز 1–2 |

---

## فاز 0 — Harden

### E01 — Persistence و مقیاس داده (P0)

**هدف:** جایگزینی file-store به‌عنوان منبع اصلی داده production با ذخیره‌سازی رابطه‌ای + object storage برای bodyهای بزرگ.

#### S01.01 — طراحی Schema و Migration اولیه
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] جداول/مدل برای entityهای اصلی کنسول (+ store_blob)
  - [x] migration اولیه و rollback documented (`docs/persistence/*`)
  - [x] نگاشت ۱:۱ با shape فعلی `api-console-store.json` مستند شده

#### S01.02 — Repository Adapter روی DB
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] backend از abstraction repository می‌خواند/می‌نویسد (`store-adapter.cjs`)
  - [x] feature flag `API_CONSOLE_STORE_BACKEND=FILE|SQLITE`
  - [x] self-check/test روی adapter سبز است

#### S01.03 — Object/File Storage برای Responseهای بزرگ
- **Status:** `PARTIAL` (آستانه body و masking موجود؛ object-store جدا اختیاری آینده)
- **Acceptance Criteria:**
  - [x] bodyهای خیلی بزرگ در execution محدود/preview می‌شوند
  - [ ] object store اختصاصی برای blobهای بسیار بزرگ
  - [ ] job cleanup اختصاصی

#### S01.04 — ابزار Migrate از JSON Store
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] CLI مهاجرت `npm run migrate:db`
  - [x] dry-run + گزارش تعداد رکورد
  - [x] idempotent بودن migrate

#### S01.05 — Backup / Restore Runbook
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] runbook backup DB + vault (`docs/persistence/BACKUP_RESTORE.md`)
  - [x] مراحل restore مستند شده

---

### E02 — Identity، Session Trust و CSRF (P0)

**هدف:** اعتماد فقط از session سمت سرور؛ حذف اتکا به payload نقش/scope ساخته‌شده در مرورگر.

#### S02.01 — Context از Session Server-Side
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] `role`، `userId`، `applicationId`، `scopeApplicationIds` از session سرور resolve می‌شوند
  - [x] تغییر یا جعل `x-api-console-context` / `x-utms-context` نمی‌تواند privilege escalate کند
  - [x] تست منفی: کاربر DEVELOPER با header جعلی SYSTEM_ADMIN → 403
  - [x] Legacy header فقط با `API_CONSOLE_ALLOW_LEGACY_CONTEXT=true` و خارج از production
  - [x] کلاینت دیگر role/claim در header نمی‌فرستد

#### S02.02 — سخت‌گیری Production Secrets
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] در `NODE_ENV=production` کلیدهای کوتاه/پیش‌فرض برای CSRF، CDE session، Runtime session، vault رد می‌شوند
  - [x] health/self-check وضعیت misconfig را بدون افشای secret گزارش می‌دهد

#### S02.03 — Session Revocation و Logout کامل
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] logout اپ، CDE bridge session و runtime sessions کاربر را invalidate می‌کند (طبق سیاست)
  - [x] لیست sessionهای فعال برای ادمین (اختیاری ولی معیار حداقل: revoke یک user)

---

### E03 — RBAC قابل مدیریت (P0)

**هدف:** نقش‌های تعریف‌شده در policy واقعاً قابل تخصیص و اعمال باشند.

#### S03.01 — UI تخصیص نقش‌های کامل Directory
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] ادمین بتواند نقش‌های `DEVELOPER`، `QA_LEAD`، `QA_SPECIALIST`، `BA`، `SECURITY_REVIEWER`، `TECH_LEAD`، `PRODUCT_OWNER` را به کاربر همگام‌شده CDE بدهد
  - [x] bootstrap admins از `API_CONSOLE_ADMIN_LOGINS` غیرقابل revoke از UI بمانند
  - [x] تغییر نقش audit شود
  - [x] `resolveRole` نقش‌های `ADMIN_APPROVAL` را با precedence اعمال می‌کند
  - [x] `PUT /admin/users/:id/roles`

#### S03.02 — هم‌ترازی Review با نقش‌ها
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] Share Review برای نقش‌های مجاز policy (`SYSTEM_ADMIN`, `TECH_LEAD`, `QA_LEAD`) باز شود
  - [x] frontend و backend یک source of truth برای `canReviewShares` داشته باشند
  - [x] تست: QA_LEAD می‌تواند list کند؛ DEVELOPER → 403

#### S03.03 — Scope پروژه/سامانه در Assignment
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] نقش بتواند به یک یا چند `applicationId` محدود شود
  - [x] list/mutation خارج از scope همچنان 403 یا filter شود
  - [x] تست سیستمی scope منفی موجود نگه داشته/تکمیل شود

#### S03.04 — نقش PRODUCT_OWNER / BA فقط‌خواندنی در اجرا
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] نقش بدون `canExecute` دکمه اجرا را نمی‌بیند یا disabled با توضیح
  - [x] تلاش API مستقیم execute → 403

---

### E04 — Audit Explorer (P0)

**هدف:** قابل مشاهده بودن trail امنیتی/عملیاتی برای ادمین.

#### S04.01 — API لیست Audit با فیلتر
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] `GET /api/api-console/admin/audit` با فیلتر: بازه زمانی، userId، action، applicationId، correlationId
  - [x] pagination و بدون raw secret در payload
  - [x] فقط SYSTEM_ADMIN (یا نقش audit مشخص)

#### S04.02 — صفحه Audit در Workspace
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] جدول خوانا با جزئیات expandable
  - [x] export CSV/JSON بدون secret
  - [x] لینک به request/share/runtime مرتبط در صورت وجود

---

### E05 — Notification Center (P0)

**هدف:** رویدادهای مهم به Inbox کاربر برسند.

#### S05.01 — API خواندن/علامت‌خوانده Notifications
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] `GET /notifications`، `POST /notifications/{id}/read`، `POST /notifications/read-all`
  - [x] فقط notifications مربوط به user جاری
  - [x] رویدادهای حداقل از مسیر `notifyUser` موجود مصرف می‌شوند

#### S05.02 — UI زنگوله / Inbox
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] badge تعداد خوانده‌نشده در Header
  - [x] لیست با deep-link پایه (mark read)
  - [x] به‌روزرسانی بعد از باز کردن Inbox

---

### E06 — Org Policy و کنترل Production (P0)

#### S06.01 — مدیریت Allowlist مقصد از UI ادمین
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] SYSTEM_ADMIN بتواند allowlist را در UI Org Policy ببیند/ویرایش کند
  - [x] تغییر policy audit شود
  - [x] production همچنان wildcard نداشته باشد

#### S06.02 — تأیید دو مرحله‌ای Production Core Command
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] برای Production Command: confirmation + businessJustification اجباری + نقش elevated
  - [x] ثبت audit با justification
  - [x] dual-approval با feature flag / org policy

#### S06.03 — سیاست TLS Insecure / EXACT Mode
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] در Production، verifyCertificate=false و EXACT mode طبق org policy ممنوع
  - [x] UI/پیام دلیل block روشن است

---

### E07 — Reports واقعی (Usage Telemetry UI) (P0)

#### S07.01 — اتصال UI به `getApiUsageReport`
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] تب Reports جدول usage events را از backend می‌خواند
  - [x] فیلتر: apiId، eventType، userId، از/تا (جلالی)، applicationId
  - [x] pagination سمت سرور

#### S07.02 — خلاصه تحلیلی Usage
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] summary.total / uniqueApis / uniqueUsers در UI
  - [x] top APIs بر اساس `API_EXECUTED` / `ADDED_TO_CONSOLE`
  - [x] export گزارش

#### S07.03 — حفظ متریک Workspace به‌عنوان بخش جدا
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] متریک‌های محلی فعلی به بخش «وضعیت workspace» منتقل شوند و با usage report قاطی نشوند

---

### E08 — Secret Management سازمانی (P0)

#### S08.01 — Provider Abstraction برای Vault
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] interface واحد resolve/store secret
  - [x] adapter محلی برای dev حفظ شود
  - [x] adapter env برای production قابل پیکربندی

#### S08.02 — منع نشت Secret در Export/Docs/Logs
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] masking در cURL export، docs، audit، OpenAPI export
  - [x] exposeSecrets فقط با نقش elevated
  - [x] تست vault-provider + secret-scan

---

## فاز 1 — Daily Productivity

### E09 — HTTP Methods کامل در UI (P1)

#### S09.01 — فعال‌سازی PUT/PATCH/DELETE/HEAD/OPTIONS در Editor
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] `METHOD_OPTIONS` شامل تمام `ApiHttpMethod`
  - [x] ایجاد/ویرایش/اجرا برای methodهای جدید (backend از قبل پشتیبانی می‌کرد)
  - [x] import cURL با `-X PUT` و مشابه در UI درست نمایش داده می‌شود

---

### E10 — Environment Manager (P1)

#### S10.01 — CRUD Environment از UI
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] بخش مدیریت Environment فقط برای SYSTEM_ADMIN / TECH_LEAD / QA_LEAD نمایش داده شود
  - [x] DEVELOPER بتواند محیط‌های موجود را استفاده کند، اما CRUD Environment نداشته باشد
  - [x] ساخت/ویرایش/آرشیو environment (غیر از قفل productionProtected بدون نقش مجاز)
  - [x] ویرایش baseUrl، variables، defaultHeaders، secretReferences
  - [x] clone environment

#### S10.02 — Variable Inspector در Editor
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] نمایش precedence: Collection → Environment (با توضیح ترتیب کامل)
  - [x] foreshadow مقدار resolved (ماسک‌شده برای sensitive)

#### S10.03 — APIهای Environment در Backend
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] POST/PUT/DELETE environments با RBAC
  - [x] جلوگیری از حذف environment در حال استفاده بدون تأیید (`force=true`)

---

### E11 — Collection Folders و ساختار درختی (P1)

#### S11.01 — مدل Folder در Collection
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] entity یا path ساختاریافته برای folder (نه فقط prefix نام)
  - [x] request بتواند `folderId` یا `folderPath[]` پایدار داشته باشد

#### S11.02 — UI درخت Collection
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] نمایش درختی folders/requests
  - [x] ساخت/تغییرنام/حذف folder
  - [x] drag-and-drop جابجایی request بین folderها (همان سامانه/collection)

#### S11.03 — Import/Export Postman با حفظ Folder
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] import ساختار `item[]` تو در تو را حفظ کند
  - [x] export Postman همان درخت را برگرداند

---

### E12 — Runtime Matrix و Multi-Environment (P1)

#### S12.01 — ماتریس پروژه × محیط Runtime
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] برای هر پروژه بتوان profileهای Dev/Test/Pre/Prod را جدا مدیریت کرد
  - [x] developer به‌صورت پیش‌فرض فقط DEVELOPMENT (طبق policy فعلی) و ارتقا با نقش
  - [x] UI وضعیت اتصال per-profile روشن باشد

#### S12.02 — Promotion مسیر بین محیط‌ها
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] کپی/ارتقای تنظیمات غیرحساس profile از Dev به Test با review ادمین
  - [x] secretها کپی نشوند؛ باید دوباره set شوند
  - [x] audit promotion

#### S12.03 — چند Origin همزمان در پروژه
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] UI لیست originهای مجاز و profileهای provision‌شده را نشان دهد
  - [x] افزودن/ویرایش origin محیط Development توسط TECH_LEAD / SYSTEM_ADMIN، فقط داخل allowlist
  - [x] provisioning چند Origin برای سامانه فعلی، چند سامانه انتخابی، یا همه سامانه‌های در دسترس
  - [x] DEVELOPER فقط Originهای provision‌شده را انتخاب و استفاده کند
  - [x] مدیریت originهای محافظت‌شده فقط توسط SYSTEM_ADMIN

---

### E13 — Data Service First-Class Onboarding (P1)

#### S13.01 — Wizard پیکربندی Data Service
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] مراحل: base URL HTTPS → auth mode → secret → validate → enable execute
  - [x] پیام خطای 409 فعلی به checklist قابل اقدام در UI تبدیل شود
  - [x] health/smoke call اختیاری بعد از save

#### S13.02 — Templateهای Auth رایج
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] preset برای NONE / Bearer static / token endpoint هم‌origin
  - [x] validation که token URL از origin مصوب خارج نشود (رفتار فعلی حفظ)

#### S13.03 — Schema Completeness Wizard برای `NEEDS_INPUT`
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] operationهای discovery با `schemaCompleteness = NEEDS_INPUT` در لیست جدا با badge مشخص شوند
  - [x] wizard فیلدهای اجباری/نمونه payload را قبل از execute یا sync تکمیل کند
  - [x] پس از تکمیل، وضعیت به کامل/قابل اجرا ارتقا یابد و در snapshot منعکس شود
  - [x] بدون تکمیل، execute با پیام قابل اقدام block شود (نه خطای مبهم)

---

### E14 — Discovery Drift و Conflict UX (P1)

#### S14.01 — گزارش Drift بعد از Scan
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] لیست added/removed/changed/STALE قبل از sync
  - [x] فیلتر بر اساس نوع operation (ds/fr/rest)

#### S14.02 — Conflict Resolution UI کامل
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] برای هر فیلد conflict انتخاب SOURCE vs LOCAL
  - [x] apply دسته‌ای و per-item
  - [x] نتیجه sync شمارنده‌های created/updated/stale/conflict را نشان دهد

#### S14.03 — Contract Drift Scheduling (پایه)
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] امکان «مقایسه با آخرین snapshot» بدون sync اجباری
  - [x] notification به ownerهای collection در صورت removed source → STALE

---

### E21 — جستجو و DX Editor (P1)

#### S21.01 — جستجوی سراسری Workspace
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] جستجو روی requests، repository items، discovery operations
  - [x] نتیجه با deep-link به view مربوط
  - [x] احترام به scope پروژه

#### S21.02 — بهبود Editor Response/History
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] فیلتر history بر اساس status/errorCategory
  - [x] مقایسه دو execution (diff status/body خلاصه)

---

### E22 — شکستن مونولیت Frontend/Backend (P1)

#### S22.01 — تفکیک صفحات Workspace در Frontend
- **Status:** `PARTIAL` (Portal/Branding/Compliance/JIT/Mocks/Activity/Environment/Runtime جدا شدند؛ صفحه اصلی هنوز بزرگ است)
- **Acceptance Criteria:**
  - [x] بخش‌های بزرگ از OnlineApiConsolePage استخراج شوند
  - [ ] OnlineApiConsolePage کاملاً به ماژول‌های Requests / Repository / Runtime / Reports / Reviews / Users شکسته شود
  - [x] رفتار فعلی regression نداشته باشد (typecheck + phase tests)
  - [x] route داخلی `/portal` اضافه شد
  - [ ] routeهای داخلی بیشتر (`/requests`, `/runtime`, ...)

#### S22.02 — تفکیک Backend Modules
- **Status:** `PARTIAL` (phase2/3 routes + persistence + vault + zone-worker؛ فایل اصلی هنوز بزرگ)
- **Acceptance Criteria:**
  - [x] شروع جداسازی routingهای فاز ۲/۳ از مونولیت
  - [x] persistence adapter و vault provider جدا شده‌اند
  - [ ] جدا کردن کامل curl parser، execution runner، sharing، runtime
  - [x] قرارداد OpenAPI مسیرهای کلیدی به‌روز شده

---

### E23 — Test Coverage سیستمی (P0/P1)

#### S23.01 — بازگردانی/افزودن System Specهای کلیدی
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] تست HTTP واقعی: scope منفی collection/request (`system-smoke.test.cjs`)
  - [x] smoke فاز ۲/۳ برای share/checklist/runner/portal
  - [x] SSRF localhost و private destination block

#### S23.02 — ماتریس پوشش در docs
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] `docs/TEST_COVERAGE_MATRIX.md` با وضعیت واقعی این repo
  - [x] اسکریپت npm برای اجرای مجموعه‌های test

---

## فاز 2 — Quality Loop و Collaboration

### E15 — Team / Shared Workspace (P1)

#### S15.01 — Collection/Request اشتراکی داخل تیم پروژه
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] مدل visibility: PRIVATE | PROJECT_SHARED
  - [x] اعضای پروژه با نقش مجاز، shared draft را ببینند/ویرایش کنند (با concurrency/rowVersion)
  - [x] Repository همچنان مسیر انتشار رسمی بماند

#### S15.02 — Activity Feed تیمی
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] رویدادهای create/update/share/execute مهم در سطح پروژه
  - [x] فیلتر بر اساس actor

---

### E16 — Repository Lifecycle پیشرفته (P1)

#### S16.01 — Deprecation Workflow
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] ادمین/owner بتواند version را deprecate کند با reason + تاریخ مؤثر
  - [x] consumerها notification بگیرند
  - [x] UI badge منسوخ + محدودیت add-to-console اختیاری

#### S16.02 — Breaking Change Flag و Migration Note
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] هنگام version جدید، flag breaking + متن migration
  - [x] در Repository و notification نمایش داده شود

---

### E17 — Share Review غنی (P1)

#### S17.01 — Comment Thread روی Share Request
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] reviewer و owner بتوانند comment بگذارند
  - [x] return همچنان reason اجباری داشته باشد
  - [x] تاریخچه comments در جزئیات review

#### S17.02 — Checklist Review
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] چک‌لیست: docs کامل؟ secret ندارد؟ classification درست؟ consumer مشخص؟
  - [x] approve بدون تکمیل checklist (اگر اجباری باشد) ممکن نباشد

---

### E18 — Collection Runner و Regression (P1)

#### S18.01 — اجرای دسته‌ای Requests یک Collection
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] انتخاب subset یا تمام requestهای collection
  - [x] اجرای ترتیبی با توقف اختیاری روی fail
  - [x] گزارش pass/fail assertions و businessResult

#### S18.02 — ذخیره Test Run
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] تاریخچه run با environment و actor
  - [x] لینک به executionهای تکی

---

### E19 — CI Integration (P1/P2)

#### S19.01 — CLI اجرای Suite
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] فرمان CLI با service account یا token محدود
  - [x] exit code غیرصفر روی fail
  - [x] خروجی JUnit یا JSON ماشین‌خوان

#### S19.02 — Webhook نتیجه Run
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] ارسال نتیجه به URL پیکربندی‌شده
  - [x] امضای HMAC و retry محدود

---

### E20 — Scripts و Assertions پیشرفته (P1/P2)

#### S20.01 — گسترش DSL امن
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] فرمان‌های جدید مستند: مثلاً `setCookie`, `testJsonEquals`, `testStatusIn`
  - [x] بدون `eval` و بدون دسترسی به filesystem/network از script

#### S20.02 — سازگاری محدود Postman Scripts
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] زیرمجموعه `pm.environment.set` / `pm.test` در sandbox ترجمه‌پذیر یا رد با warning واضح
  - [x] import Postman اسکریپت‌های پشتیبانی‌نشده را در warnings لیست کند

#### S20.03 — JSON Schema Assertion در UI
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] editor برای تعریف/الصاق schema
  - [x] نتیجه assertion در history واضح باشد

---

### E32 — Runner Zones و جداسازی شبکه (P1)

#### S32.01 — مدل Runner Zone
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] تعریف zone (مثلاً CORP_DMZ، INTERNET_EGRESS) با محدودیت origin
  - [x] انتخاب runner در environment یا request
  - [x] UI مدیریت برای SYSTEM_ADMIN

#### S32.02 — اجرای واقعی از Zone مشخص
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] معماری حداقل: queue + zone-worker جدا + tag runnerHost/networkZone
  - [x] اگر worker در دسترس نباشد execution BLOCKED با پیام روشن
  - [x] worker جداگانهٔ شبکه‌ای (`npm run zone-worker`)

---

### E33 — Ownership و Collaboration روی Request (P1)

#### S33.01 — Transfer Ownership
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] owner بتواند مالکیت را به کاربر directory دیگر در همان پروژه منتقل کند
  - [x] audit + notification

#### S33.02 — Co-Owners
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] تا N همکار با حق edit روی ORIGINAL request
  - [x] reference همچنان non-source برای share بماند

---

## فاز 3 — Platform Product

### E24 — API Documentation Portal (P2)

#### S24.01 — Portal خواندنی برای APIهای Approved
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] صفحه/حالت read-only برای repository versions مجاز
  - [x] بدون اجرای Prod به‌صورت پیش‌فرض
  - [x] جستجو و فیلتر classification/serviceId

#### S24.02 — دسترسی نیمه‌عمومی سازمانی
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] سیاست: فقط کاربران لاگین‌شده CDE با نقش view
  - [x] لینک share فقط‌خواندنی time-boxed (`/portal/shared/:token`)

---

### E25 — OpenAPI Export از Collection/Repository (P2)

#### S25.01 — Export OpenAPI 3 از Collection
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] تولید `openapi.json` از requests یک collection
  - [x] Core operations به‌صورت path/operation منطقی یا extensionهای x-core-*
  - [x] secret در spec نباشد

#### S25.02 — Export از Repository Version
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] یک version approved قابل download به‌صورت OpenAPI
  - [x] هم‌خوانی با documentation metadata موجود

---

### E26 — DOCX/Branding قابل تنظیم (P2)

#### S26.01 — انتخاب Template از UI ادمین
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] آپلود/انتخاب template docx سازمانی
  - [x] preview با داده نمونه
  - [x] audit تغییر template

#### S26.02 — چندزبانه FA/EN
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] تولید سند با زبان انتخابی
  - [x] برچسب‌های بخش‌ها ترجمه‌شده

---

### E27 — ITSM / Ticket Integration (P2)

#### S27.01 — لینک Ticket روی Share/Version
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] فیلد استاندارد `ticketUrl` / `ticketId` روی share و version
  - [x] اعتبارسنجی URL allowlist اختیاری
  - [x] نمایش در Review و Repository

#### S27.02 — Webhook ایجاد/به‌روزرسانی Ticket (اختیاری)
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] با approve/return رویداد به سیستم تیکتینگ ارسال شود
  - [x] شکست webhook اجرای approve را rollback نکند؛ retry/queue داشته باشد

---

### E28 — Multi-Origin Control Plane (CDE+) (P2)

#### S28.01 — پیکربندی چند `CDE_CORE_BASE_URL`/Origin
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] ادمین بتواند بیش از یک control-plane origin تعریف کند (`API_CONSOLE_CDE_ORIGINS`)
  - [x] کاربر هنگام login origin را انتخاب کند
  - [x] session به origin متصل بماند

#### S28.02 — ایزوله داده بین Originها
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] projects/runtime/discovery فراخوانی‌ها با origin انتخابی اجرا شوند
  - [x] audit شامل originId باشد
  - [x] جداسازی داده با originId روی entityها + فیلتر لیست (+ SQLITE cutover)

---

### E29 — Mock / Stub Server (P2)

#### S29.01 — Mock از Manual Response / Examples
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] فعال‌سازی mock endpoint برای یک request یا collection
  - [x] پاسخ از manual example یا آخرین execution موفق
  - [x] فقط در محیط‌های غیر Production مگر با سیاست خاص

#### S29.02 — مدیریت Lifecycle Mock
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] TTL یا disable دستی
  - [x] لاگ فراخوانی‌های mock جدا از execution واقعی

---

### E30 — Contract Tests (P2)

#### S30.01 — تولید تست قرارداد از OpenAPI/Discovery
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] از snapshot discovery یا OpenAPI export، suite assertion پایه ساخته شود
  - [x] قابل اجرا با Collection Runner (E18)

#### S30.02 — شکست قرارداد در CI
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] خروجی مناسب E19 (CLI/JUnit روی collection run)
  - [x] تغییر breaking در response schema نسبت به baseline ذخیره‌شده گزارش شود

---

### E31 — Security Hardening پیشرفته (P0/P1)

#### S31.01 — Secret Scanning روی Import
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] تشخیص الگوهای token/password/cookie در cURL/Postman import
  - [x] تبدیل خودکار به secret reference یا warning blocking قابل تنظیم (`API_CONSOLE_SECRET_SCAN_MODE`)
  - [x] عدم ذخیره raw در store (warning/block قبل از persist حساس)

#### S31.02 — JIT / Time-boxed Production Access
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] درخواست دسترسی موقت execute Production
  - [x] تأیید ادمین + انقضا خودکار
  - [x] audit شروع/پایان پنجره دسترسی

#### S31.03 — Compliance Report
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] گزارش: TLS insecure استفاده شده، EXACT mode، Prod Command executions، share بدون consumer
  - [x] فیلتر بازه زمانی و export

#### S31.04 — قفل تنظیمات حساس Runtime
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] تغییر Data Service و origin محیط‌های محافظت‌شده فقط توسط SYSTEM_ADMIN
  - [x] TECH_LEAD فقط نام/origin پروفایل Development را تغییر دهد
  - [x] rowVersion conflict درست به UI برسد

---

## شکاف‌های As-Is که به Story map شده‌اند (Coverage Matrix)

| پیشنهاد / شکاف تحلیل | Epic / Stories |
| --- | --- |
| Store فایل‌محور → DB | E01 (S01.01–S01.05) |
| Secret vault سازمانی | E08 |
| Redis/session production secrets | E02 |
| RBAC ناقص / فقط SYSTEM_ADMIN UI | E03 |
| Share Review فقط Admin | S03.02، E17 |
| Trust به context header | S02.01 |
| Reports بدون usage واقعی | E07 |
| notifications بدون UI | E05 |
| auditLog بدون UI | E04 |
| runners بدون مدیریت UI | E32 |
| Environment بدون CRUD UI | E10 |
| HTTP UI فقط GET/POST | E09 |
| Data Service blocked تا config ادمین | E13 |
| Schema completeness / NEEDS_INPUT | S13.03 |
| Conflict/STALE sync UX | E14 |
| تست‌های سیستمی کم | E23 |
| مونولیت صفحه/سرور | E22 |
| Script DSL ≠ Postman کامل | E20 |
| Folder تخت در import | E11 |
| Team shared drafts | E15 |
| Deprecation / breaking | E16 |
| Comment روی review | E17 |
| Collection runner | E18 |
| CI hook | E19 |
| جستجوی سراسری | E21 |
| Portal مستندات | E24 |
| OpenAPI export | E25 |
| قالب DOCX/برند | E26 |
| ITSM | E27 |
| Multi-origin CDE | E28 |
| Mock server | E29 |
| Contract tests | E30 |
| Secret scanning / JIT Prod / compliance | E31 |
| Runner zones | E32 |
| Ownership transfer / co-owners | E33 |
| Org policy allowlist / dual approval | E06 |
| نقش‌های BA/PO/QA در عمل | E03 |
| Multi-env runtime promotion | E12 |

**نتیجه:** تمام پیشنهادات و شکاف‌های تحلیل اولیه حداقل به یک Epic و Story با معیار پذیرش نگاشت شده‌اند.

---

## ترتیب تحویل پیشنهادی (Program Increments)

### PI-0 (فاز 0)
1. E02 Session trust  
2. E03 RBAC  
3. E07 Usage Reports UI  
4. E04 Audit  
5. E05 Notifications  
6. E08 Vault abstraction (حداقل طراحی + adapter)  
7. E01 شروع schema/migrate (ممکن است PI-0 و PI-1 را پوشش دهد)  
8. E06 و S31.01/S31.03 به‌صورت موازی امنیتی  
9. E23 تست‌های حیاتی

### PI-1 (فاز 1)
1. E09 Methods  
2. E10 Environments  
3. E11 Folders  
4. E13 Data Service wizard  
5. E14 Drift UX  
6. E12 Runtime matrix  
7. E21 Search  
8. E22 شروع modularization

### PI-2 (فاز 2)
1. E15 Shared workspace  
2. E16–E17 Repository/Review  
3. E18–E20 Quality  
4. E32–E33 Ownership/Runners  
5. ادامه E01 DB cutover

### PI-3 (فاز 3)
1. E24–E30 Portal، OpenAPI، Mock، Contract، Multi-origin، ITSM، Branding

### PI Identity Expansion
1. **E34** Local Directory — ورود یوزر/پسورد برای غیر-CDE + FREE-only workspace  
2. **E35** IS Approach — پل `integrated-systems` Gateway/SSO + systems + execute

جزئیات محصولی: [`PRD.md`](./PRD.md) ، [`approaches/`](./approaches/README.md)

---

## E34 — ورود Local Directory (غیر-CDE) (P0)

**هدف:** مدیر سیستم حساب محلی بسازد؛ کاربر بدون CDE وارد شود و از قابلیت Postman-like (درخواست آزاد) استفاده کند.

#### S34.01 — مدل LocalUser + Admin CRUD
- **Status:** `TODO`
- **Acceptance Criteria:**
  - [ ] entity `LocalUser` با password hash، roles، ACTIVE/DISABLED
  - [ ] API ادمین: create/list/patch/disable/reset-password
  - [ ] audit برای همهٔ mutationها
  - [ ] مستند در `docs/approaches/02-local-directory.md`

#### S34.02 — Login محلی + Session `authApproach=LOCAL`
- **Status:** `TODO`
- **Acceptance Criteria:**
  - [ ] `POST /api/auth/local/login` با rate limit
  - [ ] session بدون الزام CDE cookie jar / project
  - [ ] Gate وب: تب ورود محلی در کنار CDE
  - [ ] تست session-trust: کاربر LOCAL نمی‌تواند خود را Admin کند

#### S34.03 — Workspace محدود به FREE
- **Status:** `TODO`
- **Acceptance Criteria:**
  - [ ] UI کشف CDE / Runtime Profiles برای LOCAL مخفی یا 403
  - [ ] `PERSONAL` + درخواست آزاد کامل (Send/Save/Import/Export)
  - [ ] Share/Review طبق RBAC نقش محلی

---

## E35 — Approach Integrated Systems (P1)

**هدف:** شناسایی و اتصال به مونورپوی `D:\AllApp\IS\integrated-systems` (Gateway + SSO `_lsr` + Spec/OpenAPI).

#### S35.01 — شناسایی معماری IS در docs
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] سند `docs/approaches/03-integrated-systems.md` با ساختار، auth، routes، نگاشت مفاهیم
  - [x] ارجاع از PRD و docs/README

#### S35.02 — Bridge نشست Gateway → Console
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] feature flag `API_CONSOLE_IS_ENABLED`
  - [x] اعتبارسنجی login/`/api/v1/sso/me` روی `API_CONSOLE_IS_GATEWAY_URL`
  - [x] directory user با `authApproach=IS` / `source: IS`
  - [x] تب ورود IS در UI

#### S35.03 — Systems + Execute از طریق Gateway
- **Status:** `DONE`
- **Acceptance Criteria:**
  - [x] لیست `is:<serviceKey>` از کاتالوگ پیش‌فرض + `API_CONSOLE_IS_SYSTEMS`
  - [x] Request آزاد با base Gateway
  - [x] تزریق خودکار Cookie `_lsr` برای URL برابر Gateway
  - [x] اجازهٔ مقصد localhost فقط برای Gateway پیکربندی‌شده
  - [ ] حداقل یک تست integration با Gateway mock (باقیمانده)

#### S35.04 — Import OpenAPI از Docs & Specs (اختیاری MVP+)
- **Status:** `TODO`
- **Acceptance Criteria:**
  - [ ] خواندن `idp-docs` openapi.json
  - [ ] ساخت Collection از operations منتخب

---

## قالب Story برای ابزارهای مدیریت کار (Jira/Azure DevOps)

کپی سریع:

```text
Title: [Sxx.yy] <عنوان>
Epic: Exx
Priority: P0|P1|P2
Status: TODO|PARTIAL|DONE
Persona: <نقش>
Value: <یک جمله چرا>
Scope In:
- ...
Scope Out:
- ...
Acceptance Criteria:
- [ ] ...
Dependencies: S.. / E..
Test Notes:
- ...
```

---

## تعریف Done مشترک (Definition of Done)

برای هر Story قبل از Done:

- [ ] API (در صورت نیاز) در OpenAPI/`/api/docs` آمده
- [ ] RBAC و scope پروژه رعایت شده
- [ ] secret/masking رعایت شده؛ audit برای action حساس ثبت شده
- [ ] UI فارسی برای سطح کاربر نهایی؛ پیام خطای قابل اقدام
- [ ] حداقل یک تست خودکار (unit یا HTTP) یا دلیل مکتوب معافیت
- [ ] docs کوتاه در `docs/ONLINE_API_CONSOLE.md` یا زیرصفحه مرتبط به‌روز شده

---

## آمار Backlog

| مورد | تعداد |
| --- | --- |
| Epics | 35 |
| Stories | 81 + E34/E35 stories |
| P0-heavy Epics | E01–E08، E23/E31، **E34** |
| Approaches docs | CDE / Local / IS — `docs/approaches/` |
| P1 Epics | E09–E22، E32–E33، … |
| P2 Epics | E24–E30 و بخشی E19/E20 |

این سند living backlog است؛ با اتمام هر Story وضعیت `TODO/PARTIAL/DONE` را در همین فایل به‌روز کنید.
