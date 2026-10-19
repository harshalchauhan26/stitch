// Payments ledger (PLAN §5.18). The spec's payment fields are calculated from it, so money is never typed twice:
//   lead:  advance_amount, payment_link_sent, payment_mode, transaction_id, payment_received_date, link_expiry
//   order: amounts.paid, amounts.balance_due, fields.balance_payment
import { withTransaction } from '../db.js';
import { PAYMENT_KINDS, PAYMENT_MODES, PAYMENT_STATUSES } from '../lib/constants.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { bool, id, int, oneOf, str, todayIso } from '../lib/validate.js';
import { Client, Lead, Order, Payment } from '../models/index.js';
import { commitWrite } from './events.js';
import { computeGaps, gapCounts } from './gaps.js';
import { getLead } from './leads.js';
import { loadBrandRules } from './rules.js';

const LIVE = ['link_sent', 'received'];                  // statuses that count towards "advance amount"
const dateOrNull = (v, label) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${label} must be a date and time`);
  return d;
};
const ymd = (d) => (d ? todayIso(new Date(d)) : null);   // the calendar day in business time, not UTC

/** Lead fields derived from the lead's advance payments */
export function leadPaymentFields(payments) {
  const adv = payments.filter((p) => p.kind === 'advance');
  const live = adv.filter((p) => LIVE.includes(p.status));
  const received = adv.filter((p) => p.status === 'received').sort((a, b) => new Date(b.received_at) - new Date(a.received_at))[0];
  const linked = adv.filter((p) => p.link?.sent_at).sort((a, b) => new Date(b.link.sent_at) - new Date(a.link.sent_at))[0];
  return {
    advance_amount: live.length ? live.reduce((n, p) => n + p.amount, 0) : null,
    // money already received counts as "link sent": the gate is about a committed customer, not the link itself
    payment_link_sent: linked || received ? 'Yes' : null,
    payment_mode: received?.mode ?? null,
    transaction_id: received?.transaction_ref ?? null,
    payment_received_date: ymd(received?.received_at),
    link_expiry: ymd(linked?.link?.expires_at),
  };
}

/** Order money derived from every payment on the order */
export function orderMoney(total, payments) {
  const done = payments.filter((p) => p.status === 'received');
  const paid = done.filter((p) => p.kind !== 'refund').reduce((n, p) => n + p.amount, 0) - done.filter((p) => p.kind === 'refund').reduce((n, p) => n + p.amount, 0);
  const balance = total - paid;
  return { paid, balance_due: balance, balance_payment: balance <= 0 ? 'Paid' : 'Unpaid' };
}

/** Recalculates the lead's payment fields inside the transaction and records why. */
export async function syncLeadPayments(session, scope, lead, event) {
  if (lead.stage_type !== 'open') return lead.version;
  const payments = await Payment.find({ lead_id: lead._id, tenant_id: lead.tenant_id }).session(session).lean();
  const computed = leadPaymentFields(payments);
  const fields = { ...lead.fields };
  const changes = [];
  for (const [k, v] of Object.entries(computed)) {
    if ((fields[k] ?? null) === v) continue;
    changes.push({ field: k, scope: 'lead', old: fields[k] ?? null, new: v });
    if (v === null) delete fields[k]; else fields[k] = v;
  }
  const rb = await loadBrandRules(lead.tenant_id, lead.brand_id);
  const client = await Client.findById(lead.client_id).session(session).lean();
  const gaps = computeGaps({ recordType: 'lead', stage: lead.stage, lead: { ...lead, fields }, client }, rb);
  return commitWrite(session, scope, 'lead', lead, { $set: { fields, ...gapCounts(gaps) } }, { ...event, changes: [...(event.changes || []), ...changes], source: 'system' });
}

export async function syncOrderPayments(session, scope, order, event) {
  const payments = await Payment.find({ order_id: order._id, tenant_id: order.tenant_id }).session(session).lean();
  const m = orderMoney(order.amounts.total, payments);
  const changes = [];
  if (order.amounts.paid !== m.paid) changes.push({ field: 'amounts.paid', scope: 'order', old: order.amounts.paid, new: m.paid });
  if (order.fields.balance_payment !== m.balance_payment) changes.push({ field: 'balance_payment', scope: 'order', old: order.fields.balance_payment ?? null, new: m.balance_payment });
  const fields = { ...order.fields, balance_payment: m.balance_payment };
  const { orderGaps } = await import('./orders.js');
  const next = { ...order, fields, amounts: { ...order.amounts, paid: m.paid, balance_due: m.balance_due } };
  const gaps = await orderGaps(next, session);
  return commitWrite(session, scope, 'order', order, {
    $set: { 'amounts.paid': m.paid, 'amounts.balance_due': m.balance_due, 'fields.balance_payment': m.balance_payment, ...gapCounts(gaps) },
  }, { ...event, changes: [...(event.changes || []), ...changes], source: 'system' });
}

function paymentInput(body, { kinds }) {
  const status = oneOf(body.status, 'status', PAYMENT_STATUSES) ?? 'pending';
  const p = {
    kind: oneOf(body.kind, 'kind', kinds, { required: true }),
    amount: int(body.amount, 'Amount (smallest unit, e.g. paise)', { required: true, min: 1 }),
    currency: oneOf(body.currency, 'currency', ['INR', 'USD', 'GBP', 'AED', 'EUR']) ?? 'INR',
    status,
    mode: oneOf(body.mode, 'mode', PAYMENT_MODES),
    transaction_ref: str(body.transaction_ref, 'Transaction ref', { max: 120 }),
    notes: str(body.notes, 'notes', { max: 1000 }),
    proof_url: str(body.proof_url, 'proof_url', { max: 1000 }),
    link: { url: str(body.link_url, 'link_url', { max: 1000 }), sent_at: null, expires_at: dateOrNull(body.link_expires_at, 'link_expires_at') },
    received_at: dateOrNull(body.received_at, 'received_at'),
  };
  if (status === 'link_sent' || bool(body.link_sent, 'link_sent')) p.link.sent_at = dateOrNull(body.link_sent_at, 'link_sent_at') ?? new Date();
  if (p.status === 'link_sent' && !p.link.sent_at) p.link.sent_at = new Date();
  if (p.status === 'received' && !p.received_at) p.received_at = new Date();
  return p;
}

async function refuseDuplicateRef(tenantId, ref, exceptId = null) {
  if (!ref) return;
  const other = await Payment.findOne({ tenant_id: tenantId, transaction_ref: ref, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean();
  if (!other) return;
  const on = other.order_id ? await Order.findById(other.order_id).select('order_no').lean() : await Lead.findById(other.lead_id).select('lead_no').lean();
  throw conflict(`This transaction is already recorded on ${on?.order_no ?? on?.lead_no}`, { code: 'duplicate_transaction', payment_id: other._id });
}

/** Advance (or extra) payments recorded while the customer is still a lead */
export async function addLeadPayment(scope, leadId, body = {}) {
  const p = paymentInput(body, { kinds: ['advance', 'extra'] });
  await refuseDuplicateRef(scope.tenantId, p.transaction_ref);
  return withTransaction(async (session) => {
    const lead = await getLead(scope, leadId, session);
    if (lead.stage_type === 'lost') throw conflict(`This lead is ${lead.stage}. Reopen it first.`);
    if (lead.stage_type === 'won') throw conflict(`This lead is ${lead.stage}: record payments on its order.`, { code: 'lead_locked', order_id: lead.converted_order_id });
    const [payment] = await Payment.create([{ ...p, tenant_id: scope.tenantId, brand_id: lead.brand_id, client_id: lead.client_id, lead_id: lead._id, recorded_by: scope.user._id }], { session });
    await syncLeadPayments(session, scope, lead, { type: 'payment.recorded', data: { payment_id: payment._id, kind: p.kind, amount: p.amount, status: p.status } });
    return payment;
  });
}

export async function addOrderPayment(scope, orderId, body = {}) {
  const p = paymentInput(body, { kinds: PAYMENT_KINDS });
  await refuseDuplicateRef(scope.tenantId, p.transaction_ref);
  return withTransaction(async (session) => {
    const { getOrder } = await import('./orders.js');
    const order = await getOrder(scope, orderId, session);
    const [payment] = await Payment.create([{ ...p, tenant_id: scope.tenantId, brand_id: order.brand_id, client_id: order.client_id, lead_id: order.lead_id, order_id: order._id, recorded_by: scope.user._id }], { session });
    await syncOrderPayments(session, scope, order, { type: 'payment.recorded', data: { payment_id: payment._id, kind: p.kind, amount: p.amount, status: p.status } });
    return payment;
  });
}

/** Status changes (link sent, received, failed, refunded, cancelled) and corrections to a payment */
export async function updatePayment(scope, paymentId, body = {}) {
  return withTransaction(async (session) => {
    const payment = await Payment.findOne({ _id: id(paymentId, 'payment id'), tenant_id: scope.tenantId }).session(session);
    if (!payment || !scope.canSeeBrand(payment.brand_id)) throw notFound('Payment');
    const before = payment.toObject();
    if (body.status !== undefined) payment.status = oneOf(body.status, 'status', PAYMENT_STATUSES, { required: true });
    if (body.mode !== undefined) payment.mode = oneOf(body.mode, 'mode', PAYMENT_MODES);
    if (body.transaction_ref !== undefined) {
      payment.transaction_ref = str(body.transaction_ref, 'Transaction ref', { max: 120 });
      await refuseDuplicateRef(scope.tenantId, payment.transaction_ref, payment._id);
    }
    if (body.amount !== undefined) payment.amount = int(body.amount, 'Amount', { required: true, min: 1 });
    if (body.link_url !== undefined) payment.link.url = str(body.link_url, 'link_url', { max: 1000 });
    if (body.link_expires_at !== undefined) payment.link.expires_at = dateOrNull(body.link_expires_at, 'link_expires_at');
    if (body.notes !== undefined) payment.notes = str(body.notes, 'notes', { max: 1000 });
    if (payment.status === 'link_sent' && !payment.link.sent_at) payment.link.sent_at = new Date();
    if (payment.status === 'received' && !payment.received_at) payment.received_at = dateOrNull(body.received_at, 'received_at') ?? new Date();
    else if (body.received_at !== undefined) payment.received_at = dateOrNull(body.received_at, 'received_at');
    const get = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
    const tracked = ['status', 'mode', 'transaction_ref', 'amount', 'received_at', 'notes', 'link.url', 'link.sent_at', 'link.expires_at'];
    const changes = tracked.filter((k) => String(get(before, k) ?? '') !== String(get(payment, k) ?? ''))
      .map((k) => ({ field: `payment.${k}`, scope: 'payment', old: get(before, k) ?? null, new: get(payment, k) ?? null }));
    if (!changes.length) return payment;
    await payment.save({ session });
    const event = { type: payment.status === 'received' && before.status !== 'received' ? 'payment.received' : payment.status === 'refunded' ? 'payment.refunded' : 'payment.updated', changes, data: { payment_id: payment._id } };
    if (payment.order_id) {
      const { getOrder } = await import('./orders.js');
      await syncOrderPayments(session, scope, await getOrder(scope, payment.order_id, session), event);
    } else {
      await syncLeadPayments(session, scope, await getLead(scope, payment.lead_id, session), event);
    }
    return payment;
  });
}

export const paymentDto = (p) => ({
  id: p._id, lead_id: p.lead_id, order_id: p.order_id, kind: p.kind, amount: p.amount, currency: p.currency, status: p.status, mode: p.mode,
  link: p.link, transaction_ref: p.transaction_ref, received_at: p.received_at, proof_url: p.proof_url, notes: p.notes, created_at: p.created_at,
});
