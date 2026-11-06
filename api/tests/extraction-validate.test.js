// Chat extraction, the checking half (services/extraction.js). It needs no database and no LLM, so it runs anywhere:
//   node --test tests/extraction-validate.test.js
// A brand's rules are built straight from the womenswear template in catalogue.js, which gives the same field list a real
// brand gets at onboarding. Each test feeds validateOutput() the kind of JSON a model returns (good values, bad values,
// repeats, empty answers) and checks what becomes a suggestion and what becomes an exception with a reason.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FIELD_DEFS, TEMPLATES } from '../src/catalogue.js';
import { buildPrompt, coverage, fillable, liftProducts, readNewItems, schemaFor, validateOutput } from '../src/services/extraction.js';
import { pipelineOf } from '../src/services/pipeline.js';

const lead = (rules) => rules.filter((r) => r.record_type === 'lead');
const rb = (() => {
  const rules = lead(TEMPLATES.find((t) => t.key === 'womenswear').rules);
  return {
    brand: { name: 'Noor Atelier' }, pipeline: pipelineOf(null),
    defs: new Map(FIELD_DEFS.map((d) => [d.key, d])), rules: { lead: rules, order: [] },
    visible: { lead: new Set(rules.map((r) => r.field)), order: new Set() },
  };
})();
const fill = fillable(rb);
const msg = new Map([[1, 'm1'], [2, 'm2'], [3, 'm3']]);
const item = { _id: 'i1', product: 'Bridal lehenga', quantity: 1, fields: {} };
const base = () => ({ rb, fill, client: { name: 'Riya', whatsapp_consent: 'Unknown' }, lead: { stage: 'New', fields: {}, items: [item] }, products: new Map(), msg });
const run = (suggestions, extra = {}) => validateOutput({ suggestions }, { ...base(), ...extra });
const find = (r, field) => r.suggestions.find((s) => s.field === field);

describe('what the model is offered', () => {
  test('every fillable field of the brand, none that Stitch computes, no phone or product line', () => {
    for (const k of ['event_date', 'country', 'quote_amount', 'neckline', 'waist', 'blouse_size', 'client_name', 'email', 'customer_type', 'notes', 'delivery_address']) assert.ok(fill.has(k), k);
    for (const k of ['advance_amount', 'payment_link_sent', 'payment_mode', 'transaction_id', 'payment_received_date', 'link_expiry', 'phone', 'product']) assert.ok(!fill.has(k), k);
    assert.ok(!fill.has('collar_style'), 'menswear fields are not offered to a womenswear brand');
    const keys = schemaFor(fill).map((f) => f.key);
    assert.ok(keys.includes('wearer') && keys.includes('unit_price'));
  });
  test('the prompt carries the schema, the known values and the numbered chat; long chats keep the newest part', () => {
    const messages = Array.from({ length: 400 }, (_, i) => ({ idx: i, role: i % 2 ? 'staff' : 'customer', sender: 'x', text: `message number ${i} `.repeat(3) }));
    const p = buildPrompt({ rb, fill, client: { name: 'Riya' }, lead: base().lead, products: [{ sku: 'NA-1', name: 'Lehenga', base_price: 5000000 }], messages, today: '2026-10-20' });
    assert.match(p.system, /^neckline \| item \| text/m);
    assert.match(p.system, /^blouse_size \| item \| select \| one of: XS \/ S/m);
    assert.match(p.system, /NA-1/);
    assert.match(p.user, /"today":"2026-10-20"/);
    assert.match(p.user, /\[399\] STAFF/);
    assert.ok(p.truncated && p.read < 400);
  });
});

