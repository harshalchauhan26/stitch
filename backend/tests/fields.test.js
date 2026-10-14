import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { DEFAULT_RULES, FIELDS, GATE_FIELDS } from '../src/catalogue.js';
import { syncDefaultRules } from '../src/routes/admin.js';
import { createLead, getRecordWithGaps, moveStage, patchRecord } from '../src/services/records.js';
import { fixGap } from '../src/services/gaps.js';
import { visibleBrands } from '../src/repo.js';

function setup() {
  const db = openDb(':memory:'); seed(db);
  const user = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  const scope = { tenantId: user.tenant_id, user, brands: null };
  const brand = visibleBrands(db, scope).find((b) => b.code === 'NA').code;
  const lead = (extra = {}) => createLead(db, scope, { customer_name: 'Test Customer', brand, ...extra }).record.id;
  const gapsOf = (id) => getRecordWithGaps(db, scope, id).gaps.map((g) => g.field);
  return { db, scope, brand, lead, gapsOf };
}

test('only the six agreed fields are blocking', () => {
  const blocking = [...new Set(DEFAULT_RULES.filter((r) => r[3] === 'blocking').map((r) => r[2]))].sort();
  assert.deepEqual(blocking, [...GATE_FIELDS].sort());
});

test('select fields reject values outside their options', () => {
  const { db, scope, lead } = setup(); const id = lead();
  assert.throws(() => patchRecord(db, scope, id, { lead_source: 'Smoke signal' }), /Choose one of/);
  patchRecord(db, scope, id, { lead_source: 'instagram' });
  assert.equal(getRecordWithGaps(db, scope, id).record.fields.lead_source, 'Instagram');
});

test('doneValues: consent Unknown is a gap, Yes and No are done; design needs Approved', () => {
  const { db, scope, lead, gapsOf } = setup(); const id = lead();
  assert.ok(gapsOf(id).includes('whatsapp_consent'));
  patchRecord(db, scope, id, { whatsapp_consent: 'No' });
  assert.ok(!gapsOf(id).includes('whatsapp_consent'));
  const { db: d2, scope: s2, lead: l2, gapsOf: g2 } = setup(); const id2 = l2();
  d2.prepare("UPDATE leads SET stage = 'Customising' WHERE id = ?").run(id2);
  assert.ok(g2(id2).includes('design_approval_status'));
  patchRecord(d2, s2, id2, { design_approval_status: 'Sent' });
  assert.ok(g2(id2).includes('design_approval_status'));
  patchRecord(d2, s2, id2, { design_approval_status: 'Approved' });
  assert.ok(!g2(id2).includes('design_approval_status'));
});

test('appliesWhen: duty estimate only outside India; payment details only once the link is sent', () => {
  const { db, scope, lead, gapsOf } = setup(); const id = lead({ country: 'India' });
  db.prepare("UPDATE leads SET stage = 'Awaiting payment' WHERE id = ?").run(id);
  assert.ok(!gapsOf(id).includes('duty_estimate'));
  assert.ok(!gapsOf(id).includes('transaction_id'));
  patchRecord(db, scope, id, { country: 'UK', payment_link_sent: 'Yes' });
  assert.ok(gapsOf(id).includes('duty_estimate'));
  for (const k of ['payment_mode', 'transaction_id', 'payment_received_date']) assert.ok(gapsOf(id).includes(k), k);
});

test('derived values: quote number, lead value, advance %', () => {
  const { db, scope, lead } = setup(); const id = lead();
  patchRecord(db, scope, id, { quote_amount: '200000', advance_amount: '50000' });
  let r = getRecordWithGaps(db, scope, id).record;
  assert.equal(r.order_value, 200000); assert.equal(r.fields.advance_percent, 25);
  patchRecord(db, scope, id, { quote_status: 'Sent' });
  r = getRecordWithGaps(db, scope, id).record;
  assert.match(r.fields.quote_number, /^Q-NA-\d+-1$/);
});

test('system fields cannot be edited; locked_by_date is set when an order reaches Measurements', () => {
  const { db, scope } = setup();
  assert.throws(() => patchRecord(db, scope, db.prepare('SELECT id FROM leads WHERE tenant_id = ? LIMIT 1').get(scope.tenantId).id, { quote_number: 'X' }), /cannot be edited/);
  const o = db.prepare("SELECT id FROM orders WHERE tenant_id = ? AND stage = 'Spec locked' LIMIT 1").get(scope.tenantId);
  if (o) { moveStage(db, scope, o.id, 'Measurements', new Date()); assert.match(getRecordWithGaps(db, scope, o.id).record.fields.locked_by_date, / · \d{4}-\d{2}-\d{2}$/); }
});

test('fieldGroups: stage groups with levels, earlier stages included, system group last', () => {
  const { db, scope, lead } = setup(); const id = lead();
  db.prepare("UPDATE leads SET stage = 'Quoted' WHERE id = ?").run(id);
  const g = getRecordWithGaps(db, scope, id).fieldGroups;
  assert.deepEqual(g.map((x) => x.stage).slice(0, 4), ['New', 'Qualifying', 'Customising', 'Quoted']);
  assert.equal(g[0].fields.find((f) => f.key === 'phone').level, 'needed');
  assert.equal(g[0].fields.find((f) => f.key === 'email').level, 'optional');
  assert.ok(g.at(-1).fields.every((f) => f.system));
});

test('syncDefaultRules fills missing rules for existing brands and never overwrites a changed level', () => {
  const { db, scope, brand } = setup();
  db.prepare("DELETE FROM required_rules WHERE brand = ? AND field IN ('phone', 'email')").run(brand);
  db.prepare("INSERT INTO required_rules (tenant_id, brand, record_type, stage, field, level) VALUES (?,?,?,?,?,?)").run(scope.tenantId, brand, 'lead', 'New', 'email', 'blocking');
  db.prepare("UPDATE required_rules SET level = 'optional' WHERE brand = ? AND field = 'lead_source'").run(brand);
  syncDefaultRules(db);
  const lv = (f) => db.prepare('SELECT level FROM required_rules WHERE tenant_id = ? AND brand = ? AND field = ?').get(scope.tenantId, brand, f)?.level;
  assert.equal(lv('phone'), 'needed'); assert.equal(lv('email'), 'blocking'); assert.equal(lv('lead_source'), 'optional');
});

test('every catalogue field is usable: has a label, a type and a record scope', () => {
  for (const f of Object.values(FIELDS)) { assert.ok(f.label && f.type && f.records.length, f.key); if (f.type === 'select') assert.ok(f.options?.length, f.key); }
  const gaps = fixGap; assert.equal(typeof gaps, 'function');
});
