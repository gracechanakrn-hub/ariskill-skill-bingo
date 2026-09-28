// Accessibility of the decorated Soul (D-29, requirement 12.2, AC 13): the Soul image's text alternative names what is
// drawn - colour, face kit, charm count per kind - with no rank words and no skill data (BR-17, privacy); the SVG's
// accessible name is that text and its sprite layers add nothing a screen reader would read; the 3D stages stay
// decorative (aria-hidden, the impostor canvas never enters the DOM). Source-level + renderer output, no browser.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSoulSvg, soulAltText, BADGE_LABEL, FACE_ALT } from '../../packages/ui/soul-renderer.js';
import { GRADIENTS, FACES, CHARMS, CHARMS_BY_KIND } from '../../packages/game-rules/src/soul-catalog.js';
import { decorFixture, v2Config, neutralV2 } from '../../packages/ui/test/decor-fixture.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const RANK = /platform|role|rank|level|score|senior|junior|strong|weak|best|top|expert|master|winner|most|least|more than|matched|skill/i;

describe('decorated Soul (D-29) text alternative', () => {
  test('names the colour, the face kit and the charms per kind, e.g. "with round glasses. 10 charms: 4 technical, 4 core, 2 soft"', () => {
    assert.equal(soulAltText(v2Config()), 'Arise Soul, Aurora colour, with round glasses. 10 charms: 4 technical, 4 core, 2 soft');
    for (const face of FACES) assert.ok(soulAltText(v2Config({ face })).includes(FACE_ALT[face]), face);
    assert.equal(soulAltText(neutralV2()), 'Arise Soul, Aurora colour, with round button eyes and a glowing antenna orb');
    assert.equal(soulAltText(v2Config(), 'bingo-star'), `Arise Soul, Aurora colour, with round glasses. 10 charms: 4 technical, 4 core, 2 soft. ${BADGE_LABEL}`);
  });

  test('no rank words, no skill names or charm names, and the kinds in one fixed order (never sorted by count)', () => {
    const splits = [[4, 4, 2], [8, 1, 1], [10, 0, 0], [0, 10, 0], [0, 0, 10], [1, 2, 7]];
    for (let gi = 0; gi < GRADIENTS.length; gi++) for (const face of [...FACES, null]) for (const [t, c, s] of splits) {
      const charms = [...CHARMS_BY_KIND.technical.slice(0, t), ...CHARMS_BY_KIND.core.slice(0, c), ...CHARMS_BY_KIND.soft.slice(0, s)];
      const text = soulAltText(v2Config({ gradient: gi, face, charms }), 'bingo-star');
      assert.ok(!RANK.test(text.replace(BADGE_LABEL, '')), text);
      for (const ch of CHARMS) assert.ok(!text.includes(ch.name) || ['core', 'soft'].includes(ch.name), `${ch.id} named in "${text}"`);
      const counts = [...text.matchAll(/(\d+) (technical|core|soft)/g)].map((m) => m[2]);
      assert.deepEqual(counts, ['technical', 'core', 'soft'].filter((k) => counts.includes(k)), 'fixed order technical, core, soft');
    }
  });

  test('the SVG\'s accessible name is the text alternative; the face and charm sprites carry no text of their own', () => {
    const svg = renderSoulSvg(v2Config({ face: 'angel' }), { badge: 'bingo-star', decor: decorFixture() });
    assert.ok(svg.includes(`role="img" aria-label="${soulAltText(v2Config({ face: 'angel' }), 'bingo-star')}"`));
    const images = [...svg.matchAll(/<image [^>]*\/>/g)].map((m) => m[0]);
    assert.equal(images.length, 11);
    for (const img of images) assert.ok(!/\b(alt|aria-label|title)=/.test(img), 'decorative layers inside a labelled role=img');
    assert.equal((svg.match(/<title>/g) || []).length, 1, 'only the badge keeps its own title');
  });

  test('the phone labels its Soul with the alt text; the 3D stage is decorative; the Galaxy impostor canvas never enters the DOM', () => {
    const view = read('apps/employee-mobile/src/views/soul.js');
    assert.match(view, /soulAltText\(soul\.config, soul\.badge, \{ crown: true \}\)/);
    assert.match(view, /label: alt/);
    assert.match(view, /stage3d = h\('div', \{ className: 'soul-3d', 'aria-hidden': 'true' \}\)/);
    const impostor = read('apps/public-galaxy/src/renderer/impostor.js');
    assert.doesNotMatch(impostor, /appendChild|insertBefore|\.append\(/, 'offscreen: nothing for assistive technology to find');
    assert.doesNotMatch(read('apps/public-galaxy/src/renderer/three.js'), /soulAltText|aria-label="[^"]*charm/i, 'the public canvas names no Soul (privacy)');
  });
});
