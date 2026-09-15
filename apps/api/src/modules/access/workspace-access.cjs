'use strict';

class WorkspaceAccessError extends Error {
  constructor(category, message, statusCode = 403, details = undefined) {
    super(message);
    this.category = category;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * Required CDE project keys (workspaces) for console access.
 * Default outside tests: medu-ai
 * In NODE_ENV=test with unset/empty env: no gate so existing suites keep working.
 * Empty/whitespace outside test still defaults to medu-ai (misconfig must not open the gate).
 */
function requiredWorkspaces(env = process.env) {
  const hasExplicit = Object.prototype.hasOwnProperty.call(env, 'API_CONSOLE_REQUIRED_WORKSPACES');
  const parsed = hasExplicit ? parseList(env.API_CONSOLE_REQUIRED_WORKSPACES) : null;
  if (String(env.NODE_ENV || '') === 'test') {
    if (!hasExplicit) return [];
    return parsed;
  }
  if (parsed && parsed.length) return parsed;
  return ['medu-ai'];
}

/**
 * GATE_ONLY (default) — membership is required to enter; all CDE projects remain visible
 * RESTRICT — only allowlisted workspaces appear in context after login
 */
function allowlistMode(env = process.env) {
  const mode = String(env.API_CONSOLE_WORKSPACE_ALLOWLIST_MODE || 'GATE_ONLY').trim().toUpperCase();
  return mode === 'RESTRICT' ? 'RESTRICT' : 'GATE_ONLY';
}

function hasProjectKey(list, key) {
  const target = String(key || '').trim().toLowerCase();
  if (!target) return false;
  return list.some(item => String(item || '').trim().toLowerCase() === target);
}

function evaluateWorkspaceAccess(projects, env = process.env) {
  const required = requiredWorkspaces(env);
  const list = Array.isArray(projects) ? projects.map(String) : [];
  if (!required.length) {
    return {
      allowed: true,
      requiredWorkspaces: [],
      grantedWorkspaces: list.slice(),
      mode: allowlistMode(env),
    };
  }
  // Case-insensitive: CDE UI keys like medu-ai must match even if casing differs.
  const granted = required.filter(key => hasProjectKey(list, key));
  return {
    allowed: granted.length > 0,
    requiredWorkspaces: required,
    grantedWorkspaces: granted,
    mode: allowlistMode(env),
  };
}

function filterProjectsByPolicy(projects, env = process.env) {
  const evaluation = evaluateWorkspaceAccess(projects, env);
  if (!evaluation.allowed) return [];
  if (!evaluation.requiredWorkspaces.length || evaluation.mode === 'GATE_ONLY') {
    return Array.isArray(projects) ? projects.map(String) : [];
  }
  return evaluation.grantedWorkspaces.slice();
}

function assertWorkspaceAccess(projects, env = process.env) {
  const evaluation = evaluateWorkspaceAccess(projects, env);
  if (evaluation.allowed) return evaluation;
  throw new WorkspaceAccessError(
    'WORKSPACE_ACCESS_DENIED',
    `دسترسی فقط برای دارندگان ورک‌اسپیس‌های ${evaluation.requiredWorkspaces.join('، ')} مجاز است.`,
    403,
    {
      requiredWorkspaces: evaluation.requiredWorkspaces,
      grantedWorkspaces: evaluation.grantedWorkspaces,
      discoveredProjects: Array.isArray(projects) ? projects.map(String) : [],
      mode: evaluation.mode,
    },
  );
}

module.exports = {
  WorkspaceAccessError,
  requiredWorkspaces,
  allowlistMode,
  hasProjectKey,
  evaluateWorkspaceAccess,
  filterProjectsByPolicy,
  assertWorkspaceAccess,
};
