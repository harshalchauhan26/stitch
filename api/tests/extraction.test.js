// Chat -> lead through the real API and a real MongoDB, with a MOCKED model (needs the local replica set: npm run mongo:dev).
// setLlm() replaces the Groq call with a function that returns a canned JSON answer, so these tests need no key and no network,
// and they check everything around the model: the prompt that is built, the lead that is created, the suggestions and exceptions,
// accept / dismiss through the normal lead edit (with the chat as the source), duplicate-purchase and scope guards, and how
// model problems (no key, invalid JSON) are reported. A live Groq run is a manual check, see docs/wp-groq.md.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { setLlm } from '../src/services/llm.js';
import { seedOrg, startApp } from './helpers.js';

let t, o, account, conv, seen;
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const answer = (obj) => { setLlm(async (prompt) => { seen = prompt; return typeof obj === 'string' ? obj : JSON.stringify(obj); }); };

const CHAT = [
  '[12/10/26, 10:01:00 AM] Noor Atelier: Hello! Thank you for reaching out to Noor Atelier',
  '[12/10/26, 10:02:00 AM] +91 98111 22222: Hi, I need a bridal lehenga for my wedding on 14 Dec',
  '[12/10/26, 10:03:00 AM] Noor Atelier: Lovely! What is your budget?',
  '[13/10/26, 9:15:00 AM] +91 98111 22222: Around 2 lakh. My waist is 71 cm, and it is in Pune',
].join('\n');

const OUTPUT = {
  new_items: [{ product: 'Bridal lehenga', quantity: 1, message: 1, confidence: 0.9, evidence: 'I need a bridal lehenga' }],
  suggestions: [
    { field: 'event_date', value: '2026-12-14', message: 1, confidence: 0.95, evidence: 'wedding on 14 Dec' },
    { field: 'occasion_type', value: 'Wedding', message: 1, confidence: 0.9, evidence: 'my wedding' },
    { field: 'budget_max', value: 200000, message: 3, confidence: 0.8, evidence: 'Around 2 lakh' },
    { field: 'waist', item: 1, value: '71 cm', message: 3, confidence: 0.9, evidence: 'waist is 71 cm' },
    { field: 'city', value: 'Pune', message: 3, confidence: 0.85, evidence: 'in Pune' },
    { field: 'advance_amount', value: 50000, message: 3 },
    { field: 'nekline', item: 1, value: 'V', message: 3 },
    { field: 'blouse_size', item: 1, value: 'Huge', message: 3 },
  ],
};

before(async () => {
  t = await startApp(); o = await seedOrg(t);
  delete process.env.GROQ_API_KEY;
  account = (await t.api('GET', `/brands/${o.na.id}/whatsapp-accounts`, undefined, o.tokens.priya)).body[0];
  const up = ok(await t.api('POST', '/conversations', { whatsapp_account_id: account.id, file_name: 'WhatsApp Chat with +91 98111 22222.txt', text: CHAT }, o.tokens.priya), 201);
  conv = up.id;
});
after(async () => { setLlm(null); await t.close(); });

describe('start a lead from a chat', () => {
  let run, lead;
  test('creates the lead with its products, proposes the rest, and reports what did not fit', async () => {
    answer(OUTPUT);
    run = ok(await t.api('POST', `/conversations/${conv}/extract`, { create_lead: true }, o.tokens.priya), 201);
    assert.equal(run.lead.created, true);
    assert.match(seen.system, /^neckline \| item/m, 'the brand schema is in the prompt');
    assert.match(seen.user, /\[1\] CUSTOMER .*bridal lehenga/, 'the numbered chat is in the prompt');
    assert.deepEqual(run.suggestions.map((s) => s.field).sort(), ['budget_max', 'city', 'event_date', 'occasion_type', 'waist']);
    assert.equal(run.suggestions.find((s) => s.field === 'budget_max').value, 20000000);
    assert.equal(run.suggestions.find((s) => s.field === 'waist').value, 28);
    assert.deepEqual(run.exceptions.map((e) => [e.field, e.code]).sort(), [['advance_amount', 'computed'], ['blouse_size', 'invalid_value'], ['nekline', 'unknown_field']]);
    assert.ok(run.stats.not_found.length > 0 && run.stats.found === 5);
    lead = ok(await t.api('GET', `/leads/${run.lead.id}`, undefined, o.tokens.priya));
    assert.equal(lead.items.length, 1);
    assert.equal(lead.intake_method, 'Chat export');
    assert.equal(lead.fields.event_date, undefined, 'nothing is saved until a person accepts it');
    const chats = ok(await t.api('GET', `/leads/${lead.id}/conversations`, undefined, o.tokens.priya));
    assert.equal(chats.length, 1, 'the chat is linked to the lead');
  });

  test('accepting saves through the normal edit, with the chat as the source', async () => {
    const r = ok(await t.api('POST', `/extractions/${run.id}/accept`, {}, o.tokens.priya));
    assert.deepEqual([r.applied, r.failed], [5, 0]);
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    assert.equal(lead.fields.event_date, '2026-12-14');
    assert.equal(lead.fields.budget_max, 20000000);
    assert.equal(lead.items[0].fields.waist, 28);
    assert.equal(lead.client.city, 'Pune');
    const events = ok(await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya));
    const chatEvents = events.filter((e) => e.source === 'chat');
    assert.equal(chatEvents.length, 5);
    assert.ok(chatEvents.every((e) => e.source_message_id), 'each change points at the message it came from');
    assert.equal((await t.api('POST', `/extractions/${run.id}/accept`, {}, o.tokens.priya)).status, 400, 'nothing left to decide');
  });

  test('a second chat read for the same client needs confirmation, then goes through', async () => {
    answer({ suggestions: [], new_items: [] });
    const r = await t.api('POST', `/conversations/${conv}/extract`, { create_lead: true }, o.tokens.priya);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'open_lead_exists');
    assert.equal(ok(await t.api('POST', `/conversations/${conv}/extract`, { create_lead: true, confirm_new_purchase: true }, o.tokens.priya), 201).lead.created, true);
  });
});

