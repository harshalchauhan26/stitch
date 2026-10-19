// Outbox delivery (PLAN §11.3): claims due events, POSTs them to each of the brand's endpoints, signs every request,
// retries with backoff, and marks the event failed (and tells the admins) when it keeps failing.
import crypto from 'node:crypto';
import { Notification, Outbox, User, WebhookDelivery, WebhookEndpoint } from '../models/index.js';

export const RETRY_MINUTES = [1, 5, 30, 120, 360];          // waits after failed attempts 1..5
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;      // the 6th failure marks the event failed
const TIMEOUT_MS = 10_000;
const LOCK_MS = 2 * 60_000;

export const sign = (secret, timestamp, body) => `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

/** Client phone, email and addresses go out only if the endpoint has include_pii (PLAN §11.4) */
export function forEndpoint(payload, endpoint) {
  if (endpoint.include_pii || !payload.client) return payload;
  const { phone, email, delivery_address, ...client } = payload.client;
  return { ...payload, client };
}

async function post(endpoint, event, eventId, payload) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const started = Date.now();
  try {
    const res = await fetch(endpoint.url, {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual',
      headers: { 'content-type': 'application/json', 'user-agent': 'Stitch-Webhooks/1', 'x-stitch-event': event, 'x-stitch-event-id': eventId, 'x-stitch-timestamp': String(ts), 'x-stitch-signature': sign(endpoint.secret, ts, body) },
      body,
    });
    const text = await res.text().catch(() => '');
    return { status_code: res.status, duration_ms: Date.now() - started, response_snippet: text.slice(0, 500), ok: res.status >= 200 && res.status < 300 };
  } catch (e) {
    return { status_code: null, duration_ms: Date.now() - started, error: e.name === 'TimeoutError' ? `No answer within ${TIMEOUT_MS / 1000}s` : e.message, ok: false };
  }
}

async function deliver(item) {
  const endpoints = await WebhookEndpoint.find({ tenant_id: item.tenant_id, brand_id: item.brand_id, active: true, events: item.event }).lean();
  if (!endpoints.length) {
    await Outbox.updateOne({ _id: item._id }, { $set: { status: 'done', locked_until: null, last_error: 'No webhook endpoint set up for this brand' } });
    return;
  }
  const done = new Set((await WebhookDelivery.distinct('endpoint_id', { outbox_id: item._id, status_code: { $gte: 200, $lt: 300 } })).map(String));
  const attempt = item.attempts + 1;
  let failed = null;
  for (const ep of endpoints.filter((e) => !done.has(String(e._id)))) {
    const r = await post(ep, item.event, item.event_id, forEndpoint(item.payload, ep));
    await WebhookDelivery.create({ tenant_id: item.tenant_id, outbox_id: item._id, endpoint_id: ep._id, attempt, ...r });
    if (!r.ok) failed = r.error ?? `HTTP ${r.status_code}`;
  }
  if (!failed) {
    await Outbox.updateOne({ _id: item._id }, { $set: { status: 'done', attempts: attempt, locked_until: null, last_error: null } });
    return;
  }
  if (attempt >= MAX_ATTEMPTS) {
    await Outbox.updateOne({ _id: item._id }, { $set: { status: 'failed', attempts: attempt, locked_until: null, last_error: failed } });
    const admins = await User.find({ tenant_id: item.tenant_id, role: 'admin', active: true }).select('_id').lean();
    await Notification.insertMany(admins.map((a) => ({
      tenant_id: item.tenant_id, user_id: a._id, type: 'webhook.failed', title: `Could not notify the brand about ${item.payload?.order?.order_no ?? item.event} after ${attempt} attempts: ${failed}`, link: `/outbox/${item._id}`,
    })));
    return;
  }
  await Outbox.updateOne({ _id: item._id }, { $set: { status: 'pending', attempts: attempt, locked_until: null, last_error: failed, next_attempt_at: new Date(Date.now() + RETRY_MINUTES[attempt - 1] * 60_000) } });
}

/** Delivers everything that is due. Safe to run from several processes: each event is claimed with a lock. */
export async function drainOutbox({ max = 25 } = {}) {
  let n = 0;
  while (n < max) {
    const now = new Date();
    const item = await Outbox.findOneAndUpdate(
      { $or: [{ status: 'pending', next_attempt_at: { $lte: now } }, { status: 'processing', locked_until: { $lt: now } }] },
      { $set: { status: 'processing', locked_until: new Date(now.getTime() + LOCK_MS) } },
      { sort: { next_attempt_at: 1 }, returnDocument: 'after' },
    ).lean();
    if (!item) break;
    await deliver(item);
    n++;
  }
  return n;
}

let timer = null, running = false;
async function tick() {
  if (running) return;
  running = true;
  try { await drainOutbox(); } catch (e) { console.error('webhook worker:', e.message); } finally { running = false; }
}
/** Runs inside the web process (Render's free plan has no background workers, PLAN §18) */
export function startWebhookWorker(intervalMs = 5000) {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
  timer.unref();
}
export function stopWebhookWorker() { clearInterval(timer); timer = null; }
/** Deliver right away after a Won instead of waiting for the next tick */
export function kickWebhooks() { if (timer) setImmediate(tick); }

/** "Send test" button: a signed ping, sent now, not stored in the outbox */
export async function pingEndpoint(endpoint) {
  const eventId = crypto.randomUUID();
  return post(endpoint, 'ping', eventId, { event: 'ping', event_id: eventId, occurred_at: new Date().toISOString(), message: 'Stitch webhook test' });
}
