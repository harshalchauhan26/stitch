// Qualified / not qualified: an explainable rule, not a black box. Every answer comes with its reasons.
//   Needs ALL of: a product, an event date or a budget, a phone number, and a customer who has replied (or is not known to have gone quiet).
//   Keywords the customer used can push it either way, and the AI's buying-intent label (when the AI ran) adds or subtracts a little.
// Computed on the fly from the lead's fields, so it updates as people fill gaps. Tune QUALIFY_MIN_SCORE here.
export const QUALIFY_MIN_SCORE = 5;
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const INTENT_POINTS = { ready_to_buy: 2, interested: 1, comparing: 0, unclear: 0, hesitating: -1, browsing: -2 };

export function qualify({ event_date: eventDate, fields: f = {} }) {
  const pos = Array.isArray(f.positive_signals) ? f.positive_signals : [];
  const neg = Array.isArray(f.negative_signals) ? f.negative_signals : [];
  const yes = [], no = [];
  let score = 0;

  if (has(f.product)) { score += 2; yes.push('Product named'); } else no.push('No product mentioned');
  const hasBudget = has(f.budget_min) || has(f.budget_max);
  if (has(eventDate)) { score += 2; yes.push('Event date known'); } else if (hasBudget) { score += 1; yes.push('Budget given'); } else no.push('No event date or budget');
  if (has(f.phone)) { score += 1; yes.push('Phone number on file'); } else no.push('No phone number');
  if (f.customer_replied === 'No') no.push('Customer has not replied');
  else if (f.customer_replied === 'Yes') { score += 1; yes.push('Customer replied'); }

  score += Math.min(3, pos.length);
  if (pos.length) yes.push(`Buyer signals: ${pos.slice(0, 3).join(', ')}`);
  if (neg.length) { score -= 3 * Math.min(2, neg.length); no.push(`Warning signs: ${neg.slice(0, 3).join(', ')}`); }

  const pts = INTENT_POINTS[f.buying_intent];
  if (pts !== undefined) { score += pts; (pts > 0 ? yes : pts < 0 ? no : []).push(`AI read the chat as: ${String(f.buying_intent).replace(/_/g, ' ')}`); }

  const blocked = f.customer_replied === 'No' || !has(f.product) || !(has(eventDate) || hasBudget) || !has(f.phone) || (neg.length > 0 && neg.length >= pos.length);
  const qualified = !blocked && score >= QUALIFY_MIN_SCORE;
  return { status: qualified ? 'qualified' : 'not_qualified', score, reasons: qualified ? yes : (no.length ? no : [`Score ${score} is below ${QUALIFY_MIN_SCORE}`]) };
}
