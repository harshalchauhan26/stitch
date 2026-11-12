// Mail workflows: WHEN the team gets an e-mail and WHAT it says. Each function is called inside the transaction of the
// change it announces and only queues rows (services/mail.js sends them afterwards).
//
//   order.opened            a lead is Won and its order is created            (services/conversion.js)
//   payment.due             a payment is recorded or set as pending / link sent (services/payments.js)
//   customisation.*         a spec or measurement change, proposal, approval, customer sign-off (services/fulfilment.js)
//   dispatch.*              a shipment is created or its status changes        (services/fulfilment.js)
//   order.closed            every shipment is delivered, so the order is Delivered (services/fulfilment.js)
//
// Who gets it: every active member of the teams that handle the brand; when no team handles it, the admins.
// Customers are never e-mailed from here.
import mongoose from 'mongoose';
import { Brand, Client, Team, User } from '../models/index.js';
import { queueMails } from './mail.js';

const DUE = ['pending', 'link_sent'];
const s = (session) => session ?? null;
const who = (client) => client?.name || client?.phone_e164 || 'the customer';
const show = (v) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v));
/** Amounts are stored in the smallest unit (paise for INR) */
export function money(minor, currency = 'INR') {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format((minor ?? 0) / 100); }
  catch { return `${currency} ${(minor ?? 0) / 100}`; }
}

export async function teamRecipients(session, tenantId, brandId) {
  const teams = await Team.find({ tenant_id: tenantId, brand_ids: brandId, active: true }).select('_id').session(s(session)).lean();
  let users = teams.length
    ? await User.find({ tenant_id: tenantId, active: true, 'memberships.team_id': { $in: teams.map((t) => t._id) } }).select('name email').session(s(session)).lean()
    : [];
  if (!users.length) users = await User.find({ tenant_id: tenantId, active: true, role: 'admin' }).select('name email').session(s(session)).lean();
  return users.filter((u) => u.email);
}

/**
 * Queues one mail per recipient. lines: the body, one entry per line (null / false entries are dropped).
 * A mistake in a mail must never undo the order or payment it is about, so anything that is not a database error is
 * logged and skipped. Database errors are passed on: inside a transaction they have to reach the retry logic.
 */
export async function notifyTeam(session, { tenantId, brandId, brand, type, subject, lines, ref = {}, path = null }) {
  try {
    const to = await teamRecipients(session, tenantId, brandId);
    if (!to.length) return 0;
    const b = brand ?? await Brand.findById(brandId).select('code name').session(s(session)).lean();
    const base = (process.env.APP_URL || '').replace(/\/+$/, '');
    const text = [...lines.filter((l) => l !== null && l !== undefined && l !== false), ...(base && path ? ['', `Open in Stitch: ${base}${path}`] : [])].join('\n');
    await queueMails(session, to.map((u) => ({
      tenant_id: tenantId, brand_id: brandId, type, to: u.email, user_id: u._id,
      subject: `[${b?.code ?? 'Stitch'}] ${subject}`,
      body: `Hi ${String(u.name || '').split(' ')[0] || 'there'},\n\n${text}\n\nStitch`,
      ref,
    })));
    return to.length;
  } catch (e) {
    if (e instanceof mongoose.mongo.MongoError) throw e;
    console.error(`mail "${type}" was not queued: ${e.message}`);
    return 0;
  }
}

export function mailOrderOpened(session, { order, brand, client, leadNo }) {
  const cur = order.currency;
  return notifyTeam(session, {
    tenantId: order.tenant_id, brandId: order.brand_id, brand, type: 'order.opened',
    subject: `Order opened: ${order.order_no} for ${who(client)}`,
    lines: [
      `${order.order_no} was created from lead ${leadNo}${brand?.name ? ` (${brand.name})` : ''}.`,
      '',
      `Customer: ${who(client)}`,
      `Order value: ${money(order.amounts.total, cur)}`,
      `Paid so far: ${money(order.amounts.paid, cur)}`,
      `Balance due: ${money(order.amounts.balance_due, cur)}`,
      order.dates?.event_date ? `Event date: ${order.dates.event_date}` : null,
      order.dates?.promised_ship_date ? `Promised ship date: ${order.dates.promised_ship_date}` : null,
      '',
      'Products:',
      ...order.items.map((i) => `- ${i.product_name} x ${i.quantity}`),
    ],
    ref: { order_id: order._id, lead_id: order.lead_id, label: order.order_no }, path: `/orders/${order._id}`,
  });
}

