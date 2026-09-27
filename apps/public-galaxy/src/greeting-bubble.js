// The "say hi" speech bubble (stage 15, D-36). While a visiting Soul is at the front of the Galaxy, a bubble by its
// head reads "Hi, I'm <label>, <greeting>": the public label (the display name only when the player agreed to show it,
// otherwise no name) and the greeting the player typed on the phone before the Float (up to 40 words). The bubble
// sizes itself to the message (short: big type in a compact bubble; long: smaller type, wider), and the visit lasts
// as long as the message takes to read. Plain DOM text (textContent, never markup), crisp at any size, renderer-
// agnostic (galaxy.js feeds it each frame's visit). Visits never happen under reduced motion, so neither does the bubble.

export const BUBBLE = Object.freeze({
  maxWords: 40, maxChars: 280,         // the greeting as shown (the server applies the same limits when it is typed)
  font: Object.freeze([26, 19]),       // px at a 1080-row Galaxy: short message .. long message
  width: Object.freeze([380, 580]),    // max bubble width, px at 1080 rows: short .. long
  chars: Object.freeze([50, 240]),     // message lengths (characters, "Hi, I'm ..." included) the two ends apply to
  gapFraction: 0.1,                    // the tail sits this fraction of the visitor's size right of its centre
});

// Reading on a big screen, from across a room: about 3 words a second, plus a moment to notice the bubble.
export const READING = Object.freeze({ wordsPerSecond: 3, noticeS: 1.2, minS: 3.8, maxS: 16 });

const range = (a, b) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
// control characters, zero-width and bidi controls, line / paragraph separators, invisible formatters
const INVISIBLE = new RegExp(`[${range(0x00, 0x1f)}${range(0x7f, 0x9f)}${range(0x200b, 0x200f)}${range(0x2028, 0x202e)}${range(0x2060, 0x206f)}]`, 'g');
const ELLIPSIS = String.fromCharCode(0x2026);

/** One clean line: invisible characters out, whitespace collapsed, at most `maxChars` characters (with an ellipsis). */
export function cleanText(text, maxChars) {
  if (typeof text !== 'string') return '';
  const t = text.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const chars = [...t];
  return chars.length <= maxChars ? t : `${chars.slice(0, maxChars - 1).join('').trimEnd()}${ELLIPSIS}`;
}

/** The greeting as shown: one clean line, at most 40 words and 280 characters (an ellipsis marks a cut). '' if none. */
export function cleanGreeting(text, { maxWords = BUBBLE.maxWords, maxChars = BUBBLE.maxChars } = {}) {
  const t = cleanText(text, Number.MAX_SAFE_INTEGER);
  if (!t) return '';
  const words = t.split(' ');
  const cut = words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}${ELLIPSIS}` : t;
  return cleanText(cut, maxChars);
}

export const wordCount = (text) => (text ? text.split(' ').filter(Boolean).length : 0);

/**
 * The bubble's words: { lead, name, rest }. lead + name + rest reads "Hi, I'm Alex T., let's go!" (or "Hi, I'm Alex T.!"
 * with no greeting, "Hi! let's go!" with no public name, "Hi!" with neither). `name` is shown bold.
 */
export function bubbleText({ label = null, greeting = null } = {}) {
  const name = cleanText(label, 40);
  const words = cleanGreeting(greeting);
  if (name) return { lead: "Hi, I'm ", name, rest: words ? `, ${words}` : '!' };
  return { lead: words ? 'Hi! ' : 'Hi!', name: '', rest: words };
}

/** Seconds the visitor stays at the front: long enough to read its whole bubble (3.8 s .. 16 s). */
export function readingSeconds(visit) {
  const t = bubbleText(visit);
  const words = wordCount(`${t.lead}${t.name}${t.rest}`);
  return Math.min(READING.maxS, Math.max(READING.minS, READING.noticeS + words / READING.wordsPerSecond));
}

/** Type size and max width for a message (px at 1080 rows): big and compact when short, smaller and wider when long. */
export function bubbleStyle(visit) {
  const t = bubbleText(visit);
  const n = [...`${t.lead}${t.name}${t.rest}`].length;
  const k = Math.min(1, Math.max(0, (n - BUBBLE.chars[0]) / (BUBBLE.chars[1] - BUBBLE.chars[0])));
  return { fontPx: BUBBLE.font[0] + (BUBBLE.font[1] - BUBBLE.font[0]) * k, maxWidthPx: BUBBLE.width[0] + (BUBBLE.width[1] - BUBBLE.width[0]) * k };
}

/**
 * Where the bubble goes: above the visitor's head, to its right (its left when the right has no room), inside the
 * Galaxy. Visit = { x, y, size, scale } in Galaxy CSS px; box = { w, h } of the bubble. Returns { left, top, side }.
 */
export function bubblePlacement(visit, box, layout, margin = 16) {
  const drawn = visit.size * (visit.scale || 1);
  const headY = visit.y - drawn * 0.42;
  let side = 'right';
  let left = visit.x + drawn * BUBBLE.gapFraction;
  if (left + box.w > layout.width - margin) { side = 'left'; left = visit.x - drawn * BUBBLE.gapFraction - box.w; }
  left = Math.max(margin, Math.min(layout.width - margin - box.w, left));
  const top = Math.max(margin, Math.min(layout.height - margin - box.h, headY - box.h));
  return { left, top, side };
}

/** DOM bubble in `host` (the Galaxy container). update(visit | null, layout) each frame; dispose() removes it. */
export function createGreetingBubble(host) {
  const el = document.createElement('div');
  el.className = 'galaxy__bubble';
  el.setAttribute('aria-hidden', 'true');
  const lead = document.createElement('span'), name = document.createElement('b'), rest = document.createElement('span');
  el.append(lead, name, rest);
  host.appendChild(el);
  let shownKey = null, box = null;

  function hide() { if (shownKey !== null) { el.classList.remove('is-on'); shownKey = null; } }
  return {
    element: el,
    update(visit, layout) {
      if (!visit || visit.phase !== 'hi' || !layout) { hide(); return; }
      const key = `${visit.soulId}:${visit.key || ''}`;
      const k = layout.height / 1080;
      if (key !== shownKey) {
        const t = bubbleText(visit), st = bubbleStyle(visit);
        lead.textContent = t.lead; name.textContent = t.name; rest.textContent = t.rest;
        el.style.setProperty('--bubble-font', `${(st.fontPx * k).toFixed(1)}px`);
        el.style.setProperty('--bubble-max', `${Math.round(st.maxWidthPx * k)}px`);
        box = null;
        shownKey = key;
      }
      if (!box) { const r = el.getBoundingClientRect(); box = { w: r.width || BUBBLE.width[0] * k, h: r.height || BUBBLE.font[0] * k * 2 }; }
      const p = bubblePlacement(visit, box, layout);
      el.dataset.side = p.side;
      el.style.transform = `translate(${p.left.toFixed(1)}px, ${p.top.toFixed(1)}px)`;
      el.classList.add('is-on');
    },
    hide,
    dispose() { el.remove(); },
  };
}
