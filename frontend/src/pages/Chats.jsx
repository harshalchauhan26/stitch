import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { strFromU8, unzipSync } from 'fflate';
import Suggestions from '../components/Suggestions.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { ago, phone, plural } from '../lib/format.js';

// Chats (docs/wp-groq.md): upload a WhatsApp export, let the model read it into a lead, review what it proposed.
//   <Chats>      the page: the upload card, the list of stored chats, and the panel of the selected chat (/chats/:id)
//   <Upload>     the upload card (POST /conversations: code only, no model)
//   <ChatPanel>  one chat: "Fill from this chat" (POST /conversations/:id/extract) and the review of the result
// The model's values are only ever suggestions here: nothing reaches a lead until Accept is clicked.

// "Export chat" gives a .txt, or a .zip with the .txt inside when media is included. fflate (already a dependency) opens the zip
// in the browser so the person never has to unzip anything.
async function readExport(file) {
  if (!/\.zip$/i.test(file.name)) return file.text();
  const inner = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const name = Object.keys(inner).find((n) => /\.txt$/i.test(n));
  if (!name) throw new Error('There is no .txt chat file inside this zip');
  return strFromU8(inner[name]);
}

// The upload card. The brand is not chosen directly: it comes from the WhatsApp number the chat was on (each number belongs to
// exactly one brand, PLAN §4.1), so picking the number is what ties the chat to a brand. The customer is found by the API from
// the number in the file name ("WhatsApp Chat with +91 ..."); the phone / name boxes are only for exports without one.
function Upload({ onUploaded }) {
  const { brands, say } = useApp();
  const accounts = brands.flatMap((b) => (b.whatsapp_accounts ?? []).filter((a) => a.active).map((a) => ({ id: a.id, label: `${b.name} · ${phone(a.phone)}` })));
  const [account, setAccount] = useState(accounts.length === 1 ? accounts[0].id : '');
  const [file, setFile] = useState(null);
  const [cust, setCust] = useState({ phone: '', name: '' });
  const [hint, setHint] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setHint(null);
    try {
      const text = await readExport(file);
      const r = await api.uploadChat({ whatsapp_account_id: account, file_name: file.name, text, client_phone: cust.phone || undefined, client_name: cust.name || undefined });
      // a longer export of a chat that is already stored only adds the new messages (the API de-duplicates by message hash)
      say(r.created ? `Chat stored: ${plural(r.messages, 'message')}` : `Chat updated: ${plural(r.appended, 'new message')} added`);
      setFile(null); setCust({ phone: '', name: '' });
      onUploaded(r.id);
    } catch (e) {
      if (e.code === 'duplicate_upload') { say(e.message); onUploaded(e.conversation_id); }        // same file twice: just open the stored chat
      else if (e.code === 'phone_needed') setHint(e.message);                                       // no number in the file name or the chat
      else say(e.message);
    } finally { setBusy(false); }
  };

  return (
    <section className="tbl" style={{ padding: 16, display: 'grid', gridTemplateColumns: '170px 1fr', gap: '10px 14px', alignItems: 'center' }}>
      <span className="lbl" style={{ gridColumn: '1 / -1' }}>Upload a WhatsApp chat export</span>
      <span className="mut">Brand WhatsApp number</span>
      <select className="inp" value={account} onChange={(e) => setAccount(e.target.value)}>
        <option value="">Which number was the chat on?</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
      <span className="mut">Chat file</span>
      <input className="inp" type="file" accept=".txt,.zip,text/plain,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ paddingTop: 5 }} />
      <span className="mut">Customer phone</span>
      <input className="inp" placeholder="Only if it is not in the file name, e.g. +91 98111 22222" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} />
      <span className="mut">Customer name</span>
      <input className="inp" placeholder="Optional" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} />
      {hint && <span className="err-t" style={{ gridColumn: '1 / -1' }}>{hint}</span>}
      <span />
      <div><button type="button" className="btn pri" disabled={busy || !account || !file} onClick={submit}>{busy ? 'Uploading…' : 'Upload chat'}</button></div>
    </section>
  );
}

