// tools/ai/lib/gemini.js - pure request/response shaping for the Gemini generateContent image API (skill: ai-image-generator).
// The API key goes in the `x-goog-api-key` header (never in the URL) so no log or dry-run file can carry it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

export function geminiUrl(model) { return `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`; }
export function geminiHeaders(key) { return { 'x-goog-api-key': key }; }

/** 5-part framework -> one narrative prompt (type, subject, environment, technical, constraints). */
export function composePrompt(parts) {
  const order = ['type', 'subject', 'environment', 'technical', 'constraints'];
  for (const k of order) if (!parts[k] || !String(parts[k]).trim()) throw new Error(`prompt part "${k}" is missing`);
  return order.map((k) => String(parts[k]).trim()).join('\n');
}

/** generateContent body for a fresh plate. */
export function buildGenerateRequest({ prompt, temperature = 0.8, aspectRatio = '1:1', history = [] }) {
  if (!ASPECT_RATIOS.includes(aspectRatio)) throw new Error(`unsupported aspect ratio ${aspectRatio}`);
  const contents = [...history, { role: 'user', parts: [{ text: prompt }] }];
  return {
    contents,
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], temperature, imageConfig: { aspectRatio } },
  };
}

/**
 * Multi-turn edit: replay the original user turn and the model turn (thought signatures intact), then ask for the edit
 * with an explicit KEEP list (skill: "always specify what to keep unchanged").
 */
export function buildRefinePrompt(instruction, keep = []) {
  const keepList = keep.length ? keep.join(', ') : 'the subject, framing, palette, lighting and background';
  return `Edit this image. Keep unchanged: ${keepList}. Only change: ${instruction.trim()}. No text, no watermarks, no logos, no human faces.`;
}
export function buildRefineRequest({ originalPrompt, modelParts, instruction, keep = [], temperature = 0.6, aspectRatio = '1:1' }) {
  const history = [
    { role: 'user', parts: [{ text: originalPrompt }] },
    { role: 'model', parts: modelParts },
  ];
  return buildGenerateRequest({ prompt: buildRefinePrompt(instruction, keep), temperature, aspectRatio, history });
}

/** Model parts from a response (inline images + text + thoughtSignature preserved verbatim). */
export function extractModelParts(response) {
  const cand = response?.candidates?.[0];
  if (!cand) {
    const why = response?.promptFeedback?.blockReason || 'no candidates';
    throw new Error(`Gemini returned no candidate (${why})`);
  }
  return cand.content?.parts || [];
}
export function extractImages(parts) {
  return parts.filter((p) => p.inlineData?.data).map((p) => ({ mimeType: p.inlineData.mimeType || 'image/png', bytes: Buffer.from(p.inlineData.data, 'base64') }));
}
export function extractText(parts) { return parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n').trim(); }

/** Store model parts without the base64 payload (image bytes live in the PNG next to provenance.json). */
export function dehydrateParts(parts, fileNames) {
  let i = 0;
  return parts.map((p) => {
    if (!p.inlineData?.data) return p;
    const { data, ...rest } = p.inlineData;
    return { ...p, inlineData: { ...rest, file: fileNames[i++] } };
  });
}
export function rehydrateParts(parts, dir) {
  return parts.map((p) => {
    if (!p.inlineData?.file) return p;
    const { file, ...rest } = p.inlineData;
    return { ...p, inlineData: { ...rest, data: readFileSync(join(dir, file)).toString('base64') } };
  });
}