describe('checking what the model says', () => {
  test('values pass through the same parsing as manual edits: dates, rupees to paise, cm to inches, select casing', () => {
    const r = run([
      { field: 'event_date', value: '2026-12-14', message: 2, confidence: 0.95, evidence: 'it is on 14 Dec' },
      { field: 'quote_amount', value: 240000, message: 3 },
      { field: 'budget_max', value: '2,00,000', message: 2 },
      { field: 'waist', item: 1, value: '71 cm', message: 2 },
      { field: 'blouse_size', item: 1, value: 'custom', message: 2 },
      { field: 'occasion_type', value: 'wedding', message: 1 },
    ]);
    assert.deepEqual(r.exceptions, []);
    assert.equal(find(r, 'event_date').value, '2026-12-14');
    assert.equal(find(r, 'event_date').source_message_id, 'm2');
    assert.equal(find(r, 'quote_amount').value, 24000000);
    assert.equal(find(r, 'budget_max').value, 20000000);
    assert.equal(find(r, 'waist').value, 28);
    assert.equal(find(r, 'waist').item_id, 'i1');
    assert.equal(find(r, 'blouse_size').value, 'Custom');
    assert.equal(find(r, 'occasion_type').value, 'Wedding');
  });

  test('item attributes and customer details are supported', () => {
    const r = run([
      { field: 'quantity', item: 1, value: 2 }, { field: 'wearer', item: 1, value: 'Her sister' }, { field: 'unit_price', item: 1, value: 180000 },
      { field: 'client_name', value: 'Riya Sharma' }, { field: 'email', value: 'riya@example.com' }, { field: 'whatsapp_consent', value: 'Yes' }, { field: 'city', value: 'Pune' },
    ]);
    assert.deepEqual(r.exceptions, []);
    assert.equal(find(r, 'quantity').value, 2);
    assert.equal(find(r, 'unit_price').value, 18000000);
    assert.equal(find(r, 'client_name').scope, 'client');
    assert.equal(find(r, 'client_name').previous, 'Riya');
  });

  test('anything that does not fit goes to exceptions with the reason, and the rest still comes through', () => {
    const r = run([
      { field: 'nekline', value: 'V' },
      { field: 'advance_amount', value: 5000 },
      { field: 'phone', value: '+91 98111 22222' },
      { field: 'collar_style', item: 1, value: 'Band' },
      { field: 'event_date', value: '2026-02-30' },
      { field: 'waist', item: 1, value: 90 },
      { field: 'neckline', item: 4, value: 'V' },
      { field: 'neckline', value: 'V' },
      { field: 'email', value: 'not-an-email' },
      { field: 'whatsapp_consent', value: 'maybe' },
      { field: 'lead_source', value: 'Carrier pigeon' },
      { field: 'country', value: 'India', message: 1 },
    ]);
    const why = Object.fromEntries(r.exceptions.map((e) => [`${e.field}${e.item ?? ''}`, e.code]));
    assert.deepEqual(why, {
      nekline: 'unknown_field', advance_amount: 'computed', phone: 'not_allowed', collar_style1: 'not_used', event_date: 'invalid_value',
      waist1: 'invalid_value', neckline4: 'bad_item', neckline: 'bad_item', email: 'invalid_value', whatsapp_consent: 'invalid_value', lead_source: 'invalid_value',
    });
    assert.match(r.exceptions.find((e) => e.field === 'waist').reason, /between 18 and 70/);
    assert.deepEqual(r.suggestions.map((s) => s.field), ['country']);
  });

  test('empty answers, repeats of what is stored, and weaker duplicates are dropped quietly', () => {
    const lead = { stage: 'New', fields: { country: 'India' }, items: [{ ...item, fields: { neckline: 'V' } }] };
    const r = run([
      { field: 'country', value: 'India' }, { field: 'neckline', item: 1, value: 'v' }, { field: 'notes', value: '' }, { field: 'tags', value: null },
      { field: 'priority', value: 'Low', confidence: 0.4 }, { field: 'priority', value: 'High', confidence: 0.9 },
    ], { lead });
    assert.deepEqual(r.exceptions, []);
    assert.deepEqual(r.suggestions.map((s) => [s.field, s.value]), [['priority', 'High']]);
  });

  test('a changed value is proposed with what it replaces', () => {
    const r = run([{ field: 'country', value: 'United Kingdom' }], { lead: { stage: 'New', fields: { country: 'India' }, items: [item] } });
    assert.equal(r.suggestions[0].previous, 'India');
  });

  test('products new to the lead wait for a person; ones already there are skipped; catalogue SKUs are matched', () => {
    const products = new Map([['NA-LEH-014', { _id: 'p1', name: 'Bridal lehenga · ivory' }]]);
    const out = { new_items: [{ product: 'Dupatta', quantity: 2, message: 3, confidence: 0.8 }, { product: 'bridal LEHENGA' }, { product: 'x', sku: 'na-leh-014' }, { product: '', quantity: 1 }, { product: 'Saree', quantity: 99 }] };
    const ni = readNewItems(out, { products, msg });
    assert.deepEqual(ni.items.map((i) => [i.product, i.quantity, i.product_id]), [['Dupatta', 2, null], ['bridal LEHENGA', 1, null], ['x', 1, 'p1']]);
    assert.deepEqual(ni.exceptions.map((e) => e.code), ['invalid_value', 'invalid_value']);
    const r = validateOutput({ suggestions: [] }, { ...base(), addItems: ni.items });
    assert.deepEqual(r.suggestions.map((s) => [s.scope, s.value.product]), [['new_item', 'Dupatta'], ['new_item', 'x']]);
  });
});

describe('products listed as fields', () => {
  test('a product the model listed as "product" / "sku" becomes a new item, with its quantity; real new_items are left alone', () => {
    const out = liftProducts({ suggestions: [
      { field: 'product', value: 'Bridal lehenga', message: 1, confidence: 0.9, evidence: 'crimson lehenga' }, { field: 'sku', value: 'NA-LEH-021', item: 1 },
      { field: 'quantity', value: 2, item: 1 }, { field: 'neckline', value: 'V', item: 1 }, { field: 'product', value: 'Dupatta', item: 2 },
    ] });
    assert.deepEqual(out.new_items.map((i) => [i.product, i.sku, i.quantity]), [['Bridal lehenga', 'NA-LEH-021', 2], ['Dupatta', undefined, undefined]]);
    assert.deepEqual(out.suggestions.map((s) => s.field), ['quantity', 'neckline']);
    const kept = { suggestions: [{ field: 'product', value: 'x' }], new_items: [{ product: 'Real' }] };
    assert.deepEqual(liftProducts(kept).new_items, [{ product: 'Real' }]);
    assert.equal(liftProducts({ suggestions: [{ field: 'city', value: 'Pune' }] }).new_items, undefined);
  });
});

describe('coverage', () => {
  test('says which fields the chat filled, which were already filled, and which it could not supply', () => {
    const l = { stage: 'New', fields: { country: 'India' }, items: [item] };
    const v = validateOutput({ suggestions: [{ field: 'event_date', value: '2026-12-14' }] }, { ...base(), lead: l });
    const rows = coverage(fill, { rb, client: { name: 'Riya' }, lead: l, keys: v.keys });
    const state = (f) => rows.find((r) => r.field === f)?.state;
    assert.equal(state('event_date'), 'suggested');
    assert.equal(state('country'), 'filled');
    assert.equal(state('lead_source'), 'not_found');
    assert.equal(rows.find((r) => r.field === 'neckline').item_id, 'i1');
    assert.equal(state('duty_estimate'), undefined, 'duty only applies outside India');
  });
});
