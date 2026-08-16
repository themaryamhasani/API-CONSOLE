const {
  assertLogicalSuccess,
  createCdeState,
  getDataSource,
  storeFormData,
  getCdeOrigin,
} = require('./core-client.cjs');
const {
  createLoginChallenge,
  deleteCdeSession,
  getCdeSession,
  readLoginChallenge,
  setCdeSession,
} = require('./cde-session-store.cjs');
const {
  assertCsrf,
  markCdeConnected,
  markCdeDisconnected,
  requireSession,
  saveSession,
  setSelectedProject,
} = require('../session/session-server.cjs');

const REPOSITORY_CONFIG = {
  WEB_UI: { mappingField: 'webUiRepoName', key: 'cde/repository/web-ui/list/fetch', root: 'web-ui', suffix: 'web-ui' },
  DATA_SERVICE: { mappingField: 'dataServiceRepoName', key: 'cde/repository/data-service/list/fetch', root: 'data-service', suffix: 'data-service' },
  API_MODULE: { mappingField: 'apiModuleRepoName', key: 'cde/repository/api-module/list/fetch', root: 'api-module', suffix: 'api-module' },
  MESSAGE_CONSUMER: { mappingField: 'messageConsumerRepoName', key: 'cde/repository/message-consumer/list/fetch', root: 'message-consumer', suffix: 'message-consumer' },
};
const BROWSABLE_REPOSITORY_TYPES = ['WEB_UI', 'DATA_SERVICE', 'API_MODULE', 'MESSAGE_CONSUMER'];

