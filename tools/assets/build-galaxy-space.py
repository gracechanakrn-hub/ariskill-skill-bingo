#!/usr/bin/env python3
"""Packs the big screen's space backdrop (stage 15, D-36) into assets/space/.

Inputs: the Blender renders in assets-src/generated/galaxy-space/ (tools/ai/blender/galaxy_space.py: backdrop.png and
meteor-1..5.png; git-ignored). Adds the constellation lines (four real constellations, drawn here so the lines stay
crisp; the runtime draws their stars so each can twinkle), the falling-star streak, and space.json (layout and micro
movement), then records each packed file (bytes, sha256, pixel size) in assets-src/generated/galaxy-space/provenance.json.
Needs Pillow, so build-all does not run it: tools/assets/build-galaxy-space.js checks the committed pack against the
provenance and lists it in the asset manifest. Deterministic: the same inputs give byte-identical outputs.

    python3 tools/assets/build-galaxy-space.py [--preview out.png]
"""
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets-src', 'generated', 'galaxy-space')
OUT = os.path.join(ROOT, 'assets', 'space')
REGION = (1248, 1080)
OVERSCAN = 1.1
PW, PH = round(REGION[0] * OVERSCAN), round(REGION[1] * OVERSCAN)          # the plate: 1373 x 1188 layout units
SCALE = 2   # the Blender renders are SCALE x the plate (galaxy_space.py --scale); the lines are drawn to match

# Four real constellations, shapes normalised to their own box (x right, y down), placed in region fractions where the
# sky is free: under the title (Big Dipper), top middle (Cassiopeia), left (Orion), right (Cygnus).
CONSTELLATIONS = [
    {'name': 'Big Dipper', 'at': (0.07, 0.13), 'size': (0.24, 0.1),
     'stars': [(0.0, 0.0, 2.6), (0.03, 0.62, 2.4), (0.3, 0.8, 2.2), (0.36, 0.3, 1.8), (0.56, 0.22, 2.4), (0.76, 0.08, 2.5), (1.0, 0.36, 2.4)],
     'lines': [(0, 1), (1, 2), (2, 3), (3, 0), (3, 4), (4, 5), (5, 6)]},
    {'name': 'Cassiopeia', 'at': (0.44, 0.05), 'size': (0.16, 0.07),
     'stars': [(0.0, 0.85, 2.3), (0.24, 0.0, 2.5), (0.5, 0.62, 2.1), (0.74, 0.05, 2.4), (1.0, 0.9, 2.0)],
     'lines': [(0, 1), (1, 2), (2, 3), (3, 4)]},
    {'name': 'Orion', 'at': (0.05, 0.38), 'size': (0.13, 0.22),
     'stars': [(0.05, 0.0, 3.0), (0.92, 0.07, 2.4), (0.34, 0.52, 2.0), (0.47, 0.49, 2.1), (0.6, 0.46, 2.0), (0.12, 1.0, 2.3), (0.96, 0.95, 2.9)],
     'lines': [(0, 1), (0, 2), (1, 4), (2, 3), (3, 4), (2, 5), (4, 6)]},
    {'name': 'Cygnus', 'at': (0.84, 0.32), 'size': (0.12, 0.24),
     'stars': [(0.5, 0.0, 2.7), (0.5, 0.36, 2.2), (0.5, 1.0, 2.1), (0.0, 0.42, 2.0), (1.0, 0.26, 2.0)],
     'lines': [(0, 1), (1, 2), (3, 1), (1, 4)]},
]

METEORS = [   # file, region x / y (centre), size (fraction of the region height), rotation, spin (deg/s), drift, front
    ('meteor-1', 0.035, 0.93, 0.34, -12, 1.1, (0.004, 0.006, 31), True, 1.4),
    ('meteor-2', 0.965, 0.09, 0.2, 28, -1.8, (0.004, 0.004, 23), True, 1.3),
    ('meteor-3', 0.4, 0.06, 0.055, 0, 3.2, (0.006, 0.004, 19), False, 0.8),
    ('meteor-4', 0.6, 0.93, 0.07, 40, -2.6, (0.005, 0.006, 27), False, 0.9),
    ('meteor-5', 0.19, 0.66, 0.05, 10, 4.0, (0.006, 0.005, 17), False, 0.7),
]


def plate_xy(fx, fy):
    """Region fraction -> plate pixel (the plate is the region grown by the overscan, centred)."""
    return ((fx - 0.5) * REGION[0] + PW / 2, (fy - 0.5) * REGION[1] + PH / 2)


