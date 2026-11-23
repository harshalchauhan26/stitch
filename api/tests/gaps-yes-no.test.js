// Yes/No fields in the gap engine: does a "No" answer count as filled?
//   - an ordinary (information) Yes/No field: "No" is an answer, so no gap
//   - a gate (it holds back a stage): "No" means "not done yet", so it stays a gap until "Yes"
// No database needed: node --test tests/gaps-yes-no.test.js
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FIELD_DEFS, GATE_FIELDS } from '../src/catalogue.js';
import { ORDER_STAGES } from '../src/lib/constants.js';
import { isFilled } from '../src/lib/fields.js';
import { computeGaps } from '../src/services/gaps.js';

const shared = new Map(FIELD_DEFS.map((d) => [d.key, d]));
// a brand's own Yes/No field, like "Fabric swatches sent" (custom fields are never gates)
const swatches = { key: 'fabric_swatches_sent', label: 'Fabric swatches sent', scope: 'lead', type: 'bool', record_types: ['lead'], brand_id: 'brand-1' };

// A tiny brand setup: the rules we want to try, and the fields they point to
const brand = (rules, extraDefs = []) => ({
  stages: { lead: ['New', 'Qualifying'], order: ORDER_STAGES },
  defs: new Map([...shared, ...extraDefs.map((d) => [d.key, d])]),
  rules: { lead: rules.filter((r) => r.record_type === 'lead'), order: rules.filter((r) => r.record_type === 'order') },
});
const leadGaps = (rb, fields) => computeGaps({ recordType: 'lead', stage: 'Qualifying', lead: { stage: 'Qualifying', stage_type: 'open', fields, items: [] }, client: {} }, rb).map((g) => g.field);
const orderGaps = (rb, fields) => computeGaps({ recordType: 'order', stage: 'Ready to ship', order: { stage: 'Ready to ship', fields, items: [] }, client: {} }, rb).map((g) => g.field);

describe('an ordinary Yes/No field (information only)', () => {
  const rb = brand([{ record_type: 'lead', stage: 'Qualifying', field: swatches.key, level: 'needed' }], [swatches]);

  test('empty is a gap, Yes is filled, No is filled too', () => {
    assert.deepEqual(leadGaps(rb, {}), [swatches.key]);
    assert.deepEqual(leadGaps(rb, { [swatches.key]: 'Yes' }), []);
    assert.deepEqual(leadGaps(rb, { [swatches.key]: 'No' }), []);
  });

  test('anything else typed in is still not an answer', () => {
    assert.deepEqual(leadGaps(rb, { [swatches.key]: 'Maybe' }), [swatches.key]);
  });
});

describe('gates keep "No" as a gap', () => {
  // the order gates, set up the way the templates set them: Blocking at the stage that captures them
  const rb = brand([
    { record_type: 'order', stage: 'Measurements', field: 'customer_sign_off', level: 'blocking' },
    { record_type: 'order', stage: 'QC approval', field: 'customer_approval', level: 'blocking' },
    { record_type: 'order', stage: 'Ready to ship', field: 'address_confirmed', level: 'blocking' },
  ]);

  test('customer approval, address confirmed and customer sign off: No is still a gap', () => {
    assert.deepEqual(orderGaps(rb, { customer_sign_off: 'No', customer_approval: 'No', address_confirmed: 'No' }).sort(), ['address_confirmed', 'customer_approval', 'customer_sign_off']);
  });

  test('Yes clears each of them', () => {
    assert.deepEqual(orderGaps(rb, { customer_sign_off: 'Yes', customer_approval: 'Yes', address_confirmed: 'Yes' }), []);
  });

  test('every gate field that is a Yes/No field is handled as a gate', () => {
    for (const key of GATE_FIELDS) {
      const def = shared.get(key);
      if (def.type === 'bool') assert.equal(isFilled(def, 'No'), false, `${key}: No must stay a gap`);
    }
  });
});

describe('what makes a Yes/No field a gate', () => {
  test('a field Stitch fills in by itself: its "No" is a real "not yet"', () => {
    assert.equal(isFilled({ key: 'x', type: 'bool', computed: true }, 'No'), false);
    assert.equal(isFilled(shared.get('tracking_shared'), 'No'), false);
  });

  test('a field with blocks_move_to holds a stage back, so "No" is a gap', () => {
    assert.equal(isFilled({ key: 'x', type: 'bool', blocks_move_to: 'Dispatched' }, 'No'), false);
  });

  test('a field the brand set to Blocking is a gate, even if it is an ordinary Yes/No field', () => {
    const plain = { key: 'x', type: 'bool' };
    assert.equal(isFilled(plain, 'No', 'needed'), true);
    assert.equal(isFilled(plain, 'No', 'optional'), true);
    assert.equal(isFilled(plain, 'No', 'blocking'), false);
    const rb = brand([{ record_type: 'lead', stage: 'Qualifying', field: 'x', level: 'blocking' }], [{ ...plain, label: 'X', scope: 'lead', record_types: ['lead'] }]);
    assert.deepEqual(leadGaps(rb, { x: 'No' }), ['x']);
    assert.deepEqual(leadGaps(rb, { x: 'Yes' }), []);
  });

  test('other field types are not affected', () => {
    assert.equal(isFilled({ key: 'n', type: 'text' }, ''), false);
    assert.equal(isFilled({ key: 'n', type: 'text' }, 'No'), true);
    assert.equal(isFilled({ key: 'p', type: 'paid' }, 'Unpaid'), false);
    assert.equal(isFilled({ key: 'p', type: 'paid' }, 'Paid'), true);
    assert.equal(isFilled({ key: 'q', type: 'select', done_values: ['Accepted'] }, 'Sent'), false);
  });
});
