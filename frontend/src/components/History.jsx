import { useEffect, useState } from 'react';
import { ago, inr, label as human } from '../lib/format.js';

const TEXT = {
  'lead.created': 'Lead created', 'field.set': 'Updated', 'item.added': 'Product added', 'item.updated': 'Product updated', 'item.removed': 'Product removed',
  'owner.changed': 'Owner changed', 'stage.moved': 'Moved', 'stage.overridden': 'Moved past a gate (override)', 'stage.move_blocked': 'Move refused: gate not met',
  'lead.lost': 'Marked lost', 'lead.reopened': 'Reopened', 'lead.won': 'Won: order created', 'payment.recorded': 'Payment recorded', 'payment.received': 'Payment received',
  'payment.updated': 'Payment updated', 'payment.refunded': 'Payment refunded', 'issue.opened': 'Issue opened', 'issue.resolved': 'Issue resolved', 'issue.reopened': 'Issue reopened',
  'conversation.linked': 'Chat linked', 'conversation.unlinked': 'Chat unlinked', 'order.created': 'Order created', 'customisation.changed': 'Correction saved',
  'customisation.proposed': 'Spec change proposed (waiting for a pod lead)', 'customisation.approved': 'Spec change approved', 'measurements.signed_off': 'Customer signed off the measurements',
  'dispatch.created': 'Shipment created', 'dispatch.updated': 'Shipment updated', 'dispatch.corrected': 'Shipment corrected',
};
const MONEY = /amount|price|total|paid|balance|cost|discount|budget|surcharge|duty|estimate/;

/** The record's audit trail: what changed, old -> new, who, from which team, when. */
export default function History({ load, labels = {}, types = {}, items = [] }) {
  const [events, setEvents] = useState(null);
  useEffect(() => { load().then(setEvents).catch(() => setEvents([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!events) return <span className="mut" style={{ fontSize: 12 }}>Loading…</span>;
  if (!events.length) return <span className="mut" style={{ fontSize: 12 }}>Nothing yet.</span>;
  const name = (f) => labels[f] ?? human(String(f).replace(/^(dispatch|payment|amounts)\./, ''));
  const val = (f, v) => {
    if (v == null || v === '') return '—';
    if (typeof v === 'number' && (types[f] === 'currency' || MONEY.test(f))) return inr(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  const itemName = (id) => items.find((i) => String(i.id) === String(id))?.product;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {events.map((e) => (
        <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
          <span>
            <b style={{ fontWeight: 500 }}>{TEXT[e.type] ?? human(e.type.replace('.', ' '))}</b>
            <span className="mut"> · {e.actor?.name}{e.actor?.team_name ? `, ${e.actor.team_name}` : ''} · {ago(e.at)}</span>
            {e.source === 'system' && <span className="chip" style={{ marginLeft: 6, height: 16, fontSize: 10 }}>auto</span>}
          </span>
          {e.changes?.filter((c) => c.field !== 'item' || c.old || c.new).slice(0, 12).map((c, i) => (
            <span key={i} className="mut" style={{ paddingLeft: 10 }}>
              {c.item_id && itemName(c.item_id) ? `${itemName(c.item_id)} · ` : ''}{c.field === 'item' ? (c.new ? `+ ${c.new}` : `− ${c.old}`) : <>{name(c.field)}: {val(c.field, c.old)} → <span style={{ color: 'var(--ink)' }}>{val(c.field, c.new)}</span></>}
            </span>
          ))}
          {e.reason && <span className="mut" style={{ paddingLeft: 10 }}>Reason: {e.reason}</span>}
          {e.type === 'stage.move_blocked' && e.data?.blockers && <span className="mut" style={{ paddingLeft: 10 }}>Missing: {e.data.blockers.map(name).join(', ')}</span>}
          {e.data?.order_no && <span className="mut" style={{ paddingLeft: 10 }}>{e.data.order_no}</span>}
        </div>
      ))}
    </div>
  );
}
