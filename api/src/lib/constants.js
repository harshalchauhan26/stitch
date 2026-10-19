// Fixed vocabulary from the Field & Flow doc. Everything brand-specific lives in the database (field_defs, required_rules).

export const ROLES = ['admin', 'pod_lead', 'sales', 'ops', 'qc'];

export const LEAD_STAGES = ['New', 'Qualifying', 'Customising', 'Quoted', 'Awaiting payment', 'Won', 'Lost'];
export const LEAD_PIPELINE = LEAD_STAGES.slice(0, 6);          // Lost sits outside the pipeline
export const ORDER_STAGES = ['Created', 'Spec locked', 'Measurements', 'Production', 'QC approval', 'Ready to ship', 'Dispatched', 'Delivered'];
export const pipelineOf = (recordType) => (recordType === 'lead' ? LEAD_PIPELINE : ORDER_STAGES);

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
