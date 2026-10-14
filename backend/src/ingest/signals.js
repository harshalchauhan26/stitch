// "Analytic extraction": everything we can learn from a chat WITHOUT an AI model.
// These values are facts (phone, brand, counts) or hints (product, dates, budget) that the AI step is checked against.
import { fromISO, toISO } from '../lib.js';

const CC = { 1: 'United States', 7: 'Russia', 27: 'South Africa', 33: 'France', 44: 'United Kingdom', 49: 'Germany', 60: 'Malaysia', 61: 'Australia',
  64: 'New Zealand', 65: 'Singapore', 81: 'Japan', 86: 'China', 91: 'India', 92: 'Pakistan', 94: 'Sri Lanka', 880: 'Bangladesh', 965: 'Kuwait',
  966: 'Saudi Arabia', 968: 'Oman', 971: 'United Arab Emirates', 973: 'Bahrain', 974: 'Qatar', 977: 'Nepal' };
const CC_KEYS = Object.keys(CC).sort((a, b) => b.length - a.length);

/** "_91_98111_15326.zip" / "+91 98111 15326" / "WhatsApp Chat with +1 (551) 482-0671.txt" -> { phone, country, cc } */
export function phoneFromLabel(label) {
  const s = String(label || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^whatsapp chat with\s*/i, '');
  const m = s.match(/\+?\(?\d[\d\s\-()_]{6,}\d/);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  const key = CC_KEYS.find((k) => digits.startsWith(k) && digits.length - k.length >= 6);
  if (!key) {
    // 10 digits starting 6-9 and no country code: an Indian mobile number, but only a guess
    return digits.length === 10 && /^[6-9]/.test(digits) ? { phone: `+91 ${fmtNational('91', digits)}`, digits: '91' + digits, country: 'India', cc: '91', guessed: true } : null;
  }
  const national = digits.slice(key.length);
  return { phone: `+${key} ${fmtNational(key, national)}`, digits, country: CC[key], cc: key, guessed: false };
}

// "+91 9811115326" -> "+91 98111 15326" so numbers are readable in the UI
function fmtNational(cc, n) {
  if (cc === '91' && n.length === 10) return `${n.slice(0, 5)} ${n.slice(5)}`;
  if (cc === '1' && n.length === 10) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (cc === '971' && n.length === 9) return `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
  return n;
}

export const last10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

// --- brand: your own greeting usually names the house ("Thank you for reaching out to Team X") ---
const GREETING = /(?:team|greetings from|reaching out to|welcome to|thank you for (?:contacting|choosing))\s+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/g;
export function guessBrand(messages, brands) {
  const staffText = messages.filter((m) => m.role === 'staff').map((m) => m.text).join('\n');
  const businessNames = [...new Set([...staffText.matchAll(GREETING)].map((m) => m[1].replace(/[.!,]+$/, '')))];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const hay = norm(staffText);
  const hits = brands.filter((b) => b.name && hay.includes(norm(b.name)));
  if (hits.length === 1) return { code: hits[0].code, name: hits[0].name, confidence: 'high', businessName: businessNames[0] ?? hits[0].name };
  if (hits.length > 1) return { code: null, confidence: 'low', businessName: businessNames[0] ?? null, candidates: hits.map((h) => h.code) };
  return { code: null, confidence: 'low', businessName: businessNames[0] ?? null };
}

// --- vocab for hints ---
const PRODUCTS = [['lehenga', /\bleh[ae]?nga[s]?\b/gi], ['saree', /\b(saree|sari)s?\b/gi], ['sharara', /\b[gs]harara[s]?\b/gi], ['anarkali', /\banarkali[s]?\b/gi],
  ['gown', /\bgown[s]?\b/gi], ['kurta set', /\bkurta[s]?( set)?\b/gi], ['sherwani', /\bsherwani[s]?\b/gi], ['bandhgala', /\bbandh?gala[s]?\b/gi],
  ['suit', /\b(suit|salwar|sharara suit)s?\b/gi], ['blouse', /\bblouse[s]?\b/gi], ['co-ord set', /\bco-?ord[s]?\b/gi], ['jacket', /\bjacket[s]?\b/gi]];
const OCCASIONS = [['Wedding', /\b(wedding|shaadi|bride|bridal|marriage)\b/i], ['Engagement', /\b(engagement|ring ceremony|roka)\b/i], ['Sangeet', /\bsangeet\b/i],
  ['Reception', /\breception\b/i], ['Festive', /\b(diwali|eid|navratri|karva|festive|festival|puja)\b/i], ['Other', /\b(mehendi|mehndi|haldi|ceremony|function|party|birthday|anniversary)\b/i]];
const CITIES = ['Mumbai', 'Delhi', 'New Delhi', 'Gurgaon', 'Gurugram', 'Noida', 'Bangalore', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur',
  'Lucknow', 'Chandigarh', 'Surat', 'Indore', 'Dubai', 'Abu Dhabi', 'Sharjah', 'London', 'New York', 'Toronto', 'Singapore', 'Sydney', 'Melbourne', 'Doha'];
export const CITY_COUNTRY = { Mumbai: 'India', Delhi: 'India', 'New Delhi': 'India', Gurgaon: 'India', Gurugram: 'India', Noida: 'India', Bangalore: 'India', Bengaluru: 'India', Hyderabad: 'India',
  Chennai: 'India', Kolkata: 'India', Pune: 'India', Ahmedabad: 'India', Jaipur: 'India', Lucknow: 'India', Chandigarh: 'India', Surat: 'India', Indore: 'India', Dubai: 'United Arab Emirates',
  'Abu Dhabi': 'United Arab Emirates', Sharjah: 'United Arab Emirates', London: 'United Kingdom', 'New York': 'United States', Toronto: 'Canada', Singapore: 'Singapore', Sydney: 'Australia',
  Melbourne: 'Australia', Doha: 'Qatar' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUMWORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// Buying-intent keywords: what the CUSTOMER says. Positive = acting like a buyer, negative = reasons to stop chasing.
const POSITIVE = [
  ['ready to order', /\b(ready to (order|book|buy)|want to (order|book|buy)|place (the|an|my) order|book(ing)? (it|this|the)|go ahead|confirm(ed)? (the )?order|let'?s (do|proceed))\b/i],
  ['asked about payment', /\b(advance|token amount|payment (link|details)|how (do|can) i pay|pay(ing)? now|send (me )?(the )?(link|invoice))\b/i],
  ['gave sizing', /\b(measurements?|size chart|my size|fitting|try (it |them )?on|trial)\b/i],
  ['asked about delivery', /\b(when (can|will) (you|it) (deliver|ship|be ready)|delivery (date|time)|deliver(ed)? by|need it by|ready by|before (the )?(wedding|event|function))\b/i],
  ['wants to visit', /\b(visit (the )?(store|studio|boutique)|come (to|by) (the )?(store|studio|boutique)|appointment)\b/i],
];
const NEGATIVE = [
  ['just looking', /\bjust (looking|browsing|checking|exploring)\b/i],
  ['not interested', /\b(not interested|no longer interested|don'?t need|do not need|no requirement)\b/i],
  ['budget too low', /\b(too (expensive|costly|high|much)|out of (my )?budget|can'?t afford|cannot afford|beyond (my )?budget)\b/i],
  ['asked to stop', /\b(stop messaging|don'?t message|do not message|unsubscribe|wrong number)\b/i],
  ['cancelled', /\b(cancel(led|ling)?|called off|postponed|not happening)\b/i],
];
/** -> { positive: [{ name, evidence }], negative: [{ name, evidence }] }  (each keyword group counted once per chat) */
export function keywordSignals(messages) {
  const find = (list) => list.flatMap(([name, re]) => { const m = messages.find((x) => re.test(x.text)); return m ? [{ name, evidence: m.text.replace(/\s+/g, ' ').slice(0, 140) }] : []; });
  return { positive: find(POSITIVE), negative: find(NEGATIVE) };
}

const snippet = (m) => `${m.text.replace(/\s+/g, ' ').slice(0, 140)}`;

/** Budget from phrases like "budget around 2 lakh", "₹1.5L to 2L", "under $3000". Returns { min, max, currency } or null. */
export function parseBudget(text) {
  const t = String(text);
  const re = /(?:budget|price range|range|under|upto|up to|within|around|approx(?:imately)?|max(?:imum)?)\b[^\d₹$£€\n]{0,25}?(₹|rs\.?|inr|\$|usd|aed|£|€)?\s*(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|l|k|thousand|cr|crores?)?(?:\s*(?:to|-|–)\s*(?:₹|rs\.?|inr|\$|usd|aed|£|€)?\s*(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|l|k|thousand|cr|crores?)?)?/i;
  const m = t.match(re);
  if (!m) return null;
  const unitMul = (u) => (!u ? 1 : /^(lakh|lac|l)/i.test(u) ? 1e5 : /^(k|thousand)/i.test(u) ? 1e3 : 1e7);
  const num = (s) => Number(s.replace(/,/g, ''));
  const u2 = m[5] || m[3];                       // "1.5 to 2 lakh": the unit on the second number applies to both
  const a = num(m[2]) * unitMul(m[3] || (m[4] ? m[5] : null));
  const b = m[4] ? num(m[4]) * unitMul(u2) : null;
  const sym = (m[1] || '').toLowerCase();
  const currency = /₹|rs|inr/.test(sym) ? 'INR' : /\$|usd/.test(sym) ? 'USD' : /aed/.test(sym) ? 'AED' : sym === '£' ? 'GBP' : sym === '€' ? 'EUR' : (/lakh|lac|^l$|cr/i.test(m[3] || m[5] || '') ? 'INR' : null);
  const lo = b ? Math.min(a, b) : a, hi = b ? Math.max(a, b) : a;
  if (!Number.isFinite(lo) || lo < 500) return null;      // "around 2" is not a budget
  return { min: Math.round(lo), max: Math.round(hi), currency };
}

/** Day+month mentions ("14 Dec", "December 14th", "14th of december"). The year is the next such date after the chat started. */
export function dateMentions(text, refIso) {
  const out = []; const ref = refIso ? fromISO(refIso.slice(0, 10)) : new Date();
  const push = (d, mon, y) => {
    const mi = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()); const day = Number(d);
    if (mi < 0 || day < 1 || day > 31) return;
    let dt = new Date(y ? Number(y) : ref.getFullYear(), mi, day);
    if (dt.getMonth() !== mi) return;
    if (!y && dt < new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1)) dt = new Date(dt.getFullYear() + 1, mi, day);
    out.push(toISO(dt));
  };
  const M = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  for (const m of String(text).matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${M}\\b(?:,?\\s+(20\\d{2}))?`, 'gi'))) push(m[1], m[2], m[3]);
  for (const m of String(text).matchAll(new RegExp(`\\b${M}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d{2}))?`, 'gi'))) push(m[2], m[1], m[3]);
  return [...new Set(out)];
}

