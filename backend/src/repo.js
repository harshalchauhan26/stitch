// Data access. EVERY query here is scoped by tenant, and by the caller's visible brands.
// scope = { tenantId, user, brands }   brands: null = all brands of the tenant (admin), else array of codes (team's brands)
const TABLE = { lead: 'leads', order: 'orders' };

export const typeOfId = (id) => (String(id).startsWith('LD-') ? 'lead' : String(id).startsWith('ORD-') ? 'order' : null);

function normalise(type, row) {
  if (!row) return null;
  return { ...row, recordType: type, fields: JSON.parse(row.fields || '{}') };
}

/** Intersect the brands the caller asked for with the brands they are allowed to see. */
export function effectiveBrands(scope, requested) {
  if (!requested) return scope.brands;
  return scope.brands ? requested.filter((b) => scope.brands.includes(b)) : requested;
}
export const canSeeBrand = (scope, code) => !scope.brands || scope.brands.includes(code);

export function listRecords(db, scope, { brand } = {}) {
  const brands = effectiveBrands(scope, brand);
  if (brands && brands.length === 0) return [];
  const out = [];
  for (const type of ['lead', 'order']) {
    for (const r of db.prepare(`SELECT * FROM ${TABLE[type]} WHERE tenant_id = ?`).all(scope.tenantId)) {
      if (!brands || brands.includes(r.brand)) out.push(normalise(type, r));
    }
  }
  return out;
}

/** null when the record does not exist, belongs to another tenant, or is on a brand the caller cannot see. */
export function getRecord(db, scope, id) {
  const type = typeOfId(id);
  if (!type) return null;
  const row = db.prepare(`SELECT * FROM ${TABLE[type]} WHERE tenant_id = ? AND id = ?`).get(scope.tenantId, id);
  if (!row || !canSeeBrand(scope, row.brand)) return null;
  return normalise(type, row);
}

export function saveRecord(db, rec) {
  const base = `UPDATE ${TABLE[rec.recordType]} SET brand=@brand, customer_name=@customer_name, stage=@stage, owner_id=@owner_id,
    event_date=@event_date, order_value=@order_value, fields=@fields, updated_at=datetime('now')`;
  const extra = rec.recordType === 'order' ? ', out_of_sync=@out_of_sync' : ', converted_order_id=@converted_order_id';
  db.prepare(`${base}${extra} WHERE tenant_id=@tenant_id AND id=@id`).run({
    ...rec, fields: JSON.stringify(rec.fields), out_of_sync: rec.out_of_sync ?? 0, converted_order_id: rec.converted_order_id ?? null,
  });
}

export const loadRules = (db, tenantId) => db.prepare('SELECT * FROM required_rules WHERE tenant_id = ?').all(tenantId);
export const tenantBrands = (db, tenantId) => db.prepare('SELECT code, name, active FROM brands WHERE tenant_id = ? ORDER BY rowid').all(tenantId);
export const visibleBrands = (db, scope) => tenantBrands(db, scope.tenantId).filter((b) => b.active && canSeeBrand(scope, b.code));

export function audit(db, { scope, rec, field, oldValue, newValue, action }) {
  const r = db.prepare(`INSERT INTO audit_log (tenant_id, user_id, record_type, record_id, field, old_value, new_value, action)
    VALUES (?,?,?,?,?,?,?,?)`).run(scope.tenantId, scope.user.id, rec.recordType, rec.id, field, JSON.stringify(oldValue ?? null), JSON.stringify(newValue ?? null), action);
  return Number(r.lastInsertRowid);
}

export function nextId(db, tenantId, type) {
  const [table, prefix, floor] = type === 'lead' ? ['leads', 'LD-', 1000] : ['orders', 'ORD-', 2000];
  const row = db.prepare(`SELECT MAX(CAST(SUBSTR(id, ${prefix.length + 1}) AS INTEGER)) AS n FROM ${table} WHERE tenant_id = ?`).get(tenantId);
  return prefix + (Math.max(floor, row.n || 0) + 1);
}