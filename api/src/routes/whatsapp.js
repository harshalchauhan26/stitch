// The WhatsApp webhook (services/whatsappInbound.js). Mounted BEFORE the login check: Meta and providers cannot sign in, so
// they are checked by signature or URL key instead. The two admin routes check the login themselves.
//
//   GET  /whatsapp/webhook              Meta's one-time check when the URL is saved (hub.verify_token must be WA_VERIFY_TOKEN)
//   POST /whatsapp/webhook              every message; stored, answered 200 at once, processed right after
//   GET  /whatsapp/inbound              admin: the latest calls with what happened to each (for the pilot)
//   POST /whatsapp/inbound/:id/retry    admin: process an unmatched or failed call again (after adding the number to a brand)
import { Router } from 'express';
import { HttpError, notFound } from '../lib/errors.js';
import { id } from '../lib/validate.js';
import { WaInbound } from '../models/index.js';
import { requireRole } from '../services/scope.js';
import { checkCaller, kickInbound } from '../services/whatsappInbound.js';
import { requireAuth } from './auth.js';

export const whatsappRouter = Router();

whatsappRouter.get('/whatsapp/webhook', (req, res) => {
  const token = process.env.WA_VERIFY_TOKEN;
  if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) {
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  }
  throw new HttpError(403, 'Verification failed');
});

whatsappRouter.post('/whatsapp/webhook', async (req, res) => {
  const problem = checkCaller({ rawBody: req.rawBody, signature: req.get('x-hub-signature-256'), key: req.query.key });
  if (problem === 'not_configured') throw new HttpError(503, 'The WhatsApp webhook is not set up: set WA_APP_SECRET or WA_WEBHOOK_KEY', { code: 'whatsapp_not_configured' });
  if (problem) throw new HttpError(401, 'Invalid signature', { code: 'bad_signature' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'Expected a JSON object');
  await WaInbound.create({ payload: req.body });            // stored before answering: if this fails Meta gets a 500 and retries
  res.status(200).json({ ok: true });
  kickInbound();
});

const inboundDto = (r) => ({ id: r._id, status: r.status, created_at: r.created_at, attempts: r.attempts, summary: r.summary, error: r.error, payload: r.payload });

whatsappRouter.get('/whatsapp/inbound', requireAuth, async (req, res) => {
  requireRole(req.scope, 'admin');
  const filter = { tenant_id: { $in: [req.scope.tenantId, null] } };          // unmatched calls have no tenant yet
  if (req.query.status) filter.status = String(req.query.status);
  const rows = await WaInbound.find(filter).sort({ created_at: -1 }).limit(100).lean();
  res.json(rows.map(inboundDto));
});

whatsappRouter.post('/whatsapp/inbound/:id/retry', requireAuth, async (req, res) => {
  requireRole(req.scope, 'admin');
  const r = await WaInbound.findOneAndUpdate(
    { _id: id(req.params.id), tenant_id: { $in: [req.scope.tenantId, null] }, status: { $in: ['unmatched', 'failed'] } },
    { $set: { status: 'pending', attempts: 0, error: null } }, { returnDocument: 'after' },
  ).lean();
  if (!r) throw notFound('Unmatched or failed WhatsApp call');
  kickInbound();
  res.json(inboundDto(r));
});
