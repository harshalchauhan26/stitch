import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { seedOrg, startApp } from './helpers.js';

let t, o, account;
before(async () => {
  t = await startApp(); o = await seedOrg(t);
  account = (await t.api('GET', `/brands/${o.na.id}/whatsapp-accounts`, undefined, o.tokens.priya)).body[0];
});
after(async () => { await t.close(); });
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };

const CHAT = [
  '[12/10/26, 10:01:00 AM] Noor Atelier: Hello! Thank you for reaching out to Noor Atelier',
  '[12/10/26, 10:02:00 AM] +91 98111 22222: Hi, I need a bridal lehenga for 14 Dec',
  '[12/10/26, 10:03:00 AM] Noor Atelier: Lovely! What is your budget?',
].join('\n');
const MORE = `${CHAT}\n[13/10/26, 9:15:00 AM] +91 98111 22222: Around 2 lakh. My waist is 28\n[13/10/26, 9:20:00 AM] Noor Atelier: Noted, sharing options`;

describe('chat upload', () => {
  let conv;
  test('stores the messages, finds the client from the file name and tells staff from customer', async () => {
    const r = ok(await t.api('POST', '/conversations', { whatsapp_account_id: account.id, file_name: 'WhatsApp Chat with +91 98111 22222.txt', text: CHAT }, o.tokens.priya), 201);
    assert.equal(r.messages, 3);
    conv = ok(await t.api('GET', `/conversations/${r.id}`, undefined, o.tokens.priya));
    assert.equal(conv.status, 'unlinked');
    assert.deepEqual(conv.messages.map((m) => m.role), ['staff', 'customer', 'staff']);
    assert.equal(conv.messages[0].ts, '2026-10-12T04:31:00.000Z', 'chat time is read as IST');
    const clients = ok(await t.api('GET', '/clients?q=98111', undefined, o.tokens.priya));
    assert.equal(clients[0].phone, '+919811122222');
  });

  test('the same file twice is refused; a longer export only adds the new messages', async () => {
    const dup = await t.api('POST', '/conversations', { whatsapp_account_id: account.id, file_name: 'again.txt', text: CHAT }, o.tokens.priya);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'duplicate_upload');
    const r = ok(await t.api('POST', '/conversations', { whatsapp_account_id: account.id, file_name: 'WhatsApp Chat with +91 98111 22222.txt', text: MORE }, o.tokens.priya));
    assert.equal(r.created, false);
    assert.equal(r.appended, 2);
    const c = ok(await t.api('GET', `/conversations/${conv.id}`, undefined, o.tokens.priya));
    assert.equal(c.message_count, 5);
    assert.deepEqual(c.messages.map((m) => m.idx), [0, 1, 2, 3, 4]);
  });

  test('a chat without a number in it needs the phone; other brands\' numbers are off limits', async () => {
    const noPhone = CHAT.replaceAll('+91 98111 22222', 'Riya');
    const r = await t.api('POST', '/conversations', { whatsapp_account_id: account.id, file_name: 'WhatsApp Chat with Riya.txt', text: noPhone }, o.tokens.priya);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'phone_needed');
    ok(await t.api('POST', '/conversations', { whatsapp_account_id: account.id, file_name: 'WhatsApp Chat with Riya.txt', text: noPhone, client_phone: '+91 98111 33333' }, o.tokens.priya), 201);
    const vmAccount = (await t.api('GET', `/brands/${o.vm.id}/whatsapp-accounts`, undefined, o.admin)).body[0];
    assert.equal((await t.api('POST', '/conversations', { whatsapp_account_id: vmAccount.id, file_name: 'x.txt', text: CHAT }, o.tokens.priya)).status, 404);
  });

  test('a person links the chat to a lead of the same brand; it shows on the lead and in its history', async () => {
    const lead = ok(await t.api('POST', '/leads', { brand_id: o.na.id, client: { phone: '+91 98111 22222' }, items: [{ product: 'Bridal lehenga' }] }, o.tokens.priya), 201);
    const sugg = ok(await t.api('GET', `/conversations/${conv.id}/suggestions`, undefined, o.tokens.priya));
    assert.deepEqual(sugg.map((s) => s.lead_no), [lead.lead_no]);
    ok(await t.api('POST', `/conversations/${conv.id}/links`, { lead_id: lead.id }, o.tokens.priya), 201);
    assert.equal((await t.api('POST', `/conversations/${conv.id}/links`, { lead_id: lead.id }, o.tokens.priya)).status, 409);
    const chats = ok(await t.api('GET', `/leads/${lead.id}/conversations`, undefined, o.tokens.priya));
    assert.equal(chats[0].messages.length, 5);
    const ev = ok(await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya));
    assert.equal(ev[0].type, 'conversation.linked');
    const vmLead = ok(await t.api('POST', '/leads', { brand_id: o.vm.id, client: { phone: '+91 98111 22222' }, owner_id: o.arjun.id }, o.admin), 201);
    assert.equal((await t.api('POST', `/conversations/${conv.id}/links`, { lead_id: vmLead.id }, o.admin)).status, 400);
  });
});

describe('issues', () => {
  test('open and resolve a size problem on an item; the lead counts open issues', async () => {
    const lead = ok(await t.api('POST', '/leads', { brand_id: o.na.id, client: { phone: '+91 98111 44444' }, items: [{ product: 'Sharara set' }] }, o.tokens.priya), 201);
    const issue = ok(await t.api('POST', `/leads/${lead.id}/issues`, { type: 'size', title: 'Waist too tight at trial', item_id: lead.items[0].id }, o.tokens.priya), 201);
    assert.equal(ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya)).open_issue_count, 1);
    assert.equal((await t.api('PATCH', `/issues/${issue.id}`, { status: 'resolved' }, o.tokens.priya)).status, 400, 'needs a resolution');
    ok(await t.api('PATCH', `/issues/${issue.id}`, { status: 'resolved', resolution: 'Let out by 1 inch' }, o.tokens.priya));
    assert.equal(ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya)).open_issue_count, 0);
    const types = ok(await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya)).map((e) => e.type);
    assert.deepEqual(types.slice(0, 2), ['issue.resolved', 'issue.opened']);
    assert.deepEqual(ok(await t.api('GET', '/issues', undefined, o.tokens.arjun)), [], 'other brands do not see it');
  });
});
