# Store mapping — JSON keys → SQLite tables

1:1 mapping for `runtime/api-console/api-console-store.json` (E01 / S01.01).

Runtime source of truth in SQLITE mode is `store_blob` (`id = 'main'`). Entity tables are a projected reporting/query layer rebuilt on each save/migrate.

## Blob

| JSON | Table | Notes |
| --- | --- | --- |
| *(entire store object)* | `store_blob` | `payload_json` holds the full document; `version` mirrored |

## Arrays / objects

| JSON key | Table | Indexed / projected columns | Nested JSON columns |
| --- | --- | --- | --- |
| `collections` | `collections` | `application_id`, `name`, `owner_id`, `status`, `visibility`, `origin_id` | `variables_json`, `payload_json` |
| `requests` | `requests` | `collection_id`, `api_id`, `method`, `sharing_status`, `origin_id` | `headers_json`, `cookies_json`, `assertions_json`, `scripts_json`, `documentation_json`, `payload_json` |
| `executions` | `executions` | `operation_id`, `status`, `status_code`, `origin_id` | `response_json`, `transport_result_json`, `payload_json` |
| `importedCurls` | `imported_curls` | `request_id`, `application_id`, `origin_id` | `payload_json` |
| `manualExamples` | `manual_examples` | `request_id`, `application_id`, `origin_id` | `payload_json` |
| `documentationResults` | `documentation_results` | `request_id`, `generated_at`, `origin_id` | `payload_json` (markdown/docx live here) |
| `shareRequests` | `share_requests` | `request_id`, `status`, `origin_id` | `payload_json` |
| `consumers` | `consumers` | `api_id`, `version`, `application_id`, `origin_id` | `payload_json` |
| `references` | `references` | `request_id`, `api_id`, `origin_id` | `payload_json` |
| `usageEvents` | `usage_events` | `event_type`, `user_id`, `application_id`, `api_id`, `origin_id` | `payload_json` |
| `readReceipts` | `read_receipts` | `user_id`, `api_id`, `version`, `origin_id` | `payload_json` |
| `notifications` | `notifications` | `user_id`, `type`, `origin_id` | `payload_json` |
| `directoryUsers` | `directory_users` | `full_name`, `is_active`, `origin_id` | `payload_json` |
| `directoryRoleAssignments` | `directory_role_assignments` | `user_id`, `role`, `application_id`, `origin_id` | `payload_json` |
| `environments` | `environments` | `name`, `kind`, `base_url`, `origin_id` | `variables_json`, `default_headers_json`, `secret_references_json`, `payload_json` |
| `runners` | `runners` | `network_zone`, `enabled`, `origin_id` | `allowed_origin_patterns_json`, `payload_json` |
| `globalVariables` | `global_variables` | `key`, `scope`, `origin_id` | `payload_json` |
| `auditLog` | `audit_log` | `event_type`, `actor_user_id`, `created_at`, `origin_id` | `details_json`, `payload_json` |
| `runtimeProfiles` | `runtime_profiles` | `application_id`, `kind`, `origin`, `enabled`, `origin_id` | `data_service_json`, `payload_json` |
| `discoverySnapshots` | `discovery_snapshots` | `project_key`, `status`, `origin_id` | `operations_json`, `stats_json`, `payload_json` |
| `testRuns` | `test_runs` | `application_id`, `collection_id`, `status`, `origin_id` | `results_json`, `payload_json` |
| `mocks` | `mocks` | `application_id`, `method`, `path_pattern`, `status`, `origin_id` | `payload_json` |
| `mockCallLogs` | `mock_call_logs` | `mock_id`, `application_id`, `origin_id` | `payload_json` |
| `jitAccessGrants` | `jit_access_grants` | `user_id`, `role`, `status`, `expires_at`, `origin_id` | `payload_json` |
| `branding` | `branding_meta` | `active_template_id`, `origin_id` (`id='main'`) | `templates_json`, `payload_json` |
| `contractBaselines` | `contract_baselines` | `application_id`, `collection_id`, `version`, `origin_id` | `spec_json`, `payload_json` |
| `portalShareTokens` | `portal_share_tokens` | `application_id`, `request_id`, `expires_at`, `origin_id` | `payload_json` |
| `orgPolicies` | `org_policies` | `policy_key`, `scope`, `origin_id` | `payload_json` (array or single object → `id='main'`) |
| `dualApprovals` | `dual_approvals` | `request_id`, `user_id`, `status`, `origin_id` | `payload_json` |
| `itsmWebhookQueue` | `itsm_webhook_queue` | `status`, `origin_id` | `payload_json` |
| `version` | `store_blob.version` | scalar on blob row | — |

## Multi-origin

Every entity table includes `origin_id TEXT` for multi-origin isolation. Values are taken from `originId` / `cdeOriginId` on the JSON row when present; otherwise `NULL` (legacy single-origin data).

## Headers / cookies / assertions

Not separate tables in this foundation. They remain nested under `requests` and are duplicated into `headers_json` / `cookies_json` / `assertions_json` for reporting without changing the in-memory request shape.
