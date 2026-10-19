import { useState } from 'react';
import { inr, toPaise, toRupees } from '../lib/format.js';

const LEVEL = { blocking: ['red', 'Blocking'], needed: ['amb', 'Needed'], optional: [null, 'Optional'] };
export const LevelChip = ({ level }) => (LEVEL[level] ? <span className={`chip ${LEVEL[level][0] || ''}`} style={{ fontSize: 10, height: 18 }}>{LEVEL[level][1]}</span> : null);

/** The value as the API wants it, from what was typed: null clears the field, NaN means "not a valid amount". */
export function fromInput(def, raw) {
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (s === '' || s == null) return null;
  if (def.type === 'currency') return toPaise(s);
  if (def.type === 'number') return Number.isNaN(Number(s)) ? s : Number(s);
  return s;
}

const display = (def, v) => {
  if (v == null || v === '') return '';
  if (def.type === 'currency') return toRupees(v);
  return String(v);
};

/**
 * One editable field. def: { key, label, type, options, unit, computed, hint }. Saves on blur (text) or change (choices).
 * onSave(key, apiValue). Values Stitch fills in itself (from payments, dispatches) are shown read-only.
 */
export default function FieldControl({ def, value, onSave, disabled }) {
  const shown = display(def, value);
  const [bad, setBad] = useState(null);
  const save = (raw) => {
    const v = fromInput(def, raw);
    // "95k" is not an amount: say so instead of sending it (NaN would reach the API as null and clear the field)
    if (typeof v === 'number' && Number.isNaN(v)) { setBad(def.type === 'currency' ? 'Enter an amount in rupees, e.g. 95000' : 'Enter a number'); return; }
    setBad(null);
    if (String(v ?? '') !== String(value ?? '')) onSave(def.key, v);
  };
  if (def.computed) {
    return <span className="m" style={{ fontSize: 12, color: value ? 'var(--ink)' : 'var(--ink3)' }} title={def.hint}>{def.type === 'currency' ? (value != null ? inr(value) : 'from payments') : value ?? (def.hint ? 'filled by Stitch' : '—')}</span>;
  }
  const opts = def.options?.length ? def.options : def.type === 'bool' ? ['Yes', 'No'] : null;
  if (opts) {
    return (
      <select className="inp" aria-label={def.label} value={value ?? ''} disabled={disabled} onChange={(e) => save(e.target.value)}>
        <option value="">—</option>{opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  if (def.type === 'longtext') {
    return <textarea className="inp" aria-label={def.label} rows={2} defaultValue={shown} key={`${def.key}-${shown}`} disabled={disabled}
      style={{ height: 'auto', padding: 8, resize: 'vertical' }} onBlur={(e) => save(e.target.value)} />;
  }
  const type = def.type === 'date' ? 'date' : 'text';
  const ph = def.type === 'currency' ? '₹ amount' : def.unit ? def.unit : def.type === 'url' ? 'https://' : '';
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <input className={`inp${bad ? ' err' : ''}`} type={type} aria-label={def.label} defaultValue={shown} key={`${def.key}-${shown}`} placeholder={ph} disabled={disabled}
        inputMode={['number', 'currency'].includes(def.type) ? 'decimal' : undefined} title={bad || undefined}
        onBlur={(e) => save(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
      {bad && <span className="err-t">{bad}</span>}
    </span>
  );
}
