# WhatsApp chat → lead, read by Groq

What was built, which data it touches, how the data flows, which functions were added, and how to test it.
For the short flow chart see [EXTRACTION_FLOW.md](EXTRACTION_FLOW.md); for the original design see
[PLAN_v1.md](PLAN_v1.md) §10.4 ("Ready for AI later").

---

## 1. What this is

A person uploads a WhatsApp **Export chat** file. An LLM (Groq) reads the chat against **the brand's own field schema**
and proposes values for the lead's fields. A person reviews every value and accepts or dismisses it. Whatever the model
says that does not fit the schema is reported in a separate **exceptions** section. The lead then continues through the
journey that already existed (stages and gates → Won → order → fulfilment).

Decisions that shaped it:

| Decision | Why |
|---|---|
| The model only **suggests**; a person accepts | The spec's Q11: "suggest a value, with a person confirming". A wrong value never reaches a lead on its own |
| Every value goes through the **same code as a manual edit** | The model cannot set anything a person could not type in. The schema stays the single source of truth |
| Fill an existing lead **or start a new lead** from the chat | Asked for; a chat is often the first thing that exists for a customer |
| The schema (`field_defs`, `required_rules`) is **not changed** | It was already defined; the model is *given* it, per brand, at read time |
| Groq is the LLM | Key provided; one file (`services/llm.js`) talks to it, so the provider can change later |
| Customer names and numbers are sent to Groq **unmasked** | Decided: no masking |

---

## 2. What changed

### 2.1 Data / schema

| Area | Change |
|---|---|
| `field_defs`, `required_rules`, `brand_templates` | **None.** Read-only input for the model |
| `leads`, `clients`, `orders`, `payments` ... | **No new fields.** Accepted values are written into the existing fields |
| **New collection `extractions`** | One document per model run: `tenant_id`, `brand_id`, `lead_id`, `conversation_id`, `model`, `requested_by`, `stats`, `suggestions[]`, `exceptions[]`, timestamps |
| `extractions.suggestions[]` (embedded) | `scope` (client / lead / item / new_item), `field`, `label`, `type`, `item_id`, `value`, `previous`, `confidence`, `evidence`, `source_message_id`, `status` (pending / accepted / dismissed / failed), `error`, `decided_by`, `decided_at` |
| `extractions.exceptions[]` | `{ code, scope, field, item, value, reason, message_id, evidence }` |
| `extractions.stats` | `messages_total`, `messages_read`, `truncated`, `fields_offered`, `suggested`, `exceptions`, `found`, `already_filled`, `not_found[]` (the coverage report) |
| Indexes | `{tenant_id, lead_id, created_at}` and `{tenant_id, conversation_id, created_at}` |
| Existing values now used | `lead.intake_method = 'Chat export'` (already in the enum) for leads created from a chat. Lead history events get `source: 'chat'` and `source_message_id` (both already existed, PLAN §8) |
| Existing messages / conversations | Unchanged. After a read, the chat is linked to the lead (`conversations.lead_links`, same as linking by hand) |

