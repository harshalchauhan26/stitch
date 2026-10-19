// The gap counts cached on leads (for list views and badges) depend on things outside the lead: the brand's rules,
// its custom fields and pipeline, and the client's details. When one of those changes, recount the affected open leads.
import { Client, Lead } from '../models/index.js';
import { computeGaps, gapCounts } from './gaps.js';
import { rulesCache } from './rules.js';

/** filter: e.g. { brand_id } or { client_id }. Only the cached counts are written; the lead's version is untouched. */
export async function recountLeads(tenantId, filter) {
  const leads = await Lead.find({ tenant_id: tenantId, stage_type: 'open', ...filter }).lean();
  if (!leads.length) return 0;
  const clients = new Map((await Client.find({ _id: { $in: leads.map((l) => l.client_id) } }).lean()).map((c) => [String(c._id), c]));
  const rules = rulesCache(tenantId);
  const ops = [];
  for (const lead of leads) {
    const counts = gapCounts(computeGaps({ recordType: 'lead', stage: lead.stage, lead, client: clients.get(String(lead.client_id)) }, await rules(lead.brand_id)));
    if (counts.open_gap_count !== lead.open_gap_count || counts.blocking_gap_count !== lead.blocking_gap_count) ops.push({ updateOne: { filter: { _id: lead._id }, update: { $set: counts } } });
  }
  if (ops.length) await Lead.bulkWrite(ops);
  return ops.length;
}
