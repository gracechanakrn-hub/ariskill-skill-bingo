// tools/ai/lib/uxui-rules.js - pure schema, screen catalogue and prompt builders for UX/UI template proposals (proposal only).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../env.js';
import { extractSection, tokenNames } from './common.js';

/** Sticker tokens named in docs/art/sticker-art-direction.md (design-tokens 1.2.0 pending; names are final). */
export const STICKER_TOKENS = ['--sticker-navy', '--sticker-space', '--sticker-aurora-teal', '--sticker-aurora-lime', '--sticker-lilac', '--sticker-violet-deep', '--sticker-mint', '--sticker-cyan', '--sticker-peach', '--sticker-gold', '--sticker-rose', '--sticker-badge', '--sticker-badge-ink', '--sticker-outline', '--sticker-shadow', '--font-display'];

/** Screens to propose for, with the current structure (from the apps README files) so the proposal builds on what exists. */
export const SCREENS = [
  { id: 'employee-join', app: 'employee-mobile', title: 'Employee - Join (E1) and expired link (E2)', current: 'Join form: employee reference, display name, public-name consent + note, "Join the event" CTA; audio unlock inside the join tap. Ambient 3D orb + rings + motes behind the form (join-scene.js) with a CSS orb fallback. Expired link shows exception E2.', copyKeys: ['join.title', 'join.employeeRef', 'join.displayName', 'join.consent', 'join.consentNote', 'join.cta', 'exception.E2'] },
  { id: 'employee-select', app: 'employee-mobile', title: 'Employee - Platform/Role (E2) and skill selection (E3)', current: 'Profile step: Platform + Role selects, never prefilled, CTA disabled until both chosen (E16). Selection: three tabs (Recommended for Your Role / Popular at Arise / Search All Skills), debounced search, skill rows with aria-pressed + Core/Critical kind chip + eligibility text, chip strip with Remove and one-level Undo, progress "{count} / 25", banners E1/E8/E15, retry for E6/E18. No "accept all" control.', copyKeys: ['profile.title', 'profile.platform', 'profile.role', 'profile.cta', 'select.title', 'select.progress', 'select.tab.recommended', 'select.tab.popular', 'select.tab.search', 'select.hint', 'select.eligible', 'select.notEligible', 'select.remove', 'select.undo', 'exception.E16', 'exception.E17'] },
  { id: 'employee-board', app: 'employee-mobile', title: 'Employee - Board ready / locked / deferred (E4, E5)', current: '5x5 grid (grid.js) with state classes, server countdown to lock, "Edit skills" with reshuffle warning, no-round state, locked state, deferred state (incomplete / late / cancelled) with next-round info card.', copyKeys: ['board.complete', 'board.waiting', 'board.edit', 'board.editWarning', 'board.locked', 'board.deferred', 'board.noRound', 'exception.E5', 'exception.E8', 'exception.E15'] },
  { id: 'employee-playing', app: 'employee-mobile', title: 'Employee - Playing (E6)', current: 'Latest draw card, draw list, automatic matches on the 5x5 grid, draws 1-4 banner ("Bingo unlocks at draw 5") vs "Bingo is live", matched count, pacing text. Live-region announcements for accepted draws; celebration guard; reduced motion honoured.', copyKeys: ['play.waitingStart', 'play.drawsBeforeFive', 'play.drawsBeforeFiveN', 'play.evaluationActive', 'play.draw', 'play.matched', 'play.pacing'] },
  { id: 'employee-result', app: 'employee-mobile', title: 'Employee - Result (E7)', current: 'Winner / co-winner / not-winner copy, the first completed line traced once (live only), "Reveal my Soul" CTA, E22 while the Soul is forming, "Shown on the public screen as" label, next-round card.', copyKeys: ['result.bingo', 'result.roundComplete', 'result.winner', 'result.coWinners', 'result.notWinner', 'result.noRankNote', 'exception.E22'] },
  { id: 'employee-soul', app: 'employee-mobile', title: 'Employee - Soul reveal, insight and Float (E8-E10)', current: 'Staged reveal (glow -> silhouette -> features; skippable after first view), 3D lathe Soul scene with SVG fallback, private Role Skill Matrix insight, READY TO FLOAT countdown on the server clock, one-use Float with kept idempotency key (E13 retry), floated state with the small SVG Soul.', copyKeys: ['soul.ready', 'soul.float', 'soul.floated', 'soul.countdown', 'soul.badge', 'insight.title', 'insight.inMatrix', 'insight.beyond', 'insight.private', 'exception.E13'] },
  { id: 'stage', app: 'stage-dashboard', title: 'Stage dashboard (presenter, read-only, venue theme)', current: 'Opaque glossy tiles over an ambient Three.js backdrop at 0.5 dpr: round status, participation, skill insights, matrix alignment, beyond-matrix, small-group suppression note. Distance-readable (.theme-venue: body >= 40 px, headline >= 96 px). No doodads (presenter legibility).', copyKeys: ['stage.status', 'stage.participation', 'stage.insights', 'stage.alignment', 'stage.beyond', 'stage.suppressed', 'public.playing.draw'] },
  { id: 'public', app: 'public-galaxy', title: 'Public event screen (65 % Galaxy, 35 % info panel)', current: 'Three.js Galaxy (bloom, fireflies, forest silhouettes, winner burst) with fallback chain three -> webgl2 -> canvas2d -> static; right-side info panel: waiting (QR "Scan to join", countdown, previous winners), playing (draw number, boards matched, draw-5 unlock / Bingo is live), winner (Bingo!, round, names or "Soul #id"), cancelled, exhausted. Effects never cross the panel safe zone.', copyKeys: ['public.waiting.title', 'public.waiting.scan', 'public.waiting.previous', 'public.playing.draw', 'public.playing.matched', 'public.playing.pacing', 'public.playing.live', 'public.winner.title', 'public.winner.round', 'public.winner.anonymous', 'public.cancelled', 'public.exhausted', 'exception.E12'] },
  { id: 'admin', app: 'admin-portal', title: 'Admin portal - Mission Control, Insights, Audit (light theme)', current: 'Flat operational light theme (data-theme="light"): sign-in with admin token, tabs #mission / #insights / #audit, round list + create-round form, current round panel per state (draft ... end) with Create / Open registration / Lock now / Start / Start now (confirm) / Next Skill (pending state, pacing hint) / Cancel (reason) / Close, readiness lines (pool size, boards that can win), lock countdown, toasts, focus-trapped dialogs. Insights polled every 10 s; audit table newest first.', copyKeys: ['admin.missionControl', 'admin.insights', 'admin.createRound', 'admin.openRegistration', 'admin.lockNow', 'admin.start', 'admin.startNow', 'admin.startNowConfirm', 'admin.nextSkill', 'admin.nextSkillPending', 'admin.pacingHint', 'admin.cancel', 'admin.close', 'admin.startOverdue', 'admin.readiness.pool', 'admin.readiness.canWin', 'admin.readiness.noneCanWin', 'admin.lockCountdown', 'exception.E9', 'exception.E10', 'exception.E11', 'exception.E20'] },
];

