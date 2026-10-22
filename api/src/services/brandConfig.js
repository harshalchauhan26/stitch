// Per-brand setup done by the agency at onboarding: the lead pipeline and the brand's own custom fields.
import { withTransaction } from '../db.js';
import { ORDER_STAGES } from '../lib/constants.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { bool, int, oneOf, str } from '../lib/validate.js';
import { AuditLog, Brand, FieldDef, Lead, RequiredRule } from '../models/index.js';
import { pipelineOf, validatePipeline } from './pipeline.js';
import { actorFor } from './scope.js';

const LEVEL_RANK = { optional: 0, needed: 1, blocking: 2 };
export const CUSTOM_TYPES = ['text', 'longtext', 'number', 'currency', 'date', 'select', 'bool', 'url'];
export const CUSTOM_LEVELS = ['optional', 'needed', 'blocking'];

async function brandOr404(scope, brandId, session) {
  const b = await Brand.findOne({ _id: brandId, tenant_id: scope.tenantId }).session(session ?? null);
  if (!b || !scope.canSeeBrand(b._id)) throw notFound('Brand');
  return b;
}

/**
 * Replaces the brand's lead pipeline. body.stages: [{ name, type: open|won|lost, from?: old name when renaming }]
 * - a renamed stage keeps its leads and rules; the won and lost stages always map to the new won and lost stages
 * - a removed stage must be empty (move its leads first); its rules move to the nearest stage that is kept
 */
export async function updatePipeline(scope, brandId, input) {
  const wanted = validatePipeline(input);
  return withTransaction(async (session) => {
    const brand = await brandOr404(scope, brandId, session);
    const old = pipelineOf(brand);
    const rename = new Map([[old.won, wanted.find((s) => s.type === 'won').name], [old.lost, wanted.find((s) => s.type === 'lost').name]]);
    for (const s of wanted.filter((x) => x.type === 'open')) {
      const src = s.from ? old.open.find((o) => o === s.from) : old.open.find((o) => o.toLowerCase() === s.name.toLowerCase());
      if (s.from && !src) throw badRequest(`"${s.from}" is not an open stage of ${brand.name}`);
      if (src) {
        if (rename.has(src)) throw badRequest(`Two stages both come from "${src}"`);
        rename.set(src, s.name);
      }
    }
    const removed = old.open.filter((o) => !rename.has(o));
    if (removed.length) {
      const busy = await Lead.aggregate([{ $match: { tenant_id: brand.tenant_id, brand_id: brand._id, stage_type: 'open', stage: { $in: removed } } }, { $group: { _id: '$stage', n: { $sum: 1 } } }]).session(session);
      if (busy.length) throw conflict(`Move these leads before removing their stage: ${busy.map((b) => `${b.n} in ${b._id}`).join(', ')}`, { code: 'stage_not_empty', stages: busy.map((b) => ({ stage: b._id, leads: b.n })) });
    }
    // rules of a removed stage go to the nearest kept stage before it (or after it, or the first stage)
    const target = (stage) => {
      if (rename.has(stage)) return rename.get(stage);
      const i = old.open.indexOf(stage);
      const kept = [...old.open.slice(0, i).reverse(), ...old.open.slice(i + 1)].find((o) => rename.has(o));
      return kept ? rename.get(kept) : wanted.find((s) => s.type === 'open').name;
    };
    // rules: work out every rule's new stage from its OLD stage in one pass, then rewrite them together, so renames that
    // chain or swap (A->B, B->A) cannot be applied twice; two rules landing on the same stage+field keep the stronger level
    const oldRules = await RequiredRule.find({ brand_id: brand._id, record_type: 'lead' }).session(session).lean();
    const moved = new Map();
    for (const r of oldRules) {
      const k = `${target(r.stage)}|${r.field}`;
      const prev = moved.get(k);
      if (!prev || LEVEL_RANK[r.level] > LEVEL_RANK[prev.level]) moved.set(k, { ...r, stage: target(r.stage), locked: r.locked || !!prev?.locked });
      else if (r.locked) prev.locked = true;
    }
    if (oldRules.some((r) => target(r.stage) !== r.stage)) {
      await RequiredRule.deleteMany({ brand_id: brand._id, record_type: 'lead' }, { session });
      await RequiredRule.insertMany([...moved.values()].map(({ _id, ...r }) => r), { session });
    }
    // leads: via temporary names first, for the same reason
    const renames = [...rename].filter(([from, to]) => from !== to);
    const stamp = Date.now();
    const tmp = (i) => `__renaming_${stamp}_${i}`;
    for (const [i, [from]] of renames.entries()) {
      await Lead.updateMany({ brand_id: brand._id, stage: from }, { $set: { stage: tmp(i) } }, { session });
      await Lead.updateMany({ brand_id: brand._id, stage_before_lost: from }, { $set: { stage_before_lost: tmp(i) } }, { session });
    }
    for (const [i, [, to]] of renames.entries()) {
      await Lead.updateMany({ brand_id: brand._id, stage: tmp(i) }, { $set: { stage: to } }, { session });
      await Lead.updateMany({ brand_id: brand._id, stage_before_lost: tmp(i) }, { $set: { stage_before_lost: to } }, { session });
    }
    const before = old.stages;
    brand.lead_pipeline = pipelineOf({ lead_pipeline: wanted }).stages;
    await brand.save({ session });
    await AuditLog.create([{ tenant_id: scope.tenantId, actor: actorFor(scope, brand._id), action: 'pipeline.changed', target_type: 'brand', target_id: brand._id, data: { before, after: brand.lead_pipeline } }], { session });
    return pipelineOf(brand).stages;
  });
}

