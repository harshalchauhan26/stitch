// Field definitions + a brand's pipeline and required rules, loaded once per request (PLAN §5.13).
import { ORDER_STAGES } from '../lib/constants.js';
import { Brand, FieldDef, RequiredRule } from '../models/index.js';
import { pipelineOf } from './pipeline.js';

/**
 * -> { brand, pipeline, stages: { lead: [...open, won], order: [...] }, defs: Map(key -> def),
 *      rules: { lead: [...], order: [...] }, visible: { lead: Set, order: Set } }
 * defs = the shared catalogue plus this brand's own custom fields (never another brand's).
 */
export async function loadBrandRules(tenantId, brandId) {
  const [brand, defs, rules] = await Promise.all([
    Brand.findOne({ _id: brandId, tenant_id: tenantId }).lean(),
    FieldDef.find({ tenant_id: tenantId, active: true, brand_id: { $in: [null, brandId] } }).lean(),
    RequiredRule.find({ tenant_id: tenantId, brand_id: brandId }).lean(),
  ]);
  const pipeline = pipelineOf(brand);
  const byType = { lead: [], order: [] };
  for (const r of rules) byType[r.record_type]?.push(r);
  return {
    brand,
    pipeline,
    stages: { lead: pipeline.flow, order: ORDER_STAGES },
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
