// @ariskill/ui qr.js - self-contained QR Code encoder (ISO/IEC 18004), no third-party code.
// Scope: byte mode (UTF-8), error-correction level M, versions 1-10 auto-selected, all 8 masks with
// penalty scoring, Reed-Solomon over GF(256) with primitive polynomial 0x11D.
//
//   encodeQr(text, { minVersion = 1, maxVersion = 10, mask = -1 }) -> { version, size, mask, ecl: 'M', modules: boolean[][] }
//   qrToSvg(text, { size = 256, margin = 4, dark = '#000', light = '#fff', ariaLabel, title }) -> SVG string
//   decodeFormatInfo(bits15) -> { ecl, mask, distance } | null   (BCH(15,5) decode used in tests)
//
// modules[y][x] === true means a dark module. Row/column indices are 0-based from the top-left.

export const ECL_M = { name: 'M', formatBits: 0b00 };

// Table 9 (ISO/IEC 18004) for level M: [totalCodewords, ecCodewordsPerBlock, [ [blockCount, dataPerBlock], ... ]]
export const VERSION_TABLE = Object.freeze({
  1:  { total: 26,  ecPerBlock: 10, blocks: [[1, 16]] },
  2:  { total: 44,  ecPerBlock: 16, blocks: [[1, 28]] },
  3:  { total: 70,  ecPerBlock: 26, blocks: [[1, 44]] },
  4:  { total: 100, ecPerBlock: 18, blocks: [[2, 32]] },
  5:  { total: 134, ecPerBlock: 24, blocks: [[2, 43]] },
  6:  { total: 172, ecPerBlock: 16, blocks: [[4, 27]] },
  7:  { total: 196, ecPerBlock: 18, blocks: [[4, 31]] },
  8:  { total: 242, ecPerBlock: 22, blocks: [[2, 38], [2, 39]] },
  9:  { total: 292, ecPerBlock: 22, blocks: [[3, 36], [2, 37]] },
  10: { total: 346, ecPerBlock: 26, blocks: [[4, 43], [1, 44]] },
});
const ALIGNMENT_POSITIONS = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };
export const MIN_VERSION = 1, MAX_VERSION = 10;

export function dataCodewordCount(version) {
  const t = VERSION_TABLE[version];
  return t.blocks.reduce((n, [count, len]) => n + count * len, 0);
}
export function sizeForVersion(version) { return 17 + 4 * version; }
export function byteCharCountBits(version) { return version <= 9 ? 8 : 16; }

/** Bytes that fit in `version` at level M in byte mode. */
export function byteCapacity(version) {
  return Math.floor((dataCodewordCount(version) * 8 - 4 - byteCharCountBits(version)) / 8);
}

/** Smallest version in [min,max] holding `byteLength` bytes, or -1. */
export function chooseVersion(byteLength, minVersion = MIN_VERSION, maxVersion = MAX_VERSION) {
  for (let v = minVersion; v <= maxVersion; v++) if (byteCapacity(v) >= byteLength) return v;
  return -1;
}

export function utf8Bytes(text) {
  if (typeof TextEncoder === 'function') return Array.from(new TextEncoder().encode(String(text)));
  const out = []; const s = encodeURIComponent(String(text));
  for (let i = 0; i < s.length; i++) { if (s[i] === '%') { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else out.push(s.charCodeAt(i)); }
  return out;
}

// ---------------------------------------------------------------------------------------------
// GF(256) arithmetic and Reed-Solomon (generator built from (x - a^0)(x - a^1)...(x - a^(n-1)))
// ---------------------------------------------------------------------------------------------
const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
export function gfMultiply(a, b) { if (a === 0 || b === 0) return 0; return GF_EXP[GF_LOG[a] + GF_LOG[b]]; }
export function gfExp(i) { return GF_EXP[((i % 255) + 255) % 255]; }

/** Generator polynomial coefficients, highest degree first, leading coefficient 1, length degree+1. */
export function reedSolomonGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    // multiply poly by (x - a^i) == (x + a^i) in GF(2^8)
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= gfMultiply(poly[j], GF_EXP[i]); }
    poly = next;
  }
  return poly;
}

