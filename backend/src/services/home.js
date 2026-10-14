import { FIELDS, LEAD_STAGES, ORDER_STAGES } from '../catalogue.js';
import { daysTo, fmtDay, fmtWeekday, fromISO } from '../lib.js';
import { HOT_RISK } from '../gapEngine.js';
import { effectiveBrands } from '../repo.js';
import { buildContext, toGapDto } from './gaps.js';

function describeEvent({ rec, gaps }, now) {
  const f = rec.fields;
  if (rec.recordType === 'lead') return { what: `Still a lead · ${gaps.length} field${gaps.length === 1 ? '' : 's'} missing`, status: 'Not ordered', cls: 'red' };
  const late = (d) => d && rec.event_date && fromISO(d) > fromISO(rec.event_date);
  if (rec.stage === 'Dispatched') {
    if (f.tracking_shared !== 'Yes') return { what: 'Dispatched · tracking not shared yet', status: 'Needs info', cls: 'amb' };
    if (late(f.arrival_date)) return { what: `Dispatched · ${f.courier}, arriving ${fmtDay(f.arrival_date)}`, status: 'Arrives after event', cls: 'red' };
    return { what: `Dispatched · ${f.courier}, arriving ${fmtDay(f.arrival_date)}`, status: 'On track', cls: 'grn' };
  }
  if (rec.stage === 'Production') {
    return { what: `In production · ETA ${fmtDay(f.eta)}`, status: late(f.eta) ? 'ETA after event' : 'On track', cls: late(f.eta) ? 'red' : 'grn' };
  }
  return gaps.length ? { what: rec.stage, status: 'Needs info', cls: 'amb' } : { what: rec.stage, status: 'On track', cls: 'grn' };
}

function slaState(e, now) {
  const due = new Date(new Date(e.raised_at).getTime() + e.sla_hours * 3600000);
  const left = (due - now) / 3600000;
  if (left <= 0) return { sla: 'Past SLA', cls: 'red', past: true };
  return { sla: left < 24 ? `${Math.ceil(left)}h left` : `${Math.ceil(left / 24)}d left`, cls: 'amb', past: false };
}
const ago = (iso, now) => { const h = Math.max(0, Math.round((now - new Date(iso)) / 3600000)); return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };

export function buildHome(db, scope, { brand, now = new Date() }) {
  const userId = scope.user.id;
  const brands = effectiveBrands(scope, brand);
  const ctx = buildContext(db, scope, { brand, now });
  const { items, users } = ctx;
  const gapDtos = items.flatMap((it) => it.gaps.map((g) => toGapDto(it, g, users, now)));
  const mine = gapDtos.filter((g) => g.ownerId === userId);

  // KPIs (doc 5.1)
  const orderItems = items.filter((i) => i.rec.recordType === 'order');
  const blockedOrders = orderItems.filter((i) => i.gaps.some((g) => g.level === 'blocking' && FIELDS[g.field].locksDispatch)).length;
  const weekItems = items.filter((i) => { const d = daysTo(i.rec.event_date, now); return d !== null && d >= 0 && d <= 7 && !['Won', 'Lost', 'Delivered'].includes(i.rec.stage); })
    .sort((a, b) => a.rec.event_date.localeCompare(b.rec.event_date));
  const events = weekItems.map((i) => ({
    d: fmtDay(i.rec.event_date), w: fmtWeekday(i.rec.event_date), name: i.rec.customer_name, brand: i.rec.brand, ...describeEvent(i, now),
  }));
  const esc = db.prepare(`SELECT e.*, o.customer_name, o.brand, u.name AS by_name FROM escalations e
    JOIN orders o ON o.tenant_id = e.tenant_id AND o.id = e.order_id LEFT JOIN users u ON u.id = e.raised_by
    WHERE e.tenant_id = ? AND e.resolved_at IS NULL ORDER BY e.raised_at DESC`).all(scope.tenantId)
    .filter((e) => !brands || brands.includes(e.brand));
  const escalations = esc.map((e) => {
    const s = slaState(e, now);
    const short = e.by_name ? e.by_name.split(' ')[0] + ' ' + e.by_name.split(' ')[1][0] : '—';
    return { name: e.customer_name, id: e.order_id, what: e.details, sla: s.sla, cls: s.cls, past: s.past,
      meta: `Raised by ${short} · ${ago(e.raised_at, now)}` + (s.past ? ' · Pod lead notified' : '') };
  });
  const outOfSync = orderItems.filter((i) => i.rec.out_of_sync).length;

  // Close these first: top records by risk that have at least one gap
  const risk = items.filter((i) => i.gaps.length).sort((a, b) => b.score - a.score || (a.rec.event_date || '9').localeCompare(b.rec.event_date || '9')).slice(0, 6)
    .map((i) => {
      const sorted = [...i.gaps].sort((a, b) => Number(b.level === 'blocking') - Number(a.level === 'blocking'));
      const chips = sorted.slice(0, 2).map((g) => ({ t: FIELDS[g.field].short || FIELDS[g.field].label, blocking: g.level === 'blocking' }));
      if (sorted.length > 2) chips.push({ t: `+${sorted.length - 2}`, blocking: false });
      const d = daysTo(i.rec.event_date, now);
      return { name: i.rec.customer_name, id: i.rec.id, recordType: i.rec.recordType, stage: i.rec.stage, brand: i.rec.brand, chips,
        eventDate: i.rec.event_date, days: d, value: i.rec.order_value, score: i.score, hot: i.score >= HOT_RISK, href: `/${i.rec.recordType}s/${i.rec.id}` };
    });

  // Pipelines: records and gaps per stage
  const pipe = (name, type, stages, href) => ({ name, href, stages: stages.map((s) => {
    const inStage = items.filter((i) => i.rec.recordType === type && i.rec.stage === s);
    return { n: s, c: inStage.length, g: inStage.reduce((n, i) => n + i.gaps.length, 0) };
  }) });

  return {
    kpis: {
      myGaps: mine.length, myGapsNear: mine.filter((g) => g.days !== null && g.days <= 30).length,
      blockedOrders, eventsWeek: events.length, eventsAtRisk: events.filter((e) => e.cls === 'red').length,
      escalations: escalations.length, escalationsPastSla: escalations.filter((e) => e.past).length, outOfSync,
    },
    risk, events, escalations,
    pipelines: [pipe('Leads', 'lead', LEAD_STAGES.slice(0, 5), '/leads'), pipe('Orders', 'order', ORDER_STAGES.slice(0, 7), '/orders')],
    summary: summaryOf(items, gapDtos),
  };
}

export const summaryOf = (items, gapDtos) => ({
  leads: items.filter((i) => i.rec.recordType === 'lead' && !['Won', 'Lost'].includes(i.rec.stage)).length,
  orders: items.filter((i) => i.rec.recordType === 'order' && i.rec.stage !== 'Delivered').length,
  openGaps: gapDtos.length,
});

export function buildSummary(db, scope, { brand, now = new Date() }) {
  const ctx = buildContext(db, scope, { brand, now });
  return summaryOf(ctx.items, ctx.items.flatMap((it) => it.gaps.map((g) => toGapDto(it, g, ctx.users, now))));
}