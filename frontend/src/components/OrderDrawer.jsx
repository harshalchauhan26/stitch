import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import FieldControl, { fromInput, LevelChip } from './FieldControl.jsx';
import History from './History.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { dayLabel, fullDate, inr, label as human, phone, toPaise, todayIso } from '../lib/format.js';

export const ORDER_STAGES = ['Created', 'Spec locked', 'Measurements', 'Production', 'QC approval', 'Ready to ship', 'Dispatched', 'Delivered'];
const MEASUREMENTS = ['bust', 'waist', 'hip', 'shoulder', 'armhole', 'sleeve_length', 'blouse_length', 'chest', 'neck', 'garment_length', 'trouser_length', 'thigh', 'height'];
const STATUS = { draft: ['amb', 'Not signed off'], sent_to_customer: ['amb', 'Sent to customer'], signed_off: ['grn', 'Signed off'], superseded: ['', 'Replaced'] };
const PAY = { pending: 'Pending', link_sent: 'Link sent', received: 'Received', failed: 'Failed', cancelled: 'Cancelled', refunded: 'Refunded' };
const DSTATUS = { scheduled: 'Scheduled', picked_up: 'Picked up', in_transit: 'In transit', delivered: 'Delivered', returned: 'Returned', failed: 'Failed' };

