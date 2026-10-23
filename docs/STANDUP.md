# Stand-up demo for the CTO (about 10 minutes)

Everything is pre-filled. You only type a courier name and one field label.

## Before the call (2 min)

```bash
cd api && npm run mongo:dev && npm run seed:demo -- --reset && npm run dev
cd frontend && npm run dev
```

1. Open http://localhost:5173 and sign in as **meera@stitch.test** / `stitch123`. Meera is a pod lead: she sees every brand and can change setup.
2. Top-left brand switcher: **All brands**.
3. Share **this browser tab** only.

**What's pre-filled:**
- **3 brands:** Noor Atelier, Kesar House (with its own stages), and Veda Menswear (with menswear fields).
- **13 customers at every stage**, including:
  - **Riya**, waiting on payment;
  - **Vikram**, ready to ship with a balance due.
- **4 orders:**
  - Meher, in production;
  - Vikram, ready to ship;
  - Kavya, shipped;
  - Nandini, delivered.

---

## The script

### 1. Home: "the morning view" (30 sec)
**Show:** the numbers row (open leads, blocking gaps, balance to collect, shipped this week) and "Close these first".
**Say:** *"Sales starts the day here. Red rows are blockers: things that will stop a lead or an order moving."*

### 2. Leads: each brand has its own journey (1 min)
**Click:** **Leads** → **Noor Atelier**, then **Kesar House**.
**Say:** *"Same app, different stages per brand. Noor has the standard ones; Kesar House has New enquiry → Consultation → Design & trial… → Confirmed. That was the CEO's ask. Cards show missing details as gaps."*

### 3. A gate in action: no order without the advance (2 min)
**Click:** **Noor Atelier** → **Riya Menon** card (Awaiting payment).
1. **Move to Won** → **refused**: *Advance amount, Payment link sent*.
2. **Record advance**. The amount is pre-filled at 30% of the quote. Set status to **Received**, then **Record**.
3. **Move to Won** → *order created* → **Open the order**.

**Say:** *"Gates protect money. Nobody can turn a lead into an order without the advance. The payment fields fill themselves from the payment, so nobody types money twice. Going to Won creates the order and notifies the brand's team, plus the brand's own system if it has a webhook."*

### 4. Fulfilment: no shipping before full payment (2 min)
**Click:** **Orders**. Set the top-left switcher to **All brands** if it isn't already. Then **Vikram Singh Rathore** (Ready to ship).
1. **Create shipment** → type **Delhivery** → **Save shipment** → **refused**: balance payment missing.
2. **Record payment**. The balance (₹85,000) is pre-filled. Click **Record received**.
3. **Save shipment** → the order is **Dispatched**.

**Say:** *"Same idea on the order side: no parcel leaves before full payment and a confirmed address. Measurements need the customer's sign-off before production, and every correction is saved as a new version."*

### 5. History: who did what (30 sec)
**Scroll** to the bottom of any lead or order panel → **History**.
**Say:** *"Every change is logged: old value → new value, who, which team, when. Two people editing at once can't overwrite each other."*

### 6. Modifying a brand's setup, no code (2 min)
**Click:** **Leads** → **Kesar House** → **Edit stages and fields**.
1. **Stages:** rename, add, reorder. You don't need to save; just show it.
2. **Fields:** flip **Trial date** from Optional to **Needed**. Every Kesar House lead missing it now shows a gap.
3. **New field for Kesar House** → type **Blouse padding** → **Add field**.

**Say:** *"The agency sets each brand up once at onboarding: stages, and which fields are optional or needed. Name, phone and product are always needed. The six money and delivery gates are admin-only."*

### 7. Weekly dispatches (30 sec)
**Click:** **Dispatches**.
**Say:** *"Ops sees what shipped this week, what's late, and every correction (wrong AWB, re-measurements) with who and why."*

---

## For the CTO: the tech in one breath (1 min)

- **Stack:** Node and Express, MongoDB with Mongoose, React with Vite. It replaced the SQLite prototype.
- **Data model:** per-brand stages and fields live in the database, so a new brand or field needs no code change.
- **Transactions:** Won → order, payments and dispatch each commit fully or not at all.
- **Edit conflicts:** each lead and order has a version number, so a stale edit is refused rather than overwriting.
- **Audit log:** every change, append-only.
- **Webhooks:** go through an outbox with retries.
- **Access:** RBAC with admin, pod lead, sales, ops and QC. People only see their teams' brands.
- **Tests:** 66 API tests against a real MongoDB, plus a browser run of the whole journey. A code review fixed 15 issues.

## If he asks…

| Question | Answer |
|---|---|
| Is it deployed? | Not yet. The code is on main and `render.yaml` is ready; the target is Render + MongoDB Atlas |
| Can it read the WhatsApp chats? | Not yet: manual entry first. Chat → fields with AI comes next, into the same fields |
| Shopify? | Next up: import each brand's products, and draft orders with a payment link |
| Can a brand change its stages later? | Yes: rename, add, reorder. A stage that still has leads can't be removed |
| Who can change what? | Admin: everything. Pod lead: stages, fields, overriding a gate with a reason. Sales: work leads only |
| Invite flow? | Admin creates accounts today. Email invites are a small next ticket |

## If something goes wrong live
- **The page looks empty or logged out:** sign in again as meera.
- **Vikram is missing on Orders:** set the top-left switcher to **All brands**.
- **After the call:** run `cd api && npm run seed:demo -- --reset` to put the demo data back.
