import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { todayIso } from '../src/lib/validate.js';
import { seedOrg, startApp } from './helpers.js';

let t, o, order;
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const reload = async () => { order = ok(await t.api('GET', `/orders/${order.id}`, undefined, o.tokens.priya)); return order; };
const move = async (to, token = o.tokens.priya, extra = {}) => t.api('POST', `/orders/${order.id}/stage`, { version: order.version, to, ...extra }, token);

before(async () => {
  t = await startApp(); o = await seedOrg(t);
  let lead = ok(await t.api('POST', '/leads', {
    brand_id: o.na.id, client: { phone: '+91 97000 00001', name: 'Tara Menon', whatsapp_consent: 'Yes' },
    fields: { event_date: '2026-12-05', country: 'India', quote_amount: 15000000, promised_ship_date: '2026-10-01', delivery_address: '4 Park St, Kolkata' },
    items: [{ product: 'Lehenga', fields: { neckline: 'V', waist: 28, hip: 38 } }, { product: 'Blouse', fields: { blouse_size: 'M' } }],
  }, o.tokens.priya), 201);
  for (const to of ['Qualifying', 'Customising', 'Quoted', 'Awaiting payment']) lead = ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to }, o.tokens.priya));
  ok(await t.api('POST', `/leads/${lead.id}/payments`, { kind: 'advance', amount: 5000000, status: 'received', mode: 'UPI', transaction_ref: 'F-ADV-1' }, o.tokens.priya), 201);
  lead = ok(await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya));
  order = { id: ok(await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to: 'Won' }, o.tokens.priya)).order_id };
  await reload();
});
after(async () => { await t.close(); });

describe('customisations: corrections are new versions', () => {
  test('a measurement correction needs a reason and supersedes the old version', async () => {
    const item = order.items[0];
    assert.equal((await t.api('POST', `/orders/${order.id}/items/${item.id}/customisations`, { kind: 'measurements', values: { waist: 29 } }, o.tokens.priya)).status, 400);
    assert.equal((await t.api('POST', `/orders/${order.id}/items/${item.id}/customisations`, { kind: 'spec', values: { waist: 29 }, reason: 'x' }, o.tokens.priya)).status, 400, 'waist is a measurement, not spec');
    const v2 = ok(await t.api('POST', `/orders/${order.id}/items/${item.id}/customisations`, { kind: 'measurements', values: { waist: 29 }, reason: 'Re-measured at the trial', source: 'store_visit' }, o.tokens.priya), 201);
    assert.equal(v2.version, 2);
    assert.deepEqual(v2.changed_fields, ['waist']);
    assert.deepEqual(v2.values, { waist: 29, hip: 38 });
    const all = ok(await t.api('GET', `/orders/${order.id}/items/${item.id}/customisations?kind=measurements`, undefined, o.tokens.priya));
    assert.deepEqual(all.map((c) => [c.version, c.status]), [[2, 'draft'], [1, 'superseded']]);
    await reload();
    assert.equal(order.items[0].measurements.version, 2);
  });

  test('customer sign-off on every item clears the Production gate; a later correction needs a new sign-off', async () => {
    const [a, b] = order.items;
    assert.equal((await t.api('POST', `/customisations/${b.measurements.id}/sign-off`, {}, o.tokens.priya)).status, 400, 'nothing to sign yet');
    ok(await t.api('POST', `/orders/${order.id}/items/${b.id}/customisations`, { kind: 'measurements', values: { bust: 34 }, reason: 'Customer sent measurements' }, o.tokens.priya), 201);
    await reload();
    ok(await t.api('POST', `/customisations/${order.items[0].measurements.id}/sign-off`, {}, o.tokens.priya));
    await reload();
    assert.equal(order.fields.customer_sign_off, 'No', 'one item still unsigned');
    ok(await t.api('POST', `/customisations/${order.items[1].measurements.id}/sign-off`, {}, o.tokens.priya));
    await reload();
    assert.equal(order.fields.customer_sign_off, 'Yes');
    for (const to of ['Spec locked', 'Measurements', 'Production']) { ok(await move(to)); await reload(); }
    ok(await t.api('POST', `/orders/${order.id}/items/${a.id}/customisations`, { kind: 'measurements', values: { hip: 39 }, reason: 'Alteration after first fitting' }, o.tokens.priya), 201);
    await reload();
    assert.equal(order.fields.customer_sign_off, 'No');
  });

  test('after Spec locked, a spec change from sales waits for a pod lead', async () => {
    const item = order.items[0];
    const r = ok(await t.api('POST', `/orders/${order.id}/items/${item.id}/customisations`, { kind: 'spec', values: { neckline: 'Sweetheart' }, reason: 'Customer changed her mind' }, o.tokens.priya), 201);
    assert.equal(r.pending_approval, true);
    await reload();
    assert.equal(order.items[0].spec.values.neckline, 'V', 'still the approved spec');
    assert.equal((await t.api('POST', `/customisations/${r.id}/approve`, {}, o.tokens.priya)).status, 403);
    ok(await t.api('POST', `/customisations/${r.id}/approve`, {}, o.tokens.meera));
    await reload();
    assert.equal(order.items[0].spec.values.neckline, 'Sweetheart');
    const ev = ok(await t.api('GET', `/orders/${order.id}/events`, undefined, o.tokens.priya));
    assert.equal(ev[0].type, 'customisation.approved');
    assert.equal(ev[0].actor.name, 'Meera Lead');
  });
});

