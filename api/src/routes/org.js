// Brands, WhatsApp accounts, teams and users (PLAN §4, §14)
import { Router } from 'express';
import { hashPassword, initialsOf } from '../lib/auth.js';
import { ROLES } from '../lib/constants.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { requirePhone } from '../lib/normalise.js';
import { bool, id, ids, oneOf, str } from '../lib/validate.js';
import { Brand, RequiredRule, Team, User, WhatsappAccount } from '../models/index.js';
import { addWhatsappAccount, brandDto, checkBrand, createBrand, setBrandStatus, updateBrand } from '../services/brands.js';
import { requireBrand, requireRole } from '../services/scope.js';

export const orgRouter = Router();
const admin = (req) => requireRole(req.scope, 'admin');

// ---------- brands ----------
orgRouter.get('/brands', async (req, res) => {
  const { tenantId, isAdmin, brandIds } = req.scope;
  const filter = { tenant_id: tenantId, ...(isAdmin ? {} : { _id: { $in: brandIds } }) };
  if (req.query.status) filter.status = oneOf(req.query.status, 'status', ['active', 'archived']);
  const [brands, accounts, teams] = await Promise.all([
    Brand.find(filter).sort({ name: 1 }).lean(),
    WhatsappAccount.find({ tenant_id: tenantId }).lean(),
    Team.find({ tenant_id: tenantId }).select('name brand_ids').lean(),
  ]);
  res.json(brands.map((b) => brandDto(b, {
    whatsapp_accounts: accounts.filter((a) => String(a.brand_id) === String(b._id)).map((a) => ({ id: a._id, phone: a.phone_e164, display_name: a.display_name, active: a.active })),
    teams: teams.filter((t) => t.brand_ids.some((x) => String(x) === String(b._id))).map((t) => ({ id: t._id, name: t.name })),
  })));
});

// live duplicate check while the admin types (PLAN §4.2)
orgRouter.get('/brands/check', async (req, res) => {
  admin(req);
  const q = req.query;
  const phones = q.phone ? [].concat(q.phone) : [];
  res.json(await checkBrand(req.scope.tenantId, { name: q.name, code: q.code, instagram: q.instagram, website: q.website, phones }, q.exclude ? id(q.exclude) : null));
});

orgRouter.post('/brands', async (req, res) => {
  admin(req);
  const brand = await createBrand(req.scope, req.body || {});
  const rules = await RequiredRule.countDocuments({ brand_id: brand._id });
  res.status(201).json(brandDto(brand, { rules }));
});

orgRouter.get('/brands/:id', async (req, res) => {
  const brandId = id(req.params.id);
  requireBrand(req.scope, brandId);
  const b = await Brand.findOne({ _id: brandId, tenant_id: req.scope.tenantId }).lean();
  if (!b) throw notFound('Brand');
  res.json(brandDto(b));
});

orgRouter.patch('/brands/:id', async (req, res) => {
  admin(req);
  res.json(brandDto(await updateBrand(req.scope, id(req.params.id), req.body || {})));
});

orgRouter.post('/brands/:id/archive', async (req, res) => { admin(req); res.json(brandDto(await setBrandStatus(req.scope, id(req.params.id), 'archived'))); });
orgRouter.post('/brands/:id/restore', async (req, res) => { admin(req); res.json(brandDto(await setBrandStatus(req.scope, id(req.params.id), 'active'))); });

// ---------- WhatsApp accounts (each belongs to exactly one brand) ----------
orgRouter.get('/brands/:id/whatsapp-accounts', async (req, res) => {
  const brandId = id(req.params.id);
  requireBrand(req.scope, brandId);
  const list = await WhatsappAccount.find({ tenant_id: req.scope.tenantId, brand_id: brandId }).sort({ created_at: 1 }).lean();
  res.json(list.map((a) => ({ id: a._id, brand_id: a.brand_id, phone: a.phone_e164, display_name: a.display_name, active: a.active })));
});

orgRouter.post('/brands/:id/whatsapp-accounts', async (req, res) => {
  admin(req);
  const a = await addWhatsappAccount(req.scope, id(req.params.id), req.body || {});
  res.status(201).json({ id: a._id, brand_id: a.brand_id, phone: a.phone_e164, display_name: a.display_name, active: a.active });
});

