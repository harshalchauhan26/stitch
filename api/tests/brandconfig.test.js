import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { seedOrg, startApp } from './helpers.js';

let t, o, kh;
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const PIPELINE = [
  { name: 'New enquiry', type: 'open' }, { name: 'Consultation', type: 'open' }, { name: 'Trial', type: 'open' },
  { name: 'Confirmed', type: 'won' }, { name: 'Dropped', type: 'lost' },
];

before(async () => {
  t = await startApp(); o = await seedOrg(t);
  kh = ok(await t.api('POST', '/brands', { name: 'Kesar House', code: 'KH', template_key: 'womenswear', lead_pipeline: PIPELINE }, o.admin), 201);
  ok(await t.api('PATCH', `/teams/${o.alpha.id}`, { brand_ids: [o.na.id, kh.id] }, o.admin));
});
after(async () => { await t.close(); });

describe('custom pipeline per brand', () => {
  let lead;
  test('the brand keeps its own stages; the template SOP lands on them, payment gate before the won stage', async () => {
    assert.deepEqual(kh.lead_pipeline.map((s) => s.name), PIPELINE.map((s) => s.name));
    const rules = ok(await t.api('GET', `/brands/${kh.id}/rules`, undefined, o.admin));
    const at = (field) => rules.find((r) => r.record_type === 'lead' && r.field === field);
    assert.equal(at('client_name').stage, 'New enquiry');
    assert.equal(at('advance_amount').stage, 'Trial');
    assert.equal(at('advance_amount').level, 'blocking');
  });

  test('a lead walks the brand\'s stages, and its won stage creates the order', async () => {
    lead = ok(await t.api('POST', '/leads', { brand_id: kh.id, client: { phone: '+91 96000 00001', name: 'Ira Sen' }, fields: { quote_amount: 9000000 }, items: [{ product: 'Anarkali' }] }, o.tokens.priya), 201);
    assert.equal(lead.stage, 'New enquiry');
    assert.deepEqual(lead.layout.map((g) => g.stage), ['New enquiry', 'Consultation', 'Trial']);
    const wrong = await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Quoted' }, o.tokens.priya);
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /not a stage of Kesar House. Stages: New enquiry, Consultation, Trial, Confirmed/);
    assert.match((await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'dropped' }, o.tokens.priya)).body.error, /mark lost/);
    for (const to of ['Consultation', 'Trial']) lead = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to }, o.tokens.priya));
    assert.equal((await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Confirmed' }, o.tokens.priya)).status, 422);
    ok(await t.api('POST', `/leads/${lead.id}/payments`, { kind: 'advance', amount: 3000000, status: 'received' }, o.tokens.priya), 201);
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    const won = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'confirmed' }, o.tokens.priya));
    assert.equal(won.stage, 'Confirmed');
    assert.equal(won.stage_type, 'won');
    assert.ok(won.order_id);
    assert.equal(ok(await t.api('GET', `/orders/${won.order_id}`, undefined, o.tokens.priya)).order_no, 'ORD-KH-2001');
  });

  test('lost goes to the brand\'s lost stage and can be reopened', async () => {
    let l = ok(await t.api('POST', '/leads', { brand_id: kh.id, client: { phone: '+91 96000 00002' } }, o.tokens.priya), 201);
    l = ok(await t.api('POST', `/leads/${l.id}/lost`, { version: l.version, reason: 'Timeline' }, o.tokens.priya));
    assert.deepEqual([l.stage, l.stage_type], ['Dropped', 'lost']);
    l = ok(await t.api('POST', `/leads/${l.id}/reopen`, { version: l.version }, o.tokens.priya));
    assert.deepEqual([l.stage, l.stage_type], ['New enquiry', 'open']);
  });
});

