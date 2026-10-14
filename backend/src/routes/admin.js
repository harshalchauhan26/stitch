// Tenant administration. Mounted at /api/admin and only reachable by role=admin.
// Everything is scoped to the admin's own tenant: an admin can never touch another tenant.
import express from 'express';
import { DEFAULT_RULES } from '../catalogue.js';
import { hashPassword } from '../auth.js';
import { ValidationError } from '../lib.js';
import { ROLES, ROLE_LABEL } from '../roles.js';
import { HttpError } from '../services/gaps.js';

const wrap = (fn) => (req, res, next) => { try { res.json(fn(req, res)); } catch (e) { next(e); } };
const initialsOf = (name) => name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** Seeds the default Set Required rules for a brand (used when a brand is created). */
export function seedRulesForBrand(db, tenantId, code) {
  const ins = db.prepare('INSERT OR IGNORE INTO required_rules (tenant_id, brand, record_type, stage, field, level) VALUES (?,?,?,?,?,?)');
  // brand-specific rows (e.g. blouse fields for NA/KH only) are skipped for a brand we know nothing about;
  // the admin turns them on in Set Required.
  for (const [rec, stage, field, level, brands] of DEFAULT_RULES) if (!brands) ins.run(tenantId, code, rec, stage, field, level);
}

/**
 * Runs at server start: adds any default rule an existing brand is missing (new fields from a release).
 * INSERT OR IGNORE, so a level someone changed in Settings is never overwritten.
 */
export function syncDefaultRules(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO required_rules (tenant_id, brand, record_type, stage, field, level) VALUES (?,?,?,?,?,?)');
  db.transaction(() => {
    for (const b of db.prepare('SELECT tenant_id, code FROM brands').all())
      for (const [rec, stage, field, level, brands] of DEFAULT_RULES) if (!brands || brands.includes(b.code)) ins.run(b.tenant_id, b.code, rec, stage, field, level);
  })();
}

