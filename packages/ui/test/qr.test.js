import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeQr, qrToSvg, decodeFormatInfo, formatInfoBits, versionInfoBits, reedSolomonEncode, reedSolomonGenerator, polyRemainder,
  gfExp, gfMultiply, buildDataCodewords, addErrorCorrection, buildFunctionPatterns, placeCodewords, applyMask, penaltyScore,
  chooseVersion, byteCapacity, sizeForVersion, VERSION_TABLE, MASK_FUNCTIONS,
} from '../qr.js';

// Reference matrices produced by an independent, widely used encoder (python-qrcode 8.x) for byte mode,
// level M, at the mask our encoder selects. Verified during development to decode with OpenCV's QRCodeDetector.
const REF_HELLO_WORLD_V1_M_MASK4 = `
#######.##..#.#######
#.....#....#..#.....#
#.###.#..#.#..#.###.#
#.###.#.#..#..#.###.#
#.###.#.###.#.#.###.#
#.....#.#..#..#.....#
#######.#.#.#.#######
........#..##........
#...#.######.#####..#
...#....#.###....####
..######..##.##.#..#.
#####...##...#.......
#####.#.#.#.#.##..##.
........#.#.####.#.##
#######.###.#.#.##.#.
#.....#..#.###.##..##
#.###.#.##.#.##...##.
#.###.#..#..#...##.##
#.###.#..###...###...
#.....#....#.#.......
#######.#########.#.#`.trim().split('\n');

const REF_URL_V3_M_MASK2 = `
#######.....####..###.#######
#.....#....#.####.#...#.....#
#.###.#.##...#.#....#.#.###.#
#.###.#.#...#.##.#.#..#.###.#
#.###.#.##.#...###.##.#.###.#
#.....#.#.###.....#...#.....#
#######.#.#.#.#.#.#.#.#######
........#..##.#.#............
#.#####.........###.#.#####..
##..........####.#.##.###...#
####..#.#.#.######..##.##....
....#..##...##.#...###.#.#.#.
##.#..##.##.#.##.#.#.....##..
.....#...#..#..##..#.####...#
..#.#.###...........#.#####..
###..#.##..##.#.#.#.##..#..#.
.####.##.#......####.....##..
#....#.#.##.####.#.######.#.#
#.#.###..#.#.####...#...#.#..
#......##.##.#.#...##......#.
#.##.####.###.##.#.######.###
........#..#...##.#.#...#####
#######....##.....###.#.###..
#.....#.##..#.#.#..##...#..##
#.###.#.#.#.#....#..#####.#.#
#.###.#.##..#.##..####.#.##..
#.###.#.#..##..####..#######.
#.....#.....#.#...#.#.####.#.
#######.#...#..#.#.#.####.#..`.trim().split('\n');

const render = (q) => q.modules.map((row) => row.map((v) => (v ? '#' : '.')).join(''));

function checkFinder(modules, cx, cy) {
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    assert.equal(modules[cy + dy][cx + dx], d !== 2, `finder at (${cx},${cy}) offset (${dx},${dy})`);
  }
}

test('structure: size = 17 + 4*version, finder patterns in three corners, timing patterns alternate', () => {
  for (const text of ['a', 'HELLO WORLD', 'https://example.com/play?t=abc', 'x'.repeat(100), 'x'.repeat(213)]) {
    const q = encodeQr(text);
    assert.equal(q.size, 17 + 4 * q.version);
    assert.equal(q.size, sizeForVersion(q.version));
    assert.equal(q.modules.length, q.size);
    for (const row of q.modules) assert.equal(row.length, q.size);
    checkFinder(q.modules, 3, 3); checkFinder(q.modules, q.size - 4, 3); checkFinder(q.modules, 3, q.size - 4);
    for (let i = 8; i < q.size - 8; i++) {
      assert.equal(q.modules[6][i], i % 2 === 0, `horizontal timing ${i}`);
      assert.equal(q.modules[i][6], i % 2 === 0, `vertical timing ${i}`);
    }
    // separators (light) around the finders
    for (let i = 0; i < 8; i++) { assert.equal(q.modules[7][i], false); assert.equal(q.modules[i][7], false); assert.equal(q.modules[7][q.size - 1 - i], false); assert.equal(q.modules[q.size - 8][i], false); }
    assert.equal(q.modules[q.size - 8][8], true, 'dark module');
  }
});

