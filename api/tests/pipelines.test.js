// One numbered check per pipeline, so a failing line tells you which pipeline broke (see docs/TESTS.md).
//   ENDPOINTS  every route is up, protected, and answers the right people
//   AUTH       sign in
//   LEADS      a lead goes from New to Won and becomes an order
//   MAIL       the mails are queued, sent, retried and shown to admins
//   CHAT       a WhatsApp chat is read into a lead (the model is mocked, so no key or network is needed)
//   ENQUIRY    the landing-page form
// Needs the local MongoDB like the other tests: npm run mongo:dev, then npm test.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MailOutbox, Notification } from '../src/models/index.js';
import { MAX_ATTEMPTS, drainMail, setMailTransport } from '../src/services/mail.js';
import { setLlm } from '../src/services/llm.js';
import { seedOrg, startApp } from './helpers.js';

let t, o;
const sent = [];
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };

before(async () => { t = await startApp(); o = await seedOrg(t); setMailTransport((m) => { sent.push(m); }); });
after(async () => { setMailTransport(null); setLlm(null); await t.close(); });

// ---------------------------------------------------------------- ENDPOINTS
// every list/read route the screens call, with no ids in the path
const READS = ['/me', '/brands', '/teams', '/users', '/templates', '/field-defs', '/clients', '/leads', '/orders', '/gaps', '/payments',
  '/products', '/conversations', '/issues', '/dispatches', '/dispatches/weekly', '/notifications', '/outbox', '/mail', '/enquiries'];

describe('ENDPOINTS', () => {
  test('[ENDPOINTS-01] the API is up and the database is connected', async () => {
    const r = ok(await t.api('GET', '/health'));
    assert.deepEqual(r, { ok: true, db: 'up' });
  });

  test('[ENDPOINTS-02] every read route answers 200 for an admin', async () => {
    for (const path of READS) assert.equal((await t.api('GET', path, undefined, o.admin)).status, 200, path);
  });

  test('[ENDPOINTS-03] every protected route refuses a caller who is not signed in (401)', async () => {
    for (const path of READS) assert.equal((await t.api('GET', path)).status, 401, path);
  });

  test('[ENDPOINTS-04] a bad token is refused, an unknown route is a 404', async () => {
    assert.equal((await t.api('GET', '/leads', undefined, 'not-a-token')).status, 401);
    assert.equal((await t.api('GET', '/nothing-here', undefined, o.admin)).status, 404);
  });

  test('[ENDPOINTS-05] admin-only routes refuse sales and pod leads (403)', async () => {
    for (const token of [o.tokens.priya, o.tokens.meera]) {
      assert.equal((await t.api('GET', '/mail', undefined, token)).status, 403);
      assert.equal((await t.api('GET', '/enquiries', undefined, token)).status, 403);
    }
  });

  test('[ENDPOINTS-06] one brand\'s team cannot see another brand (404)', async () => {
    assert.equal((await t.api('GET', `/brands/${o.vm.id}`, undefined, o.tokens.priya)).status, 404);
    assert.equal((await t.api('GET', `/brands/${o.na.id}`, undefined, o.tokens.priya)).status, 200);
  });
});

// ---------------------------------------------------------------- AUTH
describe('AUTH', () => {
  test('[AUTH-01] a right password signs in and returns the user', async () => {
    const r = ok(await t.api('POST', '/auth/login', { email: 'priya@stitch.test', password: 'stitch123' }));
    assert.ok(r.token);
    assert.equal(r.user.role, 'sales');
  });

  test('[AUTH-02] a wrong password or unknown e-mail is a 401 with the same message', async () => {
    const a = await t.api('POST', '/auth/login', { email: 'priya@stitch.test', password: 'wrong' });
    const b = await t.api('POST', '/auth/login', { email: 'ghost@stitch.test', password: 'stitch123' });
    assert.deepEqual([a.status, b.status], [401, 401]);
    assert.equal(a.body.error, b.body.error);
  });

  test('[AUTH-03] /me tells the screens the role and the teams', async () => {
    const me = ok(await t.api('GET', '/me', undefined, o.tokens.meera));
    assert.equal(me.user.role, 'pod_lead');
    assert.equal(me.teams.length, 2);
  });
});

