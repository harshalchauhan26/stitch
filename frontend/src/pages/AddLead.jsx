import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import FieldControl, { LevelChip } from '../components/FieldControl.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { inr } from '../lib/format.js';

const CLIENT_KEYS = ['client_name', 'phone', 'whatsapp_consent', 'email', 'city', 'customer_type'];

/** Add a lead by hand: the brand, the customer, the products, and whatever the brand asks for at its first stage. */
export default function AddLead() {
  const nav = useNavigate();
  const { brands, brand: current, user, say, refreshSummary } = useApp();
  const [brandId, setBrandId] = useState(current !== 'ALL' ? current : brands.length === 1 ? brands[0].id : '');
  const [setup, setSetup] = useState(null);              // the brand's fields + pipeline
  const [products, setProducts] = useState([]);
  const [users, setUsers] = useState([]);
  const [owner, setOwner] = useState(user?.id ?? '');
  const [client, setClient] = useState({ phone: '', name: '', email: '', city: '', whatsapp_consent: 'Unknown' });
  const [fields, setFields] = useState({});
  const [items, setItems] = useState([{ product_id: '', product: '', quantity: 1 }]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.users().then(setUsers).catch(() => {}); }, []);
  useEffect(() => {
    setSetup(null); setProducts([]); setFields({});
    if (!brandId) return;
    api.brandFields(brandId).then(setSetup).catch((e) => say(e.message));
    api.products(brandId).then(setProducts).catch(() => {});
  }, [brandId, say]);

  const firstStage = setup?.pipeline?.[0]?.name;
  const stageFields = useMemo(() => (setup?.fields ?? []).filter((f) => f.stage === firstStage && f.scope === 'lead' && !f.computed && f.level && f.active !== false && !CLIENT_KEYS.includes(f.key)), [setup, firstStage]);
  const main = stageFields.filter((f) => f.level !== 'optional' || f.custom);
  const extra = stageFields.filter((f) => f.level === 'optional' && !f.custom);

  const submit = async (confirmNew = false) => {
    setBusy(true); setError(null);
    const body = {
      brand_id: brandId, owner_id: owner || undefined, confirm_new_purchase: confirmNew || undefined,
      client: Object.fromEntries(Object.entries(client).filter(([, v]) => v !== '' && v != null)),
      fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== '')),
      items: items.filter((i) => i.product_id || i.product.trim()).map((i) => (i.product_id ? { product_id: i.product_id, quantity: Number(i.quantity) || 1 } : { product: i.product.trim(), quantity: Number(i.quantity) || 1 })),
    };
    try {
      const lead = await api.createLead(body);
      refreshSummary();
      say(lead.warnings?.length ? `${lead.lead_no} created. ${lead.warnings.join(' ')}` : `${lead.lead_no} created`);
      nav(`/leads/${lead.id}`);
    } catch (e) {
      if (e.code === 'open_lead_exists') setDup(e);
      else setError(e.message);
    } finally { setBusy(false); }
  };

  const set = (k) => (e) => setClient({ ...client, [k]: e.target.value });
  return (
    <div style={{ overflow: 'auto', padding: '24px 28px 40px' }}>
      <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flexGrow: 1 }}><h1 className="ttl">Add a lead</h1><span style={{ color: 'var(--ink2)' }}>Type in what the customer said on WhatsApp. Anything you leave out shows up as a gap to follow up.</span></div>
          <Link className="btn gh" to="/leads">Cancel</Link>
        </div>

        <section className="tbl" style={{ padding: 16, display: 'grid', gridTemplateColumns: '170px 1fr', gap: '10px 14px', alignItems: 'center' }}>
          <span className="lbl">Brand</span>
          <select className="inp" value={brandId} onChange={(e) => setBrandId(e.target.value)} autoFocus>
            <option value="">Choose the brand the customer contacted</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {setup && <><span className="mut" style={{ fontSize: 12 }}>Pipeline</span><div className="stg">{setup.pipeline.filter((s) => s.type !== 'lost').map((s, i) => <span key={s.name} className={i === 0 ? 'cur' : ''}>{s.name}</span>)}</div></>}
          <span className="lbl">Owner</span>
          <select className="inp" value={owner} onChange={(e) => setOwner(e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </section>

        <section className="tbl" style={{ padding: 16, display: 'grid', gridTemplateColumns: '170px 1fr', gap: '10px 14px', alignItems: 'center' }}>
          <span className="lbl" style={{ gridColumn: '1 / -1' }}>Customer</span>
          <span className="mut">Phone / WhatsApp *</span><input className="inp" placeholder="+91 98111 15326" value={client.phone} onChange={set('phone')} />
          <span className="mut">Name</span><input className="inp" value={client.name} onChange={set('name')} />
          <span className="mut">WhatsApp consent</span>
          <select className="inp" value={client.whatsapp_consent} onChange={set('whatsapp_consent')}>{['Unknown', 'Yes', 'No'].map((o) => <option key={o}>{o}</option>)}</select>
          <span className="mut">Email</span><input className="inp" value={client.email} onChange={set('email')} />
          <span className="mut">City</span><input className="inp" value={client.city} onChange={set('city')} />
        </section>

        <section className="tbl" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="lbl">Products</span>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <select className="inp" value={it.product_id} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)))} disabled={!brandId}>
                <option value="">Not from the catalogue</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {inr(p.base_price)}</option>)}
              </select>
              {!it.product_id && <input className="inp" placeholder="What they want, e.g. Bridal lehenga" value={it.product} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, product: e.target.value } : x)))} style={{ flexGrow: 1 }} />}
              <input className="inp" aria-label="Quantity" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} style={{ width: 60 }} />
              {items.length > 1 && <button type="button" className="btn gh ic" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))}><Icon name="x" /></button>}
            </div>
          ))}
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setItems([...items, { product_id: '', product: '', quantity: 1 }])}><Icon name="plus" />Another product</button>
        </section>

        {setup && (
          <section className="tbl" style={{ padding: 16, display: 'grid', gridTemplateColumns: '170px 1fr', gap: '10px 14px', alignItems: 'center' }}>
            <span className="lbl" style={{ gridColumn: '1 / -1' }}>{setup.pipeline[0].name} · what {brands.find((b) => b.id === brandId)?.name} asks first</span>
            {[...main, ...(more ? extra : [])].map((f) => (
              <div key={f.key} style={{ display: 'contents' }}>
                <span className="mut" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>{f.label}<LevelChip level={f.level} />{f.custom && <span className="chip blu" style={{ fontSize: 10, height: 18 }}>brand</span>}</span>
                <FieldControl def={f} value={fields[f.key]} onSave={(k, v) => setFields((x) => ({ ...x, [k]: v }))} />
              </div>
            ))}
            {extra.length > 0 && <button type="button" className="btn gh sm" style={{ gridColumn: '1 / -1', justifySelf: 'start' }} onClick={() => setMore((m) => !m)}>{more ? 'Fewer fields' : `More fields (${extra.length})`}</button>}
          </section>
        )}

        {dup && (
          <div className="chip amb" style={{ height: 'auto', padding: 12, whiteSpace: 'normal', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <span>{dup.message}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <Link className="btn sm" to={`/leads/${dup.lead_id}`}>Open {dup.lead_no}</Link>
              <button type="button" className="btn sm pri" onClick={() => { setDup(null); submit(true); }}>It's a separate purchase: create it</button>
            </span>
          </div>
        )}
        {error && <span className="chip red" style={{ height: 'auto', padding: 10, whiteSpace: 'normal' }}>{error}</span>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn pri" disabled={busy || !brandId || !client.phone.trim()} onClick={() => submit(false)}>{busy ? 'Saving…' : 'Create lead'}</button>
          <span className="mut" style={{ fontSize: 12, alignSelf: 'center' }}>Saving is always allowed: missing details become gaps on the lead.</span>
        </div>
      </div>
    </div>
  );
}
