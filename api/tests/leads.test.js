import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { seedOrg, startApp } from './helpers.js';

let t, o;
before(async () => { t = await startApp(); o = await seedOrg(t); });
after(async () => { await t.close(); });

const newLead = (extra = {}) => ({
  brand_id: o.na.id,
  client: { phone: '+91 98200 11111', name: 'Riya Sharma', whatsapp_consent: 'Yes' },
  fields: { event_date: '2026-12-14', country: 'India', occasion_type: 'Wedding' },
  items: [{ product: 'Bridal lehenga' }],
  ...extra,
});
const gapKeys = (lead) => lead.gaps.map((g) => (g.item_id ? `${g.field}#${g.item_label}` : g.field)).sort();

describe('create a lead by hand', () => {
  let lead;
  test('saves with gaps, numbers it, and records who created it from which team', async () => {
    const r = await t.api('POST', '/leads', newLead(), o.tokens.priya);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    lead = r.body;
    assert.equal(lead.lead_no, 'LD-1001');
    assert.equal(lead.stage, 'New');
    assert.equal(lead.client.phone, '+919820011111');
    // only New-stage gaps: later stages never show (spec A2)
    assert.deepEqual(gapKeys(lead), ['lead_source', 'next_followup_date']);
    const ev = await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya);
    assert.equal(ev.body[0].type, 'lead.created');
    assert.equal(ev.body[0].actor.name, 'Priya Shah');
    assert.equal(ev.body[0].actor.team_name, 'Team Alpha');
    assert.ok(ev.body[0].changes.some((c) => c.field === 'event_date' && c.new === '2026-12-14'));
  });

  test('the same client and brand with an open lead needs confirmation (one lead = one purchase)', async () => {
    const r = await t.api('POST', '/leads', newLead({ client: { phone: '9820011111', name: 'Riya S.' } }), o.tokens.priya);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'open_lead_exists');
    assert.equal(r.body.lead_no, 'LD-1001');
    const ok = await t.api('POST', '/leads', newLead({ client: { phone: '9820011111', name: 'Riya S.' }, confirm_new_purchase: true }), o.tokens.priya);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.client.name, 'Riya Sharma', 'existing name is kept');
    assert.ok(ok.body.warnings.some((w) => /existing client whose name is "Riya Sharma"/.test(w)));
    assert.ok(ok.body.warnings.some((w) => /taken as an Indian number/.test(w)));
  });

  test('members of other teams cannot see it; owners must handle the brand', async () => {
    assert.equal((await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.arjun)).status, 404);
    const r = await t.api('POST', '/leads', newLead({ owner_id: o.arjun.id, client: { phone: '+91 98200 22222' } }), o.tokens.priya);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /owner must be in a team that handles this brand/);
  });

  test('fields are checked against the catalogue and the brand', async () => {
    const bad = [
      [{ fields: { nekline: 'V' } }, /"nekline" does not exist/],
      [{ fields: { advance_amount: 5000000 } }, /filled in by Stitch/],
      [{ fields: { event_date: '2026-02-30' } }, /Event date must be a date/],
      [{ items: [{ product: 'Lehenga', fields: { waist: 90 } }] }, /Waist must be between 18 and 70 in/],
      [{ items: [{ product: 'Lehenga', fields: { collar_style: 'Band' } }] }, /This brand does not use "Collar style"/],
    ];
    for (const [extra, msg] of bad) {
      const r = await t.api('POST', '/leads', newLead({ ...extra, client: { phone: '+91 98200 33333' } }), o.tokens.priya);
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.match(r.body.error, msg);
    }
  });
});

