import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed, seedBase, DEMO_PASSWORD } from '../src/seed.js';
import { createApp } from '../src/routes/index.js';
import { qualify } from '../src/qualify.js';
import { keywordSignals } from '../src/ingest/signals.js';
import { parseWhatsApp } from '../src/ingest/whatsappParser.js';

const lead = (over = {}, fields = {}) => ({ event_date: '2027-01-10', fields: { product: 'Lehenga', phone: '+91 98765 43210', customer_replied: 'Yes', ...fields }, ...over });

test('qualify: product + date + phone + a reply = qualified, and it says why', () => {
  const q = qualify(lead());
  assert.equal(q.status, 'qualified');
  assert.ok(q.reasons.includes('Product named') && q.reasons.includes('Customer replied'));
});

test('qualify: each missing basic makes it not qualified, with the reason', () => {
  assert.deepEqual(qualify(lead({}, { product: '' })).reasons, ['No product mentioned']);
  assert.deepEqual(qualify(lead({ event_date: null })).reasons, ['No event date or budget']);
  assert.equal(qualify(lead({ event_date: null }, { budget_min: 150000 })).status, 'qualified', 'a budget can stand in for the date');
  assert.deepEqual(qualify(lead({}, { phone: '' })).reasons, ['No phone number']);
  assert.deepEqual(qualify(lead({}, { customer_replied: 'No' })).reasons, ['Customer has not replied']);
});

test('qualify: warning keywords beat a complete record; buyer keywords and the AI label help', () => {
  const warned = qualify(lead({}, { negative_signals: ['just looking'] }));
  assert.equal(warned.status, 'not_qualified');
  assert.match(warned.reasons[0], /just looking/);
  assert.equal(qualify(lead({}, { negative_signals: ['budget too low'], positive_signals: ['ready to order', 'asked about payment'] })).status, 'qualified', 'more buyer signals than warnings');
  assert.equal(qualify(lead({ event_date: null }, { budget_min: 100000, buying_intent: 'ready_to_buy' })).status, 'qualified');
  assert.equal(qualify(lead({ event_date: null }, { budget_min: 100000, customer_replied: undefined, buying_intent: 'browsing' })).status, 'not_qualified', 'AI says browsing: 1+2+1+2-2 = 4 is below the bar');
  assert.equal(qualify(lead({}, { customer_replied: undefined })).status, 'qualified', 'a manual lead with no chat data is judged on the basics');
});

test('keywords: only the customer talks count, each group once, with evidence', () => {
  const p = parseWhatsApp(`[10/7/26, 7:00 PM] You: We can book you in and take an advance, it is not too expensive
[10/7/26, 7:01 PM] +91 98765 43210: I am just looking right now, honestly it is too expensive
[10/7/26, 7:02 PM] +91 98765 43210: but I want to order the red one, send the payment link`);
  const k = keywordSignals(p.messages.filter((m) => m.role === 'customer'));
  assert.deepEqual(k.negative.map((x) => x.name).sort(), ['budget too low', 'just looking']);
  assert.deepEqual(k.positive.map((x) => x.name).sort(), ['asked about payment', 'ready to order']);
  assert.match(k.negative[0].evidence, /just looking|too expensive/);
});

function client(app) {
  const server = app.listen(0); server.unref();
  const base = `http://localhost:${server.address().port}/api`;
  return async (method, url, body, token, headers = {}) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers }; };
}
const CHAT_YES = `[10/7/26, 7:00:51 PM] You: Hi, thank you for reaching out to Team Ridhi Mehra!
[10/7/26, 7:01:02 PM] +91 98765 43210: Hi! I want a lehenga for my wedding on 14 December. Budget around 2 lakh. Please send the payment link, I am ready to order
[10/7/26, 7:04:00 PM] +91 98765 43210: My size is medium`;
const CHAT_NO = `[10/8/26, 9:00:00 AM] You: Hello from Team Ridhi Mehra
[10/8/26, 9:05:00 AM] +971 55 594 3392: I am just looking at sarees for now`;
const CHAT_SILENT = `[10/9/26, 9:00:00 AM] You: Hello from Team Ridhi Mehra, how can we help?`;

