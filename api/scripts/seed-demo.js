// Demo organisation for walkthroughs: brands (with their own fields and pipelines), teams, people, products,
// and a realistic sample book of customers at every stage (scripts/sample-book.js).
//   npm run seed:demo                      adds the demo org if there are no brands yet
//   npm run seed:demo -- --reset           wipes the database first (refused in production unless ALLOW_RESET=yes)
//   npm run seed:demo -- --reset --empty   the org only, no sample customers (enter every lead live)
import '../src/env.js';
import mongoose from 'mongoose';
import { firstAdmin, loadConfig } from '../src/config.js';
import { connect } from '../src/db.js';
import { hashPassword, initialsOf } from '../src/lib/auth.js';
import { Brand, ensureSchema, Product, Team, User } from '../src/models/index.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { createCustomField } from '../src/services/brandConfig.js';
import { createBrand } from '../src/services/brands.js';
import { loadScope } from '../src/services/scope.js';
import { addSampleBook } from './sample-book.js';

const config = loadConfig();
const reset = process.argv.includes('--reset');
const password = process.env.DEMO_PASSWORD || (config.prod ? null : 'stitch123');
if (!password || password.length < 8) { console.error('Set DEMO_PASSWORD (at least 8 characters) for the demo people'); process.exit(1); }
if (reset && config.prod && process.env.ALLOW_RESET !== 'yes') { console.error('Refusing to wipe a production database. Set ALLOW_RESET=yes if you really mean it.'); process.exit(1); }

await connect(config.mongoUri);
if (reset) { await mongoose.connection.dropDatabase(); console.log('Database wiped'); }
await ensureSchema();
const first = firstAdmin();
const { tenant } = await bootstrap(first);
if (await Brand.exists({ tenant_id: tenant._id })) {
  console.log('Brands already exist: nothing seeded. Use --reset to start again.');
  await mongoose.disconnect();
  process.exit(0);
}
const admin = await User.findOne({ tenant_id: tenant._id, role: 'admin' });
const scope = await loadScope(admin);
const rupees = (n) => n * 100;

// ---- brands (the agency onboards them) ----
const na = await createBrand(scope, {
  name: 'Noor Atelier', code: 'NA', template_key: 'womenswear', instagram: '@nooratelier', website: 'nooratelier.com', whatsapp_numbers: ['+91 98111 00001'],
});
const kh = await createBrand(scope, {
  name: 'Kesar House', code: 'KH', template_key: 'womenswear', instagram: '@kesarhouse', whatsapp_numbers: ['+91 98111 00002'],
  // a brand with its own customer journey
  lead_pipeline: [
    { name: 'New enquiry', type: 'open' }, { name: 'Consultation', type: 'open' }, { name: 'Design & trial', type: 'open' },
    { name: 'Quote sent', type: 'open' }, { name: 'Advance pending', type: 'open' }, { name: 'Confirmed', type: 'won' }, { name: 'Dropped', type: 'lost' },
  ],
});
const vm = await createBrand(scope, {
  name: 'Veda Menswear', code: 'VM', template_key: 'menswear', instagram: '@vedamenswear', whatsapp_numbers: ['+91 98111 00003'],
});

// ---- each brand's own fields: what it offers on alterations, resizing, revisions ----
const field = (brand, f) => createCustomField(scope, brand._id, f);
await field(na, { label: 'Alterations included', type: 'select', options: ['None', 'One round', 'Two rounds'], scope: 'item', stage: 'Customising', level: 'needed' });
await field(na, { label: 'Design revisions', type: 'number', min: 0, max: 5, scope: 'item', stage: 'Customising', hint: 'How many design changes the customer gets' });
await field(kh, { label: 'Trial mode', type: 'select', options: ['In store', 'Video call', 'Home visit'], stage: 'Consultation', level: 'needed' });
await field(kh, { label: 'Resizing allowed', type: 'select', options: ['No', 'Once', 'Twice'], scope: 'item', stage: 'Design & trial', level: 'needed' });
await field(kh, { label: 'Trial date', type: 'date', stage: 'Design & trial' });
await field(vm, { label: 'Fabric swatches sent', type: 'bool', stage: 'Qualifying', level: 'needed' });
await field(vm, { label: 'Monogram', type: 'text', scope: 'item', stage: 'Customising', hint: 'Initials embroidered inside the collar, if any' });

// ---- teams and people ----
const alpha = await Team.create({ tenant_id: tenant._id, name: 'Team Alpha', brand_ids: [na._id, kh._id] });
const beta = await Team.create({ tenant_id: tenant._id, name: 'Team Beta', brand_ids: [vm._id] });
const person = (name, email, role, teams) => User.create({
  tenant_id: tenant._id, name, initials: initialsOf(name), email, password_hash: hashPassword(password), role, memberships: teams.map((t) => ({ team_id: t._id })),
});
await person('Priya Shah', 'priya@stitch.test', 'sales', [alpha]);
await person('Arjun Rao', 'arjun@stitch.test', 'sales', [beta]);
await person('Meera Iyer', 'meera@stitch.test', 'pod_lead', [alpha, beta]);
await person('Ravi Kumar', 'ravi@stitch.test', 'ops', [alpha, beta]);
alpha.lead_user_id = (await User.findOne({ email: 'meera@stitch.test' }))._id; await alpha.save();

// ---- product catalogue ----
await Product.insertMany([
  { brand_id: na._id, sku: 'NA-LEH-014', name: 'Bridal lehenga · ivory', category: 'lehenga', base_price: rupees(180000), lead_time_days: 45 },
  { brand_id: na._id, sku: 'NA-SHR-003', name: 'Sharara set · rose', category: 'sharara', base_price: rupees(65000), lead_time_days: 30 },
  { brand_id: kh._id, sku: 'KH-ANK-021', name: 'Anarkali · saffron', category: 'anarkali', base_price: rupees(45000), lead_time_days: 25 },
  { brand_id: vm._id, sku: 'VM-SHW-007', name: 'Sherwani · midnight', category: 'sherwani', base_price: rupees(120000), lead_time_days: 40 },
  { brand_id: vm._id, sku: 'VM-BND-002', name: 'Bandhgala · charcoal', category: 'bandhgala', base_price: rupees(55000), lead_time_days: 21 },
].map((p) => ({ ...p, tenant_id: tenant._id, currency: 'INR' })));

if (!process.argv.includes('--empty')) await addSampleBook();

console.log(`Demo org ready${process.argv.includes('--empty') ? '' : ', with sample customers'}.
  Admin       ${first.email}${config.prod ? '' : ` / ${first.password}`}
  Sales       priya@stitch.test (Noor Atelier, Kesar House) · arjun@stitch.test (Veda Menswear)
  Pod lead    meera@stitch.test (all brands)
  Ops         ravi@stitch.test
  Password    ${config.prod ? '(DEMO_PASSWORD)' : password}`);
await mongoose.disconnect();
