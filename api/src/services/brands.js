// Brand onboarding with duplicate checks (PLAN §4.2)
import { GATE_FIELDS } from '../catalogue.js';
import { withTransaction } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { brandNameKey, editDistance, instagramKey, requirePhone, websiteKey } from '../lib/normalise.js';
import { str, oneOf, ids, bool, int } from '../lib/validate.js';
import { Brand, BrandTemplate, RequiredRule, Team, User, WhatsappAccount } from '../models/index.js';

const SIMILAR_DISTANCE = 2;

async function describe(brand) {
  const [by, teams] = await Promise.all([
    brand.onboarded_by ? User.findById(brand.onboarded_by).select('name').lean() : null,
    Team.find({ tenant_id: brand.tenant_id, brand_ids: brand._id }).select('name').lean(),
  ]);
  return {
    id: brand._id, code: brand.code, name: brand.name, status: brand.status,
    onboarded_by: by?.name ?? null, onboarded_at: brand.created_at, teams: teams.map((t) => t.name),
  };
}

function conflictMessage(kind, b, value) {
  const handled = b.teams.length ? `, handled by ${b.teams.join(', ')}` : '';
  const when = b.onboarded_at ? ` on ${new Date(b.onboarded_at).toISOString().slice(0, 10)}` : '';
  const by = b.onboarded_by ? ` (added by ${b.onboarded_by}${when}${handled})` : '';
  const archived = b.status === 'archived' ? ' It is archived: restore it instead of adding it again.' : '';
  switch (kind) {
    case 'name': return `${b.name} is already onboarded${by}.${archived}`;
    case 'code': return `Code ${value} is already used by ${b.name}.${archived}`;
    case 'instagram': return `This Instagram handle belongs to ${b.name}.${archived}`;
    case 'website': return `This website belongs to ${b.name}.${archived}`;
    default: return `${value} is already connected to ${b.name}.${archived}`;
  }
}

/**
 * Every duplicate this brand would create, plus brands with a similar name.
 * input: { name, code, instagram, website, phones[] }, excludeId: the brand being edited
 */
export async function checkBrand(tenantId, input, excludeId = null) {
  const not = excludeId ? { _id: { $ne: excludeId } } : {};
  const keys = { name: brandNameKey(input.name), code: input.code ? String(input.code).trim().toUpperCase() : null, instagram: instagramKey(input.instagram), website: websiteKey(input.website) };
  const conflicts = [];
  const probe = async (kind, filter, value) => {
    const b = await Brand.findOne({ tenant_id: tenantId, ...not, ...filter }).lean();
    if (b) { const d = await describe(b); conflicts.push({ field: kind, message: conflictMessage(kind, d, value), brand: d }); }
  };
  if (keys.name) await probe('name', { name_key: keys.name }, input.name);
  if (keys.code) await probe('code', { code: keys.code }, keys.code);
  if (keys.instagram) await probe('instagram', { instagram_key: keys.instagram }, input.instagram);
  if (keys.website) await probe('website', { website_key: keys.website }, input.website);
  for (const p of input.phones || []) {
    const e164 = requirePhone(p, 'WhatsApp number').e164;
    const acc = await WhatsappAccount.findOne({ tenant_id: tenantId, phone_e164: e164 }).lean();
    if (acc && String(acc.brand_id) !== String(excludeId)) {
      const d = await describe(await Brand.findById(acc.brand_id).lean());
      conflicts.push({ field: 'whatsapp_number', message: conflictMessage('phone', d, e164), brand: d });
    }
  }
  const similar = [];
  if (keys.name && !conflicts.some((c) => c.field === 'name')) {
    const all = await Brand.find({ tenant_id: tenantId, ...not }).select('name name_key status').lean();
    for (const b of all) {
      if (editDistance(keys.name, b.name_key) <= SIMILAR_DISTANCE) similar.push({ id: b._id, name: b.name, status: b.status });
    }
  }
  return { conflicts, similar };
}

/** Copies the template's rules onto the brand. The six gate fields are locked (spec §5.5). */
async function copyTemplateRules(session, tenantId, brandId, template) {
  if (!template.rules.length) return;
  await RequiredRule.insertMany(template.rules.map((r) => ({
    tenant_id: tenantId, brand_id: brandId, record_type: r.record_type, stage: r.stage, field: r.field, level: r.level,
    applies_when: r.applies_when ?? null, locked: r.level === 'blocking' && GATE_FIELDS.includes(r.field),
  })), { session });
}

