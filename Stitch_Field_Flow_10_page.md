# **Stitch: Field & Flow Document** 

Condensed 10-page edition · Oct 13, 2026. The full field-by-field master table stays in the long version of this document. 

## **1. Overview** 

Stitch is the internal CRM for three made-to-order fashion brands. It tracks a customer from first enquiry ( **Lead** ) through to delivery ( **Order** ). Its central idea is the **Gap** : every required item that is still missing on a record. Gaps are ranked riskiest-first, can be fixed inline from almost any screen, and are either **Blocking** (the record cannot move to the next stage) or **Needed** (required, but does not lock the stage). 

### **1.1 Brands, users and integrations** 

|**Item**|**Detail**|
|---|---|
|Brands|Noor Atelier (NA, womenswear), Kesar House (KH), Veda Menswear (VM)|
|Users|Sales associates (grouped in pods, e.g. "Sales associate · Pod Alpha"), ops/QC staff, pod leads, admins|
|Shopify|Orders are pushed and synced. An**out of sync**flag appears when an order is edited after the last push.|
|WhatsApp|Asks customers for missing info ("Ask on WhatsApp"), shares tracking ("Share on WhatsApp") and sends<br>payment links ("Send link").|



### **1.2 The two pipelines** 

**Leads:** New → Qualifying → Customising → Quoted → Awaiting payment → Won (or Lost) 

**Orders:** Created → Spec locked → Measurements → Production → QC approval → Ready to ship → Dispatched → Delivered 

A Lead is a sales conversation: the event, what the customer wants, what it costs, and whether an advance is paid. An Order is a production and fulfilment record: what is being made, to what measurements, by whom, and how it reaches the customer. Post-delivery fields (feedback, alteration, return) live on the Order. 

### **1.3 Field levels on any stage** 

|**Level**|**Meaning**|**Shows as**|
|---|---|---|
|Blocking*|Must be filled before the record can leave this stage. Marked with<br>an asterisk.|Red "Blocking" gap|
|Needed|Required for a complete record, but does not lock the stage.|Amber "Needed" gap|
|Optional|Useful, never a gap unless Set Required promotes it.|Not shown as a gap|
|Inherited|Captured at an earlier stage and still visible and editable here.|Normal field|



Tags used in the full document: **[Design]** = in the current design, **[Added]** = recommended addition, * = blocks the next stage. Only six fields are Blocking by default: Advance amount, Payment link sent, Customer sign off, Customer approval, Balance payment, Address confirmed. Settings → Set Required can promote any other field for a brand and stage. 

Stitch · Field & Flow · page 1 of 10 

## **2. How a Lead becomes an Order** 

The Lead converts the moment it reaches **Won** . Won is gated by two blocking fields on the Awaiting payment stage: **Advance amount** * and **Payment link sent** *. When both are filled and the associate moves the Lead to Won, Stitch creates one Order in **Created** , copies the Lead's fields across, creates the Order-only fields, and keeps a two-way link (Linked Lead ID on the Order). No separate "Convert" button is needed (assumption A3). 

### **2.1 Carried over (copied once, then editable on the Order)** 

|**Lead field**|**Becomes on Order**|**Note**|
|---|---|---|
|Customer name|Customer|Same value|
|Brand|Brand|Locks the Set Required rules and brand-specific fields|
|Owner|Owner|Can be reassigned later (e.g. to ops)|
|Quote amount|Order value|Final accepted amount incl. Discount, GST, Shipping cost|
|Event date|Event date|Still drives days-to-event and the risk score|
|Phone/WhatsApp, Email|Contact details|Used for all WhatsApp actions|
|Delivery address|Delivery address|Re-confirmed later as Address confirmed*|
|Promised ship date|Promised ship date|Compared against Production ETA|
|Customising fields|Spec fields|Frozen at Spec locked|
|Waist, Hip and other measurements|Measurement fields|Re-verified at Measurements|
|Advance amount, Payment mode,<br>Transaction ID|Payment ledger|Balance due = Order value minus advance|
|Notes, Tags|Order notes|Notes are appended, not overwritten|



### **2.2 Created new at conversion (never exist on the Lead)** 

