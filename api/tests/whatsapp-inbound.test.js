// Live WhatsApp messages (services/whatsappInbound.js, routes/whatsapp.js). Payloads follow Meta's Cloud API webhook format.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { checkCaller, drainInbound, flatten } from '../src/services/whatsappInbound.js';
import { seedOrg, startApp } from './helpers.js';

const SECRET = 'test-app-secret';
const NA_NUMBER = '919811100001';            // seedOrg gives Noor Atelier +91 98111 00001
const CUSTOMER = '919876543210';
const ts = (iso) => String(Math.floor(new Date(iso).getTime() / 1000));
const meta = (display = NA_NUMBER, id = 'PNID-NA') => ({ display_phone_number: display, phone_number_id: id });

const incoming = (wamid, text, when, { display, pnid, from = CUSTOMER, name = 'Riya Menon' } = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: meta(display, pnid), contacts: [{ wa_id: from, profile: { name } }],
    messages: [{ from, id: wamid, timestamp: ts(when), type: 'text', text: { body: text } }],
  } }] }],
});
const echo = (wamid, text, when) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'smb_message_echoes', value: {
    messaging_product: 'whatsapp', metadata: meta(),
    message_echoes: [{ from: NA_NUMBER, to: CUSTOMER, id: wamid, timestamp: ts(when), type: 'text', text: { body: text } }],
  } }] }],
});
const history = (msgs) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'history', value: {
    messaging_product: 'whatsapp', metadata: meta(),
    history: [{ metadata: { phase: 1, chunk_order: 1, progress: 100 }, threads: [{ id: CUSTOMER, messages: msgs }] }],
  } }] }],
});

