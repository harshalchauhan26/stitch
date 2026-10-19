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

export const WebhookEndpoint = mongoose.model('WebhookEndpoint', WebhookEndpointSchema);
export const Outbox = mongoose.model('Outbox', OutboxSchema);
export const WebhookDelivery = mongoose.model('WebhookDelivery', WebhookDeliverySchema);
export const Notification = mongoose.model('Notification', NotificationSchema);