|**Field**|**How it is created**|
|---|---|
|Order ID|Auto-generated, unique per brand|
|Linked Lead ID|Set to the source Lead ID|
|Stage|Starts at Created|
|Shopify order ID, Last Shopify sync|Filled when the order is first pushed to Shopify|
|Out-of-sync flag|Starts off; turns on after any edit following the last push|
|Escalation (raised by, time, SLA)|Empty until someone raises one|
|Locked by/date, Final spec<br>sheet/version|Filled at Spec locked|



### **2.3 What does not carry over** 

Lead-only sales fields (Lead source, Priority, Next follow-up date, Last contacted, Budget range, Quote validity, Quote status) stay on the Lead for reporting. Lost Leads never create an Order and keep their Lost reason. Open question Q1: should Won also require Payment received date, since as designed a Lead can become an Order before the customer has paid? 

Stitch · Field & Flow · page 2 of 10 

## **3. Lead stages** 

Fields present on a Lead at every stage: Lead ID, Customer name, Brand, Stage, Owner, Order value, Event date (the single most important date), Risk score, Phone/WhatsApp, Lead source, Next follow-up date and WhatsApp consent (Yes, No or Unknown; if not Yes, the "Ask on WhatsApp" and "Send link" buttons are disabled). Lost reason is needed when a Lead is Lost. 

|**Stage**|**Key fields captured here**|**Moves on when**|
|---|---|---|
|New|Event date, Country, Product. Also: Occasion type, Budget<br>range, Quantity, Reference images, Intake method,<br>Original chat/attachment.|Customer name, Brand, Phone/WhatsApp, Event<br>date, Country and Product are filled.|
|Qualifying|Delivery deadline, Customer type. Also: Fabric, Colour,<br>Size category.|Event date, Country and Delivery deadline<br>confirmed and Customer type set.|
|Customising|Neckline, Lining colour, Blouse size, Surcharge, Dupatta<br>border, Embroidery colour. Also: Sleeve style and length,<br>Back design, Embroidery type, Add-ons, Design approval<br>status.|All customising fields for the brand are filled and<br>Design approval status is Approved.|
|Quoted|Waist, Hip, Delivery address, Promised ship date, Quote<br>amount, Currency, Quote validity, Quote status. Also:<br>Bust, Duty estimate (non-India), Shipping cost, Discount.|Quote status is Sent and accepted; amount,<br>currency and validity filled; plus Waist, Hip,<br>address and Promised ship date.|
|Awaiting<br>payment|**Advance amount***,**Payment link sent***. Also: Payment<br>mode, Transaction ID, Payment received date, Link expiry,<br>Karigar slot held until.|Advance amount filled and Payment link sent<br>marked done. The Lead becomes Won and<br>converts to an Order.|
|Won / Lost|Won: the Lead locks (sales fields read-only) and an Order<br>is created. Lost: leaves the pipeline, can be reopened by<br>the owner.|Lost needs a Lost reason (Price, Timeline, Chose<br>competitor, No response, Other).|



### **Quick add: four ways to start a Lead** 

|**Method**|**What the person provides**|**Next screen**|
|---|---|---|
|Chat export|A WhatsApp chat export file|Add Lead form, pre-filled|
|Screenshot|An image of a chat|Review Screenshot (confidence per field), then Add<br>Lead|
|Manual|Nothing|Add Lead form, blank (Brand and Owner only)|
|Paste text|Text copied from any app|Add Lead form, pre-filled|



Whatever the method cannot find stays empty and becomes a Needed gap on the new Lead. Saving is always allowed with gaps; the Gaps view becomes the follow-up list for incomplete intakes. 

Stitch · Field & Flow · page 3 of 10 

## **4. Order stages** 

Four stages carry Blocking fields, and each protects a real-world cost: stitching on wrong measurements, shipping a garment the customer has not approved, or shipping without payment or a confirmed address. 

