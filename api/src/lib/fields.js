// Field values: parse what a person typed (PLAN §12), read a value from the right document, and decide "filled".
import { CLIENT_PATHS, ITEM_PATHS, ORDER_PATHS } from '../catalogue.js';
import { badRequest } from './errors.js';
import { parsePhone } from './normalise.js';
import { isoDate } from './validate.js';

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const CM_PER_IN = 2.54;

/** Typed input -> stored value. null / '' clears the field. Throws a 400 naming the field. */
export function parseFieldValue(def, input) {
  if (empty(input)) return null;
  const label = def.label;
  const text = (max) => {
    if (typeof input !== 'string' && typeof input !== 'number') throw badRequest(`${label} must be text`);
    const s = String(input).trim();
    if (s.length > max) throw badRequest(`${label} must be at most ${max} characters`);
    return s;
  };
  switch (def.type) {
    case 'text': return text(500);
    case 'longtext': return text(5000);
    case 'date': return isoDate(input, label);
    case 'select': {
      const hit = def.options.find((o) => o.toLowerCase() === String(input).trim().toLowerCase());
      if (!hit) throw badRequest(`${label} must be one of: ${def.options.join(', ')}`);
      return hit;
    }
    case 'bool': {
      if (input === true || /^yes$/i.test(String(input).trim())) return 'Yes';
      if (input === false || /^no$/i.test(String(input).trim())) return 'No';
      throw badRequest(`${label} must be Yes or No`);
    }
    case 'paid': {
      if (/^paid$/i.test(String(input).trim())) return 'Paid';
      if (/^unpaid$/i.test(String(input).trim())) return 'Unpaid';
      throw badRequest(`${label} must be Paid or Unpaid`);
    }
    case 'currency': {
      const n = typeof input === 'number' ? input : Number(String(input).replace(/[,\s]/g, ''));
      if (!Number.isInteger(n) || n < 0) throw badRequest(`${label} must be a whole amount in the smallest unit (paise), e.g. 9500000 for ₹95,000`);
      return n;
    }
    case 'number': {
      const s = String(input).trim();
      const cm = /cm$/i.test(s);
      let n = Number(s.replace(/\s*(in|inch|inches|"|cm)$/i, ''));
      if (!Number.isFinite(n)) throw badRequest(`${label} must be a number${def.unit ? ` in ${def.unit}` : ''}`);
      if (cm && def.unit === 'in') n = Math.round((n / CM_PER_IN) * 4) / 4;      // to the nearest quarter inch (spec A11)
      if ((def.min != null && n < def.min) || (def.max != null && n > def.max)) {
        throw badRequest(`${label} must be between ${def.min} and ${def.max}${def.unit ? ` ${def.unit}` : ''}`);
      }
      return n;
    }
    case 'url': {
      const s = text(1000);
      if (!/^https?:\/\/\S+$/i.test(s)) throw badRequest(`${label} must be a link starting with https://`);
      return s;
    }
    case 'phone': {
      const p = parsePhone(input);
      if (!p) throw badRequest(`${label} must be a phone number with 8 to 15 digits`);
      return p.e164;
    }
    default: return text(500);
  }
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Reads a field's value from the record it lives on. ctx: { client, lead, item, order } */
export function valueOf(def, ctx) {
  switch (def.scope) {
    case 'client': return ctx.client ? ctx.client[CLIENT_PATHS[def.key] ?? def.key] : undefined;
    case 'item': return ctx.item ? (ITEM_PATHS[def.key] ? ctx.item[ITEM_PATHS[def.key]] : ctx.item.fields?.[def.key]) : undefined;
    case 'order': return ctx.order ? (ORDER_PATHS[def.key] ? getPath(ctx.order, ORDER_PATHS[def.key]) : ctx.order.fields?.[def.key]) : undefined;
    default: return (ctx.lead ?? ctx.order)?.fields?.[def.key];
  }
}

export function isFilled(def, v) {
  if (def.done_values?.length) return def.done_values.includes(v);
  if (def.type === 'bool') return v === 'Yes';
  if (def.type === 'paid') return v === 'Paid';
  return !empty(v);
}

/** "only when <field> <op> <value>". ne needs the field to be filled: no country yet means no duty gap (spec §8). */
export function conditionHolds(cond, defs, ctx) {
  if (!cond) return true;
  const def = defs.get(cond.field) ?? { key: cond.field, scope: cond.scope };
  const v = valueOf({ ...def, scope: cond.scope ?? def.scope }, ctx);
  const same = !empty(v) && String(v).trim().toLowerCase() === cond.value.toLowerCase();
  return cond.op === 'eq' ? same : (!empty(v) && !same);
}
