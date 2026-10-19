// Conversations (chat uploads) and issues on leads (PLAN §5.9-5.11, §10, §14)
import { Router } from 'express';
import { withTransaction } from '../db.js';
import { ISSUE_TYPES } from '../lib/constants.js';
import { badRequest, notFound } from '../lib/errors.js';
import { id, int, oneOf, str } from '../lib/validate.js';
import { Conversation, Lead, LeadIssue, Message } from '../models/index.js';
import { conversationDto, getConversation, linkLead, messageDto, unlinkLead, uploadConversation } from '../services/conversations.js';
import { writeEvent } from '../services/events.js';
import { getLead } from '../services/leads.js';

export const conversationsRouter = Router();

conversationsRouter.post('/conversations', async (req, res) => {
  const r = await uploadConversation(req.scope, req.body);
  res.status(r.created ? 201 : 200).json(r);
});

conversationsRouter.get('/conversations', async (req, res) => {
  const filter = { tenant_id: req.scope.tenantId, ...req.scope.brandFilter() };
  if (req.query.status) filter.status = oneOf(req.query.status, 'status', ['unlinked', 'linked', 'archived']);
  if (req.query.client) filter.client_id = id(req.query.client, 'client');
  if (req.query.brand) { const b = id(req.query.brand, 'brand'); if (!req.scope.canSeeBrand(b)) return res.json([]); filter.brand_id = b; }
  const list = await Conversation.find(filter).sort({ last_msg_at: -1 }).limit(int(req.query.limit, 'limit', { min: 1, max: 200 }) ?? 50).lean();
  res.json(list.map(conversationDto));
});

/** ?after=<idx>&limit=  pages through the messages in order */
conversationsRouter.get('/conversations/:id', async (req, res) => {
  const c = await getConversation(req.scope, req.params.id);
  const after = int(req.query.after, 'after', { min: -1 }) ?? -1;
  const limit = int(req.query.limit, 'limit', { min: 1, max: 1000 }) ?? 500;
  const messages = await Message.find({ conversation_id: c._id, idx: { $gt: after } }).sort({ idx: 1 }).limit(limit).lean();
  res.json({ ...conversationDto(c), messages: messages.map(messageDto) });
});

conversationsRouter.get('/conversations/:id/suggestions', async (req, res) => {
  const c = await getConversation(req.scope, req.params.id);
  const leads = await Lead.find({ tenant_id: req.scope.tenantId, client_id: c.client_id, brand_id: c.brand_id, stage_type: 'open' }).select('lead_no stage items.product items.removed_at fields.event_date').lean();
  res.json(leads.map((l) => ({ id: l._id, lead_no: l.lead_no, stage: l.stage, event_date: l.fields?.event_date ?? null, products: l.items.filter((i) => !i.removed_at).map((i) => i.product) })));
});

conversationsRouter.post('/conversations/:id/links', async (req, res) => res.status(201).json(await linkLead(req.scope, req.params.id, req.body)));
conversationsRouter.delete('/conversations/:id/links/:leadId', async (req, res) => { await unlinkLead(req.scope, req.params.id, req.params.leadId); res.status(204).end(); });

conversationsRouter.get('/leads/:id/conversations', async (req, res) => {
  const lead = await getLead(req.scope, req.params.id);
  const convs = await Conversation.find({ tenant_id: req.scope.tenantId, 'lead_links.lead_id': lead._id }).sort({ last_msg_at: -1 }).lean();
  const limit = int(req.query.messages, 'messages', { min: 0, max: 1000 }) ?? 200;
  res.json(await Promise.all(convs.map(async (c) => ({
    ...conversationDto(c),
    messages: limit ? (await Message.find({ conversation_id: c._id }).sort({ idx: -1 }).limit(limit).lean()).reverse().map(messageDto) : [],
  }))));
});

// ---------- issues (size / design / payment problems, open -> resolved) ----------
const issueDto = (i) => ({
  id: i._id, lead_id: i.lead_id, item_id: i.item_id, type: i.type, title: i.title, description: i.description, status: i.status,
  source_message_id: i.source_message_id, raised_by: i.raised_by, owner_id: i.owner_id, opened_at: i.opened_at, resolved_at: i.resolved_at, resolution: i.resolution,
});

