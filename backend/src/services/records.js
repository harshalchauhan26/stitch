import { CLOSED_STAGES, FIELDS, LEAD_STAGES, stagesOf } from '../catalogue.js';
import { blockersForMove, computeGaps, getVal, indexRules, isFilled, riskScore, setVal } from '../gapEngine.js';
import { parseDate, parseField, toISO, ValidationError } from '../lib.js';
import { derived } from './derived.js';
import { audit, canSeeBrand, effectiveBrands, getRecord, loadRules, nextId, saveRecord, visibleBrands } from '../repo.js';
import { HttpError, toGapDto, buildContext } from './gaps.js';
import { qualify } from '../qualify.js';

/** The record's fields grouped by the stage that asks for them, each with its level for this brand. */
function fieldGroups(rec, rulesIdx) {
  const stages = stagesOf(rec.recordType);
  const upto = CLOSED_STAGES[rec.recordType].includes(rec.stage) && rec.stage !== 'Lost' ? stages.length - 1 : stages.indexOf(rec.stage);
  const seen = new Set(), groups = [];
  const entry = (key, level) => {
    const def = FIELDS[key], value = getVal(rec, key) ?? rec[key] ?? null;
    return { key, label: def.label, type: def.type, options: def.options ?? null, unit: def.unit ?? null, placeholder: def.ph ?? '', level, value, filled: isFilled(key, value), system: !!def.system };
  };
  for (let i = 0; i <= upto; i++) {
    const fields = [];
    for (const rule of rulesIdx.get(`${rec.brand}|${rec.recordType}|${stages[i]}`) || []) {
      const def = FIELDS[rule.field];
      if (!def || seen.has(rule.field) || (def.appliesWhen && !def.appliesWhen(rec))) continue;
      seen.add(rule.field); fields.push(entry(rule.field, rule.level));
    }
    if (fields.length) groups.push({ stage: stages[i], fields });
  }
  const sys = Object.values(FIELDS).filter((f) => f.system && f.records.includes(rec.recordType)).map((f) => entry(f.key, 'system'));
  if (sys.length) groups.push({ stage: 'Stitch fills these in', fields: sys });
  return groups;
}

export function getRecordWithGaps(db, scope, id, now) {
  const rec = getRecord(db, scope, id);
  if (!rec) throw new HttpError(404, 'Record not found');
  const ctx = buildContext(db, scope, { now });
  const it = ctx.items.find((i) => i.rec.id === id);
  return { record: rec, score: it.score, fieldGroups: fieldGroups(rec, ctx.rules), gaps: it.gaps.map((g) => toGapDto(it, g, ctx.users, now)),
    activity: db.prepare('SELECT * FROM audit_log WHERE tenant_id = ? AND record_id = ? ORDER BY id DESC LIMIT 50').all(scope.tenantId, id),
    whatsapp: db.prepare('SELECT * FROM whatsapp_log WHERE tenant_id = ? AND record_id = ? ORDER BY id DESC LIMIT 50').all(scope.tenantId, id),
    qualification: rec.recordType === 'lead' ? qualify(rec) : null,
    escalations: rec.recordType === 'order'
      ? db.prepare(`SELECT e.id, e.reason, e.details, e.sla_hours, e.raised_at, e.resolved_at, e.resolution, u.name AS raised_by FROM escalations e
          LEFT JOIN users u ON u.id = e.raised_by WHERE e.tenant_id = ? AND e.order_id = ? ORDER BY e.id DESC`).all(scope.tenantId, id) : [] };
}

// Kanban feed: records grouped by stage with gap counts + risk (red edge when any gap is blocking)
export function kanban(db, scope, type, { brand, now }) {
  const ctx = buildContext(db, scope, { brand, now });
  const stages = stagesOf(type);
  const cards = ctx.items.filter((i) => i.rec.recordType === type).map((i) => ({
    id: i.rec.id, customer: i.rec.customer_name, brand: i.rec.brand, stage: i.rec.stage, owner: ctx.users.get(i.rec.owner_id)?.initials,
    eventDate: i.rec.event_date, value: i.rec.order_value, score: i.score, gapCount: i.gaps.length, blocked: i.gaps.some((g) => g.level === 'blocking'),
    product: i.rec.fields.product ?? null, phone: i.rec.fields.phone ?? null, lastContacted: i.rec.fields.last_contacted ?? null,
    qualification: type === 'lead' ? qualify(i.rec) : null,
  }));
  return stages.map((s) => ({ stage: s, cards: cards.filter((c) => c.stage === s).sort((a, b) => b.score - a.score) }));
}

export function patchRecord(db, scope, id, changes, now) {
  const rec = getRecord(db, scope, id);
  if (!rec) throw new HttpError(404, 'Record not found');
  db.transaction(() => {
    const done = {};
    for (const [field, raw] of Object.entries(changes)) {
      if (FIELDS[field]?.system) throw new ValidationError(`${FIELDS[field].label} is filled in by Stitch and cannot be edited`);
      if (['id', 'stage', 'recordType', 'tenant_id', 'linked_lead_id', 'converted_order_id'].includes(field)) throw new ValidationError(`${field} cannot be edited here`);
      if (field === 'owner_id' && !db.prepare('SELECT 1 FROM users WHERE id = ? AND tenant_id = ? AND active = 1').get(raw, scope.tenantId)) throw new ValidationError('Unknown owner');
      if (field === 'brand' && !visibleBrands(db, scope).some((b) => b.code === raw)) throw new HttpError(403, 'Your team cannot use this brand');
      const def = FIELDS[field];
      const value = def && raw !== '' && raw !== null ? parseField(def, raw, now) : raw;
      const old = rec.fields[field] ?? rec[field] ?? null;
      setVal(rec, field, value);
      done[field] = value;
      audit(db, { scope, rec, field, oldValue: { [field]: old }, newValue: { [field]: value }, action: 'edit' });
    }
    for (const [f, v] of Object.entries(derived(rec, done))) setVal(rec, f, v);   // quote number, order value, advance %
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
    event_date: event_date ? parseDate(event_date, now) : null, order_value: order_value ? Number(order_value) || null : null, converted_order_id: null,
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
  audit(db, { scope, rec: order, field: 'stage', oldValue: {}, newValue: { stage: 'Created', fromLead: lead.id }, action: 'create' });
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
  const old = rec.stage; rec.stage = to;
  if (rec.recordType === 'order' && to === 'Measurements') rec.fields.locked_by_date = `${scope.user.name} · ${toISO(now || new Date())}`;   // spec is locked now
  saveRecord(db, rec);
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
