// Copied from the prototype (backend/src/ingest/whatsappParser.js).
// Turns a WhatsApp "Export chat" .txt into clean messages. Handles the iPhone style
//   [10/7/26, 7:00:51 PM] Name: text          and the Android style
//   12/05/2024, 14:32 - Name: text
// Multi-line messages, system notices, media placeholders and deleted messages are handled.

const IOS = /^\[(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp]\.?[Mm]\.?)?\]\s?(.*)$/;
const AND = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp]\.?[Mm]\.?)?\s+[-–]\s+(.*)$/;
const MEDIA_RE = /^<?(image|video|audio|sticker|gif|document|media|voice message|contact card)\s*(?:message)?\s+omitted>?$|^<attached:\s*[^>]+>$|\(file attached\)$/i;
const DROP_RE = /^(this message was deleted|you deleted this message|<this message was edited>)$/i;
const SYSTEM_VERB = /\b(created group|created this group|changed the (subject|group|this group)|changed (their|this)|added|removed|left|joined|security code|end-to-end encrypted|disappearing messages|blocked|unblocked)\b/i;
const PHONE_LABEL = /^[+(]?\d[\d\s\-()]{6,}\d$/;

const clean = (s) => s.replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, '').replace(/[\u202f\u00a0]/g, ' ');

function toIso(y, mo, d, h, mi, s, ampm) {
  let hh = Number(h);
  if (ampm) { const pm = /p/i.test(ampm); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
  const yyyy = y.length === 2 ? 2000 + Number(y) : Number(y);
  const p = (n) => String(n).padStart(2, '0');
  return `${yyyy}-${p(mo)}-${p(d)}T${p(hh)}:${mi}:${p(s || 0)}`;
}

export const looksLikePhone = (label) => PHONE_LABEL.test(String(label || '').trim());

export function parseWhatsApp(rawText, { staffNames = [], defaultDateOrder = 'DMY' } = {}) {
  const lines = clean(String(rawText || '')).split(/\r?\n/);
  const entries = []; // { m (regex match groups), rest, cont[] }
  let current = null;
  for (const line of lines) {
    const m = line.match(IOS) || line.match(AND);
    if (m) { current = { g: m, rest: m[8], cont: [] }; entries.push(current); }
    else if (current) current.cont.push(line);          // continuation of a multi-line message
    // lines before the first timestamp (e.g. the encryption notice) are dropped
  }
  if (!entries.length) return { messages: [], system: 0, dateOrder: null, firstTs: null, lastTs: null };

  // Day/month order: decided by the data. If it is ambiguous (every day <= 12) use defaultDateOrder.
  // Changed from the prototype, which assumed US M/D for am/pm exports: Indian iPhones export D/M with am/pm.
  let dateOrder = null;
  for (const { g } of entries) { if (Number(g[1]) > 12) { dateOrder = 'DMY'; break; } if (Number(g[2]) > 12) { dateOrder = 'MDY'; break; } }
  if (!dateOrder) dateOrder = defaultDateOrder;

  const raw = []; let system = 0;
  for (const e of entries) {
    const [, a, b, y, h, mi, s, ampm] = e.g;
    const ts = dateOrder === 'MDY' ? toIso(y, a, b, h, mi, s, ampm) : toIso(y, b, a, h, mi, s, ampm);
    const body = [e.rest, ...e.cont].join('\n').replace(/\s+$/, '');
    if (/^[-–]\s/.test(e.rest)) { system++; continue; }              // "[ts] - Your business uses a secure service..."
    const sm = body.match(/^([^:\n]{1,60}?):\s?([\s\S]*)$/);
    if (!sm || SYSTEM_VERB.test(sm[1])) { system++; continue; }
    let text = sm[2].trim();
    if (DROP_RE.test(text)) continue;
    text = text.replace(/\s*<This message was edited>$/i, '');
    const media = MEDIA_RE.test(text) ? (text.match(/image|video|audio|sticker|gif|document|voice/i)?.[0].toLowerCase() || 'file') : null;
    raw.push({ ts, sender: sm[1].trim(), text, media });
  }

  // Who is staff and who is the customer?
  const senders = [...new Set(raw.map((m) => m.sender))];
  const staff = new Set(senders.filter((s) => s.toLowerCase() === 'you' || staffNames.map((n) => n.toLowerCase()).includes(s.toLowerCase())));
  if (!staff.size && senders.length === 2) {
    const phone = senders.find(looksLikePhone);
    if (phone) senders.filter((s) => s !== phone).forEach((s) => staff.add(s));   // the unsaved number is the customer
  }
  const customers = new Set(senders.filter((s) => !staff.has(s) && (staff.size > 0 || looksLikePhone(s))));
  const messages = raw.map((m, i) => ({
    i, ts: m.ts, sender: m.sender, media: m.media, text: m.text,
    role: staff.has(m.sender) ? 'staff' : customers.has(m.sender) ? 'customer' : 'unknown',
  }));
  return { messages, system, dateOrder, firstTs: raw[0]?.ts ?? null, lastTs: raw[raw.length - 1]?.ts ?? null };
}