describe('custom fields per brand', () => {
  test('a brand gets its own field; other brands cannot use it; it cannot block', async () => {
    assert.equal((await t.api('POST', `/brands/${kh.id}/fields`, { label: 'Resizing', type: 'bool' }, o.tokens.priya)).status, 403, 'sales cannot change setup');
    assert.equal((await t.api('POST', `/brands/${kh.id}/fields`, { label: 'Resizing', type: 'bool', level: 'blocking' }, o.admin)).status, 400);
    const r = ok(await t.api('POST', `/brands/${kh.id}/fields`, { label: 'Resizing allowed', type: 'select', options: ['No', 'Once', 'Twice'], scope: 'item', stage: 'Consultation', level: 'needed' }, o.admin), 201);
    const f = r.fields.find((x) => x.label === 'Resizing allowed');
    assert.deepEqual([f.key, f.custom, f.stage, f.level, f.scope], ['resizing_allowed', true, 'Consultation', 'needed', 'item']);
    assert.equal((await t.api('POST', `/brands/${kh.id}/fields`, { label: 'resizing allowed', type: 'text' }, o.admin)).status, 409);
    ok(await t.api('POST', `/brands/${kh.id}/fields`, { label: 'Alteration rounds included', type: 'number', min: 0, max: 5 }, o.admin), 201);

    let lead = ok(await t.api('POST', '/leads', { brand_id: kh.id, client: { phone: '+91 96000 00003' }, items: [{ product: 'Lehenga', fields: { resizing_allowed: 'once' } }], fields: { alteration_rounds_included: 2 } }, o.tokens.priya), 201);
    assert.equal(lead.items[0].fields.resizing_allowed, 'Once');
    assert.equal(lead.fields.alteration_rounds_included, 2);
    const na = await t.api('POST', '/leads', { brand_id: o.na.id, client: { phone: '+91 96000 00004' }, fields: { alteration_rounds_included: 1 } }, o.tokens.priya);
    assert.equal(na.status, 400, 'Noor Atelier does not have this field');

    // a needed custom field shows as a gap at its stage, like any other field
    lead = ok(await t.api('POST', '/leads', { brand_id: kh.id, client: { phone: '+91 96000 00005' }, items: [{ product: 'Saree' }] }, o.tokens.priya), 201);
    lead = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Consultation' }, o.tokens.priya));
    assert.ok(lead.gaps.some((g) => g.field === 'resizing_allowed' && g.item_label === 'Item 1 · Saree'));
  });

  test('a field can be renamed, moved to another stage, or hidden', async () => {
    let r = ok(await t.api('PATCH', `/brands/${kh.id}/fields/resizing_allowed`, { label: 'Resizes included', stage: 'Trial' }, o.admin));
    const f = r.fields.find((x) => x.key === 'resizing_allowed');
    assert.deepEqual([f.label, f.stage], ['Resizes included', 'Trial']);
    assert.equal((await t.api('PATCH', `/brands/${kh.id}/fields/neckline`, { label: 'Neck' }, o.admin)).status, 400, 'shared fields keep their name');
    r = ok(await t.api('PATCH', `/brands/${kh.id}/fields/back_design`, { level: null }, o.admin));
    assert.ok(r.available.some((x) => x.key === 'back_design'), 'hidden fields can be added back');
  });
});

describe('editing a pipeline', () => {
  test('renaming a stage moves its leads and rules; a stage with leads cannot be removed', async () => {
    let lead = ok(await t.api('POST', '/leads', { brand_id: kh.id, client: { phone: '+91 96000 00006' } }, o.tokens.priya), 201);
    lead = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Trial' }, o.tokens.priya));
    const renamed = [PIPELINE[0], PIPELINE[1], { name: 'Fitting', type: 'open', from: 'Trial' }, { name: 'Booked', type: 'won' }, PIPELINE[4]];
    assert.equal((await t.api('PUT', `/brands/${kh.id}/pipeline`, { stages: renamed }, o.tokens.priya)).status, 403);
    ok(await t.api('PUT', `/brands/${kh.id}/pipeline`, { stages: renamed }, o.admin));
    lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
    assert.equal(lead.stage, 'Fitting');
    const rules = ok(await t.api('GET', `/brands/${kh.id}/rules`, undefined, o.admin));
    assert.equal(rules.find((x) => x.field === 'advance_amount').stage, 'Fitting');
    const orders = ok(await t.api('GET', '/leads?stage_type=won', undefined, o.tokens.priya)).leads.filter((l) => l.brand.code === 'KH');
    assert.ok(orders.every((l) => l.stage === 'Booked'), 'won leads follow the renamed won stage');

    const withoutFitting = [PIPELINE[0], PIPELINE[1], { name: 'Booked', type: 'won' }, PIPELINE[4]];
    const busy = await t.api('PUT', `/brands/${kh.id}/pipeline`, { stages: withoutFitting }, o.admin);
    assert.equal(busy.status, 409);
    assert.match(busy.body.error, /1 in Fitting/);
    lead = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Consultation', reason: 'Re-planning' }, o.tokens.priya));
    ok(await t.api('PUT', `/brands/${kh.id}/pipeline`, { stages: withoutFitting }, o.admin));
    const after = ok(await t.api('GET', `/brands/${kh.id}/rules`, undefined, o.admin));
    assert.equal(after.find((x) => x.field === 'advance_amount').stage, 'Consultation', 'rules of a removed stage move to the stage before it');
  });

  test('a pipeline needs exactly one won and one lost stage', async () => {
    const r = await t.api('PUT', `/brands/${kh.id}/pipeline`, { stages: [{ name: 'A', type: 'open' }, { name: 'B', type: 'lost' }] }, o.admin);
    assert.equal(r.status, 400);
  });
});
