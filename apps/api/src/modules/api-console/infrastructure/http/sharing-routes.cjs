'use strict';

/**
 * Remaining share-reviews handlers (list/detail/approve/return).
 * Comments/checklist/ticket stay in phase2/phase3.
 * Returns a result object, or undefined to fall through.
 */

const { REVIEW_CHECKLIST_KEYS } = require('./phase2-routes.cjs');

function createSharingRouter(deps) {
  const {
    ApiConsoleError,
    makeId,
    nowIso,
    safeClone,
    requireContext,
    assertCanReviewShares,
    matchesApplicationScope,
    paginate,
    audit,
    notifyUser,
    saveStore,
    getStore,
    consumersForVersion,
    normalizeConsumers,
    deliverItsmWebhook,
  } = deps;

  function store() {
    return getStore();
  }

  return async function tryHandleSharing(req, parsedUrl, body, parts) {
    const [first, second, third] = parts;

    if (first !== 'share-reviews') return undefined;

    const context = requireContext(req, body);
    assertCanReviewShares(context);
    if (!second && req.method === 'GET') {
      const scope = parsedUrl.searchParams.get('applicationId') || 'ALL';
      const filters = {
        page: Number(parsedUrl.searchParams.get('page') || 1),
        limit: Number(parsedUrl.searchParams.get('limit') || 30),
        search: parsedUrl.searchParams.get('search') || '',
        status: parsedUrl.searchParams.get('status') || '',
        submittedBy: parsedUrl.searchParams.get('submittedBy') || '',
        version: parsedUrl.searchParams.get('version') || '',
      };
      let rows = store().shareRequests.filter(share =>
        matchesApplicationScope(share.applicationId, scope) &&
        matchesApplicationScope(share.applicationId, context.scopeApplicationIds || context.applicationId)
      );
      if (filters.status) rows = rows.filter(share => share.status === filters.status);
      if (filters.submittedBy) rows = rows.filter(share => share.submittedBy === filters.submittedBy);
      if (filters.version) rows = rows.filter(share => share.version === filters.version);
      if (filters.search.trim()) {
        const search = filters.search.toLowerCase();
        rows = rows.filter(share => [share.apiTitle, share.apiId, share.version, share.applicationId, share.submittedByName]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(search)));
      }
      rows = rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return safeClone(paginate(rows, filters.page, filters.limit));
    }

    const share = store().shareRequests.find(item => item.id === second);
    if (!share) throw new ApiConsoleError('INVALID_URL', 'Share review request not found.', 404);
    if (!matchesApplicationScope(share.applicationId, context.scopeApplicationIds || context.applicationId)) {
      throw new ApiConsoleError('AUTHENTICATION_ERROR', 'Share request is outside active application scope.', 403);
    }
    const sourceRequest = store().requests.find(request => request.id === share.requestId);

    if (!third && req.method === 'GET') {
      return safeClone({
        ...share,
        request: sourceRequest,
        consumers: consumersForVersion(share.apiId, share.version),
      });
    }

    if (third === 'approve' && req.method === 'POST') {
      if (share.status !== 'PENDING_REVIEW') {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'این درخواست قبلاً بررسی شده است.', 409);
      }
      if (body.rowVersion && body.rowVersion !== share.rowVersion) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'این درخواست قبلاً توسط کاربر دیگری تغییر کرده است.', 409);
      }
      if (!sourceRequest) throw new ApiConsoleError('INVALID_URL', 'Source request not found.', 404);
      const consumers = normalizeConsumers(body.consumers || body.data?.consumers || [], sourceRequest, context);
      if (!consumers.length) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'انتخاب حداقل یک مصرف‌کننده الزامی است.');
      }
      const checklist = {
        docsComplete: false,
        noSecrets: false,
        classificationOk: false,
        consumersSpecified: true,
        ...(share.checklist || {}),
        ...(body.checklist || body.data?.checklist || {}),
      };
      share.checklist = checklist;
      if (!REVIEW_CHECKLIST_KEYS.every(key => checklist[key] === true)) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'تأیید بدون تکمیل چک‌لیست Review ممکن نیست (docs/secret/classification/consumers).');
      }
      const revision = share.revisions.find(item => item.revisionNumber === share.currentRevisionNumber) || share.revisions[share.revisions.length - 1];
      if (revision) {
        revision.status = 'APPROVED';
        revision.reviewedBy = context.userId;
        revision.reviewedAt = nowIso();
        revision.reviewAction = 'APPROVED';
        revision.rowVersion = makeId('row');
      }
      store().consumers = store().consumers.filter(consumer => !(consumer.apiId === share.apiId && consumer.version === share.version));
      store().consumers.unshift(...consumers);
      share.status = 'APPROVED';
      share.reviewedBy = context.userId;
      share.reviewedAt = nowIso();
      share.rowVersion = makeId('row');
      share.updatedAt = nowIso();
      sourceRequest.sharingStatus = 'APPROVED';
      sourceRequest.approvedAt = nowIso();
      sourceRequest.approvedBy = context.userId;
      sourceRequest.shareRequestId = share.id;
      sourceRequest.updatedAt = nowIso();
      const correlationId = makeId('api-corr');
      notifyUser(sourceRequest.createdBy, 'API تأیید شد', `${sourceRequest.name} نسخه ${share.version} در Repository منتشر شد.`, 'API_REQUEST', sourceRequest.id, correlationId);
      consumers.filter(consumer => consumer.consumerType === 'USER').forEach(consumer => {
        store().readReceipts.unshift({
          id: makeId('read'),
          userId: consumer.userId,
          apiId: share.apiId,
          version: share.version,
          notifiedAt: nowIso(),
        });
        notifyUser(consumer.userId, 'نسخه جدید API منتشر شد', `${sourceRequest.name} نسخه ${share.version} برای شما قابل استفاده است.`, 'API_REQUEST', sourceRequest.id, correlationId);
      });
      audit('API_SHARE_APPROVED', context, { shareRequestId: share.id, apiId: share.apiId, version: share.version, consumers });
      saveStore(store());
      void deliverItsmWebhook(
        process.env.API_CONSOLE_ITSM_WEBHOOK_URL || '',
        process.env.API_CONSOLE_ITSM_WEBHOOK_SECRET || '',
        {
          event: 'API_SHARE_APPROVED',
          shareRequestId: share.id,
          apiId: share.apiId,
          version: share.version,
          ticketId: share.ticketId,
          ticketUrl: share.ticketUrl,
          applicationId: share.applicationId,
          reviewedBy: context.userId,
          at: nowIso(),
        }
      ).then(delivery => {
        if (!Array.isArray(store().itsmWebhookQueue)) store().itsmWebhookQueue = [];
        store().itsmWebhookQueue.unshift({
          id: makeId('itsm'),
          eventType: 'API_SHARE_APPROVED',
          status: delivery.ok ? 'DELIVERED' : (delivery.skipped ? 'SKIPPED' : 'FAILED'),
          lastError: delivery.error || null,
          createdAt: nowIso(),
        });
        store().itsmWebhookQueue = store().itsmWebhookQueue.slice(0, 200);
        saveStore(store());
      }).catch(() => {});
      return safeClone({ ...share, consumers });
    }

    if (third === 'return' && req.method === 'POST') {
      const reason = String(body.reason || body.data?.reason || '').trim();
      if (!reason) throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'دلیل بازگردانی الزامی است.');
      if (share.status !== 'PENDING_REVIEW') {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'این درخواست قبلاً بررسی شده است.', 409);
      }
      if (body.rowVersion && body.rowVersion !== share.rowVersion) {
        throw new ApiConsoleError('CORE_VALIDATION_ERROR', 'این درخواست قبلاً توسط کاربر دیگری تغییر کرده است.', 409);
      }
      const revision = share.revisions.find(item => item.revisionNumber === share.currentRevisionNumber) || share.revisions[share.revisions.length - 1];
      if (revision) {
        revision.status = 'RETURNED';
        revision.reviewedBy = context.userId;
        revision.reviewedAt = nowIso();
        revision.reviewAction = 'RETURNED';
        revision.returnReason = reason;
        revision.rowVersion = makeId('row');
      }
      share.status = 'RETURNED';
      share.returnReason = reason;
      share.reviewedBy = context.userId;
      share.reviewedAt = nowIso();
      share.rowVersion = makeId('row');
      share.updatedAt = nowIso();
      if (sourceRequest) {
        sourceRequest.sharingStatus = 'RETURNED';
        sourceRequest.latestReturnReason = reason;
        sourceRequest.updatedAt = nowIso();
      }
      notifyUser(share.submittedBy, 'درخواست اشتراک API بازگردانده شد', reason, 'API_REQUEST', share.requestId, makeId('api-corr'));
      audit('API_SHARE_RETURNED', context, { shareRequestId: share.id, apiId: share.apiId, version: share.version, reason });
      saveStore(store());
      void deliverItsmWebhook(
        process.env.API_CONSOLE_ITSM_WEBHOOK_URL || '',
        process.env.API_CONSOLE_ITSM_WEBHOOK_SECRET || '',
        {
          event: 'API_SHARE_RETURNED',
          shareRequestId: share.id,
          apiId: share.apiId,
          version: share.version,
          ticketId: share.ticketId,
          ticketUrl: share.ticketUrl,
          reason,
          applicationId: share.applicationId,
          reviewedBy: context.userId,
          at: nowIso(),
        }
      ).catch(() => {});
      return safeClone(share);
    }

    return undefined;
  };
}

module.exports = {
  createSharingRouter,
};