describe('editing, stages and gates', () => {
  let lead;
  before(async () => {
    lead = (await t.api('POST', '/leads', newLead({ client: { phone: '+44 7700 900555', name: 'Asha Patel', whatsapp_consent: 'Yes' },
      fields: { event_date: '2027-01-20', country: 'United Kingdom', lead_source: 'Instagram', next_followup_date: '2026-10-25' } }), o.tokens.priya)).body;
  });
  const patch = async (body, token = o.tokens.priya) => {
    const r = await t.api('PATCH', `/leads/${lead.id}`, { version: lead.version, ...body }, token);
    if (r.status === 200) lead = r.body;
    return r;
  };
  const move = async (to, extra = {}, token = o.tokens.priya) => {
    const r = await t.api('POST', `/leads/${lead.id}/stage`, { version: lead.version, to, ...extra }, token);
    if (r.status === 200) lead = r.body;
    return r;
  };

  test('an edit records old and new values; a stale version is refused', async () => {
    const r = await patch({ fields: { delivery_deadline: '2027-01-10' }, client: { customer_type: 'New' } });
    assert.equal(r.status, 200);
    const stale = await t.api('PATCH', `/leads/${lead.id}`, { version: lead.version - 1, fields: { notes: 'x' } }, o.tokens.priya);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'version_conflict');
    const ev = (await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya)).body[0];
    assert.equal(ev.type, 'field.set');
    assert.deepEqual(ev.changes.map((c) => [c.field, c.old, c.new]), [['delivery_deadline', null, '2027-01-10'], ['customer_type', null, 'New']]);
  });

  test('two people saving at the same moment: exactly one wins', async () => {
    const v = lead.version;
    const [a, b] = await Promise.all([
      t.api('PATCH', `/leads/${lead.id}`, { version: v, fields: { notes: 'from Priya' } }, o.tokens.priya),
      t.api('PATCH', `/leads/${lead.id}`, { version: v, fields: { notes: 'from Meera' } }, o.tokens.meera),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    lead = (await t.api('GET', `/leads/${lead.id}`, undefined, o.tokens.priya)).body;
  });

  test('item gaps name the item, measurements convert from cm, custom size makes full measurements needed', async () => {
    assert.equal((await move('Customising')).status, 200);
    assert.ok(gapKeys(lead).includes('neckline#Item 1 · Bridal lehenga'));
    await patch({ items: [{ id: lead.items[0].id, fields: { waist: '71 cm', blouse_size: 'custom' } }, { product: 'Dupatta' }] });
    assert.equal(lead.items[0].fields.waist, 28);
    assert.equal(lead.items[0].fields.blouse_size, 'Custom');
    assert.equal((await move('Quoted')).status, 200);
    const keys = gapKeys(lead);
    assert.ok(keys.includes('shoulder#Item 1 · Bridal lehenga'), 'custom blouse needs shoulder');
    assert.ok(!keys.includes('shoulder#Item 2 · Dupatta'), 'standard item does not');
    assert.ok(keys.includes('duty_estimate'), 'shipping outside India needs a duty estimate');
  });

  test('Won is blocked by the payment gate, the refusal is logged, and only pod leads can override', async () => {
    assert.equal((await move('Awaiting payment')).status, 200);
    const r = await move('Won');
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'blocked');
    assert.deepEqual(r.body.blockers.map((g) => g.field).sort(), ['advance_amount', 'payment_link_sent']);
    const ev = (await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya)).body[0];
    assert.equal(ev.type, 'stage.move_blocked');
    assert.equal((await move('Won', { override: true, reason: 'Paid cash' })).status, 403);
  });

  test('skipping ahead does not skip the gates', async () => {
    const fresh = (await t.api('POST', '/leads', newLead({ client: { phone: '+91 98200 44444' } }), o.tokens.priya)).body;
    const r = await t.api('POST', `/leads/${fresh.id}/stage`, { version: fresh.version, to: 'Won' }, o.tokens.priya);
    assert.equal(r.status, 422);
  });

  test('moving back needs a reason', async () => {
    assert.equal((await move('Quoted')).status, 400);
    const r = await move('Quoted', { reason: 'Customer wants a new quote' });
    assert.equal(r.status, 200);
    assert.equal(lead.stage, 'Quoted');
  });

  test('undo restores the old value, but not after it changed again', async () => {
    await patch({ fields: { quote_amount: 24000000 } });
    await patch({ fields: { quote_amount: 25000000 } });
    const events = (await t.api('GET', `/leads/${lead.id}/events`, undefined, o.tokens.priya)).body;
    const r = await t.api('POST', `/leads/${lead.id}/undo/${events[0].id}`, { version: lead.version }, o.tokens.priya);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.fields.quote_amount, 24000000);
    lead = r.body;
    // undoing the same change twice: the value is no longer what that change set
    const stale = await t.api('POST', `/leads/${lead.id}/undo/${events[0].id}`, { version: lead.version }, o.tokens.priya);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'undo_stale');
  });

  test('Lost needs a reason; reopening returns to where it was', async () => {
    assert.equal((await t.api('POST', `/leads/${lead.id}/lost`, { version: lead.version }, o.tokens.priya)).status, 400);
    let r = await t.api('POST', `/leads/${lead.id}/lost`, { version: lead.version, reason: 'Price' }, o.tokens.priya);
    assert.equal(r.status, 200);
    assert.equal(r.body.stage, 'Lost');
    assert.equal((await t.api('PATCH', `/leads/${lead.id}`, { version: r.body.version, fields: { notes: 'x' } }, o.tokens.priya)).status, 409);
    r = await t.api('POST', `/leads/${lead.id}/reopen`, { version: r.body.version }, o.tokens.priya);
    assert.equal(r.status, 200);
    assert.equal(r.body.stage, 'Quoted');
    lead = r.body;
  });
});

describe('the to-do list and the rules editor', () => {
  test('/gaps lists blocking gaps first and respects brand scope', async () => {
    const mine = (await t.api('GET', '/gaps', undefined, o.tokens.priya)).body;
    assert.ok(mine.length > 0);
    assert.ok(mine.every((g) => g.brand === 'NA'));
    const firstNeeded = mine.findIndex((g) => g.level === 'needed');
    assert.ok(mine.slice(firstNeeded).every((g) => g.level === 'needed'));
    assert.deepEqual((await t.api('GET', '/gaps', undefined, o.tokens.arjun)).body, []);
  });

  test('a pod lead cannot lower a gate field, an admin can, and it is logged', async () => {
    const lower = { rules: [{ record_type: 'lead', stage: 'Awaiting payment', field: 'advance_amount', level: 'needed' }] };
    const r = await t.api('PUT', `/brands/${o.na.id}/rules`, lower, o.tokens.meera);
    assert.equal(r.status, 403);
    assert.match(r.body.error, /six gate fields/);
    assert.equal((await t.api('PUT', `/brands/${o.na.id}/rules`, lower, o.admin)).status, 200);
    const back = { rules: [{ record_type: 'lead', stage: 'Awaiting payment', field: 'advance_amount', level: 'blocking' }] };
    assert.equal((await t.api('PUT', `/brands/${o.na.id}/rules`, back, o.tokens.meera)).status, 200);
  });

  test('hiding a field for a brand stops it being set', async () => {
    const hide = { rules: [{ record_type: 'lead', stage: 'New', field: 'priority', level: null }] };
    assert.equal((await t.api('PUT', `/brands/${o.na.id}/rules`, hide, o.admin)).status, 200);
    const r = await t.api('POST', '/leads', newLead({ client: { phone: '+91 98200 55555' }, fields: { priority: 'High' } }), o.tokens.priya);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /does not use "Priority"/);
  });
});
