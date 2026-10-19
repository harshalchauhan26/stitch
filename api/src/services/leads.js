// Leads: manual entry, field edits, items, stage moves with gates, Lost / reopen, undo (PLAN §7, §8)
import mongoose from 'mongoose';
import { CLIENT_PATHS, ITEM_PATHS } from '../catalogue.js';
import { withTransaction } from '../db.js';
import { INTAKE_METHODS, LOST_REASONS, REOPEN_WINDOW_DAYS } from '../lib/constants.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { parseFieldValue } from '../lib/fields.js';
import { id, int, oneOf, str } from '../lib/validate.js';
import { Brand, Client, Counter, Lead, LeadEvent, Product } from '../models/index.js';
import { clientInput, findOrCreateClient } from './clients.js';
import { commitWrite, writeEvent } from './events.js';
import { blockersForMove, computeGaps, gapCounts } from './gaps.js';
import { loadBrandRules } from './rules.js';
import { canOwnBrand, requireBrand } from './scope.js';

const ITEM_ATTRS = ['product', 'quantity', 'wearer', 'unit_price', 'product_id'];   // stored on the item, not in item.fields
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function nextNumber(key, session, start) {
  const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session }).lean();
  return start + c.seq;
}

/** Loads a lead the caller may see. 404 (not 403) for other brands, so ids of other brands are not revealed. */
export async function getLead(scope, leadId, session) {
  const lead = await Lead.findOne({ _id: id(leadId, 'lead id'), tenant_id: scope.tenantId }).session(session ?? null).lean();
  if (!lead || !scope.canSeeBrand(lead.brand_id)) throw notFound('Lead');
  return lead;
}

function requireEditable(lead) {
  if (lead.stage_type === 'won') throw conflict(`This lead is ${lead.stage} and read-only. Edit its order instead.`, { code: 'lead_locked', order_id: lead.converted_order_id });
  if (lead.stage_type === 'lost') throw conflict(`This lead is ${lead.stage}. Reopen it to make changes.`, { code: 'lead_lost' });
}

function requireVersion(body) {
  return int(body?.version, 'version', { required: true, min: 1 });
}

/** A field the caller may set on this brand's leads: known, visible for the brand, not computed by Stitch. */
function writableDef(rb, key, scope) {
  const def = rb.defs.get(key);
  if (!def || !def.record_types.includes('lead')) throw badRequest(`Field "${key}" does not exist`);
  if (def.scope !== scope) throw badRequest(`"${key}" is a ${def.scope} field, not a ${scope} field`);
  if (!rb.visible.lead.has(key) && !(scope === 'item' && ITEM_PATHS[key])) throw badRequest(`This brand does not use "${def.label}"`);
  if (def.computed) throw badRequest(`${def.label} is filled in by Stitch (${def.hint || 'from payments'}) and cannot be typed`);
  return def;
}

function parseLeadFields(rb, input = {}) {
  if (typeof input !== 'object' || Array.isArray(input)) throw badRequest('fields must be an object');
  const out = {};
  for (const [k, v] of Object.entries(input)) out[k] = parseFieldValue(writableDef(rb, k, 'lead'), v);
  return out;
}

async function parseItem(rb, scope, brandId, raw, existing = null) {
  const item = existing ? { ...existing, fields: { ...existing.fields } } : { _id: new mongoose.Types.ObjectId(), fields: {}, quantity: 1, product_id: null, unit_price: null, wearer: null };
  if (raw.product_id !== undefined) {
    item.product_id = id(raw.product_id, 'product_id', { required: false });
    if (item.product_id) {
      const p = await Product.findOne({ _id: item.product_id, tenant_id: scope.tenantId, brand_id: brandId, active: true }).lean();
      if (!p) throw badRequest('That product is not in this brand\'s catalogue');
      if (raw.product === undefined && !existing) item.product = p.name;
      if (raw.unit_price === undefined && item.unit_price == null) item.unit_price = p.base_price;
    }
  }
  if (raw.product !== undefined) item.product = str(raw.product, 'Product', { required: true, max: 200 });
  if (!item.product) throw badRequest('Each item needs a product, e.g. "Bridal lehenga"');
  if (raw.quantity !== undefined) item.quantity = int(raw.quantity, 'Quantity', { required: true, min: 1, max: 50 });
  if (raw.wearer !== undefined) item.wearer = str(raw.wearer, 'Wearer', { max: 120 });
  if (raw.unit_price !== undefined) item.unit_price = int(raw.unit_price, 'Unit price', { min: 0 });
  if (raw.fields !== undefined) {
    if (typeof raw.fields !== 'object' || Array.isArray(raw.fields)) throw badRequest('item fields must be an object');
    for (const [k, v] of Object.entries(raw.fields)) {
      if (ITEM_PATHS[k]) throw badRequest(`Set "${k}" on the item itself, not in its fields`);
      item.fields[k] = parseFieldValue(writableDef(rb, k, 'item'), v);
      if (item.fields[k] === null) delete item.fields[k];
    }
  }
  return item;
}

