// The one place that talks to Shopify, same idea as services/llm.js: the rest of the app asks this file for a brand's
// active products and never calls Shopify itself. Tests replace it with setShopify(), so they need no store and no token.
//
// Each brand has its OWN Shopify store, so the connection is per brand. For now the details are read from api/.env,
// using the brand's code (for brand NA):
//   SHOPIFY_NA_DOMAIN   the store's address, e.g. noor-atelier.myshopify.com
//   SHOPIFY_NA_TOKEN    an Admin API access token that can only READ products (the read_products scope)
//   SHOPIFY_API_VERSION optional, defaults to 2025-01
// Later these can move to a per-brand settings screen; only this file would need to change.
import { HttpError } from '../lib/errors.js';

let override = null;
export const setShopify = (fn) => { override = fn; };

// Active products with the little we need: title, handle, type, picture and each variant's SKU and price.
// "currencyCode" is the store's currency: prices come back in it.
const QUERY = `query ($cursor: String) {
  shop { currencyCode }
  products(first: 100, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle productType featuredImage { url } variants(first: 50) { nodes { sku price } } }
  }
}`;
const MAX_PAGES = 50;                    // 100 products a page, so up to 5,000 products per brand

/**
 * brand -> [{ id, title, handle, category, image, currency, variants: [{ sku, price }] }]
 * Throws 503 shopify_not_connected when the brand has no domain / token yet, and 502 when Shopify refuses or cannot be reached.
 */
export async function listActiveProducts(brand) {
  if (override) return override(brand);
  const code = String(brand.code).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const domain = (process.env[`SHOPIFY_${code}_DOMAIN`] || '').trim();
  const token = (process.env[`SHOPIFY_${code}_TOKEN`] || '').trim();
  if (!domain || !token) throw new HttpError(503, `Shopify is not connected for ${brand.name} yet (set SHOPIFY_${code}_DOMAIN and SHOPIFY_${code}_TOKEN)`, { code: 'shopify_not_connected' });
  // only a real store address is accepted, so a typo in .env can never send the token somewhere else
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) throw new HttpError(503, `SHOPIFY_${code}_DOMAIN must look like your-store.myshopify.com`, { code: 'shopify_not_connected' });
  const url = `https://${domain}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-01'}/graphql.json`;

  const out = [];
  let cursor = null, currency = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
        body: JSON.stringify({ query: QUERY, variables: { cursor } }),
      });
    } catch (e) { throw new HttpError(502, `Could not reach Shopify: ${e.message}`, { code: 'shopify_error' }); }
    if (!res.ok) throw new HttpError(502, `Shopify answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`, { code: 'shopify_error' });
    const j = await res.json();
    if (j.errors?.length) throw new HttpError(502, `Shopify refused the request: ${JSON.stringify(j.errors).slice(0, 300)}`, { code: 'shopify_error' });
    currency = j.data?.shop?.currencyCode ?? currency;
    for (const n of j.data?.products?.nodes ?? []) {
      out.push({ id: n.id, title: n.title, handle: n.handle, category: n.productType || null, image: n.featuredImage?.url ?? null, currency, variants: (n.variants?.nodes ?? []).map((v) => ({ sku: v.sku, price: v.price })) });
    }
    if (!j.data?.products?.pageInfo?.hasNextPage) break;
    cursor = j.data.products.pageInfo.endCursor;
  }
  return out;
}
