// Reading chats into leads (PLAN §10.4, docs/EXTRACTION_FLOW.md). The routes stay thin on purpose: the rules live in
// services/extraction.js, this file only maps URLs to it, like the other route files.
//
//   POST /conversations/:id/extract         run the model over a chat      body: { lead_id } | { create_lead: true, owner_id?, confirm_new_purchase? }
//   GET  /conversations/:id/extractions     the runs made on a chat (latest first), to resume a review
//   GET  /leads/:id/extractions             the runs made for a lead, shown in the lead drawer
//   POST /extractions/:id/accept            save pending suggestions through the normal lead edit   body: { suggestion_ids? } (none = all)
//   POST /extractions/:id/dismiss           throw pending suggestions away                          body: { suggestion_ids? }
//
// Access follows the rest of the API: requireAuth has already put the caller's scope on req.scope, and a chat, lead or run of a
// brand the caller cannot see answers 404 (checked inside getConversation / getLead / loadExtraction).
import { Router } from 'express';
import { Extraction } from '../models/index.js';
import { getConversation } from '../services/conversations.js';
import { decide, extractFromChat, extractionDto } from '../services/extraction.js';
import { getLead } from '../services/leads.js';

export const extractionRouter = Router();

// 201: a run is a new record, even when it only fills an existing lead
extractionRouter.post('/conversations/:id/extract', async (req, res) => res.status(201).json(await extractFromChat(req.scope, req.params.id, req.body)));

extractionRouter.get('/conversations/:id/extractions', async (req, res) => {
  const c = await getConversation(req.scope, req.params.id);
  res.json((await Extraction.find({ tenant_id: req.scope.tenantId, conversation_id: c._id }).sort({ created_at: -1 }).limit(10).lean()).map(extractionDto));
});

extractionRouter.get('/leads/:id/extractions', async (req, res) => {
  const lead = await getLead(req.scope, req.params.id);
  res.json((await Extraction.find({ tenant_id: req.scope.tenantId, lead_id: lead._id }).sort({ created_at: -1 }).limit(10).lean()).map(extractionDto));
});

extractionRouter.post('/extractions/:id/accept', async (req, res) => res.json(await decide(req.scope, req.params.id, req.body, 'accept')));
extractionRouter.post('/extractions/:id/dismiss', async (req, res) => res.json(await decide(req.scope, req.params.id, req.body, 'dismiss')));
