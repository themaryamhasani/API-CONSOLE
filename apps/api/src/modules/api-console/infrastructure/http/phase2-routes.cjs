'use strict';

/**
 * Phase 2 route handlers (E15–E20, E32–E33).
 * Returns a result object, or undefined to fall through to legacy routes.
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const MAX_CO_OWNERS = 5;
const REVIEW_CHECKLIST_KEYS = ['docsComplete', 'noSecrets', 'classificationOk', 'consumersSpecified'];

function createPhase2Router(deps) {
  const {
    ApiConsoleError,
    makeId,
    nowIso,
    safeClone,
    sanitizeText,
    requireContext,
    assertCsrf,
    roleAllowed,
    API_CONSOLE_POLICY,
    assertApplicationInContext,
    contextApplicationIds,
    matchesApplicationScope,
    paginate,
    audit,
    notifyUser,
    saveStore,
    getStore,
    setStoreField,
    belongsToUser,
    ensureRequestApiFields,
    protectRequestSecrets,
    semanticVersionOf,
    consumersForVersion,
    executeRequest,
    findEnvironment,
    assertCanReviewShares,
  } = deps;

  function store() {
    return getStore();
  }

  function canEditShared(entity, context) {
    if (!belongsToUser(entity, context)) return false;
    if (entity.ownerId === context.userId || entity.createdBy === context.userId) return true;
    if ((entity.coOwnerIds || []).includes(context.userId)) return true;
    if (entity.visibility === 'PROJECT_SHARED' && roleAllowed(context.role, API_CONSOLE_POLICY.canEdit)) return true;
    return false;
  }

  function projectActivity(applicationId, filters = {}) {
    const rows = (store().auditLog || [])
      .filter(item => {
        const details = item.details || {};
        const appId = details.applicationId || details.projectKey;
        if (appId && appId !== applicationId) return false;
        if (filters.actorUserId && item.actorUserId !== filters.actorUserId) return false;
        const allowed = new Set([
          'API_COLLECTION_CREATED', 'API_REQUEST_CREATED', 'API_REQUEST_UPDATED', 'API_SHARE_SUBMITTED',
          'API_SHARE_APPROVED', 'API_SHARE_RETURNED', 'API_EXECUTED', 'API_OWNERSHIP_TRANSFERRED',
          'API_CO_OWNERS_UPDATED', 'API_VERSION_CREATED', 'API_VERSION_DEPRECATED', 'COLLECTION_RUN_COMPLETED',
          'API_VISIBILITY_UPDATED', 'RUNTIME_PROFILE_PROMOTED',
        ]);
        if (!allowed.has(item.eventType) && !String(item.eventType || '').startsWith('API_')) return false;
        return true;
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return paginate(rows, filters.page || 1, filters.limit || 30);
  }

  function normalizeChecklist(input) {
    const source = input && typeof input === 'object' ? input : {};
    const next = {};
    REVIEW_CHECKLIST_KEYS.forEach(key => {
      next[key] = source[key] === true;
    });
    return next;
  }

  function checklistComplete(checklist) {
    return REVIEW_CHECKLIST_KEYS.every(key => checklist?.[key] === true);
  }

  async function deliverWebhook(url, secret, payload) {
    if (!url) return { skipped: true };
    const body = JSON.stringify(payload);
    const signature = secret
      ? crypto.createHmac('sha256', secret).update(body).digest('hex')
      : '';
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    const attempt = () => new Promise((resolve, reject) => {
      const req = lib.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(signature ? { 'x-api-console-signature': `sha256=${signature}` } : {}),
        },
        timeout: 8000,
      }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, statusCode: res.statusCode });
        else reject(new Error(`Webhook HTTP ${res.statusCode}`));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
      req.write(body);
      req.end();
    });
    let lastError = null;
    for (let i = 0; i < 3; i += 1) {
      try {
        return await attempt();
      } catch (error) {
        lastError = error;
      }
    }
    return { ok: false, error: lastError?.message || 'Webhook failed' };
  }

  async function runCollection(collectionId, context, options = {}) {
    const collection = store().collections.find(item => item.id === collectionId && item.status === 'ACTIVE');
    if (!collection || !belongsToUser(collection, context)) {
      throw new ApiConsoleError('INVALID_URL', 'Collection not found.', 404);
    }
    assertApplicationInContext(collection.applicationId, context);
    const stopOnFail = options.stopOnFail !== false;
    const environmentId = options.environmentId || '';
    let requestIds = Array.isArray(options.requestIds) ? options.requestIds.map(String) : [];
    const all = store().requests.filter(request =>
      request.collectionId === collectionId &&
      request.status !== 'ARCHIVED' &&
      belongsToUser(request, context)
    );
    if (!requestIds.length) requestIds = all.map(item => item.id);
    const selected = requestIds
      .map(id => all.find(item => item.id === id))
      .filter(Boolean);

    const results = [];
    let stopped = false;
    for (const request of selected) {
      if (stopped) {
        results.push({
          requestId: request.id,
          name: request.name,
          status: 'SKIPPED',
          transportResult: 'CANCELLED',
          businessResult: 'NOT_EVALUATED',
          assertionPassed: 0,
          assertionFailed: 0,
        });
        continue;
      }
      try {
        const execution = await executeRequest(request.id, context, {
          environmentId: environmentId || request.environmentId,
          runnerId: options.runnerId,
        });
        const assertionFailed = (execution.assertionResults || []).filter(item => item.result === 'FAILED').length;
        const assertionPassed = (execution.assertionResults || []).filter(item => item.result === 'PASSED').length;
        const failed = execution.transportResult === 'FAILED'
          || execution.transportResult === 'BLOCKED'
          || execution.businessResult === 'FAILED'
          || assertionFailed > 0;
        results.push({
          requestId: request.id,
          name: request.name,
          executionId: execution.id,
          status: failed ? 'FAILED' : 'PASSED',
          transportResult: execution.transportResult,
          businessResult: execution.businessResult,
          assertionPassed,
          assertionFailed,
        });
        if (failed && stopOnFail) stopped = true;
      } catch (error) {
        results.push({
          requestId: request.id,
          name: request.name,
          status: 'FAILED',
          transportResult: 'FAILED',
          businessResult: 'FAILED',
          error: error.message || String(error),
          assertionPassed: 0,
          assertionFailed: 0,
        });
        if (stopOnFail) stopped = true;
      }
    }

    const summary = {
      total: results.length,
      passed: results.filter(item => item.status === 'PASSED').length,
      failed: results.filter(item => item.status === 'FAILED').length,
      skipped: results.filter(item => item.status === 'SKIPPED').length,
    };
    const testRun = {
      id: makeId('testrun'),
      collectionId,
      applicationId: collection.applicationId,
      environmentId: environmentId || selected[0]?.environmentId || '',
      actorUserId: context.userId,
      actorRole: context.role,
      stopOnFail,
      results,
      summary,
      createdAt: nowIso(),
      webhookDelivery: null,
    };
    if (!Array.isArray(store().testRuns)) setStoreField('testRuns', []);
    store().testRuns.unshift(testRun);
    store().testRuns = store().testRuns.slice(0, 200);
    audit('COLLECTION_RUN_COMPLETED', context, {
      applicationId: collection.applicationId,
      collectionId,
      testRunId: testRun.id,
      summary,
    });

    const env = environmentId ? findEnvironment(environmentId) : null;
    const webhookUrl = options.webhookUrl || env?.webhookUrl || process.env.API_CONSOLE_RUN_WEBHOOK_URL || '';
    const webhookSecret = options.webhookSecret || env?.webhookSecret || process.env.API_CONSOLE_RUN_WEBHOOK_SECRET || '';
    if (webhookUrl) {
      testRun.webhookDelivery = await deliverWebhook(webhookUrl, webhookSecret, {
        event: 'COLLECTION_RUN_COMPLETED',
        testRunId: testRun.id,
        collectionId,
        summary,
        results,
        createdAt: testRun.createdAt,
      });
    }
    saveStore(store());
    return safeClone(testRun);
  }

  return async function tryHandlePhase2(req, parsedUrl, body, parts) {
    const [first, second, third, fourth] = parts;

    if (first === 'activity' && req.method === 'GET') {
      const context = requireContext(req, body);
      if (context.role !== 'SYSTEM_ADMIN') {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only SYSTEM_ADMIN can view activity feed.', 403);
      }
      const applicationId = assertApplicationInContext(
        parsedUrl.searchParams.get('applicationId') || context.applicationId,
        context
      );
      return safeClone(projectActivity(applicationId, {
        page: Number(parsedUrl.searchParams.get('page') || 1),
        limit: Number(parsedUrl.searchParams.get('limit') || 30),
        actorUserId: parsedUrl.searchParams.get('actorUserId') || '',
      }));
    }

    if (first === 'test-runs') {
      const context = requireContext(req, body);
      if (!second && req.method === 'GET') {
        const applicationId = parsedUrl.searchParams.get('applicationId') || context.applicationId;
        const collectionId = parsedUrl.searchParams.get('collectionId') || '';
        let rows = (store().testRuns || []).filter(run =>
          matchesApplicationScope(run.applicationId, context.scopeApplicationIds || context.applicationId) &&
          (!applicationId || applicationId === 'ALL' || run.applicationId === applicationId) &&
          (!collectionId || run.collectionId === collectionId)
        );
        return safeClone(paginate(rows, Number(parsedUrl.searchParams.get('page') || 1), Number(parsedUrl.searchParams.get('limit') || 20)));
      }
      if (second && req.method === 'GET') {
        const run = (store().testRuns || []).find(item => item.id === second);
        if (!run) throw new ApiConsoleError('INVALID_URL', 'Test run not found.', 404);
        assertApplicationInContext(run.applicationId, context);
        return safeClone(run);
      }
    }

    if (first === 'collections' && second && third === 'run' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      if (!roleAllowed(context.role, API_CONSOLE_POLICY.canExecute)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'User is not authorized to execute API requests.', 403);
      }
      return runCollection(second, context, body.options || body.data || body);
    }

    if (first === 'runners') {
      const context = requireContext(req, body);
      if (!second && req.method === 'GET') {
        return safeClone(store().runners || []);
      }
      if (!second && req.method === 'POST') {
        assertCsrf(req);
        if (context.role !== 'SYSTEM_ADMIN') throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only SYSTEM_ADMIN can manage runners.', 403);
        const data = body.data || body;
        const runner = {
          id: makeId('runner'),
          name: String(data.name || 'Runner').trim(),
          networkZone: String(data.networkZone || 'PUBLIC').toUpperCase(),
          allowedOriginPatterns: Array.isArray(data.allowedOriginPatterns) ? data.allowedOriginPatterns.map(String) : [],
          enabled: data.enabled !== false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        store().runners.unshift(runner);
        audit('RUNNER_CREATED', context, { runnerId: runner.id, networkZone: runner.networkZone });
        saveStore(store());
        return safeClone(runner);
      }
      if (second && req.method === 'PUT') {
        assertCsrf(req);
        if (context.role !== 'SYSTEM_ADMIN') throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only SYSTEM_ADMIN can manage runners.', 403);
        const runner = store().runners.find(item => item.id === second);
        if (!runner) throw new ApiConsoleError('INVALID_URL', 'Runner not found.', 404);
        const data = body.data || body;
        if (data.name !== undefined) runner.name = String(data.name).trim();
        if (data.networkZone !== undefined) runner.networkZone = String(data.networkZone).toUpperCase();
        if (data.allowedOriginPatterns !== undefined) {
          runner.allowedOriginPatterns = Array.isArray(data.allowedOriginPatterns) ? data.allowedOriginPatterns.map(String) : [];
        }
        if (data.enabled !== undefined) runner.enabled = data.enabled === true;
        runner.updatedAt = nowIso();
        audit('RUNNER_UPDATED', context, { runnerId: runner.id });
        saveStore(store());
        return safeClone(runner);
      }
      if (second && req.method === 'DELETE') {
        assertCsrf(req);
        if (context.role !== 'SYSTEM_ADMIN') throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only SYSTEM_ADMIN can manage runners.', 403);
        const runner = store().runners.find(item => item.id === second);
        if (!runner) throw new ApiConsoleError('INVALID_URL', 'Runner not found.', 404);
        runner.enabled = false;
        runner.updatedAt = nowIso();
        audit('RUNNER_DISABLED', context, { runnerId: runner.id });
        saveStore(store());
        return safeClone(runner);
      }
    }

    if (first === 'requests' && second && third === 'transfer' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const request = store().requests.find(item => item.id === second);
      if (!request || !belongsToUser(request, context)) throw new ApiConsoleError('INVALID_URL', 'Request not found.', 404);
      if (request.createdBy !== context.userId && context.role !== 'SYSTEM_ADMIN') {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only the owner can transfer ownership.', 403);
      }
      const targetUserId = String(body.targetUserId || body.data?.targetUserId || '').trim();
      if (!targetUserId) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'targetUserId is required.');
      const previousOwner = request.createdBy;
      request.createdBy = targetUserId;
      request.ownerId = targetUserId;
      request.coOwnerIds = (request.coOwnerIds || []).filter(id => id !== targetUserId);
      request.updatedBy = context.userId;
      request.updatedAt = nowIso();
      request.rowVersion = makeId('row');
      notifyUser(targetUserId, 'مالکیت API منتقل شد', `${request.name} به شما منتقل شد.`, 'API_REQUEST', request.id, makeId('api-corr'));
      notifyUser(previousOwner, 'مالکیت API منتقل شد', `مالکیت ${request.name} به کاربر دیگر منتقل شد.`, 'API_REQUEST', request.id, makeId('api-corr'));
      audit('API_OWNERSHIP_TRANSFERRED', context, {
        applicationId: request.applicationId,
        requestId: request.id,
        previousOwner,
        targetUserId,
      });
      saveStore(store());
      return safeClone(request);
    }

    if (first === 'requests' && second && third === 'co-owners' && req.method === 'PUT') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const request = store().requests.find(item => item.id === second);
      if (!request || !belongsToUser(request, context)) throw new ApiConsoleError('INVALID_URL', 'Request not found.', 404);
      if (request.createdBy !== context.userId && context.role !== 'SYSTEM_ADMIN') {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only the owner can manage co-owners.', 403);
      }
      const coOwnerIds = Array.isArray(body.coOwnerIds || body.data?.coOwnerIds)
        ? [...new Set((body.coOwnerIds || body.data.coOwnerIds).map(String).filter(Boolean))]
        : [];
      if (coOwnerIds.length > MAX_CO_OWNERS) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', `حداکثر ${MAX_CO_OWNERS} همکار مجاز است.`);
      }
      if (coOwnerIds.includes(request.createdBy)) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'مالک اصلی نباید در لیست co-owner باشد.');
      }
      request.coOwnerIds = coOwnerIds;
      request.updatedBy = context.userId;
      request.updatedAt = nowIso();
      coOwnerIds.forEach(userId => {
        notifyUser(userId, 'دسترسی ویرایش API', `شما co-owner درخواست ${request.name} شدید.`, 'API_REQUEST', request.id, makeId('api-corr'));
      });
      audit('API_CO_OWNERS_UPDATED', context, { applicationId: request.applicationId, requestId: request.id, coOwnerIds });
      saveStore(store());
      return safeClone(request);
    }

    if (first === 'requests' && second && third === 'visibility' && req.method === 'PUT') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const request = store().requests.find(item => item.id === second);
      if (!request || !canEditShared(request, context)) throw new ApiConsoleError('INVALID_URL', 'Request not found.', 404);
      const visibility = String(body.visibility || body.data?.visibility || 'PRIVATE').toUpperCase();
      if (!['PRIVATE', 'PROJECT_SHARED'].includes(visibility)) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'visibility باید PRIVATE یا PROJECT_SHARED باشد.');
      }
      request.visibility = visibility;
      request.updatedBy = context.userId;
      request.updatedAt = nowIso();
      audit('API_VISIBILITY_UPDATED', context, { applicationId: request.applicationId, requestId: request.id, visibility });
      saveStore(store());
      return safeClone(request);
    }

    if (first === 'collections' && second && third === 'visibility' && req.method === 'PUT') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const collection = store().collections.find(item => item.id === second);
      if (!collection || !belongsToUser(collection, context)) throw new ApiConsoleError('INVALID_URL', 'Collection not found.', 404);
      if (collection.ownerId !== context.userId && context.role !== 'SYSTEM_ADMIN') {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only collection owner can change visibility.', 403);
      }
      const visibility = String(body.visibility || body.data?.visibility || 'PRIVATE').toUpperCase();
      if (!['PRIVATE', 'PROJECT_SHARED'].includes(visibility)) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'visibility باید PRIVATE یا PROJECT_SHARED باشد.');
      }
      collection.visibility = visibility;
      collection.updatedAt = nowIso();
      audit('API_VISIBILITY_UPDATED', context, { applicationId: collection.applicationId, collectionId: collection.id, visibility });
      saveStore(store());
      return safeClone(collection);
    }

    if (first === 'repository' && second && third === 'versions' && fourth && parts[4] === 'deprecate' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const apiId = decodeURIComponent(second);
      const version = decodeURIComponent(fourth);
      const sourceRequest = store().requests.find(request =>
        request.apiId === apiId &&
        semanticVersionOf(request) === version &&
        request.sourceType !== 'REFERENCE' &&
        ['APPROVED', 'DEPRECATED', 'UNLISTED'].includes(request.sharingStatus)
      );
      if (!sourceRequest) throw new ApiConsoleError('INVALID_URL', 'Repository version not found.', 404);
      const isOwner = sourceRequest.createdBy === context.userId;
      const canManage = isOwner || context.role === 'SYSTEM_ADMIN' || roleAllowed(context.role, API_CONSOLE_POLICY.canReviewShares);
      if (!canManage) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to deprecate this version.', 403);
      const reason = String(body.reason || body.data?.reason || '').trim();
      if (!reason) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'دلیل منسوخ‌سازی الزامی است.');
      const effectiveAt = String(body.effectiveAt || body.data?.effectiveAt || nowIso());
      sourceRequest.sharingStatus = 'DEPRECATED';
      sourceRequest.deprecatedAt = nowIso();
      sourceRequest.deprecatedBy = context.userId;
      sourceRequest.deprecationReason = sanitizeText(reason);
      sourceRequest.deprecationEffectiveAt = effectiveAt;
      sourceRequest.updatedAt = nowIso();
      sourceRequest.updatedBy = context.userId;
      const correlationId = makeId('api-corr');
      consumersForVersion(apiId, version).forEach(consumer => {
        if (consumer.consumerType === 'USER' && consumer.userId) {
          notifyUser(consumer.userId, 'API منسوخ شد', `${sourceRequest.name} نسخه ${version}: ${reason}`, 'API_REQUEST', sourceRequest.id, correlationId);
        }
      });
      notifyUser(sourceRequest.createdBy, 'API منسوخ شد', `${sourceRequest.name} نسخه ${version} منسوخ شد.`, 'API_REQUEST', sourceRequest.id, correlationId);
      audit('API_VERSION_DEPRECATED', context, { applicationId: sourceRequest.applicationId, apiId, version, reason, effectiveAt });
      saveStore(store());
      return safeClone(sourceRequest);
    }

    if (first === 'repository' && second && third === 'versions' && fourth && parts[4] === 'unlist' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const apiId = decodeURIComponent(second);
      const version = decodeURIComponent(fourth);
      const sourceRequest = store().requests.find(request =>
        request.apiId === apiId &&
        semanticVersionOf(request) === version &&
        request.sourceType !== 'REFERENCE' &&
        ['APPROVED', 'DEPRECATED', 'UNLISTED'].includes(request.sharingStatus)
      );
      if (!sourceRequest) throw new ApiConsoleError('INVALID_URL', 'Repository version not found.', 404);
      const isOwner = sourceRequest.createdBy === context.userId;
      const canManage = isOwner || context.role === 'SYSTEM_ADMIN' || roleAllowed(context.role, API_CONSOLE_POLICY.canReviewShares);
      if (!canManage) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to hide this version.', 403);
      const reason = String(body.reason || body.data?.reason || 'مخفی‌سازی از نمایش مخزن').trim();
      sourceRequest.previousSharingStatus = sourceRequest.sharingStatus === 'UNLISTED'
        ? (sourceRequest.previousSharingStatus || 'APPROVED')
        : sourceRequest.sharingStatus;
      sourceRequest.sharingStatus = 'UNLISTED';
      sourceRequest.unlistedAt = nowIso();
      sourceRequest.unlistedBy = context.userId;
      sourceRequest.unlistReason = sanitizeText(reason);
      sourceRequest.updatedAt = nowIso();
      sourceRequest.updatedBy = context.userId;
      audit('API_VERSION_UNLISTED', context, { applicationId: sourceRequest.applicationId, apiId, version, reason });
      saveStore(store());
      return safeClone(sourceRequest);
    }

    if (first === 'repository' && second && third === 'versions' && fourth && parts[4] === 'remove' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const apiId = decodeURIComponent(second);
      const version = decodeURIComponent(fourth);
      const sourceRequest = store().requests.find(request =>
        request.apiId === apiId &&
        semanticVersionOf(request) === version &&
        request.sourceType !== 'REFERENCE' &&
        ['APPROVED', 'DEPRECATED', 'UNLISTED', 'REMOVED'].includes(request.sharingStatus)
      );
      if (!sourceRequest) throw new ApiConsoleError('INVALID_URL', 'Repository version not found.', 404);
      const isOwner = sourceRequest.createdBy === context.userId;
      const canManage = isOwner || context.role === 'SYSTEM_ADMIN' || roleAllowed(context.role, API_CONSOLE_POLICY.canReviewShares);
      if (!canManage) throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to remove this version.', 403);
      const reason = String(body.reason || body.data?.reason || 'حذف از مخزن').trim();
      sourceRequest.previousSharingStatus = sourceRequest.sharingStatus === 'REMOVED'
        ? (sourceRequest.previousSharingStatus || 'APPROVED')
        : sourceRequest.sharingStatus;
      sourceRequest.sharingStatus = 'REMOVED';
      sourceRequest.removedAt = nowIso();
      sourceRequest.removedBy = context.userId;
      sourceRequest.removalReason = sanitizeText(reason);
      sourceRequest.updatedAt = nowIso();
      sourceRequest.updatedBy = context.userId;
      audit('API_VERSION_REMOVED', context, { applicationId: sourceRequest.applicationId, apiId, version, reason });
      saveStore(store());
      return safeClone(sourceRequest);
    }

    if (first === 'repository' && second && third === 'versions' && fourth && parts[4] === 'restore' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const apiId = decodeURIComponent(second);
      const version = decodeURIComponent(fourth);
      const sourceRequest = store().requests.find(request =>
        request.apiId === apiId &&
        semanticVersionOf(request) === version &&
        request.sourceType !== 'REFERENCE' &&
        ['UNLISTED', 'REMOVED'].includes(request.sharingStatus)
      );
      if (!sourceRequest) throw new ApiConsoleError('INVALID_URL', 'Hidden/removed repository version not found.', 404);
      if (context.role !== 'SYSTEM_ADMIN' && !roleAllowed(context.role, API_CONSOLE_POLICY.canReviewShares)) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Not authorized to restore this version.', 403);
      }
      const restored = ['APPROVED', 'DEPRECATED'].includes(sourceRequest.previousSharingStatus)
        ? sourceRequest.previousSharingStatus
        : 'APPROVED';
      sourceRequest.sharingStatus = restored;
      sourceRequest.restoredAt = nowIso();
      sourceRequest.restoredBy = context.userId;
      sourceRequest.updatedAt = nowIso();
      sourceRequest.updatedBy = context.userId;
      audit('API_VERSION_RESTORED', context, { applicationId: sourceRequest.applicationId, apiId, version, restored });
      saveStore(store());
      return safeClone(sourceRequest);
    }

    if (first === 'share-reviews' && second && third === 'comments' && req.method === 'POST') {
      assertCsrf(req);
      const context = requireContext(req, body);
      const share = store().shareRequests.find(item => item.id === second);
      if (!share) throw new ApiConsoleError('INVALID_URL', 'Share review request not found.', 404);
      const isReviewer = roleAllowed(context.role, API_CONSOLE_POLICY.canReviewShares);
      const isOwner = share.submittedBy === context.userId;
      if (!isReviewer && !isOwner) {
        throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Only reviewer or submitter can comment.', 403);
      }
      const text = String(body.text || body.data?.text || '').trim();
      if (!text) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'متن نظر الزامی است.');
      if (!Array.isArray(share.comments)) share.comments = [];
      const comment = {
        id: makeId('share-cmt'),
        authorId: context.userId,
        authorName: context.user?.fullName || context.userName || context.userId,
        text: sanitizeText(text),
        createdAt: nowIso(),
      };
      share.comments.push(comment);
      share.updatedAt = nowIso();
      share.rowVersion = makeId('row');
      const notifyTarget = isOwner ? share.reviewedBy : share.submittedBy;
      if (notifyTarget) {
        notifyUser(notifyTarget, 'نظر جدید روی Share', text.slice(0, 180), 'SHARE_REQUEST', share.id, makeId('api-corr'));
      }
      audit('API_SHARE_COMMENTED', context, { shareRequestId: share.id, commentId: comment.id });
      saveStore(store());
      return safeClone(share);
    }

    if (first === 'share-reviews' && second && third === 'checklist' && req.method === 'PUT') {
      assertCsrf(req);
      const context = requireContext(req, body);
      assertCanReviewShares(context);
      const share = store().shareRequests.find(item => item.id === second);
      if (!share) throw new ApiConsoleError('INVALID_URL', 'Share review request not found.', 404);
      share.checklist = normalizeChecklist(body.checklist || body.data?.checklist || body);
      share.updatedAt = nowIso();
      share.rowVersion = makeId('row');
      audit('API_SHARE_CHECKLIST_UPDATED', context, { shareRequestId: share.id, checklist: share.checklist });
      saveStore(store());
      return safeClone(share);
    }

    return undefined;
  };
}

module.exports = {
  createPhase2Router,
  MAX_CO_OWNERS,
  REVIEW_CHECKLIST_KEYS,
};
