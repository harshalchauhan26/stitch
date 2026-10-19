// Clients: one per real person, identified by phone (PLAN §5.6)
import { badRequest } from '../lib/errors.js';
import { requirePhone } from '../lib/normalise.js';
import { oneOf, str } from '../lib/validate.js';
import { Client, Conversation, Lead } from '../models/index.js';

const CONSENT = ['Yes', 'No', 'Unknown'];
const CUSTOMER_TYPES = ['New', 'Repeat', 'Referral', 'Trade/Stylist'];
const sameName = (a, b) => String(a).trim().toLowerCase().replace(/\s+/g, ' ') === String(b).trim().toLowerCase().replace(/\s+/g, ' ');

/** Validated client details from a request body. Only keys that were sent are returned. */
export function clientInput(body = {}) {
  const out = {};
  if (body.name !== undefined) out.name = str(body.name, 'Customer name', { max: 120 });
  if (body.email !== undefined) {
    out.email = str(body.email, 'Email', { max: 200 })?.toLowerCase() ?? null;
    if (out.email && !/^\S+@\S+\.\S+$/.test(out.email)) throw badRequest('Email is not valid');
  }
  if (body.city !== undefined) out.city = str(body.city, 'City', { max: 120 });
  if (body.country !== undefined) out.country = str(body.country, 'Country', { max: 80 });
  if (body.whatsapp_consent !== undefined) out.whatsapp_consent = oneOf(body.whatsapp_consent, 'WhatsApp consent', CONSENT) ?? 'Unknown';
  if (body.customer_type !== undefined) out.customer_type = oneOf(body.customer_type, 'Customer type', CUSTOMER_TYPES);
  return out;
}

/**
 * Finds the client by phone or creates them. An existing client is reused: empty details are filled in,
 * different ones are never overwritten but returned as warnings (PLAN §7.1 step 2).
 */
export async function findOrCreateClient(scope, body, session) {
  const phone = requirePhone(body?.phone, 'Phone');
  const input = clientInput(body);
  const warnings = [];
  if (phone.guessed) warnings.push(`No country code given: ${phone.e164} was taken as an Indian number`);
  const existing = await Client.findOne({ tenant_id: scope.tenantId, phone_e164: phone.e164 }).session(session ?? null);
  if (!existing) {
    const [client] = await Client.create([{ tenant_id: scope.tenantId, phone_e164: phone.e164, country: phone.country, ...input, created_by: scope.user._id }], { session });
    return { client, created: true, warnings };
  }
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined) continue;
    const cur = existing[k];
    if (cur === null || cur === undefined || cur === '' || (k === 'whatsapp_consent' && cur === 'Unknown')) existing[k] = v;
    else if (k === 'name' ? !sameName(cur, v) : String(cur) !== String(v)) warnings.push(`This number belongs to an existing client whose ${k.replace('_', ' ')} is "${cur}" (you entered "${v}"). The existing value was kept.`);
  }
  if (existing.isModified()) await existing.save({ session });
  return { client: existing, created: false, warnings };
}

/** Clients a member can see: those with a lead or conversation in one of their brands (PLAN §5.6) */
export async function visibleClientIds(scope) {
  if (scope.isAdmin) return null;
  const f = { tenant_id: scope.tenantId, ...scope.brandFilter() };
  const [a, b] = await Promise.all([Lead.distinct('client_id', f), Conversation.distinct('client_id', f)]);
  return [...new Set([...a, ...b].map(String))];
}

export const clientDto = (c) => c && ({
  id: c._id, phone: c.phone_e164, alt_phones: c.alt_phones, name: c.name, email: c.email, city: c.city, country: c.country,
  whatsapp_consent: c.whatsapp_consent, customer_type: c.customer_type, created_at: c.created_at,
});