orgRouter.patch('/whatsapp-accounts/:id', async (req, res) => {
  admin(req);
  const a = await WhatsappAccount.findOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId });
  if (!a) throw notFound('WhatsApp account');
  if (req.body.display_name !== undefined) a.display_name = str(req.body.display_name, 'Display name', { max: 120 });
  if (req.body.active !== undefined) a.active = bool(req.body.active, 'active');
  if (req.body.phone !== undefined) {
    const { e164 } = requirePhone(req.body.phone, 'WhatsApp number');
    const other = await WhatsappAccount.findOne({ tenant_id: req.scope.tenantId, phone_e164: e164, _id: { $ne: a._id } }).lean();
    if (other) throw conflict(`${e164} is already connected to another account`, { code: 'duplicate_whatsapp_number' });
    a.phone_e164 = e164;
  }
  await a.save();
  res.json({ id: a._id, brand_id: a.brand_id, phone: a.phone_e164, display_name: a.display_name, active: a.active });
});

// ---------- teams (team <-> brand and user <-> team are both many-to-many) ----------
async function teamDto(t) {
  const [members, brands] = await Promise.all([
    User.find({ tenant_id: t.tenant_id, 'memberships.team_id': t._id }).select('name initials role active').sort({ name: 1 }).lean(),
    Brand.find({ _id: { $in: t.brand_ids } }).select('code name status').sort({ name: 1 }).lean(),
  ]);
  return {
    id: t._id, name: t.name, active: t.active, lead_user_id: t.lead_user_id,
    brands: brands.map((b) => ({ id: b._id, code: b.code, name: b.name, status: b.status })),
    members: members.map((m) => ({ id: m._id, name: m.name, initials: m.initials, role: m.role, active: m.active })),
  };
}

async function checkTeamRefs(tenantId, brandIds, leadUserId) {
  if (brandIds?.length && await Brand.countDocuments({ tenant_id: tenantId, _id: { $in: brandIds } }) !== brandIds.length) throw badRequest('One of the brands does not exist');
  if (leadUserId && !await User.exists({ tenant_id: tenantId, _id: leadUserId })) throw badRequest('The team lead does not exist');
}

orgRouter.get('/teams', async (req, res) => {
  const { tenantId, isAdmin, teams } = req.scope;
  const list = isAdmin ? await Team.find({ tenant_id: tenantId }).sort({ name: 1 }).lean() : teams;
  res.json(await Promise.all(list.map(teamDto)));
});

orgRouter.post('/teams', async (req, res) => {
  admin(req);
  const name = str(req.body.name, 'Name', { required: true, max: 80 });
  const brandIds = ids(req.body.brand_ids, 'brand_ids') ?? [];
  const leadUserId = id(req.body.lead_user_id, 'lead_user_id', { required: false });
  await checkTeamRefs(req.scope.tenantId, brandIds, leadUserId);
  if (await Team.exists({ tenant_id: req.scope.tenantId, name })) throw conflict(`A team called ${name} already exists`);
  const t = await Team.create({ tenant_id: req.scope.tenantId, name, brand_ids: brandIds, lead_user_id: leadUserId });
  res.status(201).json(await teamDto(t.toObject()));
});

orgRouter.patch('/teams/:id', async (req, res) => {
  admin(req);
  const t = await Team.findOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId });
  if (!t) throw notFound('Team');
  if (req.body.name !== undefined) {
    const name = str(req.body.name, 'Name', { required: true, max: 80 });
    if (await Team.exists({ tenant_id: req.scope.tenantId, name, _id: { $ne: t._id } })) throw conflict(`A team called ${name} already exists`);
    t.name = name;
  }
  const brandIds = ids(req.body.brand_ids, 'brand_ids');
  const leadUserId = req.body.lead_user_id !== undefined ? id(req.body.lead_user_id, 'lead_user_id', { required: false }) : undefined;
  await checkTeamRefs(req.scope.tenantId, brandIds, leadUserId);
  if (brandIds) t.brand_ids = brandIds;
  if (leadUserId !== undefined) t.lead_user_id = leadUserId;
  if (req.body.active !== undefined) t.active = bool(req.body.active, 'active');
  await t.save();
  res.json(await teamDto(t.toObject()));
});

