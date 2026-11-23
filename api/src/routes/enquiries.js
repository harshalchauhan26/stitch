// Enquiries from the public landing page (frontend/landing). The form post is open to anyone; reading the list is admin only.
import { Router } from 'express';
import { HttpError, badRequest } from '../lib/errors.js';
import { requirePhone } from '../lib/normalise.js';
import { str } from '../lib/validate.js';
import { Enquiry } from '../models/index.js';
import { requireRole } from '../services/scope.js';
import { requireAuth } from './auth.js';

export const enquiriesRouter = Router();

// In-memory limiter, same idea as the login one: 5 enquiries per hour per IP, so the open form cannot be flooded.
const sent = new Map();
const WINDOW = 60 * 60_000, MAX = 5;
function tooMany(ip, now) {
  for (const [k, hits] of sent) if (hits.every((t) => now - t >= WINDOW)) sent.delete(k);   // drop old entries
  const hits = (sent.get(ip) || []).filter((t) => now - t < WINDOW);
  if (hits.length >= MAX) return true;
  sent.set(ip, [...hits, now]);
  return false;
}

enquiriesRouter.post('/enquiries', async (req, res) => {
  const b = req.body || {};
  // "website" is a hidden field real people never fill in; a bot that does gets a normal-looking answer and nothing is saved
  if (b.website) return res.status(201).json({ ok: true });
  if (tooMany(req.ip, Date.now())) throw new HttpError(429, 'Too many requests. Please try again later.');
  const email = str(b.email, 'Work email', { required: true, max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Work email must look like name@brand.com');
  await Enquiry.create({
    name: str(b.name, 'Name', { required: true, max: 120 }),
    brand: str(b.brand, 'Brand', { required: true, max: 120 }),
    phone: requirePhone(b.phone, 'WhatsApp number').e164,
    email,
    purpose: str(b.purpose, 'Purpose', { max: 1000 }),
  });
  res.status(201).json({ ok: true });
});

enquiriesRouter.get('/enquiries', requireAuth, async (req, res) => {
  requireRole(req.scope, 'admin');
  const rows = await Enquiry.find().sort({ created_at: -1 }).limit(200).lean();
  res.json(rows.map((e) => ({ id: e._id, name: e.name, brand: e.brand, phone: e.phone, email: e.email, purpose: e.purpose, status: e.status, created_at: e.created_at })));
});