const strArr = { type: 'array', items: { type: 'string' } };
export const SCREEN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['screen', 'summary', 'layoutRegions', 'components', 'tokenUsage', 'motion', 'accessibility', 'stickerNotes', 'openQuestions'],
  properties: {
    screen: { type: 'string' },
    summary: { type: 'string' },
    layoutRegions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'role', 'placement', 'contains'], properties: { id: { type: 'string' }, role: { type: 'string' }, placement: { type: 'string' }, contains: strArr } } },
    components: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'region', 'variant', 'states', 'tokens', 'copyKeys', 'notes'], properties: { name: { type: 'string' }, region: { type: 'string' }, variant: { type: 'string' }, states: strArr, tokens: strArr, copyKeys: strArr, notes: { type: 'string' } } } },
    tokenUsage: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['token', 'use'], properties: { token: { type: 'string' }, use: { type: 'string' } } } },
    motion: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['trigger', 'cue', 'durationToken', 'reducedMotion'], properties: { trigger: { type: 'string' }, cue: { type: 'string' }, durationToken: { type: 'string' }, reducedMotion: { type: 'string' } } } },
    accessibility: strArr,
    stickerNotes: strArr,
    openQuestions: strArr,
  },
};

export function loadUxSources(root = ROOT) {
  const req = readFileSync(join(root, 'docs', 'requirements', 'ariskill-skill-bingo-requirements.md'), 'utf8');
  const art = readFileSync(join(root, 'docs', 'art', 'sticker-art-direction.md'), 'utf8');
  const tokens = JSON.parse(readFileSync(join(root, 'packages', 'design-tokens', 'tokens.json'), 'utf8'));
  return {
    design: extractSection(req, /^### 8\.1 /),
    theme: extractSection(req, /^### 9\.1 /),
    galaxy: extractSection(req, /^### 9\.2 /),
    motion: extractSection(req, /^## 11\. /),
    a11y: extractSection(req, /^### 12\.2 /),
    art,
    tokenNames: tokenNames(tokens),
    tokenRules: tokens.rules || {},
  };
}

export function allowedTokenNames(src) { return [...new Set([...src.tokenNames, ...STICKER_TOKENS])].sort(); }

export function buildUxSystemPrompt(src) {
  return [
    'You are a product designer proposing a UX/UI TEMPLATE (layout regions, components, token usage, motion cues, accessibility notes) for one screen of "AriSkill Skill Bingo", a live internal event game at Arise.',
    'This is a PROPOSAL ONLY for the design owner; nothing is applied automatically. Build on the existing screen structure you are given: refine, do not reinvent, and do not add features, screens or product scope.',
    '',
    'HARD RULES:',
    '1. Souls are non-ranking (BR-17): no level, tier, rank, score, leaderboard or "stronger" language or visuals; every Soul is the same size and brightness; the only badge is the Bingo Star.',
    '2. No analyst / export UI: no export buttons, downloads, CSV, per-person analytics. Insights are aggregate and privacy-safe.',
    '3. All names and labels are provisional (requirement 8.1). Copy comes from packages/contracts/copy.json keys; reference keys, do not write new copy except as an open question.',
    '4. Use ONLY token names from the allowed list below (design-tokens 1.1.0 plus the --sticker-* names from the art direction, which are pending 1.2.0). Never invent token names or hard-code colours.',
    '5. Semantic colour is never the only signal (Core = filled diamond + "Core", Critical = filled circle + "Critical").',
    '6. Accessibility baseline: WCAG 2.2 AA, 44x44 px targets, visible focus, live regions for accepted draws/results, no focus theft, reduced motion, zoom/reflow; venue displays: body >= 40 px, headline >= 96 px.',
    '7. Sticker art direction: glossy clay, white die-cut outlines, aurora night-forest sky, doodads never over text and never on the stage screen; flash safety (<= 3 luminance flips/s), additive glow capped.',
    '8. English only. No human-faced mascots. No marketing slogans.',
    '',
    'ALLOWED TOKEN NAMES:', allowedTokenNames(src).join(', '),
    '', 'TOKEN RULES:', JSON.stringify(src.tokenRules),
    '', 'REQUIREMENT EXCERPTS:', src.design, '', src.theme, '', src.galaxy, '', src.motion, '', src.a11y,
    '', 'STICKER ART DIRECTION (v2, provisional D-25):', src.art,
    '', 'OUTPUT: fill the JSON schema. layoutRegions top to bottom / left to right; components reference a region id and list token names and copy keys; motion cues name a duration token (--duration-fast/base/slow) and the reduced-motion behaviour; openQuestions collect anything the design owner must decide.',
  ].join('\n');
}

export function buildScreenUserPrompt(screen) {
  return [`Screen: ${screen.id} (${screen.app}) - ${screen.title}`, '', `Current structure: ${screen.current}`, '', `Copy keys available: ${screen.copyKeys.join(', ')}`, '', 'Propose the UX/UI template for this screen.'].join('\n');
}

/** Post-check: token names outside the allowed list are flagged (never silently kept). */
export function reviewScreen(data, allowed) {
  const set = new Set(allowed);
  const unknown = new Set();
  for (const c of data.components || []) for (const t of c.tokens || []) if (!set.has(t)) unknown.add(t);
  for (const t of data.tokenUsage || []) if (!set.has(t.token)) unknown.add(t.token);
  for (const m of data.motion || []) if (m.durationToken && !set.has(m.durationToken)) unknown.add(m.durationToken);
  return { unknownTokens: [...unknown].sort() };
}
