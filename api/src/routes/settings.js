// Field catalogue, templates and "Set Required" (spec §5.5, PLAN §14 Settings)
import { Router } from 'express';
import { GATE_FIELDS } from '../catalogue.js';
import { LEVELS, pipelineOf } from '../lib/constants.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { id, oneOf } from '../lib/validate.js';
import { AuditLog, BrandTemplate, FieldDef, RequiredRule } from '../models/index.js';
import { actorFor, requireBrand, requireRole } from '../services/scope.js';

export const settingsRouter = Router();

const defDto = (d) => ({
  key: d.key, label: d.label, scope: d.scope, record_types: d.record_types, type: d.type, options: d.options ?? null,
  done_values: d.done_values ?? null, unit: d.unit, min: d.min, max: d.max, hint: d.hint, computed: d.computed, applies_when: d.applies_when,
});

settingsRouter.get('/field-defs', async (req, res) => {
  res.json((await FieldDef.find({ tenant_id: req.scope.tenantId, active: true }).sort({ scope: 1, key: 1 }).lean()).map(defDto));
});

settingsRouter.get('/templates', async (req, res) => {
  const list = await BrandTemplate.find({ tenant_id: req.scope.tenantId }).sort({ key: 1 }).lean();
  res.json(list.map((t) => ({ key: t.key, name: t.name, category: t.category, field_count: t.field_keys.length })));
});

const ruleDto = (r) => ({ record_type: r.record_type, stage: r.stage, field: r.field, level: r.level, applies_when: r.applies_when, locked: r.locked });

settingsRouter.get('/brands/:id/rules', async (req, res) => {
  const brandId = id(req.params.id);
  requireBrand(req.scope, brandId);
  const rules = await RequiredRule.find({ tenant_id: req.scope.tenantId, brand_id: brandId }).lean();
  const order = (r) => pipelineOf(r.record_type).indexOf(r.stage);
  rules.sort((a, b) => a.record_type.localeCompare(b.record_type) || order(a) - order(b) || a.field.localeCompare(b.field));
  res.json(rules.map(ruleDto));
});

/**
 * body: { rules: [{ record_type, stage, field, level }] }   level null = hide the field for this brand.
 * Admins and pod leads; the six gate fields can only be lowered or hidden by an admin (spec §5.5). Every change is logged.
 */
settingsRouter.put('/brands/:id/rules', async (req, res) => {
  const brandId = id(req.params.id);
  requireBrand(req.scope, brandId);
  requireRole(req.scope, 'admin', 'pod_lead');
  const list = req.body?.rules;
  if (!Array.isArray(list) || !list.length) throw badRequest('rules must be a non-empty list');
  const defs = new Map((await FieldDef.find({ tenant_id: req.scope.tenantId }).lean()).map((d) => [d.key, d]));
  const actor = actorFor(req.scope, brandId);
  const results = [];
  for (const raw of list) {
    const record_type = oneOf(raw.record_type, 'record_type', ['lead', 'order'], { required: true });
    const stage = oneOf(raw.stage, 'stage', pipelineOf(record_type), { required: true });
    const def = defs.get(raw.field);
    if (!def || !def.record_types.includes(record_type)) throw badRequest(`Field "${raw.field}" does not exist for ${record_type}s`);
    const level = raw.level === null ? null : oneOf(raw.level, 'level', LEVELS, { required: true });
    const key = { tenant_id: req.scope.tenantId, brand_id: brandId, record_type, stage, field: def.key };
    const existing = await RequiredRule.findOne(key).lean();
    // a gate field is protected wherever it is defined, not just on its original rule
    const gate = GATE_FIELDS.includes(def.key) && (existing?.locked || (existing?.level === 'blocking'));
    if (gate && level !== 'blocking' && req.scope.user.role !== 'admin') throw forbidden(`Only an admin can lower ${def.label}: it is one of the six gate fields`);
    if (level === null) {
      if (existing) {
        await RequiredRule.deleteOne({ _id: existing._id });
        await AuditLog.create({ tenant_id: req.scope.tenantId, actor, action: 'rule.removed', target_type: 'brand', target_id: brandId, changes: [{ field: `${record_type}/${stage}/${def.key}`, old: existing.level, new: null }] });
      }
      results.push({ ...key, level: null });
      continue;
    }
    if (existing?.level === level) { results.push(ruleDto(existing)); continue; }
    const r = await RequiredRule.findOneAndUpdate(key, {
      $set: { level, updated_by: req.scope.user._id, locked: existing?.locked ?? (GATE_FIELDS.includes(def.key) && level === 'blocking') },
    }, { upsert: true, returnDocument: 'after' }).lean();
    await AuditLog.create({ tenant_id: req.scope.tenantId, actor, action: 'rule.changed', target_type: 'brand', target_id: brandId, changes: [{ field: `${record_type}/${stage}/${def.key}`, old: existing?.level ?? null, new: level }] });
    results.push(ruleDto(r));
  }
  res.json(results.map((r) => ({ record_type: r.record_type, stage: r.stage, field: r.field, level: r.level })));
});
