-- API Console persistence schema (SQLite)
-- E01 / S01.01 — entity tables + blob for in-memory store round-trip.
-- Complex nested fields use JSON TEXT columns. origin_id isolates multi-origin data.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS store_blob (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 2,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  application_id TEXT,
  workspace_name TEXT,
  name TEXT,
  owner_id TEXT,
  status TEXT,
  visibility TEXT,
  variables_json TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collections_origin ON collections(origin_id);
CREATE INDEX IF NOT EXISTS idx_collections_app ON collections(application_id);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  collection_id TEXT,
  application_id TEXT,
  api_id TEXT,
  semantic_version TEXT,
  name TEXT,
  method TEXT,
  url_template TEXT,
  sharing_status TEXT,
  visibility TEXT,
  owner_id TEXT,
  environment_id TEXT,
  runner_id TEXT,
  headers_json TEXT,
  cookies_json TEXT,
  assertions_json TEXT,
  scripts_json TEXT,
  documentation_json TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_origin ON requests(origin_id);
CREATE INDEX IF NOT EXISTS idx_requests_collection ON requests(collection_id);
CREATE INDEX IF NOT EXISTS idx_requests_api ON requests(api_id);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  operation_id TEXT,
  application_id TEXT,
  runtime_profile_id TEXT,
  source_kind TEXT,
  executed_by TEXT,
  status TEXT,
  status_code INTEGER,
  response_size INTEGER,
  correlation_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  response_json TEXT,
  transport_result_json TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_executions_origin ON executions(origin_id);
CREATE INDEX IF NOT EXISTS idx_executions_operation ON executions(operation_id);

CREATE TABLE IF NOT EXISTS imported_curls (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  request_id TEXT,
  application_id TEXT,
  created_by TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_examples (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  request_id TEXT,
  application_id TEXT,
  created_by TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documentation_results (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  request_id TEXT,
  generated_by TEXT,
  generated_at TEXT,
  approved INTEGER,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_requests (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  request_id TEXT,
  application_id TEXT,
  status TEXT,
  submitted_by TEXT,
  reviewed_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_requests_status ON share_requests(status);

CREATE TABLE IF NOT EXISTS consumers (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  api_id TEXT,
  version TEXT,
  application_id TEXT,
  consumer_application_id TEXT,
  user_id TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "references" (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  request_id TEXT,
  api_id TEXT,
  application_id TEXT,
  referenced_by TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  event_type TEXT,
  user_id TEXT,
  application_id TEXT,
  api_id TEXT,
  version TEXT,
  event_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_events_app ON usage_events(application_id);

CREATE TABLE IF NOT EXISTS read_receipts (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  user_id TEXT,
  api_id TEXT,
  version TEXT,
  read_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  user_id TEXT,
  type TEXT,
  read_at TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS directory_users (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  full_name TEXT,
  phone_number TEXT,
  is_active INTEGER,
  source TEXT,
  created_at TEXT,
  updated_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directory_role_assignments (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  user_id TEXT,
  role TEXT,
  application_id TEXT,
  is_active INTEGER,
  created_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_directory_roles_user ON directory_role_assignments(user_id);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  name TEXT,
  kind TEXT,
  base_url TEXT,
  archived INTEGER,
  production_protected INTEGER,
  variables_json TEXT,
  default_headers_json TEXT,
  secret_references_json TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS runners (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  name TEXT,
  network_zone TEXT,
  enabled INTEGER,
  allowed_origin_patterns_json TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS global_variables (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  key TEXT,
  scope TEXT,
  sensitive INTEGER,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  event_type TEXT,
  actor_user_id TEXT,
  actor_role TEXT,
  details_json TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_origin ON audit_log(origin_id);

CREATE TABLE IF NOT EXISTS runtime_profiles (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  application_id TEXT,
  project_key TEXT,
  name TEXT,
  kind TEXT,
  origin TEXT,
  enabled INTEGER,
  row_version TEXT,
  data_service_json TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runtime_profiles_app ON runtime_profiles(application_id);

CREATE TABLE IF NOT EXISTS discovery_snapshots (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  project_key TEXT,
  application_id TEXT,
  status TEXT,
  parser_version TEXT,
  service_id_status TEXT,
  operations_json TEXT,
  stats_json TEXT,
  scanned_by TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_project ON discovery_snapshots(project_key);

CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  application_id TEXT,
  collection_id TEXT,
  status TEXT,
  started_at TEXT,
  completed_at TEXT,
  results_json TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mocks (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  application_id TEXT,
  name TEXT,
  method TEXT,
  path_pattern TEXT,
  status TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS mock_call_logs (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  mock_id TEXT,
  application_id TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jit_access_grants (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  application_id TEXT,
  user_id TEXT,
  role TEXT,
  status TEXT,
  expires_at TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jit_grants_user ON jit_access_grants(user_id);

CREATE TABLE IF NOT EXISTS branding_meta (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  active_template_id TEXT,
  templates_json TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS contract_baselines (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  application_id TEXT,
  collection_id TEXT,
  name TEXT,
  version TEXT,
  spec_json TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS portal_share_tokens (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  application_id TEXT,
  request_id TEXT,
  token_hash TEXT,
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_policies (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  policy_key TEXT,
  scope TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS dual_approvals (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  request_id TEXT,
  user_id TEXT,
  status TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dual_approvals_request ON dual_approvals(request_id);

CREATE TABLE IF NOT EXISTS itsm_webhook_queue (
  id TEXT PRIMARY KEY,
  origin_id TEXT,
  status TEXT,
  created_at TEXT,
  payload_json TEXT NOT NULL
);
