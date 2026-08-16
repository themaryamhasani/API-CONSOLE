# Online API Console Implementation

Source-verified for standalone package: API-CONSOLE

این سند از UTMS استخراج و برای پروژه مستقل `d:\AllApp\API-CONSOLE` سازگار شده است. ورود فقط از طریق CDE انجام می‌شود و وابستگی به UTMS وجود ندارد.

## Source Of Truth

- Frontend page: `apps/web/src/pages/OnlineApiConsolePage.tsx`
- Frontend API client: `apps/web/src/services/apiConsoleApi.ts`
- Shared TypeScript types: `apps/web/src/types/apiConsole.ts`
- CDE login: `apps/web/src/pages/CdeLoginPage.tsx`
- Backend service and Runner: `apps/api/src/modules/api-console/infrastructure/http/api-console-server.cjs`
- CDE bridge: `apps/api/src/modules/cde/`
- App session: `apps/api/src/modules/session/session-server.cjs`
- File-backed store: `runtime/api-console/api-console-store.json`
- Swagger UI: `http://localhost:4274/api/docs`



## Architecture

Online API Console به صورت یک module داخلی برای اجرای controlled HTTP request پیاده‌سازی شده است.

```text
Frontend
  -> apiConsoleApi.ts
  -> /api/api-console/*
  -> API Console backend
  -> policy + variable/secret resolution + SSRF/TLS/redirect controls
  -> Node http/https Runner
  -> Target API
  -> sanitized execution record
  -> Frontend response viewer
```

در development، `vite.config.ts` مسیر `/api` را به `http://localhost:4174` proxy می‌کند. backend با `npm run backend` اجرا می‌شود و frontend با `npm run dev`.

این module Gateway یا Data Service موجود را تغییر نمی‌دهد. اگر یک Core request اجرا شود، دقیقا همان HTTP endpoint فعلی Core صدا زده می‌شود و semantic classification فقط برای UI، validation، risk policy و documentation استفاده می‌شود.

## Runbook

```bash
npm install
npm run backend
npm run dev
npm run backend:self-check
npm run build
```

در PowerShell می‌توان از `npm.cmd` استفاده کرد:

```powershell
npm.cmd run backend
npm.cmd run dev
npm.cmd run backend:self-check
npm.cmd run build
```

Backend default روی port `4174` بالا می‌آید. متغیرهای قابل تنظیم:

- `API_CONSOLE_PORT`
- `API_CONSOLE_DATA_DIR`
- `API_CONSOLE_STORE_FILE`
- `API_CONSOLE_SECRET_VAULT_FILE`
- `API_CONSOLE_SECRET_KEY_FILE`
- `API_CONSOLE_SECRET_KEY`
- `API_CONSOLE_DOCX_TEMPLATE_FILE`
- `API_CONSOLE_MAX_REQUEST_BODY`
- `API_CONSOLE_MAX_RESPONSE_BODY`
- `API_CONSOLE_MAX_REDIRECTS`
- `API_CONSOLE_CONNECT_TIMEOUT_MS`
- `API_CONSOLE_READ_TIMEOUT_MS`
- `API_CONSOLE_TOTAL_TIMEOUT_MS`
- `VITE_API_CONSOLE_BASE_URL`

## UI Behavior

صفحه Online API Console ابتدا list view را نمایش می‌دهد:

- compact filter section برای جستجو، Collection، classification و status
- actionهای سمت راست شامل `Collection جدید`، `Import cURL` و `Request جدید`
- table requestها با actionهای open/edit، soft delete، documentation preview و final documentation
- data per user ذخیره و list می‌شود؛ backend بر اساس `createdBy` و `ownerId` دسترسی را محدود می‌کند

وقتی کاربر `Request جدید` یا `Import cURL` را انتخاب می‌کند، وارد editor می‌شود. editor شامل این tabها است:

- `Query Parameters`
- `Headers`
- `Cookies`
- `Body`
- `Authentication`
- `Core Details`
- `Scripts`
- `Settings`
- `Assertions`
- `Generated cURL`
- `Execution History`

`Settings` فقط برای role `SYSTEM_ADMIN` نمایش داده می‌شود. برای سایر roleها tab تنظیمات general قابل مشاهده نیست.

