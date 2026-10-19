// Orders and payments (PLAN §5.12, §5.18, §14)
import { Router } from 'express';
import { ORDER_PATHS } from '../catalogue.js';
import { ORDER_STAGES, PAYMENT_STATUSES } from '../lib/constants.js';
import { id, int, isoDate, oneOf, str } from '../lib/validate.js';
import { Brand, Client, Customisation, Order, OrderEvent, Payment, User } from '../models/index.js';
import { clientDto } from '../services/clients.js';
import { eventDto } from '../services/events.js';
import { getLead } from '../services/leads.js';
import { getOrder, moveOrderStage, orderGaps, updateOrder } from '../services/orders.js';
import { addLeadPayment, addOrderPayment, paymentDto, updatePayment } from '../services/payments.js';
import { loadBrandRules } from '../services/rules.js';

export const ordersRouter = Router();
const byId = (list) => new Map(list.map((x) => [String(x._id), x]));
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

async function orderView(scope, order) {
  const [client, brand, owner, payments, custom, rb] = await Promise.all([
    Client.findById(order.client_id).lean(), Brand.findById(order.brand_id).select('code name').lean(), User.findById(order.owner_id).select('name initials').lean(),
    Payment.find({ order_id: order._id }).sort({ created_at: 1 }).lean(),
    Customisation.find({ _id: { $in: order.items.flatMap((i) => [i.current_spec_id, i.current_measurements_id]).filter(Boolean) } }).lean(),
    loadBrandRules(scope.tenantId, order.brand_id),
  ]);
  const cmap = byId(custom);
  const cdto = (c) => c && { id: c._id, version: c.version, values: c.values, status: c.status, signed_off: c.signed_off, reason: c.reason, created_at: c.created_at };
  const gaps = await orderGaps(order, null, rb);
  const seen = new Set();
  return {
    id: order._id, order_no: order.order_no, order_date: order.order_date, stage: order.stage, version: order.version, lead_id: order.lead_id,
    brand: { id: brand._id, code: brand.code, name: brand.name }, owner: owner && { id: owner._id, name: owner.name, initials: owner.initials }, client: clientDto(client),
    currency: order.currency, amounts: order.amounts, dates: order.dates, addresses: order.addresses, production: order.production, qc: order.qc, fields: order.fields,
    items: order.items.map((i) => ({
      id: i._id, product: i.product_name, product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, line_total: i.line_total, wearer: i.wearer,
      spec: cdto(cmap.get(String(i.current_spec_id))), measurements: cdto(cmap.get(String(i.current_measurements_id))),
    })),
    payments: payments.map(paymentDto),
    gaps, open_gap_count: gaps.length, blocking_gap_count: gaps.filter((g) => g.level === 'blocking').length,
    layout: ORDER_STAGES.map((stage) => ({
      stage,
      fields: rb.rules.order.filter((r) => r.stage === stage && !seen.has(r.field) && seen.add(r.field)).map((r) => {
        const d = rb.defs.get(r.field);
        return d && { key: d.key, label: d.label, type: d.type, options: d.options ?? null, level: r.level, computed: d.computed, value: getPath(order, ORDER_PATHS[d.key] ?? `fields.${d.key}`) ?? null };
      }).filter(Boolean),
    })),
    created_at: order.created_at, updated_at: order.updated_at,
  };
}
const view = async (req, orderId) => orderView(req.scope, await getOrder(req.scope, orderId));

