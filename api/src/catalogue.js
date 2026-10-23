// Seed data from the Field & Flow doc (spec §3, §4, §6) and PLAN §6: every field, and the two brand templates.
// This is copied into each tenant's field_defs / brand_templates on first run. After that the database is the source of truth.

const f = (key, label, scope, type, extra = {}) => ({ key, label, scope, type, ...extra });
const LEAD = { record_types: ['lead'] };
const ORDER = { record_types: ['order'] };
const IN = (min, max) => ({ unit: 'in', min, max });
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Custom'];
const linkSent = { field: 'payment_link_sent', scope: 'lead', op: 'eq', value: 'Yes' };

export const FIELD_DEFS = [
  // ---- client (stored on the client document, shown on every lead) ----
  f('client_name', 'Customer name', 'client', 'text', LEAD),
  f('phone', 'Phone/WhatsApp', 'client', 'phone', { ...LEAD, hint: 'International format, e.g. +91 98111 15326' }),
  f('whatsapp_consent', 'WhatsApp consent', 'client', 'select', { ...LEAD, options: ['Yes', 'No', 'Unknown'], done_values: ['Yes', 'No'], hint: 'WhatsApp actions are only allowed when this is Yes' }),
  f('email', 'Email', 'client', 'text', LEAD),
  f('city', 'City/State', 'client', 'text', LEAD),
  f('customer_type', 'Customer type', 'client', 'select', { ...LEAD, options: ['New', 'Repeat', 'Referral', 'Trade/Stylist'] }),

  // ---- lead: New ----
  f('event_date', 'Event date', 'lead', 'date', { ...LEAD, hint: 'Drives days-to-event and the risk score' }),
  f('country', 'Country', 'lead', 'text', { ...LEAD, hint: 'Delivery country; decides currency, duty and courier' }),
  f('lead_source', 'Lead source', 'lead', 'select', { ...LEAD, options: ['Instagram', 'WhatsApp', 'Website', 'Shopify store', 'Referral', 'Walk-in', 'Other'] }),
  f('next_followup_date', 'Next follow-up date', 'lead', 'date', LEAD),
  f('occasion_type', 'Occasion type', 'lead', 'select', { ...LEAD, options: ['Wedding', 'Engagement', 'Sangeet', 'Reception', 'Festive', 'Other'] }),
  f('budget_min', 'Budget from', 'lead', 'currency', LEAD),
  f('budget_max', 'Budget to', 'lead', 'currency', LEAD),
  f('reference_images', 'Reference images', 'lead', 'longtext', { ...LEAD, hint: 'One link per line' }),
  f('priority', 'Priority', 'lead', 'select', { ...LEAD, options: ['Low', 'Medium', 'High'] }),
  f('tags', 'Tags', 'lead', 'text', LEAD),
  f('notes', 'Notes', 'lead', 'longtext', LEAD),
  // ---- lead: Qualifying ----
  f('delivery_deadline', 'Delivery deadline', 'lead', 'date', { ...LEAD, hint: 'When the customer needs the outfit in hand' }),
  // ---- lead: Quoted ----
  f('delivery_address', 'Delivery address', 'lead', 'longtext', LEAD),
  f('promised_ship_date', 'Promised ship date', 'lead', 'date', LEAD),
  f('quote_amount', 'Quote amount', 'lead', 'currency', LEAD),
  f('currency', 'Currency', 'lead', 'select', { ...LEAD, options: ['INR', 'USD', 'GBP', 'AED', 'EUR'] }),
  f('quote_validity', 'Quote validity', 'lead', 'date', LEAD),
  f('quote_status', 'Quote status', 'lead', 'select', { ...LEAD, options: ['Draft', 'Sent', 'Accepted', 'Expired', 'Rejected'], done_values: ['Accepted'] }),
  f('shipping_cost', 'Shipping cost', 'lead', 'currency', LEAD),
  f('discount', 'Discount', 'lead', 'currency', LEAD),
  f('duty_estimate', 'Duty estimate', 'lead', 'currency', { ...LEAD, applies_when: { field: 'country', scope: 'lead', op: 'ne', value: 'India' }, hint: 'Only for orders shipped outside India' }),
  // ---- lead: Awaiting payment (computed from the payments ledger, PLAN §5.18) ----
  f('advance_amount', 'Advance amount', 'lead', 'currency', { ...LEAD, computed: true, hint: 'Record the advance in Payments' }),
  f('payment_link_sent', 'Payment link sent', 'lead', 'bool', { ...LEAD, computed: true, hint: 'Set when the advance payment link is sent' }),
  f('payment_mode', 'Payment mode', 'lead', 'select', { ...LEAD, computed: true, options: ['UPI', 'Card', 'Bank transfer', 'Shopify checkout', 'Cash'], applies_when: linkSent }),
  f('transaction_id', 'Transaction ID', 'lead', 'text', { ...LEAD, computed: true, applies_when: linkSent }),
  f('payment_received_date', 'Payment received date', 'lead', 'date', { ...LEAD, computed: true, applies_when: linkSent }),
  f('link_expiry', 'Link expiry', 'lead', 'date', { ...LEAD, computed: true }),
  f('karigar_slot_until', 'Karigar slot held until', 'lead', 'date', LEAD),

  // ---- item (one value per product on the lead) ----
  f('product', 'Product', 'item', 'text', LEAD),
  f('quantity', 'Quantity', 'item', 'number', { ...LEAD, min: 1, max: 50 }),
  f('fabric', 'Fabric', 'item', 'text', LEAD),
  f('colour', 'Colour', 'item', 'text', LEAD),
  f('size_category', 'Size category', 'item', 'select', { ...LEAD, options: ['Standard', 'Plus', 'Custom'] }),
  // womenswear spec
  f('neckline', 'Neckline', 'item', 'text', { ...LEAD, hint: 'Round, V, Sweetheart, ...' }),
  f('lining_colour', 'Lining colour', 'item', 'text', LEAD),
  f('blouse_size', 'Blouse size', 'item', 'select', { ...LEAD, options: SIZES }),
  f('dupatta_border', 'Dupatta border', 'item', 'text', { ...LEAD, hint: 'Gota, Zari, Plain, ...' }),
  f('sleeve_style', 'Sleeve style', 'item', 'select', { ...LEAD, options: ['Cap', 'Elbow', 'Full', 'Sleeveless'] }),
  f('back_design', 'Back design', 'item', 'text', LEAD),
  f('skirt_flare', 'Skirt/lehenga flare', 'item', 'text', LEAD),
  // menswear spec
  f('collar_style', 'Collar style', 'item', 'select', { ...LEAD, options: ['Mandarin', 'Band', 'Shawl', 'Notch', 'Spread', 'Other'] }),
  f('garment_size', 'Garment size', 'item', 'select', { ...LEAD, options: SIZES }),
  f('closure_type', 'Closure type', 'item', 'select', { ...LEAD, options: ['Buttons', 'Hooks', 'Zip', 'Toggle', 'Other'] }),
  f('fit_type', 'Fit type', 'item', 'select', { ...LEAD, options: ['Slim', 'Regular', 'Relaxed'] }),
  // shared spec
  f('embroidery_colour', 'Embroidery colour', 'item', 'text', LEAD),
  f('embroidery_type', 'Embroidery type', 'item', 'select', { ...LEAD, options: ['Zardozi', 'Chikankari', 'Resham', 'Sequin', 'Mirror work', 'None', 'Other'] }),
  f('surcharge', 'Surcharge', 'item', 'currency', LEAD),
  f('add_ons', 'Add-ons', 'item', 'text', LEAD),
  f('design_approval_status', 'Design approval status', 'item', 'select', { ...LEAD, options: ['Not sent', 'Sent', 'Changes requested', 'Approved'], done_values: ['Approved'] }),
  f('customisation_notes', 'Customisation notes', 'item', 'longtext', LEAD),
  // measurements (inches, indicative on the lead; verified on the order, spec A10)
  f('bust', 'Bust', 'item', 'number', { ...LEAD, ...IN(20, 70) }),
  f('waist', 'Waist', 'item', 'number', { ...LEAD, ...IN(18, 70) }),
  f('hip', 'Hip', 'item', 'number', { ...LEAD, ...IN(20, 80) }),
  f('shoulder', 'Shoulder', 'item', 'number', { ...LEAD, ...IN(10, 30) }),
  f('armhole', 'Armhole', 'item', 'number', { ...LEAD, ...IN(10, 30) }),
  f('sleeve_length', 'Sleeve length', 'item', 'number', { ...LEAD, ...IN(2, 40) }),
  f('blouse_length', 'Blouse length', 'item', 'number', { ...LEAD, ...IN(8, 30) }),
  f('chest', 'Chest', 'item', 'number', { ...LEAD, ...IN(24, 70) }),
  f('neck', 'Neck', 'item', 'number', { ...LEAD, ...IN(10, 25) }),
  f('garment_length', 'Garment length', 'item', 'number', { ...LEAD, ...IN(15, 60) }),
  f('trouser_length', 'Trouser length', 'item', 'number', { ...LEAD, ...IN(20, 50) }),
  f('thigh', 'Thigh', 'item', 'number', { ...LEAD, ...IN(12, 40) }),
  f('height', 'Height', 'item', 'text', { ...LEAD, hint: 'e.g. 5 ft 6 in' }),

  // ---- order (spec §4) ----
  f('final_spec_sheet', 'Final spec sheet/version', 'order', 'text', ORDER),
  f('customer_sign_off', 'Customer sign off', 'order', 'bool', { ...ORDER, computed: true, hint: 'Every item\'s measurements signed off by the customer' }),
  f('karigar', 'Karigar/workshop', 'order', 'text', ORDER),
  f('production_eta', 'Production ETA', 'order', 'date', ORDER),
  f('production_completed', 'Completion date', 'order', 'date', ORDER),
  f('qc_result', 'QC result', 'order', 'select', { ...ORDER, options: ['Pass', 'Fail'], done_values: ['Pass'] }),
  f('customer_approval', 'Customer approval', 'order', 'bool', ORDER),
  f('balance_payment', 'Balance payment', 'order', 'paid', { ...ORDER, computed: true, blocks_move_to: 'Dispatched', hint: 'Cleared when the payments ledger shows nothing due' }),
  f('verified_shipping_address', 'Verified shipping address', 'order', 'longtext', ORDER),
  f('billing_address', 'Billing address', 'order', 'longtext', ORDER),
  f('address_confirmed', 'Address confirmed', 'order', 'bool', ORDER),
  f('tracking_shared', 'Tracking shared', 'order', 'bool', { ...ORDER, computed: true }),
];