test('HELLO WORLD encodes to version 1-M and matches the independent reference matrix exactly', () => {
  const q = encodeQr('HELLO WORLD');
  assert.equal(q.version, 1); assert.equal(q.size, 21); assert.equal(q.ecl, 'M'); assert.equal(q.mask, 4);
  assert.deepEqual(render(q), REF_HELLO_WORLD_V1_M_MASK4);
  assert.deepEqual(render(encodeQr('HELLO WORLD', { mask: 4 })), REF_HELLO_WORLD_V1_M_MASK4);
});

test('join URL encodes to version 3-M and matches the independent reference matrix exactly', () => {
  const q = encodeQr('https://example.com/play?t=abc');
  assert.equal(q.version, 3); assert.equal(q.size, 29); assert.equal(q.mask, 2);
  assert.deepEqual(render(q), REF_URL_V3_M_MASK2);
});

test('byte-mode data codewords for HELLO WORLD 1-M are bit-exact (mode, count, bytes, terminator, pad)', () => {
  // 0100 | 00001011 | 'H''E''L''L''O'' ''W''O''R''L''D' | 0000 terminator | pad to 16 codewords with EC 11
  const bits = '0100' + '00001011' + Array.from('HELLO WORLD', (c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join('') + '0000';
  const expected = [];
  for (let i = 0; i < bits.length; i += 8) expected.push(parseInt(bits.slice(i, i + 8).padEnd(8, '0'), 2));
  for (let pad = 0xEC; expected.length < 16; pad ^= 0xEC ^ 0x11) expected.push(pad);
  assert.deepEqual(expected, [0x40, 0xB4, 0x84, 0x54, 0xC4, 0xC4, 0xF2, 0x05, 0x74, 0xF5, 0x24, 0xC4, 0x40, 0xEC, 0x11, 0xEC]);
  const q = encodeQr('HELLO WORLD');
  assert.deepEqual(q.dataCodewords, expected);
  assert.deepEqual(buildDataCodewords(Array.from('HELLO WORLD', (c) => c.charCodeAt(0)), 1), expected);
});

test('Reed-Solomon: generator for 10 EC codewords has the classic alpha exponents and encodes the textbook vector', () => {
  // ISO 18004 Annex A generator polynomial for 10 error-correction codewords (exponents of alpha, x^10 first)
  const exps = [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45];
  assert.deepEqual(reedSolomonGenerator(10), exps.map(gfExp));
  // Widely published worked example (1-M, "HELLO WORLD" in alphanumeric mode): 16 data codewords -> 10 EC codewords
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(reedSolomonEncode(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  // GF(256) sanity: a * a^-1 == 1, alpha^255 == 1
  assert.equal(gfExp(255), 1);
  assert.equal(gfMultiply(gfExp(7), gfExp(248)), 1);
});

test('Reed-Solomon: full codeword polynomial (data + EC) is divisible by the generator for every block, all versions', () => {
  for (let v = 1; v <= 10; v++) {
    const text = 'v'.repeat(Math.max(1, byteCapacity(v) - 2));
    const q = encodeQr(text);
    assert.equal(q.version, v);
    const gen = reedSolomonGenerator(VERSION_TABLE[v].ecPerBlock);
    let blocksSeen = 0;
    for (const block of q.blocks) {
      blocksSeen++;
      assert.equal(block.ec.length, VERSION_TABLE[v].ecPerBlock);
      const remainder = polyRemainder([...block.data, ...block.ec], gen);
      assert.ok(remainder.every((c) => c === 0), `version ${v} block ${blocksSeen} not divisible by generator`);
      // corrupt one byte -> remainder must be non-zero
      const bad = [...block.data, ...block.ec]; bad[3] ^= 0x5a;
      assert.ok(polyRemainder(bad, gen).some((c) => c !== 0));
    }
    assert.equal(blocksSeen, VERSION_TABLE[v].blocks.reduce((n, [c]) => n + c, 0));
    assert.equal(q.codewords.length, VERSION_TABLE[v].total);
  }
});

test('interleaving matches the spec for a two-group version (8-M: 2x38 + 2x39 data, 22 EC each)', () => {
  const data = Array.from({ length: 154 }, (_, i) => i & 0xff);
  const { codewords, blocks } = addErrorCorrection(data, 8);
  assert.deepEqual(blocks.map((b) => b.data.length), [38, 38, 39, 39]);
  // first four interleaved codewords are the first byte of each block
  assert.deepEqual(codewords.slice(0, 4), [blocks[0].data[0], blocks[1].data[0], blocks[2].data[0], blocks[3].data[0]]);
  // codeword 152 and 153 are the 39th byte of the two long blocks only
  assert.deepEqual(codewords.slice(152, 154), [blocks[2].data[38], blocks[3].data[38]]);
  assert.deepEqual(codewords.slice(154, 158), blocks.map((b) => b.ec[0]));
  assert.equal(codewords.length, 242);
});

function readFormatBits(modules) {
  const size = modules.length; let bits = 0;
  // copy 1 (around the top-left finder), same order the encoder writes: bits 0..14
  const at = (x, y) => (modules[y][x] ? 1 : 0);
  for (let i = 0; i <= 5; i++) bits |= at(8, i) << i;
  bits |= at(8, 7) << 6; bits |= at(8, 8) << 7; bits |= at(7, 8) << 8;
  for (let i = 9; i < 15; i++) bits |= at(14 - i, 8) << i;
  let copy2 = 0;
  for (let i = 0; i < 8; i++) copy2 |= at(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) copy2 |= at(8, size - 15 + i) << i;
  assert.equal(copy2, bits, 'both format-information copies agree');
  return bits;
}

test('format information decodes (BCH 15,5) to ECL M and the chosen mask for every mask, and corrects up to 3 bit errors', () => {
  for (let m = 0; m < 8; m++) {
    const q = encodeQr('HELLO WORLD', { mask: m });
    assert.equal(q.mask, m);
    const bits = readFormatBits(q.modules);
    const decoded = decodeFormatInfo(bits);
    assert.deepEqual(decoded, { ecl: 'M', mask: m, distance: 0 });
    assert.equal(bits, formatInfoBits(m));
    // BCH property: after removing the XOR mask the 15-bit word is divisible by the generator 0x537
    const unmasked = bits ^ 0x5412;
    let rem = unmasked;
    for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    assert.equal(rem, 0, 'BCH remainder');
    assert.deepEqual(decodeFormatInfo(bits ^ 0b101000000000010), { ecl: 'M', mask: m, distance: 3 });
  }
  // known constant from the specification: level M, mask 0 -> 101010000010010
  assert.equal(formatInfoBits(0), 0b101010000010010);
  assert.equal(decodeFormatInfo(0b111011111000100).ecl, 'L'); // L, mask 0 from the spec table
  assert.equal(decodeFormatInfo(0), null);
});

test('version information (versions 7-10) uses BCH(18,6) and both copies are placed', () => {
  assert.equal(versionInfoBits(7), 0b000111110010010100);   // spec table D.1
  assert.equal(versionInfoBits(10), 0b001010010011010011);
  for (let v = 7; v <= 10; v++) {
    const q = encodeQr('v'.repeat(byteCapacity(v - 1) + 1));
    assert.equal(q.version, v);
    const bits = versionInfoBits(v); const size = q.size;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      assert.equal(q.modules[Math.floor(i / 3)][size - 11 + (i % 3)], dark);
      assert.equal(q.modules[size - 11 + (i % 3)][Math.floor(i / 3)], dark);
    }
  }
});

test('unmasking with the chosen mask and reading the zigzag back yields the interleaved codewords', () => {
  for (const text of ['HELLO WORLD', 'https://example.com/play?t=abc', 'z'.repeat(200)]) {
    const q = encodeQr(text);
    const { modules, isFunction } = buildFunctionPatterns(q.version);
    // independent read-out: undo the mask on a copy, then walk the placement order per ISO 18004 7.7.3
    const copy = q.modules.map((r) => r.slice());
    const fn = MASK_FUNCTIONS[q.mask];
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (!isFunction[y][x] && fn(y, x)) copy[y][x] = !copy[y][x];
    const bits = [];
    let right = q.size - 1; let upward = true;
    while (right >= 1) {
      if (right === 6) right = 5;
      for (let k = 0; k < q.size; k++) {
        const y = upward ? q.size - 1 - k : k;
        for (const x of [right, right - 1]) if (!isFunction[y][x]) bits.push(copy[y][x] ? 1 : 0);
      }
      right -= 2; upward = !upward;
    }
    const bytes = [];
    for (let i = 0; i + 8 <= q.codewords.length * 8; i += 8) bytes.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    assert.deepEqual(bytes, q.codewords, `read-back for ${text.slice(0, 20)}`);
    assert.ok(bits.slice(q.codewords.length * 8).every((b) => b === 0), 'remainder bits are light');
    // placing again into a fresh layout reproduces the pre-mask matrix
    placeCodewords(modules, isFunction, q.codewords, q.version);
    applyMask(modules, isFunction, q.mask);
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (!isFunction[y][x]) assert.equal(modules[y][x], q.modules[y][x]);
  }
});

// Independent, literal implementation of ISO 18004 8.8.2 penalty rules for cross-checking penaltyScore.
function referencePenalty(modules) {
  const size = modules.length; let score = 0;
  const lines = [];
  for (let y = 0; y < size; y++) lines.push(modules[y].map((v) => (v ? '1' : '0')).join(''));
  for (let x = 0; x < size; x++) lines.push(modules.map((r) => (r[x] ? '1' : '0')).join(''));
  for (const line of lines) {
    for (const run of line.match(/1+|0+/g)) if (run.length >= 5) score += 3 + (run.length - 5);
    // the quiet zone around the symbol is light (ISO 18004:2015 note on rule N3)
    const padded = `0000${line}0000`;
    for (const pat of ['10111010000', '00001011101']) { let idx = -1; while ((idx = padded.indexOf(pat, idx + 1)) !== -1) score += 40; }
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = modules[y][x]; if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
  }
  let dark = 0; for (const r of modules) for (const v of r) if (v) dark++;
  const pct = (dark * 100) / (size * size);
  const prev = Math.floor(pct / 5) * 5, next = prev + 5;
  score += Math.min(Math.abs(prev - 50) / 5, Math.abs(next - 50) / 5) * 10;
  return score;
}

test('mask selection: every mask evaluated, lowest penalty wins, penalty matches an independent implementation', () => {
  for (const text of ['HELLO WORLD', 'https://example.com/play?t=abc', 'Skill Bingo', 'q'.repeat(60)]) {
    const auto = encodeQr(text);
    const scores = [];
    for (let m = 0; m < 8; m++) {
      const q = encodeQr(text, { mask: m });
      const ours = penaltyScore(q.modules), ref = referencePenalty(q.modules);
      assert.equal(ours, ref, `penalty parity for mask ${m} of ${text.slice(0, 12)}`);
      scores.push(ours);
    }
    assert.equal(scores[auto.mask], Math.min(...scores));
    assert.equal(auto.mask, scores.indexOf(Math.min(...scores)), 'first lowest-penalty mask wins ties');
  }
});

test('version selection: capacity boundaries for byte mode at level M, and UTF-8 input', () => {
  assert.equal(byteCapacity(1), 14); assert.equal(byteCapacity(2), 26); assert.equal(byteCapacity(9), 180); assert.equal(byteCapacity(10), 213);
  assert.equal(chooseVersion(14), 1); assert.equal(chooseVersion(15), 2); assert.equal(chooseVersion(213), 10); assert.equal(chooseVersion(214), -1);
  assert.equal(encodeQr('x'.repeat(14)).version, 1);
  assert.equal(encodeQr('x'.repeat(15)).version, 2);
  assert.equal(encodeQr('x'.repeat(213)).version, 10);
  assert.throws(() => encodeQr('x'.repeat(214)), RangeError);
  assert.throws(() => encodeQr('hello', { mask: 9 }), RangeError);
  const u = encodeQr('Skill Bingo ÄÖÜ ✓ 日本'); // 27 UTF-8 bytes -> version 3
  assert.equal(u.version, 3);
  assert.equal(encodeQr('a', { minVersion: 4 }).version, 4);
  assert.equal(encodeQr('a').dataCodewords[1], 0b0001_0110, 'count 1 then first nibble of 0x61');
});

test('qrToSvg produces an accessible, escaped SVG with one path for dark modules', () => {
  const svg = qrToSvg('https://example.com/play?t=abc', { size: 320, margin: 4, dark: '#111', light: '#fff', ariaLabel: 'Join <QR> "link"', title: 'Scan & join' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 37 37" width="320" height="320" role="img" aria-label="Join &lt;QR&gt; &quot;link&quot;"/);
  assert.match(svg, /<title>Scan &amp; join<\/title>/);
  assert.match(svg, /<rect width="37" height="37" fill="#fff"\/>/);
  assert.match(svg, /<path d="M4 4h7v1h-7z/); // first row: finder top edge (7 dark) offset by the margin
  assert.match(svg, /fill="#111"\/><\/svg>$/);
  assert.equal((svg.match(/<path/g) || []).length, 1);
  const pre = encodeQr('abc');
  assert.equal(qrToSvg(pre, { margin: 0 }).includes('viewBox="0 0 21 21"'), true);
});
