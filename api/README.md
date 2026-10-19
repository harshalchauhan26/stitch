# Stitch API (v1, MongoDB)

The backend described in [docs/PLAN_v1.md](../docs/PLAN_v1.md). It replaces the earlier SQLite prototype (removed; it is still in the git history).

## Run it locally

```bash
cd api
npm install
npm run mongo:dev   # local MongoDB replica set on port 27018 (transactions need one); leaves any MongoDB on 27017 alone
npm run dev         # http://localhost:4000/api, first run creates admin@stitch.test / stitch123
npm test            # 50 API tests, each file on its own throwaway database
```

Settings are environment variables; see [.env.example](.env.example). Development needs none.

## Deploy (Render + MongoDB Atlas)

1. Create a free Atlas cluster and a database user. Under Network Access allow `0.0.0.0/0` (Render's free plan has no fixed IP); use a strong password.
2. In Render: **New > Blueprint**, pick this repo. [render.yaml](../render.yaml) sets up the API; fill in `MONGODB_URI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
3. Check `https://<service>.onrender.com/api/health` returns `{"ok":true}`, then sign in with the admin email.

Free tier: the service sleeps when idle (first request is slow) and webhook retries pause while it sleeps (PLAN §18).

## How it is organised

| Folder | What is in it |
|---|---|
| `src/models/` | Mongoose schemas for all collections (PLAN §5) |
| `src/catalogue.js` | Field catalogue and the womenswear/menswear templates, seeded into each tenant on first run |
| `src/services/` | The rules: brand onboarding, gap engine, leads, payments, Won → Order, webhooks, customisations, dispatches |
| `src/routes/` | HTTP endpoints, all under `/api` |
| `tests/` | API tests against a real MongoDB |

## Conventions

- **Auth:** `POST /api/auth/login` returns a token; send `Authorization: Bearer <token>`.
- **Scope:** a member sees the brands of every team they are in; admins see everything. Other brands' records answer 404.
- **Money** is an integer in the smallest unit (paise for INR): ₹95,000 is `9500000`.
- **Dates** without a time are `YYYY-MM-DD`; "today" and chat times use business time (`BUSINESS_TZ`, IST by default).
- **Edits** to leads and orders send the record's `version`. If someone else saved first, you get `409 version_conflict`: reload and re-apply.
- **Errors** are `{ "error": "readable message", "code"?: "...", ... }`. `409` = duplicate or conflict, `422` = blocked by a gate (with `blockers`).
- **History:** every change to a lead or order is in `GET /api/leads/:id/events` / `GET /api/orders/:id/events`, with who, which team, old and new values.

## Main endpoints

| Area | Endpoints |
|---|---|
| Org | `/brands` (+ `/check`, `/archive`, `/restore`, `/whatsapp-accounts`), `/teams` (+ `/members`), `/users`, `/me` |
| Settings | `/field-defs`, `/templates`, `/brands/:id/rules` (GET, PUT) |
| Clients | `/clients`, `/clients/:id` |
| Leads | `/leads`, `/leads/:id` (PATCH with version), `/items`, `/stage`, `/lost`, `/reopen`, `/events`, `/undo/:eventId`, `/payments`, `/issues`, `/conversations` |
| To-do | `/gaps` |
| Chats | `/conversations` (upload), `/conversations/:id` (+ `/suggestions`, `/links`) |
| Orders | `/orders`, `/orders/:id` (PATCH), `/stage`, `/events`, `/payments`, `/items/:itemId/customisations`, `/dispatches` |
| Fulfilment | `/customisations/:id/sign-off`, `/customisations/:id/approve`, `/dispatches`, `/dispatches/weekly?week=2026-W43`, `/payments` |
| Brand webhooks | `/products`, `/brands/:id/webhooks`, `/webhooks/:id` (+ `/test`, `/deliveries`), `/outbox` (+ `/redeliver`), `/notifications` |

### Brand webhook

On Won, Stitch sends `POST <brand url>` with `X-Stitch-Event: order.created`, `X-Stitch-Event-Id`, `X-Stitch-Timestamp` and
`X-Stitch-Signature: sha256=HMAC_SHA256(secret, timestamp + "." + body)`. The secret is shown once when the webhook is created.
Delivery is at least once, so receivers should ignore an `X-Stitch-Event-Id` they have already seen.
