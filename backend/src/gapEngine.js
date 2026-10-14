// The gap engine. ONE calculation feeds Home, Gaps, cards and KPIs (doc 5.1).
//   gap = (rule: Brand+Record+Stage+Field -> Needed|Blocking) AND (field empty)
// A record shows gaps for its current stage and every earlier stage, never later ones (doc A2).
import { COLUMN_FIELDS, CLOSED_STAGES, FIELDS, stagesOf } from './catalogue.js';
import { daysTo, fromISO, todayStart } from './lib.js';

// Score at/above which the red risk dot is drawn at full strength (tune with the team, doc A7)
export const HOT_RISK = 45;

export const getVal = (rec, field) => (COLUMN_FIELDS.has(field) ? rec[field] : rec.fields[field]);

export function setVal(rec, field, value) {
  if (COLUMN_FIELDS.has(field)) rec[field] = value;
  else rec.fields[field] = value;
}

export function isFilled(field, v) {
  const def = FIELDS[field];
  const type = def?.type;
  if (def?.doneValues) return def.doneValues.includes(v);
  if (type === 'bool') return v === 'Yes';
  if (type === 'paid') return v === 'Paid';
  return v !== null && v !== undefined && String(v).trim() !== '';
}

// rules table -> Map('NA|lead|Quoted' -> [{field, level}])
export function indexRules(rows) {
  const idx = new Map();
  for (const r of rows) {
    const k = `${r.brand}|${r.record_type}|${r.stage}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push({ field: r.field, level: r.level });
  }
  return idx;
}

export function computeGaps(rec, rulesIdx) {
  if (CLOSED_STAGES[rec.recordType].includes(rec.stage)) return [];
  const stages = stagesOf(rec.recordType);
  const upto = stages.indexOf(rec.stage);
  const byField = new Map();
  for (let i = 0; i <= upto; i++) {
    for (const rule of rulesIdx.get(`${rec.brand}|${rec.recordType}|${stages[i]}`) || []) {
      if (rule.level === 'optional') continue;
      if (FIELDS[rule.field]?.appliesWhen && !FIELDS[rule.field].appliesWhen(rec)) continue;
      if (isFilled(rule.field, getVal(rec, rule.field))) continue;
      const prev = byField.get(rule.field);
      if (!prev || (rule.level === 'blocking' && prev.level !== 'blocking')) byField.set(rule.field, { field: rule.field, level: rule.level, ruleStage: stages[i] });
    }
  }
  return [...byField.values()];
}

// Risk score 0-100 (proposal in doc 5.4 - tune the constants with the team).
export function riskScore(rec, gaps, { escalationOpen = false, now } = {}) {
  const d = daysTo(rec.event_date, now);
  let urgency;
  if (d === null) urgency = 10;
  else if (d <= 0) urgency = 50;
  else if (d < 30) urgency = 20 + 30 * (1 - d / 30);
  else urgency = Math.max(0, 20 * (1 - (Math.min(d, 120) - 30) / 90));
  const blocking = gaps.filter((g) => g.level === 'blocking').length;
  const needed = gaps.length - blocking;
  let score = urgency + Math.min(30, blocking * 10) + Math.min(10, needed * 5);
  const lc = rec.fields.last_contacted;
  if (rec.recordType === 'lead' && lc && (todayStart(now) - fromISO(lc)) / 86400000 > 7) score += 5; // stalled
  if (escalationOpen) score += 5;
  return Math.min(100, Math.round(score));
}

/**
 * Which blocking gaps stop `rec` moving into stage `to`? (doc 5.3)
 * A blocking field gates the stage AFTER the stage it is captured at, unless the catalogue says otherwise
 * (Balance payment is captured at QC approval but only blocks Dispatched).
 */
export function blockersForMove(rec, gaps, to) {
  const stages = stagesOf(rec.recordType);
  return gaps.filter((g) => {
    if (g.level !== 'blocking') return false;
    const gate = FIELDS[g.field].blocksMoveTo ?? stages[stages.indexOf(g.ruleStage) + 1];
    return stages.indexOf(to) >= stages.indexOf(gate);
  });
}
export const nextStage = (rec) => stagesOf(rec.recordType)[stagesOf(rec.recordType).indexOf(rec.stage) + 1] ?? null;