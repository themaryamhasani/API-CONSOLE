'use strict';

const { randomBytes, scrypt, timingSafeEqual } = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(scrypt);

const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LEN = 32;

/**
 * Format: scrypt$N$r$p$saltB64$hashB64
 */
async function hashPassword(password) {
  const plain = String(password || '');
  if (plain.length < 8) {
    const error = new Error('Password must be at least 8 characters.');
    error.category = 'PASSWORD_TOO_SHORT';
    error.statusCode = 422;
    throw error;
  }
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEY_LEN, {
    N: DEFAULT_N,
    r: DEFAULT_R,
    p: DEFAULT_P,
  });
  return `scrypt$${DEFAULT_N}$${DEFAULT_R}$${DEFAULT_P}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

async function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const derived = await scryptAsync(String(password || ''), salt, expected.length, { N, r, p });
  const actual = Buffer.from(derived);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
