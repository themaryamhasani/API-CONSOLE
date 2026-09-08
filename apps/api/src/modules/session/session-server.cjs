const { createHash, randomBytes, timingSafeEqual } = require('crypto');
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');

const COOKIE_NAME = process.env.API_CONSOLE_SESSION_COOKIE || 'api_console_session';
const SESSION_TTL_SECONDS = Number(process.env.API_CONSOLE_SESSION_TTL_SECONDS || 12 * 60 * 60);
const REDIS_PREFIX = process.env.API_CONSOLE_SESSION_REDIS_PREFIX || 'api-console:app-session:';
const REPOSITORY_ROOT = path.resolve(__dirname, '../../../../..');
const resolveRepositoryPath = value => path.isAbsolute(value) ? value : path.join(REPOSITORY_ROOT, value);
const DIRECTORY_STORE_FILE = process.env.API_CONSOLE_STORE_FILE
  ? resolveRepositoryPath(process.env.API_CONSOLE_STORE_FILE)
  : resolveRepositoryPath(path.join(process.env.API_CONSOLE_DATA_DIR || path.join('runtime', 'api-console'), 'api-console-store.json'));
const configuredSecret = process.env.API_CONSOLE_CSRF_SECRET || '';
if (process.env.NODE_ENV === 'production' && configuredSecret.length < 32) {
  throw new Error('API_CONSOLE_CSRF_SECRET must contain at least 32 characters in production.');
}
const secretMaterial = createHash('sha256')
  .update(configuredSecret || 'api-console-development-csrf-secret-change-me')
  .digest();

const memoryStore = new Map();
let redis;

class SessionError extends Error {
  constructor(category, message, statusCode = 401) {
    super(message);
    this.category = category;
    this.statusCode = statusCode;
  }
}

function redisClient() {
  if (redis) return redis;
  redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
  });
  redis.on('error', () => undefined);
  return redis;
}

