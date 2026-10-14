// PHASE 1 data source: the exact hardcoded data from the design file, behind the same interface as http.js.
// Delete this file once the backend is wired (Phase 3) - nothing else depends on it.
const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const delay = (v) => new Promise((r) => setTimeout(() => r(structuredClone(v)), 60));
const slug = (s) => s.replace(/\s/g, '');

// brand, field, rec, id, stage, hint, days, owner, blocking, score, fix, placeholder, a1, a2  (copied from the design)
const RAW = [
  ['NA', 'Customer approval', 'Meher Ali', 'ORD-2291', 'QC approval', 'Blocks Ready to ship. Round 2 photos sent 25 Sep', 15, 'KJ', 1, 92, 'act', '', 'Mark approved', 'Nudge'],
  ['NA', 'Address confirmed', 'Tara Menon', 'ORD-2285', 'Ready to ship', 'Blocks dispatch. Courier pickup is booked for Monday', 13, 'PS', 1, 90, 'text', 'Confirmed address'],
  ['NA', 'Advance amount', 'Rhea Kapur', 'LD-1197', 'Awaiting payment', 'Blocks Won. ₹2,40,000 order, karigar slot held till Tue', 56, 'PS', 1, 81, 'text', '₹ amount received'],
  ['NA', 'Neckline', 'Nandini Bose', 'LD-1193', 'Customising', 'Pattern cannot be drafted. Event in 6 days', 6, 'PS', 0, 88, 'text', 'Round, V, Sweetheart'],
  ['NA', 'Lining colour', 'Nandini Bose', 'LD-1193', 'Customising', 'Karigar needs it to cut the lining', 6, 'PS', 0, 86, 'text', 'e.g. Peach'],
  ['NA', 'Blouse size', 'Nandini Bose', 'LD-1193', 'Customising', 'Standard size or custom measurements', 6, 'PS', 0, 86, 'text', 'XS to XXL, or Custom'],
  ['NA', 'Surcharge', 'Nandini Bose', 'LD-1193', 'Customising', 'Quote is incomplete without it', 6, 'PS', 0, 85, 'text', '₹'],
  ['NA', 'Dupatta border', 'Nandini Bose', 'LD-1193', 'Customising', 'Border finish changes the lead time', 6, 'PS', 0, 84, 'text', 'Gota, Zari, Plain'],
  ['NA', 'Embroidery colour', 'Nandita Roy', 'ORD-2293', 'Spec locked', 'Customer said “antique gold” but did not pick a shade', 65, 'PS', 0, 58, 'text', 'Shade code'],
  ['NA', 'Waist', 'Ananya Kapoor', 'LD-1184', 'Quoted', 'Needed before pattern cutting starts', 49, 'PS', 0, 52, 'text', 'inches'],
  ['NA', 'Hip', 'Ananya Kapoor', 'LD-1184', 'Quoted', 'Sets the flare of the kalidar panels', 49, 'PS', 0, 52, 'text', 'inches'],
  ['NA', 'Delivery address', 'Ananya Kapoor', 'LD-1184', 'Quoted', 'Needed for the Dubai duty estimate', 49, 'PS', 0, 50, 'text', 'Full address'],
  ['NA', 'Event date', 'Ishita Rao', 'LD-1201', 'New', 'Without it the risk score cannot be set', null, 'PS', 0, 40, 'text', 'DD Mon YYYY'],
  ['NA', 'Country', 'Ishita Rao', 'LD-1201', 'New', 'Decides currency, duties and courier', null, 'PS', 0, 34, 'text', 'e.g. India'],
  ['NA', 'Product', 'Ishita Rao', 'LD-1201', 'New', 'Picks which customisation rules apply', null, 'PS', 0, 34, 'text', 'Product or SKU'],
  ['NA', 'Country', 'Sana Qureshi', 'LD-1190', 'Qualifying', 'Decides currency, duties and courier', 71, 'PS', 0, 30, 'text', 'e.g. UK'],
  ['KH', 'Customer sign off', 'Pooja Iyer', 'ORD-2288', 'Measurements', 'Blocks production. Measurements sent 23 Sep', 34, 'RD', 1, 78, 'act', '', 'Mark signed off', 'Nudge'],
  ['KH', 'Payment link sent', 'Zoya Farooq', 'LD-1192', 'Awaiting payment', 'Blocks Won until the link is sent', 35, 'RD', 1, 70, 'act', '', 'Send link now', 'Paste link'],
  ['KH', 'Surcharge', 'Aisha Khan', 'LD-1188', 'Customising', 'Quote is incomplete without it', 28, 'RD', 0, 55, 'text', '₹'],
  ['KH', 'Promised ship date', 'Nikita Jain', 'LD-1199', 'Quoted', 'Shown to the customer in the quote', 43, 'RD', 0, 48, 'text', 'DD Mon'],
  ['KH', 'Event date', 'Meera Pillai', 'LD-1200', 'New', 'Without it the risk score cannot be set', null, 'RD', 0, 32, 'text', 'DD Mon YYYY'],
  ['KH', 'Event date', 'Kavya Reddy', 'LD-1196', 'Qualifying', 'Without it the risk score cannot be set', null, 'RD', 0, 36, 'text', 'DD Mon YYYY'],
  ['KH', 'Country', 'Kavya Reddy', 'LD-1196', 'Qualifying', 'Decides currency, duties and courier', null, 'RD', 0, 30, 'text', 'e.g. India'],
  ['VM', 'Customer approval', 'Rohan Mehta', 'ORD-2279', 'QC approval', 'Blocks Ready to ship. Pending 2 days', 22, 'KJ', 1, 94, 'act', '', 'Mark approved', 'Nudge'],
  ['VM', 'Balance payment', 'Rohan Mehta', 'ORD-2279', 'QC approval', 'Blocks dispatch. ₹62,500 due', 22, 'KJ', 1, 91, 'act', '', 'Send link', 'Mark paid'],
  ['VM', 'Tracking shared', 'Kunal Shah', 'ORD-2270', 'Dispatched', 'Customer has asked where the order is', 4, 'AK', 0, 74, 'act', '', 'Share on WhatsApp', 'Copy link'],
  ['VM', 'Size or custom', 'Arjun Malhotra', 'LD-1195', 'Customising', 'Pick a size or open a measurement template', 77, 'AK', 0, 38, 'text', 'M, or Custom'],
  ['VM', 'Surcharge', 'Arjun Malhotra', 'LD-1195', 'Customising', 'Quote is incomplete without it', 77, 'AK', 0, 38, 'text', '₹'],
  ['VM', 'Event date', 'Farhan Siddiqui', 'LD-1202', 'New', 'Without it the risk score cannot be set', null, 'AK', 0, 30, 'text', 'DD Mon YYYY'],
  ['VM', 'Country', 'Farhan Siddiqui', 'LD-1202', 'New', 'Decides currency, duties and courier', null, 'AK', 0, 28, 'text', 'e.g. India'],
];

