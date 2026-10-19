// Products, orders, customisations, payments and dispatches (PLAN §5.12, §5.16-5.19)
import mongoose from 'mongoose';
import { DISPATCH_STATUSES, ORDER_STAGES, PAYMENT_KINDS, PAYMENT_MODES, PAYMENT_STATUSES } from '../lib/constants.js';
import { eventSchema } from './crm.js';
import { Mixed, ObjectId, Schema, baseOptions, tenantRef, whenString } from './common.js';

// All money is an integer in the smallest currency unit (paise, cents).

const ProductSchema = new Schema({
  tenant_id: tenantRef,
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  sku: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, default: null },
  base_price: { type: Number, default: null, min: 0 },
  currency: { type: String, default: 'INR' },
  customisable_fields: { type: [String], default: [] },
  lead_time_days: { type: Number, default: null },
  images: { type: [String], default: [] },
  shopify_product_id: { type: String, default: null },
  active: { type: Boolean, default: true },
}, baseOptions('products'));
ProductSchema.index({ tenant_id: 1, brand_id: 1, sku: 1 }, { unique: true });
ProductSchema.index({ name: 'text', sku: 'text' });

const OrderItemSchema = new Schema({
  lead_item_id: { type: ObjectId, default: null },
  product_id: { type: ObjectId, ref: 'Product', default: null },
  product_name: { type: String, required: true },
  quantity: { type: Number, default: 1, min: 1 },
  unit_price: { type: Number, default: 0 },
  line_total: { type: Number, default: 0 },
  wearer: { type: String, default: null },
  current_spec_id: { type: ObjectId, ref: 'Customisation', default: null },
  current_measurements_id: { type: ObjectId, ref: 'Customisation', default: null },
}, { _id: true });

const OrderSchema = new Schema({
  tenant_id: tenantRef,
  order_no: { type: String, required: true },
  order_date: { type: String, required: true },          // YYYY-MM-DD, the day the lead was Won
  lead_id: { type: ObjectId, ref: 'Lead', required: true },
  client_id: { type: ObjectId, ref: 'Client', required: true },
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  owner_id: { type: ObjectId, ref: 'User', required: true },
  stage: { type: String, enum: ORDER_STAGES, default: 'Created' },
  stage_changed_at: { type: Date, default: Date.now },
  currency: { type: String, default: 'INR' },
  amounts: {                                              // paid and balance_due come from the payments ledger only
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    duty: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    balance_due: { type: Number, default: 0 },
  },
  items: { type: [OrderItemSchema], default: [] },
  dates: {
    event_date: { type: String, default: null },
    promised_ship_date: { type: String, default: null },
    delivery_deadline: { type: String, default: null },
  },
  addresses: {
    delivery: { type: String, default: null },
    verified_shipping: { type: String, default: null },
    billing: { type: String, default: null },
  },
  production: {
    karigar: { type: String, default: null }, start_date: { type: String, default: null }, eta: { type: String, default: null },
    completed_at: { type: String, default: null }, delay_reason: { type: String, default: null },
  },
  qc: {
    result: { type: String, enum: ['Pass', 'Fail', null], default: null }, by: { type: ObjectId, ref: 'User', default: null },
    at: { type: Date, default: null }, failure_reason: { type: String, default: null },
  },
  fields: { type: Mixed, default: () => ({}) },
  shopify: {
    order_id: { type: String, default: null }, last_sync_at: { type: Date, default: null }, out_of_sync: { type: Boolean, default: false },
  },
  open_gap_count: { type: Number, default: 0 },
  blocking_gap_count: { type: Number, default: 0 },
  version: { type: Number, default: 1 },
}, baseOptions('orders'));
OrderSchema.index({ tenant_id: 1, brand_id: 1, order_no: 1 }, { unique: true });
OrderSchema.index({ tenant_id: 1, brand_id: 1, stage: 1 });
OrderSchema.index({ tenant_id: 1, order_date: -1 });
OrderSchema.index({ tenant_id: 1, lead_id: 1 }, { unique: true });   // one order per lead, enforced by the database