function parseCookieHeader(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function appendSetCookie(res, value) {
  const previous = res.getHeader('set-cookie');
  if (!previous) {
    res.setHeader('set-cookie', value);
    return;
  }
  const list = Array.isArray(previous) ? previous : [previous];
  res.setHeader('set-cookie', [...list, value]);
}

function cookieOptions(maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function storeKey(sessionId) {
  return `${REDIS_PREFIX}${sessionId}`;
}

function memoryGet(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

async function withRedis(operation, fallback) {
  if (process.env.NODE_ENV === 'test') return fallback();
  try {
    const client = redisClient();
    if (client.status === 'wait') await client.connect();
    return await operation(client);
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    return fallback();
  }
}

function parseLoginList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function comparableLogin(value) {
  const normalized = String(value || '')
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\D+/g, '');
  if (normalized.startsWith('98') && normalized.length === 12) return normalized.slice(2);
  if (normalized.startsWith('0') && normalized.length === 11) return normalized.slice(1);
  return normalized;
}

function loginListIncludes(value, login) {
  const expected = comparableLogin(login);
  return parseLoginList(value).some(item => comparableLogin(item) === expected);
}

function readDirectoryStore() {
  try {
    if (!fs.existsSync(DIRECTORY_STORE_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(DIRECTORY_STORE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function directoryUserForIdentity(store, userLoginName, userId) {
  const login = comparableLogin(userLoginName);
  return (Array.isArray(store?.directoryUsers) ? store.directoryUsers : []).find(user =>
    String(user.id || '') === String(userId || '') ||
    (login && comparableLogin(user.phoneNumber) === login)
  );
}

const ROLE_PRECEDENCE = [
  'SYSTEM_ADMIN',
  'TECH_LEAD',
  'QA_LEAD',
  'SECURITY_REVIEWER',
  'QA_SPECIALIST',
  'BA',
  'PRODUCT_OWNER',
  'DEVELOPER',
];

function hasManagedSystemAdminRole(userLoginName, userId) {
  const store = readDirectoryStore();
  const user = directoryUserForIdentity(store, userLoginName, userId);
  if (!user || user.isActive === false) return false;
  return (Array.isArray(store.directoryRoleAssignments) ? store.directoryRoleAssignments : []).some(assignment =>
    assignment.userId === user.id &&
    assignment.role === 'SYSTEM_ADMIN' &&
    assignment.source === 'ADMIN_APPROVAL' &&
    assignment.isActive !== false
  );
}

function managedApprovalRoles(userLoginName, userId) {
  const store = readDirectoryStore();
  const user = directoryUserForIdentity(store, userLoginName, userId);
  if (!user || user.isActive === false) return [];
  return Array.from(new Set((Array.isArray(store.directoryRoleAssignments) ? store.directoryRoleAssignments : [])
    .filter(assignment =>
      assignment.userId === user.id &&
      assignment.source === 'ADMIN_APPROVAL' &&
      assignment.isActive !== false &&
      ROLE_PRECEDENCE.includes(assignment.role)
    )
    .map(assignment => assignment.role)));
}

function isBootstrapSystemAdmin(userLoginName) {
  return loginListIncludes(process.env.API_CONSOLE_ADMIN_LOGINS, userLoginName);
}

function pickPrimaryRole(roles) {
  const unique = Array.from(new Set((roles || []).filter(role => ROLE_PRECEDENCE.includes(role))));
  if (!unique.length) return 'DEVELOPER';
  return ROLE_PRECEDENCE.find(role => unique.includes(role)) || 'DEVELOPER';
}

function resolveRole(userLoginName, userId) {
  const login = String(userLoginName || '');
  const roles = [];
  if (isBootstrapSystemAdmin(login) || hasManagedSystemAdminRole(login, userId)) {
    roles.push('SYSTEM_ADMIN');
  }
  if (loginListIncludes(process.env.API_CONSOLE_QA_LEAD_LOGINS, login)) {
    roles.push('QA_LEAD');
  }
  roles.push(...managedApprovalRoles(login, userId));
  return pickPrimaryRole(roles);
}

/**
 * Application scope from managed directory role assignments.
 * Returns null when unrestricted (bootstrap admin, ALL assignment, or no managed role).
 * Returns a concrete app id list when roles are scoped to specific applications.
 */
function resolveManagedScopeApplicationIds(userLoginName, userId) {
  const login = String(userLoginName || '');
  if (isBootstrapSystemAdmin(login)) return null;
  const store = readDirectoryStore();
  const user = directoryUserForIdentity(store, userLoginName, userId);
  if (!user || user.isActive === false) return null;
  const assignments = (Array.isArray(store.directoryRoleAssignments) ? store.directoryRoleAssignments : [])
    .filter(assignment =>
      assignment.userId === user.id &&
      assignment.source === 'ADMIN_APPROVAL' &&
      assignment.isActive !== false &&
      ROLE_PRECEDENCE.includes(assignment.role) &&
      assignment.role !== 'DEVELOPER'
    );
  if (!assignments.length) return null;
  if (assignments.some(assignment => !assignment.applicationId || assignment.applicationId === 'ALL')) {
    return null;
  }
  return Array.from(new Set(assignments.map(assignment => String(assignment.applicationId)).filter(Boolean)));
}

function createSessionRecord(partial = {}) {
  const id = randomBytes(24).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  return {
    id,
    csrfToken,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authApproach: null,
    cdeConnected: false,
    userLoginName: null,
    userId: null,
    displayName: null,
    firstName: null,
    lastName: null,
    role: 'DEVELOPER',
    applicationId: null,
    projects: [],
    isGatewayCookie: null,
    isGatewayBaseUrl: null,
    isRoles: [],
    ...partial,
  };
}

function isSessionAuthenticated(session) {
  if (!session?.userId) return false;
  if (session.authApproach === 'IS') return true;
  if (session.authApproach === 'LOCAL') return true;
  return Boolean(session.cdeConnected);
}

async function getSession(sessionId) {
  if (!sessionId) return null;
  const key = storeKey(sessionId);
  const raw = await withRedis(client => client.get(key), () => memoryGet(key));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveSession(session, ttlSeconds = SESSION_TTL_SECONDS) {
  session.updatedAt = new Date().toISOString();
  const key = storeKey(session.id);
  const encoded = JSON.stringify(session);
  await withRedis(
    client => client.set(key, encoded, 'EX', ttlSeconds),
    () => memoryStore.set(key, { value: encoded, expiresAt: Date.now() + ttlSeconds * 1000 })
  );
  return session;
}

async function deleteSession(sessionId) {
  if (!sessionId) return;
  const key = storeKey(sessionId);
  await withRedis(client => client.del(key), () => memoryStore.delete(key));
}

function setSessionCookie(res, sessionId) {
  appendSetCookie(res, `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; ${cookieOptions(SESSION_TTL_SECONDS)}`);
}

function clearSessionCookie(res) {
  appendSetCookie(res, `${COOKIE_NAME}=; ${cookieOptions(0)}`);
}

async function attachSession(req, res) {
  const cookies = parseCookieHeader(req.headers.cookie);
  let session = await getSession(cookies[COOKIE_NAME]);
  let created = false;
  if (!session) {
    session = createSessionRecord();
    await saveSession(session);
    setSessionCookie(res, session.id);
    created = true;
  }
  req.apiConsoleSession = session;
  req.utmsSession = { id: session.id };
  return { session, created };
}

function requireSession(req) {
  if (!req.apiConsoleSession?.id) {
    throw new SessionError('AUTHENTICATION_ERROR', 'Session is required.', 401);
  }
  return req.apiConsoleSession;
}

function assertCsrf(req) {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'development' || env === 'test') {
    if (process.env.API_CONSOLE_REQUIRE_CSRF !== 'true') return;
  }
  const session = requireSession(req);
  const header = String(req.headers['x-csrf-token'] || '');
  const expected = String(session.csrfToken || '');
  if (!header || !expected || header.length !== expected.length) {
    throw new SessionError('CSRF_FAILED', 'CSRF token is missing or invalid.', 403);
  }
  if (!timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    throw new SessionError('CSRF_FAILED', 'CSRF token is missing or invalid.', 403);
  }
}

function buildApplication(projectKey) {
  const key = String(projectKey || '');
  return {
    id: key,
    name: key,
    code: key,
    description: '',
    isActive: true,
  };
}

function buildConsoleContext(session) {
  if (!isSessionAuthenticated(session)) return null;
  const authApproach = session.authApproach || (session.cdeConnected ? 'CDE' : null);
  const applicationId = session.applicationId || (session.projects?.[0] || null);
  if (!applicationId) return null;
  const application = buildApplication(applicationId);
  const projects = Array.isArray(session.projects) && session.projects.length
    ? session.projects
    : [applicationId];
  const applications = projects.map(buildApplication);
  const user = {
    id: session.userId,
    firstName: session.firstName || '',
    lastName: session.lastName || '',
    displayName: session.displayName || session.userLoginName || session.userId,
    fullName: session.displayName || `${session.firstName || ''} ${session.lastName || ''}`.trim() || session.userLoginName || session.userId,
    phoneNumber: session.userLoginName || '',
    isActive: true,
  };
  const managedScope = resolveManagedScopeApplicationIds(session.userLoginName, session.userId);
  // Unrestricted users keep the full session project list in scope so Tech Lead / Admin
  // can provision Runtime origins across one, several, or all accessible systems.
  const scopeApplicationIds = managedScope?.length
    ? managedScope
    : projects.map(projectKey => String(projectKey)).filter(Boolean);
  const prefix = authApproach === 'IS' ? 'is' : authApproach === 'LOCAL' ? 'local' : 'cde';
  return {
    contextId: `${prefix}:${session.id}`,
    userId: session.userId,
    user,
    assignmentId: `${prefix}:${session.userId}:${applicationId}`,
    assignmentIds: [`${prefix}:${session.userId}:${applicationId}`],
    applicationId,
    scopeApplicationIds,
    application,
    applications,
    // Resolve on every request so an administrator assignment becomes effective
    // without requiring the target account to sign in again.
    role: resolveRole(session.userLoginName, session.userId),
    scope: 'SYSTEMS',
    token: session.csrfToken,
    authApproach,
    identitySource: authApproach,
    cdeOriginId: authApproach === 'CDE' ? (session.cdeOriginId || 'default') : undefined,
    cdeOriginUrl: authApproach === 'CDE' ? session.cdeOriginUrl || undefined : undefined,
    isGatewayBaseUrl: authApproach === 'IS' ? session.isGatewayBaseUrl || undefined : undefined,
    // Server-only; used to forward Gateway session on IS executions (never expose in UI APIs).
    isGatewayCookie: authApproach === 'IS' ? session.isGatewayCookie || undefined : undefined,
  };
}

function publicConsoleContext(context) {
  if (!context) return null;
  const { isGatewayCookie, ...rest } = context;
  return rest;
}

function attachConsoleContext(req) {
  const context = buildConsoleContext(req.apiConsoleSession);
  if (context) {
    req.utmsContext = context;
    req.consoleContext = context;
  }
  return context;
}

async function markCdeConnected(session, user) {
  const loginName = String(user?.userLoginName || user?.loginName || session.userLoginName || '');
  session.authApproach = 'CDE';
  session.cdeConnected = true;
  session.isGatewayCookie = null;
  session.isGatewayBaseUrl = null;
  session.isRoles = [];
  session.userLoginName = loginName;
  session.userId = String(user?.id || user?.userId || loginName || session.id);
  session.firstName = String(user?.firstName || '');
  session.lastName = String(user?.lastName || '');
  session.displayName = String(user?.displayName || `${session.firstName} ${session.lastName}`.trim() || loginName);
  session.role = resolveRole(loginName, session.userId);
  await saveSession(session);
  return session;
}

async function markCdeDisconnected(session) {
  session.authApproach = null;
  session.cdeConnected = false;
  session.userLoginName = null;
  session.userId = null;
  session.displayName = null;
  session.firstName = null;
  session.lastName = null;
  session.applicationId = null;
  session.projects = [];
  session.role = 'DEVELOPER';
  session.isGatewayCookie = null;
  session.isGatewayBaseUrl = null;
  session.isRoles = [];
  await saveSession(session);
  return session;
}

async function markIsConnected(session, user, extras = {}) {
  const loginName = String(user?.userLoginName || user?.loginName || session.userLoginName || '');
  session.authApproach = 'IS';
  session.cdeConnected = false;
  session.userLoginName = loginName;
  session.userId = String(user?.id || user?.userId || loginName || session.id);
  session.firstName = String(user?.firstName || '');
  session.lastName = String(user?.lastName || '');
  session.displayName = String(user?.displayName || `${session.firstName} ${session.lastName}`.trim() || loginName);
  session.role = resolveRole(loginName, session.userId);
  session.isGatewayCookie = extras.gatewayCookie || null;
  session.isGatewayBaseUrl = extras.gatewayBaseUrl || null;
  session.isRoles = Array.isArray(extras.isRoles) ? extras.isRoles : (Array.isArray(user?.roles) ? user.roles : []);
  await saveSession(session);
  return session;
}

async function markIsDisconnected(session) {
  return markCdeDisconnected(session);
}

async function setSelectedProject(session, projectKey, projects = []) {
  session.applicationId = String(projectKey);
  if (Array.isArray(projects) && projects.length) {
    session.projects = projects.map(String);
  } else if (!session.projects.includes(String(projectKey))) {
    session.projects = [...(session.projects || []), String(projectKey)];
  }
  await saveSession(session);
  return session;
}

function canHandleSession(pathname) {
  return pathname === '/api/session' || pathname === '/api/session/context' || pathname === '/api/session/logout';
}

async function handleSession(req, parsedUrl, body, res) {
  const session = requireSession(req);
  const pathname = parsedUrl.pathname;
  if (pathname === '/api/session' && req.method === 'GET') {
    const context = buildConsoleContext(session);
    const authApproach = session.authApproach || (session.cdeConnected ? 'CDE' : null);
    return {
      authenticated: Boolean(isSessionAuthenticated(session) && context),
      authApproach,
      cdeConnected: Boolean(session.cdeConnected && authApproach === 'CDE'),
      isConnected: authApproach === 'IS',
      csrfToken: session.csrfToken,
      activeContext: publicConsoleContext(context),
      user: context?.user || null,
      applicationId: session.applicationId,
      projects: session.projects || [],
    };
  }
  if (pathname === '/api/session/context' && req.method === 'POST') {
    assertCsrf(req);
    if (!isSessionAuthenticated(session)) {
      throw new SessionError('NOT_AUTHENTICATED', 'Sign in before selecting a project or system.', 401);
    }
    const projectKey = String(body?.applicationId || body?.projectKey || '').trim();
    if (!projectKey) throw new SessionError('PROJECT_REQUIRED', 'projectKey is required.', 400);
    await setSelectedProject(session, projectKey, body?.projects);
    const context = buildConsoleContext(session);
    return {
      activeContext: publicConsoleContext(context),
      csrfToken: session.csrfToken,
      authApproach: session.authApproach || null,
    };
  }
  if (pathname === '/api/session/logout' && req.method === 'POST') {
    assertCsrf(req);
    const { deleteAllRuntimeSessions } = require('../runtime/runtime-session-store.cjs');
    const { deleteCdeSession } = require('../cde/cde-session-store.cjs');
    if (session.authApproach === 'IS' && session.isGatewayCookie) {
      try {
        const { gatewayBaseUrl } = require('../is/is-auth-server.cjs');
        await fetch(`${gatewayBaseUrl()}/api/v1/sso/logout`, {
          method: 'POST',
          headers: { cookie: session.isGatewayCookie, accept: 'application/json' },
        });
      } catch {
        // best-effort upstream logout
      }
    }
    await deleteAllRuntimeSessions(session.id);
    await deleteCdeSession(session.id);
    await deleteSession(session.id);
    clearSessionCookie(res);
    req.apiConsoleSession = null;
    return { authenticated: false };
  }
  throw new SessionError('ENDPOINT_NOT_FOUND', 'Session endpoint not found.', 404);
}

function summarizeSession(session) {
  if (!session || typeof session !== 'object') return null;
  return {
    id: session.id,
    userId: session.userId || null,
    userLoginName: session.userLoginName || null,
    displayName: session.displayName || null,
    role: session.role || null,
    applicationId: session.applicationId || null,
    authApproach: session.authApproach || (session.cdeConnected ? 'CDE' : null),
    cdeConnected: Boolean(session.cdeConnected),
    isConnected: session.authApproach === 'IS',
    createdAt: session.createdAt || null,
    updatedAt: session.updatedAt || null,
  };
}

async function listActiveSessions() {
  const sessions = [];
  const seen = new Set();
  for (const [key, entry] of memoryStore.entries()) {
    if (!key.startsWith(REDIS_PREFIX)) continue;
    if (!entry || entry.expiresAt <= Date.now()) {
      memoryStore.delete(key);
      continue;
    }
    try {
      const parsed = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
      const summary = summarizeSession(parsed);
      if (summary?.id && !seen.has(summary.id)) {
        seen.add(summary.id);
        sessions.push(summary);
      }
    } catch {
      // skip corrupt entries
    }
  }
  await withRedis(async client => {
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', `${REDIS_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      if (!keys.length) continue;
      const values = await client.mget(keys);
      values.forEach(raw => {
        if (!raw) return;
        try {
          const summary = summarizeSession(JSON.parse(raw));
          if (summary?.id && !seen.has(summary.id)) {
            seen.add(summary.id);
            sessions.push(summary);
          }
        } catch {
          // skip corrupt entries
        }
      });
    } while (cursor !== '0');
  }, () => undefined);
  sessions.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  return sessions;
}

module.exports = {
  SessionError,
  COOKIE_NAME,
  // Legacy browser context headers are opt-in only (tests / emergency). Never enable in production.
  isLegacyContextEnabled() {
    return process.env.API_CONSOLE_ALLOW_LEGACY_CONTEXT === 'true'
      && process.env.NODE_ENV !== 'production';
  },
  get LEGACY_CONTEXT_ENABLED() {
    return this.isLegacyContextEnabled();
  },
  ROLE_PRECEDENCE,
  attachSession,
  attachConsoleContext,
  assertCsrf,
  buildConsoleContext,
  publicConsoleContext,
  canHandleSession,
  clearSessionCookie,
  createSessionRecord,
  handleSession,
  markCdeConnected,
  markCdeDisconnected,
  markIsConnected,
  markIsDisconnected,
  isSessionAuthenticated,
  isBootstrapSystemAdmin,
  loginListIncludes,
  pickPrimaryRole,
  requireSession,
  resolveRole,
  resolveManagedScopeApplicationIds,
  listActiveSessions,
  saveSession,
  setSelectedProject,
  secretMaterial,
};
