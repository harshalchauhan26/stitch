// Password hashing (scrypt) + signed tokens (HS256 JWT) using only node:crypto. Same as the prototype backend.
import crypto from 'node:crypto';

const secret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is not set');
  return 'dev-secret-change-me-in-production';
};
const b64 = (v) => Buffer.from(v).toString('base64url');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'));
}

export function signToken(claims, ttlSeconds = 12 * 3600) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = crypto.createHmac('sha256', secret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export function verifyToken(token) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const want = crypto.createHmac('sha256', secret()).update(`${h}.${b}`).digest('base64url');
  if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() / 1000 ? p : null; } catch { return null; }
}

export const initialsOf = (name) => String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
