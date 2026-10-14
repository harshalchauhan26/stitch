-- Stitch schema v2 (SQLite). MULTI-TENANT:  Tenant -> Brands, Teams, Users.
-- Every business table carries tenant_id and every query filters on it (see repo.js).
-- Leads and Orders keep hot columns + a JSON `fields` bag, so new doc fields need NO migration.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS brands (
  tenant_id TEXT NOT NULL REFERENCES tenants(id), code TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, code)
);

-- A team is a "pod" in the doc. A team only sees the brands listed in team_brands.
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);
CREATE TABLE IF NOT EXISTS team_brands (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, tenant_id TEXT NOT NULL, brand_code TEXT NOT NULL,
  PRIMARY KEY (team_id, brand_code)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL, initials TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','pod_lead','sales','ops','qc')),
  team_id INTEGER REFERENCES teams(id), active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS leads (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,                -- LD-1193 (unique per tenant)
  brand TEXT NOT NULL, customer_name TEXT NOT NULL,
  stage TEXT NOT NULL,             -- New..Awaiting payment | Won | Lost
  owner_id TEXT REFERENCES users(id),
  event_date TEXT, order_value INTEGER,
  fields TEXT NOT NULL DEFAULT '{}',
  converted_order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS orders (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,                -- ORD-2279
  brand TEXT NOT NULL, customer_name TEXT NOT NULL,
  stage TEXT NOT NULL,             -- Created..Dispatched | Delivered
  owner_id TEXT REFERENCES users(id),
  event_date TEXT, order_value INTEGER,
  linked_lead_id TEXT, out_of_sync INTEGER NOT NULL DEFAULT 0,
  shopify_order_id TEXT, last_shopify_sync TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS ix_leads_scope ON leads(tenant_id, brand, stage);
CREATE INDEX IF NOT EXISTS ix_orders_scope ON orders(tenant_id, brand, stage);

-- Set Required: Tenant + Brand + Record + Stage + Field -> Level
CREATE TABLE IF NOT EXISTS required_rules (
  tenant_id TEXT NOT NULL, brand TEXT NOT NULL, record_type TEXT NOT NULL, stage TEXT NOT NULL, field TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('optional','needed','blocking')),
  PRIMARY KEY (tenant_id, brand, record_type, stage, field)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT, record_type TEXT, record_id TEXT, field TEXT,
  old_value TEXT, new_value TEXT,
  action TEXT NOT NULL,            -- gap_fix | edit | stage_move | convert | create | rule_change
  undone INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_audit_record ON audit_log(tenant_id, record_type, record_id);

CREATE TABLE IF NOT EXISTS whatsapp_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  record_type TEXT, record_id TEXT, direction TEXT NOT NULL DEFAULT 'out',
  template TEXT, field TEXT, body TEXT, status TEXT NOT NULL DEFAULT 'queued'
);

CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  raised_by TEXT REFERENCES users(id), raised_at TEXT NOT NULL,
  reason TEXT NOT NULL, details TEXT, sla_hours INTEGER NOT NULL DEFAULT 24,
  assigned_to TEXT REFERENCES users(id),
  resolved_at TEXT, resolution TEXT
);

CREATE TABLE IF NOT EXISTS saved_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
  user_id TEXT, name TEXT NOT NULL, path TEXT NOT NULL, filters TEXT NOT NULL DEFAULT '{}'


);




-- Chat uploads (Add Lead -> Chat export). One row per uploaded chat; becomes a lead once confirmed.
CREATE TABLE IF NOT EXISTS ingestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, batch_id TEXT NOT NULL, user_id TEXT,
  file_name TEXT NOT NULL, content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',      -- ready | confirmed | failed
  mode TEXT NOT NULL DEFAULT 'code',         -- code | llm
  raw_text TEXT, result TEXT, llm_usage TEXT, lead_id TEXT, error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_ingest_hash ON ingestions(tenant_id, content_hash);
CREATE INDEX IF NOT EXISTS ix_ingest_batch ON ingestions(tenant_id, batch_id);