// ---------------------------------------------------------------- LEADS
describe('LEADS', () => {
  let lead, orderId;
  test('[LEADS-01] a new lead is created for a brand with its product', async () => {
    lead = ok(await t.api('POST', '/leads', {
      brand_id: o.na.id, client: { phone: '+91 97000 11111', name: 'Isha Rao', whatsapp_consent: 'Yes' },
      fields: { event_date: '2026-12-05', country: 'India', quote_amount: 15000000, promised_ship_date: '2026-10-01', delivery_address: '4 Park St, Kolkata' },
      items: [{ product: 'Lehenga', fields: { neckline: 'V', waist: 28, hip: 38 } }],
    }, o.tokens.priya), 201);
    assert.equal(lead.stage, 'New');
    assert.equal(lead.items.length, 1);
  });

  test('[LEADS-02] the lead appears in the list and in the audit trail', async () => {
    assert.ok(ok(await t.api('GET', '/leads', undefined, o.tokens.priya)).leads.some((l) => l.id === lead.id));
    assert.ok(ok(await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya)).length >= 1);
  });

  test('[LEADS-03] a stale edit is refused with 409 version_conflict', async () => {
    const r = await t.api('PATCH', `/leads/${lead.id}`, { version: lead.version + 5, fields: { city: 'Pune' } }, o.tokens.priya);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'version_conflict');
  });

  test('[LEADS-04] the lead moves forward through the pipeline stage by stage', async () => {
    for (const to of ['Qualifying', 'Customising', 'Quoted', 'Awaiting payment']) {
      lead = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to }, o.tokens.priya));
      assert.equal(lead.stage, to);
    }
  });

  test('[LEADS-05] Won is blocked until the advance link is sent; then it creates the order and the lead becomes read-only', async () => {
    const blocked = await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Won' }, o.tokens.priya);
    assert.deepEqual([blocked.status, blocked.body.code], [422, 'blocked']);
    ok(await t.api('POST', `/leads/${lead.id}/payments`, { kind: 'advance', amount: 5000000, status: 'link_sent', link_url: 'https://pay.test/abc' }, o.tokens.priya), 201);
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    const r = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Won' }, o.tokens.priya));
    orderId = r.order_id;
    assert.ok(orderId);
    const order = ok(await t.api('GET', `/orders/${orderId}`, undefined, o.tokens.priya));
    assert.equal(order.stage, 'Created');
    assert.equal(order.items.length, 1);
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    assert.notEqual((await t.api('PATCH', `/leads/${lead.id}`, { version: lead.version, fields: { city: 'Pune' } }, o.tokens.priya)).status, 200);
  });

  test('[LEADS-06] a lead can be lost with a reason and reopened', async () => {
    const l = ok(await t.api('POST', '/leads', { brand_id: o.vm.id, client: { phone: '+91 97000 22222', name: 'Kabir', whatsapp_consent: 'Yes' }, items: [{ product: 'Sherwani' }] }, o.tokens.arjun), 201);
    const lost = ok(await t.api('POST', `/leads/${l.id}/lost`, { version: l.version, reason: 'Price' }, o.tokens.arjun));
    assert.equal(lost.stage, 'Lost');
    const back = ok(await t.api('POST', `/leads/${l.id}/reopen`, { version: lost.version, reason: 'Came back' }, o.tokens.arjun));
    assert.notEqual(back.stage, 'Lost');
  });

  test('[LEADS-07] the other brand\'s team cannot open this lead (404)', async () => {
    assert.equal((await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.arjun)).status, 404);
  });
});

// ---------------------------------------------------------------- MAIL
describe('MAIL', () => {
  const TEAM = ['meera@stitch.test', 'priya@stitch.test'];            // Team Alpha handles Noor Atelier (LEADS-05 opened an order for it)
  let failedId;

  test('[MAIL-01] opening an order queued one mail for each member of the brand team', async () => {
    const rows = await MailOutbox.find({ type: 'order.opened' }).sort({ to: 1 }).lean();
    assert.deepEqual(rows.map((m) => m.to), TEAM);
    assert.match(rows[0].subject, /^\[NA\] Order opened: ORD-NA-\d+ for Isha Rao$/);
    assert.equal(rows[0].status, 'pending');
  });

  test('[MAIL-02] the worker sends every queued mail once (dry-run transport) and marks it sent', async () => {
    const queued = await MailOutbox.countDocuments({ status: 'pending' });
    assert.ok(queued >= 2);
    assert.equal(await drainMail({ max: 100 }), queued);
    assert.equal(sent.length, queued);
    assert.equal(await MailOutbox.countDocuments({ status: 'pending' }), 0);
    assert.equal(await drainMail(), 0, 'nothing is sent twice');
  });

  test('[MAIL-03] a mail server that is down: waits, retries, then fails after the last attempt and tells the admins', async () => {
    setMailTransport(() => { throw new Error('smtp down'); });
    const row = await MailOutbox.create({ tenant_id: (await MailOutbox.findOne().lean()).tenant_id, type: 'test.mail', to: 'nobody@stitch.test', subject: 'Hello', body: 'Body' });
    failedId = row._id;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await MailOutbox.updateOne({ _id: failedId }, { $set: { next_attempt_at: new Date(0) } });
      assert.equal(await drainMail(), 1);
    }
    const m = await MailOutbox.findById(failedId).lean();
    assert.deepEqual([m.status, m.attempts, m.last_error], ['failed', MAX_ATTEMPTS, 'smtp down']);
    assert.equal(await Notification.countDocuments({ type: 'mail.failed' }), 1);
  });

  test('[MAIL-04] an admin sees the failed mail with its text and error; Retry sends it', async () => {
    const failed = ok(await t.api('GET', '/mail?status=failed', undefined, o.admin));
    assert.deepEqual(failed.map((m) => m.to), ['nobody@stitch.test']);
    assert.equal(failed[0].body, 'Body');
    setMailTransport((m) => { sent.push(m); });
    ok(await t.api('POST', `/mail/${failedId}/retry`, {}, o.admin));
    await drainMail();
    assert.equal((await MailOutbox.findById(failedId).lean()).status, 'sent');
  });

  test('[MAIL-05] a mail that is not failed cannot be retried (404)', async () => {
    assert.equal((await t.api('POST', `/mail/${failedId}/retry`, {}, o.admin)).status, 404);
  });
});

