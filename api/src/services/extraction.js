// Chat -> suggestions (PLAN §10.4, docs/EXTRACTION_FLOW.md).
//
// The idea: an LLM reads ONE customer chat against the brand's own schema (field_defs + required_rules) and proposes values
// for the fields. It never writes to a lead. Every value it proposes is first checked by the SAME code a manual edit goes
// through (parseFieldValue, writableDef, clientInput), so the model cannot put anything in the database that a person could
// not type in. What passes becomes a pending suggestion that a person accepts or dismisses; what does not pass is kept in a
// separate "exceptions" list with the reason, so nothing is silently dropped.
//
// The only thing written without a click is the empty lead (and its product lines) when a chat starts a NEW lead, because
// the suggestions need a lead to hang on to.
//
// Layout of this file, top to bottom:
//   1. what the model may fill      fillable(), schemaFor(), schemaText(), buildPrompt()
//   2. checking what came back      parseJson(), liftProducts(), readNewItems(), validateOutput(), coverage()   (all DB-free)
//   3. running it                   extractFromChat() (one run), decide() (accept / dismiss)
import fs from 'node:fs';
import { CLIENT_PATHS } from '../catalogue.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { conditionHolds, isFilled, parseFieldValue, valueOf } from '../lib/fields.js';
import { id, ids, int, str, todayIso } from '../lib/validate.js';
import { Client, Extraction, Lead, Message, Product } from '../models/index.js';
import { clientInput } from './clients.js';
import { getConversation, linkLead } from './conversations.js';
import { complete } from './llm.js';
import { createLead, getLead, updateLead, writableDef } from './leads.js';
import { recountLeads } from './recount.js';
import { loadBrandRules } from './rules.js';

// The domain rules the model is given (distilled from the Field & Flow spec). Read once at start-up.
const GUIDE = fs.readFileSync(new URL('../prompts/extraction.md', import.meta.url), 'utf8');

// Groq's on-demand tier allows 8,000 tokens a minute, answer included: the newest part of a long chat is read
// (EXTRACT_MAX_CHARS to change; raise it after upgrading the Groq tier)
const maxChars = () => Number(process.env.EXTRACT_MAX_CHARS) || 8_000;

// "Is the model's value the same as what is stored?" Text is compared ignoring case and spaces ("v" and "V" are the same
// neckline); everything else (numbers, dates, objects) by value. Used to skip suggestions that would change nothing.
const same = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.trim().toLowerCase() === b.trim().toLowerCase() : JSON.stringify(a ?? null) === JSON.stringify(b ?? null));

// The model talks in rupees ("2 lakh" -> 200000), the database stores paise (PLAN §5, money is the smallest unit).
// A number is multiplied by 100; a string like "₹2,45,000" or "Rs. 245000" is cleaned first. Anything that is still not a
// number is returned untouched so the normal parsing rejects it with a readable message.
const money = (v) => {
  if (typeof v === 'number') return Math.round(v * 100);
  const n = Number(String(v).replace(/[₹,\s]|rs\.?|inr/gi, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : v;
};

// Item attributes live on the item itself, not inside item.fields (services/leads.js ITEM_ATTRS), and they are not all in
// field_defs, so they get their own small validators. Each returns the cleaned value or throws a readable 400.
const ATTR = {
  quantity: (v) => int(v, 'Quantity', { min: 1, max: 50 }),
  wearer: (v) => str(v, 'Wearer', { max: 120 }),
  unit_price: (v) => int(money(v), 'Price per piece', { min: 0 }),
};
// "Wearer" and "Price per piece" are not catalogue fields, but a chat often says them ("it is for my sister", "quoted 1.8 lakh
// for the lehenga"), so they are offered to the model next to the catalogue's item fields.
const EXTRA_ITEM = [
  { key: 'wearer', label: 'Wearer (who the outfit is for)', scope: 'item', type: 'text' },
  { key: 'unit_price', label: 'Price per piece', scope: 'item', type: 'currency' },
];

// ---------------------------------------------------------------- what the model may fill

/**
 * Every field this brand asks for on a lead that a chat could supply, keyed by field key: { def, stage, level }.
 * Built from the brand's required_rules, so a field the brand does not use (no rule) is never offered and can never be filled
 * (spec §6), and custom fields the brand added are included automatically. Left out on purpose:
 *   - computed fields (advance amount, payment link ... are calculated from the payments ledger, PLAN §5.18)
 *   - phone (it identifies the client, it is not edited from a chat)
 *   - product (a product is an item, added through new_items, not a field)
 */
export function fillable(rb) {
  const out = new Map();
  for (const stage of rb.pipeline.open) {
    for (const r of rb.rules.lead) {
      const d = rb.defs.get(r.field);
      if (r.stage !== stage || !d || d.computed || out.has(d.key) || ['phone', 'product'].includes(d.key)) continue;
      out.set(d.key, { def: d, stage, level: r.level });
    }
  }
  return out;
}

// Drops empty values so the schema sent to the model stays small (every token counts against Groq's per-minute limit).
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));
// "only when country is not India": the conditional rules from field_defs.applies_when, written so the model can read them
const cond = (c) => c && `${c.field} ${c.op === 'eq' ? 'is' : 'is not'} ${c.value}`;