// Where a client- or order-scope key lives on its document. Item keys not listed here live in item.fields.
export const CLIENT_PATHS = { client_name: 'name', phone: 'phone_e164', whatsapp_consent: 'whatsapp_consent', email: 'email', city: 'city', customer_type: 'customer_type' };
export const ITEM_PATHS = { product: 'product', quantity: 'quantity' };
export const ORDER_PATHS = {
  verified_shipping_address: 'addresses.verified_shipping', billing_address: 'addresses.billing',
  karigar: 'production.karigar', production_eta: 'production.eta', production_completed: 'production.completed_at', qc_result: 'qc.result',
};

// Every lead needs these, for every brand: they are always Needed and cannot be removed from a brand.
export const CORE_FIELDS = ['client_name', 'phone', 'product'];

// The six Blocking fields from spec §1.3. Only an admin can lower them (spec §5.5).
export const GATE_FIELDS = ['advance_amount', 'payment_link_sent', 'customer_sign_off', 'customer_approval', 'balance_payment', 'address_confirmed'];

// ---- templates ----
const r = (stage, level, fields, extra = {}) => fields.map((field) => ({ record_type: 'lead', stage, field, level, ...extra }));
const o = (stage, level, fields) => fields.map((field) => ({ record_type: 'order', stage, field, level }));
const when = (field, value) => ({ applies_when: { field, scope: 'item', op: 'eq', value } });

