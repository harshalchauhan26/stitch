// Chat uploads (PLAN §10): parse with code only, store as messages, link to leads by hand. No AI in v1.
import crypto from 'node:crypto';
import { withTransaction } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { looksLikePhone, parseWhatsApp } from '../lib/whatsappParser.js';
import { phoneFromLabel } from '../lib/normalise.js';
import { id, localToDate, str } from '../lib/validate.js';
import { Brand, Conversation, Lead, Message, WhatsappAccount } from '../models/index.js';
import { findOrCreateClient } from './clients.js';
import { writeEvent } from './events.js';
import { getLead } from './leads.js';

const MAX_CHARS = 800_000;
// how to read 05/06/26 when nothing in the chat settles it; India and most of the world write day first
const DATE_ORDER = process.env.CHAT_DATE_ORDER === 'MDY' ? 'MDY' : 'DMY';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const contentHash = (text) => sha(String(text).replace(/\s+/g, ' ').trim());
const msgHash = (m) => sha(`${m.ts}|${m.sender}|${m.text}|${m.media ?? ''}`);

export async function getConversation(scope, conversationId, session) {
  const c = await Conversation.findOne({ _id: id(conversationId, 'conversation id'), tenant_id: scope.tenantId }).session(session ?? null).lean();
  if (!c || !scope.canSeeBrand(c.brand_id)) throw notFound('Conversation');
  return c;
}

/**
 * body: { whatsapp_account_id, file_name, text, client_phone?, client_name? }
 * The brand comes from the WhatsApp account; the client from the number in the file name, the sender label, or client_phone.
 * Uploading a longer export of the same chat appends only the new messages.
 */
export async function uploadConversation(scope, body = {}) {
  const accountId = id(body.whatsapp_account_id, 'whatsapp_account_id');
  const account = await WhatsappAccount.findOne({ _id: accountId, tenant_id: scope.tenantId, active: true }).lean();
  if (!account || !scope.canSeeBrand(account.brand_id)) throw notFound('WhatsApp account');
  const brand = await Brand.findById(account.brand_id).lean();
  const fileName = str(body.file_name, 'file_name', { max: 255 }) ?? 'chat.txt';
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) throw badRequest('The chat file is empty');
  if (text.length > MAX_CHARS) throw badRequest('This chat is too large (over 800,000 characters). Export a shorter range.');

  const parsed = parseWhatsApp(text, { staffNames: [brand.name, account.display_name].filter(Boolean), defaultDateOrder: DATE_ORDER });
  if (!parsed.messages.length) throw badRequest('This does not look like a WhatsApp chat export: no messages were found');
  const hash = contentHash(text);
  const dup = await Conversation.findOne({ tenant_id: scope.tenantId, content_hash: hash }).select('_id file_name').lean();
  if (dup) throw conflict(`This chat was already uploaded (${dup.file_name})`, { code: 'duplicate_upload', conversation_id: dup._id });

  const customerLabel = parsed.messages.find((m) => m.role === 'customer')?.sender;
  const phone = body.client_phone ?? phoneFromLabel(fileName)?.e164 ?? (looksLikePhone(customerLabel) ? customerLabel : null);
  if (!phone) throw badRequest('Could not find the customer\'s number in the file name or the chat. Send client_phone.', { code: 'phone_needed' });
  const name = str(body.client_name, 'client_name', { max: 120 }) ?? (customerLabel && !looksLikePhone(customerLabel) ? customerLabel : undefined);

  return withTransaction(async (session) => {
    const { client, warnings } = await findOrCreateClient(scope, { phone, ...(name ? { name } : {}) }, session);
    const existing = await Conversation.findOne({ tenant_id: scope.tenantId, whatsapp_account_id: account._id, client_id: client._id, status: { $ne: 'archived' } }).session(session).lean();
    const conv = existing ?? (await Conversation.create([{
      tenant_id: scope.tenantId, whatsapp_account_id: account._id, brand_id: account.brand_id, client_id: client._id,
      file_name: fileName, content_hash: hash, uploaded_by: scope.user._id,
    }], { session }))[0].toObject();

    // re-upload: keep the messages we already have, add the rest after them
    const known = new Set(existing ? await Message.distinct('msg_hash', { conversation_id: conv._id }).session(session) : []);
    const last = existing ? (await Message.findOne({ conversation_id: conv._id }).sort({ idx: -1 }).select('idx').session(session).lean())?.idx ?? -1 : -1;
    const fresh = [];
    for (const m of parsed.messages) {
      const h = msgHash(m);
      if (known.has(h)) continue;
      known.add(h);
      fresh.push({ tenant_id: scope.tenantId, conversation_id: conv._id, idx: last + 1 + fresh.length, ts: localToDate(m.ts), sender: m.sender, role: m.role, text: m.text, media: m.media, msg_hash: h });
    }
    if (fresh.length) await Message.insertMany(fresh, { session });
    const all = await Message.aggregate([
      { $match: { conversation_id: conv._id } },
      { $group: { _id: null, n: { $sum: 1 }, c: { $sum: { $cond: [{ $eq: ['$role', 'customer'] }, 1, 0] } }, first: { $min: '$ts' }, last: { $max: '$ts' } } },
    ]).session(session);
    await Conversation.updateOne({ _id: conv._id }, { $set: {
      message_count: all[0]?.n ?? 0, customer_message_count: all[0]?.c ?? 0, first_msg_at: all[0]?.first ?? null, last_msg_at: all[0]?.last ?? null,
      ...(existing ? { file_name: fileName, content_hash: hash } : {}),
    } }, { session });
    const openLeads = await Lead.find({ tenant_id: scope.tenantId, client_id: client._id, brand_id: account.brand_id, stage: { $nin: ['Won', 'Lost'] } }).select('lead_no stage').session(session).lean();
    return { id: conv._id, created: !existing, appended: existing ? fresh.length : 0, messages: fresh.length, warnings, suggested_leads: openLeads.map((l) => ({ id: l._id, lead_no: l.lead_no, stage: l.stage })) };
  });
}

