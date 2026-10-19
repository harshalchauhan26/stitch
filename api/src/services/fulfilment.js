// Customisations with versioned corrections (PLAN §5.17) and dispatches with the weekly view (PLAN §5.19).
import { MEASUREMENT_KEYS } from '../catalogue.js';
import { withTransaction } from '../db.js';
import { DISPATCH_STATUSES, ORDER_STAGES } from '../lib/constants.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { parseFieldValue } from '../lib/fields.js';
import { id, ids, int, isoDate, isoWeek, localToDate, oneOf, str } from '../lib/validate.js';
import { Brand, Client, Customisation, Dispatch, Order, User } from '../models/index.js';
import { blockersForMove } from './gaps.js';
import { getOrder, syncOrder } from './orders.js';
import { loadBrandRules } from './rules.js';

const after = (stage, than) => ORDER_STAGES.indexOf(stage) >= ORDER_STAGES.indexOf(than);
const SOURCES = ['customer', 'store_visit', 'tailor_visit', 'video_call'];

function findItem(order, itemId) {
  const item = order.items.find((i) => String(i._id) === String(itemId));
  if (!item) throw notFound('Order item');
  return item;
}

export async function listVersions(scope, orderId, itemId, kind) {
  const order = await getOrder(scope, orderId);
  findItem(order, itemId);
  const filter = { order_item_id: id(itemId, 'item id'), ...(kind ? { kind: oneOf(kind, 'kind', ['spec', 'measurements']) } : {}) };
  return Customisation.find(filter).sort({ kind: 1, version: -1 }).lean();
}

/** Makes a version the current one for its item, and supersedes the previous current version. */
async function makeCurrent(session, scope, order, item, doc, event) {
  const key = doc.kind === 'spec' ? 'current_spec_id' : 'current_measurements_id';
  await Customisation.updateOne({ _id: item[key] }, { $set: { status: 'superseded' } }, { session });
  const items = order.items.map((i) => (String(i._id) === String(item._id) ? { ...i, [key]: doc._id } : i));
  await syncOrder(session, scope, order._id, { set: { items }, event: { ...event, item_id: item._id } });
}

/**
 * A correction: body { kind, values: { waist: 29, ... } (null clears), reason, source? }
 * Spec changes once the order is at Spec locked or later need a pod lead (spec Q7): from sales they wait as a draft for approval.
 * A measurement correction always needs the customer to sign off again.
 */
export async function createVersion(scope, orderId, itemId, body = {}) {
  const kind = oneOf(body.kind, 'kind', ['spec', 'measurements'], { required: true });
  const reason = str(body.reason, 'reason', { required: true, max: 500 });
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) throw badRequest('values must be an object, e.g. { "waist": 29 }');
  return withTransaction(async (session) => {
    const order = await getOrder(scope, orderId, session);
    const item = findItem(order, itemId);
    const rb = await loadBrandRules(scope.tenantId, order.brand_id);
    const current = await Customisation.findById(kind === 'spec' ? item.current_spec_id : item.current_measurements_id).session(session).lean();
    const values = { ...(current?.values ?? {}) };
    const changed = [];
    for (const [k, v] of Object.entries(body.values)) {
      const def = rb.defs.get(k);
      if (!def || def.scope !== 'item' || ['product', 'quantity'].includes(k)) throw badRequest(`"${k}" is not an item field`);
      if (MEASUREMENT_KEYS.includes(k) !== (kind === 'measurements')) throw badRequest(`${def.label} belongs to the ${kind === 'spec' ? 'measurements' : 'spec'}, not the ${kind}`);
      if (!rb.visible.lead.has(k)) throw badRequest(`This brand does not use "${def.label}"`);
      const parsed = parseFieldValue(def, v);
      if (JSON.stringify(values[k] ?? null) === JSON.stringify(parsed)) continue;
      changed.push({ field: k, scope: 'item', item_id: item._id, old: values[k] ?? null, new: parsed });
      if (parsed === null) delete values[k]; else values[k] = parsed;
    }
    if (!changed.length) throw badRequest('Nothing changed compared with the current version');
    const top = await Customisation.findOne({ order_item_id: item._id, kind }).sort({ version: -1 }).session(session).lean();
    const needsApproval = kind === 'spec' && after(order.stage, 'Spec locked');
    const approver = ['admin', 'pod_lead'].includes(scope.user.role);
    const [doc] = await Customisation.create([{
      tenant_id: scope.tenantId, order_id: order._id, order_item_id: item._id, lead_id: order.lead_id, brand_id: order.brand_id, kind,
      version: (top?.version ?? 0) + 1, values, changed_fields: changed.map((c) => c.field), reason,
      source: oneOf(body.source, 'source', SOURCES) ?? 'customer', status: 'draft',
      approved_by: needsApproval && approver ? scope.user._id : null, created_by: scope.user._id,
    }], { session });
    if (needsApproval && !approver) {
      // waits for a pod lead; the current version stays in force
      const { writeEvent } = await import('./events.js');
      await writeEvent(session, scope, 'order', order, { type: 'customisation.proposed', item_id: item._id, changes: changed, reason, data: { customisation_id: doc._id, kind, version: doc.version } });
      return { customisation: doc, pending_approval: true };
    }
    await makeCurrent(session, scope, order, item, doc, { type: 'customisation.changed', changes: changed, reason, data: { customisation_id: doc._id, kind, version: doc.version } });
    return { customisation: doc, pending_approval: false };
  });
}