// One document per VERSION of an item's spec or measurements. A correction is a new version, never an overwrite.
const CustomisationSchema = new Schema({
  tenant_id: tenantRef,
  order_id: { type: ObjectId, ref: 'Order', required: true },
  order_item_id: { type: ObjectId, required: true },
  lead_id: { type: ObjectId, ref: 'Lead', default: null },
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  kind: { type: String, enum: ['spec', 'measurements'], required: true },
  version: { type: Number, required: true, min: 1 },
  values: { type: Mixed, default: () => ({}) },
  unit: { type: String, default: 'in' },
  changed_fields: { type: [String], default: [] },
  reason: { type: String, default: null },               // required from version 2 onwards
  source: { type: String, enum: ['lead', 'customer', 'store_visit', 'tailor_visit', 'video_call'], default: 'customer' },
  status: { type: String, enum: ['draft', 'sent_to_customer', 'signed_off', 'superseded'], default: 'draft' },
  signed_off: {
    by_customer: { type: Boolean, default: false },
    confirmed_by_user_id: { type: ObjectId, ref: 'User', default: null },
    at: { type: Date, default: null },
    evidence_message_id: { type: ObjectId, ref: 'Message', default: null },
  },
  approved_by: { type: ObjectId, ref: 'User', default: null },   // needed for changes after Spec locked (spec Q7)
  created_by: { type: ObjectId, ref: 'User' },
}, baseOptions('customisations'));
CustomisationSchema.index({ order_item_id: 1, kind: 1, version: 1 }, { unique: true });
CustomisationSchema.index({ tenant_id: 1, order_id: 1 });
CustomisationSchema.index({ tenant_id: 1, created_at: -1, version: 1 });

const PaymentSchema = new Schema({
  tenant_id: tenantRef,
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  client_id: { type: ObjectId, ref: 'Client', required: true },
  lead_id: { type: ObjectId, ref: 'Lead', required: true },
  order_id: { type: ObjectId, ref: 'Order', default: null },
  kind: { type: String, enum: PAYMENT_KINDS, required: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
  mode: { type: String, enum: [...PAYMENT_MODES, null], default: null },
  link: {
    url: { type: String, default: null }, sent_at: { type: Date, default: null }, expires_at: { type: Date, default: null },
  },
  transaction_ref: { type: String, default: null, trim: true },
  received_at: { type: Date, default: null },
  proof_url: { type: String, default: null },
  notes: { type: String, default: null },
  recorded_by: { type: ObjectId, ref: 'User' },
}, baseOptions('payments'));
PaymentSchema.index({ tenant_id: 1, order_id: 1 });
PaymentSchema.index({ tenant_id: 1, lead_id: 1 });
PaymentSchema.index({ tenant_id: 1, status: 1, received_at: -1 });
PaymentSchema.index({ tenant_id: 1, transaction_ref: 1 }, { unique: true, ...whenString('transaction_ref') });

const CorrectionSchema = new Schema({
  at: { type: Date, default: Date.now },
  by: { type: ObjectId, ref: 'User' },
  field: { type: String, required: true },
  old: Mixed,
  new: Mixed,
  reason: { type: String, required: true },
}, { _id: false });

const DispatchSchema = new Schema({
  tenant_id: tenantRef,
  brand_id: { type: ObjectId, ref: 'Brand', required: true },
  client_id: { type: ObjectId, ref: 'Client', required: true },
  order_id: { type: ObjectId, ref: 'Order', required: true },
  shipment_no: { type: Number, default: 1 },
  order_item_ids: { type: [ObjectId], default: [] },
  courier: { type: String, default: null },
  awb: { type: String, default: null, trim: true },
  tracking_link: { type: String, default: null },
  ship_to: {
    name: String, phone: String, address: String, city: String, pincode: String, country: String,
  },
  pickup_date: { type: String, default: null },
  dispatch_date: { type: String, default: null },        // YYYY-MM-DD, drives the weekly view
  expected_delivery: { type: String, default: null },
  delivered_at: { type: Date, default: null },
  delivery_proof_url: { type: String, default: null },
  status: { type: String, enum: DISPATCH_STATUSES, default: 'scheduled' },
  late: { type: Boolean, default: false },
  tracking_shared_at: { type: Date, default: null },
  corrections: { type: [CorrectionSchema], default: [] },
  created_by: { type: ObjectId, ref: 'User' },
}, baseOptions('dispatches'));
DispatchSchema.index({ tenant_id: 1, dispatch_date: -1 });
DispatchSchema.index({ tenant_id: 1, brand_id: 1, dispatch_date: -1 });
DispatchSchema.index({ tenant_id: 1, order_id: 1 });
DispatchSchema.index({ tenant_id: 1, awb: 1 }, { unique: true, ...whenString('awb') });

export const Product = mongoose.model('Product', ProductSchema);
export const Order = mongoose.model('Order', OrderSchema);
export const OrderEvent = mongoose.model('OrderEvent', eventSchema('order_id', 'order_events'));
export const Customisation = mongoose.model('Customisation', CustomisationSchema);
export const Payment = mongoose.model('Payment', PaymentSchema);
export const Dispatch = mongoose.model('Dispatch', DispatchSchema);