The collection is created automatically at start-up (`ensureSchema()` creates every model's collection and indexes).

### 2.2 Files

New:

| File | What it is |
|---|---|
| `api/src/services/extraction.js` | All the logic: what the model may fill, building the prompt, checking the answer, running a read, accept / dismiss |
| `api/src/services/llm.js` | The only code that calls Groq (`complete()`), plus `setLlm()` for tests |
| `api/src/routes/extraction.js` | The five HTTP endpoints |
| `api/src/prompts/extraction.md` | The domain rules given to the model (distilled from the Field & Flow spec) |
| `api/tests/extraction-validate.test.js` | 10 tests of the checking logic, no database |
| `api/tests/extraction.test.js` | Integration tests with a mocked model (needs MongoDB) |
| `frontend/src/pages/Chats.jsx` | The Chats page: upload, list, read, review |
| `frontend/src/components/Suggestions.jsx` | The review list (suggestions, exceptions, coverage), shared by Chats and the lead drawer |
| `docs/EXTRACTION_FLOW.md`, `docs/wp-groq.md` | Documentation |

Changed (small):

| File | Change |
|---|---|
| `api/src/models/crm.js` | Added the `Extraction` model (above) |
| `api/src/app.js` | Mounts `extractionRouter` |
| `api/src/services/leads.js` | `writableDef` is now `export`ed so extraction reuses the exact edit gate |
| `api/.env.example`, `api/README.md` | New env vars and endpoints |
| `frontend/src/api/http.js` | 10 new client calls |
| `frontend/src/components/LeadDrawer.jsx` | "Suggested from the chat" section |
| `frontend/src/App.jsx`, `Sidebar.jsx`, `Shell.jsx`, `Home.jsx`, `AddLead.jsx`, `lib/Icon.jsx` | Chats route, sidebar link, `g c` shortcut, links from Home and Add lead, a chat icon |

---

## 3. How the data flows

```
1. UPLOAD   Chats page → POST /conversations              (existing; code only, no model)
              file.txt/.zip → text → parseWhatsApp() → messages numbered 0..n
              brand = the WhatsApp number's brand; customer = the number in the file name (clients, by phone)

2. READ     "Read chat" → POST /conversations/:id/extract   { lead_id } | { create_lead: true }
   a. checks that can refuse, BEFORE any model call: chat visible, lead open and same brand,
      customer has no other open lead (unless confirm_new_purchase)
   b. build context from the DB:
        fillable(rb)    the brand's fields (required_rules → field_defs), minus computed / phone / product
        buildPrompt()   system = guide + field list + product catalogue
                        user   = today's date + what is already known + the numbered chat (newest 8,000 chars)
   c. complete()        Groq → JSON { suggestions[], new_items[] }
   d. liftProducts()    a product listed as a "field" is moved to new_items
   e. new lead only:    createLead() with the product lines (intake_method 'Chat export'); nothing else is written
   f. validateOutput()  every value → writableDef + parseFieldValue + clientInput  (the manual-edit gate)
        fits           → pending suggestion (value already in stored form: paise, canonical option, inches)
        does not fit   → exception with a code and a reason
        same as stored / empty / weaker duplicate → dropped quietly
   g. coverage()        which offered fields were found / already filled / not in the chat
   h. save one `extractions` document; mark older pending suggestions for the lead as dismissed; link chat ↔ lead

3. REVIEW   Chats page (right after the read) and the lead drawer ("Suggested from the chat")
              Accept / Dismiss per value, or all; exceptions and "fields the chat did not cover" shown apart

4. ACCEPT   POST /extractions/:id/accept
              for each pending suggestion: editFor() → updateLead({ version, source: 'chat', source_message_id })
              → the normal lead edit: version check, audit event, gap recount, undo
              a suggestion that cannot apply any more is marked 'failed' with the reason; the rest still go through

5. AFTER    the lead continues as before: stage moves and gates → Won → order → shipments
```

Where each kind of value ends up:

| Suggestion scope | Written to (on accept) |
|---|---|
| `client` | `clients` (`name`, `email`, `city`, `whatsapp_consent`, `customer_type`) |
| `lead` | `leads.fields.<key>` |
| `item` (quantity / wearer / unit_price) | the item itself on `leads.items[]` |
| `item` (anything else, e.g. neckline, waist) | `leads.items[].fields.<key>` |
| `new_item` | a new entry in `leads.items[]` |

What the model is **offered**: every field the brand asks for on a lead, for the customer, the lead and each product,
including the brand's own custom fields, plus `wearer` and `unit_price` for items. **Never offered**: fields Stitch
computes from payments (advance amount, payment link sent, payment mode, transaction ID, payment received date, link
expiry), the phone number, and the product line (products come through `new_items`). Order-stage fields are not read
from chats.

---

## 4. Functions added

`api/src/services/extraction.js`

| Function | Purpose |
|---|---|
| `fillable(rb)` | The fields the model may fill for a brand, from its rules |
| `schemaFor(fill)` / `schemaText(fill)` | The field list as objects / as one short line per field (the form sent to the model) |
| `buildPrompt({...})` | Builds the system and user messages; keeps the newest part of a long chat; returns `read` and `truncated` |
| `parseJson(text)` | Strips a code fence, parses the model's answer; invalid JSON is a clear 502 |
| `liftProducts(out)` | Moves a product the model listed as a field (`product`, `sku`) into `new_items`, with its quantity |
| `readNewItems(out, ctx)` | Validates the products; matches the catalogue by SKU; bad ones become exceptions |
| `validateOutput(out, ctx)` | The core check: every value through the manual-edit code; returns suggestions, exceptions and the set of filled keys |
| `coverage(fill, ctx)` | Found / already filled / not in the chat, per field (per product for product fields) |
| `extractionDto(e)` | The API shape of a run |
| `extractFromChat(scope, convId, body)` | One whole read (steps 2a–2h above) |
| `editFor(s)` | Turns one suggestion into the body of an ordinary lead edit |
| `decide(scope, extractionId, body, action)` | Accept or dismiss pending suggestions |

Small helpers inside the file: `money()` (rupees → paise), `same()` (equal ignoring case for text), `ATTR` (validators for quantity / wearer / unit_price), `clamp()`, `evidenceOf()`.

`api/src/services/llm.js`: `complete({ system, user })` → `{ text, model, cutOff }`, `setLlm(fn)` for tests.

Frontend: `Chats` (page), `Upload` and `ChatPanel` (inside it), `readExport()` (opens a `.zip`), `Suggestions` (component), and in
`LeadDrawer`: `decideChat()`.

### Endpoints (all under `/api`, behind the normal login)

| Method and path | Does |
|---|---|
| `POST /conversations` | (existing) upload a chat export |
| `GET /conversations/:id/suggestions` | (existing) the customer's open leads, used for "fill an existing lead" |
| `POST /conversations/:id/extract` | **New.** Read the chat. Body `{ lead_id }` or `{ create_lead: true, owner_id?, confirm_new_purchase? }` |
| `GET /conversations/:id/extractions` | **New.** Earlier reads of a chat |
| `GET /leads/:id/extractions` | **New.** Earlier reads for a lead |
| `POST /extractions/:id/accept` | **New.** Body `{ suggestion_ids? }` (none = all pending) |
| `POST /extractions/:id/dismiss` | **New.** Same body |

Access is the same as everywhere: another brand's chat, lead or run answers 404.

### Exception codes

| Code | Meaning |
|---|---|
| `unknown_field` | Stitch has no such field |
| `computed` | Filled by Stitch from payments |
| `not_allowed` | Phone number, or a product given as a field |
| `not_used` | The brand does not use this field |
| `bad_item` | The item number is not on the lead |
| `invalid_value` | Wrong type, range, option, date, email ... (the message is the one a manual edit would show) |

Whole-run errors: `llm_not_configured` (503, no key), `llm_error` (502, Groq refused or was unreachable, message passed
through), `llm_bad_output` (502, not JSON), `llm_cut_off` (502, answer hit the token cap), `open_lead_exists` (409),
`lead_closed` (409).

---

## 5. Configuration (`api/.env`, never committed)

| Variable | Meaning |
|---|---|
| `GROQ_API_KEY` | Required to read chats. Without it uploading still works, reading answers 503 |
| `GROQ_MODEL` | Default `llama-3.3-70b-versatile`. **A key only sees the models its organisation can use**: this project's key uses `openai/gpt-oss-120b` |
| `EXTRACT_MAX_CHARS` | Newest part of a chat sent to the model. Default 8,000 |
| `EXTRACT_MAX_TOKENS` | Cap on the model's answer. Default 2,500 |

Groq's on-demand tier allows **8,000 tokens per minute, answer included**. The defaults keep one read under that
(instructions + field list ≈ 2,300 tokens, chat ≤ 8,000 chars ≈ 2,300, answer ≤ 2,500). After upgrading the Groq tier,
raise the two caps to read longer chats. Reading twice within a minute can still hit the limit: wait a minute.

---

## 6. How to test

### 6.1 Automated

```bash
cd api
npm run mongo:dev                         # local MongoDB replica set on port 27018 (once per machine restart)
npm test                                  # everything: 82 tests

node --test tests/extraction-validate.test.js   # only the checking logic: no database, no key, runs anywhere
node --test tests/extraction.test.js            # only the API flow with a mocked model (needs mongo:dev)
```

What they cover:

| File | Checks |
|---|---|
| `extraction-validate.test.js` | The field list offered (right fields in, computed / phone / product out); the prompt (schema, known values, numbered chat, long chat keeps the newest part); dates, rupees → paise, cm → inches, option casing; item attributes and customer details; every exception code; quiet drops (empty, same as stored, weaker duplicate); "was X" when a value changes; products as `new_items`, SKU matching, quantity limits; a product listed as a field is lifted; the coverage report |
| `extraction.test.js` | Create a lead from a chat (product lines created, nothing else saved); the prompt contains the schema and the chat; accept saves through the normal edit with `source: 'chat'` and a message id; a second read for the same customer asks for confirmation; dismiss leaves the lead alone and a new read replaces pending values; one failing suggestion does not stop the others; other brands get 404; no key → 503; invalid JSON → 502 |

If MongoDB is not running every test that needs it fails after 5 seconds (connection timeout): start `npm run mongo:dev`.
On Windows it needs `mongod` on PATH (`C:\Program Files\MongoDB\Server\9.0\bin`).

### 6.2 By hand, in the app

1. Start everything (three terminals, or background tasks):
   ```bash
   cd api && npm run mongo:dev
   cd api && npm run seed:demo            # only the first time: demo brands, people, WhatsApp numbers (does not wipe)
   cd api && npm run dev                  # API on :4000, reads api/.env
   cd frontend && npm run dev             # app on http://localhost:5173
   ```
2. Sign in as `priya@stitch.test` / `stitch123` (sales, Noor Atelier + Kesar House).
3. Save the sample chat below as `WhatsApp Chat with +91 98765 43210.txt` (the number in the name identifies the customer).
4. Sidebar → **Chats** → choose **Noor Atelier · +91 98111 00001** → pick the file → **Upload chat**. The chat opens on the right.
5. Keep **Start a new lead from this chat** → **Read chat** (a few seconds).
6. Check the result:
   - suggestions with a confidence and a quote each (name, city, email, event date, budget, lead source, consent, quote ...);
   - for each product: neckline, lining, sleeves, border, colour, fabric and the three measurements (cm converted to inches);
   - **Did not fit the schema** and **fields the chat did not cover** (collapsed) for the rest.
7. **Accept all** → **Open LD-xxxx**: the values are in the lead, the history shows them with the source *chat*, and the gaps went down.
8. Try the guards: **Read chat** again → it warns the customer already has an open lead (fill it instead, or confirm a separate purchase).
   Dismiss one value, then read again: the earlier pending ones are replaced.
9. Remove the key from `api/.env` and read again: the page shows "GROQ_API_KEY is not set".

Sample chat (14 messages, Hinglish, lakh amounts, cm measurements, two products):

```
[05/10/26, 11:02:10 AM] Noor Atelier: Hello! Thank you for reaching out to Noor Atelier. How can we help?
[05/10/26, 11:04:31 AM] +91 98765 43210: Hi, I saw your crimson zardozi lehenga on Instagram. Shaadi hai meri 18 December ko
[05/10/26, 11:05:02 AM] Noor Atelier: Congratulations! Which city will you be delivering to?
[05/10/26, 11:06:40 AM] +91 98765 43210: Pune. Mera naam Sneha Kulkarni hai, sneha.k@gmail.com pe bhej dena details
[05/10/26, 11:07:15 AM] Noor Atelier: Lovely Sneha. What budget are you thinking of?
[05/10/26, 11:08:50 AM] +91 98765 43210: Around 2.5 lakh. I need it delivered by 5 December latest
[05/10/26, 11:10:21 AM] Noor Atelier: Our Bridal lehenga crimson zardozi is Rs 2,45,000, 60 days lead time
[05/10/26, 11:12:05 AM] +91 98765 43210: Okay. Sweetheart neckline please, with gold lining. Sleeves elbow length
[05/10/26, 11:13:40 AM] +91 98765 43210: Also a net dupatta in blush with scalloped gota border, 1 piece
[05/10/26, 11:15:02 AM] Noor Atelier: Noted. Can you share your measurements?
[05/10/26, 11:18:30 AM] +91 98765 43210: Bust 86 cm, waist 71 cm, hip 96 cm. Blouse size custom hi rakhna
[05/10/26, 11:19:44 AM] Noor Atelier: Perfect. Shipping to Pune is Rs 1,500. Shall I send the quote?
[05/10/26, 11:20:10 AM] +91 98765 43210: Yes please send. And yes WhatsApp pe hi baat karna
[05/10/26, 11:22:00 AM] Noor Atelier: Quote sent: Rs 2,46,500 all inclusive, valid till 12 Oct
```

Real exports: WhatsApp → chat → **Export chat → Without media** gives a `.txt`; with media gives a `.zip`, which the page also accepts.

### 6.3 Results from the live check

Run on a throwaway database with the chat above and `openai/gpt-oss-120b` (3–4 seconds per read):

- Found and validated: name, city, email, lead source, event date, occasion, delivery deadline, budget (2.5 lakh → 25,000,000 paise),
  currency, WhatsApp consent, neckline, lining colour, sleeve style, border, colour, fabric, size category, blouse size and the three
  measurements (86 / 71 / 96 cm → 33.75 / 28 / 37.75 in). 21 suggestions, 0 exceptions, all 21 accepted without a failure.
- The model varies a little between runs: on one run it also captured the quote amount, status and validity; on another it did not.
  Shipping cost was missed in both. Anything missed shows under "fields the chat did not cover".

---

## 7. Problems met and how they were solved

| Symptom | Cause | Fix |
|---|---|---|
| Every test in a file fails after 5 s | No MongoDB running (the driver times out) | Install MongoDB, `npm run mongo:dev` |
| `model_not_found` from Groq | The key's organisation cannot use `llama-3.3-70b-versatile` | `GROQ_MODEL=openai/gpt-oss-120b` in `api/.env` |
| `413 Request too large ... TPM Limit 8000, Requested 10258` | Prompt + chat + reserved answer over the per-minute limit | Compact field list (one line per field), chat cap 8,000 chars, answer cap 2,500 tokens, low reasoning effort |
| Lead created with no products; every product detail rejected as `bad_item` | The model listed `product` / `sku` as fields instead of `new_items` | `liftProducts()` plus a clearer instruction in `prompts/extraction.md` |
| An API key ended up in `.env.example` | The example file is tracked by git | Moved to `api/.env` (git-ignored); the example is blank |

---

## 8. Limits and not built yet

- Only the newest `EXTRACT_MAX_CHARS` characters of a long chat are read (the panel says so).
- Details of a product the chat adds to an **existing** lead cannot be filled in the same read: accept the product, then read again.
- **Lead stage** and **hot / warm / cold** are not suggested yet. The model fills fields only; the stage is a separate property that
  only moves through the gated "Move to…" action, and the schema has no temperature field (the closest is *Priority*). A plan for
  both was proposed and is waiting for approval.
- Nothing is committed to git yet; all of this is in the working tree for local testing.
