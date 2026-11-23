# Mailer: e-mails to the team

Stitch e-mails the brand's team when something important happens to an order. Nothing is sent to customers.

## How it works

```
a change is saved (order created, payment, customisation, shipment)
   |  in the SAME database transaction: one row per recipient is written to `mail_outbox`   (services/mailFlows.js)
   v
mail worker, every 15 seconds inside the API process                                        (services/mail.js)
   |  claims each due row, sends it, marks it sent
   |  on failure: waits 1, 5, 30, 120 minutes between tries; the 5th failure marks it failed and notifies the admins
   v
the mail server (any SMTP provider), or the console in dry-run mode
```

Because the row is written with the change, a mail exists only if the change really happened, and a slow or broken mail
server never slows or breaks a save.

## The mails

| Type | When | Where in the code |
|---|---|---|
| `order.opened` | a lead is Won and its order is created | `winLead` in `services/conversion.js` |
| `payment.due` | a payment (not a refund) is recorded or set as `pending` or `link_sent`, on a lead or an order | `services/payments.js` |
| `customisation.changed` | a spec or measurement correction becomes the current version | `createVersion` in `services/fulfilment.js` |
| `customisation.proposed` | a spec change after Spec locked waits for a pod lead | `createVersion` |
| `customisation.approved` | a pod lead or admin approves it | `approveVersion` |
| `customisation.signed_off` | the customer signs off the measurements | `signOff` |
| `dispatch.created` | a shipment is created | `createDispatch` |
| `dispatch.<status>` | a shipment's status changes (in transit, returned, failed...) | `updateDispatch` |
| `order.closed` | every shipment is delivered, so the order is Delivered (replaces the "delivered" shipment mail) | `updateDispatch` |

**Who gets them:** every active member of the teams that handle the order's brand. If no team handles the brand, the admins.

## Settings (`api/.env`)

| Variable | Meaning |
|---|---|
| `MAIL_WORKER` | `off` stops the sending loop in this process (mails are still queued). Default on |
| `SMTP_HOST` | the mail server. **Not set = dry run:** mails are printed to the API console and counted as sent |
| `SMTP_PORT` | default 587 (465 uses TLS from the start) |
| `SMTP_USER`, `SMTP_PASS` | the login, if the server needs one |
| `MAIL_FROM` | the sender, e.g. `Stitch <alerts@example.com>`. Defaults to `SMTP_USER` |
| `APP_URL` | the frontend's address. When set, each mail ends with an "Open in Stitch" link |

To send real mail, pick any provider with SMTP, run `npm install nodemailer` once in `api/`, and set the variables above.
Until then everything works in dry run.

## For admins: the E-mails screen

**E-mails** in the sidebar (admins only) lists the last 100 mails: when, to whom, the subject, which order or lead it is
about, and whether it is waiting, sent or failed.

- Filter by status (All, Failed, Waiting, Sent) and by kind of mail. The filters are in the address, e.g. `/mail?status=failed`.
- Click a row to read the exact text that was sent.
- A failed mail shows why it failed and how many times it was tried, with a **Retry** button that queues it again and
  sends it straight away.
- A mail that fails 5 times also appears as an in-app notification for every admin; clicking it opens this screen on the
  failed mails.

**Who can see it.** Only admins: the list shows every team member's address and the text of every order mail across all
brands. The sidebar link is not drawn for anyone else, opening `/mail` by hand sends them back to Home, and the API
answers 403.

The screen uses two endpoints, which can also be called directly:

- `GET /api/mail?status=failed&type=order.opened` lists the last 100 mails (both filters optional).
- `POST /api/mail/:id/retry` queues a failed mail again.

## Tests

`api/tests/mail.test.js` (needs the local MongoDB, like the other tests: `npm run mongo:dev`, then `npm test`).
It replaces the sender with `setMailTransport`, so it needs no mail server.

## Not built

- No e-mails to customers, no HTML templates, no per-user "do not e-mail me" setting.
- "Payment due" is sent when the payment is recorded or its link is sent. There is no reminder before a due date.
