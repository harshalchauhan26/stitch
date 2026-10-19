import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import LeadDrawer from '../components/LeadDrawer.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { dayLabel, phone, plural } from '../lib/format.js';

/** Leads: a Kanban of the selected brand's own pipeline (each brand has its own stages), or a table across brands. */
export default function Leads() {
  const { id } = useParams();
  const nav = useNavigate();
  const { brand, setBrand, brands, brandById, refreshSummary, say } = useApp();
  const [rows, setRows] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const [q, setQ] = useState('');
  const [over, setOver] = useState(null);
  const current = brand === 'ALL' ? null : brandById(brand);

  const load = useCallback(() => api.leads({ brand: brand === 'ALL' ? undefined : brand, limit: 200 }).then((r) => setRows(r.leads)).catch((e) => say(e.message)), [brand, say]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const visible = useMemo(() => (rows ?? []).filter((l) => {
    if (!showClosed && l.stage_type === 'lost') return false;
    const s = q.trim().toLowerCase();
    return !s || `${l.client.name ?? ''} ${l.client.phone} ${l.lead_no} ${l.products.join(' ')}`.toLowerCase().includes(s);
  }), [rows, showClosed, q]);

  const columns = current ? current.lead_pipeline.filter((s) => showClosed || s.type !== 'lost') : [];
  const moveTo = async (leadId, stage) => {
    const l = rows.find((x) => x.id === leadId);
    if (!l || l.stage === stage) return;
    const target = current.lead_pipeline.find((s) => s.name === stage);
    if (target?.type === 'lost') { say('Open the lead and use "Mark lost": it needs a reason'); return; }
    try {
      const r = await api.moveLead(leadId, { version: l.version, to: stage });
      say(r.order_id ? `${l.client.name || l.lead_no} is ${stage}: order created` : `${l.client.name || l.lead_no} moved to ${stage}`);
      load(); refreshSummary();
    } catch (e) {
      if (e.code === 'blocked') { say(`Can't move to ${stage} yet: ${e.blockers.map((b) => b.label).join(', ')}`); nav(`/leads/${leadId}`); }
      else if (/reason/.test(e.message)) { const reason = window.prompt(`${e.message}\n\nReason:`); if (reason) { await api.moveLead(leadId, { version: l.version, to: stage, reason }).catch((x) => say(x.message)); load(); } }
      else { say(e.message); load(); }
    }
  };

  const card = (l) => (
    <article key={l.id} className={`card${l.blocking_gap_count ? ' blk' : ''}${l.id === id ? ' sel' : ''}`} draggable={l.stage_type === 'open'}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', l.id)} onClick={() => nav(`/leads/${l.id}`)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 500, flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.client.name || phone(l.client.phone)}</span>
        <span className="bd">{l.brand.code}</span>
      </div>
      <div className="mut" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.products.join(', ') || 'No product yet'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="m mut" style={{ fontSize: 11 }}>{l.lead_no}</span>
        <span className="m" style={{ fontSize: 11, color: l.days_to_event == null ? 'var(--amb)' : l.days_to_event <= 14 ? 'var(--red)' : 'var(--ink2)' }}>{l.event_date ? `${dayLabel(l.event_date)} · ${l.days_to_event}d` : 'no event date'}</span>
        <span style={{ flexGrow: 1 }} />
        {l.blocking_gap_count > 0 && <span className="chip red"><Icon name="lock" small />{l.blocking_gap_count}</span>}
        {l.open_gap_count > 0 && <span className="chip amb">{plural(l.open_gap_count, 'gap')}</span>}
        {l.open_issue_count > 0 && <span className="chip red">{plural(l.open_issue_count, 'issue')}</span>}
        <span className="av" title="Owner">{l.owner.initials ?? '—'}</span>
      </div>
    </article>
  );

  return (
    <>
      <div style={{ padding: '24px 28px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1 }}>
            <h1 className="ttl">Leads</h1>
            <span style={{ color: 'var(--ink2)' }}>
              {!rows ? 'Loading…' : current ? `${plural(visible.length, 'lead')} in ${current.name}'s pipeline. Drag a card to move it.` : `${plural(visible.length, 'lead')} across all brands. Pick a brand to see its pipeline.`}
            </span>
          </div>
          <Link className="btn pri" to="/leads/new"><Icon name="plus" />Add lead</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="Brand">
            <button type="button" className={brand === 'ALL' ? 'on' : ''} onClick={() => setBrand('ALL')}>All brands</button>
            {brands.map((b) => <button key={b.id} type="button" className={brand === b.id ? 'on' : ''} onClick={() => setBrand(b.id)}><span className="bd" style={{ padding: '2px 4px' }}>{b.code}</span>{b.name}</button>)}
          </div>
          <input className="inp" placeholder="Search name, phone, LD-number, product" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260, height: 28, fontSize: 12 }} />
          <label className="mut" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Show lost</label>
        </div>
      </div>

      {current ? (
        <div className="board">
          {columns.map((col) => {
            const cards = visible.filter((l) => l.stage === col.name);
            return (
              <section key={col.name} className={`col${over === col.name ? ' over' : ''}`} aria-label={col.name}
                onDragOver={(e) => { e.preventDefault(); setOver(col.name); }} onDragLeave={() => setOver((o) => (o === col.name ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); moveTo(e.dataTransfer.getData('text/plain'), col.name); }}>
                <div className="colh">
                  {col.name}
                  {col.type === 'won' && <span className="chip grn" style={{ fontSize: 10, height: 18 }}>creates order</span>}
                  {col.type === 'lost' && <span className="chip" style={{ fontSize: 10, height: 18 }}>closed</span>}
                  <span className="chip m" style={{ marginLeft: 'auto' }}>{cards.length}</span>
                </div>
                <div className="cards">{cards.map(card)}{cards.length === 0 && <div className="mut" style={{ fontSize: 12, padding: '6px 4px' }}>No leads here</div>}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <div style={{ flexGrow: 1, overflow: 'auto', padding: '0 28px 28px' }}>
          <div className="tbl">
            <div className="r h" style={{ gridTemplateColumns: '1.4fr 60px 150px 1.2fr 110px 90px 40px' }}><span>Customer</span><span>Brand</span><span>Stage</span><span>Products</span><span>Event</span><span>Gaps</span><span /></div>
            {visible.map((l) => (
              <div key={l.id} className="r" onClick={() => nav(`/leads/${l.id}`)} style={{ gridTemplateColumns: '1.4fr 60px 150px 1.2fr 110px 90px 40px', cursor: 'pointer', background: l.id === id ? 'var(--goldS)' : undefined }}>
                <span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 500 }}>{l.client.name || phone(l.client.phone)}</b><span className="m mut" style={{ fontSize: 11 }}>{l.lead_no}</span></span>
                <span className="bd" style={{ justifySelf: 'start' }}>{l.brand.code}</span>
                <span className={`chip ${l.stage_type === 'won' ? 'grn' : ''}`} style={{ justifySelf: 'start' }}>{l.stage}</span>
                <span className="mut" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.products.join(', ') || '—'}</span>
                <span className="m" style={{ fontSize: 12 }}>{l.event_date ? `${dayLabel(l.event_date)} · ${l.days_to_event}d` : '—'}</span>
                <span>{l.open_gap_count ? <span className={`chip ${l.blocking_gap_count ? 'red' : 'amb'}`}>{l.open_gap_count}</span> : <span className="mut">—</span>}</span>
                <span className="av">{l.owner.initials ?? '—'}</span>
              </div>
            ))}
            {rows && visible.length === 0 && <div className="r mut" style={{ gridTemplateColumns: '1fr' }}>No leads yet. Add one with “Add lead”.</div>}
          </div>
        </div>
      )}
      {id && <LeadDrawer id={id} onClose={() => nav('/leads')} onChanged={() => { load(); refreshSummary(); }} />}
    </>
  );
}
