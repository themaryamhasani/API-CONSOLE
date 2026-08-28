'use strict';

/**
 * Vault provider abstraction (E08).
 * API_CONSOLE_VAULT_PROVIDER=local|env (default: local)
 */

const fs = require('fs');
const path = require('path');
const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../../../../..');

function resolveRepositoryPath(value) {
  return path.isAbsolute(value) ? value : path.join(REPOSITORY_ROOT, value);
}

function dataDir() {
  return resolveRepositoryPath(process.env.API_CONSOLE_DATA_DIR || path.join('runtime', 'api-console'));
}

function vaultFilePath() {
  return process.env.API_CONSOLE_SECRET_VAULT_FILE || path.join(dataDir(), 'api-console-secrets.json');
}

function keyFilePath() {
  return process.env.API_CONSOLE_SECRET_KEY_FILE || path.join(dataDir(), 'api-console-secret.key');
}

function ensureDataDirectory() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

function loadOrCreateSecretKey() {
  ensureDataDirectory();
  let key;
  if (process.env.API_CONSOLE_SECRET_KEY) {
    key = Buffer.from(process.env.API_CONSOLE_SECRET_KEY, 'base64');
  } else if (fs.existsSync(keyFilePath())) {
    key = Buffer.from(fs.readFileSync(keyFilePath(), 'utf8').trim(), 'base64');
  } else {
    key = randomBytes(32);
    fs.writeFileSync(keyFilePath(), key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  }
  if (key.length !== 32) {
    throw new Error('API Console secret key must be 32 bytes in base64 form.');
  }
  return key;
}

function loadSecretVault() {
  ensureDataDirectory();
  const file = vaultFilePath();
  if (!fs.existsSync(file)) return { version: 1, secrets: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      version: 1,
      secrets: parsed.secrets && typeof parsed.secrets === 'object' ? parsed.secrets : {},
    };
  } catch {
    return { version: 1, secrets: {} };
  }
}

function saveSecretVault(vault) {
  ensureDataDirectory();
  const file = vaultFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function encryptSecretValue(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadOrCreateSecretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    createdAt: new Date().toISOString(),
  };
}

function decryptSecretValue(record) {
  if (!record || record.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported API Console secret record.');
  }
  const decipher = createDecipheriv('aes-256-gcm', loadOrCreateSecretKey(), Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function envKeyForRef(ref) {
  const text = String(ref || '');
  const slug = text
    .replace(/^secret:\/\/api-console\//i, '')
    .replace(/^secret\//i, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
  return slug ? `API_CONSOLE_SECRET_${slug}` : 'API_CONSOLE_SECRET_UNKNOWN';
}

function createLocalProvider(deps = {}) {
  const load = deps.loadSecretVault || loadSecretVault;
  const save = deps.saveSecretVault || saveSecretVault;
  const encrypt = deps.encryptSecretValue || encryptSecretValue;
  const decrypt = deps.decryptSecretValue || decryptSecretValue;

  return {
    name: 'local',
    resolve(ref) {
      const vault = load();
      const record = vault.secrets?.[ref];
      if (!record) return null;
      return decrypt(record);
    },
    store(ref, value) {
      const vault = load();
      vault.secrets[ref] = encrypt(String(value ?? ''));
      save(vault);
      return ref;
    },
    delete(ref) {
      const vault = load();
      if (!vault.secrets?.[ref]) return false;
      delete vault.secrets[ref];
      save(vault);
      return true;
    },
  };
}

function createEnvProvider(deps = {}) {
  const env = deps.env || process.env;
  return {
    name: 'env',
    resolve(ref) {
      const text = String(ref || '');
      if (Object.prototype.hasOwnProperty.call(env, text) && env[text] != null && env[text] !== '') {
        return String(env[text]);
      }
      const key = envKeyForRef(text);
      if (Object.prototype.hasOwnProperty.call(env, key) && env[key] != null && env[key] !== '') {
        return String(env[key]);
      }
      return null;
    },
    store(ref, value) {
      const text = String(ref || '');
      const key = envKeyForRef(text);
      env[key] = String(value ?? '');
      env[text] = String(value ?? '');
      return text;
    },
    delete(ref) {
      const text = String(ref || '');
      const key = envKeyForRef(text);
      const existed = Object.prototype.hasOwnProperty.call(env, text) || Object.prototype.hasOwnProperty.call(env, key);
      delete env[text];
      delete env[key];
      return existed;
    },
  };
}

function getProvider(options = {}) {
  const mode = String(options.provider || process.env.API_CONSOLE_VAULT_PROVIDER || 'local').toLowerCase();
  if (mode === 'env') return createEnvProvider(options);
  return createLocalProvider(options);
}

module.exports = {
  getProvider,
  createLocalProvider,
  createEnvProvider,
  envKeyForRef,
  loadSecretVault,
  saveSecretVault,
  encryptSecretValue,
  decryptSecretValue,
  loadOrCreateSecretKey,
};