test('end to end: chats are classified in the upload table, saved on the lead, and shown on the board and record', async () => {
  const db = openDb(':memory:'); seedBase(db);
  const call = client(createApp(db, { llm: null }));
  const tok = (await call('POST', '/auth/login', { email: 'admin@stitch.test', password: DEMO_PASSWORD })).body.token;
  await call('POST', '/admin/brands', { code: 'RM', name: 'Ridhi Mehra' }, tok);
  const up = await call('POST', '/ingest/chats', { chats: [{ name: '_91_98765_43210.zip', text: CHAT_YES }, { name: '_971_55_594_3392.zip', text: CHAT_NO }, { name: '_44_7700_900123.zip', text: CHAT_SILENT }] }, tok);
  const [yes, no, silent] = up.body.items;
  assert.equal(yes.qualification.status, 'qualified');
  assert.equal(no.qualification.status, 'not_qualified');
  assert.match(no.qualification.reasons.join(' '), /just looking|date|budget/);
  assert.match(silent.qualification.reasons.join(' '), /not replied/);
  const done = await call('POST', '/ingest/confirm', { items: [yes, no, silent].map((i) => ({ id: i.id, values: { brand: 'RM', customer_name: `Lead ${i.id}`, phone: i.fields.phone.value, product: i.fields.product?.value, event_date: i.fields.event_date?.value } })) }, tok);
  assert.equal(done.body.created.length, 3);
  const board = (await call('GET', '/leads', null, tok)).body.flatMap((c) => c.cards);
  const byId = Object.fromEntries(board.map((c) => [c.customer, c]));
  assert.equal(byId[`Lead ${yes.id}`].qualification.status, 'qualified');
  assert.equal(byId[`Lead ${no.id}`].qualification.status, 'not_qualified');
  assert.equal(byId[`Lead ${yes.id}`].phone, '+91 98765 43210');
  assert.equal(byId[`Lead ${yes.id}`].product, 'lehenga');
  const rec = (await call('GET', `/leads/${byId[`Lead ${silent.id}`].id}`, null, tok)).body;
  assert.equal(rec.record.fields.customer_replied, 'No');
  assert.equal(rec.qualification.status, 'not_qualified');
  // it recalculates as the team fills things in: give the silent lead the basics and it qualifies
  await call('PATCH', `/leads/${rec.record.id}`, { product: 'Saree', event_date: '3 Feb 2027', customer_replied: 'Yes' }, tok);
  assert.equal((await call('GET', `/leads/${rec.record.id}`, null, tok)).body.qualification.status, 'qualified');
  // orders have no qualification
  assert.equal((await call('GET', '/orders', null, tok)).body.flatMap((c) => c.cards).length, 0);
});

test('demo leads and orders still load (cards carry the new fields)', async () => {
  const db = openDb(':memory:'); seed(db);
  const call = client(createApp(db, { llm: null }));
  const tok = (await call('POST', '/auth/login', { email: 'priya@stitch.test', password: DEMO_PASSWORD })).body.token;
  const leads = (await call('GET', '/leads', null, tok)).body.flatMap((c) => c.cards);
  assert.ok(leads.length > 10 && leads.every((c) => c.qualification && ['qualified', 'not_qualified'].includes(c.qualification.status)));
  assert.ok((await call('GET', '/orders', null, tok)).body.flatMap((c) => c.cards).every((c) => c.qualification === null));
});

test('saved chat is readable via the upload and via the lead', async () => {
  const { processBatch, confirmBatch, getChat } = await import('../src/ingest/service.js');
  const { openDb } = await import('../src/db.js');
  const { seed } = await import('../src/seed.js');
  const db = openDb(':memory:'); seed(db);
  const user = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  const scope = { tenantId: user.tenant_id, user, brands: null };
  const text = '[10/7/26, 7:00 PM] You: Hi from Team X\n[10/7/26, 7:01 PM] +91 98111 15326: I want a saree';
  const r = await processBatch(db, scope, [{ name: 'WhatsApp Chat with +91 98111 15326.txt', text }]);
  assert.equal(getChat(db, scope, { ingestionId: r.items[0].id }).messages.length, 2);
  const brand = (await import('../src/repo.js')).visibleBrands(db, scope)[0].code;
  const c = confirmBatch(db, scope, [{ id: r.items[0].id, values: { brand, customer_name: 'A' } }]);
  assert.deepEqual(c.failed, []); assert.equal(getChat(db, scope, { leadId: c.created[0].leadId }).messages[1].role, 'customer');
});
