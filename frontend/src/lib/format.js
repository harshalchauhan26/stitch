const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const dayLabel = (iso) => { const d = parse(iso); return `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]}`; };
export const inr = (n) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN'));
export const eventLabel = (iso, days) => (iso && days != null ? `${dayLabel(iso)} · ${days}d` : 'no date');
export const longDate = (d = new Date()) => `${DOW[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const greeting = (d = new Date()) => (d.getHours() < 12 ? 'Good morning' : d.getHours() < 17 ? 'Good afternoon' : 'Good evening');
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;