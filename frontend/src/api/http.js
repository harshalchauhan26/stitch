// Real backend client (Phase 3). Same interface as mock.js, so pages never know which one they use.
const KEY = 'stitch.token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

async function req(method, url, body) {
  const token = getToken();
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, blockers: data.blockers });
  return data;
}
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '' && v !== 'anyone' && v !== 'ALL')); return p.toString() ? `?${p}` : ''; };

export default {
  login: async (email, password) => { const r = await req('POST', '/auth/login', { email, password }); setToken(r.token); },
  logout: async () => setToken(null),
  hasSession: () => !!getToken(),
  me: () => req('GET', '/me'),
  users: () => req('GET', '/meta').then((m) => m.users),
  summary: (brand) => req('GET', `/summary${qs({ brand })}`),
  home: (brand) => req('GET', `/home${qs({ brand })}`),
  gaps: (params) => req('GET', `/gaps${qs(params)}`),
  fixGap: (key, body) => req('POST', `/gaps/${encodeURIComponent(key)}/fix`, body),
  askGap: (key) => req('POST', `/gaps/${encodeURIComponent(key)}/ask`),
  askAll: (keys) => req('POST', '/gaps/ask-all', { keys }),
  undo: (auditId) => req('POST', `/audit/${auditId}/undo`),
  search: (q) => req('GET', `/search${qs({ q })}`),
};