conversationsRouter.post('/leads/:id/issues', async (req, res) => {
  const issue = await withTransaction(async (session) => {
    const lead = await getLead(req.scope, req.params.id, session);
    const itemId = id(req.body.item_id, 'item_id', { required: false });
    if (itemId && !lead.items.some((i) => String(i._id) === String(itemId))) throw badRequest('That item is not on this lead');
    const [i] = await LeadIssue.create([{
      tenant_id: req.scope.tenantId, lead_id: lead._id, brand_id: lead.brand_id, item_id: itemId,
      type: oneOf(req.body.type, 'type', ISSUE_TYPES, { required: true }), title: str(req.body.title, 'title', { required: true, max: 200 }),
      description: str(req.body.description, 'description', { max: 2000 }), source_message_id: id(req.body.source_message_id, 'source_message_id', { required: false }),
      raised_by: req.scope.user._id, owner_id: id(req.body.owner_id, 'owner_id', { required: false }) ?? lead.owner_id,
    }], { session });
    // a counter, not a field edit: incremented atomically, so it never conflicts with someone editing the lead
    await Lead.updateOne({ _id: lead._id }, { $inc: { open_issue_count: 1 } }, { session });
    await writeEvent(session, req.scope, 'lead', lead, { type: 'issue.opened', item_id: itemId, source_message_id: i.source_message_id, data: { issue_id: i._id, type: i.type, title: i.title } });
    return i;
  });
  res.status(201).json(issueDto(issue));
});

conversationsRouter.get('/leads/:id/issues', async (req, res) => {
  const lead = await getLead(req.scope, req.params.id);
  res.json((await LeadIssue.find({ lead_id: lead._id }).sort({ opened_at: -1 }).lean()).map(issueDto));
});

conversationsRouter.get('/issues', async (req, res) => {
  const filter = { tenant_id: req.scope.tenantId, ...req.scope.brandFilter() };
  filter.status = oneOf(req.query.status, 'status', ['open', 'resolved']) ?? 'open';
  if (req.query.type) filter.type = oneOf(req.query.type, 'type', ISSUE_TYPES);
  if (req.query.owner) filter.owner_id = req.query.owner === 'me' ? req.scope.user._id : id(req.query.owner, 'owner');
  res.json((await LeadIssue.find(filter).sort({ opened_at: -1 }).limit(500).lean()).map(issueDto));
});

/** body: { status?: 'resolved' | 'open', resolution?, title?, description?, owner_id? } */
conversationsRouter.patch('/issues/:id', async (req, res) => {
  const issue = await withTransaction(async (session) => {
    const i = await LeadIssue.findOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId }).session(session);
    if (!i || !req.scope.canSeeBrand(i.brand_id)) throw notFound('Issue');
    const lead = await getLead(req.scope, i.lead_id, session);
    if (req.body.title !== undefined) i.title = str(req.body.title, 'title', { required: true, max: 200 });
    if (req.body.description !== undefined) i.description = str(req.body.description, 'description', { max: 2000 });
    if (req.body.owner_id !== undefined) i.owner_id = id(req.body.owner_id, 'owner_id', { required: false });
    const status = oneOf(req.body.status, 'status', ['open', 'resolved']);
    if (status && status !== i.status) {
      if (status === 'resolved') {
        i.resolution = str(req.body.resolution, 'resolution', { required: true, max: 2000 });
        i.resolved_at = new Date();
      } else { i.resolved_at = null; i.resolution = null; }
      i.status = status;
      await Lead.updateOne({ _id: lead._id }, { $inc: { open_issue_count: status === 'resolved' ? -1 : 1 } }, { session });
      await writeEvent(session, req.scope, 'lead', lead, { type: status === 'resolved' ? 'issue.resolved' : 'issue.reopened', item_id: i.item_id, data: { issue_id: i._id, title: i.title, resolution: i.resolution } });
    }
    await i.save({ session });
    return i;
  });
  res.json(issueDto(issue));
});
