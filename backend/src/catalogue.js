// Static vocabulary of the app: brands, stages and every field the Gaps screen can fix.
// Adding a field from the Field & Flow doc = add one entry here + one rule row. No migration.

export const BRANDS = [
  { code: 'NA', name: 'Noor Atelier' },
  { code: 'KH', name: 'Kesar House' },
  { code: 'VM', name: 'Veda Menswear' },
];

export const LEAD_STAGES = ['New', 'Qualifying', 'Customising', 'Quoted', 'Awaiting payment', 'Won'];
export const ORDER_STAGES = ['Created', 'Spec locked', 'Measurements', 'Production', 'QC approval', 'Ready to ship', 'Dispatched', 'Delivered'];
export const stagesOf = (type) => (type === 'lead' ? LEAD_STAGES : ORDER_STAGES);
// records in these stages are out of the pipeline and never produce gaps
export const CLOSED_STAGES = { lead: ['Won', 'Lost'], order: ['Delivered'] };

// Columns that live on the row itself; everything else is in the JSON `fields` bag.
export const COLUMN_FIELDS = new Set(['event_date', 'order_value', 'customer_name', 'brand', 'stage', 'owner_id']);

// Orders: fields mapped to Shopify. Editing one flips out_of_sync (doc 5.7).
export const SHOPIFY_MAPPED = new Set(['delivery_address', 'verified_shipping_address', 'billing_address', 'order_value', 'courier', 'awb', 'tracking_link', 'dispatch_date']);

const act = (id, label, effect, extra = {}) => ({ id, label, effect, ...extra });

/**
 * type: text | date | number | currency | bool (value 'Yes') | paid (value 'Paid')
 * fix:  'text' -> inline input + Save (+ Ask on WhatsApp)   'act' -> two action buttons
 * locksDispatch: counts toward the "Blocked orders / Dispatch locked" KPI on Home
 */