/** Remainder of data(x) * x^degree divided by the generator = the EC codewords. */
export function reedSolomonEncode(data, degree) {
  const gen = reedSolomonGenerator(degree);
  const result = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= gfMultiply(gen[i + 1], factor);
  }
  return result;
}

/** Polynomial remainder (GF(256)) of message (highest degree first) divided by divisor; all-zero when divisible. */
export function polyRemainder(message, divisor) {
  const msg = message.slice();
  for (let i = 0; i + divisor.length <= msg.length; i++) {
    const coef = msg[i];
    if (coef === 0) continue;
    for (let j = 0; j < divisor.length; j++) msg[i + j] ^= gfMultiply(divisor[j], coef);
  }
  return msg.slice(msg.length - (divisor.length - 1));
}

// ---------------------------------------------------------------------------------------------
// Data codewords (byte mode) and interleaving
// ---------------------------------------------------------------------------------------------
class BitBuffer {
  constructor() { this.bits = []; }
  push(value, length) { for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1); }
  get length() { return this.bits.length; }
}

/** Byte-mode data codewords for `bytes` at `version` (mode 0100, count, data, terminator, pad 0xEC/0x11). */
export function buildDataCodewords(bytes, version) {
  const capacityBits = dataCodewordCount(version) * 8;
  const bb = new BitBuffer();
  bb.push(0b0100, 4);
  bb.push(bytes.length, byteCharCountBits(version));
  for (const b of bytes) bb.push(b & 0xff, 8);
  if (bb.length > capacityBits) throw new Error(`qr: data does not fit version ${version}`);
  bb.push(0, Math.min(4, capacityBits - bb.length));      // terminator
  if (bb.length % 8) bb.push(0, 8 - (bb.length % 8));      // byte align
  for (let pad = 0xEC; bb.length < capacityBits; pad ^= 0xEC ^ 0x11) bb.push(pad, 8);
  const out = [];
  for (let i = 0; i < bb.bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bb.bits[i + j]; out.push(v); }
  return out;
}

/** Split into blocks, append EC per block, interleave data then EC codewords. Returns { codewords, blocks }. */
export function addErrorCorrection(dataCodewords, version) {
  const t = VERSION_TABLE[version];
  if (dataCodewords.length !== dataCodewordCount(version)) throw new Error('qr: wrong data length');
  const blocks = [];
  let offset = 0;
  for (const [count, len] of t.blocks) {
    for (let i = 0; i < count; i++) {
      const data = dataCodewords.slice(offset, offset + len); offset += len;
      blocks.push({ data, ec: reedSolomonEncode(data, t.ecPerBlock) });
    }
  }
  const codewords = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) codewords.push(b.data[i]);
  for (let i = 0; i < t.ecPerBlock; i++) for (const b of blocks) codewords.push(b.ec[i]);
  if (codewords.length !== t.total) throw new Error('qr: interleave produced wrong length');
  return { codewords, blocks };
}

// ---------------------------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------------------------
function makeGrid(size, fill = false) { return Array.from({ length: size }, () => new Array(size).fill(fill)); }

/** Function-pattern layout for a version: returns { modules, isFunction } with finder/timing/alignment/dark module and reserved format/version areas. */
export function buildFunctionPatterns(version) {
  const size = sizeForVersion(version);
  const modules = makeGrid(size), isFunction = makeGrid(size);
  const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { modules[y][x] = dark; isFunction[y][x] = true; } };
  // Timing patterns
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Finder patterns (with separators) at three corners
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  // Alignment patterns
  const pos = ALIGNMENT_POSITIONS[version];
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Reserve format info areas (filled later) and the dark module
  drawFormatBits(modules, isFunction, size, 0);
  drawVersionBits(modules, isFunction, version);
  return { size, modules, isFunction };
}

