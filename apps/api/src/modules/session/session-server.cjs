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

function isBootstrapSystemAdmin(userLoginName) {
  return loginListIncludes(process.env.API_CONSOLE_ADMIN_LOGINS, userLoginName);
}

function resolveRole(userLoginName, userId) {
  const login = String(userLoginName || '');
  if (isBootstrapSystemAdmin(login) || hasManagedSystemAdminRole(login, userId)) return 'SYSTEM_ADMIN';
  if (loginListIncludes(process.env.API_CONSOLE_QA_LEAD_LOGINS, login)) return 'QA_LEAD';
  return 'DEVELOPER';
}

function createSessionRecord(partial = {}) {
  const id = randomBytes(24).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  return {
    id,
    csrfToken,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cdeConnected: false,
    userLoginName: null,
    userId: null,
    displayName: null,
    firstName: null,
    lastName: null,
    role: 'DEVELOPER',
    applicationId: null,
    projects: [],
    ...partial,
  };
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
  if (!session?.cdeConnected || !session.userId) return null;
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
  return {
    contextId: `cde:${session.id}`,
    userId: session.userId,
    user,
    assignmentId: `cde:${session.userId}:${applicationId}`,
    assignmentIds: [`cde:${session.userId}:${applicationId}`],
    applicationId,
    scopeApplicationIds: [applicationId],
    application,
    applications,
    // Resolve on every request so an administrator assignment becomes effective
    // without requiring the target CDE account to sign in again.
    role: resolveRole(session.userLoginName, session.userId),
    scope: 'SYSTEMS',
    token: session.csrfToken,
  };
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
  session.cdeConnected = true;
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
  session.cdeConnected = false;
  session.userLoginName = null;
  session.userId = null;
  session.displayName = null;
  session.firstName = null;
  session.lastName = null;
  session.applicationId = null;
  session.projects = [];
  session.role = 'DEVELOPER';
  await saveSession(session);
  return session;
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
    return {
      authenticated: Boolean(session.cdeConnected && context),
      cdeConnected: Boolean(session.cdeConnected),
      csrfToken: session.csrfToken,
      activeContext: context,
      user: context?.user || null,
      applicationId: session.applicationId,
      projects: session.projects || [],
    };
  }
  if (pathname === '/api/session/context' && req.method === 'POST') {
    assertCsrf(req);
    if (!session.cdeConnected) {
      throw new SessionError('CDE_NOT_CONNECTED', 'Connect a CDE account before selecting a project.', 401);
    }
    const projectKey = String(body?.applicationId || body?.projectKey || '').trim();
    if (!projectKey) throw new SessionError('PROJECT_REQUIRED', 'projectKey is required.', 400);
    await setSelectedProject(session, projectKey, body?.projects);
    const context = buildConsoleContext(session);
    return { activeContext: context, csrfToken: session.csrfToken };
  }
  if (pathname === '/api/session/logout' && req.method === 'POST') {
    assertCsrf(req);
    const { deleteAllRuntimeSessions } = require('../runtime/runtime-session-store.cjs');
    await deleteAllRuntimeSessions(session.id);
    await deleteSession(session.id);
    clearSessionCookie(res);
    req.apiConsoleSession = null;
    return { authenticated: false };
  }
  throw new SessionError('ENDPOINT_NOT_FOUND', 'Session endpoint not found.', 404);
}

module.exports = {
  SessionError,
  COOKIE_NAME,
  LEGACY_CONTEXT_ENABLED: !process.env.NODE_ENV || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test',
  attachSession,
  attachConsoleContext,
  assertCsrf,
  buildConsoleContext,
  canHandleSession,
  clearSessionCookie,
  handleSession,
  markCdeConnected,
  markCdeDisconnected,
  isBootstrapSystemAdmin,
  requireSession,
  resolveRole,
  saveSession,
  setSelectedProject,
  secretMaterial,
};
