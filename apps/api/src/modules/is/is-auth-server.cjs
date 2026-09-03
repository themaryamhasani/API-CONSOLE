'use strict';

const {
  assertCsrf,
  requireSession,
  saveSession,
  setSelectedProject,
  markIsConnected,
  markIsDisconnected,
  buildConsoleContext,
  publicConsoleContext,
} = require('../session/session-server.cjs');

const PERSONAL_APPLICATION_ID = 'PERSONAL';
const IS_APPLICATION_PREFIX = 'is:';

class IsApiError extends Error {
  constructor(category, message, statusCode = 400, details) {
    super(message);
    this.category = category;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function isEnabled() {
  const raw = String(process.env.API_CONSOLE_IS_ENABLED || '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  if (raw === 'true' || raw === '1' || raw === 'on') return true;
  // Default on in non-production so local stacks work without extra env.
  return process.env.NODE_ENV !== 'production';
}

function gatewayBaseUrl() {
  const raw = String(process.env.API_CONSOLE_IS_GATEWAY_URL || 'http://127.0.0.1:4000').trim().replace(/\/+$/, '');
  return raw.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
}

function sessionCookieName() {
  return String(process.env.API_CONSOLE_IS_SESSION_COOKIE || '_lsr').trim() || '_lsr';
}

function normalizeCellphone(value) {
  const digits = String(value || '')
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\D+/g, '');
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('9')) return `0${digits}`;
  if (digits.length === 11 && digits.startsWith('09')) return digits;
  return digits;
}

function defaultSystemsCatalog() {
  const builtins = [
    ['sso', 'SSO / هویت'],
    ['iam', 'IAM'],
    ['base-entity', 'Base Entity'],
    ['entity-core', 'Entity Core'],
    ['flow-admin', 'Flow Admin'],
    ['flow-runtime', 'Flow Runtime'],
    ['flow-monitor', 'Flow Monitor'],
    ['idp', 'IDP Core'],
    ['idp-docs', 'Docs & Specs'],
    ['idp-portal', 'Developer Portal'],
    ['idp-tasks', 'IDP Tasks'],
    ['idp-spec-runtime', 'Spec Runtime'],
    ['idp-spec-kernel-exec', 'Spec Kernel Exec'],
    ['exam-centers', 'Exam Centers'],
    ['student-pre-registration', 'پیش‌ثبت‌نام'],
    ['internship', 'کارورزی'],
    ['myprofile', 'My Profile'],
    ['savabegh', 'سوابق'],
    ['improvement', 'بهبود'],
    ['outsourcing', 'برونسپاری'],
    ['parent-teacher-association', 'انجمن اولیا'],
    ['planning', 'برنامه‌ریزی'],
    ['final', 'نهایی'],
    ['report-card', 'کارنامه'],
  ];
  const fromEnv = String(process.env.API_CONSOLE_IS_SYSTEMS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(key => {
      const [id, label] = key.split('|').map(part => part.trim());
      return [id, label || id];
    });
  const merged = new Map();
  for (const [id, label] of [...builtins, ...fromEnv]) {
    if (!id) continue;
    merged.set(id, label);
  }
  return Array.from(merged.entries()).map(([serviceKey, label]) => ({
    applicationId: `${IS_APPLICATION_PREFIX}${serviceKey}`,
    serviceKey,
    label,
    basePath: `/api/v1/${serviceKey}`,
    gatewayBaseUrl: gatewayBaseUrl(),
  }));
}

function extractNamedCookie(setCookieHeaders, cookieName) {
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [];
  for (const header of headers) {
    const first = String(header || '').split(';')[0].trim();
    if (first.toLowerCase().startsWith(`${cookieName.toLowerCase()}=`)) {
      return first;
    }
  }
  return null;
}

async function gatewayFetch(pathname, { method = 'GET', body, cookieHeader, headers = {} } = {}) {
  const url = `${gatewayBaseUrl()}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const init = {
    method,
    headers: {
      accept: 'application/json',
      ...headers,
    },
  };
  if (cookieHeader) init.headers.cookie = cookieHeader;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new IsApiError(
      'IS_GATEWAY_UNREACHABLE',
      `اتصال به Gateway IS برقرار نشد (${gatewayBaseUrl()}): ${error.message || 'network error'}`,
      502,
    );
  }
  const setCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.raw?.()['set-cookie'] || []);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { response, payload, setCookie };
}

function displayIsUser(me, fallbackCellphone = '') {
  const contact = me?.contact;
  const phone = typeof contact === 'string'
    ? contact
    : (contact?.cellphone || contact?.value || fallbackCellphone || '');
  const displayName = String(me?.displayName || me?.username || phone || me?.id || 'IS User');
  return {
    id: String(me?.id || me?.username || phone || displayName),
    firstName: '',
    lastName: '',
    displayName,
    userLoginName: String(phone || me?.username || me?.id || ''),
    roles: Array.isArray(me?.roles) ? me.roles : [],
  };
}

function systemApplicationIds() {
  return [PERSONAL_APPLICATION_ID, ...defaultSystemsCatalog().map(item => item.applicationId)];
}

async function fetchAuthConfig() {
  if (!isEnabled()) {
    return {
      enabled: false,
      gatewayBaseUrl: gatewayBaseUrl(),
      sessionCookieName: sessionCookieName(),
      passwordLoginEnabled: false,
      message: 'رویکرد Integrated Systems در این محیط غیرفعال است.',
    };
  }
  try {
    const { response, payload } = await gatewayFetch('/api/v1/sso/auth-config');
    if (!response.ok) {
      return {
        enabled: true,
        gatewayBaseUrl: gatewayBaseUrl(),
        sessionCookieName: sessionCookieName(),
        passwordLoginEnabled: true,
        gatewayReachable: false,
        message: 'Gateway پاسخ auth-config نداد؛ ورود ممکن است ناموفق باشد.',
        upstream: payload,
      };
    }
    const data = payload?.data || payload || {};
    return {
      enabled: true,
      gatewayBaseUrl: gatewayBaseUrl(),
      sessionCookieName: sessionCookieName(),
      passwordLoginEnabled: data.passwordLoginEnabled !== false,
      passwordLoginDisabledMessageFa: data.passwordLoginDisabledMessageFa || null,
      externalProviders: Array.isArray(data.externalProviders) ? data.externalProviders : [],
      gatewayReachable: true,
    };
  } catch (error) {
    return {
      enabled: true,
      gatewayBaseUrl: gatewayBaseUrl(),
      sessionCookieName: sessionCookieName(),
      passwordLoginEnabled: true,
      gatewayReachable: false,
      message: error.message,
    };
  }
}

async function loginWithPassword(session, cellphone, password) {
  if (!isEnabled()) {
    throw new IsApiError('IS_DISABLED', 'رویکرد Integrated Systems غیرفعال است.', 403);
  }
  const normalized = normalizeCellphone(cellphone);
  if (!normalized || normalized.length < 10) {
    throw new IsApiError('IS_LOGIN_INVALID', 'شماره همراه معتبر وارد کنید.', 400);
  }
  if (!password) {
    throw new IsApiError('IS_LOGIN_INVALID', 'رمز عبور الزامی است.', 400);
  }

  const { response, payload, setCookie } = await gatewayFetch('/api/v1/sso/login', {
    method: 'POST',
    body: { cellphone: normalized, password },
  });

  if (!response.ok) {
    const code = payload?.code || payload?.error?.code;
    if (response.status === 403 || code === 'PASSWORD_LOGIN_DISABLED') {
      throw new IsApiError(
        'IS_PASSWORD_LOGIN_DISABLED',
        payload?.error || payload?.message || 'ورود با رمز در SSO غیرفعال است.',
        403,
        payload,
      );
    }
    if (response.status === 401) {
      throw new IsApiError('IS_INVALID_CREDENTIALS', 'شماره یا رمز عبور نادرست است.', 401, payload);
    }
    throw new IsApiError(
      'IS_LOGIN_FAILED',
      payload?.error || payload?.message || 'ورود به Integrated Systems ناموفق بود.',
      response.status || 502,
      payload,
    );
  }

  const cookiePair = extractNamedCookie(setCookie, sessionCookieName());
  if (!cookiePair) {
    throw new IsApiError('IS_SESSION_COOKIE_MISSING', 'Gateway کوکی نشست IS را برنگرداند.', 502);
  }

  const meResult = await gatewayFetch('/api/v1/sso/me', { cookieHeader: cookiePair });
  if (!meResult.response.ok) {
    throw new IsApiError('IS_ME_FAILED', 'خواندن پروفایل IS پس از ورود ناموفق بود.', 502, meResult.payload);
  }

  const user = displayIsUser(meResult.payload, normalized);
  await markIsConnected(session, user, {
    gatewayCookie: cookiePair,
    gatewayBaseUrl: gatewayBaseUrl(),
    isRoles: user.roles,
  });
  const live = await listSystemsForSession(session);
  const projectIds = [PERSONAL_APPLICATION_ID, ...(live.systems || []).map(item => item.applicationId)];
  await setSelectedProject(session, PERSONAL_APPLICATION_ID, projectIds);
  let isEnvironment = null;
  try {
    const { ensureIsGatewayEnvironment } = require('../api-console/infrastructure/http/api-console-server.cjs');
    isEnvironment = ensureIsGatewayEnvironment(gatewayBaseUrl());
  } catch {
    /* store may not be ready in isolated tests */
  }
  const context = buildConsoleContext(session);
  return {
    connected: true,
    authApproach: 'IS',
    csrfToken: session.csrfToken,
    user,
    activeContext: publicConsoleContext(context),
    systems: live.systems || defaultSystemsCatalog(),
    workspaces: live.workspaces || [],
    applicationId: session.applicationId,
    projects: session.projects || [],
    environmentId: isEnvironment?.id || null,
    environmentName: isEnvironment?.name || null,
  };
}

async function bridgeExistingCookie(session, cookieValue) {
  if (!isEnabled()) {
    throw new IsApiError('IS_DISABLED', 'رویکرد Integrated Systems غیرفعال است.', 403);
  }
  const name = sessionCookieName();
  let cookiePair = String(cookieValue || '').trim();
  if (!cookiePair) {
    throw new IsApiError('IS_COOKIE_REQUIRED', 'کوکی نشست Gateway الزامی است.', 400);
  }
  if (!cookiePair.includes('=')) {
    cookiePair = `${name}=${cookiePair}`;
  }
  const meResult = await gatewayFetch('/api/v1/sso/me', { cookieHeader: cookiePair });
  if (!meResult.response.ok) {
    throw new IsApiError('IS_SESSION_INVALID', 'نشست Gateway معتبر نیست.', 401, meResult.payload);
  }
  const user = displayIsUser(meResult.payload);
  await markIsConnected(session, user, {
    gatewayCookie: cookiePair,
    gatewayBaseUrl: gatewayBaseUrl(),
    isRoles: user.roles,
  });
  const live = await listSystemsForSession(session);
  const projectIds = [PERSONAL_APPLICATION_ID, ...(live.systems || []).map(item => item.applicationId)];
  await setSelectedProject(session, PERSONAL_APPLICATION_ID, projectIds);
  let isEnvironment = null;
  try {
    const { ensureIsGatewayEnvironment } = require('../api-console/infrastructure/http/api-console-server.cjs');
    isEnvironment = ensureIsGatewayEnvironment(gatewayBaseUrl());
  } catch {
    /* ignore */
  }
  return {
    connected: true,
    authApproach: 'IS',
    csrfToken: session.csrfToken,
    user,
    activeContext: publicConsoleContext(buildConsoleContext(session)),
    systems: live.systems || defaultSystemsCatalog(),
    workspaces: live.workspaces || [],
    applicationId: session.applicationId,
    projects: session.projects || [],
    environmentId: isEnvironment?.id || null,
    environmentName: isEnvironment?.name || null,
  };
}

async function isStatus(session) {
  if (!isEnabled()) {
    return { connected: false, enabled: false, authApproach: null };
  }
  if (session.authApproach !== 'IS' || !session.isGatewayCookie) {
    return {
      connected: false,
      enabled: true,
      authApproach: session.authApproach || null,
      gatewayBaseUrl: gatewayBaseUrl(),
    };
  }
  const meResult = await gatewayFetch('/api/v1/sso/me', { cookieHeader: session.isGatewayCookie });
  if (!meResult.response.ok) {
    await markIsDisconnected(session);
    return {
      connected: false,
      enabled: true,
      reconnectRequired: true,
      gatewayBaseUrl: gatewayBaseUrl(),
    };
  }
  return {
    connected: true,
    enabled: true,
    authApproach: 'IS',
    gatewayBaseUrl: gatewayBaseUrl(),
    user: displayIsUser(meResult.payload, session.userLoginName),
    csrfToken: session.csrfToken,
  };
}

async function disconnectIs(session) {
  if (session.isGatewayCookie) {
    try {
      await gatewayFetch('/api/v1/sso/logout', {
        method: 'POST',
        cookieHeader: session.isGatewayCookie,
      });
    } catch {
      // best-effort
    }
  }
  await markIsDisconnected(session);
  return { connected: false, authApproach: null, csrfToken: session.csrfToken };
}

function listSystems() {
  return {
    gatewayBaseUrl: gatewayBaseUrl(),
    systems: defaultSystemsCatalog(),
    warnings: [],
    discoveredAt: new Date().toISOString(),
    source: 'static',
  };
}

async function listSystemsForSession(session) {
  try {
    const { discoverSystemsLive } = require('./is-discovery.cjs');
    const cookie = session?.authApproach === 'IS' ? session.isGatewayCookie : '';
    const live = await discoverSystemsLive(cookie || '');
    return { ...live, source: live.source || 'specs-disk' };
  } catch (error) {
    const fallback = listSystems();
    fallback.warnings = [
      ...(fallback.warnings || []),
      { code: 'LIVE_DISCOVERY_FAILED', message: error.message || 'live discovery failed' },
    ];
    return fallback;
  }
}

function canHandleIs(pathname) {
  return pathname === '/api/auth/is/config'
    || pathname === '/api/auth/is/login'
    || pathname === '/api/auth/is/session/bridge'
    || pathname === '/api/auth/is/session'
    || pathname === '/api/auth/is/session/logout'
    || pathname === '/api/api-console/is/systems'
    || pathname === '/api/api-console/is/workspaces'
    || pathname === '/api/api-console/is/products'
    || /^\/api\/api-console\/is\/systems\/[^/]+\/apis$/.test(pathname)
    || /^\/api\/api-console\/is\/products\/[^/]+\/apis$/.test(pathname);
}

async function handleIs(req, parsedUrl, body) {
  const pathname = parsedUrl.pathname;
  const session = requireSession(req);

  if (pathname === '/api/auth/is/config' && req.method === 'GET') {
    return fetchAuthConfig();
  }

  if (pathname === '/api/auth/is/login' && req.method === 'POST') {
    assertCsrf(req);
    return loginWithPassword(session, body?.cellphone || body?.userLoginName, body?.password);
  }

  if (pathname === '/api/auth/is/session/bridge' && req.method === 'POST') {
    assertCsrf(req);
    return bridgeExistingCookie(session, body?.gatewayCookie || body?.cookie || body?.lsr);
  }

  if (pathname === '/api/auth/is/session' && req.method === 'GET') {
    return isStatus(session);
  }

  if (pathname === '/api/auth/is/session/logout' && req.method === 'POST') {
    assertCsrf(req);
    return disconnectIs(session);
  }

  if (pathname === '/api/api-console/is/systems' && req.method === 'GET') {
    if (session.authApproach !== 'IS' && !session.cdeConnected) {
      throw new IsApiError('AUTHENTICATION_ERROR', 'Login required.', 401);
    }
    const result = await listSystemsForSession(session);
    if (session.authApproach === 'IS' && Array.isArray(result.systems) && result.systems.length) {
      const ids = [PERSONAL_APPLICATION_ID, ...result.systems.map(item => item.applicationId)];
      await setSelectedProject(session, session.applicationId || PERSONAL_APPLICATION_ID, ids);
    }
    return result;
  }

  if (pathname === '/api/api-console/is/workspaces' && req.method === 'GET') {
    if (session.authApproach !== 'IS' && !session.cdeConnected) {
      throw new IsApiError('AUTHENTICATION_ERROR', 'Login required.', 401);
    }
    const { listWorkspaces } = require('./is-discovery.cjs');
    return {
      gatewayBaseUrl: gatewayBaseUrl(),
      workspaces: listWorkspaces(),
      discoveredAt: new Date().toISOString(),
      source: 'specs-disk',
    };
  }

  if (pathname === '/api/api-console/is/products' && req.method === 'GET') {
    if (session.authApproach !== 'IS' && !session.cdeConnected) {
      throw new IsApiError('AUTHENTICATION_ERROR', 'Login required.', 401);
    }
    const workspaceRaw = parsedUrl.searchParams.get('workspace');
    const category = parsedUrl.searchParams.get('category') || undefined;
    const { listProductsFromDisk } = require('./is-discovery.cjs');
    return listProductsFromDisk({
      workspaceIndex: workspaceRaw == null || workspaceRaw === '' ? undefined : Number(workspaceRaw),
      category,
    });
  }

  const productApisMatch = pathname.match(/^\/api\/api-console\/is\/products\/([^/]+)\/apis$/);
  if (productApisMatch && req.method === 'GET') {
    if (session.authApproach !== 'IS' && !session.cdeConnected) {
      throw new IsApiError('AUTHENTICATION_ERROR', 'Login required.', 401);
    }
    const specFolder = decodeURIComponent(productApisMatch[1]);
    const workspaceRaw = parsedUrl.searchParams.get('workspace');
    const { discoverSystemApis } = require('./is-discovery.cjs');
    return discoverSystemApis(specFolder, session.isGatewayCookie || '', {
      specFolder,
      workspaceIndex: workspaceRaw == null || workspaceRaw === '' ? undefined : Number(workspaceRaw),
    });
  }

  const apisMatch = pathname.match(/^\/api\/api-console\/is\/systems\/([^/]+)\/apis$/);
  if (apisMatch && req.method === 'GET') {
    if (session.authApproach !== 'IS' && !session.cdeConnected) {
      throw new IsApiError('AUTHENTICATION_ERROR', 'Login required.', 401);
    }
    const serviceKey = decodeURIComponent(apisMatch[1]);
    const workspaceRaw = parsedUrl.searchParams.get('workspace');
    const specFolder = parsedUrl.searchParams.get('specFolder') || undefined;
    const { discoverSystemApis } = require('./is-discovery.cjs');
    return discoverSystemApis(serviceKey, session.isGatewayCookie || '', {
      specFolder,
      workspaceIndex: workspaceRaw == null || workspaceRaw === '' ? undefined : Number(workspaceRaw),
    });
  }

  throw new IsApiError('ENDPOINT_NOT_FOUND', 'IS endpoint not found.', 404);
}

module.exports = {
  IsApiError,
  PERSONAL_APPLICATION_ID,
  IS_APPLICATION_PREFIX,
  canHandleIs,
  handleIs,
  isEnabled,
  gatewayBaseUrl,
  listSystems,
  listSystemsForSession,
  defaultSystemsCatalog,
  systemApplicationIds,
};
