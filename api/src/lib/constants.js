// Fixed vocabulary from the Field & Flow doc. Everything brand-specific lives in the database (field_defs, required_rules).

export const ROLES = ['admin', 'pod_lead', 'sales', 'ops', 'qc'];

// The lead pipeline is per brand (brand.lead_pipeline). This is the default from the spec; every stage has a type:
// open stages are worked through in order, the won stage creates the order, the lost stage closes the lead.
export const DEFAULT_LEAD_PIPELINE = [
  { name: 'New', type: 'open' }, { name: 'Qualifying', type: 'open' }, { name: 'Customising', type: 'open' },
  { name: 'Quoted', type: 'open' }, { name: 'Awaiting payment', type: 'open' }, { name: 'Won', type: 'won' }, { name: 'Lost', type: 'lost' },
];
export const STAGE_TYPES = ['open', 'won', 'lost'];
// The order pipeline is the agency's own fulfilment process: the same for every brand.
export const ORDER_STAGES = ['Created', 'Spec locked', 'Measurements', 'Production', 'QC approval', 'Ready to ship', 'Dispatched', 'Delivered'];

export const LEVELS = ['optional', 'needed', 'blocking'];
export const FIELD_SCOPES = ['client', 'lead', 'item', 'order'];
export const FIELD_TYPES = ['text', 'longtext', 'number', 'currency', 'date', 'select', 'bool', 'paid', 'url', 'phone'];

export const INTAKE_METHODS = ['Manual', 'Chat export', 'Paste text', 'Screenshot'];
export const LOST_REASONS = ['Price', 'Timeline', 'Chose competitor', 'No response', 'Other'];
export const ISSUE_TYPES = ['size', 'design', 'fabric', 'colour', 'measurement', 'payment', 'delivery', 'other'];
export const EVENT_SOURCES = ['manual', 'chat', 'system', 'import', 'api'];

export const PAYMENT_KINDS = ['advance', 'balance', 'extra', 'refund'];
export const PAYMENT_STATUSES = ['pending', 'link_sent', 'received', 'failed', 'cancelled', 'refunded'];
export const PAYMENT_MODES = ['UPI', 'Card', 'Bank transfer', 'Shopify checkout', 'Cash'];
export const DISPATCH_STATUSES = ['scheduled', 'picked_up', 'in_transit', 'delivered', 'returned', 'failed'];

export const REOPEN_WINDOW_DAYS = 90;                           // spec Q12