orgRouter.post('/teams/:id/members', async (req, res) => {
  admin(req);
  const t = await Team.findOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId }).lean();
  if (!t) throw notFound('Team');
  const userId = id(req.body.user_id, 'user_id');
  const r = await User.updateOne({ _id: userId, tenant_id: req.scope.tenantId, 'memberships.team_id': { $ne: t._id } }, { $push: { memberships: { team_id: t._id } } });
  if (!r.matchedCount && !await User.exists({ _id: userId, tenant_id: req.scope.tenantId })) throw notFound('User');
  res.json(await teamDto(t));
});

orgRouter.delete('/teams/:id/members/:userId', async (req, res) => {
  admin(req);
  const t = await Team.findOne({ _id: id(req.params.id), tenant_id: req.scope.tenantId }).lean();
  if (!t) throw notFound('Team');
  await User.updateOne({ _id: id(req.params.userId), tenant_id: req.scope.tenantId }, { $pull: { memberships: { team_id: t._id } } });
  res.json(await teamDto(t));
});

// ---------- users ----------
const userDto = (u) => ({ id: u._id, name: u.name, initials: u.initials, email: u.email, role: u.role, active: u.active, team_ids: u.memberships.map((m) => m.team_id) });

orgRouter.get('/users', async (req, res) => {
  const { tenantId, isAdmin, teams } = req.scope;
  const filter = { tenant_id: tenantId, ...(isAdmin ? {} : { 'memberships.team_id': { $in: teams.map((t) => t._id) } }) };
  res.json((await User.find(filter).sort({ name: 1 }).lean()).map(userDto));
});

async function teamIdsOrThrow(tenantId, teamIds) {
  if (teamIds?.length && await Team.countDocuments({ tenant_id: tenantId, _id: { $in: teamIds } }) !== teamIds.length) throw badRequest('One of the teams does not exist');
  return teamIds;
}

orgRouter.post('/users', async (req, res) => {
  admin(req);
  const b = req.body || {};
  const name = str(b.name, 'Name', { required: true, max: 80 });
  const email = str(b.email, 'Email', { required: true, max: 200 }).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw badRequest('Email is not valid');
  const password = str(b.password, 'Password', { required: true, max: 200 });
  if (password.length < 8) throw badRequest('Password must be at least 8 characters');
  const teamIds = await teamIdsOrThrow(req.scope.tenantId, ids(b.team_ids, 'team_ids') ?? []);
  if (await User.exists({ email })) throw conflict(`${email} already has an account`);
  const u = await User.create({
    tenant_id: req.scope.tenantId, name, initials: initialsOf(name), email, password_hash: hashPassword(password),
    role: oneOf(b.role, 'Role', ROLES, { required: true }), memberships: teamIds.map((team_id) => ({ team_id })),
  });
  res.status(201).json(userDto(u));
});

orgRouter.patch('/users/:id', async (req, res) => {
  const userId = id(req.params.id);
  const self = String(userId) === String(req.scope.user._id);
  if (!self) admin(req);
  const u = await User.findOne({ _id: userId, tenant_id: req.scope.tenantId });
  if (!u) throw notFound('User');
  const b = req.body || {};
  if (b.name !== undefined) { u.name = str(b.name, 'Name', { required: true, max: 80 }); u.initials = initialsOf(u.name); }
  if (b.password !== undefined) {
    const pw = str(b.password, 'Password', { required: true, max: 200 });
    if (pw.length < 8) throw badRequest('Password must be at least 8 characters');
    u.password_hash = hashPassword(pw);
  }
  // only an admin changes roles, teams and active state, and an admin cannot lock themselves out
  if (b.role !== undefined || b.active !== undefined || b.team_ids !== undefined) {
    admin(req);
    if (b.role !== undefined) {
      const role = oneOf(b.role, 'Role', ROLES, { required: true });
      if (self && role !== 'admin') throw badRequest('You cannot remove your own admin role');
      u.role = role;
    }
    if (b.active !== undefined) {
      const active = bool(b.active, 'active');
      if (self && !active) throw badRequest('You cannot deactivate yourself');
      u.active = active;
    }
    if (b.team_ids !== undefined) {
      const teamIds = await teamIdsOrThrow(req.scope.tenantId, ids(b.team_ids, 'team_ids'));
      const keep = new Map(u.memberships.map((m) => [String(m.team_id), m]));
      u.memberships = teamIds.map((t) => keep.get(String(t)) ?? { team_id: t });
    }
  }
  await u.save();
  res.json(userDto(u));
});
