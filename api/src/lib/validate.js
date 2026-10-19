// Small request-body helpers. Each returns the cleaned value or throws a 400 with a readable message.
import mongoose from 'mongoose';
import { badRequest } from './errors.js';

const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

export function str(v, label, { required = false, max = 500 } = {}) {
  if (!has(v)) { if (required) throw badRequest(`${label} is required`); return null; }
  if (typeof v !== 'string' && typeof v !== 'number') throw badRequest(`${label} must be text`);
  const s = String(v).trim();
  if (s.length > max) throw badRequest(`${label} must be at most ${max} characters`);
  return s;
}

export function oneOf(v, label, options, { required = false } = {}) {
  if (!has(v)) { if (required) throw badRequest(`${label} is required`); return null; }
  const hit = options.find((o) => String(o).toLowerCase() === String(v).trim().toLowerCase());
  if (!hit) throw badRequest(`${label} must be one of: ${options.join(', ')}`);
  return hit;
}

export function int(v, label, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (!has(v)) { if (required) throw badRequest(`${label} is required`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${label} must be a whole number${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}`);
  return n;
}

export function bool(v, label) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'boolean') throw badRequest(`${label} must be true or false`);
  return v;
}

export function id(v, label = 'id', { required = true } = {}) {
  if (!has(v)) { if (required) throw badRequest(`${label} is required`); return null; }
  if (!mongoose.isValidObjectId(v) || String(new mongoose.Types.ObjectId(String(v))) !== String(v)) throw badRequest(`${label} is not a valid id`);
  return new mongoose.Types.ObjectId(String(v));
}

export function ids(v, label) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw badRequest(`${label} must be a list`);
  return [...new Set(v.map(String))].map((x) => id(x, label));
}

/** YYYY-MM-DD that is a real calendar date */
export function isoDate(v, label, { required = false } = {}) {
  if (!has(v)) { if (required) throw badRequest(`${label} is required`); return null; }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw badRequest(`${label} must be a date like 2026-12-14`);
  return s;
}

// "Today" in the business's time zone, not the server's (Render runs in UTC; 00:00-05:30 IST would be yesterday)
const TZ = process.env.BUSINESS_TZ || 'Asia/Kolkata';
export const todayIso = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);

// Chat exports carry the phone's local time with no zone. Read it as business time (IST by default).
const OFFSET = process.env.BUSINESS_UTC_OFFSET || '+05:30';
export const localToDate = (isoLocal) => new Date(`${isoLocal}${OFFSET}`);

/** "2026-W43" -> { week, from: Monday, to: Sunday } as YYYY-MM-DD; no input = this week (business time) */
export function isoWeek(input) {
  let year, week;
  if (input) {
    const m = String(input).trim().match(/^(\d{4})-W(\d{1,2})$/i);
    if (!m) throw badRequest('week must look like 2026-W43');
    [year, week] = [+m[1], +m[2]];
  } else {
    const d = new Date(`${todayIso()}T00:00:00Z`);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);                 // the Thursday of this week decides the ISO year
    year = d.getUTCFullYear();
    week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  }
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
  const thursday = new Date(monday); thursday.setUTCDate(monday.getUTCDate() + 3);
  if (week < 1 || thursday.getUTCFullYear() !== year) throw badRequest(`${year} has no week ${week}`);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const ymd = (x) => x.toISOString().slice(0, 10);
  return { week: `${year}-W${String(week).padStart(2, '0')}`, from: ymd(monday), to: ymd(sunday) };
}
