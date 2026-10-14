import { useEffect, useState } from 'react';

// The saved WhatsApp conversation, read-only. load() returns { fileName, messages }.
export default function ChatView({ load }) {
  const [chat, setChat] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { let on = true; load().then((c) => on && setChat(c)).catch((e) => on && setErr(e.message)); return () => { on = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <span className="mut" style={{ fontSize: 12 }}>{err}</span>;
  if (!chat) return <span className="mut" style={{ fontSize: 12 }}>Loading chat…</span>;
  let day = '';
  return (
    <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--ln)', borderRadius: 10, background: 'var(--sf2)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {chat.messages.map((m, i) => {
        const d = (m.ts || '').slice(0, 10), staff = m.role === 'staff';
        const sep = d !== day ? (day = d) : null;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: staff ? 'flex-end' : 'flex-start', gap: 6 }}>
            {sep && <span className="mut" style={{ alignSelf: 'center', fontSize: 11 }}>{sep}</span>}
            <div style={{ maxWidth: '80%', padding: '6px 10px', borderRadius: 10, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: staff ? 'var(--goldS)' : 'var(--sf)', border: '1px solid var(--ln2)' }}>
              <div className="mut" style={{ fontSize: 10 }}>{staff ? 'Staff' : m.sender} · {(m.ts || '').slice(11, 16)}</div>
              {m.media ? <i className="mut">[attachment]</i> : m.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
