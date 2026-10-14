import Icon from '../lib/Icon.jsx';

/** "Qualified" / "Not qualified". The reasons are on hover. */
export default function QualChip({ q }) {
  if (!q) return null;
  const yes = q.status === 'qualified';
  return (
    <span className={`chip${yes ? ' grn' : ''}`} title={`${yes ? 'Why it qualifies' : 'Why not yet'} (score ${q.score})\n• ${q.reasons.join('\n• ')}`}>
      {yes && <Icon name="check" small />}{yes ? 'Qualified' : 'Not qualified'}
    </span>
  );
}
