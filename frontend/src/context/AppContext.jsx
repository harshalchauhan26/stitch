import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { getToken } from '../api/http.js';
import Toast from '../components/Toast.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [dark, setDark] = useState(() => localStorage.getItem('stitch.dark') === '1');
  const [brand, setBrand] = useState('ALL');             // ALL | a brand id the user can see
  const [me, setMe] = useState(null);                    // { user, teams, brands }
  const [brands, setBrands] = useState([]);              // full brand records (with lead_pipeline)
  const [auth, setAuth] = useState(getToken() ? 'checking' : 'out');
  const [summary, setSummary] = useState({ leads: 0, orders: 0, gaps: 0 });
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const say = useCallback((m) => { clearTimeout(timer.current); setToast(m); timer.current = setTimeout(() => setToast(null), 4200); }, []);

  const loadMe = useCallback(async () => {
    try {
      const [m, b] = await Promise.all([api.me(), api.brands()]);
      setMe(m); setBrands(b.filter((x) => x.status === 'active')); setAuth('in');
    } catch (e) { if (e.status === 401) setAuth('out'); }
  }, []);
  useEffect(() => { if (getToken()) loadMe(); }, [loadMe]);

  const refreshSummary = useCallback(async () => {
    if (auth !== 'in') return;
    const b = brand === 'ALL' ? undefined : brand;
    try {
      const [l, o, g] = await Promise.all([api.leads({ brand: b, stage_type: 'open', limit: 1 }), api.orders({ brand: b, limit: 1 }), api.gaps({ brand: b })]);
      setSummary({ leads: l.total, orders: o.total, gaps: g.length });
    } catch { /* the badges just stay as they were */ }
  }, [brand, auth]);
  useEffect(() => { refreshSummary(); }, [refreshSummary]);
  useEffect(() => { localStorage.setItem('stitch.dark', dark ? '1' : '0'); }, [dark]);

  const login = async (email, password) => { await api.login(email, password); setBrand('ALL'); await loadMe(); };
  const logout = async () => { await api.logout(); setMe(null); setAuth('out'); };
  const brandById = useCallback((id) => brands.find((b) => b.id === id), [brands]);

  const value = useMemo(() => ({
    dark, toggleTheme: () => setDark((d) => !d), brand, setBrand, me, user: me?.user, brands, brandById, auth, login, logout,
    summary, refreshSummary, reloadMe: loadMe, say,
  }), [dark, brand, me, brands, brandById, auth, summary, refreshSummary, loadMe, say]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className={`st${dark ? ' dark' : ''}`} style={{ position: 'fixed', inset: 'auto 0 0 0', pointerEvents: 'none', zIndex: 60 }}>
        <div style={{ pointerEvents: 'auto' }}><Toast message={toast} /></div>
      </div>
    </Ctx.Provider>
  );
}
