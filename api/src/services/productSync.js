// Copies a brand's active Shopify products into Stitch's own product catalogue (products collection).
//
// Shopify is the source of truth for the products it sends. The sync:
//   - creates a product Stitch does not have yet, updates one it has, and leaves unchanged ones alone
//   - deactivates a synced product that is no longer active in Shopify (never deletes: old leads and orders still point to it)
//   - never touches products someone typed in by hand, EXCEPT when a Shopify product has the same SKU: then that product is
//     "adopted" (linked to Shopify) instead of creating a duplicate
//   - reports everything it could not use in an `exceptions` list, with the reason, instead of silently skipping it
// It is safe to run again and again: running it twice in a row changes nothing the second time.
//
// How a Shopify product becomes a Stitch product (one Stitch product per Shopify product, not one per variant):
//   name = title        SKU = the first variant's SKU, or the product handle when no variant has one
//   price = the LOWEST variant price (in paise)        category = product type        picture = the main image
//   lead time = the brand's default production days, set only when the product is first created
import { notFound } from '../lib/errors.js';
import { AuditLog, Brand, Product } from '../models/index.js';
import { actorFor, requireBrand } from './scope.js';
import { listActiveProducts } from './shopify.js';

// "1800.00" -> 180000 paise. Anything that is not a plain, non-negative number gives null.
const toPaise = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** -> { created, updated, unchanged, deactivated, exceptions: [{ code, shopify_id, title, sku, reason }] } */
export async function syncProducts(scope, brandId) {
  requireBrand(scope, brandId);
  const brand = await Brand.findOne({ _id: brandId, tenant_id: scope.tenantId }).lean();
  if (!brand) throw notFound('Brand');

  const fetched = await listActiveProducts(brand);                              // may throw: not connected / Shopify error
  const mine = await Product.find({ tenant_id: scope.tenantId, brand_id: brand._id });
  const byShopifyId = new Map(mine.filter((p) => p.shopify_product_id).map((p) => [p.shopify_product_id, p]));
  const bySku = new Map(mine.map((p) => [p.sku, p]));
  const seen = new Set();                    // Shopify ids that came back, even ones we could not use: they still exist in Shopify
  const usedSkus = new Set();                // SKUs taken during this run: two Shopify products must not claim the same one
  const r = { created: 0, updated: 0, unchanged: 0, deactivated: 0, exceptions: [] };
  const skip = (p, code, reason, sku = null) => r.exceptions.push({ code, shopify_id: p.id, title: p.title ?? null, sku, reason });

  for (const p of fetched) {
    seen.add(String(p.id));
    const title = String(p.title ?? '').trim();
    if (!title) { skip(p, 'no_title', 'The product has no title'); continue; }
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const sku = String(variants.find((v) => String(v.sku ?? '').trim())?.sku ?? p.handle ?? '').trim().toUpperCase();
    if (!sku) { skip(p, 'no_sku', 'No variant has a SKU and the product has no handle to use instead'); continue; }
    const prices = variants.map((v) => toPaise(v.price)).filter((x) => x !== null);
    if (!prices.length) { skip(p, 'bad_price', 'No variant has a readable price', sku); continue; }
    if (usedSkus.has(sku)) { skip(p, 'duplicate_sku', `SKU ${sku} is already used by another Shopify product in this sync`, sku); continue; }

    // find the Stitch product this belongs to: by its Shopify id, else a hand-typed one with the same SKU
    let doc = byShopifyId.get(String(p.id)) ?? null;
    const holder = bySku.get(sku);
    if (holder && holder !== doc) {
      if (!doc && !holder.shopify_product_id) doc = holder;                      // adopt the hand-typed product
      else { skip(p, 'duplicate_sku', `SKU ${sku} already belongs to another product (${holder.name})`, sku); continue; }
    }
    usedSkus.add(sku);

    const fields = {
      sku, name: title, category: p.category ?? null, base_price: Math.min(...prices), currency: p.currency || brand.defaults?.currency || 'INR',
      images: p.image ? [p.image] : [], shopify_product_id: String(p.id), active: true,
    };
    if (!doc) {
      await Product.create({ tenant_id: scope.tenantId, brand_id: brand._id, lead_time_days: brand.defaults?.production_days ?? null, ...fields });
      r.created++;
      continue;
    }
    const changed = Object.keys(fields).filter((k) => JSON.stringify(doc[k] ?? null) !== JSON.stringify(fields[k] ?? null));
    if (!changed.length) { r.unchanged++; continue; }
    doc.set(fields);
    await doc.save();
    r.updated++;
  }

  // a synced product that Shopify no longer lists as active: switch it off (hand-typed products have no Shopify id, so they are left alone)
  for (const doc of mine) {
    if (doc.shopify_product_id && doc.active && !seen.has(doc.shopify_product_id)) { doc.active = false; await doc.save(); r.deactivated++; }
  }

  await AuditLog.create({
    tenant_id: scope.tenantId, actor: actorFor(scope, brand._id), action: 'products.synced', target_type: 'brand', target_id: brand._id,
    data: { created: r.created, updated: r.updated, unchanged: r.unchanged, deactivated: r.deactivated, exceptions: r.exceptions.length },
  });
  return r;
}
