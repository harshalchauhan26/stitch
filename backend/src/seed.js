// Seeds the same 18 people / 30 gaps shown in the design. Dates are offsets from "today" so the demo never goes stale.
//DEMO DATA
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES, stagesOf } from './catalogue.js';
import { hashPassword } from './auth.js';
import { isoInDays } from './lib.js';
import { openDb } from './db.js';

export const DEMO_PASSWORD = 'stitch123';
const T1 = { id: 't_stitch', name: 'Stitch Fashion Group', slug: 'stitch' };
const T1_BRANDS = [['NA', 'Noor Atelier'], ['KH', 'Kesar House'], ['VM', 'Veda Menswear']];
// team -> brands it can see. Pod Beta is VM-only on purpose, to show brand scoping.
const T1_TEAMS = { 'Pod Alpha': ['NA', 'KH', 'VM'], 'Pod Beta': ['VM'] };
// id, name, initials, email, role, team
const T1_USERS = [
  ['u_priya', 'Priya Sharma', 'PS', 'priya@stitch.test', 'sales', 'Pod Alpha'], ['u_ravi', 'Ravi Desai', 'RD', 'ravi@stitch.test', 'sales', 'Pod Alpha'],
  ['u_kabir', 'Kabir Joshi', 'KJ', 'kabir@stitch.test', 'ops', 'Pod Alpha'], ['u_arnav', 'Arnav Kulkarni', 'AK', 'arnav@stitch.test', 'sales', 'Pod Beta'],
  ['u_neha', 'Neha Verma', 'NV', 'neha@stitch.test', 'pod_lead', 'Pod Alpha'], ['u_admin', 'Stitch Admin', 'AD', 'admin@stitch.test', 'admin', null],
];
// A completely separate company, used to prove tenants cannot see each other.
const T2 = { id: 't_other', name: 'Other Atelier Co', slug: 'other' };
const T2_USERS = [['u_o_admin', 'Olivia Admin', 'OA', 'admin@other.test', 'admin', null], ['u_o_sales', 'Omar Sales', 'OS', 'omar@other.test', 'sales', 'Core']];

// [id, brand, name, stage, owner, daysToEvent, value, missingFields, extraFields]
const LEADS = [
  ['LD-1193', 'NA', 'Nandini Bose', 'Customising', 'u_priya', 6, 110000, ['neckline', 'lining_colour', 'blouse_size', 'surcharge', 'dupatta_border']],
  ['LD-1197', 'NA', 'Rhea Kapur', 'Awaiting payment', 'u_priya', 56, 240000, ['advance_amount']],
  ['LD-1184', 'NA', 'Ananya Kapoor', 'Quoted', 'u_priya', 49, 48500, ['waist', 'hip', 'delivery_address']],
  ['LD-1201', 'NA', 'Ishita Rao', 'New', 'u_priya', null, null, ['event_date', 'country', 'product']],
  ['LD-1190', 'NA', 'Sana Qureshi', 'Qualifying', 'u_priya', 71, 85000, ['country']],
  ['LD-1189', 'NA', 'Diya Malik', 'Qualifying', 'u_priya', 90, 64000, []],
  ['LD-1192', 'KH', 'Zoya Farooq', 'Awaiting payment', 'u_ravi', 35, 72000, ['payment_link_sent']],
  ['LD-1188', 'KH', 'Aisha Khan', 'Customising', 'u_ravi', 28, 56000, ['surcharge']],
  ['LD-1199', 'KH', 'Nikita Jain', 'Quoted', 'u_ravi', 43, 61000, ['promised_ship_date']],
  ['LD-1198', 'KH', 'Mansi Shah', 'Quoted', 'u_ravi', 60, 58000, []],
  ['LD-1200', 'KH', 'Meera Pillai', 'New', 'u_ravi', null, null, ['event_date']],
  ['LD-1196', 'KH', 'Kavya Reddy', 'Qualifying', 'u_ravi', null, null, ['event_date', 'country']],
  ['LD-1195', 'VM', 'Arjun Malhotra', 'Customising', 'u_arnav', 77, 98000, ['garment_size', 'surcharge']],
  ['LD-1194', 'VM', 'Vikram Rathore', 'Awaiting payment', 'u_arnav', 80, 135000, []],
  ['LD-1202', 'VM', 'Farhan Siddiqui', 'New', 'u_arnav', null, null, ['event_date', 'country']],
];
const ORDERS = [
  ['ORD-2291', 'NA', 'Meher Ali', 'QC approval', 'u_kabir', 15, 78000, ['customer_approval']],
  ['ORD-2285', 'NA', 'Tara Menon', 'Ready to ship', 'u_priya', 13, 92000, ['address_confirmed'], { oos: 1 }],
  ['ORD-2293', 'NA', 'Nandita Roy', 'Spec locked', 'u_priya', 65, 120000, ['embroidery_colour']],
  ['ORD-2286', 'NA', 'Riya Chawla', 'Production', 'u_priya', 40, 145000, [], { eta: 36 }],
  ['ORD-2287', 'NA', 'Aditi Seth', 'Created', 'u_priya', 70, 99000, []],
  ['ORD-2290', 'NA', 'Pallavi Nair', 'Measurements', 'u_priya', 45, 88000, []],
  ['ORD-2288', 'KH', 'Pooja Iyer', 'Measurements', 'u_ravi', 34, 36500, ['customer_sign_off']],
  ['ORD-2289', 'KH', 'Anjali Dev', 'Created', 'u_ravi', 80, 52000, []],
  ['ORD-2271', 'KH', 'Simran Gill', 'Dispatched', 'u_ravi', 3, 67000, [], { courier: 'Bluedart', arrival: 2 }],
  ['ORD-2279', 'VM', 'Rohan Mehta', 'QC approval', 'u_kabir', 22, 125000, ['customer_approval', 'balance_payment']],
  ['ORD-2292', 'VM', 'Aarav Bhatia', 'Production', 'u_arnav', 6, 110000, [], { eta: 8 }],
  ['ORD-2270', 'VM', 'Kunal Shah', 'Dispatched', 'u_arnav', 4, 84000, ['tracking_shared'], { courier: 'Bluedart', arrival: 3 }],
];

