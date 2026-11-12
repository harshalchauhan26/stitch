// The mailer: workflows queue e-mails for the brand's team in the same transaction as the change, and the worker sends them.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { todayIso } from '../src/lib/validate.js';
import { MailOutbox, Notification, Tenant } from '../src/models/index.js';
import { MAX_ATTEMPTS, drainMail, queueMails, setMailTransport } from '../src/services/mail.js';
import { seedOrg, startApp } from './helpers.js';

let t, o, lead, order;
const sent = [];
const collect = (msg) => { sent.push(msg); };
const TEAM = ['meera@stitch.test', 'priya@stitch.test'];   // Team Alpha handles Noor Atelier. Arjun (Team Beta) and the admin do not.
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const reload = async () => { order = ok(await t.api('GET', `/orders/${order.id}`, undefined, o.tokens.priya)); return order; };
const move = async (to) => ok(await t.api('POST', `/orders/${order.id}/stage`, { version: order.version, to, override: true, reason: 'Mail test' }, o.tokens.meera));
const mails = (type) => MailOutbox.find({ type }).sort({ to: 1 }).lean();

before(async () => {
  t = await startApp(); o = await seedOrg(t);
  setMailTransport(collect);
  lead = ok(await t.api('POST', '/leads', {
    brand_id: o.na.id, client: { phone: '+91 97000 00077', name: 'Tara Menon', whatsapp_consent: 'Yes' },
    fields: { event_date: '2026-12-05', country: 'India', quote_amount: 15000000, promised_ship_date: '2026-10-01', delivery_address: '4 Park St, Kolkata' },
    items: [{ product: 'Lehenga', fields: { neckline: 'V', waist: 28, hip: 38 } }],
  }, o.tokens.priya), 201);
  for (const to of ['Qualifying', 'Customising', 'Quoted', 'Awaiting payment']) lead = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to }, o.tokens.priya));
});
after(async () => { setMailTransport(null); await t.close(); });