|**Stage**|**Key fields captured here**|**Moves on when**|
|---|---|---|
|Created|Copied from the Lead. Shopify order ID, Linked Lead ID.|Shopify order ID exists and no Needed gap<br>remains on the inherited spec.|
|Spec locked|Embroidery colour, Final spec sheet/version, Locked<br>by/date, Change-request log.|Final spec sheet attached and Locked by/date set.<br>After this, changes need a change request.|
|Measurements|**Customer sign off***, Full measurement set, Measurement<br>source, Sign-off date, Revision count.|Customer sign off is Yes (confirmed in writing).|
|Production|Karigar/workshop, Start date, ETA, Completion date,<br>Delay reason, Progress photos.|Completion date filled. A risk gap appears if ETA is<br>later than Promised ship date minus buffer.|
|QC approval|**Customer approval***,**Balance payment***, QC result, QC<br>photos, QC by, Failure reason, Balance due, Payment<br>reference.|Customer approval Yes and QC result Pass.<br>Balance payment must also be cleared before<br>Dispatched.|
|Ready to ship|**Address confirmed***, Verified shipping address, Billing<br>address, Courier, Pickup date, Invoice number, Customs<br>docs (non-India).|Address confirmed Yes and Balance payment<br>Paid.|
|Dispatched|Tracking shared, Courier, Arrival date, AWB, Tracking link,<br>Dispatch date, Delivery status.|Delivery status is Delivered and Delivered<br>date/proof filled.|
|Delivered|Feedback/rating, Alteration request, Return/exchange<br>request. Create follow-up work, block nothing.|End of the pipeline.|



### **4.1 Gate summary: what blocks what** 

|**Blocking field**|**Filled at**|**Blocks**|**Why**|
|---|---|---|---|
|Advance amount* + Payment link<br>sent*|Lead, Awaiting payment|Lead moving to Won|No Order without a<br>committed customer|
|Customer sign off*|Order, Measurements|Moving to Production|No stitching on unconfirmed<br>measurements|
|Customer approval*|Order, QC approval|Moving to Ready to ship|No handover of an<br>unaccepted piece|
|Balance payment*|Order, QC approval|Moving to Dispatched|No shipping before full<br>payment|
|Address confirmed*|Order, Ready to ship|Moving to Dispatched|No parcel to a wrong<br>address|



Balance payment and Customer approval are captured at QC approval but enforced at the next stage (assumption A4, open question Q3). Any further field a brand marks Blocking in Set Required is added to the check for that brand and stage. Needed gaps never block a move; they stay on the board and keep the Risk score up. 

Stitch · Field & Flow · page 4 of 10 

## **5. Gaps, fixes and integrations** 

### **5.1 One gap list feeds every screen** 

For each record, Stitch looks up the rules for its Brand, record type and stage (Set Required), checks each rule's field, and creates a Gap whenever a required field is empty. A record shows gaps for its current stage and every earlier stage, never later ones. The Gaps view, Home "Close these first", Kanban cards (gap count, red edge when Blocking), pipeline strips, both drawers, and the KPIs (My gaps, Blocked orders, Events this week, Escalations, Out of sync) are all views of this one calculation, so they cannot disagree. 

### **5.2 Inline fix controls on a gap row** 

|**Control**|**Used for**|**Example fields**|
|---|---|---|
|Text input + Save|Free text, numbers, measurements|Delivery address, Waist, Quote amount, Advance<br>amount|
|Date picker + Save|Date fields|Event date, Promised ship date, Pickup date|
|Select + Save|Fixed lists|Courier, Neckline, Payment mode|
|Action button|A yes/no step done by a person or<br>system|"Mark approved", "Send link", "Share on WhatsApp",<br>"Mark paid"|
|Ask on WhatsApp|Anything only the customer can supply|Delivery address, Event date, Waist, Address confirmed|



Fixing a field recomputes the record's gaps, removes the row everywhere, lowers counts and the Risk score, writes to the Audit log, and (for Shopify-mapped Order fields) turns the Out-of-sync flag on. 

### **5.3 Risk score and Event date** 

Event date drives days-to-event, the at-risk flag and sort order. Proposed Risk score (to tune with the team, assumption A7): up to 50 points for urgency (rising sharply under 30 days), 10 per Blocking gap up to 30, 5 per Needed gap up to 10, 5 for a stalled lead, 5 for an open Escalation, capped at 100. 

