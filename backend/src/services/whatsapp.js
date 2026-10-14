// WhatsApp service. PHASE 2-4: writes to whatsapp_log with status 'queued' (no real send).
// PHASE 5: replace the marked block with the WhatsApp Cloud API call (see README).
import { ValidationError, toISO } from '../lib.js';

const first = (name) => name.split(' ')[0];
export const TEMPLATES = {
  ask_field: (rec, label) => `Hi ${first(rec.customer_name)}, quick one for order ${rec.id}: could you share your ${label.toLowerCase()}?`,
  nudge: (rec, label) => `Hi ${first(rec.customer_name)}, a gentle reminder about ${label.toLowerCase()} for ${rec.id}. Thank you!`,
  payment_link: (rec) => `Hi ${first(rec.customer_name)}, here is your advance payment link for ${rec.id}: https://pay.stitch.local/${rec.id}`,
  balance_link: (rec) => `Hi ${first(rec.customer_name)}, your outfit is ready. Balance payment link for ${rec.id}: https://pay.stitch.local/${rec.id}-bal`,
  tracking: (rec) => `Hi ${first(rec.customer_name)}, your order ${rec.id} has shipped. Track it here: ${rec.fields.tracking_link || 'https://track.stitch.local/' + rec.id}`,
};

export function assertCanMessage(rec) {
  if (rec.fields.whatsapp_consent !== 'Yes') throw new ValidationError('WhatsApp consent is not Yes for this customer');
  if (!rec.fields.phone) throw new ValidationError('Phone/WhatsApp is missing for this customer');
}

// Returns the field changes the caller must persist (keeps Last contacted fresh, doc 5.6).
export function sendWhatsApp(db, { rec, template, field, label, now }) {
  assertCanMessage(rec);
  const body = TEMPLATES[template](rec, label || '');
  // --- PHASE 5: call WhatsApp Cloud API here, store provider message id + real status ---
  db.prepare(`INSERT INTO whatsapp_log (tenant_id, record_type, record_id, template, field, body, status) VALUES (?,?,?,?,?,?,?)`)
    .run(rec.tenant_id, rec.recordType, rec.id, template, field, body, 'queued');
  return { last_contacted: toISO(now || new Date()) };
}