export async function approveVersion(scope, customisationId) {
  if (!['admin', 'pod_lead'].includes(scope.user.role)) throw forbidden('Only a pod lead or admin can approve a spec change');
  return withTransaction(async (session) => {
    const doc = await Customisation.findOne({ _id: id(customisationId, 'customisation id'), tenant_id: scope.tenantId }).session(session).lean();
    if (!doc || !scope.canSeeBrand(doc.brand_id)) throw notFound('Customisation');
    const order = await getOrder(scope, doc.order_id, session);
    const item = findItem(order, doc.order_item_id);
    const currentId = doc.kind === 'spec' ? item.current_spec_id : item.current_measurements_id;
    if (String(currentId) === String(doc._id) || doc.approved_by) throw conflict('This version is already approved');
    if (doc.status !== 'draft') throw conflict('Only a proposed change can be approved');
    await Customisation.updateOne({ _id: doc._id }, { $set: { approved_by: scope.user._id } }, { session });
    await makeCurrent(session, scope, order, item, doc, { type: 'customisation.approved', reason: doc.reason, data: { customisation_id: doc._id, kind: doc.kind, version: doc.version, changed_fields: doc.changed_fields } });
    return Customisation.findById(doc._id).session(session).lean();
  });
}

/** The customer confirmed the current measurements in writing (spec §4, Customer sign off*) */
export async function signOff(scope, customisationId, body = {}) {
  return withTransaction(async (session) => {
    const doc = await Customisation.findOne({ _id: id(customisationId, 'customisation id'), tenant_id: scope.tenantId }).session(session).lean();
    if (!doc || !scope.canSeeBrand(doc.brand_id)) throw notFound('Customisation');
    if (doc.kind !== 'measurements') throw badRequest('Only measurements are signed off by the customer');
    const order = await getOrder(scope, doc.order_id, session);
    const item = findItem(order, doc.order_item_id);
    if (String(item.current_measurements_id) !== String(doc._id)) throw conflict('Only the current measurements can be signed off');
    if (doc.status === 'signed_off') throw conflict('Already signed off');
    if (!Object.keys(doc.values || {}).length) throw badRequest('There are no measurements to sign off yet');
    const evidence = id(body.evidence_message_id, 'evidence_message_id', { required: false });
    await Customisation.updateOne({ _id: doc._id }, { $set: { status: 'signed_off', signed_off: { by_customer: true, confirmed_by_user_id: scope.user._id, at: new Date(), evidence_message_id: evidence } } }, { session });
    await syncOrder(session, scope, order._id, { event: { type: 'measurements.signed_off', item_id: item._id, source_message_id: evidence, data: { customisation_id: doc._id, version: doc.version } } });
    return Customisation.findById(doc._id).session(session).lean();
  });
}

