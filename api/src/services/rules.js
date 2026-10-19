// Field definitions + a brand's required rules, loaded once per request (PLAN §5.13).
import { FieldDef, RequiredRule } from '../models/index.js';

/** -> { defs: Map(key -> def), rules: { lead: [...], order: [...] }, visible: { lead: Set, order: Set } } */
export async function loadBrandRules(tenantId, brandId) {
  const [defs, rules] = await Promise.all([
    FieldDef.find({ tenant_id: tenantId, active: true }).lean(),
    RequiredRule.find({ tenant_id: tenantId, brand_id: brandId }).lean(),
  ]);
  const byType = { lead: [], order: [] };
  for (const r of rules) byType[r.record_type]?.push(r);
  return {
    defs: new Map(defs.map((d) => [d.key, d])),
    rules: byType,
    // a field with no rule for this brand is hidden (spec §6): it cannot be set and never becomes a gap
    visible: { lead: new Set(byType.lead.map((r) => r.field)), order: new Set(byType.order.map((r) => r.field)) },
  };
}

/** Memoised per request, keyed by brand */
export function rulesCache(tenantId) {
  const cache = new Map();
  return (brandId) => {
    const k = String(brandId);
    if (!cache.has(k)) cache.set(k, loadBrandRules(tenantId, brandId));
    return cache.get(k);
  };
}