/** Field-level changes between two item lists, for the event */
function itemChanges(before, after) {
  const changes = [];
  const prev = new Map(before.map((i) => [String(i._id), i]));
  for (const it of after) {
    const old = prev.get(String(it._id));
    if (!old) { changes.push({ field: 'item', scope: 'item', item_id: it._id, old: null, new: it.product }); continue; }
    if (!old.removed_at && it.removed_at) { changes.push({ field: 'item', scope: 'item', item_id: it._id, old: old.product, new: null }); continue; }
    for (const k of ITEM_ATTRS) if (!same(old[k], it[k])) changes.push({ field: k, scope: 'item', item_id: it._id, old: old[k] ?? null, new: it[k] ?? null });
    for (const k of new Set([...Object.keys(old.fields || {}), ...Object.keys(it.fields || {})])) {
      if (!same(old.fields?.[k], it.fields?.[k])) changes.push({ field: k, scope: 'item', item_id: it._id, old: old.fields?.[k] ?? null, new: it.fields?.[k] ?? null });
    }
  }
  return changes;
}

const gapsFor = (lead, client, rb) => computeGaps({ recordType: 'lead', stage: lead.stage, lead, client }, rb);

// ---------------------------------------------------------------- create

export async function createLead(scope, body = {}) {
  const brandId = id(body.brand_id, 'brand_id');
  requireBrand(scope, brandId);
  const brand = await Brand.findOne({ _id: brandId, tenant_id: scope.tenantId }).lean();
  if (!brand) throw notFound('Brand');
  if (brand.status !== 'active') throw badRequest(`${brand.name} is archived`);
  const ownerId = id(body.owner_id ?? String(scope.user._id), 'owner_id');
  if (!await canOwnBrand(scope.tenantId, ownerId, brandId)) throw badRequest('The owner must be in a team that handles this brand');
  if (!body.client || typeof body.client !== 'object') throw badRequest('client is required, at least { phone }');

  const rb = await loadBrandRules(scope.tenantId, brandId);
  const fields = parseLeadFields(rb, body.fields);
  for (const k of Object.keys(fields)) if (fields[k] === null) delete fields[k];
  const items = [];
  for (const raw of body.items ?? []) items.push(await parseItem(rb, scope, brandId, raw));
  const intake = oneOf(body.intake_method, 'intake_method', INTAKE_METHODS) ?? 'Manual';

  return withTransaction(async (session) => {
    const { client, created, warnings } = await findOrCreateClient(scope, body.client, session);
    // one purchase = one lead: warn when this client already has an open lead with this brand (PLAN §13)
    if (!created && body.confirm_new_purchase !== true) {
      const open = await Lead.findOne({ tenant_id: scope.tenantId, client_id: client._id, brand_id: brandId, stage_type: 'open' }).select('lead_no stage').session(session).lean();
      if (open) {
        throw conflict(`${client.name || client.phone_e164} already has open lead ${open.lead_no} with ${brand.name}. Add the products there, or send confirm_new_purchase: true if this is a separate purchase.`,
          { code: 'open_lead_exists', lead_id: open._id, lead_no: open.lead_no });
      }
    }
    const lead = {
      _id: new mongoose.Types.ObjectId(), tenant_id: scope.tenantId, lead_no: `LD-${await nextNumber(`${scope.tenantId}:lead`, session, 1000)}`,
      client_id: client._id, brand_id: brandId, owner_id: ownerId, stage: rb.pipeline.open[0], stage_type: 'open', fields, items, intake_method: intake, created_by: scope.user._id, version: 1,
    };
    Object.assign(lead, gapCounts(gapsFor(lead, client, rb)));
    await Lead.create([lead], { session });
    await writeEvent(session, scope, 'lead', lead, {
      type: 'lead.created',
      changes: [
        ...Object.entries(fields).map(([field, v]) => ({ field, scope: 'lead', old: null, new: v })),
        ...items.map((i) => ({ field: 'item', scope: 'item', item_id: i._id, old: null, new: i.product })),
      ],
      data: { client_created: created, intake_method: intake },
    }, 1);
    return { id: lead._id, warnings };
  });
}

