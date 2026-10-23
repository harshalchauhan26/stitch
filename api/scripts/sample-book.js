// A realistic sample book for demos: fuller brand details and catalogue, and a dozen customers spread over every stage.
// Everything goes through the real services, so gates, payments, gaps and history are genuine.
//   npm run seed:sample     adds it to the existing demo org (nothing is deleted; skipped if already added)
import '../src/env.js';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { connect } from '../src/db.js';
import { Brand, Client, Lead, LeadEvent, Order, OrderEvent, Product, Tenant, User } from '../src/models/index.js';
import { updateBrand } from '../src/services/brands.js';
import { createDispatch, createVersion, signOff, updateDispatch } from '../src/services/fulfilment.js';
import { createLead, markLost, moveStage } from '../src/services/leads.js';
import { moveOrderStage, updateOrder } from '../src/services/orders.js';
import { addLeadPayment, addOrderPayment } from '../src/services/payments.js';
import { loadScope } from '../src/services/scope.js';
import { todayIso } from '../src/lib/validate.js';

const rupees = (n) => n * 100;
const day = (n) => { const d = new Date(`${todayIso()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MARKER = '+919820144521';                         // the first sample customer: if present, the book is already in

const BRAND_DETAILS = {
  NA: { website: 'nooratelier.in', contact: { email: 'studio@nooratelier.in', phone: '+91 22 4012 7788' }, defaults: { production_days: 45, transit_days: 4 } },
  KH: { website: 'kesarhouse.co', contact: { email: 'hello@kesarhouse.co', phone: '+91 40 2355 1902' }, defaults: { production_days: 30, transit_days: 5 } },
  VM: { website: 'vedamenswear.com', contact: { email: 'bespoke@vedamenswear.com', phone: '+91 11 4155 6021' }, defaults: { production_days: 35, transit_days: 4 } },
};
const PRODUCTS = {
  NA: [['NA-LEH-021', 'Bridal lehenga · crimson zardozi', 'lehenga', 245000, 60], ['NA-ANK-008', 'Anarkali · mint chikankari', 'anarkali', 48000, 25], ['NA-SAR-011', 'Pre-draped saree · champagne', 'saree', 58000, 21]],
  KH: [['KH-LEH-005', 'Lehenga · marigold gota', 'lehenga', 98000, 35], ['KH-KUR-014', 'Kurta set · indigo bandhani', 'kurta set', 18500, 14]],
  VM: [['VM-KUR-019', 'Kurta pyjama · ivory silk', 'kurta set', 24000, 14], ['VM-ACH-003', 'Achkan · emerald velvet', 'achkan', 135000, 45]],
};

export async function addSampleBook() {
  const tenant = await Tenant.findOne().sort({ created_at: 1 });
  if (await Client.exists({ tenant_id: tenant._id, phone_e164: MARKER })) return { added: false, reason: 'already added' };
  const [admin, priya, arjun, meera] = await Promise.all(['admin@stitch.test', 'priya@stitch.test', 'arjun@stitch.test', 'meera@stitch.test'].map((email) => User.findOne({ email })));
  if (!priya || !arjun || !meera) throw new Error('Run npm run seed:demo first: the demo people are missing');
  const as = { admin: await loadScope(admin), priya: await loadScope(priya), arjun: await loadScope(arjun), meera: await loadScope(meera) };
  const brands = Object.fromEntries((await Brand.find({ tenant_id: tenant._id })).map((b) => [b.code, b]));

  // ---- brand details and a fuller catalogue ----
  for (const [code, details] of Object.entries(BRAND_DETAILS)) if (brands[code]) await updateBrand(as.admin, brands[code]._id, details);
  for (const [code, list] of Object.entries(PRODUCTS)) {
    if (!brands[code]) continue;
    for (const [sku, name, category, price, lead_time_days] of list) {
      await Product.updateOne({ tenant_id: tenant._id, brand_id: brands[code]._id, sku }, { $setOnInsert: { name, category, base_price: rupees(price), currency: 'INR', lead_time_days } }, { upsert: true });
    }
  }
  const product = async (code, sku) => (await Product.findOne({ brand_id: brands[code]._id, sku }))._id;
  const version = async (id) => (await Lead.findById(id).select('version').lean()).version;
  const orderVersion = async (id) => (await Order.findById(id).select('version').lean()).version;

  const lead = async (who, code, client, fields, items) => (await createLead(as[who], {
    brand_id: brands[code]._id, owner_id: as[who].user._id, client: { whatsapp_consent: 'Yes', ...client }, fields, items, intake_method: 'Manual',
  })).id;
  const walk = async (who, id, stages) => { for (const to of stages) await moveStage(as[who], String(id), { version: await version(id), to }); };
  // record the advance and move to the brand's won stage: the order is created
  const win = async (who, id, wonStage, advance, ref) => {
    await addLeadPayment(as[who], String(id), { kind: 'advance', amount: rupees(advance), status: 'received', mode: 'UPI', transaction_ref: ref });
    const r = await moveStage(as[who], String(id), { version: await version(id), to: wonStage });
    return r.order_id;
  };
  const orderTo = async (who, oid, stages) => { for (const to of stages) await moveOrderStage(as[who], String(oid), { version: await orderVersion(oid), to }); };
  const signAll = async (who, oid) => {
    const o = await Order.findById(oid).lean();
    for (const it of o.items) await signOff(as[who], String(it.current_measurements_id));
  };
  const readyToShip = async (who, oid, address) => {
    await orderTo(who, oid, ['Spec locked', 'Measurements']);
    await signAll(who, oid);
    await orderTo(who, oid, ['Production']);
    await updateOrder(as[who], String(oid), { version: await orderVersion(oid), fields: { karigar: 'Rafiq Workshop, Lucknow', production_completed: day(-3) } });
    await orderTo(who, oid, ['QC approval']);
    await updateOrder(as[who], String(oid), { version: await orderVersion(oid), fields: { qc_result: 'Pass', customer_approval: 'Yes' } });
    await orderTo(who, oid, ['Ready to ship']);
    await updateOrder(as[who], String(oid), { version: await orderVersion(oid), fields: { verified_shipping_address: address, address_confirmed: 'Yes' } });
  };
  const ship = async (who, oid, courier, awb, when) => {
    const o = await Order.findById(oid).lean();
    if (o.amounts.balance_due > 0) await addOrderPayment(as[who], String(oid), { kind: 'balance', amount: o.amounts.balance_due, status: 'received', mode: 'Bank transfer', transaction_ref: `NEFT-${awb}` });
    return createDispatch(as[who], String(oid), { version: await orderVersion(oid), courier, awb, dispatch_date: when });
  };

  // ================= Noor Atelier (standard stages) =================
  const ananya = await lead('priya', 'NA', { phone: MARKER, name: 'Ananya Kapoor', city: 'Mumbai', email: 'ananya.k@gmail.com', customer_type: 'New' },
    { event_date: day(52), occasion_type: 'Wedding', country: 'India', lead_source: 'Instagram', next_followup_date: day(2), delivery_deadline: day(42), notes: 'Saw the crimson lehenga reel. Wants a lighter dupatta.' },
    [{ product_id: await product('NA', 'NA-LEH-021'), fields: { neckline: 'Sweetheart', blouse_size: 'Custom', embroidery_type: 'Zardozi', sleeve_style: 'Elbow', lining_colour: 'Gold', alterations_included: 'Two rounds' } },
     { product: 'Net dupatta · blush', fields: { dupatta_border: 'Scalloped gota' } }]);
  await walk('priya', ananya, ['Qualifying', 'Customising']);

  const ishita = await lead('priya', 'NA', { phone: '+91 99100 23876', name: 'Ishita Malhotra', city: 'New Delhi', customer_type: 'Referral' },
    { event_date: day(24), occasion_type: 'Sangeet', country: 'India', lead_source: 'Referral', next_followup_date: day(1), delivery_deadline: day(18),
      delivery_address: 'B-14, Vasant Vihar, New Delhi 110057', promised_ship_date: day(14), quote_amount: rupees(72000), currency: 'INR', quote_validity: day(7), quote_status: 'Sent', shipping_cost: rupees(800) },
    [{ product_id: await product('NA', 'NA-SHR-003'), fields: { neckline: 'V', blouse_size: 'M', embroidery_type: 'Mirror work', waist: 28, hip: 38, bust: 34 } }]);
  await walk('priya', ishita, ['Qualifying', 'Customising', 'Quoted']);

  const riya = await lead('priya', 'NA', { phone: '+971 50 312 4478', name: 'Riya Menon', city: 'Dubai', email: 'riya.menon@outlook.com' },
    { event_date: day(38), occasion_type: 'Reception', country: 'United Arab Emirates', lead_source: 'Website', next_followup_date: day(0), delivery_deadline: day(30),
      delivery_address: 'Villa 22, Al Barsha 2, Dubai', promised_ship_date: day(24), quote_amount: rupees(116000), currency: 'INR', quote_validity: day(5), quote_status: 'Accepted', shipping_cost: rupees(4500), duty_estimate: rupees(5800) },
    [{ product_id: await product('NA', 'NA-SAR-011'), fields: { blouse_size: 'S', neckline: 'Halter', waist: 26, hip: 36, bust: 32 } }]);
  await walk('priya', riya, ['Qualifying', 'Customising', 'Quoted', 'Awaiting payment']);    // the payment gate stops Won: record the advance live

  await lead('priya', 'NA', { phone: '+91 98450 77120', name: 'Sneha Iyer', city: 'Bengaluru' },
    { occasion_type: 'Engagement', lead_source: 'WhatsApp' }, [{ product: 'Anarkali, pastel, for engagement' }]);   // fresh enquiry, lots of gaps

  const tanvi = await lead('priya', 'NA', { phone: '+91 98200 55190', name: 'Tanvi Shah', city: 'Ahmedabad' },
    { event_date: day(30), occasion_type: 'Wedding', country: 'India', lead_source: 'Instagram', quote_amount: rupees(210000) }, [{ product_id: await product('NA', 'NA-LEH-014') }]);
  await markLost(as.priya, String(tanvi), { version: await version(tanvi), reason: 'Price', note: 'Budget was around 1.2L; offered the rose sharara instead.' });

  // won, in production
  const meher = await lead('priya', 'NA', { phone: '+91 98110 42263', name: 'Meher Sethi', city: 'Chandigarh', customer_type: 'Repeat' },
    { event_date: day(41), occasion_type: 'Wedding', country: 'India', lead_source: 'Referral', delivery_address: '1123, Sector 8-C, Chandigarh 160009', promised_ship_date: day(30), quote_amount: rupees(245000), currency: 'INR', quote_status: 'Accepted' },
    [{ product_id: await product('NA', 'NA-LEH-021'), fields: { neckline: 'Sweetheart', blouse_size: 'Custom', embroidery_type: 'Zardozi', waist: 27, hip: 37, bust: 33, shoulder: 14, armhole: 16 } }]);
  const meherOrder = await win('priya', meher, 'Won', 80000, 'UPI-SETHI-1104');
  await orderTo('priya', meherOrder, ['Spec locked', 'Measurements']);
  await createVersion(as.priya, String(meherOrder), String((await Order.findById(meherOrder).lean()).items[0]._id), { kind: 'measurements', values: { waist: 27.5 }, reason: 'Re-measured at the first fitting', source: 'store_visit' });
  await signAll('priya', meherOrder);
  await orderTo('priya', meherOrder, ['Production']);
  await updateOrder(as.priya, String(meherOrder), { version: await orderVersion(meherOrder), fields: { karigar: 'Rafiq Workshop, Lucknow', production_eta: day(22) } });

  // delivered this week
  const nandini = await lead('priya', 'NA', { phone: '+91 98300 61745', name: 'Nandini Bose', city: 'Kolkata' },
    { event_date: day(9), occasion_type: 'Reception', country: 'India', lead_source: 'Instagram', delivery_address: '7/2 Ballygunge Place, Kolkata 700019', promised_ship_date: day(-2), quote_amount: rupees(52000), currency: 'INR', quote_status: 'Accepted' },
    [{ product_id: await product('NA', 'NA-ANK-008'), fields: { neckline: 'Round', blouse_size: 'M', waist: 29, hip: 39, bust: 35 } }]);
  const nandiniOrder = await win('priya', nandini, 'Won', 20000, 'UPI-BOSE-0921');
  await readyToShip('priya', nandiniOrder, '7/2 Ballygunge Place, Kolkata 700019');
  const nd = await ship('priya', nandiniOrder, 'Blue Dart', 'BD71503882', day(-1));
  await updateDispatch(as.priya, String(nd._id), { awb: 'BD71503892', reason: 'Wrong digit typed from the courier slip' });
  await updateDispatch(as.priya, String(nd._id), { tracking_shared: true, status: 'delivered' });

  // ================= Kesar House (its own stages) =================
  const aditi = await lead('priya', 'KH', { phone: '+91 99890 31477', name: 'Aditi Rao', city: 'Hyderabad' },
    { event_date: day(33), occasion_type: 'Festive', country: 'India', lead_source: 'Instagram', next_followup_date: day(1), trial_mode: 'Video call' },
    [{ product_id: await product('KH', 'KH-ANK-021'), fields: { colour: 'Saffron with pink dupatta' } }]);
  await walk('priya', aditi, ['Consultation']);

  const pooja = await lead('priya', 'KH', { phone: '+91 94470 22816', name: 'Pooja Nair', city: 'Kochi' },
    { event_date: day(27), occasion_type: 'Wedding', country: 'India', lead_source: 'WhatsApp', trial_mode: 'In store', trial_date: day(3) },
    [{ product_id: await product('KH', 'KH-LEH-005'), fields: { resizing_allowed: 'Once', neckline: 'Boat', blouse_size: 'L' } }]);
  await walk('priya', pooja, ['Consultation', 'Design & trial']);

  // confirmed, shipped and on its way
  const kavya = await lead('priya', 'KH', { phone: '+91 98490 15520', name: 'Kavya Reddy', city: 'Visakhapatnam' },
    { event_date: day(12), occasion_type: 'Wedding', country: 'India', lead_source: 'Referral', trial_mode: 'Home visit', delivery_address: '44-1-12, Siripuram, Visakhapatnam 530003', promised_ship_date: day(4), quote_amount: rupees(98000), currency: 'INR', quote_status: 'Accepted' },
    [{ product_id: await product('KH', 'KH-LEH-005'), fields: { resizing_allowed: 'Twice', neckline: 'Sweetheart', blouse_size: 'M', waist: 28, hip: 38, bust: 34 } }]);
  const kavyaOrder = await win('priya', kavya, 'Confirmed', 30000, 'UPI-REDDY-2210');
  await readyToShip('priya', kavyaOrder, '44-1-12, Siripuram, Visakhapatnam 530003');
  const kd = await ship('priya', kavyaOrder, 'Delhivery', 'DLV4417820193', day(0));
  await updateDispatch(as.priya, String(kd._id), { tracking_shared: true, status: 'in_transit' });

  // ================= Veda Menswear (standard stages, menswear fields) =================
  const arjunK = await lead('arjun', 'VM', { phone: '+91 98100 66234', name: 'Arjun Khanna', city: 'Gurugram', customer_type: 'New' },
    { event_date: day(46), occasion_type: 'Wedding', country: 'India', lead_source: 'Website', next_followup_date: day(2), delivery_deadline: day(38), fabric_swatches_sent: 'Yes',
      delivery_address: 'Tower 5, DLF Park Place, Gurugram 122002', promised_ship_date: day(32), quote_amount: rupees(142000), currency: 'INR', quote_validity: day(10), quote_status: 'Sent', shipping_cost: rupees(0) },
    [{ product_id: await product('VM', 'VM-SHW-007'), fields: { collar_style: 'Mandarin', garment_size: 'Custom', closure_type: 'Buttons', fit_type: 'Slim', monogram: 'A.K.', chest: 40, waist: 34, neck: 15.5 } }]);
  await walk('arjun', arjunK, ['Qualifying', 'Customising', 'Quoted']);

  await lead('arjun', 'VM', { phone: '+91 98111 90457', name: 'Rohan Gupta', city: 'Jaipur' },
    { occasion_type: 'Reception', lead_source: 'Instagram' }, [{ product_id: await product('VM', 'VM-BND-002') }]);

  // won, ready to ship, balance still due: the balance gate stops the shipment
  const vikram = await lead('arjun', 'VM', { phone: '+91 98290 33718', name: 'Vikram Singh Rathore', city: 'Udaipur' },
    { event_date: day(15), occasion_type: 'Wedding', country: 'India', lead_source: 'Referral', fabric_swatches_sent: 'Yes', delivery_address: 'Haveli 9, Lake Pichola Road, Udaipur 313001', promised_ship_date: day(6), quote_amount: rupees(135000), currency: 'INR', quote_status: 'Accepted' },
    [{ product_id: await product('VM', 'VM-ACH-003'), fields: { collar_style: 'Band', garment_size: 'L', fit_type: 'Regular', chest: 42, waist: 36 } }]);
  const vikramOrder = await win('arjun', vikram, 'Won', 50000, 'UPI-RATHORE-0730');
  await readyToShip('arjun', vikramOrder, 'Haveli 9, Lake Pichola Road, Udaipur 313001');

  // spread the history over the last couple of weeks so "when" reads naturally
  await backdate([ananya, ishita, riya, tanvi, meher, nandini, aditi, pooja, kavya, arjunK, vikram], [meherOrder, nandiniOrder, kavyaOrder, vikramOrder]);
  return { added: true };
}

/** History written by this script happens within seconds; spread each record's events over the last days instead. */
async function backdate(leadIds, orderIds) {
  const now = Date.now(), H = 3600_000;
  const spread = async (Model, key, id, startDaysAgo) => {
    const events = await Model.find({ [key]: id }).sort({ at: 1, _id: 1 }).lean();
    const start = now - startDaysAgo * 24 * H, step = Math.max(H, (startDaysAgo * 24 * H * 0.85) / Math.max(1, events.length));
    await Promise.all(events.map((e, i) => Model.updateOne({ _id: e._id }, { $set: { at: new Date(start + i * step) } })));
    return start;
  };
  for (const [i, id] of leadIds.entries()) {
    const start = await spread(LeadEvent, 'lead_id', id, 14 - i);
    await Lead.collection.updateOne({ _id: id }, { $set: { created_at: new Date(start) } });
  }
  for (const [i, id] of orderIds.entries()) await spread(OrderEvent, 'order_id', id, 6 - i);
}

// run directly: npm run seed:sample
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connect(loadConfig().mongoUri);
  const r = await addSampleBook();
  console.log(r.added ? 'Sample book added: 13 customers across every stage, 4 orders, brand details and products.' : 'Sample book is already in this database: nothing added.');
  await mongoose.disconnect();
}
