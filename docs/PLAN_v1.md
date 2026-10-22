# Stitch Backend: Plan v1

**Status:** Draft for review · **Date:** 19 Oct 2026 · **Database:** MongoDB
**Based on:** `Stitch_Field_Flow_10_page.md` (the Field & Flow doc). Where this plan says "spec", it means that doc.

**Changes, 20 Oct (CEO):** each brand can have its own lead pipeline and its own custom fields (§4.3). The order pipeline stays the same for every brand. Custom fields are optional or needed, never blocking.

**Changes, 19 Oct (review with Harshal):** added products (§5.16), full order details (§5.12), customisations with versioned corrections (§5.17), a payments ledger (§5.18), dispatches with a weekly view (§5.19), and deployment on Render (§18).

---

## 1. What v1 is

Stitch tracks every customer enquiry from WhatsApp until it becomes a paid order. For each enquiry it shows what information is still missing.

v1 builds the backend for this. The data is entered by hand, so the system is useful before any AI chat-reading exists. When AI extraction arrives later, it writes into the same fields through the same API.

### In scope

1. **Organisation setup:** brands (with duplicate checks), WhatsApp accounts per brand, teams, members, and who can see which brand.
2. **Clients:** one record per real person, identified by phone number.
3. **Leads:** manual entry. Every field maps to a defined place in the database and stays editable. Stage changes follow the spec's rules.
4. **Audit trail:** every change is recorded with who made it, from which team, what changed and when.
5. **Gaps:** missing required fields, calculated from the brand's rules (spec §5.1).
6. **Conversations:** upload a chat export and store it as messages. Link it to one or more leads by hand. No AI.
7. **Lead to order:** when a lead reaches **Won**, create an order and notify the brand through a **webhook**.
8. **Orders and products:** each brand's product catalogue, plus orders with their date, amounts and items.
9. **Customisations:** custom sizes, measurements and design specs for each ordered item. Every correction is kept as a new version.
10. **Payments:** a ledger of every advance, balance, extra charge and refund, linked to the lead and the order.
11. **Dispatches:** shipments with courier, AWB and status, a weekly dispatch view, and any corrections made.

### Out of scope for v1

- AI or LLM extraction from chats. The schema is ready for it (§10.4).
- Sending WhatsApp messages (Ask on WhatsApp, Send link). Only the fields are stored.
- Shopify sync. The fields are reserved but not used.
- Detailed production and QC tracking (karigar, progress photos, QC photos). The order moves through every stage, and payments and dispatch are covered, but these screens come in v1.1.
- Risk score tuning. A simple version is computed; the weights stay as in spec §5.3.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Tenant** | The agency's company account. Every document carries `tenant_id`. |
| **Brand** | A client fashion brand, such as Noor Atelier. It has its own field template and rules. |
| **WhatsApp account** | A business WhatsApp number. **Each one belongs to exactly one brand.** Chats on it are about that brand. |
| **Team** | A group of members (a "pod" in the spec). It handles a set of brands. |
| **Member** | A user. Belongs to one or more teams and can work on any brand those teams handle. |
| **Client** | The end customer, identified by phone number. |
| **Lead** | **One purchase**: one client, one brand and one buying decision (one occasion, one quote, one payment). |
| **Item** | A product inside a lead, such as a lehenga or a dupatta. Each item has its own configuration (size, neckline, measurements). |
| **Conversation** | One uploaded WhatsApp chat and its messages. It can relate to several leads, and a lead can span several conversations. |
| **Gap** | A required field that is still empty. **Blocking** gaps stop a stage move; **Needed** gaps do not (spec §1.3). |
| **Event** | One entry in the append-only audit trail. |
| **Order** | Created automatically when a lead is Won (spec §2). |
| **Product** | An entry in a brand's catalogue, such as "Bridal lehenga, ivory". Lead and order items can point to one. |
| **Customisation** | A versioned set of specs or measurements for one ordered item. A correction creates a new version. |
| **Payment** | One money movement (advance, balance, extra or refund), recorded in the ledger. |
| **Dispatch** | One shipment of an order. An order can be split into several. |

---

## 3. How it fits together

```
tenant
 ├── brands ─────────┬── whatsapp_accounts      (1 brand : N numbers, each number belongs to 1 brand)
 │                   ├── products               (the brand's catalogue)
 │                   │
 ├── teams ──────────┘  brand_ids[]             (team ↔ brand  = many-to-many)
 ├── users  ── memberships[] → teams            (user ↔ team   = many-to-many)
 │
 ├── clients                                    (unique phone per tenant)
 │     ├── conversations ── messages            (1 client : N conversations)
 │     └── leads ── items[]                     (1 client : N leads)
 │            ├── lead_events  (append-only trail)
 │            ├── lead_issues  (size / design / … problems)
 │            ├── payments     (advance recorded here, before the order exists)
 │            └── order        (created at Won)
 │                  ├── items[] ── customisations  (versioned specs and measurements per item)
 │                  ├── payments                   (advance + balance + refunds)
 │                  └── dispatches                 (one or more shipments, with corrections)
 │
 │   conversations ⇄ leads                      (many-to-many, via conversations.lead_links[])
 │
 ├── field_defs, brand_templates, required_rules (what to capture, and what is required when)
 └── webhook_endpoints, outbox, webhook_deliveries, notifications
```

**Who can see what:** a member sees the leads, clients, conversations and orders of **every brand handled by any of their teams**. Admins see everything in the tenant.

---

## 4. Organisation model

### 4.1 Rules

1. **Brand to WhatsApp account is one-to-many.** A brand can have several numbers. A number belongs to exactly one brand. The number is unique across the tenant.
2. **Team to brand is many-to-many.** A team handles several brands, and a brand can be handled by several teams.
3. **Member to team is many-to-many.** A member is usually in one team but can be in more.
4. **A member's brand scope** is the union of the brands handled by all of their teams. Inside a team, any member can work on any of the team's brands; there is no per-member brand list in v1.
5. **The lead owner** must be a member whose scope includes the lead's brand. This is checked on create and on reassignment.
6. **A team is never stored on a lead.** It is worked out from the owner and the brand. This keeps data from drifting when teams change. The audit trail does record the acting team at the time of each change (§8).

### 4.2 Brand onboarding

**Flow (admin only):**

1. **Enter details:** name, short code (such as NA), template (womenswear, menswear and so on), Instagram handle, website, contact email, WhatsApp numbers, and an optional webhook URL.
2. **Check for duplicates live while typing:** `GET /brands/check?name=…&instagram=…&website=…&phone=…`.
3. **Save.** This creates the brand and copies the template's fields and required rules to the brand.
4. **Assign the brand to one or more teams.**

