// The one API client for the Stitch API (api/). Vite proxies /api to :4000 in development.
const KEY = 'stitch.token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

const BASE = import.meta.env.VITE_API_URL || '/api';

async function req(method, url, body) {
  const token = getToken();
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, ...data });
  return data;
}
const qs = (o = {}) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '' && v !== 'ALL')); return p.toString() ? `?${p}` : ''; };

export default {
  login: async (email, password) => { const r = await req('POST', '/auth/login', { email, password }); setToken(r.token); },
  logout: async () => setToken(null),
  me: () => req('GET', '/me'),

  // org + settings
  brands: () => req('GET', '/brands'),
  checkBrand: (q) => req('GET', `/brands/check${qs(q)}`),
  createBrand: (body) => req('POST', '/brands', body),
  updateBrand: (id, body) => req('PATCH', `/brands/${id}`, body),
  templates: () => req('GET', '/templates'),
  brandFields: (id) => req('GET', `/brands/${id}/fields`),
  addBrandField: (id, body) => req('POST', `/brands/${id}/fields`, body),
  updateBrandField: (id, key, body) => req('PATCH', `/brands/${id}/fields/${key}`, body),
  updateBrandRule: (id, rule) => req('PUT', `/brands/${id}/rules`, { rules: [rule] }),
  savePipeline: (id, stages) => req('PUT', `/brands/${id}/pipeline`, { stages }),
  teams: () => req('GET', '/teams'),
  createTeam: (body) => req('POST', '/teams', body),
  updateTeam: (id, body) => req('PATCH', `/teams/${id}`, body),
  users: () => req('GET', '/users'),
  createUser: (body) => req('POST', '/users', body),
  updateUser: (id, body) => req('PATCH', `/users/${id}`, body),
  products: (brand) => req('GET', `/products${qs({ brand })}`),

  // leads
  leads: (q) => req('GET', `/leads${qs(q)}`),
  lead: (id) => req('GET', `/leads/${id}`),
  createLead: (body) => req('POST', '/leads', body),
  updateLead: (id, body) => req('PATCH', `/leads/${id}`, body),
  moveLead: (id, body) => req('POST', `/leads/${id}/stage`, body),
  loseLead: (id, body) => req('POST', `/leads/${id}/lost`, body),
  reopenLead: (id, body) => req('POST', `/leads/${id}/reopen`, body),
  leadEvents: (id) => req('GET', `/leads/${id}/events`),
  leadPayments: (id) => req('GET', `/leads/${id}/payments`),
  addLeadPayment: (id, body) => req('POST', `/leads/${id}/payments`, body),
  updatePayment: (id, body) => req('PATCH', `/payments/${id}`, body),
  leadIssues: (id) => req('GET', `/leads/${id}/issues`),
  addIssue: (id, body) => req('POST', `/leads/${id}/issues`, body),
  updateIssue: (id, body) => req('PATCH', `/issues/${id}`, body),
  gaps: (q) => req('GET', `/gaps${qs(q)}`),

  // orders
  orders: (q) => req('GET', `/orders${qs(q)}`),
  order: (id) => req('GET', `/orders/${id}`),
  updateOrder: (id, body) => req('PATCH', `/orders/${id}`, body),
  moveOrder: (id, body) => req('POST', `/orders/${id}/stage`, body),
  orderEvents: (id) => req('GET', `/orders/${id}/events`),
  addOrderPayment: (id, body) => req('POST', `/orders/${id}/payments`, body),
  correct: (orderId, itemId, body) => req('POST', `/orders/${orderId}/items/${itemId}/customisations`, body),
  versions: (orderId, itemId, kind) => req('GET', `/orders/${orderId}/items/${itemId}/customisations${qs({ kind })}`),
  signOff: (id) => req('POST', `/customisations/${id}/sign-off`, {}),
  approve: (id) => req('POST', `/customisations/${id}/approve`, {}),
  orderDispatches: (id) => req('GET', `/orders/${id}/dispatches`),
  addDispatch: (id, body) => req('POST', `/orders/${id}/dispatches`, body),
  updateDispatch: (id, body) => req('PATCH', `/dispatches/${id}`, body),
  weekly: (q) => req('GET', `/dispatches/weekly${qs(q)}`),

  notifications: (q) => req('GET', `/notifications${qs(q)}`),
  readAll: () => req('POST', '/notifications/read-all', {}),
};
