// Normalised keys for duplicate checks (PLAN §4.2) and phone numbers in E.164.
import { badRequest } from './errors.js';

/** "The Noor Atelier Pvt. Ltd." -> "noor atelier" */
export function brandNameKey(name) {
  return String(name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^the\s+/, '')
    .replace(/\s+(pvt|private)?\s*(ltd|limited|llp)$/, '')
    .replace(/\s+(pvt|private)$/, '')
    .trim();
}

/** "@Noor.Atelier", "https://instagram.com/noor.atelier/?hl=en" -> "noor.atelier" */
export function instagramKey(handle) {
  const s = String(handle || '').trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return s || null;
}

/** "https://www.NoorAtelier.com/shop?x=1" -> "nooratelier.com" */
export function websiteKey(url) {
  const s = String(url || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#:].*$/, '');
  return s || null;
}

/** Edit distance, for "Noor Ateliers" looks like "Noor Atelier" warnings */
export function editDistance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Country calling codes (longest match first), same list as the prototype's chat parser
const CC = { 1: 'United States', 7: 'Russia', 27: 'South Africa', 33: 'France', 44: 'United Kingdom', 49: 'Germany', 60: 'Malaysia', 61: 'Australia',
  64: 'New Zealand', 65: 'Singapore', 81: 'Japan', 86: 'China', 91: 'India', 92: 'Pakistan', 94: 'Sri Lanka', 880: 'Bangladesh', 965: 'Kuwait',
  966: 'Saudi Arabia', 968: 'Oman', 971: 'United Arab Emirates', 973: 'Bahrain', 974: 'Qatar', 977: 'Nepal' };
const CC_KEYS = Object.keys(CC).sort((a, b) => b.length - a.length);

/**
 * "+91 98111 15326" | "919811115326" | "9811115326" -> { e164: "+919811115326", country, guessed }
 * A 10-digit number starting 6-9 with no country code is taken as Indian, and marked as a guess.
 * Returns null when it does not look like a phone number.
 */
export function parsePhone(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  if (!raw.startsWith('+') && !raw.startsWith('00') && digits.length === 10 && /^[6-9]/.test(digits)) {
    return { e164: `+91${digits}`, country: 'India', guessed: true };
  }
  const d = raw.startsWith('00') ? digits.slice(2) : digits;
  const cc = CC_KEYS.find((k) => d.startsWith(k) && d.length - k.length >= 6);
  return { e164: `+${d}`, country: cc ? CC[cc] : null, guessed: false };
}

export function requirePhone(input, label = 'Phone') {
  const p = parsePhone(input);
  if (!p) throw badRequest(`${label} must be a phone number with 8 to 15 digits, e.g. +91 98111 15326`);
  return p;
}

/** The customer's number from an export's file name or sender label: "WhatsApp Chat with +91 98111 15326.txt" */
export function phoneFromLabel(label) {
  const s = String(label || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^whatsapp chat (with|-)\s*/i, '');
  const m = s.match(/\+?\(?\d[\d\s\-()_]{6,}\d/);
  return m ? parsePhone(m[0].replace(/_/g, ' ').trim()) : null;
}
