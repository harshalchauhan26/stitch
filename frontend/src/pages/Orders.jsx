import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import OrderDrawer, { ORDER_STAGES } from '../components/OrderDrawer.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { dayLabel, inr, plural } from '../lib/format.js';

/** Orders: the same fulfilment pipeline for every brand. Drag a card to move it; gates still apply. */
export default function Orders() {
  const { id } = useParams();
  const nav = useNavigate();
  const { brand, refreshSummary, say } = useApp();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [over, setOver] = useState(null);

  const load = useCallback(() => api.orders({ brand: brand === 'ALL' ? undefined : brand, limit: 200 }).then((r) => setRows(r.orders)).catch((e) => say(e.message)), [brand, say]);
  useEffect(() => { setRows(null); load(); }, [load]);
  const visible = useMemo(() => (rows ?? []).filter((o) => { const s = q.trim().toLowerCase(); return !s || `${o.client.name ?? ''} ${o.order_no} ${o.products.join(' ')}`.toLowerCase().includes(s); }), [rows, q]);

  const moveTo = async (orderId, stage) => {
    const o = rows.find((x) => x.id === orderId);
    if (!o || o.stage === stage) return;
    if (stage === 'Dispatched') { say('Open the order and create the shipment: that moves it to Dispatched'); nav(`/orders/${orderId}`); return; }
    try { await api.moveOrder(orderId, { version: o.version, to: stage }); say(`${o.order_no} moved to ${stage}`); load(); refreshSummary(); }
    catch (e) {
      if (e.code === 'blocked') { say(`Can't move to ${stage} yet: ${e.blockers.map((b) => b.label).join(', ')}`); nav(`/orders/${orderId}`); }
      else if (/reason/.test(e.message)) { const reason = window.prompt(`${e.message}\n\nReason:`); if (reason) { await api.moveOrder(orderId, { version: o.version, to: stage, reason }).catch((x) => say(x.message)); load(); } }
      else say(e.message);
    }
  };

  return (
    <>
      <div style={{ padding: '24px 28px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="ttl">Orders</h1>
          <span style={{ color: 'var(--ink2)' }}>{rows ? `${plural(visible.length, 'order')}. Orders are created when a lead reaches its brand's won stage.` : 'Loading…'}</span>
        </div>
        <input className="inp" placeholder="Search name, ORD-number, product" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260, height: 28, fontSize: 12 }} />
      </div>
      <div className="board">
        {ORDER_STAGES.map((stage) => {
          const cards = visible.filter((o) => o.stage === stage);
          return (
            <section key={stage} className={`col${over === stage ? ' over' : ''}`} aria-label={stage}
              onDragOver={(e) => { e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver((x) => (x === stage ? null : x))}
              onDrop={(e) => { e.preventDefault(); setOver(null); moveTo(e.dataTransfer.getData('text/plain'), stage); }}>
              <div className="colh">{stage}<span className="chip m" style={{ marginLeft: 'auto' }}>{cards.length}</span></div>
              <div className="cards">
                {cards.map((o) => (
                  <article key={o.id} className={`card${o.blocking_gap_count ? ' blk' : ''}${o.id === id ? ' sel' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', o.id)} onClick={() => nav(`/orders/${o.id}`)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 500, flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.client.name}</span><span className="bd">{o.brand}</span>
                    </div>
                    <div className="mut" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.products.join(', ')}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="m mut" style={{ fontSize: 11 }}>{o.order_no}</span>
                      {o.event_date && <span className="m" style={{ fontSize: 11 }}>{dayLabel(o.event_date)}</span>}
                      <span style={{ flexGrow: 1 }} />
                      <span className="m" style={{ fontSize: 11, color: o.balance_due > 0 ? 'var(--amb)' : 'var(--grn)' }}>{o.balance_due > 0 ? `${inr(o.balance_due)} due` : 'paid'}</span>
                      {o.blocking_gap_count > 0 && <span className="chip red"><Icon name="lock" small />{o.blocking_gap_count}</span>}
                    </div>
                  </article>
                ))}
                {cards.length === 0 && <div className="mut" style={{ fontSize: 12, padding: '6px 4px' }}>No orders here</div>}
              </div>
            </section>
          );
        })}
      </div>
      {id && <OrderDrawer id={id} onClose={() => nav('/orders')} onChanged={() => { load(); refreshSummary(); }} />}
    </>
  );
}