// ------------------------------------------------------------------ dispatches

/**
 * body: { version (the order's), courier, awb?, tracking_link?, order_item_ids?, pickup_date?, dispatch_date?, expected_delivery? }
 * The first shipment moves the order to Dispatched, so it must pass the Dispatched gates. More shipments split the order.
 */
export async function createDispatch(scope, orderId, body = {}) {
  const version = int(body.version, 'version', { required: true, min: 1 });
  const input = {
    courier: str(body.courier, 'Courier', { required: true, max: 80 }),
    awb: str(body.awb, 'AWB', { max: 60 })?.toUpperCase() ?? null,
    tracking_link: str(body.tracking_link, 'Tracking link', { max: 1000 }),
    pickup_date: isoDate(body.pickup_date, 'Pickup date'),
    dispatch_date: isoDate(body.dispatch_date, 'Dispatch date'),
    expected_delivery: isoDate(body.expected_delivery, 'Expected delivery'),
  };
  const result = await withTransaction(async (session) => {
    const order = await getOrder(scope, orderId, session);
    if (order.version !== version) throw conflict('Someone else changed this order just now. Reload it and try again.', { code: 'version_conflict', current_version: order.version });
    if (!['Ready to ship', 'Dispatched'].includes(order.stage)) throw conflict(`The order is in ${order.stage}. It must be Ready to ship before it can be dispatched.`, { code: 'not_ready' });
    const client = await Client.findById(order.client_id).session(session).lean();
    if (order.stage === 'Ready to ship') {
      const rb = await loadBrandRules(scope.tenantId, order.brand_id);
      const blockers = blockersForMove({ recordType: 'order', stage: order.stage, order, client }, rb, 'Dispatched');
      if (blockers.length) return { blocked: blockers };
    }
    if (input.awb) {
      const other = await Dispatch.findOne({ tenant_id: scope.tenantId, awb: input.awb }).session(session).lean();
      if (other) { const o = await Order.findById(other.order_id).select('order_no').lean(); throw conflict(`This AWB is already used on ${o?.order_no}`, { code: 'duplicate_awb' }); }
    }
    const itemIds = ids(body.order_item_ids, 'order_item_ids') ?? order.items.map((i) => i._id);
    for (const i of itemIds) findItem(order, i);
    const shipmentNo = (await Dispatch.countDocuments({ order_id: order._id }).session(session)) + 1;
    const [d] = await Dispatch.create([{
      ...input, tenant_id: scope.tenantId, brand_id: order.brand_id, client_id: order.client_id, order_id: order._id, shipment_no: shipmentNo, order_item_ids: itemIds,
      ship_to: { name: client.name, phone: client.phone_e164, address: order.addresses.verified_shipping ?? order.addresses.delivery, country: order.fields.country ?? client.country },
      status: input.dispatch_date ? 'picked_up' : 'scheduled',
      late: !!(input.dispatch_date && order.dates.promised_ship_date && input.dispatch_date > order.dates.promised_ship_date),
      created_by: scope.user._id,
    }], { session });
    const moving = order.stage !== 'Dispatched';
    await syncOrder(session, scope, order._id, {
      set: moving ? { stage: 'Dispatched', stage_changed_at: new Date() } : {},
      event: { type: 'dispatch.created', changes: moving ? [{ field: 'stage', scope: 'order', old: order.stage, new: 'Dispatched' }] : [], data: { dispatch_id: d._id, shipment_no: shipmentNo, courier: d.courier, awb: d.awb } },
    });
    return { dispatch: d };
  });
  if (result.blocked) throw new HttpError(422, `Cannot dispatch yet: ${result.blocked.map((g) => g.label).join(', ')} ${result.blocked.length > 1 ? 'are' : 'is'} missing`, { code: 'blocked', blockers: result.blocked });
  return result.dispatch;
}