// ---------------------------------------------------------------- edit

/**
 * body: { version, fields?: {...}, client?: {...}, items?: [{ id?, product?, quantity?, wearer?, unit_price?, product_id?, fields?, remove? }], owner_id?, source?, source_message_id? }
 * One event lists every changed value with its old and new value.
 */
export async function updateLead(scope, leadId, body = {}) {
  const version = requireVersion(body);
  return withTransaction(async (session) => {
    const lead = await getLead(scope, leadId, session);
    requireEditable(lead);
    if (lead.version !== version) throw conflict('Someone else changed this lead just now. Reload it and apply your change again.', { code: 'version_conflict', current_version: lead.version });
    const rb = await loadBrandRules(scope.tenantId, lead.brand_id);
    const client = await Client.findById(lead.client_id).session(session);
    const changes = [];

    const fields = { ...lead.fields };
    for (const [k, v] of Object.entries(parseLeadFields(rb, body.fields))) {
      if (same(fields[k], v)) continue;
      changes.push({ field: k, scope: 'lead', old: fields[k] ?? null, new: v });
      if (v === null) delete fields[k]; else fields[k] = v;
    }

    let items = lead.items;
    if (body.items !== undefined) {
      if (!Array.isArray(body.items)) throw badRequest('items must be a list');
      items = lead.items.map((i) => ({ ...i }));
      for (const raw of body.items) {
        if (raw.id) {
          const idx = items.findIndex((i) => String(i._id) === String(raw.id) && !i.removed_at);
          if (idx < 0) throw badRequest(`Item ${raw.id} is not on this lead`);
          items[idx] = raw.remove === true ? { ...items[idx], removed_at: new Date() } : await parseItem(rb, scope, lead.brand_id, raw, items[idx]);
        } else {
          items.push(await parseItem(rb, scope, lead.brand_id, raw));
        }
      }
      changes.push(...itemChanges(lead.items, items));
    }

    if (body.client !== undefined) {
      const input = clientInput(body.client);
      for (const [k, v] of Object.entries(input)) {
        if (same(client[k], v)) continue;
        changes.push({ field: Object.keys(CLIENT_PATHS).find((x) => CLIENT_PATHS[x] === k) ?? k, scope: 'client', old: client[k] ?? null, new: v });
        client[k] = v;
      }
    }

    const set = {};
    let type = 'field.set';
    if (body.owner_id !== undefined) {
      const ownerId = id(body.owner_id, 'owner_id');
      if (String(ownerId) !== String(lead.owner_id)) {
        if (!await canOwnBrand(scope.tenantId, ownerId, lead.brand_id)) throw badRequest('The owner must be in a team that handles this brand');
        changes.push({ field: 'owner_id', scope: 'lead', old: lead.owner_id, new: ownerId });
        set.owner_id = ownerId;
        if (changes.length === 1) type = 'owner.changed';
      }
    }
    if (!changes.length) return { id: lead._id, changed: 0 };

    if (changes.some((c) => c.scope === 'client')) await client.save({ session });
    const next = { ...lead, fields, items };
    Object.assign(set, { fields, items }, gapCounts(gapsFor(next, client, rb)));
    if (changes.every((c) => c.scope === 'item') && changes.length) type = changes.some((c) => c.field === 'item' && c.old === null) ? 'item.added' : changes.some((c) => c.field === 'item' && c.new === null) ? 'item.removed' : 'item.updated';
    await commitWrite(session, scope, 'lead', lead, { $set: set }, {
      type, changes,
      source: oneOf(body.source, 'source', ['manual', 'chat', 'import', 'api']) ?? 'manual',
      source_message_id: id(body.source_message_id, 'source_message_id', { required: false }),
      reason: str(body.reason, 'reason', { max: 500 }),
    });
    return { id: lead._id, changed: changes.length };
  });
}