describe('mail workflows', () => {
  test('payment due: a payment link sent on a lead mails the brand team, and receiving the money does not', async () => {
    const p = ok(await t.api('POST', `/leads/${lead.id}/payments`, { kind: 'advance', amount: 5000000, status: 'link_sent', link_url: 'https://pay.test/abc' }, o.tokens.priya), 201);
    const due = await mails('payment.due');
    assert.deepEqual(due.map((m) => m.to), TEAM);
    assert.match(due[0].subject, /^\[NA\] Payment due: .*50,000.* advance on /);
    assert.ok(due[0].body.includes('https://pay.test/abc'));
    assert.equal(due[0].status, 'pending');
    ok(await t.api('PATCH', `/payments/${p.id}`, { status: 'received', mode: 'UPI', transaction_ref: 'M-ADV-1' }, o.tokens.priya));
    assert.equal((await mails('payment.due')).length, 2, 'money received is not a payment due');
  });

  test('order opened: winning the lead mails the team', async () => {
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    order = { id: ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Won' }, o.tokens.priya)).order_id };
    await reload();
    const opened = await mails('order.opened');
    assert.deepEqual(opened.map((m) => m.to), TEAM);
    assert.match(opened[0].subject, /^\[NA\] Order opened: ORD-NA-\d+ for Tara Menon$/);
    assert.ok(opened[0].body.includes('- Lehenga x 1'));
    assert.equal(String(opened[0].ref.order_id), String(order.id));
  });

  test('the worker sends what is queued and marks it sent', async () => {
    const pending = await MailOutbox.countDocuments({ status: 'pending' });
    assert.equal(pending, 4);
    assert.equal(await drainMail(), 4);
    assert.equal(sent.length, 4);
    assert.deepEqual(Object.keys(sent[0]).sort(), ['subject', 'text', 'to']);
    assert.equal(await MailOutbox.countDocuments({ status: 'sent', sent_at: { $ne: null } }), 4);
    assert.equal(await drainMail(), 0, 'nothing is sent twice');
  });

  test('customisation: a measurement correction and the customer sign-off mail the team', async () => {
    const item = order.items[0];
    ok(await t.api('POST', `/orders/${order.id}/items/${item.id}/customisations`, { kind: 'measurements', values: { waist: 29 }, reason: 'Re-measured at the trial' }, o.tokens.priya), 201);
    const changed = await mails('customisation.changed');
    assert.deepEqual(changed.map((m) => m.to), TEAM);
    assert.ok(changed[0].body.includes('- waist: 28 -> 29'));
    assert.ok(changed[0].body.includes('Reason: Re-measured at the trial'));
    await reload();
    ok(await t.api('POST', `/customisations/${order.items[0].measurements.id}/sign-off`, {}, o.tokens.priya));
    assert.equal((await mails('customisation.signed_off')).length, 2);
    await reload();                                          // the sign-off changed the order: the next test needs its new version
  });

  test('payment due on an order, then dispatch, then order closed', async () => {
    for (const to of ['Spec locked', 'Measurements', 'Production']) { await move(to); await reload(); }
    ok(await t.api('PATCH', `/orders/${order.id}`, { version: order.version, fields: { production_completed: todayIso(), customer_approval: 'Yes', qc_result: 'Pass', verified_shipping_address: '4 Park St, Kolkata 700016', address_confirmed: 'Yes' } }, o.tokens.priya));
    await reload();
    for (const to of ['QC approval', 'Ready to ship']) { await move(to); await reload(); }

    const bal = ok(await t.api('POST', `/orders/${order.id}/payments`, { kind: 'balance', amount: 10000000, status: 'link_sent' }, o.tokens.priya), 201);
    const due = (await mails('payment.due')).filter((m) => / balance on ORD-NA-/.test(m.subject));
    assert.deepEqual(due.map((m) => m.to), TEAM);
    ok(await t.api('PATCH', `/payments/${bal.id}`, { status: 'received', transaction_ref: 'M-BAL-1' }, o.tokens.priya));
    await reload();

    const d = ok(await t.api('POST', `/orders/${order.id}/dispatches`, { version: order.version, courier: 'Delhivery', awb: 'ML123', dispatch_date: todayIso() }, o.tokens.priya), 201);
    const created = await mails('dispatch.created');
    assert.deepEqual(created.map((m) => m.to), TEAM);
    assert.ok(created[0].subject.includes('Delhivery'));
    assert.ok(created[0].body.includes('AWB: ML123'));

    ok(await t.api('PATCH', `/dispatches/${d.id}`, { status: 'in_transit' }, o.tokens.priya));
    assert.equal((await mails('dispatch.in_transit')).length, 2);

    ok(await t.api('PATCH', `/dispatches/${d.id}`, { status: 'delivered' }, o.tokens.priya));
    await reload();
    assert.equal(order.stage, 'Delivered');
    const closed = await mails('order.closed');
    assert.deepEqual(closed.map((m) => m.to), TEAM);
    assert.ok(closed[0].body.includes('Paid in full.'));
    assert.equal((await mails('dispatch.delivered')).length, 0, 'the closing mail replaces the delivered mail');
  });
});

describe('mail worker: retries and the admin view', () => {
  let failedId;
  test('a failing send is retried with a wait, then marked failed and the admin is told', async () => {
    await drainMail({ max: 100 });                                   // clear what the workflows queued
    setMailTransport(() => { throw new Error('smtp down'); });
    const tenant = await Tenant.findOne({ slug: 'test' }).lean();
    const [row] = await queueMails(null, [{ tenant_id: tenant._id, type: 'test.mail', to: 'nobody@stitch.test', subject: 'Hello', body: 'Body' }]);
    failedId = row._id;
    assert.equal(await drainMail(), 1);
    let m = await MailOutbox.findById(failedId).lean();
    assert.equal(m.status, 'pending');
    assert.equal(m.attempts, 1);
    assert.equal(m.last_error, 'smtp down');
    assert.ok(m.next_attempt_at > new Date(), 'waits before the next try');
    assert.equal(await drainMail(), 0, 'not retried before its time');
    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
      await MailOutbox.updateOne({ _id: failedId }, { $set: { next_attempt_at: new Date(0) } });
      assert.equal(await drainMail(), 1);
    }
    m = await MailOutbox.findById(failedId).lean();
    assert.equal(m.status, 'failed');
    assert.equal(m.attempts, MAX_ATTEMPTS);
    assert.equal(await Notification.countDocuments({ type: 'mail.failed' }), 1);
  });

  test('only an admin sees the mail list; Retry sends a failed mail again', async () => {
    assert.equal((await t.api('GET', '/mail', undefined, o.tokens.priya)).status, 403);
    const failed = ok(await t.api('GET', '/mail?status=failed', undefined, o.admin));
    assert.deepEqual(failed.map((m) => [m.to, m.subject, m.attempts]), [['nobody@stitch.test', 'Hello', MAX_ATTEMPTS]]);
    assert.equal((await t.api('POST', `/mail/${failedId}/retry`, {}, o.tokens.priya)).status, 403);
    assert.equal(ok(await t.api('POST', `/mail/${failedId}/retry`, {}, o.admin)).status, 'pending');
    setMailTransport(collect);
    assert.equal(await drainMail(), 1);
    assert.equal((await MailOutbox.findById(failedId).lean()).status, 'sent');
    assert.equal((await t.api('POST', `/mail/${failedId}/retry`, {}, o.admin)).status, 404, 'only a failed mail can be retried');
  });
});
