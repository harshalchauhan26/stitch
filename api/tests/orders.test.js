import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { Outbox } from '../src/models/index.js';
import { drainOutbox, MAX_ATTEMPTS, sign } from '../src/services/webhooks.js';
import { seedOrg, startApp } from './helpers.js';

let t, o, receiver, received = [], replyWith = 200;
before(async () => {
  t = await startApp(); o = await seedOrg(t);
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push({ headers: req.headers, body }); res.writeHead(replyWith).end('ok'); });
  }).listen(0);
  await new Promise((ok) => receiver.once('listening', ok));
});
after(async () => { receiver.close(); await t.close(); });

const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };

describe('products and payments', () => {
  let product, lead;
  test('a product SKU is unique per brand, and an item can come from the catalogue', async () => {
    product = ok(await t.api('POST', '/products', { brand_id: o.na.id, sku: 'na-leh-014', name: 'Bridal lehenga · ivory', base_price: 18000000 }, o.tokens.meera), 201);
    assert.equal(product.sku, 'NA-LEH-014');
    assert.equal((await t.api('POST', '/products', { brand_id: o.na.id, sku: 'NA-LEH-014', name: 'Copy' }, o.admin)).status, 409);
    lead = ok(await t.api('POST', '/leads', { brand_id: o.na.id, client: { phone: '+91 99000 10001', name: 'Kavya Iyer', whatsapp_consent: 'Yes' }, items: [{ product_id: product.id }] }, o.tokens.priya), 201);
    assert.equal(lead.items[0].product, 'Bridal lehenga · ivory');
    assert.equal(lead.items[0].unit_price, 18000000);
  });

  test('recording the advance fills the payment fields on the lead; they cannot be typed', async () => {
    const p = ok(await t.api('POST', `/leads/${lead.id}/payments`, { kind: 'advance', amount: 6000000, status: 'link_sent', link_url: 'https://pay.example/abc' }, o.tokens.priya), 201);
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    assert.equal(lead.fields.advance_amount, 6000000);
    assert.equal(lead.fields.payment_link_sent, 'Yes');
    ok(await t.api('PATCH', `/payments/${p.id}`, { status: 'received', mode: 'UPI', transaction_ref: 'UPI-778899' }, o.tokens.priya));
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    assert.equal(lead.fields.payment_mode, 'UPI');
    assert.equal(lead.fields.transaction_id, 'UPI-778899');
    assert.ok(lead.fields.payment_received_date);
    const typed = await t.api('PATCH', `/leads/${lead.id}`, { version: lead.version, fields: { advance_amount: 1 } }, o.tokens.priya);
    assert.equal(typed.status, 400);
    const events = ok(await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya));
    assert.equal(events[0].type, 'payment.received');
  });

  test('the same transaction cannot be recorded twice', async () => {
    const r = await t.api('POST', `/leads/${lead.id}/payments`, { kind: 'extra', amount: 100, status: 'received', transaction_ref: 'UPI-778899' }, o.tokens.priya);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already recorded on LD-/);
  });
});

