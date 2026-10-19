const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const dayLabel = (iso) => { if (!iso) return '—'; const d = parse(iso.slice(0, 10)); return `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]}`; };
export const fullDate = (iso) => { if (!iso) return '—'; const d = parse(iso.slice(0, 10)); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
export const longDate = (d = new Date()) => `${DOW[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const greeting = (d = new Date()) => (d.getHours() < 12 ? 'Good morning' : d.getHours() < 17 ? 'Good afternoon' : 'Good evening');
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// Money: the API stores the smallest unit (paise); people see and type rupees.
export const inr = (paise) => (paise == null ? '—' : '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
export const toPaise = (rupees) => {
  const s = String(rupees ?? '').replace(/[₹,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};
export const toRupees = (paise) => (paise == null ? '' : String(paise / 100));

export const ago = (ts) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const label = (k) => String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const ROLE_LABEL = { admin: 'Admin', pod_lead: 'Pod lead', sales: 'Sales associate', ops: 'Ops', qc: 'QC' };

/** "+919988776655" -> "+91 99887 76655" (other countries: "+44 7700900123") */
export const phone = (e164) => {
  const s = String(e164 ?? '');
  const m = s.match(/^\+91(\d{5})(\d{5})$/);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  const cc = s.match(/^\+(1|7|2\d|3\d|4\d|5\d|6\d|8\d|9\d{1,2})(\d+)$/);
  return cc ? `+${cc[1]} ${cc[2]}` : s;
};
