// Products, brand webhooks, the outbox and in-app notifications (PLAN §5.16, §11, §14)
import crypto from 'node:crypto';
import { Router } from 'express';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { bool, id, int, str } from '../lib/validate.js';
import { Brand, FieldDef, Notification, Outbox, Product, WebhookDelivery, WebhookEndpoint } from '../models/index.js';
import { pingEndpoint } from '../services/webhooks.js';
import { requireBrand, requireRole } from '../services/scope.js';

export const integrationsRouter = Router();

// ---------- products (the brand's catalogue) ----------
const productDto = (p) => ({
  id: p._id, brand_id: p.brand_id, sku: p.sku, name: p.name, category: p.category, base_price: p.base_price, currency: p.currency,
  customisable_fields: p.customisable_fields, lead_time_days: p.lead_time_days, images: p.images, active: p.active,
});

async function productInput(tenantId, body, partial) {
  const out = {};
  if (!partial || body.sku !== undefined) out.sku = str(body.sku, 'SKU', { required: true, max: 60 }).toUpperCase();
  if (!partial || body.name !== undefined) out.name = str(body.name, 'Name', { required: true, max: 200 });
  if (body.category !== undefined) out.category = str(body.category, 'Category', { max: 80 });
  if (body.base_price !== undefined) out.base_price = int(body.base_price, 'Base price (smallest unit)', { min: 0 });
  if (body.lead_time_days !== undefined) out.lead_time_days = int(body.lead_time_days, 'Lead time', { min: 0, max: 365 });
  if (body.images !== undefined) out.images = (Array.isArray(body.images) ? body.images : []).map((u) => str(u, 'image', { max: 1000 })).filter(Boolean);
  if (body.customisable_fields !== undefined) {
    const keys = Array.isArray(body.customisable_fields) ? body.customisable_fields.map(String) : [];
    const known = await FieldDef.countDocuments({ tenant_id: tenantId, key: { $in: keys }, scope: 'item' });
    if (known !== new Set(keys).size) throw badRequest('customisable_fields must be item fields from the catalogue');
    out.customisable_fields = [...new Set(keys)];
  }
  return out;
}

integrationsRouter.get('/products', async (req, res) => {
  const filter = { tenant_id: req.scope.tenantId, ...req.scope.brandFilter() };
  if (req.query.brand) { const b = id(req.query.brand, 'brand'); requireBrand(req.scope, b); filter.brand_id = b; }
  if (req.query.active !== 'all') filter.active = true;
  const q = str(req.query.q, 'q', { max: 100 });
  if (q) { const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ name: rx }, { sku: rx }]; }
  res.json((await Product.find(filter).sort({ name: 1 }).limit(500).lean()).map(productDto));
});

integrationsRouter.post('/products', async (req, res) => {
  requireRole(req.scope, 'admin', 'pod_lead');
  const brandId = id(req.body.brand_id, 'brand_id');
  requireBrand(req.scope, brandId);
  const brand = await Brand.findOne({ _id: brandId, tenant_id: req.scope.tenantId }).lean();
  if (!brand) throw notFound('Brand');
  const input = await productInput(req.scope.tenantId, req.body, false);
  if (await Product.exists({ tenant_id: req.scope.tenantId, brand_id: brandId, sku: input.sku })) throw conflict(`SKU ${input.sku} already exists for ${brand.name}`, { code: 'duplicate_sku' });
  const p = await Product.create({ tenant_id: req.scope.tenantId, brand_id: brandId, currency: brand.defaults?.currency ?? 'INR', ...input });
  res.status(201).json(productDto(p));
});

integrationsRouter.patch('/products/:id', async (req, res) => {
  requireRole(req.scope, 'admin', 'pod_lead');
  const p = await Product.findOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId });
  if (!p || !req.scope.canSeeBrand(p.brand_id)) throw notFound('Product');
  const input = await productInput(req.scope.tenantId, req.body, true);
  if (input.sku && input.sku !== p.sku && await Product.exists({ tenant_id: req.scope.tenantId, brand_id: p.brand_id, sku: input.sku })) throw conflict(`SKU ${input.sku} already exists`, { code: 'duplicate_sku' });
  Object.assign(p, input);
  if (req.body.active !== undefined) p.active = bool(req.body.active, 'active');
  await p.save();
  res.json(productDto(p));
});

// ---------- webhooks (admin) ----------
const endpointDto = (e, secret) => ({ id: e._id, brand_id: e.brand_id, url: e.url, events: e.events, include_pii: e.include_pii, active: e.active, created_at: e.created_at, ...(secret ? { secret } : {}) });

function webhookUrl(v) {
  const url = str(v, 'url', { required: true, max: 1000 });
  let u;
  try { u = new URL(url); } catch { throw badRequest('url must be a full link, e.g. https://example.com/stitch'); }
  if (u.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && u.protocol === 'http:')) throw badRequest('Webhook links must use https');
  return url;
}