// ---------------------------------------------------------------- stages

/** body: { version, to, reason?, override? }. Won converts to an order (services/conversion.js). */
export async function moveStage(scope, leadId, body = {}) {
  const version = requireVersion(body);
  const asked = str(body.to, 'to', { required: true, max: 40 });
  const reason = str(body.reason, 'reason', { max: 500 });
  let to = asked;
  const result = await withTransaction(async (session) => {
    const lead = await getLead(scope, leadId, session);
    requireEditable(lead);
    if (lead.version !== version) throw conflict('Someone else changed this lead just now. Reload it and try again.', { code: 'version_conflict', current_version: lead.version });
    const rb = await loadBrandRules(scope.tenantId, lead.brand_id);
    const { flow, won, lost } = rb.pipeline;
    to = flow.find((s) => s.toLowerCase() === asked.toLowerCase());
    if (!to) {
      if (asked.toLowerCase() === lost.toLowerCase()) throw badRequest(`Use "mark lost" to move a lead to ${lost}: it needs a reason`);
      throw badRequest(`"${asked}" is not a stage of ${rb.brand.name}. Stages: ${flow.join(', ')}`);
    }
    if (lead.stage === to) throw badRequest(`The lead is already in ${to}`);
    const from = flow.indexOf(lead.stage), target = flow.indexOf(to);
    const client = await Client.findById(lead.client_id).session(session).lean();
    const rec = { recordType: 'lead', stage: lead.stage, lead, client };

    if (target < from) {                                    // backward: always allowed, with a reason
      if (!reason) throw badRequest('Say why the lead is moving back (reason)');
    } else {
      const blockers = blockersForMove(rec, rb, to);
      if (to === won && rb.brand.defaults?.won_requires_payment_received && !lead.fields.payment_received_date) {
        blockers.push({ field: 'payment_received_date', label: 'Payment received date', level: 'blocking', stage: rb.pipeline.open.at(-1), hint: `${rb.brand.name} requires proof of payment before ${won}` });
      }
      if (blockers.length) {
        const override = body.override === true;
        if (!override) return { blocked: blockers, lead };
        if (!['admin', 'pod_lead'].includes(scope.user.role)) throw forbidden('Only a pod lead or admin can override a blocking gap');
        if (!reason) throw badRequest('An override needs a reason');
        rec.overridden = blockers;
      }
    }

    if (to === won) {
      const { winLead } = await import('./conversion.js');
      return winLead(session, scope, lead, client, rb, { reason, overridden: rec.overridden });
    }
    const next = { ...lead, stage: to };
    await commitWrite(session, scope, 'lead', lead, { $set: { stage: to, stage_changed_at: new Date(), ...gapCounts(gapsFor(next, client, rb)) } }, {
      type: rec.overridden ? 'stage.overridden' : 'stage.moved', changes: [{ field: 'stage', scope: 'lead', old: lead.stage, new: to }], reason,
      data: rec.overridden ? { overridden: rec.overridden.map((g) => g.field) } : null,
    });
    return { id: lead._id, stage: to };
  });
  if (result.blocked) {
    // the refusal is logged outside the (aborted) transaction so pod leads can see where people get stuck
    await writeEvent(null, scope, 'lead', result.lead, { type: 'stage.move_blocked', reason, data: { to, blockers: result.blocked.map((g) => g.field) } });
    throw new HttpError(422, `Cannot move to ${to} yet: ${result.blocked.map((g) => g.label).join(', ')} ${result.blocked.length > 1 ? 'are' : 'is'} missing`, { code: 'blocked', blockers: result.blocked });
  }
  return result;
}