const commonLeadRules = [
  ...r('New', 'needed', ['client_name', 'phone', 'whatsapp_consent', 'event_date', 'country', 'product', 'lead_source', 'next_followup_date']),
  ...r('New', 'optional', ['email', 'city', 'occasion_type', 'budget_min', 'budget_max', 'quantity', 'reference_images', 'priority', 'tags', 'notes']),
  ...r('Qualifying', 'needed', ['delivery_deadline', 'customer_type']),
  ...r('Qualifying', 'optional', ['fabric', 'colour', 'size_category']),
  ...r('Quoted', 'needed', ['delivery_address', 'promised_ship_date', 'quote_amount', 'currency', 'quote_validity', 'quote_status', 'shipping_cost', 'duty_estimate']),
  ...r('Quoted', 'optional', ['discount', 'height']),
  ...r('Awaiting payment', 'blocking', ['advance_amount', 'payment_link_sent']),
  ...r('Awaiting payment', 'needed', ['payment_mode', 'transaction_id', 'payment_received_date']),
  ...r('Awaiting payment', 'optional', ['link_expiry', 'karigar_slot_until']),
];
const orderRules = [
  ...o('Spec locked', 'needed', ['final_spec_sheet']),
  ...o('Measurements', 'blocking', ['customer_sign_off']),
  ...o('Production', 'needed', ['production_completed']),
  ...o('Production', 'optional', ['karigar', 'production_eta']),
  ...o('QC approval', 'blocking', ['customer_approval', 'balance_payment']),
  ...o('QC approval', 'needed', ['qc_result']),
  ...o('Ready to ship', 'blocking', ['address_confirmed']),
  ...o('Ready to ship', 'needed', ['verified_shipping_address']),
  ...o('Ready to ship', 'optional', ['billing_address']),
  ...o('Dispatched', 'needed', ['tracking_shared']),
];

