'use strict';

/**
 * Runtime HTTP profile/session/admin/output/execute routes.
 * Returns a result object, or undefined to fall through.
 * Discovery routes stay in the main server.
 */

function createRuntimeHttpRouter(deps) {
  const {
    ApiConsoleError,
    makeId,
    nowIso,
    safeClone,
    requireContext,
    assertCsrf,
    requireSession,
    getStore,
    saveStore,
    audit,
    assertRuntimeProjectAccess,
    ensureDefaultRuntimeProfiles,
    resolveListOriginFilter,
    matchesOriginId,
    runtimeProfileView,
    findRuntimeProfile,
    runtimeSessionIdentity,
    getRuntimeSession,
    deleteRuntimeSession,
    setRuntimeSession,
    publicRuntimeStatus,
    startRuntimeLogin,
    finishRuntimeLogin,
    normalizeCdeLoginName,
    promoteRuntimeProfile,
    canManageDevelopmentRuntimeProfiles,
    assertSystemAdministrator,
    runtimeProfileMutationInput,
    createRuntimeProfilesFromInput,
    normalizeRuntimeProfileInput,
    assertCanManageRuntimeProfile,
    validateRuntimeOrigin,
    latestDiscovery,
    runtimeOpenApiDocument,
    runtimeDocsHtml,
    buildRuntimePostmanCollection,
    buildRuntimeCurlExport,
    executeRuntimeDiscoveredOperation,
  } = deps;

  function store() {
    return getStore();
  }

  return async function tryHandleRuntimeHttp(req, parsedUrl, body, parts) {
    const [first, second, third, fourth, fifth] = parts;

    if (first === 'runtime-profiles' && !second && req.method === 'GET') {
      const context = requireContext(req, body);
      const applicationId = String(parsedUrl.searchParams.get('applicationId') || context.applicationId || '');
      assertRuntimeProjectAccess(applicationId, context);
      ensureDefaultRuntimeProfiles(applicationId, context);
      const originFilter = resolveListOriginFilter(context, parsedUrl);
      return safeClone(store().runtimeProfiles
        .filter(profile => profile.applicationId === applicationId && profile.enabled !== false && matchesOriginId(profile, originFilter))
        .map(runtimeProfileView)
        .sort((left, right) => left.name.localeCompare(right.name, 'fa')));
    }

    if (first === 'runtime-profiles' && second && third === 'session') {
      const context = requireContext(req, body);
      const profile = findRuntimeProfile(second, context);
      const { appSession, phone } = runtimeSessionIdentity(req, context);
      if (!fourth && req.method === 'GET') {
        const state = await getRuntimeSession(appSession.id, profile.id);
        if (state && normalizeCdeLoginName(state.loginName) !== phone) {
          await deleteRuntimeSession(appSession.id, profile.id);
          return { ...publicRuntimeStatus(null), profileId: profile.id };
        }
        return { ...publicRuntimeStatus(state), profileId: profile.id };
      }
      if (!fourth && req.method === 'DELETE') {
        assertCsrf(req);
        await deleteRuntimeSession(appSession.id, profile.id);
        audit('RUNTIME_SESSION_DISCONNECTED', context, { profileId: profile.id });
        saveStore(store());
        return { ...publicRuntimeStatus(null), profileId: profile.id };
      }
      if (fourth === 'start' && req.method === 'POST') {
        assertCsrf(req);
        await deleteRuntimeSession(appSession.id, profile.id);
        const result = await startRuntimeLogin(profile, phone);
        await setRuntimeSession(appSession.id, profile.id, result.state, result.state.phase === 'PASSWORD_REQUIRED' ? 5 * 60 : undefined);
        audit('RUNTIME_LOGIN_STARTED', context, { profileId: profile.id, nextStep: result.status.nextStep || result.status.phase });
        saveStore(store());
        return { ...result.status, profileId: profile.id };
      }
      if (fourth === 'password' && req.method === 'POST') {
        assertCsrf(req);
        const password = String(body.password || '');
        if (!password) throw new ApiConsoleError('RUNTIME_PASSWORD_REQUIRED', 'Runtime password is required.', 422);
        const state = await getRuntimeSession(appSession.id, profile.id);
        if (!state) throw new ApiConsoleError('RUNTIME_LOGIN_NOT_STARTED', 'Start Runtime login again.', 409);
        try {
          const result = await finishRuntimeLogin(state, profile, password);
          await setRuntimeSession(appSession.id, profile.id, result.state);
          audit('RUNTIME_LOGIN_COMPLETED', context, { profileId: profile.id });
          saveStore(store());
          return { ...result.status, profileId: profile.id };
        } catch (error) {
          await setRuntimeSession(appSession.id, profile.id, state, 5 * 60);
          if (error.category === 'RUNTIME_LOGICAL_ERROR') {
            throw new ApiConsoleError('RUNTIME_INVALID_CREDENTIALS', 'Runtime did not accept the supplied credentials.', 401);
          }
          throw error;
        }
      }
      throw new ApiConsoleError('INVALID_URL', 'Runtime session endpoint not found.', 404);
    }

    if (first === 'admin' && second === 'runtime-profiles') {
      const context = requireContext(req, body);
      if (third && fourth === 'promote' && req.method === 'POST') {
        assertCsrf(req);
        const targetKind = body.targetKind ?? body.data?.targetKind;
        return safeClone(promoteRuntimeProfile(third, targetKind, context));
      }
      if (!canManageDevelopmentRuntimeProfiles(context)) {
        assertSystemAdministrator(context);
      }
      if (!third && req.method === 'POST') {
        assertCsrf(req);
        const rawInput = body.data || body || {};
        const input = runtimeProfileMutationInput(rawInput, context);
        const batchRequested = Array.isArray(rawInput.origins)
          || Array.isArray(rawInput.applicationIds)
          || String(rawInput.applicationId || '') === 'ALL'
          || (typeof rawInput.origin === 'string' && /[\n,]/.test(rawInput.origin));
        const result = createRuntimeProfilesFromInput(input, context);
        if (!batchRequested && result.created.length === 1 && result.skipped.length === 0) {
          return safeClone(result.created[0]);
        }
        return safeClone(result);
      }
      const profile = store().runtimeProfiles.find(item => item.id === String(third));
      if (!profile) throw new ApiConsoleError('RUNTIME_PROFILE_NOT_FOUND', 'Runtime Profile was not found.', 404);
      assertRuntimeProjectAccess(profile.applicationId, context);
      if (!fourth && req.method === 'PUT') {
        assertCsrf(req);
        assertCanManageRuntimeProfile(context, profile.kind);
        if (body.rowVersion && body.rowVersion !== profile.rowVersion) throw new ApiConsoleError('RUNTIME_PROFILE_CONFLICT', 'Runtime Profile changed in another session.', 409);
        const input = runtimeProfileMutationInput(body.data || body, context, profile);
        const next = normalizeRuntimeProfileInput(input, context, profile);
        if (store().runtimeProfiles.some(item => item.id !== next.id && item.applicationId === next.applicationId && item.origin === next.origin && item.kind === next.kind && item.enabled !== false)) {
          throw new ApiConsoleError('RUNTIME_PROFILE_DUPLICATE', 'An active Runtime Profile with this project, origin, and kind already exists.', 409);
        }
        store().runtimeProfiles[store().runtimeProfiles.indexOf(profile)] = next;
        audit('RUNTIME_PROFILE_UPDATED', context, { profileId: next.id, applicationId: next.applicationId, origin: next.origin });
        saveStore(store());
        return safeClone(runtimeProfileView(next));
      }
      if (!fourth && req.method === 'DELETE') {
        assertSystemAdministrator(context);
        assertCsrf(req);
        profile.enabled = false;
        profile.disabledAt = nowIso();
        profile.disabledBy = context.userId;
        profile.updatedAt = nowIso();
        profile.rowVersion = makeId('row');
        await deleteRuntimeSession(requireSession(req).id, profile.id);
        audit('RUNTIME_PROFILE_DISABLED', context, { profileId: profile.id });
        saveStore(store());
        return safeClone(runtimeProfileView(profile));
      }
      if (fourth === 'validate' && req.method === 'POST') {
        assertCsrf(req);
        assertCanManageRuntimeProfile(context, profile.kind);
        const validation = await validateRuntimeOrigin(profile.origin);
        profile.lastValidatedAt = nowIso();
        profile.lastValidation = { valid: true, addresses: validation.addresses, checkedAt: profile.lastValidatedAt };
        profile.updatedAt = nowIso();
        profile.rowVersion = makeId('row');
        audit('RUNTIME_PROFILE_VALIDATED', context, { profileId: profile.id, hostname: validation.hostname, addresses: validation.addresses });
        saveStore(store());
        return safeClone({ profile: runtimeProfileView(profile), validation: profile.lastValidation });
      }
      throw new ApiConsoleError('INVALID_URL', 'Runtime Profile administration endpoint not found.', 404);
    }

    if (first === 'projects' && second && third === 'runtime-profiles' && fourth && fifth) {
      const projectKey = decodeURIComponent(second);
      const context = requireContext(req, body);
      assertRuntimeProjectAccess(projectKey, context);
      const profile = findRuntimeProfile(fourth, context);
      if (profile.applicationId !== projectKey) throw new ApiConsoleError('RUNTIME_BINDING_INVALID', 'Runtime Profile does not belong to the requested project.', 422);
      const snapshot = latestDiscovery(projectKey);
      if (!snapshot) throw new ApiConsoleError('DISCOVERY_NOT_FOUND', 'Run CDE discovery before generating Runtime outputs.', 404);
      if (fifth === 'openapi.json' && req.method === 'GET') return runtimeOpenApiDocument(projectKey, profile, snapshot);
      if (fifth === 'docs' && req.method === 'GET') return { __rawResponse: { contentType: 'text/html; charset=utf-8', body: runtimeDocsHtml(projectKey, profile) } };
      if (fifth === 'postman' && req.method === 'GET') return buildRuntimePostmanCollection(projectKey, profile, snapshot);
      if (fifth === 'curl' && req.method === 'GET') {
        return buildRuntimeCurlExport(projectKey, profile, snapshot, parsedUrl.searchParams.get('operationId'), parsedUrl.searchParams.get('mode') || 'sample');
      }
      throw new ApiConsoleError('INVALID_URL', 'Runtime output endpoint not found.', 404);
    }

    if (first === 'runtime' && second === 'operations' && third && fourth === 'execute' && req.method === 'POST') {
      const context = requireContext(req, body);
      return executeRuntimeDiscoveredOperation(req, third, body.data || body, context);
    }

    return undefined;
  };
}

module.exports = {
  createRuntimeHttpRouter,
};
