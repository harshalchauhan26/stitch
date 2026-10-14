import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { MAX_CHATS, readChatFiles } from '../lib/readChats.js';
import { plural } from '../lib/format.js';
import QualChip from '../components/QualChip.jsx';
import ChatView from '../components/ChatView.jsx';

const OCCASIONS = ['Wedding', 'Engagement', 'Sangeet', 'Reception', 'Festive', 'Other'];
const INTENT = { browsing: 'Browsing', interested: 'Interested', comparing: 'Comparing', ready_to_buy: 'Ready to buy', hesitating: 'Hesitating', unclear: 'Unclear' };
const GRID = '26px minmax(190px,1.3fr) 150px minmax(130px,1fr) 118px 124px minmax(110px,.8fr) minmax(90px,.7fr)';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : iso || '');

// Turns a server item into an editable review row
function toRow(item, user, brandFilter, batchBrand) {
  const f = item.fields || {};
  const v = (k) => f[k]?.value ?? '';
  const oneBrand = user?.brands?.length === 1 ? user.brands[0].code : '';
  return {
    id: item.id, item, include: !item.duplicateLead && !item.duplicateUpload && !item.duplicateInBatch,
    values: {
      brand: batchBrand || item.brand?.code || oneBrand || (brandFilter !== 'ALL' ? brandFilter : ''),
      customer_name: v('customer_name'), phone: v('phone'), country: v('country'), city: v('city'), product: v('product'),
      occasion_type: v('occasion_type'), event_date: longDate(v('event_date')), quantity: v('quantity'),
      budget_min: v('budget_min'), budget_max: v('budget_max'), currency: v('currency'), size: v('size'), notes: item.summary || '',
    },
  };
}

// amber when the value is unsure or missing, so the person checks it first (same idea as the Review Screenshot screen)
const tone = (item, key, value) => {
  const conf = item.fields?.[key]?.confidence;
  if (!value) return ['event_date', 'country', 'product'].includes(key) ? { borderColor: 'var(--amb)', background: 'var(--ambS)' } : undefined;
  return conf === 'low' || conf === 'medium' ? { borderColor: 'var(--amb)', background: conf === 'low' ? 'var(--ambS)' : undefined } : undefined;
};
const why = (item, key) => {
  const f = item.fields?.[key]; if (!f) return undefined;
  const who = { code: 'found by code', llm: 'read by AI', both: 'AI and code agree' }[f.source] || '';
  return [`${f.confidence} confidence${who ? ` · ${who}` : ''}`, ...(f.evidence || []).map((e) => `“${e}”`)].join('\n');
};

