import { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { ago, label as human, plural } from '../lib/format.js';

// E-mails: what Stitch has e-mailed (or is about to e-mail) to the brand teams, and Retry for the ones that failed.
// See docs/MAILER.md for when a mail is sent.
//
// ADMINS ONLY. The list shows every team member's address and the text of every order mail across all brands, so:
//   - the sidebar link is only drawn for admins (components/Sidebar.jsx)
//   - anyone else who opens /mail by hand is sent back to Home (the check at the top of this page)
//   - the API itself answers 403 to anyone who is not an admin, so hiding the page is not the only protection

const STATUS = { pending: ['amb', 'Waiting to send'], processing: ['blu', 'Sending'], sent: ['grn', 'Sent'], failed: ['red', 'Failed'] };
// the mail types the workflows produce (services/mailFlows.js); any other type found in the list is added to the filter too
const TYPES = ['order.opened', 'payment.due', 'customisation.changed', 'customisation.proposed', 'customisation.approved', 'customisation.signed_off', 'dispatch.created', 'order.closed'];
const typeLabel = (t) => human(String(t).replace(/[._]/g, ' '));
const GRID = '90px minmax(0,1fr) minmax(0,1.8fr) 110px 130px 80px';

export default function Mail() {
  const { user, say } = useApp();
  const [params, setParams] = useSearchParams();          // the filters live in the address, so a notification can link to "failed"
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);                 // the id of the mail whose text is shown
  const [busy, setBusy] = useState(null);                 // the id of the mail being retried
  const status = params.get('status') || '';
  const type = params.get('type') || '';
  const set = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const admin = user?.role === 'admin';

  const load = useCallback(() => {
    if (!admin) return;
    api.mails({ status: status || undefined, type: type || undefined }).then(setRows).catch((e) => say(e.message));
  }, [admin, status, type, say]);
  useEffect(() => { setRows(null); load(); }, [load]);

  // Retry puts a failed mail back in the queue and sends it straight away; the list is reloaded to show the new status
  const retry = async (m) => {
    setBusy(m.id);
    try { await api.retryMail(m.id); say(`Sending again to ${m.to}`); load(); } catch (e) { say(e.message); } finally { setBusy(null); }
  };

  if (user && !admin) return <Navigate to="/" replace />;  // not an admin: this page does not exist for them
  const types = [...new Set([...TYPES, ...(rows ?? []).map((m) => m.type), ...(type ? [type] : [])])];
  const failed = (rows ?? []).filter((m) => m.status === 'failed').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flexGrow: 1 }}>
      <div style={{ padding: '24px 28px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h1 className="ttl">E-mails</h1>
          <span style={{ color: 'var(--ink2)' }}>
            {rows ? `The last ${plural(rows.length, 'e-mail')} to the brand teams${failed ? `, ${failed} failed` : ''}. Customers are never e-mailed.` : 'Loading…'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="seg" role="group" aria-label="Status">
            {[['', 'All'], ['failed', 'Failed'], ['pending', 'Waiting'], ['sent', 'Sent']].map(([k, l]) => <button key={k} type="button" className={status === k ? 'on' : ''} onClick={() => set('status', k)}>{l}</button>)}
          </div>
          <select className="inp" aria-label="Mail type" value={type} onChange={(e) => set('type', e.target.value)} style={{ height: 28, fontSize: 12 }}>
            <option value="">Every kind of mail</option>{types.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
          <button type="button" className="btn gh sm" onClick={load}>Refresh</button>
        </div>
      </div>

      <div style={{ flexGrow: 1, overflow: 'auto', padding: '0 28px 28px' }}>
        <div className="tbl">
          <div className="r h" style={{ gridTemplateColumns: GRID }}><span>When</span><span>To</span><span>Subject</span><span>About</span><span>Status</span><span /></div>
          {(rows ?? []).map((m) => (
            <div key={m.id} style={{ borderTop: '1px solid var(--ln2)' }}>
              {/* click a row to read the mail's text */}
              <div className="r" style={{ gridTemplateColumns: GRID, cursor: 'pointer', borderTop: 0 }} onClick={() => setOpen(open === m.id ? null : m.id)}>
                <span className="mut" style={{ fontSize: 12 }}>{ago(m.created_at)}</span>
                <span className="m" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.to}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.subject}</span>
                <span className="m mut" style={{ fontSize: 12 }}>{m.label ?? '—'}</span>
                <span className={`chip ${STATUS[m.status]?.[0] ?? ''}`} style={{ justifySelf: 'start' }}>{STATUS[m.status]?.[1] ?? m.status}</span>
                <span style={{ justifySelf: 'end' }}>
                  {m.status === 'failed' && <button type="button" className="btn sm" disabled={busy === m.id} onClick={(e) => { e.stopPropagation(); retry(m); }}>{busy === m.id ? 'Sending…' : 'Retry'}</button>}
                </span>
              </div>
              {/* why it failed (or is waiting), shown without opening the row so a problem is visible at a glance */}
              {m.last_error && <div className="err-t" style={{ padding: '0 16px 8px' }}>{m.status === 'failed' ? `Failed after ${plural(m.attempts, 'attempt')}` : `Attempt ${m.attempts} failed, will try again`}: {m.last_error}</div>}
              {open === m.id && (
                <div style={{ padding: '4px 16px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="mut" style={{ fontSize: 11 }}>
                    {typeLabel(m.type)} · {plural(m.attempts, 'attempt')}{m.sent_at ? ` · sent ${ago(m.sent_at)}` : ''}
                  </span>
                  <pre style={{ margin: 0, padding: 12, background: 'var(--sf2)', borderRadius: 8, font: "12px/1.5 'IBM Plex Mono', monospace", whiteSpace: 'pre-wrap' }}>{m.body}</pre>
                </div>
              )}
            </div>
          ))}
          {rows && rows.length === 0 && <div className="r mut" style={{ gridTemplateColumns: '1fr' }}>{status || type ? 'No e-mails match these filters.' : 'No e-mails yet. They appear when an order is opened, a payment is due, a spec changes or a shipment moves.'}</div>}
        </div>
      </div>
    </div>
  );
}
