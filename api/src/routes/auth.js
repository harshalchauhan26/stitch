import { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { signToken, verifyPassword, verifyToken } from '../lib/auth.js';
import { str } from '../lib/validate.js';
import { Brand, User } from '../models/index.js';
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

// Simple in-memory limiter for the login form: 8 tries per 15 minutes per IP + email
const attempts = new Map();
const WINDOW = 15 * 60_000, MAX = 8;
function limited(key) {
  const now = Date.now();
  const hits = (attempts.get(key) || []).filter((t) => now - t < WINDOW);
  attempts.set(key, hits);
  return hits.length >= MAX;
}

export const authRouter = Router();

authRouter.post('/auth/login', async (req, res) => {
  const email = str(req.body?.email, 'Email', { required: true, max: 200 }).toLowerCase();
  const password = str(req.body?.password, 'Password', { required: true, max: 200 });
  const key = `${req.ip}|${email}`;
  if (limited(key)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const user = await User.findOne({ email, active: true });
  if (!user || !verifyPassword(password, user.password_hash)) {
    attempts.get(key).push(Date.now());
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
