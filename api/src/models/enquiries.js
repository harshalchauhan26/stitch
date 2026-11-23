import mongoose from 'mongoose';
import { Schema, baseOptions } from './common.js';

// Early-access / demo requests from the public landing page (frontend/landing). These are people who are not users yet,
// so there is no tenant and no login. An admin reads them with GET /api/enquiries.
const EnquirySchema = new Schema({
  name: { type: String, required: true },
  brand: { type: String, required: true },
  phone: { type: String, required: true },                     // E.164, e.g. +919811115326
  email: { type: String, required: true },                     // lower case
  purpose: { type: String, default: null },                    // what they want from Stitch, in their words
  source: { type: String, default: 'landing_page' },
  status: { type: String, enum: ['new', 'contacted', 'closed'], default: 'new' },
}, baseOptions('enquiries'));
EnquirySchema.index({ created_at: -1 });
EnquirySchema.index({ email: 1, created_at: -1 });

export const Enquiry = mongoose.model('Enquiry', EnquirySchema);
