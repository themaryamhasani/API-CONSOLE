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
  const encoded = await withRedis(client => client.get(key), () => memoryGet(key));
  if (!encoded) return { profiles: {} };
  try {
    const parsed = decrypt(encoded, appSessionId);
    return parsed && typeof parsed === 'object' && parsed.profiles && typeof parsed.profiles === 'object'
      ? parsed
      : { profiles: {} };
  } catch {
    await withRedis(client => client.del(key), () => memoryStore.delete(key));
    return { profiles: {} };
  }
}

async function writeContainer(appSessionId, container, ttlSeconds = SESSION_TTL_SECONDS) {
  const key = storeKey(appSessionId);
  const encoded = encrypt(container, appSessionId);
  await withRedis(
    client => client.set(key, encoded, 'EX', ttlSeconds),
    () => memoryStore.set(key, { value: encoded, expiresAt: Date.now() + ttlSeconds * 1000 })
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
  await withRedis(client => client.del(key), () => memoryStore.delete(key));
}

module.exports = {
  SESSION_TTL_SECONDS,
  deleteAllRuntimeSessions,
  deleteRuntimeSession,
  getRuntimeSession,
  setRuntimeSession,
};
