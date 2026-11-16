import crypto from 'node:crypto';

export const SESSION_COOKIE_NAME = 'ronda_cfg_session';
export const DEFAULT_ADMIN_USERNAME = process.env.CONFIG_AUTH_USER || 'admtati';
export const DEFAULT_ADMIN_PASSWORD = process.env.CONFIG_AUTH_PASS || '"w$D[;*[8#g}V_bq';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !String(storedHash).includes(':')) return false;
  const [salt, keyHex] = String(storedHash).split(':');
  if (!salt || !keyHex) return false;
  try {
    const derived = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(keyHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function generateSessionSecret() {
  return crypto.randomBytes(32).toString('hex');
}

export function createSessionToken({ username, tokenVersion = 1, secret, ttlMs = SESSION_TTL_MS }) {
  const payload = Buffer.from(
    JSON.stringify({
      u: username,
      v: tokenVersion,
      exp: Date.now() + ttlMs
    }),
    'utf-8'
  ).toString('base64url');

  const sig = crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token, { secret, expectedUsername, expectedVersion = 1 }) {
  if (!token || !secret || !String(token).includes('.')) return null;
  const [payload, sigHex] = String(token).split('.');
  if (!payload || !sigHex) return null;

  try {
    const expectedSig = crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
    const sigBuf = Buffer.from(sigHex, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!decoded || typeof decoded.exp !== 'number' || Date.now() > decoded.exp) {
      return null;
    }
    if (decoded.u !== expectedUsername || decoded.v !== expectedVersion) {
      return null;
    }
    return { username: decoded.u, exp: decoded.exp };
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function extractSessionFromRequest(req, store) {
  const authCfg = store.getAuthConfig();
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[SESSION_COOKIE_NAME];

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }

  return verifySessionToken(token, {
    secret: authCfg.sessionSecret,
    expectedUsername: authCfg.username,
    expectedVersion: authCfg.tokenVersion
  });
}

export function createLoginRateLimiter({ maxAttempts = 10, windowMs = 5 * 60 * 1000 } = {}) {
  const attempts = new Map();

  return {
    isBlocked(ip) {
      const entry = attempts.get(ip);
      if (!entry) return false;
      if (Date.now() > entry.resetAt) {
        attempts.delete(ip);
        return false;
      }
      return entry.count >= maxAttempts;
    },
    recordFailure(ip) {
      const now = Date.now();
      const entry = attempts.get(ip);
      if (!entry || now > entry.resetAt) {
        attempts.set(ip, { count: 1, resetAt: now + windowMs });
      } else {
        entry.count += 1;
      }
    },
    clear(ip) {
      attempts.delete(ip);
    }
  };
}