def constellation_stars():
    out = []
    for c in CONSTELLATIONS:
        for k, (sx, sy, r) in enumerate(c['stars']):
            fx, fy = c['at'][0] + sx * c['size'][0], c['at'][1] + sy * c['size'][1]
            b = round(0.72 + 0.28 * min(1.0, (r - 1.8) / 1.2), 3)
            out.append({'x': round(fx, 4), 'y': round(fy, 4), 'r': r, 'b': b, 't': round(((len(out) * 0.618) % 1), 3), 'c': c['name']})
    return out


def draw_lines(size, scale=1.0):
    """Constellation lines on a transparent plate: a soft glow under a thin, pale-periwinkle line."""
    lines = Image.new('RGBA', size, (0, 0, 0, 0)); glow = Image.new('RGBA', size, (0, 0, 0, 0))
    dl, dg = ImageDraw.Draw(lines), ImageDraw.Draw(glow)
    for c in CONSTELLATIONS:
        pts = [plate_xy(c['at'][0] + sx * c['size'][0], c['at'][1] + sy * c['size'][1]) for sx, sy, _ in c['stars']]
        pts = [(x * scale, y * scale) for x, y in pts]
        for a, b in c['lines']:
            (x0, y0), (x1, y1) = pts[a], pts[b]
            # stop short of each star, so the line meets a halo rather than the dot
            d = math.hypot(x1 - x0, y1 - y0) or 1; ux, uy = (x1 - x0) / d, (y1 - y0) / d; gap = 7 * scale
            seg = [(x0 + ux * gap, y0 + uy * gap), (x1 - ux * gap, y1 - uy * gap)]
            dg.line(seg, fill=(150, 170, 255, 70), width=max(1, round(6 * scale)))
            dl.line(seg, fill=(205, 216, 255, 120), width=max(1, round(1.6 * scale)))
    glow = glow.filter(ImageFilter.GaussianBlur(4 * scale))
    return Image.alpha_composite(glow, lines)


def falling_star():
    """A horizontal streak, head on the right: a warm-white head, a tail fading to transparent over its length."""
    W, H = 512, 48
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); px = img.load()
    cy = H / 2
    for x in range(W):
        t = x / (W - 1)                                   # 0 tail end .. 1 head
        half = 0.8 + 5.2 * t ** 1.5                       # tapers toward the tail
        a_len = t ** 2.2
        for y in range(H):
            dy = abs(y + 0.5 - cy)
            a = max(0.0, 1 - dy / half) ** 1.5 * a_len
            if a > 0:
                warm = (255, round(236 - 40 * (1 - t)), round(210 - 90 * (1 - t)))
                px[x, y] = (*warm, round(255 * min(1, a)))
    glow = img.filter(ImageFilter.GaussianBlur(4))
    head = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dh = ImageDraw.Draw(head)
    dh.ellipse((W - 30, cy - 13, W - 4, cy + 13), fill=(255, 250, 235, 255))
    head = head.filter(ImageFilter.GaussianBlur(4.5))
    return Image.alpha_composite(Image.alpha_composite(glow, img), head)


