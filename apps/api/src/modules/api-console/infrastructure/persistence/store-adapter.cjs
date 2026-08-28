'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

const STORE_ARRAY_KEYS = [
  'collections',
  'requests',
  'executions',
  'importedCurls',
  'manualExamples',
  'documentationResults',
  'shareRequests',
  'consumers',
  'references',
  'usageEvents',
  'readReceipts',
  'notifications',
  'directoryUsers',
  'directoryRoleAssignments',
  'runtimeProfiles',
  'discoverySnapshots',
  'environments',
  'runners',
  'globalVariables',
  'auditLog',
  'testRuns',
  'mocks',
  'mockCallLogs',
  'jitAccessGrants',
  'contractBaselines',
  'portalShareTokens',
  'orgPolicies',
  'dualApprovals',
  'itsmWebhookQueue',
];

function resolveBackend(env = process.env) {
  const raw = String(env.API_CONSOLE_STORE_BACKEND || 'FILE').trim().toUpperCase();
  return raw === 'SQLITE' || raw === 'DB' ? 'SQLITE' : 'FILE';
}

function resolveSqlitePath(env = process.env, dataDir) {
  if (env.API_CONSOLE_SQLITE_FILE) {
    return path.isAbsolute(env.API_CONSOLE_SQLITE_FILE)
      ? env.API_CONSOLE_SQLITE_FILE
      : path.join(process.cwd(), env.API_CONSOLE_SQLITE_FILE);
  }
  const base = dataDir || path.join(process.cwd(), 'runtime', 'api-console');
  return path.join(base, 'api-console.sqlite');
}

