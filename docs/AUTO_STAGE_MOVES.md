# Automatic stage moves: proposal

**Status: proposal only. Nothing in this document is built.** It lists which moves could safely happen on their own, which
should only be suggested, how each would be audited and undone, and what has to be decided before any code is written.

---

## 1. What happens today

Read from `services/leads.js`, `services/orders.js`, `services/fulfilment.js`, `services/payments.js`, `services/gaps.js`.

| Record | Moves on its own today? |
|---|---|
| **Lead** | **No.** The only way to change a lead's stage is `moveStage` (the "Move to…" button or a board drag): forward moves must pass the gates, backward moves need a reason, a pod lead or admin can override a gate with a reason. The `ready_for_next` hint promised in PLAN §7.3 was never built |
| **Order → Dispatched** | **Yes, already.** `createDispatch` moves the order to Dispatched, after it passes the Dispatched gates (balance paid, address confirmed). A manual move to Dispatched is refused (`use_shipments`) |
| **Order → Delivered** | **Yes, already.** `updateDispatch` moves the order to Delivered when every shipment is delivered AND every item has shipped. A manual move is refused |
| Every other order move | No, manual |

Also automatic today, but these are **field values, not stage moves**: the lead's payment fields (advance amount, payment link
sent, payment mode, transaction ID, received date), the order's `paid`, `balance_due` and `balance_payment`,
`customer_sign_off` (from the measurements) and `tracking_shared` (from the shipments). They are recalculated inside the same
transaction as the change that causes them and recorded with `source: 'system'`.

Two things worth noting about the existing automatic moves:
- Their history entries are the dispatch events (`dispatch.created`, `dispatch.updated`), with the stage change inside, and
  `source` is `manual`. The History panel therefore does **not** show its "auto" chip for them.
- Nothing can be undone for a stage move except moving back by hand (always allowed, reason required). `undoEvent` only handles
  field edits (`field.set`, `item.updated`).

## 2. When is automatic acceptable?

A move should happen without a click only if **all** of these hold:

1. It is fully determined by data Stitch itself holds or calculates (not a judgement a person should make).
2. It has no side effect outside the record (no webhook, no notification to a brand, no order created).
3. It is reversible with one action.
4. It never crosses a gate by override: an automatic move only happens when `blockersForMove` is empty.
5. It never goes into **Won** or **Lost**. Won creates the order, notifies the brand's team and its webhook, and cannot be
   undone. Lost needs a reason from a person.

Anything that fails one of these should be a **suggestion** ("Ready to move to Quoted" with a button) and never a silent move.

## 3. Candidate moves

"Suggest" = the screen shows "Ready for X" with a one-click button that uses the normal move (so gates, history and the version
check all apply). "Auto" = the system performs the move itself.

