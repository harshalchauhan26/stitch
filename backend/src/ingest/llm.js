// AI step: reads the (cleaned) conversation and returns lead fields with confidence + evidence.
// Provider = Anthropic Messages API with a FORCED tool call, so the answer always arrives as structured JSON.
// No ANTHROPIC_API_KEY set -> the pipeline simply runs in "code only" mode.

export const LLM_TOOL = {
  name: 'record_lead_fields',
  description: 'Record the details of a customer lead found in a WhatsApp conversation. Use null for anything not stated. Never guess.',
  input_schema: {
    type: 'object',
    properties: {
      customer_name: { $ref: '#/definitions/field' }, city: { $ref: '#/definitions/field' }, country: { $ref: '#/definitions/field' },
      product: { $ref: '#/definitions/field' }, occasion_type: { $ref: '#/definitions/field' }, event_date: { $ref: '#/definitions/field' },
      budget_text: { $ref: '#/definitions/field' }, quantity: { $ref: '#/definitions/field' }, size: { $ref: '#/definitions/field' },
      summary: { type: 'string', description: 'Two short sentences: what the customer wants, and the next step.' },
      buying_intent: { type: 'string', enum: ['browsing', 'interested', 'comparing', 'ready_to_buy', 'hesitating', 'unclear'] },
      relevant_message_ids: { type: 'array', items: { type: 'integer' }, description: 'Ids of the messages that matter for this lead.' },
    },
    required: ['customer_name', 'city', 'country', 'product', 'occasion_type', 'event_date', 'budget_text', 'quantity', 'size', 'summary', 'buying_intent', 'relevant_message_ids'],
    definitions: {
      field: {
        type: 'object',
        properties: {
          value: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'array', items: { type: 'integer' }, description: 'Message ids that state this.' },
        },
        required: ['value', 'confidence', 'evidence'],
      },
    },
  },
};

export const SYSTEM_PROMPT = `You read WhatsApp conversations between a made-to-order fashion house (STAFF) and a prospective customer (CUSTOMER) and extract lead details.
Rules:
- Use only what the conversation says. If a detail is not stated, return value null. Never guess or invent.
- confidence: "high" = the customer clearly states it; "medium" = implied or stated by staff and not contradicted; "low" = uncertain.
- evidence: the ids (numbers in [#id]) of the messages that state the detail.
- product: what they want to buy (e.g. "bridal lehenga", "saree and sharara"). occasion_type must be one of: Wedding, Engagement, Sangeet, Reception, Festive, Other (or null).
- event_date: only an explicit date of the customer's event, as YYYY-MM-DD. Do not use store-visit or appointment dates. If no year is given use the next occurrence after the chat started.
- budget_text: the customer's own words about budget (e.g. "around 2 lakh"), or null.
- city/country: where the outfit will be delivered or worn, if stated. Do not infer it from a phone number.
- relevant_message_ids: messages that matter for the lead; skip greetings, thanks and small talk.
Phone numbers are replaced by <phone>. Call the tool exactly once.`;

const mask = (s) => String(s).replace(/\+?\d[\d\s\-()]{6,}\d/g, '<phone>');

/** Compact transcript for the model: ids, roles, no phone numbers, long chats trimmed in the middle. */
export function buildTranscript(parsed, { maxChars = 24000 } = {}) {
  const lines = parsed.messages.map((m) => {
    const who = m.role === 'staff' ? 'STAFF' : m.role === 'customer' ? 'CUSTOMER' : m.sender.replace(/^\+?\d[\d\s\-()]{6,}\d$/, 'CUSTOMER');
    const body = m.media ? `(${m.media} shared)` : mask(m.text).replace(/\s+/g, ' ').slice(0, 600);
    return `[#${m.i}] ${who}: ${body}`;
  });
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(0, 4000) + '\n[... middle of the chat omitted ...]\n' + out.slice(-(maxChars - 4000));
  return out;
}

export function makeAnthropicLlm({ apiKey, model, baseUrl = 'https://api.anthropic.com', fetchImpl = globalThis.fetch, timeoutMs = 60000, retries = 1, retryDelayMs = 1500 } = {}) {
  if (!apiKey) return null;
  return async function extract(parsed) {
    const body = {
      model, max_tokens: 1800, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Conversation (chat started ${parsed.firstTs?.slice(0, 10) ?? 'unknown'}):\n\n${buildTranscript(parsed)}` }],
      tools: [LLM_TOOL], tool_choice: { type: 'tool', name: LLM_TOOL.name },
    };
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${baseUrl}/v1/messages`, {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { const e = new Error(data?.error?.message || `AI request failed (${res.status})`); e.status = res.status; throw e; }
        const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === LLM_TOOL.name);
        if (!block?.input) throw new Error('The AI returned no structured answer');
        return { result: block.input, usage: { model: data.model || model, input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 } };
      } catch (e) {
        lastErr = e;
        const retryable = e.name === 'AbortError' || [429, 500, 502, 503, 529].includes(e.status);
        if (!retryable || attempt === retries) break;
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
      } finally { clearTimeout(timer); }
    }
    throw lastErr;
  };
}

export function llmFromEnv(env = process.env, fetchImpl) {
  return makeAnthropicLlm({ apiKey: env.ANTHROPIC_API_KEY, model: env.STITCH_LLM_MODEL || 'claude-haiku-5-5', baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', fetchImpl });
}