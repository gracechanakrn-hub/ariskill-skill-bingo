// tools/ai/lib/copy-rules.js - pure rules, schema and prompt builders for copy (CW) proposals. Proposals only (OD-11).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../env.js';
import { extractSection } from './common.js';

export const CANDIDATE_KEY = 'select.encouragement';
export const CANDIDATE_PURPOSE = 'Short, warm nudge shown on the skill-selection screen while the participant is between 1 and 24 picks (e.g. under the progress line). Optional; the screen must read fine without it.';

/** Hard rules embedded verbatim in the developer prompt. */
export const HARD_RULES = [
  'Souls are non-ranking: never use level, tier, rank, score, points, XP, leaderboard, unlock-by-merit, "stronger", "better than" or any language that implies one participant, Platform or Role is worth more than another (requirement BR-17, section 9.1).',
  'No analyst or export language: no "export", "download report", "CSV", "dashboard", "analytics", "assessment", "evaluate your skills", "gap analysis". This is discovery, not assessment.',
  'All interface names, labels and copy are provisional working names pending content/design-system review (requirement 8.1). Do not invent new features, screens, sections or product scope.',
  'Exception copy E1-E24 must keep its exact meaning, trigger and recovery: alternatives may reword, never change what the user is told to do or what happened.',
  'English only. Thai or bilingual text is not required and must not be produced.',
  'Keep every {placeholder} exactly as in the current text, in the same order, with the same meaning.',
  'Copy is calm, warm, plain, inclusive and short: no exclamation-mark stacking, no shouting, no jokes at the user, no gambling language ("jackpot", "bet", "odds"), no competition-first framing.',
  'Never write a sentence a presenter could read as a marketing slogan; this is product copy, not a campaign.',
];

/** Patterns that fail a proposal at lint time (case-insensitive, word-bounded). */
export const FORBIDDEN_PATTERNS = [
  /\blevel(s|ed|ing)?\b/i, /\btiers?\b/i, /\brank(s|ed|ing)?\b/i, /\bscores?\b/i, /\bpoints?\b/i, /\bxp\b/i, /\bleaderboards?\b/i,
  /\bexports?\b/i, /\bdownload\b/i, /\bcsv\b/i, /\banalytics?\b/i, /\banalysts?\b/i, /\bassess(ment|ed)?\b/i, /\bevaluat(e|ion)\b/i, /\bgap analysis\b/i,
  /\bjackpot\b/i, /\bodds\b/i, /\bbet\b/i, /\bstronger\b/i, /\bbetter than\b/i, /\bwinner takes\b/i,
  /[฀-๿]/, // Thai script
];
// Keys where a listed word is part of the locked meaning (e.g. "Skill insights"), so lint is relaxed for those words only.
export const LINT_ALLOW = { 'stage.insights': [/\banalytics?\b/i], 'admin.insights': [], 'insight.title': [] };

export function lintText(text, key = '') {
  const allow = LINT_ALLOW[key] || [];
  const hits = [];
  for (const re of FORBIDDEN_PATTERNS) {
    if (allow.some((a) => a.source === re.source)) continue;
    const m = String(text).match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

export function placeholdersOf(text) { return (String(text).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort(); }
export function placeholdersMatch(current, proposal) { return JSON.stringify(placeholdersOf(current)) === JSON.stringify(placeholdersOf(proposal)); }

/** Flat list of catalogue items: `key.*` strings and `exception.E<n>` copy with trigger/recovery context. */
export function catalogueItems(copy) {
  const items = Object.entries(copy.key).map(([key, current]) => ({ key, current, context: null }));
  for (const [id, e] of Object.entries(copy.exceptions || {})) items.push({ key: `exception.${id}`, current: e.copy, context: `Trigger: ${e.trigger}. Recovery: ${e.recovery}.` });
  return items;
}

export function chunk(list, size) { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; }

/** Strict JSON schema for one batch of proposals. */
export const PROPOSAL_ITEM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['key', 'current', 'alternatives'],
  properties: {
    key: { type: 'string' },
    current: { type: 'string' },
    alternatives: {
      type: 'array', minItems: 2, maxItems: 2,
      items: { type: 'object', additionalProperties: false, required: ['text', 'rationale'], properties: { text: { type: 'string' }, rationale: { type: 'string' } } },
    },
  },
};
export const BATCH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['proposals'],
  properties: { proposals: { type: 'array', items: PROPOSAL_ITEM_SCHEMA } },
};
export const CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['key', 'purpose', 'options', 'placementNote'],
  properties: {
    key: { type: 'string' },
    purpose: { type: 'string' },
    placementNote: { type: 'string' },
    options: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['text', 'rationale'], properties: { text: { type: 'string' }, rationale: { type: 'string' } } } },
  },
};