| # | Trigger | Move | Recommended | Why |
|---|---|---|---|---|
| **G** | Every Needed and Blocking gap of the current stage (and earlier ones) is cleared | Lead or order → the next stage | **Suggest** (optional per-brand **auto** for early lead stages) | The spec's "Moves on when" column is mostly covered by gaps, but "ready" is still a judgement: sales may want to keep qualifying. Delivers the never-built `ready_for_next` hint |
| **P** | Advance payment is `received` while the lead is in its last open stage ("Awaiting payment") and the Won gates pass | Lead → Won | **Suggest only. Never auto** | Fails rule 2 and 3: creates the order, notifies the brand, cannot be undone. A payment recorded by mistake would create a real order |
| **S** | The last unsigned product is signed off (`customer_sign_off` becomes Yes) while the order is in Measurements | Order → Production | **Suggest** (good candidate for opt-in **auto**) | Computed by Stitch from sign-offs, gate satisfied, no side effect, reversible |
| **Q** | `qc_result` = Pass and `customer_approval` = Yes while the order is in QC approval | Order → Ready to ship | **Suggest** | Two human judgements (QC, customer approval) |
| **D1** | Shipment created | Order → Dispatched | **Keep automatic** (already) | Add the "auto" marker to its history entry |
| **D2** | All shipments delivered and all items shipped | Order → Delivered | **Keep automatic** (already) | Same |
| **R** | A measurement correction flips `customer_sign_off` back to No after Production started | Order stays where it is | **Flag, do not move back** | Production may already be under way. Show a warning on the order and in Gaps instead |
| **X** | Customer silent for N days | Lead → Lost | **Not recommended** | Needs a reason and a person. A "stalled" flag (the spec's risk score) is the safer first step |

Rows G, P, S and Q are the real decisions; D1 and D2 only need the audit label fixed.

## 4. How it would be built

- **One helper**, `advanceIfReady(session, scope, recordType, record)` in a new `services/advance.js`. It recomputes gaps with the
  existing `computeGaps` / `blockersForMove`, checks the rule table, and either performs the move or returns a suggestion.
  No new gate logic: it reuses what already decides a manual move.
- **Called at the end of the transactions that change its inputs**, after the gap counts are recalculated: `updateLead`,
  `syncLeadPayments`, `syncOrderPayments`, `updateOrder`, `syncOrder` (sign-off and tracking), and `decide` in
  `extraction.js` (once after a whole batch of accepted chat values, not after each value).
- **One hop per trigger.** A single edit never chains through several stages, so nothing jumps further than a person would expect.
- **Writes through `commitWrite`**, like every other change: version check, one event, same transaction.
- **Suggestions** are computed on read, not stored: `ready_for_next` and `next_stage` on the lead and order views, shown as a
  banner with a button in the drawers and a small chip on board cards.
- **Switches** live per brand next to the existing `won_requires_payment_received`:
  `brand.defaults.auto_moves = { G: 'off' | 'suggest' | 'auto', S: ..., Q: ... }`. This is a **small schema addition** on `brands`
  and a toggle in Settings → Brands. Default for every rule: `suggest`. `P` has no `auto` option.

## 5. Audit

- New event types `stage.auto_moved` (lead and order) with `source: 'system'` and
  `data: { rule: 'S', trigger: 'measurements.signed_off', from, to }`.
- The History panel already shows an **auto** chip for `source: 'system'`, so no UI work is needed there.
- **Actor.** Services always run on behalf of a person, so the event keeps that person (and their team) as the actor: "Priya, Team
  Alpha, auto". The alternative is a pseudo-actor `{ name: 'Stitch', role: 'system' }`; the actor fields are all optional in
  `ActorSchema`, so either works. Keeping the person is better for "who caused this", and the `auto` chip and `data.rule` say it
  was the system.
- D1 and D2 get `data.rule` too, and `source: 'system'` on the stage change.

## 6. Undo

- Extend `undoEvent` to accept `stage.auto_moved`, and add the same route for orders (`POST /orders/:id/undo/:eventId`, which
  does not exist today).
- Allowed only while the record is still in the stage it was moved to and nobody has moved or edited it since (same "nothing
  changed since" rule the field undo already uses). It restores the previous stage, needs no reason, and writes
  `stage.auto_move_undone`.
- **Loop protection:** `advanceIfReady` skips a rule if the latest event on the record is the undo of that rule's move, so an
  undone move is not immediately redone. Any later edit lets it evaluate again.
- Won is not undoable (an order exists), which is the main reason rule P is never automatic.

## 7. Tests that would be added

- G: gaps cleared → suggestion appears; with `auto` on → moves exactly one stage; blocked by a blocking gap → no move.
- S: last sign-off → Production suggested / moved per setting; a correction after Production does not move the order back.
- P: payment received → "Won" suggested, never performed, even with every switch on.
- No chaining, an event with the right actor, source and data, undo restores the stage, no immediate re-advance after undo.
- Switch off → nothing changes.

## 8. Decisions needed before any code

1. **Default policy:** suggest everywhere except the two moves that are already automatic (D1, D2)? Or do you want any rule on
   `auto` by default?
2. **Row G (all gaps cleared → next stage):** suggest only, or allow a per-brand opt-in to `auto` for early lead stages
   (New → Qualifying → Customising)?
3. **Row P (payment received → Won):** suggest only (recommended)? The alternative is an opt-in that auto-creates the order, which
   cannot be undone.
4. **Order rows S and Q:** suggest or auto? S (all measurements signed off → Production) is the safest to automate.
5. **Where the switches live:** per brand (a small schema addition on `brands.defaults`, recommended) or one global setting?
6. **Undo:** build it as described (needed if anything is `auto`), or skip it if everything is suggest-only?
7. **Actor:** keep the triggering person as the actor with an `auto` chip (recommended), or a "Stitch" system actor?
