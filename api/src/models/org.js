// Organisation: tenants, users, teams, brands, WhatsApp accounts (PLAN §4, §5.1-5.5)
import mongoose from 'mongoose';
import { DEFAULT_LEAD_PIPELINE, ROLES, STAGE_TYPES } from '../lib/constants.js';
import { ObjectId, Schema, baseOptions, tenantRef, whenString } from './common.js';

const TenantSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  active: { type: Boolean, default: true },
}, baseOptions('tenants'));

// user <-> team is many-to-many through memberships[]
const MembershipSchema = new Schema({
  team_id: { type: ObjectId, ref: 'Team', required: true },
  joined_at: { type: Date, default: Date.now },
}, { _id: false });

const UserSchema = new Schema({
  tenant_id: tenantRef,
  name: { type: String, required: true, trim: true },
  initials: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ROLES, required: true },
  memberships: { type: [MembershipSchema], default: [] },
  active: { type: Boolean, default: true },
}, baseOptions('users'));
UserSchema.index({ tenant_id: 1, 'memberships.team_id': 1 });

// team <-> brand is many-to-many through brand_ids[]
const TeamSchema = new Schema({
  tenant_id: tenantRef,
  name: { type: String, required: true, trim: true },
  brand_ids: { type: [{ type: ObjectId, ref: 'Brand' }], default: [] },
  lead_user_id: { type: ObjectId, ref: 'User', default: null },
  active: { type: Boolean, default: true },
}, baseOptions('teams'));
TeamSchema.index({ tenant_id: 1, name: 1 }, { unique: true });
TeamSchema.index({ tenant_id: 1, brand_ids: 1 });

const StageSchema = new Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: STAGE_TYPES, required: true },
}, { _id: false });

// *_key fields are normalised copies used only for the duplicate checks (PLAN §4.2)
const BrandSchema = new Schema({
  tenant_id: tenantRef,
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  name_key: { type: String, required: true },
  instagram: { type: String, default: null },
  instagram_key: { type: String, default: null },
  website: { type: String, default: null },
  website_key: { type: String, default: null },
  template_key: { type: String, required: true },
  category: { type: String, default: null },
  lead_pipeline: { type: [StageSchema], default: () => DEFAULT_LEAD_PIPELINE.map((x) => ({ ...x })) },   // custom per brand
  contact: { email: { type: String, default: null }, phone: { type: String, default: null } },
  defaults: {
    currency: { type: String, default: 'INR' },
    production_days: { type: Number, default: null },
    transit_days: { type: Number, default: null },
    won_requires_payment_received: { type: Boolean, default: false },   // spec Q1, per brand
  },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  onboarded_by: { type: ObjectId, ref: 'User' },
}, baseOptions('brands'));
BrandSchema.index({ tenant_id: 1, code: 1 }, { unique: true });
BrandSchema.index({ tenant_id: 1, name_key: 1 }, { unique: true });
BrandSchema.index({ tenant_id: 1, instagram_key: 1 }, { unique: true, ...whenString('instagram_key') });
BrandSchema.index({ tenant_id: 1, website_key: 1 }, { unique: true, ...whenString('website_key') });

// each WhatsApp number belongs to exactly one brand
const WhatsappAccountSchema = new Schema({
  tenant_id: tenantRef,
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  phone_e164: { type: String, required: true },
  display_name: { type: String, default: null },
  active: { type: Boolean, default: true },
}, baseOptions('whatsapp_accounts'));
WhatsappAccountSchema.index({ tenant_id: 1, phone_e164: 1 }, { unique: true });
WhatsappAccountSchema.index({ brand_id: 1 });

export const Tenant = mongoose.model('Tenant', TenantSchema);
export const User = mongoose.model('User', UserSchema);
export const Team = mongoose.model('Team', TeamSchema);
export const Brand = mongoose.model('Brand', BrandSchema);
export const WhatsappAccount = mongoose.model('WhatsappAccount', WhatsappAccountSchema);
