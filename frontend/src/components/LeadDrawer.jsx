import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import FieldControl, { LevelChip } from './FieldControl.jsx';
import History from './History.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { dayLabel, inr, phone, plural, toPaise, toRupees } from '../lib/format.js';

const LOST_REASONS = ['Price', 'Timeline', 'Chose competitor', 'No response', 'Other'];
const ISSUE_TYPES = ['size', 'design', 'fabric', 'colour', 'measurement', 'payment', 'delivery', 'other'];
const PAY_STATUS = { pending: 'Pending', link_sent: 'Link sent', received: 'Received', failed: 'Failed', cancelled: 'Cancelled', refunded: 'Refunded' };

const Row = ({ def, children }) => (
  <div style={{ display: 'contents' }}>
    <span style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', color: 'var(--ink2)' }}>
      {def.label}<LevelChip level={def.level} />{def.custom && <span className="chip blu" style={{ fontSize: 10, height: 18 }} title="This brand's own field">brand</span>}
    </span>
    {children}
  </div>
);

export default function LeadDrawer({ id, onClose, onChanged }) {
  const { say, user } = useApp();
  const canOverride = ['admin', 'pod_lead'].includes(user?.role);
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [issues, setIssues] = useState([]);
  const [historyKey, setHistoryKey] = useState(0);
  const [blockers, setBlockers] = useState(null);
  const [lost, setLost] = useState(null);
  const [newItem, setNewItem] = useState(null);
  const [pay, setPay] = useState(null);
  const [issue, setIssue] = useState(null);
  const [resolving, setResolving] = useState({});

  const loadSide = useCallback(() => Promise.all([
    api.leadPayments(id).then(setPayments), api.leadIssues(id).then(setIssues),
  ]).catch(() => {}), [id]);
  const load = useCallback(() => api.lead(id).then((x) => { setD(x); setError(null); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { setD(null); setBlockers(null); setLost(null); setNewItem(null); setPay(null); setIssue(null); load(); loadSide(); }, [load, loadSide]);
  useEffect(() => { api.users().then(setUsers).catch(() => {}); }, []);
  useEffect(() => { if (d?.brand?.id) api.products(d.brand.id).then(setProducts).catch(() => {}); }, [d?.brand?.id]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const after = async (res, msg) => {
    if (res?.id) setD(res); else await load();
    setHistoryKey((k) => k + 1); onChanged?.(); if (msg) say(msg);
  };
  const fail = async (e) => {
    if (e.code === 'version_conflict') { say('Someone else just changed this lead. It has been reloaded: apply your change again.'); await load(); return; }
    say(e.message);
  };
  const patch = async (body, msg) => { try { await after(await api.updateLead(id, { version: d.version, ...body }), msg); } catch (e) { await fail(e); } };

  if (error) return (<><div className="scrim" onClick={onClose} /><aside className="drawer"><div className="dsec"><span className="chip red">{error}</span><button className="btn" onClick={onClose}>Close</button></div></aside></>);
  if (!d) return (<><div className="scrim" onClick={onClose} /><aside className="drawer"><div className="dsec mut">Loading…</div></aside></>);

  const open = d.stage_type === 'open';
  const flow = d.pipeline.filter((s) => s.type !== 'lost');
  const idx = flow.findIndex((s) => s.name === d.stage);
  const next = open ? flow[idx + 1] : null;
  const nb = d.gaps.filter((g) => g.level === 'blocking').length;
  const byScope = (scope) => d.layout.map((g) => ({ stage: g.stage, fields: g.fields.filter((f) => f.scope === scope) })).filter((g) => g.fields.length);
  const leadGroups = byScope('lead');
  const clientDefs = byScope('client').flatMap((g) => g.fields);
  const itemGroups = byScope('item').map((g) => ({ ...g, fields: g.fields.filter((f) => !['product', 'quantity'].includes(f.key)) })).filter((g) => g.fields.length);
  const clientValue = { client_name: d.client.name, phone: phone(d.client.phone), whatsapp_consent: d.client.whatsapp_consent, email: d.client.email, city: d.client.city, customer_type: d.client.customer_type };
  const clientKey = { client_name: 'name' };

  const move = async (to, extra = {}) => {
    try {
      const r = await api.moveLead(id, { version: d.version, to, ...extra });
      setBlockers(null);
      await after(r, r.order_id ? `${r.stage}: order created` : `Moved to ${to}`);
    } catch (e) {
      if (e.code === 'blocked') { setBlockers({ to, list: e.blockers }); say(`Can't move to ${to} yet`); }
      else if (e.status === 400 && /reason/.test(e.message)) {
        const reason = window.prompt(`${e.message}\n\nReason:`);
        if (reason) await move(to, { ...extra, reason });
      } else await fail(e);
    }
  };
  const markLost = async () => { try { await after(await api.loseLead(id, { version: d.version, reason: lost }), 'Marked lost'); setLost(null); } catch (e) { await fail(e); } };
  const reopen = async () => { try { await after(await api.reopenLead(id, { version: d.version }), 'Reopened'); } catch (e) { await fail(e); } };

  const addItem = async () => {
    const body = newItem.product_id ? { product_id: newItem.product_id } : { product: newItem.product };
    if (newItem.quantity) body.quantity = Number(newItem.quantity);
    try { await after(await api.updateLead(id, { version: d.version, items: [body] }), 'Product added'); setNewItem(null); } catch (e) { await fail(e); }
  };
  const recordPayment = async () => {
    const amount = toPaise(pay.amount);
    if (!amount || Number.isNaN(amount)) { say('Enter the amount in rupees'); return; }
    try {
      await api.addLeadPayment(id, { kind: 'advance', amount, status: pay.status, mode: pay.mode || null, transaction_ref: pay.ref || null });
      setPay(null); await loadSide(); await after(null, 'Payment recorded');
    } catch (e) { say(e.message); }
  };
  const markReceived = async (p) => {
    const ref = window.prompt('Transaction reference (optional)') ?? undefined;
    try { await api.updatePayment(p.id, { status: 'received', transaction_ref: ref || undefined }); await loadSide(); await after(null, 'Marked received'); } catch (e) { say(e.message); }
  };
  const saveIssue = async () => {
    try { await api.addIssue(id, { type: issue.type, title: issue.title, item_id: issue.item_id || null }); setIssue(null); await loadSide(); await after(null, 'Issue opened'); } catch (e) { say(e.message); }
  };
  const resolveIssue = async (i) => {
    try { await api.updateIssue(i.id, { status: 'resolved', resolution: resolving[i.id] }); setResolving((x) => ({ ...x, [i.id]: undefined })); await loadSide(); await after(null, 'Issue resolved'); } catch (e) { say(e.message); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label={`${d.lead_no} details`}>
        <div style={{ padding: '18px 24px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="m mut" style={{ fontSize: 12 }}>{d.lead_no}</span><span className="bd">{d.brand.code}</span>
            <span className={`chip ${d.stage_type === 'won' ? 'grn' : d.stage_type === 'lost' ? '' : nb ? 'red' : 'blu'}`}>{d.stage}</span>
            <span style={{ flexGrow: 1 }} />
            <button type="button" className="btn gh sm" onClick={onClose}>Close <span className="kbd">Esc</span></button>
          </div>
          <h2 className="ttl" style={{ fontSize: 26 }}>{d.client.name || phone(d.client.phone)}</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--ink2)' }}>
            <span className="m">{phone(d.client.phone)}</span>
            <span className="m" style={{ color: d.days_to_event != null && d.days_to_event <= 14 ? 'var(--red)' : undefined }}>{d.fields.event_date ? `Event ${dayLabel(d.fields.event_date)} · ${d.days_to_event}d` : 'No event date'}</span>
            {d.fields.quote_amount != null && <span className="m">Quote {inr(d.fields.quote_amount)}</span>}
            {d.converted_order_id && <Link className="chip grn" to={`/orders/${d.converted_order_id}`}>Open the order</Link>}
            {d.lost_reason && <span className="chip">Lost: {d.lost_reason}</span>}
          </div>
          {canOverride && <Link to={`/settings/brands?brand=${d.brand.id}`} style={{ fontSize: 12, alignSelf: 'flex-start' }}>Edit {d.brand.name}'s stages and fields</Link>}
          <div className="stg">{flow.map((s, i) => (
            <span key={s.name} className={i < idx ? 'past' : i === idx ? 'cur' : ''} style={{ cursor: open && i !== idx ? 'pointer' : undefined }}
              title={open && i !== idx ? `Move to ${s.name}` : undefined} onClick={() => open && i !== idx && move(s.name)}>{s.name}</span>
          ))}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {next && <button type="button" className="btn pri" onClick={() => move(next.name)}>Move to {next.name}</button>}
            {open && lost === null && <button type="button" className="btn" onClick={() => setLost('')}>Mark lost</button>}
            {d.stage_type === 'lost' && <button type="button" className="btn pri" onClick={reopen}>Reopen</button>}
            <span style={{ flexGrow: 1 }} />
            <label className="mut" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>Owner
              <select className="inp" style={{ height: 28, fontSize: 12 }} value={d.owner?.id ?? ''} disabled={!open} onChange={(e) => patch({ owner_id: e.target.value }, 'Owner changed')}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          </div>
          {blockers && (
            <div className="chip red" style={{ height: 'auto', padding: '8px 10px', whiteSpace: 'normal', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <span>Can't move to {blockers.to} until these are filled:</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{blockers.list.map((b) => <span key={b.field + (b.item_id || '')} className="chip red" style={{ outline: '1px solid currentColor' }}>{b.label}</span>)}</span>
              <span style={{ fontSize: 11 }}>Advance amount and payment link are filled in by recording the advance under Payments.</span>
              {canOverride && <button type="button" className="btn sm" onClick={() => { const reason = window.prompt('Override the gate: why?'); if (reason) move(blockers.to, { override: true, reason }); }}>Override (pod lead)</button>}
            </div>
          )}
          {lost !== null && (
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="inp" aria-label="Lost reason" value={lost} onChange={(e) => setLost(e.target.value)} style={{ flexGrow: 1 }} autoFocus>
                <option value="">Why was this lead lost?</option>{LOST_REASONS.map((o) => <option key={o}>{o}</option>)}
              </select>
              <button type="button" className="btn pri" disabled={!lost} onClick={markLost}>Confirm lost</button>
              <button type="button" className="btn gh" onClick={() => setLost(null)}>Cancel</button>
            </div>
          )}
        </div>

        <div className="dbody">
          {open && (
            <section className="dsec">
              <div className="lbl">Gaps · {d.gaps.length === 0 ? 'none open' : `${d.gaps.length} open${nb ? `, ${nb} blocking` : ''}`}</div>
              {d.gaps.length === 0 ? <span className="chip grn" style={{ alignSelf: 'flex-start' }}><Icon name="check" small />Nothing missing up to this stage</span> : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {d.gaps.map((g) => <span key={g.field + (g.item_id || '')} className={`chip ${g.level === 'blocking' ? 'red' : 'amb'}`} title={g.hint}>{g.level === 'blocking' && <Icon name="lock" small />}{g.item_label ? `${g.item_label}: ` : ''}{g.label}</span>)}
                </div>
              )}
            </section>
          )}

          <section className="dsec">
            <div className="lbl">Customer</div>
            <div className="fgrid" style={{ gridTemplateColumns: '190px 1fr' }}>
              {clientDefs.map((f) => (
                <Row key={f.key} def={f}>
                  {f.key === 'phone' ? <span className="m" style={{ fontSize: 12 }} title="The phone identifies the customer, so it is not edited per lead">{clientValue.phone}</span>
                    : <FieldControl def={f} value={clientValue[f.key]} disabled={!open} onSave={(k, v) => patch({ client: { [clientKey[k] ?? k]: v } }, `${f.label} saved`)} />}
                </Row>
              ))}
            </div>
          </section>

          {leadGroups.map((g) => (
            <section key={g.stage} className="dsec">
              <div className="lbl">{g.stage}{g.stage === d.stage ? ' · this stage' : ''}</div>
              <div className="fgrid" style={{ gridTemplateColumns: '190px 1fr' }}>
                {g.fields.map((f) => <Row key={f.key} def={f}><FieldControl def={f} value={d.fields[f.key]} disabled={!open} onSave={(k, v) => patch({ fields: { [k]: v } }, `${f.label} saved`)} /></Row>)}
              </div>
            </section>
          ))}

          <section className="dsec">
            <div className="lbl">Products · {plural(d.items.length, 'item')}</div>
            {d.items.map((it, n) => (
              <div key={it.id} style={{ border: '1px solid var(--ln)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--sf)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="m mut" style={{ fontSize: 11 }}>Item {n + 1}</span>
                  <b style={{ fontWeight: 600 }}>{it.product}</b>
                  <span className="mut">× {it.quantity}</span>
                  {it.unit_price != null && <span className="m mut" style={{ fontSize: 12 }}>{inr(it.unit_price)}</span>}
                  <span style={{ flexGrow: 1 }} />
                  {open && <button type="button" className="btn gh sm" onClick={() => window.confirm(`Remove ${it.product}?`) && patch({ items: [{ id: it.id, remove: true }] }, 'Product removed')}>Remove</button>}
                </div>
                <div className="fgrid" style={{ gridTemplateColumns: '170px 1fr' }}>
                  <span className="mut" style={{ fontSize: 12 }}>Quantity</span>
                  <FieldControl def={{ key: 'quantity', label: 'Quantity', type: 'number' }} value={it.quantity} disabled={!open} onSave={(k, v) => patch({ items: [{ id: it.id, quantity: v }] }, 'Quantity saved')} />
                  <span className="mut" style={{ fontSize: 12 }}>Price per piece</span>
                  <FieldControl def={{ key: 'unit_price', label: 'Price', type: 'currency' }} value={it.unit_price} disabled={!open} onSave={(k, v) => patch({ items: [{ id: it.id, unit_price: v }] }, 'Price saved')} />
                  <span className="mut" style={{ fontSize: 12 }}>For (wearer)</span>
                  <FieldControl def={{ key: 'wearer', label: 'Wearer', type: 'text' }} value={it.wearer} disabled={!open} onSave={(k, v) => patch({ items: [{ id: it.id, wearer: v }] }, 'Saved')} />
                </div>
                {itemGroups.map((g) => (
                  <div key={g.stage} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="lbl" style={{ fontSize: 10 }}>{g.stage}</span>
                    <div className="fgrid" style={{ gridTemplateColumns: '170px 1fr' }}>
                      {g.fields.map((f) => <Row key={f.key} def={f}><FieldControl def={f} value={it.fields?.[f.key]} disabled={!open} onSave={(k, v) => patch({ items: [{ id: it.id, fields: { [k]: v } }] }, `${f.label} saved`)} /></Row>)}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {open && (newItem ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select className="inp" value={newItem.product_id || ''} onChange={(e) => setNewItem({ ...newItem, product_id: e.target.value })}>
                  <option value="">Not from the catalogue</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {inr(p.base_price)}</option>)}
                </select>
                {!newItem.product_id && <input className="inp" placeholder="Product, e.g. Bridal lehenga" value={newItem.product || ''} onChange={(e) => setNewItem({ ...newItem, product: e.target.value })} style={{ flexGrow: 1 }} />}
                <input className="inp" placeholder="Qty" value={newItem.quantity || ''} onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })} style={{ width: 60 }} />
                <button type="button" className="btn pri" disabled={!newItem.product_id && !newItem.product} onClick={addItem}>Add</button>
                <button type="button" className="btn gh" onClick={() => setNewItem(null)}>Cancel</button>
              </div>
            ) : <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setNewItem({})}><Icon name="plus" />Add product</button>)}
          </section>

          <section className="dsec">
            <div className="lbl">Payments</div>
            {payments.length === 0 && <span className="mut" style={{ fontSize: 12 }}>No payments yet. Record the advance here: it fills in the advance amount and payment link fields.</span>}
            {payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
                <span className="chip">{p.kind}</span><span className="m">{inr(p.amount)}</span>
                <span className={`chip ${p.status === 'received' ? 'grn' : p.status === 'link_sent' ? 'amb' : ''}`}>{PAY_STATUS[p.status]}</span>
                <span className="mut">{[p.mode, p.transaction_ref].filter(Boolean).join(' · ')}</span>
                <span style={{ flexGrow: 1 }} />
                {open && p.status === 'link_sent' && <button type="button" className="btn sm" onClick={() => markReceived(p)}>Mark received</button>}
              </div>
            ))}
            {open && (pay ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="inp" placeholder="Advance ₹" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} style={{ width: 120 }} autoFocus />
                <select className="inp" value={pay.status} onChange={(e) => setPay({ ...pay, status: e.target.value })}>
                  <option value="link_sent">Payment link sent</option><option value="received">Received</option>
                </select>
                <select className="inp" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
                  <option value="">Mode</option>{['UPI', 'Card', 'Bank transfer', 'Shopify checkout', 'Cash'].map((m) => <option key={m}>{m}</option>)}
                </select>
                <input className="inp" placeholder="Transaction ref" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} style={{ width: 140 }} />
                <button type="button" className="btn pri" onClick={recordPayment}>Record</button>
                <button type="button" className="btn gh" onClick={() => setPay(null)}>Cancel</button>
              </div>
            ) : <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setPay({ amount: d.fields.quote_amount ? toRupees(Math.round(d.fields.quote_amount * 0.3)) : '', status: 'link_sent', mode: '', ref: '' })}><Icon name="plus" />Record advance</button>)}
          </section>

          <section className="dsec">
            <div className="lbl">Issues · {plural(issues.filter((i) => i.status === 'open').length, 'open')}</div>
            {issues.map((i) => (
              <div key={i.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0', borderTop: '1px solid var(--ln2)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                  <span className={`chip ${i.status === 'open' ? 'amb' : 'grn'}`}>{i.type}</span><b style={{ fontWeight: 500 }}>{i.title}</b>
                  {i.item_id && <span className="mut">· {d.items.find((x) => x.id === i.item_id)?.product}</span>}
                </div>
                {i.status === 'resolved' ? <span className="mut" style={{ fontSize: 12 }}>Resolved: {i.resolution}</span> : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="inp" placeholder="How was it resolved?" style={{ flexGrow: 1, height: 28, fontSize: 12 }} value={resolving[i.id] || ''} onChange={(e) => setResolving((x) => ({ ...x, [i.id]: e.target.value }))} />
                    <button type="button" className="btn sm" disabled={!(resolving[i.id] || '').trim()} onClick={() => resolveIssue(i)}>Resolve</button>
                  </div>
                )}
              </div>
            ))}
            {issue ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select className="inp" value={issue.type} onChange={(e) => setIssue({ ...issue, type: e.target.value })}>{ISSUE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                <select className="inp" value={issue.item_id} onChange={(e) => setIssue({ ...issue, item_id: e.target.value })}><option value="">Whole lead</option>{d.items.map((it) => <option key={it.id} value={it.id}>{it.product}</option>)}</select>
                <input className="inp" placeholder="What is the problem?" value={issue.title} onChange={(e) => setIssue({ ...issue, title: e.target.value })} style={{ flexGrow: 1 }} autoFocus />
                <button type="button" className="btn pri" disabled={!issue.title.trim()} onClick={saveIssue}>Open issue</button>
                <button type="button" className="btn gh" onClick={() => setIssue(null)}>Cancel</button>
              </div>
            ) : <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setIssue({ type: 'size', title: '', item_id: '' })}><Icon name="plus" />Open issue</button>}
          </section>

          <section className="dsec">
            <div className="lbl">History</div>
            <History key={historyKey} load={() => api.leadEvents(id)} items={d.items}
              labels={Object.fromEntries(d.layout.flatMap((g) => g.fields.map((f) => [f.key, f.label])))} types={Object.fromEntries(d.layout.flatMap((g) => g.fields.map((f) => [f.key, f.type])))} />
          </section>
        </div>
      </aside>
    </>
  );
}
