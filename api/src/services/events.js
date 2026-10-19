// The audit trail (PLAN §8): every write to a lead or order writes exactly one event, in the same transaction,
// and the write only succeeds if nobody changed the record since it was read (optimistic lock on `version`).
import { conflict } from '../lib/errors.js';
import { Lead, LeadEvent, Order, OrderEvent } from '../models/index.js';
import { actorFor } from './scope.js';

const MODELS = { lead: [Lead, LeadEvent, 'lead_id'], order: [Order, OrderEvent, 'order_id'] };

/**
 * Applies `update` to the record at `record.version`, bumps the version and writes the event.
 * event: { type, changes?, item_id?, reason?, source?, source_message_id?, data? }
 * Returns the new version. Throws 409 version_conflict if the record changed in the meantime.
 */
export async function commitWrite(session, scope, recordType, record, update, event) {
  const [Model] = MODELS[recordType];
  const set = { ...(update.$set || {}), updated_at: new Date() };
  const r = await Model.updateOne(
    { _id: record._id, tenant_id: record.tenant_id, version: record.version },
    { ...update, $set: set, $inc: { ...(update.$inc || {}), version: 1 } },
    { session },
  );
  if (!r.matchedCount) {
    const now = await Model.findById(record._id).select('version').lean();
    throw conflict(`Someone else changed this ${recordType} just now. Reload it and apply your change again.`, { code: 'version_conflict', current_version: now?.version ?? null });
  }
  const version = record.version + 1;
  await writeEvent(session, scope, recordType, record, event, version);
  return version;
}

/** An event without a record write, e.g. a refused stage move */
export async function writeEvent(session, scope, recordType, record, event, version = record.version) {
  const [, EventModel, key] = MODELS[recordType];
  await EventModel.create([{
    tenant_id: record.tenant_id, [key]: record._id, item_id: event.item_id ?? null, type: event.type, changes: event.changes ?? [],
    actor: actorFor(scope, record.brand_id), source: event.source ?? 'manual', source_message_id: event.source_message_id ?? null,
    reason: event.reason ?? null, data: event.data ?? null, record_version: version,
  }], { session });
}

export const eventDto = (e) => ({
  id: e._id, type: e.type, at: e.at, actor: e.actor, item_id: e.item_id, changes: e.changes, source: e.source,
  source_message_id: e.source_message_id, reason: e.reason, data: e.data, version: e.record_version,
});
