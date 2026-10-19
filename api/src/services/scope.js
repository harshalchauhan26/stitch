// Who can see what (PLAN §4.1): a member sees every brand handled by any of their teams; an admin sees the whole tenant.
// Loaded fresh on every request, so team and brand changes apply immediately.
import { forbidden, notFound } from '../lib/errors.js';
import { Team, User } from '../models/index.js';

export async function loadScope(user) {
  const isAdmin = user.role === 'admin';
  const teamIds = user.memberships.map((m) => m.team_id);
  const teams = await Team.find({ tenant_id: user.tenant_id, _id: { $in: teamIds }, active: true }).sort({ name: 1 }).lean();
  const brandIds = isAdmin ? null : [...new Set(teams.flatMap((t) => t.brand_ids.map(String)))];
  return {
    tenantId: user.tenant_id,
    user,
    teams,
    isAdmin,
    brandIds,                                     // null = every brand
    canSeeBrand: (brandId) => isAdmin || brandIds.includes(String(brandId)),
    /** Mongo filter on brand_id for this caller */
    brandFilter: (field = 'brand_id') => (isAdmin ? {} : { [field]: { $in: teams.flatMap((t) => t.brand_ids) } }),
  };
}

export function requireBrand(scope, brandId) {
  if (!scope.canSeeBrand(brandId)) throw notFound('Brand');
}

export const requireRole = (scope, ...roles) => {
  if (!roles.includes(scope.user.role)) throw forbidden(`Only ${roles.join(' or ').replace(/_/g, ' ')}s can do this`);
};

/** The actor block for events: the caller's team that handles this brand (first by name), copied at write time (PLAN §8.2) */
export function actorFor(scope, brandId) {
  const team = brandId ? scope.teams.find((t) => t.brand_ids.some((b) => String(b) === String(brandId))) : scope.teams[0];
  return { user_id: scope.user._id, name: scope.user.name, team_id: team?._id ?? null, team_name: team?.name ?? null, role: scope.user.role };
}

/** Can this user own a record of this brand? (PLAN §4.1 rule 5) */
export async function canOwnBrand(tenantId, userId, brandId) {
  const user = await User.findOne({ _id: userId, tenant_id: tenantId, active: true }).lean();
  if (!user) return false;
  if (user.role === 'admin') return true;
  const n = await Team.countDocuments({ tenant_id: tenantId, _id: { $in: user.memberships.map((m) => m.team_id) }, active: true, brand_ids: brandId });
  return n > 0;
}
