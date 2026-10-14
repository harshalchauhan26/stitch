import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import Menu from '../components/Menu.jsx';
import Toast from '../components/Toast.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { eventLabel } from '../lib/format.js';
import { GapInput } from '../components/FieldControl.jsx';

const WITHIN = [{ value: '', label: 'Any' }, ...[7, 14, 30, 60].map((n) => ({ value: String(n), label: `${n} days` }))];
const recHref = (g) => `/${g.recordType}s/${g.recordId}`;

export default function Gaps() {
  const { brand, refreshSummary, user } = useApp();
  const brandList = useMemo(() => (user?.brands ?? []).map((b) => [b.code, b.name]), [user]);
  const [params] = useSearchParams();
  const [gaps, setGaps] = useState([]);
  const [serverCleared, setServerCleared] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [done, setDone] = useState({});               // key -> auditId (rows fixed this session stay visible, struck through)
  const [closed, setClosed] = useState({}); // collapsed brand groups (all but the first, as in the design)
  const [sev, setSev] = useState('all');
  const [by, setBy] = useState('brand');
  const [owner, setOwner] = useState(params.get('owner') || 'anyone');
  const [within, setWithin] = useState(params.get('eventWithin') || '');
  const [users, setUsers] = useState([]);
  const [vals, setVals] = useState({});                // key -> typed text
  const [errs, setErrs] = useState({});                // key -> inline validation error
  const [toast, setToast] = useState(null);            // { msg, undoKey }
  const timer = useRef();
  useEffect(() => { setOwner(params.get('owner') || 'anyone'); setWithin(params.get('eventWithin') || ''); }, [params]);   // saved views change the URL while this page stays open

  const say = useCallback((msg, undoKey) => {
    clearTimeout(timer.current);
    setToast({ msg, undoKey: undoKey || null });
    timer.current = setTimeout(() => setToast(null), 3600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { api.users().then(setUsers).catch(() => {}); }, []);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    return api.gaps({ brand, owner, eventWithin: within })
      .then((r) => { setGaps(r.gaps); setServerCleared(r.cleared); setDone({}); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [brand, owner, within]);
  useEffect(() => { load(); }, [load]);
  // Design starts with KH/VM collapsed; but when the user filters to one brand, show it expanded.
  useEffect(() => { setClosed(brand === 'ALL' ? Object.fromEntries(brandList.slice(1).map(([c]) => [c, 1])) : {}); }, [brand, brandList]);

  // ---- derived (same maths as the design) ----
  const isOpen = (g) => !done[g.key];
  const open = gaps.filter(isOpen);
  const nb = open.filter((g) => g.blocking).length;
  const pass = (g) => sev === 'all' || (sev === 'block' ? g.blocking : !g.blocking);

  // ---- actions ----
  const run = async (g, body) => {
    try {
      const r = await api.fixGap(g.key, body);
      const resolves = g.fix === 'text' || g.actions.find((a) => a.id === (body.action || 'primary'))?.resolves;
      if (resolves) {
        setDone((d) => ({ ...d, [g.key]: r.auditId })); setErrs((e) => ({ ...e, [g.key]: null }));
        say(r.message, g.key); refreshSummary();
      } else say(r.message);
    } catch (e) {
      if (g.fix === 'text' && e.status === 422) setErrs((x) => ({ ...x, [g.key]: e.message })); else say(e.message);
    }
  };
  const ask = async (g) => { try { say((await api.askGap(g.key)).message); } catch (e) { say(e.message); } };
  const askAll = async () => {
    const keys = open.filter((g) => g.fix === 'text' && pass(g)).map((g) => g.key);
    try { say((await api.askAll(keys)).message); } catch (e) { say(e.message); }
  };
  const undo = async () => {
    const key = toast?.undoKey; if (!key) return;
    try { await api.undo(done[key]); setDone((d) => { const n = { ...d }; delete n[key]; return n; }); setToast(null); refreshSummary(); }
    catch (e) { say(e.message); }
  };

  // ---- rows ----
  const rows = useMemo(() => {
    const out = [];
    if (by === 'brand') {
      brandList.forEach(([code, name]) => {
        const list = gaps.filter((g) => g.brand === code && pass(g));
        if (!list.length && brand !== 'ALL' && brand !== code) return;
        const op = list.filter(isOpen);
        out.push({ t: 'brand', code, name, open: op.length, blocks: op.filter((g) => g.blocking).length });
        if (closed[code]) return;
        const fields = [];
        [...list].sort((a, b) => b.score - a.score).forEach((g) => { if (!fields.includes(g.fieldLabel)) fields.push(g.fieldLabel); });
        fields.forEach((f) => {
          const fl = list.filter((g) => g.fieldLabel === f).sort((a, b) => b.score - a.score);
          const blk = fl.some((g) => g.blocking);
          out.push({ t: 'field', name: f, blk, meta: `${fl.length} ${fl.length === 1 ? 'record' : 'records'}${blk ? ' · blocking' : ''}` });
          fl.forEach((g) => out.push({ t: 'item', g, showBrand: false }));
        });
      });
    } else {
      gaps.filter(pass).sort((a, b) => b.score - a.score).forEach((g) => out.push({ t: 'item', g, showBrand: true }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaps, done, closed, sev, by, brand, brandList]);

  const seg = (opts, value, set) => (
    <div className="seg" role="group">
      {opts.map(([id, label, count]) => (
        <button key={id} type="button" className={value === id ? 'on' : ''} onClick={() => set(id)}>
          {label}{count !== undefined && <span className="m" style={{ fontSize: 11, opacity: 0.75 }}>{count}</span>}
        </button>
      ))}
    </div>
  );
  const ownerOpts = [{ value: 'anyone', label: 'Anyone' }, { value: 'me', label: 'Me' }, ...users.map((u) => ({ value: u.id, label: u.name }))];
  const ownerLabel = ownerOpts.find((o) => o.value === owner)?.label ?? 'Anyone';

  return (
    <>
      <div style={{ padding: '24px 28px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1 }}>
            <h1 className="ttl">Gaps</h1>
            <span style={{ color: 'var(--ink2)' }}>Every missing item across leads and orders, riskiest first. Fix each one right here.</span>
          </div>
          <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end' }}>
            {[[open.length, 'var(--amb)', 'open'], [nb, 'var(--red)', 'blocking'], [serverCleared + Object.keys(done).length, 'var(--grn)', 'cleared today']].map(([n, c, l]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span className="m" style={{ fontSize: 22, fontWeight: 500, color: c, lineHeight: 1 }}>{n}</span>
                <span className="mut" style={{ fontSize: 11 }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {seg([['all', 'All', open.length], ['block', 'Blocking', nb], ['soft', 'Needed', open.length - nb]], sev, setSev)}
          {seg([['brand', 'Brand › Field'], ['risk', 'Flat, by risk']], by, setBy)}
          <Menu className="btn sm" options={ownerOpts} value={owner} onChange={setOwner} trigger={`Owner: ${ownerLabel.toLowerCase()}`} />
          <Menu className="btn sm" options={WITHIN} value={within} onChange={setWithin} trigger={`Event within: ${within ? within + 'd' : 'any'}`} />
          <div style={{ flexGrow: 1 }} />
          <button className="btn sm" type="button" onClick={askAll}><Icon name="leads" small />Ask all on WhatsApp</button>
        </div>
      </div>

      <div style={{ flexGrow: 1, overflow: 'auto', padding: '0 28px 28px' }}>
        <div style={{ border: '1px solid var(--ln)', borderRadius: 10, overflow: 'hidden' }}>
          <div className="gr lbl" style={{ height: 34, background: 'var(--sf2)', position: 'sticky', top: 0, zIndex: 2 }}>
            <span /><span>Record</span><span>Stage</span><span>Why it matters</span><span>Event</span><span /><span>Fix</span>
          </div>
          {error && <div style={{ padding: 20 }}><span className="chip red">Could not load gaps: {error}</span> <button className="btn sm" onClick={load}>Retry</button></div>}
          {!error && loading && <div className="mut" style={{ padding: 20 }}>Loading…</div>}
          {!error && !loading && rows.length === 0 && <div className="mut" style={{ padding: 20 }}>No gaps match these filters.</div>}
          {rows.map((r, i) => {
            if (r.t === 'brand') {
              return (
                <div key={'b' + r.code} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 16px', background: 'var(--sf2)', borderTop: '1px solid var(--ln)' }}>
                  <button className="tw" type="button" aria-label="Toggle brand" onClick={() => setClosed((c) => { const n = { ...c }; if (n[r.code]) delete n[r.code]; else n[r.code] = 1; return n; })}>
                    <Icon name="chevRight" small style={{ transform: `rotate(${closed[r.code] ? '0deg' : '90deg'})` }} />
                  </button>
                  <span className="bd">{r.code}</span><span style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</span>
                  <span className="chip amb m">{r.open} open</span>
                  {r.blocks > 0 && <span className="chip red m"><Icon name="lock" small />{r.blocks} blocking</span>}
                </div>
              );
            }
            if (r.t === 'field') {
              return (
                <div key={'f' + i} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 16px 0 46px', borderTop: '1px solid var(--ln2)', background: 'var(--bg)' }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: r.blk ? 'var(--red)' : 'var(--amb)' }}>{r.name}</span>
                  <span className="m mut" style={{ fontSize: 11 }}>{r.meta}</span>
                </div>
              );
            }
            const g = r.g, isDone = !!done[g.key];
            return (
              <div key={g.key} className="gr" style={{ minHeight: 48, borderTop: '1px solid var(--ln2)', background: isDone ? 'var(--grnS)' : 'transparent' }}>
                <span className="rd" style={{ opacity: g.hot ? 1 : 0.2 }} title={`Risk score ${g.score}`} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Link to={recHref(g)} style={{ color: 'var(--ink)', textDecoration: isDone ? 'line-through' : 'none', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.rec}</Link>
                    {r.showBrand && <span className="bd">{g.brand}</span>}
                  </span>
                  <span className="m mut" style={{ fontSize: 11 }}>{g.recordId} · <span style={{ color: g.blocking ? 'var(--red)' : 'var(--amb)' }}>{g.fieldLabel}</span></span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{g.stage}</span>
                <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{g.hint}</span>
                <span className="m" style={{ fontSize: 12, color: g.days != null && g.days <= 14 ? 'var(--red)' : g.days == null ? 'var(--amb)' : 'var(--ink2)' }}>{eventLabel(g.eventDate, g.days)}</span>
                <span className="av" title="Owner">{g.owner}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {isDone && <span className="chip grn"><Icon name="check" small />Fixed just now</span>}
                  {!isDone && g.fix === 'text' && (
                    <>
                      <label htmlFor={g.key} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{g.fieldLabel}</label>
                      <GapInput g={g} value={vals[g.key]} error={errs[g.key]} style={{ flexGrow: 1 }}
                        onChange={(val) => { setVals((v) => ({ ...v, [g.key]: val })); if (errs[g.key]) setErrs((x) => ({ ...x, [g.key]: null })); }} onEnter={(val) => run(g, { value: val })} />
                      <button className="btn sm" type="button" onClick={() => run(g, { value: vals[g.key] })}>Save</button>
                      <button className="btn gh sm ic" type="button" aria-label="Ask on WhatsApp" title="Ask on WhatsApp" style={{ width: 28 }} onClick={() => ask(g)}><Icon name="leads" /></button>
                    </>
                  )}
                  {!isDone && g.fix === 'act' && g.actions.map((a, idx) => (
                    <button key={a.id} className={`btn sm${idx === 0 ? ' pri' : ''}`} type="button" onClick={() => run(g, { action: a.id })}>{a.label}</button>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <Toast message={toast?.msg} onUndo={toast?.undoKey ? undo : null} />
    </>
  );
}