/** BCH(15,5) format information for level M and `mask`, already XOR-masked with 0x5412. */
export function formatInfoBits(mask, ecl = ECL_M) {
  const data = (ecl.formatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  if (bits >>> 15 !== 0) throw new Error('qr: format bits overflow');
  return bits;
}

const ECL_BY_FORMAT = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };
/**
 * decodeFormatInfo(bits15) -> { ecl, mask, distance } for the closest valid BCH codeword (distance <= 3) or null.
 * Exhaustively compares against all 32 valid codewords, which is the standard decoding approach.
 */
export function decodeFormatInfo(bits15) {
  let best = null;
  for (let data = 0; data < 32; data++) {
    const ecl = data >> 3, mask = data & 7;
    const valid = formatInfoBits(mask, { formatBits: ecl });
    let diff = valid ^ (bits15 & 0x7fff), dist = 0;
    while (diff) { dist += diff & 1; diff >>>= 1; }
    if (!best || dist < best.distance) best = { ecl: ECL_BY_FORMAT[ecl], mask, distance: dist };
  }
  return best && best.distance <= 3 ? best : null;
}

function drawFormatBits(modules, isFunction, size, mask) {
  const bits = formatInfoBits(mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  const set = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };
  // Copy 1: around the top-left finder
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  // Copy 2: top-right row and bottom-left column
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true); // always-dark module
}

/** BCH(18,6) version information (versions >= 7). */
export function versionInfoBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
  return (version << 12) | rem;
}
function drawVersionBits(modules, isFunction, version) {
  if (version < 7) return;
  const size = sizeForVersion(version);
  const bits = versionInfoBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3), b = Math.floor(i / 3);
    modules[b][a] = dark; isFunction[b][a] = true;
    modules[a][b] = dark; isFunction[a][b] = true;
  }
}

/** Zigzag placement of the final codeword sequence (MSB first) into non-function modules. */
export function placeCodewords(modules, isFunction, codewords, version) {
  const size = modules.length;
  const totalBits = codewords.length * 8;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < totalBits) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
        // remainder modules stay light (false)
      }
    }
  }
  if (i !== totalBits) throw new Error('qr: placement mismatch');
  const remainder = size * size - countFunction(isFunction) - totalBits;
  if (remainder !== REMAINDER_BITS[version]) throw new Error(`qr: unexpected remainder bits ${remainder}`);
}
function countFunction(isFunction) { let n = 0; for (const row of isFunction) for (const v of row) if (v) n++; return n; }

export const MASK_FUNCTIONS = [
  (y, x) => (x + y) % 2 === 0,
  (y, x) => y % 2 === 0,
  (y, x) => x % 3 === 0,
  (y, x) => (x + y) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (y, x) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (y, x) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** XOR the mask pattern onto all non-function modules (applying twice removes it). */
export function applyMask(modules, isFunction, mask) {
  const fn = MASK_FUNCTIONS[mask];
  if (!fn) throw new Error('qr: mask out of range');
  const size = modules.length;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFunction[y][x] && fn(y, x)) modules[y][x] = !modules[y][x];
}

const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

/** N3 helper: count 1011101 patterns with 4 light modules before or after. The quiet zone outside the symbol is light. */
function finderLikePatterns(line) {
  const a = [false, false, false, false, ...line, false, false, false, false];
  let count = 0;
  for (let i = 0; i + 11 <= a.length; i++) {
    if (a[i] && !a[i + 1] && a[i + 2] && a[i + 3] && a[i + 4] && !a[i + 5] && a[i + 6] && !a[i + 7] && !a[i + 8] && !a[i + 9] && !a[i + 10]) count++; // 1011101 0000
    if (!a[i] && !a[i + 1] && !a[i + 2] && !a[i + 3] && a[i + 4] && !a[i + 5] && a[i + 6] && a[i + 7] && a[i + 8] && !a[i + 9] && a[i + 10]) count++; // 0000 1011101
  }
  return count;
}
/** N1 helper: runs of 5+ same-colour modules score 3 + (length - 5). */
function runPenalty(line) {
  let score = 0, run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) { run++; continue; }
    if (run >= 5) score += PENALTY_N1 + (run - 5);
    run = 1;
  }
  return score;
}

