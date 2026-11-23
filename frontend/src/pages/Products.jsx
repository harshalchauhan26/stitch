import { useCallback, useEffect, useState } from 'react';
import Icon from '../lib/Icon.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { inr, plural, toPaise, toRupees } from '../lib/format.js';

// Products: each brand's catalogue (the products that leads and orders pick from).
// Two ways products get here:
//   - from Shopify: "Sync from Shopify" pulls the brand's active products. They are read-only here, because Shopify owns them
//     and the next sync would overwrite any change.
//   - typed in by hand (Add product): for a brand with no Shopify store, or a product that is not in Shopify. Fully editable.
// Everyone sees the list (only the brands of their teams). Adding, editing and syncing are for admins and pod leads; the API
// refuses anyone else, the buttons are just hidden for them.
export default function Products() {
  const { brand, brands, brandById, user, say } = useApp();
  const canEdit = ['admin', 'pod_lead'].includes(user?.role);
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [inactive, setInactive] = useState(false);        // also list the switched-off products
  const [form, setForm] = useState(null);                 // the add / edit box: null = closed, else { id?, brand_id, sku, name, category, price, lead }
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);             // what the last sync did: counts and the things it could not use

  // the top-bar brand switcher decides which brand's products show; "All brands" lists every brand the person can see
  const load = useCallback(() => api.productList({ brand: brand === 'ALL' ? undefined : brand, q: q.trim() || undefined, active: inactive ? 'all' : undefined })
    .then(setRows).catch((e) => say(e.message)), [brand, q, inactive, say]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);   // short pause while typing in the search box
  useEffect(() => { setResult(null); setForm(null); }, [brand]);

  const openAdd = () => setForm({ brand_id: brand === 'ALL' ? '' : brand, sku: '', name: '', category: '', price: '', lead: '' });
  const openEdit = (p) => setForm({ id: p.id, brand_id: p.brand_id, sku: p.sku, name: p.name, category: p.category ?? '', price: toRupees(p.base_price), lead: p.lead_time_days ?? '' });

  // Save the add / edit box. Prices are typed in rupees and stored in paise, like everywhere else in the app.
  const save = async () => {
    const price = toPaise(form.price);
    if (Number.isNaN(price)) { say('Enter the price in rupees, e.g. 95000'); return; }
    const body = { sku: form.sku, name: form.name, category: form.category.trim() || null, base_price: price, lead_time_days: form.lead === '' ? null : Number(form.lead) };
    try {
      if (form.id) await api.updateProduct(form.id, body); else await api.createProduct({ brand_id: form.brand_id, ...body });
      say(form.id ? `${form.name} saved` : `${form.name} added`);
      setForm(null); load();
    } catch (e) { say(e.message); }
  };
  // Switching a product off hides it from the pickers; it is never deleted, so old leads and orders keep pointing at it.
  const setActive = async (p, active) => { try { await api.updateProduct(p.id, { active }); say(active ? `${p.name} is back` : `${p.name} switched off`); load(); } catch (e) { say(e.message); } };

  // Pull the brand's active products from Shopify. Needs one brand picked (each brand has its own store).
  const sync = async () => {
    setSyncing(true); setResult(null);
    try { setResult(await api.syncProducts(brand)); load(); } catch (e) { say(e.message); } finally { setSyncing(false); }
  };

  const GRID = '120px minmax(0,1.6fr) 60px 110px 110px 80px 170px';
  return (
    <div style={{ overflow: 'auto', padding: '24px 28px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flexGrow: 1 }}>
          <h1 className="ttl">Products</h1>
          <span style={{ color: 'var(--ink2)' }}>{rows ? `${plural(rows.length, 'product')}${brand === 'ALL' ? ' across your brands' : ` in ${brandById(brand)?.name ?? 'this brand'}`}. Leads and orders pick from this list.` : 'Loading…'}</span>
        </div>
        {canEdit && <button type="button" className="btn" disabled={brand === 'ALL' || syncing} onClick={sync} title={brand === 'ALL' ? 'Pick one brand in the top bar: each brand has its own Shopify store' : 'Pull this brand\'s active products from Shopify'}>{syncing ? 'Syncing…' : 'Sync from Shopify'}</button>}
        {canEdit && <button type="button" className="btn pri" onClick={openAdd}><Icon name="plus" />Add product</button>}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="inp" placeholder="Search name or SKU" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260, height: 28, fontSize: 12 }} />
        <label className="mut" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />Show switched-off products</label>
      </div>

      {/* what the last sync did. "Could not use" lists the Shopify products that did not fit, each with the reason */}
      {result && (
        <section className="tbl" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="lbl">Shopify sync</div>
          <span style={{ fontSize: 13 }}>{result.created} added · {result.updated} updated · {result.unchanged} unchanged · {result.deactivated} switched off (no longer active in Shopify)</span>
          {result.exceptions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, border: '1px solid var(--red)', borderRadius: 8 }}>
              <div className="lbl" style={{ color: 'var(--red)' }}>Could not use · {result.exceptions.length}</div>
              {result.exceptions.map((e, i) => (
                <span key={i} style={{ fontSize: 12 }}><b style={{ fontWeight: 600 }}>{e.title || e.shopify_id}</b>{e.sku ? ` (${e.sku})` : ''} <span className="chip" style={{ fontSize: 10, height: 18 }}>{e.code}</span> <span className="mut">{e.reason}</span></span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* add / edit box (hand-typed products only) */}
      {form && (
        <section className="tbl" style={{ padding: 16, display: 'grid', gridTemplateColumns: '150px 1fr', gap: '10px 14px', alignItems: 'center', maxWidth: 640 }}>
          <span className="lbl" style={{ gridColumn: '1 / -1' }}>{form.id ? 'Edit product' : 'Add product'}</span>
          {!form.id && (<>
            <span className="mut">Brand</span>
            <select className="inp" value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}>
              <option value="">Which brand?</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </>)}
          <span className="mut">SKU</span><input className="inp" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. NA-LEH-030" />
          <span className="mut">Name</span><input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bridal lehenga · emerald" />
          <span className="mut">Category</span><input className="inp" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. lehenga" />
          <span className="mut">Price (₹)</span><input className="inp" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="e.g. 210000" />
          <span className="mut">Lead time (days)</span><input className="inp" value={form.lead} onChange={(e) => setForm({ ...form, lead: e.target.value })} placeholder="e.g. 45" />
          <span />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn pri" disabled={!form.sku.trim() || !form.name.trim() || (!form.id && !form.brand_id)} onClick={save}>Save</button>
            <button type="button" className="btn gh" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </section>
      )}

      <div className="tbl">
        <div className="r h" style={{ gridTemplateColumns: GRID }}><span>SKU</span><span>Product</span><span>Brand</span><span>Category</span><span>Price</span><span>Lead time</span><span /></div>
        {(rows ?? []).map((p) => (
          <div key={p.id} className="r" style={{ gridTemplateColumns: GRID, opacity: p.active ? 1 : 0.55 }}>
            <span className="m" style={{ fontSize: 12 }}>{p.sku}</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
              <b style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</b>
              {p.shopify && <span className="chip blu" style={{ fontSize: 10, height: 18 }} title="Comes from Shopify: changed there and picked up by the next sync">Shopify</span>}
              {!p.active && <span className="chip" style={{ fontSize: 10, height: 18 }}>off</span>}
            </span>
            <span className="bd" style={{ justifySelf: 'start' }}>{brandById(p.brand_id)?.code ?? '—'}</span>
            <span className="mut" style={{ fontSize: 12 }}>{p.category ?? '—'}</span>
            <span className="m" style={{ fontSize: 12 }}>{p.base_price != null ? inr(p.base_price) : '—'}</span>
            <span className="m mut" style={{ fontSize: 12 }}>{p.lead_time_days != null ? `${p.lead_time_days} d` : '—'}</span>
            <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              {/* Shopify products have no buttons: their details are owned by Shopify */}
              {canEdit && !p.shopify && <button type="button" className="btn gh sm" onClick={() => openEdit(p)}>Edit</button>}
              {canEdit && !p.shopify && (p.active
                ? <button type="button" className="btn gh sm" onClick={() => window.confirm(`Switch off ${p.name}? It disappears from the pickers; existing leads and orders keep it.`) && setActive(p, false)}>Switch off</button>
                : <button type="button" className="btn sm" onClick={() => setActive(p, true)}>Switch on</button>)}
            </span>
          </div>
        ))}
        {rows && rows.length === 0 && <div className="r mut" style={{ gridTemplateColumns: '1fr' }}>No products yet.{canEdit ? ' Add one, or sync from Shopify.' : ''}</div>}
      </div>
    </div>
  );
}