const CORRECTABLE = ['courier', 'awb', 'tracking_link', 'pickup_date', 'dispatch_date', 'expected_delivery', 'address'];

/**
 * body: { status?, delivered_at?, delivery_proof_url?, tracking_shared?: true, <correctable field>?, reason? }
 * Changing a detail that was already set is a correction and needs a reason (kept on the dispatch, shown in the weekly view).
 * When every shipment is delivered, the order moves to Delivered.
 */
export async function updateDispatch(scope, dispatchId, body = {}) {
  return withTransaction(async (session) => {
    const d = await Dispatch.findOne({ _id: id(dispatchId, 'dispatch id'), tenant_id: scope.tenantId }).session(session);
    if (!d || !scope.canSeeBrand(d.brand_id)) throw notFound('Dispatch');
    const reason = str(body.reason, 'reason', { max: 500 });
    const changes = [];
    let corrected = false;
    for (const k of CORRECTABLE) {
      if (body[k] === undefined) continue;
      let v;
      if (['pickup_date', 'dispatch_date', 'expected_delivery'].includes(k)) v = isoDate(body[k], k);
      else v = str(body[k], k, { max: ['tracking_link', 'address'].includes(k) ? 1000 : 80 });
      if (k === 'awb' && v) v = v.toUpperCase();
      const old = k === 'address' ? d.ship_to.address : d[k];
      if ((old ?? null) === v) continue;
      if (k === 'awb' && v && await Dispatch.exists({ tenant_id: scope.tenantId, awb: v, _id: { $ne: d._id } }).session(session)) throw conflict('This AWB is already used on another shipment', { code: 'duplicate_awb' });
      if (old !== null && old !== undefined) {
        if (!reason) throw badRequest(`Changing the ${k.replace('_', ' ')} is a correction: say why (reason)`);
        d.corrections.push({ by: scope.user._id, field: k, old, new: v, reason });
        corrected = true;
      }
      if (k === 'address') d.ship_to.address = v; else d[k] = v;
      changes.push({ field: `dispatch.${k}`, scope: 'dispatch', old: old ?? null, new: v });
    }
    if (body.status !== undefined) {
      const status = oneOf(body.status, 'status', DISPATCH_STATUSES, { required: true });
      if (status !== d.status) { changes.push({ field: 'dispatch.status', scope: 'dispatch', old: d.status, new: status }); d.status = status; }
      if (status === 'delivered' && !d.delivered_at) d.delivered_at = body.delivered_at ? new Date(isoDate(body.delivered_at, 'delivered_at')) : new Date();
    }
    if (body.delivery_proof_url !== undefined) d.delivery_proof_url = str(body.delivery_proof_url, 'delivery_proof_url', { max: 1000 });
    if (body.tracking_shared === true && !d.tracking_shared_at) { d.tracking_shared_at = new Date(); changes.push({ field: 'dispatch.tracking_shared', scope: 'dispatch', old: null, new: 'Yes' }); }
    if (d.dispatch_date) {
      const order = await Order.findById(d.order_id).select('dates').session(session).lean();
      d.late = !!(order.dates.promised_ship_date && d.dispatch_date > order.dates.promised_ship_date);
    }
    if (!changes.length && body.delivery_proof_url === undefined) return d;
    await d.save({ session });
    const order = await Order.findById(d.order_id).session(session).lean();
    const pending = await Dispatch.countDocuments({ order_id: order._id, status: { $ne: 'delivered' } }).session(session);
    const deliver = !pending && order.stage === 'Dispatched';
    await syncOrder(session, scope, order._id, {
      set: deliver ? { stage: 'Delivered', stage_changed_at: new Date() } : {},
      event: { type: corrected ? 'dispatch.corrected' : 'dispatch.updated',
        changes: [...changes, ...(deliver ? [{ field: 'stage', scope: 'order', old: 'Dispatched', new: 'Delivered' }] : [])], reason, data: { dispatch_id: d._id, shipment_no: d.shipment_no } },
    });
    return d;
  });
}