export const TEMPLATES = [
  {
    key: 'womenswear', name: 'Womenswear (ethnic)', category: 'womenswear',
    rules: [
      ...commonLeadRules,
      ...r('Customising', 'needed', ['neckline', 'lining_colour', 'blouse_size', 'dupatta_border', 'embroidery_colour', 'surcharge', 'sleeve_style', 'sleeve_length', 'embroidery_type', 'design_approval_status']),
      ...r('Customising', 'optional', ['back_design', 'blouse_length', 'skirt_flare', 'add_ons', 'customisation_notes']),
      ...r('Quoted', 'needed', ['bust', 'waist', 'hip']),
      ...r('Quoted', 'needed', ['shoulder', 'armhole'], when('blouse_size', 'Custom')),   // spec §8: custom size -> full measurements
      ...orderRules,
    ],
  },
  {
    key: 'menswear', name: 'Menswear', category: 'menswear',
    rules: [
      ...commonLeadRules,
      ...r('Customising', 'needed', ['collar_style', 'garment_size', 'closure_type', 'fit_type', 'lining_colour', 'embroidery_colour', 'surcharge', 'embroidery_type', 'design_approval_status']),
      ...r('Customising', 'optional', ['add_ons', 'customisation_notes']),
      ...r('Quoted', 'needed', ['waist', 'chest']),
      ...r('Quoted', 'optional', ['hip']),                                                  // spec Q8
      ...r('Quoted', 'needed', ['neck', 'shoulder', 'garment_length', 'trouser_length', 'thigh'], when('garment_size', 'Custom')),
      ...orderRules,
    ],
  },
].map((t) => ({ ...t, field_keys: [...new Set(t.rules.map((x) => x.field))] }));

// At Won each item's values are split into two customisation records (PLAN §5.17): measurements, and the design spec.
export const MEASUREMENT_KEYS = ['bust', 'waist', 'hip', 'shoulder', 'armhole', 'sleeve_length', 'blouse_length', 'chest', 'neck', 'garment_length', 'trouser_length', 'thigh', 'height'];
// Lead fields that stay on the lead for reporting and are not copied to the order (spec §2.3)
export const LEAD_ONLY_FIELDS = ['lead_source', 'priority', 'next_followup_date', 'budget_min', 'budget_max', 'quote_validity', 'quote_status', 'link_expiry', 'karigar_slot_until', 'advance_amount', 'payment_link_sent'];
