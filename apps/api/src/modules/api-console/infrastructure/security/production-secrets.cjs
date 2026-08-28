'use strict';

/**
 * Production secret hardening (S02.02).
 * Rejects short or placeholder secrets when NODE_ENV=production.
 */

const SECRET_CHECKS = [
  { env: 'API_CONSOLE_CSRF_SECRET', label: 'CSRF secret (API_CONSOLE_CSRF_SECRET)' },
  { env: 'CDE_SESSION_ENCRYPTION_KEY', label: 'CDE session key (CDE_SESSION_ENCRYPTION_KEY)' },
  { env: 'RUNTIME_SESSION_ENCRYPTION_KEY', label: 'Runtime session key (RUNTIME_SESSION_ENCRYPTION_KEY)' },
  { env: 'API_CONSOLE_SECRET_KEY', label: 'Vault key (API_CONSOLE_SECRET_KEY)' },
];

function inspectSecretValue(value, label) {
  const issues = [];
  const raw = String(value || '');
  if (!raw) {
    issues.push(`${label} is missing`);
    return issues;
  }
  if (raw.toLowerCase().includes('change-me')) {
    issues.push(`${label} still contains placeholder 'change-me'`);
  }
  if (raw.length < 32) {
    issues.push(`${label} must be at least 32 characters (got ${raw.length})`);
  }
  return issues;
}

function inspectProductionSecrets(env = process.env) {
  const issues = [];
  for (const item of SECRET_CHECKS) {
    issues.push(...inspectSecretValue(env[item.env], item.label));
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}

function assertProductionSecrets(env = process.env) {
  if (String(env.NODE_ENV || '') !== 'production') return;
  const result = inspectProductionSecrets(env);
  if (!result.ok) {
    throw new Error(`Production secrets misconfigured:\n- ${result.issues.join('\n- ')}`);
  }
}

module.exports = {
  SECRET_CHECKS,
  assertProductionSecrets,
  inspectProductionSecrets,
  inspectSecretValue,
};