### **5.4 WhatsApp and Shopify** 

|**Action**|**Serves**|**Writes back**|
|---|---|---|
|Ask on WhatsApp|Any customer-supplied field|Message log, Last contacted|
|Send link|Payment link sent*, Balance link|Payment link sent = Yes, Link expiry, log|
|Share on WhatsApp|Tracking shared, AWB, Tracking link|Tracking shared = Yes, log|
|Mark approved|Design approval status, Customer approval*|Status set to Approved, Audit log (nothing is sent)|



All WhatsApp actions need a filled Phone/WhatsApp and WhatsApp consent = Yes. Orders push to Shopify when they reach Created; the Out-of-sync flag turns on when a Shopify-mapped field (addresses, order totals and taxes, notes, courier/AWB/tracking, delivery status) is edited after the last sync, and off after a successful re-push. Production, QC, Escalation and the change-request log stay internal. 

### **5.5 Set Required** 

A lookup table: Brand + Record + Stage + Field → Optional, Needed or Blocking. The gap list is built from it, so changing a cell changes the app immediately. Guardrail: the six default Blocking fields cannot be lowered by anyone except an admin, and every change is written to the Audit log. 

Stitch · Field & Flow · page 5 of 10 

## **6. Brands, assumptions and open questions** 

|**Brand**|**Garments**|**Garment layer**|
|---|---|---|
|Noor Atelier (NA)|Womenswear: lehenga, blouse, dupatta|Full blouse, dupatta and skirt fields|
|Kesar House (KH)|Not described in the brief; assumed festive<br>and ethnic womenswear|Same as NA, lehenga flare optional|
|Veda Menswear (VM)|Menswear: kurta, sherwani, bandhgala,<br>trousers|Collar style, Garment size, Closure type, Fit type<br>replace blouse and dupatta fields; Chest, Neck,<br>Garment length, Trouser length, Thigh replace<br>womenswear measurements|



Everything else (contact, event, quote, payment, production, QC, shipping, Shopify, the six Blocking fields, the Won conversion, WhatsApp consent) behaves identically for all brands. A field a brand does not use is hidden, never empty, so it can never become a gap. Brand is chosen at Lead creation and fixed on the Order. 

### **6.1 Key assumptions** 

- A1 Only six fields are Blocking by default; everything else is Needed or Optional unless Set Required promotes it. 

- A2 A record shows gaps for its current and earlier stages, not later ones. 

- A3 A Lead converts automatically at Won; there is no Convert button. 

- A5 Kesar House is festive and ethnic womenswear, close to Noor Atelier. 

- A10 Waist and Hip at Quoted are indicative; the verified measurement set is collected at Measurements. 

- A11 Formats: DD MMM YYYY dates, international phone numbers, inches (cm optional), default currency INR. 

### **6.2 Open questions for the team** 

|**#**|**Question**|**Suggested default**|
|---|---|---|
|Q1|Should Won require proof of payment, or is Payment link sent<br>enough?|Require Payment received date or gateway confirmation to<br>enter Won.|
|Q2|Can a pod lead override a Blocking gap?|Allow with a mandatory reason, written to the Audit log.|
|Q3|Is Customer approval blocking on leaving QC approval (A4)?|Keep as A4.|
|Q4|What does Kesar House sell?|Confirm, then set its field template.|
|Q5|Who owns the Order after Won: same associate or Ops?|Sales owns until Spec locked, then Ops.|
|Q6|Which Order fields push to Shopify; is Shopify the source of truth for<br>payments?|Mapping in 5.4, payments recorded in Stitch.|
|Q7|Can the spec change after Spec locked, and who approves a price<br>change?|Via a change request approved by a pod lead.|
|Q8|Are Waist and Hip required for menswear?|Waist Required, Hip Optional.|
|Q9|What are the standard production and transit times per brand?|Set per brand in settings.|
|Q10|If Quantity is more than 1, one Order or one per piece?|One Order with a line per piece.|
|Q11|Are WhatsApp replies typed in by a person or read and suggested<br>automatically?|Suggest a value, with a person confirming.|
|Q12|Can a Lost Lead be reopened, and does it keep its ID?|Reopen within 90 days with the same ID.|
|Q13|Which fields appear on invoices and customs documents?|Customer, Verified shipping address, Billing address, Order<br>value, GST.|



