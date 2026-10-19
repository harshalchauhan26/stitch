// Lead -> Order at Won (spec §2, PLAN §11.1). Everything below runs in ONE transaction:
// the lead is Won, the order exists, its customisations and payments are attached, and the brand notification is queued,
// or none of it happened. The webhook itself is sent afterwards by the outbox worker (services/webhooks.js).
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { LEAD_ONLY_FIELDS, MEASUREMENT_KEYS } from '../catalogue.js';
import { badRequest } from '../lib/errors.js';
import { todayIso } from '../lib/validate.js';
import { Brand, Customisation, Notification, Order, Outbox, Payment, Team, User } from '../models/index.js';
import { commitWrite, writeEvent } from './events.js';
import { computeGaps, gapCounts } from './gaps.js';
import { nextNumber } from './leads.js';
import { orderMoney } from './payments.js';

const { ObjectId } = mongoose.Types;
// copied into dedicated places on the order rather than order.fields
const MOVED = ['event_date', 'promised_ship_date', 'delivery_deadline', 'delivery_address', 'quote_amount', 'discount', 'shipping_cost', 'duty_estimate'];

export function orderCreatedPayload({ order, brand, client, owner, team, leadNo }) {
  return {
    event: 'order.created',
    occurred_at: new Date().toISOString(),
    amount_unit: 'smallest currency unit (paise for INR)',
    brand: { code: brand.code, name: brand.name },
    order: {
      order_no: order.order_no, lead_no: leadNo, order_date: order.order_date, stage: order.stage, currency: order.currency,
      order_value: order.amounts.total, advance_paid: order.amounts.paid, balance_due: order.amounts.balance_due,
      event_date: order.dates.event_date, promised_ship_date: order.dates.promised_ship_date,
      items: order.items.map((i) => ({ product: i.product_name, quantity: i.quantity, wearer: i.wearer, spec: i.spec })),
    },
    client: { name: client.name, phone: client.phone_e164, email: client.email, city: client.city, country: order.fields.country ?? client.country, delivery_address: order.addresses.delivery },
    owner: { name: owner?.name ?? null, team: team ?? null },
  };
}

