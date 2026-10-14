// Values Stitch works out by itself when something else is saved (quote number, lead value, advance %, created date).
import { getVal } from '../gapEngine.js';

export function derived(rec, changes) {
  const out = {};
  const v = (k) => (k in changes ? changes[k] : getVal(rec, k));
  if (rec.recordType === 'lead') {
    if (changes.quote_status === 'Sent' && !rec.fields.quote_number) out.quote_number = `Q-${rec.brand}-${rec.id.replace(/\D/g, '')}-1`;
    if (Number(changes.quote_amount) > 0) out.order_value = Number(changes.quote_amount);
    if (('advance_amount' in changes || 'quote_amount' in changes) && !('advance_percent' in changes)) {
      const q = Number(v('quote_amount')), a = Number(v('advance_amount'));
      if (q > 0 && a > 0) out.advance_percent = Math.min(100, Math.round((a / q) * 100));
    }
  }
  if (!rec.fields.created_date) out.created_date = new Date().toISOString();
  return out;
}
