// WhatsApp messages arriving live (docs/WHATSAPP_AGENT.md, "Runbook"). A brand's number is connected to the WhatsApp Business
// Platform through Coexistence: the team keeps using the WhatsApp Business app, and Meta (directly, or through a provider such
// as 360dialog that forwards Meta's format) calls our webhook for every message. This file turns those calls into the same
// conversations and messages a chat upload creates, so the Chats page and the AI chat reading work on them unchanged.
//
// What is read (Meta's webhook "fields"):
//   messages             a customer wrote to the brand                        -> role customer
//   smb_message_echoes   the team replied from the phone or a linked device   -> role staff
//   history              the past 1:1 chats (up to ~6 months), sent once after onboarding when the business agreed to share them
//   (statuses, smb_app_state_sync contacts and anything else are acknowledged and ignored)
//
// How it runs:
//   1. the route stores the raw call in wa_inbound (status pending) and answers 200 at once, so Meta never times out or retries
//      because we were slow, and nothing is lost if step 2 fails
//   2. drainInbound() processes the pending calls ONE AT A TIME, oldest first (so message numbers in a chat never clash)
//   3. a number that is not a WhatsApp account in Stitch is marked unmatched (kept, not dropped): add the number to the brand,
//      then reprocess (POST /whatsapp/inbound/:id/retry)
//
// Repeats are harmless: a message is stored once per WhatsApp message id (wamid), however often Meta sends it.
// The payload shapes follow Meta's Cloud API webhook reference; the raw payloads are kept so the first real ones from the pilot
// can be checked against this code.
import crypto from 'node:crypto';
import { Brand, Client, Conversation, Message, WaInbound, WhatsappAccount } from '../models/index.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const e164 = (v) => (digits(v) ? `+${digits(v)}` : null);

// ---------------------------------------------------------------- reading one WhatsApp message

/**
 * A WhatsApp message object -> { text, media } or null when there is nothing worth keeping (reactions, system notices,
 * unsupported types). Media itself is not downloaded: the message says which kind it was, plus its caption.
 */
export function readContent(m) {
  switch (m?.type) {
    case 'text': return { text: m.text?.body ?? '', media: null };
    case 'image': case 'video': case 'document': case 'sticker':
      return { text: m[m.type]?.caption ?? (m.type === 'document' ? m.document?.filename ?? '' : ''), media: m.type };
    case 'audio': return { text: '', media: m.audio?.voice ? 'voice note' : 'audio' };
    case 'location': return { text: `Location: ${[m.location?.name, m.location?.address].filter(Boolean).join(', ') || `${m.location?.latitude}, ${m.location?.longitude}`}`, media: null };
    case 'contacts': return { text: `Shared contact: ${(m.contacts ?? []).map((c) => c.name?.formatted_name).filter(Boolean).join(', ')}`, media: null };
    case 'button': return { text: m.button?.text ?? '', media: null };
    case 'interactive': return { text: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '', media: null };
    default: return null;                                    // reaction, system, unsupported, edit, revoke ...
  }
}

/**
 * One webhook call -> a flat list of messages to store:
 *   { business: '+91...', phoneNumberId, customer: '+91...', customerName, wamid, ts, role, text, media, history }
 * plus `ignored` (how many entries were skipped and why). Pure, so it is unit tested without a database.
 */
export function flatten(payload) {
  const out = [], ignored = {};
  const skip = (why) => { ignored[why] = (ignored[why] ?? 0) + 1; };
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = ch?.value ?? {};
      const business = e164(v.metadata?.display_phone_number);
      const phoneNumberId = v.metadata?.phone_number_id ? String(v.metadata.phone_number_id) : null;
      const push = (m, role, customer, customerName, history = false) => {
        const c = readContent(m);
        if (!c) return skip(`type:${m?.type ?? 'none'}`);
        if (!m.id || !customer) return skip('incomplete');
        out.push({ business, phoneNumberId, customer, customerName: customerName ?? null, wamid: String(m.id), ts: new Date(Number(m.timestamp) * 1000 || Date.now()), role, ...c, history });
      };
      if (ch.field === 'messages') {
        const names = new Map((v.contacts ?? []).map((c) => [digits(c.wa_id), c.profile?.name]));
        for (const m of v.messages ?? []) push(m, 'customer', e164(m.from), names.get(digits(m.from)));
        if (v.statuses?.length) skip('statuses');
      } else if (ch.field === 'smb_message_echoes') {
        for (const m of v.message_echoes ?? []) push(m, 'staff', e164(m.to));
      } else if (ch.field === 'history') {
        for (const chunk of v.history ?? []) {
          for (const thread of chunk.threads ?? []) {
            const customer = e164(thread.id);
            for (const m of thread.messages ?? []) {
              // in a thread, a message from the business number is the team's; anything else is the customer's
              const fromBusiness = business && e164(m.from) === business;
              push(m, fromBusiness ? 'staff' : 'customer', customer, null, true);
            }
          }
        }
      } else skip(`field:${ch?.field ?? 'none'}`);
    }
  }
  return { messages: out, ignored };
}