Stitch · Field & Flow · page 6 of 10 

## **7. Diagram: field flow, Lead to Delivered** 



<!-- Start of picture text -->
Four stage moves are locked behind six blocking fields<br>Key fields captured at each stage.<br>A * marksa Blocking field. Event date is carried through every stage.<br>New Customer name - Phone/WhatsApp- Brand Event date<br>Lead stage Country Product: Intake method<br>QualifyingLead stage DeliveryFabric preferencedeadline -- CustomerColour preferencetype -Size category<br>Customising "Neckline Lining colour -Blouse size Surcharge<br>Lead stage Dupatta border Embroidery colour - Design approval status<br>Quoted Waist Hip: Delivery address - Promised ship date<br>Lead stage Quote amount «Currency -Quote validity -Quote status<br>‘AwaitingLead stagepayment Advance amount*Payment mode - TransactionPayment IDlink-Payment sent™  received date<br>Blocks Won: Advance amount®, Payment link sent®<br>Won Lead locks and an Order is created<br>Lead exit Copied: customer, brand, value, Event date, spec, measurements, address<br>Order created, Lead fields copied across<br>CreatedOrder stage (OrderPushedID to Shopify,Linked LeadOutof-syne ID -Shopityflag starts off order ID<br>Spec locked Embroidery colour Final spec sheet/version<br>Order stage Locked by/date-Change-requestlog<br>MeasurementsOrder stage CustomerMeasurementsign off*source:FullSign-off datemeasurement- Revisionset count<br>Blocks Production: Customer sign off*<br>Production Karigar/workshop-Start date-ETA<br>Order stage ‘Completiondate Delay reason: Progress photos<br>QC approval Customer approval*- Balance payment*<br>Order stage QCrresult-QC photos Balance due - Payment reference<br>Blocks Ready to ship: Customer approval*<br>Ready to ship ‘Address confirmed* Verified shipping address<br>Order stage Courier Pickup date - Invoice number - Customs docs<br>J Blocks Dispatched: Address confirmed*, Balance payment*<br>Dispatched ‘racking shared - AWB -Tracking tink<br>Order stage Courier Dispatch date Arrival date - Delivery status<br>Delivered Delivered date/proot<br>Order stage Feedback/rating: Alteration request -Returnjexchange request,<br>— Gated move: refused unti the Blocking fields filed<br>— Conversion: the Lead becomes an Order at Won<br><!-- End of picture text -->

_Field flow, Lead to Delivered · 14 stages, 4 gated moves_ 

Read top to bottom. Each row lists the fields first captured at that stage; everything above it stays visible and editable. Red arrows are the four gated moves, and the highlighted row is the conversion that copies the Lead into an Order. 

Stitch · Field & Flow · page 7 of 10 

## **8. Diagram: screen navigation and field lineage** 



<!-- Start of picture text -->
Every card and gap row opens the same two drawers<br>‘Screen navigation. Arrows show howa person gets from one screen to the next.<br>Global: brand switcher search (leads, orders, phone, AWB) saved views : dark theme- notifications<br>Home<br>KPIs Close these first: pipeline strips<br>Quick ade Pipeline strips, KPI, risk list<br>Create Boards and lists Settings<br>Review Screenshot saves Leads Kanban OrdersKanban | ules | SetRequired<br>Decides which<br>‘Add Lead Orders List recairtead<br>Click any card,rowor gap<br>Records<br>all LeadLead fields Drawer and gaps tee allOrderOrder fieldsDrawer and gaps feed raisedEscalation from an form Order<br><!-- End of picture text -->

_Screen navigation · 4 zones, 2 drawers, 1 settings screen_ 

Home is the hub. Quick add leads into the Add Lead form, which saves onto the Leads Kanban. The four boards and lists all open the same Lead Drawer or Order Drawer, so a field is edited in exactly one place. Set Required sits to the side and silently decides what the Gaps view contains. 

### **Field lineage: typed once, reused everywhere** 

