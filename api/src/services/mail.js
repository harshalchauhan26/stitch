// Mail outbox delivery: the same idea as services/webhooks.js, for e-mail. Workflows (services/mailFlows.js) only WRITE a row,
// in the same transaction as the change they announce; this worker sends it afterwards, retries with backoff, and marks the
// mail failed (and tells the admins) when it keeps failing. So a slow or broken mail server never slows or breaks a save.
//
// Which mail server is used is decided only here, from api/.env:
//   no SMTP_HOST            dry run: the mail is printed to the console and counted as sent (development default)
//   SMTP_HOST (+ SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM)   sent through that server; works with any provider that
//                           offers SMTP (Brevo, Resend, SES, Gmail...). Needs the "nodemailer" package: npm install nodemailer
// Tests replace the sender with setMailTransport(), so they need no mail server and no package.
import { MailOutbox, Notification, User } from '../models/index.js';

export const RETRY_MINUTES = [1, 5, 30, 120];              // waits after failed attempts 1..4
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;      // the 5th failure marks the mail failed
const LOCK_MS = 2 * 60_000;

let override = null;
/** Tests: fn({ to, subject, text }, row) is called instead of a real send. Pass null to go back to normal. */
export const setMailTransport = (fn) => { override = fn; };
export const mailMode = () => (override ? 'test' : process.env.SMTP_HOST ? 'smtp' : 'dry-run');

let smtp = null;
async function smtpTransport() {
  if (smtp) return smtp;
  let nodemailer;
  try { ({ default: nodemailer } = await import('nodemailer')); }
  catch { throw new Error('SMTP_HOST is set but the "nodemailer" package is not installed (run: npm install nodemailer)'); }
  const port = Number(process.env.SMTP_PORT) || 587;
  smtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return smtp;
}

async function send(m) {
  const msg = { to: m.to, subject: m.subject, text: m.body };
  if (override) return override(msg, m);
  if (!process.env.SMTP_HOST) { console.log(`[mail dry-run] to ${m.to} | ${m.subject}\n${m.body}\n`); return null; }
  const t = await smtpTransport();
  return t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, ...msg });
}

/** Writes mail rows; nothing is sent here. Pass the transaction's session so the mail exists only if the change does. */
export async function queueMails(session, rows) {
  if (!rows.length) return [];
  return MailOutbox.insertMany(rows, session ? { session } : {});
}

async function deliver(m) {
  const attempt = m.attempts + 1;
  try {
    await send(m);
    await MailOutbox.updateOne({ _id: m._id }, { $set: { status: 'sent', attempts: attempt, sent_at: new Date(), locked_until: null, last_error: null } });
    return;
  } catch (e) {
    const error = String(e?.message ?? e).slice(0, 500);
    if (attempt < MAX_ATTEMPTS) {
      await MailOutbox.updateOne({ _id: m._id }, { $set: { status: 'pending', attempts: attempt, locked_until: null, last_error: error, next_attempt_at: new Date(Date.now() + RETRY_MINUTES[attempt - 1] * 60_000) } });
      return;
    }
    await MailOutbox.updateOne({ _id: m._id }, { $set: { status: 'failed', attempts: attempt, locked_until: null, last_error: error } });
    const admins = await User.find({ tenant_id: m.tenant_id, role: 'admin', active: true }).select('_id').lean();
    if (admins.length) {
      await Notification.insertMany(admins.map((a) => ({
        tenant_id: m.tenant_id, user_id: a._id, type: 'mail.failed', title: `Could not e-mail ${m.to} about "${m.subject}" after ${attempt} attempts: ${error}`,
        link: '/mail?status=failed',                         // opens the E-mails screen on the failed mails, where Retry is
      })));
    }
  }
}

/** Sends everything that is due. Safe to run from several processes: each mail is claimed with a lock. */
export async function drainMail({ max = 25 } = {}) {
  let n = 0;
  while (n < max) {
    const now = new Date();
    const m = await MailOutbox.findOneAndUpdate(
      { $or: [{ status: 'pending', next_attempt_at: { $lte: now } }, { status: 'processing', locked_until: { $lt: now } }] },
      { $set: { status: 'processing', locked_until: new Date(now.getTime() + LOCK_MS) } },
      { sort: { next_attempt_at: 1 }, returnDocument: 'after' },
    ).lean();
    if (!m) break;
    await deliver(m);
    n++;
  }
  return n;
}

let timer = null, running = false;
async function tick() {
  if (running) return;
  running = true;
  try { await drainMail(); } catch (e) { console.error('mail worker:', e.message); } finally { running = false; }
}
/** Runs inside the web process, like the webhook worker (Render's free plan has no background workers) */
export function startMailWorker(intervalMs = 15_000) {
  if (timer) return;
  console.log(`Mail worker on (${mailMode()})`);
  timer = setInterval(tick, intervalMs);
  timer.unref();
}
export function stopMailWorker() { clearInterval(timer); timer = null; }
/** Send right away instead of waiting for the next tick (used by Retry) */
export function kickMail() { if (timer) setImmediate(tick); }