**Duplicate rules,** enforced by unique indexes and not just by the UI:

| Check | Normalisation | Message on conflict |
|---|---|---|
| Name | lowercase, punctuation removed, spaces collapsed, "the" and "pvt ltd" removed | "**Noor Atelier** is already onboarded (added by Priya on 12 Oct, handled by Team Alpha)." |
| Code | uppercase | "Code NA is already used by Noor Atelier." |
| Instagram | lowercase, without `@` or the URL | "This Instagram handle belongs to Noor Atelier." |
| Website | domain only, `www.` removed | "This website belongs to Noor Atelier." |
| WhatsApp number | E.164 format | "+91 98111 15326 is already connected to Noor Atelier." |

**Responses:** a conflict returns **HTTP 409** with the existing brand's name, who added it, when, and its teams. A **similar** but not identical name (edit distance ≤ 2, such as "Noor Ateliers") returns a **warning**. The admin can still proceed.

**Archived brands:** a brand is never deleted; it is archived instead. Re-onboarding an archived brand offers **"Restore"** rather than creating a duplicate.

### 4.3 Per-brand setup: pipeline and custom fields (added 20 Oct)

The agency's sales team sets each brand up at onboarding:

- **Lead pipeline.** The brand's own list of stages (a single-select status). Each stage has a type: **open** stages are worked through in order, the **won** stage creates the order (whatever the brand calls it, e.g. "Confirmed"), and the **lost** stage closes the lead. The default is the spec's stages. Template rules are placed on the stage at the same relative position, so the payment gate always sits on the stage before won.
- **Editing a pipeline.** Renaming a stage moves its leads and rules with it. A stage that still has leads cannot be removed; once empty, its rules move to the stage before it. Every change is logged.
- **Custom fields.** A brand can add its own fields (text, number, date, dropdown, yes/no, link), on the lead or on each product, at a chosen stage, as optional or needed. Only that brand sees them. They are stored in the same `fields` bag, show up as gaps when needed, and are copied to the order at won.
- **Order pipeline.** The same for every brand: it is the agency's fulfilment process.

---

## 5. Data model (MongoDB collections)

**Conventions:**
- `_id` is an ObjectId.
- Readable IDs (`LD-1001`, `ORD-NA-2001`) are stored separately and come from a `counters` collection.
- Every document has `tenant_id`, `created_at` and `updated_at`.
- Money is stored in the smallest unit as integers (paise, cents), with a separate `currency`.
- Dates without a time (event date, deadlines) are stored as `"YYYY-MM-DD"` strings, so time zones can't shift them by a day. Timestamps are stored as `Date`.

### 5.1 `tenants`
```js
{ _id, name, slug /* unique */, active, created_at }
```

### 5.2 `users`
```js
{
  _id, tenant_id, name, initials, email /* unique */, password_hash,
  role: 'admin' | 'pod_lead' | 'sales' | 'ops' | 'qc',
  memberships: [ { team_id, joined_at } ],      // user ↔ team many-to-many
  active, created_at, updated_at
}
```
Indexes: `{ email: 1 }` unique · `{ tenant_id: 1, 'memberships.team_id': 1 }`

### 5.3 `teams`
```js
{ _id, tenant_id, name, brand_ids: [ObjectId], lead_user_id, active, created_at, updated_at }
```
Indexes: `{ tenant_id: 1, name: 1 }` unique · `{ tenant_id: 1, brand_ids: 1 }`

### 5.4 `brands`
```js
{
  _id, tenant_id, code: 'NA', name: 'Noor Atelier',
  name_key: 'noor atelier', instagram_key: 'nooratelier', website_key: 'nooratelier.com',   // for duplicate checks
  template_id, category: 'womenswear',
  contact: { email, phone },
  defaults: { currency: 'INR', production_days, transit_days },     // spec Q9
  status: 'active' | 'archived',
  onboarded_by, created_at, updated_at
}
```
Indexes (all unique, the last two partial so they only apply when the value is present): `{ tenant_id: 1, code: 1 }` · `{ tenant_id: 1, name_key: 1 }` · `{ tenant_id: 1, instagram_key: 1 }` · `{ tenant_id: 1, website_key: 1 }`

### 5.5 `whatsapp_accounts`
```js
{ _id, tenant_id, brand_id, phone_e164: '+919811115326', display_name, active, created_at }
```
Indexes: `{ tenant_id: 1, phone_e164: 1 }` unique · `{ brand_id: 1 }`

### 5.6 `clients`
```js
{
  _id, tenant_id,
  phone_e164 /* unique per tenant */, alt_phones: [],
  name, email, city, country,
  whatsapp_consent: 'Yes' | 'No' | 'Unknown',     // per person, shown on every lead (spec §3)
  customer_type: 'New' | 'Repeat' | 'Referral' | 'Trade/Stylist',
  created_by, created_at, updated_at
}
```
Indexes: `{ tenant_id: 1, phone_e164: 1 }` unique · `{ tenant_id: 1, name: 'text' }`

**Clients have no brand.** One person can buy from several brands. Brand scoping applies through their leads and conversations: a member can see a client only if the client has a lead or conversation in one of the member's brands.

### 5.7 `leads`
```js
{
  _id, tenant_id, lead_no: 'LD-1001',
  client_id, brand_id, owner_id,
  stage: 'New' | 'Qualifying' | 'Customising' | 'Quoted' | 'Awaiting payment' | 'Won' | 'Lost',
  stage_changed_at,
  fields: {                       // lead-level values, keys from field_defs (scope: 'lead')
    event_date: '2026-12-14', occasion_type: 'Wedding', country: 'India',
    delivery_deadline: '2026-12-05', quote_amount: 24000000, currency: 'INR',
    advance_amount: null, payment_link_sent: null, ...
  },
  items: [                        // embedded: a lead has few items, and they are always read together
    {
      _id, product_id: null /* optional link to the catalogue (§5.16) */, product: 'Bridal lehenga', quantity: 1, wearer: null,
      fields: { neckline: 'Sweetheart', blouse_size: 'Custom', waist: 28, design_approval_status: 'Sent', ... },
      created_at, updated_at, removed_at: null
    }
  ],
  lost_reason: null, reopened_count: 0,
  converted_order_id: null,
  open_gap_count: 3, blocking_gap_count: 1,   // cached from the gap engine, for list views
  open_issue_count: 0,
  version: 7,                     // optimistic lock, +1 on every write
  created_by, intake_method: 'Manual' | 'Chat export' | 'Paste text' | 'Screenshot',
  created_at, updated_at
}
```
Indexes:
- `{ tenant_id: 1, lead_no: 1 }` unique
- `{ tenant_id: 1, brand_id: 1, stage: 1 }`, used by boards
- `{ tenant_id: 1, owner_id: 1, stage: 1 }`, used for "my leads"
- `{ tenant_id: 1, client_id: 1 }`
- `{ tenant_id: 1, 'fields.event_date': 1 }`