/** The fields as plain objects: key, label, scope, type, options, unit, limits, hint, conditions, stage, level */
export function schemaFor(fill) {
  const list = [...fill.values()].map(({ def, stage, level }) => compact({
    key: def.key, label: def.label, scope: def.scope, type: def.type, options: def.options, unit: def.unit, min: def.min, max: def.max,
    hint: def.hint, done_when: def.done_values, only_when: cond(def.applies_when), stage, level,
  }));
  for (const e of EXTRA_ITEM) if (!fill.has(e.key)) list.push(compact({ ...e, level: 'optional' }));
  return list;
}

/**
 * The same list as schemaFor(), one short line per field: what the model needs to fill it, nothing more.
 * Roughly half the size of the JSON form, which is what lets the whole schema plus a chat fit into Groq's token limit.
 * Example line:   blouse_size | item | select | one of: XS / S / M / L / XL / XXL / Custom
 */
export function schemaText(fill) {
  const line = (f) => [
    f.key, f.scope, f.unit ? `${f.type} in ${f.unit}${f.min != null ? ` ${f.min}-${f.max}` : ''}` : f.type,
    f.options && `one of: ${f.options.join(' / ')}`, f.done_when && `counts only as ${f.done_when.join(' / ')}`, f.only_when && `only when ${f.only_when}`, f.hint,
  ].filter(Boolean).join(' | ');
  return `key | scope | type | notes\n${schemaFor(fill).map(line).join('\n')}`;
}

const activeItems = (lead) => (lead.items || []).filter((i) => !i.removed_at);
const rupees = (p) => (p == null ? null : p / 100);

/**
 * The two messages sent to the model.
 *   system = the domain guide + the brand's fillable fields + the brand's product catalogue
 *   user   = what Stitch already knows (so the model skips what is filled) + the numbered chat
 * Chat lines look like `[12] CUSTOMER (+91 98111 22222): text`; the number is how the model points at the message a value
 * came from (it becomes source_message_id). A chat longer than maxChars() keeps its NEWEST lines.
 * Returns { system, user, read, truncated } so the screen can say how much of the chat was read.
 */