Response viewer برای JSON responseها pretty formatting، line number، line count، max-height scroll، compact/expand و zoom in/out دارد. برای loadingهای طولانی از `MinimalLoader` و `LoadingState` استفاده می‌شود تا table، detail panel و buttonها حالت در حال پردازش داشته باشند.

## Sharing, Repository And Review

برای انتشار یک Request در Repository، owner از action `اشتراک` استفاده می‌کند. Backend یک `ApiShareRequest` با snapshot کامل از Request، documentation preview، generated cURL، execution evidence و manual response evidence می‌سازد. snapshot immutable است و مدیرسیستم همان محتوای submit شده را review می‌کند.

Workflow اصلی:

- Owner روی Request اصلی `POST /requests/{id}/share` می‌زند.
- مدیرسیستم در tab `تأیید اشتراک API` درخواست‌های `PENDING_REVIEW` را می‌بیند.
- مدیرسیستم باید حداقل یک Consumer از نوع `USER` یا `ROLE` انتخاب کند.
- Approve توسط مدیرسیستم باعث انتشار version در Repository و ساخت access list از دولوپرهای همگام‌شده CDE می‌شود.
- Return دلیل اجباری دارد و Request را به owner برمی‌گرداند.
- Consumer در tab `Repository APIها` نسخه‌های مجاز را می‌بیند.
- `استفاده از API` یک Reference واقعی داخل Online API Console کاربر می‌سازد.
- Reference قابل execute است، اما به عنوان source اصلی share نمی‌شود.

Versioning با Semantic Versioning کنترل می‌شود. `Version جدید` فقط برای Request اصلی فعال است و version جدید باید از version قبلی بزرگ‌تر باشد. هر version مستقل review و approve می‌شود.

Usage telemetry برای این eventها ثبت می‌شود:

- `ADDED_TO_CONSOLE`
- `API_OPENED`
- `API_EXECUTED`
- `REMOVED_FROM_CONSOLE`
- `NEW_VERSION_VIEWED`

گزارش مصرف API از route واقعی `GET /api/api-console/reports/api-usage` خوانده می‌شود و در صفحه Reports با عنوان `گزارش مصرف APIها` نمایش داده می‌شود.

## Collections And Requests

کاربر می‌تواند مانند Postman یک Collection بسازد و Requestها را داخل آن نگه دارد. هر Collection هنگام ساخت یا Import از Postman باید به یک سامانه واقعی و صریح در Context فعال متصل شود؛ `ALL`، مقدار خالی و شناسه ترکیبی معتبر نیستند.

سامانه Request از Collection والد مشتق می‌شود و پس از ایجاد قابل تغییر نیست. در نتیجه:

- ساخت Request جدید و Import از cURL بدون انتخاب Collection مجاز نیست.
- Import مجموعه Postman ابتدا سامانه را می‌گیرد و Collection و تمام Requestهای Importشده را به همان سامانه متصل می‌کند.
- انتقال Request به Collection سامانه دیگر و ارسال `applicationId` ناسازگار با Collection رد می‌شود.
- نام Collectionها در selectorها همراه نام سامانه نمایش داده می‌شود تا مجموعه‌های هم‌نام در دو سامانه اشتباه نشوند.

Request definition شامل این بخش‌ها است:

- applicationId مشتق‌شده از Collection
- name و description
- method و urlTemplate
- queryParameters
- headers
- cookies
- bodyType و bodyTemplate
- authentication
- tls
- executionMode
- classification
- environmentId
- assertions
- scripts
- documentation metadata
- version و status
- originalImportedCurl

Soft delete با `DELETE /api/api-console/requests/{id}` انجام می‌شود و رکورد را حذف فیزیکی نمی‌کند؛ فقط `status = ARCHIVED` می‌شود.

## cURL Import

Importer هیچ‌وقت pasted cURL را با shell، command prompt، PowerShell، `eval` یا child process اجرا نمی‌کند. متن cURL به tokenهای structured parse می‌شود.

Dialectهای پشتیبانی‌شده:

- Bash / Linux / macOS style
- Windows CMD با caret escaping مثل `^"`, `^%`, `^$`, `^^`
- PowerShell style
- Chrome یا Edge `Copy as cURL`

گزینه‌های پشتیبانی‌شده:

