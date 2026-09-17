'use strict';

const { createHash } = require('crypto');

/**
 * PostgreSQL store backend for API Console.
 * Keeps the same in-memory document shape used by FILE/SQLITE adapters.
 * save() is synchronous (queues a flush); loadAsync()/drain() are async.
 */

function tryRequirePrisma() {
  try {
    // Generated client lives under apps/api/node_modules or hoisted root
    const { PrismaClient } = require('@prisma/client');
    return PrismaClient;
  } catch {
    return null;
  }
}

function rowHash(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function asDate(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function asIso(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

const DB_SHARING_STATUSES = new Set([
  'PRIVATE', 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED', 'DEPRECATED', 'UNLISTED', 'REMOVED',
]);

function normalizeSharingStatusForDb(status) {
  if (!status) return null;
  const value = String(status);
  if (DB_SHARING_STATUSES.has(value)) return value;
  // Legacy / unknown values stay out of the enum column.
  return null;
}

function normalizeSharingStatusFromDb(status) {
  if (!status) return undefined;
  if (status === 'PRIVATE') return 'DRAFT';
  if (status === 'REJECTED') return 'RETURNED';
  return status;
}

function asDbText(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asDbFolderPath(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join('/') || null;
  return String(value);
}

function parseMaybeJson(value) {
  if (value == null || value === '') return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeEnvironmentKindForDb(kind) {
  const value = String(kind || '').toUpperCase();
  if (value === 'PRE_PRODUCTION' || value === 'PREPROD') return 'PREPROD';
  if (value === 'DEVELOPMENT') return 'DEVELOPMENT';
  if (value === 'TEST') return 'TEST';
  if (value === 'PRODUCTION') return 'PRODUCTION';
  if (value === 'CUSTOM') return 'CUSTOM';
  return null;
}

function normalizeEnvironmentKindFromDb(kind) {
  if (kind === 'PREPROD') return 'PRE_PRODUCTION';
  return kind || undefined;
}

function normalizeVisibilityForDb(visibility) {
  const value = String(visibility || '').toUpperCase();
  if (value === 'PRIVATE' || value === 'PROJECT_SHARED') return value;
  return null;
}

function normalizeExecutionStatusForDb(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'COMPLETED' || value === 'SUCCEEDED' || value === 'SUCCESS') return 'SUCCEEDED';
  if (value === 'FAILED' || value === 'BLOCKED' || value === 'ERROR') return 'FAILED';
  if (value === 'CANCELLED' || value === 'CANCELED') return 'CANCELLED';
  if (value === 'PENDING') return 'PENDING';
  if (value === 'RUNNING') return 'RUNNING';
  if (value === 'QUEUED') return 'QUEUED';
  return null;
}

function normalizeExecutionStatusFromDb(status) {
  if (status === 'SUCCEEDED') return 'COMPLETED';
  return status || undefined;
}

function normalizeShareRequestStatusForDb(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'DRAFT') return 'DRAFT';
  if (value === 'PENDING_REVIEW' || value === 'SUBMITTED') return 'SUBMITTED';
  if (value === 'APPROVED') return 'APPROVED';
  if (value === 'RETURNED') return 'RETURNED';
  if (value === 'REJECTED') return 'REJECTED';
  return null;
}

/** Map Prisma rows back to the in-memory store document shape. */
function hydrateStoreFromRows(rows) {
  const store = {
    version: 2,
    collections: rows.collections || [],
    requests: rows.requests || [],
    executions: rows.executions || [],
    importedCurls: rows.importedCurls || [],
    manualExamples: rows.manualExamples || [],
    documentationResults: rows.documentationResults || [],
    shareRequests: rows.shareRequests || [],
    consumers: rows.consumers || [],
    references: rows.references || [],
    usageEvents: rows.usageEvents || [],
    readReceipts: rows.readReceipts || [],
    notifications: rows.notifications || [],
    directoryUsers: rows.directoryUsers || [],
    directoryRoleAssignments: rows.directoryRoleAssignments || [],
    runtimeProfiles: rows.runtimeProfiles || [],
    discoverySnapshots: rows.discoverySnapshots || [],
    environments: rows.environments || [],
    runners: rows.runners || [],
    globalVariables: rows.globalVariables || [],
    auditLog: rows.auditLog || [],
    testRuns: rows.testRuns || [],
    mocks: rows.mocks || [],
    mockCallLogs: rows.mockCallLogs || [],
    jitAccessGrants: rows.jitAccessGrants || [],
    contractBaselines: rows.contractBaselines || [],
    portalShareTokens: rows.portalShareTokens || [],
    orgPolicies: rows.orgPolicies || {},
    dualApprovals: rows.dualApprovals || [],
    itsmWebhookQueue: rows.itsmWebhookQueue || [],
    branding: rows.branding || undefined,
    executionQueue: rows.executionQueue || [],
    zoneWorkerHeartbeat: rows.zoneWorkerHeartbeat || null,
  };
  return store;
}

function stripExtra(row) {
  if (!row || typeof row !== 'object') return row;
  const { extra, ...rest } = row;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    return { ...extra, ...rest };
  }
  return rest;
}

function entityToDb(entity, knownKeys) {
  if (!entity || typeof entity !== 'object') return { id: String(Math.random()), extra: entity };
  const known = {};
  const extra = {};
  for (const [key, value] of Object.entries(entity)) {
    if (knownKeys.has(key)) known[key] = value;
    else extra[key] = value;
  }
  return { ...known, extra: Object.keys(extra).length ? extra : undefined };
}

const COLLECTION_KEYS = new Set(['id', 'originId', 'applicationId', 'workspaceName', 'name', 'description', 'ownerId', 'status', 'visibility', 'variables', 'authenticationDocumentationProfileId', 'createdAt', 'updatedAt']);
const REQUEST_KEYS = new Set(['id', 'originId', 'collectionId', 'applicationId', 'apiId', 'semanticVersion', 'sharingStatus', 'sourceType', 'referenceId', 'sourceRequestId', 'shareRequestId', 'name', 'method', 'urlTemplate', 'folderPath', 'queryParameters', 'headers', 'cookies', 'bodyType', 'bodyTemplate', 'authentication', 'tls', 'executionMode', 'classification', 'environmentId', 'runnerId', 'assertions', 'scripts', 'documentation', 'version', 'status', 'runtimeBinding', 'isGatewayBinding', 'sourceSync', 'visibility', 'coOwnerIds', 'ownerId', 'createdAt', 'updatedAt']);

function createPostgresStore(options = {}) {
  const PrismaClient = tryRequirePrisma();
  if (!PrismaClient) {
    const err = new Error('POSTGRES backend requires @prisma/client. Run: npm install && npx prisma generate');
    err.code = 'PRISMA_UNAVAILABLE';
    throw err;
  }

  const prisma = options.prisma || new PrismaClient();
  let flushQueue = Promise.resolve();
  let pendingStore = null;
  let lastHashes = new Map();
  let closed = false;

  async function loadAllRows() {
    const [
      collections,
      requests,
      executions,
      importedCurls,
      manualExamples,
      documentationResults,
      shareRequests,
      consumers,
      references,
      usageEvents,
      readReceipts,
      notifications,
      directoryUsers,
      directoryRoleAssignments,
      runtimeProfiles,
      discoverySnapshots,
      environments,
      runners,
      globalVariables,
      auditLog,
      testRuns,
      mocks,
      mockCallLogs,
      jitAccessGrants,
      contractBaselines,
      portalShareTokens,
      orgPolicies,
      dualApprovals,
      itsmWebhookQueue,
      branding,
      executionQueue,
      zoneWorker,
    ] = await Promise.all([
      prisma.collection.findMany(),
      prisma.request.findMany(),
      prisma.execution.findMany(),
      prisma.importedCurl.findMany(),
      prisma.manualExample.findMany(),
      prisma.documentationResult.findMany(),
      prisma.shareRequest.findMany(),
      prisma.consumer.findMany(),
      prisma.reference.findMany(),
      prisma.usageEvent.findMany(),
      prisma.readReceipt.findMany(),
      prisma.notification.findMany(),
      prisma.directoryUser.findMany(),
      prisma.directoryRoleAssignment.findMany(),
      prisma.runtimeProfile.findMany(),
      prisma.discoverySnapshot.findMany(),
      prisma.environment.findMany(),
      prisma.runner.findMany(),
      prisma.globalVariable.findMany(),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
      prisma.testRun.findMany(),
      prisma.mock.findMany(),
      prisma.mockCallLog.findMany(),
      prisma.jitAccessGrant.findMany(),
      prisma.contractBaseline.findMany(),
      prisma.portalShareToken.findMany(),
      prisma.orgPolicy.findMany(),
      prisma.dualApproval.findMany(),
      prisma.itsmWebhookQueueItem.findMany(),
      prisma.brandingTemplate.findMany(),
      prisma.executionQueueItem.findMany(),
      prisma.zoneWorkerState.findUnique({ where: { id: 'main' } }),
    ]);

    const mapRow = row => {
      if (!row) return null;
      const plain = { ...row };
      // Convert Date fields to ISO strings for in-memory compatibility
      for (const [k, v] of Object.entries(plain)) {
        if (v instanceof Date) plain[k] = v.toISOString();
      }
      return stripExtra(plain);
    };

    let orgPoliciesObj = {};
    if (orgPolicies.length === 1 && orgPolicies[0].payload && typeof orgPolicies[0].payload === 'object') {
      orgPoliciesObj = { ...orgPolicies[0].payload, updatedAt: asIso(orgPolicies[0].updatedAt), updatedBy: orgPolicies[0].updatedBy };
    } else if (orgPolicies.length) {
      orgPoliciesObj = orgPolicies.map(mapRow);
    }

    let brandingObj;
    if (branding[0]) {
      brandingObj = {
        activeTemplateId: branding[0].activeTemplateId,
        templates: branding[0].templates || [],
        ...(branding[0].extra && typeof branding[0].extra === 'object' ? branding[0].extra : {}),
      };
    }

    return hydrateStoreFromRows({
      collections: collections.map(mapRow),
      requests: requests.map(row => {
        const mapped = mapRow(row);
        if (!mapped) return mapped;
        if (mapped.sharingStatus) mapped.sharingStatus = normalizeSharingStatusFromDb(mapped.sharingStatus);
        mapped.folderPath = mapped.folderPath
          ? (String(mapped.folderPath).includes('/') ? String(mapped.folderPath).split('/').filter(Boolean) : [String(mapped.folderPath)])
          : [];
        mapped.classification = parseMaybeJson(mapped.classification);
        if (mapped.version != null && mapped.version !== '' && !Number.isNaN(Number(mapped.version))) {
          mapped.version = Number(mapped.version);
        }
        return mapped;
      }),
      executions: executions.map(row => {
        const mapped = mapRow(row);
        if (mapped?.status) mapped.status = normalizeExecutionStatusFromDb(mapped.status);
        return mapped;
      }),
      importedCurls: importedCurls.map(mapRow),
      manualExamples: manualExamples.map(mapRow),
      documentationResults: documentationResults.map(mapRow),
      shareRequests: shareRequests.map(mapRow),
      consumers: consumers.map(mapRow),
      references: references.map(mapRow),
      usageEvents: usageEvents.map(mapRow),
      readReceipts: readReceipts.map(mapRow),
      notifications: notifications.map(mapRow),
      directoryUsers: directoryUsers.map(mapRow),
      directoryRoleAssignments: directoryRoleAssignments.map(mapRow),
      runtimeProfiles: runtimeProfiles.map(mapRow),
      discoverySnapshots: discoverySnapshots.map(mapRow),
      environments: environments.map(row => {
        const mapped = mapRow(row);
        if (mapped?.kind) mapped.kind = normalizeEnvironmentKindFromDb(mapped.kind);
        return mapped;
      }),
      runners: runners.map(mapRow),
      globalVariables: globalVariables.map(mapRow),
      auditLog: auditLog.map(mapRow),
      testRuns: testRuns.map(mapRow),
      mocks: mocks.map(mapRow),
      mockCallLogs: mockCallLogs.map(mapRow),
      jitAccessGrants: jitAccessGrants.map(mapRow),
      contractBaselines: contractBaselines.map(mapRow),
      portalShareTokens: portalShareTokens.map(mapRow),
      orgPolicies: orgPoliciesObj,
      dualApprovals: dualApprovals.map(mapRow),
      itsmWebhookQueue: itsmWebhookQueue.map(mapRow),
      branding: brandingObj,
      executionQueue: executionQueue.map(mapRow),
      zoneWorkerHeartbeat: zoneWorker?.heartbeatAt ? asIso(zoneWorker.heartbeatAt) : null,
    });
  }

  async function upsertArray(tx, model, items, idField = 'id') {
    const list = Array.isArray(items) ? items : [];
    const ids = new Set();
    for (const item of list) {
      if (!item || !item[idField]) continue;
      const id = String(item[idField]);
      ids.add(id);
      const hash = rowHash(item);
      const hashKey = `${model}:${id}`;
      if (lastHashes.get(hashKey) === hash) continue;
      const data = { ...item };
      // Normalize date-ish fields
      for (const key of Object.keys(data)) {
        if (/At$|Date$|createdAt|updatedAt|expiresAt|startedAt|completedAt|importedAt|enteredAt|reviewedAt|notifiedAt|readAt|requestedAt|approvedAt|revokedAt|deliveredAt|eventAt|syncedAt|heartbeatAt/.test(key) && typeof data[key] === 'string') {
          const d = asDate(data[key]);
          if (d) data[key] = d;
        }
      }
      await tx[model].upsert({
        where: { [idField]: id },
        create: data,
        update: data,
      });
      lastHashes.set(hashKey, hash);
    }
    // Delete removed rows (best-effort for small tables)
    try {
      const existing = await tx[model].findMany({ select: { [idField]: true } });
      for (const row of existing) {
        const id = String(row[idField]);
        if (!ids.has(id)) {
          await tx[model].delete({ where: { [idField]: id } }).catch(() => undefined);
          lastHashes.delete(`${model}:${id}`);
        }
      }
    } catch {
      // skip delete sync on partial models
    }
  }

  async function flushStore(store) {
    if (!store || closed) return;
    await prisma.$transaction(async tx => {
      // Identity
      await upsertArray(tx, 'directoryUser', (store.directoryUsers || []).map(u => {
        const mapped = entityToDb(u, new Set([
          'id', 'originId', 'fullName', 'phoneNumber', 'email', 'username', 'passwordHash',
          'passwordUpdatedAt', 'lastLoginAt', 'source', 'isActive', 'createdAt', 'updatedAt',
        ]));
        return {
          id: String(u.id),
          originId: u.originId || null,
          fullName: String(u.fullName || u.displayName || u.id),
          phoneNumber: u.phoneNumber || null,
          email: u.email || null,
          username: u.username || null,
          passwordHash: u.passwordHash || null,
          passwordUpdatedAt: asDate(u.passwordUpdatedAt) || null,
          lastLoginAt: asDate(u.lastLoginAt) || null,
          source: u.source || 'CDE',
          isActive: u.isActive !== false,
          createdAt: asDate(u.createdAt) || new Date(),
          updatedAt: asDate(u.updatedAt) || new Date(),
          extra: mapped.extra,
        };
      }));

      await upsertArray(tx, 'directoryRoleAssignment', (store.directoryRoleAssignments || []).map(a => ({
        id: String(a.id),
        originId: a.originId || null,
        userId: String(a.userId),
        role: a.role || 'DEVELOPER',
        applicationId: a.applicationId || null,
        scope: a.scope || null,
        isActive: a.isActive !== false,
        source: a.source || 'SESSION_SYNC',
        createdBy: a.createdBy || null,
        updatedBy: a.updatedBy || null,
        createdAt: asDate(a.createdAt) || new Date(),
        updatedAt: asDate(a.updatedAt) || null,
        extra: entityToDb(a, new Set(['id', 'originId', 'userId', 'role', 'applicationId', 'scope', 'isActive', 'source', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt'])).extra,
      })));

      // Catalog
      await upsertArray(tx, 'collection', (store.collections || []).map(c => {
        const mapped = entityToDb(c, COLLECTION_KEYS);
        return {
          id: String(c.id),
          originId: c.originId || null,
          applicationId: c.applicationId || null,
          workspaceName: c.workspaceName || null,
          name: String(c.name || c.id),
          description: c.description || null,
          ownerId: c.ownerId || null,
          status: c.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
          visibility: c.visibility || 'PRIVATE',
          variables: c.variables ?? null,
          authenticationDocumentationProfileId: c.authenticationDocumentationProfileId || null,
          createdAt: asDate(c.createdAt) || new Date(),
          updatedAt: asDate(c.updatedAt) || new Date(),
          extra: mapped.extra,
        };
      }));

      await upsertArray(tx, 'request', (store.requests || []).map(r => {
        const mapped = entityToDb(r, REQUEST_KEYS);
        return {
          id: String(r.id),
          originId: r.originId || null,
          collectionId: String(r.collectionId),
          applicationId: r.applicationId || null,
          apiId: r.apiId || null,
          semanticVersion: r.semanticVersion || null,
          sharingStatus: normalizeSharingStatusForDb(r.sharingStatus),
          sourceType: r.sourceType || null,
          referenceId: r.referenceId || null,
          sourceRequestId: r.sourceRequestId || null,
          shareRequestId: r.shareRequestId || null,
          name: String(r.name || r.id),
          method: String(r.method || 'GET'),
          urlTemplate: r.urlTemplate || null,
          folderPath: asDbFolderPath(r.folderPath),
          queryParameters: r.queryParameters ?? null,
          headers: r.headers ?? null,
          cookies: r.cookies ?? null,
          bodyType: r.bodyType || null,
          bodyTemplate: r.bodyTemplate || null,
          authentication: r.authentication ?? null,
          tls: r.tls ?? null,
          executionMode: r.executionMode || null,
          classification: asDbText(r.classification),
          environmentId: r.environmentId || null,
          runnerId: r.runnerId || null,
          assertions: r.assertions ?? null,
          scripts: r.scripts ?? null,
          documentation: r.documentation ?? null,
          version: r.version == null ? null : String(r.version),
          status: r.status || null,
          runtimeBinding: r.runtimeBinding ?? null,
          isGatewayBinding: r.isGatewayBinding ?? null,
          sourceSync: r.sourceSync ?? null,
          visibility: normalizeVisibilityForDb(r.visibility),
          coOwnerIds: r.coOwnerIds ?? null,
          ownerId: r.ownerId || null,
          createdAt: asDate(r.createdAt) || new Date(),
          updatedAt: asDate(r.updatedAt) || new Date(),
          extra: mapped.extra,
        };
      }));

      // Environments / runners
      await upsertArray(tx, 'environment', (store.environments || []).map(e => ({
        id: String(e.id),
        originId: e.originId || null,
        name: String(e.name || e.id),
        kind: normalizeEnvironmentKindForDb(e.kind),
        baseUrl: e.baseUrl || null,
        variables: e.variables ?? null,
        defaultHeaders: e.defaultHeaders ?? null,
        secretReferences: e.secretReferences ?? null,
        productionProtected: Boolean(e.productionProtected),
        archived: Boolean(e.archived),
        seeded: Boolean(e.seeded),
        clonedFrom: e.clonedFrom || null,
        authenticationDocumentationProfileId: e.authenticationDocumentationProfileId || null,
        runnerId: e.runnerId || null,
        webhookUrl: e.webhookUrl || null,
        webhookSecret: e.webhookSecret || null,
        createdAt: asDate(e.createdAt) || new Date(),
        updatedAt: asDate(e.updatedAt) || new Date(),
        extra: entityToDb(e, new Set(['id', 'originId', 'name', 'kind', 'baseUrl', 'variables', 'defaultHeaders', 'secretReferences', 'productionProtected', 'archived', 'seeded', 'clonedFrom', 'authenticationDocumentationProfileId', 'runnerId', 'webhookUrl', 'webhookSecret', 'createdAt', 'updatedAt'])).extra,
      })));

      await upsertArray(tx, 'runner', (store.runners || []).map(r => ({
        id: String(r.id),
        originId: r.originId || null,
        name: String(r.name || r.id),
        networkZone: r.networkZone || null,
        enabled: r.enabled !== false,
        allowedOriginPatterns: r.allowedOriginPatterns ?? null,
        createdAt: asDate(r.createdAt) || new Date(),
        updatedAt: asDate(r.updatedAt) || new Date(),
        extra: entityToDb(r, new Set(['id', 'originId', 'name', 'networkZone', 'enabled', 'allowedOriginPatterns', 'createdAt', 'updatedAt'])).extra,
      })));

      await upsertArray(tx, 'globalVariable', (store.globalVariables || []).map(v => ({
        id: String(v.id),
        originId: v.originId || null,
        key: String(v.key || v.id),
        currentValue: v.currentValue ?? null,
        initialValue: v.initialValue ?? null,
        sensitive: Boolean(v.sensitive),
        scope: v.scope || 'GLOBAL',
        description: v.description || null,
        extra: entityToDb(v, new Set(['id', 'originId', 'key', 'currentValue', 'initialValue', 'sensitive', 'scope', 'description'])).extra,
      })));

      await upsertArray(tx, 'runtimeProfile', (store.runtimeProfiles || []).map(p => ({
        id: String(p.id),
        originId: p.originId || null,
        applicationId: p.applicationId || null,
        projectKey: p.projectKey || null,
        name: String(p.name || p.id),
        kind: p.kind || null,
        origin: p.origin || null,
        coreBasePath: p.coreBasePath || null,
        loginPath: p.loginPath || null,
        appRefererPath: p.appRefererPath || null,
        runtimeServiceId: p.runtimeServiceId || null,
        projectServiceId: p.projectServiceId || null,
        serviceIdEvidence: p.serviceIdEvidence ?? null,
        userSource: p.userSource || null,
        prostage: p.prostage || null,
        dataService: p.dataService ?? null,
        enabled: p.enabled !== false,
        rowVersion: p.rowVersion || null,
        createdBy: p.createdBy || null,
        updatedBy: p.updatedBy || null,
        createdAt: asDate(p.createdAt) || new Date(),
        updatedAt: asDate(p.updatedAt) || new Date(),
        extra: entityToDb(p, new Set(['id', 'originId', 'applicationId', 'projectKey', 'name', 'kind', 'origin', 'coreBasePath', 'loginPath', 'appRefererPath', 'runtimeServiceId', 'projectServiceId', 'serviceIdEvidence', 'userSource', 'prostage', 'dataService', 'enabled', 'rowVersion', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt'])).extra,
      })));

      await upsertArray(tx, 'auditLog', (store.auditLog || []).slice(0, 500).map(a => ({
        id: String(a.id),
        originId: a.originId || null,
        eventType: String(a.eventType || 'UNKNOWN'),
        actorUserId: a.actorUserId || null,
        actorRole: a.actorRole || null,
        details: a.details ?? null,
        createdAt: asDate(a.createdAt) || new Date(),
        extra: entityToDb(a, new Set(['id', 'originId', 'eventType', 'actorUserId', 'actorRole', 'details', 'createdAt'])).extra,
      })));

      await upsertArray(tx, 'notification', (store.notifications || []).map(n => ({
        id: String(n.id),
        originId: n.originId || null,
        userId: n.userId || null,
        title: n.title || null,
        message: n.message || null,
        type: n.type || null,
        entityType: n.entityType || null,
        entityId: n.entityId || null,
        channels: n.channels ?? null,
        deliveryStatus: n.deliveryStatus || null,
        correlationId: n.correlationId || null,
        isRead: Boolean(n.isRead),
        createdAt: asDate(n.createdAt) || new Date(),
        readAt: asDate(n.readAt) || null,
        extra: entityToDb(n, new Set(['id', 'originId', 'userId', 'title', 'message', 'type', 'entityType', 'entityId', 'channels', 'deliveryStatus', 'correlationId', 'isRead', 'createdAt', 'readAt'])).extra,
      })));

      // Org policies (singleton object or array)
      const policies = store.orgPolicies;
      if (policies && typeof policies === 'object' && !Array.isArray(policies)) {
        await tx.orgPolicy.upsert({
          where: { id: 'main' },
          create: {
            id: 'main',
            policyKey: 'main',
            payload: policies,
            updatedAt: asDate(policies.updatedAt) || new Date(),
            updatedBy: policies.updatedBy || null,
          },
          update: {
            payload: policies,
            updatedAt: asDate(policies.updatedAt) || new Date(),
            updatedBy: policies.updatedBy || null,
          },
        });
      }

      // Branding singleton
      if (store.branding && typeof store.branding === 'object') {
        await tx.brandingTemplate.upsert({
          where: { id: 'main' },
          create: {
            id: 'main',
            activeTemplateId: store.branding.activeTemplateId || null,
            templates: store.branding.templates || [],
            updatedAt: new Date(),
          },
          update: {
            activeTemplateId: store.branding.activeTemplateId || null,
            templates: store.branding.templates || [],
            updatedAt: new Date(),
          },
        });
      }

      // Zone worker heartbeat
      if (store.zoneWorkerHeartbeat) {
        await tx.zoneWorkerState.upsert({
          where: { id: 'main' },
          create: { id: 'main', heartbeatAt: asDate(store.zoneWorkerHeartbeat) || new Date() },
          update: { heartbeatAt: asDate(store.zoneWorkerHeartbeat) || new Date() },
        });
      }

      // Remaining array entities with payload-in-extra pattern for speed
      const simpleMaps = [
        ['importedCurl', store.importedCurls, ['id', 'originId', 'requestId', 'originalTextReference', 'sanitizedPreview', 'detectedDialect', 'parserVersion', 'importedBy', 'importedAt']],
        ['manualExample', store.manualExamples, ['id', 'originId', 'requestId', 'statusCode', 'headers', 'body', 'claimedEnvironmentId', 'source', 'reason', 'enteredBy', 'enteredAt', 'reviewStatus', 'reviewedBy', 'evidenceAttachmentId']],
        ['documentationResult', store.documentationResults, ['id', 'originId', 'requestId', 'generatedAt', 'generatedBy', 'approved', 'markdown', 'warnings', 'wordDocumentBase64', 'wordFileName', 'wordMimeType']],
        ['shareRequest', store.shareRequests, ['id', 'originId', 'requestId', 'apiId', 'apiTitle', 'applicationId', 'version', 'submittedBy', 'status', 'currentRevisionNumber', 'purpose', 'introduction', 'description', 'ticketId', 'ticketUrl', 'returnReason', 'reviewedBy', 'reviewedAt', 'comments', 'checklist', 'rowVersion', 'createdAt', 'updatedAt']],
        ['consumer', store.consumers, ['id', 'originId', 'apiId', 'version', 'consumerType', 'userId', 'roleKey', 'applicationId', 'status', 'createdBy', 'createdAt', 'updatedAt']],
        ['reference', store.references, ['id', 'originId', 'apiId', 'version', 'sourceRequestId', 'requestId', 'collectionId', 'applicationId', 'createdBy', 'status', 'createdAt', 'removedAt']],
        ['usageEvent', store.usageEvents, ['id', 'originId', 'eventType', 'userId', 'userDisplayName', 'activeRole', 'applicationId', 'apiId', 'apiTitle', 'version', 'referenceId', 'eventAt', 'environmentId', 'correlationId']],
        ['readReceipt', store.readReceipts, ['id', 'originId', 'userId', 'apiId', 'version', 'notifiedAt', 'readAt']],
        ['discoverySnapshot', store.discoverySnapshots, ['id', 'originId', 'projectKey', 'applicationId', 'runtimeProfileId', 'status', 'parserVersion', 'serviceIdStatus', 'projectServiceIdCandidates', 'operations', 'removedOperations', 'warnings', 'stats', 'sourceFingerprint', 'scannedBy', 'createdAt']],
        ['testRun', store.testRuns, ['id', 'originId', 'collectionId', 'applicationId', 'environmentId', 'actorUserId', 'actorRole', 'stopOnFail', 'summary', 'webhookDelivery', 'createdAt']],
        ['mock', store.mocks, ['id', 'originId', 'requestId', 'collectionId', 'applicationId', 'environmentId', 'method', 'pathMatch', 'statusCode', 'responseBody', 'responseHeaders', 'status', 'expiresAt', 'hitCount', 'createdBy', 'createdAt', 'updatedAt']],
        ['mockCallLog', store.mockCallLogs, ['id', 'originId', 'mockId', 'method', 'path', 'at', 'applicationId']],
        ['jitAccessGrant', store.jitAccessGrants, ['id', 'originId', 'userId', 'applicationId', 'reason', 'status', 'requestedAt', 'expiresAt', 'approvedBy', 'approvedAt', 'revokedAt']],
        ['contractBaseline', store.contractBaselines, ['id', 'originId', 'collectionId', 'applicationId', 'name', 'fingerprint', 'schemaSummary', 'version', 'spec', 'createdAt', 'createdBy']],
        ['portalShareToken', store.portalShareTokens, ['id', 'originId', 'token', 'tokenHash', 'apiId', 'version', 'requestId', 'applicationId', 'expiresAt', 'createdBy', 'createdAt', 'urlPath']],
        ['dualApproval', store.dualApprovals, ['id', 'originId', 'requestId', 'userId', 'applicationId', 'reason', 'status', 'requestedAt', 'approvedBy', 'approvedAt', 'expiresAt']],
        ['itsmWebhookQueueItem', store.itsmWebhookQueue, ['id', 'originId', 'eventType', 'payload', 'status', 'attempts', 'lastError', 'createdAt', 'deliveredAt']],
        ['execution', store.executions, ['id', 'originId', 'requestId', 'collectionId', 'environmentId', 'runnerId', 'operationId', 'applicationId', 'runtimeProfileId', 'sourceKind', 'executedBy', 'status', 'statusCode', 'responseSize', 'durationMs', 'correlationId', 'startedAt', 'completedAt', 'requestSnapshot', 'response', 'tlsVerification', 'transportResult', 'businessResult', 'assertionResults', 'scriptResults', 'errorCategory', 'sanitizedError', 'environmentName', 'evidenceType', 'businessJustification', 'queueJobId', 'networkZone', 'runnerHost']],
        ['executionQueueItem', store.executionQueue, ['id', 'status', 'requestId', 'collectionId', 'environmentId', 'environmentName', 'runnerId', 'networkZone', 'runnerHost', 'executedBy', 'startedAt', 'createdAt', 'businessJustification', 'requestSnapshot', 'transport', 'assertions', 'scripts', 'preScriptResults', 'errorCategory', 'errorMessage']],
      ];

      for (const [model, items, keys] of simpleMaps) {
        const keySet = new Set(keys);
        await upsertArray(tx, model, (items || []).map(item => {
          if (!item?.id) return null;
          const mapped = entityToDb(item, keySet);
          const data = { id: String(item.id), extra: mapped.extra };
          for (const key of keys) {
            if (key === 'id') continue;
            let value = item[key];
            if (value === undefined) {
              // Prisma Int/required fields cannot be null — use safe defaults.
              if (key === 'attempts' || key === 'hitCount') data[key] = 0;
              else data[key] = null;
              continue;
            }
            if (key === 'attempts' || key === 'hitCount') {
              data[key] = Number(value) || 0;
              continue;
            }
            if (key === 'status' && model === 'execution') {
              data[key] = normalizeExecutionStatusForDb(value);
              continue;
            }
            if (key === 'status' && model === 'shareRequest') {
              data[key] = normalizeShareRequestStatusForDb(value);
              continue;
            }
            if (key === 'networkZone') {
              const zone = String(value || '').toUpperCase();
              data[key] = ['PUBLIC', 'INTERNAL', 'RESTRICTED', 'TEST'].includes(zone) ? zone : null;
              continue;
            }
            if (typeof value === 'string' && /At$|Date$|createdAt|updatedAt|expiresAt|startedAt|completedAt|importedAt|enteredAt|reviewedAt|notifiedAt|readAt|requestedAt|approvedAt|revokedAt|deliveredAt|eventAt|syncedAt/.test(key)) {
              value = asDate(value) || value;
            }
            data[key] = value;
          }
          return data;
        }).filter(Boolean));
      }
    }, { timeout: 120_000 });
  }

  function enqueueFlush(store) {
    pendingStore = store;
    flushQueue = flushQueue.then(async () => {
      const snapshot = pendingStore;
      pendingStore = null;
      if (!snapshot) return;
      try {
        await flushStore(snapshot);
      } catch (error) {
        console.error('[postgres-store] flush failed:', error.message || error);
      }
    });
    return flushQueue;
  }

  return {
    backend: 'POSTGRES',
    prisma,
    async loadAsync() {
      return loadAllRows();
    },
    /** Sync API compatible with store-adapter — queues async flush. */
    save(store) {
      enqueueFlush(JSON.parse(JSON.stringify(store)));
    },
    async drain() {
      await flushQueue;
    },
    async close() {
      closed = true;
      await flushQueue;
      await prisma.$disconnect();
    },
    async recordLoginEvent(event) {
      try {
        await prisma.loginEvent.create({
          data: {
            userId: event.userId || null,
            kind: event.kind || 'SSO_PROBE',
            success: Boolean(event.success),
            reason: event.reason || null,
            originId: event.originId || null,
            details: event.details || null,
          },
        });
      } catch {
        // table may not exist yet during first boot
      }
    },
  };
}

module.exports = {
  createPostgresStore,
  tryRequirePrisma,
  hydrateStoreFromRows,
  rowHash,
};
