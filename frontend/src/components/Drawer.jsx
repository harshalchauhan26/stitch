import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import Toast from './Toast.jsx';
import QualChip from './QualChip.jsx';
import ChatView from './ChatView.jsx';
import FieldControl, { GapInput, LevelChip } from './FieldControl.jsx';
import { api } from '../api/index.js';
import { dayLabel, inr, plural } from '../lib/format.js';

const OCCASIONS = ['Wedding', 'Engagement', 'Sangeet', 'Reception', 'Festive', 'Other'];
const REASONS = ['Delay', 'Quality', 'Customer', 'Payment', 'Other'];
const LABELS = { phone: 'Phone', whatsapp_consent: 'WhatsApp consent', country: 'Country', city: 'City', product: 'Product', occasion_type: 'Occasion', quantity: 'Quantity',
  budget_min: 'Budget from', budget_max: 'Budget to', currency: 'Currency', size: 'Size', notes: 'Notes', lead_source: 'Lead source', intake_method: 'Intake method',
  buying_intent: 'Buying intent', customer_replied: 'Customer replied', last_contacted: 'Last contacted', original_chat_file: 'Original chat file', courier: 'Courier', eta: 'Production ETA', arrival_date: 'Arrival date' };
const ORDER = ['phone', 'whatsapp_consent', 'customer_replied', 'country', 'city', 'product', 'occasion_type', 'quantity', 'size', 'budget_min', 'budget_max', 'currency', 'notes', 'lead_source', 'intake_method'];   // always shown, even when empty, so anything can be filled in
const HIDDEN = new Set(['source_ingestion', 'created_date', 'linked_lead_id', 'reference_links', 'positive_signals', 'negative_signals']);
const label = (k) => LABELS[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const ACTION = { gap_fix: 'Fixed', edit: 'Edited', stage_move: 'Moved', convert: 'Won, converted to order', create: 'Created', rule_change: 'Rule changed', escalate: 'Escalation raised', resolve: 'Escalation resolved' };

const parseTs = (ts) => new Date(String(ts).includes('T') ? ts : String(ts).replace(' ', 'T') + 'Z');
const ago = (d) => { const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const daysTo = (iso) => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); const t = new Date(); return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); };
const longDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${Number(iso.slice(8))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : iso || '');

