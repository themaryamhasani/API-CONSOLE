-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";
CREATE SCHEMA IF NOT EXISTS "workspace";
CREATE SCHEMA IF NOT EXISTS "catalog";
CREATE SCHEMA IF NOT EXISTS "runtime";
CREATE SCHEMA IF NOT EXISTS "execution";
CREATE SCHEMA IF NOT EXISTS "governance";
CREATE SCHEMA IF NOT EXISTS "observability";

-- Enums (identity)
DO $$ BEGIN
  CREATE TYPE "identity"."UserRole" AS ENUM ('SYSTEM_ADMIN','TECH_LEAD','QA_LEAD','SECURITY_REVIEWER','QA_SPECIALIST','BA','PRODUCT_OWNER','DEVELOPER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "identity"."GrantStatus" AS ENUM ('PENDING','APPROVED','DENIED','EXPIRED','REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "identity"."LoginEventKind" AS ENUM ('SSO_PROBE','CDE_PASSWORD','IS_LOGIN','LOCAL_LOGIN','LOGOUT','WORKSPACE_DENIED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enums (catalog)
DO $$ BEGIN
  CREATE TYPE "catalog"."CollectionStatus" AS ENUM ('ACTIVE','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "catalog"."Visibility" AS ENUM ('PRIVATE','PROJECT_SHARED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "catalog"."SharingStatus" AS ENUM ('PRIVATE','PENDING_REVIEW','APPROVED','REJECTED','RETURNED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enums (execution)
DO $$ BEGIN
  CREATE TYPE "execution"."ExecutionStatus" AS ENUM ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED','QUEUED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "execution"."NetworkZone" AS ENUM ('PUBLIC','INTERNAL','RESTRICTED','TEST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "execution"."EnvironmentKind" AS ENUM ('DEVELOPMENT','TEST','PREPROD','PRODUCTION','CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enums (governance)
DO $$ BEGIN
  CREATE TYPE "governance"."ShareStatus" AS ENUM ('DRAFT','SUBMITTED','APPROVED','RETURNED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── identity ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "identity"."directory_users" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "full_name" TEXT NOT NULL,
  "phone_number" TEXT,
  "email" TEXT,
  "source" TEXT NOT NULL DEFAULT 'CDE',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "directory_users_phone_number_idx" ON "identity"."directory_users"("phone_number");
CREATE INDEX IF NOT EXISTS "directory_users_origin_id_idx" ON "identity"."directory_users"("origin_id");

CREATE TABLE IF NOT EXISTS "identity"."directory_role_assignments" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "user_id" TEXT NOT NULL REFERENCES "identity"."directory_users"("id") ON DELETE CASCADE,
  "role" "identity"."UserRole" NOT NULL,
  "application_id" TEXT,
  "scope" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'SESSION_SYNC',
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "directory_role_assignments_user_id_idx" ON "identity"."directory_role_assignments"("user_id");
CREATE INDEX IF NOT EXISTS "directory_role_assignments_application_id_idx" ON "identity"."directory_role_assignments"("application_id");

CREATE TABLE IF NOT EXISTS "identity"."workspace_memberships" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "identity"."directory_users"("id") ON DELETE CASCADE,
  "workspace_key" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'CDE_SYNC',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "extra" JSONB,
  UNIQUE ("user_id", "workspace_key")
);
CREATE INDEX IF NOT EXISTS "workspace_memberships_workspace_key_idx" ON "identity"."workspace_memberships"("workspace_key");

CREATE TABLE IF NOT EXISTS "identity"."jit_access_grants" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "user_id" TEXT NOT NULL REFERENCES "identity"."directory_users"("id") ON DELETE CASCADE,
  "application_id" TEXT,
  "reason" TEXT,
  "status" "identity"."GrantStatus" NOT NULL DEFAULT 'PENDING',
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ,
  "approved_by" TEXT,
  "approved_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "jit_access_grants_user_id_idx" ON "identity"."jit_access_grants"("user_id");
CREATE INDEX IF NOT EXISTS "jit_access_grants_status_idx" ON "identity"."jit_access_grants"("status");

CREATE TABLE IF NOT EXISTS "identity"."login_events" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT REFERENCES "identity"."directory_users"("id") ON DELETE SET NULL,
  "kind" "identity"."LoginEventKind" NOT NULL,
  "success" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "origin_id" TEXT,
  "details" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "login_events_created_at_idx" ON "identity"."login_events"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "login_events_user_id_created_at_idx" ON "identity"."login_events"("user_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "identity"."access_denials" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT REFERENCES "identity"."directory_users"("id") ON DELETE SET NULL,
  "required_workspaces" TEXT[] NOT NULL,
  "granted_workspaces" TEXT[] NOT NULL,
  "details" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "access_denials_created_at_idx" ON "identity"."access_denials"("created_at" DESC);

-- ─── workspace ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workspace"."origins" (
  "id" TEXT PRIMARY KEY,
  "label" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "extra" JSONB
);

CREATE TABLE IF NOT EXISTS "workspace"."workspaces" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "name" TEXT,
  "origin_id" TEXT REFERENCES "workspace"."origins"("id") ON DELETE SET NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "workspaces_origin_id_idx" ON "workspace"."workspaces"("origin_id");

CREATE TABLE IF NOT EXISTS "workspace"."workspace_access_policy" (
  "id" TEXT PRIMARY KEY,
  "required_workspaces" TEXT[] NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'RESTRICT',
  "updated_at" TIMESTAMPTZ NOT NULL,
  "updated_by" TEXT,
  "extra" JSONB
);

CREATE TABLE IF NOT EXISTS "workspace"."workspace_sync_state" (
  "id" TEXT PRIMARY KEY,
  "workspace_key" TEXT NOT NULL UNIQUE,
  "last_synced_at" TIMESTAMPTZ,
  "fingerprint" TEXT,
  "extra" JSONB
);

-- ─── catalog ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "catalog"."collections" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "application_id" TEXT,
  "workspace_name" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "owner_id" TEXT,
  "status" "catalog"."CollectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "visibility" "catalog"."Visibility" DEFAULT 'PRIVATE',
  "variables" JSONB,
  "authentication_documentation_profile_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "collections_origin_id_idx" ON "catalog"."collections"("origin_id");
CREATE INDEX IF NOT EXISTS "collections_application_id_idx" ON "catalog"."collections"("application_id");

CREATE TABLE IF NOT EXISTS "catalog"."requests" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "collection_id" TEXT NOT NULL REFERENCES "catalog"."collections"("id") ON DELETE CASCADE,
  "application_id" TEXT,
  "api_id" TEXT,
  "semantic_version" TEXT,
  "sharing_status" "catalog"."SharingStatus",
  "source_type" TEXT,
  "reference_id" TEXT,
  "source_request_id" TEXT,
  "share_request_id" TEXT,
  "name" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "url_template" TEXT,
  "folder_path" TEXT,
  "query_parameters" JSONB,
  "headers" JSONB,
  "cookies" JSONB,
  "body_type" TEXT,
  "body_template" TEXT,
  "authentication" JSONB,
  "tls" JSONB,
  "execution_mode" TEXT,
  "classification" TEXT,
  "environment_id" TEXT,
  "runner_id" TEXT,
  "assertions" JSONB,
  "scripts" JSONB,
  "documentation" JSONB,
  "version" TEXT,
  "status" TEXT,
  "runtime_binding" JSONB,
  "is_gateway_binding" JSONB,
  "source_sync" JSONB,
  "visibility" "catalog"."Visibility",
  "co_owner_ids" JSONB,
  "owner_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "requests_origin_id_idx" ON "catalog"."requests"("origin_id");
CREATE INDEX IF NOT EXISTS "requests_collection_id_idx" ON "catalog"."requests"("collection_id");
CREATE INDEX IF NOT EXISTS "requests_api_id_idx" ON "catalog"."requests"("api_id");

CREATE TABLE IF NOT EXISTS "catalog"."references" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "api_id" TEXT,
  "version" TEXT,
  "source_request_id" TEXT,
  "request_id" TEXT REFERENCES "catalog"."requests"("id") ON DELETE SET NULL,
  "collection_id" TEXT,
  "application_id" TEXT,
  "created_by" TEXT,
  "status" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "references_origin_id_idx" ON "catalog"."references"("origin_id");
CREATE INDEX IF NOT EXISTS "references_api_id_idx" ON "catalog"."references"("api_id");

CREATE TABLE IF NOT EXISTS "catalog"."imported_curls" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "request_id" TEXT REFERENCES "catalog"."requests"("id") ON DELETE SET NULL,
  "original_text_reference" TEXT,
  "sanitized_preview" TEXT,
  "detected_dialect" TEXT,
  "parser_version" TEXT,
  "imported_by" TEXT,
  "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "imported_curls_request_id_idx" ON "catalog"."imported_curls"("request_id");

CREATE TABLE IF NOT EXISTS "catalog"."manual_examples" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "request_id" TEXT NOT NULL REFERENCES "catalog"."requests"("id") ON DELETE CASCADE,
  "status_code" INTEGER,
  "headers" JSONB,
  "body" TEXT,
  "claimed_environment_id" TEXT,
  "source" TEXT,
  "reason" TEXT,
  "entered_by" TEXT,
  "entered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "review_status" TEXT,
  "reviewed_by" TEXT,
  "evidence_attachment_id" TEXT,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "manual_examples_request_id_idx" ON "catalog"."manual_examples"("request_id");

CREATE TABLE IF NOT EXISTS "catalog"."documentation_results" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "request_id" TEXT NOT NULL REFERENCES "catalog"."requests"("id") ON DELETE CASCADE,
  "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generated_by" TEXT,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "markdown" TEXT,
  "warnings" JSONB,
  "word_document_base64" TEXT,
  "word_file_name" TEXT,
  "word_mime_type" TEXT,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "documentation_results_request_id_idx" ON "catalog"."documentation_results"("request_id");

CREATE TABLE IF NOT EXISTS "catalog"."contract_baselines" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "collection_id" TEXT REFERENCES "catalog"."collections"("id") ON DELETE SET NULL,
  "application_id" TEXT,
  "name" TEXT NOT NULL,
  "fingerprint" TEXT,
  "schema_summary" JSONB,
  "version" TEXT,
  "spec" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "contract_baselines_collection_id_idx" ON "catalog"."contract_baselines"("collection_id");

-- ─── runtime ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "runtime"."runtime_profiles" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "application_id" TEXT,
  "project_key" TEXT,
  "name" TEXT NOT NULL,
  "kind" TEXT,
  "origin" TEXT,
  "core_base_path" TEXT,
  "login_path" TEXT,
  "app_referer_path" TEXT,
  "runtime_service_id" TEXT,
  "project_service_id" TEXT,
  "service_id_evidence" JSONB,
  "user_source" TEXT,
  "prostage" TEXT,
  "data_service" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "row_version" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "runtime_profiles_application_id_idx" ON "runtime"."runtime_profiles"("application_id");
CREATE INDEX IF NOT EXISTS "runtime_profiles_project_key_idx" ON "runtime"."runtime_profiles"("project_key");

CREATE TABLE IF NOT EXISTS "runtime"."discovery_snapshots" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "project_key" TEXT,
  "application_id" TEXT,
  "runtime_profile_id" TEXT REFERENCES "runtime"."runtime_profiles"("id") ON DELETE SET NULL,
  "status" TEXT,
  "parser_version" TEXT,
  "service_id_status" TEXT,
  "project_service_id_candidates" JSONB,
  "operations" JSONB,
  "removed_operations" JSONB,
  "warnings" JSONB,
  "stats" JSONB,
  "source_fingerprint" TEXT,
  "scanned_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "discovery_snapshots_project_key_idx" ON "runtime"."discovery_snapshots"("project_key");
CREATE INDEX IF NOT EXISTS "discovery_snapshots_application_id_idx" ON "runtime"."discovery_snapshots"("application_id");

CREATE TABLE IF NOT EXISTS "runtime"."discovered_operations" (
  "id" TEXT PRIMARY KEY,
  "snapshot_id" TEXT NOT NULL REFERENCES "runtime"."discovery_snapshots"("id") ON DELETE CASCADE,
  "operation_id" TEXT,
  "method" TEXT,
  "path" TEXT,
  "summary" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "discovered_operations_snapshot_id_idx" ON "runtime"."discovered_operations"("snapshot_id");
CREATE INDEX IF NOT EXISTS "discovered_operations_operation_id_idx" ON "runtime"."discovered_operations"("operation_id");

-- ─── execution ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "execution"."environments" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "name" TEXT NOT NULL,
  "kind" "execution"."EnvironmentKind",
  "base_url" TEXT,
  "variables" JSONB,
  "default_headers" JSONB,
  "secret_references" JSONB,
  "production_protected" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "seeded" BOOLEAN NOT NULL DEFAULT false,
  "cloned_from" TEXT,
  "authentication_documentation_profile_id" TEXT,
  "runner_id" TEXT,
  "webhook_url" TEXT,
  "webhook_secret" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);

CREATE TABLE IF NOT EXISTS "execution"."runners" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "name" TEXT NOT NULL,
  "network_zone" "execution"."NetworkZone",
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "allowed_origin_patterns" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);

CREATE TABLE IF NOT EXISTS "execution"."executions" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "request_id" TEXT REFERENCES "catalog"."requests"("id") ON DELETE SET NULL,
  "collection_id" TEXT,
  "environment_id" TEXT REFERENCES "execution"."environments"("id") ON DELETE SET NULL,
  "runner_id" TEXT REFERENCES "execution"."runners"("id") ON DELETE SET NULL,
  "operation_id" TEXT,
  "application_id" TEXT,
  "runtime_profile_id" TEXT REFERENCES "runtime"."runtime_profiles"("id") ON DELETE SET NULL,
  "source_kind" TEXT,
  "executed_by" TEXT,
  "status" "execution"."ExecutionStatus",
  "status_code" INTEGER,
  "response_size" INTEGER,
  "duration_ms" INTEGER,
  "correlation_id" TEXT,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "request_snapshot" JSONB,
  "response" JSONB,
  "tls_verification" JSONB,
  "transport_result" JSONB,
  "business_result" JSONB,
  "assertion_results" JSONB,
  "script_results" JSONB,
  "error_category" TEXT,
  "sanitized_error" TEXT,
  "environment_name" TEXT,
  "evidence_type" TEXT,
  "business_justification" TEXT,
  "queue_job_id" TEXT,
  "network_zone" TEXT,
  "runner_host" TEXT,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "executions_origin_id_idx" ON "execution"."executions"("origin_id");
CREATE INDEX IF NOT EXISTS "executions_request_id_started_at_idx" ON "execution"."executions"("request_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "executions_operation_id_idx" ON "execution"."executions"("operation_id");

CREATE TABLE IF NOT EXISTS "execution"."execution_queue" (
  "id" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "request_id" TEXT,
  "collection_id" TEXT,
  "environment_id" TEXT,
  "environment_name" TEXT,
  "runner_id" TEXT REFERENCES "execution"."runners"("id") ON DELETE SET NULL,
  "network_zone" TEXT,
  "runner_host" TEXT,
  "executed_by" TEXT,
  "started_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "business_justification" TEXT,
  "request_snapshot" JSONB,
  "transport" JSONB,
  "assertions" JSONB,
  "scripts" JSONB,
  "pre_script_results" JSONB,
  "error_category" TEXT,
  "error_message" TEXT,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "execution_queue_status_created_at_idx" ON "execution"."execution_queue"("status", "created_at");

CREATE TABLE IF NOT EXISTS "execution"."test_runs" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "collection_id" TEXT REFERENCES "catalog"."collections"("id") ON DELETE SET NULL,
  "application_id" TEXT,
  "environment_id" TEXT REFERENCES "execution"."environments"("id") ON DELETE SET NULL,
  "actor_user_id" TEXT,
  "actor_role" TEXT,
  "stop_on_fail" BOOLEAN NOT NULL DEFAULT false,
  "summary" JSONB,
  "webhook_delivery" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "test_runs_collection_id_idx" ON "execution"."test_runs"("collection_id");

CREATE TABLE IF NOT EXISTS "execution"."test_run_results" (
  "id" TEXT PRIMARY KEY,
  "test_run_id" TEXT NOT NULL REFERENCES "execution"."test_runs"("id") ON DELETE CASCADE,
  "request_id" TEXT,
  "status" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "test_run_results_test_run_id_idx" ON "execution"."test_run_results"("test_run_id");

CREATE TABLE IF NOT EXISTS "execution"."mocks" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "request_id" TEXT REFERENCES "catalog"."requests"("id") ON DELETE SET NULL,
  "collection_id" TEXT REFERENCES "catalog"."collections"("id") ON DELETE SET NULL,
  "application_id" TEXT,
  "environment_id" TEXT REFERENCES "execution"."environments"("id") ON DELETE SET NULL,
  "method" TEXT,
  "path_match" TEXT,
  "status_code" INTEGER,
  "response_body" TEXT,
  "response_headers" JSONB,
  "status" TEXT,
  "expires_at" TIMESTAMPTZ,
  "hit_count" INTEGER NOT NULL DEFAULT 0,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "mocks_application_id_idx" ON "execution"."mocks"("application_id");

CREATE TABLE IF NOT EXISTS "execution"."mock_call_logs" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "mock_id" TEXT NOT NULL REFERENCES "execution"."mocks"("id") ON DELETE CASCADE,
  "method" TEXT,
  "path" TEXT,
  "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "application_id" TEXT,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "mock_call_logs_mock_id_idx" ON "execution"."mock_call_logs"("mock_id");

CREATE TABLE IF NOT EXISTS "execution"."zone_worker_state" (
  "id" TEXT PRIMARY KEY DEFAULT 'main',
  "heartbeat_at" TIMESTAMPTZ,
  "extra" JSONB
);

-- ─── governance ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "governance"."share_requests" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "request_id" TEXT REFERENCES "catalog"."requests"("id") ON DELETE SET NULL,
  "api_id" TEXT,
  "api_title" TEXT,
  "application_id" TEXT,
  "version" TEXT,
  "submitted_by" TEXT,
  "status" "governance"."ShareStatus",
  "current_revision_number" INTEGER,
  "purpose" TEXT,
  "introduction" TEXT,
  "description" TEXT,
  "ticket_id" TEXT,
  "ticket_url" TEXT,
  "return_reason" TEXT,
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMPTZ,
  "comments" JSONB,
  "checklist" JSONB,
  "row_version" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "share_requests_status_idx" ON "governance"."share_requests"("status");
CREATE INDEX IF NOT EXISTS "share_requests_application_id_idx" ON "governance"."share_requests"("application_id");

CREATE TABLE IF NOT EXISTS "governance"."share_revisions" (
  "id" TEXT PRIMARY KEY,
  "share_request_id" TEXT NOT NULL REFERENCES "governance"."share_requests"("id") ON DELETE CASCADE,
  "revision_number" INTEGER NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT
);
CREATE INDEX IF NOT EXISTS "share_revisions_share_request_id_idx" ON "governance"."share_revisions"("share_request_id");

CREATE TABLE IF NOT EXISTS "governance"."consumers" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "api_id" TEXT,
  "version" TEXT,
  "consumer_type" TEXT,
  "user_id" TEXT,
  "role_key" TEXT,
  "application_id" TEXT,
  "status" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "consumers_api_id_version_idx" ON "governance"."consumers"("api_id", "version");

CREATE TABLE IF NOT EXISTS "governance"."read_receipts" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "user_id" TEXT,
  "api_id" TEXT,
  "version" TEXT,
  "notified_at" TIMESTAMPTZ,
  "read_at" TIMESTAMPTZ,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "read_receipts_user_id_idx" ON "governance"."read_receipts"("user_id");

CREATE TABLE IF NOT EXISTS "governance"."dual_approvals" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "request_id" TEXT REFERENCES "catalog"."requests"("id") ON DELETE SET NULL,
  "user_id" TEXT,
  "application_id" TEXT,
  "reason" TEXT,
  "status" TEXT,
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by" TEXT,
  "approved_at" TIMESTAMPTZ,
  "expires_at" TIMESTAMPTZ,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "dual_approvals_request_id_idx" ON "governance"."dual_approvals"("request_id");

CREATE TABLE IF NOT EXISTS "governance"."portal_share_tokens" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "token" TEXT NOT NULL,
  "token_hash" TEXT,
  "api_id" TEXT,
  "version" TEXT,
  "request_id" TEXT REFERENCES "catalog"."requests"("id") ON DELETE SET NULL,
  "application_id" TEXT,
  "expires_at" TIMESTAMPTZ,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "url_path" TEXT,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "portal_share_tokens_token_idx" ON "governance"."portal_share_tokens"("token");

CREATE TABLE IF NOT EXISTS "governance"."org_policies" (
  "id" TEXT PRIMARY KEY DEFAULT 'main',
  "origin_id" TEXT,
  "policy_key" TEXT,
  "scope" TEXT,
  "payload" JSONB NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "updated_by" TEXT,
  "extra" JSONB
);

CREATE TABLE IF NOT EXISTS "governance"."itsm_webhook_queue" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "event_type" TEXT,
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered_at" TIMESTAMPTZ,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "itsm_webhook_queue_status_created_at_idx" ON "governance"."itsm_webhook_queue"("status", "created_at");

CREATE TABLE IF NOT EXISTS "governance"."global_variables" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "key" TEXT NOT NULL,
  "current_value" TEXT,
  "initial_value" TEXT,
  "sensitive" BOOLEAN NOT NULL DEFAULT false,
  "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
  "description" TEXT,
  "extra" JSONB
);

CREATE TABLE IF NOT EXISTS "governance"."branding_templates" (
  "id" TEXT PRIMARY KEY DEFAULT 'main',
  "origin_id" TEXT,
  "active_template_id" TEXT,
  "templates" JSONB,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "extra" JSONB
);

-- ─── observability ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "observability"."audit_log" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "event_type" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "actor_role" TEXT,
  "details" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "observability"."audit_log"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_log_origin_id_idx" ON "observability"."audit_log"("origin_id");
CREATE INDEX IF NOT EXISTS "audit_log_actor_user_id_idx" ON "observability"."audit_log"("actor_user_id");

CREATE TABLE IF NOT EXISTS "observability"."usage_events" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "event_type" TEXT NOT NULL,
  "user_id" TEXT,
  "user_display_name" TEXT,
  "active_role" TEXT,
  "application_id" TEXT,
  "api_id" TEXT,
  "api_title" TEXT,
  "version" TEXT,
  "reference_id" TEXT,
  "event_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "environment_id" TEXT,
  "correlation_id" TEXT,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "usage_events_application_id_idx" ON "observability"."usage_events"("application_id");
CREATE INDEX IF NOT EXISTS "usage_events_event_at_idx" ON "observability"."usage_events"("event_at" DESC);

CREATE TABLE IF NOT EXISTS "observability"."notifications" (
  "id" TEXT PRIMARY KEY,
  "origin_id" TEXT,
  "user_id" TEXT REFERENCES "identity"."directory_users"("id") ON DELETE SET NULL,
  "title" TEXT,
  "message" TEXT,
  "type" TEXT,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "channels" JSONB,
  "delivery_status" TEXT,
  "correlation_id" TEXT,
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMPTZ,
  "extra" JSONB
);
CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_idx" ON "observability"."notifications"("user_id", "is_read");
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "observability"."notifications"("created_at" DESC);

-- Seed default workspace access policy
INSERT INTO workspace.workspace_access_policy (id, required_workspaces, mode, updated_at) VALUES ('default', ARRAY['medu-ai'], 'RESTRICT', CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING;
