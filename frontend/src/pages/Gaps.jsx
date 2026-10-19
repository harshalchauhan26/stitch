import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { dayLabel, plural } from '../lib/format.js';

/** The to-do list: every required field still empty on an open lead, blocking first, then the nearest event. */
export default function Gaps() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { brand, say } = useApp();
  const [gaps, setGaps] = useState(null);
  const level = params.get('level') || '';
  const owner = params.get('owner') || '';
  const set = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const load = useCallback(() => api.gaps({ brand: brand === 'ALL' ? undefined : brand, level: level || undefined, owner: owner || undefined }).then(setGaps).catch((e) => say(e.message)), [brand, level, owner, say]);
  useEffect(() => { setGaps(null); load(); }, [load]);
  const leads = new Set((gaps ?? []).map((g) => g.record_id)).size;
  const GRID = '14px minmax(0,1.3fr) minmax(0,1.4fr) 140px 110px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flexGrow: 1 }}>
      <div style={{ padding: '24px 28px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div><h1 className="ttl">Gaps</h1><span style={{ color: 'var(--ink2)' }}>{gaps ? `${plural(gaps.length, 'missing detail')} on ${plural(leads, 'lead')}. Blocking ones stop a lead moving on.` : 'Loading…'}</span></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="seg">{[['', 'All'], ['blocking', 'Blocking'], ['needed', 'Needed']].map(([k, l]) => <button key={k} type="button" className={level === k ? 'on' : ''} onClick={() => set('level', k)}>{l}</button>)}</div>
          <div className="seg">{[['', 'Everyone'], ['me', 'Mine']].map(([k, l]) => <button key={k} type="button" className={owner === k ? 'on' : ''} onClick={() => set('owner', k)}>{l}</button>)}</div>
        </div>
      </div>
      <div style={{ flexGrow: 1, overflow: 'auto', padding: '0 28px 28px' }}>
        <div className="tbl">
          <div className="r h" style={{ gridTemplateColumns: GRID }}><span /><span>Lead</span><span>Missing</span><span>Stage</span><span>Event</span></div>
          {(gaps ?? []).map((g) => (
            <div key={`${g.record_id}-${g.field}-${g.item_id ?? ''}`} className="r" style={{ gridTemplateColumns: GRID, cursor: 'pointer' }} onClick={() => nav(`/leads/${g.record_id}`)}>
              <span className="rd" style={{ background: g.level === 'blocking' ? 'var(--red)' : 'var(--amb)' }} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><b style={{ fontWeight: 500 }}>{g.client_name}</b><span className="bd">{g.brand}</span></span>
                <span className="m mut" style={{ fontSize: 11 }}>{g.record_no}</span>
              </span>
              <span style={{ color: g.level === 'blocking' ? 'var(--red)' : 'var(--ink)' }}>{g.level === 'blocking' && <Icon name="lock" small style={{ marginRight: 4 }} />}{g.item_label ? `${g.item_label}: ` : ''}{g.label}</span>
              <span className="mut" style={{ fontSize: 12 }}>{g.stage}</span>
              <span className="m" style={{ fontSize: 12, color: g.days_to_event != null && g.days_to_event <= 14 ? 'var(--red)' : 'var(--ink2)' }}>{g.event_date ? `${dayLabel(g.event_date)} · ${g.days_to_event}d` : '—'}</span>
            </div>
          ))}
          {gaps && gaps.length === 0 && <div className="r" style={{ gridTemplateColumns: '1fr' }}><span className="chip grn" style={{ justifySelf: 'start' }}><Icon name="check" small />Nothing missing</span></div>}
        </div>
      </div>
    </div>
  );
}