integrationsRouter.get('/brands/:id/webhooks', async (req, res) => {
  requireRole(req.scope, 'admin');
  const list = await WebhookEndpoint.find({ tenant_id: req.scope.tenantId, brand_id: id(req.params.id) }).sort({ created_at: 1 }).lean();
  res.json(list.map((e) => endpointDto(e)));
});

// the secret is shown once, at creation (and when rotated); the brand uses it to check X-Stitch-Signature
integrationsRouter.post('/brands/:id/webhooks', async (req, res) => {
  requireRole(req.scope, 'admin');
  const brand = await Brand.findOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId }).lean();
  if (!brand) throw notFound('Brand');
  const secret = crypto.randomBytes(32).toString('hex');
  const e = await WebhookEndpoint.create({
    tenant_id: req.scope.tenantId, brand_id: brand._id, url: webhookUrl(req.body.url), secret, events: ['order.created'],
    include_pii: bool(req.body.include_pii, 'include_pii') ?? false, created_by: req.scope.user._id,
  });
  res.status(201).json(endpointDto(e, secret));
});

integrationsRouter.patch('/webhooks/:id', async (req, res) => {
  requireRole(req.scope, 'admin');
  const e = await WebhookEndpoint.findOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId });
  if (!e) throw notFound('Webhook');
  if (req.body.url !== undefined) e.url = webhookUrl(req.body.url);
  if (req.body.active !== undefined) e.active = bool(req.body.active, 'active');
  if (req.body.include_pii !== undefined) e.include_pii = bool(req.body.include_pii, 'include_pii');
  let secret = null;
  if (req.body.rotate_secret === true) { secret = crypto.randomBytes(32).toString('hex'); e.secret = secret; }
  await e.save();
  res.json(endpointDto(e, secret));
});

integrationsRouter.post('/webhooks/:id/test', async (req, res) => {
  requireRole(req.scope, 'admin');
  const e = await WebhookEndpoint.findOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId }).lean();
  if (!e) throw notFound('Webhook');
  res.json(await pingEndpoint(e));
});

integrationsRouter.get('/webhooks/:id/deliveries', async (req, res) => {
  requireRole(req.scope, 'admin');
  const list = await WebhookDelivery.find({ tenant_id: req.scope.tenantId, endpoint_id: id(req.params.id) }).sort({ request_at: -1 }).limit(100).lean();
  res.json(list.map((d) => ({ id: d._id, outbox_id: d.outbox_id, attempt: d.attempt, request_at: d.request_at, status_code: d.status_code, duration_ms: d.duration_ms, error: d.error, response_snippet: d.response_snippet })));
});

integrationsRouter.get('/outbox', async (req, res) => {
  requireRole(req.scope, 'admin');
  const filter = { tenant_id: req.scope.tenantId };
  if (req.query.status) filter.status = String(req.query.status);
  const list = await Outbox.find(filter).sort({ created_at: -1 }).limit(100).lean();
  res.json(list.map((o) => ({ id: o._id, event: o.event, event_id: o.event_id, brand_id: o.brand_id, status: o.status, attempts: o.attempts, next_attempt_at: o.next_attempt_at, last_error: o.last_error, order_no: o.payload?.order?.order_no ?? null, created_at: o.created_at })));
});

integrationsRouter.post('/outbox/:id/redeliver', async (req, res) => {
  requireRole(req.scope, 'admin');
  const o = await Outbox.findOneAndUpdate({ _id: id(req.params.id), tenant_id: req.scope.tenantId, status: { $in: ['failed', 'done'] } },
    { $set: { status: 'pending', attempts: 0, next_attempt_at: new Date(), last_error: null, redeliver_from: new Date() } }, { returnDocument: 'after' }).lean();
  if (!o) throw notFound('Failed or delivered event');
  const { kickWebhooks } = await import('../services/webhooks.js');
  kickWebhooks();
  res.json({ id: o._id, status: o.status });
});

// ---------- notifications ----------
integrationsRouter.get('/notifications', async (req, res) => {
  const filter = { tenant_id: req.scope.tenantId, user_id: req.scope.user._id, ...(req.query.unread ? { read_at: null } : {}) };
  const list = await Notification.find(filter).sort({ created_at: -1 }).limit(100).lean();
  res.json(list.map((n) => ({ id: n._id, type: n.type, title: n.title, link: n.link, read_at: n.read_at, created_at: n.created_at })));
});
integrationsRouter.post('/notifications/:id/read', async (req, res) => {
  await Notification.updateOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId, user_id: req.scope.user._id }, { $set: { read_at: new Date() } });
  res.status(204).end();
});
integrationsRouter.post('/notifications/read-all', async (req, res) => {
  await Notification.updateMany({ tenant_id: req.scope.tenantId, user_id: req.scope.user._id, read_at: null }, { $set: { read_at: new Date() } });
  res.status(204).end();
});
