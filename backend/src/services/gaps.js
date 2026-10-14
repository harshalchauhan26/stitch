import { FIELDS, SHOPIFY_MAPPED } from '../catalogue.js';
import { HOT_RISK, blockersForMove, computeGaps, getVal, indexRules, nextStage, riskScore, setVal } from '../gapEngine.js';
import { daysTo, inr, isoInDays, parseField, ValidationError } from '../lib.js';
import { derived } from './derived.js';
import { audit, getRecord, listRecords, loadRules, saveRecord } from '../repo.js';
import { sendWhatsApp } from './whatsapp.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

export const parseKey = (key) => { const i = key.lastIndexOf('-'); return { id: key.slice(0, i), field: key.slice(i + 1) }; };

/** Loads everything once per request: records + their gaps + risk score. */
export function buildContext(db, scope, { brand, now } = {}) {
  const rules = indexRules(loadRules(db, scope.tenantId));
  const openEsc = new Set(db.prepare('SELECT order_id FROM escalations WHERE tenant_id = ? AND resolved_at IS NULL').all(scope.tenantId).map((r) => r.order_id));
  const users = new Map(db.prepare('SELECT * FROM users WHERE tenant_id = ?').all(scope.tenantId).map((u) => [u.id, u]));
  const items = listRecords(db, scope, { brand }).map((rec) => {
    const gaps = computeGaps(rec, rules);
    return { rec, gaps, score: riskScore(rec, gaps, { escalationOpen: openEsc.has(rec.id), now }) };
  });
  return { rules, openEsc, users, items };
}

function hintFor(f, rec) {
  // {balanceDue} is the only dynamic token; the Event column already carries the days-to-event.
  return f.hint.replace('{balanceDue}', inr(Math.max(0, (rec.order_value || 0) - Number(rec.fields.advance_amount || 0))));
}

export function toGapDto({ rec, score }, g, users, now) {
  const f = FIELDS[g.field];
  const days = daysTo(rec.event_date, now);
  return {
    key: `${rec.id}-${g.field}`, recordType: rec.recordType, recordId: rec.id, rec: rec.customer_name, brand: rec.brand,
    field: g.field, fieldLabel: f.label, stage: rec.stage, hint: hintFor(f, rec),
    eventDate: rec.event_date, days, owner: users.get(rec.owner_id)?.initials ?? '—', ownerId: rec.owner_id,
    blocking: g.level === 'blocking', score, hot: score >= HOT_RISK, fix: f.fix, placeholder: f.ph || '', type: f.type, options: f.options ?? null,
    actions: (f.actions || []).map((a) => ({ id: a.id, label: a.label, resolves: !!a.resolves })),
  };
}

