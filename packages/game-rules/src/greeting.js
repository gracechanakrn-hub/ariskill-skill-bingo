// Float greeting (D-42): an optional one-line message a player adds before Ready to Float, shown beside their Soul on
// the public screen. Isomorphic: the phone checks it as the player types and the server checks it again before it is
// stored (the server is the gate). Rules: control / invisible / bidi characters removed, whitespace (newlines too)
// collapsed to single spaces, trimmed; empty means no greeting (the big screen shows "Hi, I'm <name>!"); at most 40 characters
// (code points); no links, e-mail addresses, phone numbers or @handles; no word from a small blocklist.

export const GREETING_MAX_CHARS = 40;

// Kept short on purpose: an obvious-abuse net for a workplace screen, not a moderation system (OD-24).
const BLOCKLIST = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'bastard', 'asshole', 'slut', 'whore', 'nigger', 'faggot', 'retard', 'porn', 'sex', 'nude', 'kill yourself', 'kys'];

const BLOCKED = BLOCKLIST.map((w) => w.replace(/(.)\1+/g, '$1'));

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;   // controls, format chars (zero-width, bidi overrides), line / paragraph separators
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|th|app|dev|ly|me|gg|xyz|info|biz)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d[\d\s().-]{6,}\d/;
const HANDLE = /(^|\s)@[\p{L}\p{N}_.]{2,}/u;

/** Cleans the raw text: invisible characters out, whitespace collapsed, trimmed. */
export function cleanGreeting(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFC').replace(INVISIBLE, ' ').replace(/\s+/gu, ' ').trim();
}

export function greetingLength(text) { return [...text].length; }

/**
 * checkGreeting(raw) -> { ok: true, value: string|null } | { ok: false, reason, value }
 * reason: 'too-long' | 'link' | 'contact' | 'handle' | 'language'. An empty or missing greeting is ok with value null.
 */
export function checkGreeting(raw) {
  const value = cleanGreeting(raw);
  if (!value) return { ok: true, value: null };
  if (greetingLength(value) > GREETING_MAX_CHARS) return { ok: false, reason: 'too-long', value };
  if (EMAIL.test(value) || PHONE.test(value)) return { ok: false, reason: 'contact', value };   // before LINK: a@b.co is an e-mail
  if (LINK.test(value)) return { ok: false, reason: 'link', value };
  if (HANDLE.test(value)) return { ok: false, reason: 'handle', value };
  // compare squeezed spellings (accents dropped, repeated letters reduced to one) so "shiiit" and "shit" match alike
  const squeeze = (t) => t.replace(/(.)\1+/gu, '$1');
  const plain = squeeze(value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ''));
  const words = ` ${plain.replace(/\s+/g, ' ')} `;
  if (BLOCKED.some((w) => words.includes(` ${w} `) || words.includes(` ${w}s `))) return { ok: false, reason: 'language', value };
  return { ok: true, value };
}
