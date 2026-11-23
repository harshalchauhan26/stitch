# WhatsApp agent: research and direction

Researched 5 Nov 2026. The goal (from Rishab): an agent that suggests replies to the sales team on WhatsApp, and pulls chat data into Stitch (the CRM) through the API.

Most sources are vendor blogs (BSPs). Check numbers against Meta's own docs before committing money.

## 1. What Meta sells inside the WhatsApp Business app

**Meta Business Agent:** Meta's own AI inside the Business app.
- It replies to customers by itself: FAQs, product recommendations, bookings, lead qualification. It hands off to a person when stuck.
- You train it with Google Drive files, the catalogue, past chats and example answers. Connecting Drive works only from the phone app and can take up to 12 hours.
- It's a closed box:
  - no API to pull its conversations or the leads it qualified into our CRM;
  - it doesn't give *suggestions* to our sales team; it answers the customer directly.

**Meta One (Essential / Advanced, about ₹2,099 a month for Advanced):** a subscription for app features.
- **What it gives:** the verified badge, broadcast credits, more linked devices, team access, and more Business Agent replies.
- **What it doesn't give:** API access or any way to get data out.

**Verdict:** it's useful for after-hours FAQ answering. It doesn't do what we want (data into Stitch, suggestions for sales).

## 2. What gets us there: Coexistence (Business app + Cloud API on the same number)

- **How it works:**
  - Each brand's existing number stays on the WhatsApp Business app, so the sales team keeps chatting on the phone exactly as today.
  - The same number is also connected to the official Cloud API, directly or through a BSP such as 360dialog, Interakt or AiSensy.
- **What Stitch receives by webhook:**
  - `messages`: every customer message, including media (photos, voice notes);
  - `smb_message_echoes`: every reply the team sends from the phone or a linked device;
  - `history`: up to about 6 months of past 1:1 chats, one time. It **must be requested within 24 hours of onboarding**, and the business must agree to share it in the app;
  - `smb_app_state_sync`: the phone's contacts.
