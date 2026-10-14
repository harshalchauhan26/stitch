import { FIELDS, LEAD_STAGES, stagesOf } from '../catalogue.js';
import { blockersForMove, computeGaps, indexRules, riskScore, setVal } from '../gapEngine.js';
import { parseValue, ValidationError } from '../lib.js';
import { audit, canSeeBrand, effectiveBrands, getRecord, loadRules, nextId, saveRecord, visibleBrands } from '../repo.js';
import { HttpError, toGapDto, buildContext } from './gaps.js';

export function getRecordWithGaps(db, scope, id, now) {
  const rec = getRecord(db, scope, id);
  if (!rec) throw new HttpError(404, 'Record not found');
  const ctx = buildContext(db, scope, { now });
  const it = ctx.items.find((i) => i.rec.id === id);
  return { record: rec, score: it.score, gaps: it.gaps.map((g) => toGapDto(it, g, ctx.users, now)),
    activity: db.prepare('SELECT * FROM audit_log WHERE tenant_id = ? AND record_id = ? ORDER BY id DESC LIMIT 50').all(scope.tenantId, id),
    whatsapp: db.prepare('SELECT * FROM whatsapp_log WHERE tenant_id = ? AND record_id = ? ORDER BY id DESC LIMIT 50').all(scope.tenantId, id) };
}

// Kanban feed: records grouped by stage with gap counts + risk (red edge when any gap is blocking)
export function kanban(db, scope, type, { brand, now }) {
  const ctx = buildContext(db, scope, { brand, now });
  const stages = stagesOf(type);
  const cards = ctx.items.filter((i) => i.rec.recordType === type).map((i) => ({
    id: i.rec.id, customer: i.rec.customer_name, brand: i.rec.brand, stage: i.rec.stage, owner: ctx.users.get(i.rec.owner_id)?.initials,
    eventDate: i.rec.event_date, value: i.rec.order_value, score: i.score, gapCount: i.gaps.length, blocked: i.gaps.some((g) => g.level === 'blocking'),
  }));
  return stages.map((s) => ({ stage: s, cards: cards.filter((c) => c.stage === s).sort((a, b) => b.score - a.score) }));
}

export function patchRecord(db, scope, id, changes, now) {
  const rec = getRecord(db, scope, id);
  if (!rec) throw new HttpError(404, 'Record not found');
  db.transaction(() => {
    for (const [field, raw] of Object.entries(changes)) {
      if (['id', 'stage', 'recordType'].includes(field)) throw new ValidationError(`${field} cannot be edited here`);
      const def = FIELDS[field];
      const value = def && raw !== '' && raw !== null ? parseValue(def.type === 'bool' || def.type === 'paid' ? 'text' : def.type, raw, now) : raw;
      const old = rec.fields[field] ?? rec[field] ?? null;
      setVal(rec, field, value);
      audit(db, { scope, rec, field, oldValue: { [field]: old }, newValue: { [field]: value }, action: 'edit' });
    }
    saveRecord(db, rec);
  })();
  return getRecordWithGaps(db, scope, id, now);
}

