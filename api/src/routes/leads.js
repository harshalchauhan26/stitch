// Leads, gaps (the to-do list) and the audit trail (PLAN §7-9, §14)
import { Router } from 'express';
import { badRequest } from '../lib/errors.js';
import { id, int, oneOf, str, todayIso } from '../lib/validate.js';
import { Brand, Client, Lead, LeadEvent, User } from '../models/index.js';
import { clientDto } from '../services/clients.js';
import { eventDto } from '../services/events.js';
import { computeGaps } from '../services/gaps.js';
import { createLead, getLead, markLost, moveStage, reopenLead, undoEvent, updateLead } from '../services/leads.js';
import { rulesCache } from '../services/rules.js';
import { kickWebhooks } from '../services/webhooks.js';

export const leadsRouter = Router();

const daysTo = (iso) => (iso ? Math.round((Date.parse(iso) - Date.parse(todayIso())) / 86400000) : null);
const byId = (list) => new Map(list.map((x) => [String(x._id), x]));
const itemDto = (i) => ({ id: i._id, product: i.product, product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, wearer: i.wearer, fields: i.fields });

/** Which fields this brand asks for at each stage, for the lead form (first stage that asks wins) */
function layout(rb) {
  const seen = new Set();
  return rb.pipeline.open.map((stage) => ({
    stage,
    fields: rb.rules.lead.filter((r) => r.stage === stage && !seen.has(r.field) && seen.add(r.field)).map((r) => {
      const d = rb.defs.get(r.field);
      return d && { key: d.key, label: d.label, scope: d.scope, type: d.type, options: d.options ?? null, unit: d.unit, level: r.level, computed: d.computed, hint: d.hint };
    }).filter(Boolean),
  }));
}

async function leadView(scope, lead) {
  const rules = rulesCache(scope.tenantId);
  const [client, brand, owner, rb] = await Promise.all([
    Client.findById(lead.client_id).lean(), Brand.findById(lead.brand_id).select('code name').lean(),
    User.findById(lead.owner_id).select('name initials').lean(), rules(lead.brand_id),
  ]);
  const gaps = computeGaps({ recordType: 'lead', stage: lead.stage, lead, client }, rb);
  return {
    id: lead._id, lead_no: lead.lead_no, stage: lead.stage, stage_type: lead.stage_type, version: lead.version, pipeline: rb.pipeline.stages,
    brand: { id: brand._id, code: brand.code, name: brand.name }, owner: owner && { id: owner._id, name: owner.name, initials: owner.initials },
    client: clientDto(client), fields: lead.fields, items: lead.items.filter((i) => !i.removed_at).map(itemDto),
    gaps, open_gap_count: gaps.length, blocking_gap_count: gaps.filter((g) => g.level === 'blocking').length, open_issue_count: lead.open_issue_count,
    days_to_event: daysTo(lead.fields.event_date), intake_method: lead.intake_method,
    lost_reason: lead.lost_reason, lost_note: lead.lost_note, converted_order_id: lead.converted_order_id,
    created_at: lead.created_at, updated_at: lead.updated_at, layout: layout(rb),
  };
}

const view = async (req, leadId) => leadView(req.scope, await getLead(req.scope, leadId));

leadsRouter.post('/leads', async (req, res) => {
  const { id: leadId, warnings } = await createLead(req.scope, req.body);
  res.status(201).json({ ...(await view(req, String(leadId))), warnings });
});

leadsRouter.get('/leads', async (req, res) => {
  const { tenantId } = req.scope;
  const q = req.query;
  const filter = { tenant_id: tenantId, ...req.scope.brandFilter() };
  if (q.brand) { const b = id(q.brand, 'brand'); if (!req.scope.canSeeBrand(b)) return res.json({ total: 0, leads: [] }); filter.brand_id = b; }
  if (q.stage) filter.stage = str(q.stage, 'stage', { max: 40 });
  if (q.stage_type) filter.stage_type = oneOf(q.stage_type, 'stage_type', ['open', 'won', 'lost']);
  if (q.owner) filter.owner_id = q.owner === 'me' ? req.scope.user._id : id(q.owner, 'owner');
  if (q.client) filter.client_id = id(q.client, 'client');
  const search = str(q.q, 'q', { max: 100 });
  if (search) {
    const digits = search.replace(/\D/g, '');
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const clients = await Client.find({ tenant_id: tenantId, $or: [{ name: rx }, ...(digits.length >= 4 ? [{ phone_e164: new RegExp(digits) }] : [])] }).select('_id').limit(200).lean();
    filter.$or = [{ lead_no: rx }, { client_id: { $in: clients.map((c) => c._id) } }];
  }
  const limit = int(q.limit, 'limit', { min: 1, max: 200 }) ?? 50, skip = int(q.skip, 'skip', { min: 0 }) ?? 0;
  const [total, leads] = await Promise.all([Lead.countDocuments(filter), Lead.find(filter).sort({ updated_at: -1 }).skip(skip).limit(limit).lean()]);
  const [clients, users, brands] = await Promise.all([
    Client.find({ _id: { $in: leads.map((l) => l.client_id) } }).select('name phone_e164').lean(),
    User.find({ _id: { $in: leads.map((l) => l.owner_id) } }).select('name initials').lean(),
    Brand.find({ _id: { $in: leads.map((l) => l.brand_id) } }).select('code name').lean(),
  ]).then((xs) => xs.map(byId));
  res.json({
    total, leads: leads.map((l) => ({
      id: l._id, lead_no: l.lead_no, stage: l.stage, stage_type: l.stage_type, version: l.version,
      client: { id: l.client_id, name: clients.get(String(l.client_id))?.name ?? null, phone: clients.get(String(l.client_id))?.phone_e164 },
      brand: { id: l.brand_id, code: brands.get(String(l.brand_id))?.code }, owner: { id: l.owner_id, initials: users.get(String(l.owner_id))?.initials },
      event_date: l.fields.event_date ?? null, days_to_event: daysTo(l.fields.event_date), products: l.items.filter((i) => !i.removed_at).map((i) => i.product),
      open_gap_count: l.open_gap_count, blocking_gap_count: l.blocking_gap_count, open_issue_count: l.open_issue_count, updated_at: l.updated_at,
    })),
  });
});

