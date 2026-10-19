// Regression tests for the code review of feat/mongo-api-v1
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { productionProblems, loadConfig } from '../src/config.js';
import { seedOrg, startApp } from './helpers.js';

let t, o;
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
before(async () => { t = await startApp(); o = await seedOrg(t); });
after(async () => { await t.close(); });

describe('config', () => {
  test('production refuses the public development JWT secret', () => {
    const env = { NODE_ENV: 'production', MONGODB_URI: 'mongodb://x', JWT_SECRET: 'dev-secret-change-me-in-production' };
    assert.ok(productionProblems(env).some((p) => /JWT_SECRET/.test(p)));
    assert.deepEqual(productionProblems({ ...env, JWT_SECRET: 'a'.repeat(40) }), []);
  });
  test('TRUST_PROXY=0 turns proxy trust off', () => {
    assert.equal(loadConfig({ NODE_ENV: 'production', TRUST_PROXY: '0' }).trustProxy, 0);
    assert.equal(loadConfig({ NODE_ENV: 'production' }).trustProxy, 1);
  });
});

describe('pipeline renames', () => {
  test('swapping two stage names keeps every lead in its own stage', async () => {
    const stages = [{ name: 'Alpha', type: 'open' }, { name: 'Beta', type: 'open' }, { name: 'Won', type: 'won' }, { name: 'Lost', type: 'lost' }];
    const b = ok(await t.api('POST', '/brands', { name: 'Swap House', code: 'SW', template_key: 'womenswear', lead_pipeline: stages, team_ids: [o.alpha.id] }, o.admin), 201);
    const a = ok(await t.api('POST', '/leads', { brand_id: b.id, client: { phone: '+91 95000 00001' } }, o.tokens.priya), 201);
    let bLead = ok(await t.api('POST', '/leads', { brand_id: b.id, client: { phone: '+91 95000 00002' } }, o.tokens.priya), 201);
    bLead = ok(await t.api('POST', `/leads/${bLead.id}/stage`, { version: bLead.version, to: 'Beta' }, o.tokens.priya));
    const rulesBefore = ok(await t.api('GET', `/brands/${b.id}/rules`, undefined, o.admin)).filter((r) => r.record_type === 'lead');
    // swap: Alpha -> Beta, Beta -> Alpha
    ok(await t.api('PUT', `/brands/${b.id}/pipeline`, { stages: [{ name: 'Beta', type: 'open', from: 'Alpha' }, { name: 'Alpha', type: 'open', from: 'Beta' }, stages[2], stages[3]] }, o.admin));
    assert.equal(ok(await t.api('GET', `/leads/${a.id}`, undefined, o.tokens.priya)).stage, 'Beta');
    assert.equal(ok(await t.api('GET', `/leads/${bLead.id}`, undefined, o.tokens.priya)).stage, 'Alpha');
    const rulesAfter = ok(await t.api('GET', `/brands/${b.id}/rules`, undefined, o.admin)).filter((r) => r.record_type === 'lead');
    assert.equal(rulesAfter.length, rulesBefore.length, 'no rule merged away');
    const swap = { Alpha: 'Beta', Beta: 'Alpha' };
    for (const r of rulesBefore) assert.ok(rulesAfter.some((x) => x.field === r.field && x.stage === swap[r.stage] && x.level === r.level), `${r.field} moved with its stage`);
  });
});

describe('cached gap counts follow settings changes', () => {
  test('a new needed field shows up in /gaps and on the lead list straight away', async () => {
    const lead = ok(await t.api('POST', '/leads', { brand_id: o.na.id, client: { phone: '+91 95000 00003', name: 'Rhea', whatsapp_consent: 'Yes' }, fields: { event_date: '2027-01-10', country: 'India', lead_source: 'Instagram', next_followup_date: '2026-11-01' }, items: [{ product: 'Lehenga' }] }, o.tokens.priya), 201);
    assert.equal(lead.open_gap_count, 0);
    ok(await t.api('POST', `/brands/${o.na.id}/fields`, { label: 'Fitting slot', type: 'text', stage: 'New', level: 'needed' }, o.admin), 201);
    const gaps = ok(await t.api('GET', '/gaps', undefined, o.tokens.priya));
    assert.ok(gaps.some((g) => g.record_id === lead.id && g.field === 'fitting_slot'));
    const row = ok(await t.api('GET', '/leads?q=95000%2000003', undefined, o.tokens.priya)).leads[0];
    assert.equal(row.open_gap_count, 1);
  });
});

