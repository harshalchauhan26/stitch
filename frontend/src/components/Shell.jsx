import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import { useApp } from '../context/AppContext.jsx';

// Keyboard shortcuts shown in the design: "/" search, "N" add lead, "G" then H / L / O / G to jump.
function useShortcuts(searchRef) {
  const nav = useNavigate();
  useEffect(() => {
    let g = false, t;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (k === 'n') { nav('/leads/new'); return; }
      if (g) { g = false; clearTimeout(t); const to = { h: '/', l: '/leads', o: '/orders', g: '/gaps', d: '/dispatches' }[k]; if (to) nav(to); return; }
      if (k === 'g') { g = true; t = setTimeout(() => { g = false; }, 1200); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [nav, searchRef]);
}

export default function Shell({ children }) {
  const { dark } = useApp();
  const searchRef = useRef(null);
  useShortcuts(searchRef);
  return (
    <div className={`app st${dark ? ' dark' : ''}`}>
      <Sidebar />
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar searchRef={searchRef} />
        {children}
      </div>
    </div>
  );
}