export default function Drawer({ type, id, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [vals, setVals] = useState({});                 // gap key -> typed text
  const [errs, setErrs] = useState({});                 // gap key -> validation message
  const [blockers, setBlockers] = useState(null);
  const [lost, setLost] = useState(null);               // null | reason text
  const [esc, setEsc] = useState(null);                 // null | { reason, details, slaHours }
  const [resolving, setResolving] = useState({});       // escalation id -> text
  const timer = useRef();

  const say = useCallback((m) => { clearTimeout(timer.current); setToast(m); timer.current = setTimeout(() => setToast(null), 3600); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { api.meta().then(setMeta).catch(() => {}); }, []);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const load = useCallback(() => api.record(type, id).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)), [type, id]);
  useEffect(() => { setData(null); setBlockers(null); setLost(null); setEsc(null); setVals({}); setErrs({}); load(); }, [load]);
  const changed = async (msg) => { if (msg) say(msg); await load(); onChanged(); };

  const users = meta?.users ?? [];
  const who = (uid) => users.find((u) => u.id === uid)?.name ?? '';

  if (error) {
    return (<><div className="scrim" onClick={onClose} /><aside className="drawer"><div className="dsec"><span className="chip red">{error}</span><button className="btn" onClick={onClose}>Close</button></div></aside></>);
  }
  if (!data) return (<><div className="scrim" onClick={onClose} /><aside className="drawer"><div className="dsec mut">Loading…</div></aside></>);

  const { record: r, gaps, score, activity, whatsapp, escalations = [], qualification, fieldGroups = [] } = data;
  const stages = (type === 'lead' ? meta?.leadStages : meta?.orderStages) ?? [];
  const idx = stages.indexOf(r.stage);
  const next = idx >= 0 ? stages[idx + 1] : null;
  const days = daysTo(r.event_date);
  const nb = gaps.filter((g) => g.blocking).length;

  // ---- actions ----
  const move = async (to) => {
    try { const res = await api.move(type, r.id, to); setBlockers(null); await changed(res.orderId ? `Won. Order ${res.orderId} created.` : `Moved to ${to}`); }
    catch (e) { if (e.blockers?.length) { setBlockers({ to, list: e.blockers }); say(`Can't move to ${to} yet`); } else say(e.message); }
  };
  const markLost = async () => {
    try { await api.patchRecord(type, r.id, { lost_reason: lost }); await api.move(type, r.id, 'Lost'); say('Marked lost'); onChanged(); onClose(); }
    catch (e) { say(e.message); }
  };
  const fix = async (g, body) => {
    try { const res = await api.fixGap(g.key, body); setErrs((x) => ({ ...x, [g.key]: null })); await changed(res.message); }
    catch (e) { if (e.status === 422) setErrs((x) => ({ ...x, [g.key]: e.message })); else say(e.message); }
  };
  const save = async (field, value, was) => {
    if (String(value ?? '') === String(was ?? '')) return;
    try { await api.patchRecord(type, r.id, { [field]: value }); await changed(`${label(field)} saved`); } catch (e) { say(e.message); load(); }
  };
  const raise = async () => {
    try { await api.escalate(r.id, esc); setEsc(null); await changed('Escalation raised'); } catch (e) { say(e.message); }
  };
  const resolve = async (eid) => {
    try { await api.resolveEscalation(eid, resolving[eid]); setResolving((x) => ({ ...x, [eid]: undefined })); await changed('Escalation resolved'); } catch (e) { say(e.message); }
  };

  // ---- derived lists ----
  const grouped = new Set(fieldGroups.flatMap((g) => g.fields.map((f) => f.key)));
  const otherKeys = [...ORDER.filter((k) => meta?.fields?.[k]?.records?.includes(type)), ...Object.keys(r.fields)]
    .filter((k, i, a) => a.indexOf(k) === i && !grouped.has(k) && !HIDDEN.has(k) && typeof r.fields[k] !== 'object');
  const feed = [
    ...activity.map((a) => ({ t: parseTs(a.ts), text: `${ACTION[a.action] || a.action}${a.field ? ` · ${a.field.replace(/_/g, ' ')}` : ''}`, by: who(a.user_id) })),
    ...whatsapp.map((w) => ({ t: parseTs(w.ts), text: `WhatsApp · ${w.template.replace(/_/g, ' ')} (${w.status})`, by: '', sub: w.body })),
  ].sort((a, b) => b.t - a.t).slice(0, 30);

  const input = (field, was, extra = {}) => (
    <input className="inp" defaultValue={was ?? ''} key={`${field}-${was}`} aria-label={field} onBlur={(e) => save(field, e.target.value.trim(), was)}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} {...extra} />
  );

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-label={`${r.id} details`}>
        <div style={{ padding: '18px 24px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="m mut" style={{ fontSize: 12 }}>{r.id}</span><span className="bd">{r.brand}</span>
            <span className={`chip ${nb ? 'red' : 'grn'}`}>{r.stage}</span>
            {score >= 45 && <span className="chip red" title="Risk score">Risk {score}</span>}
            <QualChip q={qualification} />
            <span style={{ flexGrow: 1 }} />
            <button type="button" className="btn gh sm" onClick={onClose}>Close <span className="kbd">Esc</span></button>
          </div>
          <h2 className="ttl" style={{ fontSize: 26 }}>{r.customer_name}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--ink2)' }}>
            <span className="m" style={{ color: days != null && days <= 14 ? 'var(--red)' : undefined }}>{r.event_date ? `Event ${dayLabel(r.event_date)} · ${days}d` : 'No event date'}</span>
            {r.order_value != null && <span className="m">{inr(r.order_value)}</span>}
            {r.converted_order_id && <Link className="chip grn" to={`/orders/${r.converted_order_id}`}>Order {r.converted_order_id}</Link>}
            {r.linked_lead_id && <Link className="chip blu" to={`/leads/${r.linked_lead_id}`}>From lead {r.linked_lead_id}</Link>}
            {r.out_of_sync ? <span className="chip amb">Out of sync with Shopify</span> : null}
          </div>
          <div className="stg">{stages.map((s, i) => <span key={s} className={i < idx ? 'past' : i === idx ? 'cur' : ''}>{s}</span>)}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {next && <button type="button" className="btn pri" onClick={() => move(next)}>Move to {next}</button>}
            {type === 'lead' && r.stage !== 'Won' && lost === null && <button type="button" className="btn" onClick={() => setLost('')}>Mark lost</button>}
            {type === 'order' && esc === null && <button type="button" className="btn" onClick={() => setEsc({ reason: 'Delay', details: '', slaHours: 24 })}>Raise escalation</button>}
          </div>
          {blockers && (
            <div className="chip red" style={{ height: 'auto', padding: '8px 10px', whiteSpace: 'normal', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <span>Can't move to {blockers.to} until these are fixed:</span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{blockers.list.map((b) => <span key={b.key} className="chip red" style={{ outline: '1px solid currentColor' }}>{b.fieldLabel}</span>)}</span>
            </div>
          )}
          {lost !== null && (
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="inp" aria-label="Lost reason" value={lost} onChange={(e) => setLost(e.target.value)} style={{ flexGrow: 1 }} autoFocus>
                <option value="">Why was this lead lost?</option>{(meta?.fields?.lost_reason?.options ?? []).map((o) => <option key={o}>{o}</option>)}
              </select>
              <button type="button" className="btn pri" disabled={!lost.trim()} onClick={markLost}>Confirm lost</button>
              <button type="button" className="btn gh" onClick={() => setLost(null)}>Cancel</button>
            </div>
          )}
          {esc && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid var(--ln)', borderRadius: 8, background: 'var(--sf)' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="inp" aria-label="Escalation reason" value={esc.reason} onChange={(e) => setEsc({ ...esc, reason: e.target.value })}>{REASONS.map((x) => <option key={x}>{x}</option>)}</select>
                <div className="seg" role="group">{[4, 24, 48].map((h) => <button key={h} type="button" className={esc.slaHours === h ? 'on' : ''} onClick={() => setEsc({ ...esc, slaHours: h })}>{h}h SLA</button>)}</div>
              </div>
              <input className="inp" placeholder="What happened?" aria-label="Escalation details" value={esc.details} onChange={(e) => setEsc({ ...esc, details: e.target.value })} />
              <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn pri" disabled={!esc.details.trim()} onClick={raise}>Raise</button><button type="button" className="btn gh" onClick={() => setEsc(null)}>Cancel</button></div>
            </div>
          )}
        </div>

        <div className="dbody">
          <section className="dsec">
            <div className="lbl">Gaps · {gaps.length === 0 ? 'none open' : `${gaps.length} open${nb ? `, ${nb} blocking` : ''}`}</div>
            {gaps.length === 0 && <span className="chip grn" style={{ alignSelf: 'flex-start' }}><Icon name="check" small />Nothing missing for this stage</span>}
            {gaps.map((g) => (
              <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--ln2)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 190, flexShrink: 0 }}>
                  <span style={{ fontWeight: 500, color: g.blocking ? 'var(--red)' : 'var(--amb)' }}>{g.fieldLabel}{g.blocking && <Icon name="lock" small style={{ marginLeft: 5 }} />}</span>
                  <span className="mut" style={{ fontSize: 11 }}>{g.hint}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexGrow: 1, justifyContent: 'flex-end' }}>
                  {g.fix === 'text' && (<>
                    <GapInput g={g} value={vals[g.key]} error={errs[g.key]} style={{ flexGrow: 1, height: 28, fontSize: 12 }}
                      onChange={(val) => { setVals((v) => ({ ...v, [g.key]: val })); setErrs((x) => ({ ...x, [g.key]: null })); }} onEnter={(val) => fix(g, { value: val })} />
                    <button type="button" className="btn sm" onClick={() => fix(g, { value: vals[g.key] })}>Save</button>
                  </>)}
                  {g.fix === 'act' && g.actions.map((a, i) => <button key={a.id} type="button" className={`btn sm${i === 0 ? ' pri' : ''}`} onClick={() => fix(g, { action: a.id })}>{a.label}</button>)}
                </div>
              </div>
            ))}
            {Object.values(errs).filter(Boolean).map((m, i) => <span key={i} className="err-t">{m}</span>)}
          </section>

          {qualification && (
            <section className="dsec">
              <div className="lbl">Qualification · {qualification.status === 'qualified' ? 'qualified' : 'not qualified yet'}</div>
              {qualification.reasons.map((x) => <span key={x} style={{ fontSize: 12, display: 'flex', gap: 8 }}><span style={{ color: qualification.status === 'qualified' ? 'var(--grn)' : 'var(--amb)' }}>{qualification.status === 'qualified' ? '✓' : '•'}</span>{x}</span>)}
              <span className="mut" style={{ fontSize: 11 }}>Updates by itself as you fill in the product, date, budget and phone. It needs a product, an event date or budget, a phone number and a customer who has replied.</span>
            </section>
          )}

          <section className="dsec">
            <div className="lbl">Key details</div>
            <div className="fgrid">
              <span className="mut">Customer</span>{input('customer_name', r.customer_name)}
              <span className="mut">Owner</span>
              <select className="inp" aria-label="Owner" value={r.owner_id ?? ''} onChange={(e) => save('owner_id', e.target.value, r.owner_id)}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <span className="mut">Event date</span>{input('event_date', longDate(r.event_date), { placeholder: 'DD Mon YYYY' })}
              <span className="mut">Order value (₹)</span>{input('order_value', r.order_value ?? '', { placeholder: 'Amount' })}
            </div>
          </section>

          {fieldGroups.map((grp) => (
            <section key={grp.stage} className="dsec">
              <div className="lbl">{grp.stage === r.stage ? `${grp.stage} · this stage` : grp.stage}</div>
              <div className="fgrid" style={{ gridTemplateColumns: '190px 1fr' }}>
                {grp.fields.map((f) => (
                  <div key={f.key} style={{ display: 'contents' }}>
                    <span style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', color: !f.filled && f.level === 'blocking' ? 'var(--red)' : !f.filled && f.level === 'needed' ? 'var(--amb)' : 'var(--ink2)' }}>
                      {f.label}<LevelChip level={f.level} />
                    </span>
                    <FieldControl f={f} onSave={(k, val) => save(k, val, r.fields[k])} />
                  </div>
                ))}
              </div>
            </section>
          ))}

          <section className="dsec">
            <div className="lbl">Other details</div>
            <div className="fgrid">
              {otherKeys.map((k) => (
                <div key={k} style={{ display: 'contents' }}>
                  <span className="mut" style={{ fontSize: 12 }}>{label(k)}</span>
                  <FieldControl f={{ key: k, label: label(k), value: r.fields[k], type: meta?.fields?.[k]?.type ?? 'text', options: meta?.fields?.[k]?.options, unit: meta?.fields?.[k]?.unit, placeholder: meta?.fields?.[k]?.placeholder }}
                    onSave={(key, val) => save(key, val, r.fields[key])} />
                </div>
              ))}
            </div>
            {Array.isArray(r.fields.reference_links) && r.fields.reference_links.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="mut" style={{ fontSize: 12 }}>Reference links</span>
                {r.fields.reference_links.map((l) => <a key={l} href={l} target="_blank" rel="noreferrer" className="m" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l}</a>)}
              </div>
            )}
          </section>

          {type === 'order' && (
            <section className="dsec">
              <div className="lbl">Escalations · {plural(escalations.filter((e) => !e.resolved_at).length, 'open')}</div>
              {escalations.length === 0 && <span className="mut" style={{ fontSize: 12 }}>None raised for this order.</span>}
              {escalations.map((e) => (
                <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', borderTop: '1px solid var(--ln2)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={`chip ${e.resolved_at ? 'grn' : 'red'}`}>{e.resolved_at ? 'Resolved' : `${e.reason} · ${e.sla_hours}h SLA`}</span>
                    <span className="mut" style={{ fontSize: 11 }}>{e.raised_by ? `${e.raised_by} · ` : ''}{ago(parseTs(e.raised_at))}</span>
                  </div>
                  <span style={{ fontSize: 12 }}>{e.details}</span>
                  {e.resolved_at ? <span className="mut" style={{ fontSize: 12 }}>Resolution: {e.resolution}</span> : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input className="inp" placeholder="How was it resolved?" aria-label="Resolution" style={{ flexGrow: 1, height: 28, fontSize: 12 }} value={resolving[e.id] || ''} onChange={(ev) => setResolving((x) => ({ ...x, [e.id]: ev.target.value }))} />
                      <button type="button" className="btn sm" disabled={!(resolving[e.id] || '').trim()} onClick={() => resolve(e.id)}>Resolve</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {type === 'lead' && data?.record?.fields?.source_ingestion && (
            <section className="dsec">
              <div className="lbl">Chat</div>
              <ChatView load={() => api.leadChat(id)} />
            </section>
          )}

          <section className="dsec">
            <div className="lbl">Activity</div>
            {feed.length === 0 && <span className="mut" style={{ fontSize: 12 }}>Nothing yet.</span>}
            {feed.map((f, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                <span><b style={{ fontWeight: 500 }}>{f.text}</b>{f.by && <span className="mut"> · {f.by}</span>} <span className="mut">· {ago(f.t)}</span></span>
                {f.sub && <span className="mut" style={{ fontSize: 11 }}>{f.sub}</span>}
              </div>
            ))}
          </section>
        </div>
      </aside>
      <Toast message={toast} />
    </>
  );
}
