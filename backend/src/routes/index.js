import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES, FIELDS, GATE_FIELDS, LEAD_STAGES, ORDER_STAGES } from '../catalogue.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../auth.js';
import { ValidationError } from '../lib.js';
import { ROLE_LABEL, canEditRules, isAdmin } from '../roles.js';
import { audit, canSeeBrand, getRecord, visibleBrands } from '../repo.js';
import { askAll, askOnWhatsApp, fixGap, HttpError, listGaps, undoAudit } from '../services/gaps.js';
import { buildHome, buildSummary } from '../services/home.js';
import { createLead, getRecordWithGaps, kanban, moveStage, patchRecord, search } from '../services/records.js';
import { confirmBatch, processBatch } from '../ingest/service.js';
import { llmFromEnv } from '../ingest/llm.js';
import adminRoutes from './admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const wrap = (fn) => (req, res, next) => { try { res.json(fn(req, res)); } catch (e) { next(e); } };
const awrap = (fn) => async (req, res, next) => { try { res.json(await fn(req, res)); } catch (e) { next(e); } };

export function createApp(db, { clock = () => new Date(), llm = llmFromEnv() } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));            // uploaded chat text can be large
  app.use((req, _res, next) => { req.now = clock(); next(); });

  // ---- public ---------------------------------------------------------------------------
  app.get('/api/health', (_q, res) => res.json({ ok: true }));
  app.post('/api/auth/login', wrap((req) => {
    const { email, password } = req.body || {};
    const u = db.prepare(`SELECT u.*, t.active AS tenant_active FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE lower(u.email) = lower(?)`).get(String(email || ''));
    // same error for unknown user / wrong password / disabled account: do not leak which one
    if (!u || !u.active || !u.tenant_active || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Wrong email or password');
    return { token: signToken({ sub: u.id, tid: u.tenant_id }) };
  }));

  // ---- everything below needs a valid token ---------------------------------------------
  // scope = who is asking + which tenant + which brands (null = all brands, i.e. admin)
  app.use('/api', (req, _res, next) => {
    const bearer = (req.get('authorization') || '').replace(/^Bearer /i, '');
    const claims = verifyToken(bearer);
    if (!claims) return next(new HttpError(401, 'Please sign in'));
    const user = db.prepare(`SELECT u.*, t.active AS tenant_active FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ?`).get(claims.sub);
    if (!user || !user.active || !user.tenant_active || user.tenant_id !== claims.tid) return next(new HttpError(401, 'Please sign in'));
    const brands = isAdmin(user) ? null
      : (user.team_id ? db.prepare('SELECT brand_code FROM team_brands WHERE team_id = ?').all(user.team_id).map((r) => r.brand_code) : []);
    req.scope = { tenantId: user.tenant_id, user, brands };
    next();
  });
  const brandOf = (req) => (req.query.brand && req.query.brand !== 'ALL' ? String(req.query.brand).split(',') : undefined);
  const S = (req) => req.scope;

  app.get('/api/me', wrap((req) => {
    const { user } = S(req);
    const team = user.team_id ? db.prepare('SELECT name FROM teams WHERE id = ?').get(user.team_id) : null;
    const tenant = db.prepare('SELECT id, name, slug FROM tenants WHERE id = ?').get(user.tenant_id);
    return { id: user.id, name: user.name, initials: user.initials, email: user.email, role: user.role, roleLabel: ROLE_LABEL[user.role],
      pod: team?.name ?? null, tenant, brands: visibleBrands(db, S(req)).map(({ code, name }) => ({ code, name })) };
  }));
  app.get('/api/meta', wrap((req) => ({
    brands: visibleBrands(db, S(req)).map(({ code, name }) => ({ code, name })), leadStages: LEAD_STAGES, orderStages: ORDER_STAGES, gateFields: GATE_FIELDS,
    fields: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, { label: f.label, type: f.type }])),
    users: db.prepare('SELECT id, name, initials, role FROM users WHERE tenant_id = ? AND active = 1').all(S(req).tenantId),
  })));

  // ---- Home + shell -----------------------------------------------------------------------
  app.get('/api/home', wrap((req) => buildHome(db, S(req), { brand: brandOf(req), now: req.now })));
  app.get('/api/summary', wrap((req) => buildSummary(db, S(req), { brand: brandOf(req), now: req.now })));

  // ---- Gaps ---------------------------------------------------------------------------------
  app.get('/api/gaps', wrap((req) => listGaps(db, S(req), req.query, req.now)));
  app.post('/api/gaps/ask-all', wrap((req) => askAll(db, S(req), req.body.keys || [], req.now)));
  app.post('/api/gaps/:key/fix', wrap((req) => fixGap(db, S(req), req.params.key, req.body || {}, req.now)));
  app.post('/api/gaps/:key/ask', wrap((req) => askOnWhatsApp(db, S(req), req.params.key, req.now)));
  app.post('/api/audit/:id/undo', wrap((req) => undoAudit(db, S(req), Number(req.params.id))));

  // ---- Leads / Orders -----------------------------------------------------------------------
  app.get('/api/leads', wrap((req) => kanban(db, S(req), 'lead', { brand: brandOf(req), now: req.now })));
  app.get('/api/orders', wrap((req) => kanban(db, S(req), 'order', { brand: brandOf(req), now: req.now })));
  app.post('/api/leads', wrap((req, res) => { res.status(201); return createLead(db, S(req), req.body, req.now); }));
  for (const t of ['leads', 'orders']) {
    app.get(`/api/${t}/:id`, wrap((req) => getRecordWithGaps(db, S(req), req.params.id, req.now)));
    app.patch(`/api/${t}/:id`, wrap((req) => patchRecord(db, S(req), req.params.id, req.body, req.now)));
    app.post(`/api/${t}/:id/move`, wrap((req) => moveStage(db, S(req), req.params.id, req.body.to, req.now)));
  }
  app.get('/api/search', wrap((req) => search(db, S(req), req.query.q || '')));

  // ---- Set Required (admin + pod lead; pod leads only for their own team's brands) -----------
  app.get('/api/rules', wrap((req) => {
    const brands = visibleBrands(db, S(req)).map((b) => b.code).filter((c) => !req.query.brand || c === req.query.brand);
    return db.prepare('SELECT * FROM required_rules WHERE tenant_id = ?').all(S(req).tenantId)
      .filter((r) => brands.includes(r.brand) && (!req.query.record || r.record_type === req.query.record));
  }));
  app.put('/api/rules', wrap((req) => {
    const { user, tenantId } = S(req);
    if (!canEditRules(user)) throw new HttpError(403, 'Only admins and pod leads can change required fields');
    const { brand, record, stage, field, level } = req.body;
    if (!visibleBrands(db, S(req)).some((b) => b.code === brand)) throw new HttpError(403, 'You cannot edit rules for this brand');
    if (!['lead', 'order'].includes(record)) throw new ValidationError('Bad record');
    if (!(record === 'lead' ? LEAD_STAGES : ORDER_STAGES).includes(stage)) throw new ValidationError('Bad stage');
    if (!FIELDS[field]) throw new ValidationError('Unknown field');
    if (!['optional', 'needed', 'blocking'].includes(level)) throw new ValidationError('Bad level');
    if (GATE_FIELDS.includes(field) && level !== 'blocking' && !isAdmin(user)) throw new HttpError(403, 'Only an admin can lower a gate field');
    const old = db.prepare('SELECT level FROM required_rules WHERE tenant_id=? AND brand=? AND record_type=? AND stage=? AND field=?').get(tenantId, brand, record, stage, field);
    db.prepare(`INSERT INTO required_rules (tenant_id, brand, record_type, stage, field, level) VALUES (?,?,?,?,?,?)
      ON CONFLICT(tenant_id, brand, record_type, stage, field) DO UPDATE SET level = excluded.level`).run(tenantId, brand, record, stage, field, level);
    audit(db, { scope: S(req), rec: { recordType: 'rule', id: `${brand}|${record}|${stage}` }, field, oldValue: { level: old?.level ?? null }, newValue: { level }, action: 'rule_change' });
    return { ok: true };
  }));

  // ---- Escalations ----------------------------------------------------------------------------
  app.post('/api/orders/:id/escalations', wrap((req, res) => {
    const { reason, details, slaHours = 24, assignedTo } = req.body;
    if (!getRecord(db, S(req), req.params.id)) throw new HttpError(404, 'Order not found');
    if (!reason || !details) throw new ValidationError('reason and details are required');
    if (![4, 24, 48].includes(Number(slaHours))) throw new ValidationError('SLA must be 4, 24 or 48 hours');
    const r = db.prepare(`INSERT INTO escalations (tenant_id, order_id, raised_by, raised_at, reason, details, sla_hours, assigned_to) VALUES (?,?,?,?,?,?,?,?)`)
      .run(S(req).tenantId, req.params.id, S(req).user.id, req.now.toISOString(), reason, details, Number(slaHours), assignedTo || null);
    res.status(201); return { id: Number(r.lastInsertRowid) };
  }));
  app.post('/api/escalations/:id/resolve', wrap((req) => {
    if (!req.body.resolution) throw new ValidationError('resolution is required');
    const r = db.prepare('UPDATE escalations SET resolved_at = ?, resolution = ? WHERE id = ? AND tenant_id = ? AND resolved_at IS NULL')
      .run(req.now.toISOString(), req.body.resolution, req.params.id, S(req).tenantId);
    if (!r.changes) throw new HttpError(404, 'Escalation not found');
    return { ok: true };
  }));

  // ---- Add Lead -> upload chats --------------------------------------------------------------------
  app.get('/api/ingest/config', wrap(() => ({ mode: llm ? 'llm' : 'code' })));
  app.post('/api/ingest/chats', awrap((req) => processBatch(db, S(req), req.body?.chats, { llm })));
  app.post('/api/ingest/confirm', wrap((req, res) => { const r = confirmBatch(db, S(req), req.body?.items, req.now); if (r.created.length) res.status(201); return r; }));

  // ---- Admin: brands, teams, users (admin only) -----------------------------------------------
  app.use('/api/admin', (req, _res, next) => (isAdmin(req.scope.user) ? next() : next(new HttpError(403, 'Admins only'))), adminRoutes(db));

  // ---- Serve the built frontend in production -------------------------------------------------
  const dist = path.join(here, '../../../frontend/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_q, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message, ...(err.blockers ? { blockers: err.blockers } : {}) });
  });
  return app;
}