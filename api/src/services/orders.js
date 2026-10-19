// Orders after Won (spec §4, PLAN §5.12): edits, gaps and stage moves with the order gates.
import { ORDER_PATHS } from '../catalogue.js';
import { withTransaction } from '../db.js';
import { ORDER_STAGES } from '../lib/constants.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { parseFieldValue } from '../lib/fields.js';
import { id, int, oneOf, str } from '../lib/validate.js';
import { Client, Order, Payment } from '../models/index.js';
import { commitWrite, writeEvent } from './events.js';
import { blockersForMove, computeGaps, gapCounts } from './gaps.js';
import { orderMoney } from './payments.js';
import { loadBrandRules } from './rules.js';

export async function getOrder(scope, orderId, session) {
  const order = await Order.findOne({ _id: id(orderId, 'order id'), tenant_id: scope.tenantId }).session(session ?? null).lean();
  if (!order || !scope.canSeeBrand(order.brand_id)) throw notFound('Order');
  return order;
}

export async function orderGaps(order, session, rb) {
  const rules = rb ?? await loadBrandRules(order.tenant_id, order.brand_id);
  const client = await Client.findById(order.client_id).session(session ?? null).lean();
  return computeGaps({ recordType: 'order', stage: order.stage, order, client }, rules);
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * body: { version, fields?: { final_spec_sheet, karigar, qc_result, customer_approval, verified_shipping_address, address_confirmed, ... },
 *         amounts?: { discount, shipping, gst, duty, total }, owner_id?, reason? }
 */
export async function updateOrder(scope, orderId, body = {}) {
  const version = int(body.version, 'version', { required: true, min: 1 });
  return withTransaction(async (session) => {
    const order = await getOrder(scope, orderId, session);
    if (order.version !== version) throw conflict('Someone else changed this order just now. Reload it and apply your change again.', { code: 'version_conflict', current_version: order.version });
    const rb = await loadBrandRules(scope.tenantId, order.brand_id);
    const set = {}, changes = [];
    // shallow copies of the parts that can change (structuredClone would turn ObjectIds into plain objects)
    const next = { ...order, fields: { ...order.fields }, amounts: { ...order.amounts }, addresses: { ...order.addresses }, production: { ...order.production }, qc: { ...order.qc } };
    for (const [k, v] of Object.entries(body.fields ?? {})) {
      const def = rb.defs.get(k);
      if (!def || !def.record_types.includes('order') || def.scope !== 'order') throw badRequest(`Field "${k}" does not exist on orders`);
      if (!rb.visible.order.has(k)) throw badRequest(`This brand does not use "${def.label}"`);
      if (def.computed) throw badRequest(`${def.label} is filled in by Stitch and cannot be typed`);
      const value = parseFieldValue(def, v);
      const path = ORDER_PATHS[k] ?? `fields.${k}`;
      const old = getPath(order, path) ?? null;
      if (JSON.stringify(old) === JSON.stringify(value)) continue;
      set[path] = value;
      changes.push({ field: k, scope: 'order', old, new: value });
      const [head, tail] = path.split('.');
      next[head] = { ...next[head], [tail]: value };
    }
    // the customer confirms the address that will go on the parcel (spec §4 Ready to ship)
    if (next.fields.address_confirmed === 'Yes' && !next.addresses.verified_shipping) {
      throw badRequest('Fill the verified shipping address before marking the address confirmed');
    }
    if (body.amounts) {
      for (const k of ['discount', 'shipping', 'gst', 'duty', 'total']) {
        if (body.amounts[k] === undefined) continue;
        const v = int(body.amounts[k], `amounts.${k}`, { required: true, min: 0 });
        if (v === order.amounts[k]) continue;
        set[`amounts.${k}`] = v;
        next.amounts[k] = v;
        changes.push({ field: `amounts.${k}`, scope: 'order', old: order.amounts[k], new: v });
      }
      if (changes.some((c) => c.field.startsWith('amounts.')) && !str(body.reason, 'reason', { max: 500 })) throw badRequest('Changing the order amounts needs a reason');
      const m = orderMoney(next.amounts.total, await Payment.find({ order_id: order._id }).session(session).lean());
      Object.assign(set, { 'amounts.balance_due': m.balance_due, 'fields.balance_payment': m.balance_payment });
      next.amounts.balance_due = m.balance_due;
      next.fields.balance_payment = m.balance_payment;
    }
    if (body.owner_id !== undefined) {
      const { canOwnBrand } = await import('./scope.js');
      const ownerId = id(body.owner_id, 'owner_id');
      if (String(ownerId) !== String(order.owner_id)) {
        if (!await canOwnBrand(scope.tenantId, ownerId, order.brand_id)) throw badRequest('The owner must be in a team that handles this brand');
        set.owner_id = ownerId;
        changes.push({ field: 'owner_id', scope: 'order', old: order.owner_id, new: ownerId });
      }
    }
    if (!changes.length) return { id: order._id, changed: 0 };
    Object.assign(set, gapCounts(await orderGaps(next, session, rb)));
    await commitWrite(session, scope, 'order', order, { $set: set }, { type: changes.length === 1 && changes[0].field === 'owner_id' ? 'owner.changed' : 'field.set', changes, reason: str(body.reason, 'reason', { max: 500 }) });
    return { id: order._id, changed: changes.length };
  });
}

/** Same rules as leads: forward moves pass the gates (pod lead override with reason), backward moves need a reason. */
export async function moveOrderStage(scope, orderId, body = {}) {
  const version = int(body.version, 'version', { required: true, min: 1 });
  const to = oneOf(body.to, 'to', ORDER_STAGES, { required: true });
  const reason = str(body.reason, 'reason', { max: 500 });
  const result = await withTransaction(async (session) => {
    const order = await getOrder(scope, orderId, session);
    if (order.version !== version) throw conflict('Someone else changed this order just now. Reload it and try again.', { code: 'version_conflict', current_version: order.version });
    if (order.stage === to) throw badRequest(`The order is already in ${to}`);
    const rb = await loadBrandRules(scope.tenantId, order.brand_id);
    const client = await Client.findById(order.client_id).session(session).lean();
    const from = ORDER_STAGES.indexOf(order.stage), target = ORDER_STAGES.indexOf(to);
    let overridden = null;
    if (target < from) {
      if (!reason) throw badRequest('Say why the order is moving back (reason)');
    } else {
      const blockers = blockersForMove({ recordType: 'order', stage: order.stage, order, client }, rb, to);
      if (blockers.length) {
        if (body.override !== true) return { blocked: blockers, order };
        if (!['admin', 'pod_lead'].includes(scope.user.role)) throw forbidden('Only a pod lead or admin can override a blocking gap');
        if (!reason) throw badRequest('An override needs a reason');
        overridden = blockers;
      }
    }
    const gaps = computeGaps({ recordType: 'order', stage: to, order: { ...order, stage: to }, client }, rb);
    await commitWrite(session, scope, 'order', order, { $set: { stage: to, stage_changed_at: new Date(), ...gapCounts(gaps) } }, {
      type: overridden ? 'stage.overridden' : 'stage.moved', changes: [{ field: 'stage', scope: 'order', old: order.stage, new: to }], reason,
      data: overridden ? { overridden: overridden.map((g) => g.field) } : null,
    });
    return { id: order._id, stage: to };
  });
  if (result.blocked) {
    await writeEvent(null, scope, 'order', result.order, { type: 'stage.move_blocked', reason, data: { to, blockers: result.blocked.map((g) => g.field) } });
    throw new HttpError(422, `Cannot move to ${to} yet: ${result.blocked.map((g) => g.label).join(', ')} ${result.blocked.length > 1 ? 'are' : 'is'} missing`, { code: 'blocked', blockers: result.blocked });
  }
  return result;
}