class CdeApiError extends Error {
  constructor(category, message, statusCode = 400, details) {
    super(message);
    this.category = category;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function resultOf(response) {
  return response?.Result || {};
}

function itemsOf(response) {
  const result = resultOf(response);
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.list)) return result.list;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function displayCdeUser(loginUser) {
  const firstName = String(loginUser?.firstName || loginUser?.name || '');
  const lastName = String(loginUser?.lastName || '');
  const displayName = String(loginUser?.displayName || `${firstName} ${lastName}`.trim() || loginUser?.userLoginName || '');
  return {
    id: String(loginUser?.id || loginUser?.userId || loginUser?.userLoginName || displayName),
    firstName,
    lastName,
    displayName,
    userLoginName: String(loginUser?.userLoginName || loginUser?.loginName || ''),
  };
}

function normalizeCdeLoginName(value) {
  const digits = String(value || '')
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\D+/g, '');
  if (digits.startsWith('98') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  if (digits.length === 10 && digits.startsWith('9')) return digits;
  return '';
}

function requireCdePasswordStep(response) {
  const result = resultOf(response);
  const nextStep = String(result?.nextStep || result?.step || result?.NextStep || 'password').toLowerCase();
  if (!nextStep.includes('password') && result?.IsUserLogin !== false) {
    throw new CdeApiError('CDE_UNEXPECTED_LOGIN_STEP', 'CDE login did not request a password step.', 502);
  }
  return 'password';
}

async function loadCdeState(req) {
  const session = requireSession(req);
  const state = await getCdeSession(session.id);
  if (!state) throw new CdeApiError('CDE_NOT_CONNECTED', 'Connect a CDE account before using this feature.', 401);
  return state;
}

async function persistCoreResult(req, callResult) {
  const session = requireSession(req);
  await setCdeSession(session.id, callResult.state);
  return callResult.response;
}

async function callDataSource(req, key, params = {}, options = {}) {
  const state = options.state || await loadCdeState(req);
  const callResult = await getDataSource(state, key, params);
  const response = await persistCoreResult(req, callResult);
  assertLogicalSuccess(response);
  if (options.requireLogin !== false && resultOf(response).IsUserLogin === false) {
    await deleteCdeSession(req.apiConsoleSession.id);
    await markCdeDisconnected(req.apiConsoleSession);
    throw new CdeApiError('CDE_RECONNECT_REQUIRED', 'The CDE session has expired. Connect again.', 401);
  }
  return response;
}

async function cdeStatus(req) {
  const session = requireSession(req);
  const state = await getCdeSession(session.id);
  if (!state) return { connected: false, csrfToken: session.csrfToken };
  try {
    const response = await callDataSource(req, 'pages-app/who-am-i', {}, { state, requireLogin: false });
    const result = resultOf(response);
    if (!result.IsUserLogin) {
      // Keep mid-login cookie/jar state so the password step can continue.
      // Only clear when we previously believed the account was connected.
      if (session.cdeConnected) {
        await deleteCdeSession(session.id);
        await markCdeDisconnected(session);
        return { connected: false, reconnectRequired: true, csrfToken: session.csrfToken };
      }
      return { connected: false, csrfToken: session.csrfToken };
    }
    const user = displayCdeUser(result.LoginUser);
    await markCdeConnected(session, user);
    return { connected: true, user, ecreq: Boolean(result.ecreq), csrfToken: session.csrfToken };
  } catch (error) {
    if (error.category === 'CDE_RECONNECT_REQUIRED') {
      return { connected: false, reconnectRequired: true, csrfToken: session.csrfToken };
    }
    throw error;
  }
}

async function startCdeLogin(req, body) {
  assertCsrf(req);
  const session = requireSession(req);
  const userLoginName = normalizeCdeLoginName(body.userLoginName);
  if (!userLoginName) throw new CdeApiError('CDE_LOGIN_NAME_INVALID', 'Enter a valid Iranian cellphone number.', 400);
  await deleteCdeSession(session.id);
  await markCdeDisconnected(session);
  let state = createCdeState();
  let callResult = await getDataSource(state, 'pages-app/who-am-i', {});
  state = callResult.state;
  if (resultOf(callResult.response).IsUserLogin) {
    await setCdeSession(session.id, state);
    const user = displayCdeUser(resultOf(callResult.response).LoginUser);
    await markCdeConnected(session, user);
    return { connected: true, user, csrfToken: session.csrfToken };
  }
  callResult = await storeFormData(state, 'auth/signin/iran-cellphone', {
    userSource: 'rayadevelopers',
    userLoginName,
  });
  assertLogicalSuccess(callResult.response);
  const loginResult = resultOf(callResult.response);
  if (loginResult.IsUserLogin === true) {
    await setCdeSession(session.id, callResult.state);
    const user = displayCdeUser(loginResult.LoginUser);
    await markCdeConnected(session, { ...user, userLoginName });
    return { connected: true, user, ecreq: Boolean(loginResult.ecreq), csrfToken: session.csrfToken };
  }
  const nextStep = requireCdePasswordStep(callResult.response);
  await setCdeSession(session.id, callResult.state, 5 * 60);
  session.userLoginName = userLoginName;
  await saveSession(session);
  return {
    connected: false,
    nextStep,
    challenge: createLoginChallenge(session.id, userLoginName),
    csrfToken: session.csrfToken,
  };
}

async function finishCdePassword(req, body) {
  assertCsrf(req);
  const session = requireSession(req);
  const password = String(body.password || '');
  if (!password || !body.challenge) throw new CdeApiError('CDE_PASSWORD_REQUIRED', 'Password and login challenge are required.', 400);
  let userLoginName;
  try {
    userLoginName = readLoginChallenge(session.id, String(body.challenge));
  } catch {
    throw new CdeApiError('CDE_LOGIN_CHALLENGE_EXPIRED', 'The CDE login challenge expired. Start again.', 401);
  }
  const state = await loadCdeState(req);
  let callResult = await storeFormData(state, 'auth/signin/check-password', {
    userSource: 'rayadevelopers',
    userLoginName,
    contact: 'iran-cellphone',
    password,
  });
  try {
    assertLogicalSuccess(callResult.response);
  } catch (error) {
    await setCdeSession(session.id, callResult.state, 5 * 60);
    if (error.category === 'CDE_LOGICAL_ERROR') {
      throw new CdeApiError('CDE_INVALID_CREDENTIALS', 'The CDE password is incorrect.', 401);
    }
    throw error;
  }
  callResult = await getDataSource(callResult.state, 'pages-app/who-am-i', {});
  const result = resultOf(callResult.response);
  if (!result.IsUserLogin) {
    await setCdeSession(session.id, callResult.state, 5 * 60);
    throw new CdeApiError('CDE_INVALID_CREDENTIALS', 'The CDE password is incorrect.', 401);
  }
  await setCdeSession(session.id, callResult.state);
  const user = displayCdeUser(result.LoginUser);
  await markCdeConnected(session, { ...user, userLoginName });
  return { connected: true, user, ecreq: Boolean(result.ecreq), csrfToken: session.csrfToken };
}

async function disconnectCde(req) {
  assertCsrf(req);
  const session = requireSession(req);
  await deleteCdeSession(session.id);
  await markCdeDisconnected(session);
  return { connected: false, csrfToken: session.csrfToken };
}

async function accessibleProjects(req, force = false) {
  const session = requireSession(req);
  const state = await loadCdeState(req);
  if (!force && Array.isArray(state.accessibleProjects) && Date.now() - Number(state.accessibleProjectsAt || 0) < 60_000) {
    return state.accessibleProjects;
  }
  const response = await callDataSource(req, 'cde/repository/list/my-repo', {}, { state });
  const projects = itemsOf(response).map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  state.accessibleProjects = Array.from(new Set(projects));
  state.accessibleProjectsAt = Date.now();
  await setCdeSession(session.id, state);
  session.projects = state.accessibleProjects;
  if (!session.applicationId && state.accessibleProjects[0]) {
    session.applicationId = state.accessibleProjects[0];
  }
  await saveSession(session);
  return state.accessibleProjects;
}

function normalizeProjectKey(value) {
  const projectKey = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(projectKey)) {
    throw new CdeApiError('CDE_PROJECT_INVALID', 'CDE project key is invalid.', 400);
  }
  return projectKey;
}

