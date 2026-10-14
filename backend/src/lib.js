// Small shared helpers: dates, INR, value parsing/validation.
const DAY = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const todayStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate());
export const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const isoInDays = (n, now) => toISO(addDays(todayStart(now), n));

export function daysTo(iso, now) {
  if (!iso) return null;
  return Math.round((fromISO(iso) - todayStart(now)) / DAY);
}
export const fmtDay = (iso) => { if (!iso) return '—'; const d = fromISO(iso); return `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]}`; };
export const fmtWeekday = (iso) => fromISO(iso).toLocaleDateString('en-US', { weekday: 'short' });
export const inr = (n) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN'));

export class ValidationError extends Error {
  constructor(message) { super(message); this.status = 422; }
}

// "14 Nov 2026" | "14 Nov" | "2026-11-14" -> ISO. Year-less dates roll to the next occurrence.
export function parseDate(input, now) {
  const s = String(input ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?$/);
  if (!m) throw new ValidationError('Use a date like 14 Nov 2026');
  const mon = MON.findIndex((x) => m[2].toLowerCase().startsWith(x.toLowerCase()));
  if (mon < 0) throw new ValidationError('Unknown month');
  const t = todayStart(now);
  let y = m[3] ? Number(m[3]) : t.getFullYear();
  let d = new Date(y, mon, Number(m[1]));
  if (!m[3] && d < t) d = new Date(y + 1, mon, Number(m[1]));
  if (d.getMonth() !== mon) throw new ValidationError('That date does not exist');
  return toISO(d);
}

// Field-aware parsing: select must be one of the options, url must look like a link, longtext keeps its line breaks.
export function parseField(def, input, now) {
  const s = String(input ?? '').trim();
  if (def.options) {
    if (!s) throw new ValidationError('Choose a value first');
    const hit = def.options.find((o) => o.toLowerCase() === s.toLowerCase());
    if (!hit) throw new ValidationError(`Choose one of: ${def.options.join(', ')}`);
    return hit;
  }
  if (def.type === 'url') {
    if (!/^https?:\/\/\S+$/i.test(s)) throw new ValidationError('Enter a link starting with https://');
    return s.slice(0, 1000);
  }
  if (def.type === 'longtext') { if (!s) throw new ValidationError('Enter a value first'); return s.slice(0, 5000); }
  return parseValue(def.type === 'bool' || def.type === 'paid' ? 'text' : def.type, input, now);
}

// Normalises what the user typed in an inline-fix input according to the field type.
export function parseValue(type, input, now) {
  const s = String(input ?? '').trim();
  if (!s) throw new ValidationError('Enter a value first');
  switch (type) {
    case 'date': return parseDate(s, now);
    case 'currency': {
      const n = Number(s.replace(/[₹,\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) throw new ValidationError('Enter an amount like 95,000');
      return Math.round(n);
    }
    case 'number': {
      const n = Number(s.replace(/\s*(in|inch|inches|cm)$/i, ''));
      if (!Number.isFinite(n) || n <= 0 || n > 400) throw new ValidationError('Enter a measurement like 30 or 38.5');
      return n;
    }
    default: return s.slice(0, 500);
  }
}