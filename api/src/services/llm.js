// The one place that talks to the LLM (Groq's OpenAI-compatible chat API). Everything else in the app asks this file for a
// completion, so changing provider or model later means changing only this file. Tests swap it with setLlm(), which is how
// the extraction tests run without a key or a network.
import { HttpError } from '../lib/errors.js';

let override = null;
export const setLlm = (fn) => { override = fn; };

/**
 * { system, user } -> { text, model, cutOff }. The model must answer with a JSON object.
 * Settings come from the environment (api/.env), see .env.example:
 *   GROQ_API_KEY        required; without it a read fails with 503 llm_not_configured (uploading chats still works)
 *   GROQ_MODEL          which Groq model to use (a key only sees the models its organisation has access to)
 *   EXTRACT_MAX_TOKENS  size cap for the answer
 * Problems are turned into plain HttpErrors so the screen shows a readable message: 503 not configured, 502 for anything the
 * model or the network did (including Groq's "too many tokens per minute" answer, passed through as written).
 */
export async function complete({ system, user }) {
  if (override) { const r = await override({ system, user }); return typeof r === 'string' ? { text: r, model: 'mock' } : r; }
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new HttpError(503, 'GROQ_API_KEY is not set, so chats cannot be read yet', { code: 'llm_not_configured' });
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      // temperature 0: the same chat should give the same answer. response_format json_object: Groq only answers with JSON.
      // The answer counts against Groq's tokens-per-minute limit too, so it is capped (EXTRACT_MAX_TOKENS to change).
      // gpt-oss models "think" before answering; low effort keeps that thinking from eating the answer's token budget.
      body: JSON.stringify({
        model, temperature: 0, response_format: { type: 'json_object' }, max_tokens: Number(process.env.EXTRACT_MAX_TOKENS) || 2500,
        ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
  } catch (e) { throw new HttpError(502, `Could not reach Groq: ${e.message}`, { code: 'llm_error' }); }
  if (!res.ok) throw new HttpError(502, `Groq answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`, { code: 'llm_error' });
  const j = await res.json();
  // finish_reason 'length' means the answer hit max_tokens and the JSON is incomplete: reported as cutOff by the caller
  return { text: j.choices?.[0]?.message?.content ?? '', model, cutOff: j.choices?.[0]?.finish_reason === 'length' };
}