/** Requirement + glossary excerpts that define the tone (read at run time so the prompt follows the locked text). */
export function loadToneSources(root = ROOT) {
  const req = readFileSync(join(root, 'docs', 'requirements', 'ariskill-skill-bingo-requirements.md'), 'utf8');
  const glossary = readFileSync(join(root, 'docs', 'requirements', 'glossary.md'), 'utf8');
  return {
    summary: extractSection(req, /^## 1\. Product Summary/),
    design: extractSection(req, /^### 8\.1 /),
    keyCopy: extractSection(req, /^### 8\.2 /),
    exceptions: extractSection(req, /^### 8\.3 /),
    theme: extractSection(req, /^### 9\.1 /),
    soul: extractSection(req, /^### 9\.3 /),
    glossary: glossary.trim(),
  };
}

export function buildCopySystemPrompt(tone) {
  return [
    'You are a UX writer proposing alternative English microcopy for "AriSkill Skill Bingo", a live internal event game at Arise.',
    'You produce PROPOSALS ONLY. They go to the content owner for review (open decision OD-11). Nothing you write is adopted automatically.',
    '',
    'HARD RULES (each one is a release invariant; violating it makes the proposal unusable):',
    ...HARD_RULES.map((r, i) => `${i + 1}. ${r}`),
    '',
    'PRODUCT CONTEXT (locked requirement excerpts):',
    tone.summary, '', tone.theme, '', tone.soul, '',
    'PROVISIONAL DESIGN / COPY DECISIONS:', tone.design, '', tone.keyCopy, '', tone.exceptions, '',
    'GLOSSARY (use these terms exactly; capitalise Soul, Galaxy, Bingo Star, Platform, Role, Skill Master, Mission Control as shown):', tone.glossary,
    '',
    'OUTPUT: for every key you receive, give exactly two alternatives, each with a one-sentence rationale. Alternatives must differ from the current text and from each other, keep the same length class (a button label stays a label; a sentence stays one sentence), and keep the same placeholders.',
  ].join('\n');
}

export function buildBatchUserPrompt(items, batchIndex, batchCount) {
  const lines = items.map((it) => `- key: ${it.key}\n  current: ${JSON.stringify(it.current)}${it.context ? `\n  context: ${it.context}` : ''}`);
  return `Batch ${batchIndex + 1} of ${batchCount}. Propose two alternatives for each of these ${items.length} copy keys. Return the "current" text verbatim.\n\n${lines.join('\n')}`;
}

export function buildCandidateUserPrompt() {
  return [
    `Propose a NEW candidate copy key "${CANDIDATE_KEY}".`,
    `Purpose: ${CANDIDATE_PURPOSE}`,
    'Give three options (each at most 60 characters, no placeholders, no exclamation mark stacking), one sentence of rationale each, and a placement note for the content owner.',
    'Remember: encouragement about discovery and completing the 25 picks, never about performance, standing or comparison with others.',
  ].join('\n');
}

/** Lint + shape check of one batch response against the items sent. Returns { accepted, rejected, missing }. */
export function reviewBatch(items, response) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const accepted = [], rejected = [];
  for (const p of response.proposals || []) {
    const src = byKey.get(p.key);
    if (!src) { rejected.push({ key: p.key, reason: 'unknown key' }); continue; }
    byKey.delete(p.key);
    const alts = p.alternatives.map((a) => {
      const problems = [];
      const hits = lintText(a.text, p.key);
      if (hits.length) problems.push(`forbidden wording: ${hits.join(', ')}`);
      if (!placeholdersMatch(src.current, a.text)) problems.push('placeholders differ from the current text');
      if (a.text.trim() === src.current.trim()) problems.push('identical to the current text');
      if (!a.text.trim()) problems.push('empty');
      return { text: a.text, rationale: a.rationale, lint: problems.length ? 'rejected' : 'ok', problems };
    });
    accepted.push({ key: p.key, current: src.current, context: src.context, alternatives: alts });
  }
  return { accepted, rejected, missing: [...byKey.keys()] };
}
