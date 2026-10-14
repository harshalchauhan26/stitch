import { useEffect, useRef, useState } from 'react';

/** Small dropdown. `trigger(open)` renders the button content; options = [{value, label}] */
export default function Menu({ options, value, onChange, trigger, className = 'btn', style, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{trigger}</button>
      {open && (
        <div className="menu" role="menu" style={align === 'right' ? { left: 'auto', right: 0 } : undefined}>
          {options.map((o) => (
            <button key={o.value} type="button" role="menuitem" className={o.value === value ? 'on' : ''} onClick={() => { onChange(o.value); setOpen(false); }}>
              {o.label}{o.value === value && <span>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}