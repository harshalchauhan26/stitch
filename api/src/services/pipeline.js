// A brand's lead pipeline: the stages its leads move through (the CEO's "custom pipeline", a single-select status per brand).
// Each stage has a type: open stages are worked in order, the won stage creates the order, the lost stage closes the lead.
import { DEFAULT_LEAD_PIPELINE, STAGE_TYPES } from '../lib/constants.js';
import { badRequest } from '../lib/errors.js';
import { str } from '../lib/validate.js';

/** { stages, open: [names], won, lost, flow: [...open, won] } */
export function pipelineOf(brand) {
  const stages = brand?.lead_pipeline?.length ? brand.lead_pipeline : DEFAULT_LEAD_PIPELINE;
  const open = stages.filter((s) => s.type === 'open').map((s) => s.name);
  const won = stages.find((s) => s.type === 'won').name;
  const lost = stages.find((s) => s.type === 'lost').name;
  return { stages: [...open.map((name) => ({ name, type: 'open' })), { name: won, type: 'won' }, { name: lost, type: 'lost' }], open, won, lost, flow: [...open, won] };
}

export const typeOfStage = (p, name) => (name === p.won ? 'won' : name === p.lost ? 'lost' : p.open.includes(name) ? 'open' : null);

/** [{ name, type, from? }] -> validated. Open stages keep their order; exactly one won and one lost stage. */
export function validatePipeline(input) {
  if (!Array.isArray(input) || input.length < 3) throw badRequest('A pipeline needs at least one open stage, one won stage and one lost stage');
  if (input.length > 20) throw badRequest('A pipeline can have at most 20 stages');
  const seen = new Set();
  const stages = input.map((raw, i) => {
    const name = str(raw?.name, `Stage ${i + 1} name`, { required: true, max: 40 });
    const key = name.toLowerCase();
    if (seen.has(key)) throw badRequest(`Two stages are called "${name}"`);
    seen.add(key);
    const type = String(raw?.type ?? 'open').toLowerCase();
    if (!STAGE_TYPES.includes(type)) throw badRequest(`Stage "${name}" must be of type open, won or lost`);
    return { name, type, from: raw?.from ? String(raw.from) : null };
  });
  if (stages.filter((s) => s.type === 'won').length !== 1) throw badRequest('The pipeline needs exactly one won stage (the one that creates the order)');
  if (stages.filter((s) => s.type === 'lost').length !== 1) throw badRequest('The pipeline needs exactly one lost stage');
  if (!stages.some((s) => s.type === 'open')) throw badRequest('The pipeline needs at least one open stage');
  return stages;
}

/**
 * Where a rule written for stage `stage` of pipeline `fromOpen` lands in pipeline `toOpen`: the stage at the same relative
 * position. The first stays first and the last stays last, so the payment gate always sits on the stage before Won.
 */
export function mapByPosition(fromOpen, toOpen, stage) {
  if (toOpen.includes(stage)) return stage;
  const i = fromOpen.indexOf(stage);
  if (i < 0 || fromOpen.length === 1) return toOpen[toOpen.length - 1];
  return toOpen[Math.round((i * (toOpen.length - 1)) / (fromOpen.length - 1))];
}
