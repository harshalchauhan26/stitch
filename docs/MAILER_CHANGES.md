# Mailer: what was built and what code changed

Branch: **`mailer`** (cut from `fix/v1-leftovers`). Commit: `8a8d5ef`.

This is the guide to the change itself: what it does, every file it touched and why, a worked example, and how to try,
test and undo it. For the day-to-day reference (mail types, settings, admin endpoints) see [MAILER.md](MAILER.md).

---

## 1. What it does, in one minute

Stitch now e-mails the **brand's team** when something important happens to an order:

| The team gets a mail when... | Mail type |
|---|---|
| a lead is Won and its order is created | `order.opened` |
| a payment is recorded as pending, or its payment link is sent | `payment.due` |
| a spec or measurement is corrected | `customisation.changed` |
| a spec change is waiting for a pod lead | `customisation.proposed` |
| a pod lead approves that change | `customisation.approved` |
| the customer signs off the measurements | `customisation.signed_off` |
| a shipment is created | `dispatch.created` |
| a shipment's status changes (in transit, returned...) | `dispatch.<status>` |
| every shipment is delivered, so the order is closed | `order.closed` |

- **Who gets it:** every active member of the teams that handle the brand. If no team handles the brand, the admins.
- **Customers are never e-mailed.**
- **Out of the box nothing is really sent:** without a mail server set up, each mail is printed to the API console
  ("dry run"). That is the default in development.

---

## 2. How it works

```
1. Someone saves a change            e.g. Priya moves a lead to Won
        |
2. In the SAME database transaction  services/mailFlows.js writes one row per team member
   as that change                    into the new `mail_outbox` collection (status: pending)
        |
3. The mail worker                   services/mail.js, runs every 15 seconds inside the API
        |                            picks up each pending row and sends it
        |
4a. Sent                             row is marked `sent`
4b. Failed                           tried again after 1, 5, 30 and 120 minutes;
                                     the 5th failure marks it `failed` and notifies the admins in the app
```

Two things this design guarantees:

1. **A mail exists only if the change really happened.** The row is written inside the change's transaction, so if the
   save is rolled back, the mail is gone too.
2. **A slow or broken mail server never slows or breaks a save.** Saving only writes a row; sending happens later.

This is the same pattern the brand webhooks already use (`services/webhooks.js`), so nothing new was invented.

---

## 3. A worked example

Priya (sales, Team Alpha) moves Tara Menon's Noor Atelier lead to **Won**.

**Step 1: the order is created** (this already existed). In the same transaction, `mailOrderOpened` now writes one
`mail_outbox` row for each member of Team Alpha.

**Step 2: within 15 seconds the worker sends them.** In dry run, the API console shows:

```
[mail dry-run] to priya@stitch.test | [NA] Order opened: ORD-NA-2001 for Tara Menon
Hi Priya,

ORD-NA-2001 was created from lead LD-1001 (Noor Atelier).

Customer: Tara Menon
Order value: ₹1,50,000
Paid so far: ₹50,000
Balance due: ₹1,00,000
Event date: 2026-12-05

Products:
- Lehenga x 1

Stitch
```

**Step 3: later, ops records the balance as "link sent".** The team gets `[NA] Payment due: ₹1,00,000 balance on
ORD-NA-2001`. When the money is marked **received**, no mail is sent: nothing is due any more.

**Step 4: the shipment is created, then delivered.** The team gets `Shipment created` and, when the last shipment is
delivered, one `Order closed: ORD-NA-2001 delivered` mail. The closing mail replaces the "delivered" shipment mail, so
the team is not told the same thing twice.

---

## 4. What code changed

### New files (4)

| File | What it is |
|---|---|
| `api/src/services/mailFlows.js` | **When** a mail is sent and **what it says**. One small function per workflow (`mailOrderOpened`, `mailPaymentDue`, `mailCustomisation`, `mailDispatch`, `mailOrderClosed`), plus `teamRecipients` (who gets it) and `notifyTeam` (writes the rows) |
| `api/src/services/mail.js` | **How** a mail is sent: the worker (`startMailWorker`, `drainMail`), the retry rules, and the one place that talks to a mail server. Also `setMailTransport`, which tests use to stand in for a real server |
| `api/tests/mail.test.js` | 7 tests (see section 6) |
| `docs/MAILER.md` | The reference: mail types, settings, admin endpoints |

### Edited files (8), and exactly what was added