const slug = (label) => {
  const s = String(label).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(s) ? s : `f_${s}`;
};

/** Every lead field this brand uses, with its stage and level, plus catalogue fields it does not use yet (for Settings) */
export async function brandFields(scope, brandId) {
  const brand = await brandOr404(scope, brandId);
  const [defs, rules] = await Promise.all([
    FieldDef.find({ tenant_id: scope.tenantId, brand_id: { $in: [null, brand._id] }, record_types: 'lead' }).lean(),
    RequiredRule.find({ brand_id: brand._id, record_type: 'lead' }).lean(),
  ]);
  const p = pipelineOf(brand);
  const ruleOf = new Map(rules.map((r) => [r.field, r]));
  const dto = (d) => ({
    key: d.key, label: d.label, scope: d.scope, type: d.type, options: d.options ?? null, unit: d.unit, hint: d.hint, computed: d.computed,
    custom: !!d.brand_id, active: d.active, stage: ruleOf.get(d.key)?.stage ?? null, level: ruleOf.get(d.key)?.level ?? null, locked: !!ruleOf.get(d.key)?.locked,
  });
  const used = defs.filter((d) => ruleOf.has(d.key) || d.brand_id).map(dto).sort((a, b) => p.open.indexOf(a.stage) - p.open.indexOf(b.stage) || a.label.localeCompare(b.label));
  return {
    pipeline: p.stages,
    fields: used,
    available: defs.filter((d) => !d.brand_id && !ruleOf.has(d.key) && d.active).map(dto).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function fieldShape(body, existing) {
  const out = {};
  if (!existing || body.label !== undefined) out.label = str(body.label, 'Label', { required: true, max: 60 });
  if (!existing) {
    out.type = oneOf(body.type, 'Type', CUSTOM_TYPES, { required: true });
    out.scope = oneOf(body.scope, 'Applies to', ['lead', 'item']) ?? 'lead';
  }
  const type = existing?.type ?? out.type;
  if (body.options !== undefined || (!existing && type === 'select')) {
    const opts = (Array.isArray(body.options) ? body.options : []).map((o) => str(o, 'Option', { max: 60 })).filter(Boolean);
    if (type === 'select' && !opts.length) throw badRequest('A dropdown needs at least one option');
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) throw badRequest('Options must be different from each other');
    if (opts.length > 50) throw badRequest('At most 50 options');
    out.options = type === 'select' ? opts : undefined;
  }
  if (type === 'bool') out.options = undefined;
  if (body.hint !== undefined) out.hint = str(body.hint, 'Hint', { max: 200 }) ?? '';
  if (body.unit !== undefined) out.unit = str(body.unit, 'Unit', { max: 10 });
  if (body.min !== undefined) out.min = body.min === null ? null : Number(int(body.min, 'min'));
  if (body.max !== undefined) out.max = body.max === null ? null : Number(int(body.max, 'max'));
  return out;
}

/** body: { label, type, scope: lead|item, options?, unit?, min?, max?, hint?, stage?, level?: optional|needed|blocking } */
export async function createCustomField(scope, brandId, body = {}) {
  const shape = fieldShape(body);
  const level = oneOf(body.level, 'Level', CUSTOM_LEVELS) ?? 'optional';
  return withTransaction(async (session) => {
    const brand = await brandOr404(scope, brandId, session);
    const p = pipelineOf(brand);
    const stage = body.stage ? oneOf(body.stage, 'Stage', p.open, { required: true }) : p.open[0];
    if (await FieldDef.exists({ tenant_id: scope.tenantId, brand_id: brand._id, label: new RegExp(`^${shape.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).session(session)) {
      throw conflict(`${brand.name} already has a field called "${shape.label}"`, { code: 'duplicate_field' });
    }
    let key = slug(shape.label);
    if (await FieldDef.exists({ tenant_id: scope.tenantId, key }).session(session)) key = `${key}_${brand.code.toLowerCase()}`;
    for (let n = 2; await FieldDef.exists({ tenant_id: scope.tenantId, key }).session(session); n++) key = `${slug(shape.label)}_${brand.code.toLowerCase()}_${n}`;
    const [def] = await FieldDef.create([{ tenant_id: scope.tenantId, brand_id: brand._id, key, record_types: ['lead'], ...shape }], { session });
    await RequiredRule.create([{ tenant_id: scope.tenantId, brand_id: brand._id, record_type: 'lead', stage, field: key, level, updated_by: scope.user._id }], { session });
    await AuditLog.create([{ tenant_id: scope.tenantId, actor: actorFor(scope, brand._id), action: 'field.created', target_type: 'brand', target_id: brand._id, data: { key, label: def.label, type: def.type, scope: def.scope, stage, level } }], { session });
    return { key, stage, level };
  });
}

/** Label / options / hint / active for the brand's own fields; stage and level for any field this brand uses. */
export async function updateBrandField(scope, brandId, key, body = {}) {
  return withTransaction(async (session) => {
    const brand = await brandOr404(scope, brandId, session);
    const def = await FieldDef.findOne({ tenant_id: scope.tenantId, key, brand_id: { $in: [null, brand._id] } }).session(session);
    if (!def) throw notFound('Field');
    const custom = String(def.brand_id) === String(brand._id);
    const wantsShape = ['label', 'options', 'hint', 'unit', 'min', 'max', 'active'].some((k) => body[k] !== undefined);
    if (wantsShape && !custom) throw badRequest('Only the stage and level of a shared field can be changed for one brand');
    if (wantsShape) {
      Object.assign(def, fieldShape(body, def));
      if (body.active !== undefined) def.active = bool(body.active, 'active');
      await def.save({ session });
    }
    if (body.stage !== undefined || body.level !== undefined) {
      const p = pipelineOf(brand);
      const rule = await RequiredRule.findOne({ brand_id: brand._id, record_type: 'lead', field: key }).session(session);
      if (rule?.locked && body.level !== undefined && body.level !== 'blocking' && scope.user.role !== 'admin') throw badRequest('Only an admin can lower a gate field');
      const level = body.level === null ? null : oneOf(body.level, 'Level', custom ? CUSTOM_LEVELS : ['optional', 'needed', 'blocking']) ?? rule?.level ?? 'optional';
      const stage = body.stage !== undefined ? oneOf(body.stage, 'Stage', p.open, { required: true }) : rule?.stage ?? p.open[0];
      if (level === null) { if (rule) await rule.deleteOne({ session }); }          // hide the field for this brand
      else if (rule) { rule.stage = stage; rule.level = level; rule.updated_by = scope.user._id; await rule.save({ session }); }
      else await RequiredRule.create([{ tenant_id: scope.tenantId, brand_id: brand._id, record_type: 'lead', stage, field: key, level, updated_by: scope.user._id }], { session });
    }
    await AuditLog.create([{ tenant_id: scope.tenantId, actor: actorFor(scope, brand._id), action: 'field.updated', target_type: 'brand', target_id: brand._id, data: { key, ...body } }], { session });
    return { key };
  });
}

export const stagesFor = (brand, recordType) => (recordType === 'lead' ? pipelineOf(brand).open : ORDER_STAGES);
