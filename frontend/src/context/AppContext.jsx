import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [dark, setDark] = useState(() => localStorage.getItem('stitch.dark') === '1');
  const [brand, setBrand] = useState('ALL'); // ALL | any brand code the user can see
  const [user, setUser] = useState(null);
  const [auth, setAuth] = useState('checking'); // checking | in | out
  const [summary, setSummary] = useState({ leads: 0, orders: 0, openGaps: 0 });

  const loadMe = useCallback(() => api.me().then((u) => { setUser(u); setAuth('in'); }).catch((e) => { if (e.status === 401) setAuth('out'); }), []);
  useEffect(() => { loadMe(); }, [loadMe]);

  const refreshSummary = useCallback(() => (auth === 'in' ? api.summary(brand).then(setSummary).catch(() => {}) : Promise.resolve()), [brand, auth]);
  useEffect(() => { refreshSummary(); }, [refreshSummary]);
  useEffect(() => { localStorage.setItem('stitch.dark', dark ? '1' : '0'); }, [dark]);

  const login = async (email, password) => { await api.login(email, password); setBrand('ALL'); await loadMe(); };
  const logout = async () => { await api.logout(); setUser(null); setAuth('out'); };

  const value = useMemo(() => ({ dark, toggleTheme: () => setDark((d) => !d), brand, setBrand, user, auth, login, logout, summary, refreshSummary }),
    [dark, brand, user, auth, summary, refreshSummary]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}