// ---------------------------------------------------------------- storing

// Meta's phone_number_id first (it never changes), then the display number; the id is remembered on the account for next time
async function findAccount(phoneNumberId, business) {
  let acc = phoneNumberId ? await WhatsappAccount.findOne({ wa_phone_number_id: phoneNumberId, active: true }).lean() : null;
  if (!acc && business) {
    acc = await WhatsappAccount.findOne({ phone_e164: business, active: true }).lean();
    if (acc && phoneNumberId && !acc.wa_phone_number_id) await WhatsappAccount.updateOne({ _id: acc._id }, { $set: { wa_phone_number_id: phoneNumberId } });
  }
  return acc;
}

// The customer, found by number or created. A WhatsApp profile name only fills an empty name, never replaces one a person typed.
async function findClient(tenantId, phone, name) {
  const c = await Client.findOne({ tenant_id: tenantId, phone_e164: phone });
  if (c) {
    if (!c.name && name) { c.name = name; await c.save(); }
    return c;
  }
  try {
    return await Client.create({ tenant_id: tenantId, phone_e164: phone, ...(name ? { name } : {}) });
  } catch (e) {
    if (e?.code === 11000) return Client.findOne({ tenant_id: tenantId, phone_e164: phone });   // created meanwhile
    throw e;
  }
}

// One conversation per brand number and customer, the same one a chat upload appends to
async function findConversation(acc, client) {
  const c = await Conversation.findOne({ tenant_id: acc.tenant_id, whatsapp_account_id: acc._id, client_id: client._id, status: { $ne: 'archived' } }).lean();
  if (c) return c;
  return (await Conversation.create({
    tenant_id: acc.tenant_id, whatsapp_account_id: acc._id, brand_id: acc.brand_id, client_id: client._id,
    source: 'whatsapp', file_name: null, content_hash: `whatsapp:${acc._id}:${client._id}`,
  })).toObject();
}

/**
 * Message numbers (idx) follow time. Old chats from `history` arrive after newer live messages, so when anything older than the
 * newest stored message was added, the whole chat is renumbered by time. Two passes (negative first) keep the unique
 * (conversation, idx) index happy. Safe because suggestions point at message ids, not numbers.
 */
async function renumber(conversationId) {
  const all = await Message.find({ conversation_id: conversationId }).sort({ ts: 1, _id: 1 }).select('_id idx').lean();
  const moves = all.map((m, i) => ({ _id: m._id, from: m.idx, to: i })).filter((m) => m.from !== m.to);
  if (!moves.length) return;
  await Message.bulkWrite(moves.map((m) => ({ updateOne: { filter: { _id: m._id }, update: { $set: { idx: -1 - m.to } } } })));
  await Message.bulkWrite(moves.map((m) => ({ updateOne: { filter: { _id: m._id }, update: { $set: { idx: m.to } } } })));
}

async function refreshCounts(conversationId) {
  const [a] = await Message.aggregate([
    { $match: { conversation_id: conversationId } },
    { $group: { _id: null, n: { $sum: 1 }, c: { $sum: { $cond: [{ $eq: ['$role', 'customer'] }, 1, 0] } }, first: { $min: '$ts' }, last: { $max: '$ts' } } },
  ]);
  await Conversation.updateOne({ _id: conversationId }, { $set: { message_count: a?.n ?? 0, customer_message_count: a?.c ?? 0, first_msg_at: a?.first ?? null, last_msg_at: a?.last ?? null } });
}

