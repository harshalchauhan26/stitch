# Chat to lead: the end-to-end flow

A WhatsApp chat goes in, a model proposes values for the brand's own fields, a person confirms them, and the lead then
moves through the journey that already exists (stages, gates, order, shipment). Nothing is saved to a lead by the model:
every value is a suggestion until someone accepts it.

```
WhatsApp "Export chat" (.txt or .zip)
   │  Chats page → Upload                          POST /conversations          (code only: parse, store messages)
   ▼
Conversation (messages numbered 0..n, customer found by phone, brand from the WhatsApp number)
   │  Chats page → Read chat                       POST /conversations/:id/extract
   │     • start a new lead from the chat   {create_lead: true}
   │     • or fill an open lead             {lead_id}
   ▼
Context built from the database (nothing hard-coded per brand)
   │     • prompts/extraction.md          domain rules from the Field & Flow spec
   │     • every field the brand asks for  key, label, type, options, unit, limits, stage, level, conditions
   │       (not the computed payment fields, not the phone, not the product line)
   │     • what Stitch already knows       customer, lead fields, products
   │     • the brand's product catalogue
   │     • the numbered chat (newest EXTRACT_MAX_CHARS characters, default 8,000)
   ▼
Groq (services/llm.js)  →  JSON { suggestions[], new_items[] }, each with message number, confidence, quote
   ▼
Checked with the SAME code manual edits use (parseFieldValue, writableDef, clientInput)
   ├─ fits the schema  → pending suggestion       "Suggested from the chat" in the lead, and on the Chats page
   └─ does not fit     → exception, with a reason "Did not fit the schema" section (unknown field, field the brand
                                                   does not use, computed field, wrong type/range/option, bad item,
                                                   or model output that is not JSON)
   ▼
A person accepts or dismisses each value          POST /extractions/:id/accept | /dismiss
   ▼
Saved through the normal lead edit (PATCH /leads/:id path, source "chat", pointing at the message)
   → history shows it, the version check still applies, gaps shrink, undo works
   ▼
Lead → stages (gates) → Won → order → measurements → production → QC → shipment → delivered   (all existing)
```

## What "fill everything that can be filled" means

- The model is offered every fillable field of that brand, per scope: **customer** (name, consent, email, city, customer
  type), **lead** (event, quote, delivery, budget and so on), **each product** (spec, measurements, quantity, wearer, price)
  and the brand's **own custom fields**. Hidden fields are not offered, so they can never be filled.
- The Result panel reports what was **found**, what was **already filled**, and what the chat **did not cover**.
- Amounts are given in rupees and converted to paise in code. Centimetre measurements are converted to inches by the
  existing parser. Dates are resolved against today's date.
- A new lead gets its **product lines** at creation (the structure the rest hangs on); every other value waits for a person.
  Products the chat adds to an existing lead come back as suggestions too.
- A new read replaces the pending suggestions of earlier reads for the same lead.

## Using it

1. Put `GROQ_API_KEY` in `api/.env` (see `.env.example`). Restart the API.
2. **Chats** in the sidebar → pick the brand's WhatsApp number → choose the export → **Upload chat**.
   If the customer's number is not in the file name, type it in.
3. Pick **Start a new lead from this chat** (or an open lead of that customer) → **Read chat**.
4. Review: accept or dismiss each value, read the exceptions, open the lead.

## Limits to know

- Groq's on-demand tier allows 8,000 tokens per minute, answer included. So only the newest `EXTRACT_MAX_CHARS`
  (default 8,000) characters of a long chat are read and the answer is capped at `EXTRACT_MAX_TOKENS` (default 2,500).
  The panel says when a chat was cut. After upgrading the Groq tier, raise both. Reading twice within a minute can
  still hit the limit; wait a minute and retry.
- Customer names and numbers are sent to Groq as written (no masking, by decision).
- Fields on an item the chat adds to an *existing* lead cannot be filled in the same read: accept the product, then read
  the chat again.
- Order-stage fields (karigar, QC and so on) are entered by ops after Won and are not read from chats.
