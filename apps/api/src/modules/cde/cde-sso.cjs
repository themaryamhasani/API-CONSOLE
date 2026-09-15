'use strict';

const { CookieJar } = require('tough-cookie');
const {
  createCdeState,
  getDataSource,
  getCdeOrigin,
  parseConfiguredOrigins,
  resolveOriginById,
  assertLogicalSuccess,
} = require('./core-client.cjs');
const { deleteCdeSession, setCdeSession } = require('./cde-session-store.cjs');
const {
  assertCsrf,
  markCdeConnected,
  markCdeDisconnected,
  requireSession,
  saveSession,
  COOKIE_NAME,
} = require('../session/session-server.cjs');
const {
  assertWorkspaceAccess,
  evaluateWorkspaceAccess,
  WorkspaceAccessError,
} = require('../access/workspace-access.cjs');
const { resultOf, projectKeysFromMyRepoResponse } = require('./repo-projects.cjs');

class CdeSsoError extends Error {
  constructor(category, message, statusCode = 400, details) {
    super(message);
    this.category = category;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function ssoMode(env = process.env) {
  const mode = String(env.API_CONSOLE_CDE_SSO_MODE || 'COOKIE_FORWARD').trim().toUpperCase();
  return mode === 'OFF' ? 'OFF' : 'COOKIE_FORWARD';
}

function defaultCookieNames() {
  // Prefer '*' (all non-console cookies) — CDE cookie names vary by deploy.
  return ['*'];
}

function allowedCookieNames(env = process.env) {
  const raw = String(env.API_CONSOLE_CDE_SSO_COOKIE_NAMES || '*').trim();
  if (!raw || raw === '*') return ['*'];
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

function parseCookieHeader(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    const raw = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  });
  return out;
}

function classifyBrowserCookies(req, env = process.env) {
  const allowList = allowedCookieNames(env);
  const allowAll = allowList.includes('*');
  const allow = new Set(allowList.map(name => name.toLowerCase()));
  const sessionCookie = String(env.API_CONSOLE_SESSION_COOKIE || COOKIE_NAME || 'api_console_session').toLowerCase();
  const all = parseCookieHeader(req.headers?.cookie);
  const allNames = Object.keys(all);
  const picked = {};
  const skipped = [];
  for (const [name, value] of Object.entries(all)) {
    const lower = name.toLowerCase();
    if (lower === sessionCookie || lower.startsWith('api_console')) {
      skipped.push({ name, reason: 'console_session' });
      continue;
    }
    if (!allowAll && !allow.has(lower) && !allow.has(name)) {
      skipped.push({ name, reason: 'not_allowlisted' });
      continue;
    }
    picked[name] = value;
  }
  return {
    allNames,
    pickedNames: Object.keys(picked),
    skipped,
    picked,
    cookieHeaderPresent: Boolean(req.headers?.cookie),
    cookieHeaderLength: String(req.headers?.cookie || '').length,
  };
}

function extractCdeBrowserCookies(req, env = process.env) {
  return classifyBrowserCookies(req, env).picked;
}

function registrableDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

function isSameSiteHost(consoleHost, cdeOriginUrl, env = process.env) {
  if (env.API_CONSOLE_CDE_SSO_ALLOW_CROSS_SITE === 'true') return true;
  try {
    const cdeHost = new URL(cdeOriginUrl).hostname;
    const consoleDomain = registrableDomain(consoleHost);
    const cdeDomain = registrableDomain(cdeHost);
    if (!consoleDomain || !cdeDomain) return false;
    if (consoleDomain === 'localhost' || cdeDomain === 'localhost') return false;
    return consoleDomain === cdeDomain;
  } catch {
    return false;
  }
}

function requestHost(req, env = process.env) {
  const forwardedRaw = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const hostHeader = String(req.headers.host || '').trim();
  const candidates = [forwardedRaw, hostHeader]
    .map(value => value.replace(/:\d+$/, '').toLowerCase())
    .filter(Boolean);
  let host = candidates.find(value => value !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(value)) || candidates[0] || '';
  // When Vite/Caddy leave only loopback hosts, fall back to PUBLIC_URL.
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const publicUrl = String(env.API_CONSOLE_PUBLIC_URL || '').trim();
    if (publicUrl) {
      try {
        host = new URL(publicUrl).hostname.toLowerCase();
      } catch {
        // keep loopback host
      }
    }
  }
  return host;
}

