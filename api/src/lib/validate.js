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