export function buildPrompt({ rb, fill, client, lead, products, messages, today }) {
  const items = activeItems(lead);
  // "Already known": item numbers here (1, 2 ...) are the numbers the model must use when it answers about an item
  const known = {
    today, brand: rb.brand.name, lead_stage: lead.stage ?? rb.pipeline.open[0],
    customer: compact({ name: client.name, email: client.email, city: client.city, whatsapp_consent: client.whatsapp_consent === 'Unknown' ? null : client.whatsapp_consent, customer_type: client.customer_type }),
    lead_fields: lead.fields ?? {},
    items: items.map((i, n) => ({ item: n + 1, product: i.product, quantity: i.quantity, wearer: i.wearer, unit_price_rupees: rupees(i.unit_price), fields: i.fields ?? {} })),
  };
  const lines = messages.map((m) => `[${m.idx}] ${m.role.toUpperCase()} (${m.sender ?? '?'}): ${m.text || ''}${m.media ? ` <${m.media}>` : ''}`);
  // walk backwards from the newest message until the character budget is used up
  let used = 0, from = lines.length;
  while (from > 0 && used + lines[from - 1].length < maxChars()) used += lines[--from].length + 1;
  const catalogue = products.slice(0, 30).map((p) => `${p.sku} | ${p.name} | ${rupees(p.base_price) ?? '-'}`).join('\n');
  const system = `${GUIDE}\n\n## Fields you may fill\n${schemaText(fill)}\n\n## Product catalogue (sku | name | price in rupees)\n${catalogue || '(none)'}`;
  const omitted = from ? `(${from} earlier messages are not shown)\n` : '';
  return { system, user: `## Already known\n${JSON.stringify(known)}\n\n## Chat\n${omitted}${lines.slice(from).join('\n')}`, read: lines.length - from, truncated: from > 0 };
}