// Same action semantics as the backend: only the "resolves" action clears the gap.
const resolvesPrimary = (fieldLabel) => fieldLabel !== 'Balance payment';
const ALL = RAW.map(([brand, fieldLabel, rec, id, stage, hint, days, owner, b, score, fix, ph, a1, a2]) => ({
  key: `${id}-${slug(fieldLabel)}`, recordType: id.startsWith('ORD') ? 'order' : 'lead', recordId: id, rec, brand, field: slug(fieldLabel), fieldLabel,
  stage, hint, eventDate: days == null ? null : iso(days), days, owner, ownerId: owner === 'PS' ? 'u_priya' : owner, blocking: !!b, score, hot: score >= 70, fix, placeholder: ph || '',
  actions: fix === 'act' ? [{ id: 'primary', label: a1, resolves: resolvesPrimary(fieldLabel) }, { id: 'secondary', label: a2, resolves: !resolvesPrimary(fieldLabel) }] : [],
}));

const state = { done: {}, audit: 0, cleared: 9 };
const openGaps = () => ALL.filter((g) => !state.done[g.key]);
const inBrand = (g, brand) => !brand || brand === 'ALL' || brand.split(',').includes(g.brand);

const ME = { id: 'u_priya', name: 'Priya Sharma', initials: 'PS', role: 'sales', roleLabel: 'Sales associate', pod: 'Pod Alpha', tenant: { name: 'Stitch Fashion Group' },
  brands: [{ code: 'NA', name: 'Noor Atelier' }, { code: 'KH', name: 'Kesar House' }, { code: 'VM', name: 'Veda Menswear' }] };