describe('reading webhook payloads (no database)', () => {
  test('customer messages, replies from the phone and old chats become messages with the right side; the rest is counted as ignored', () => {
    const r1 = flatten(incoming('w1', 'Hi, need a lehenga for 14 Dec', '2026-11-20T10:00:00Z'));
    assert.deepEqual(r1.messages.map((m) => [m.role, m.customer, m.business, m.customerName, m.text]), [['customer', '+919876543210', '+919811100001', 'Riya Menon', 'Hi, need a lehenga for 14 Dec']]);
    assert.equal(flatten(echo('w2', 'Sure!', '2026-11-20T10:05:00Z')).messages[0].role, 'staff');
    const h = flatten(history([
      { from: CUSTOMER, id: 'h1', timestamp: ts('2026-09-01T09:00:00Z'), type: 'text', text: { body: 'old question' } },
      { from: NA_NUMBER, id: 'h2', timestamp: ts('2026-09-01T09:10:00Z'), type: 'text', text: { body: 'old answer' } },
    ]));
    assert.deepEqual(h.messages.map((m) => [m.role, m.history]), [['customer', true], ['staff', true]]);

    const mixed = flatten({ entry: [{ changes: [
      { field: 'messages', value: { metadata: meta(), statuses: [{ id: 'x', status: 'read' }], messages: [
        { from: CUSTOMER, id: 'r1', timestamp: '1', type: 'reaction', reaction: { emoji: '👍' } },
        { from: CUSTOMER, id: 'i1', timestamp: '1', type: 'image', image: { caption: 'this colour' } },
        { from: CUSTOMER, id: 'a1', timestamp: '1', type: 'audio', audio: { voice: true } },
      ] } },
      { field: 'smb_app_state_sync', value: {} },
    ] }] });
    assert.deepEqual(mixed.messages.map((m) => [m.text, m.media]), [['this colour', 'image'], ['', 'voice note']]);
    assert.deepEqual(mixed.ignored, { 'type:reaction': 1, statuses: 1, 'field:smb_app_state_sync': 1 });
  });

  test('a call is accepted only with a valid signature or URL key, and refused when neither is set up', () => {
    const body = Buffer.from('{"a":1}');
    const sig = `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;
    assert.equal(checkCaller({ rawBody: body, signature: sig }, { WA_APP_SECRET: SECRET }), null);
    assert.equal(checkCaller({ rawBody: Buffer.from('{"a":2}'), signature: sig }, { WA_APP_SECRET: SECRET }), 'bad_signature');
    assert.equal(checkCaller({ rawBody: body, key: 'k'.repeat(40) }, { WA_WEBHOOK_KEY: 'k'.repeat(40) }), null);
    assert.equal(checkCaller({ rawBody: body, key: 'wrong' }, { WA_WEBHOOK_KEY: 'k'.repeat(40) }), 'bad_signature');
    assert.equal(checkCaller({ rawBody: body, signature: sig }, {}), 'not_configured');
  });
});

describe('the webhook', () => {
  let t, org;
  const post = async (payload, { sign = true, key } = {}) => {
    const raw = JSON.stringify(payload);
    const res = await fetch(`${t.url}/whatsapp/webhook${key ? `?key=${key}` : ''}`, {
      method: 'POST', body: raw,
      headers: { 'content-type': 'application/json', ...(sign ? { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}` } : {}) },
    });
    await drainInbound();
    return res.status;
  };
  const chat = async () => {
    const list = (await t.api('GET', `/conversations?brand=${org.na.id}`, undefined, org.admin)).body;
    assert.equal(list.length, 1);
    return (await t.api('GET', `/conversations/${list[0].id}`, undefined, org.admin)).body;
  };

  before(async () => {
    process.env.WA_APP_SECRET = SECRET;
    process.env.WA_VERIFY_TOKEN = 'verify-me';
    t = await startApp();
    org = await seedOrg(t);
  });
  after(async () => {
    delete process.env.WA_APP_SECRET; delete process.env.WA_VERIFY_TOKEN; delete process.env.WA_WEBHOOK_KEY;
    await t.close();
  });

  test("Meta's one-time check answers the challenge only with the right verify token", async () => {
    const ok = await fetch(`${t.url}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '12345');
    assert.equal((await fetch(`${t.url}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status, 403);
  });

  test('an unsigned or wrongly signed call is refused and nothing is stored', async () => {
    assert.equal(await post(incoming('bad1', 'hello', '2026-11-20T09:00:00Z'), { sign: false }), 401);
    const rows = (await t.api('GET', '/whatsapp/inbound', undefined, org.admin)).body;
    assert.equal(rows.length, 0);
  });

  test('a customer message creates the customer and the chat on the right brand; the same message twice is stored once', async () => {
    assert.equal(await post(incoming('w1', 'Hi, need a lehenga for 14 Dec, budget 2L', '2026-11-20T10:00:00Z')), 200);
    assert.equal(await post(incoming('w1', 'Hi, need a lehenga for 14 Dec, budget 2L', '2026-11-20T10:00:00Z')), 200);   // Meta retried
    const c = await chat();
    assert.equal(c.messages.length, 1);
    assert.deepEqual([c.messages[0].role, c.messages[0].sender, c.messages[0].text], ['customer', 'Riya Menon', 'Hi, need a lehenga for 14 Dec, budget 2L']);
    const clients = (await t.api('GET', '/clients?q=Riya', undefined, org.admin)).body;
    assert.ok(JSON.stringify(clients).includes('+919876543210'), 'the customer was created from the WhatsApp number and profile name');
    const rows = (await t.api('GET', '/whatsapp/inbound', undefined, org.admin)).body;
    assert.deepEqual(rows.map((r) => r.status), ['processed', 'processed']);
    assert.equal(rows[0].summary.repeats, 1);
  });

  test("the team's reply from the phone is added as staff, and the sales team of another brand cannot see the chat", async () => {
    await post(echo('w2', 'Hi Riya! Sharing our bridal collection', '2026-11-20T10:05:00Z'));
    const c = await chat();
    assert.deepEqual(c.messages.map((m) => [m.idx, m.role]), [[0, 'customer'], [1, 'staff']]);
    assert.equal((await t.api('GET', `/conversations/${c.id}`, undefined, org.tokens.arjun)).status, 404);
    assert.equal((await t.api('GET', `/conversations/${c.id}`, undefined, org.tokens.priya)).status, 200);
  });

  test('old chats arriving later are put in time order before the live messages', async () => {
    await post(history([
      { from: CUSTOMER, id: 'h1', timestamp: ts('2026-09-01T09:00:00Z'), type: 'text', text: { body: 'Do you ship to Dubai?' } },
      { from: NA_NUMBER, id: 'h2', timestamp: ts('2026-09-01T09:10:00Z'), type: 'text', text: { body: 'Yes, 10-12 days' } },
      { from: CUSTOMER, id: 'w1', timestamp: ts('2026-11-20T10:00:00Z'), type: 'text', text: { body: 'Hi, need a lehenga for 14 Dec, budget 2L' } },
    ]));
    const c = await chat();
    assert.deepEqual(c.messages.map((m) => [m.idx, m.role, m.text.slice(0, 12)]), [
      [0, 'customer', 'Do you ship '], [1, 'staff', 'Yes, 10-12 d'], [2, 'customer', 'Hi, need a l'], [3, 'staff', 'Hi Riya! Sha'],
    ]);
    assert.equal(c.message_count ?? c.messages.length, 4);
  });

  test('a number Stitch does not know is kept as unmatched, and processed after the number is added to a brand', async () => {
    await post(incoming('u1', 'Hello Veda', '2026-11-21T08:00:00Z', { display: '919811199999', pnid: 'PNID-VM' }));
    let rows = (await t.api('GET', '/whatsapp/inbound?status=unmatched', undefined, org.admin)).body;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].summary.unmatched_numbers, ['+919811199999']);
    const add = await t.api('POST', `/brands/${org.vm.id}/whatsapp-accounts`, { phone: '+91 98111 99999' }, org.admin);
    assert.equal(add.status, 201);
    assert.equal((await t.api('POST', `/whatsapp/inbound/${rows[0].id}/retry`, undefined, org.admin)).status, 200);
    await drainInbound();
    rows = (await t.api('GET', '/whatsapp/inbound?status=unmatched', undefined, org.admin)).body;
    assert.equal(rows.length, 0);
    const vm = (await t.api('GET', `/conversations?brand=${org.vm.id}`, undefined, org.admin)).body;
    assert.equal(vm.length, 1);
  });

  test('a provider without Meta\'s signature can use the URL key instead', async () => {
    process.env.WA_WEBHOOK_KEY = 'k'.repeat(40);
    assert.equal(await post(incoming('k1', 'via provider', '2026-11-21T09:00:00Z'), { sign: false, key: 'k'.repeat(40) }), 200);
    assert.equal(await post(incoming('k2', 'wrong key', '2026-11-21T09:01:00Z'), { sign: false, key: 'nope' }), 401);
    const c = await chat();
    assert.ok(c.messages.some((m) => m.text === 'via provider'));
    assert.ok(!c.messages.some((m) => m.text === 'wrong key'));
  });

  test('the inbound log is for admins only', async () => {
    assert.equal((await t.api('GET', '/whatsapp/inbound', undefined, org.tokens.priya)).status, 403);
  });
});