- URL positional یا `--url`
- `-X` و `--request`
- `-H` و `--header`
- `-b` و `--cookie`
- `--data`, `--data-raw`, `--data-binary`, `--data-ascii`, `--data-urlencode`
- `-F` و `--form`
- `--location` و `-L`
- `--insecure` و `-k`

Method resolution:

- explicit `-X` یا `--request` اولویت اول دارد
- data optionها method را به `POST` تبدیل می‌کنند
- بدون method و body، method برابر `GET` است

Import preview این اطلاعات را برمی‌گرداند:

- detected dialect
- effective method
- URL
- header count
- cookie count
- body type
- JSON validity
- TLS verification state
- classification
- warnings
- unsupported options

## Normalized Request Model

Normalized model در `apps/web/src/types/apiConsole.ts` تعریف شده و backend نیز همین shape را تولید یا مصرف می‌کند:

```ts
type NormalizedApiRequest = {
  method: ApiHttpMethod;
  url: string;
  queryParameters: ApiKeyValueParameter[];
  headers: ApiRequestHeader[];
  cookies: ApiRequestCookie[];
  body: ApiRequestBody;
  authentication: ApiRequestAuthentication;
  tls: ApiTlsSettings;
  executionMode: 'RECOMMENDED' | 'EXACT';
  classification: ApiClassification;
};
```

HTTP method type برای آینده extensible است، ولی UI و acceptance فعلی روی `GET` و `POST` تمرکز دارد.

## Core Awareness

Core classification فقط از روی endpoint و JSON body انجام می‌شود، نه فقط از روی HTTP method.

`CORE_COMMAND` وقتی تشخیص داده می‌شود که:

- URL با `/core-api/v1/data-provider/store-form-data` تمام شود
- JSON body شامل `serviceId`, `formId`, `data` باشد

`CORE_QUERY` وقتی تشخیص داده می‌شود که:

- URL با `/core-api/v1/data-provider/get-data-source` تمام شود
- JSON body شامل `serviceId`, `key`, `params` باشد

در غیر این صورت request به عنوان `GENERIC_HTTP` باقی می‌ماند. Core Query همچنان HTTP `POST` است و به HTTP `GET` تبدیل نمی‌شود.

Core Details tab همان `bodyTemplate` را ویرایش می‌کند. یعنی تغییر `formId`، `key`، `data` یا `params` در Core Details روی raw JSON هم اثر می‌گذارد و دو copy جداگانه از body وجود ندارد.

## Headers, Cookies And Secrets

Headerها به categoryهای زیر تقسیم می‌شوند:

- `USER_BUSINESS`
- `BROWSER_GENERATED`
- `TRANSPORT_GENERATED`
- `AUTHENTICATION`
- `ENVIRONMENT`

در `RECOMMENDED` mode:

- business، authentication و environment headerها enabled می‌مانند
- browser-generated headerها visible ولی معمولا disabled هستند
- transport-generated headerهایی مثل `Content-Length`, `Host`, `Connection`, `Accept-Encoding` توسط Runner مدیریت می‌شوند
- `Content-Length` دوباره محاسبه می‌شود

در `EXACT` mode:

- backend تلاش می‌کند همه headerهای technically valid را نگه دارد
- headerهایی که transport library اجازه ارسال exact آن‌ها را نمی‌دهد با `omittedHeaders` و replay note توضیح داده می‌شوند

Cookieها از `Cookie` header یا `-b/--cookie` جداگانه parse می‌شوند. هر cookie رکورد مستقل دارد:

- name
- valueReference
- enabled
- sensitive
- maskedValue
- domain/path/expiresAt در صورت وجود
- temporary flag

Sensitive valueها در request store به صورت raw ذخیره نمی‌شوند و به `secret://api-console/*` reference تبدیل می‌شوند. local development از AES-256-GCM encrypted vault استفاده می‌کند. export cURL و documentation به صورت default secretها را mask می‌کنند.

## Authentication

Typeهای پشتیبانی‌شده در model:

- `none`
- `bearer`
- `basic`
- `api-key`
- `cookie-session`
- `custom-headers`
- `environment-secret`

مقدار credential نباید hard-code شود. Saved requestها باید از variable یا secret reference مثل `{{token}}`, `{{clientId}}`, `{{sessionCookie}}` یا `secret://api-console/*` استفاده کنند.

## Environments And Variables

Backend هنگام initialize، environmentهای پایه را می‌سازد:

- Development
- Test
- Pre-production
- Production

Variable precedence در execution:

```text
Execution
-> Request
-> Collection
-> Environment
-> Global
```

Environment profileها شامل `baseUrl`، variableها، default headerها و secret referenceها هستند. Production environment با `productionProtected` مشخص می‌شود.

## Execution And Network Safety

Requestها از browser مستقیم اجرا نمی‌شوند. Execution از route زیر انجام می‌شود:

```text
POST /api/api-console/requests/{id}/execute
```

Execution service این کارها را انجام می‌دهد:

- RBAC check
- request ownership check
- environment و variable resolution
- secret reference resolution
- Core validation
- pre-request script execution
- destination validation
- DNS validation
- redirect validation
- timeout و max response size enforcement
- controlled Node http/https request
- response capture
- post-response script execution
- assertion evaluation
- sanitized execution persistence

SSRF protection شامل این موارد است:

- فقط `http` و `https` مجاز است
- localhost و loopback block می‌شود
- private/internal IP range block می‌شود
- cloud metadata endpoint مثل `169.254.169.254` block می‌شود
- DNS lookup validate می‌شود
- redirect destination دوباره validate می‌شود
- redirect count محدود است

برای APIهای داخلی که DNS آن‌ها به RFC1918 یا IPv6 ULA resolve می‌شود، origin دقیق باید در
`API_CONSOLE_PRIVATE_DESTINATION_ALLOWLIST` ثبت شود. چند origin با ویرگول جدا می‌شوند؛ برای مثال:

```dotenv
API_CONSOLE_PRIVATE_DESTINATION_ALLOWLIST=https://internal-api.example.ir,https://10.20.30.40:8443
```

این allowlist فقط همان protocol، hostname و port را مجاز می‌کند و wildcard ندارد. مقصدهای
localhost، loopback، link-local، carrier-grade NAT، multicast و cloud metadata حتی با وجود
entry در allowlist مسدود می‌مانند. مقصد هر redirect نیز مستقل بررسی می‌شود.

در محیط development می‌توان برای اجرای APIهای همه‌ی شبکه‌های خصوصی سازمانی از تنظیم زیر
استفاده کرد:

```dotenv
API_CONSOLE_ALLOW_PRIVATE_DESTINATIONS=true
```

این گزینه در `NODE_ENV=production` نادیده گرفته می‌شود. محدودیت‌های localhost، loopback،
link-local، carrier-grade NAT، multicast و cloud metadata در development نیز حذف نمی‌شوند.

اگر certificate با hostname match نباشد، error category برابر `TLS_ERROR` است. `--insecure` یا `tls.verifyCertificate=false` فقط وقتی مجاز است که policy اجازه بدهد؛ Production به صورت default restricted است.

## Scripts

Online API Console یک safe script DSL دارد. این runtime، JavaScript/Postman sandbox کامل نیست و `eval` یا arbitrary code اجرا نمی‌کند.

Pre-request commandها:

```text
setVar("name", "value")
setHeader("name", "value")
setQuery("name", "value")
setJsonBody("$.path.to.field", "value")
```

Post-response commandها:

```text
testStatus(200)
testResponseTimeBelow(5000)
testHeaderContains("content-type", "json")
testJsonPath("$.data.id")
testBodyContains("success")
```

Pre-request script فقط execution copy را mutate می‌کند و saved request را تغییر نمی‌دهد. Post-response script بعد از دریافت response اجرا می‌شود و نتیجه آن به `scriptResults` و `businessResult` اضافه می‌شود.

## Assertions

Saved assertionها در `ApiRequestAssertion` نگهداری می‌شوند و در execution به `assertionResults` تبدیل می‌شوند. Typeهای فعلی:

- `EXPECTED_HTTP_STATUS`
- `MAX_RESPONSE_TIME`
- `EXPECTED_CONTENT_TYPE`
- `REQUIRED_JSON_PATH`
- `HEADER_VALUE`
- `BUSINESS_EXPRESSION`
- `JSON_SCHEMA`

Transport success و business success جدا هستند. HTTP 200 به تنهایی business success محسوب نمی‌شود.

## Response Viewer And Execution History

Execution record شامل این اطلاعات است:

- status و statusCode
- statusText
- response headers
- response cookies
- bodyPreview یا bodyReference
- contentType
- responseSize
- durationMs
- resolvedIpAddress
- redirectHistory
- tlsVerified
- safePreviewMode
- runnerId
- environmentId
- correlationId
- errorCategory
- sanitizedError
- assertionResults
- scriptResults
- evidenceType

Large responseها با max response size کنترل می‌شوند. HTML response نباید مستقیم در DOM اصلی render شود؛ UI باید آن را safe preview یا downloadable evidence در نظر بگیرد.

## Manual Response Mode

اگر target API از network در دسترس نباشد، کاربر می‌تواند manual response ثبت کند. این record با execution واقعی یکی نیست و `evidenceType` آن از actual execution جدا نگه داشته می‌شود.

Manual response شامل:

- statusCode
- headers
- body
- claimedEnvironmentId
- source
- reason
- enteredBy
- enteredAt
- reviewStatus

Documentation مشخص می‌کند response example از actual execution آمده یا manual example است.

## Documentation Generation

دو مسیر عملیاتی وجود دارد:

- `POST /api/api-console/requests/{id}/documentation/preview`
- `POST /api/api-console/requests/{id}/documentation/final`

Preview خروجی markdown می‌دهد و در modal نمایش داده می‌شود.

Final documentation علاوه بر markdown، فایل Word با فرمت `.docx` تولید می‌کند:

- backend template را از `apps/api/src/modules/api-console/infrastructure/templates/api-console-document-template.docx` می‌خواند
- مسیر template با `API_CONSOLE_DOCX_TEMPLATE_FILE` قابل override است
- generator بدون dependency جدید، DOCX ZIP را parse و `word/document.xml` را با محتوای تولیدشده جایگزین می‌کند
- style، media، header/footer و package structure template حفظ می‌شود
- frontend مقدار `wordDocumentBase64` را دانلود می‌کند

DOCX نهایی شامل این بخش‌ها است:

- cover/title
- فهرست مطالب ساده
- مقدمه
- مشخصات service
- transport information
- Core semantic information در صورت Core request
- ورودی‌ها
- نمونه body
- خروجی‌ها
- response example
- sample cURL
- نمونه تست و post-response script
- ملاحظات security

Secretها، tokenها، session cookieها، passwordها، client-secretها، api-keyها و مقدارهای sensitive در documentation نهایی درج نمی‌شوند.

## API Contract

- `GET /api/api-console/health`
- `GET /api/api-console/policy`
- `GET /api/api-console/environments`
- `GET /api/api-console/runners`
- `GET /api/api-console/self-check`
- `POST /api/api-console/validate-core`
- `GET /api/api-console/collections`
- `POST /api/api-console/collections`
- `POST /api/api-console/curl/parse`
- `GET /api/api-console/requests`
- `POST /api/api-console/requests`
- `POST /api/api-console/requests/blank`
- `GET /api/api-console/requests/{id}`
- `PUT /api/api-console/requests/{id}`
- `DELETE /api/api-console/requests/{id}`
- `POST /api/api-console/requests/{id}/execute`
- `GET /api/api-console/requests/{id}/executions`
- `POST /api/api-console/requests/{id}/export-curl`
- `POST /api/api-console/requests/{id}/validate-core`
- `GET /api/api-console/requests/{id}/effective-request`
- `GET /api/api-console/requests/{id}/manual-responses`
- `POST /api/api-console/requests/{id}/manual-responses`
- `POST /api/api-console/requests/{id}/documentation/preview`
- `POST /api/api-console/requests/{id}/documentation/final`
- `POST /api/api-console/requests/{id}/share`
- `POST /api/api-console/requests/{id}/versions`
- `GET /api/api-console/consumer-candidates`
- `GET /api/api-console/share-reviews`
- `GET /api/api-console/share-reviews/{id}`
- `POST /api/api-console/share-reviews/{id}/approve`
- `POST /api/api-console/share-reviews/{id}/return`
- `GET /api/api-console/admin/users`
- `PUT /api/api-console/admin/users/{id}/system-admin`
- `GET /api/api-console/repository`
- `GET /api/api-console/repository/{apiId}/versions`
- `GET /api/api-console/repository/{apiId}/versions/{version}`
- `POST /api/api-console/repository/{apiId}/versions/{version}/add-to-console`
- `POST /api/api-console/repository/{apiId}/versions/{version}/mark-viewed`
- `GET /api/api-console/references`
- `DELETE /api/api-console/references/{id}`
- `PUT /api/api-console/shared-apis/{apiId}/versions/{version}/consumers`
- `GET /api/api-console/reports/api-usage`
- `GET /api/reports/api-usage`
- `GET /api/api-console/executions/{id}`
- `POST /api/api-console/executions/{id}/cancel`

