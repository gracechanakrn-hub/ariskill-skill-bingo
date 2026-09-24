// tools/ai/lib/schema.js - tiny JSON-schema (draft-2020 subset) validator for structured-output responses.
// Supports: type, properties, required, additionalProperties, items, enum, minItems, maxItems, minLength, maxLength, pattern, const.
export function validateSchema(schema, value, path = '$') {
  const errors = [];
  const push = (m) => errors.push(`${path}: ${m}`);
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v);
  if (schema.const !== undefined && value !== schema.const) push(`expected const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) push(`expected one of ${JSON.stringify(schema.enum)}`);
  if (schema.type) {
    const types = [].concat(schema.type);
    const t = typeOf(value);
    const ok = types.some((x) => x === t || (x === 'number' && t === 'integer'));
    if (!ok) { push(`expected ${types.join('|')}, got ${t}`); return errors; }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) push(`shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) push(`longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) push(`does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) push(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) push(`more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validateSchema(schema.items, v, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {};
    for (const r of schema.required || []) if (!(r in value)) push(`missing required "${r}"`);
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errors.push(...validateSchema(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) push(`unexpected property "${k}"`);
    }
  }
  return errors;
}

/** OpenAI strict mode requires every property listed in `required` and additionalProperties:false at every object level. */
export function assertStrictSchema(schema, path = '$') {
  const problems = [];
  if (schema.type === 'object' || schema.properties) {
    const keys = Object.keys(schema.properties || {});
    const req = schema.required || [];
    for (const k of keys) if (!req.includes(k)) problems.push(`${path}: "${k}" must be required in strict mode`);
    if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    for (const k of keys) problems.push(...assertStrictSchema(schema.properties[k], `${path}.${k}`));
  }
  if (schema.items) problems.push(...assertStrictSchema(schema.items, `${path}[]`));
  return problems;
}
