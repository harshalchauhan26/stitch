// Validate + merge: the AI answer is checked against facts found by code, and every value gets a confidence label.
// Nothing the AI says is trusted blindly: dates must be real, enums must match, evidence ids must exist.
import { fmtDay, fromISO, todayStart } from '../lib.js';
import { parseBudget, CITY_COUNTRY } from './signals.js';

const OCCASIONS = ['Wedding', 'Engagement', 'Sangeet', 'Reception', 'Festive', 'Other'];
const CONF = ['low', 'medium', 'high'];
const lowerOf = (a, b) => CONF[Math.min(CONF.indexOf(a), CONF.indexOf(b))];
const upOf = (c) => CONF[Math.min(2, CONF.indexOf(c) + 1)];
const isConf = (c) => CONF.includes(c);

function fromLlm(raw, key, messages) {
  const f = raw?.[key];
  if (!f || typeof f !== 'object') return null;
  const value = typeof f.value === 'string' ? f.value.trim() : typeof f.value === 'number' ? String(f.value) : null;
  if (!value) return null;
  const evidence = (Array.isArray(f.evidence) ? f.evidence : []).filter((i) => Number.isInteger(i) && messages[i]).slice(0, 3);
  return { value, confidence: isConf(f.confidence) ? f.confidence : 'low', evidence };
}
const snippets = (ids, messages) => ids.map((i) => messages[i].text.replace(/\s+/g, ' ').replace(/\+?\d[\d\s\-()]{6,}\d/g, '<phone>').slice(0, 140));