describe('Won -> Order -> brand webhook', () => {
  let lead, order, endpoint;
  before(async () => {
    endpoint = ok(await t.api('POST', `/brands/${o.na.id}/webhooks`, { url: `http://127.0.0.1:${receiver.address().port}/stitch` }, o.admin), 201);
    lead = ok(await t.api('POST', '/leads', {
      brand_id: o.na.id, client: { phone: '+91 99000 20002', name: 'Meher Kapoor', whatsapp_consent: 'Yes' },
      fields: { event_date: '2026-12-20', country: 'India', quote_amount: 24000000, delivery_address: '12 MG Road, Pune', promised_ship_date: '2026-12-01' },
      items: [{ product: 'Bridal lehenga', unit_price: 20000000, fields: { neckline: 'Sweetheart', blouse_size: 'M', waist: 28, hip: 38 } }, { product: 'Dupatta', unit_price: 4000000, fields: { dupatta_border: 'Zari' } }],
    }, o.tokens.priya), 201);
    for (const to of ['Qualifying', 'Customising', 'Quoted', 'Awaiting payment']) {
      lead = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to }, o.tokens.priya));
    }
  });

  test('Won is refused until the advance is recorded', async () => {
    const r = await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Won' }, o.tokens.priya);
    assert.equal(r.status, 422);
    ok(await t.api('POST', `/leads/${lead.id}/payments`, { kind: 'advance', amount: 8000000, status: 'received', mode: 'Bank transfer', transaction_ref: 'NEFT-1' }, o.tokens.priya), 201);
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
  });

  test('Won creates the order with amounts, items, split customisations and the payment attached', async () => {
    const r = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Won' }, o.tokens.priya));
    assert.equal(r.stage, 'Won');
    assert.ok(r.order_id);
    order = ok(await t.api('GET', `/orders/${r.order_id}`, undefined, o.tokens.priya));
    assert.equal(order.order_no, 'ORD-NA-2001');
    assert.equal(order.stage, 'Created');
    assert.deepEqual([order.amounts.total, order.amounts.paid, order.amounts.balance_due], [24000000, 8000000, 16000000]);
    assert.equal(order.fields.balance_payment, 'Unpaid');
    assert.equal(order.addresses.delivery, '12 MG Road, Pune');
    assert.deepEqual(order.items[0].measurements.values, { waist: 28, hip: 38 });
    assert.deepEqual(order.items[0].spec.values, { neckline: 'Sweetheart', blouse_size: 'M' });
    assert.equal(order.payments.length, 1);
  });

  test('the Won lead is read-only and cannot be won twice', async () => {
    const now = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    assert.equal((await t.api('PATCH', `/leads/${lead.id}`, { version: now.version, fields: { notes: 'x' } }, o.tokens.priya)).status, 409);
    assert.equal((await t.api('POST', `/leads/${lead.id}/stage`, { version: now.version, to: 'Won' }, o.tokens.priya)).status, 409);
    const events = ok(await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya));
    assert.equal(events[0].type, 'lead.won');
    assert.equal(events[0].data.order_no, 'ORD-NA-2001');
  });

  test('the brand team gets an in-app notification', async () => {
    const n = ok(await t.api('GET', '/notifications?unread=1', undefined, o.tokens.meera));
    assert.ok(n.some((x) => x.type === 'order.created' && /ORD-NA-2001/.test(x.title)));
    assert.equal(ok(await t.api('GET', '/notifications', undefined, o.tokens.arjun)).length, 0, 'other brand teams are not notified');
  });

  test('the webhook is signed, carries the order, and leaves out personal data by default', async () => {
    received = [];
    assert.equal(await drainOutbox(), 1);
    assert.equal(received.length, 1);
    const { headers, body } = received[0];
    assert.equal(headers['x-stitch-event'], 'order.created');
    assert.equal(headers['x-stitch-signature'], sign(endpoint.secret, headers['x-stitch-timestamp'], body));
    const payload = JSON.parse(body);
    assert.equal(payload.order.order_no, 'ORD-NA-2001');
    assert.equal(payload.order.balance_due, 16000000);
    assert.equal(payload.client.name, 'Meher Kapoor');
    assert.equal(payload.client.phone, undefined);
    assert.equal(payload.client.delivery_address, undefined);
    const box = await Outbox.findOne({ event_id: payload.event_id }).lean();
    assert.equal(box.status, 'done');
    const deliveries = ok(await t.api('GET', `/webhooks/${endpoint.id}/deliveries`, undefined, o.admin));
    assert.equal(deliveries[0].status_code, 200);
  });

  test('a failing endpoint is retried with backoff, then marked failed and the admins are told', async () => {
    replyWith = 500;
    const box = await Outbox.findOneAndUpdate({ status: 'done' }, { $set: { status: 'pending', attempts: 0, next_attempt_at: new Date() } }, { returnDocument: 'after' });
    await WebhookDeliveryReset(box._id);
    await drainOutbox();
    let now = await Outbox.findById(box._id).lean();
    assert.equal(now.status, 'pending');
    assert.equal(now.attempts, 1);
    assert.ok(now.next_attempt_at > new Date(Date.now() + 50_000), 'next try is about a minute later');
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await Outbox.updateOne({ _id: box._id }, { $set: { next_attempt_at: new Date() } });
      await drainOutbox();
    }
    now = await Outbox.findById(box._id).lean();
    assert.equal(now.status, 'failed');
    assert.match(now.last_error, /HTTP 500/);
    const n = ok(await t.api('GET', '/notifications?unread=1', undefined, o.admin));
    assert.ok(n.some((x) => x.type === 'webhook.failed'));
    replyWith = 200;
    ok(await t.api('POST', `/outbox/${box._id}/redeliver`, {}, o.admin));
    await drainOutbox();
    assert.equal((await Outbox.findById(box._id).lean()).status, 'done');
  });

  test('order gates: sign-off blocks Production, balance blocks Dispatched, address needs a verified address', async () => {
    const move = async (to, extra = {}) => t.api('POST', `/orders/${order.id}/stage`, { version: order.version, to, ...extra }, o.tokens.priya);
    order = ok(await move('Spec locked'));
    order = ok(await move('Measurements'));
    const blocked = await move('Production');
    assert.equal(blocked.status, 422);
    assert.deepEqual(blocked.body.blockers.map((g) => g.field), ['customer_sign_off']);
    assert.equal((await move('Production', { override: true, reason: 'Signed off on a call' })).status, 403, 'sales cannot override');
    order = ok(await t.api('POST', `/orders/${order.id}/stage`, { version: order.version, to: 'Production', override: true, reason: 'Signed off on a call' }, o.tokens.meera));
    const events = ok(await t.api('GET', `/orders/${order.id}/events`, undefined, o.tokens.meera));
    assert.equal(events[0].type, 'stage.overridden');
    assert.equal(events[0].actor.name, 'Meera Lead');
    order = ok(await move('QC approval'));
    const bad = await t.api('PATCH', `/orders/${order.id}`, { version: order.version, fields: { address_confirmed: 'Yes' } }, o.tokens.priya);
    assert.equal(bad.status, 400);
    order = ok(await t.api('PATCH', `/orders/${order.id}`, { version: order.version, fields: { customer_approval: 'Yes', qc_result: 'Pass', verified_shipping_address: '12 MG Road, Pune 411001', address_confirmed: 'Yes' } }, o.tokens.priya));
    order = ok(await move('Ready to ship'));
    const noBalance = await t.api('POST', `/orders/${order.id}/dispatches`, { version: order.version, courier: 'Blue Dart' }, o.tokens.priya);
    assert.equal(noBalance.status, 422);
    assert.deepEqual(noBalance.body.blockers.map((g) => g.field), ['balance_payment']);
    ok(await t.api('POST', `/orders/${order.id}/payments`, { kind: 'balance', amount: 16000000, status: 'received', mode: 'UPI', transaction_ref: 'UPI-BAL-1' }, o.tokens.priya), 201);
    order = ok(await t.api('GET', `/orders/${order.id}`, undefined, o.tokens.priya));
    assert.equal(order.amounts.balance_due, 0);
    assert.equal(order.fields.balance_payment, 'Paid');
    const byHand = await move('Dispatched');
    assert.equal(byHand.status, 400, 'Dispatched follows the shipment, not a manual move');
    assert.equal(byHand.body.code, 'use_shipments');
    ok(await t.api('POST', `/orders/${order.id}/dispatches`, { version: order.version, courier: 'Blue Dart' }, o.tokens.priya), 201);
    order = ok(await t.api('GET', `/orders/${order.id}`, undefined, o.tokens.priya));
    assert.equal(order.stage, 'Dispatched');
  });

  test('payment notes and link expiry edits are saved', async () => {
    const p = order.payments[0];
    ok(await t.api('PATCH', `/payments/${p.id}`, { notes: 'Paid by her brother', link_expires_at: '2026-11-01T00:00:00Z' }, o.tokens.priya));
    const again = ok(await t.api('GET', `/orders/${order.id}`, undefined, o.tokens.priya)).payments.find((x) => x.id === p.id);
    assert.equal(again.notes, 'Paid by her brother');
    assert.equal(again.link.expires_at, '2026-11-01T00:00:00.000Z');
  });

  test('Redeliver really sends the event again, even after it was delivered', async () => {
    received = [];
    const box = await Outbox.findOne({ status: 'done' }).lean();
    ok(await t.api('POST', `/outbox/${box._id}/redeliver`, {}, o.admin));
    await drainOutbox();
    assert.equal(received.length, 1);
    assert.equal((await Outbox.findById(box._id).lean()).status, 'done');
  });
});

async function WebhookDeliveryReset(outboxId) {
  const { WebhookDelivery } = await import('../src/models/index.js');
  await WebhookDelivery.deleteMany({ outbox_id: outboxId });
}
