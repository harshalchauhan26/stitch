// Customisations and dispatches (PLAN §5.17, §5.19, §14)
import { Router } from 'express';
import { DISPATCH_STATUSES } from '../lib/constants.js';
import { id, int, isoDate, oneOf } from '../lib/validate.js';
import { Dispatch } from '../models/index.js';
import { approveVersion, createDispatch, createVersion, listVersions, signOff, updateDispatch, weeklyDispatches } from '../services/fulfilment.js';
import { getOrder } from '../services/orders.js';

export const fulfilmentRouter = Router();

const customisationDto = (c) => ({
  id: c._id, order_id: c.order_id, item_id: c.order_item_id, kind: c.kind, version: c.version, values: c.values, unit: c.unit,
  changed_fields: c.changed_fields, reason: c.reason, source: c.source, status: c.status, signed_off: c.signed_off, approved_by: c.approved_by,
  created_by: c.created_by, created_at: c.created_at,
});

fulfilmentRouter.get('/orders/:id/items/:itemId/customisations', async (req, res) => {
  res.json((await listVersions(req.scope, req.params.id, req.params.itemId, req.query.kind)).map(customisationDto));
});
fulfilmentRouter.post('/orders/:id/items/:itemId/customisations', async (req, res) => {
  const r = await createVersion(req.scope, req.params.id, req.params.itemId, req.body);
  res.status(201).json({ ...customisationDto(r.customisation), pending_approval: r.pending_approval });
});
fulfilmentRouter.post('/customisations/:id/approve', async (req, res) => res.json(customisationDto(await approveVersion(req.scope, req.params.id))));
fulfilmentRouter.post('/customisations/:id/sign-off', async (req, res) => res.json(customisationDto(await signOff(req.scope, req.params.id, req.body))));

// ---------- dispatches ----------
const dispatchDto = (d) => ({
  id: d._id, order_id: d.order_id, brand_id: d.brand_id, shipment_no: d.shipment_no, order_item_ids: d.order_item_ids, courier: d.courier, awb: d.awb,
  tracking_link: d.tracking_link, ship_to: d.ship_to, pickup_date: d.pickup_date, dispatch_date: d.dispatch_date, expected_delivery: d.expected_delivery,
  delivered_at: d.delivered_at, delivery_proof_url: d.delivery_proof_url, status: d.status, late: d.late, tracking_shared_at: d.tracking_shared_at,
  corrections: d.corrections, created_at: d.created_at,
});

fulfilmentRouter.get('/dispatches/weekly', async (req, res) => res.json(await weeklyDispatches(req.scope, { week: req.query.week, brand: req.query.brand })));

fulfilmentRouter.get('/dispatches', async (req, res) => {
  const q = req.query;
  const filter = { tenant_id: req.scope.tenantId, ...req.scope.brandFilter() };
  if (q.status) filter.status = oneOf(q.status, 'status', DISPATCH_STATUSES);
  if (q.brand) { const b = id(q.brand, 'brand'); if (!req.scope.canSeeBrand(b)) return res.json([]); filter.brand_id = b; }
  if (q.from || q.to) filter.dispatch_date = { ...(q.from ? { $gte: isoDate(q.from, 'from') } : {}), ...(q.to ? { $lte: isoDate(q.to, 'to') } : {}) };
  res.json((await Dispatch.find(filter).sort({ dispatch_date: -1, created_at: -1 }).limit(int(q.limit, 'limit', { min: 1, max: 500 }) ?? 100).lean()).map(dispatchDto));
});

fulfilmentRouter.get('/orders/:id/dispatches', async (req, res) => {
  const order = await getOrder(req.scope, req.params.id);
  res.json((await Dispatch.find({ order_id: order._id }).sort({ shipment_no: 1 }).lean()).map(dispatchDto));
});
fulfilmentRouter.post('/orders/:id/dispatches', async (req, res) => res.status(201).json(dispatchDto(await createDispatch(req.scope, req.params.id, req.body))));
fulfilmentRouter.patch('/dispatches/:id', async (req, res) => res.json(dispatchDto(await updateDispatch(req.scope, req.params.id, req.body))));
