// The one API client. Every call goes to the Express backend (Vite proxies /api to :3001 in development).
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
  ingestConfig: () => req('GET', '/ingest/config'),
  ingestChats: (chats) => req('POST', '/ingest/chats', { chats }),
  ingestChat: (id) => req('GET', `/ingest/${id}/chat`),
  leadChat: (id) => req('GET', `/leads/${encodeURIComponent(id)}/chat`),
  ingestConfirm: (items) => req('POST', '/ingest/confirm', { items }),
  // boards + records
  meta: () => req('GET', '/meta'),
  leads: (brand) => req('GET', `/leads${qs({ brand })}`),
  orders: (brand) => req('GET', `/orders${qs({ brand })}`),
  record: (type, id) => req('GET', `/${type}s/${encodeURIComponent(id)}`),
  createLead: (body) => req('POST', '/leads', body),
  patchRecord: (type, id, body) => req('PATCH', `/${type}s/${encodeURIComponent(id)}`, body),
  move: (type, id, to) => req('POST', `/${type}s/${encodeURIComponent(id)}/move`, { to }),
  escalate: (orderId, body) => req('POST', `/orders/${encodeURIComponent(orderId)}/escalations`, body),
  resolveEscalation: (id, resolution) => req('POST', `/escalations/${id}/resolve`, { resolution }),
  // Settings
  rules: (params) => req('GET', `/rules${qs(params)}`),
  saveRule: (body) => req('PUT', '/rules', body),
  adminBrands: () => req('GET', '/admin/brands'),
  addBrand: (body) => req('POST', '/admin/brands', body),
  editBrand: (code, body) => req('PATCH', `/admin/brands/${code}`, body),
  adminTeams: () => req('GET', '/admin/teams'),
  addTeam: (body) => req('POST', '/admin/teams', body),
  editTeam: (id, body) => req('PUT', `/admin/teams/${id}`, body),
  adminUsers: () => req('GET', '/admin/users'),
  addUser: (body) => req('POST', '/admin/users', body),
  editUser: (id, body) => req('PATCH', `/admin/users/${id}`, body),
};