**Why `fields` is a sub-document:** new fields and new brand templates need no migration. `field_defs` (§6) controls which keys are valid, so the bag is not free-form.

### 5.8 `lead_events` (append-only audit trail; see §8)
```js
{
  _id, tenant_id, lead_id, item_id: null,
  type: 'field.set',              // see the list in §8.1
  changes: [ { field: 'waist', scope: 'item', old: null, new: 28 } ],
  actor: { user_id, name, team_id, team_name, role },     // copied at write time
  source: 'manual' | 'chat' | 'system' | 'import' | 'api',
  source_message_id: null,        // set when the value came from a chat message
  reason: null,                   // required for backward moves, overrides, Lost
  lead_version: 8,                // the lead's version after this event
  at
}
```
Indexes: `{ tenant_id: 1, lead_id: 1, at: -1 }` · `{ tenant_id: 1, 'actor.user_id': 1, at: -1 }` · `{ tenant_id: 1, 'actor.team_id': 1, at: -1 }`
Events are never updated or deleted. Undo is a new event that restores the old value.

### 5.9 `lead_issues`
```js
{
  _id, tenant_id, lead_id, item_id: null,
  type: 'size' | 'design' | 'fabric' | 'colour' | 'measurement' | 'payment' | 'delivery' | 'other',
  title, description,
  status: 'open' | 'resolved',
  source_message_id: null,
  raised_by, owner_id, opened_at, resolved_at, resolution
}
```
Indexes: `{ tenant_id: 1, lead_id: 1, status: 1 }` · `{ tenant_id: 1, status: 1, type: 1 }`
Issues are separate from fields on purpose. A lead can have several, and each one opens and closes over time. Opening and resolving an issue also writes a `lead_events` entry.

### 5.10 `conversations`
```js
{
  _id, tenant_id, whatsapp_account_id, brand_id /* from the account */, client_id,
  source: 'chat_export',
  file_name, content_hash,
  first_msg_at, last_msg_at, message_count, customer_message_count,
  lead_links: [ { lead_id, linked_by, linked_at, note } ],   // conversation ↔ lead many-to-many
  status: 'unlinked' | 'linked' | 'archived',
  uploaded_by, created_at, updated_at
}
```
Indexes: `{ tenant_id: 1, client_id: 1 }` · `{ tenant_id: 1, brand_id: 1, status: 1 }` · `{ tenant_id: 1, 'lead_links.lead_id': 1 }` · `{ tenant_id: 1, content_hash: 1 }`

### 5.11 `messages`
```js
{ _id, tenant_id, conversation_id, idx, ts, sender, role: 'customer' | 'staff' | 'unknown', text, media: null | 'image' | ..., msg_hash }
```
Indexes: `{ conversation_id: 1, idx: 1 }` unique · `{ conversation_id: 1, msg_hash: 1 }` unique, which makes re-uploads add only the new messages.
Messages are a separate collection because a chat can have thousands of them, and a Mongo document is capped at 16 MB.

### 5.12 `orders`
```js
{
  _id, tenant_id, order_no: 'ORD-NA-2001',      // unique per brand (spec §2.2)
  order_date: '2026-10-19',                     // the day the lead was Won
  lead_id, client_id, brand_id, owner_id,
  stage: 'Created' | 'Spec locked' | 'Measurements' | 'Production' | 'QC approval' | 'Ready to ship' | 'Dispatched' | 'Delivered',
  stage_changed_at,
  currency: 'INR',
  amounts: {                                    // smallest currency unit
    subtotal,                                   // sum of item line totals
    discount, shipping, gst, duty,
    total,                                      // the spec's "Order value"
    paid,                                       // received payments minus refunds (from §5.18; never typed by hand)
    balance_due                                 // total − paid
  },
  items: [
    {
      _id, product_id, product_name, quantity, unit_price, line_total, wearer,
      current_spec_id, current_measurements_id  // latest versions in customisations (§5.17)
    }
  ],
  dates: { event_date, promised_ship_date, delivery_deadline },
  addresses: { delivery, verified_shipping, billing },
  production: { karigar, start_date, eta, completed_at, delay_reason },     // v1.1 screens
  qc: { result, by, at, failure_reason },                                   // v1.1 screens
  fields: { ... other values copied from the lead (spec §2.1) ... },
  shopify: { order_id: null, last_sync_at: null, out_of_sync: false },   // reserved, unused in v1
  version, created_at, updated_at
}
```
Indexes:
- `{ tenant_id: 1, brand_id: 1, order_no: 1 }` unique
- `{ tenant_id: 1, brand_id: 1, stage: 1 }`
- `{ tenant_id: 1, order_date: -1 }`
- `{ tenant_id: 1, lead_id: 1 }` unique, which makes it impossible to create two orders for one lead

Order events go in `order_events`, which has the same shape as `lead_events`.

**Amounts are never edited directly.** `paid` and `balance_due` are recalculated from the payments ledger whenever a payment changes, and `subtotal` is recalculated whenever an item changes.

### 5.13 Configuration: `field_defs`, `brand_templates`, `required_rules`
```js
// field_defs: the field catalogue (one per tenant; seeded from the spec)
{ _id, tenant_id, key: 'neckline', label: 'Neckline', scope: 'lead' | 'item' | 'client',
  record_types: ['lead', 'order'], type: 'text' | 'longtext' | 'number' | 'currency' | 'date' | 'select' | 'bool' | 'paid' | 'url',
  options: [], unit: 'in', min, max, done_values: [], hint, active }

// brand_templates: a starter set of fields and rules for a kind of brand
{ _id, tenant_id, key: 'womenswear', name: 'Womenswear (ethnic)', field_keys: [...],
  rules: [ { record_type, stage, field, level } ] }

// required_rules: spec §5.5 "Set Required", copied from the template at onboarding, then editable
{ _id, tenant_id, brand_id, record_type: 'lead' | 'order', stage, field,
  level: 'optional' | 'needed' | 'blocking', locked: true /* the six gate fields */, updated_by, updated_at }
```
Index: `required_rules { tenant_id: 1, brand_id: 1, record_type: 1, stage: 1, field: 1 }` unique

**A field with no rule for a brand is hidden for that brand.** It is never shown and never a gap (spec §6).