export default function AddLead() {
  const { user, brand: brandFilter, refreshSummary } = useApp();
  const inputRef = useRef(null);
  const [phase, setPhase] = useState('pick');              // pick | reading | review | done
  const [files, setFiles] = useState([]);                  // [{ name, text } | { name, error }]
  const [config, setConfig] = useState(null);
  const [rows, setRows] = useState([]);
  const [failedItems, setFailedItems] = useState([]);
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openChat, setOpenChat] = useState(null);       // ingestion id whose chat is showing
  const [batchBrand, setBatchBrand] = useState('');      // '' = detect from each chat
  const [ownerId, setOwnerId] = useState('');            // who owns the leads created from this upload
  const [users, setUsers] = useState([]);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const method = ['paste', 'manual'].includes(params.get('method')) ? params.get('method') : 'chat';   // chat | paste | manual
  const [pasteText, setPasteText] = useState('');
  const [pastePhone, setPastePhone] = useState('');
  const [form, setForm] = useState({ customer_name: '', brand: '', phone: '', country: '', product: '', event_date: '', notes: '' });

  useEffect(() => { api.ingestConfig().then(setConfig).catch(() => setConfig({ mode: 'code' })); api.users().then(setUsers).catch(() => {}); }, []);
  useEffect(() => { if (user && !ownerId) setOwnerId(user.id); }, [user, ownerId]);

  const readable = files.filter((f) => f.text);
  const addFiles = async (list) => {
    const incoming = await readChatFiles([...list]);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !seen.has(f.name))].slice(0, MAX_CHATS);
    });
    setErr(null);
  };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); };

  const readChats = async () => {
    setPhase('reading'); setErr(null);
    try {
      const r = await api.ingestChats(readable.map(({ name, text }) => ({ name, text })));
      const ok = r.items.filter((i) => i.status === 'ready');
      setRows(ok.map((i) => toRow(i, user, brandFilter, batchBrand)));
      setFailedItems([...files.filter((f) => f.error).map((f) => ({ fileName: f.name, error: f.error })), ...r.items.filter((i) => i.status === 'failed')]);
      setUsage(r.usage || { input: 0, output: 0 });
      setPhase('review');
    } catch (e) { setErr(e.message); setPhase('pick'); }
  };

  const setVal = (id, k, val) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, values: { ...r.values, [k]: val } } : r)));
  const toggle = (id) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, include: !r.include } : r)));
  const chosen = rows.filter((r) => r.include);
  const missingBrand = chosen.filter((r) => !r.values.brand).length;
  const brandOpts = user?.brands ?? [];

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.ingestConfirm(rows.map((x) => ({ id: x.id, include: x.include, values: { ...x.values, owner_id: ownerId } })));
      setResult({ ...r, names: Object.fromEntries(rows.map((x) => [x.id, x.values.customer_name || x.values.phone || x.item.fileName])) });
      setPhase('done'); refreshSummary();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const reset = () => { setFiles([]); setRows([]); setFailedItems([]); setResult(null); setErr(null); setUsage({ input: 0, output: 0 }); setPhase('pick'); };

  const addPaste = () => {
    const base = pastePhone.trim() ? `WhatsApp Chat with ${pastePhone.trim()}` : 'Pasted chat';
    let name = `${base}.txt`, n = 2;
    while (files.some((f) => f.name === name)) name = `${base} (${n++}).txt`;
    setFiles((p) => [...p, { name, text: pasteText }]); setPasteText(''); setPastePhone('');
  };
  const oneBrand = brandOpts.length === 1 ? brandOpts[0].code : '';
  const manualBrand = form.brand || batchBrand || oneBrand || (brandFilter !== 'ALL' ? brandFilter : '');
  const createManual = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { customer_name: form.customer_name.trim(), brand: manualBrand, owner_id: ownerId, intake_method: 'Manual' };
      for (const k of ['phone', 'country', 'product', 'event_date', 'notes']) if (form[k].trim()) body[k] = form[k].trim();
      const res = await api.createLead(body);
      refreshSummary(); nav(`/leads/${res.record.id}`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const aiBanner = useMemo(() => (config?.mode === 'llm'
    ? <span className="chip grn">AI reading is on</span>
    : <span className="chip amb" title="Add ANTHROPIC_API_KEY to backend/.env and restart the backend">AI reading is off: only phone, country, brand and keyword hints are filled</span>), [config]);

  // ---------------- header ----------------
  const header = (
    <div style={{ padding: '24px 28px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1 }}>
          <h1 className="ttl">{method === 'manual' ? 'Add a lead' : 'Add leads from chats'}</h1>
          <span style={{ color: 'var(--ink2)' }}>{method === 'chat' ? 'Upload several WhatsApp chat exports at once. Stitch reads each one, fills in what it can, and you check it before anything is saved.' : method === 'paste' ? 'Paste a copied WhatsApp conversation. Stitch reads it the same way as an export.' : 'Type the details yourself. Anything you leave blank becomes a gap to fill later.'}</span>
        </div>
        {aiBanner}
      </div>
      <div className="seg" role="group" style={{ alignSelf: 'flex-start' }}>
        {[['chat', 'Chat export', 'leads'], ['paste', 'Paste text', 'paste'], ['manual', 'Manual', 'pencil']].map(([k, l, ic]) => (
          <button key={k} type="button" className={method === k ? 'on' : ''} disabled={phase !== 'pick'} onClick={() => setParams(k === 'chat' ? {} : { method: k })}><Icon name={ic} small />{l}</button>
        ))}
        <button type="button" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }} title="Coming next"><Icon name="shot" small />Screenshot</button>
      </div>
    </div>
  );

  // ---------------- manual ----------------
  if (method === 'manual' && phase === 'pick') {
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    return (
      <main style={{ flexGrow: 1, overflow: 'auto' }}>
        {header}
        <div style={{ padding: '8px 28px 28px', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {brandOpts.length === 0 && <div className="chip amb" style={{ height: 'auto', padding: '10px 12px', whiteSpace: 'normal' }}>No brands yet. Add your brands first in <Link to="/settings/brands">Settings → Brands</Link>.</div>}
          <div className="fgrid" style={{ gridTemplateColumns: '130px 1fr', gap: '10px 14px', padding: 16, border: '1px solid var(--ln)', borderRadius: 10, background: 'var(--sf)' }}>
            <span className="mut">Customer name *</span><input className="inp" aria-label="Customer name" value={form.customer_name} onChange={set('customer_name')} autoFocus />
            <span className="mut">Brand *</span>
            <select className="inp" aria-label="Brand" value={manualBrand} onChange={set('brand')}><option value="">Choose brand</option>{brandOpts.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</select>
            <span className="mut">Owner</span>
            <select className="inp" aria-label="Owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{(users.length ? users : [{ id: user?.id, name: user?.name }]).map((u) => <option key={u.id} value={u.id}>{u.id === user?.id ? `${u.name} (me)` : u.name}</option>)}</select>
            <span className="mut">Phone</span><input className="inp" aria-label="Phone" placeholder="+91 98765 43210" value={form.phone} onChange={set('phone')} />
            <span className="mut">Country</span><input className="inp" aria-label="Country" value={form.country} onChange={set('country')} />
            <span className="mut">Product</span><input className="inp" aria-label="Product" placeholder="e.g. Bridal lehenga" value={form.product} onChange={set('product')} />
            <span className="mut">Event date</span><input className="inp" aria-label="Event date" placeholder="DD Mon YYYY" value={form.event_date} onChange={set('event_date')} />
            <span className="mut">Notes</span><input className="inp" aria-label="Notes" value={form.notes} onChange={set('notes')} />
          </div>
          {err && <span className="chip red" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}>{err}</span>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn pri" disabled={busy || !form.customer_name.trim() || !manualBrand} style={{ opacity: busy || !form.customer_name.trim() || !manualBrand ? 0.5 : 1 }} onClick={createManual}>{busy ? 'Creating…' : 'Create lead'}</button>
            <span className="mut" style={{ alignSelf: 'center', fontSize: 12 }}>The lead opens next so you can fill what's missing.</span>
          </div>
        </div>
      </main>
    );
  }

  // ---------------- pick ----------------
  if (phase === 'pick' || phase === 'reading') {
    return (
      <main style={{ flexGrow: 1, overflow: 'auto' }}>
        {header}
        <div style={{ padding: '8px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
          {brandOpts.length === 0 && <div className="chip amb" style={{ height: 'auto', padding: '10px 12px', whiteSpace: 'normal' }}>No brands yet. Add your brands first in <Link to="/settings/brands">Settings → Brands</Link>, then come back.</div>}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', padding: '14px 16px', border: '1px solid var(--ln)', borderRadius: 10, background: 'var(--sf)' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="lbl">These chats are for</span>
              <select className="inp" aria-label="batch brand" value={batchBrand} onChange={(e) => setBatchBrand(e.target.value)} style={{ minWidth: 200 }}>
                <option value="">Detect from each chat</option>
                {brandOpts.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="lbl">Lead owner</span>
              <select className="inp" aria-label="lead owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} style={{ minWidth: 180 }}>
                {(users.length ? users : [{ id: user?.id, name: user?.name }]).map((u) => <option key={u.id} value={u.id}>{u.id === user?.id ? `${u.name} (me)` : u.name}</option>)}
              </select>
            </label>
            <span className="mut" style={{ fontSize: 12, flex: 1, minWidth: 220 }}>Applies to every chat you drop below. You can still change the brand of any single chat before creating.</span>
          </div>
          {method === 'chat' && (<>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            style={{ border: `1.5px dashed ${drag ? 'var(--gold)' : 'var(--ln)'}`, background: drag ? 'var(--goldS)' : 'var(--sf)', borderRadius: 10, padding: '34px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <Icon name="paste" style={{ width: 24, height: 24 }} className="mut" />
            <div style={{ fontWeight: 500, fontSize: 14 }}>Drop WhatsApp chat exports here</div>
            <div className="mut">.zip or .txt, up to {MAX_CHATS} at a time. Select many files in one go.</div>
            <input ref={inputRef} type="file" multiple accept=".zip,.txt" hidden data-testid="chat-files" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" className="btn" onClick={() => inputRef.current?.click()}>Choose files</button>
          </div>
          <div className="mut" style={{ fontSize: 12 }}>To export in WhatsApp: open the chat, tap the contact name, choose <b>Export chat</b>, then <b>Without media</b>. Name the file after the customer's number (for example <span className="m">+91 98765 43210</span>) so Stitch can read the phone number from it.</div>

          </>)}
          {method === 'paste' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, border: '1px solid var(--ln)', borderRadius: 10, background: 'var(--sf)' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span className="lbl">Customer phone (optional)</span>
                <input className="inp" aria-label="Pasted chat phone" placeholder="+91 98765 43210" value={pastePhone} onChange={(e) => setPastePhone(e.target.value)} style={{ maxWidth: 260 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span className="lbl">Conversation</span>
                <textarea className="inp" aria-label="Pasted chat" rows={10} placeholder="[10/7/26, 7:00 PM] You: Hi, thank you for reaching out…" value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                  style={{ height: 'auto', padding: 10, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, resize: 'vertical' }} />
              </label>
              <div><button type="button" className="btn" disabled={!pasteText.trim()} onClick={addPaste}>Add to list</button></div>
            </div>
          )}
          {files.length > 0 && (
            <div style={{ border: '1px solid var(--ln)', borderRadius: 10, overflow: 'hidden' }}>
              {files.map((f) => (
                <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--ln2)' }}>
                  <Icon name={f.error ? 'lock' : 'check'} small className={f.error ? '' : 'mut'} />
                  <span className="m" style={{ fontSize: 12, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  {f.error ? <span className="chip red">{f.error}</span> : <span className="mut" style={{ fontSize: 11 }}>{f.text.length < 1000 ? 'under 1' : Math.round(f.text.length / 1000)} KB of text</span>}
                  <button type="button" className="btn gh sm" onClick={() => setFiles((p) => p.filter((x) => x.name !== f.name))}>Remove</button>
                </div>
              ))}
            </div>
          )}
          {err && <span className="chip red" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}>{err}</span>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="button" className="btn pri" disabled={!readable.length || phase === 'reading'} onClick={readChats} style={{ opacity: !readable.length ? 0.5 : 1 }}>
              {phase === 'reading' ? 'Reading chats…' : `Read ${plural(readable.length, 'chat')}`}
            </button>
            {phase === 'reading' && <span className="mut">This can take a minute when the AI is on.</span>}
          </div>
        </div>
      </main>
    );
  }

  // ---------------- done ----------------
  if (phase === 'done') {
    return (
      <main style={{ flexGrow: 1, overflow: 'auto' }}>
        {header}
        <div style={{ padding: '8px 28px 28px', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="chip grn"><Icon name="check" small />Created {plural(result.created.length, 'lead')}</span>
            {result.skipped.length > 0 && <span className="mut">{result.skipped.length} left out</span>}</div>
          <div style={{ border: '1px solid var(--ln)', borderRadius: 10, overflow: 'hidden' }}>
            {result.created.map((c) => (
              <div key={c.leadId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: '1px solid var(--ln2)' }}>
                <Link to={`/leads/${c.leadId}`} className="m" style={{ fontSize: 12 }}>{c.leadId}</Link>
                <span style={{ fontWeight: 500, flexGrow: 1 }}>{result.names[c.id]}</span>
                {c.gaps > 0 ? <span className="chip amb">{plural(c.gaps, 'gap')} to fill</span> : <span className="chip grn">Complete</span>}
              </div>
            ))}
          </div>
          {result.failed.length > 0 && (
            <div style={{ border: '1px solid var(--ln)', borderRadius: 10 }}>
              {result.failed.map((f) => <div key={f.id} style={{ padding: '10px 14px', display: 'flex', gap: 10 }}><span className="chip red">Not created</span><span>{result.names[f.id]}: {f.error}</span></div>)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <Link className="btn pri" to="/gaps">Fill the gaps</Link>
            <button type="button" className="btn" onClick={reset}>Add more chats</button>
          </div>
        </div>
      </main>
    );
  }

  // ---------------- review ----------------
  return (
    <>
      <main style={{ flexGrow: 1, overflow: 'auto' }}>
        {header}
        <div style={{ padding: '0 28px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="mut" style={{ fontSize: 12 }}>Amber boxes are guesses or blanks. Hover a box to see where the value came from. Anything left blank becomes a gap you can fill later.</div>
          {failedItems.length > 0 && (
            <div style={{ border: '1px solid var(--ln)', borderRadius: 10, padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {failedItems.map((f, i) => <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="chip red">Skipped</span><span className="m" style={{ fontSize: 12 }}>{f.fileName}</span><span className="mut">{f.error}</span></div>)}
            </div>
          )}
          <div style={{ border: '1px solid var(--ln)', borderRadius: 10, overflow: 'hidden' }}>
            <div className="lbl" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, alignItems: 'center', padding: '0 14px', height: 34, background: 'var(--sf2)' }}>
              <span /><span>Customer</span><span>Brand</span><span>Product</span><span>Occasion</span><span>Event date</span><span>Country</span><span>City</span>
            </div>
            {rows.map((r) => {
              const it = r.item, v = r.values, s = it.stats || {};
              const cell = (key, ph, extra = {}) => (
                <input className="inp" value={v[key] ?? ''} placeholder={ph} title={why(it, key)} aria-label={key}
                  style={{ width: '100%', height: 30, fontSize: 12, ...tone(it, key, v[key]), ...extra }} onChange={(e) => setVal(r.id, key, e.target.value)} />
              );
              return (
                <div key={r.id} style={{ borderTop: '1px solid var(--ln2)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, opacity: r.include ? 1 : 0.55 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, alignItems: 'start' }}>
                    <input type="checkbox" checked={r.include} onChange={() => toggle(r.id)} aria-label={`Include ${it.fileName}`} style={{ marginTop: 8 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                      {cell('customer_name', 'Name not found', { fontWeight: 500 })}
                      <span className="m mut" style={{ fontSize: 11 }} title={why(it, 'phone')}>{v.phone || 'No phone found'}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <select className="inp" aria-label="brand" value={v.brand} onChange={(e) => setVal(r.id, 'brand', e.target.value)}
                        style={{ width: '100%', height: 30, fontSize: 12, ...(r.include && !v.brand ? { borderColor: 'var(--red)', background: 'var(--redS)' } : it.brand?.code ? undefined : { borderColor: 'var(--amb)' }) }}>
                        <option value="">Choose brand</option>
                        {brandOpts.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                      </select>
                      {!it.brand?.code && it.brand?.businessName && <span className="mut" style={{ fontSize: 10 }}>Chat with “{it.brand.businessName}”</span>}
                    </div>
                    {cell('product', 'Not found')}
                    <select className="inp" aria-label="occasion" value={v.occasion_type} onChange={(e) => setVal(r.id, 'occasion_type', e.target.value)} title={why(it, 'occasion_type')}
                      style={{ width: '100%', height: 30, fontSize: 12, ...tone(it, 'occasion_type', v.occasion_type) }}>
                      <option value="">—</option>
                      {OCCASIONS.map((o) => <option key={o}>{o}</option>)}
                    </select>
                    {cell('event_date', 'DD Mon YYYY')}
                    {cell('country', 'Not found')}
                    {cell('city', '—')}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 36 }}>
                    <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{it.summary}</span>
                    <QualChip q={it.qualification} />
                    {it.qualification?.status === 'not_qualified' && <span className="mut" style={{ fontSize: 11 }}>{it.qualification.reasons[0]}</span>}
                    {it.intent && <span className="chip blu">{INTENT[it.intent]}</span>}
                    <span className="chip">{s.customerMessages} customer · {s.staffMessages} staff messages</span>
                    {s.images > 0 && <span className="chip">{plural(s.images, 'image')}</span>}
                    {it.mode === 'llm' ? <span className="chip grn">AI read</span> : <span className="chip">Code only</span>}
                    {it.aiError && <span className="chip red" title={it.aiError}>AI failed for this chat</span>}
                    {!s.customerReplied && <span className="chip amb">Customer has not replied</span>}
                    {it.duplicateLead && <span className="chip red">Phone already on lead {it.duplicateLead}</span>}
                    {it.duplicateUpload && <span className="chip red">This chat was uploaded before</span>}
                    {it.duplicateInBatch && <span className="chip red">Same number as {it.duplicateInBatch}</span>}
                    <button type="button" className="btn sm" onClick={() => setOpenChat(openChat === r.id ? null : r.id)}>{openChat === r.id ? 'Hide chat' : 'Read chat'}</button>
                  </div>
                  {openChat === r.id && <div style={{ paddingLeft: 36 }}><ChatView load={() => api.ingestChat(r.id)} /></div>}
                </div>
              );
            })}
          </div>
          {err && <span className="chip red" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}>{err}</span>}
        </div>
      </main>
      <div style={{ borderTop: '1px solid var(--ln)', padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg)' }}>
        <span style={{ fontWeight: 500 }}>{chosen.length} of {rows.length} selected</span>
        {usage.input + usage.output > 0 && <span className="m mut" style={{ fontSize: 11 }}>AI used {usage.input.toLocaleString('en-IN')} input + {usage.output.toLocaleString('en-IN')} output tokens</span>}
        {missingBrand > 0 && <span className="chip red">Choose a brand for {plural(missingBrand, 'selected chat')}</span>}
        <label className="mut" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>Owner
          <select className="inp" aria-label="final owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} style={{ height: 28, fontSize: 12 }}>
            {(users.length ? users : [{ id: user?.id, name: user?.name }]).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <div style={{ flexGrow: 1 }} />
        <button type="button" className="btn" onClick={reset}>Start over</button>
        <button type="button" className="btn pri" disabled={busy || !chosen.length || missingBrand > 0} style={{ opacity: busy || !chosen.length || missingBrand > 0 ? 0.5 : 1 }} onClick={create}>
          {busy ? 'Creating…' : `Create ${plural(chosen.length, 'lead')}`}
        </button>
      </div>
    </>
  );
}