Frontend context از طریق header زیر به backend داده می‌شود:

```text
x-utms-context: base64(JSON.stringify(activeContext))
```

Backend توسعه‌ای علاوه بر مالکیت کاربر، `scopeApplicationIds` را برای list، read و mutation اعمال می‌کند:

| وضعیت | نتیجه HTTP |
| --- | --- |
| Collection بدون سامانه واقعی | `422 CORE_VALIDATION_ERROR` |
| سامانه Collection خارج از Context | `403 AUTHENTICATION_ERROR` |
| Request با سامانه متفاوت از Collection | `422 CORE_VALIDATION_ERROR` |
| انتقال Request بین Collectionهای دو سامانه | `422 CORE_VALIDATION_ERROR` |
| list خارج از Scope | رکورد بیرون Scope فیلتر می‌شود |
| دسترسی مستقیم یا mutation خارج از Context | `403 AUTHENTICATION_ERROR` |

`x-utms-context` فقط adapter توسعه‌ای این checkout است. در production باید با auth middleware و session/JWT امضاشده جایگزین شود و payload ارسالی مرورگر به‌تنهایی منبع اعتماد نباشد.

## RBAC

Policy در backend و frontend هماهنگ است:

- `canView`: `SYSTEM_ADMIN`, `QA_LEAD`, `QA_SPECIALIST`, `BA`, `SECURITY_REVIEWER`, `TECH_LEAD`, `PRODUCT_OWNER`, `DEVELOPER`
- `canCreate`: `SYSTEM_ADMIN`, `QA_LEAD`, `QA_SPECIALIST`, `BA`, `TECH_LEAD`, `DEVELOPER`
- `canEdit`: `SYSTEM_ADMIN`, `QA_LEAD`, `QA_SPECIALIST`, `BA`, `TECH_LEAD`, `DEVELOPER`
- `canExecute`: `SYSTEM_ADMIN`, `QA_LEAD`, `QA_SPECIALIST`, `SECURITY_REVIEWER`, `TECH_LEAD`, `DEVELOPER`
- `canExecuteProduction`: `SYSTEM_ADMIN`, `TECH_LEAD`, `QA_LEAD`
- `canExecuteCommand`: `SYSTEM_ADMIN`, `QA_LEAD`, `TECH_LEAD`
- `canExecuteProductionCommand`: `SYSTEM_ADMIN`, `TECH_LEAD`
- `canDelete`: همه roleهای Online API Console بالا
- `canGenerateDocumentation`: همه roleهای Online API Console بالا

`SYSTEM_ADMIN` implicit access دارد. Production Core Command نیاز به elevated permission و confirmation دارد.

## Persistence

Local backend از file-backed persistence استفاده می‌کند:

```text
runtime/api-console/api-console-store.json
```

Store sections:

- `collections`
- `requests`
- `executions`
- `importedCurls`
- `manualExamples`
- `documentationResults`
- `shareRequests`
- `consumers`
- `references`
- `usageEvents`
- `readReceipts`
- `notifications`
- `directoryUsers`
- `directoryRoleAssignments`
- `environments`
- `runners`
- `auditLog`

Prisma schema اکنون tableهای متناظر API Console را تعریف می‌کند، اما runtime این module هنوز به آنها route نشده است. برای production همین structure باید از طریق repositoryهای واقعی به tableهای Prisma map شود، از جمله:

- `ApiCollection`
- `ApiRequestDefinition`
- `ApiRequestHeader`
- `ApiRequestCookie`
- `ApiRequestAssertion`
- `ApiRequestExecution`
- `ImportedCurl`
- `ApiManualResponseExample`
- `ApiShareRequest`
- `ApiVersionConsumer`
- `ApiConsoleReference`
- `ApiUsageEvent`
- `ApiReadReceipt`
- `Notification`

Response bodyهای بزرگ نباید مستقیم در relational column ذخیره شوند و باید به object/file storage منتقل شوند.

## Audit And Logging

