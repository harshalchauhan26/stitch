// Clients, leads (with items), the audit trail, issues, conversations and messages (PLAN §5.6-5.11)
import mongoose from 'mongoose';
import { EVENT_SOURCES, INTAKE_METHODS, ISSUE_TYPES, LOST_REASONS, STAGE_TYPES } from '../lib/constants.js';
import { ActorSchema, ChangeSchema, Mixed, ObjectId, Schema, baseOptions, tenantRef } from './common.js';

// One real person, identified by phone. No brand: a person can buy from several brands.
const ClientSchema = new Schema({
  tenant_id: tenantRef,
  phone_e164: { type: String, required: true },
  alt_phones: { type: [String], default: [] },
  name: { type: String, default: null, trim: true },
  email: { type: String, default: null, lowercase: true, trim: true },
  city: { type: String, default: null },
  country: { type: String, default: null },
  whatsapp_consent: { type: String, enum: ['Yes', 'No', 'Unknown'], default: 'Unknown' },
  customer_type: { type: String, enum: ['New', 'Repeat', 'Referral', 'Trade/Stylist', null], default: null },
  created_by: { type: ObjectId, ref: 'User' },
}, baseOptions('clients'));
ClientSchema.index({ tenant_id: 1, phone_e164: 1 }, { unique: true });
ClientSchema.index({ name: 'text', email: 'text' });