// ---------------------------------------------------------------- one chat: read it into a lead, review what came back
function ChatPanel({ id }) {
  const { say, refreshSummary } = useApp();
  const [conv, setConv] = useState(null);          // the stored chat with its first messages
  const [leads, setLeads] = useState([]);          // the customer's open leads with this brand: what the chat could fill instead of a new lead
  const [users, setUsers] = useState([]);          // for "Owner" when a new lead is created
  const [target, setTarget] = useState('new');     // 'new' = start a new lead, otherwise the id of the lead to fill
  const [owner, setOwner] = useState('');
  const [run, setRun] = useState(null);            // the extraction being reviewed (the result of Read chat, or the latest earlier one)
  const [items, setItems] = useState([]);          // the lead's products, so suggestions can name the product they belong to
  const [running, setRunning] = useState(false);   // the model is reading (a few seconds)
  const [busy, setBusy] = useState(false);         // an accept / dismiss request is running
  const [err, setErr] = useState(null);
  const [showChat, setShowChat] = useState(false);

  // load everything this chat needs. The latest earlier run is shown straight away, so a review can be resumed after a refresh.
  useEffect(() => {
    setConv(null); setRun(null); setErr(null); setShowChat(false);
    api.conversation(id, { limit: 80 }).then(setConv).catch((e) => say(e.message));
    // default to filling the customer's open lead when there is one, so a second read does not create a duplicate lead
    api.chatLeads(id).then((l) => { setLeads(l); setTarget(l[0]?.id ?? 'new'); }).catch(() => {});
    api.chatExtractions(id).then((xs) => setRun(xs[0] ?? null)).catch(() => {});
    api.users().then(setUsers).catch(() => {});
  }, [id, say]);
  useEffect(() => { if (run?.lead_id) api.lead(run.lead_id).then((l) => setItems(l.items)).catch(() => setItems([])); }, [run?.lead_id, run?.id]);

  // "Read chat": the API calls the model, checks every value, and returns suggestions + exceptions. confirm = the person said
  // "this is a separate purchase" after the API warned that the customer already has an open lead.
  const go = async (confirm = false) => {
    setRunning(true); setErr(null);
    try {
      const r = await api.extract(id, target === 'new' ? { create_lead: true, owner_id: owner || undefined, confirm_new_purchase: confirm || undefined } : { lead_id: target });
      setRun(r); refreshSummary();
      say(r.lead.created ? `${r.lead.lead_no} created from the chat` : 'Chat read');
    } catch (e) { setErr(e); } finally { setRunning(false); }
  };
  // accept / dismiss: the API returns the updated run (statuses changed) plus how many values were applied or failed
  const decide = async (action, ids) => {
    setBusy(true);
    try {
      const r = await (action === 'accept' ? api.acceptExtraction : api.dismissExtraction)(run.id, ids);
      setRun((prev) => ({ ...prev, ...r })); refreshSummary();                         // keep the lead info the first response carried
      say(action === 'accept' ? `${plural(r.applied, 'value')} saved${r.failed ? `, ${r.failed} could not be applied` : ''}` : 'Dismissed');
    } catch (e) { say(e.message); } finally { setBusy(false); }
  };

  if (!conv) return <div className="mut">Loading…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* the stored chat, collapsed: customer lines in dark, brand (staff) lines greyed */}
      <section className="tbl" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontWeight: 600 }}>{conv.file_name}</b>
          <span className="mut">{plural(conv.message_count, 'message')} · {conv.customer_message_count} from the customer</span>
          <span style={{ flexGrow: 1 }} />
          <button type="button" className="btn gh sm" onClick={() => setShowChat((s) => !s)}>{showChat ? 'Hide chat' : 'Show chat'}</button>
        </div>
        {showChat && (
          <div style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {conv.messages.map((m) => <span key={m.id} style={{ color: m.role === 'staff' ? 'var(--ink3)' : 'var(--ink)' }}><b style={{ fontWeight: 500 }}>{m.sender}</b>: {m.text || `<${m.media}>`}</span>)}
            {conv.message_count > conv.messages.length && <span className="mut">… {conv.message_count - conv.messages.length} more</span>}
          </div>
        )}
      </section>

      {/* choose what to fill and start the read */}
      <section className="tbl" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="lbl">Fill from this chat</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="inp" aria-label="Which lead" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">Start a new lead from this chat</option>
            {leads.map((l) => <option key={l.id} value={l.id}>Fill {l.lead_no} · {l.stage}{l.products.length ? ` · ${l.products.join(', ')}` : ''}</option>)}
          </select>
          {target === 'new' && (
            <select className="inp" aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Owner: me</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <button type="button" className="btn pri" disabled={running} onClick={() => go(false)}>{running ? 'Reading the chat…' : 'Read chat'}</button>
        </div>
        <span className="mut" style={{ fontSize: 12 }}>The model proposes values for every field the brand asks for. Nothing is saved to a lead until you accept it.</span>
        {/* errors from the API are shown as written (no key set, Groq limit, bad output ...). The one with buttons is the
            "customer already has an open lead" warning: fill that lead instead, or confirm it is a separate purchase */}
        {err && (
          <div className="chip red" style={{ height: 'auto', padding: '8px 10px', whiteSpace: 'normal', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
            <span>{err.message}</span>
            {err.code === 'open_lead_exists' && <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn sm" onClick={() => { setTarget(err.lead_id); setErr(null); }}>Fill {err.lead_no} instead</button>
              <button type="button" className="btn sm" onClick={() => go(true)}>It is a separate purchase: create it</button>
            </span>}
          </div>
        )}
      </section>

      {/* the review: suggestions, exceptions and the coverage report (components/Suggestions.jsx) */}
      {run && (
        <section className="tbl" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="lbl">Result</span>
            <span className="mut" style={{ fontSize: 12 }}>{ago(run.created_at)}</span>
            <span style={{ flexGrow: 1 }} />
            <Link className="btn sm" to={`/leads/${run.lead_id}`}>Open {run.lead?.lead_no ?? 'the lead'}</Link>
          </div>
          {run.warnings?.map((w, i) => <span key={i} className="chip amb" style={{ height: 'auto', padding: 8, whiteSpace: 'normal' }}>{w}</span>)}
          <Suggestions run={run} items={items} busy={busy} onDecide={decide} />
        </section>
      )}
    </div>
  );
}

export default function Chats() {
  const { id } = useParams();
  const nav = useNavigate();
  const { brandById, say } = useApp();
  const [convs, setConvs] = useState(null);
  const [clients, setClients] = useState(new Map());
  // the chat list has only client ids, so the customers are loaded once and looked up by id (no change to the chats API needed)
  const load = useCallback(() => Promise.all([
    api.conversations({ limit: 100 }).then(setConvs),
    api.clients({ limit: 200 }).then((cs) => setClients(new Map(cs.map((c) => [c.id, c])))),
  ]).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); }, [load]);
  const GRID = 'minmax(0,1.4fr) 60px 90px 110px 110px';

  return (
    <div style={{ overflow: 'auto', padding: '24px 28px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 className="ttl">Chats</h1>
        <span style={{ color: 'var(--ink2)' }}>Upload a WhatsApp export and let the model fill a lead from it. You review every value.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 24, alignItems: 'start' }}>
        {/* left: upload + the stored chats. Right: the selected chat (route /chats/:id) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Upload onUploaded={(cid) => { load(); nav(`/chats/${cid}`); }} />
          <div className="tbl">
            <div className="r h" style={{ gridTemplateColumns: GRID }}><span>Customer</span><span>Brand</span><span>Messages</span><span>Last message</span><span>Leads</span></div>
            {(convs ?? []).map((c) => {
              const cl = clients.get(c.client_id);
              return (
                <div key={c.id} className="r" onClick={() => nav(`/chats/${c.id}`)} style={{ gridTemplateColumns: GRID, cursor: 'pointer', background: c.id === id ? 'var(--goldS)' : undefined }}>
                  <span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 500 }}>{cl?.name || phone(cl?.phone) || 'Customer'}</b><span className="m mut" style={{ fontSize: 11 }}>{phone(cl?.phone)}</span></span>
                  <span className="bd" style={{ justifySelf: 'start' }}>{brandById(c.brand_id)?.code ?? '—'}</span>
                  <span className="m">{c.message_count}</span>
                  <span className="mut" style={{ fontSize: 12 }}>{c.last_msg_at ? ago(c.last_msg_at) : '—'}</span>
                  <span className={`chip ${c.lead_ids.length ? 'grn' : ''}`} style={{ justifySelf: 'start' }}>{c.lead_ids.length ? plural(c.lead_ids.length, 'lead') : 'not linked'}</span>
                </div>
              );
            })}
            {convs && convs.length === 0 && <div className="r mut" style={{ gridTemplateColumns: '1fr' }}>No chats yet. Upload an export above.</div>}
          </div>
        </div>
        <div>{id ? <ChatPanel key={id} id={id} /> : <p className="mut">Pick a chat to read it into a lead.</p>}</div>
      </div>
    </div>
  );
}
