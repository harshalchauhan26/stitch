# Stitch: what was built and how it works

A plain-language guide to everything on the `feat/mongo-api-v1` branch (PR #1): the backend, the database, the rules, the screens, and the commits. For *why* things are designed this way, see [PLAN_v1.md](PLAN_v1.md). For the demo click path, see [DEMO.md](DEMO.md).

---

## 1. The product in one minute

Stitch is a CRM for an agency (Growify) that sells made-to-order fashion for several brands over WhatsApp.

- A customer messages a brand on WhatsApp. A salesperson enters them in Stitch as a **lead** (by hand for now).
- The lead moves through the **brand's own stages** (its pipeline). At each stage Stitch shows what is still missing (**gaps**), and some missing items **block** the next move (**gates**).
- When the lead reaches the brand's **won** stage, Stitch creates an **order**. The brand's team is notified, and the brand's own system can be told through a **webhook**.
- The order goes through the agency's fulfilment steps: spec, measurements, production, QC, shipping, delivery. The same steps apply to every brand.
- Every change is recorded: who made it, from which team, old value → new value.

---

## 2. Branch, PR and commits

- **Branch:** `feat/mongo-api-v1`
- **Pull request:** https://github.com/harshalchauhan26/stitch/pull/1 (into `main`)

| # | Commit | What it did |
|---|---|---|
| 1 | `966954c` | **MongoDB schemas.** All 25 collections, the unique indexes for duplicate checks, the field catalogue and the two brand templates (womenswear, menswear), plus a script to run a local MongoDB |
| 2 | `abb8a11` | **Login, brands, teams, people (M1).** Sign-in, who sees which brand, brand onboarding with duplicate checks, WhatsApp numbers, teams, users |
| 3 | `578789a` | **Rules, gaps, leads (M2, M3).** Required fields per brand and stage, the gap engine, manual lead entry, stage moves with gates, history, lost/reopen, undo |
| 4 | `ec8f20e` | **Payments and orders (M5).** Products, the payments ledger, Won → Order, brand webhooks, notifications |
| 5 | `081170e` | **Chats and issues (M4).** Upload a WhatsApp export, link it to leads; problems on leads (size, design…) |
| 6 | `c0fa1b7` | **Fulfilment (M6).** Versioned spec and measurement corrections, customer sign-off, shipments, the weekly dispatch view |
| 7 | `415eef8` | **Deploy prep (M7).** `render.yaml` and `api/README.md` |
| 8 | `b34586e` | **CEO's ask.** A custom pipeline and custom fields per brand |
| 9 | `65a108e` | **Old backend removed.** The SQLite prototype: AI chat reading, scores, old gap engine |
| 10 | `a697de6` | **Demo seed.** Three brands with their own setup, teams, people, products |
| 11 | `fb2e643` | **Frontend rewired** to the new backend for the manual-entry demo |
| 12 | `3410bf5` | **Code-review fixes.** 15 issues fixed, with tests |

The plan document itself (`docs/PLAN_v1.md`) was committed on `main` before the branch.

**After v1** (on `main`):

| Commit | By | What it did |
|---|---|---|
| `984d4c8` (PR #3) | Aaroh | **Brand setup restored.** Fields switch between Optional and Needed, can be removed and added back; name, phone and product are fixed |
| `bda9e57`, `16f1e6c` | Aaroh | **Demo sample book** of 13 customers, and the CTO stand-up script (`docs/STANDUP.md`) |
| `41a82f1` (PR #4) | Harshal | **Chat → lead with AI (Groq).** The Chats page, the model reading a chat against the brand's fields, and accept/dismiss suggestions. See §14 |
| `4656cbd` and later | Aaroh | **WhatsApp research** (`docs/WHATSAPP_AGENT.md`): Meta One gives no data; Coexistence is the official route |
| `fb68961` | Aaroh | **Review of PR #4**, one fix (see §14), and this document updated |
| `74693dc` (merge) | Harshal, reviewed by Aaroh | **Four branches:** `fix/v1-leftovers`, `mailer`, `mail-screen`, `ui-redesign`. See §20 |

---

## 3. What is in the repo

```
stitch/
├── api/                     the backend (Node.js, Express, MongoDB)
│   ├── src/
│   │   ├── models/          database schemas (what each collection stores)
│   │   ├── services/        the business rules (gaps, leads, payments, orders, ...)
│   │   ├── routes/          the web endpoints, all under /api
│   │   ├── lib/             helpers: validation, phone numbers, dates, the chat parser
│   │   ├── catalogue.js     the standard fields and the two brand templates
│   │   ├── server.js        starts the API
│   │   └── env.js           loads api/.env if present
│   ├── scripts/             dev-mongo.js (local database), seed-demo.js (demo data)
│   └── tests/               65 automatic tests against a real database
├── frontend/                the web app (React + Vite)
├── docs/                    PLAN_v1.md, DEMO.md, this file
└── render.yaml              deploy settings for Render
```

**Technology**
- Node.js 20+ with Express 5 (web server) and Mongoose 9 (MongoDB library).
- React 18 with Vite (frontend).
- MongoDB, run as a **replica set**. MongoDB only allows transactions on a replica set; locally `npm run mongo:dev` sets one up, and MongoDB Atlas is one by default.

---

## 4. Running it

```bash
cd api
npm install
npm run mongo:dev              # local MongoDB on port 27018 (your own MongoDB on 27017 is untouched)
npm run seed:demo -- --reset   # wipe and load the demo data
npm run dev                    # API on http://localhost:4000/api
cd ../frontend && npm install && npm run dev   # app on http://localhost:5173
npm test                       # (in api/) 65 tests
```

**Demo logins** (password `stitch123`):

| Login | Role | Sees |
|---|---|---|
| `admin@stitch.test` | Admin | everything |
| `priya@stitch.test` | Sales | Noor Atelier, Kesar House (Team Alpha) |
| `arjun@stitch.test` | Sales | Veda Menswear (Team Beta) |
| `meera@stitch.test` | Pod lead | all brands (both teams) |
| `ravi@stitch.test` | Ops | all brands (both teams) |

**Settings** come from environment variables, or from `api/.env`; see `api/.env.example`. Development needs none. Production requires these, and refuses to start without them:
- `MONGODB_URI`
- `JWT_SECRET`: random, at least 32 characters.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: only on the very first start.

---

## 5. Login and who can see what

- **Signing in:** `POST /api/auth/login` returns a **token**. Every other request sends it as `Authorization: Bearer <token>`. Tokens last 12 hours.
- **Passwords** are stored hashed (scrypt), never in plain text.
- **Too many wrong passwords:**
  - 8 failed tries per person per 15 minutes;
  - 40 per computer (IP address) across all accounts.
- **Roles:**

  | Role | Can do |
  |---|---|
  | Admin | everything: onboarding, teams, people, lowering the six gates |
  | Pod lead | edit pipelines, fields and rules for their brands; override a gate (with a reason); approve spec changes after Spec locked |
  | Sales, Ops, QC | work leads and orders of their brands |

- **Who sees which brand:**
  - **Teams:** a person can be in **several teams**, and a team handles **several brands**. A person sees every brand of every team they're in.
  - **Admins** see everything.
  - **Other brands' records** answer "not found", so their existence isn't even revealed.
  - **Takes effect immediately:** adding a brand to a team gives its members access at once.

---

## 6. The database (MongoDB)

**Conventions used everywhere:**
- **Company:** every document has `tenant_id`, which says which company it belongs to.
- **Timestamps:** documents have `created_at` and `updated_at`.
- **Money** is a whole number in **paise**: ₹95,000 is stored as `9500000`. The screens show and accept rupees.
- **Dates without a time** (event date, ship date) are text like `2026-12-14`, so time zones can't shift them a day. "Today" uses Indian time.
- **Readable numbers:** leads get `LD-1001`, `LD-1002`… and orders get `ORD-<brand code>-2001`.
- **Flexible fields:** leads and orders keep their details in a `fields` object. A new field, or a brand's custom field, needs no database change.

### Organisation

| Collection | Stores | Notes |
|---|---|---|
| `tenants` | the company (the agency) | |
| `users` | people: name, email, password hash, role, `memberships` (their teams) | email unique |
| `teams` | team name, `brand_ids` (brands it handles) | |
| `brands` | name, code, Instagram, website, template, **`lead_pipeline`** (its own stages), defaults, archived or active | unique per company: name, code, Instagram, website |
| `whatsapp_accounts` | a WhatsApp number and its brand | each number belongs to **one** brand, unique |

### Setup (what to capture, and when)

| Collection | Stores |
|---|---|
| `field_defs` | every field: label, type (text, number, amount, date, dropdown, yes/no…), whether it's asked once per lead, per product, about the customer or on the order, and its options and limits. `brand_id` is empty for standard fields and set for a brand's own custom fields |
| `brand_templates` | the two starting setups (womenswear, menswear): their fields and rules |
| `required_rules` | **the brand's SOP**: brand + lead or order + stage + field → optional, needed or blocking. A field with no rule is hidden for that brand. `locked` protects the six gates |
| `counters` | the running numbers for LD- and ORD- |
| `audit_log` | settings changes: rules, fields, pipelines, client edits |

### Customers and leads

| Collection | Stores | Notes |
|---|---|---|
| `clients` | one real person: phone (international format), name, email, city, WhatsApp consent, customer type | phone unique. **No brand:** one person can buy from several brands |
| `leads` | one purchase: client, brand, owner, `stage` + `stage_type` (open, won or lost), `fields`, **`items`** (products, each with its own fields), lost reason, cached gap counts, **`version`** | |
| `lead_events` | **history**: every change, old → new, who, which team, when, and why | never edited or deleted |
| `lead_issues` | problems: size, design, payment…, optionally per product, open → resolved | |
| `conversations` | an uploaded WhatsApp chat: brand (from the number), client, message counts, `lead_links` (which leads it's about) | a chat can concern several leads, and a lead several chats |
| `messages` | each chat message: time, sender, customer or staff, text | |

### Orders and fulfilment

| Collection | Stores |
|---|---|
| `products` | each brand's catalogue: SKU (unique per brand), name, base price |
| `orders` | the order: number, date, client, brand, owner, stage, **amounts** (total, paid, balance due), items, dates, addresses, production, QC, `fields`, `version` |
| `order_events` | order history, same as lead history |
| `customisations` | **one document per version** of a product's spec or measurements, with the reason, changed fields, customer sign-off, and who approved |
| `payments` | every payment: advance, balance, extra or refund; amount, status (link sent, received…), mode, transaction ref (unique) |
| `dispatches` | each shipment: courier, AWB (unique), items in it, ship-to address, dates, status, late flag, **corrections** log |

### Notifications and integrations

| Collection | Stores |
|---|---|
| `webhook_endpoints` | a brand's URL to be told about new orders, and the secret used to sign messages |
| `outbox` | messages waiting to be sent to brands (with retries) |
| `webhook_deliveries` | every send attempt and its result |
| `notifications` | in-app notifications (the bell) |

---

## 7. Brands: onboarding and setup

**Onboarding** happens in Settings → Brands, by the agency (admin):
1. Name, short code, Instagram, website, WhatsApp numbers, and the teams that handle it.
2. A **template** (womenswear or menswear) pre-fills the usual fields and the six gates.
3. A **pipeline**: the standard stages, or the brand's own.

**Duplicates are refused,** with a clear message such as *"Kesar House is already onboarded (added by Admin on 2026-10-19, handled by Team Alpha)."* Checks:
- name (ignoring case, "The", "Pvt Ltd");
- code;
- Instagram handle;
- website;
- WhatsApp number.

Other cases:
- **A similar name,** like "Noor Ateliers", asks for confirmation.
- **An archived brand** must be restored, not added again.
- **Live warning:** the form checks while you type.

**After onboarding,** the brand's setup can be changed at any time; see sections 8 and 9.

---

## 8. Pipelines (the stages)

**Lead pipeline: per brand.** Each stage has a type:
- **open:** worked through in order;
- **won:** reaching it **creates the order**, whatever it is called ("Won", "Confirmed"…);
- **lost:** closes the lead and needs a reason.

| Brand (demo) | Lead stages |
|---|---|
| Noor Atelier, Veda Menswear | New → Qualifying → Customising → Quoted → Awaiting payment → **Won** / Lost |
| Kesar House | New enquiry → Consultation → Design & trial → Quote sent → Advance pending → **Confirmed** / Dropped |

**Editing a pipeline** (Settings → Brands → pipeline):
- **Rename a stage:** its leads and rules move with it. Swaps and chains of renames are handled safely.
- **Add or reorder stages.**
- **Remove a stage:** refused while leads are in it. Once empty, its rules move to the stage before it.
- **A custom pipeline at onboarding:** the template's rules land on the stage at the same position, so the payment gate always sits just before the won stage.

**The order pipeline is the same for every brand:** Created → Spec locked → Measurements → Production → QC approval → Ready to ship → Dispatched → Delivered.

---

## 9. Fields, gaps and gates

**Fields.** Each brand decides, for each stage, which fields matter and how much:
- **Optional:** shown, never a gap.
- **Needed:** shown as a **gap** while empty.
- **Blocking:** a gap that also **stops the next move**. This is a **gate**.

**Where fields live:**
- once per lead (event date, quote amount…);
- for **each product** (neckline, waist, the brand's "Resizing allowed"…);
- on the customer (name, consent…).

**Custom fields** (Settings → Brands → "New field for <brand>"):
- **Settings:** a label, a type, once per lead or per product, a stage, and optional or needed.
- **Never blocking**, as the CEO asked.
- **Only that brand sees them.** They carry over to the order at won.

**Gaps:**
- A lead shows the gaps of its current stage and every earlier stage, **never later ones**.
- Product fields show per product, for example *"Item 2 · Saree: Neckline"*.
- **Smart conditions:**
  - Duty estimate is only needed outside India.
  - Full measurements are only needed when the size is Custom.
  - Payment details only apply once a payment link is sent.
- **The to-do list** (the Gaps page, and Home's "Close these first") lists every gap on open leads: blocking first, then the nearest event date.
- **Changing a brand's rules or fields** updates every affected lead's gaps immediately.

**The six gates** (default; only an admin can weaken them):

| Gate | Blocks | Why |
|---|---|---|
| Advance amount + Payment link sent | lead → won stage | no order without a committed customer |
| Customer sign-off (measurements) | order → Production | no stitching on wrong sizes |
| Customer approval | order → Ready to ship | no handover of an unapproved piece |
| Balance payment | order → Dispatched | no shipping before full payment |
| Address confirmed | order → Dispatched | no parcel to a wrong address |

**Some fields Stitch fills in itself,** and nobody types them:
- the advance and payment fields, from the payments;
- customer sign-off, from the measurements;
- balance payment, from the payments;
- tracking shared, from the shipments.

---

## 10. Leads: day to day

- **Adding a lead** (Add lead): brand, owner, customer phone and details, products, plus the brand's first-stage fields. Saving is always allowed; anything missing becomes a gap.
- **The customer is found by phone.**
  - **A known number** reuses the existing customer. Different details are kept, with a warning, never overwritten.
  - **A number without a country code** is taken as Indian, with a warning.
- **One lead is one purchase.** If this customer already has an open lead with this brand, Stitch asks: add the products there, or confirm it's a separate purchase.
- **Moving stages** is done **by a person**, with the "Move to…" button or by dragging a card on the board.
  - **Forward moves** pass the gates, including the gates of any skipped stages.
  - **Backward moves** need a reason.
  - **A refused move** can be pushed through by a pod lead or admin with a reason. Both the refusal and the override are recorded.
- **Lost** needs a reason (Price, Timeline, Chose competitor, No response, Other). A lost lead can be **reopened** within 90 days and goes back to where it was.
- **Won leads are read-only.** Further work happens on the order.
- **Two people editing at once:** each lead has a `version`. If someone else saved first, the second person gets "someone else changed this lead, reload and apply your change again", instead of silently overwriting.
- **History:** every change is listed: what changed (old → new), who, which team, when, and why.
- **Undo:** a field change can be undone, as long as nobody changed that field since.

---

## 11. Payments

- **Recording:** payments are recorded on the lead (the advance) or on the order (balance, extra charge, refund).
- **Statuses:** pending, link sent, received, failed, cancelled, refunded.
- **The same transaction reference can't be recorded twice;** Stitch says which lead or order already has it.
- **Payment fields are calculated from the payments,** so money is never typed twice:
  - **On the lead:** advance amount, payment link sent, payment mode, transaction ID, payment received date. A received payment counts as "link sent".
  - **On the order:** paid, balance due, and balance payment ("Paid" when nothing is due).

---

## 12. Won → Order

When a lead moves to its brand's won stage, **all of this happens together, or none of it does** (a database transaction):

1. The lead becomes won and read-only.
2. The **order** is created: its number, today's date, and the accepted quote as the order value.
3. Each product's details are split into its **spec** (version 1) and its **measurements** (version 1).
4. The lead's payments are attached to the order, giving paid and balance due.
5. History entries are written on both the lead and the order.
6. A message to the brand is queued (the **outbox**).
7. Everyone on the brand's teams gets a **notification** (the bell).

**The brand webhook** goes out after the transaction, so a slow brand system can never undo a won lead.
- **What's sent:** a `POST` to the brand's URL, with event `order.created`, the order, its items and amounts, and the client's name and city.
- **Personal data:** phone, email and address are left out unless the brand's webhook allows them.
- **Signing:** every message is signed (HMAC-SHA256), so the brand can check it came from Stitch.
- **Retries:** after 1 min, 5 min, 30 min, 2 h and 6 h. After 6 failed attempts, admins are notified and can **Redeliver**.

---

## 13. Orders: to the customer's door

- **Moving stages:** as with leads, a person moves the order, gates apply, moving back needs a reason, and a pod lead can override.
- **Spec and measurements, with corrections:**
  - **Versions:** a correction creates a **new version** with a reason. The old version is kept and marked "replaced".
  - **Customer sign-off:** recorded on the current measurements. It satisfies the Production gate only when **every product** is signed off. A later correction needs a new sign-off.
  - **After Spec locked,** a spec change from sales waits as a **proposal** until a pod lead approves it. Approving applies only that proposal's changes, so two approved proposals don't cancel each other.
- **Shipping:**
  - **Create the shipment** (courier, AWB, date) to move the order to **Dispatched**. It is refused until the balance is paid and the address is confirmed.
  - **Split shipments** are supported.
  - **The late flag** is set when shipped after the promised date.
  - **Changing a shipment detail that was already set** (AWB, courier, address…) is a **correction** and needs a reason.
  - The order becomes **Delivered** when every shipment is delivered and every product has shipped.
  - **No shortcut:** Dispatched and Delivered can't be reached by a manual move.
- **The weekly dispatch view (Dispatches page) shows:**
  - shipments per brand and status;
  - late ones;
  - every correction that week (shipments, specs, measurements) with who and why.

---

## 14. Chats and issues

- **Chat upload** (now on the **Chats** page):
  - **How it's read:** a WhatsApp export is read by code (no AI) and stored as messages, with staff and customer told apart.
  - **Brand and customer:** the brand comes from the WhatsApp number it was exported from. The customer comes from the number in the file name, or is typed in.
  - **Duplicates:** the same file twice is refused. A longer export of the same chat only adds the new messages.
  - **Linking:** a person links the chat to one or more leads of that brand; Stitch never guesses.
- **Ambiguous chat dates** (for example 05/06) are read as day/month, the Indian format. This can be changed with `CHAT_DATE_ORDER`.
- **Issues** are size, design, payment and similar problems. They can belong to a product, run open → resolved (a resolution is required), and are recorded in the lead's history.

### Reading a chat with AI (Harshal, PR #4)

The full flow is in `docs/EXTRACTION_FLOW.md`.

**What it does:**
1. On the **Chats** page, upload a WhatsApp export, then click **Read chat**. You either start a new lead or fill an open lead of that customer.
2. Stitch sends Groq (Llama 3.3 70B) the following:
   - the rules (`api/src/prompts/extraction.md`);
   - **that brand's own fields**, built from its setup, so custom fields are included and hidden fields are never offered;
   - what Stitch already knows about the customer and lead;
   - the product catalogue;
   - the numbered chat.
3. The model answers in JSON. Each value comes with the message number, a confidence score and a short quote.
4. Every value goes through **the same checks as a manual edit**:
   - values that pass become **suggestions**;
   - values that don't fit become **exceptions**, with the reason.
5. A person **accepts or dismisses** each suggestion. Accepted values are saved through the normal lead edit, so the version check, History (pointing at the source message), gap recount and undo all apply.

**Safe by design:**
- The model never writes to a lead. Only a new lead's empty shell and its products are created without a click.
- All refusals (access, wrong brand, closed lead, existing open lead) happen **before** the model is called, so a refusal costs nothing.
- The lead is created only **after** the model answers, so a failed call leaves nothing behind.
- Payment fields and the phone can never be filled from a chat.

**Code:** `services/extraction.js` (the logic), `services/llm.js` (the only file that calls Groq, so switching provider is a one-file change), `routes/extraction.js`, the `extractions` collection, and on the frontend `pages/Chats.jsx` and `components/Suggestions.jsx`.

**Endpoints:**
- `POST /conversations/:id/extract`
- `GET /conversations/:id/extractions`
- `GET /leads/:id/extractions`
- `POST /extractions/:id/accept`
- `POST /extractions/:id/dismiss`

**Set up:** put `GROQ_API_KEY` in `api/.env`. Without it, uploads still work but **Read chat** answers 503.

**Review (16 Nov 2026):**
- Reviewed by Aaroh: all 83 tests pass and the frontend builds.
- **One fix:** if the newest message alone was longer than the 8,000-character budget (for example a pasted brief), the model was sent an empty chat. It now gets the start of that message. A test covers it.

**Limits:**
- **Long chats:** only the newest 8,000 characters are read, because of Groq's free tier of 8,000 tokens a minute. Raise `EXTRACT_MAX_CHARS` and `EXTRACT_MAX_TOKENS` after upgrading. Two reads within a minute can hit the limit.
- **Customer data:** names and numbers go to Groq unmasked. This was a decision; it should be confirmed with the business.
- **Manual export:** each chat is exported and uploaded by hand. Live chats need WhatsApp Coexistence (`docs/WHATSAPP_AGENT.md`).
- **Products added to an existing lead:** accept the product, then read again to fill its details.
- **A new read dismisses the earlier pending suggestions** for that lead.
- **No locking on Accept.** The buttons disable while a request runs, but two people accepting the same run at the same moment could add a suggested product twice.
- **Not tested live here:** no Groq key on this machine, so only the tests (with a mocked model) and the build were run.

---

## 15. The screens (frontend)

| Screen | What it does |
|---|---|
| **Home** | KPIs (open leads, my gaps, blocking gaps, events in 30 days, orders in progress, balance to collect, shipped this week) and "Close these first" |
| **Leads** | with a brand selected: a board of **that brand's pipeline** (drag to move). With "All brands": a table |
| **Lead panel** | stage strip, Move / Mark lost / Reopen, gaps, customer, fields by stage (brand fields marked), products with their fields, payments, issues, history |
| **Add lead** | manual entry, including the brand's first-stage fields |
| **Orders** | board of the order stages |
| **Order panel** | money, products with spec and measurements (correct, sign off, approve), order fields by stage, payments, shipments, "from the lead", history |
| **Gaps** | the to-do list (filters: blocking or needed, mine) |
| **Dispatches** | the weekly view, with previous and next week |
| **Settings** | Brands (onboard, pipeline editor, fields by stage, new brand fields), Teams, People |

**Top bar:** brand switcher, search (name, phone, LD-number), dark mode, notifications, Add lead.

---

## 16. API endpoints (all under `/api`)

| Area | Endpoints |
|---|---|
| Login | `POST /auth/login`, `GET /me` |
| Brands | `GET/POST /brands`, `GET /brands/check`, `GET/PATCH /brands/:id`, `/archive`, `/restore`, `/whatsapp-accounts` |
| Brand setup | `GET/PUT /brands/:id/pipeline`, `GET/POST /brands/:id/fields`, `PATCH /brands/:id/fields/:key`, `GET/PUT /brands/:id/rules`, `GET /field-defs`, `GET /templates` |
| Teams, people | `/teams`, `/teams/:id/members`, `/users` |
| Clients | `/clients`, `/clients/:id` |
| Leads | `/leads`, `/leads/:id` (edit with `version`), `/items`, `/stage`, `/lost`, `/reopen`, `/events`, `/undo/:eventId`, `/payments`, `/issues`, `/conversations` |
| To-do | `/gaps` |
| Orders | `/orders`, `/orders/:id`, `/stage`, `/events`, `/payments`, `/dispatches`, `/items/:itemId/customisations` |
| Fulfilment | `/customisations/:id/sign-off`, `/customisations/:id/approve`, `/dispatches`, `/dispatches/weekly?week=2026-W43` |
| Payments | `/payments`, `PATCH /payments/:id` |
| Chats, issues | `/conversations`, `/conversations/:id/links`, `/conversations/:id/suggestions`, `/issues` |
| Chat → lead (AI) | `POST /conversations/:id/extract`, `GET /conversations/:id/extractions`, `GET /leads/:id/extractions`, `POST /extractions/:id/accept`, `/dismiss` |
| Products, webhooks | `/products`, `/brands/:id/webhooks`, `/webhooks/:id/test`, `/webhooks/:id/deliveries`, `/outbox`, `/outbox/:id/redeliver`, `/notifications` |

**Errors** look like `{ "error": "readable message", "code": "..." }`:
- `400` means invalid input;
- `401` means not signed in;
- `403` means not allowed;
- `404` means not found or not your brand;
- `409` means a duplicate, or someone else saved first;
- `422` means blocked by a gate (the list of what's missing is included).

---

## 17. Tests and checks

- **143 automatic tests** (`npm test` in `api/`; 65 at v1, the rest from chat reading, Shopify, the mailer, enquiries and Harshal's numbered pipeline tests in `docs/TESTS.md`) run against a real MongoDB. Each test file uses its own throwaway database. They cover:
  - onboarding and duplicates;
  - access per team;
  - leads, gaps and gates;
  - simultaneous edits;
  - undo;
  - payments;
  - Won → Order;
  - webhooks (signature, retries, redeliver);
  - corrections, sign-off and approvals;
  - shipments and the weekly view;
  - custom pipelines and fields;
  - every code-review fix.
- **The full demo journey was also run in a headless browser**, with no unexpected errors.

---

## 18. The code review (commit 12)

The whole branch was reviewed before the PR. Fixed:

- **Stage renames:** renaming stages in a chain or swap could merge leads into the wrong stage.
- **To-do list:** it could miss new gaps after a settings change.
- **Production secret:** the public development secret would have been accepted.
- **Spec approvals:** approving two spec changes lost the first one.
- **Delivery:**
  - an order could become Delivered with a product never shipped;
  - an order could be dragged to Delivered with no shipment.
- **Smaller fixes:**
  - payment notes and link-expiry edits weren't saved;
  - "Redeliver" sent nothing;
  - `TRUST_PROXY=0` was ignored;
  - login limits now also apply per IP;
  - `.env` was ignored;
  - a mistyped amount cleared the field;
  - the lead's phone showed empty;
  - payment dates used UTC instead of Indian time.

---

## 19. Not done yet / known limits

- **AI chat reading is manual.** A chat export is uploaded and read on request (§14); there's no live WhatsApp feed yet.
- **No WhatsApp sending.** "Ask on WhatsApp" and "Send link" are not built.
- **Shopify: products only.** Active products sync into Stitch (§20); orders aren't written back to Shopify yet.
- **No automatic stage moves.** A person always moves the stage.
- **No priority or win-probability score.**
- **Deployed by Harshal:** the frontend on Vercel and the API on Render's free tier, which sleeps, so the first load takes about 30 seconds.

---

## 20. Harshal's branches, merged 23 Nov 2026

Built by Harshal from 10 to 16 Nov. Reviewed and merged by Aaroh: 143 tests pass and the frontend builds. No changes were needed.

| Branch | What it added |
|---|---|
| `fix/v1-leftovers` | **Products screen** and **Shopify product sync**. **Removing a stage that has leads** now moves them to a chosen stage. A Yes/No "No" counts as filled unless the field is a gate. Automatic stage moves proposed (`docs/AUTO_STAGE_MOVES.md`, doc only) |
| `mailer` | **Emails to the brand's team** for: order opened, payment due, spec and measurement changes, shipments, order closed |
| `mail-screen` | An **Emails** screen for admins: what was sent, what failed, and Retry |
| `ui-redesign` | A public **landing page** (`/landing/`) with a demo-request form, the app restyled (green palette, Hanken Grotesk and Cormorant fonts, new logo), and numbered pipeline tests |

**How each one works:**
- **Shopify sync:**
  - Products → **Sync from Shopify**, for admins and pod leads.
  - It reads only the brand's **active** products, one Stitch product per Shopify product (SKU = the first variant's SKU, price = the lowest variant price).
  - It's safe to run again. A product removed from Shopify is switched off, never deleted.
  - A hand-typed product with the same SKU is linked instead of duplicated.
  - Synced products' name, SKU, price and status can only be changed in Shopify.
  - Set up per brand in `api/.env` with `SHOPIFY_<CODE>_DOMAIN` and `SHOPIFY_<CODE>_TOKEN` (the token only needs read_products).
- **Emails:**
  - Queued in the same transaction as the change, then sent by a worker in the API process, with retries at 1, 5, 30 and 120 minutes.
  - After 5 failures the mail is marked failed and admins get a notification.
  - Without `SMTP_HOST` the emails are only printed to the console. To send for real, install `nodemailer` and set the SMTP variables (`docs/MAILER.md`).
  - Customers are never emailed.
- **Landing page form:**
  - `POST /api/enquiries` is open to anyone.
  - It's limited to 5 requests per hour per IP and has a hidden spam trap.
  - Admins read the requests with `GET /api/enquiries`.

**Review notes (nothing blocking):**
- **Shopify tokens:** they live in `api/.env`, so adding a brand's store needs a redeploy. A per-brand settings screen can come later; only `services/shopify.js` would change.
- **Enquiries:** they aren't tied to a company account, so every admin sees all of them. That's fine while there is one agency.
- **Real emails:** to send them on Render, `nodemailer` has to be added to `api/package.json` (it isn't installed by default).
- **Unused packages:** the old font packages (Fraunces, IBM Plex) are still in `frontend/package.json` but no longer imported, and can be removed.

---

## 21. Live WhatsApp messages (the receiver), 23 Nov 2026

This lets a brand number connected through **Coexistence** (`docs/WHATSAPP_AGENT.md`) send its chats into Stitch by itself, with no export and upload. The team keeps using the WhatsApp Business app.

**How it works:**
1. The provider (or Meta) calls `POST /api/whatsapp/webhook` for every message.
2. Stitch checks the caller: Meta's signature (`WA_APP_SECRET`), or a secret key in the URL (`WA_WEBHOOK_KEY`). With neither set, every call is refused.
3. The raw call is saved in `wa_inbound`, and Stitch answers 200 straight away, so nothing is lost if processing fails.
4. A worker processes the saved calls one at a time, oldest first:
   - **The brand** is found from the WhatsApp number. Meta's phone-number ID is remembered for next time.
   - **The customer** is found by phone, or created with their WhatsApp profile name. A typed name is never overwritten.
   - **The chat** is the same conversation a chat upload would use (one per brand number and customer), so the Chats page and the **AI chat reading** work on it unchanged.
   - **What's stored:**
     - customer messages;
     - replies the team sends from the phone (`smb_message_echoes`), as staff;
     - old chats (`history`).
   - **Ordering:** old chats arriving later are put back in time order.
   - **Media:** photos, voice notes and documents are stored as their type plus caption. The files aren't downloaded.
   - **Ignored:** reactions, delivery receipts and contacts sync are skipped and counted.
5. **Repeats are harmless:** a message is stored once per WhatsApp message ID.
6. **Unknown numbers:** a call for a number Stitch doesn't know is kept as **unmatched**. Add the number to the brand, then retry it.

**Endpoints:**
- `GET /api/whatsapp/webhook`: Meta's one-time check.
- `POST /api/whatsapp/webhook`: incoming calls.
- `GET /api/whatsapp/inbound`: admin only; the latest calls, with what happened to each and the raw payload.
- `POST /api/whatsapp/inbound/:id/retry`: admin only.

**Code:**
- `services/whatsappInbound.js`
- `routes/whatsapp.js`
- the `wa_inbound` collection
- `whatsapp_accounts.wa_phone_number_id`, `messages.wamid`, and `conversations.source = 'whatsapp'`

**Tests:** 10 cases in `tests/whatsapp-inbound.test.js` (153 in total, all passing):
- signatures and URL keys;
- Meta's verify check;
- repeats;
- staff replies;
- old chats arriving late;
- unmatched numbers then retry;
- access per team.

**Not done yet / to check in the pilot:**
- **The payload shapes follow Meta's Cloud API docs** but haven't been seen from a real number yet. The raw payloads are kept so the first real ones can be checked.
- **Media files aren't downloaded**, only noted.
- **The AI reading isn't run automatically** on new messages. A person still clicks **Read chat**.
- **Live chats aren't listed on the Chats page yet.** It only shows the chat you just uploaded. A list of live chats per brand is the next UI step.
- **Chat exports and live messages may overlap.** If the same chat is both uploaded and received live, the same messages can appear twice, because uploads and live messages are deduplicated differently.
- **Render's free tier sleeps,** so the first call after a quiet spell is slow. Meta retries, but use a paid instance for real numbers.
