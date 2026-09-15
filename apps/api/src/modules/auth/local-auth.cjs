'use strict';

const { hashPassword, verifyPassword } = require('./password-hash.cjs');
const {
  assertCsrf,
  markLocalConnected,
  requireSession,
  saveSession,
  resolveRole,
} = require('../session/session-server.cjs');

class LocalAuthError extends Error {
  constructor(category, message, statusCode = 400, details) {
    super(message);
    this.category = category;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();

let storeApi = null;

function registerLocalAuthStore(api) {
  storeApi = api && typeof api === 'object' ? api : null;
}

function requireStoreApi() {
  if (!storeApi?.getStore || !storeApi?.saveStore) {
    throw new LocalAuthError('LOCAL_AUTH_NOT_READY', 'Local auth store is not registered.', 500);
  }
  return storeApi;
}

function clientKey(req, username) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || 'unknown';
  return `${ip}|${String(username || '').trim().toLowerCase()}`;
}

function assertLoginRateLimit(req, username) {
  const key = clientKey(req, username);
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + LOGIN_WINDOW_MS;
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    throw new LocalAuthError(
      'LOCAL_LOGIN_RATE_LIMITED',
      `Too many login attempts. Try again in ${retryAfterSec} seconds.`,
      429,
      { retryAfterSec },
    );
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
}

function clearLoginRateLimit(req, username) {
  loginAttempts.delete(clientKey(req, username));
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function findLocalUserByUsername(store, username) {
  const needle = normalizeUsername(username);
  if (!needle) return null;
  return (store.directoryUsers || []).find(user =>
    user.source === 'LOCAL'
    && normalizeUsername(user.username) === needle
  ) || null;
}

function canHandleLocalAuth(pathname) {
  return pathname === '/api/auth/local/login'
    || pathname === '/api/auth/local/logout';
}

async function localLogin(req, body) {
  const api = requireStoreApi();
  const store = api.getStore();
  const username = normalizeUsername(body?.username || body?.data?.username);
  const password = String(body?.password || body?.data?.password || '');
  if (!username || !password) {
    throw new LocalAuthError('LOCAL_CREDENTIALS_REQUIRED', 'Username and password are required.', 400);
  }
  assertLoginRateLimit(req, username);

  const user = findLocalUserByUsername(store, username);
  if (!user || user.isActive === false || !user.passwordHash) {
    api.audit?.('LOCAL_LOGIN_FAILED', { userId: 'anonymous', role: 'UNKNOWN' }, { username, reason: 'NOT_FOUND_OR_DISABLED' });
    throw new LocalAuthError('LOCAL_INVALID_CREDENTIALS', 'Invalid username or password.', 401);
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    api.audit?.('LOCAL_LOGIN_FAILED', { userId: user.id, role: 'UNKNOWN' }, { username, reason: 'BAD_PASSWORD' });
    throw new LocalAuthError('LOCAL_INVALID_CREDENTIALS', 'Invalid username or password.', 401);
  }

  clearLoginRateLimit(req, username);
  const session = requireSession(req);
  user.lastLoginAt = new Date().toISOString();
  user.updatedAt = user.lastLoginAt;
  api.saveStore(store);

  await markLocalConnected(session, {
    id: user.id,
    username: user.username,
    userLoginName: user.username,
    phoneNumber: user.phoneNumber,
    displayName: user.fullName,
    fullName: user.fullName,
  });
  session.role = resolveRole(user.username, user.id);
  await saveSession(session);

  api.audit?.('LOCAL_LOGIN_SUCCESS', session, { username: user.username, userId: user.id });

  const { buildConsoleContext, publicConsoleContext } = require('../session/session-server.cjs');
  const context = buildConsoleContext(session);
  return {
    connected: true,
    authApproach: 'LOCAL',
    authenticated: Boolean(context),
    csrfToken: session.csrfToken,
    user: {
      id: user.id,
      displayName: user.fullName,
      username: user.username,
      phoneNumber: user.phoneNumber || null,
    },
    activeContext: publicConsoleContext(context),
    applicationId: 'PERSONAL',
    projects: ['PERSONAL'],
  };
}

async function localLogout(req) {
  assertCsrf(req);
  const session = requireSession(req);
  const { deleteCdeSession } = require('../cde/cde-session-store.cjs');
  const { markCdeDisconnected } = require('../session/session-server.cjs');
  try {
    await deleteCdeSession(session.id);
  } catch {
    // best-effort
  }
  await markCdeDisconnected(session);
  return { connected: false, authApproach: null, csrfToken: session.csrfToken };
}

async function handleLocalAuth(req, parsedUrl, body) {
  const pathname = parsedUrl.pathname;
  if (pathname === '/api/auth/local/login' && req.method === 'POST') {
    return localLogin(req, body || {});
  }
  if (pathname === '/api/auth/local/logout' && req.method === 'POST') {
    return localLogout(req);
  }
  throw new LocalAuthError('LOCAL_ENDPOINT_NOT_FOUND', 'Local auth endpoint not found.', 404);
}

function assertValidUsername(username) {
  const value = normalizeUsername(username);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(value)) {
    throw new LocalAuthError(
      'LOCAL_USERNAME_INVALID',
      'Username must be 3–64 chars: letters, digits, dot, underscore, hyphen.',
      422,
    );
  }
  return value;
}

async function createLocalDirectoryUser(store, payload, actor, helpers) {
  const username = assertValidUsername(payload.username);
  const fullName = String(payload.fullName || payload.displayName || username).trim() || username;
  const password = String(payload.password || '');
  const role = String(payload.role || 'DEVELOPER').trim();
  if (!helpers.USER_ROLES.includes(role)) {
    throw new LocalAuthError('LOCAL_ROLE_INVALID', 'Unsupported directory role.', 422);
  }
  if ((store.directoryUsers || []).some(user => normalizeUsername(user.username) === username)) {
    throw new LocalAuthError('LOCAL_USERNAME_TAKEN', 'This username is already taken.', 409);
  }
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const id = helpers.makeId('local-user');
  const user = {
    id,
    fullName,
    username,
    phoneNumber: payload.phoneNumber ? String(payload.phoneNumber).trim() : null,
    email: payload.email ? String(payload.email).trim() : null,
    passwordHash,
    passwordUpdatedAt: now,
    lastLoginAt: null,
    source: 'LOCAL',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    createdBy: actor?.userId || null,
  };
  store.directoryUsers.unshift(user);
  store.directoryRoleAssignments.unshift({
    id: helpers.makeId('dir-role'),
    userId: id,
    role,
    applicationId: role === 'SYSTEM_ADMIN' ? 'ALL' : (payload.applicationId || 'ALL'),
    scope: 'APP',
    isActive: true,
    source: 'ADMIN_APPROVAL',
    createdAt: now,
    createdBy: actor?.userId || null,
  });
  if (role !== 'DEVELOPER') {
    store.directoryRoleAssignments.unshift({
      id: helpers.makeId('dir-role'),
      userId: id,
      role: 'DEVELOPER',
      applicationId: 'ALL',
      scope: 'APP',
      isActive: true,
      source: 'SESSION_SYNC',
      createdAt: now,
      createdBy: actor?.userId || null,
    });
  }
  helpers.audit('LOCAL_USER_CREATED', actor, { userId: id, username, role });
  helpers.saveStore(store);
  return helpers.directoryUserView(user);
}

async function patchLocalDirectoryUser(store, userId, payload, actor, helpers) {
  const user = (store.directoryUsers || []).find(item => item.id === userId && item.source === 'LOCAL');
  if (!user) throw new LocalAuthError('LOCAL_USER_NOT_FOUND', 'Local user not found.', 404);
  if (payload.fullName != null) user.fullName = String(payload.fullName).trim() || user.fullName;
  if (payload.email != null) user.email = String(payload.email).trim() || null;
  if (payload.phoneNumber != null) user.phoneNumber = String(payload.phoneNumber).trim() || null;
  if (payload.isActive === false) {
    if (helpers.directoryUserView(user).isSystemAdmin && helpers.systemAdministratorCount() <= 1) {
      throw new LocalAuthError('LOCAL_LAST_ADMIN', 'At least one active System Administrator must remain.', 409);
    }
    user.isActive = false;
  } else if (payload.isActive === true) {
    user.isActive = true;
  }
  user.updatedAt = new Date().toISOString();
  helpers.audit('LOCAL_USER_UPDATED', actor, {
    userId: user.id,
    username: user.username,
    isActive: user.isActive,
  });
  helpers.saveStore(store);
  return helpers.directoryUserView(user);
}

async function resetLocalPassword(store, userId, password, actor, helpers) {
  const user = (store.directoryUsers || []).find(item => item.id === userId && item.source === 'LOCAL');
  if (!user) throw new LocalAuthError('LOCAL_USER_NOT_FOUND', 'Local user not found.', 404);
  user.passwordHash = await hashPassword(password);
  user.passwordUpdatedAt = new Date().toISOString();
  user.updatedAt = user.passwordUpdatedAt;
  helpers.audit('LOCAL_PASSWORD_RESET', actor, { userId: user.id, username: user.username });
  helpers.saveStore(store);
  return helpers.directoryUserView(user);
}

function listLocalDirectoryUsers(store, helpers) {
  return (store.directoryUsers || [])
    .filter(user => user.source === 'LOCAL')
    .map(user => helpers.directoryUserView(user))
    .sort((left, right) => String(left.fullName || left.username || '').localeCompare(String(right.fullName || right.username || ''), 'fa'));
}

module.exports = {
  LocalAuthError,
  canHandleLocalAuth,
  handleLocalAuth,
  registerLocalAuthStore,
  hashPassword,
  verifyPassword,
  createLocalDirectoryUser,
  patchLocalDirectoryUser,
  resetLocalPassword,
  listLocalDirectoryUsers,
  normalizeUsername,
  findLocalUserByUsername,
  // test helpers
  _loginAttempts: loginAttempts,
  LOGIN_MAX_ATTEMPTS,
};
