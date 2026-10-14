import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import Toast from '../components/Toast.jsx';
import Drawer from '../components/Drawer.jsx';
import QualChip from '../components/QualChip.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { dayLabel, inr, plural } from '../lib/format.js';

const HOT = 45;
const daysTo = (iso) => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); const t = new Date(); return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); };
const isQ = (c) => c.qualification?.status === 'qualified';

// Table view columns. Same look as the design's Gaps list: shaded sticky header, 48px rows, risk dot, two-line record cell.
const SORTS = {
  risk: (a, b) => b.score - a.score,
  customer: (a, b) => a.customer.localeCompare(b.customer),
  stage: (a, b) => a.stageIdx - b.stageIdx,
  q: (a, b) => (b.qualification?.score ?? -99) - (a.qualification?.score ?? -99),
  event: (a, b) => (a.eventDate || '9999').localeCompare(b.eventDate || '9999'),
  value: (a, b) => (b.value ?? -1) - (a.value ?? -1),
  gaps: (a, b) => b.gapCount - a.gapCount,
};

/** Leads and Orders share one screen: a Kanban board or a tracker table. Drag a card to another column to move it. */
export default function Board({ type }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { brand, refreshSummary } = useApp();
  const [params, setParams] = useSearchParams();
  const [cols, setCols] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(params.get('filter') || 'all');           // all | qualified | notq | blocked | hot
  const [sort, setSort] = useState('risk');
  const [q, setQ] = useState('');
  const [over, setOver] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const view = params.get('view') === 'table' ? 'table' : 'board';
  const word = type === 'lead' ? 'lead' : 'order';
  const lead = type === 'lead';

  useEffect(() => { setFilter(params.get('filter') || 'all'); }, [params]);
  const setView = (v) => { const n = new URLSearchParams(params); if (v === 'table') n.set('view', 'table'); else n.delete('view'); setParams(n, { replace: true }); };

  const say = useCallback((msg) => { clearTimeout(timer.current); setToast(msg); timer.current = setTimeout(() => setToast(null), 4200); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const load = useCallback(() => (lead ? api.leads(brand) : api.orders(brand)).then((c) => { setCols(c); setError(null); }).catch((e) => setError(e.message)), [lead, brand]);
  useEffect(() => { setCols(null); load(); }, [load]);

  const all = useMemo(() => (cols ?? []).flatMap((c, i) => c.cards.map((card) => ({ ...card, stageIdx: i }))), [cols]);
  const count = useMemo(() => ({ all: all.length, qualified: all.filter(isQ).length, notq: all.filter((c) => c.qualification && !isQ(c)).length, blocked: all.filter((c) => c.blocked).length, hot: all.filter((c) => c.score >= HOT).length }), [all]);

  const match = (c) => {
    if (filter === 'qualified' && !isQ(c)) return false;
    if (filter === 'notq' && (isQ(c) || !c.qualification)) return false;
    if (filter === 'blocked' && !c.blocked) return false;
    if (filter === 'hot' && c.score < HOT) return false;
    const s = q.trim().toLowerCase();
    return !s || c.customer.toLowerCase().includes(s) || c.id.toLowerCase().includes(s) || (c.phone || '').replace(/\s/g, '').includes(s.replace(/\s/g, ''));
  };
  const rows = useMemo(() => all.filter(match).sort(SORTS[sort]), [all, filter, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveTo = async (cardId, stage) => {
    const card = all.find((c) => c.id === cardId);
    if (!card || card.stage === stage) return;
    try {
      const r = await api.move(type, cardId, stage);
      say(r.orderId ? `${card.customer} is won. Order ${r.orderId} created.` : `${card.customer} moved to ${stage}`);
      load(); refreshSummary();
    } catch (e) {
      say(e.blockers?.length ? `Blocked: ${e.blockers.map((b) => b.fieldLabel).join(', ')} still needed` : e.message);
    }
  };

  const opts = [['all', 'All', count.all], ...(lead ? [['qualified', 'Qualified', count.qualified], ['notq', 'Not qualified', count.notq]] : []), ['blocked', 'Blocked', count.blocked], ['hot', 'High risk', count.hot]];
  const stat = (n, color, label) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <span className="m" style={{ fontSize: 22, fontWeight: 500, color, lineHeight: 1 }}>{n}</span><span className="mut" style={{ fontSize: 11 }}>{label}</span>
    </div>
  );
  const open = (cardId) => nav(`/${type}s/${cardId}${params.toString() ? `?${params}` : ''}`);

  // ---- grid for the table view (same pattern as the Gaps list) ----
  const GRID = lead ? '14px minmax(0,1.6fr) 120px 130px 96px 100px 84px 30px' : '14px minmax(0,1.6fr) 130px 96px 100px 84px 30px';
  const head = (key, label) => (
    <span role="button" tabIndex={0} onClick={() => setSort(key)} onKeyDown={(e) => e.key === 'Enter' && setSort(key)} style={{ cursor: 'pointer', color: sort === key ? 'var(--goldT)' : undefined }}>{label}{sort === key ? ' ↓' : ''}</span>
  );

  return (
    <>
      <div style={{ padding: '24px 28px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1 }}>
            <h1 className="ttl">{lead ? 'Leads' : 'Orders'}</h1>
            <span style={{ color: 'var(--ink2)' }}>{cols ? (view === 'board' ? `${plural(count.all, word)}. Drag a card to another column to move it.` : `${plural(count.all, word)}, ${sort === 'risk' ? 'riskiest first' : `sorted by ${sort}`}. Click a column heading to sort.`) : 'Loading…'}</span>
          </div>
          <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end' }}>
            {lead ? <>{stat(count.qualified, 'var(--grn)', 'qualified')}{stat(count.notq, 'var(--amb)', 'not qualified')}{stat(count.blocked, 'var(--red)', 'blocked')}</>
              : <>{stat(count.hot, 'var(--amb)', 'high risk')}{stat(count.blocked, 'var(--red)', 'blocked')}</>}
          </div>
          {lead && <Link className="btn pri" to="/leads/new"><Icon name="plus" />Add leads</Link>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="seg" role="group" aria-label="Filter">
            {opts.map(([k, l, n]) => <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}<span className="m" style={{ fontSize: 11, opacity: 0.75 }}>{n}</span></button>)}
          </div>
          <div className="seg" role="group" aria-label="View">
            <button type="button" className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
            <button type="button" className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button>
          </div>
          <input className="inp" placeholder="Search name, id or phone" aria-label="Search this list" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240, height: 28, fontSize: 12 }} />
        </div>
      </div>
      {error && <div style={{ padding: '0 28px' }}><span className="chip red">Could not load: {error}</span> <button className="btn sm" onClick={load}>Retry</button></div>}

      {view === 'board' && (
        <div className="board">
          {(cols ?? []).map((col) => {
            const cards = col.cards.filter(match);
            return (
              <section key={col.stage} className={`col${over === col.stage ? ' over' : ''}`} aria-label={col.stage}
                onDragOver={(e) => { e.preventDefault(); setOver(col.stage); }} onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); moveTo(e.dataTransfer.getData('text/plain'), col.stage); }}>
                <div className="colh">{col.stage}<span className="chip m">{cards.length}</span></div>
                <div className="cards">
                  {cards.map((c) => {
                    const d = daysTo(c.eventDate);
                    return (
                      <article key={c.id} className={`card${c.blocked ? ' blk' : ''}${c.id === id ? ' sel' : ''}`} draggable data-id={c.id}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)} onClick={() => open(c.id)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {c.score >= HOT && <span className="rd" title={`Risk score ${c.score}`} />}
                          <span style={{ fontWeight: 500, flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.customer}</span>
                          <span className="bd">{c.brand}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="m mut" style={{ fontSize: 11 }}>{c.id}</span>
                          <span style={{ flexGrow: 1 }} />
                          {c.value != null && <span className="m" style={{ fontSize: 11 }}>{inr(c.value)}</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="m" style={{ fontSize: 11, color: d == null ? 'var(--amb)' : d <= 14 ? 'var(--red)' : 'var(--ink2)' }}>{c.eventDate ? `${dayLabel(c.eventDate)} · ${d}d` : 'no event date'}</span>
                          <span style={{ flexGrow: 1 }} />
                          {c.blocked && <span className="chip red"><Icon name="lock" small />Blocked</span>}
                          {c.gapCount > 0 && <span className="chip amb">{plural(c.gapCount, 'gap')}</span>}
                          <span className="av" title="Owner">{c.owner ?? '—'}</span>
                        </div>
                        {c.qualification && <div style={{ display: 'flex' }}><QualChip q={c.qualification} /></div>}
                      </article>
                    );
                  })}
                  {cards.length === 0 && <div className="mut" style={{ fontSize: 12, padding: '6px 4px' }}>No {word}s here</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === 'table' && (
        <div style={{ flexGrow: 1, overflow: 'auto', padding: '0 28px 28px' }}>
          <div style={{ border: '1px solid var(--ln)', borderRadius: 10, overflow: 'hidden' }} role="table" aria-label={`${word} tracker`}>
            <div className="gr lbl" role="row" style={{ gridTemplateColumns: GRID, height: 34, background: 'var(--sf2)', position: 'sticky', top: 0, zIndex: 2 }}>
              <span />{head('customer', word === 'lead' ? 'Lead' : 'Order')}{head('stage', 'Stage')}{lead && head('q', 'Qualified')}{head('event', 'Event')}{head('value', 'Value')}{head('gaps', 'Gaps')}<span />
            </div>
            {rows.map((c) => {
              const d = daysTo(c.eventDate);
              return (
                <div key={c.id} className="gr" role="row" data-id={c.id} onClick={() => open(c.id)}
                  style={{ gridTemplateColumns: GRID, minHeight: 48, borderTop: '1px solid var(--ln2)', cursor: 'pointer', background: c.id === id ? 'var(--goldS)' : 'transparent' }}>
                  <span className="rd" style={{ opacity: c.score >= HOT ? 1 : 0.2 }} title={`Risk score ${c.score}`} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <Link to={`/${type}s/${c.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.customer}</Link>
                      <span className="bd">{c.brand}</span>
                    </span>
                    <span className="m mut" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.id} · {c.product || c.phone || '—'}</span>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{c.stage}</span>
                  {lead && <span><QualChip q={c.qualification} /></span>}
                  <span className="m" style={{ fontSize: 12, color: d == null ? 'var(--amb)' : d <= 14 ? 'var(--red)' : 'var(--ink2)' }}>{c.eventDate ? `${dayLabel(c.eventDate)} · ${d}d` : 'no date'}</span>
                  <span className="m" style={{ fontSize: 12 }}>{c.value != null ? inr(c.value) : '—'}</span>
                  <span style={{ display: 'flex', gap: 4 }}>{c.blocked && <span className="chip red" title="Blocked"><Icon name="lock" small /></span>}{c.gapCount > 0 ? <span className="chip amb m">{c.gapCount}</span> : <span className="mut">—</span>}</span>
                  <span className="av" title="Owner">{c.owner ?? '—'}</span>
                </div>
              );
            })}
            {rows.length === 0 && <div className="mut" style={{ padding: 20 }}>No {word}s match these filters.</div>}
          </div>
        </div>
      )}

      {id && <Drawer type={type} id={id} onClose={() => nav(`/${type}s${params.toString() ? `?${params}` : ''}`)} onChanged={() => { load(); refreshSummary(); }} />}
      <Toast message={toast} />
    </>
  );
}
