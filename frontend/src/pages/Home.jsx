import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { dayLabel, greeting, inr, longDate, plural } from '../lib/format.js';

/** The morning view: what is open, what is blocked, what to close first. */
export default function Home() {
  const nav = useNavigate();
  const { user, brand, say } = useApp();
  const [d, setD] = useState(null);
  useEffect(() => {
    const b = brand === 'ALL' ? undefined : brand;
    Promise.all([api.leads({ brand: b, stage_type: 'open', limit: 200 }), api.orders({ brand: b, limit: 200 }), api.gaps({ brand: b }), api.gaps({ brand: b, owner: 'me' }), api.weekly({ brand: b })])
      .then(([leads, orders, gaps, mine, week]) => setD({ leads, orders, gaps, mine, week }))
      .catch((e) => say(e.message));
  }, [brand, say]);
  if (!d) return <div className="ph mut">Loading…</div>;

  const live = d.orders.orders.filter((o) => o.stage !== 'Delivered');
  const due = live.reduce((n, o) => n + Math.max(0, o.balance_due), 0);
  const blocking = d.gaps.filter((g) => g.level === 'blocking');
  const soon = d.leads.leads.filter((l) => l.days_to_event != null && l.days_to_event >= 0 && l.days_to_event <= 30).length;
  const kpi = (n, l, to, color) => (
    <Link className="kpi" to={to}><span className="m kn" style={{ fontSize: 30, fontWeight: 500, color }}>{n}</span><span className="mut">{l}</span></Link>
  );
  return (
    <div style={{ overflow: 'auto', padding: '28px 28px 40px', display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div><span className="mut">{longDate()}</span><h1 className="ttl" style={{ marginTop: 6 }}>{greeting()}, {user?.name?.split(' ')[0]}</h1></div>
      <div style={{ display: 'flex', borderTop: '1px solid var(--ln)', borderBottom: '1px solid var(--ln)' }}>
        {kpi(d.leads.total, 'open leads', '/leads')}
        {kpi(d.mine.length, 'my gaps', '/gaps?owner=me', d.mine.length ? 'var(--amb)' : undefined)}
        {kpi(blocking.length, 'blocking gaps', '/gaps?level=blocking', blocking.length ? 'var(--red)' : undefined)}
        {kpi(soon, 'events in 30 days', '/leads')}
        {kpi(live.length, 'orders in progress', '/orders')}
        {kpi(inr(due), 'balance to collect', '/orders', due ? 'var(--amb)' : undefined)}
        {kpi(d.week.totals.dispatched, 'shipped this week', '/dispatches')}
      </div>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Close these first</h2><span className="mut">{plural(d.gaps.length, 'gap')} open · blocking first, then the nearest event</span><span style={{ flexGrow: 1 }} /><Link to="/gaps">All gaps</Link></div>
        <div className="tbl">
          {d.gaps.slice(0, 8).map((g) => (
            <div key={`${g.record_id}-${g.field}-${g.item_id ?? ''}`} className="r" style={{ gridTemplateColumns: '14px 1.2fr 1.4fr 130px', cursor: 'pointer' }} onClick={() => nav(`/leads/${g.record_id}`)}>
              <span className="rd" style={{ background: g.level === 'blocking' ? 'var(--red)' : 'var(--amb)' }} />
              <span><b style={{ fontWeight: 500 }}>{g.client_name}</b> <span className="bd">{g.brand}</span> <span className="m mut" style={{ fontSize: 11 }}>{g.record_no}</span></span>
              <span>{g.item_label ? `${g.item_label}: ` : ''}{g.label} <span className="mut">· {g.stage}</span></span>
              <span className="m" style={{ fontSize: 12, color: g.days_to_event != null && g.days_to_event <= 14 ? 'var(--red)' : 'var(--ink2)' }}>{g.event_date ? `${dayLabel(g.event_date)} · ${g.days_to_event}d` : 'no event date'}</span>
            </div>
          ))}
          {d.gaps.length === 0 && <div className="r" style={{ gridTemplateColumns: '1fr' }}><span className="chip grn" style={{ justifySelf: 'start' }}><Icon name="check" small />Nothing missing on open leads</span></div>}
        </div>
      </section>
      <section style={{ display: 'flex', gap: 12 }}>
        <Link className="qa" to="/leads/new"><Icon name="plus" />Add a lead by hand</Link>
        <Link className="qa" to="/orders"><Icon name="orders" />Orders board</Link>
        <Link className="qa" to="/dispatches"><Icon name="truck" />This week's dispatches</Link>
      </section>
    </div>
  );
}