const SAMPLE = {
  country: 'India', product: 'Bridal lehenga', neckline: 'Sweetheart', lining_colour: 'Ivory', blouse_size: 'Custom', garment_size: 'M',
  surcharge: 4500, dupatta_border: 'Gota patti', waist: 30, hip: 38, delivery_address: '12 Park Lane, Pune 411001', payment_link_sent: 'Yes',
  embroidery_colour: 'Antique gold', customer_sign_off: 'Yes', customer_approval: 'Yes', balance_payment: 'Paid', address_confirmed: 'Yes', tracking_shared: 'Yes',
};

function buildFields(type, brand, stage, value, missing, extra, ruleRows, now, idx) {
  const f = { phone: `+91 98${String(10000000 + idx * 7919).slice(0, 8)}`, whatsapp_consent: 'Yes', last_contacted: isoInDays(-(1 + (idx % 3)), now) };
  const stages = stagesOf(type), upto = stages.indexOf(stage);
  for (const r of ruleRows) {
    if (r.record_type !== type || r.brand !== brand || stages.indexOf(r.stage) > upto) continue;
    if (missing.includes(r.field) || r.field === 'event_date') continue;
    f[r.field] = r.field === 'promised_ship_date' ? isoInDays(25, now) : r.field === 'advance_amount' ? Math.round((value || 0) / 2) : SAMPLE[r.field];
  }
  if (value && !missing.includes('advance_amount')) f.advance_amount = Math.round(value / 2);
  if (extra.courier) { f.courier = extra.courier; f.arrival_date = isoInDays(extra.arrival, now); f.tracking_link = 'https://track.example/' + idx; }
  if (extra.eta !== undefined) f.eta = isoInDays(extra.eta, now);
  return f;
}

function seedTenantBase(db, t, brands, teams, users, pwHash) {
  db.prepare('INSERT INTO tenants (id, name, slug) VALUES (?,?,?)').run(t.id, t.name, t.slug);
  const ib = db.prepare('INSERT INTO brands (tenant_id, code, name) VALUES (?,?,?)');
  const ir = db.prepare('INSERT OR REPLACE INTO required_rules (tenant_id, brand, record_type, stage, field, level) VALUES (?,?,?,?,?,?)');
  for (const [code, name] of brands) {
    ib.run(t.id, code, name);
    for (const [rec, stage, field, level, only] of DEFAULT_RULES) if (!only || only.includes(code)) ir.run(t.id, code, rec, stage, field, level);
  }
  const teamId = {};
  for (const [name, codes] of Object.entries(teams)) {
    teamId[name] = Number(db.prepare('INSERT INTO teams (tenant_id, name) VALUES (?,?)').run(t.id, name).lastInsertRowid);
    for (const c of codes) db.prepare('INSERT INTO team_brands (team_id, tenant_id, brand_code) VALUES (?,?,?)').run(teamId[name], t.id, c);
  }
  const iu = db.prepare('INSERT INTO users (id, tenant_id, name, initials, email, password_hash, role, team_id) VALUES (?,?,?,?,?,?,?,?)');
  for (const [id, name, ini, email, role, team] of users) iu.run(id, t.id, name, ini, email, pwHash, role, team ? teamId[team] : null);
}