export default function OrderDrawer({ id, onClose, onChanged }) {
  const { say, user } = useApp();
  const [o, setO] = useState(null);
  const [error, setError] = useState(null);
  const [defs, setDefs] = useState({});                   // the brand's field defs by key (labels, types, options)
  const [versions, setVersions] = useState({});           // item id -> all customisation versions
  const [dispatches, setDispatches] = useState([]);
  const [blockers, setBlockers] = useState(null);
  const [pay, setPay] = useState(null);
  const [fix, setFix] = useState(null);                   // { itemId, kind, key, value, reason }
  const [ship, setShip] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);
  const pod = ['admin', 'pod_lead'].includes(user?.role);

  const load = useCallback(async () => {
    try {
      const x = await api.order(id);
      setO(x); setError(null);
      const [ds, vs] = await Promise.all([api.orderDispatches(id), Promise.all(x.items.map((i) => api.versions(id, i.id)))]);
      setDispatches(ds); setVersions(Object.fromEntries(x.items.map((i, n) => [i.id, vs[n]])));
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { setO(null); setBlockers(null); setPay(null); setFix(null); setShip(null); load(); }, [load]);
  useEffect(() => { if (o?.brand?.id) api.brandFields(o.brand.id).then((f) => setDefs(Object.fromEntries([...f.fields, ...f.available].map((d) => [d.key, d])))).catch(() => {}); }, [o?.brand?.id]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const done = async (msg) => { await load(); setHistoryKey((k) => k + 1); onChanged?.(); if (msg) say(msg); };
  const fail = async (e) => { if (e.code === 'version_conflict') { say('Someone else just changed this order. It has been reloaded.'); await load(); } else say(e.message); };
  const call = async (fn, msg) => { try { await fn(); await done(msg); return true; } catch (e) { await fail(e); return false; } };

  if (error) return (<><div className="scrim" onClick={onClose} /><aside className="drawer"><div className="dsec"><span className="chip red">{error}</span><button className="btn" onClick={onClose}>Close</button></div></aside></>);
  if (!o) return (<><div className="scrim" onClick={onClose} /><aside className="drawer"><div className="dsec mut">Loading…</div></aside></>);

  const idx = ORDER_STAGES.indexOf(o.stage);
  const next = ORDER_STAGES[idx + 1];
  const nb = o.gaps.filter((g) => g.level === 'blocking').length;
  const labelOf = (k) => defs[k]?.label ?? human(k);
  const layoutKeys = new Set(o.layout.flatMap((g) => g.fields.map((f) => f.key)));
  const fromLead = Object.entries(o.fields).filter(([k, v]) => !layoutKeys.has(k) && v != null && v !== '' && typeof v !== 'object');

  const move = async (to, extra = {}) => {
    if (to === 'Dispatched' && !extra.override) { setShip({ courier: '', awb: '', dispatch_date: todayIso() }); say('Create the shipment: that moves the order to Dispatched'); return; }
    try { await api.moveOrder(id, { version: o.version, to, ...extra }); setBlockers(null); await done(`Moved to ${to}`); }
    catch (e) {
      if (e.code === 'blocked') { setBlockers({ to, list: e.blockers }); say(`Can't move to ${to} yet`); }
      else if (/reason/.test(e.message)) { const reason = window.prompt(`${e.message}\n\nReason:`); if (reason) await move(to, { ...extra, reason }); }
      else await fail(e);
    }
  };
  const saveField = (k, v) => call(() => api.updateOrder(id, { version: o.version, fields: { [k]: v } }), `${labelOf(k)} saved`);
  const recordPayment = () => {
    const amount = toPaise(pay.amount);
    if (!amount || Number.isNaN(amount)) { say('Enter the amount in rupees'); return; }
    call(() => api.addOrderPayment(id, { kind: pay.kind, amount, status: 'received', mode: pay.mode || null, transaction_ref: pay.ref || null }), 'Payment recorded').then((ok) => ok && setPay(null));
  };
  const saveFix = () => {
    const def = defs[fix.key] ?? { key: fix.key, type: MEASUREMENTS.includes(fix.key) && fix.key !== 'height' ? 'number' : 'text' };
    call(() => api.correct(id, fix.itemId, { kind: fix.kind, values: { [fix.key]: fromInput(def, fix.value) }, reason: fix.reason }), 'Correction saved as a new version').then((ok) => ok && setFix(null));
  };
  const createShipment = () => call(() => api.addDispatch(id, { version: o.version, courier: ship.courier, awb: ship.awb || null, dispatch_date: ship.dispatch_date || null }), 'Shipment created: order is Dispatched').then((ok) => ok && setShip(null));
  const correctShipment = (dsp) => {
    const field = window.prompt('Which detail is wrong? (courier, awb, tracking_link, dispatch_date, address)');
    if (!field) return;
    const value = window.prompt(`New ${field}`);
    if (value == null) return;
    const reason = window.prompt('Why is it being corrected?');
    if (reason) call(() => api.updateDispatch(dsp.id, { [field.trim()]: value, reason }), 'Shipment corrected');
  };

  const itemFieldKeys = Object.values(defs).filter((d) => d.scope === 'item' && !['product', 'quantity'].includes(d.key));
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label={`${o.order_no} details`}>
        <div style={{ padding: '18px 24px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="m mut" style={{ fontSize: 12 }}>{o.order_no}</span><span className="bd">{o.brand.code}</span>
            <span className={`chip ${o.stage === 'Delivered' ? 'grn' : nb ? 'red' : 'blu'}`}>{o.stage}</span>
            <span style={{ flexGrow: 1 }} />
            <button type="button" className="btn gh sm" onClick={onClose}>Close <span className="kbd">Esc</span></button>
          </div>
          <h2 className="ttl" style={{ fontSize: 26 }}>{o.client.name || phone(o.client.phone)}</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--ink2)' }}>
            <span className="m">{phone(o.client.phone)}</span><span>Ordered {fullDate(o.order_date)}</span>
            {o.dates.event_date && <span className="m">Event {dayLabel(o.dates.event_date)}</span>}
            {o.dates.promised_ship_date && <span className="m">Ship by {dayLabel(o.dates.promised_ship_date)}</span>}
            <Link className="chip blu" to={`/leads/${o.lead_id}`}>From the lead</Link>
          </div>
          <div className="stg">{ORDER_STAGES.map((s, i) => <span key={s} className={i < idx ? 'past' : i === idx ? 'cur' : ''}>{s}</span>)}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {next && <button type="button" className="btn pri" onClick={() => move(next)}>Move to {next}</button>}
            {idx > 0 && <button type="button" className="btn gh" onClick={() => move(ORDER_STAGES[idx - 1])}>Back to {ORDER_STAGES[idx - 1]}</button>}
          </div>
          {blockers && (
            <div className="chip red" style={{ height: 'auto', padding: '8px 10px', whiteSpace: 'normal', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
              <span>Can't move to {blockers.to} until these are done:</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{blockers.list.map((b) => <span key={b.field} className="chip red" style={{ outline: '1px solid currentColor' }}>{b.label}</span>)}</span>
              {pod && <button type="button" className="btn sm" onClick={() => { const reason = window.prompt('Override the gate: why?'); if (reason) move(blockers.to, { override: true, reason }); }}>Override (pod lead)</button>}
            </div>
          )}
        </div>

        <div className="dbody">
          <section className="dsec">
            <div className="lbl">Money</div>
            <div style={{ display: 'flex', gap: 28 }}>
              {[['Order value', o.amounts.total], ['Paid', o.amounts.paid], ['Balance due', o.amounts.balance_due]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="m" style={{ fontSize: 20, color: l === 'Balance due' && v > 0 ? 'var(--amb)' : l === 'Balance due' ? 'var(--grn)' : undefined }}>{inr(v)}</span><span className="mut" style={{ fontSize: 11 }}>{l}</span>
                </div>
              ))}
            </div>
            {o.payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
                <span className="chip">{p.kind}</span><span className="m">{inr(p.amount)}</span>
                <span className={`chip ${p.status === 'received' ? 'grn' : 'amb'}`}>{PAY[p.status]}</span>
                <span className="mut">{[p.mode, p.transaction_ref].filter(Boolean).join(' · ')}</span>
                <span style={{ flexGrow: 1 }} />
                {p.status === 'link_sent' && <button type="button" className="btn sm" onClick={() => call(() => api.updatePayment(p.id, { status: 'received' }), 'Marked received')}>Mark received</button>}
              </div>
            ))}
            {pay ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select className="inp" value={pay.kind} onChange={(e) => setPay({ ...pay, kind: e.target.value })}><option value="balance">Balance</option><option value="extra">Extra charge</option><option value="refund">Refund</option></select>
                <input className="inp" placeholder="Amount ₹" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} style={{ width: 120 }} autoFocus />
                <select className="inp" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}><option value="">Mode</option>{['UPI', 'Card', 'Bank transfer', 'Shopify checkout', 'Cash'].map((m) => <option key={m}>{m}</option>)}</select>
                <input className="inp" placeholder="Transaction ref" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} style={{ width: 140 }} />
                <button type="button" className="btn pri" onClick={recordPayment}>Record received</button>
                <button type="button" className="btn gh" onClick={() => setPay(null)}>Cancel</button>
              </div>
            ) : <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setPay({ kind: 'balance', amount: o.amounts.balance_due > 0 ? String(o.amounts.balance_due / 100) : '', mode: '', ref: '' })}><Icon name="plus" />Record payment</button>}
          </section>

          <section className="dsec">
            <div className="lbl">Products · spec and measurements</div>
            {o.items.map((it) => {
              const vs = versions[it.id] ?? [];
              const pending = vs.filter((v) => v.status === 'draft' && v.kind === 'spec' && v.id !== it.spec?.id && v.version > (it.spec?.version ?? 0) && !v.approved_by);
              return (
                <div key={it.id} style={{ border: '1px solid var(--ln)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--sf)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b style={{ fontWeight: 600 }}>{it.product}</b><span className="mut">× {it.quantity}</span>{it.wearer && <span className="mut">· for {it.wearer}</span>}<span style={{ flexGrow: 1 }} />{it.line_total > 0 && <span className="m mut">{inr(it.line_total)}</span>}</div>
                  {[['spec', 'Spec', it.spec], ['measurements', 'Measurements', it.measurements]].map(([kind, title, c]) => (
                    <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className="lbl" style={{ fontSize: 10 }}>{title} · v{c?.version ?? 1}</span>
                        {kind === 'measurements' && c && <span className={`chip ${STATUS[c.status]?.[0] ?? ''}`} style={{ fontSize: 10, height: 18 }}>{STATUS[c.status]?.[1]}</span>}
                        {c?.reason && <span className="mut" style={{ fontSize: 11 }}>Last change: {c.reason}</span>}
                        <span style={{ flexGrow: 1 }} />
                        {kind === 'measurements' && c && c.status !== 'signed_off' && Object.keys(c.values).length > 0 && <button type="button" className="btn sm pri" onClick={() => call(() => api.signOff(c.id), 'Customer sign-off recorded')}>Customer signed off</button>}
                        <button type="button" className="btn sm" onClick={() => setFix({ itemId: it.id, kind, key: '', value: '', reason: '' })}>Correct</button>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {Object.entries(c?.values ?? {}).map(([k, v]) => <span key={k} className="chip" style={{ fontSize: 11 }}>{labelOf(k)}: <b style={{ fontWeight: 600 }}>{String(v)}{MEASUREMENTS.includes(k) && k !== 'height' ? '"' : ''}</b></span>)}
                        {!Object.keys(c?.values ?? {}).length && <span className="mut" style={{ fontSize: 12 }}>Nothing recorded yet</span>}
                      </div>
                      {fix?.itemId === it.id && fix.kind === kind && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <select className="inp" value={fix.key} onChange={(e) => setFix({ ...fix, key: e.target.value })}>
                            <option value="">Which {kind === 'spec' ? 'detail' : 'measurement'}?</option>
                            {itemFieldKeys.filter((d) => MEASUREMENTS.includes(d.key) === (kind === 'measurements')).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                          </select>
                          {defs[fix.key]?.options ? (
                            <select className="inp" value={fix.value} onChange={(e) => setFix({ ...fix, value: e.target.value })}><option value="">—</option>{defs[fix.key].options.map((x) => <option key={x}>{x}</option>)}</select>
                          ) : <input className="inp" placeholder={kind === 'measurements' ? 'inches' : 'new value'} value={fix.value} onChange={(e) => setFix({ ...fix, value: e.target.value })} style={{ width: 120 }} />}
                          <input className="inp" placeholder="Why? e.g. re-measured at trial" value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} style={{ flexGrow: 1 }} />
                          <button type="button" className="btn pri sm" disabled={!fix.key || !fix.reason.trim()} onClick={saveFix}>Save version</button>
                          <button type="button" className="btn gh sm" onClick={() => setFix(null)}>Cancel</button>
                        </div>
                      )}
                    </div>
                  ))}
                  {pending.map((v) => (
                    <div key={v.id} className="chip amb" style={{ height: 'auto', padding: 8, whiteSpace: 'normal', gap: 8 }}>
                      <span>Proposed spec v{v.version}: {v.changed_fields.map(labelOf).join(', ')}. {v.reason}</span>
                      {pod ? <button type="button" className="btn sm" onClick={() => call(() => api.approve(v.id), 'Spec change approved')}>Approve</button> : <span>Waiting for a pod lead.</span>}
                    </div>
                  ))}
                </div>
              );
            })}
          </section>

          {o.layout.filter((g) => g.fields.length).map((g) => (
            <section key={g.stage} className="dsec">
              <div className="lbl">{g.stage}{g.stage === o.stage ? ' · this stage' : ''}</div>
              <div className="fgrid" style={{ gridTemplateColumns: '190px 1fr' }}>
                {g.fields.map((f) => (
                  <div key={f.key} style={{ display: 'contents' }}>
                    <span style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink2)' }}>{f.label}<LevelChip level={f.level} /></span>
                    <FieldControl def={f} value={f.value} onSave={saveField} />
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section className="dsec">
            <div className="lbl">Shipments</div>
            {dispatches.map((dsp) => (
              <div key={dsp.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', borderTop: '1px solid var(--ln2)', fontSize: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ fontWeight: 500 }}>Shipment {dsp.shipment_no}</b><span>{dsp.courier}</span><span className="m">{dsp.awb ?? 'no AWB yet'}</span>
                  <span className={`chip ${dsp.status === 'delivered' ? 'grn' : 'blu'}`}>{DSTATUS[dsp.status]}</span>
                  {dsp.late && <span className="chip red">late</span>}
                  {dsp.tracking_shared_at && <span className="chip grn">tracking shared</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {dsp.status !== 'delivered' && <button type="button" className="btn sm" onClick={() => call(() => api.updateDispatch(dsp.id, { status: 'in_transit' }), 'In transit')}>In transit</button>}
                  {!dsp.tracking_shared_at && <button type="button" className="btn sm" onClick={() => call(() => api.updateDispatch(dsp.id, { tracking_shared: true }), 'Tracking shared')}>Tracking shared</button>}
                  {dsp.status !== 'delivered' && <button type="button" className="btn sm pri" onClick={() => call(() => api.updateDispatch(dsp.id, { status: 'delivered' }), 'Delivered')}>Delivered</button>}
                  <button type="button" className="btn sm gh" onClick={() => correctShipment(dsp)}>Correct a detail</button>
                </div>
                {dsp.corrections.map((c, i) => <span key={i} className="mut">Corrected {c.field}: {String(c.old)} → {String(c.new)} ({c.reason})</span>)}
              </div>
            ))}
            {['Ready to ship', 'Dispatched'].includes(o.stage) && (ship ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="inp" placeholder="Courier" value={ship.courier} onChange={(e) => setShip({ ...ship, courier: e.target.value })} autoFocus />
                <input className="inp" placeholder="AWB" value={ship.awb} onChange={(e) => setShip({ ...ship, awb: e.target.value })} style={{ width: 130 }} />
                <input className="inp" type="date" value={ship.dispatch_date} onChange={(e) => setShip({ ...ship, dispatch_date: e.target.value })} />
                <button type="button" className="btn pri" disabled={!ship.courier.trim()} onClick={createShipment}>Create shipment</button>
                <button type="button" className="btn gh" onClick={() => setShip(null)}>Cancel</button>
              </div>
            ) : <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShip({ courier: '', awb: '', dispatch_date: todayIso() })}><Icon name="truck" />Create shipment</button>)}
            {!['Ready to ship', 'Dispatched', 'Delivered'].includes(o.stage) && dispatches.length === 0 && <span className="mut" style={{ fontSize: 12 }}>Shipments can be created once the order is Ready to ship.</span>}
          </section>

          {fromLead.length > 0 && (
            <section className="dsec">
              <div className="lbl">From the lead</div>
              <div className="fgrid" style={{ gridTemplateColumns: '190px 1fr' }}>
                {fromLead.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><span className="mut" style={{ fontSize: 12 }}>{labelOf(k)}{defs[k]?.custom && <span className="chip blu" style={{ fontSize: 10, height: 18, marginLeft: 6 }}>brand</span>}</span><span style={{ fontSize: 12 }}>{defs[k]?.type === 'currency' ? inr(v) : String(v)}</span></div>)}
              </div>
            </section>
          )}

          <section className="dsec">
            <div className="lbl">History</div>
            <History key={historyKey} load={() => api.orderEvents(id)} items={o.items} labels={Object.fromEntries(Object.values(defs).map((d) => [d.key, d.label]))} />
          </section>
        </div>
      </aside>
    </>
  );
}
