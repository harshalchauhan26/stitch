// First run: one tenant, one admin, and the field catalogue + brand templates from the spec.
// Safe to run on every start: it only adds what is missing and never overwrites edits made in Settings.
import { FIELD_DEFS, TEMPLATES } from '../catalogue.js';
import { hashPassword, initialsOf } from '../lib/auth.js';
import { BrandTemplate, FieldDef, Tenant, User } from '../models/index.js';

export async function seedCatalogue(tenantId) {
  await FieldDef.bulkWrite(FIELD_DEFS.map((d) => ({
    updateOne: { filter: { tenant_id: tenantId, key: d.key }, update: { $setOnInsert: { ...d, tenant_id: tenantId } }, upsert: true },
  })));
  await BrandTemplate.bulkWrite(TEMPLATES.map((t) => ({
    updateOne: { filter: { tenant_id: tenantId, key: t.key }, update: { $setOnInsert: { ...t, tenant_id: tenantId } }, upsert: true },
  })));
}

/** Returns { tenant, admin, created } */
export async function bootstrap({ tenant: t, email, password }) {
  let tenant = await Tenant.findOne({ slug: t.slug });
  let admin = null, created = false;
  if (!tenant) {
    tenant = await Tenant.create(t);
    admin = await User.create({
      tenant_id: tenant._id, name: 'Admin', initials: initialsOf('Admin'), email, password_hash: hashPassword(password), role: 'admin',
    });
    created = true;
  }
  await seedCatalogue(tenant._id);
  return { tenant, admin, created };
}
