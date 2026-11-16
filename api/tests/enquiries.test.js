// The landing-page form: anyone can post an enquiry, only an admin can read the list.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Enquiry } from '../src/models/index.js';
import { seedOrg, startApp } from './helpers.js';

let t, o;
const form = { name: 'Aanya Kapoor', brand: 'Kesar House', phone: '98111 15326', email: 'Aanya@Kesar.com', purpose: 'Track wedding orders' };

before(async () => { t = await startApp(); o = await seedOrg(t); });
after(async () => { await t.close(); });

describe('enquiries', () => {
  test('a visitor can post the form without logging in; phone and e-mail are cleaned', async () => {
    const r = await t.api('POST', '/enquiries', form);
    assert.equal(r.status, 201);
    const e = await Enquiry.findOne().lean();
    assert.equal(e.phone, '+919811115326');
    assert.equal(e.email, 'aanya@kesar.com');
    assert.equal(e.status, 'new');
  });

  test('missing or bad details are refused', async () => {
    assert.equal((await t.api('POST', '/enquiries', { ...form, name: '' })).status, 400);
    assert.equal((await t.api('POST', '/enquiries', { ...form, phone: 'abc' })).status, 400);
    assert.equal((await t.api('POST', '/enquiries', { ...form, email: 'nope' })).status, 400);
  });

  test('the hidden website field marks a bot: it looks accepted but nothing is saved', async () => {
    const before = await Enquiry.countDocuments();
    assert.equal((await t.api('POST', '/enquiries', { ...form, website: 'http://spam' })).status, 201);
    assert.equal(await Enquiry.countDocuments(), before);
  });

  test('only an admin can read the list', async () => {
    assert.equal((await t.api('GET', '/enquiries')).status, 401);
    assert.equal((await t.api('GET', '/enquiries', undefined, o.tokens.priya)).status, 403);
    const r = await t.api('GET', '/enquiries', undefined, await t.login('admin@stitch.test'));
    assert.equal(r.status, 200);
    assert.equal(r.body[0].brand, 'Kesar House');
  });
});