def main():
    os.makedirs(OUT, exist_ok=True)
    back = Image.open(os.path.join(SRC, 'backdrop.png')).convert('RGB')
    assert back.size == (round(PW * SCALE), round(PH * SCALE)), back.size
    back.save(os.path.join(OUT, 'backdrop.jpg'), quality=86, optimize=True, progressive=True)
    draw_lines((round(PW * SCALE), round(PH * SCALE)), SCALE).save(os.path.join(OUT, 'constellations.webp'), quality=90, method=6)
    for name, *_ in METEORS:
        m = Image.open(os.path.join(SRC, f'{name}.png')).convert('RGBA')
        bbox = m.getbbox(); m = m.crop(bbox)                                      # tight: the size is the rock's height
        # D-57: meteors are small on screen, so they ship at 1x (texture memory); only the plates stay at SCALE
        if SCALE != 1: m = m.resize((round(m.width / SCALE), round(m.height / SCALE)), Image.LANCZOS)
        m.save(os.path.join(OUT, f'{name}.webp'), quality=88, method=6)
    falling_star().save(os.path.join(OUT, 'falling-star.webp'), quality=90, method=6)
    data = {
        'version': 1, 'generator': 'tools/ai/blender/galaxy_space.py + tools/assets/build-galaxy-space.py',
        'region': {'width': REGION[0], 'height': REGION[1]}, 'overscan': OVERSCAN, 'scale': SCALE,
        'backdrop': {'file': 'backdrop.jpg', 'drift': {'px': 12, 'periodS': 80}, 'breathe': {'amount': 0.012, 'periodS': 50}, 'parallax': 0.35},
        'constellations': {'file': 'constellations.webp', 'lineShimmer': {'amount': 0.25, 'periodS': 9},
                           'stars': [{k: v for k, v in s.items() if k != 'c'} for s in constellation_stars()],
                           'names': [c['name'] for c in CONSTELLATIONS],
                           'twinkle': {'amount': 0.35, 'periodS': 5.5}, 'parallax': 0.5},
        'meteors': [{'file': f'{n}.webp', 'x': x, 'y': y, 'size': s, 'rotDeg': rot, 'spinDegPerS': spin,
                     'drift': {'x': d[0], 'y': d[1], 'periodS': d[2]}, 'front': front, 'parallax': par}
                    for n, x, y, s, rot, spin, d, front, par in METEORS],
        'fallingStars': {'file': 'falling-star.webp', 'everyS': [6, 12], 'durationS': [0.9, 1.5], 'angleDeg': [15, 32],
                         'lengthFrac': [0.18, 0.32], 'area': [0.05, 0.03, 0.95, 0.5], 'maxAlpha': 0.9},
    }
    with open(os.path.join(OUT, 'space.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2); f.write('\n')
    write_provenance()
    sizes = {n: os.path.getsize(os.path.join(OUT, n)) for n in sorted(os.listdir(OUT))}
    print('build-galaxy-space:', ', '.join(f'{n} {s // 1024} KB' for n, s in sizes.items()), f'= {sum(sizes.values()) // 1024} KB')
    if '--preview' in sys.argv:
        preview(sys.argv[sys.argv.index('--preview') + 1], data)


def write_provenance():
    """provenance.json: every packed file's bytes, sha256 and (images) pixel size, for build-galaxy-space.js to check."""
    import hashlib
    files = {}
    for n in sorted(os.listdir(OUT)):
        if n.startswith('.'):
            continue
        buf = open(os.path.join(OUT, n), 'rb').read()
        rec = {'bytes': len(buf), 'sha256': hashlib.sha256(buf).hexdigest()}
        if not n.endswith('.json'):
            with Image.open(os.path.join(OUT, n)) as im:
                rec['px'] = list(im.size)
        files[n] = rec
    prov = {'generator': 'tools/assets/build-galaxy-space.py', 'renders': 'tools/ai/blender/galaxy_space.py', 'files': files}
    with open(os.path.join(SRC, 'provenance.json'), 'w', encoding='utf-8') as f:
        json.dump(prov, f, indent=2); f.write('\n')


def preview(path, data):
    """A still of the whole composition (the region, no overscan), with one falling star mid-flight."""
    back = Image.open(os.path.join(OUT, 'backdrop.jpg')).convert('RGBA')
    ox, oy = (PW - REGION[0]) // 2, (PH - REGION[1]) // 2
    img = back.crop((ox, oy, ox + REGION[0], oy + REGION[1]))
    lines = Image.open(os.path.join(OUT, 'constellations.webp')).convert('RGBA').crop((ox, oy, ox + REGION[0], oy + REGION[1]))
    img = Image.alpha_composite(img, lines)
    d = ImageDraw.Draw(img)
    for s in data['constellations']['stars']:
        x, y, r = s['x'] * REGION[0], s['y'] * REGION[1], s['r']
        glow = Image.new('RGBA', img.size, (0, 0, 0, 0)); ImageDraw.Draw(glow).ellipse((x - r * 3, y - r * 3, x + r * 3, y + r * 3), fill=(190, 205, 255, 60))
        img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(r * 1.5)))
        d = ImageDraw.Draw(img); d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, round(255 * s['b'])))
    fs = Image.open(os.path.join(OUT, 'falling-star.webp')).convert('RGBA')
    L = round(0.26 * REGION[0]); fs = fs.resize((L, round(fs.height * L / fs.width)), Image.LANCZOS).rotate(-24, expand=True, resample=Image.BICUBIC)
    img.alpha_composite(fs, (round(0.55 * REGION[0]), round(0.16 * REGION[1])))
    for m in data['meteors']:
        sp = Image.open(os.path.join(OUT, m['file'])).convert('RGBA')
        h = round(m['size'] * REGION[1]); sp = sp.resize((round(sp.width * h / sp.height), h), Image.LANCZOS).rotate(-m['rotDeg'], expand=True, resample=Image.BICUBIC)
        img.alpha_composite(sp, (round(m['x'] * REGION[0] - sp.width / 2), round(m['y'] * REGION[1] - sp.height / 2)))
    img.convert('RGB').save(path)
    print('preview', path)


if __name__ == '__main__':
    main()
