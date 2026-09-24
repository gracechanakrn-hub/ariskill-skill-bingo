// tools/ai/lib/openai.js - pure request/response shaping for the OpenAI Responses API with JSON-schema structured output.
import { assertStrictSchema } from './schema.js';

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export function openaiHeaders(key) { return { authorization: `Bearer ${key}` }; }

/** POST /v1/responses body. `system` goes in as a developer message; the schema is enforced in strict mode. */
export function buildResponsesRequest({ model, system, user, schemaName, schema, maxOutputTokens = 8000, temperature } = {}) {
  if (!model) throw new Error('model is required');
  const strict = assertStrictSchema(schema);
  if (strict.length) throw new Error(`schema is not strict-compatible:\n${strict.join('\n')}`);
  const body = {
    model,
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: system }] },
      { role: 'user', content: [{ type: 'input_text', text: user }] },
    ],
    text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
    max_output_tokens: maxOutputTokens,
    store: false,
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  return body;
}

/** Concatenated output_text of a Responses API result (raw REST shape). */
export function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const chunks = [];
  for (const item of response?.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text' && typeof c.text === 'string') chunks.push(c.text);
      if (c.type === 'refusal') throw new Error(`model refused: ${c.refusal}`);
    }
  }
  if (!chunks.length) {
    const status = response?.status || 'unknown';
    const reason = response?.incomplete_details?.reason || response?.error?.message || 'no output_text';
    throw new Error(`empty structured output (status ${status}: ${reason})`);
  }
  return chunks.join('');
}
export function parseStructured(response) { return JSON.parse(extractOutputText(response)); }

/** Usage summary for the cost notes in the report (tokens only; prices are documented in docs/ai-tooling.md). */
export function usageOf(response) {
  const u = response?.usage || {};
  return { inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null, totalTokens: u.total_tokens ?? null };
}
