import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { eventLabel, greeting, inr, longDate, plural } from '../lib/format.js';

const h2 = { margin: 0, fontSize: 15, fontWeight: 600 };
const num = (color) => ({ fontSize: 30, fontWeight: 500, lineHeight: 1, ...(color ? { color } : {}) });

function Kpi({ to, label, value, color, sub }) {
  return (
    <Link className="kpi" to={to}>
      <span className="lbl">{label}</span>
      <span className="m kn" style={num(color)}>{value}</span>
      <span className="mut" style={{ fontSize: 12 }}>{sub}</span>
    </Link>
  );
}

export default function Home() {
  const { brand, user } = useApp();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setErr(null);
    api.home(brand).then(setD).catch((e) => setErr(e.message));
  }, [brand]);

  if (err) return <main style={{ padding: 40 }}><span className="chip red">Could not load Home: {err}</span></main>;
  if (!d) return <main style={{ flexGrow: 1, padding: 40 }} className="mut">Loading…</main>;
  const k = d.kpis;

  return (
    <main style={{ flexGrow: 1, overflow: 'auto', padding: '32px 40px 40px', display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="lbl">{longDate()}</div>
          <h1 className="ttl">{greeting()}{user ? `, ${user.name.split(' ')[0]}` : ''}</h1>
          <p style={{ margin: 0, color: 'var(--ink2)', fontSize: 14 }}>
            {k.myGaps === 1 ? '1 gap is yours' : `${k.myGaps} gaps are yours`} to close today. {plural(k.blockedOrders, 'order')} cannot ship until something is fixed.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="mut" style={{ fontSize: 12 }}>Jump to</span><span className="kbd">G</span><span className="kbd">L</span><span className="mut" style={{ fontSize: 12 }}>leads</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', borderTop: '1px solid var(--ln)', borderBottom: '1px solid var(--ln)' }}>
        <Kpi to="/gaps?owner=me" label="My gaps" value={k.myGaps} color="var(--amb)" sub={`${k.myGapsNear} on records with events in 30d`} />
        <Kpi to="/orders" label="Blocked orders" value={k.blockedOrders} color="var(--red)" sub="Dispatch locked" />
        <Kpi to="/orders" label="Events this week" value={k.eventsWeek} sub={`${k.eventsAtRisk} at risk of missing the date`} />
        <Kpi to="/orders" label="Escalations" value={k.escalations} sub={`${k.escalationsPastSla} past SLA`} />
        <Kpi to="/orders" label="Out of sync" value={k.outOfSync} color="var(--blu)" sub="Edited since last Shopify push" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 48 }}>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <h2 style={h2}>Close these first</h2>
              <span className="mut" style={{ fontSize: 12 }}>Sorted by risk: gaps, days in stage, days to event, value</span>
            </div>
            <Link to="/gaps" style={{ fontSize: 12, fontWeight: 500, textDecoration: 'none' }}>All {d.summary.openGaps} gaps</Link>
          </div>
          <div>
            {d.risk.length === 0 && <div className="mut" style={{ padding: '16px 0' }}>Nothing is missing. Nice.</div>}
            {d.risk.map((r) => (
              <Link key={r.id} className="row" to={r.href}>
                <span className="rd" style={{ opacity: r.hot ? 1 : 0.25 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                  <span className="m mut" style={{ fontSize: 11 }}>{r.id} · {r.stage}</span>
                </span>
                <span><span className="bd">{r.brand}</span></span>
                <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {r.chips.map((c, i) => (
                    <span key={i} className={`chip ${c.blocking ? 'red' : 'amb'}`}>{c.blocking && <Icon name="lock" small />}{c.t}</span>
                  ))}
                </span>
                <span className="m" style={{ fontSize: 12, color: r.days != null && r.days <= 14 ? 'var(--red)' : 'var(--ink2)' }}>{eventLabel(r.eventDate, r.days)}</span>
                <span className="m" style={{ fontSize: 12, textAlign: 'right' }}>{inr(r.value)}</span>
                <Icon name="chevRight" className="mut" />
              </Link>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
            <h2 style={h2}>Pipeline</h2>
            {d.pipelines.map((p) => (
              <div key={p.name} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', gap: 12, alignItems: 'center' }}>
                <span className="lbl">{p.name}</span>
                <div style={{ display: 'flex', border: '1px solid var(--ln)', borderRadius: 8, overflow: 'hidden', background: 'var(--sf)' }}>
                  {p.stages.map((s) => (
                    <Link key={s.n} to={p.href} style={{ flex: '1 1 0', padding: '10px 12px', borderLeft: '1px solid var(--ln2)', textDecoration: 'none', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: 'var(--ink3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.n}</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span className="m" style={{ fontSize: 15, fontWeight: 500 }}>{s.c}</span>
                        {s.g > 0 && <span className="m" style={{ fontSize: 11, color: 'var(--amb)' }}>{s.g} gaps</span>}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ ...h2, margin: '0 0 8px' }}>Events this week</h2>
            {d.events.length === 0 && <div className="mut">No events in the next 7 days.</div>}
            {d.events.map((e, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--ln2)' }}>
                <span className="m" style={{ fontSize: 12, lineHeight: 1.2 }}>{e.d}<br /><span className="mut" style={{ fontSize: 11 }}>{e.w}</span></span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{e.name} <span className="bd" style={{ marginLeft: 4 }}>{e.brand}</span></span>
                  <span className="mut" style={{ fontSize: 12 }}>{e.what}</span>
                </span>
                <span className={`chip ${e.cls}`}>{e.status}</span>
              </div>
            ))}
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ ...h2, margin: '0 0 8px' }}>Escalations</h2>
            {d.escalations.length === 0 && <div className="mut">No open escalations.</div>}
            {d.escalations.map((e) => (
              <Link key={e.id} to={`/orders/${e.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: '1px solid var(--ln2)', textDecoration: 'none', color: 'var(--ink)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{e.name}</span><span className="m mut" style={{ fontSize: 11 }}>{e.id}</span>
                  <span style={{ flexGrow: 1 }} /><span className={`chip ${e.cls}`}>{e.sla}</span>
                </span>
                <span style={{ color: 'var(--ink2)', fontSize: 12 }}>{e.what}</span>
                <span className="m mut" style={{ fontSize: 11 }}>{e.meta}</span>
              </Link>
            ))}
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={h2}>Quick add</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
              <Link className="qa" to="/leads/new?method=chat"><Icon name="leads" />Chat export</Link>
              <Link className="qa" to="/leads/new?method=screenshot"><Icon name="shot" />Screenshot</Link>
              <Link className="qa" to="/leads/new?method=manual"><Icon name="pencil" />Manual</Link>
              <Link className="qa" to="/leads/new?method=paste"><Icon name="paste" />Paste text</Link>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}