// The model is asked for a JSON object, but may still wrap it in a ```json fence. Anything that is not a JSON object fails the
// whole run with a clear 502 (and the first 500 characters of what came back, for debugging) instead of guessing.
function parseJson(text) {
  const s = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { const j = JSON.parse(s); if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch { /* below */ }
  throw new HttpError(502, 'The model did not return valid JSON, so nothing was read from this chat', { code: 'llm_bad_output', raw: String(text ?? '').slice(0, 500) });
}

// ---------------------------------------------------------------- checking what came back
// Everything in this section is pure (no database), so it is unit tested without MongoDB: tests/extraction-validate.test.js

/**
 * Models sometimes list the product as a field ("product", "sku") instead of under new_items, which the prompt asks for.
 * Without this the lead would be created with NO product line and every item detail (neckline, measurements ...) would be
 * rejected as "item 1 is not on this lead". So: lift those entries into new_items (with the quantity given for the same item
 * number) and drop them from the suggestions. If the model did give new_items, its own list wins.
 */
export function liftProducts(out) {
  const list = Array.isArray(out?.suggestions) ? out.suggestions : [];
  const lifted = new Map(), rest = [];
  for (const s of list) {
    const key = String(s?.field ?? '').trim();
    if (key !== 'product' && key !== 'sku') { rest.push(s); continue; }
    const n = Number(s.item) || 1;                                   // no item number means the first product
    const cur = lifted.get(n) ?? { message: s.message, confidence: s.confidence, evidence: s.evidence };
    if (key === 'product') cur.product = s.value; else cur.sku = s.value;
    lifted.set(n, cur);
  }
  if (!lifted.size) return out;
  const asked = Array.isArray(out.new_items) ? out.new_items : [];
  const items = [...lifted].map(([n, i]) => ({ ...i, product: i.product ?? i.sku, quantity: list.find((s) => s?.field === 'quantity' && (Number(s.item) || 1) === n)?.value }));
  return { ...out, suggestions: rest, new_items: asked.length ? asked : items };
}

// confidence comes back as any number or string: keep it between 0 and 1, or null when it is missing / not a number
const clamp = (c) => (Number.isFinite(Number(c)) && c !== null && c !== '' ? Math.min(1, Math.max(0, Number(c))) : null);
// the short quote the model gives as proof, capped so one bad answer cannot bloat the document
const evidenceOf = (s) => (s?.evidence ? String(s.evidence).slice(0, 200) : null);

/**
 * The products the model wants on the lead -> { items, exceptions }.
 * A product is matched to the brand's catalogue by SKU when the model gives one (that also fills the price from the
 * catalogue when the item is created); otherwise the name is used as the customer said it. A product with no name, or a
 * quantity outside 1-50, becomes an exception instead of an item.
 * ctx: { products: Map(SKU -> product), msg: Map(chat line number -> message id) }
 */
export function readNewItems(out, { products, msg }) {
  const items = [], exceptions = [];
  for (const n of Array.isArray(out?.new_items) ? out.new_items : []) {
    const at = { scope: 'new_item', field: 'item', message_id: msg.get(Number(n?.message)) ?? null, evidence: evidenceOf(n) };
    let product, quantity = 1;
    try { product = str(n?.product, 'Product', { required: true, max: 200 }); if (n.quantity != null) quantity = int(n.quantity, 'Quantity', { min: 1, max: 50 }); }
    catch (e) { exceptions.push({ ...at, code: 'invalid_value', value: n?.product ?? null, reason: e.message }); continue; }
    const p = n.sku ? products.get(String(n.sku).trim().toUpperCase()) : null;
    items.push({ product, product_id: p?._id ?? null, quantity, confidence: clamp(n.confidence), source_message_id: at.message_id, evidence: at.evidence });
  }
  return { items, exceptions };
}

/**
 * The model's answer -> { suggestions, exceptions, keys }.
 * A value is kept only if the manual edit path would accept it; everything else is reported with the reason:
 *   unknown_field   Stitch has no such field            computed       filled by Stitch from payments
 *   not_allowed     phone / product                      not_used       the brand does not use the field
 *   bad_item        the item number is not on the lead   invalid_value  wrong type, range, option, date, email ...
 * Values that equal what is already stored, empty values, and weaker duplicates of the same field are dropped quietly: they
 * are not mistakes. `keys` is the set of fields that got a suggestion (used for the coverage report).
 * ctx: { rb, fill, client, lead, products, msg, addItems }  (addItems: products to propose for an EXISTING lead)
 */
export function validateOutput(out, ctx) {
  const { rb, fill, client, lead, msg } = ctx;
  const items = activeItems(lead);
  const kept = new Map(), exceptions = [];
  const raise = (s, code, reason, scope = null) => exceptions.push({ code, scope, field: s?.field ?? null, item: s?.item ?? null, value: s?.value ?? null, reason, message_id: msg.get(Number(s?.message)) ?? null, evidence: evidenceOf(s) });

  for (const s of Array.isArray(out?.suggestions) ? out.suggestions : []) {
    if (s?.value === null || s?.value === undefined || String(s.value).trim() === '') continue;        // nothing found is not an error
    const key = String(s.field ?? '').trim();
    const attr = ATTR[key];
    const def = rb.defs.get(key) ?? EXTRA_ITEM.find((e) => e.key === key);
    // 1. is it a field we may fill at all?
    if (!def) { raise(s, 'unknown_field', `Stitch has no field called "${key}"`); continue; }
    if (def.computed) { raise(s, 'computed', `${def.label} is filled in by Stitch from payments and cannot be set from a chat`); continue; }
    if (key === 'phone') { raise(s, 'not_allowed', 'The phone number identifies the customer and is not changed from a chat'); continue; }
    if (key === 'product') { raise(s, 'not_allowed', 'Products are added as items, not as a field'); continue; }
    if (!attr && !fill.has(key)) { raise(s, 'not_used', `This brand does not use "${def.label}"`); continue; }

    // 2. which record does it belong to? item fields need an item number that exists on the lead
    const scope = def.scope;
    let item = null;
    if (scope === 'item') {
      item = items[Number(s.item) - 1];
      if (!item) { raise(s, 'bad_item', `Item ${s.item ?? '(none given)'} is not on this lead${items.length ? ` (it has ${items.length})` : ''}. Add the product first, then read the chat again`, 'item'); continue; }
    }

    // 3. does the value pass the exact checks a manual edit goes through?
    let value, current;
    try {
      if (scope === 'client') {
        value = parseFieldValue(def, s.value);
        clientInput({ [CLIENT_PATHS[key]]: value });                                                  // email format, consent and customer type lists
        current = client?.[CLIENT_PATHS[key]];
      } else if (attr) {
        value = attr(s.value);
        current = item[key];
      } else {
        writableDef(rb, key, scope);                                                                  // exists, visible for the brand, not computed
        value = parseFieldValue(def, def.type === 'currency' ? money(s.value) : s.value);            // dates, select casing, cm -> inches, rupees -> paise
        current = scope === 'item' ? item.fields?.[key] : lead.fields?.[key];
      }
    } catch (e) { raise(s, 'invalid_value', e.message, scope); continue; }
    if (value === null || same(value, current)) continue;                                              // already what the chat says

    // 4. one suggestion per field (per item): when the model repeats itself, the more confident one wins
    const k = `${scope}|${key}|${item?._id ?? ''}`;
    const conf = clamp(s.confidence);
    if (kept.has(k) && (kept.get(k).confidence ?? 0) >= (conf ?? 0)) continue;
    kept.set(k, {
      scope, field: key, label: def.label, type: def.type, item_id: item?._id ?? null, value, previous: current ?? null,
      confidence: conf, evidence: evidenceOf(s), source_message_id: msg.get(Number(s.message)) ?? null,
    });
  }

  // products the chat adds to a lead that already exists wait for a person; a new lead gets them at creation
  const suggestions = [...kept.values()];
  if (ctx.addItems) {
    const have = new Set(items.map((i) => i.product.toLowerCase()));
    for (const n of ctx.addItems) {
      if (have.has(n.product.toLowerCase())) continue;
      suggestions.push({ scope: 'new_item', field: 'item', label: 'Add product', type: null, item_id: null, previous: null,
        value: { product: n.product, product_id: n.product_id ? String(n.product_id) : null, quantity: n.quantity }, confidence: n.confidence, evidence: n.evidence, source_message_id: n.source_message_id });
    }
  }
  return { suggestions, exceptions, keys: new Set([...kept.keys()]) };
}

/**
 * The coverage report: for every offered field (per item for item fields), was it filled by this chat ("suggested"), already
 * filled before ("filled"), or could the chat not supply it ("not_found")? Fields whose condition does not hold (duty estimate
 * for a delivery inside India) are left out, they are not missing. This is the measure of "everything that can be filled".
 */
export function coverage(fill, { rb, client, lead, keys }) {
  const rows = [];
  const mark = (def, item) => {
    const ctx = { client, lead, item };
    if (!conditionHolds(def.applies_when, rb.defs, ctx)) return;
    const state = keys.has(`${def.scope}|${def.key}|${item?._id ?? ''}`) ? 'suggested' : isFilled(def, valueOf(def, ctx)) ? 'filled' : 'not_found';
    rows.push({ field: def.key, label: def.label, item_id: item?._id ?? null, state });
  };
  for (const { def } of fill.values()) {
    if (def.scope === 'item') activeItems(lead).forEach((i) => mark(def, i)); else mark(def, null);
  }
  return rows;
}

// ---------------------------------------------------------------- running it

// What the API returns for one run. Ids are exposed as `id` like every other DTO in the API (services/events.js eventDto).
export const extractionDto = (e) => ({
  id: e._id, lead_id: e.lead_id, conversation_id: e.conversation_id, model: e.model, created_at: e.created_at, stats: e.stats, exceptions: e.exceptions,
  suggestions: e.suggestions.map((s) => ({
    id: s._id, scope: s.scope, field: s.field, label: s.label, type: s.type, item_id: s.item_id, value: s.value, previous: s.previous,
    confidence: s.confidence, evidence: s.evidence, source_message_id: s.source_message_id, status: s.status, error: s.error,
  })),
});

/**
 * One run over a chat. body is one of
 *   { lead_id }                                           fill an existing open lead
 *   { create_lead: true, owner_id?, confirm_new_purchase? }  start a new lead from this chat
 * In the second case the lead is created with its product lines (the structure everything else hangs on); every other value
 * comes back as a suggestion. Order matters: all the checks that can refuse (access, brand, open lead, duplicate purchase)
 * run BEFORE the model is called, so a refusal never costs an LLM call, and the lead is created only AFTER the model
 * answered, so a failed LLM call never leaves an empty lead behind.
 */
export async function extractFromChat(scope, conversationId, body = {}) {
  const conv = await getConversation(scope, conversationId);          // 404 for another brand's chat
  const createNew = body.create_lead === true;
  if (!createNew && !body.lead_id) throw badRequest('Say which lead to fill (lead_id), or send create_lead: true to start a new lead from this chat');
  let lead = null;
  if (!createNew) {
    lead = await getLead(scope, body.lead_id);
    if (String(lead.brand_id) !== String(conv.brand_id)) throw badRequest('This chat is on another brand\'s WhatsApp number, so it cannot fill this lead');
    if (lead.stage_type !== 'open') throw conflict(`This lead is ${lead.stage}, so it can no longer be filled from a chat`, { code: 'lead_closed' });
  }
  const client = await Client.findById(conv.client_id).lean();
  // one lead = one purchase (PLAN §13): same warning as adding a lead by hand
  if (createNew && body.confirm_new_purchase !== true) {
    const open = await Lead.findOne({ tenant_id: scope.tenantId, client_id: client._id, brand_id: conv.brand_id, stage_type: 'open' }).select('lead_no').lean();
    if (open) throw conflict(`${client.name || client.phone_e164} already has open lead ${open.lead_no}. Fill that one, or send confirm_new_purchase: true if this chat is a separate purchase.`, { code: 'open_lead_exists', lead_id: open._id, lead_no: open.lead_no });
  }

  // build the context from the database and ask the model
  const rb = await loadBrandRules(scope.tenantId, conv.brand_id);
  const fill = fillable(rb);
  const [messages, productList] = await Promise.all([
    Message.find({ conversation_id: conv._id }).sort({ idx: 1 }).lean(),
    Product.find({ tenant_id: scope.tenantId, brand_id: conv.brand_id, active: true }).sort({ name: 1 }).limit(80).lean(),
  ]);
  const products = new Map(productList.map((p) => [p.sku, p]));       // SKU -> product, for matching the model's products to the catalogue
  const msg = new Map(messages.map((m) => [m.idx, m._id]));           // chat line number -> message id, for source_message_id
  const prompt = buildPrompt({ rb, fill, client, lead: lead ?? { items: [], fields: {} }, products: productList, messages, today: todayIso() });
  const { text, model, cutOff } = await complete(prompt);
  if (cutOff) throw new HttpError(502, 'The model\'s answer was cut off before it finished. Raise EXTRACT_MAX_TOKENS, or read a shorter chat', { code: 'llm_cut_off' });
  const out = liftProducts(parseJson(text));

  // products: a new lead gets them now (through the normal createLead, so owner, duplicate and brand checks apply);
  // for an existing lead they come back as "Add product" suggestions
  const extra = [];
  let addItems = null, warnings = [], created = false;
  if (createNew) {
    const ni = readNewItems(out, { products, msg });
    extra.push(...ni.exceptions);
    const r = await createLead(scope, {
      brand_id: String(conv.brand_id), owner_id: body.owner_id, intake_method: 'Chat export', confirm_new_purchase: body.confirm_new_purchase,
      client: { phone: client.phone_e164, ...(client.name ? { name: client.name } : {}) },
      items: ni.items.map((i) => (i.product_id ? { product_id: String(i.product_id), quantity: i.quantity } : { product: i.product, quantity: i.quantity })),
    });
    lead = await getLead(scope, r.id);
    warnings = r.warnings; created = true;
  } else {
    const ni = readNewItems(out, { products, msg });
    extra.push(...ni.exceptions);
    addItems = ni.items;
  }

  // check everything against the lead as it is now (a new lead already has its items, so "item 1" means something)
  const ctx = { rb, fill, client, lead, products, msg, addItems };
  const v = validateOutput(out, ctx);
  const rows = coverage(fill, { rb, client, lead, keys: v.keys });
  const stats = {
    messages_total: messages.length, messages_read: prompt.read, truncated: prompt.truncated, fields_offered: fill.size + EXTRA_ITEM.length,
    suggested: v.suggestions.length, exceptions: v.exceptions.length + extra.length,
    found: rows.filter((r) => r.state === 'suggested').length, already_filled: rows.filter((r) => r.state === 'filled').length,
    not_found: rows.filter((r) => r.state === 'not_found').map(({ field, label, item_id }) => ({ field, label, item_id })),
  };
  // a new run replaces the pending suggestions of earlier runs for this lead (they are marked dismissed, not deleted)
  await Extraction.updateMany({ tenant_id: scope.tenantId, lead_id: lead._id }, { $set: { 'suggestions.$[s].status': 'dismissed' } }, { arrayFilters: [{ 's.status': 'pending' }] });
  const ex = await Extraction.create({
    tenant_id: scope.tenantId, brand_id: conv.brand_id, lead_id: lead._id, conversation_id: conv._id, model, requested_by: scope.user._id,
    stats, suggestions: v.suggestions, exceptions: [...extra, ...v.exceptions],
  });
  // the chat now belongs to the lead (shows in the lead's chats and history), same as linking it by hand
  try { await linkLead(scope, conv._id, { lead_id: String(lead._id), note: 'Read by the model' }); }
  catch (e) { if (e.status !== 409) throw e; }                                                          // already linked
  return { ...extractionDto(ex), lead: { id: lead._id, lead_no: lead.lead_no, created }, warnings };
}

// Loads a run the caller may see; another brand's run answers 404 like every other record (services/scope.js)
async function loadExtraction(scope, extractionId) {
  const ex = await Extraction.findOne({ _id: id(extractionId, 'extraction id'), tenant_id: scope.tenantId });
  if (!ex || !scope.canSeeBrand(ex.brand_id)) throw notFound('Extraction');
  return ex;
}

/**
 * What accepting one suggestion means as an ordinary lead edit: the body PATCH /leads/:id would take.
 * Reusing updateLead means accepted values get the version check, the audit event, the gap recount and undo for free.
 */
function editFor(s) {
  switch (s.scope) {
    case 'client': return { client: { [CLIENT_PATHS[s.field]]: s.value } };
    case 'lead': return { fields: { [s.field]: s.value } };
    case 'new_item': return { items: [{ ...(s.value.product_id ? { product_id: s.value.product_id } : { product: s.value.product }), quantity: s.value.quantity }] };
    // item: quantity / wearer / unit_price sit on the item itself, everything else in item.fields
    default: return ATTR[s.field]
      ? { items: [{ id: String(s.item_id), [s.field]: s.value }] }
      : { items: [{ id: String(s.item_id), fields: { [s.field]: s.value } }] };
  }
}

/**
 * Accept or dismiss pending suggestions of one run (body.suggestion_ids picks some; none means all of them).
 * Accepting saves each value through updateLead with source 'chat' and the message it came from, one edit at a time with a
 * fresh lead version each time. A suggestion that can no longer be applied (the item was removed, the lead was won in the
 * meantime) is marked failed with the reason; the others still go through. Returns the run plus { applied, failed }.
 */
export async function decide(scope, extractionId, body, action) {
  const ex = await loadExtraction(scope, extractionId);
  const want = ids(body?.suggestion_ids, 'suggestion_ids');
  const pending = ex.suggestions.filter((s) => s.status === 'pending' && (!want || want.some((w) => w.equals(s._id))));
  if (!pending.length) throw badRequest('Nothing pending to decide');
  let applied = 0, failed = 0, clientChanged = false;
  for (const s of pending) {
    s.decided_by = scope.user._id; s.decided_at = new Date();
    if (action === 'dismiss') { s.status = 'dismissed'; continue; }
    try {
      const lead = await getLead(scope, ex.lead_id);                                                     // fresh version for each edit
      await updateLead(scope, lead._id, {
        version: lead.version, ...editFor(s), source: 'chat', source_message_id: s.source_message_id ? String(s.source_message_id) : undefined,
        reason: 'Accepted from a chat suggestion',
      });
      s.status = 'accepted'; applied++;
      if (s.scope === 'client') clientChanged = true;
    } catch (e) { s.status = 'failed'; s.error = e.message; failed++; }
  }
  await ex.save();
  // a client detail (email, city ...) can change the gaps of the client's other open leads too
  if (clientChanged) await recountLeads(scope.tenantId, { client_id: (await getLead(scope, ex.lead_id)).client_id });
  return { ...extractionDto(ex), applied, failed };
}