function projectRepositoryName(projectKey, repositoryType) {
  const normalizedProjectKey = normalizeProjectKey(projectKey);
  const config = REPOSITORY_CONFIG[String(repositoryType || '')];
  if (!config || !BROWSABLE_REPOSITORY_TYPES.includes(String(repositoryType))) {
    throw new CdeApiError('CDE_REPOSITORY_TYPE_INVALID', 'Repository type is not browsable.', 400);
  }
  return `${normalizedProjectKey}/${config.suffix}`;
}

async function assertAccessibleProject(req, projectKey) {
  const normalizedProjectKey = normalizeProjectKey(projectKey);
  const projects = await accessibleProjects(req);
  if (!projects.includes(normalizedProjectKey)) {
    throw new CdeApiError('CDE_PROJECT_ACCESS_DENIED', 'The connected CDE account cannot access this project.', 403);
  }
  return normalizedProjectKey;
}

function projectDescriptor(projectKey) {
  const normalizedProjectKey = normalizeProjectKey(projectKey);
  const origin = getCdeOrigin();
  const encodedProject = encodeURIComponent(normalizedProjectKey);
  const encodedApp = encodeURIComponent(`${normalizedProjectKey}>App`);
  const encodedGateway = encodeURIComponent(`${normalizedProjectKey}>`);
  return {
    projectKey: normalizedProjectKey,
    repositories: Object.fromEntries(BROWSABLE_REPOSITORY_TYPES.map(repositoryType => [
      repositoryType,
      projectRepositoryName(normalizedProjectKey, repositoryType),
    ])),
    editorUrls: {
      webUi: `${origin}/front/directory/${encodedApp}`,
      dataService: `${origin}/dservice/directory/${encodedApp}`,
      gateway: `${origin}/back/${encodedProject}/${encodedGateway}?return=/workspace/${encodedProject}`,
    },
  };
}

async function browseProjects(req) {
  const projects = await accessibleProjects(req);
  const session = requireSession(req);
  if (!session.applicationId && projects[0]) {
    await setSelectedProject(session, projects[0], projects);
  }
  return projects.map(projectDescriptor);
}