export default function adminRoutes(db) {
  const r = express.Router();
  const T = (req) => req.scope.tenantId;

  // ---- brands ----
  r.get('/brands', wrap((req) => db.prepare('SELECT code, name, active FROM brands WHERE tenant_id = ? ORDER BY rowid').all(T(req))));
  r.post('/brands', wrap((req, res) => {
    const { code, name } = req.body || {};
    if (!/^[A-Z]{2,4}$/.test(code || '')) throw new ValidationError('Brand code must be 2-4 capital letters, e.g. NA');
    if (!name?.trim()) throw new ValidationError('Brand name is required');
    if (db.prepare('SELECT 1 FROM brands WHERE tenant_id = ? AND code = ?').get(T(req), code)) throw new HttpError(409, 'That brand code already exists');
    db.transaction(() => { db.prepare('INSERT INTO brands (tenant_id, code, name) VALUES (?,?,?)').run(T(req), code, name.trim()); seedRulesForBrand(db, T(req), code); })();
    res.status(201); return { code, name: name.trim(), active: 1 };
  }));
  r.patch('/brands/:code', wrap((req) => {
    const b = db.prepare('SELECT * FROM brands WHERE tenant_id = ? AND code = ?').get(T(req), req.params.code);
    if (!b) throw new HttpError(404, 'Brand not found');
    const name = req.body.name?.trim() || b.name; const active = req.body.active === undefined ? b.active : req.body.active ? 1 : 0;
    db.prepare('UPDATE brands SET name = ?, active = ? WHERE tenant_id = ? AND code = ?').run(name, active, T(req), b.code);
    return { code: b.code, name, active };
  }));

  // ---- teams (pods) and the brands they can see ----
  const teamDto = (tid, row) => ({ ...row, brands: db.prepare('SELECT brand_code FROM team_brands WHERE team_id = ? ORDER BY brand_code').all(row.id).map((x) => x.brand_code),
    members: db.prepare('SELECT COUNT(*) n FROM users WHERE team_id = ? AND tenant_id = ?').get(row.id, tid).n });
  const setTeamBrands = (tid, teamId, codes) => {
    const valid = db.prepare('SELECT code FROM brands WHERE tenant_id = ?').all(tid).map((b) => b.code);
    const bad = (codes || []).filter((c) => !valid.includes(c));
    if (bad.length) throw new ValidationError(`Unknown brand: ${bad.join(', ')}`);
    db.prepare('DELETE FROM team_brands WHERE team_id = ?').run(teamId);
    const ins = db.prepare('INSERT INTO team_brands (team_id, tenant_id, brand_code) VALUES (?,?,?)');
    for (const c of new Set(codes || [])) ins.run(teamId, tid, c);
  };
  r.get('/teams', wrap((req) => db.prepare('SELECT * FROM teams WHERE tenant_id = ? ORDER BY name').all(T(req)).map((t) => teamDto(T(req), t))));
  r.post('/teams', wrap((req, res) => {
    const name = req.body?.name?.trim();
    if (!name) throw new ValidationError('Team name is required');
    if (db.prepare('SELECT 1 FROM teams WHERE tenant_id = ? AND name = ?').get(T(req), name)) throw new HttpError(409, 'A team with that name exists');
    const id = db.transaction(() => { const id = Number(db.prepare('INSERT INTO teams (tenant_id, name) VALUES (?,?)').run(T(req), name).lastInsertRowid); setTeamBrands(T(req), id, req.body.brands); return id; })();
    res.status(201); return teamDto(T(req), db.prepare('SELECT * FROM teams WHERE id = ?').get(id));
  }));
  r.put('/teams/:id', wrap((req) => {
    const t = db.prepare('SELECT * FROM teams WHERE id = ? AND tenant_id = ?').get(req.params.id, T(req));
    if (!t) throw new HttpError(404, 'Team not found');
    db.transaction(() => {
      if (req.body.name?.trim()) db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(req.body.name.trim(), t.id);
      if (req.body.brands) setTeamBrands(T(req), t.id, req.body.brands);
    })();
    return teamDto(T(req), db.prepare('SELECT * FROM teams WHERE id = ?').get(t.id));
  }));

  // ---- users ----
  const userDto = (u) => ({ id: u.id, name: u.name, initials: u.initials, email: u.email, role: u.role, roleLabel: ROLE_LABEL[u.role], teamId: u.team_id, active: !!u.active });
  const checkTeam = (tid, teamId) => { if (teamId != null && !db.prepare('SELECT 1 FROM teams WHERE id = ? AND tenant_id = ?').get(teamId, tid)) throw new ValidationError('Unknown team'); };
  r.get('/users', wrap((req) => db.prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY name').all(T(req)).map(userDto)));
  r.post('/users', wrap((req, res) => {
    const { name, email, password, role, teamId = null } = req.body || {};
    if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '')) throw new ValidationError('Name and a valid email are required');
    if (!ROLES.includes(role)) throw new ValidationError(`Role must be one of: ${ROLES.join(', ')}`);
    if (String(password || '').length < 8) throw new ValidationError('Password must be at least 8 characters');
    checkTeam(T(req), teamId);
    if (db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(email)) throw new HttpError(409, 'That email is already in use');
    const id = 'u_' + Math.random().toString(36).slice(2, 10);
    db.prepare('INSERT INTO users (id, tenant_id, name, initials, email, password_hash, role, team_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, T(req), name.trim(), initialsOf(name), email.trim(), hashPassword(password), role, teamId);
    res.status(201); return userDto(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }));
  r.patch('/users/:id', wrap((req) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(req.params.id, T(req));
    if (!u) throw new HttpError(404, 'User not found');
    const b = req.body || {};
    if (b.role !== undefined && !ROLES.includes(b.role)) throw new ValidationError('Bad role');
    if (b.teamId !== undefined) checkTeam(T(req), b.teamId);
    if (b.password !== undefined && String(b.password).length < 8) throw new ValidationError('Password must be at least 8 characters');
    const demoting = u.id === req.scope.user.id && ((b.role && b.role !== 'admin') || b.active === false);
    if (demoting) throw new HttpError(409, 'You cannot demote or deactivate yourself');
    db.prepare('UPDATE users SET name=?, initials=?, role=?, team_id=?, active=?, password_hash=? WHERE id=?').run(
      b.name?.trim() || u.name, b.name?.trim() ? initialsOf(b.name) : u.initials, b.role ?? u.role, b.teamId === undefined ? u.team_id : b.teamId,
      b.active === undefined ? u.active : b.active ? 1 : 0, b.password ? hashPassword(b.password) : u.password_hash, u.id);
    return userDto(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id));
  }));

  return r;
}