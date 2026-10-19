// All icons from the design file, keyed by name. <Icon name="lock" small /> -> 12px variant.
const P = {
  home: <><path d="M3 8.5 10 3l7 5.5V17H3z" /><path d="M8 17v-5h4v5" /></>,
  leads: <path d="M4 4h12v9H9l-4 3v-3H4z" />,
  orders: <><path d="M3 6.5 10 3l7 3.5v7L10 17l-7-3.5z" /><path d="M3 6.5 10 10l7-3.5M10 10v7" /></>,
  gaps: <><circle cx="10" cy="10" r="7" /><path d="M10 6.5v4.5M10 13.5v.01" /></>,
  settings: <><path d="M4 6h8M15 6h1M4 14h2M9 14h7" /><circle cx="13.5" cy="6" r="1.5" /><circle cx="7.5" cy="14" r="1.5" /></>,
  search: <><circle cx="9" cy="9" r="5.5" /><path d="m13 13 4 4" /></>,
  chevDown: <path d="m6 8 4 4 4-4" />,
  chevRight: <path d="m8 6 4 4-4 4" />,
  moon: <path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z" />,
  bell: <><path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 2h-13z" /><path d="M8.5 18h3" /></>,
  plus: <path d="M10 4v12M4 10h12" />,
  lock: <><rect x="5" y="9" width="10" height="8" rx="1.5" /><path d="M7 9V7a3 3 0 0 1 6 0v2" /></>,
  shot: <><rect x="3" y="4" width="14" height="12" rx="1.5" /><circle cx="7.5" cy="8.5" r="1.3" /><path d="m3 14 4-3.5 3 2.5 3-3 4 3.5" /></>,
  pencil: <path d="M4 16l1-4 8-8 3 3-8 8z" />,
  paste: <><rect x="5" y="3" width="10" height="14" rx="1.5" /><path d="M8 7h4M8 10h4M8 13h2" /></>,
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  truck: <><path d="M2.5 5.5h9v8h-9zM11.5 8.5h3l3 3v2h-6z" /><circle cx="6" cy="14.5" r="1.5" /><circle cx="14.5" cy="14.5" r="1.5" /></>,
  x: <path d="M5 5l10 10M15 5 5 15" />,
  up: <path d="m6 12 4-4 4 4" />,
  down: <path d="m6 8 4 4 4-4" />,
};

export default function Icon({ name, small, className = '', style, ...rest }) {
  return (
    <svg className={`i${small ? ' s' : ''} ${className}`.trim()} viewBox="0 0 20 20" style={style} aria-hidden="true" {...rest}>
      {P[name]}
    </svg>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 22 22" style={{ width: 22, height: 22, fill: 'none', stroke: 'var(--gold)', strokeWidth: 1.6, strokeLinecap: 'round' }} aria-hidden="true">
      <path d="M3 16C7 5 15 5 19 16" strokeDasharray="2.2 2.6" />
      <circle cx="19" cy="16" r="1.6" />
    </svg>
  );
}