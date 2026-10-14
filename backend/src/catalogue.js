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
};
FIELDS.customer_approval.locksDispatch = true;
for (const [key, f] of Object.entries(FIELDS)) f.key = key;

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
];