### 5.14 Integration: `webhook_endpoints`, `outbox`, `webhook_deliveries`, `notifications`
See §11.

### 5.15 `counters`
```js
{ _id: 'tenant:<id>:lead', seq: 1001 }   { _id: 'tenant:<id>:order:NA', seq: 2001 }
```
These are incremented with `findOneAndUpdate({ $inc: { seq: 1 } }, { upsert: true })`.

### 5.16 `products` (the brand's catalogue)
```js
{
  _id, tenant_id, brand_id,
  sku: 'NA-LEH-014', name: 'Bridal lehenga · ivory', category: 'lehenga',
  base_price, currency,
  customisable_fields: ['neckline', 'blouse_size', 'dupatta_border', ...],   // subset of the brand's template
  lead_time_days: 45,
  images: [], shopify_product_id: null,
  active, created_at, updated_at
}
```
Indexes: `{ tenant_id: 1, brand_id: 1, sku: 1 }` unique · `{ tenant_id: 1, brand_id: 1, name: 'text' }`

- **Choosing a product is optional.** A lead item can be free text ("something like the pink one in the reel") and be matched to a product later.
- **When a product is chosen,** its `base_price` pre-fills the item's price, and `customisable_fields` narrows which item fields are shown.
- **Products are never deleted, only made inactive,** so old orders keep their references.

### 5.17 `customisations` (custom sizes, measurements and specs, with corrections)

One document per **version** of the spec or measurements of an ordered item. A correction never overwrites anything; it creates the next version.

```js
{
  _id, tenant_id, order_id, order_item_id, lead_id, brand_id,
  kind: 'spec' | 'measurements',
  version: 2,                                  // 1 = copied from the lead at Won
  values: {                                    // keys from field_defs (scope: 'item')
    // kind = 'spec':         neckline, blouse_size, sleeve_style, dupatta_border, embroidery_colour, ...
    // kind = 'measurements': bust: 34, waist: 28, hip: 38, shoulder: 14.5, ...
  },
  unit: 'in',
  changed_fields: ['waist'],                   // compared with the previous version
  reason: 'Customer re-measured at the trial',// required from version 2 onwards
  source: 'customer' | 'store_visit' | 'tailor_visit' | 'video_call',
  status: 'draft' | 'sent_to_customer' | 'signed_off' | 'superseded',
  signed_off: { by_customer: true, confirmed_by_user_id, at, evidence_message_id },  // spec "Customer sign off*"
  approved_by: null,                           // needed after Spec locked (spec Q7: pod lead)
  created_by, created_at
}
```
Indexes: `{ order_item_id: 1, kind: 1, version: 1 }` unique · `{ tenant_id: 1, order_id: 1 }` · `{ tenant_id: 1, created_at: -1, version: 1 }` (for the "corrections" report)

**How it maps to the spec:**
- **Measurements stage:** the gate *Customer sign off\** is met when every item's current measurements are `signed_off`.
- **Revision count:** `version − 1`.
- **After Spec locked:** a change needs `approved_by` (spec §4, Q7). The change-request log is the list of versions with their reasons.

**Before Won,** item details stay on the lead (§5.7) because they change freely during sales. At Won, each item's values are copied into version 1 here.

### 5.18 `payments` (ledger)

```js
{
  _id, tenant_id, brand_id, client_id,
  lead_id, order_id: null,                     // order_id is set at Won for payments made before it
  kind: 'advance' | 'balance' | 'extra' | 'refund',
  amount, currency,
  status: 'pending' | 'link_sent' | 'received' | 'failed' | 'cancelled' | 'refunded',
  mode: 'UPI' | 'Card' | 'Bank transfer' | 'Shopify checkout' | 'Cash' | null,
  link: { url, sent_at, expires_at },
  transaction_ref, received_at,
  proof_url: null, notes,
  recorded_by, created_at, updated_at
}
```
Indexes: `{ tenant_id: 1, order_id: 1 }` · `{ tenant_id: 1, lead_id: 1 }` · `{ tenant_id: 1, status: 1, received_at: -1 }` · `{ tenant_id: 1, transaction_ref: 1 }` (unique where present, to stop the same payment being recorded twice)

**The spec's payment fields are calculated from the ledger,** so the same money is never typed in two places:

| Spec field | Calculated as |
|---|---|
| Advance amount\* (lead) | amount of the advance payment (status `link_sent` or `received`) |
| Payment link sent\* (lead) | `Yes` when the advance has a `link.sent_at` |
| Payment mode, Transaction ID, Payment received date | from the received advance payment |
| Balance due (order) | `amounts.total − amounts.paid` |
| Balance payment\* (order) | `Paid` when balance due ≤ 0 |

**Every payment change writes an event** (`payment.recorded`, `payment.received`, `payment.refunded`) on the lead or the order.

### 5.19 `dispatches` (shipments, weekly view and corrections)

```js
{
  _id, tenant_id, brand_id, client_id, order_id,
  shipment_no: 1,                              // 2, 3, ... when an order is split
  order_item_ids: [],                          // what is in this parcel
  courier, awb, tracking_link,
  ship_to: { name, phone, address, city, pincode, country },   // copied from the verified address at creation
  pickup_date, dispatch_date, expected_delivery, delivered_at, delivery_proof_url,
  status: 'scheduled' | 'picked_up' | 'in_transit' | 'delivered' | 'returned' | 'failed',
  late: false,                                 // dispatch_date > order's promised_ship_date
  tracking_shared_at: null,
  corrections: [                               // everything fixed after the shipment was created
    { at, by, field: 'awb', old, new, reason: 'Wrong AWB typed' }
  ],
  created_by, created_at, updated_at
}
```
Indexes: `{ tenant_id: 1, dispatch_date: -1 }` · `{ tenant_id: 1, brand_id: 1, dispatch_date: -1 }` · `{ tenant_id: 1, order_id: 1 }` · `{ tenant_id: 1, awb: 1 }` (unique where present)

**Weekly dispatch view:** `GET /dispatches/weekly?week=2026-W43&brand=NA` returns, for that ISO week:
- the number dispatched, delivered, in transit, returned or failed, per brand;
- the list of shipments;
- **late** shipments (dispatched after the promised ship date);
- **corrections made that week**, both to shipments and to customisations (§5.17), with who made them and why.

**Ties to the spec:** creating a dispatch moves the order to **Dispatched**. `delivered_at` plus proof moves it to **Delivered**. *Tracking shared* is met when `tracking_shared_at` is set.

---

## 6. Field catalogue

This follows spec §3 and §6. **Level** is the default from the spec: **B** = Blocking, **N** = Needed, **O** = Optional. **Scope** is where the value lives.