function repositoryBranches(item, repositoryType) {
  const branches = [];
  if (item?.public && typeof item.public === 'object' && Object.keys(item.public).length) {
    branches.push({
      selector: { kind: 'PUBLIC' },
      versionId: item.public.versionId || null,
      editable: false,
      meta: item.public.meta || {},
      value: item.public,
    });
  }
  (Array.isArray(item?.personal) ? item.personal : []).forEach((branch, index) => {
    branches.push({
      selector: {
        kind: 'PERSONAL',
        ...(branch.rand_id ? { randId: String(branch.rand_id) } : {}),
        index: Number.isInteger(branch.index) ? branch.index : index,
      },
      versionId: branch.versionId || null,
      editable: branch.editable === true,
      meta: branch.meta || {},
      value: branch,
    });
  });
  return branches.map(branch => ({ ...branch, repositoryType }));
}

function branchSummaries(branches) {
  return branches.map(({ selector, versionId, editable, meta }) => ({ selector, versionId, editable, meta }));
}

function isOptionalProjectBundleRepositoryFailure(repositoryType, error) {
  if (repositoryType !== 'DATA_SERVICE') return false;
  if (['CDE_LOGICAL_ERROR', 'CDE_SCHEMA_ERROR'].includes(error?.category)) return true;
  return error?.category === 'CDE_HTTP_ERROR' && /HTTP\s+404\b/i.test(String(error?.message || ''));
}

function projectBundleApproach(repositoryTypes) {
  return repositoryTypes.includes('DATA_SERVICE') ? 'DATA_SERVICE' : 'GATEWAY';
}

function selectorMatches(branch, selector) {
  if (!selector || selector.kind !== branch.selector.kind) return false;
  if (selector.kind === 'PUBLIC') return true;
  if (selector.randId) return selector.randId === branch.selector.randId;
  return Number.isInteger(selector.index) && selector.index === branch.selector.index;
}

function packageSummary(item, repositoryType) {
  const id = String(item?.id || item?._id || '');
  return {
    id,
    branches: repositoryBranches(item, repositoryType).map(({ selector, versionId, editable, meta }) => ({
      selector, versionId, editable, meta,
    })),
  };
}

function packagesFromResponse(response, repositoryType) {
  return itemsOf(response).map(item => (typeof item === 'string' ? { id: item, branches: [] } : packageSummary(item, repositoryType)));
}

function normalizeSourcePath(value) {
  const path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!path || path.includes('..') || path.includes('\0')) {
    throw new Error('Unsafe CDE source path.');
  }
  return path;
}

function normalizeRemoteFiles(branch, repositoryType, packId) {
  if (repositoryType === 'API_MODULE') {
    return [{
      path: `${String(packId).replace(/^ds\//, '')}.js`,
      code: String(branch.value.actions || ''),
      language: 'javascript',
      readOnly: true,
    }];
  }
  const files = branch.value?.content?.content;
  if (!Array.isArray(files)) throw new CdeApiError('CDE_SCHEMA_ERROR', 'The selected CDE branch has no source file array.', 502);
  const seen = new Set();
  return files.map(file => {
    let path;
    try {
      path = normalizeSourcePath(file.name);
    } catch (error) {
      throw new CdeApiError('CDE_UNSAFE_PATH', error.message, 422);
    }
    const folded = path.toLocaleLowerCase('en-US');
    if (seen.has(folded)) throw new CdeApiError('CDE_PATH_COLLISION', 'CDE package contains duplicate or case-colliding paths.', 422);
    seen.add(folded);
    return { path, code: String(file.code ?? ''), readOnly: true };
  });
}

async function browseProjectCatalog(req, projectKey) {
  const accessibleProjectKey = await assertAccessibleProject(req, projectKey);
  const session = requireSession(req);
  await setSelectedProject(session, accessibleProjectKey, session.projects);
  const repositories = [];
  for (const repositoryType of BROWSABLE_REPOSITORY_TYPES) {
    const config = REPOSITORY_CONFIG[repositoryType];
    const repoName = projectRepositoryName(accessibleProjectKey, repositoryType);
    try {
      const response = await callDataSource(req, config.key, { repoName });
      const packages = packagesFromResponse(response, repositoryType);
      if (repositoryType === 'DATA_SERVICE' && packages.length === 0) continue;
      repositories.push({ type: repositoryType, repoName, packages });
    } catch (error) {
      if (['CDE_NOT_CONNECTED', 'CDE_RECONNECT_REQUIRED'].includes(error.category)) throw error;
      if (isOptionalProjectBundleRepositoryFailure(repositoryType, error)) continue;
      repositories.push({
        type: repositoryType,
        repoName,
        packages: [],
        error: {
          code: error.category || 'CDE_REPOSITORY_LOAD_FAILED',
          message: error.message || 'CDE repository could not be loaded.',
        },
      });
    }
  }
  return {
    projectKey: accessibleProjectKey,
    approach: projectBundleApproach(repositories.map(repository => repository.type)),
    repositories,
  };
}