export function createLead(db, scope, body, now = new Date()) {
  if (!body.customer_name || !body.brand) throw new ValidationError('customer_name and brand are required');
  const { customer_name, brand, owner_id, event_date, order_value, ...rest } = body;
  if (!visibleBrands(db, scope).some((b) => b.code === brand)) throw new HttpError(403, 'Your team cannot create leads for this brand');
  if (owner_id && !db.prepare('SELECT 1 FROM users WHERE id = ? AND tenant_id = ?').get(owner_id, scope.tenantId)) throw new ValidationError('Unknown owner');
  const rec = { recordType: 'lead', tenant_id: scope.tenantId, id: nextId(db, scope.tenantId, 'lead'), brand, customer_name, stage: 'New', owner_id: owner_id || scope.user.id,
    event_date: event_date || null, order_value: order_value || null, converted_order_id: null,
    fields: { whatsapp_consent: 'Unknown', created_date: now.toISOString(), ...rest } };
  db.prepare(`INSERT INTO leads (tenant_id, id, brand, customer_name, stage, owner_id, event_date, order_value, fields) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(scope.tenantId, rec.id, brand, customer_name, rec.stage, rec.owner_id, rec.event_date, rec.order_value, JSON.stringify(rec.fields));
  audit(db, { scope, rec, field: 'stage', oldValue: {}, newValue: { stage: 'New' }, action: 'create' });
  return getRecordWithGaps(db, scope, rec.id, now);
}

// Lead -> Order at Won (doc 1.3). Copies fields once; the lead keeps a read-only snapshot.
function convertLead(db, scope, lead) {
  const order = { recordType: 'order', tenant_id: lead.tenant_id, id: nextId(db, lead.tenant_id, 'order'), brand: lead.brand, customer_name: lead.customer_name, stage: 'Created',
    owner_id: lead.owner_id, event_date: lead.event_date, order_value: lead.order_value, linked_lead_id: lead.id, out_of_sync: 0,
    fields: { ...lead.fields, linked_lead_id: lead.id } };
  db.prepare(`INSERT INTO orders (tenant_id, id, brand, customer_name, stage, owner_id, event_date, order_value, linked_lead_id, fields) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(order.tenant_id, order.id, order.brand, order.customer_name, order.stage, order.owner_id, order.event_date, order.order_value, lead.id, JSON.stringify(order.fields));
  lead.stage = 'Won'; lead.converted_order_id = order.id;
  saveRecord(db, lead);
  audit(db, { scope, rec: lead, field: 'stage', oldValue: { stage: 'Awaiting payment' }, newValue: { stage: 'Won', order: order.id }, action: 'convert' });
  return order.id;
}

export function moveStage(db, scope, id, to, now) {
  const rec = getRecord(db, scope, id);
  if (!rec) throw new HttpError(404, 'Record not found');
  const stages = rec.recordType === 'lead' ? [...LEAD_STAGES, 'Lost'] : stagesOf('order');
  const from = stages.indexOf(rec.stage), target = stages.indexOf(to);
  if (target < 0) throw new ValidationError('Unknown stage');
  if (rec.recordType === 'lead' && to === 'Lost') {
    if (!rec.fields.lost_reason) throw new HttpError(409, 'Lost reason is needed');
  } else if (target > from) {
    if (target !== from + 1) throw new ValidationError('Move one stage at a time');
    const gaps = computeGaps(rec, indexRules(loadRules(db, scope.tenantId)));
    const blockers = blockersForMove(rec, gaps, to);
    if (blockers.length) {
      const ctx = buildContext(db, scope, { now });
      const it = ctx.items.find((i) => i.rec.id === id);
      throw new HttpError(409, 'Blocking gaps remain', { blockers: blockers.map((b) => toGapDto(it, b, ctx.users, now)) });
    }
  }
  if (rec.recordType === 'lead' && to === 'Won') return { orderId: convertLead(db, scope, rec), ...getRecordWithGaps(db, scope, id, now) };
  const old = rec.stage; rec.stage = to; saveRecord(db, rec);
  audit(db, { scope, rec, field: 'stage', oldValue: { stage: old }, newValue: { stage: to }, action: 'stage_move' });
  return getRecordWithGaps(db, scope, id, now);
}

export function search(db, scope, q) {
  const like = `%${String(q).trim()}%`;
  if (String(q).trim().length < 2) return [];
  const out = [];
  for (const [t, table] of [['lead', 'leads'], ['order', 'orders']]) {
    for (const r of db.prepare(`SELECT id, customer_name, brand, stage FROM ${table} WHERE tenant_id = ? AND (id LIKE ? OR customer_name LIKE ? OR fields LIKE ?) LIMIT 30`).all(scope.tenantId, like, like, like))
      if (canSeeBrand(scope, r.brand)) out.push({ ...r, recordType: t, href: `/${t}s/${r.id}` });
  }
  return out.slice(0, 10);
}