|**Source field**|**Feeds**|**How**|
|---|---|---|
|Event date|Days-to-event, Risk score, Delivery<br>deadline|Days-to-event is Event date minus today|
|Delivery deadline|Promised ship date|Ship date must be early enough to arrive by the deadline|
|Country|Currency, Duty estimate, Courier,<br>Customs docs, GST|Non-India countries add duty and customs gaps|
|Blouse size = Custom|Full measurement set, Surcharge|Custom size makes full measurements mandatory|
|Quote amount, Discount, GST,<br>Shipping|Order value|Accepted quote becomes the Order value at Won|
|Order value, Advance amount|Balance due|Order value minus Advance amount|
|Delivery address|Verified shipping address, Address<br>confirmed*|Draft address is re-confirmed before dispatch|
|Phone/WhatsApp, WhatsApp<br>consent|Every WhatsApp action|Missing or No disables the buttons|



Stitch · Field & Flow · page 8 of 10 

## **9. Chat to lead: use cases (recommended addition)** 



<!-- Start of picture text -->
r Stitch: Quick add to filled lead }<br>' i<br>H i<br>H Upload chat export '<br>i \ i<br>i \\ |i<br>f Paste chat text oe Read chat or image i<br>i7<br>f/ '<br>1 Upload screenshot Extract key fields i<br>p<br>f'<br>O H ' LLM<br>t<br>' Review and fix form \<--- Score confidence 1 service<br>' 1<br>Sales \ \ '<br>associate \ | --->C Create gaps for blanks) f|<br>I 1<br>"i<br>H\ Close gaps inline _)<----CSuggest value from reply )—;<br>1 \ i<br>i \ '<br>\ ;<br>H<br>H'<br>1 Ask on WhatsApp —f<br>' | Customer<br>' Set required fields H<br>;i<br>q}<br>| oS<br>Admin<br>or pod lead<br>© Person D Stitch rule Ousm ----> include / extend<br><!-- End of picture text -->

_Use cases, WhatsApp chat to filled lead · 1 LLM service, 4 LLM steps_ 

Not in the original design. The associate picks a Quick add method. An LLM reads the chat or image, extracts the key fields and scores each one. The associate reviews and saves, and Stitch's rules create a gap for every blank required field. When a customer answers an Ask on WhatsApp message, the LLM only suggests a value and a person confirms it (Q11). Admins and pod leads decide which fields count as gaps through Set Required. 

Stitch · Field & Flow · page 9 of 10 

**10. Chat ingestion: system design (recommended addition)** 



<!-- Start of picture text -->
1 Ingestion<br>Quick add UI API+ auth Job queue |<br>upload or paste tenant scoped ‘one job per chat<br>J Objectraw chats, storageimages<br>2 Analytic extraction<br>Parse or OCR L| Clean, filter Regex hints ¥<br>who, when, what drop system msgs phone, date, %<br>3 LLM filter and extract<br>‘i : LLM provider<br>Pick relevant _.| Extract fields Score fields | |) vrappable art<br>buying intent JSON + evidence confidence 0-1<br>4 Validate and store<br>Validate L5| Reconcile Save draft >|<br>schema, formats LLM vs regex draft lead rows<br>J tenantPostgresscoped<br>5 Review and confirm<br>Review screen _./ Confirm Gap engine kK—<br>check low first creates the lead flags blanks<br>O Apporut © Code, no LLM Oum © Store or provider<br><!-- End of picture text -->

_System design, chat ingestion · 5 stages, code first, LLM second_ 

Ingestion saves the raw chat to object storage and queues one job, so the associate never waits on the model. Analytic extraction runs in code only: it parses the export or runs OCR on a screenshot, drops system messages and finds phone, date and amount candidates. The LLM keeps the relevant messages, returns the key fields as JSON with the source message for each, and scores its confidence. Code validates the JSON, reconciles it with the regex hints and saves a draft to Postgres. The associate checks low-confidence fields first and confirms, which creates the Lead and lets the gap engine flag anything still blank. The LLM never writes to a Lead directly, and every row carries the tenant. 

Stitch · Field & Flow · page 10 of 10 

