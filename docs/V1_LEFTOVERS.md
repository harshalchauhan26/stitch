# v1 leftovers: what was changed, how it works, and how to try it

The v1 known-limits list (`IMPLEMENTATION.md` §19) had seven open items. This document covers the work done on them on the branch
**`fix/v1-leftovers`** (cut from `Harshal`): what each change does, which files it touches, worked examples, how to test it, and
what is still open. Nothing here is pushed, and the branch is local until you say so.

For the chat-reading feature that sits underneath (Groq), see [wp-groq.md](wp-groq.md). For the original design see
[PLAN_v1.md](PLAN_v1.md).

---

## 1. At a glance

| # | Item from the known-limits list | Status | Commit |
|---|---|---|---|
| 1 | A Yes/No field answered "No" still counted as a gap | **Done** | `e98d962` |
| 2 | Removing a pipeline stage that has leads was refused | **Done** | `682085a` |
| 3 | No Products screen (and products had to be typed in) | **Done**, with a Shopify sync | `e28d430` |
| 4 | No automatic stage moves | **Proposal written and decisions made. Not built yet** | `9f8415f` |
| 5 | Lead stage and hot/warm/cold suggestions from chats | Not started (a plan document is next) | |
| 6 | Production and QC tracking (v1.1) | Not started (a design document is next) | |
| 7 | Not deployed yet | Not started (a deploy checklist document is next) | |

Branch history (newest first):

```
e28d430  Add a Products screen and a Shopify product sync
682085a  Move the leads when removing a pipeline stage that still has some
e98d962  Count a "No" answer on an ordinary Yes/No field as filled
9f8415f  Propose automatic stage moves (docs only)
41a82f1  Add WhatsApp chat to lead extraction with Groq        <- the Harshal branch this started from
```