/** PLAN §5.19: per brand counts, the week's shipments, late ones, and every correction made that week */
export async function weeklyDispatches(scope, { week, brand } = {}) {
  const w = isoWeek(week);
  const filter = { tenant_id: scope.tenantId, ...scope.brandFilter(), dispatch_date: { $gte: w.from, $lte: w.to } };
  if (brand) { const b = id(brand, 'brand'); if (!scope.canSeeBrand(b)) throw notFound('Brand'); filter.brand_id = b; }
  const start = localToDate(`${w.from}T00:00:00`), end = new Date(localToDate(`${w.to}T00:00:00`).getTime() + 86400000);   // the week in business time
  const scoped = { tenant_id: scope.tenantId, ...scope.brandFilter(), ...(filter.brand_id ? { brand_id: filter.brand_id } : {}) };
  const [shipments, corrected, versions] = await Promise.all([
    Dispatch.find(filter).sort({ dispatch_date: 1 }).lean(),
    Dispatch.find({ ...scoped, 'corrections.at': { $gte: start, $lt: end } }).lean(),
    Customisation.find({ ...scoped, version: { $gt: 1 }, created_at: { $gte: start, $lt: end } }).lean(),
  ]);
  const orderIds = [...new Set([...shipments, ...corrected, ...versions].map((x) => String(x.order_id)))];
  const [orders, brands, users] = await Promise.all([
    Order.find({ _id: { $in: orderIds } }).select('order_no items dates').lean(),
    Brand.find({ tenant_id: scope.tenantId }).select('code name').lean(),
    User.find({ tenant_id: scope.tenantId }).select('name').lean(),
  ]);
  const ord = new Map(orders.map((o) => [String(o._id), o]));
  const code = (b) => brands.find((x) => String(x._id) === String(b))?.code;
  const who = (u) => users.find((x) => String(x._id) === String(u))?.name ?? null;
  const byBrand = {};
  for (const s of shipments) {
    const k = code(s.brand_id);
    byBrand[k] ??= { brand: k, total: 0, late: 0, ...Object.fromEntries(DISPATCH_STATUSES.map((st) => [st, 0])) };
    byBrand[k].total++; byBrand[k][s.status]++; if (s.late) byBrand[k].late++;
  }
  const row = (s) => ({ id: s._id, order_id: s.order_id, order_no: ord.get(String(s.order_id))?.order_no, brand: code(s.brand_id), shipment_no: s.shipment_no, courier: s.courier, awb: s.awb,
    dispatch_date: s.dispatch_date, promised_ship_date: ord.get(String(s.order_id))?.dates.promised_ship_date ?? null, status: s.status, late: s.late, delivered_at: s.delivered_at });
  const corrections = [
    ...corrected.flatMap((s) => s.corrections.filter((c) => c.at >= start && c.at < end).map((c) => ({
      kind: 'dispatch', at: c.at, order_id: s.order_id, order_no: ord.get(String(s.order_id))?.order_no, brand: code(s.brand_id), field: c.field, old: c.old, new: c.new, reason: c.reason, by: who(c.by),
    }))),
    ...versions.map((v) => ({
      kind: v.kind, at: v.created_at, order_id: v.order_id, order_no: ord.get(String(v.order_id))?.order_no, brand: code(v.brand_id),
      item: ord.get(String(v.order_id))?.items.find((i) => String(i._id) === String(v.order_item_id))?.product_name ?? null,
      version: v.version, field: v.changed_fields.join(', '), reason: v.reason, by: who(v.created_by),
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  return {
    ...w,
    totals: { dispatched: shipments.length, late: shipments.filter((s) => s.late).length, corrections: corrections.length },
    by_brand: Object.values(byBrand).sort((a, b) => a.brand.localeCompare(b.brand)),
    shipments: shipments.map(row), late: shipments.filter((s) => s.late).map(row), corrections,
  };
}