/** One stored webhook call -> messages in Stitch. Returns { status, tenant_id, summary } for its wa_inbound row. */
export async function processPayload(payload) {
  const { messages, ignored } = flatten(payload);
  const summary = { stored: 0, repeats: 0, ignored, unmatched_numbers: [] };
  if (!messages.length) return { status: 'processed', tenant_id: null, summary };

  let tenantId = null, matched = 0;
  const touched = new Map();                                // conversation id -> needs renumbering
  for (const m of messages) {
    const acc = await findAccount(m.phoneNumberId, m.business);
    if (!acc) { if (!summary.unmatched_numbers.includes(m.business)) summary.unmatched_numbers.push(m.business); continue; }
    matched++; tenantId = acc.tenant_id;
    const client = await findClient(acc.tenant_id, m.customer, m.role === 'customer' ? m.customerName : null);
    const conv = await findConversation(acc, client);
    const hash = sha(`wa:${m.wamid}`);
    if (await Message.exists({ conversation_id: conv._id, msg_hash: hash })) { summary.repeats++; continue; }
    const brand = m.role === 'staff' ? await Brand.findById(acc.brand_id).select('name').lean() : null;
    const last = await Message.findOne({ conversation_id: conv._id }).sort({ idx: -1 }).select('idx ts').lean();
    try {
      await Message.create({
        tenant_id: acc.tenant_id, conversation_id: conv._id, idx: (last?.idx ?? -1) + 1, ts: m.ts,
        sender: m.role === 'customer' ? (m.customerName || m.customer) : (acc.display_name || brand?.name || 'Staff'),
        role: m.role, text: m.text, media: m.media, msg_hash: hash, wamid: m.wamid,
      });
    } catch (e) {
      if (e?.code === 11000) { summary.repeats++; continue; }
      throw e;
    }
    summary.stored++;
    const needs = touched.get(String(conv._id)) ?? { id: conv._id, renumber: false };
    if (last && m.ts < last.ts) needs.renumber = true;      // older than what we had: an old chat arriving late
    touched.set(String(conv._id), needs);
  }
  for (const t of touched.values()) {
    if (t.renumber) await renumber(t.id);
    await refreshCounts(t.id);
  }
  return { status: matched ? 'processed' : 'unmatched', tenant_id: tenantId, summary };
}

// ---------------------------------------------------------------- the queue

const MAX_ATTEMPTS = 5;
let running = null;

/** Processes every pending call, oldest first, one at a time. Calls made while it runs wait for the same run. */
export function drainInbound() {
  if (running) return running;
  running = (async () => {
    let n = 0;
    for (;;) {
      const row = await WaInbound.findOne({ status: 'pending', attempts: { $lt: MAX_ATTEMPTS } }).sort({ created_at: 1, _id: 1 }).lean();
      if (!row) break;
      try {
        const r = await processPayload(row.payload);
        await WaInbound.updateOne({ _id: row._id }, { $set: { status: r.status, tenant_id: r.tenant_id, summary: r.summary, error: null }, $inc: { attempts: 1 } });
      } catch (e) {
        const attempts = row.attempts + 1;
        await WaInbound.updateOne({ _id: row._id }, { $set: { status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', error: String(e?.message ?? e).slice(0, 500) }, $inc: { attempts: 1 } });
        console.error('whatsapp inbound:', e?.message ?? e);
        if (attempts < MAX_ATTEMPTS) break;                  // leave it for the next kick instead of spinning on it
      }
      n++;
    }
    return n;
  })().finally(() => { running = null; });
  return running;
}

/** Fire and forget, used by the route after storing a call (and at start-up for calls left from before a restart) */
export function kickInbound() { drainInbound().catch((e) => console.error('whatsapp inbound:', e?.message ?? e)); }

// ---------------------------------------------------------------- checking who is calling

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Is this call really from Meta / our provider? One of these must be set in api/.env, or the webhook refuses everything:
 *   WA_APP_SECRET    Meta's app secret: every call carries X-Hub-Signature-256 = HMAC-SHA256 of the raw body (direct Cloud API)
 *   WA_WEBHOOK_KEY   a long random key put in the webhook URL as ?key=... (for providers that forward without Meta's signature)
 * Returns null when the call is allowed, else the reason.
 */
export function checkCaller({ rawBody, signature, key }, env = process.env) {
  const secret = env.WA_APP_SECRET, urlKey = env.WA_WEBHOOK_KEY;
  if (!secret && !urlKey) return 'not_configured';
  if (secret && signature) {
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody ?? Buffer.alloc(0)).digest('hex')}`;
    if (safeEqual(signature, expected)) return null;
  }
  if (urlKey && key && safeEqual(key, urlKey)) return null;
  return 'bad_signature';
}