export async function markLost(scope, leadId, body = {}) {
  const version = requireVersion(body);
  const reason = oneOf(body.reason, 'Lost reason', LOST_REASONS, { required: true });
  const note = str(body.note, 'note', { max: 1000 });
  return withTransaction(async (session) => {
    const lead = await getLead(scope, leadId, session);
    requireEditable(lead);
    const { lost } = (await loadBrandRules(scope.tenantId, lead.brand_id)).pipeline;
    await commitWrite(session, scope, 'lead', { ...lead, version }, {
      $set: { stage: lost, stage_type: 'lost', stage_before_lost: lead.stage, stage_changed_at: new Date(), lost_reason: reason, lost_note: note, lost_at: new Date(), open_gap_count: 0, blocking_gap_count: 0 },
    }, { type: 'lead.lost', changes: [{ field: 'stage', scope: 'lead', old: lead.stage, new: lost }, { field: 'lost_reason', scope: 'lead', old: null, new: reason }], reason: note });
    return { id: lead._id, stage: lost };
  });
}

export async function reopenLead(scope, leadId, body = {}) {
  const version = requireVersion(body);
  return withTransaction(async (session) => {
    const lead = await getLead(scope, leadId, session);
    if (lead.stage_type !== 'lost') throw badRequest('Only a lost lead can be reopened');
    const isOwner = String(lead.owner_id) === String(scope.user._id);
    if (!isOwner && !['admin', 'pod_lead'].includes(scope.user.role)) throw forbidden('Only the owner or a pod lead can reopen this lead');
    if (Date.now() - new Date(lead.lost_at).getTime() > REOPEN_WINDOW_DAYS * 86400000) throw badRequest(`Leads can be reopened within ${REOPEN_WINDOW_DAYS} days of being lost. Create a new lead instead.`);
    const rb = await loadBrandRules(scope.tenantId, lead.brand_id);
    // back to where it was, or the first stage if the brand's pipeline no longer has that stage
    const to = rb.pipeline.open.includes(lead.stage_before_lost) ? lead.stage_before_lost : rb.pipeline.open[0];
    const client = await Client.findById(lead.client_id).session(session).lean();
    await commitWrite(session, scope, 'lead', { ...lead, version }, {
      $set: { stage: to, stage_type: 'open', stage_changed_at: new Date(), lost_reason: null, lost_note: null, lost_at: null, ...gapCounts(gapsFor({ ...lead, stage: to, stage_type: 'open' }, client, rb)) },
      $inc: { reopened_count: 1 },
    }, { type: 'lead.reopened', changes: [{ field: 'stage', scope: 'lead', old: lead.stage, new: to }], reason: str(body.reason, 'reason', { max: 500 }) });
    return { id: lead._id, stage: to };
  });
}

/** Undo a field.set / item event: only if those values have not changed since (PLAN §8.2 rule 3) */
export async function undoEvent(scope, leadId, eventId, body = {}) {
  const version = requireVersion(body);
  const ev = await LeadEvent.findOne({ _id: id(eventId, 'event id'), tenant_id: scope.tenantId, lead_id: id(leadId, 'lead id') }).lean();
  if (!ev) throw notFound('Event');
  if (!['field.set', 'item.updated'].includes(ev.type)) throw badRequest('Only field changes can be undone');
  const lead = await getLead(scope, leadId);
  const fields = {}, items = new Map();
  for (const c of ev.changes) {
    let now;
    if (c.scope === 'lead' && c.field !== 'owner_id') {
      now = lead.fields[c.field];
      fields[c.field] = c.old;
    } else if (c.scope === 'item' && c.field !== 'item') {
      const cur = lead.items.find((i) => String(i._id) === String(c.item_id) && !i.removed_at);
      if (!cur) throw conflict('That item has been removed since, so this cannot be undone', { code: 'undo_stale' });
      const onItem = ITEM_ATTRS.includes(c.field);
      now = onItem ? cur[c.field] : cur.fields?.[c.field];
      const it = items.get(String(c.item_id)) ?? { id: String(c.item_id), fields: {} };
      if (onItem) it[c.field] = c.old; else it.fields[c.field] = c.old;
      items.set(String(c.item_id), it);
    } else throw badRequest('This change cannot be undone automatically');
    if (!same(now, c.new)) throw conflict(`${c.field} has changed since then, so this cannot be undone`, { code: 'undo_stale' });
  }
  return updateLead(scope, leadId, { version, fields, items: items.size ? [...items.values()] : undefined, reason: `Undo of change ${ev._id}` });
}
