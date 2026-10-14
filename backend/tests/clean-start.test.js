import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed, seedBase, DEMO_PASSWORD } from '../src/seed.js';
import { createApp } from '../src/routes/index.js';

function client(app) {
  const server = app.listen(0); server.unref();
  const base = `http://localhost:${server.address().port}/api`;
  return async (method, url, body, token) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
}
const CHAT = `[10/7/26, 7:00:51 PM] You: Hi, thank you for reaching out to Team Ridhi Mehra!
[10/7/26, 7:01:02 PM] +91 98765 43210: Hi! I want a lehenga for my sangeet. Budget around 2 lakh
[10/7/26, 7:04:00 PM] +91 98765 43210: Delivering to Pune.`;

test('clean start: no fake brands or records; the admin builds the company from Settings', async () => {
  const db = openDb(':memory:'); seedBase(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n + db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM brands').get().n, 0);
  const call = client(createApp(db, { llm: null }));
  const tok = (await call('POST', '/auth/login', { email: 'admin@stitch.test', password: DEMO_PASSWORD })).body.token;
  const home = (await call('GET', '/home', null, tok)).body;
  assert.deepEqual([home.kpis.myGaps, home.kpis.blockedOrders, home.risk.length], [0, 0, 0], 'Home works with zero records');
  assert.equal((await call('GET', '/gaps', null, tok)).body.gaps.length, 0);
  assert.deepEqual((await call('GET', '/leads', null, tok)).body.map((c) => c.cards.length), [0, 0, 0, 0, 0, 0]);
  // the admin adds the real brand: it gets the default Set Required rules and can be detected from the chat greeting
  assert.equal((await call('POST', '/admin/brands', { code: 'RM', name: 'Ridhi Mehra' }, tok)).status, 201);
  assert.ok((await call('GET', '/rules?brand=RM', null, tok)).body.length > 5);
  const up = await call('POST', '/ingest/chats', { chats: [{ name: '_91_98765_43210.zip', text: CHAT }] }, tok);
  assert.equal(up.body.items[0].brand.code, 'RM');
  const done = await call('POST', '/ingest/confirm', { items: [{ id: up.body.items[0].id, values: { brand: 'RM', customer_name: 'First Customer', phone: '+91 98765 43210', owner_id: 'u_admin' } }] }, tok);
  assert.equal(done.body.created[0].leadId, 'LD-1001', 'first real lead id');
  assert.equal((await call('GET', '/leads', null, tok)).body[0].cards.length, 1, 'the new lead is on the board');
});

test('record edits cannot reassign a lead to a stranger or a brand the team cannot see', async () => {
  const db = openDb(':memory:'); seed(db);
  const call = client(createApp(db, { llm: null }));
  const arnav = (await call('POST', '/auth/login', { email: 'arnav@stitch.test', password: DEMO_PASSWORD })).body.token;   // VM-only team
  assert.equal((await call('PATCH', '/leads/LD-1195', { owner_id: 'u_o_admin' }, arnav)).status, 422, 'owner from another company');
  assert.equal((await call('PATCH', '/leads/LD-1195', { brand: 'NA' }, arnav)).status, 403, 'brand outside the team');
  assert.equal((await call('PATCH', '/leads/LD-1195', { owner_id: 'u_neha', notes: 'ok' }, arnav)).status, 200, 'a real colleague is fine');
  assert.equal((await call('PATCH', '/leads/LD-1195', { linked_lead_id: 'x' }, arnav)).status, 422);
});

test('an order record carries its escalations so the drawer can show and resolve them', async () => {
  const db = openDb(':memory:'); seed(db);
  const call = client(createApp(db, { llm: null }));
  const tok = (await call('POST', '/auth/login', { email: 'priya@stitch.test', password: DEMO_PASSWORD })).body.token;
  const o = (await call('GET', '/orders/ORD-2286', null, tok)).body;
  assert.equal(o.escalations.length, 1);
  assert.equal(o.escalations[0].resolved_at, null);
  assert.equal((await call('POST', `/escalations/${o.escalations[0].id}/resolve`, { resolution: 'Called the karigar' }, tok)).status, 200);
  assert.match((await call('GET', '/orders/ORD-2286', null, tok)).body.escalations[0].resolution, /karigar/);
  assert.deepEqual((await call('GET', '/leads/LD-1193', null, tok)).body.escalations, [], 'leads have none');
});

test('history: converting a lead, raising and resolving an escalation all appear in the order activity', async () => {
  const db = openDb(':memory:'); seed(db);
  const call = client(createApp(db, { llm: null }));
  const tok = (await call('POST', '/auth/login', { email: 'priya@stitch.test', password: DEMO_PASSWORD })).body.token;
  await call('POST', '/gaps/LD-1197-advance_amount/fix', { value: '120000' }, tok);
  const won = await call('POST', '/leads/LD-1197/move', { to: 'Won' }, tok);
  assert.equal(won.status, 200);
  const order = (await call('GET', `/orders/${won.body.orderId}`, null, tok)).body;
  assert.ok(order.activity.some((a) => a.action === 'create'), 'order creation is logged');
  const esc = await call('POST', `/orders/${won.body.orderId}/escalations`, { reason: 'Delay', details: 'Late', slaHours: 24 }, tok);
  await call('POST', `/escalations/${esc.body.id}/resolve`, { resolution: 'Fixed' }, tok);
  const actions = (await call('GET', `/orders/${won.body.orderId}`, null, tok)).body.activity.map((a) => a.action);
  assert.ok(actions.includes('escalate') && actions.includes('resolve'), actions.join(','));
});

test('manual lead: a typed date is understood, a bad one is refused', async () => {
  const db = openDb(':memory:'); seed(db);
  const call = client(createApp(db, { llm: null }));
  const tok = (await call('POST', '/auth/login', { email: 'priya@stitch.test', password: DEMO_PASSWORD })).body.token;
  const ok = await call('POST', '/leads', { customer_name: 'Typed Lead', brand: 'NA', event_date: '14 Dec 2027', phone: '+91 90000 11111', intake_method: 'Manual' }, tok);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.record.event_date, '2027-12-14');
  assert.equal((await call('POST', '/leads', { customer_name: 'Bad Date', brand: 'NA', event_date: 'someday' }, tok)).status, 422);
});