- **Limits:**
  - **Groups don't sync.** Brand WhatsApp groups stay outside the API.
  - Broadcast lists in the app become read-only; send broadcasts through the API as templates instead.
  - All linked devices are logged out at onboarding and must be re-linked (about 4 companions; WhatsApp for Windows isn't supported).
  - Throughput is capped (sources say 5–20 messages per second; fine for us).
  - The blue tick may not carry over. Check this before paying for Meta One verification.
  - Some 1:1 features are off: disappearing messages, live location.
  - India availability: newer sources (June 2026) say it's live globally, including India. Confirm with the BSP.
  - The number must already be in active use (not brand new) and pass Meta's quality checks.
- **Linked-device slots:**
  - The API **does not take a linked-device slot**. Meta sends messages to Stitch from its servers by webhook. It isn't a WhatsApp Web session, although no source says this outright.
  - A "bot on a linked device" (WhatsApp Web automation such as whatsapp-web.js or Baileys) does take a slot. It's also unofficial, and the number can get banned.
  - Under Coexistence the cap is 4 companion devices plus the phone. Meta One's "6 devices" may not apply on a Coexistence number. This is unconfirmed.
  - If more people need access, they work from Stitch's inbox, which has no device limit.
- **Policy:** Meta banned *general-purpose* AI chatbots (ChatGPT-style) from the API from 15 Jan 2026. A brand's own sales and support assistant is explicitly allowed, so we're fine.

### Does Coexistence lose data? (researched 6 Nov 2026)
Our dev reports an account where data was lost and the account reset. From Meta's docs and providers' docs:
- **The chats on the phone are not deleted.** Meta converts the existing account in place: same number, same account ID, and the app keeps working.
- **What looks like a reset but isn't:**
  - linked devices log out and show little history after re-scanning;
  - the account becomes a "Messaging account" in Meta's systems;
  - in the provider's tool, chats show only if history was shared on the phone **and** requested within 24 hours.
- **What really loses data:**
  - **The provider doesn't support Coexistence.** Entering a number that's already on the app into a normal API signup asks you to **delete the app account**, and that wipes the chats.
  - Deleting the app account, or uninstalling the app, during or after setup.
  - Disconnecting from the provider's side rather than from the app (Settings → Account → Business Platform → Disconnect).
- **What stops the sync:** leaving the phone unopened for about 14 days, or reinstalling or moving to a new phone without the "keep connected" option.
- **Requirements:** WhatsApp Business app 2.24.17 or newer (not normal WhatsApp), and the provider must be a Meta Solution Partner or Tech Provider with Coexistence switched on. Meta's flow starts Coexistence automatically when the number is already on the Business app.

**Follow-up research, 12 Nov 2026:**
- **No source reports Coexistence deleting chats on the phone.** Meta's page says history "stays in sync between both apps".
- **Where the "it erases chats" rumour likely comes from:**
  - Providers without Coexistence support. Intercom, for example, still requires deleting the number from the Business app before connecting.
  - Providers that never request the history. Whatomate issue #613 (Nov 2026): users started with an empty inbox and had to offboard and onboard again after 24 hours.
- **Media:** only media from about the 14 days before onboarding comes across.
- **Embedded Signup:** v2 and v3 were deprecated on 15 Oct 2026, so a provider must be on v4.
- **Meta One:** a Business app subscription (launched for businesses around Sept 2026). It gives no API access and no chat export. Business Agent's self-serve version has no CRM or API connection either.

**Safety checklist for the pilot:**
1. Back up chats to Google Drive from the phone and update the app.
2. Use a low-stakes brand number.
3. Pick a provider that says "Coexistence" by name. If a screen ever asks to delete the WhatsApp account, stop.
4. Tap **share history** on the phone, and make sure the history request goes out within 24 hours.
5. The next day, check the phone still has every chat, re-link the 4 devices, and confirm messages are reaching Stitch.
6. Open the app at least weekly, and never uninstall it.

### Runbook: connecting a number without losing data (23 Nov 2026)

**The problem Harshal hit:** Meta warned that the data might be deleted.

**Most likely cause:** he added the number in Meta's **developer dashboard** (developers.facebook.com → the app → WhatsApp → API Setup → "Add phone number"). That screen is the **plain Cloud API sign-up, not Coexistence**.
- For a number that's already on WhatsApp, it asks you to **delete the WhatsApp account first**, so the warning is real.
- A number registered that way **can't use Coexistence later**: Meta's Embedded Signup page says numbers created through the developer app can't be onboarded through it.

**Why it happens:** Coexistence isn't available from the developer dashboard. Meta only offers it through **Embedded Signup run by a Solution Partner or Tech Provider**, with the Business-app option switched on.

**Other possible causes** (check them with step 1):

| Cause | How to tell | Fix |
|---|---|---|
| The number is on **normal WhatsApp**, not the Business app | The app icon has no "B" | Move it to WhatsApp Business first (chats move with it), then use Coexistence |
| The Business app is too old | Below 2.24.17 | Update the app |
| The number was **already registered as API-only** during the "verification" | It shows in WhatsApp Manager as connected, and the app on the phone was logged out | Use it as a pure API test number, or delete it from WhatsApp Manager and start again on the Business app |
| The warning is only the normal Coexistence notice | It talks about linked devices, disappearing messages or broadcast lists, not deleting the account | Fine. Continue |
| The provider doesn't support Coexistence | It asks to delete the account | Use a provider that names Coexistence (360dialog, YCloud, Interakt, AiSensy) |

**Steps:**

0. **Stop.** On any number with real chats, don't press anything that says delete, remove or migrate the account.
1. **Screenshot the warning** and note which website or app showed it. That shows which cause above it is.
2. **Back up the real numbers first** (your idea):
   - On the phone: WhatsApp Business → Settings → Chats → Chat backup → Back up to Google Drive, including videos.
   - For the important customer chats: open the chat → ⋮ → More → Export chat (without media), then upload it on Stitch's **Chats** page. That data is then in Stitch whatever happens.
3. **Use the sample number as a test,** since it has no real data:
   - If it isn't already registered as API-only, install the WhatsApp Business app (latest version) on a spare phone and register the sample number.
   - Set up a business profile and send it about 10 test chats from personal phones ("need a lehenga for 14 Dec, budget 2L").
   - If it was already registered as API-only, keep it as an API test number for building the receiver (step 5). Then put a second spare SIM on the Business app to test Coexistence.
4. **Connect through a provider's Coexistence flow:**
   - Sign up with 360dialog (or YCloud).
   - Choose "Connect existing WhatsApp Business App" (Coexistence).
   - Log in with the Facebook account that owns the verified Meta Business portfolio.
   - Enter the number. Meta sends a WhatsApp message and a QR code to the phone. Scan it and approve.
   - Choose **Share chat history**, and allow contacts.
   - Check that the history and contacts are requested within **24 hours** (only one try). Ask the provider whether they do this or we must.
5. **The receiver in Stitch: built** (23 Nov 2026, see IMPLEMENTATION.md §21).
   - The webhook address is `https://<api>/api/whatsapp/webhook`. Give the provider `...?key=<WA_WEBHOOK_KEY>`, or set `WA_APP_SECRET` and `WA_VERIFY_TOKEN` if Meta calls us directly.
   - **Add the number to the brand in Stitch first** (Settings → brand → WhatsApp numbers). Calls for an unknown number are kept as *unmatched* and can be retried after adding it.
   - During the pilot, check what arrived with `GET /api/whatsapp/inbound` (admin). The raw payloads are kept there.
6. **Test:**
   - the phone still has every chat;
   - a test message from a personal phone reaches Stitch;
   - a reply sent from the phone reaches Stitch;
   - the old chats arrive;
   - after re-scanning the QR on linked devices, they still work.
7. **Only then** connect one low-stakes real brand number (after the backup in step 2). Wait a week before the next one.

**Things that will bite us later:**
- **Render's free tier sleeps,** and the first request takes about 30 seconds. Meta and providers retry, but messages can be late or dropped. Use a paid instance (or keep it awake) before connecting real numbers.
- **The phone must be opened at least every 14 days,** or the link drops.
- **Only about the last 14 days of media** come over in the old chats.
- **Embedded Signup v2 and v3 are deprecated,** so the provider must be on v4.

## 3. Cost (India, 2026)

| What | Cost |
|---|---|
| Replies to a customer within 24 h of their last message | Free |
| Messages the team sends from the phone app | Free |
| Marketing template (follow-up after 24 h, offers) | about ₹0.86 per message |
| Utility template (order shipped, payment reminder) | about ₹0.12–0.35 per message (sources differ) |
| BSP fee, if we use one | Their plan; going direct to the Cloud API has no fee |
| AI (our agent) | Model tokens per message read or drafted |

## 4. What our agent can do (in Stitch)

1. **Read:** every incoming message, every reply the team sends from the phone, and the 6-month history on day one. Voice notes are transcribed; photos are attached to the lead.
2. **Fill the CRM:** pull product, event date, budget, measurements and city into the lead's fields as *suggestions to accept*, using the same fields, gaps and gates as today. It never writes silently, and every accept is logged in History.
3. **Move the lead:** suggest the stage change (for example "price shared" → Quoted) and point out what's still missing for the next gate.
4. **Suggest replies:** 2–3 drafts in the brand's voice, using its catalogue, prices, lead times and policies (alterations, resizing). Sales taps one, edits it if needed, and sends.
5. **Send from Stitch:** through the API, free within 24 h. After 24 h it offers an approved template instead (payment link, follow-up).
6. **Nudge:** "Riya hasn't replied in 2 days, send a follow-up?" or "Advance not received, send the payment link?"
7. **Brief:** a morning summary per pod lead: hot leads, stuck leads, money due.
8. **Later, opt-in per brand:** auto-reply after hours for FAQs only, with a handoff to a person and a pause once a person replies.

**Where the suggestions show:** in Stitch (a chat view on the lead panel, on web or mobile). The WhatsApp app has no plug-in space; only Meta's own agent lives inside it. The team can keep replying from the phone, and those replies still flow into Stitch.

## 5. Plan

1. **Pilot one brand number.** We need its Meta Business account access, the phone for the QR scan, and a decision on direct Cloud API or a BSP.
2. **Build:**
   - a webhook receiver that writes into the existing `conversations` and `messages`;
   - history import;
   - a chat tab on the lead.
3. **Add the AI:** field suggestions with accept/reject, and reply drafts.
4. **Add send-from-Stitch:** templates, with payment links through the outbox.
5. **Only after the pilot:** Meta One or Business Agent for after-hours, if still wanted.

## Open questions
- Direct Cloud API or a BSP (faster setup, but a monthly fee)?
- Does Meta Business Agent work on a number that is also on Coexistence, and would it clash with our agent? This is unconfirmed.
- Who owns each brand's Meta Business account: the brand or the agency?

## Sources
- [Meta's AI agent for WhatsApp Business available globally (TechCrunch)](https://techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/)
- [Connect Google Drive to Meta Business Agent (WhatsApp FAQ)](https://faq.whatsapp.com/2110604303116586/)
- [About Meta One plans (WhatsApp FAQ)](https://faq.whatsapp.com/975910528178219)
- [Meta One for Business (imbee)](https://www.imbee.io/resource/meta-one-business-plans-whatsapp)
- [Coexistence webhooks (360dialog)](https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence/coexistence-webhooks)
- [Coexistence for developers: history sync and echoes (DEV)](https://dev.to/wapgrowai/whatsapp-coexistence-for-developers-history-sync-message-echoes-and-contacts-without-breaking-1111)
- [Coexistence limitations (DoubleTick)](https://learn.doubletick.io/co-existence/limitations-and-restrictions-of-co-existence)
- [Coexistence (Infobip)](https://www.infobip.com/docs/whatsapp/manage-integration/coexistence)
- [Coexistence available globally (Chakra)](https://chakrahq.com/article/whatsapp-coexistence-live-eu-uk-europe-whatsapp-business-for-api-live/)
- [General-purpose chatbot ban (TechCrunch)](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform)
- [WhatsApp chatbot policy 2026 (respond.io)](https://respond.io/blog/whatsapp-chatbot-policy-2026)
- [Pricing on the WhatsApp Business Platform (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)
- [WhatsApp API cost in India 2026 (ecorpit)](https://ecorpit.com/whatsapp-business-api-cost-india-d2c-2026/)
