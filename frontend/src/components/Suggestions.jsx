import { useState } from 'react';
import { inr } from '../lib/format.js';

// How a suggested value reads on screen. Money is stored in paise, people see rupees (same rule as the rest of the app);
// a "new product" suggestion carries an object, so it is shown as "Product × quantity".
const show = (s) => (s.scope === 'new_item' ? `${s.value.product} × ${s.value.quantity}` : s.type === 'currency' ? inr(s.value) : String(s.value));
const shown = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
// confidence chip colour: green = stated outright, amber = indirect, red = weak guess (same bands as the model's instructions)
const tone = (c) => (c == null ? '' : c >= 0.8 ? 'grn' : c >= 0.6 ? 'amb' : 'red');

/**
 * What the model proposed from a chat (docs/wp-groq.md). Used in two places so the review looks the same everywhere:
 * the Chats page (right after "Read chat") and the lead drawer ("Suggested from the chat").
 *
 * Three parts, top to bottom:
 *   1. the pending suggestions, each with the quote it came from, its confidence and Accept / Dismiss
 *   2. "Did not fit the schema": what the model said that the schema refused, with the reason (never silently dropped)
 *   3. a collapsible list of the fields the chat did not cover (the coverage report)
 *
 * Props: run = one extraction from the API; items = the lead's products (to name the product a value belongs to);
 * busy = disables the buttons while a request is running; onDecide('accept' | 'dismiss', suggestionIds) does the work,
 * so this component only shows things and holds no data of its own.
 */
export default function Suggestions({ run, items = [], busy, onDecide }) {
  const [missing, setMissing] = useState(false);
  const pending = run.suggestions.filter((s) => s.status === 'pending');
  const decided = run.suggestions.filter((s) => s.status !== 'pending');
  const st = run.stats ?? {};
  const itemName = (id) => items.find((i) => String(i.id) === String(id))?.product;
  // the same label can be missing on several products; list it once, with the product when there is one
  const missingNames = [...new Set((st.not_found ?? []).map((f) => (itemName(f.item_id) ? `${f.label} (${itemName(f.item_id)})` : f.label)))];
  const ids = pending.map((s) => s.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* one line that says how much of the chat was read and how much it filled */}
      <span className="mut" style={{ fontSize: 12 }}>
        {st.messages_read != null && <>Read {st.messages_read} of {st.messages_total} messages{st.truncated ? ' (the newest part)' : ''} · </>}
        {pending.length + decided.length} found · {st.already_filled ?? 0} already filled · {missingNames.length} not in the chat{run.model ? ` · ${run.model}` : ''}
      </span>

      {pending.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn pri sm" disabled={busy} onClick={() => onDecide('accept', ids)}>Accept all ({pending.length})</button>
          <button type="button" className="btn gh sm" disabled={busy} onClick={() => onDecide('dismiss', ids)}>Dismiss all</button>
        </div>
      )}
      {pending.map((s) => (
        <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8, borderTop: '1px solid var(--ln2)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{ color: 'var(--ink2)' }}>{s.label}</span>
            {itemName(s.item_id) && <span className="chip" style={{ fontSize: 10, height: 18 }}>{itemName(s.item_id)}</span>}
            <b style={{ fontWeight: 600 }}>{show(s)}</b>
            {/* the chat disagrees with a stored value: show what it would replace */}
            {s.previous != null && <span className="mut">was <s>{s.type === 'currency' ? inr(s.previous) : shown(s.previous)}</s></span>}
            {s.confidence != null && <span className={`chip ${tone(s.confidence)}`} style={{ fontSize: 10, height: 18 }}>{Math.round(s.confidence * 100)}%</span>}
            <span style={{ flexGrow: 1 }} />
            <button type="button" className="btn sm" disabled={busy} onClick={() => onDecide('accept', [s.id])}>Accept</button>
            <button type="button" className="btn gh sm" disabled={busy} onClick={() => onDecide('dismiss', [s.id])}>Dismiss</button>
          </div>
          {/* the quote that proves the value, so a person can check it against the chat without scrolling */}
          {s.evidence && <span className="mut" style={{ fontSize: 11, fontStyle: 'italic' }}>“{s.evidence}”</span>}
        </div>
      ))}
      {pending.length === 0 && decided.length === 0 && <span className="mut" style={{ fontSize: 12 }}>The model found nothing it could fill from this chat.</span>}

      {/* already decided: accepted, dismissed, or failed (with the reason it could not be applied) */}
      {decided.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
          {decided.map((s) => (
            <span key={s.id} className="mut">
              <span className={`chip ${s.status === 'accepted' ? 'grn' : s.status === 'failed' ? 'red' : ''}`} style={{ fontSize: 10, height: 18, marginRight: 6 }}>{s.status}</span>
              {s.label}: {show(s)}{s.error ? ` · ${s.error}` : ''}
            </span>
          ))}
        </div>
      )}

      {/* the exceptions section: values the schema refused. Kept apart from the suggestions on purpose, so a bad value is
          reported instead of being quietly lost (unknown field, field the brand does not use, wrong type or option ...) */}
      {run.exceptions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, border: '1px solid var(--red)', borderRadius: 8 }}>
          <div className="lbl" style={{ color: 'var(--red)' }}>Did not fit the schema · {run.exceptions.length}</div>
          {run.exceptions.map((e, i) => (
            <div key={i} style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span><b style={{ fontWeight: 600 }}>{e.field ?? e.scope}</b>{e.value != null && <> = {shown(e.value)}</>} <span className="chip" style={{ fontSize: 10, height: 18 }}>{e.code}</span></span>
              <span className="mut">{e.reason}{e.evidence ? ` · “${e.evidence}”` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* coverage report: the offered fields the chat did not mention, so a person knows what to ask the customer next */}
      {missingNames.length > 0 && (
        <div style={{ fontSize: 12 }}>
          <button type="button" className="btn gh sm" onClick={() => setMissing((m) => !m)}>{missing ? 'Hide' : 'Show'} fields the chat did not cover ({missingNames.length})</button>
          {missing && <p className="mut" style={{ margin: '6px 0 0' }}>{missingNames.join(', ')}</p>}
        </div>
      )}
    </div>
  );
}
