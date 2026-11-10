// Shopify -> product catalogue (services/productSync.js). No store and no token needed:
// setShopify() replaces the Shopify call with a function that returns whatever products a test wants.
// Needs the local replica set (npm run mongo:dev), like the other API tests.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { setShopify } from '../src/services/shopify.js';
import { seedOrg, startApp } from './helpers.js';

let t, o;
let shop = [];                                              // what "Shopify" currently returns
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const product = (n, extra = {}) => ({ id: `gid://shopify/Product/${n}`, title: `Product ${n}`, handle: `product-${n}`, category: 'lehenga', image: `https://cdn.example/${n}.jpg`, currency: 'INR', variants: [{ sku: `na-p-${n}`, price: '1800.00' }], ...extra });
const sync = (token = o.tokens.meera) => t.api('POST', `/brands/${o.na.id}/products/sync`, {}, token);
const list = async () => ok(await t.api('GET', `/products?brand=${o.na.id}&active=all`, undefined, o.tokens.meera));
const bySku = (rows, sku) => rows.find((p) => p.sku === sku);

before(async () => {
  t = await startApp(); o = await seedOrg(t);
  setShopify(async () => shop);
});
after(async () => { setShopify(null); await t.close(); });

describe('sync from Shopify', () => {
  test('creates the products: SKU from the first variant (or the handle), lowest price in paise, brand lead time', async () => {
    ok(await t.api('PATCH', `/brands/${o.na.id}`, { defaults: { production_days: 45 } }, o.admin));
    shop = [
      product(1, { variants: [{ sku: '', price: '2500.00' }, { sku: 'na-p-1', price: '1800.50' }, { sku: 'na-p-1-xl', price: '2000' }] }),
      product(2, { variants: [{ sku: null, price: '950' }], handle: 'pink-dupatta' }),
    ];
    const r = ok(await sync());
    assert.deepEqual([r.created, r.updated, r.unchanged, r.deactivated, r.exceptions], [2, 0, 0, 0, []]);
    const rows = await list();
    const a = bySku(rows, 'NA-P-1'), b = bySku(rows, 'PINK-DUPATTA');
    assert.deepEqual([a.name, a.base_price, a.category, a.currency, a.active, a.shopify, a.lead_time_days], ['Product 1', 180050, 'lehenga', 'INR', true, true, 45]);
    assert.deepEqual(a.images, ['https://cdn.example/1.jpg']);
    assert.equal(b.base_price, 95000, 'no SKU on any variant: the handle is used');
  });

  test('running it again changes nothing; a changed title or price is updated', async () => {
    const same = ok(await sync());
    assert.deepEqual([same.created, same.updated, same.unchanged], [0, 0, 2]);
    shop = [product(1, { title: 'Bridal lehenga · ivory', variants: [{ sku: 'na-p-1', price: '2100' }] }), shop[1]];
    const r = ok(await sync());
    assert.deepEqual([r.created, r.updated, r.unchanged], [0, 1, 1]);
    const a = bySku(await list(), 'NA-P-1');
    assert.deepEqual([a.name, a.base_price], ['Bridal lehenga · ivory', 210000]);
  });

  test('a product that is no longer active in Shopify is switched off, not deleted, and comes back when Shopify lists it again', async () => {
    const gone = shop[1];
    shop = [shop[0]];
    assert.equal(ok(await sync()).deactivated, 1);
    assert.equal(bySku(await list(), 'PINK-DUPATTA').active, false);
    assert.equal(ok(await t.api('GET', `/products?brand=${o.na.id}`, undefined, o.tokens.meera)).length, 1, 'inactive products are hidden by default');
    shop = [shop[0], gone];
    const r = ok(await sync());
    assert.equal(r.updated, 1);
    assert.equal(bySku(await list(), 'PINK-DUPATTA').active, true);
  });

  test('products typed in by hand are left alone, and a hand-typed product with the same SKU is adopted, not duplicated', async () => {
    const hand = ok(await t.api('POST', '/products', { brand_id: o.na.id, sku: 'NA-HAND-1', name: 'Typed in by hand', base_price: 500000 }, o.tokens.meera), 201);
    const typed = ok(await t.api('POST', '/products', { brand_id: o.na.id, sku: 'NA-P-3', name: 'Typed first', base_price: 100 }, o.tokens.meera), 201);
    shop = [...shop, product(3, { title: 'Now from Shopify' })];
    const r = ok(await sync());
    assert.deepEqual([r.created, r.updated], [0, 1], 'the NA-P-3 product already existed');
    const rows = await list();
    assert.equal(rows.filter((p) => p.sku === 'NA-P-3').length, 1);
    assert.deepEqual([rows.find((p) => p.id === typed.id).name, rows.find((p) => p.id === typed.id).shopify], ['Now from Shopify', true]);
    shop = shop.slice(0, 2);                                            // product 3 leaves Shopify
    ok(await sync());
    const after = await list();
    assert.equal(after.find((p) => p.id === hand.id).active, true, 'the hand-typed product is never switched off');
    assert.equal(after.find((p) => p.id === hand.id).shopify, false);
  });

  test('what cannot be used is reported with the reason, and the rest still syncs', async () => {
    shop = [
      product(4, { variants: [{ sku: 'DUP-1', price: '100' }] }), product(5, { variants: [{ sku: 'dup-1', price: '200' }] }),
      product(6, { variants: [{ sku: 'na-p-6', price: 'abc' }] }), product(7, { title: '  ' }), product(8, { variants: [{ sku: '', price: '10' }], handle: '' }),
      product(9),
    ];
    const r = ok(await sync());
    assert.equal(r.created, 2, 'one of the DUP-1 pair, and product 9');
    assert.deepEqual(r.exceptions.map((e) => [e.shopify_id.split('/').pop(), e.code]).sort(), [['5', 'duplicate_sku'], ['6', 'bad_price'], ['7', 'no_title'], ['8', 'no_sku']]);
    assert.ok(r.exceptions.every((e) => e.reason));
    // a product with an exception that is already synced is not switched off just because this run could not use it
    shop = [product(1, { title: 'Bridal lehenga · ivory', variants: [{ sku: 'na-p-1', price: '2100' }] }), product(9, { variants: [{ sku: 'na-p-9', price: 'oops' }] })];
    const again = ok(await sync());
    assert.equal(bySku(await list(), 'NA-P-9').active, true);
    assert.equal(again.exceptions[0].code, 'bad_price');
  });
});