export const FIELDS = {
  // ---- Lead ----
  event_date: { label: 'Event date', type: 'date', fix: 'text', ph: 'DD Mon YYYY', hint: 'Without it the risk score cannot be set' },
  country: { label: 'Country', type: 'text', fix: 'text', ph: 'e.g. India', hint: 'Decides currency, duties and courier' },
  product: { label: 'Product', type: 'text', fix: 'text', ph: 'Product or SKU', hint: 'Picks which customisation rules apply' },
  neckline: { label: 'Neckline', type: 'text', fix: 'text', ph: 'Round, V, Sweetheart', hint: 'Pattern cannot be drafted.' },
  lining_colour: { label: 'Lining colour', type: 'text', fix: 'text', ph: 'e.g. Peach', hint: 'Karigar needs it to cut the lining' },
  blouse_size: { label: 'Blouse size', type: 'text', fix: 'text', ph: 'XS to XXL, or Custom', hint: 'Standard size or custom measurements' },
  garment_size: { label: 'Size or custom', type: 'text', fix: 'text', ph: 'M, or Custom', hint: 'Pick a size or open a measurement template' },
  surcharge: { label: 'Surcharge', type: 'currency', fix: 'text', ph: '₹', hint: 'Quote is incomplete without it' },
  dupatta_border: { label: 'Dupatta border', type: 'text', fix: 'text', ph: 'Gota, Zari, Plain', hint: 'Border finish changes the lead time' },
  waist: { label: 'Waist', type: 'number', fix: 'text', ph: 'inches', hint: 'Needed before pattern cutting starts' },
  hip: { label: 'Hip', type: 'number', fix: 'text', ph: 'inches', hint: 'Sets the flare of the skirt panels' },
  delivery_address: { label: 'Delivery address', type: 'text', fix: 'text', ph: 'Full address', hint: 'Needed for shipping and the duty estimate' },
  promised_ship_date: { label: 'Promised ship date', type: 'date', fix: 'text', ph: 'DD Mon', hint: 'Shown to the customer in the quote' },
  advance_amount: { label: 'Advance amount', type: 'currency', fix: 'text', ph: '₹ amount received', hint: 'Blocks Won.' },
  payment_link_sent: {
    label: 'Payment link sent', type: 'bool', fix: 'act', hint: 'Blocks Won until the link is sent',
    actions: [
      act('primary', 'Send link now', 'send_and_set', { template: 'payment_link', value: 'Yes', resolves: true }),
      act('secondary', 'Paste link', 'info', { message: 'Paste the link in the lead drawer' }),
    ],
  },
  // ---- Order ----
  embroidery_colour: { label: 'Embroidery colour', type: 'text', fix: 'text', ph: 'Shade code', hint: 'Confirm the thread shade before the spec is locked' },
  customer_sign_off: {
    label: 'Customer sign off', type: 'bool', fix: 'act', hint: 'Blocks production.',
    actions: [
      act('primary', 'Mark signed off', 'set', { value: 'Yes', resolves: true }),
      act('secondary', 'Nudge', 'whatsapp', { template: 'nudge' }),
    ],
  },
  customer_approval: {
    label: 'Customer approval', type: 'bool', fix: 'act', hint: 'Blocks Ready to ship.',
    actions: [
      act('primary', 'Mark approved', 'set', { value: 'Yes', resolves: true }),
      act('secondary', 'Nudge', 'whatsapp', { template: 'nudge' }),
    ],
  },
  balance_payment: {
    label: 'Balance payment', short: 'Balance', type: 'paid', fix: 'act', locksDispatch: true, blocksMoveTo: 'Dispatched', hint: 'Blocks dispatch. {balanceDue} due',
    actions: [
      // Sending a link must NOT clear the gate; only "Mark paid" does (doc 3.6 / 5.6).
      act('primary', 'Send link', 'whatsapp', { template: 'balance_link' }),
      act('secondary', 'Mark paid', 'set', { value: 'Paid', resolves: true }),
    ],
  },
  address_confirmed: { label: 'Address confirmed', type: 'bool', fix: 'text', locksDispatch: true, ph: 'Confirmed address', hint: 'Blocks dispatch.', textSetsValue: 'Yes', storeTextAs: 'verified_shipping_address' },
  tracking_shared: {
    label: 'Tracking shared', type: 'bool', fix: 'act', hint: 'Customer may be asking where the order is',
    actions: [
      act('primary', 'Share on WhatsApp', 'send_and_set', { template: 'tracking', value: 'Yes', resolves: true }),
      act('secondary', 'Copy link', 'info', { message: 'Tracking link copied' }),
    ],
  },
  // ---- Lead: every stage ----
  phone: { label: 'Phone/WhatsApp', type: 'text', fix: 'text', ph: '+91 98765 43210', hint: 'Needed to message the customer, international format', records: ['lead'] },
  lead_source: { label: 'Lead source', type: 'select', options: ['Instagram', 'WhatsApp', 'Website', 'Shopify store', 'Referral', 'Walk-in', 'Other'], fix: 'text', hint: 'Where this customer came from', records: ['lead'] },
  whatsapp_consent: { label: 'WhatsApp consent', type: 'select', options: ['Yes', 'No', 'Unknown'], doneValues: ['Yes', 'No'], fix: 'text', hint: 'We can only message on WhatsApp when this is Yes', records: ['lead'] },
  next_followup_date: { label: 'Next follow-up date', type: 'date', fix: 'text', ph: 'DD Mon YYYY', hint: 'So no lead goes quiet', records: ['lead'] },
  email: { label: 'Email', type: 'text', fix: 'text', ph: 'name@example.com', hint: 'Optional contact', records: ['lead'] },
  city: { label: 'City/State', type: 'text', fix: 'text', ph: 'e.g. Pune, Maharashtra', hint: 'Optional', records: ['lead'] },
  priority: { label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'], fix: 'text', hint: 'Optional', records: ['lead'] },
  tags: { label: 'Tags', type: 'text', fix: 'text', ph: 'comma separated', hint: 'Optional', records: ['lead'] },
  notes: { label: 'Notes', type: 'longtext', fix: 'text', hint: 'Optional', records: ['lead'] },
  lost_reason: { label: 'Lost reason', type: 'select', options: ['Price', 'Timeline', 'Chose competitor', 'No response', 'Other'], fix: 'text', hint: 'Required to mark a lead lost', records: ['lead'] },
  created_date: { label: 'Created', type: 'text', system: true, fix: 'text', hint: '' },
  last_contacted: { label: 'Last contacted', type: 'date', system: true, fix: 'text', hint: '' },
  intake_method: { label: 'Intake method', type: 'text', system: true, fix: 'text', hint: '', records: ['lead'] },
  original_chat_file: { label: 'Original chat file', type: 'text', system: true, fix: 'text', hint: '', records: ['lead'] },
  customer_replied: { label: 'Customer replied', type: 'select', options: ['Yes', 'No'], fix: 'text', hint: '', records: ['lead'] },
  // ---- Lead / New ----
  occasion_type: { label: 'Occasion type', type: 'select', options: ['Wedding', 'Engagement', 'Sangeet', 'Reception', 'Festive', 'Other'], fix: 'text', hint: 'Optional', records: ['lead'] },
  budget_min: { label: 'Budget from', type: 'currency', fix: 'text', ph: 'amount', hint: 'Optional', records: ['lead'] },
  budget_max: { label: 'Budget to', type: 'currency', fix: 'text', ph: 'amount', hint: 'Optional', records: ['lead'] },
  quantity: { label: 'Quantity', type: 'number', fix: 'text', ph: '1', hint: 'Optional, default 1', records: ['lead'] },
  reference_images: { label: 'Reference images', type: 'longtext', fix: 'text', ph: 'One link per line', hint: 'Optional', records: ['lead'] },
  // ---- Lead / Qualifying ----
  delivery_deadline: { label: 'Delivery deadline', type: 'date', fix: 'text', ph: 'DD Mon YYYY', hint: 'Date the customer needs the outfit in hand, usually before the event date', records: ['lead'] },
  customer_type: { label: 'Customer type', type: 'select', options: ['New', 'Repeat', 'Referral', 'Trade/Stylist'], fix: 'text', hint: 'Decides how we price and follow up', records: ['lead'] },
  fabric_preference: { label: 'Fabric preference', type: 'text', fix: 'text', ph: 'e.g. Raw silk', hint: 'Optional', records: ['lead'] },
  colour_preference: { label: 'Colour preference', type: 'text', fix: 'text', ph: 'e.g. Ivory', hint: 'Optional', records: ['lead'] },
  size_category: { label: 'Size category', type: 'select', options: ['Standard', 'Plus', 'Custom'], fix: 'text', hint: 'Optional', records: ['lead'] },
  size: { label: 'Size', type: 'text', fix: 'text', hint: 'Optional', records: ['lead'] },
  // ---- Lead / Customising ----
  sleeve_style: { label: 'Sleeve style', type: 'select', options: ['Cap', 'Elbow', 'Full', 'Sleeveless'], fix: 'text', hint: 'Pattern cannot be drafted without it', records: ['lead'] },
  sleeve_design_length: { label: 'Sleeve length (design)', type: 'number', unit: 'in', fix: 'text', ph: 'inches', hint: 'Length of the designed sleeve', records: ['lead'] },
  embroidery_type: { label: 'Embroidery type', type: 'select', options: ['Zardozi', 'Chikankari', 'Resham', 'Sequin', 'Mirror work', 'Other'], fix: 'text', hint: 'Sets the karigar and the lead time', records: ['lead'] },
  design_approval_status: { label: 'Design approval status', type: 'select', options: ['Not sent', 'Sent', 'Changes requested', 'Approved'], doneValues: ['Approved'], fix: 'text', hint: 'Done only when the customer approves the design', records: ['lead'] },
  back_design: { label: 'Back design', type: 'text', fix: 'text', hint: 'Optional', records: ['lead'] },
  blouse_length: { label: 'Blouse length', type: 'number', unit: 'in', fix: 'text', ph: 'inches', hint: 'Optional', records: ['lead'] },
  skirt_flare: { label: 'Skirt/lehenga flare', type: 'text', fix: 'text', hint: 'Optional', records: ['lead'] },
  add_ons: { label: 'Add-ons', type: 'text', fix: 'text', hint: 'Optional', records: ['lead'] },
  customisation_notes: { label: 'Customisation notes', type: 'longtext', fix: 'text', hint: 'Optional', records: ['lead'] },
  // ---- Lead / Quoted ----
  bust: { label: 'Bust', type: 'number', unit: 'in', fix: 'text', ph: 'inches', hint: 'Needed before pattern cutting starts', records: ['lead'] },
  quote_amount: { label: 'Quote amount', type: 'currency', fix: 'text', ph: 'amount', hint: 'Also sets the lead value', records: ['lead'] },
  currency: { label: 'Currency', type: 'select', options: ['INR', 'USD', 'GBP', 'AED', 'EUR', 'Other'], fix: 'text', hint: 'Currency of the quote', records: ['lead'] },
  shipping_cost: { label: 'Shipping cost', type: 'currency', fix: 'text', ph: 'amount', hint: 'Quote is incomplete without it', records: ['lead'] },
  quote_validity: { label: 'Quote validity', type: 'date', fix: 'text', ph: 'DD Mon YYYY', hint: 'Last day the quoted price holds', records: ['lead'] },
  quote_status: { label: 'Quote status', type: 'select', options: ['Draft', 'Sent', 'Accepted', 'Expired', 'Rejected'], doneValues: ['Accepted'], fix: 'text', hint: 'Done when the customer accepts', records: ['lead'] },
  duty_estimate: {
    label: 'Duty estimate', type: 'currency', fix: 'text', ph: 'amount', hint: 'Needed for orders shipped outside India', records: ['lead'],
    appliesWhen: (rec) => !!rec.fields.country && String(rec.fields.country).trim().toLowerCase() !== 'india',
  },
  shoulder: { label: 'Shoulder', type: 'number', unit: 'in', fix: 'text', ph: 'inches', hint: 'Indicative, optional', records: ['lead'] },
  sleeve_length: { label: 'Sleeve length', type: 'number', unit: 'in', fix: 'text', ph: 'inches', hint: 'Indicative, optional', records: ['lead'] },
  armhole: { label: 'Armhole', type: 'number', unit: 'in', fix: 'text', ph: 'inches', hint: 'Indicative, optional', records: ['lead'] },
  height: { label: 'Height', type: 'text', fix: 'text', ph: 'e.g. 5 ft 6 in', hint: 'Indicative, optional', records: ['lead'] },
  measurement_template_link: { label: 'Measurement template link', type: 'url', fix: 'text', ph: 'https://', hint: 'Optional', records: ['lead'] },
  discount: { label: 'Discount', type: 'text', fix: 'text', ph: 'amount or %', hint: 'Optional', records: ['lead'] },
  quote_number: { label: 'Quote number', type: 'text', system: true, fix: 'text', hint: '', records: ['lead'] },
  gst: { label: 'GST', type: 'text', system: true, fix: 'text', hint: 'Placeholder: the domestic vs export rule is not decided yet', records: ['lead'] },
  // ---- Lead / Awaiting payment ----
  payment_mode: { label: 'Payment mode', type: 'select', options: ['UPI', 'Card', 'Bank transfer', 'Shopify checkout', 'Cash'], fix: 'text', hint: 'How the advance was paid', records: ['lead'], appliesWhen: (rec) => rec.fields.payment_link_sent === 'Yes' },
  transaction_id: { label: 'Transaction ID', type: 'text', fix: 'text', ph: 'Reference', hint: 'Reference of the advance payment', records: ['lead'], appliesWhen: (rec) => rec.fields.payment_link_sent === 'Yes' },
  payment_received_date: { label: 'Payment received date', type: 'date', fix: 'text', ph: 'DD Mon YYYY', hint: 'When the advance landed', records: ['lead'], appliesWhen: (rec) => rec.fields.payment_link_sent === 'Yes' },
  link_expiry: { label: 'Link expiry', type: 'date', fix: 'text', ph: 'DD Mon YYYY', hint: 'Optional', records: ['lead'] },
  advance_percent: { label: 'Advance %', type: 'number', fix: 'text', ph: '%', hint: 'Worked out from advance and quote, editable', records: ['lead'] },
  karigar_slot_until: { label: 'Karigar slot held until', type: 'date', fix: 'text', ph: 'DD Mon YYYY', hint: 'Optional', records: ['lead'] },
  // ---- Order ----
  order_notes: { label: 'Order notes', type: 'longtext', fix: 'text', hint: 'Optional', records: ['order'] },
  final_spec_sheet: { label: 'Final spec sheet/version', type: 'text', fix: 'text', ph: 'Link or version', hint: 'The locked spec the karigar works from', records: ['order'] },
  locked_by_date: { label: 'Locked by/date', type: 'text', system: true, fix: 'text', hint: '', records: ['order'] },
  change_request_log: { label: 'Change-request log', type: 'longtext', fix: 'text', hint: 'Optional', records: ['order'] },
  shopify_order_id: { label: 'Shopify order', type: 'text', system: true, fix: 'text', hint: 'No Shopify link yet', records: ['order'] },
  last_shopify_sync: { label: 'Last Shopify sync', type: 'text', system: true, fix: 'text', hint: 'No Shopify link yet', records: ['order'] },
};
FIELDS.customer_approval.locksDispatch = true;
const ORDER_ONLY = ['customer_sign_off', 'customer_approval', 'balance_payment', 'address_confirmed', 'tracking_shared'];
const LEAD_ONLY = ['neckline', 'lining_colour', 'blouse_size', 'garment_size', 'surcharge', 'dupatta_border', 'waist', 'hip', 'delivery_address', 'promised_ship_date', 'payment_link_sent'];
for (const [key, f] of Object.entries(FIELDS)) {
  f.key = key;
  f.hint ??= '';
  f.records ??= ORDER_ONLY.includes(key) ? ['order'] : LEAD_ONLY.includes(key) ? ['lead'] : ['lead', 'order'];
}
// a field is offered for a record type only when it applies there and is not read-only
export const fieldsFor = (type) => Object.values(FIELDS).filter((f) => f.records.includes(type) && !f.system);

export const GATE_FIELDS = ['advance_amount', 'payment_link_sent', 'customer_sign_off', 'customer_approval', 'balance_payment', 'address_confirmed'];

// Default Set Required rules, mirroring the design. [record, stage, field, level, brands|null]
export const DEFAULT_RULES = [
  ['lead', 'New', 'event_date', 'needed'], ['lead', 'New', 'country', 'needed'], ['lead', 'New', 'product', 'needed'],
  ['lead', 'Customising', 'neckline', 'needed', ['NA', 'KH']],
  ['lead', 'Customising', 'lining_colour', 'needed'],
  ['lead', 'Customising', 'blouse_size', 'needed', ['NA', 'KH']],
  ['lead', 'Customising', 'garment_size', 'needed', ['VM']],
  ['lead', 'Customising', 'surcharge', 'needed'],
  ['lead', 'Customising', 'dupatta_border', 'needed', ['NA', 'KH']],
  ['lead', 'Quoted', 'waist', 'needed'], ['lead', 'Quoted', 'hip', 'needed', ['NA', 'KH']], ['lead', 'Quoted', 'hip', 'optional', ['VM']],
  ['lead', 'Quoted', 'delivery_address', 'needed'], ['lead', 'Quoted', 'promised_ship_date', 'needed'],
  ['lead', 'Awaiting payment', 'advance_amount', 'blocking'], ['lead', 'Awaiting payment', 'payment_link_sent', 'blocking'],
  ['order', 'Spec locked', 'embroidery_colour', 'needed'],
  ['order', 'Measurements', 'customer_sign_off', 'blocking'],
  ['order', 'QC approval', 'customer_approval', 'blocking'], ['order', 'QC approval', 'balance_payment', 'blocking'],
  ['order', 'Ready to ship', 'address_confirmed', 'blocking'],
  ['order', 'Dispatched', 'tracking_shared', 'needed'],
  // ---- Field & Flow doc additions ----
  ['lead', 'New', 'phone', 'needed'], ['lead', 'New', 'lead_source', 'needed'], ['lead', 'New', 'whatsapp_consent', 'needed'], ['lead', 'New', 'next_followup_date', 'needed'],
  ['lead', 'New', 'email', 'optional'], ['lead', 'New', 'city', 'optional'], ['lead', 'New', 'priority', 'optional'], ['lead', 'New', 'tags', 'optional'], ['lead', 'New', 'notes', 'optional'],
  ['lead', 'New', 'occasion_type', 'optional'], ['lead', 'New', 'budget_min', 'optional'], ['lead', 'New', 'budget_max', 'optional'], ['lead', 'New', 'quantity', 'optional'], ['lead', 'New', 'reference_images', 'optional'],
  ['lead', 'Qualifying', 'delivery_deadline', 'needed'], ['lead', 'Qualifying', 'customer_type', 'needed'],
  ['lead', 'Qualifying', 'fabric_preference', 'optional'], ['lead', 'Qualifying', 'colour_preference', 'optional'], ['lead', 'Qualifying', 'size_category', 'optional'],
  ['lead', 'Customising', 'embroidery_colour', 'needed'], ['lead', 'Customising', 'sleeve_style', 'needed'], ['lead', 'Customising', 'sleeve_design_length', 'needed'],
  ['lead', 'Customising', 'embroidery_type', 'needed'], ['lead', 'Customising', 'design_approval_status', 'needed'],
  ['lead', 'Customising', 'back_design', 'optional'], ['lead', 'Customising', 'blouse_length', 'optional'], ['lead', 'Customising', 'skirt_flare', 'optional'],
  ['lead', 'Customising', 'add_ons', 'optional'], ['lead', 'Customising', 'customisation_notes', 'optional'],
  ['lead', 'Quoted', 'bust', 'needed', ['NA', 'KH']], ['lead', 'Quoted', 'quote_amount', 'needed'], ['lead', 'Quoted', 'currency', 'needed'], ['lead', 'Quoted', 'shipping_cost', 'needed'],
  ['lead', 'Quoted', 'quote_validity', 'needed'], ['lead', 'Quoted', 'quote_status', 'needed'], ['lead', 'Quoted', 'duty_estimate', 'needed'],
  ['lead', 'Quoted', 'shoulder', 'optional'], ['lead', 'Quoted', 'sleeve_length', 'optional'], ['lead', 'Quoted', 'armhole', 'optional'], ['lead', 'Quoted', 'height', 'optional'],
  ['lead', 'Quoted', 'measurement_template_link', 'optional'], ['lead', 'Quoted', 'discount', 'optional'],
  ['lead', 'Awaiting payment', 'payment_mode', 'needed'], ['lead', 'Awaiting payment', 'transaction_id', 'needed'], ['lead', 'Awaiting payment', 'payment_received_date', 'needed'],
  ['lead', 'Awaiting payment', 'link_expiry', 'optional'], ['lead', 'Awaiting payment', 'advance_percent', 'optional'], ['lead', 'Awaiting payment', 'karigar_slot_until', 'optional'],
  ['order', 'Created', 'order_notes', 'optional'],
  ['order', 'Spec locked', 'final_spec_sheet', 'needed'], ['order', 'Spec locked', 'change_request_log', 'optional'],
];
