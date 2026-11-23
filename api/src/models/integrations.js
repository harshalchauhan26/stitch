// Webhooks to brands and in-app notifications (PLAN §11)
import mongoose from 'mongoose';
import { Mixed, ObjectId, Schema, baseOptions, tenantRef } from './common.js';

const WebhookEndpointSchema = new Schema({
  tenant_id: tenantRef,
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  url: { type: String, required: true },
  secret: { type: String, required: true },              // signs every request (HMAC-SHA256)
  events: { type: [String], default: ['order.created'] },
  include_pii: { type: Boolean, default: false },        // client phone and address are left out unless this is on
  active: { type: Boolean, default: true },
  created_by: { type: ObjectId, ref: 'User' },
}, baseOptions('webhook_endpoints'));
WebhookEndpointSchema.index({ tenant_id: 1, brand_id: 1, active: 1 });

// Written in the same transaction as the change it announces; a worker delivers it afterwards.
const OutboxSchema = new Schema({
  tenant_id: tenantRef,
  event: { type: String, required: true },
  event_id: { type: String, required: true, unique: true },   // receivers de-duplicate on this
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  payload: { type: Mixed, required: true },
  status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  next_attempt_at: { type: Date, default: Date.now },
  locked_until: { type: Date, default: null },
  redeliver_from: { type: Date, default: null },            // set by Redeliver: earlier successful sends do not count
  last_error: { type: String, default: null },
}, baseOptions('outbox'));
OutboxSchema.index({ status: 1, next_attempt_at: 1 });

const WebhookDeliverySchema = new Schema({
  tenant_id: tenantRef,
  outbox_id: { type: ObjectId, ref: 'Outbox', required: true },
  endpoint_id: { type: ObjectId, ref: 'WebhookEndpoint', required: true },
  attempt: { type: Number, required: true },
  request_at: { type: Date, default: Date.now },
  status_code: { type: Number, default: null },
  duration_ms: { type: Number, default: null },
  response_snippet: { type: String, default: null },
  error: { type: String, default: null },
}, { collection: 'webhook_deliveries', versionKey: false });
WebhookDeliverySchema.index({ tenant_id: 1, endpoint_id: 1, request_at: -1 });
WebhookDeliverySchema.index({ outbox_id: 1 });

const NotificationSchema = new Schema({
  tenant_id: tenantRef,
  user_id: { type: ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  link: { type: String, default: null },
  read_at: { type: Date, default: null },
}, baseOptions('notifications'));
NotificationSchema.index({ tenant_id: 1, user_id: 1, read_at: 1, created_at: -1 });

// E-mails to the team (docs/MAILER.md). Written in the same transaction as the change they announce by services/mailFlows.js;
// the worker in services/mail.js sends them. One row per recipient, so each is retried on its own.
const MailOutboxSchema = new Schema({
  tenant_id: tenantRef,
  brand_id: { type: ObjectId, ref: 'Brand', default: null },
  type: { type: String, required: true },                     // order.opened, payment.due, customisation.changed, dispatch.created, order.closed...
  to: { type: String, required: true },
  user_id: { type: ObjectId, ref: 'User', default: null },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  ref: { type: Mixed, default: {} },                           // what it is about: { order_id, lead_id, label, ... }
  status: { type: String, enum: ['pending', 'processing', 'sent', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  next_attempt_at: { type: Date, default: Date.now },
  locked_until: { type: Date, default: null },
  sent_at: { type: Date, default: null },
  last_error: { type: String, default: null },
}, baseOptions('mail_outbox'));
MailOutboxSchema.index({ status: 1, next_attempt_at: 1 });
MailOutboxSchema.index({ tenant_id: 1, created_at: -1 });

// Every WhatsApp webhook call, stored as it arrived before anything is done with it (services/whatsappInbound.js).
// That way Meta gets its 200 straight away, nothing is lost if processing fails, and the raw payloads of the pilot can be
// read to check them against what the code expects. No tenant: the tenant is only known once the number is matched.
const WaInboundSchema = new Schema({
  payload: { type: Mixed, required: true },
  status: { type: String, enum: ['pending', 'processed', 'unmatched', 'failed'], default: 'pending' },
  tenant_id: { type: ObjectId, ref: 'Tenant', default: null },
  summary: { type: Mixed, default: null },                    // what processing did: { stored, skipped, fields, numbers }
  error: { type: String, default: null },
  attempts: { type: Number, default: 0 },
}, baseOptions('wa_inbound'));
WaInboundSchema.index({ status: 1, created_at: 1 });
WaInboundSchema.index({ created_at: -1 });

export const WaInbound = mongoose.model('WaInbound', WaInboundSchema);
export const WebhookEndpoint = mongoose.model('WebhookEndpoint', WebhookEndpointSchema);
export const Outbox = mongoose.model('Outbox', OutboxSchema);
export const WebhookDelivery = mongoose.model('WebhookDelivery', WebhookDeliverySchema);
export const Notification = mongoose.model('Notification', NotificationSchema);
export const MailOutbox = mongoose.model('MailOutbox', MailOutboxSchema);