/** A person decides which lead(s) a chat is about; the system never guesses (PLAN §10.2) */
export async function linkLead(scope, conversationId, body = {}) {
  return withTransaction(async (session) => {
    const conv = await getConversation(scope, conversationId, session);
    const lead = await getLead(scope, body.lead_id, session);
    if (String(lead.brand_id) !== String(conv.brand_id)) throw badRequest('This chat is on another brand\'s WhatsApp number, so it cannot be linked to this lead');
    if (conv.lead_links.some((l) => String(l.lead_id) === String(lead._id))) throw conflict('This chat is already linked to this lead');
    const note = str(body.note, 'note', { max: 300 });
    await Conversation.updateOne({ _id: conv._id }, { $push: { lead_links: { lead_id: lead._id, linked_by: scope.user._id, note } }, $set: { status: 'linked' } }, { session });
    await writeEvent(session, scope, 'lead', lead, { type: 'conversation.linked', data: { conversation_id: conv._id, file_name: conv.file_name, note } });
    return { warning: String(lead.client_id) !== String(conv.client_id) ? 'This chat is with a different client than the lead\'s client' : null };
  });
}

export async function unlinkLead(scope, conversationId, leadId) {
  return withTransaction(async (session) => {
    const conv = await getConversation(scope, conversationId, session);
    const lead = await getLead(scope, leadId, session);
    const left = conv.lead_links.filter((l) => String(l.lead_id) !== String(lead._id));
    if (left.length === conv.lead_links.length) throw notFound('Link');
    await Conversation.updateOne({ _id: conv._id }, { $set: { lead_links: left, status: left.length ? 'linked' : 'unlinked' } }, { session });
    await writeEvent(session, scope, 'lead', lead, { type: 'conversation.unlinked', data: { conversation_id: conv._id } });
  });
}

export const conversationDto = (c) => ({
  id: c._id, whatsapp_account_id: c.whatsapp_account_id, brand_id: c.brand_id, client_id: c.client_id, file_name: c.file_name,
  first_msg_at: c.first_msg_at, last_msg_at: c.last_msg_at, message_count: c.message_count, customer_message_count: c.customer_message_count,
  status: c.status, lead_ids: c.lead_links.map((l) => l.lead_id), created_at: c.created_at,
});
export const messageDto = (m) => ({ id: m._id, idx: m.idx, ts: m.ts, sender: m.sender, role: m.role, text: m.text, media: m.media });
