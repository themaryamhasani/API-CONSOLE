'use strict';

/**
 * Production readiness checklist (no secrets printed).
 * Usage: node scripts/prod-ready-check.cjs [.env.production]
 */

const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.argv[2] || path.join(__dirname, '../.env.production'));
const examplePath = path.resolve(__dirname, '../.env.production.example');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const map = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

const required = [
  'NODE_ENV',
  'API_CONSOLE_PUBLIC_URL',
  'API_CONSOLE_CORS_ORIGIN',
  'API_CONSOLE_CSRF_SECRET',
  'API_CONSOLE_SECRET_KEY',
  'CDE_SESSION_ENCRYPTION_KEY',
  'RUNTIME_SESSION_ENCRYPTION_KEY',
  'API_CONSOLE_ADMIN_LOGINS',
  'POSTGRES_PASSWORD',
];

const env = parseEnvFile(envPath);
const issues = [];

if (!env) {
  console.error(`Missing ${envPath}`);
  console.error(`Copy from ${examplePath} and fill secrets.`);
  process.exit(1);
}

for (const key of required) {
  const value = String(env[key] || '');
  if (!value) {
    issues.push(`${key} is missing`);
    continue;
  }
  if (value.includes('REPLACE_ME') || value.toLowerCase().includes('change-me')) {
    issues.push(`${key} still has a placeholder value`);
  }
}

if (String(env.NODE_ENV || '') !== 'production') {
  issues.push('NODE_ENV must be production');
}

if (String(env.API_CONSOLE_IS_ENABLED || 'false').toLowerCase() !== 'false'
  && String(env.API_CONSOLE_IS_ENABLED).toLowerCase() !== '0'
  && String(env.API_CONSOLE_IS_ENABLED).toLowerCase() !== 'off') {
  issues.push('API_CONSOLE_IS_ENABLED must be false for v1 delivery (IS is deferred)');
}

if (String(env.API_CONSOLE_ALLOW_LEGACY_CONTEXT || '').trim()) {
  issues.push('API_CONSOLE_ALLOW_LEGACY_CONTEXT must be empty/false in production');
}

const secretKeys = [
  'API_CONSOLE_CSRF_SECRET',
  'API_CONSOLE_SECRET_KEY',
  'CDE_SESSION_ENCRYPTION_KEY',
  'RUNTIME_SESSION_ENCRYPTION_KEY',
  'POSTGRES_PASSWORD',
];
for (const key of secretKeys) {
  const value = String(env[key] || '');
  if (value && value.length < 32 && !value.includes('REPLACE_ME')) {
    issues.push(`${key} should be at least 32 characters`);
  }
}

const publicUrl = String(env.API_CONSOLE_PUBLIC_URL || '');
const isLocalHttp = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(publicUrl);
if (!/^https:\/\//i.test(publicUrl) && !isLocalHttp) {
  issues.push('API_CONSOLE_PUBLIC_URL should be https:// for production SSO/cookies (http://localhost allowed for local Compose)');
}

if (issues.length) {
  console.error('Production readiness FAILED:');
  for (const issue of issues) console.error(` - ${issue}`);
  process.exit(1);
}

console.log('Production readiness OK');
console.log(` - env file: ${envPath}`);
console.log(` - release: v1-cde-local (IS off)`);
console.log(` - public: ${env.API_CONSOLE_PUBLIC_URL}`);
console.log(` - store: ${env.API_CONSOLE_STORE_BACKEND || 'POSTGRES'}`);
process.exit(0);