// ---------------------------------------------------------------- CHAT
describe('CHAT', () => {
  let account, conv, run, lead;
  const CHAT = [
    '[12/10/26, 10:01:00 AM] Noor Atelier: Hello! Thank you for reaching out to Noor Atelier',
    '[12/10/26, 10:02:00 AM] +91 98111 33333: Hi, I need a bridal lehenga for my wedding on 14 Dec',
    '[13/10/26, 9:15:00 AM] +91 98111 33333: It is in Pune',
  ].join('\n');
  const MODEL = JSON.stringify({
    new_items: [{ product: 'Bridal lehenga', quantity: 1, message: 1, confidence: 0.9, evidence: 'I need a bridal lehenga' }],
    suggestions: [
      { field: 'event_date', value: '2026-12-14', message: 1, confidence: 0.95, evidence: 'wedding on 14 Dec' },
      { field: 'city', value: 'Pune', message: 2, confidence: 0.85, evidence: 'in Pune' },
    ],
  });

  test('[CHAT-01] a WhatsApp export is uploaded and stored under the brand', async () => {
    account = (await t.api('GET', `/brands/${o.na.id}/whatsapp-accounts`, undefined, o.tokens.priya)).body[0];
    const up = ok(await t.api('POST', '/conversations', { whatsapp_account_id: account.id, file_name: 'WhatsApp Chat with +91 98111 33333.txt', text: CHAT }, o.tokens.priya), 201);
    conv = up.id;
    assert.ok(ok(await t.api('GET', '/conversations', undefined, o.tokens.priya)).some((c) => c.id === conv));
  });

  test('[CHAT-02] reading the chat creates a lead and proposes values, saving nothing yet', async () => {
    setLlm(async () => MODEL);
    run = ok(await t.api('POST', `/conversations/${conv}/extract`, { create_lead: true }, o.tokens.priya), 201);
    assert.equal(run.lead.created, true);
    assert.deepEqual(run.suggestions.map((s) => s.field).sort(), ['city', 'event_date']);
    lead = ok(await t.api('GET', `/leads/${run.lead.id}`, undefined, o.tokens.priya));
    assert.equal(lead.items.length, 1);
    assert.equal(lead.fields.event_date, undefined);
  });

  test('[CHAT-03] accepting the proposal fills the lead from the chat', async () => {
    const r = ok(await t.api('POST', `/extractions/${run.id}/accept`, {}, o.tokens.priya));
    assert.deepEqual([r.applied, r.failed], [2, 0]);
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    assert.equal(lead.fields.event_date, '2026-12-14');
    assert.equal(lead.client.city, 'Pune');
  });

  test('[CHAT-04] a model that answers with broken JSON is reported, not crashed on', async () => {
    setLlm(async () => 'this is not json');
    const r = await t.api('POST', `/conversations/${conv}/extract`, { lead_id: lead.id }, o.tokens.priya);
    assert.ok(r.status >= 400 && r.status < 600);
    assert.ok(r.body.error);
  });

  test('[CHAT-05] another brand\'s team cannot read this chat (404)', async () => {
    assert.equal((await t.api('GET', `/conversations/${conv}`, undefined, o.tokens.arjun)).status, 404);
  });
});

// ---------------------------------------------------------------- ENQUIRY
describe('ENQUIRY', () => {
  test('[ENQUIRY-01] the landing-page form saves a prospect, and only an admin can read it', async () => {
    ok(await t.api('POST', '/enquiries', { name: 'Aanya', brand: 'Kesar House', phone: '98111 15326', email: 'aanya@kesar.com', purpose: 'Track orders' }), 201);
    const list = ok(await t.api('GET', '/enquiries', undefined, o.admin));
    assert.equal(list[0].phone, '+919811115326');
    assert.equal((await t.api('GET', '/enquiries', undefined, o.tokens.priya)).status, 403);
  });

  test('[ENQUIRY-02] a form with a bad e-mail or number is refused (400)', async () => {
    assert.equal((await t.api('POST', '/enquiries', { name: 'A', brand: 'B', phone: '98111 15326', email: 'nope' })).status, 400);
    assert.equal((await t.api('POST', '/enquiries', { name: 'A', brand: 'B', phone: 'abc', email: 'a@b.co' })).status, 400);
  });
});