export default {
  login: () => Promise.resolve(), logout: () => Promise.resolve(), hasSession: () => true,
  me: () => delay(ME),
  users: () => delay([{ id: 'u_priya', name: 'Priya Sharma', initials: 'PS' }, { id: 'RD', name: 'RD', initials: 'RD' }, { id: 'KJ', name: 'KJ', initials: 'KJ' }, { id: 'AK', name: 'AK', initials: 'AK' }]),
  summary: () => delay({ leads: 18, orders: 14, openGaps: openGaps().length }),

  gaps: ({ brand, owner, eventWithin } = {}) => delay({
    gaps: ALL.filter((g) => inBrand(g, brand) && (!owner || owner === 'anyone' || (owner === 'me' ? g.owner === 'PS' : g.ownerId === owner || g.owner === owner))
      && (!eventWithin || (g.days != null && g.days <= Number(eventWithin)))),
    cleared: state.cleared,
  }),

  fixGap: (key, { value, action } = {}) => {
    const g = ALL.find((x) => x.key === key);
    if (g.fix === 'text' && !String(value || '').trim()) return Promise.reject(Object.assign(new Error('Enter a value first'), { status: 422 }));
    const act = g.actions.find((a) => a.id === (action || 'primary'));
    if (g.fix === 'act' && !act.resolves) return delay({ ok: true, message: `${act.label} · done for ${g.rec}` });
    state.done[g.key] = ++state.audit; state.cleared++;
    return delay({ ok: true, auditId: state.audit, stageUnblocked: true, message: `${g.fieldLabel} fixed for ${g.rec}` + (g.blocking ? `. ${g.stage} is unblocked.` : '') });
  },
  askGap: (key) => { const g = ALL.find((x) => x.key === key); return delay({ ok: true, message: `Asked ${g.rec} for ${g.fieldLabel.toLowerCase()} on WhatsApp` }); },
  askAll: (keys) => delay({ ok: true, sent: keys.length, message: `Asked ${keys.length} customers on WhatsApp` }),
  undo: (auditId) => { const k = Object.keys(state.done).find((x) => state.done[x] === auditId); delete state.done[k]; state.cleared--; return delay({ ok: true }); },
  search: () => delay([]),

  home: () => {
    const c = (t, b) => ({ t, blocking: !!b });
    const mk = (name, id, stage, brand, chips, days, value, score) => ({ name, id, recordType: id.startsWith('ORD') ? 'order' : 'lead', stage, brand, chips, eventDate: iso(days), days, value, score, hot: score >= 70, href: `/${id.startsWith('ORD') ? 'orders' : 'leads'}/${id}` });
    return delay({
      summary: { leads: 18, orders: 14, openGaps: openGaps().length },
      kpis: { myGaps: 14, myGapsNear: 5, blockedOrders: 3, eventsWeek: 4, eventsAtRisk: 2, escalations: 2, escalationsPastSla: 1, outOfSync: 1 },
      risk: [
        mk('Nandini Bose', 'LD-1193', 'Customising', 'NA', [c('Neckline'), c('Lining colour'), c('+3')], 6, 110000, 88),
        mk('Rohan Mehta', 'ORD-2279', 'QC approval', 'VM', [c('Customer approval', 1), c('Balance', 1)], 22, 125000, 80),
        mk('Tara Menon', 'ORD-2285', 'Ready to ship', 'NA', [c('Address confirmed', 1)], 13, 92000, 75),
        mk('Rhea Kapur', 'LD-1197', 'Awaiting payment', 'NA', [c('Advance amount', 1)], 56, 240000, 72),
        mk('Ananya Kapoor', 'LD-1184', 'Quoted', 'NA', [c('Waist'), c('Hip'), c('Delivery address')], 49, 48500, 40),
        mk('Pooja Iyer', 'ORD-2288', 'Measurements', 'KH', [c('Customer sign off', 1)], 34, 36500, 38),
      ],
      pipelines: [
        { name: 'Leads', href: '/leads', stages: [['New', 3, 6], ['Qualifying', 3, 3], ['Customising', 3, 8], ['Quoted', 3, 4], ['Awaiting payment', 3, 2]].map(([n, c, g]) => ({ n, c, g })) },
        { name: 'Orders', href: '/orders', stages: [['Created', 2, 0], ['Spec locked', 1, 1], ['Measurements', 2, 1], ['Production', 2, 0], ['QC approval', 2, 3], ['Ready to ship', 1, 1], ['Dispatched', 2, 1]].map(([n, c, g]) => ({ n, c, g })) },
      ],
      events: [
        { d: '29 Sep', w: 'Tue', name: 'Simran Gill', brand: 'KH', what: 'Dispatched · Bluedart, arriving 28 Sep', status: 'On track', cls: 'grn' },
        { d: '30 Sep', w: 'Wed', name: 'Kunal Shah', brand: 'VM', what: 'Dispatched · tracking not shared yet', status: 'Needs info', cls: 'amb' },
        { d: '02 Oct', w: 'Fri', name: 'Aarav Bhatia', brand: 'VM', what: 'In production · ETA 04 Oct', status: 'ETA after event', cls: 'red' },
        { d: '02 Oct', w: 'Fri', name: 'Nandini Bose', brand: 'NA', what: 'Still a lead · 3 fields missing', status: 'Not ordered', cls: 'red' },
      ],
      escalations: [
        { name: 'Riya Chawla', id: 'ORD-2286', what: 'Production 3 days late. Customer has asked twice.', meta: 'Raised by Priya S · 5h ago · Pod lead notified', sla: 'Past SLA', cls: 'red', past: true },
        { name: 'Meher Ali', id: 'ORD-2291', what: 'QC round 2 declined: embroidery thread colour.', meta: 'Raised by Kabir J · 1d ago', sla: '6h left', cls: 'amb', past: false },
      ],
    });
  },
};