// What to capture and what is required when: field_defs, brand_templates, required_rules, counters (PLAN §5.13, §5.15)
import mongoose from 'mongoose';
import { FIELD_SCOPES, FIELD_TYPES, LEVELS } from '../lib/constants.js';
import { ActorSchema, ChangeSchema, Mixed, ObjectId, Schema, baseOptions, tenantRef } from './common.js';

// "This field only applies when <field> <op> <value>", e.g. duty_estimate only when country != India
const ConditionSchema = new Schema({
  field: { type: String, required: true },
  scope: { type: String, enum: FIELD_SCOPES, default: 'lead' },
  op: { type: String, enum: ['eq', 'ne'], required: true },
  value: { type: String, required: true },
}, { _id: false });

const FieldDefSchema = new Schema({
  tenant_id: tenantRef,
  brand_id: { type: ObjectId, ref: 'Brand', default: null },   // null = shared catalogue field; set = a brand's custom field
  key: { type: String, required: true, match: /^[a-z][a-z0-9_]*$/ },
  label: { type: String, required: true },
  scope: { type: String, enum: FIELD_SCOPES, required: true },
  record_types: { type: [String], default: ['lead', 'order'] },
  type: { type: String, enum: FIELD_TYPES, required: true },
  options: { type: [String], default: undefined },
  done_values: { type: [String], default: undefined },     // e.g. quote_status is only "filled" when Accepted
  unit: { type: String, default: null },
  min: { type: Number, default: null },
  max: { type: Number, default: null },
  hint: { type: String, default: '' },
  computed: { type: Boolean, default: false },              // filled by Stitch (payments ledger, dispatches), never typed
  applies_when: { type: ConditionSchema, default: null },
  blocks_move_to: { type: String, default: null },          // a blocking field normally gates the next stage; this overrides it
  active: { type: Boolean, default: true },
}, baseOptions('field_defs'));
FieldDefSchema.index({ tenant_id: 1, key: 1 }, { unique: true });
FieldDefSchema.index({ tenant_id: 1, brand_id: 1 });

const RuleSchema = new Schema({
  record_type: { type: String, enum: ['lead', 'order'], required: true },
  stage: { type: String, required: true },
  field: { type: String, required: true },
  level: { type: String, enum: LEVELS, required: true },
  applies_when: { type: ConditionSchema, default: null },   // overrides the field's own condition for this brand
}, { _id: false });

const BrandTemplateSchema = new Schema({
  tenant_id: tenantRef,
  key: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, default: null },
  field_keys: { type: [String], default: [] },
  lead_pipeline: { type: [{ _id: false, name: String, type: { type: String } }], default: undefined },
  rules: { type: [RuleSchema], default: [] },
}, baseOptions('brand_templates'));
BrandTemplateSchema.index({ tenant_id: 1, key: 1 }, { unique: true });

// spec §5.5 "Set Required": Brand + Record + Stage + Field -> level. No rule = the field is hidden for that brand.
const RequiredRuleSchema = new Schema({
  tenant_id: tenantRef,
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  record_type: { type: String, enum: ['lead', 'order'], required: true },
  stage: { type: String, required: true },
  field: { type: String, required: true },
  level: { type: String, enum: LEVELS, required: true },
  applies_when: { type: ConditionSchema, default: null },
  locked: { type: Boolean, default: false },                // the six gate fields: only an admin may lower them
  updated_by: { type: ObjectId, ref: 'User', default: null },
}, baseOptions('required_rules'));
RequiredRuleSchema.index({ tenant_id: 1, brand_id: 1, record_type: 1, stage: 1, field: 1 }, { unique: true });

// readable numbers: LD-1001, ORD-NA-2001
const CounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
}, { collection: 'counters', versionKey: false });

// Settings changes that are not on a lead or order (required rules, ...). Spec §5.5: every rule change is logged.
const AuditLogSchema = new Schema({
  tenant_id: tenantRef,
  actor: { type: ActorSchema, required: true },
  action: { type: String, required: true },               // e.g. rule.changed, rule.removed, client.updated
  target_type: { type: String, required: true },
  target_id: { type: ObjectId, default: null },
  changes: { type: [ChangeSchema], default: [] },
  data: { type: Mixed, default: null },
  at: { type: Date, default: Date.now },
}, { collection: 'audit_log', versionKey: false, minimize: false });
AuditLogSchema.index({ tenant_id: 1, target_type: 1, target_id: 1, at: -1 });

export const AuditLog = mongoose.model('AuditLog', AuditLogSchema);
export const FieldDef = mongoose.model('FieldDef', FieldDefSchema);
export const BrandTemplate = mongoose.model('BrandTemplate', BrandTemplateSchema);
export const RequiredRule = mongoose.model('RequiredRule', RequiredRuleSchema);
export const Counter = mongoose.model('Counter', CounterSchema);