describe('fill an existing lead', () => {
  let lead;
  before(async () => {
    lead = ok(await t.api('POST', '/leads', { brand_id: o.na.id, client: { phone: '+91 98111 22222' }, items: [{ product: 'Sharara set' }], confirm_new_purchase: true }, o.tokens.priya), 201);
  });

  test('proposals wait; dismissing leaves the lead alone; a new read replaces the pending ones', async () => {
    answer({ suggestions: [{ field: 'country', value: 'India', message: 3 }, { field: 'neckline', item: 1, value: 'V', message: 3 }], new_items: [{ product: 'Dupatta', quantity: 2, message: 3 }] });
    const run = ok(await t.api('POST', `/conversations/${conv}/extract`, { lead_id: lead.id }, o.tokens.priya), 201);
    assert.equal(run.lead.created, false);
    assert.deepEqual(run.suggestions.map((s) => s.scope).sort(), ['item', 'lead', 'new_item']);
    const skip = run.suggestions.find((s) => s.field === 'country');
    const r = ok(await t.api('POST', `/extractions/${run.id}/dismiss`, { suggestion_ids: [skip.id] }, o.tokens.priya));
    assert.equal(r.suggestions.find((s) => s.id === skip.id).status, 'dismissed');
    assert.equal(ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya)).fields.country, undefined);
    answer({ suggestions: [{ field: 'lead_source', value: 'Instagram', message: 1 }] });
    ok(await t.api('POST', `/conversations/${conv}/extract`, { lead_id: lead.id }, o.tokens.priya), 201);
    const runs = ok(await t.api('GET', `/leads/${lead.id}/extractions`, undefined, o.tokens.priya));
    assert.equal(runs[0].suggestions.filter((s) => s.status === 'pending').length, 1);
    assert.equal(runs[1].suggestions.filter((s) => s.status === 'pending').length, 0, 'the older read no longer waits');
  });

  test('one suggestion that no longer applies fails on its own; the others are saved', async () => {
    answer({ suggestions: [{ field: 'neckline', item: 1, value: 'Round', message: 3 }, { field: 'notes', value: 'Wants a lighter dupatta', message: 3 }] });
    const run = ok(await t.api('POST', `/conversations/${conv}/extract`, { lead_id: lead.id }, o.tokens.priya), 201);
    const now = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    ok(await t.api('PATCH', `/leads/${lead.id}`, { version: now.version, items: [{ id: now.items[0].id, remove: true }, { product: 'Anarkali' }] }, o.tokens.priya));
    const r = ok(await t.api('POST', `/extractions/${run.id}/accept`, {}, o.tokens.priya));
    assert.deepEqual([r.applied, r.failed], [1, 1]);
    assert.match(r.suggestions.find((s) => s.field === 'neckline').error, /not on this lead/);
    assert.equal(ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya)).fields.notes, 'Wants a lighter dupatta');
  });
});

describe('guards', () => {
  test('other brands cannot read this chat; a lead is needed; model problems are reported plainly', async () => {
    assert.equal((await t.api('POST', `/conversations/${conv}/extract`, { create_lead: true }, o.tokens.arjun)).status, 404);
    assert.equal((await t.api('POST', `/conversations/${conv}/extract`, {}, o.tokens.priya)).status, 400);
    setLlm(null);
    const off = await t.api('POST', `/conversations/${conv}/extract`, { create_lead: true, confirm_new_purchase: true }, o.tokens.priya);
    assert.equal(off.status, 503);
    assert.equal(off.body.code, 'llm_not_configured');
    answer('this is not json');
    const bad = await t.api('POST', `/conversations/${conv}/extract`, { create_lead: true, confirm_new_purchase: true }, o.tokens.priya);
    assert.equal(bad.status, 502);
    assert.equal(bad.body.code, 'llm_bad_output');
  });
});
