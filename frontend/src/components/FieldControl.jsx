

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : iso || '');
const LEVEL = { blocking: ['red', 'Blocking'], needed: ['amb', 'Needed'], optional: [null, 'Optional'] };

export const LevelChip = ({ level }) => (LEVEL[level] ? <span className={`chip ${LEVEL[level][0] || ''}`} style={{ fontSize: 10, height: 18 }}>{LEVEL[level][1]}</span> : null);

// A gap's fix input: a <select> for fixed-choice fields, a text box otherwise. Controlled by the caller.
export function GapInput({ g, value, onChange, onEnter, error, style }) {
  if (g.options) {
    return (
      <select className={`inp${error ? ' err' : ''}`} aria-label={g.fieldLabel} value={value || ''} style={style} title={error || undefined}
        onChange={(e) => { onChange(e.target.value); if (e.target.value && onEnter) onEnter(e.target.value); }}>
        <option value="">Choose…</option>{g.options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input className={`inp${error ? ' err' : ''}`} aria-label={g.fieldLabel} placeholder={g.placeholder} value={value || ''} style={style} title={error || undefined}
      onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.(value)} />
  );
}

// An editable (or read-only) value for the Drawer. f: { key, label, type, options, unit, placeholder, value, system }. Saves on blur / change.
export default function FieldControl({ f, onSave }) {
  const was = f.type === 'date' ? longDate(f.value) : f.value;
  const save = (val) => { if (String(val ?? '') !== String(was ?? '')) onSave(f.key, val); };
  if (f.system) return <span className="m mut" style={{ fontSize: 12 }}>{f.value ? String(f.value) : '—'}</span>;
  const opts = f.options || (f.type === 'bool' ? ['Yes'] : f.type === 'paid' ? ['Paid'] : null);
  if (opts) {
    return (
      <select className="inp" aria-label={f.label} value={f.value ?? ''} onChange={(e) => save(e.target.value)}>
        <option value="">—</option>{opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  if (f.type === 'longtext') {
    return <textarea className="inp" aria-label={f.label} rows={3} defaultValue={f.value ?? ''} key={`${f.key}-${f.value}`} placeholder={f.placeholder}
      style={{ height: 'auto', padding: 8, resize: 'vertical' }} onBlur={(e) => save(e.target.value.trim())} />;
  }
  return <input className="inp" aria-label={f.label} defaultValue={was ?? ''} key={`${f.key}-${f.value}`} placeholder={f.placeholder || (f.unit === 'in' ? 'inches' : '')}
    onBlur={(e) => save(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />;
}