/** Money the customer still has to pay: a payment that is pending or whose link was sent. Refunds are not "due". */
export async function mailPaymentDue(session, payment, { order = null, lead = null }) {
  if (!DUE.includes(payment.status) || payment.kind === 'refund') return 0;
  const rec = order ?? lead;
  const label = order ? order.order_no : lead.lead_no;
  const client = await Client.findById(payment.client_id).select('name phone_e164').session(s(session)).lean();
  const amount = money(payment.amount, payment.currency);
  return notifyTeam(session, {
    tenantId: rec.tenant_id, brandId: rec.brand_id, type: 'payment.due',
    subject: `Payment due: ${amount} ${payment.kind} on ${label}`,
    lines: [
      payment.status === 'link_sent'
        ? `A payment link for the ${payment.kind} of ${amount} was sent to the customer for ${label}. The money has not arrived yet.`
        : `The ${payment.kind} of ${amount} on ${label} is still pending.`,
      '',
      `Customer: ${who(client)}`,
      payment.link?.url ? `Payment link: ${payment.link.url}` : null,
      payment.link?.expires_at ? `Link expires: ${new Date(payment.link.expires_at).toISOString().slice(0, 10)}` : null,
      order ? `Balance due on the order: ${money(order.amounts.balance_due, order.currency)}` : null,
    ],
    ref: { order_id: order?._id ?? null, lead_id: lead?._id ?? order?.lead_id ?? null, payment_id: payment._id, label },
    path: order ? `/orders/${order._id}` : `/leads/${lead._id}`,
  });
}

const CUSTOMISATION_TITLE = {
  proposed: () => 'Spec change needs approval',
  changed: (kind) => (kind === 'spec' ? 'Spec changed' : 'Measurements changed'),
  approved: () => 'Spec change approved',
  signed_off: () => 'Measurements signed off by the customer',
};

/** what: proposed | changed | approved | signed_off.  changes: [{ field, old?, new }] */
export function mailCustomisation(session, { order, item, doc, what, changes = [], reason = null, by = null }) {
  const title = CUSTOMISATION_TITLE[what](doc.kind);
  return notifyTeam(session, {
    tenantId: order.tenant_id, brandId: order.brand_id, type: `customisation.${what}`,
    subject: `${title}: ${order.order_no}, ${item.product_name}`,
    lines: [
      `${title} on ${order.order_no}, ${item.product_name} (${doc.kind}, version ${doc.version}).`,
      by?.name ? `By: ${by.name}` : null,
      reason ? `Reason: ${reason}` : null,
      changes.length ? '' : null,
      ...changes.map((c) => `- ${c.field}: ${'old' in c ? `${show(c.old)} -> ` : ''}${show(c.new)}`),
      what === 'proposed' ? '' : null,
      what === 'proposed' ? 'The current spec stays in force until a pod lead or admin approves this change.' : null,
      what === 'changed' && doc.kind === 'measurements' ? '' : null,
      what === 'changed' && doc.kind === 'measurements' ? 'The customer has to sign off the new measurements.' : null,
    ],
    ref: { order_id: order._id, lead_id: order.lead_id, customisation_id: doc._id, label: order.order_no }, path: `/orders/${order._id}`,
  });
}

/** what: created (a new shipment) | status (its status changed) */
export function mailDispatch(session, { order, dispatch: d, what }) {
  const status = String(d.status).replace(/_/g, ' ');
  return notifyTeam(session, {
    tenantId: order.tenant_id, brandId: order.brand_id, type: what === 'created' ? 'dispatch.created' : `dispatch.${d.status}`,
    subject: what === 'created'
      ? `Shipment created: ${order.order_no} (shipment ${d.shipment_no}, ${d.courier})`
      : `Shipment ${status}: ${order.order_no} (shipment ${d.shipment_no})`,
    lines: [
      what === 'created' ? `Shipment ${d.shipment_no} of ${order.order_no} was created.` : `Shipment ${d.shipment_no} of ${order.order_no} is now ${status}.`,
      '',
      d.ship_to?.name ? `Customer: ${d.ship_to.name}` : null,
      `Courier: ${show(d.courier)}`,
      `AWB: ${show(d.awb)}`,
      d.tracking_link ? `Tracking: ${d.tracking_link}` : null,
      d.dispatch_date ? `Dispatch date: ${d.dispatch_date}` : null,
      d.expected_delivery ? `Expected delivery: ${d.expected_delivery}` : null,
      d.late ? 'This shipment left after the promised ship date.' : null,
    ],
    ref: { order_id: order._id, lead_id: order.lead_id, dispatch_id: d._id, label: order.order_no }, path: `/orders/${order._id}`,
  });
}

/** The order is closed: every shipment is delivered and the order moved to Delivered */
export async function mailOrderClosed(session, { order, dispatch: d }) {
  const client = await Client.findById(order.client_id).select('name phone_e164').session(s(session)).lean();
  const balance = order.amounts?.balance_due ?? 0;
  return notifyTeam(session, {
    tenantId: order.tenant_id, brandId: order.brand_id, type: 'order.closed',
    subject: `Order closed: ${order.order_no} delivered`,
    lines: [
      `Every shipment of ${order.order_no} has been delivered, so the order is now Delivered.`,
      '',
      `Customer: ${who(client)}`,
      `Order value: ${money(order.amounts?.total, order.currency)}`,
      balance > 0 ? `Balance still due: ${money(balance, order.currency)}` : 'Paid in full.',
      d?.delivered_at ? `Delivered: ${new Date(d.delivered_at).toISOString().slice(0, 10)}` : null,
    ],
    ref: { order_id: order._id, lead_id: order.lead_id, label: order.order_no }, path: `/orders/${order._id}`,
  });
}