describe('who can sync, and what a synced product allows', () => {
  test('only admins and pod leads; sales get 403; another brand\'s team cannot sync this brand', async () => {
    assert.equal((await sync(o.tokens.priya)).status, 403);
    assert.equal((await sync(o.tokens.arjun)).status, 403);
    ok(await sync(o.admin));
  });

  test('a synced product cannot be edited by hand (the next sync would overwrite it); Stitch\'s own details can', async () => {
    const p = bySku(await list(), 'NA-P-1');
    for (const body of [{ name: 'Renamed' }, { base_price: 1 }, { sku: 'X' }, { active: false }]) {
      const r = await t.api('PATCH', `/products/${p.id}`, body, o.tokens.meera);
      assert.equal(r.status, 409, JSON.stringify(body));
      assert.equal(r.body.code, 'shopify_managed');
    }
    assert.equal(ok(await t.api('PATCH', `/products/${p.id}`, { lead_time_days: 30 }, o.tokens.meera)).lead_time_days, 30);
  });

  test('without a store connection it says so plainly', async () => {
    setShopify(null);
    delete process.env.SHOPIFY_NA_DOMAIN; delete process.env.SHOPIFY_NA_TOKEN;
    const r = await sync();
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'shopify_not_connected');
    assert.match(r.body.error, /SHOPIFY_NA_DOMAIN/);
    process.env.SHOPIFY_NA_DOMAIN = 'not-a-store.example.com'; process.env.SHOPIFY_NA_TOKEN = 'x';
    assert.match((await sync()).body.error, /your-store\.myshopify\.com/, 'a domain that is not a Shopify store is refused before any call is made');
    delete process.env.SHOPIFY_NA_DOMAIN; delete process.env.SHOPIFY_NA_TOKEN;
    setShopify(async () => shop);
  });
});