export function reconcile({ parsed, signals, llmRaw, brands }) {
  const { messages } = parsed; const h = signals.hints; const out = {};
  const L = (k) => (llmRaw ? fromLlm(llmRaw, k, messages) : null);
  const put = (key, value, confidence, source, evidence = []) => { if (value !== null && value !== undefined && value !== '') out[key] = { value, confidence, source, evidence }; };

  // phone + country come from code; the AI can only refine the country (delivery country can differ from the phone's)
  if (signals.phone) put('phone', signals.phone.phone, signals.phone.guessed ? 'low' : 'high', 'code');
  const country = L('country');
  if (country) {
    const same = signals.phone && country.value.toLowerCase() === signals.phone.country.toLowerCase();
    put('country', country.value, same ? 'high' : country.confidence, same ? 'both' : 'llm', snippets(country.evidence, messages));
  } else if (signals.phone) put('country', signals.phone.country, 'medium', 'code', ['from the phone number prefix']);

  // name
  const name = L('customer_name');
  if (name) put('customer_name', name.value, name.confidence, 'llm', snippets(name.evidence, messages));
  else if (h.name) put('customer_name', h.name.value, 'low', 'code');

  // product, city, quantity
  const product = L('product');
  if (product) put('product', product.value, product.confidence, h.product && product.value.toLowerCase().includes(h.product.value.split(' ')[0].slice(0, 4)) ? 'both' : 'llm', snippets(product.evidence, messages));
  else if (h.product) put('product', h.product.value, 'low', 'code', h.product.evidence);
  const city = L('city');
  if (city) put('city', city.value, city.confidence, 'llm', snippets(city.evidence, messages));
  else if (h.city) put('city', h.city.value, 'low', 'code');
  const q = L('quantity'); const ql = q ? parseInt(q.value, 10) : NaN;
  const qOk = Number.isInteger(ql) && ql >= 1 && ql <= 50;            // an absurd AI quantity is ignored and the chat-text hint is used instead
  const qn = qOk ? ql : h.quantity?.value;
  if (Number.isInteger(qn) && qn >= 1 && qn <= 50) put('quantity', qn, qOk ? q.confidence : 'low', qOk ? 'llm' : 'code', qOk ? snippets(q.evidence, messages) : []);

  // a phone prefix says where the NUMBER is from, not where the outfit goes: if the chat names a city in another country, ask the associate to check
  const cityName = out.city?.value, cityCountry = cityName && CITY_COUNTRY[Object.keys(CITY_COUNTRY).find((c) => c.toLowerCase() === cityName.toLowerCase())];
  if (cityCountry && out.country && out.country.source === 'code' && out.country.value !== cityCountry) {
    out.country = { value: out.country.value, confidence: 'low', source: 'code', evidence: [`Phone number is from ${out.country.value}, but the chat mentions ${cityName} (${cityCountry}). Please check.`] };
  }

  // occasion: must be one of the allowed values
  const occ = L('occasion_type');
  const occOk = occ && OCCASIONS.find((o) => o.toLowerCase() === occ.value.toLowerCase());
  if (occOk) put('occasion_type', occOk, h.occasion?.value === occOk ? upOf(occ.confidence) : occ.confidence, h.occasion?.value === occOk ? 'both' : 'llm', snippets(occ.evidence, messages));
  else if (h.occasion) put('occasion_type', h.occasion.value, 'low', 'code');

  // event date: must be a real date; if the AI and a date mentioned in the chat agree, confidence goes up; past dates are marked low
  const ed = L('event_date'); const today = todayStart();
  const validIso = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = fromISO(s); return d.getFullYear() === +s.slice(0, 4) && d.getMonth() === +s.slice(5, 7) - 1 && d.getDate() === +s.slice(8); };
  if (ed && validIso(ed.value)) {
    const agree = h.dates.some((d) => d.date === ed.value);
    let c = agree ? upOf(ed.confidence) : ed.confidence;
    if (fromISO(ed.value) < today) c = 'low';
    put('event_date', ed.value, c, agree ? 'both' : 'llm', snippets(ed.evidence, messages));
  } else if (!llmRaw && h.dates.length) put('event_date', h.dates[0].date, 'low', 'code', [h.dates[0].text]);

  // budget
  const bt = L('budget_text'); const pb = bt ? parseBudget(`budget ${bt.value}`) : null; const b = pb || h.budget;
  if (b) {
    put('budget_min', b.min, bt && pb ? bt.confidence : 'medium', bt && pb ? 'llm' : 'code', bt ? snippets(bt.evidence, messages) : h.budget?.evidence || []);
    put('budget_max', b.max, bt && pb ? bt.confidence : 'medium', bt && pb ? 'llm' : 'code');
    if (b.currency || signals.phone?.cc === '91') put('currency', b.currency || 'INR', b.currency ? 'high' : 'low', 'code');
  }
  const sz = L('size'); if (sz) put('size', sz.value, sz.confidence, 'llm', snippets(sz.evidence, messages));

  // brand: only codes that exist for this company
  const brandCode = signals.brand.code && brands.some((x) => x.code === signals.brand.code) ? signals.brand.code : null;

  // notes / summary
  const st = signals.stats;
  const range = !st.firstDate ? 'Chat' : st.firstDate === st.lastDate ? `Chat on ${fmtDay(st.firstDate)}` : `Chat from ${fmtDay(st.firstDate)} to ${fmtDay(st.lastDate)}`;
  const summary = (llmRaw && typeof llmRaw.summary === 'string' && llmRaw.summary.trim())
    || `${range}.${out.product ? ` Asked about ${out.product.value}.` : ''}${st.customerReplied ? '' : ' The customer has not replied yet.'}`;
  const intent = llmRaw && ['browsing', 'interested', 'comparing', 'ready_to_buy', 'hesitating', 'unclear'].includes(llmRaw.buying_intent) ? llmRaw.buying_intent : null;
  const relevant = (llmRaw && Array.isArray(llmRaw.relevant_message_ids) ? llmRaw.relevant_message_ids : []).filter((i) => Number.isInteger(i) && messages[i]);

  const missing = ['event_date', 'country', 'product', 'phone'].filter((k) => !out[k]);
  return { fields: out, brand: { ...signals.brand, code: brandCode }, summary, intent, relevantCount: relevant.length, missing, referenceLinks: h.productLinks };
}