### 6.1 Client-level (shown on every lead)

| Field | Type | Level |
|---|---|---|
| Name | text | N (New) |
| Phone/WhatsApp | phone | N (New) |
| WhatsApp consent | Yes / No / Unknown | N (New) |
| Email, City | text | O |
| Customer type | select | N (Qualifying) |

### 6.2 Lead-level

| Stage | Field | Type | Level |
|---|---|---|---|
| Every stage | Brand, Owner | ref | always required (not a gap; enforced on create) |
| New | Event date | date | N |
| New | Country | text | N |
| New | **At least one item** (the spec's "Product") | — | N |
| New | Lead source | select | N |
| New | Next follow-up date | date | N |
| New | Occasion type, Budget from/to, Reference images, Priority, Tags, Notes | various | O |
| Qualifying | Delivery deadline | date | N |
| Quoted | Delivery address | longtext | N |
| Quoted | Promised ship date | date | N |
| Quoted | Quote amount, Currency, Quote validity | currency, select, date | N |
| Quoted | Quote status (done when Accepted) | select | N |
| Quoted | Shipping cost | currency | N |
| Quoted | Duty estimate (only when country is not India) | currency | N |
| Quoted | Discount | text | O |
| Awaiting payment | **Advance amount** | currency | **B** |
| Awaiting payment | **Payment link sent** | bool | **B** |
| Awaiting payment | Payment mode, Transaction ID, Payment received date | various | N |
| Awaiting payment | Link expiry, Karigar slot held until | date | O |
| Awaiting payment | *(The payment fields above are calculated from the payments ledger, §5.18, not typed on the lead.)* | | |
| Lost | Lost reason | select | required to mark Lost |

### 6.3 Item-level (by template)

An item-level rule must be met by **every item** on the lead. The gap shows as, for example, *"Item 2 · Saree: Neckline missing"*.

| Stage | Womenswear (NA, KH) | Menswear (VM) | Level |
|---|---|---|---|
| New | Product, Quantity | Product, Quantity | N |
| Qualifying | Fabric, Colour, Size category | Fabric, Colour, Size category | O |
| Customising | Neckline, Lining colour, Blouse size, Dupatta border, Embroidery colour, Surcharge, Sleeve style, Sleeve length, Embroidery type, Design approval status | Collar style, Garment size, Closure type, Fit type, Embroidery colour, Surcharge, Embroidery type, Design approval status | N |
| Customising | Back design, Blouse length, Skirt flare, Add-ons, Customisation notes | Add-ons, Customisation notes | O |
| Quoted | Waist, Hip, Bust | Waist, Chest | N |
| Quoted | Shoulder, Armhole, Height | Hip (Q8), Neck, Shoulder, Garment length, Trouser length, Thigh, Height | O |

**Derived rules** (spec §8, "Field lineage"):
- `blouse_size = Custom` makes the full measurement set Needed.
- `country ≠ India` makes Duty estimate Needed.
- Payment mode, Transaction ID and Payment received date only apply once `payment_link_sent = Yes`.

---

## 7. Lead lifecycle

### 7.1 Create a lead manually

`POST /leads`

```json
{
  "brand_id": "…", "owner_id": "…",
  "client": { "phone": "+91 98111 15326", "name": "Riya Sharma" },
  "fields": { "event_date": "2026-12-14", "occasion_type": "Wedding", "country": "India" },
  "items": [ { "product": "Bridal lehenga", "quantity": 1 } ],
  "conversation_id": null
}
```

**Steps, in one transaction:**
1. **Check permissions:** the brand is in the caller's scope, and the owner's scope includes the brand.
2. **Find or create the client:** normalise the phone to E.164, then upsert on `(tenant_id, phone_e164)`. An existing client is reused, and a different name is returned as a warning; it is never silently overwritten.
3. **Check for a duplicate lead:** if this client already has an **open** lead with this brand, return it as a warning. The caller can confirm it's a new purchase or add items to the existing lead instead (§13).
4. **Validate every field** against `field_defs` (§12).
5. **Insert the lead** with stage **New**, `version: 1`, and the next `lead_no`.
6. **Write a `lead.created` event** containing every initial value.
7. **Link the conversation**, if `conversation_id` was given.
8. **Compute gaps** and cache the counts.

Saving with gaps is **always allowed** (spec §3, "Quick add").

### 7.2 Update fields

`PATCH /leads/:id`

```json
{ "version": 7, "fields": { "delivery_deadline": "2026-12-05" }, "items": [ { "_id": "…", "fields": { "waist": 28 } } ] }
```

1. **Validate** the new values.
2. **Write with the version check:**
   `updateOne({ _id, tenant_id, version: 7 }, { $set: {...}, $inc: { version: 1 } })`
   - **Updated:** write one `field.set` or `item.updated` event listing every changed field with its old and new value.
   - **Not updated** (`matchedCount = 0`): return **409 Conflict** with the latest lead, and the UI reloads it and asks the user to re-apply. No hard locks, so nobody waits.
3. **Recompute gaps.**
4. **Won leads:** sales fields are read-only (spec §3). Edits go to the order.

### 7.3 Move stage

`POST /leads/:id/stage`

```json
{ "version": 7, "to": "Quoted", "reason": null }
```

- **Forward moves:** allowed only when there are **no Blocking gaps** in the current stage and in any stage being skipped. Needed gaps never block (spec §4.1). A gate only blocks the move that crosses it: once a record is past a gate (met, or overridden by a pod lead), later moves don't re-check it, though its gap stays visible.
- **Refused moves:** return **422** with the list of Blocking gaps, and log a `stage.move_blocked` event so pod leads can see where people get stuck.
- **Backward moves:** always allowed, but a `reason` is required.
- **Overrides (spec Q2):** a pod lead may pass `override: true` with a reason. This writes a `stage.overridden` event.
- **Readiness hint:** the API returns `ready_for_next: true/false` with what's missing, based on each stage's "Moves on when" column in the spec. Moving the stage is still a manual action.

### 7.4 Lost and reopen

- **Lost:** `POST /leads/:id/lost { reason, note }`. The reason is one of: Price, Timeline, Chose competitor, No response, Other.
- **Reopen:** `POST /leads/:id/reopen`. Only the owner or a pod lead can do this, within 90 days (spec Q12). The lead keeps its `lead_no`, returns to its last stage, and `reopened_count` goes up by one.

### 7.5 Won

Won is a stage move. It requires the Awaiting payment gate: **Advance amount** and **Payment link sent**. Spec Q1 is still open: should Won also require Payment received date? The plan makes this a single per-brand setting.

What happens on Won is covered in §11.

---

## 8. Audit trail (who did what, from which team)

### 8.1 Event types

`lead.created` · `field.set` · `field.cleared` · `item.added` · `item.updated` · `item.removed` · `owner.changed` · `stage.moved` · `stage.move_blocked` · `stage.overridden` · `lead.lost` · `lead.reopened` · `lead.won` · `issue.opened` · `issue.resolved` · `conversation.linked` · `conversation.unlinked` · `order.created` · `webhook.sent` · `webhook.failed`

### 8.2 Rules

1. **Every write to a lead writes exactly one event, in the same transaction.** The update and its trail can never disagree.
2. **The actor's team is resolved at write time:** the actor's team that handles the lead's brand. If several do, the first is taken alphabetically. It is stored with the event, so reports stay correct after people change teams.
3. **Events are immutable.** Undo (`POST /leads/:id/undo/:eventId`) writes a new event that restores the old values, and only works if those fields haven't changed since.
4. **One timeline query serves every view:** the lead history, "what did Team Alpha do this week", and "what did Priya change today" all read `lead_events` through its indexes.

### 8.3 Why "current state plus event log" and not full event sourcing

The current values live on the lead document, and the events are a log beside it. Full event sourcing (rebuilding a lead by replaying its events) adds complexity: projections, replays and snapshots. v1 doesn't need that. It gets the same practical benefits (history, undo, "where did this value come from") with simple reads.

### 8.4 MongoDB transactions

Writing a document and its event together needs a **replica set**.
- **MongoDB Atlas:** works out of the box.
- **Local development:** run `mongod --replSet rs0`, then `rs.initiate()` once.

---

## 9. Gap engine

This is the spec §5.1 rule, implemented once and used by every screen:

```
gaps(lead) =
  for stage in [first stage … lead.stage]:          # current and earlier stages only (spec A2)
    for rule in required_rules(brand, 'lead', stage) where level ≠ optional:
      if rule.field is item-scoped: check every active item
      else: check lead.fields / client fields
      if the field applies (derived rules §6.3) and is not filled → gap { field, item_id?, level, stage }
```

"Filled" depends on the type:
- **select with done values:** filled only when the value is one of them (for example, Quote status = Accepted).
- **bool:** filled when the value is `Yes`.
- **paid:** filled when the value is `Paid`.
- **anything else:** filled when non-empty.

**Caching:** the gaps are recomputed on every lead write, and the counts are cached on the lead for list views.

**Reuse:** ported from the SQLite prototype's gap engine, with item-level rules added (`api/src/services/gaps.js`).

---

## 10. Conversations (chat upload, no AI)

### 10.1 Upload

`POST /conversations` (multipart: a `.txt` or `.zip` export, plus `whatsapp_account_id`)

1. **Parse with code only.** Reuses the prototype's parser (`api/src/lib/whatsappParser.js`). It handles iPhone and Android formats, multi-line messages, media placeholders, and works out which side is staff and which is the customer.
2. **Brand:** taken from the WhatsApp account. The uploader picks the account; it's pre-selected when they can only see one.
3. **Client:** taken from the customer's phone, found in the file name ("WhatsApp Chat with +91 …") or in the sender label. The client is created if new. If no phone is found, the uploader enters one.
4. **Duplicate and re-upload handling:**
   - **Same `content_hash`:** "This chat was already uploaded".
   - **Same client and account, but a longer chat:** append only the new messages, de-duplicated by `msg_hash`, to the existing conversation.
5. **Stats:** first and last message time, message counts.

### 10.2 Link to leads

- **Suggestions:** the API lists the client's **open leads for that brand**.
- **No open lead:** the associate clicks "Create lead from this chat". This opens the manual form (§7.1) with the client and brand filled in.
- **One or more open leads:** the associate picks which ones the chat concerns. `POST /conversations/:id/links { lead_id }` handles this.
- **The system never guesses a link.** A person always confirms.

### 10.3 Reading a lead's chats

`GET /leads/:id/conversations` returns every linked chat with its messages, for the lead drawer.

### 10.4 Ready for AI later

When extraction arrives, it produces **suggested** field values, each with a `source_message_id`. Accepting a suggestion calls the same `PATCH /leads/:id` with `source: 'chat'` and the message ID. No schema change is needed.

---

## 11. Lead → Order and the brand webhook

### 11.1 What happens on Won (one transaction)

1. **Check the gate:** Advance amount and Payment link sent, plus Payment received date if the brand requires it (Q1).
2. **Update the lead:** `stage = 'Won'` and `converted_order_id`. Sales fields become read-only.
3. **Create the order** in **Created**, with:
   - the next `order_no` for that brand, and `order_date` set to today;
   - the fields copied as in spec §2.1;
   - the items copied, with their product and price;
   - the amounts calculated from the quote and the payments ledger.
4. **Create version 1 of each item's customisations** (§5.17), one for the spec and one for the measurements, from the lead item's values.
5. **Attach the lead's payments to the order** by setting `order_id` on the advance (§5.18).
6. **Write events:** `lead.won` on the lead and `order.created` on the order.
7. **Insert an `outbox` document** for the `order.created` event.

The webhook is **not** called inside the transaction. Writing to the outbox in the same transaction guarantees exactly two outcomes:
- the order exists **and** a notification is queued;
- or neither happened.

It also means a slow or failing brand endpoint can never block or roll back a Won.

### 11.2 Collections

```js
// webhook_endpoints: where a brand wants to be told (an admin sets these up at onboarding)
{ _id, tenant_id, brand_id, url, secret /* encrypted at rest */, events: ['order.created'], active, created_by, created_at }

// outbox: events waiting to be delivered
{ _id, tenant_id, event: 'order.created', event_id /* uuid */, brand_id, payload,
  status: 'pending' | 'processing' | 'done' | 'failed', attempts: 0, next_attempt_at, last_error, created_at }

// webhook_deliveries: one row per HTTP attempt, for debugging and "Redeliver"
{ _id, tenant_id, outbox_id, endpoint_id, attempt, request_at, status_code, duration_ms, response_snippet, error }

// notifications: in-app alerts for the brand's team members
{ _id, tenant_id, user_id, type: 'order.created', title, link, read_at, created_at }
```

### 11.3 Delivery worker

- **Picking up work:** a loop, every 5 seconds or on a change stream, claims due outbox rows with `findOneAndUpdate({ status: 'pending', next_attempt_at ≤ now }, { status: 'processing' })`.
- **Sending:** it POSTs to every active endpoint of the brand that subscribes to the event. The timeout is **10 seconds**, and only **2xx** counts as success.
- **Retries:** after 1 minute, 5 minutes, 30 minutes, 2 hours, then 6 hours. The 6th failed attempt marks the row `failed`, and admins get a notification and a **Redeliver** button.
- **Receivers must de-duplicate** by `X-Stitch-Event-Id`, because delivery is *at least once*.

### 11.4 Request format

```
POST <brand webhook url>
Content-Type: application/json
X-Stitch-Event: order.created
X-Stitch-Event-Id: 6f1c…-uuid
X-Stitch-Timestamp: 1766400000
X-Stitch-Signature: sha256=<HMAC-SHA256(secret, timestamp + "." + body)>
```
```json
{
  "event": "order.created",
  "event_id": "6f1c…",
  "occurred_at": "2026-10-19T10:42:00Z",
  "brand": { "code": "NA", "name": "Noor Atelier" },
  "order": {
    "order_no": "ORD-NA-2001", "lead_no": "LD-1001", "stage": "Created",
    "order_value": 240000, "currency": "INR", "advance_amount": 80000, "balance_due": 160000,
    "event_date": "2026-12-14", "promised_ship_date": "2026-12-01",
    "items": [ { "product": "Bridal lehenga", "quantity": 1, "spec": { "neckline": "Sweetheart", "blouse_size": "Custom" } } ]
  },
  "client": { "name": "Riya Sharma", "phone": "+919811115326", "city": "Pune", "country": "India" },
  "owner": { "name": "Priya", "team": "Team Alpha" }
}
```

**Personal data:** the client's phone and address are included only if the brand's endpoint has `include_pii: true`. They are off by default.

### 11.5 "The brand gets notified": who receives it

1. **The brand's own system:** the webhook above.
2. **Brands without a system:** the same webhook URL can point at Slack, Google Chat, Zapier or Make, which turn it into a message or email with no code on our side.
3. **The brand's team inside Stitch:** an in-app `notifications` entry for every member of the teams handling the brand.

---

## 12. Validation

| Type | Rule |
|---|---|
| phone | Parsed to E.164; must be 8–15 digits. A 10-digit number starting 6–9 with no country code is assumed Indian (+91) and flagged as a guess |
| date | `YYYY-MM-DD` and a real calendar date. The UI shows DD MMM YYYY (spec A11). Event date in the past gives a warning, not an error |
| number with unit | Within `min`/`max` from `field_defs`, for example waist 18–60 in. Inches by default; cm converted on input (A11) |
| currency | A non-negative integer in the smallest unit. `currency` must be set when an amount is set |
| select | Must be one of `options` (case-insensitive match, stored in canonical form) |
| unknown field key | Rejected with 400: "Field 'nekline' doesn't exist for brand Noor Atelier" |
| hidden field for brand | Rejected with 400: "Veda Menswear doesn't use 'dupatta_border'" |

---

## 13. Duplicates: summary

| What | Detected by | Outcome |
|---|---|---|
| Brand | name, code, Instagram, website, WhatsApp number (§4.2) | 409 with the existing brand's details; warning for similar names |
| WhatsApp number | unique `phone_e164` | 409: "already connected to <brand>" |
| Client | unique phone per tenant | Reuses the existing client; a name mismatch gives a warning |
| Lead | same client and brand with an open lead | Warning: "Riya already has open lead LD-1001 with Noor Atelier. Add items there, or create a new purchase?" |
| Chat upload | `content_hash`; `msg_hash` per message | "Already uploaded", or only the new messages are appended |
| Order | `lead.converted_order_id` set inside the Won transaction, plus a unique index on `orders.lead_id` | A second Won is impossible |
| Product | unique SKU per brand | 409: "SKU NA-LEH-014 already exists" |
| Payment | unique `transaction_ref` | 409: "This transaction is already recorded on ORD-NA-2001" |
| Dispatch | unique AWB | 409: "This AWB is already used on ORD-NA-1987" |
| Webhook | `event_id` | The receiver de-duplicates; Stitch never creates two outbox rows for one event |

---

## 14. API summary (v1)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /me` (includes the brand scope) |
| Brands | `GET /brands`, `GET /brands/check`, `POST /brands`, `PATCH /brands/:id`, `POST /brands/:id/archive`, `POST /brands/:id/restore` |
| WhatsApp accounts | `GET /brands/:id/whatsapp-accounts`, `POST …`, `PATCH /whatsapp-accounts/:id` |
| Teams | `GET /teams`, `POST /teams`, `PATCH /teams/:id` (name, brand_ids), `POST /teams/:id/members`, `DELETE /teams/:id/members/:userId` |
| Users | `GET /users`, `POST /users`, `PATCH /users/:id` |
| Clients | `GET /clients?q=`, `GET /clients/:id` (with leads and conversations), `POST /clients`, `PATCH /clients/:id` |
| Leads | `GET /leads?brand=&stage=&owner=&q=`, `POST /leads`, `GET /leads/:id` (with gaps, issues, links), `PATCH /leads/:id`, `POST /leads/:id/items`, `DELETE /leads/:id/items/:itemId`, `POST /leads/:id/stage`, `POST /leads/:id/lost`, `POST /leads/:id/reopen`, `GET /leads/:id/events`, `POST /leads/:id/undo/:eventId` |
| Issues | `POST /leads/:id/issues`, `PATCH /issues/:id` (resolve) |
| Gaps | `GET /gaps?brand=&owner=&level=` (the to-do list) |
| Conversations | `POST /conversations` (upload), `GET /conversations?status=unlinked`, `GET /conversations/:id`, `POST /conversations/:id/links`, `DELETE /conversations/:id/links/:leadId`, `GET /leads/:id/conversations` |
| Products | `GET /products?brand=&q=`, `POST /products`, `PATCH /products/:id`, `POST /products/:id/deactivate` |
| Orders | `GET /orders?brand=&stage=&from=&to=`, `GET /orders/:id` (with items, payments, dispatches), `PATCH /orders/:id`, `POST /orders/:id/stage`, `GET /orders/:id/events` |
| Customisations | `GET /orders/:id/items/:itemId/customisations?kind=`, `POST …` (new version with reason), `POST /customisations/:id/sign-off`, `POST /customisations/:id/approve` |
| Payments | `GET /payments?status=&from=&to=`, `POST /leads/:id/payments`, `POST /orders/:id/payments`, `PATCH /payments/:id` (mark received, failed, refunded) |
| Dispatches | `GET /dispatches?status=&from=&to=`, `GET /dispatches/weekly?week=&brand=`, `POST /orders/:id/dispatches`, `PATCH /dispatches/:id` (status changes; corrections need a reason) |
| Settings | `GET /field-defs`, `GET /templates`, `GET /brands/:id/rules`, `PUT /brands/:id/rules` (admin and pod lead; the six gate fields are admin-only) |
| Webhooks | `GET /brands/:id/webhooks`, `POST …`, `PATCH /webhooks/:id`, `POST /webhooks/:id/test`, `GET /webhooks/:id/deliveries`, `POST /outbox/:id/redeliver` |
| Activity | `GET /activity?team=&user=&from=&to=` (reads `lead_events`) |

**Every handler** takes `tenant_id` from the session, **never** from the request. The handler then narrows every query to the caller's brand scope.

---

## 15. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M1** | Organisation | Brands with all duplicate checks, WhatsApp accounts, teams with brand_ids, many-to-many members, and brand scope enforced on a test endpoint. Seeds for NA, KH, VM and the two templates |
| **M2** | Field catalogue and rules | `field_defs`, `brand_templates` and `required_rules` seeded from the spec. Onboarding a new brand copies its template. The rules editor API works, with the gate fields locked |
| **M3** | Clients and leads | Manual create, field updates with optimistic lock, items, every write producing an event, gap engine (including item-level gaps), stage moves with gates, Lost and reopen |
| **M4** | Conversations and issues | Upload and parse, client match, re-upload appends, link and unlink with leads, issues with events |
| **M5** | Products, payments, Won → Order → Webhook | Product catalogue; payments ledger with the spec's payment fields calculated from it; atomic conversion (order, customisations v1, payments attached); outbox, delivery worker with retries and signing, delivery log, Redeliver, in-app notifications |
| **M6** | Customisations and dispatch | Versioned corrections with reasons, customer sign-off gate, approval after Spec locked; dispatches with corrections; weekly dispatch view; order stage moves to Dispatched and Delivered |
| **M7** | Hardening and deploy | API tests for every rule in this document, a test for two users editing at once, seed data, backups; deployed on Render and Atlas (§18) |

**Order of work:** M1 → M2 → M3 is the critical path. M4 and M5 can run in parallel after M3, and M6 follows M5.

**Harshal's suggestion (agreed):** deploy to Render early, right after M3, and close the remaining gaps while using the real app. Each later milestone then ships to the same deployment.

---

## 16. Reuse from the current prototype

The SQLite prototype (`backend/`) was the reference for the logic. Its useful parts were ported into `api/` and the folder was then removed (20 Oct); it remains in the git history.

| Prototype file | Reuse as |
|---|---|
| `backend/src/catalogue.js` | Seed data for `field_defs` and the default rules (add the menswear fields) |
| `backend/src/gapEngine.js` | The gap engine (add item-level rules) |
| `backend/src/ingest/whatsappParser.js` | Chat parsing as-is |
| `backend/src/ingest/signals.js` (`phoneFromLabel`) | Phone and country from the file name |
| `frontend/` screens | Home, Leads/Orders boards, Gaps, Add Lead and Settings stay. They are pointed at the new API |

**Dropped:** `backend/src/qualify.js` (points-based scoring), which was judged unreliable.

---

## 17. Open questions for the team

| # | Question | Plan's default until answered |
|---|---|---|
| 1 | Full list of brands, and what each sells? | Seed NA, KH, VM; new brands pick womenswear or menswear |
| 2 | Real fields each brand asks customers? | Spec §3 and §6 lists |
| 3 | Which team handles which brands? Can a member be in two teams? | Many-to-many supported; most people in one team |
| 4 | Can a lead's owner be outside the brand's teams? | No |
| 5 | Should Won require proof of payment (spec Q1)? | Configurable per brand; default **off** |
| 6 | Can a pod lead override a Blocking gap (Q2)? | Yes, with a reason that is logged |
| 7 | One chat covering two purchases, such as the bride and her mother? | Supported: one conversation links to two leads |
| 8 | Do items need a "wearer" (measurements for someone other than the client)? | Optional `wearer` on each item |
| 9 | What does each brand use to receive the order notification: their own system, Slack, email? | Webhook URL per brand (works with Slack, Zapier and Make) |
| 10 | Should the webhook include the client's phone and address? | Off by default per brand |
| 11 | Who owns the order after Won (Q5)? | The same owner until Spec locked |
| 12 | MongoDB hosting: Atlas, or self-hosted? | Atlas (needed for transactions without setting up a replica set ourselves) |
| 13 | ID formats: are `LD-1001` and `ORD-NA-2001` fine? | Yes |
| 14 | 20–30 anonymised chat exports | Needed before the AI phase, not for v1 |
| 15 | Where does each brand's product catalogue come from: Shopify, a spreadsheet, or typed in? | Typed in or imported from CSV; Shopify import later |
| 16 | Are partial payments and more than one balance payment common? | Supported: the ledger allows any number of payments |
| 17 | Are orders ever split into several shipments? | Supported with `shipment_no` |
| 18 | What should the weekly dispatch view be used for, and by whom (ops review, brand report)? | Counts, late shipments and corrections per brand, for ops |
| 19 | Which corrections matter most: measurements, address, AWB, or something else? | All three are recorded with a reason |

---

## 18. Deployment (free tier, for testing)

| Part | Where | Notes |
|---|---|---|
| Backend API | **Render** web service (free) | Node app; settings come from environment variables (`MONGODB_URI`, `SESSION_SECRET`, `WEBHOOK_KEY`) |
| Frontend | **Render** static site (free) | Built Vite app; `/api` points to the backend URL |
| Database | **MongoDB Atlas** M0 (free) | A replica set by default, so the transactions in §8.4 work |

**Free-tier limits to know about** (check Render's and Atlas's current terms before relying on them):
- **The backend sleeps when nobody uses it** for a while, and the first request after that is slow, often several seconds.
- **Webhook retries pause while it sleeps.** The webhook worker (§11.3) runs inside the web service, because separate background workers are not on the free plan. Retries resume when the next request wakes the backend. This is fine for testing but not for production.
- **No permanent local disk.** Files written to disk are lost on restart. Chats are stored in MongoDB as messages (§5.11), so nothing depends on the disk. Payment proofs and delivery photos need object storage later; until then, store links.
- **Atlas network access:** Render's free plan has no fixed outgoing IP, so Atlas must allow connections from anywhere. Use a strong database password and a database user limited to the Stitch database.
- **Atlas M0 storage is about 512 MB.** That's plenty for testing. Watch the size of `messages` once real chats are uploaded.

**Before real customer data goes in:** move to paid tiers (always-on backend, a separate worker, backups) and review §11.4 on personal data in webhooks.
