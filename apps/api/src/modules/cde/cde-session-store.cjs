const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('crypto');
const Redis = require('ioredis');

const SESSION_TTL_SECONDS = Number(process.env.CDE_SESSION_TTL_SECONDS || 12 * 60 * 60);
const REDIS_PREFIX = process.env.CDE_SESSION_REDIS_PREFIX || 'api-console:cde-session:';
const configuredEncryptionKey = process.env.CDE_SESSION_ENCRYPTION_KEY || '';
if (process.env.NODE_ENV === 'production' && configuredEncryptionKey.length < 32) {
  throw new Error('CDE_SESSION_ENCRYPTION_KEY must contain at least 32 characters in production.');
}
const encryptionKey = createHash('sha256')
  .update(configuredEncryptionKey || 'api-console-development-cde-session-key-change-me')
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

function encrypt(value, purpose = 'session') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from(`api-console-cde:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

function decrypt(value, purpose = 'session') {
  const packed = Buffer.from(String(value), 'base64url');
  if (packed.length < 29) throw new Error('CDE_ENCRYPTED_VALUE_INVALID');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAAD(Buffer.from(`api-console-cde:${purpose}`));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
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
  try {
    const client = redisClient();
    if (client.status === 'wait') await client.connect();
    return await operation(client);
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    return fallback();
  }
}

async function getCdeSession(sessionId) {
  const key = storeKey(sessionId);
  const encoded = await withRedis(client => client.get(key), () => memoryGet(key));
  if (!encoded) return null;
  return decrypt(encoded);
}

async function setCdeSession(sessionId, state, ttlSeconds = SESSION_TTL_SECONDS) {
  const key = storeKey(sessionId);
  const encoded = encrypt(state);
  await withRedis(
    client => client.set(key, encoded, 'EX', ttlSeconds),
    () => memoryStore.set(key, { value: encoded, expiresAt: Date.now() + ttlSeconds * 1000 })
  );
  return state;
}

async function deleteCdeSession(sessionId) {
  const key = storeKey(sessionId);
  await withRedis(client => client.del(key), () => memoryStore.delete(key));
}

function createLoginChallenge(sessionId, userLoginName) {
  return encrypt({
    sessionId,
    userLoginName: String(userLoginName),
    expiresAt: Date.now() + 5 * 60 * 1000,
  }, 'login-challenge');
}

function readLoginChallenge(sessionId, challenge) {
  const value = decrypt(challenge, 'login-challenge');
  if (value.sessionId !== sessionId || Number(value.expiresAt) <= Date.now()) {
    throw new Error('CDE_LOGIN_CHALLENGE_EXPIRED');
  }
  return String(value.userLoginName || '');
}

module.exports = {
  SESSION_TTL_SECONDS,
  createLoginChallenge,
  deleteCdeSession,
  getCdeSession,
  readLoginChallenge,
  setCdeSession,
};