ordersRouter.get('/orders', async (req, res) => {
  const q = req.query;
  const filter = { tenant_id: req.scope.tenantId, ...req.scope.brandFilter() };
  if (q.brand) { const b = id(q.brand, 'brand'); if (!req.scope.canSeeBrand(b)) return res.json({ total: 0, orders: [] }); filter.brand_id = b; }
  if (q.stage) filter.stage = oneOf(q.stage, 'stage', ORDER_STAGES);
  if (q.owner) filter.owner_id = q.owner === 'me' ? req.scope.user._id : id(q.owner, 'owner');
  if (q.from || q.to) filter.order_date = { ...(q.from ? { $gte: isoDate(q.from, 'from') } : {}), ...(q.to ? { $lte: isoDate(q.to, 'to') } : {}) };
  const search = str(q.q, 'q', { max: 60 });
  if (search) filter.order_no = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const limit = int(q.limit, 'limit', { min: 1, max: 200 }) ?? 50, skip = int(q.skip, 'skip', { min: 0 }) ?? 0;
  const [total, orders] = await Promise.all([Order.countDocuments(filter), Order.find(filter).sort({ order_date: -1, _id: -1 }).skip(skip).limit(limit).lean()]);
  const [clients, brands] = await Promise.all([
    Client.find({ _id: { $in: orders.map((o) => o.client_id) } }).select('name phone_e164').lean(),
    Brand.find({ _id: { $in: orders.map((o) => o.brand_id) } }).select('code').lean(),
  ]).then((xs) => xs.map(byId));
  res.json({
    total, orders: orders.map((o) => ({
      id: o._id, order_no: o.order_no, order_date: o.order_date, stage: o.stage, version: o.version, brand: brands.get(String(o.brand_id))?.code,
      client: { id: o.client_id, name: clients.get(String(o.client_id))?.name ?? clients.get(String(o.client_id))?.phone_e164 },
      currency: o.currency, total: o.amounts.total, paid: o.amounts.paid, balance_due: o.amounts.balance_due, event_date: o.dates.event_date,
      products: o.items.map((i) => i.product_name), open_gap_count: o.open_gap_count, blocking_gap_count: o.blocking_gap_count,
    })),
  });
});

ordersRouter.get('/orders/:id', async (req, res) => res.json(await view(req, req.params.id)));
ordersRouter.patch('/orders/:id', async (req, res) => { const r = await updateOrder(req.scope, req.params.id, req.body); res.json({ ...(await view(req, req.params.id)), changed: r.changed }); });
ordersRouter.post('/orders/:id/stage', async (req, res) => { await moveOrderStage(req.scope, req.params.id, req.body); res.json(await view(req, req.params.id)); });

ordersRouter.get('/orders/:id/events', async (req, res) => {
  const order = await getOrder(req.scope, req.params.id);
  const events = await OrderEvent.find({ tenant_id: req.scope.tenantId, order_id: order._id }).sort({ at: -1, _id: -1 }).limit(int(req.query.limit, 'limit', { min: 1, max: 500 }) ?? 100).lean();
  res.json(events.map(eventDto));
});

// ---------- payments ----------
ordersRouter.get('/leads/:id/payments', async (req, res) => {
  const lead = await getLead(req.scope, req.params.id);
  res.json((await Payment.find({ lead_id: lead._id }).sort({ created_at: 1 }).lean()).map(paymentDto));
});
ordersRouter.post('/leads/:id/payments', async (req, res) => res.status(201).json(paymentDto(await addLeadPayment(req.scope, req.params.id, req.body))));
ordersRouter.post('/orders/:id/payments', async (req, res) => res.status(201).json(paymentDto(await addOrderPayment(req.scope, req.params.id, req.body))));
ordersRouter.patch('/payments/:id', async (req, res) => res.json(paymentDto(await updatePayment(req.scope, req.params.id, req.body))));

ordersRouter.get('/payments', async (req, res) => {
  const q = req.query;
  const filter = { tenant_id: req.scope.tenantId, ...req.scope.brandFilter() };
  if (q.status) filter.status = oneOf(q.status, 'status', PAYMENT_STATUSES);
  if (q.from || q.to) filter.received_at = { ...(q.from ? { $gte: new Date(isoDate(q.from, 'from')) } : {}), ...(q.to ? { $lt: new Date(Date.parse(isoDate(q.to, 'to')) + 86400000) } : {}) };
  const limit = int(q.limit, 'limit', { min: 1, max: 500 }) ?? 100;
  res.json((await Payment.find(filter).sort({ created_at: -1 }).limit(limit).lean()).map(paymentDto));
});
