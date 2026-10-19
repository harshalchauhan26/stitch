import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import Menu from './Menu.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { ago, phone } from '../lib/format.js';

export default function Topbar({ searchRef }) {
  const { brand, setBrand, toggleTheme, brands } = useApp();
  const BRANDS = [{ value: 'ALL', label: 'All brands', code: 'ALL' }, ...brands.map((b) => ({ value: b.id, label: b.name, code: b.code }))];
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [bell, setBell] = useState(null);                // null = closed, else the list
  const [unread, setUnread] = useState(0);
  const nav = useNavigate();
  const timer = useRef();
  const cur = BRANDS.find((b) => b.value === brand) ?? BRANDS[0];

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return undefined; }
    timer.current = setTimeout(() => api.leads({ q, limit: 8 }).then((r) => setResults(r.leads)).catch(() => setResults([])), 200);
    return () => clearTimeout(timer.current);
  }, [q]);

  const loadUnread = () => api.notifications({ unread: 1 }).then((n) => setUnread(n.length)).catch(() => {});
  useEffect(() => { loadUnread(); const t = setInterval(loadUnread, 20000); return () => clearInterval(t); }, []);
  const openBell = async () => {
    if (bell) { setBell(null); return; }
    const list = await api.notifications().catch(() => []);
    setBell(list);
    if (unread) { await api.readAll().catch(() => {}); setUnread(0); }
  };

  return (
    <header style={{ height: 56, flexShrink: 0, borderBottom: '1px solid var(--ln)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', position: 'relative' }}>
      <Menu options={BRANDS} value={brand} onChange={setBrand} trigger={<><span className="bd">{cur.code}</span>{cur.label}<Icon name="chevDown" small /></>} />
      <div style={{ flex: '0 1 420px', position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Icon name="search" className="mut" style={{ position: 'absolute', left: 10 }} />
        <input ref={searchRef} className="inp" aria-label="Search" placeholder="Search leads by name, phone or LD-number" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setQ(''), e.target.blur())}
          style={{ width: '100%', paddingLeft: 32, height: 32, fontSize: 13 }} />
        <span className="kbd" style={{ position: 'absolute', right: 8 }}>/</span>
        {results.length > 0 && (
          <div className="sres">
            {results.map((r) => (
              <a key={r.id} href={`/leads/${r.id}`} onClick={(e) => { e.preventDefault(); setQ(''); nav(`/leads/${r.id}`); }}>
                <span className="bd">{r.brand.code}</span><span style={{ fontWeight: 500 }}>{r.client.name || phone(r.client.phone)}</span>
                <span className="m mut" style={{ fontSize: 11 }}>{r.lead_no} · {r.stage}</span>
              </a>
            ))}
          </div>
        )}
      </div>
      <div style={{ flexGrow: 1 }} />
      <button className="btn gh ic" type="button" aria-label="Toggle dark theme" onClick={toggleTheme}><Icon name="moon" /></button>
      <div style={{ position: 'relative' }}>
        <button className="btn gh ic" type="button" aria-label="Notifications" onClick={openBell}>
          <Icon name="bell" />{unread > 0 && <span className="rd" style={{ position: 'absolute', top: 6, right: 6 }} />}
        </button>
        {bell && (
          <div className="menu" style={{ left: 'auto', right: 0, width: 360, maxHeight: 420, overflowY: 'auto', padding: 8 }}>
            {bell.length === 0 && <div className="mut" style={{ padding: 8 }}>No notifications yet.</div>}
            {bell.map((n) => (
              <a key={n.id} href={n.link || '#'} onClick={(e) => { e.preventDefault(); setBell(null); if (n.link) nav(n.link); }}
                style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: 6, color: 'var(--ink)', textDecoration: 'none' }}>
                <span style={{ fontWeight: n.read_at ? 400 : 500 }}>{n.title}</span>
                <span className="mut" style={{ fontSize: 11 }}>{ago(n.created_at)}</span>
              </a>
            ))}
          </div>
        )}
      </div>
      <Link className="btn pri" to="/leads/new">
        <Icon name="plus" />Add lead<span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>N</span>
      </Link>
    </header>
  );
}
