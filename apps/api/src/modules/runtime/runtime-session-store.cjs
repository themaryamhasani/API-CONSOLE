const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('crypto');
const Redis = require('ioredis');

const SESSION_TTL_SECONDS = Number(process.env.RUNTIME_SESSION_TTL_SECONDS || 2 * 60 * 60);
const REDIS_PREFIX = process.env.RUNTIME_SESSION_REDIS_PREFIX || 'api-console:runtime-session:';
const configuredEncryptionKey = process.env.RUNTIME_SESSION_ENCRYPTION_KEY || '';
if (process.env.NODE_ENV === 'production' && configuredEncryptionKey.length < 32) {
  throw new Error('RUNTIME_SESSION_ENCRYPTION_KEY must contain at least 32 characters in production.');
}
const encryptionKey = createHash('sha256')
  .update(configuredEncryptionKey || 'api-console-development-runtime-session-key-change-me')
  .digest();
const memoryStore = new Map();
let redis;

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

function storeKey(appSessionId) {
  return `${REDIS_PREFIX}${appSessionId}`;
}

function encrypt(value, appSessionId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from(`api-console-runtime:${appSessionId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

function decrypt(value, appSessionId) {
  const packed = Buffer.from(String(value), 'base64url');
  if (packed.length < 29) throw new Error('RUNTIME_ENCRYPTED_VALUE_INVALID');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAAD(Buffer.from(`api-console-runtime:${appSessionId}`));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
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

function memorySet(key, value, ttlSeconds = SESSION_TTL_SECONDS) {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
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

async function readContainer(appSessionId) {
  const key = storeKey(appSessionId);
  // A development request may be written to the in-memory fallback while Redis
  // is briefly unavailable. If Redis recovers before the next request, a null
  // Redis result must not hide that live fallback session.
  const encodedFromRedis = await withRedis(client => client.get(key), () => null);
  const encoded = encodedFromRedis || memoryGet(key);
  if (!encoded) return { profiles: {} };
  try {
    const parsed = decrypt(encoded, appSessionId);
    return parsed && typeof parsed === 'object' && parsed.profiles && typeof parsed.profiles === 'object'
      ? parsed
      : { profiles: {} };
  } catch {
    memoryStore.delete(key);
    await withRedis(client => client.del(key), () => undefined);
    return { profiles: {} };
  }
}

async function writeContainer(appSessionId, container, ttlSeconds = SESSION_TTL_SECONDS) {
  const key = storeKey(appSessionId);
  const encoded = encrypt(container, appSessionId);
  // Keep a local encrypted mirror so a transient Redis failure/recovery cannot
  // make a Runtime login disappear between API Console and generated Swagger.
  memorySet(key, encoded, ttlSeconds);
  await withRedis(
    client => client.set(key, encoded, 'EX', ttlSeconds),
    () => undefined
  );
}

async function getRuntimeSession(appSessionId, profileId) {
  const container = await readContainer(String(appSessionId));
  return container.profiles[String(profileId)] || null;
}

async function setRuntimeSession(appSessionId, profileId, state, ttlSeconds = SESSION_TTL_SECONDS) {
  const sessionId = String(appSessionId);
  const container = await readContainer(sessionId);
  container.profiles[String(profileId)] = state;
  container.updatedAt = new Date().toISOString();
  await writeContainer(sessionId, container, ttlSeconds);
  return state;
}

async function deleteRuntimeSession(appSessionId, profileId) {
  const sessionId = String(appSessionId);
  const container = await readContainer(sessionId);
  delete container.profiles[String(profileId)];
  if (!Object.keys(container.profiles).length) {
    await deleteAllRuntimeSessions(sessionId);
    return;
  }
  await writeContainer(sessionId, container);
}

async function deleteAllRuntimeSessions(appSessionId) {
  const key = storeKey(String(appSessionId));
  memoryStore.delete(key);
  await withRedis(client => client.del(key), () => undefined);
}

function normalizedLoginName(value) {
  const digits = String(value || '')
    .replace(/[\u06F0-\u06F9]/g, digit => String('\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'.indexOf(digit)))
    .replace(/[\u0660-\u0669]/g, digit => String('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'.indexOf(digit)))
    .replace(/\D+/g, '');
  if (digits.startsWith('98') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits;
}

function candidateFromEncoded(key, encoded, profileId) {
  const appSessionId = String(key).slice(REDIS_PREFIX.length);
  if (!appSessionId || !encoded) return null;
  try {
    const container = decrypt(encoded, appSessionId);
    const state = container?.profiles?.[String(profileId)];
    return state ? { appSessionId, state } : null;
  } catch {
    return null;
  }
}

/**
 * Recovers a connected Runtime login created by another active API Console
 * browser session for the same CDE cellphone and Runtime Profile. This is used
 * only after the current app-session lookup misses, such as a generated Swagger
 * tab opened under a newly issued app cookie.
 */
async function findConnectedRuntimeSession(profileId, loginName, excludedAppSessionId = '') {
  const expectedLogin = normalizedLoginName(loginName);
  if (!expectedLogin) return null;
  const candidates = [];
  const seen = new Set();

  for (const [key, entry] of memoryStore.entries()) {
    if (!key.startsWith(REDIS_PREFIX)) continue;
    const encoded = memoryGet(key);
    if (!encoded) continue;
    const candidate = candidateFromEncoded(key, encoded, profileId);
    if (candidate && candidate.appSessionId !== String(excludedAppSessionId || '')) {
      seen.add(candidate.appSessionId);
      candidates.push(candidate);
    }
  }

  await withRedis(async client => {
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', `${REDIS_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      if (!keys.length) continue;
      const values = await client.mget(keys);
      keys.forEach((key, index) => {
        const appSessionId = String(key).slice(REDIS_PREFIX.length);
        if (seen.has(appSessionId) || appSessionId === String(excludedAppSessionId || '')) return;
        const candidate = candidateFromEncoded(key, values[index], profileId);
        if (candidate) candidates.push(candidate);
      });
    } while (cursor !== '0');
  }, () => undefined);

  return candidates
    .filter(candidate => candidate.state?.phase === 'CONNECTED' && normalizedLoginName(candidate.state.loginName) === expectedLogin)
    .sort((left, right) => String(right.state.lastUsedAt || right.state.connectedAt || '').localeCompare(String(left.state.lastUsedAt || left.state.connectedAt || '')))[0] || null;
}

module.exports = {
  SESSION_TTL_SECONDS,
  deleteAllRuntimeSessions,
  deleteRuntimeSession,
  findConnectedRuntimeSession,
  getRuntimeSession,
  setRuntimeSession,
};