export function listGaps(db, scope, q = {}, now) {
  const userId = scope.user.id;
  const brand = q.brand && q.brand !== 'ALL' ? String(q.brand).split(',') : undefined;
  const ctx = buildContext(db, scope, { brand, now });
  const within = q.eventWithin ? Number(q.eventWithin) : null;
  const dtos = [];
  for (const it of ctx.items) for (const g of it.gaps) dtos.push(toGapDto(it, g, ctx.users, now));
  const out = dtos.filter((g) => {
    if (q.owner === 'me' && g.ownerId !== userId) return false;
    if (q.owner && q.owner !== 'me' && q.owner !== 'anyone' && g.ownerId !== q.owner) return false;
    if (within && !(g.days !== null && g.days <= within)) return false;
    return true;
  });
  out.sort((a, b) => b.score - a.score || Number(b.blocking) - Number(a.blocking) || (a.days ?? 9999) - (b.days ?? 9999));
  const cleared = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE tenant_id = ? AND action='gap_fix' AND undone=0
    AND date(ts,'localtime') = date('now','localtime')`).get(scope.tenantId).n;
  return { gaps: out, cleared };
}

// ---- writes -------------------------------------------------------------------------
const applyChanges = (db, scope, rec, changes, action) => db.transaction(() => {
  Object.assign(changes, derived(rec, changes));
  const oldV = {};
  for (const [f, v] of Object.entries(changes)) {
    oldV[f] = getVal(rec, f) ?? null;
    setVal(rec, f, v);
    if (rec.recordType === 'order' && SHOPIFY_MAPPED.has(f)) rec.out_of_sync = 1;
  }
  saveRecord(db, rec);
  return audit(db, { scope, rec, field: Object.keys(changes)[0], oldValue: oldV, newValue: changes, action });
})();

function loadGapTarget(db, scope, key) {
  const { id, field } = parseKey(key);
  const rec = getRecord(db, scope, id);           // 404 for other tenants' records and for brands outside the caller's team
  const f = FIELDS[field];
  if (!rec || !f) throw new HttpError(404, 'Gap not found');
  const rules = indexRules(loadRules(db, scope.tenantId));
  const gap = computeGaps(rec, rules).find((g) => g.field === field);
  return { rec, f, field, gap, rules };
}

function afterWrite(db, scope, rec, f, gapWasBlocking, auditId, message) {
  const rules = indexRules(loadRules(db, scope.tenantId));
  const left = computeGaps(rec, rules);
  const nxt = nextStage(rec);
  const stageUnblocked = nxt ? blockersForMove(rec, left, nxt).length === 0 : true;
  return {
    ok: true, auditId, remaining: left.length, stageUnblocked,
    message: message ?? `${f.label} fixed for ${rec.customer_name}` + (gapWasBlocking && stageUnblocked ? `. ${rec.stage} is unblocked.` : ''),
  };
}

export function fixGap(db, scope, key, { value, action }, now) {
  const { rec, f, field, gap } = loadGapTarget(db, scope, key);
  if (!gap) throw new HttpError(409, `${f.label} is already filled for ${rec.customer_name}`);
  const blocking = gap.level === 'blocking';

  if (f.fix === 'text') {
    const parsed = parseField(f, value, now);
    const changes = f.textSetsValue ? { [f.storeTextAs]: parsed, [field]: f.textSetsValue } : { [field]: parsed };
    return afterWrite(db, scope, rec, f, blocking, applyChanges(db, scope, rec, changes, 'gap_fix'));
  }

  const act = f.actions.find((a) => a.id === (action || 'primary'));
  if (!act) throw new ValidationError('Unknown action');
  if (act.effect === 'info') return { ok: true, message: act.message };

  const changes = {};
  if (act.effect === 'send_and_set' || act.effect === 'whatsapp') {
    Object.assign(changes, sendWhatsApp(db, { rec, template: act.template, field, label: f.label, now }));
    if (act.template === 'payment_link') changes.link_expiry = isoInDays(3, now);
    if (act.template === 'balance_link') changes.balance_link = `https://pay.stitch.local/${rec.id}-bal`;
  }
  if (act.value !== undefined) changes[field] = act.value;

  const auditId = applyChanges(db, scope, rec, changes, act.resolves ? 'gap_fix' : 'edit');
  if (!act.resolves) return { ok: true, auditId, message: `${act.label} · done for ${rec.customer_name}`, remaining: undefined };
  return afterWrite(db, scope, rec, f, blocking, auditId);
}

export function askOnWhatsApp(db, scope, key, now) {
  const { rec, f, field } = loadGapTarget(db, scope, key);
  const changes = sendWhatsApp(db, { rec, template: 'ask_field', field, label: f.label, now });
  applyChanges(db, scope, rec, changes, 'edit');
  return { ok: true, message: `Asked ${rec.customer_name} for ${f.label.toLowerCase()} on WhatsApp` };
}

export function askAll(db, scope, keys, now) {
  let sent = 0; const skipped = [];
  for (const key of keys) {
    try { askOnWhatsApp(db, scope, key, now); sent++; } catch (e) { skipped.push({ key, reason: e.message }); }
  }
  return { ok: true, sent, skipped, message: `Asked ${sent} customer${sent === 1 ? '' : 's'} on WhatsApp` + (skipped.length ? ` (${skipped.length} skipped)` : '') };
}

export function undoAudit(db, scope, auditId) {
  const a = db.prepare('SELECT * FROM audit_log WHERE id = ? AND tenant_id = ?').get(auditId, scope.tenantId);
  if (!a) throw new HttpError(404, 'Nothing to undo');
  if (a.undone) throw new HttpError(409, 'Already undone');
  const rec = getRecord(db, scope, a.record_id);
  if (!rec) throw new HttpError(404, 'Nothing to undo');
  const oldV = JSON.parse(a.old_value), newV = JSON.parse(a.new_value);
  for (const f of Object.keys(newV)) {
    if (String(getVal(rec, f) ?? '') !== String(newV[f] ?? '')) throw new HttpError(409, 'Changed since, cannot undo');
  }
  db.transaction(() => {
    for (const f of Object.keys(oldV)) setVal(rec, f, oldV[f]);
    saveRecord(db, rec);
    db.prepare('UPDATE audit_log SET undone = 1 WHERE id = ?').run(auditId);
  })();
  return { ok: true };
}