leadsRouter.get('/leads/:id', async (req, res) => res.json(await view(req, req.params.id)));

leadsRouter.patch('/leads/:id', async (req, res) => {
  const r = await updateLead(req.scope, req.params.id, req.body);
  res.json({ ...(await view(req, req.params.id)), changed: r.changed });
});

leadsRouter.post('/leads/:id/items', async (req, res) => {
  const { version, ...item } = req.body || {};
  await updateLead(req.scope, req.params.id, { version, items: [item] });
  res.status(201).json(await view(req, req.params.id));
});

leadsRouter.delete('/leads/:id/items/:itemId', async (req, res) => {
  await updateLead(req.scope, req.params.id, { version: req.query.version, items: [{ id: req.params.itemId, remove: true }], reason: req.query.reason });
  res.json(await view(req, req.params.id));
});

leadsRouter.post('/leads/:id/stage', async (req, res) => {
  const r = await moveStage(req.scope, req.params.id, req.body);
  if (r.order_id) kickWebhooks();                         // tell the brand now rather than at the next worker tick
  res.json({ ...(await view(req, req.params.id)), order_id: r.order_id ?? null });
});

leadsRouter.post('/leads/:id/lost', async (req, res) => { await markLost(req.scope, req.params.id, req.body); res.json(await view(req, req.params.id)); });
leadsRouter.post('/leads/:id/reopen', async (req, res) => { await reopenLead(req.scope, req.params.id, req.body); res.json(await view(req, req.params.id)); });

leadsRouter.get('/leads/:id/events', async (req, res) => {
  const lead = await getLead(req.scope, req.params.id);
  const limit = int(req.query.limit, 'limit', { min: 1, max: 500 }) ?? 100;
  const events = await LeadEvent.find({ tenant_id: req.scope.tenantId, lead_id: lead._id }).sort({ at: -1, _id: -1 }).limit(limit).lean();
  res.json(events.map(eventDto));
});

leadsRouter.post('/leads/:id/undo/:eventId', async (req, res) => {
  await undoEvent(req.scope, req.params.id, req.params.eventId, req.body);
  res.json(await view(req, req.params.id));
});

/** The to-do list: every open gap on every open lead the caller can see, blocking first, then nearest event (spec §5.1) */
leadsRouter.get('/gaps', async (req, res) => {
  const q = req.query;
  const filter = { tenant_id: req.scope.tenantId, stage_type: 'open', open_gap_count: { $gt: 0 }, ...req.scope.brandFilter() };
  if (q.brand) { const b = id(q.brand, 'brand'); if (!req.scope.canSeeBrand(b)) return res.json([]); filter.brand_id = b; }
  if (q.owner) filter.owner_id = q.owner === 'me' ? req.scope.user._id : id(q.owner, 'owner');
  const level = oneOf(q.level, 'level', ['needed', 'blocking']);
  const leads = await Lead.find(filter).limit(2000).lean();
  if (leads.length === 2000) throw badRequest('Too many leads to list at once; filter by brand or owner');
  const [clients, brands] = await Promise.all([
    Client.find({ _id: { $in: leads.map((l) => l.client_id) } }).lean(),
    Brand.find({ _id: { $in: leads.map((l) => l.brand_id) } }).select('code').lean(),
  ]).then((xs) => xs.map(byId));
  const rules = rulesCache(req.scope.tenantId);
  const out = [];
  for (const lead of leads) {
    const client = clients.get(String(lead.client_id));
    for (const g of computeGaps({ recordType: 'lead', stage: lead.stage, lead, client }, await rules(lead.brand_id))) {
      if (level && g.level !== level) continue;
      out.push({ ...g, record_type: 'lead', record_id: lead._id, record_no: lead.lead_no, record_stage: lead.stage, version: lead.version,
        brand: brands.get(String(lead.brand_id))?.code, client_name: client?.name ?? client?.phone_e164, owner_id: lead.owner_id,
        event_date: lead.fields.event_date ?? null, days_to_event: daysTo(lead.fields.event_date) });
    }
  }
  out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'blocking' ? -1 : 1) || (a.days_to_event ?? 1e9) - (b.days_to_event ?? 1e9) || a.record_no.localeCompare(b.record_no));
  res.json(out);
});
