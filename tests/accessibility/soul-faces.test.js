// Accessibility of the v3 Soul (D-31, docs/art/soul-faces.md "Alt text v3", requirement 12.2, AC 13): the Soul image's
// text alternative names what is drawn - colour, face plate, eyes, face kit, charm count per kind and the antenna charm -
// with no rank words and no skill data (BR-17, privacy); the look list stays three items a listener can tell apart (a
// serial comma when an item already reads "x and y"); the SVG's accessible name is that text and its sprite layers add
// nothing a screen reader would read. Renderer output, no browser.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSoulSvg, soulAltText, charmAltName, BADGE_LABEL, FACE_ALT_V3 } from '../../packages/ui/soul-renderer.js';
import { GRADIENTS, FACES, CHARMS, CHARM_BY_ID, CHARMS_BY_KIND, PLATES, EYES, PLATE_IDS, EYE_IDS } from '../../packages/game-rules/src/soul-catalog.js';
import { decorFixture } from '../../packages/ui/test/decor-fixture.js';
import { faceFixture, stubFace, v3Config } from '../../packages/ui/test/face-fixture.js';

const RANK = /platform|role|rank|level|score|senior|junior|strong|weak|best|top|expert|master|winner|most|least|more than|matched|skill/i;
const OPTS = { decor: decorFixture(), face: faceFixture() };
const EYES_NAME = Object.fromEntries(EYES.map((e) => [e.id, e.name]));
/** True when `words` appears in `text` as whole words ("pen" is not named by "pencil"). */
const named = (text, words) => new RegExp(`(^|[^\\w-])${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`).test(text);

describe('v3 Soul (D-31) text alternative', () => {
  test('names the colour, the face plate, eyes and kit, the charms per kind and the antenna charm', () => {
    assert.equal(soulAltText(v3Config()), 'Arise Soul, Aurora colour, with a bean face, heart eyes and round glasses. 10 charms: 4 technical, 4 core, 2 soft. A lemon classic star charm on its antenna');
    assert.equal(soulAltText(v3Config(), 'bingo-star'), `Arise Soul, Aurora colour, with a bean face, heart eyes and round glasses. 10 charms: 4 technical, 4 core, 2 soft. A lemon classic star charm on its antenna. ${BADGE_LABEL}`);
    for (const p of PLATES) assert.ok(soulAltText(v3Config({ plate: p.id })).includes(`, with a ${p.name} face, `), p.id);
    for (const e of EYES) assert.ok(soulAltText(v3Config({ eyes: e.id })).includes(` face, ${e.name}`), e.id);
    for (const face of FACES) assert.ok(soulAltText(v3Config({ face })).includes(` ${FACE_ALT_V3[face]}. 10 charms`), face);
    assert.doesNotMatch(soulAltText(v3Config({ face: 'angel' })), /blush|orb/, 'v3 has no blush and no antenna orb');
  });

  test('the look list stays three items: a serial comma before the kit when the eyes or the kit already read "x and y"', () => {
    for (const plate of PLATE_IDS) for (const eyes of EYE_IDS) for (const face of FACES) {
      const text = soulAltText(v3Config({ plate, eyes, face }));
      const e = EYES_NAME[eyes], kit = FACE_ALT_V3[face];
      const joint = e.includes(' and ') || kit.includes(' and ') ? `${e}, and ${kit}.` : `${e} and ${kit}.`;
      assert.ok(text.includes(joint), `"${joint}" in "${text}"`);
    }
    assert.match(soulAltText(v3Config({ eyes: 'wink', face: 'pirate' })), /, a blue eye and a cross eye, and an eye patch and a bandana\. /);
  });

  test('no rank words, no skill data, only the antenna charm is named (never the ten body charms), kinds in one fixed order', () => {
    const splits = [[4, 4, 2], [8, 1, 1], [10, 0, 0], [0, 10, 0], [0, 0, 10], [1, 2, 7]];
    for (let gi = 0; gi < GRADIENTS.length; gi++) for (const [t, c, s] of splits) {
      const charms = [...CHARMS_BY_KIND.technical.slice(0, t), ...CHARMS_BY_KIND.core.slice(0, c), ...CHARMS_BY_KIND.soft.slice(0, s)];
      const free = CHARMS.filter((ch) => !charms.includes(ch.id));
      const topper = free[(gi * 41 + t) % free.length].id;
      const text = soulAltText(v3Config({ gradient: gi, face: FACES[gi % 3], plate: PLATE_IDS[gi % 10], eyes: EYE_IDS[(gi + t) % 10], charms, topper }), 'bingo-star');
      assert.ok(!RANK.test(text.replace(BADGE_LABEL, '').replace(`${charmAltName(topper)} charm`, 'charm')), text);
      assert.ok(text.includes(` ${charmAltName(topper)} charm on its antenna`), text);
      for (const id of charms) assert.ok(![CHARM_BY_ID.get(id).name, charmAltName(id), id].some((w) => named(text, w)), `${id} named in "${text}"`);
      const kinds = [...text.matchAll(/(\d+) (technical|core|soft)/g)].map((m) => m[2]);
      assert.deepEqual(kinds, ['technical', 'core', 'soft'].filter((k) => kinds.includes(k)), 'fixed order technical, core, soft');
    }
  });

  test('the SVG\'s accessible name is the text alternative, whatever state the face data is in; the sprite layers carry no text of their own', () => {
    const cfg = v3Config({ face: 'angel' });
    const alt = soulAltText(cfg, 'bingo-star');
    const svg = renderSoulSvg(cfg, { ...OPTS, badge: 'bingo-star' });
    assert.ok(svg.includes(`role="img" aria-label="${alt}"`));
    const images = [...svg.matchAll(/<image [^>]*\/>/g)].map((m) => m[0]);
    assert.equal(images.length, 14, 'plate, eyes, kit, 10 charms, antenna charm');
    for (const img of images) assert.ok(!/\b(alt|aria-label|title)=/.test(img), 'decorative layers inside a labelled role=img');
    assert.equal((svg.match(/<title>/g) || []).length, 1, 'only the badge keeps its own title');
    for (const face of [stubFace(), undefined]) assert.ok(renderSoulSvg(cfg, { decor: OPTS.decor, face, badge: 'bingo-star' }).includes(`role="img" aria-label="${alt}"`), 'the stub fallback and the checked-in data');
  });
});
