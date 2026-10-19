// The gap engine (spec §5.1, PLAN §9). One calculation feeds every screen.
//   gap = a rule (brand + record + stage + field -> needed | blocking) whose field is empty
// A record shows gaps for its current stage and every earlier stage, never later ones (spec A2).
import { conditionHolds, isFilled, valueOf } from '../lib/fields.js';

const itemLabel = (item, n) => `Item ${n} · ${item.product}`;

/**
 * rec: { recordType, stage, lead?, order?, client }  rb: loadBrandRules() result
 * uptoIndex: last pipeline stage to include (defaults to the record's current stage)
 */
export function computeGaps(rec, rb, uptoIndex) {
  const stages = rb.stages[rec.recordType];
  const record = rec.recordType === 'lead' ? rec.lead : rec.order;
  // closed records have no gaps: a Won or Lost lead, a Delivered order (spec: Delivered blocks nothing)
  if (uptoIndex === undefined && (rec.recordType === 'lead' ? record.stage_type && record.stage_type !== 'open' : record.stage === 'Delivered')) return [];
  const upto = uptoIndex ?? stages.indexOf(rec.stage);
  if (upto < 0) return [];
  const items = (record.items || []).filter((i) => !i.removed_at);
  const base = { client: rec.client, lead: rec.lead, order: rec.order };
  const byKey = new Map();
  const add = (gap) => {
    const k = `${gap.field}|${gap.item_id ?? ''}`;
    const prev = byKey.get(k);
    if (!prev || (gap.level === 'blocking' && prev.level !== 'blocking')) byKey.set(k, gap);
  };

  for (let i = 0; i <= upto; i++) {
    for (const rule of rb.rules[rec.recordType].filter((r) => r.stage === stages[i])) {
      if (rule.level === 'optional') continue;
      const def = rb.defs.get(rule.field);
      if (!def) continue;
      const cond = rule.applies_when ?? def.applies_when;
      const gap = { field: def.key, label: def.label, level: rule.level, stage: stages[i], scope: def.scope, item_id: null, item_label: null, hint: def.hint || '' };
      if (def.scope === 'item' && rec.recordType === 'lead') {
        if (!items.length) {                                  // one "add a product" gap instead of one per item field
          if (def.key === 'product') add({ ...gap, hint: 'Add at least one product to this lead' });
          continue;
        }
        items.forEach((item, n) => {
          const ctx = { ...base, item };
          if (!conditionHolds(cond, rb.defs, ctx)) return;
          if (!isFilled(def, valueOf(def, ctx))) add({ ...gap, item_id: item._id, item_label: itemLabel(item, n + 1) });
        });
        continue;
      }
      if (!conditionHolds(cond, rb.defs, base)) continue;
      if (!isFilled(def, valueOf(def, base))) add(gap);
    }
  }
  return [...byKey.values()];
}

/**
 * Which Blocking gaps stop this record moving to `to`? (spec §4.1)
 * A blocking field gates the stage after the one it is captured at, unless its def says otherwise
 * (Balance payment is captured at QC approval but only blocks Dispatched).
 * Only gates this move crosses count: a gate the record already passed (met, or overridden by a pod lead)
 * does not block every later move again. Its gap still shows on the record.
 */
export function blockersForMove(rec, rb, to) {
  const stages = rb.stages[rec.recordType];
  const current = stages.indexOf(rec.stage), target = stages.indexOf(to);
  return computeGaps(rec, rb, target - 1).filter((g) => {
    if (g.level !== 'blocking') return false;
    const gate = stages.indexOf(rb.defs.get(g.field)?.blocks_move_to ?? stages[stages.indexOf(g.stage) + 1]);
    return gate > current && gate <= target;
  });
}

export const gapCounts = (gaps) => ({ open_gap_count: gaps.length, blocking_gap_count: gaps.filter((g) => g.level === 'blocking').length });