Backend برای actionهای اصلی audit record می‌سازد، از جمله:

- cURL import
- request create/update/archive
- request execution
- manual response add
- documentation preview/final
- secret reference usage
- TLS verification disabled
- share submit/resubmit
- share approve/return
- version create
- repository reference add/remove
- new version viewed
- consumers update

Audit payload نباید raw secret داشته باشد. Sensitive patternها توسط `sanitizeText` و masking logic حذف یا mask می‌شوند.

## Error Categories

Error categoryهای پشتیبانی‌شده در type و backend:

- `CURL_PARSE_ERROR`
- `INVALID_URL`
- `UNSUPPORTED_CURL_OPTION`
- `VARIABLE_RESOLUTION_ERROR`
- `SECRET_RESOLUTION_ERROR`
- `AUTHENTICATION_ERROR`
- `DNS_ERROR`
- `TLS_ERROR`
- `CONNECTION_TIMEOUT`
- `READ_TIMEOUT`
- `RESPONSE_TOO_LARGE`
- `REDIRECT_BLOCKED`
- `DESTINATION_NOT_ALLOWED`
- `CORE_VALIDATION_ERROR`
- `HTTP_ERROR`
- `EXECUTION_CANCELLED`
- `INTERNAL_EXECUTION_ERROR`

Frontend errorها را به شکل safe و actionable نمایش می‌دهد و stack trace یا raw secret نشان داده نمی‌شود.

## Test Coverage

`npm run backend:self-check` self-check backend را اجرا می‌کند. موارد پوشش‌داده‌شده در source فعلی:

- Bash GET cURL import
- Wrapped Bash cURL import
- Bash POST JSON import
- Windows CMD caret escaping
- PowerShell import
- `--data-raw` method inference
- explicit `-X` priority
- `--insecure`
- `--location`
- Core Command detection
- Core Query detection
- Generic POST classification
- Generic GET classification
- secret masking
- secret vault persistence
- TLS error categorization
- Pre-request script mutation
- Post-response script tests
- template DOCX generation
- SSRF localhost protection
- Bash cURL export

تست `UTMS-API-SCOPE-003` در `tests/system/api-console.system.spec.ts` با HTTP واقعی دو مسیر منفی را بررسی می‌کند: ساخت Collection خارج از Scope و جعل سامانه Request نسبت به Collection. تست‌های `UTMS-API-SYS-001/002` نیز جریان ماندگاری UI/API، export و archive را پوشش می‌دهند. وضعیت اجرای جاری در [ماتریس پوشش تست](../testing/TEST_COVERAGE_MATRIX.md) ثبت می‌شود.

`npm run build` frontend TypeScript و production bundle را verify می‌کند.

برای workflow اشتراک و Repository یک smoke test ایزوله با `API_CONSOLE_DATA_DIR` موقت اجرا شد که این مسیرها را با HTTP واقعی validate کرد:

```text
create collection
create blank request
submit share request
QA approve with consumer
read repository as consumer
add-to-console
mark-viewed
read api-usage report
```

## Rollout Notes

- در development، `runtime/api-console/*` runtime data است و نباید به عنوان production DB در نظر گرفته شود.
- `apps/api/src/modules/api-console/infrastructure/templates/api-console-document-template.docx` باید همراه backend deploy شود یا مسیر آن با `API_CONSOLE_DOCX_TEMPLATE_FILE` تنظیم شود.
- برای production، `x-utms-context` باید با session/JWT/auth middleware واقعی validate شود.
- Network allowlist و Runner zoneها باید بر اساس سیاست سازمان تکمیل شوند.
- Secret vault فعلی local adapter است؛ production باید از secret-management رسمی استفاده کند.
- Gateway و Data Service برای این feature تغییر نکرده‌اند.

## Assumptions

- repo دارای Prisma schema، migration و PostgreSQL است، اما Online API Console هنوز repository PostgreSQL ندارد و از file-backed adapter استفاده می‌کند.
- auth فعلی frontend بر اساس active context داخلی است؛ backend برای development همان context را از header می‌خواند.
- Postman-compatible script engine کامل پیاده‌سازی نشده است؛ به جای آن safe DSL برای pre-request و post-response test وجود دارد.
- DOCX generator برای حفظ template فعلی بدون dependency جدید پیاده‌سازی شده است.