describe('fulfilment', () => {
  let order;
  before(async () => {
    let lead = ok(await t.api('POST', '/leads', {
      brand_id: o.na.id, client: { phone: '+91 95000 00004', name: 'Zoya' }, fields: { quote_amount: 10000000 },
      items: [{ product: 'Lehenga', fields: { neckline: 'V', waist: 28 } }, { product: 'Dupatta' }],
    }, o.tokens.priya), 201);
    ok(await t.api('POST', `/leads/${lead.id}/payments`, { kind: 'advance', amount: 10000000, status: 'received' }, o.tokens.priya), 201);
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    const won = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Won', override: true, reason: 'demo' }, o.tokens.meera));
    order = ok(await t.api('GET', `/orders/${won.order_id}`, undefined, o.tokens.priya));
  });

  test('approving two spec proposals keeps both changes', async () => {
    for (const to of ['Spec locked']) order = ok(await t.api('POST', `/orders/${order.id}/stage`, { version: order.version, to }, o.tokens.priya));
    const item = order.items[0];
    const p1 = ok(await t.api('POST', `/orders/${order.id}/items/${item.id}/customisations`, { kind: 'spec', values: { neckline: 'Sweetheart' }, reason: 'Customer asked' }, o.tokens.priya), 201);
    const p2 = ok(await t.api('POST', `/orders/${order.id}/items/${item.id}/customisations`, { kind: 'spec', values: { embroidery_colour: 'Gold' }, reason: 'Customer asked' }, o.tokens.priya), 201);
    ok(await t.api('POST', `/customisations/${p1.id}/approve`, {}, o.tokens.meera));
    ok(await t.api('POST', `/customisations/${p2.id}/approve`, {}, o.tokens.meera));
    order = ok(await t.api('GET', `/orders/${order.id}`, undefined, o.tokens.priya));
    assert.equal(order.items[0].spec.values.neckline, 'Sweetheart', 'the first approved change is kept');
    assert.equal(order.items[0].spec.values.embroidery_colour, 'Gold');
  });

  test('an order with an item never shipped does not become Delivered', async () => {
    ok(await t.api('PATCH', `/orders/${order.id}`, { version: order.version, fields: { customer_approval: 'Yes', qc_result: 'Pass', verified_shipping_address: '1 Main St', address_confirmed: 'Yes' } }, o.tokens.priya));
    order = ok(await t.api('GET', `/orders/${order.id}`, undefined, o.tokens.priya));
    order = ok(await t.api('POST', `/orders/${order.id}/stage`, { version: order.version, to: 'Ready to ship', override: true, reason: 'demo' }, o.tokens.meera));
    const d = ok(await t.api('POST', `/orders/${order.id}/dispatches`, { version: order.version, courier: 'Delhivery', order_item_ids: [order.items[0].id] }, o.tokens.priya), 201);
    ok(await t.api('PATCH', `/dispatches/${d.id}`, { status: 'delivered' }, o.tokens.priya));
    order = ok(await t.api('GET', `/orders/${order.id}`, undefined, o.tokens.priya));
    assert.equal(order.stage, 'Dispatched', 'the dupatta has not shipped yet');
    const d2 = ok(await t.api('POST', `/orders/${order.id}/dispatches`, { version: order.version, courier: 'Delhivery', order_item_ids: [order.items[1].id] }, o.tokens.priya), 201);
    ok(await t.api('PATCH', `/dispatches/${d2.id}`, { status: 'delivered' }, o.tokens.priya));
    assert.equal(ok(await t.api('GET', `/orders/${order.id}`, undefined, o.tokens.priya)).stage, 'Delivered');
  });
});