function tryOpenSqlite(dbPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (error) {
    const err = new Error(
      'API_CONSOLE_STORE_BACKEND=SQLITE requires Node.js 22+ with built-in node:sqlite. '
      + `Current runtime cannot load node:sqlite (${error.message}). Keep FILE backend or upgrade Node.`,
    );
    err.code = 'SQLITE_UNAVAILABLE';
    throw err;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function migrateSchema(db) {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  db.exec(sql);
}

function originOf(row) {
  if (!row || typeof row !== 'object') return null;
  return row.originId || row.cdeOriginId || row.origin_id || null;
}

function jsonOrNull(value) {
  if (value === undefined) return null;
  return JSON.stringify(value ?? null);
}

function upsertBlob(db, store) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO store_blob (id, version, payload_json, updated_at)
    VALUES ('main', @version, @payload_json, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      version = excluded.version,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run({
    version: Number(store.version) || 2,
    payload_json: JSON.stringify(store),
    updated_at: now,
  });
}

function clearEntityTables(db) {
  const tables = [
    'collections', 'requests', 'executions', 'imported_curls', 'manual_examples',
    'documentation_results', 'share_requests', 'consumers', 'references', 'usage_events',
    'read_receipts', 'notifications', 'directory_users', 'directory_role_assignments',
    'environments', 'runners', 'global_variables', 'audit_log', 'runtime_profiles',
    'discovery_snapshots', 'test_runs', 'mocks', 'mock_call_logs', 'jit_access_grants',
    'branding_meta', 'contract_baselines', 'portal_share_tokens', 'org_policies',
    'dual_approvals', 'itsm_webhook_queue',
  ];
  for (const table of tables) {
    db.exec(`DELETE FROM "${table}"`);
  }
}

function projectSimple(db, items, table, extra = {}) {
  const cols = Object.keys(extra.fields || {});
  const colSql = cols.length ? `, ${cols.join(', ')}` : '';
  const bindSql = cols.length ? `, ${cols.map(c => `@${c}`).join(', ')}` : '';
  const stmt = db.prepare(`
    INSERT INTO "${table}" (id, origin_id, payload_json${colSql})
    VALUES (@id, @origin_id, @payload_json${bindSql})
  `);
  for (const row of items || []) {
    if (!row?.id && !extra.idOf) continue;
    const id = String(extra.idOf ? extra.idOf(row) : row.id);
    const bind = {
      id,
      origin_id: originOf(row),
      payload_json: JSON.stringify(row),
    };
    for (const col of cols) {
      bind[col] = extra.fields[col](row);
    }
    stmt.run(bind);
  }
}

function projectEntities(db, store) {
  clearEntityTables(db);

  const insertCollection = db.prepare(`
    INSERT INTO collections (
      id, origin_id, application_id, workspace_name, name, owner_id, status, visibility,
      variables_json, payload_json, created_at, updated_at
    ) VALUES (
      @id, @origin_id, @application_id, @workspace_name, @name, @owner_id, @status, @visibility,
      @variables_json, @payload_json, @created_at, @updated_at
    )
  `);
  for (const row of store.collections || []) {
    insertCollection.run({
      id: String(row.id),
      origin_id: originOf(row),
      application_id: row.applicationId || null,
      workspace_name: row.workspaceName || null,
      name: row.name || null,
      owner_id: row.ownerId || null,
      status: row.status || null,
      visibility: row.visibility || null,
      variables_json: jsonOrNull(row.variables),
      payload_json: JSON.stringify(row),
      created_at: row.createdAt || null,
      updated_at: row.updatedAt || null,
    });
  }

  const insertRequest = db.prepare(`
    INSERT INTO requests (
      id, origin_id, collection_id, application_id, api_id, semantic_version, name, method,
      url_template, sharing_status, visibility, owner_id, environment_id, runner_id,
      headers_json, cookies_json, assertions_json, scripts_json, documentation_json,
      payload_json, created_at, updated_at
    ) VALUES (
      @id, @origin_id, @collection_id, @application_id, @api_id, @semantic_version, @name, @method,
      @url_template, @sharing_status, @visibility, @owner_id, @environment_id, @runner_id,
      @headers_json, @cookies_json, @assertions_json, @scripts_json, @documentation_json,
      @payload_json, @created_at, @updated_at
    )
  `);
  for (const row of store.requests || []) {
    insertRequest.run({
      id: String(row.id),
      origin_id: originOf(row),
      collection_id: row.collectionId || null,
      application_id: row.applicationId || null,
      api_id: row.apiId || null,
      semantic_version: row.semanticVersion || null,
      name: row.name || null,
      method: row.method || null,
      url_template: row.urlTemplate || null,
      sharing_status: row.sharingStatus || null,
      visibility: row.visibility || null,
      owner_id: row.ownerId || row.createdBy || null,
      environment_id: row.environmentId || null,
      runner_id: row.runnerId || null,
      headers_json: jsonOrNull(row.headers),
      cookies_json: jsonOrNull(row.cookies),
      assertions_json: jsonOrNull(row.assertions),
      scripts_json: jsonOrNull(row.scripts),
      documentation_json: jsonOrNull(row.documentation),
      payload_json: JSON.stringify(row),
      created_at: row.createdAt || null,
      updated_at: row.updatedAt || null,
    });
  }

  const insertExecution = db.prepare(`
    INSERT INTO executions (
      id, origin_id, operation_id, application_id, runtime_profile_id, source_kind, executed_by,
      status, status_code, response_size, correlation_id, started_at, completed_at,
      response_json, transport_result_json, payload_json
    ) VALUES (
      @id, @origin_id, @operation_id, @application_id, @runtime_profile_id, @source_kind, @executed_by,
      @status, @status_code, @response_size, @correlation_id, @started_at, @completed_at,
      @response_json, @transport_result_json, @payload_json
    )
  `);
  for (const row of store.executions || []) {
    insertExecution.run({
      id: String(row.id),
      origin_id: originOf(row),
      operation_id: row.operationId || null,
      application_id: row.applicationId || null,
      runtime_profile_id: row.runtimeProfileId || null,
      source_kind: row.sourceKind || null,
      executed_by: row.executedBy || null,
      status: row.status || null,
      status_code: row.statusCode == null ? null : Number(row.statusCode),
      response_size: row.responseSize == null ? null : Number(row.responseSize),
      correlation_id: row.correlationId || null,
      started_at: row.startedAt || null,
      completed_at: row.completedAt || null,
      response_json: jsonOrNull(row.response),
      transport_result_json: jsonOrNull(row.transportResult),
      payload_json: JSON.stringify(row),
    });
  }

  projectSimple(db, store.importedCurls, 'imported_curls', {
    fields: {
      request_id: r => r.requestId || null,
      application_id: r => r.applicationId || null,
      created_by: r => r.createdBy || null,
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.manualExamples, 'manual_examples', {
    fields: {
      request_id: r => r.requestId || null,
      application_id: r => r.applicationId || null,
      created_by: r => r.createdBy || null,
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.documentationResults, 'documentation_results', {
    idOf: row => row.id || `doc-${row.requestId || 'unknown'}-${row.generatedAt || Date.now()}`,
    fields: {
      request_id: r => r.requestId || null,
      generated_by: r => r.generatedBy || null,
      generated_at: r => r.generatedAt || null,
      approved: r => (r.approved ? 1 : 0),
    },
  });
  projectSimple(db, store.shareRequests, 'share_requests', {
    fields: {
      request_id: r => r.requestId || null,
      application_id: r => r.applicationId || null,
      status: r => r.status || null,
      submitted_by: r => r.submittedBy || r.createdBy || null,
      reviewed_by: r => r.reviewedBy || null,
      created_at: r => r.createdAt || null,
      updated_at: r => r.updatedAt || null,
    },
  });
  projectSimple(db, store.consumers, 'consumers', {
    fields: {
      api_id: r => r.apiId || null,
      version: r => r.version || null,
      application_id: r => r.applicationId || null,
      consumer_application_id: r => r.consumerApplicationId || null,
      user_id: r => r.userId || null,
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.references, 'references', {
    fields: {
      request_id: r => r.requestId || null,
      api_id: r => r.apiId || null,
      application_id: r => r.applicationId || null,
      referenced_by: r => r.referencedBy || r.userId || null,
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.usageEvents, 'usage_events', {
    fields: {
      event_type: r => r.eventType || null,
      user_id: r => r.userId || null,
      application_id: r => r.applicationId || null,
      api_id: r => r.apiId || null,
      version: r => r.version || null,
      event_at: r => r.eventAt || null,
    },
  });
  projectSimple(db, store.readReceipts, 'read_receipts', {
    idOf: row => row.id || `rr-${row.userId}-${row.apiId}-${row.version}`,
    fields: {
      user_id: r => r.userId || null,
      api_id: r => r.apiId || null,
      version: r => r.version || null,
      read_at: r => r.readAt || null,
    },
  });
  projectSimple(db, store.notifications, 'notifications', {
    fields: {
      user_id: r => r.userId || null,
      type: r => r.type || r.eventType || null,
      read_at: r => r.readAt || null,
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.directoryUsers, 'directory_users', {
    fields: {
      full_name: r => r.fullName || null,
      phone_number: r => r.phoneNumber || null,
      is_active: r => (r.isActive === false ? 0 : 1),
      source: r => r.source || null,
      created_at: r => r.createdAt || null,
      updated_at: r => r.updatedAt || null,
    },
  });
  projectSimple(db, store.directoryRoleAssignments, 'directory_role_assignments', {
    fields: {
      user_id: r => r.userId || null,
      role: r => r.role || null,
      application_id: r => r.applicationId || null,
      is_active: r => (r.isActive === false ? 0 : 1),
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.environments, 'environments', {
    fields: {
      name: r => r.name || null,
      kind: r => r.kind || null,
      base_url: r => r.baseUrl || null,
      archived: r => (r.archived ? 1 : 0),
      production_protected: r => (r.productionProtected ? 1 : 0),
      variables_json: r => jsonOrNull(r.variables),
      default_headers_json: r => jsonOrNull(r.defaultHeaders),
      secret_references_json: r => jsonOrNull(r.secretReferences),
      created_at: r => r.createdAt || null,
      updated_at: r => r.updatedAt || null,
    },
  });
  projectSimple(db, store.runners, 'runners', {
    fields: {
      name: r => r.name || null,
      network_zone: r => r.networkZone || null,
      enabled: r => (r.enabled === false ? 0 : 1),
      allowed_origin_patterns_json: r => jsonOrNull(r.allowedOriginPatterns),
    },
  });
  projectSimple(db, store.globalVariables, 'global_variables', {
    fields: {
      key: r => r.key || null,
      scope: r => r.scope || null,
      sensitive: r => (r.sensitive ? 1 : 0),
    },
  });
  projectSimple(db, store.auditLog, 'audit_log', {
    fields: {
      event_type: r => r.eventType || null,
      actor_user_id: r => r.actorUserId || null,
      actor_role: r => r.actorRole || null,
      details_json: r => jsonOrNull(r.details),
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.runtimeProfiles, 'runtime_profiles', {
    fields: {
      application_id: r => r.applicationId || null,
      project_key: r => r.projectKey || null,
      name: r => r.name || null,
      kind: r => r.kind || null,
      origin: r => r.origin || null,
      enabled: r => (r.enabled === false ? 0 : 1),
      row_version: r => r.rowVersion || null,
      data_service_json: r => jsonOrNull(r.dataService),
      created_at: r => r.createdAt || null,
      updated_at: r => r.updatedAt || null,
    },
  });
  projectSimple(db, store.discoverySnapshots, 'discovery_snapshots', {
    fields: {
      project_key: r => r.projectKey || null,
      application_id: r => r.applicationId || null,
      status: r => r.status || null,
      parser_version: r => r.parserVersion || null,
      service_id_status: r => r.serviceIdStatus || null,
      operations_json: r => jsonOrNull(r.operations),
      stats_json: r => jsonOrNull(r.stats),
      scanned_by: r => r.scannedBy || null,
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.testRuns, 'test_runs', {
    fields: {
      application_id: r => r.applicationId || null,
      collection_id: r => r.collectionId || null,
      status: r => r.status || null,
      started_at: r => r.startedAt || null,
      completed_at: r => r.completedAt || null,
      results_json: r => jsonOrNull(r.results || r.cases),
    },
  });
  projectSimple(db, store.mocks, 'mocks', {
    fields: {
      application_id: r => r.applicationId || null,
      name: r => r.name || null,
      method: r => r.method || null,
      path_pattern: r => r.pathPattern || r.path || null,
      status: r => r.status || null,
      created_at: r => r.createdAt || null,
      updated_at: r => r.updatedAt || null,
    },
  });
  projectSimple(db, store.mockCallLogs, 'mock_call_logs', {
    fields: {
      mock_id: r => r.mockId || null,
      application_id: r => r.applicationId || null,
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.jitAccessGrants, 'jit_access_grants', {
    fields: {
      application_id: r => r.applicationId || null,
      user_id: r => r.userId || null,
      role: r => r.role || null,
      status: r => r.status || null,
      expires_at: r => r.expiresAt || null,
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.contractBaselines, 'contract_baselines', {
    fields: {
      application_id: r => r.applicationId || null,
      collection_id: r => r.collectionId || null,
      name: r => r.name || null,
      version: r => r.version || null,
      spec_json: r => jsonOrNull(r.spec || r.openApi),
      created_at: r => r.createdAt || null,
      updated_at: r => r.updatedAt || null,
    },
  });
  projectSimple(db, store.portalShareTokens, 'portal_share_tokens', {
    fields: {
      application_id: r => r.applicationId || null,
      request_id: r => r.requestId || null,
      token_hash: r => r.tokenHash || r.token || null,
      expires_at: r => r.expiresAt || null,
      created_by: r => r.createdBy || null,
      created_at: r => r.createdAt || null,
    },
  });
  projectSimple(db, store.dualApprovals, 'dual_approvals', {
    fields: {
      request_id: r => r.requestId || null,
      user_id: r => r.userId || null,
      status: r => r.status || null,
      created_at: r => r.requestedAt || r.createdAt || null,
    },
  });
  if (Array.isArray(store.orgPolicies)) {
    projectSimple(db, store.orgPolicies, 'org_policies', {
      fields: {
        policy_key: r => r.policyKey || r.key || null,
        scope: r => r.scope || null,
        updated_at: r => r.updatedAt || null,
      },
    });
  } else if (store.orgPolicies && typeof store.orgPolicies === 'object') {
    projectSimple(db, [{
      id: 'main',
      policyKey: 'org',
      scope: 'SYSTEM',
      updatedAt: store.orgPolicies.updatedAt || null,
      ...store.orgPolicies,
    }], 'org_policies', {
      fields: {
        policy_key: () => 'org',
        scope: () => 'SYSTEM',
        updated_at: r => r.updatedAt || null,
      },
    });
  }
  projectSimple(db, store.itsmWebhookQueue, 'itsm_webhook_queue', {
    fields: {
      status: r => r.status || null,
      created_at: r => r.createdAt || null,
    },
  });

  if (store.branding && typeof store.branding === 'object') {
    db.prepare(`
      INSERT INTO branding_meta (id, origin_id, active_template_id, templates_json, payload_json, updated_at)
      VALUES (@id, @origin_id, @active_template_id, @templates_json, @payload_json, @updated_at)
    `).run({
      id: 'main',
      origin_id: originOf(store.branding),
      active_template_id: store.branding.activeTemplateId || null,
      templates_json: jsonOrNull(store.branding.templates),
      payload_json: JSON.stringify(store.branding),
      updated_at: store.branding.updatedAt || new Date().toISOString(),
    });
  }
}

function countStoreEntities(store) {
  const counts = {};
  for (const key of STORE_ARRAY_KEYS) {
    if (key === 'orgPolicies' && store?.orgPolicies && !Array.isArray(store.orgPolicies)) {
      counts[key] = 1;
      continue;
    }
    counts[key] = Array.isArray(store?.[key]) ? store[key].length : 0;
  }
  counts.branding = store?.branding ? 1 : 0;
  counts.version = store?.version ?? null;
  return counts;
}

function saveStoreToSqlite(db, store) {
  db.exec('BEGIN IMMEDIATE');
  try {
    upsertBlob(db, store);
    projectEntities(db, store);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
}

function loadStoreFromSqlite(db) {
  const row = db.prepare(`SELECT payload_json FROM store_blob WHERE id = 'main'`).get();
  if (!row?.payload_json) return null;
  return JSON.parse(row.payload_json);
}

function createSqliteHandle(options = {}) {
  const env = options.env || process.env;
  const dbPath = options.sqliteFile || resolveSqlitePath(env, options.dataDir);
  const db = tryOpenSqlite(dbPath);
  migrateSchema(db);
  return {
    backend: 'SQLITE',
    dbPath,
    db,
    load() {
      return loadStoreFromSqlite(db);
    },
    save(store) {
      saveStoreToSqlite(db, store);
    },
    close() {
      db.close();
    },
  };
}

/**
 * Repository adapter: FILE keeps injected load/save; SQLITE uses node:sqlite blob + entity tables.
 */
function createStoreAdapter(options = {}) {
  const env = options.env || process.env;
  const backend = options.backend || resolveBackend(env);

  if (backend === 'FILE') {
    if (typeof options.loadStore !== 'function' || typeof options.saveStore !== 'function') {
      throw new Error('FILE backend requires loadStore and saveStore functions.');
    }
    return {
      backend: 'FILE',
      load: () => options.loadStore(),
      save: store => options.saveStore(store),
      close() {},
    };
  }

  const handle = createSqliteHandle(options);
  return {
    backend: 'SQLITE',
    dbPath: handle.dbPath,
    load() {
      const fromDb = handle.load();
      if (fromDb) {
        return typeof options.normalizeStore === 'function'
          ? options.normalizeStore(fromDb)
          : fromDb;
      }
      if (typeof options.loadStore === 'function') {
        const seeded = options.loadStore();
        handle.save(seeded);
        return seeded;
      }
      const empty = typeof options.defaultStore === 'function' ? options.defaultStore() : { version: 2 };
      handle.save(empty);
      return typeof options.normalizeStore === 'function' ? options.normalizeStore(empty) : empty;
    },
    save(store) {
      handle.save(store);
    },
    close: () => handle.close(),
  };
}

/**
 * Low-risk entry used by the server: FILE delegates to existing fns; SQLITE loads blob into memory.
 */
function loadStoreViaAdapter(options = {}) {
  const adapter = createStoreAdapter(options);
  const store = adapter.load();
  return { adapter, store };
}

function writeStoreViaAdapter(adapter, store) {
  if (!adapter || typeof adapter.save !== 'function') {
    throw new Error('Invalid store adapter.');
  }
  adapter.save(store);
}

module.exports = {
  STORE_ARRAY_KEYS,
  SCHEMA_FILE,
  resolveBackend,
  resolveSqlitePath,
  tryOpenSqlite,
  migrateSchema,
  countStoreEntities,
  projectEntities,
  upsertBlob,
  saveStoreToSqlite,
  loadStoreFromSqlite,
  createSqliteHandle,
  createStoreAdapter,
  loadStoreViaAdapter,
  writeStoreViaAdapter,
};