**Tests:** the original `main` suite is 66 tests. The branch now runs **103**, all passing, and the 66 originals still pass
unchanged against the new code (checked by running `main`'s test folder against the current source).

---

## 2. What did NOT change

You asked for the core to stay as it is. Compared with `main`:

- **Database schema:** no existing collection or field changed. The only schema addition on the whole `Harshal` + `fix/v1-leftovers`
  line is the new `extractions` collection (from the chat feature). Fixes 1 to 3 add **no** collection and **no** field.
- **Field definitions:** `catalogue.js` (fields, templates, the six gates) is untouched.
- **Editing code:** `parseFieldValue`, `valueOf`, the validators, `updateLead`, `moveStage`, `commitWrite` and the payment, order
  and fulfilment services are untouched.
- **One deliberate change to core logic:** `isFilled` in `lib/fields.js` (fix 1). It affects what shows as a *gap*, not what can be
  saved. `git revert e98d962` removes it cleanly.

---

## 3. Fix 1: a "No" answer on a Yes/No field

### The problem
A Yes/No field only counted as filled when it was "Yes". A brand's own question such as **"Fabric swatches sent"** therefore kept
showing as a gap even after the team had answered "No".

### The rule now
A Yes/No field counts as filled on "Yes", and also on "No", **unless it is a gate**. A gate is where "No" means "not done yet",
so it must stay a gap until "Yes". A field is a gate if any of these is true:

1. it is one of the six gate fields (`GATE_FIELDS` in `catalogue.js`);
2. Stitch fills it in by itself (`computed`): customer sign off, payment link sent, tracking shared;
3. it has its own `blocks_move_to`;
4. the brand set its rule to **Blocking** in Set Required.

### Example A: an ordinary field (this is what changed)
Veda Menswear has its own Yes/No field "Fabric swatches sent", set as Needed at Qualifying.

| Value in the field | Before | After |
|---|---|---|
| empty | gap | gap (nobody answered) |
| Yes | filled | filled |
| **No** | **gap (wrong)** | **filled**: the team checked, the answer is "No" |

### Example B: a gate (this did NOT change)
Vikram's order is at Ready to ship and **Address confirmed** is "No":

| Value | Before and after |
|---|---|
| No | still a **blocking gap**. "Create shipment" is refused with "Address confirmed is missing" |
| Yes | filled; the shipment goes through |

The same holds for Customer approval, Customer sign off (a computed "No" means a product is unsigned), Payment link sent and
Tracking shared.

### Which fields are treated which way

| Gate: "No" stays a gap | Information: "No" counts as answered |
|---|---|
| `customer_approval`, `address_confirmed` (in the gate list) | A brand's own Yes/No fields, e.g. "Fabric swatches sent" |
| `customer_sign_off`, `payment_link_sent`, `tracking_shared` (computed by Stitch) | |
| any field with `blocks_move_to`, or any field a brand sets to Blocking | |

Every shared Yes/No field in the catalogue is a gate or computed, so in practice **only brand custom Yes/No fields change**.

### Files
`api/src/lib/fields.js` (the rule, in `isFilled` and a small `isGate` helper), `api/src/services/gaps.js` (passes the rule's level
to `isFilled` in its two places), `api/src/services/extraction.js` (the chat coverage report uses the same rule).

### Tests (10)
`api/tests/gaps-yes-no.test.js` (9, no database): empty / Yes / No on an ordinary field; every gate staying a gap on "No"; computed
fields; `blocks_move_to`; a field set to Blocking; other field types unaffected. Plus one end-to-end test in
`api/tests/brandconfig.test.js` through the real API: the gap is there when empty, gone on "No" and on "Yes", and back when cleared.

---

## 4. Fix 2: removing a pipeline stage that still has leads

### The problem
In Settings → Brands you can rename, add, reorder and remove a brand's lead stages. Removing a stage that still had leads was
**refused** ("Move these leads before removing their stage"), so a busy stage meant opening every lead by hand.

### How it works now
The pipeline save accepts an optional **`move_leads_to`**: the name of an *open* stage that stays in the new pipeline (a stage
renamed in the same save is given by its new name). In **one transaction**:

1. every open lead in a removed stage is moved to that stage, through the normal checked write (`commitWrite`);
2. each moved lead gets its **own history entry**: type `stage.moved`, source `system`, reason
   `Stage "X" was removed from the pipeline`, with the admin as the actor;
3. a **lost** lead that would have reopened into the removed stage is pointed at the new stage;
4. the stage's rules move to the nearest kept stage (as before) and the stage is removed;
5. the move is noted in the settings log (`pipeline.changed`, `data.moved`);
6. gap counts are recounted by the route right after the commit (`services/recount.js`), as for any pipeline change.

If anything fails, nothing changes: no lead is moved and the stage is not removed.

### Example
Kesar House's stages: New enquiry, Consultation, **Design & trial**, Quote sent, Advance pending, then Confirmed or Dropped.
Pooja Nair's lead is in Design & trial. An admin removes that stage.

**Before:** Save stages gives `409 stage_not_empty`: *Move these leads before removing their stage: 1 in Design & trial*.

**Now:** the same refusal opens a box on the Settings screen:

> 1 lead in "Design & trial" would be left without a stage. Move them to: **[Consultation ▾]**  [Move leads and save]  [Cancel]

The API call it makes:

```json
PUT /api/brands/:id/pipeline
{ "stages": [ {"name":"New enquiry","type":"open"}, {"name":"Consultation","type":"open"}, {"name":"Quote sent","type":"open"},
              {"name":"Advance pending","type":"open"}, {"name":"Confirmed","type":"won"}, {"name":"Dropped","type":"lost"} ],
  "move_leads_to": "Consultation" }
```

Pooja's History now shows:

```
Moved · Admin, Team Alpha · just now   [auto]
   Stage: Design & trial → Consultation
   Reason: Stage "Design & trial" was removed from the pipeline
```

### What is refused

| Request | Result |
|---|---|
| remove a busy stage, no `move_leads_to` | the old `409 stage_not_empty` (the response lists each stage and its lead count) |
| `move_leads_to` = the stage being removed | 400 |
| `move_leads_to` = a **won** or **lost** stage | 400: those create an order or need a reason |
| `move_leads_to` = a stage that does not exist | 400 |
| a salesperson | 403 (as before: only admins and pod leads change a pipeline) |

A refused save moves nobody.

### Good to know
- Moving leads this way does **not** check gates, the same as a stage rename does not. It is an admin restructuring action and every
  move is logged. If the target is a *later* stage, the lead's gap list simply grows to show what that stage needs.
- One target covers every removed stage in the same save.

### Files
`api/src/services/brandConfig.js` (the logic), `api/src/routes/settings.js` (passes `move_leads_to`),
`frontend/src/api/http.js`, `frontend/src/pages/Settings.jsx` (the "move the leads" box).

### Tests (3), in `api/tests/brandconfig.test.js`
1. without a target it is still refused; each wrong target is refused; nothing moves; sales get 403;
2. leads move in one go, each with its own `system` history entry; leads of kept stages stay; the list counts match the live gaps; a lost
   lead reopens into the new stage; no rule is left on the removed stage;
3. the target can be a stage renamed in the same save, and the settings log records the move.

---

## 5. Fix 3: Products screen and Shopify sync

### The problem
The product catalogue worked in the API (and demo brands had products) but there was no screen for it, and every product had to be
typed in. Each brand also has its own Shopify store, where its real products already live.

### What was built

**The Products page** (sidebar **Products**, shortcut `g` then `p`):

```
Products                         [Sync from Shopify]  [+ Add product]
12 products in Noor Atelier. Leads and orders pick from this list.
[ Search name or SKU ]   [ ] Show switched-off products

SKU          Product                              Brand  Category  Price      Lead time
NA-LEH-021   Bridal lehenga · crimson zardozi     NA     lehenga   ₹2,45,000  60 d      [Edit] [Switch off]
NA-LEH-014   Bridal lehenga · ivory   [Shopify]   NA     lehenga   ₹1,800     45 d
```

- It follows the top-bar **brand switcher**, so people only see the brands of their teams.
- **Admins and pod leads** can add, edit, switch off and switch on hand-typed products, and run the sync. Prices are typed in rupees
  and stored in paise, like everywhere else. **Sales** see a read-only list.
- Products that come from Shopify show a **Shopify** badge and have **no buttons**: Shopify owns them.
- Switching a product off hides it from the pickers (Add lead, the lead drawer, chat reading). It is never deleted, so old leads and
  orders keep their link.

**The Shopify sync**: `POST /brands/:id/products/sync` (admins and pod leads). The Shopify call is isolated in
`services/shopify.js`, the logic in `services/productSync.js`.

How one Shopify product becomes one Stitch product:

| Stitch field | Taken from Shopify |
|---|---|
| name | the product title |
| SKU | the first variant that has a SKU, else the product **handle** (upper-cased) |
| price | the **lowest** variant price, converted to paise |
| category | the product type |
| picture | the main image |
| lead time | the brand's default production days, set only when the product is first created |
| currency | the store's currency, else the brand's default |

What a sync does, in order:

1. fetches the brand's **active** products from its store;
2. **creates** products Stitch does not have, **updates** changed ones, counts unchanged ones;
3. **switches off** a synced product that is no longer active in Shopify (never deletes), and switches it back on if it returns;
4. **adopts** a hand-typed product with the same SKU (links it to Shopify) instead of creating a duplicate;
5. leaves every other **hand-typed** product alone;
6. reports what it could **not use** in an `exceptions` list with a reason, and still syncs the rest.

It is safe to run again and again: a second run in a row changes nothing.

### Example
Shopify returns:

```json
{ "id": "gid://shopify/Product/1", "title": "Bridal lehenga · ivory", "handle": "bridal-lehenga-ivory", "category": "lehenga",
  "variants": [ { "sku": "",            "price": "2500.00" },
                { "sku": "NA-LEH-014",    "price": "1800.50" },
                { "sku": "NA-LEH-014-XL", "price": "2000"    } ] }
```

Stitch stores: name "Bridal lehenga · ivory", SKU **NA-LEH-014** (the first variant with a SKU), price **₹1,800.50** = 180050 paise
(the lowest), category lehenga, tagged Shopify.

The sync's answer:

```json
{ "created": 5, "updated": 1, "unchanged": 12, "deactivated": 1,
  "exceptions": [
    { "code": "duplicate_sku", "shopify_id": "gid://shopify/Product/5", "title": "Dupatta B", "sku": "DUP-1",
      "reason": "SKU DUP-1 is already used by another Shopify product in this sync" },
    { "code": "bad_price", "shopify_id": "gid://shopify/Product/6", "title": "Sharara", "sku": "NA-P-6",
      "reason": "No variant has a readable price" } ] }
```

Exception codes: `no_title`, `no_sku`, `bad_price`, `duplicate_sku`. A product that raises an exception is **not** switched off just
because this run could not use it.

### Hand edits to a Shopify product are refused
`PATCH /products/:id` on a synced product answers `409 shopify_managed` if it changes the name, SKU, category, price, images or
status: the next sync would overwrite the change. Stitch's own details (lead time, customisable fields) can still be edited.

### Connecting a store (not needed to try the rest)
Each brand has its own store. The details come from `api/.env`, named by the brand's code (here brand `NA`):

```
SHOPIFY_NA_DOMAIN=noor-atelier.myshopify.com      # must be a *.myshopify.com address
SHOPIFY_NA_TOKEN=...                              # an Admin API token with only the read_products scope
SHOPIFY_API_VERSION=2025-01                       # optional
```

Until a brand has both, **Sync from Shopify** answers `503 shopify_not_connected`: *Shopify is not connected for Noor Atelier yet
(set SHOPIFY_NA_DOMAIN and SHOPIFY_NA_TOKEN)*. A domain that is not a `*.myshopify.com` address is refused before any call is made,
so a typo can never send the token elsewhere. Moving these settings into a per-brand Settings screen later would only touch
`services/shopify.js`.

### Files
New: `api/src/services/shopify.js`, `api/src/services/productSync.js`, `frontend/src/pages/Products.jsx`,
`api/tests/shopify-sync.test.js`. Edited: `api/src/routes/integrations.js` (the sync route, a `shopify` flag on each product, the edit
guard), `frontend/src/{App.jsx,api/http.js,components/Sidebar.jsx,components/Shell.jsx,lib/Icon.jsx}`, `api/.env.example`,
`api/README.md`.

### Tests (8, no Shopify store needed)
`api/tests/shopify-sync.test.js` replaces Shopify with canned answers (`setShopify`). It covers create with the SKU / price / lead-time
rules; idempotent re-runs and updates; switch-off and reactivation; adoption and hand-typed products left alone; every exception
type and the "not switched off" rule; who may sync; the manual-edit lock; and the not-connected message.

### Not verified here
The real call to Shopify (a standard Admin GraphQL products query, pinned to API version 2025-01) could not be run without a store
and token. The first live sync should be done together once the env vars are set.

---

## 6. Fix 4: automatic stage moves (decided, not built)

The full proposal is in [AUTO_STAGE_MOVES.md](AUTO_STAGE_MOVES.md). Decisions taken after review:

| Decision | Detail |
|---|---|
| **The rule** | A record moves to the next stage **automatically only when every gap is cleared**, for leads and orders. One stage at a time |
| **When it fires** | Only when an edit takes the gap count from at least 1 to 0, and the stage has at least one required rule. This stops a stage with no requirements advancing at once, and stops an undone move being redone |
| **Into Won** | **Never automatic.** The lead shows "Ready to create the order", with **Review and approve**. A summary shows the order value, advance paid, products and who is notified; the order is created only on **Approve and create order**. Whoever can edit the lead can approve (a pod-lead-only variant is possible if wanted) |
| **Into Dispatched / Delivered** | Not part of this rule: they already follow the shipments (and get an "auto" label in history) |
| **Switches** | Per brand, for leads and for orders, **on by default**, in Settings → Brands (a small addition to `brand.defaults`) |
| **Undo** | Each automatic move can be undone while the record is still in that stage, with no reason needed |
| **Audit** | Event `stage.auto_moved`, source `system`, with the rule name. The actor is the person whose edit cleared the last gap. History shows the "auto" chip |
| **Chat suggestions** | After accepting a batch of chat values, the check runs once at the end |

Not built: measurement-correction warning, customer-silent-for-N-days. Manual moves are unchanged.

### Example
Lead at Qualifying; its only open gap is "Delivery deadline". Priya fills it in.
1. The gap count goes from 1 to 0, so the lead moves to **Customising** by itself.
2. History: `Moved · Priya, Team Alpha [auto]  Stage: Qualifying → Customising  (rule: gaps cleared)`.
3. Customising brings its own needed fields, so the gap count rises again and nothing else moves.
4. If Priya did not want that, **Undo** on that entry puts it back in Qualifying.

At the last open stage (Awaiting payment), when its gaps clear, nothing moves: the lead offers **Review and approve** to create the order.

---

## 7. Still open

| Item | Next step |
|---|---|
| 4: build the automatic moves and the order-approval step | build, with tests |
| 5: stage and hot/warm/cold suggestions from chats | write `docs/EXTRACTION_STAGE_TEMPERATURE.md`, then wait for approval |
| 6: production and QC tracking | write `docs/PRODUCTION_QC.md`, then wait for approval |
| 7: deployment | write `docs/DEPLOY_CHECKLIST.md`; nothing is deployed |
| `IMPLEMENTATION.md` | update §19 (it still says there is no AI chat reading and no chat screen) and the stage-removal line in §8 |

---

## 8. How to try it

```bash
cd api && npm run mongo:dev          # local MongoDB replica set on port 27018
cd api && npm test                   # 103 tests
cd api && npm run dev                # API on :4000      (api/.env is read)
cd frontend && npm run dev           # app on http://localhost:5173
```

Sign in as `meera@stitch.test` (pod lead, every brand) / `stitch123`, or `admin@stitch.test`.

| Try | Steps |
|---|---|
| Fix 1 | Settings → Brands → Veda Menswear: its "Fabric swatches sent" field. Open a Veda lead at Qualifying or later, set it to **No**: its gap disappears. Clear it: the gap returns |
| Fix 2 | Settings → Brands → Kesar House → remove **Design & trial** → **Save stages**. The box appears; pick **Consultation** → **Move leads and save**. Open Pooja Nair: stage and History updated |
| Fix 3 | **Products** in the sidebar: search, add a product, edit it, switch it off and on. Pick a brand and click **Sync from Shopify**: it says Shopify is not connected until the env vars are set |

---

## 9. Going back

Each fix is its own commit, so any one can be undone without the others:

```bash
git revert e28d430     # Products screen and Shopify sync
git revert 682085a     # moving leads when removing a stage
git revert e98d962     # "No" counts as filled
```