export async function createBrand(scope, body) {
  const input = {
    name: str(body.name, 'Name', { required: true, max: 120 }),
    code: str(body.code, 'Code', { required: true, max: 8 })?.toUpperCase(),
    template_key: str(body.template_key, 'Template', { required: true }),
    instagram: str(body.instagram, 'Instagram', { max: 200 }),
    website: str(body.website, 'Website', { max: 300 }),
    phones: Array.isArray(body.whatsapp_numbers) ? body.whatsapp_numbers : [],
    team_ids: ids(body.team_ids, 'team_ids') ?? [],
  };
  if (!/^[A-Z0-9]{2,8}$/.test(input.code)) throw badRequest('Code must be 2 to 8 letters or digits, e.g. NA');
  if (!brandNameKey(input.name)) throw badRequest('Name must contain letters or digits');
  const template = await BrandTemplate.findOne({ tenant_id: scope.tenantId, key: input.template_key }).lean();
  if (!template) throw badRequest(`Unknown template "${input.template_key}"`);
  const phones = [...new Map(input.phones.map((p) => { const x = requirePhone(p, 'WhatsApp number'); return [x.e164, x]; })).values()];
  const teams = input.team_ids.length ? await Team.find({ tenant_id: scope.tenantId, _id: { $in: input.team_ids } }).lean() : [];
  if (teams.length !== input.team_ids.length) throw badRequest('One of the teams does not exist');

  const { conflicts, similar } = await checkBrand(scope.tenantId, { ...input, phones: phones.map((p) => p.e164) });
  if (conflicts.length) throw conflict(conflicts[0].message, { code: 'duplicate_brand', conflicts });
  if (similar.length && body.confirm_similar !== true) {
    throw conflict(`A similar brand already exists: ${similar.map((s) => s.name).join(', ')}. Send confirm_similar: true if this is a different brand.`, { code: 'similar_brand', similar });
  }

  return withTransaction(async (session) => {
    const [brand] = await Brand.create([{
      tenant_id: scope.tenantId, code: input.code, name: input.name, name_key: brandNameKey(input.name),
      instagram: input.instagram, instagram_key: instagramKey(input.instagram), website: input.website, website_key: websiteKey(input.website),
      template_key: template.key, category: template.category,
      contact: { email: str(body.contact?.email, 'Contact email', { max: 200 }), phone: str(body.contact?.phone, 'Contact phone', { max: 40 }) },
      defaults: {
        currency: oneOf(body.defaults?.currency, 'Currency', ['INR', 'USD', 'GBP', 'AED', 'EUR']) ?? 'INR',
        production_days: int(body.defaults?.production_days, 'Production days', { min: 0, max: 365 }),
        transit_days: int(body.defaults?.transit_days, 'Transit days', { min: 0, max: 120 }),
        won_requires_payment_received: bool(body.defaults?.won_requires_payment_received, 'won_requires_payment_received') ?? false,
      },
      onboarded_by: scope.user._id,
    }], { session });
    await copyTemplateRules(session, scope.tenantId, brand._id, template);
    if (phones.length) {
      await WhatsappAccount.insertMany(phones.map((p) => ({ tenant_id: scope.tenantId, brand_id: brand._id, phone_e164: p.e164, display_name: brand.name })), { session });
    }
    if (teams.length) await Team.updateMany({ _id: { $in: input.team_ids } }, { $addToSet: { brand_ids: brand._id } }, { session });
    return brand;
  });
}

export async function updateBrand(scope, brandId, body) {
  const brand = await Brand.findOne({ _id: brandId, tenant_id: scope.tenantId });
  if (!brand) throw notFound('Brand');
  const next = {
    name: body.name !== undefined ? str(body.name, 'Name', { required: true, max: 120 }) : brand.name,
    code: body.code !== undefined ? str(body.code, 'Code', { required: true, max: 8 }).toUpperCase() : brand.code,
    instagram: body.instagram !== undefined ? str(body.instagram, 'Instagram', { max: 200 }) : brand.instagram,
    website: body.website !== undefined ? str(body.website, 'Website', { max: 300 }) : brand.website,
  };
  if (!/^[A-Z0-9]{2,8}$/.test(next.code)) throw badRequest('Code must be 2 to 8 letters or digits, e.g. NA');
  const { conflicts } = await checkBrand(scope.tenantId, next, brand._id);
  if (conflicts.length) throw conflict(conflicts[0].message, { code: 'duplicate_brand', conflicts });
  Object.assign(brand, next, { name_key: brandNameKey(next.name), instagram_key: instagramKey(next.instagram), website_key: websiteKey(next.website) });
  if (body.contact) {
    if (body.contact.email !== undefined) brand.contact.email = str(body.contact.email, 'Contact email', { max: 200 });
    if (body.contact.phone !== undefined) brand.contact.phone = str(body.contact.phone, 'Contact phone', { max: 40 });
  }
  if (body.defaults) {
    const d = body.defaults;
    if (d.currency !== undefined) brand.defaults.currency = oneOf(d.currency, 'Currency', ['INR', 'USD', 'GBP', 'AED', 'EUR'], { required: true });
    if (d.production_days !== undefined) brand.defaults.production_days = int(d.production_days, 'Production days', { min: 0, max: 365 });
    if (d.transit_days !== undefined) brand.defaults.transit_days = int(d.transit_days, 'Transit days', { min: 0, max: 120 });
    if (d.won_requires_payment_received !== undefined) brand.defaults.won_requires_payment_received = bool(d.won_requires_payment_received, 'won_requires_payment_received');
  }
  await brand.save();
  return brand;
}

export async function setBrandStatus(scope, brandId, status) {
  const brand = await Brand.findOneAndUpdate({ _id: brandId, tenant_id: scope.tenantId }, { $set: { status } }, { returnDocument: 'after' });
  if (!brand) throw notFound('Brand');
  return brand;
}

export async function addWhatsappAccount(scope, brandId, body) {
  const brand = await Brand.findOne({ _id: brandId, tenant_id: scope.tenantId }).lean();
  if (!brand) throw notFound('Brand');
  const { e164 } = requirePhone(body.phone, 'WhatsApp number');
  const { conflicts } = await checkBrand(scope.tenantId, { phones: [e164] });
  if (conflicts.length) throw conflict(conflicts[0].message, { code: 'duplicate_whatsapp_number', conflicts });
  return WhatsappAccount.create({ tenant_id: scope.tenantId, brand_id: brand._id, phone_e164: e164, display_name: str(body.display_name, 'Display name', { max: 120 }) ?? brand.name });
}

export const brandDto = (b, extra = {}) => ({
  id: b._id, code: b.code, name: b.name, status: b.status, template_key: b.template_key, category: b.category,
  instagram: b.instagram, website: b.website, contact: b.contact, defaults: b.defaults, created_at: b.created_at, ...extra,
});
