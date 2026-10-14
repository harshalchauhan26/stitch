// Chat upload pipeline:  parse -> code signals -> (AI) -> validate/merge -> draft row  ... then confirm -> real leads.
import crypto from 'node:crypto';
import { ValidationError, parseDate } from '../lib.js';
import { parseWhatsApp } from './whatsappParser.js';
import { extractSignals, last10 } from './signals.js';
import { reconcile } from './reconcile.js';
import { visibleBrands } from '../repo.js';
import { createLead } from '../services/records.js';
import { HttpError } from '../services/gaps.js';

export const LIMITS = { chats: 30, totalChars: 6_000_000, perChatChars: 800_000 };
const hash = (t) => crypto.createHash('sha256').update(t.replace(/\s+/g, ' ').trim()).digest('hex');

function existingLeadByPhone(db, scope, phone) {
  const key = last10(phone); if (!key) return null;
  for (const r of db.prepare('SELECT id, brand, fields FROM leads WHERE tenant_id = ?').all(scope.tenantId)) {
    if (scope.brands && !scope.brands.includes(r.brand)) continue;
    if (last10(JSON.parse(r.fields).phone) === key) return r.id;
  }
  return null;
}

/** One chat -> one draft. Never throws for a bad chat: the item comes back with status 'failed' and a reason. */
async function processOne(db, scope, chat, { llm, brands, batchId }) {
  const name = String(chat?.name || 'chat.txt').slice(0, 200);
  const text = String(chat?.text || '');
  const fail = (error) => ({ id: null, fileName: name, status: 'failed', error });
  if (!text.trim()) return fail('The file is empty');
  if (text.length > LIMITS.perChatChars) return fail('This chat is too large (over 800,000 characters)');
  const parsed = parseWhatsApp(text);
  if (!parsed.messages.length) return fail('This does not look like a WhatsApp chat export (no messages found)');

  const signals = extractSignals(parsed, { fileName: name, brands });
  let llmRaw = null, usage = null, mode = 'code', aiError = null;
  if (llm) {
    try { const r = await llm(parsed); llmRaw = r.result; usage = r.usage; mode = 'llm'; }
    catch (e) { aiError = e.message; }                          // fall back to code-only for this chat
  }
  const rec = reconcile({ parsed, signals, llmRaw, brands });
  const h = hash(text);
  const dupIng = db.prepare(`SELECT id FROM ingestions WHERE tenant_id = ? AND content_hash = ? AND status IN ('ready','confirmed') ORDER BY id DESC LIMIT 1`).get(scope.tenantId, h);
  const phone = rec.fields.phone?.value;
  const item = { fileName: name, status: 'ready', mode, aiError, stats: signals.stats, brand: rec.brand, fields: rec.fields, summary: rec.summary, intent: rec.intent,
    missing: rec.missing, referenceLinks: rec.referenceLinks, duplicateLead: phone ? existingLeadByPhone(db, scope, phone) : null, duplicateUpload: dupIng?.id ?? null, usage };
  const r = db.prepare(`INSERT INTO ingestions (tenant_id, batch_id, user_id, file_name, content_hash, status, mode, raw_text, result, llm_usage) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(scope.tenantId, batchId, scope.user.id, name, h, 'ready', mode, text, JSON.stringify(item), usage ? JSON.stringify(usage) : null);
  return { id: Number(r.lastInsertRowid), ...item };
}

export async function processBatch(db, scope, chats, { llm = null } = {}) {
  if (!Array.isArray(chats) || !chats.length) throw new ValidationError('Add at least one chat');
  if (chats.length > LIMITS.chats) throw new ValidationError(`Upload at most ${LIMITS.chats} chats at a time`);
  if (chats.reduce((n, c) => n + String(c?.text || '').length, 0) > LIMITS.totalChars) throw new ValidationError('These chats are too large to read together. Upload fewer at a time');
  const brands = visibleBrands(db, scope).map(({ code, name }) => ({ code, name }));
  const batchId = crypto.randomUUID();
  const items = new Array(chats.length);
  let next = 0;                                                  // small worker pool: 3 chats at a time
  await Promise.all(Array.from({ length: Math.min(3, chats.length) }, async () => {
    while (next < chats.length) { const i = next++; items[i] = await processOne(db, scope, chats[i], { llm, brands, batchId }); }
  }));
  // same phone twice in one upload -> flag the later ones
  const seen = new Map();
  for (const it of items) { const p = it.fields?.phone?.value && last10(it.fields.phone.value); if (!p) continue; if (seen.has(p)) it.duplicateInBatch = seen.get(p); else seen.set(p, it.fileName); }
  const usage = items.reduce((u, it) => ({ input: u.input + (it.usage?.input || 0), output: u.output + (it.usage?.output || 0) }), { input: 0, output: 0 });
  return { batchId, mode: llm ? 'llm' : 'code', items, usage };
}

const val = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : v);

/** The associate reviewed the table: create one lead per included row (values may have been edited). */
export function confirmBatch(db, scope, rows, now = new Date()) {
  if (!Array.isArray(rows) || !rows.length) throw new ValidationError('Nothing to create');
  const created = [], failed = [], skipped = [];
  for (const row of rows) {
    if (row.include === false) { skipped.push(row.id); continue; }
    try {
      const ing = db.prepare(`SELECT * FROM ingestions WHERE id = ? AND tenant_id = ?`).get(row.id, scope.tenantId);
      if (!ing) throw new HttpError(404, 'This upload was not found');
      if (ing.status === 'confirmed') throw new HttpError(409, `Already created as ${ing.lead_id}`);
      const v = row.values || {}; const draft = JSON.parse(ing.result);
      const name = val(v.customer_name) || val(v.phone) || draft.fields.phone?.value || 'Unknown customer';
      const min = val(v.budget_min) != null ? Number(v.budget_min) : null, max = val(v.budget_max) != null ? Number(v.budget_max) : min;
      const body = {
        customer_name: String(name).trim(), brand: v.brand, owner_id: val(v.owner_id), event_date: val(v.event_date), order_value: v.currency === 'INR' && min ? Math.round((min + (max ?? min)) / 2) : null,
        phone: val(v.phone), country: val(v.country), city: val(v.city), product: val(v.product), occasion_type: val(v.occasion_type), quantity: val(v.quantity),
        budget_min: min, budget_max: max, currency: val(v.currency), size: val(v.size), notes: val(v.notes) ?? draft.summary,
        lead_source: 'WhatsApp', intake_method: 'Chat export', original_chat_file: ing.file_name, source_ingestion: ing.id,
        reference_links: draft.referenceLinks || [], buying_intent: draft.intent, last_contacted: draft.stats?.lastDate || null,
      };
      Object.keys(body).forEach((k) => body[k] === null && delete body[k]);
      body.customer_name = String(name).trim(); body.brand = v.brand;
      if (body.event_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) body.event_date = parseDate(body.event_date, now);
      const lead = createLead(db, scope, body, now);
      db.prepare(`UPDATE ingestions SET status = 'confirmed', lead_id = ? WHERE id = ?`).run(lead.record.id, ing.id);
      created.push({ id: row.id, leadId: lead.record.id, gaps: lead.gaps.length });
    } catch (e) { failed.push({ id: row.id, error: e.message }); }
  }
  return { created, failed, skipped };
}