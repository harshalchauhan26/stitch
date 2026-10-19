// Clients (PLAN §5.6, §14)
import { Router } from 'express';
import { withTransaction } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { requirePhone } from '../lib/normalise.js';
import { id, int, str } from '../lib/validate.js';
import { AuditLog, Brand, Client, Conversation, Lead } from '../models/index.js';
import { clientDto, clientInput, findOrCreateClient, visibleClientIds } from '../services/clients.js';
import { recountLeads } from '../services/recount.js';
import { actorFor } from '../services/scope.js';

export const clientsRouter = Router();

async function getClient(scope, clientId) {
  const c = await Client.findOne({ _id: id(clientId, 'client id'), tenant_id: scope.tenantId });
  const visible = await visibleClientIds(scope);
  if (!c || (visible && !visible.includes(String(c._id)))) throw notFound('Client');
  return c;
}

clientsRouter.get('/clients', async (req, res) => {
  const filter = { tenant_id: req.scope.tenantId };
  const visible = await visibleClientIds(req.scope);
  if (visible) filter._id = { $in: visible };
  const q = str(req.query.q, 'q', { max: 100 });
  if (q) {
    const digits = q.replace(/\D/g, '');
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }, ...(digits.length >= 4 ? [{ phone_e164: new RegExp(digits) }] : [])];
  }
  const limit = int(req.query.limit, 'limit', { min: 1, max: 200 }) ?? 50;
  res.json((await Client.find(filter).sort({ updated_at: -1 }).limit(limit).lean()).map(clientDto));
});

clientsRouter.get('/clients/:id', async (req, res) => {
  const c = await getClient(req.scope, req.params.id);
  const scoped = { tenant_id: req.scope.tenantId, client_id: c._id, ...req.scope.brandFilter() };
  const [leads, conversations, brands] = await Promise.all([
    Lead.find(scoped).sort({ created_at: -1 }).select('lead_no stage brand_id fields.event_date items.product items.removed_at').lean(),
    Conversation.find(scoped).sort({ last_msg_at: -1 }).select('brand_id file_name message_count last_msg_at status').lean(),
    Brand.find({ tenant_id: req.scope.tenantId }).select('code').lean(),
  ]);
  const code = (b) => brands.find((x) => String(x._id) === String(b))?.code;
  res.json({
    ...clientDto(c),
    leads: leads.map((l) => ({ id: l._id, lead_no: l.lead_no, stage: l.stage, brand: code(l.brand_id), event_date: l.fields?.event_date ?? null, products: l.items.filter((i) => !i.removed_at).map((i) => i.product) })),
    conversations: conversations.map((x) => ({ id: x._id, brand: code(x.brand_id), file_name: x.file_name, message_count: x.message_count, last_msg_at: x.last_msg_at, status: x.status })),
  });
});

clientsRouter.post('/clients', async (req, res) => {
  const { client, created, warnings } = await withTransaction((session) => findOrCreateClient(req.scope, req.body, session));
  res.status(created ? 201 : 200).json({ ...clientDto(client), created, warnings });
});

clientsRouter.patch('/clients/:id', async (req, res) => {
  const c = await getClient(req.scope, req.params.id);
  const input = clientInput(req.body);
  if (req.body.phone !== undefined) {
    const { e164 } = requirePhone(req.body.phone, 'Phone');
    if (e164 !== c.phone_e164) {
      const other = await Client.findOne({ tenant_id: req.scope.tenantId, phone_e164: e164 }).select('name').lean();
      if (other) throw conflict(`${e164} already belongs to ${other.name || 'another client'}`, { code: 'duplicate_client', client_id: other._id });
      input.alt_phones = [...new Set([...c.alt_phones, c.phone_e164])];
      input.phone_e164 = e164;
    }
  }
  const changes = Object.entries(input).filter(([k, v]) => JSON.stringify(c[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, v]) => ({ field, scope: 'client', old: c[field] ?? null, new: v }));
  if (changes.length) {
    Object.assign(c, input);
    await c.save();
    await AuditLog.create({ tenant_id: req.scope.tenantId, actor: actorFor(req.scope, null), action: 'client.updated', target_type: 'client', target_id: c._id, changes });
    await recountLeads(req.scope.tenantId, { client_id: c._id });
  }
  res.json(clientDto(c));
});