| File | What was added | Lines |
|---|---|---|
| `api/src/models/integrations.js` | The new **`mail_outbox`** collection (`MailOutbox` model): who the mail is for, subject, body, what it is about, status, attempts, next try, last error | +22 |
| `api/src/services/conversion.js` | One call to `mailOrderOpened` at the end of `winLead` (after the order is created) | +3 |
| `api/src/services/payments.js` | A call to `mailPaymentDue` after a payment is recorded on a lead or an order, and after a payment's **status** changes (not on every small correction) | +10 |
| `api/src/services/fulfilment.js` | Calls to `mailCustomisation` (change, proposal, approval, sign-off), `mailDispatch` (shipment created or status changed) and `mailOrderClosed` (order delivered) | +9 |
| `api/src/routes/integrations.js` | Two admin endpoints: `GET /mail` (the last 100 mails, filter by status or type) and `POST /mail/:id/retry` (send a failed mail again) | +21 |
| `api/src/config.js` | One setting: `mailWorker` (off when `MAIL_WORKER=off`) | +1 |
| `api/src/server.js` | Starts the mail worker when the API starts | +2 |
| `api/.env.example` | The mail settings, all commented out (`MAIL_WORKER`, `SMTP_*`, `MAIL_FROM`, `APP_URL`) | +12 |

### What did NOT change

- **No existing collection or field changed.** The only database addition is the new `mail_outbox` collection. It is
  created automatically when the API starts.
- **No existing behaviour changed.** Every edit above is an *added* call after the existing work; the order, payment,
  customisation and shipment logic is untouched. The 103 tests that existed before still pass.
- **No new package is required.** `nodemailer` is only needed when you switch on real sending (section 5).
- **A mistake in a mail can never undo an order or payment.** If building a mail fails for any reason other than a
  database error, it is logged and skipped, and the save goes through.

---

## 5. Settings

All in `api/.env`. None are needed for dry run.

| Setting | What it does |
|---|---|
| *(nothing set)* | **Dry run:** mails are printed to the API console and counted as sent |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Send real mail through any provider that offers SMTP (Brevo, Resend, SES, Gmail...) |
| `MAIL_FROM` | The sender, e.g. `Stitch <alerts@example.com>` |
| `APP_URL` | The frontend's address. When set, each mail ends with an "Open in Stitch" link to the order or lead |
| `MAIL_WORKER=off` | Stop the sending loop in this process (mails are still queued) |

**To send real mail:** run `npm install nodemailer` once in `api/`, set the `SMTP_*` values, restart the API.
Keep the password only in `api/.env` (git ignores it), never in `.env.example`.

---

## 6. How to try it and test it

### Try it by hand (dry run, no setup)

```bash
cd api && npm run mongo:dev      # local MongoDB (once per machine restart)
cd api && npm run dev            # the console prints: Mail worker on (dry-run)
cd frontend && npm run dev       # app on http://localhost:5173
```

1. Sign in as `priya@stitch.test` / `stitch123`.
2. Open a Noor Atelier lead → **Record advance** → status **Payment link sent** → Record.
3. Watch the API console: within 15 seconds a `[mail dry-run] ... Payment due ...` block appears for each team member.
4. Move a lead to Won, correct a measurement, or create a shipment to see the other mails.

As an admin you can also list what was queued: `GET /api/mail`, or only the failures: `GET /api/mail?status=failed`.

### Automated tests

```bash
cd api && npm test                          # everything: 110 tests
cd api && node --test tests/mail.test.js    # only the mailer: 7 tests
```

The mail tests use a stand-in for the mail server, so they need no SMTP account. They check:

| Test | What it proves |
|---|---|
| payment due on a lead | a "link sent" payment mails the brand's team; receiving the money does not |
| order opened | winning a lead mails the team, with the right subject, products and order link |
| the worker | queued mails are sent once, marked sent, and never sent twice |
| customisation | a measurement correction and the customer sign-off each mail the team |
| payment due on an order, dispatch, order closed | the full run: balance link, shipment created, in transit, and one closing mail instead of a "delivered" mail |
| retries | a failing send waits and retries, then is marked failed and the admin is notified |
| admin view | only an admin sees the mail list; Retry sends a failed mail again |

One fix was made while finishing this phase: the test "payment due on an order..." failed because the test before it
changed the order and did not reload it. One line (`await reload()`) was added to the test. The product code was correct.

---

## 7. Not built yet

- No screen for the mail list (API only). This is the next phase, branch `mail-screen`.
- No e-mails to customers, no HTML templates, no "do not e-mail me" setting per person.
- No reminder before a payment's due date: "payment due" is sent when the payment is recorded or its link is sent.
- Real sending through SMTP has not been tried against a live mail server yet; only dry run and the tests.

---

## 8. Going back

The whole mailer is one commit, so it can be removed cleanly:

```bash
git revert 8a8d5ef
```

The `mail_outbox` collection stays in the database (empty or with old rows) and is simply no longer used.