// A product inside a lead. Embedded: a lead has few items and they are always read together.
const LeadItemSchema = new Schema({
  product_id: { type: ObjectId, ref: 'Product', default: null },
  product: { type: String, required: true, trim: true },
  quantity: { type: Number, default: 1, min: 1 },
  unit_price: { type: Number, default: null },            // smallest currency unit
  wearer: { type: String, default: null },
  fields: { type: Mixed, default: () => ({}) },           // item-scope values: neckline, waist, blouse_size, ...
  removed_at: { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, minimize: false });

// One purchase: one client + one brand + one buying decision
const LeadSchema = new Schema({
  tenant_id: tenantRef,
  lead_no: { type: String, required: true },
  client_id: { type: ObjectId, ref: 'Client', required: true },
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  owner_id: { type: ObjectId, ref: 'User', required: true },
  stage: { type: String, required: true },                // a stage name from the brand's lead_pipeline
  stage_type: { type: String, enum: STAGE_TYPES, default: 'open' },
  stage_changed_at: { type: Date, default: Date.now },
  stage_before_lost: { type: String, default: null },      // where a reopened lead goes back to
  fields: { type: Mixed, default: () => ({}) },           // lead-scope values, keys from field_defs
  items: { type: [LeadItemSchema], default: [] },
  lost_reason: { type: String, enum: [...LOST_REASONS, null], default: null },
  lost_note: { type: String, default: null },
  lost_at: { type: Date, default: null },
  reopened_count: { type: Number, default: 0 },
  converted_order_id: { type: ObjectId, ref: 'Order', default: null },
  open_gap_count: { type: Number, default: 0 },           // cached by the gap engine for list views
  blocking_gap_count: { type: Number, default: 0 },
  open_issue_count: { type: Number, default: 0 },
  version: { type: Number, default: 1 },                  // optimistic lock: +1 on every write
  intake_method: { type: String, enum: INTAKE_METHODS, default: 'Manual' },
  created_by: { type: ObjectId, ref: 'User' },
}, baseOptions('leads'));
LeadSchema.index({ tenant_id: 1, lead_no: 1 }, { unique: true });
LeadSchema.index({ tenant_id: 1, brand_id: 1, stage: 1 });
LeadSchema.index({ tenant_id: 1, client_id: 1, brand_id: 1, stage_type: 1 });
LeadSchema.index({ tenant_id: 1, owner_id: 1, stage: 1 });
LeadSchema.index({ tenant_id: 1, client_id: 1 });
LeadSchema.index({ tenant_id: 1, 'fields.event_date': 1 });

// Append-only. Never updated or deleted; undo writes a new event (PLAN §8)
export const eventSchema = (recordKey, collection) => {
  const s = new Schema({
    tenant_id: tenantRef,
    [recordKey]: { type: ObjectId, required: true },
    item_id: { type: ObjectId, default: null },
    type: { type: String, required: true },
    changes: { type: [ChangeSchema], default: [] },
    actor: { type: ActorSchema, required: true },
    source: { type: String, enum: EVENT_SOURCES, default: 'manual' },
    source_message_id: { type: ObjectId, ref: 'Message', default: null },
    reason: { type: String, default: null },
    data: { type: Mixed, default: null },                 // extra context, e.g. the blockers of a refused move
    record_version: { type: Number, default: null },      // the record's version after this event
    at: { type: Date, default: Date.now },
  }, { collection, versionKey: false, minimize: false });
  s.index({ tenant_id: 1, [recordKey]: 1, at: -1 });
  s.index({ tenant_id: 1, 'actor.user_id': 1, at: -1 });
  s.index({ tenant_id: 1, 'actor.team_id': 1, at: -1 });
  return s;
};

const LeadIssueSchema = new Schema({
  tenant_id: tenantRef,
  lead_id: { type: ObjectId, ref: 'Lead', required: true },
  brand_id: { type: ObjectId, ref: 'Brand', required: true },   // copied from the lead, for brand scoping
  item_id: { type: ObjectId, default: null },
  type: { type: String, enum: ISSUE_TYPES, required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: null },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  source_message_id: { type: ObjectId, ref: 'Message', default: null },
  raised_by: { type: ObjectId, ref: 'User' },
  owner_id: { type: ObjectId, ref: 'User', default: null },
  opened_at: { type: Date, default: Date.now },
  resolved_at: { type: Date, default: null },
  resolution: { type: String, default: null },
}, baseOptions('lead_issues'));
LeadIssueSchema.index({ tenant_id: 1, lead_id: 1, status: 1 });
LeadIssueSchema.index({ tenant_id: 1, brand_id: 1, status: 1, type: 1 });

// conversation <-> lead is many-to-many through lead_links[]
const LeadLinkSchema = new Schema({
  lead_id: { type: ObjectId, ref: 'Lead', required: true },
  linked_by: { type: ObjectId, ref: 'User' },
  linked_at: { type: Date, default: Date.now },
  note: { type: String, default: null },
}, { _id: false });

const ConversationSchema = new Schema({
  tenant_id: tenantRef,
  whatsapp_account_id: { type: ObjectId, ref: 'WhatsappAccount', required: true },
  brand_id: { type: ObjectId, ref: 'Brand', required: true },   // always the account's brand
  client_id: { type: ObjectId, ref: 'Client', required: true },
  source: { type: String, enum: ['chat_export'], default: 'chat_export' },
  file_name: { type: String, default: null },
  content_hash: { type: String, required: true },
  first_msg_at: { type: Date, default: null },
  last_msg_at: { type: Date, default: null },
  message_count: { type: Number, default: 0 },
  customer_message_count: { type: Number, default: 0 },
  lead_links: { type: [LeadLinkSchema], default: [] },
  status: { type: String, enum: ['unlinked', 'linked', 'archived'], default: 'unlinked' },
  uploaded_by: { type: ObjectId, ref: 'User' },
}, baseOptions('conversations'));
ConversationSchema.index({ tenant_id: 1, client_id: 1 });
ConversationSchema.index({ tenant_id: 1, brand_id: 1, status: 1 });
ConversationSchema.index({ tenant_id: 1, 'lead_links.lead_id': 1 });
ConversationSchema.index({ tenant_id: 1, content_hash: 1 });

// Separate collection: a chat can have thousands of messages (16 MB document limit)
const MessageSchema = new Schema({
  tenant_id: tenantRef,
  conversation_id: { type: ObjectId, ref: 'Conversation', required: true },
  idx: { type: Number, required: true },
  ts: { type: Date, required: true },
  sender: { type: String, default: null },
  role: { type: String, enum: ['customer', 'staff', 'unknown'], required: true },
  text: { type: String, default: '' },
  media: { type: String, default: null },
  msg_hash: { type: String, required: true },
}, { collection: 'messages', versionKey: false });
MessageSchema.index({ conversation_id: 1, idx: 1 }, { unique: true });
MessageSchema.index({ conversation_id: 1, msg_hash: 1 }, { unique: true });

// ---- chat -> lead (docs/wp-groq.md, services/extraction.js) ----
// One LLM run over one chat for one lead. It stores what the model PROPOSED (suggestions, which a person accepts or dismisses one
// by one) and what it said that did NOT fit the schema (exceptions), so nothing is silently dropped and a run can be reviewed
// later. Nothing here is the lead's data: the lead only changes when a suggestion is accepted, through the normal edit.
//
// A suggestion is embedded (not its own collection): a run has a few dozen of them, they are always read together with the run,
// and they never outlive it.
const SuggestionSchema = new Schema({
  // client = customer detail, lead = lead-level field, item = field/attribute of one product, new_item = "add this product"
  scope: { type: String, enum: ['client', 'lead', 'item', 'new_item'], required: true },
  field: { type: String, required: true },                // a field_defs key (or quantity / wearer / unit_price for items)
  label: { type: String, default: null },                 // copied so screens need no extra lookup
  type: { type: String, default: null },                  // the field's type, so screens can format the value (currency -> rupees)
  item_id: { type: ObjectId, default: null },             // which product, for scope 'item'
  value: Mixed,                                           // already parsed by the same code manual edits use (paise, canonical select value ...)
  previous: Mixed,                                        // what the field holds now, when the chat CHANGES an existing value
  confidence: { type: Number, default: null },            // 0 to 1, the model's own estimate
  evidence: { type: String, default: null },              // short quote from the chat that shows the value
  source_message_id: { type: ObjectId, ref: 'Message', default: null },   // the chat message it came from; carried onto the lead's history when accepted
  status: { type: String, enum: ['pending', 'accepted', 'dismissed', 'failed'], default: 'pending' },   // failed = accepted but could not be applied
  error: { type: String, default: null },                 // why a failed one failed
  decided_by: { type: ObjectId, ref: 'User', default: null },
  decided_at: { type: Date, default: null },
});
const ExtractionSchema = new Schema({
  tenant_id: tenantRef,
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  lead_id: { type: ObjectId, ref: 'Lead', required: true },
  conversation_id: { type: ObjectId, ref: 'Conversation', required: true },
  model: { type: String, default: null },                 // which LLM answered, e.g. openai/gpt-oss-120b
  requested_by: { type: ObjectId, ref: 'User' },
  // messages_total / messages_read / truncated, fields_offered, suggested, exceptions, found, already_filled, and the not_found list
  // (the coverage report: which offered fields the chat could not supply)
  stats: { type: Mixed, default: null },
  suggestions: { type: [SuggestionSchema], default: [] },
  // everything the model said that did not fit: { code, scope, field, item, value, reason, message_id, evidence }
  // codes: unknown_field, computed, not_allowed, not_used, bad_item, invalid_value
  exceptions: { type: [Mixed], default: [] },
}, baseOptions('extractions'));
ExtractionSchema.index({ tenant_id: 1, lead_id: 1, created_at: -1 });          // the lead drawer: runs for this lead
ExtractionSchema.index({ tenant_id: 1, conversation_id: 1, created_at: -1 });  // the Chats page: runs on this chat

export const Extraction = mongoose.model('Extraction', ExtractionSchema);
export const Client = mongoose.model('Client', ClientSchema);
export const Lead = mongoose.model('Lead', LeadSchema);
export const LeadEvent = mongoose.model('LeadEvent', eventSchema('lead_id', 'lead_events'));
export const LeadIssue = mongoose.model('LeadIssue', LeadIssueSchema);
export const Conversation = mongoose.model('Conversation', ConversationSchema);
export const Message = mongoose.model('Message', MessageSchema);