export async function winLead(session, scope, lead, client, rb, { reason, overridden } = {}) {
  const items = lead.items.filter((i) => !i.removed_at);
  if (!items.length) throw badRequest(`Add at least one product before moving the lead to ${rb.pipeline.won}`);
  const brand = await Brand.findById(lead.brand_id).session(session).lean();
  const orderId = new ObjectId();
  const orderNo = `ORD-${brand.code}-${await nextNumber(`${lead.tenant_id}:order:${brand.code}`, session, 2000)}`;
  const f = lead.fields;

  // items + version 1 of each item's spec and measurements (PLAN §5.17)
  const customisations = [];
  const orderItems = items.map((i) => {
    const itemId = new ObjectId();
    const spec = Object.fromEntries(Object.entries(i.fields || {}).filter(([k]) => !MEASUREMENT_KEYS.includes(k)));
    const measurements = Object.fromEntries(Object.entries(i.fields || {}).filter(([k]) => MEASUREMENT_KEYS.includes(k)));
    const base = { tenant_id: lead.tenant_id, order_id: orderId, order_item_id: itemId, lead_id: lead._id, brand_id: lead.brand_id, version: 1, source: 'lead', status: 'draft', created_by: scope.user._id };
    const specDoc = { _id: new ObjectId(), ...base, kind: 'spec', values: spec };
    const measDoc = { _id: new ObjectId(), ...base, kind: 'measurements', values: measurements };
    customisations.push(specDoc, measDoc);
    return {
      _id: itemId, lead_item_id: i._id, product_id: i.product_id, product_name: i.product, quantity: i.quantity,
      unit_price: i.unit_price ?? 0, line_total: (i.unit_price ?? 0) * i.quantity, wearer: i.wearer,
      current_spec_id: specDoc._id, current_measurements_id: measDoc._id, spec,
    };
  });

  // money: the accepted quote becomes the order value (spec §2.1); paid comes from the ledger
  const subtotal = orderItems.reduce((n, i) => n + i.line_total, 0);
  const discount = f.discount ?? 0, shipping = f.shipping_cost ?? 0, duty = f.duty_estimate ?? 0;
  const total = f.quote_amount ?? Math.max(0, subtotal - discount + shipping + duty);
  const payments = await Payment.find({ lead_id: lead._id, tenant_id: lead.tenant_id }).session(session).lean();
  const money = orderMoney(total, payments);

  const order = {
    _id: orderId, tenant_id: lead.tenant_id, order_no: orderNo, order_date: todayIso(), lead_id: lead._id, client_id: lead.client_id,
    brand_id: lead.brand_id, owner_id: lead.owner_id, stage: 'Created', currency: f.currency ?? brand.defaults?.currency ?? 'INR',
    amounts: { subtotal, discount, shipping, gst: 0, duty, total, paid: money.paid, balance_due: money.balance_due },
    items: orderItems.map(({ spec, ...i }) => i),
    dates: { event_date: f.event_date ?? null, promised_ship_date: f.promised_ship_date ?? null, delivery_deadline: f.delivery_deadline ?? null },
    addresses: { delivery: f.delivery_address ?? null, verified_shipping: null, billing: null },
    fields: { ...Object.fromEntries(Object.entries(f).filter(([k]) => !LEAD_ONLY_FIELDS.includes(k) && !MOVED.includes(k))), balance_payment: money.balance_payment },
    version: 1,
  };
  Object.assign(order, gapCounts(computeGaps({ recordType: 'order', stage: 'Created', order, client }, rb)));

  await Order.create([order], { session });
  await Customisation.insertMany(customisations, { session });
  await Payment.updateMany({ lead_id: lead._id, tenant_id: lead.tenant_id }, { $set: { order_id: orderId } }, { session });

  await commitWrite(session, scope, 'lead', lead, {
    $set: { stage: rb.pipeline.won, stage_type: 'won', stage_changed_at: new Date(), converted_order_id: orderId, open_gap_count: 0, blocking_gap_count: 0 },
  }, {
    type: 'lead.won', changes: [{ field: 'stage', scope: 'lead', old: lead.stage, new: rb.pipeline.won }], reason,
    data: { order_id: orderId, order_no: orderNo, ...(overridden ? { overridden: overridden.map((g) => g.field) } : {}) },
  });
  await writeEvent(session, scope, 'order', order, { type: 'order.created', source: 'system', data: { lead_id: lead._id, lead_no: lead.lead_no } }, 1);

  // queue the brand notification in the same transaction (outbox pattern, PLAN §11.1)
  const teams = await Team.find({ tenant_id: lead.tenant_id, brand_ids: lead.brand_id, active: true }).session(session).lean();
  const owner = await User.findById(lead.owner_id).session(session).lean();
  const ownerTeam = teams.find((t) => owner?.memberships.some((m) => String(m.team_id) === String(t._id)))?.name;
  const eventId = crypto.randomUUID();
  await Outbox.create([{
    tenant_id: lead.tenant_id, event: 'order.created', event_id: eventId, brand_id: lead.brand_id,
    payload: { event_id: eventId, ...orderCreatedPayload({ order: { ...order, items: orderItems }, brand, client, owner, team: ownerTeam, leadNo: lead.lead_no }) },
  }], { session });

  // in-app notification for everyone on the teams that handle this brand
  const members = await User.find({ tenant_id: lead.tenant_id, active: true, 'memberships.team_id': { $in: teams.map((t) => t._id) } }).select('_id').session(session).lean();
  if (members.length) {
    await Notification.insertMany(members.map((m) => ({
      tenant_id: lead.tenant_id, user_id: m._id, type: 'order.created', title: `${orderNo} created for ${client.name || client.phone_e164} (${brand.name})`, link: `/orders/${orderId}`,
    })), { session });
  }
  return { id: lead._id, stage: rb.pipeline.won, order_id: orderId, order_no: orderNo };
}