async function browseProjectPackage(req, projectKey, body) {
  const accessibleProjectKey = await assertAccessibleProject(req, projectKey);
  const repositoryType = String(body.repositoryType || '');
  const config = REPOSITORY_CONFIG[repositoryType];
  if (!config || !BROWSABLE_REPOSITORY_TYPES.includes(repositoryType)) {
    throw new CdeApiError('CDE_REPOSITORY_TYPE_INVALID', 'Repository type is not browsable.', 400);
  }
  const repoName = projectRepositoryName(accessibleProjectKey, repositoryType);
  const packId = String(body.packId || '');
  const list = await callDataSource(req, config.key, { repoName });
  const listedItem = itemsOf(list).find(candidate => String(candidate?.id || candidate?._id || candidate || '') === packId);
  if (!listedItem) throw new CdeApiError('CDE_PACKAGE_NOT_FOUND', 'CDE package was not found in the selected repository.', 404);

  let item = listedItem;
  if (repositoryType !== 'API_MODULE') {
    const response = await callDataSource(req, 'cde/package/any/one/fetch', { repoName, packId });
    item = resultOf(response).pack;
    if (!item || typeof item !== 'object') throw new CdeApiError('CDE_PACKAGE_NOT_FOUND', 'CDE package was not found.', 404);
  }

  const branches = repositoryBranches(item, repositoryType);
  const requestedSelector = body.branch || null;
  let branch = requestedSelector ? branches.find(candidate => selectorMatches(candidate, requestedSelector)) : null;
  if (!branch && branches.length === 1) branch = branches[0];
  if (!branch) {
    throw new CdeApiError('BRANCH_SELECTION_REQUIRED', 'Select one accessible CDE branch before opening this package.', 409, {
      branches: branches.map(({ selector, versionId, editable, meta }) => ({ selector, versionId, editable, meta })),
    });
  }

  return {
    projectKey: accessibleProjectKey,
    repositoryType,
    repoName,
    packId,
    branches: branchSummaries(branches),
    branch: { selector: branch.selector, versionId: branch.versionId, editable: branch.editable, meta: branch.meta },
    files: normalizeRemoteFiles(branch, repositoryType, packId),
  };
}

function routeMatch(pathname, expression) {
  return pathname.match(expression);
}

function canHandleCde(pathname) {
  return pathname.startsWith('/api/cde/');
}

async function handleCde(req, parsedUrl, body) {
  const pathname = parsedUrl.pathname;
  if (pathname === '/api/cde/session' && req.method === 'GET') return cdeStatus(req);
  if (pathname === '/api/cde/session/start' && req.method === 'POST') return startCdeLogin(req, body);
  if (pathname === '/api/cde/session/password' && req.method === 'POST') return finishCdePassword(req, body);
  if (pathname === '/api/cde/session' && req.method === 'DELETE') return disconnectCde(req);
  if (pathname === '/api/cde/projects' && req.method === 'GET') return browseProjects(req);
  let match = routeMatch(pathname, /^\/api\/cde\/projects\/([^/]+)\/catalog$/);
  if (match && req.method === 'GET') return browseProjectCatalog(req, decodeURIComponent(match[1]));
  match = routeMatch(pathname, /^\/api\/cde\/projects\/([^/]+)\/package$/);
  if (match && req.method === 'POST') return browseProjectPackage(req, decodeURIComponent(match[1]), body);
  throw new CdeApiError('CDE_ENDPOINT_NOT_FOUND', 'CDE endpoint not found.', 404);
}

module.exports = {
  CdeApiError,
  canHandleCde,
  handleCde,
  normalizeCdeLoginName,
  projectRepositoryName,
};
