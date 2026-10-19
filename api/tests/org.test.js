import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { seedOrg, startApp } from './helpers.js';

let t, o;
before(async () => { t = await startApp(); o = await seedOrg(t); });
after(async () => { await t.close(); });

describe('auth', () => {
  test('wrong password is rejected, no token without login', async () => {
    assert.equal((await t.api('POST', '/auth/login', { email: 'admin@stitch.test', password: 'nope' })).status, 401);
    assert.equal((await t.api('GET', '/me')).status, 401);
  });
  test('/me shows the brands of every team the user is in', async () => {
    const me = await t.api('GET', '/me', undefined, o.tokens.meera);
    assert.deepEqual(me.body.brands.map((b) => b.code).sort(), ['NA', 'VM']);
    const priya = await t.api('GET', '/me', undefined, o.tokens.priya);
    assert.deepEqual(priya.body.brands.map((b) => b.code), ['NA']);
  });
});

describe('brand onboarding', () => {
  test('a new brand gets its template rules, with the gate fields locked', async () => {
    assert.ok(o.na.rules > 50);
    const rules = await t.api('GET', '/brands', undefined, o.admin);
    assert.equal(rules.status, 200);
    assert.deepEqual(rules.body.map((b) => b.code).sort(), ['NA', 'VM']);
  });

  test('the same brand twice is refused with who added it and which team handles it', async () => {
    const r = await t.api('POST', '/brands', { name: 'The Noor Atelier Pvt Ltd', code: 'NO', template_key: 'womenswear' }, o.admin);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'duplicate_brand');
    assert.match(r.body.error, /Noor Atelier is already onboarded \(added by Admin on \d{4}-\d{2}-\d{2}, handled by Team Alpha\)/);
  });

  test('duplicate code, Instagram, website and WhatsApp number are each caught', async () => {
    const cases = [
      [{ name: 'Brand X', code: 'na' }, /Code NA is already used by Noor Atelier/],
      [{ name: 'Brand Y', code: 'BY', instagram: 'https://instagram.com/NoorAtelier/' }, /Instagram handle belongs to Noor Atelier/],
      [{ name: 'Brand Z', code: 'BZ', whatsapp_numbers: ['919811100001'] }, /\+919811100001 is already connected to Noor Atelier/],
    ];
    for (const [body, msg] of cases) {
      const r = await t.api('POST', '/brands', { template_key: 'womenswear', ...body }, o.admin);
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.match(r.body.error, msg);
    }
  });

  test('a similar name needs confirmation, then goes through', async () => {
    const body = { name: 'Noor Ateliers', code: 'NS', template_key: 'womenswear' };
    const r = await t.api('POST', '/brands', body, o.admin);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'similar_brand');
    const ok = await t.api('POST', '/brands', { ...body, confirm_similar: true }, o.admin);
    assert.equal(ok.status, 201);
  });

  test('the live check endpoint reports conflicts before saving', async () => {
    const r = await t.api('GET', '/brands/check?name=noor%20atelier&website=nooratelier.com', undefined, o.admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.conflicts[0].field, 'name');
  });

  test('an archived brand asks to be restored instead of re-added', async () => {
    const b = await t.api('POST', '/brands', { name: 'Kesar House', code: 'KH', template_key: 'womenswear' }, o.admin);
    await t.api('POST', `/brands/${b.body.id}/archive`, {}, o.admin);
    const r = await t.api('POST', '/brands', { name: 'Kesar House', code: 'KH2', template_key: 'womenswear' }, o.admin);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /archived: restore it/);
  });

  test('only admins onboard brands', async () => {
    const r = await t.api('POST', '/brands', { name: 'Sneaky', code: 'SN', template_key: 'womenswear' }, o.tokens.priya);
    assert.equal(r.status, 403);
  });
});

describe('scope', () => {
  test('members only see the brands of their teams', async () => {
    const r = await t.api('GET', `/brands/${o.vm.id}`, undefined, o.tokens.priya);
    assert.equal(r.status, 404);
    assert.equal((await t.api('GET', `/brands/${o.vm.id}`, undefined, o.tokens.arjun)).status, 200);
  });

  test('adding a brand to a team gives its members access immediately', async () => {
    await t.api('PATCH', `/teams/${o.alpha.id}`, { brand_ids: [o.na.id, o.vm.id] }, o.admin);
    assert.equal((await t.api('GET', `/brands/${o.vm.id}`, undefined, o.tokens.priya)).status, 200);
    await t.api('PATCH', `/teams/${o.alpha.id}`, { brand_ids: [o.na.id] }, o.admin);
    assert.equal((await t.api('GET', `/brands/${o.vm.id}`, undefined, o.tokens.priya)).status, 404);
  });

  test('a user can be in several teams (many-to-many)', async () => {
    const teams = await t.api('GET', '/teams', undefined, o.tokens.meera);
    assert.deepEqual(teams.body.map((x) => x.name), ['Team Alpha', 'Team Beta']);
  });
});

describe('WhatsApp accounts', () => {
  test('a number already used by another brand is refused', async () => {
    const r = await t.api('POST', `/brands/${o.vm.id}/whatsapp-accounts`, { phone: '+91 98111 00001' }, o.admin);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already connected to Noor Atelier/);
    const ok = await t.api('POST', `/brands/${o.vm.id}/whatsapp-accounts`, { phone: '+44 7700 900123' }, o.admin);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.phone, '+447700900123');
  });
});
