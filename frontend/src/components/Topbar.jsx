import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import Menu from './Menu.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';

export default function Topbar({ searchRef }) {
  const { brand, setBrand, toggleTheme, user } = useApp();
  // only the brands this user's team can see (admins: all of the tenant's brands)
  const BRANDS = [{ value: 'ALL', label: 'All brands', code: 'ALL' }, ...(user?.brands ?? []).map((b) => ({ value: b.code, label: b.name, code: b.code }))];
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const nav = useNavigate();
  const timer = useRef();
  const cur = BRANDS.find((b) => b.value === brand) ?? BRANDS[0];

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return undefined; }
    timer.current = setTimeout(() => api.search(q).then(setResults).catch(() => setResults([])), 200);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <header style={{ height: 56, flexShrink: 0, borderBottom: '1px solid var(--ln)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px' }}>
      <Menu options={BRANDS} value={brand} onChange={setBrand} trigger={<><span className="bd">{cur.code}</span>{cur.label}<Icon name="chevDown" small /></>} />
      <div style={{ flex: '0 1 420px', position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Icon name="search" className="mut" style={{ position: 'absolute', left: 10 }} />
        <input ref={searchRef} className="inp" aria-label="Search" placeholder="Search leads, orders, phone, AWB" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setQ(''), e.target.blur())}
          style={{ width: '100%', paddingLeft: 32, height: 32, fontSize: 13 }} />
        <span className="kbd" style={{ position: 'absolute', right: 8 }}>/</span>
        {results.length > 0 && (
          <div className="sres">
            {results.map((r) => (
              <a key={r.id} href={r.href} onClick={(e) => { e.preventDefault(); setQ(''); nav(r.href); }}>
                <span className="bd">{r.brand}</span><span style={{ fontWeight: 500 }}>{r.customer_name}</span>
                <span className="m mut" style={{ fontSize: 11 }}>{r.id} · {r.stage}</span>
              </a>
            ))}
          </div>
        )}
      </div>
      <div style={{ flexGrow: 1 }} />
      <button className="btn gh ic" type="button" aria-label="Toggle dark theme" onClick={toggleTheme}><Icon name="moon" /></button>
      <button className="btn gh ic" type="button" aria-label="Notifications"><Icon name="bell" /></button>
      <Link className="btn pri" to="/leads/new">
        <Icon name="plus" />Add lead<span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor', opacity: 0.7 }}>N</span>
      </Link>
    </header>
  );
}