/** Penalty score per ISO/IEC 18004 section 7.8.3 (lower is better). */
export function penaltyScore(modules) {
  const size = modules.length;
  let result = 0;
  for (let y = 0; y < size; y++) { result += runPenalty(modules[y]) + finderLikePatterns(modules[y]) * PENALTY_N3; }
  for (let x = 0; x < size; x++) { const col = modules.map((row) => row[x]); result += runPenalty(col) + finderLikePatterns(col) * PENALTY_N3; }
  // 2x2 blocks of the same colour
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = modules[y][x];
    if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += PENALTY_N2;
  }
  // Balance of dark and light modules: 10 points per 5 % step away from 50 %
  let dark = 0; for (const row of modules) for (const v of row) if (v) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;
  return result;
}

/**
 * encodeQr(text, { minVersion, maxVersion, mask })
 * mask = -1 (default) evaluates all 8 masks and picks the lowest penalty.
 */
export function encodeQr(text, { minVersion = MIN_VERSION, maxVersion = MAX_VERSION, mask = -1 } = {}) {
  const bytes = utf8Bytes(text);
  const version = chooseVersion(bytes.length, Math.max(MIN_VERSION, minVersion), Math.min(MAX_VERSION, maxVersion));
  if (version < 0) throw new RangeError(`qr: ${bytes.length} bytes exceed capacity of version ${Math.min(MAX_VERSION, maxVersion)}-M (${byteCapacity(Math.min(MAX_VERSION, maxVersion))} bytes)`);
  const data = buildDataCodewords(bytes, version);
  const { codewords, blocks } = addErrorCorrection(data, version);
  const { size, modules, isFunction } = buildFunctionPatterns(version);
  placeCodewords(modules, isFunction, codewords, version);
  let chosen = mask;
  if (chosen === -1) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(modules, isFunction, m);
      drawFormatBits(modules, isFunction, size, m);
      const p = penaltyScore(modules);
      if (p < best) { best = p; chosen = m; }
      applyMask(modules, isFunction, m); // undo
    }
  }
  if (chosen < 0 || chosen > 7) throw new RangeError('qr: mask must be -1..7');
  applyMask(modules, isFunction, chosen);
  drawFormatBits(modules, isFunction, size, chosen);
  return { version, size, mask: chosen, ecl: 'M', modules, isFunction, dataCodewords: data, codewords, blocks };
}

function escapeAttr(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

/**
 * qrToSvg(text, { size = 256, margin = 4, dark = '#000', light = '#fff', ariaLabel, title })
 * Returns an accessible SVG string (role="img", aria-label) with crisp edges; one <path> for all dark modules.
 */
export function qrToSvg(text, { size = 256, margin = 4, dark = '#000', light = '#fff', ariaLabel = 'QR code', title = null, encodeOptions = {} } = {}) {
  const qr = typeof text === 'object' && text && text.modules ? text : encodeQr(text, encodeOptions);
  const n = qr.size, m = Math.max(0, margin | 0), view = n + 2 * m;
  const parts = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!qr.modules[y][x]) { x++; continue; }
      let run = 1; while (x + run < n && qr.modules[y][x + run]) run++;
      parts.push(`M${x + m} ${y + m}h${run}v1h-${run}z`);
      x += run;
    }
  }
  const titleEl = title ? `<title>${escapeAttr(title)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="${size}" height="${size}" role="img" aria-label="${escapeAttr(ariaLabel)}" shape-rendering="crispEdges">${titleEl}<rect width="${view}" height="${view}" fill="${escapeAttr(light)}"/><path d="${parts.join('')}" fill="${escapeAttr(dark)}"/></svg>`;
}

/** Render into a DOM container (browser only). Returns the SVG element or null in non-DOM environments. */
export function renderQr(container, text, options = {}) {
  if (typeof document === 'undefined' || !container) return null;
  container.innerHTML = qrToSvg(text, options);
  return container.firstElementChild;
}