describe('dispatches and the weekly view', () => {
  let dispatch;
  test('cannot dispatch before Ready to ship, nor without the balance paid', async () => {
    assert.equal((await t.api('POST', `/orders/${order.id}/dispatches`, { version: order.version, courier: 'Delhivery' }, o.tokens.priya)).status, 409);
    ok(await t.api('PATCH', `/orders/${order.id}`, { version: order.version, fields: { production_completed: todayIso(), customer_approval: 'Yes', qc_result: 'Pass', verified_shipping_address: '4 Park St, Kolkata 700016', address_confirmed: 'Yes' } }, o.tokens.priya));
    await reload();
    ok(await move('QC approval', o.tokens.meera, { override: true, reason: 'Re-sign-off pending, customer approved on call' }));
    await reload();
    ok(await move('Ready to ship'));
    await reload();
    const r = await t.api('POST', `/orders/${order.id}/dispatches`, { version: order.version, courier: 'Delhivery' }, o.tokens.priya);
    assert.equal(r.status, 422);
    assert.deepEqual(r.body.blockers.map((g) => g.field), ['balance_payment']);
  });

  test('the first shipment moves the order to Dispatched and is flagged late against the promised date', async () => {
    ok(await t.api('POST', `/orders/${order.id}/payments`, { kind: 'balance', amount: 10000000, status: 'received', transaction_ref: 'F-BAL-1' }, o.tokens.priya), 201);
    await reload();
    dispatch = ok(await t.api('POST', `/orders/${order.id}/dispatches`, { version: order.version, courier: 'Delhivery', awb: 'dl123', dispatch_date: todayIso() }, o.tokens.priya), 201);
    assert.equal(dispatch.awb, 'DL123');
    assert.equal(dispatch.late, true);
    assert.equal(dispatch.ship_to.address, '4 Park St, Kolkata 700016');
    await reload();
    assert.equal(order.stage, 'Dispatched');
  });

  test('a wrong AWB is corrected with a reason; tracking shared and delivery update the order', async () => {
    assert.equal((await t.api('PATCH', `/dispatches/${dispatch.id}`, { awb: 'DL124' }, o.tokens.priya)).status, 400);
    const fixed = ok(await t.api('PATCH', `/dispatches/${dispatch.id}`, { awb: 'DL124', reason: 'Typo in AWB' }, o.tokens.priya));
    assert.deepEqual(fixed.corrections.map((c) => [c.field, c.old, c.new, c.reason]), [['awb', 'DL123', 'DL124', 'Typo in AWB']]);
    ok(await t.api('PATCH', `/dispatches/${dispatch.id}`, { tracking_shared: true, status: 'in_transit' }, o.tokens.priya));
    await reload();
    assert.equal(order.fields.tracking_shared, 'Yes');
    ok(await t.api('PATCH', `/dispatches/${dispatch.id}`, { status: 'delivered' }, o.tokens.priya));
    await reload();
    assert.equal(order.stage, 'Delivered');
  });

  test('the weekly view counts shipments per brand and lists late ones and every correction', async () => {
    const w = ok(await t.api('GET', '/dispatches/weekly', undefined, o.tokens.priya));
    assert.deepEqual(w.totals, { dispatched: 1, late: 1, corrections: 5 });
    assert.equal(w.by_brand[0].brand, 'NA');
    assert.equal(w.by_brand[0].delivered, 1);
    assert.equal(w.late[0].order_no, 'ORD-NA-2001');
    const kinds = w.corrections.map((c) => `${c.kind}:${c.field}`);
    assert.ok(kinds.includes('dispatch:awb'));
    assert.ok(kinds.includes('measurements:waist'));
    assert.ok(kinds.includes('spec:neckline'));
    assert.equal(ok(await t.api('GET', '/dispatches/weekly', undefined, o.tokens.arjun)).totals.dispatched, 0, 'other brands see nothing');
    assert.equal((await t.api('GET', '/dispatches/weekly?week=2021-W53', undefined, o.tokens.priya)).status, 400);
  });
});
