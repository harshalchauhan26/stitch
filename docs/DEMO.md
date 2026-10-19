# Demo script: manual entry, the whole journey

About 10 minutes. Everything below is entered by hand; nothing is read from chats yet.

## Before the demo

```bash
cd api
npm run mongo:dev              # local MongoDB (once per restart of the machine)
npm run seed:demo -- --reset   # fresh demo org: 3 brands, 2 teams, 4 people, products. No leads.
npm run dev                    # API on :4000
cd ../frontend && npm run dev  # app on http://localhost:5173
```

Logins (password `stitch123`): `admin@stitch.test` (agency admin), `priya@stitch.test` (sales, Team Alpha: Noor Atelier + Kesar House), `meera@stitch.test` (pod lead, all brands), `arjun@stitch.test` (sales, Team Beta: Veda Menswear).

## 1. Each brand is set up its own way (admin, 2 min)

Sign in as **admin** → **Settings → Brands**.

- **Kesar House** has its **own pipeline**: New enquiry → Consultation → Design & trial → Quote sent → Advance pending → **Confirmed** (creates the order) / Dropped. Noor Atelier and Veda Menswear use the standard stages.
- Below it, **fields by stage**: what Kesar House must capture at each step. Blue **brand** fields are its own: *Trial mode*, *Resizing allowed*, *Trial date*.
- Click **New field for Kesar House** → e.g. *Blouse padding*, Yes/No, each product, Design & trial, Needed → **Add field**. It appears on every Kesar House lead immediately; other brands never see it.
- **Onboard a brand** → type *Kesar House* → it warns: *already onboarded, handled by Team Alpha*. Duplicates are stopped by the database, not just the screen.

## 2. A lead, entered by hand (sales, 3 min)

Sign out, sign in as **priya** (she only sees her team's brands).

- **Add lead** → brand **Kesar House**: the form shows Kesar House's pipeline and what it asks first.
- Phone, name, WhatsApp consent, a product (*Anarkali for sangeet*), event date, lead source → **Create lead**.
- The lead opens with its **gaps**: everything still missing for this stage.
- **Move to Consultation** → fill **Trial mode** (a brand field). **Move to Design & trial** → each product gets **Resizing allowed**.
- **Move to Quote sent** → quote amount ₹90,000. **Move to Advance pending**.
- **Move to Confirmed** → **refused**: *Advance amount* and *Payment link sent* are missing. This is a gate.
- **Record advance** → ₹27,000, Received, UPI ref → **Move to Confirmed** → **order created**. The brand's team gets a notification (bell) and, if the brand has a webhook, their system is told.
- **History** at the bottom: every change, old → new, who, which team, when.

## 3. The order, to the customer's door (2–3 min)

**Open the order** (same pipeline for every brand: Created → … → Delivered).

- Money: order value ₹90,000, paid ₹27,000, balance ₹63,000, all from the payments, never typed twice.
- **Move to Spec locked → Measurements**. Moving to Production is **blocked** until the customer signs off the measurements.
- Measurements → **Correct** → Waist 28, reason *measured on the video call* → saved as **version 2** (version 1 is kept). **Customer signed off** → Production is open.
- Production → QC approval: Customer approval *Yes*, QC result *Pass* → Ready to ship: verified address, Address confirmed *Yes*.
- **Create shipment** → **refused**: balance not paid. **Record payment** (₹63,000 received) → **Create shipment** → Dispatched → **Tracking shared** → **Delivered**.

## 4. The week at a glance (1 min)

**Dispatches**: shipments this week per brand, late ones (shipped after the promised date), and **every correction** made this week (shipments, specs, measurements) with who and why.

## Points to land

- Custom fields and pipelines per brand are set up by the agency at onboarding; no code changes.
- Nothing moves past a money or delivery gate without the data (a pod lead can override, with a reason, and it is logged).
- Every change is traceable to a person and a team.
- Chat reading (AI) plugs into the same fields later; today it is manual entry.
