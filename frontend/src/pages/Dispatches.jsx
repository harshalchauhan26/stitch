import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { ago, dayLabel, fullDate, label as human, plural } from '../lib/format.js';

const shiftWeek = (week, n) => {
  const [y, w] = week.split('-W').map(Number);
  const d = new Date(Date.UTC(y, 0, 4 + (w - 1) * 7 + n * 7));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return `${year}-W${String(Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;
};

/** The week's shipments per brand, late ones, and every correction made (shipments, specs, measurements). */
export default function Dispatches() {
  const { brand, say } = useApp();
  const [week, setWeek] = useState(null);
  const [w, setW] = useState(null);
  const load = useCallback(() => api.weekly({ week: week || undefined, brand: brand === 'ALL' ? undefined : brand }).then((x) => { setW(x); if (!week) setWeek(x.week); }).catch((e) => say(e.message)), [week, brand, say]);
  useEffect(() => { load(); }, [load]);
  if (!w) return <div className="ph mut">Loading…</div>;
  const ROW = '1fr 60px 70px 120px 120px 110px 110px';
  return (
    <div style={{ overflow: 'auto', padding: '24px 28px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ flexGrow: 1 }}><h1 className="ttl">Dispatches</h1><span style={{ color: 'var(--ink2)' }}>Week {w.week.split('-W')[1]} · {fullDate(w.from)} to {fullDate(w.to)}</span></div>
        <div className="seg">
          <button type="button" onClick={() => setWeek(shiftWeek(w.week, -1))}>← Previous</button>
          <button type="button" onClick={() => setWeek(null)}>This week</button>
          <button type="button" onClick={() => setWeek(shiftWeek(w.week, 1))}>Next →</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 32 }}>
        {[['Shipped', w.totals.dispatched, 'var(--ink)'], ['Late', w.totals.late, w.totals.late ? 'var(--red)' : 'var(--ink)'], ['Corrections', w.totals.corrections, w.totals.corrections ? 'var(--amb)' : 'var(--ink)']].map(([l, n, c]) => (
          <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span className="m" style={{ fontSize: 28, color: c }}>{n}</span><span className="mut">{l}</span></div>
        ))}
      </div>

      {w.by_brand.length > 0 && (
        <div className="tbl">
          <div className="r h" style={{ gridTemplateColumns: '1fr repeat(5, 90px)' }}><span>Brand</span><span>Shipped</span><span>In transit</span><span>Delivered</span><span>Returned</span><span>Late</span></div>
          {w.by_brand.map((b) => (
            <div key={b.brand} className="r" style={{ gridTemplateColumns: '1fr repeat(5, 90px)' }}>
              <span className="bd" style={{ justifySelf: 'start' }}>{b.brand}</span><span className="m">{b.total}</span><span className="m">{b.in_transit + b.picked_up + b.scheduled}</span><span className="m">{b.delivered}</span><span className="m">{b.returned + b.failed}</span><span className="m" style={{ color: b.late ? 'var(--red)' : undefined }}>{b.late}</span>
            </div>
          ))}
        </div>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="lbl">Shipments · {plural(w.shipments.length, 'shipment')}</div>
        <div className="tbl">
          <div className="r h" style={{ gridTemplateColumns: ROW }}><span>Order</span><span>Brand</span><span>Parcel</span><span>Courier</span><span>AWB</span><span>Shipped</span><span>Status</span></div>
          {w.shipments.map((s) => (
            <div key={s.id} className="r" style={{ gridTemplateColumns: ROW }}>
              <Link to={`/orders/${s.order_id}`} className="m" style={{ fontSize: 12 }}>{s.order_no}</Link><span className="bd" style={{ justifySelf: 'start' }}>{s.brand}</span><span className="m">{s.shipment_no}</span>
              <span>{s.courier}</span><span className="m" style={{ fontSize: 12 }}>{s.awb ?? '—'}</span>
              <span className="m" style={{ fontSize: 12, color: s.late ? 'var(--red)' : undefined }}>{dayLabel(s.dispatch_date)}{s.late ? ' · late' : ''}</span>
              <span className={`chip ${s.status === 'delivered' ? 'grn' : 'blu'}`} style={{ justifySelf: 'start' }}>{human(s.status)}</span>
            </div>
          ))}
          {w.shipments.length === 0 && <div className="r mut" style={{ gridTemplateColumns: '1fr' }}>Nothing shipped this week.</div>}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="lbl">Corrections this week</div>
        <div className="tbl">
          <div className="r h" style={{ gridTemplateColumns: '110px 100px 60px 1fr 1.2fr 120px' }}><span>When</span><span>Order</span><span>Brand</span><span>What</span><span>Why</span><span>By</span></div>
          {w.corrections.map((c, i) => (
            <div key={i} className="r" style={{ gridTemplateColumns: '110px 100px 60px 1fr 1.2fr 120px', fontSize: 12 }}>
              <span className="mut">{ago(c.at)}</span><Link to={`/orders/${c.order_id}`} className="m">{c.order_no}</Link><span className="bd" style={{ justifySelf: 'start' }}>{c.brand}</span>
              <span>{c.kind === 'dispatch' ? `Shipment ${human(c.field)}: ${c.old} → ${c.new}` : `${c.item ? `${c.item} · ` : ''}${c.kind} v${c.version}: ${human(c.field)}`}</span>
              <span className="mut">{c.reason}</span><span>{c.by}</span>
            </div>
          ))}
          {w.corrections.length === 0 && <div className="r mut" style={{ gridTemplateColumns: '1fr' }}>No corrections this week.</div>}
        </div>
      </section>
    </div>
  );
}