export function extractSignals(parsed, { fileName, brands = [] }) {
  const { messages } = parsed;
  const customerMsgs = messages.filter((m) => m.role === 'customer');
  const hintMsgs = messages.filter((m) => m.role !== 'staff' && !m.media);          // customer (or unknown) text only
  const customerText = hintMsgs.map((m) => m.text).join('\n');

  // phone / country: the file name first, then the customer's sender label
  const senderPhone = customerMsgs.find((m) => /^[+(]?\d/.test(m.sender))?.sender;
  const ph = phoneFromLabel(fileName) || phoneFromLabel(senderPhone);

  // products, occasion, quantity, cities, links
  const prod = PRODUCTS.map(([name, re]) => ({ name, n: (customerText.match(re) || []).length })).filter((p) => p.n).sort((a, b) => b.n - a.n);
  const occ = OCCASIONS.find(([, re]) => re.test(customerText))?.[0] ?? null;
  const qm = customerText.match(/\b(\d{1,2}|one|two|three|four|five|six)\s+(?:more\s+)?(?:outfits?|pieces?|lehengas?|sarees?|saris?|suits?|sets?|gowns?)\b/i);
  const quantity = qm ? (NUMWORDS[qm[1].toLowerCase()] ?? Number(qm[1])) : null;
  const city = CITIES.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(customerText)) ?? null;
  const links = [...new Set([...customerText.matchAll(/https?:\/\/[^\s)>"']+/g)].map((m) => m[0].replace(/[.,]+$/, '')))];
  const productLinks = links.filter((l) => /\/products?\//i.test(l)).map((l) => l.split('?')[0]);
  const budgetMsg = hintMsgs.find((m) => parseBudget(m.text));
  const dateHits = hintMsgs.flatMap((m) => dateMentions(m.text, parsed.firstTs).map((d) => ({ date: d, i: m.i, text: snippet(m) })));
  const nameMatch = customerText.match(/\b(?:my name is|this is|i am|i'm|name[:\s])\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b(?!\s+(?:looking|here|from|interested|planning|getting|wanting))/);

  return {
    phone: ph, brand: guessBrand(messages, brands),
    stats: {
      messages: messages.length, customerMessages: customerMsgs.length, staffMessages: messages.filter((m) => m.role === 'staff').length,
      images: messages.filter((m) => m.media === 'image').length, media: messages.filter((m) => m.media).length, links: links.length, productLinks: productLinks.length,
      firstDate: parsed.firstTs?.slice(0, 10) ?? null, lastDate: parsed.lastTs?.slice(0, 10) ?? null, customerReplied: customerMsgs.length > 0, dateOrder: parsed.dateOrder,
    },
    hints: {
      product: prod.length ? { value: prod.slice(0, 2).map((p) => p.name).join(' / '), evidence: [snippet(customerMsgs.find((m) => m.text.toLowerCase().includes(prod[0].name.split(' ')[0].slice(0, 5))) || hintMsgs[0] || { text: '' })] } : null,
      occasion: occ ? { value: occ } : null,
      quantity: quantity ? { value: quantity } : null,
      city: city ? { value: city } : null,
      budget: budgetMsg ? { ...parseBudget(budgetMsg.text), evidence: [snippet(budgetMsg)] } : null,
      dates: dateHits,
      name: nameMatch ? { value: nameMatch[1] } : null,
      productLinks: productLinks.slice(0, 10),
    },
    keywords: keywordSignals(hintMsgs),
  };
}
