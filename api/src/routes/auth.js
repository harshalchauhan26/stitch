import { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { signToken, verifyPassword, verifyToken } from '../lib/auth.js';
import { str } from '../lib/validate.js';
import { Brand, Tenant, User } from '../models/index.js';
import { loadScope } from '../services/scope.js';

/** Bearer token -> req.scope (user, teams, brand scope). Every route after this needs a valid login. */
export async function requireAuth(req, _res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const claims = verifyToken(token);
  if (!claims) throw new HttpError(401, 'Please sign in');
  const user = await User.findOne({ _id: claims.sub, active: true });
  if (!user) throw new HttpError(401, 'Please sign in');
  req.scope = await loadScope(user);
  next();
}

// In-memory login limiter: 8 failed tries per 15 minutes per IP + email, and 40 per IP across all emails
// (stops one IP trying many accounts). Old entries are pruned so the map cannot grow without bound.
const attempts = new Map();
const WINDOW = 15 * 60_000, PER_ACCOUNT = 8, PER_IP = 40;
function recent(key, now) {
  const hits = (attempts.get(key) || []).filter((t) => now - t < WINDOW);
  if (hits.length) attempts.set(key, hits); else attempts.delete(key);
  return hits;
}
function prune(now) {
  if (attempts.size < 5000) return;
  for (const k of attempts.keys()) recent(k, now);
}
const fail = (key, now) => attempts.set(key, [...(attempts.get(key) || []), now]);

export const authRouter = Router();

authRouter.post('/auth/login', async (req, res) => {
  const email = str(req.body?.email, 'Email', { required: true, max: 200 }).toLowerCase();
  const password = str(req.body?.password, 'Password', { required: true, max: 200 });
  const now = Date.now();
  const key = `${req.ip}|${email}`, ipKey = `ip|${req.ip}`;
  prune(now);
  if (recent(key, now).length >= PER_ACCOUNT || recent(ipKey, now).length >= PER_IP) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const user = await User.findOne({ email, active: true });
  const ok = user && verifyPassword(password, user.password_hash) && await Tenant.exists({ _id: user.tenant_id, active: true });
  if (!ok) {
    fail(key, now); fail(ipKey, now);
    throw new HttpError(401, 'Wrong email or password');
  }
  attempts.delete(key);
  res.json({ token: signToken({ sub: String(user._id), tid: String(user.tenant_id) }), user: { id: user._id, name: user.name, email: user.email, role: user.role } });
});

authRouter.post('/auth/logout', (_req, res) => res.status(204).end());   // tokens are stateless; the client drops it

authRouter.get('/me', requireAuth, async (req, res) => {
  const { user, teams, isAdmin, brandIds, tenantId } = req.scope;
  const brands = await Brand.find({ tenant_id: tenantId, ...(isAdmin ? {} : { _id: { $in: brandIds } }) }).select('code name status').sort({ name: 1 }).lean();
  res.json({
    user: { id: user._id, name: user.name, initials: user.initials, email: user.email, role: user.role },
    teams: teams.map((t) => ({ id: t._id, name: t.name })),
    brands: brands.map((b) => ({ id: b._id, code: b.code, name: b.name, status: b.status })),
  });
});