async function seedStateFromBrowserCookies(cookies, origin) {
  const state = createCdeState();
  const jar = new CookieJar();
  const base = String(origin || getCdeOrigin()).replace(/\/$/, '');
  for (const [name, value] of Object.entries(cookies || {})) {
    const cookieStr = `${name}=${value}; Path=/`;
    try {
      await jar.setCookie(cookieStr, `${base}/`, { ignoreError: true });
    } catch {
      // skip malformed
    }
  }
  state.cookieJar = jar.serializeSync();
  return state;
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

function consoleReturnUrl(req, env = process.env) {
  const configured = String(env.API_CONSOLE_PUBLIC_URL || env.API_CONSOLE_CORS_ORIGIN || '').replace(/\/$/, '');
  if (configured) return `${configured}/auth/callback`;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5280').split(',')[0].trim();
  return `${proto}://${host}/auth/callback`;
}

function ssoConfig(req, env = process.env) {
  const mode = ssoMode(env);
  const origins = parseConfiguredOrigins();
  const session = req?.apiConsoleSession;
  const origin = resolveOriginById(session?.cdeOriginId) || origins[0];
  const baseUrl = origin?.baseUrl || getCdeOrigin();
  const returnUrl = consoleReturnUrl(req, env);
  // CDE only honors same-origin relative ?return= paths — never absolute external URLs.
  // Open CDE in a new tab; user returns to console and we re-probe cookies.
  const loginUrl = `${baseUrl}/`;
  const host = requestHost(req, env);
  const sameSite = isSameSiteHost(host, baseUrl, env);
  const enabled = mode === 'COOKIE_FORWARD';
  return {
    enabled,
    mode,
    originId: origin?.id || 'default',
    originUrl: baseUrl,
    loginUrl,
    returnUrl,
    sameSiteEligible: sameSite,
    // Cookie forward only works when browser sends CDE cookies to this host.
    cookieForwardAvailable: enabled && sameSite,
    openInNewTab: true,
    messageFa: sameSite
      ? 'اگر در CDE وارد شده‌اید، نشست به‌صورت خودکار تشخیص داده می‌شود. در غیر این صورت پنجرهٔ ورود CDE را باز کنید و پس از ورود به این صفحه برگردید.'
      : 'روی این میزبان (مثلاً localhost) کوکی‌های CDE به کنسول نمی‌رسند؛ با شماره همراه و رمز وارد شوید. ورود با کوکی فقط روی زیردامنه‌ی مشترک با CDE (مثل *.edus.ir) کار می‌کند.',
  };
}

let loginEventRecorder = null;

function registerLoginEventRecorder(fn) {
  loginEventRecorder = typeof fn === 'function' ? fn : null;
}

async function recordLoginEvent(event) {
  if (!loginEventRecorder) return;
  try {
    await loginEventRecorder(event);
  } catch {
    // best-effort
  }
}

/**
 * Probe existing CDE browser session via cookie forwarding (same-site deploy).
 */
async function ssoProbe(req, options = {}) {
  assertCsrf(req);
  const env = options.env || process.env;
  const session = requireSession(req);
  const config = ssoConfig(req, env);

  if (config.mode === 'OFF') {
    await recordLoginEvent({ kind: 'SSO_PROBE', success: false, reason: 'SSO_DISABLED', userId: session.userId });
    return { connected: false, reason: 'SSO_DISABLED', csrfToken: session.csrfToken, config };
  }

  // Cookie reading is always attempted. Same-site only affects whether the browser can
  // actually send CDE cookies to this host (localhost cannot).
  const classified = classifyBrowserCookies(req, env);
  const cookies = classified.picked;
  const host = requestHost(req, env);
  console.log('[cde-sso] probe', {
    host,
    sameSiteEligible: config.sameSiteEligible,
    cookieHeaderPresent: classified.cookieHeaderPresent,
    cookieHeaderLength: classified.cookieHeaderLength,
    allNames: classified.allNames,
    pickedNames: classified.pickedNames,
    skipped: classified.skipped,
    forwardedHost: String(req.headers?.['x-forwarded-host'] || ''),
    rawHost: String(req.headers?.host || ''),
  });
  if (!Object.keys(cookies).length) {
    const reason = config.sameSiteEligible ? 'NO_CDE_COOKIES' : 'SSO_NOT_SAME_SITE';
    await recordLoginEvent({ kind: 'SSO_PROBE', success: false, reason, userId: session.userId });
    const onlyConsole = classified.allNames.length > 0
      && classified.allNames.every(name => {
        const lower = name.toLowerCase();
        return lower.startsWith('api_console') || lower === String(COOKIE_NAME || 'api_console_session').toLowerCase();
      });
    return {
      connected: false,
      reason,
      message: config.sameSiteEligible
        ? (onlyConsole
          ? `هدر Cookie فقط کوکی کنسول را دارد (${classified.allNames.join(', ') || '—'})؛ کوکی نشست CDE نیست. در CDE لاگین کنید و مجدد بررسی کنید، یا با شماره و رمز وارد شوید.`
          : 'کوکی نشست CDE دیده نشد. پنجرهٔ ورود CDE را باز کنید، لاگین کنید، سپس بررسی مجدد بزنید — یا با شماره و رمز وارد شوید.')
        : (config.messageFa || 'روی این میزبان کوکی‌های CDE به کنسول نمی‌رسند؛ با شماره و رمز وارد شوید.'),
      debug: {
        requestHost: host,
        cookieHeaderPresent: classified.cookieHeaderPresent,
        cookieHeaderLength: classified.cookieHeaderLength,
        allCookieNames: classified.allNames,
        pickedCookieNames: classified.pickedNames,
        skippedCookies: classified.skipped,
        forwardedHost: String(req.headers?.['x-forwarded-host'] || ''),
        rawHost: String(req.headers?.host || ''),
        sameSiteEligible: config.sameSiteEligible,
      },
      csrfToken: session.csrfToken,
      config,
    };
  }

  const origin = config.originUrl || getCdeOrigin();
  let state = await seedStateFromBrowserCookies(cookies, origin);
  let callResult;
  try {
    callResult = await getDataSource(state, 'pages-app/who-am-i', {});
    state = callResult.state;
  } catch (error) {
    await recordLoginEvent({
      kind: 'SSO_PROBE',
      success: false,
      reason: error.category || 'CDE_UNAVAILABLE',
      userId: session.userId,
    });
    return {
      connected: false,
      reason: error.category || 'CDE_UNAVAILABLE',
      message: error.message || 'CDE could not be reached.',
      csrfToken: session.csrfToken,
      config,
    };
  }

  const result = resultOf(callResult.response);
  if (!result.IsUserLogin) {
    await recordLoginEvent({ kind: 'SSO_PROBE', success: false, reason: 'NOT_LOGGED_IN', userId: session.userId });
    return { connected: false, reason: 'NOT_LOGGED_IN', csrfToken: session.csrfToken, config };
  }

  assertLogicalSuccess(callResult.response);
  const user = displayCdeUser(result.LoginUser);
  await setCdeSession(session.id, state);
  await markCdeConnected(session, user);

  // Fetch projects and enforce workspace gate
  let projects = [];
  try {
    const { probeRequiredWorkspaceKeys } = require('./workspace-probe.cjs');
    const repoResult = await getDataSource(state, 'cde/repository/list/my-repo', {});
    state = repoResult.state;
    const fromMyRepo = projectKeysFromMyRepoResponse(repoResult.response);
    const probed = await probeRequiredWorkspaceKeys(state, fromMyRepo, env);
    state = probed.state;
    projects = probed.projects;
    await setCdeSession(session.id, state);
    session.projects = Array.from(new Set(projects));
    await saveSession(session);
  } catch (error) {
    await recordLoginEvent({
      kind: 'SSO_PROBE',
      success: false,
      reason: error.category || 'PROJECTS_FAILED',
      userId: user.id,
    });
    throw error;
  }

  const access = evaluateWorkspaceAccess(projects, env);
  if (!access.allowed) {
    await recordLoginEvent({
      kind: 'WORKSPACE_DENIED',
      success: false,
      reason: 'WORKSPACE_ACCESS_DENIED',
      userId: user.id,
      details: { ...access, discoveredProjects: projects },
    });
    try {
      await deleteCdeSession(session.id);
    } catch {
      // best-effort
    }
    await markCdeDisconnected(session);
    session.workspaceDenial = {
      requiredWorkspaces: access.requiredWorkspaces,
      discoveredProjects: projects.map(String),
      at: new Date().toISOString(),
    };
    await saveSession(session);
    const err = new WorkspaceAccessError(
      'WORKSPACE_ACCESS_DENIED',
      `دسترسی فقط برای دارندگان ورک‌اسپیس‌های ${access.requiredWorkspaces.join('، ')} مجاز است.`,
      403,
      { ...access, discoveredProjects: projects },
    );
    throw err;
  }

  session.workspaceDenial = null;
  await saveSession(session);

  await recordLoginEvent({
    kind: 'SSO_PROBE',
    success: true,
    reason: 'CONNECTED',
    userId: user.id,
    details: { projects: access.grantedWorkspaces },
  });

  return {
    connected: true,
    user,
    projects: session.projects,
    workspaceAccess: access,
    ecreq: Boolean(result.ecreq),
    csrfToken: session.csrfToken,
    config,
  };
}

module.exports = {
  CdeSsoError,
  ssoMode,
  allowedCookieNames,
  extractCdeBrowserCookies,
  classifyBrowserCookies,
  seedStateFromBrowserCookies,
  isSameSiteHost,
  registrableDomain,
  requestHost,
  ssoConfig,
  ssoProbe,
  registerLoginEventRecorder,
  consoleReturnUrl,
};