export function seed(db, now = new Date()) {
  const pw = hashPassword(DEMO_PASSWORD); // hash once, share across demo users
  db.transaction(() => {
    seedTenantBase(db, T1, T1_BRANDS, T1_TEAMS, T1_USERS, pw);
    const ruleRows = db.prepare('SELECT * FROM required_rules WHERE tenant_id = ?').all(T1.id);

    const il = db.prepare('INSERT INTO leads (tenant_id, id, brand, customer_name, stage, owner_id, event_date, order_value, fields) VALUES (?,?,?,?,?,?,?,?,?)');
    LEADS.forEach(([id, brand, name, stage, owner, days, value, missing, extra = {}], i) => {
      const ev = days === null || missing.includes('event_date') ? null : isoInDays(days, now);
      il.run(T1.id, id, brand, name, stage, owner, ev, value, JSON.stringify(buildFields('lead', brand, stage, value, missing, extra, ruleRows, now, i)));
    });
    const io = db.prepare('INSERT INTO orders (tenant_id, id, brand, customer_name, stage, owner_id, event_date, order_value, out_of_sync, fields) VALUES (?,?,?,?,?,?,?,?,?,?)');
    ORDERS.forEach(([id, brand, name, stage, owner, days, value, missing, extra = {}], i) => {
      io.run(T1.id, id, brand, name, stage, owner, isoInDays(days, now), value, extra.oos || 0, JSON.stringify(buildFields('order', brand, stage, value, missing, extra, ruleRows, now, 30 + i)));
    });

    const ie = db.prepare('INSERT INTO escalations (tenant_id, order_id, raised_by, raised_at, reason, details, sla_hours, assigned_to) VALUES (?,?,?,?,?,?,?,?)');
    const ago = (h) => new Date(now.getTime() - h * 3600000).toISOString();
    ie.run(T1.id, 'ORD-2286', 'u_priya', ago(5), 'Delay', 'Production 3 days late. Customer has asked twice.', 4, 'u_neha');
    ie.run(T1.id, 'ORD-2291', 'u_kabir', ago(18), 'Quality', 'QC round 2 declined: embroidery thread colour.', 24, 'u_neha');

    const ia = db.prepare(`INSERT INTO audit_log (tenant_id, user_id, record_type, record_id, field, old_value, new_value, action) VALUES (?, 'u_priya','lead','LD-1189','country','null','"India"','gap_fix')`);
    for (let i = 0; i < 9; i++) ia.run(T1.id); // "cleared today" starts at 9, as in the design

    const iv = db.prepare('INSERT INTO saved_views (tenant_id, user_id, name, path, filters) VALUES (?,?,?,?,?)');
    iv.run(T1.id, 'u_priya', 'My gaps today', '/gaps', '{"owner":"me"}');
    iv.run(T1.id, 'u_priya', 'Noor · events in 30d', '/leads', '{"brand":"NA","eventWithin":30}');
    iv.run(T1.id, 'u_priya', 'Blocked for dispatch', '/orders', '{"blocked":true}');

    // ---- second tenant: one brand, two users, two leads. Same record ids as tenant 1 on purpose (ids are per tenant). ----
    seedTenantBase(db, T2, [['TA', 'Test Atelier']], { Core: ['TA'] }, T2_USERS, pw);
    const rules2 = db.prepare('SELECT * FROM required_rules WHERE tenant_id = ?').all(T2.id);
    il.run(T2.id, 'LD-1193', 'TA', 'Zed Customer', 'Customising', 'u_o_sales', isoInDays(10, now), 50000, JSON.stringify(buildFields('lead', 'TA', 'Customising', 50000, ['surcharge'], {}, rules2, now, 90)));
    il.run(T2.id, 'LD-1001', 'TA', 'Yara Customer', 'New', 'u_o_sales', null, null, JSON.stringify(buildFields('lead', 'TA', 'New', null, ['event_date'], {}, rules2, now, 91)));
  })();
}

export function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) n FROM tenants').get().n === 0) { seed(db); console.log(`Seeded demo data. Login: admin@stitch.test / priya@stitch.test / ... password: ${DEMO_PASSWORD}`); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.env.DB_FILE || fileURLToPath(new URL('../data/stitch.db', import.meta.url));
  if (process.argv.includes('--reset')) for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true });
  const db = openDb(file); seedIfEmpty(db); console.log('Done:', file);
}