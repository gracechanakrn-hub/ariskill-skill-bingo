#!/usr/bin/env python3
"""tools/ai/blender/soul_face.py - Soul faces v3: face plates, eyes and the antenna charm (stage 13).

The partner supplied two design sheets: docs/art/reference/soul-faces-reference.png (10 white face plates) and
docs/art/reference/soul-eyes-reference.png (10 pairs of eyes). Every Soul gets one plate and one pair of eyes at random
(from its seed), and one random charm replaces the glowing orb on its antenna. This tool turns the sheets into 3D parts
on the approved baseline body (D-27, soul_baseline.py; soul_decor.py for the shared helpers):

  trace    (python3 + PIL) the plate sheet -> clean plate designs assets-src/soul-face/plates/<id>.png + plates.json
  body     the v3 body: the baseline without its button eyes and without the orb; the antenna ends in a short stalk
           that holds the topper charm
  plates   plate-<id>.glb: the traced outline as a thin shell on the face with rounded edges; ink (crack, scar) as a
           flush inlay
  eyes     eyes-<id>.glb: both eyes as raised glossy pieces on the plate (flat colours or vertex gradients); insets
           (hearts, sparkles) sit on top
  renders  review sheets in reports/qa/screens/

Frames as soul_decor.py: Blender Z up, the character faces -Y, its left is +X; model space = (x, z, -y). "Front
projection" = Blender (x, z). The eye designs are authored for the character's left eye (+X, the viewer's right, the
near eye of the sheet's 3/4 view) in eye units (radius 1, +u outward toward the ear, +v up); the other eye mirrors u.

  python3 tools/ai/blender/soul_face.py --mode trace          (needs PIL)
  python3 tools/ai/blender/soul_face.py --mode preview        2D check of every plate with every eye
  Blender --background --factory-startup --python tools/ai/blender/soul_face.py -- --mode renders
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

try:
    import bpy  # type: ignore
except ImportError:
    bpy = None

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import soul_baseline as sb  # noqa: E402
import soul_decor as sd  # noqa: E402

ROOT = sd.ROOT
REF_FACES = os.path.join(ROOT, 'docs', 'art', 'reference', 'soul-faces-reference.png')
REF_EYES = os.path.join(ROOT, 'docs', 'art', 'reference', 'soul-eyes-reference.png')
PLATE_DIR = os.path.join(ROOT, 'assets-src', 'soul-face', 'plates')
PLATES_JSON = os.path.join(ROOT, 'assets-src', 'soul-face', 'plates.json')
GEN = os.path.join(ROOT, 'assets-src', 'generated', 'soul-face', 'v1')
QA_DIR = sd.QA_DIR
LUMA = np.array([0.2126, 0.7152, 0.0722])

_CAT = sd.read_catalog()                                  # catalog 2 (packages/game-rules/src/soul-catalog.js)
PLATES = [p['id'] for p in _CAT['plates']]                 # catalog order = the sheet's tile order
EYES = [e['id'] for e in _CAT['eyes']]
FACES = [_CAT['faces'][k] for k in _CAT['kinds']]          # nerdy, pirate, angel
# The plate sheet: 5 x 2 tiles of 258 px; the left half of every plate but the bean is mirrored (the sheet's plates
# are slightly turned, so their halves differ by a few px).
SHEET = {'x': [36, 327, 618, 910, 1201], 'y': [28, 319], 'tile': 258, 'inset': 8, 'up': 4}
SYMMETRIC = set(PLATES) - {'bean'}
PLATE_PNG, PLATE_FRAME = 512, 0.8   # design image size; the plate's width spans PLATE_FRAME of it
PLATE_WHITE = '#F7F8FF'             # the old eye-disc white (D-27)
PLATE_WALL = '#C9CEE2'             # the sides of a plate whose sheet tile shows no coloured rim
PLATE_RIM = {'crack': '#3A3FC3', 'bean': '#3136C1', 'notch': '#71D8D9', 'skull-x': '#69DABC', 'bat': '#7E94F3',
             'dome': '#66D3C1'}   # the rim colour each tile shows on the plate's side (median of its saturated px)
INK = {'crack': '#3F37D6', 'skull-x': '#26232E', 'cracked-bow': '#26232E'}

# Layout (Blender units). The eyes sit at fixed places for every plate; each plate is scaled and raised (fit_plates)
# so both eyes of every design sit inside it, and it stays between the top charm row and the bandana brim.
FACE = {'eye_x': 0.145, 'eye_z': 1.175, 'eye_r': 0.085,
        'plate_t': 0.014, 'plate_in': 0.004, 'plate_round': 0.005,
        'eye_t': 0.013, 'eye_in': 0.004, 'eye_round': 0.0035,
        'inset_t': 0.0035, 'inset_round': 0.0015,
        'ink_t': 0.0012, 'ink_round': 0.0008,
        'plate_w': (0.46, 0.56), 'plate_bottom': 0.895, 'plate_top': 1.465, 'eye_margin': 0.022}


def log(*a):
    print('[soul-face]', *a, flush=True)


def box_blur(a, r):
    """Three box blurs of radius r px (~Gaussian), edges clamped."""
    a = np.asarray(a, float)
    r = max(1, int(r))
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if k == ax else (0, 0) for k in range(2)], mode='edge'), axis=ax)
            a = (np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)) / (2 * r + 1)
    return a


# ================================================================================================ trace (python3 + PIL)
def trace_plates(src=REF_FACES, out_dir=PLATE_DIR):
    """Plate sheet -> clean designs: RGBA PNG (alpha = outline coverage, white + ink colour) framed so the plate is
    PLATE_FRAME of the image wide and centred on its bounding box; plates.json records how each was traced."""
    from PIL import Image
    up = SHEET['up']
    img = Image.open(src).convert('RGB')
    os.makedirs(out_dir, exist_ok=True)
    recs = {}
    for i, pid in enumerate(PLATES):
        x0, y0, k = SHEET['x'][i % 5], SHEET['y'][i // 5], SHEET['inset']
        tile = img.crop((x0 + k, y0 + k, x0 + SHEET['tile'] - k, y0 + SHEET['tile'] - k))
        tile = tile.resize((tile.width * up, tile.height * up), Image.BICUBIC)
        a = np.asarray(tile).astype(float) / 255.0
        lum = a @ LUMA
        sat = a.max(2) - a.min(2)
        blue = (a[..., 2] - a[..., 0] > 0.25) & (a[..., 2] > 0.45)
        body = (lum > 0.62) & (sat < 0.18)          # white only: the sheet's coloured rim lights are left out
        if pid == 'crack':
            body |= blue                            # the lightning crack is part of the plate
        if pid == 'cracked-bow':
            body = box_blur(box_blur(body, 3 * up // 2) > 0.02, 3 * up // 2) > 0.98  # close cracks at the edge
        sil = sd.largest_component(body)
        s = box_blur(sil, up)
        ys, xs = np.nonzero(sil)
        axis, iou = (xs.min() + xs.max()) / 2, None
        if pid in SYMMETRIC:
            xx = np.arange(s.shape[1])
            best = None
            for c_ in np.arange(axis - 6 * up, axis + 6 * up + 0.01, 0.5):
                m = np.stack([np.interp(2 * c_ - xx, xx, row, left=0, right=0) for row in s])
                o = float(np.minimum(s, m).sum() / np.maximum(s, m).sum())
                if best is None or o > best[0]:
                    best = (o, float(c_), m)
            iou, axis, m = best
            s = np.where(xx[None, :] <= axis, s, m)
        inside = s > 0.5
        ink = np.zeros(s.shape)
        if pid in ('skull-x', 'cracked-bow'):
            ink = ((lum < 0.45) & (sat < 0.2) & sil & (box_blur(sil, up) > 0.9)).astype(float)
        elif pid == 'crack':
            seed = blue & (box_blur(inside, 3 * up) > 0.995)
            ink = (blue & (box_blur(seed, 3 * up) > 0.02) & inside).astype(float)
        ink = box_blur(ink, up // 2) if ink.any() else ink
        ys, xs = np.nonzero(inside)
        bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        k_ = (bx1 - bx0) / (PLATE_FRAME * PLATE_PNG)            # tile px per design px
        o = np.arange(PLATE_PNG) + 0.5 - PLATE_PNG / 2
        X, Y = np.meshgrid((bx0 + bx1) / 2 + o * k_, (by0 + by1) / 2 + o * k_)
        alpha = np.clip(sd.bilinear(s[..., None], X, Y)[..., 0], 0, 1)
        inkr = np.clip(sd.bilinear(ink[..., None], X, Y)[..., 0], 0, 1) if ink.any() else np.zeros_like(alpha)
        white = sd.hex_rgb(PLATE_WHITE)
        col = sd.hex_rgb(INK.get(pid, PLATE_WHITE))
        rgb = white[None, None] * (1 - inkr[..., None]) + col[None, None] * inkr[..., None]
        out = np.concatenate([rgb, alpha[..., None]], 2)
        path = os.path.join(out_dir, f'{pid}.png')
        sd.save_png(path, sd.to_u8(out))
        recs[pid] = {'file': f'assets-src/soul-face/plates/{pid}.png', 'aspect': round(float((by1 - by0) / (bx1 - bx0)), 4),
                     'ink': INK.get(pid), 'mirrored': pid in SYMMETRIC, 'halfOverlap': None if iou is None else round(iou, 3),
                     'sheetTile': i, 'sha256': sd.sha256_file(path)}
        log(f'plate {pid}: aspect {recs[pid]["aspect"]}, ink {"yes" if ink.any() else "no"}')
    meta = {'version': 1, 'source': 'docs/art/reference/soul-faces-reference.png', 'sourceSha256': sd.sha256_file(src),
            'tool': 'tools/ai/blender/soul_face.py --mode trace', 'frame': PLATE_FRAME, 'size': PLATE_PNG, 'plates': recs}
    with open(PLATES_JSON, 'w') as fh:
        json.dump(meta, fh, indent=2)
        fh.write('\n')
    return meta


# ================================================================================================ 2D signed distances
def sd_disc(P, c, r):
    return np.hypot(P[:, 0] - c[0], P[:, 1] - c[1]) - r


def sd_half(P, p0, n):
    """Half plane: negative on the side opposite n (n need not be unit)."""
    n = np.asarray(n, float) / np.linalg.norm(n)
    return (P[:, 0] - p0[0]) * n[0] + (P[:, 1] - p0[1]) * n[1]


def sd_poly(P, V):
    return sd.sd_polygon(P, np.asarray(V, float))


def r_and(a, b, k=0.0):
    """Intersection with the corner rounded by k (exact outside, like a rounded box)."""
    if k <= 0:
        return np.maximum(a, b)
    qa, qb = a + k, b + k
    return np.hypot(np.maximum(qa, 0), np.maximum(qb, 0)) + np.minimum(np.maximum(qa, qb), 0) - k


def r_or(a, b, k=0.0):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def heart_poly(w=1.3, cy=0.0, n=160):
    t = np.linspace(0, 2 * math.pi, n, endpoint=False)
    x = 16 * np.sin(t) ** 3
    y = 13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t)
    s = w / 32.0
    y = y - (y.max() + y.min()) / 2
    return np.stack([x * s, y * s + cy], 1)[::-1]


def sparkle_poly(c, size, p=0.55, n=240):
    V = sd.superellipse(size * 0.84, size, p, count=n)
    return V + np.asarray(c, float)[None]


def blade_poly(a, b, w_mid, w_end):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = (b - a) / np.linalg.norm(b - a)
    n = np.array([-d[1], d[0]])
    m = (a + b) / 2
    return np.array([a + n * w_end / 2, m + n * w_mid / 2, b + n * w_end / 2, b - n * w_end / 2, m - n * w_mid / 2, a - n * w_end / 2])


def arc_stroke(c, r, a0, a1, w0, w1, n=64):
    """A stroke along a circular arc (angles in degrees, a0 -> a1) whose width runs w0 -> w1 -> w0, round ends."""
    t = np.radians(np.linspace(a0, a1, n))
    s = np.linspace(0, 1, n)
    w = w0 + (w1 - w0) * np.sin(math.pi * s)
    P = np.stack([c[0] + r * np.cos(t), c[1] + r * np.sin(t)], 1)
    N = np.stack([np.cos(t), np.sin(t)], 1)
    outer, inner = P + N * (w / 2)[:, None], P - N * (w / 2)[:, None]
    cap = lambda p, nn, ww, sgn: [p + ww / 2 * np.array([math.cos(q), math.sin(q)])  # noqa: E731
                                  for q in np.linspace(math.atan2(nn[1], nn[0]), math.atan2(nn[1], nn[0]) + sgn * math.pi, 9)[1:-1]]
    return np.vstack([outer, np.array(cap(P[-1], N[-1], w[-1], -1.0)), inner[::-1], np.array(cap(P[0], -N[0], w[0], -1.0))])


# ================================================================================================ eye designs
# A piece: footprint (2D signed distance in eye units), layer ('base' on the plate, 'inset' on top of a base piece), the
# top colour (hex, or ('lin', p0, p1, hex0, hex1) / ('rad', c, r0, r1, hex0, hex1) in eye units), the wall colour (the
# sides of the raised piece), roughness and an optional glow.
def _grad_lin(p0, p1, h0, h1):
    return ('lin', tuple(p0), tuple(p1), h0, h1)


def eye_pieces(eid, side=+1):
    """Pieces of one eye: side +1 = the character's left eye (+X, the sheet's near eye), -1 = its right eye."""
    disc = lambda P: sd_disc(P, (0, 0), 1.0)  # noqa: E731
    if eid == 'button':
        return [dict(name='eye', f=disc, layer='base', top='#0B0B12', wall='#F4F5FA', rough=0.16)]
    if eid == 'bead':
        return [dict(name='eye', f=disc, layer='base', top='#0B0B12', wall='#43DDBE', rough=0.16)]
    if eid == 'lashes':
        V = arc_stroke((0.0, 0.42), 0.78, 198, 342, 0.13, 0.25)
        lashes = []
        for ang in (228, 252, 276, 300, 322):
            q = math.radians(ang)
            base = np.array([0.0, 0.42]) + 0.78 * np.array([math.cos(q), math.sin(q)])
            nrm = np.array([math.cos(q), math.sin(q)])
            tng = np.array([-nrm[1], nrm[0]])
            lashes.append(np.array([base + tng * 0.09 - nrm * 0.02, base + nrm * 0.30 + tng * 0.035, base - tng * 0.09 - nrm * 0.02]))
        f = lambda P, V=V, L=lashes: np.minimum(sd_poly(P, V), np.min([sd_poly(P, l_) for l_ in L], axis=0))  # noqa: E731
        return [dict(name='lids', f=f, layer='base', top=_grad_lin((-0.8, 0.2), (0.8, 0.2), '#9A3FD0', '#3448D0'), wall='#2A1F55', rough=0.3, emit=0.25)]
    if eid == 'hearts':
        H = heart_poly(1.34, 0.02)
        return [dict(name='eye', f=disc, layer='base', top=('rad', (-0.3, 0.35), 0.2, 1.3, '#26222C', '#0B0B12'), wall='#1B1A22', rough=0.18),
                dict(name='heart', f=lambda P, H=H: sd_poly(P, H), layer='inset', top='#F0587F', wall='#B23458', rough=0.3, emit=0.3)]
    if eid == 'sleepy':
        f = lambda P: r_and(disc(P), sd_half(P, (0.0, 0.16), (-0.10, 1.0)), 0.10)  # noqa: E731
        return [dict(name='eye', f=f, layer='base', top='#0B0B12', wall='#43DDBE', rough=0.16)]
    if eid == 'wink':
        if side > 0:   # the sheet's near eye: a glowing X
            B1 = blade_poly((-0.92, 0.80), (0.92, -0.80), 0.24, 0.07)
            B2 = blade_poly((-0.85, -0.86), (0.88, 0.84), 0.24, 0.07)
            f = lambda P, a=B1, b=B2: np.minimum(sd_poly(P, a), sd_poly(P, b))  # noqa: E731
            return [dict(name='x', f=f, layer='base', top=('rad', (0.0, 0.0), 0.05, 0.55, '#5EE2FF', '#161936'), wall='#141731', rough=0.22, emit=0.3)]
        return [dict(name='eye', f=disc, layer='base', top=_grad_lin((0.0, 1.0), (0.0, -1.0), '#48BFF5', '#16206E'), wall='#141A3A', rough=0.14, emit=0.2)]
    if eid == 'sparkle':
        S = [sparkle_poly((-0.12, 0.22), 0.62), sparkle_poly((0.48, -0.38), 0.34), sparkle_poly((-0.52, -0.42), 0.30)]
        return [dict(name='eye', f=disc, layer='base', top='#0B0B12', wall='#1B1A22', rough=0.16)] + [
            dict(name=f'sparkle{i}', f=lambda P, V=V: sd_poly(P, V), layer='inset', top='#FFB800', wall='#C98A00', rough=0.3, emit=0.35) for i, V in enumerate(S)]
    if eid in ('fierce', 'fierce-red'):
        tail = np.array([[0.62, -0.62], [1.12, -0.86], [0.86, -0.36]])
        f = lambda P, T=tail: r_or(r_and(disc(P), sd_half(P, (0.0, 0.08), (-0.34, 1.0)), 0.08), sd_poly(P, T), 0.06)  # noqa: E731
        top = _grad_lin((0.0, 0.6), (0.0, -1.0), '#FFF3B0', '#F4DC78') if eid == 'fierce' else _grad_lin((-0.7, 0.5), (0.8, -0.9), '#E8305C', '#2A1034')
        return [dict(name='eye', f=f, layer='base', top=top, wall='#221E2C', rough=0.25, emit=0.1 if eid == 'fierce' else 0.2)]
    if eid == 'happy':
        f = lambda P: r_and(disc(P), -sd_disc(P, (0.28, -1.05), 1.0), 0.08)  # noqa: E731
        return [dict(name='eye', f=f, layer='base', top=_grad_lin((-0.5, 0.9), (0.5, -0.6), '#FF962A', '#E0264F'), wall='#2A1E2A', rough=0.25, emit=0.25)]
    raise KeyError(eid)


def eye_frames():
    """(side, centre (x, z)) for both eyes, character's left (+X) first."""
    return [(+1, (FACE['eye_x'], FACE['eye_z'])), (-1, (-FACE['eye_x'], FACE['eye_z']))]


def to_eye(P, side, c, r=None):
    """Front-projected points (x, z) -> eye units of one eye (u mirrored for the character's right eye)."""
    r = FACE['eye_r'] if r is None else r
    return np.stack([side * (P[:, 0] - c[0]) / r, (P[:, 1] - c[1]) / r], 1)


def colour_at(spec, U):
    """Linear RGB of a colour spec at eye-unit points U (N, 2)."""
    if isinstance(spec, str):
        return np.repeat(sd.srgb_to_linear(sd.hex_rgb(spec))[None], len(U), 0)
    kind = spec[0]
    if kind == 'lin':
        p0, p1, h0, h1 = np.asarray(spec[1]), np.asarray(spec[2]), spec[3], spec[4]
        d = p1 - p0
        t = np.clip(((U - p0) @ d) / (d @ d), 0, 1)
    else:
        c, r0, r1, h0, h1 = np.asarray(spec[1]), spec[2], spec[3], spec[4], spec[5]
        t = np.clip((np.linalg.norm(U - c, axis=1) - r0) / (r1 - r0), 0, 1)
    t = t * t * (3 - 2 * t)
    srgb = sd.hex_rgb(h0)[None] * (1 - t[:, None]) + sd.hex_rgb(h1)[None] * t[:, None]
    return sd.srgb_to_linear(srgb)


# ================================================================================================ plates as 2D fields
class Grid2D:
    """A regular 2D grid of values over [lo, hi]^2 with bilinear lookup (points outside clamp to the border)."""

    def __init__(self, vals, lo, hi):
        self.v, self.lo, self.hi = vals, lo, hi
        self.n = vals.shape[0]

    def __call__(self, U):
        f = (np.clip(U, self.lo, self.hi) - self.lo) / (self.hi - self.lo) * (self.n - 1)
        i0 = np.clip(np.floor(f).astype(int), 0, self.n - 2)
        t = f - i0
        v = self.v
        a = v[i0[:, 0], i0[:, 1]] * (1 - t[:, 0]) + v[i0[:, 0] + 1, i0[:, 1]] * t[:, 0]
        b = v[i0[:, 0], i0[:, 1] + 1] * (1 - t[:, 0]) + v[i0[:, 0] + 1, i0[:, 1] + 1] * t[:, 0]
        out = a * (1 - t[:, 1]) + b * t[:, 1]
        # beyond the grid the distance keeps growing
        return out + np.linalg.norm(U - np.clip(U, self.lo, self.hi), axis=1)


def mask_sdf(alpha, lo=-0.62, hi=0.62, n=321):
    """Signed distance (plate-width units, negative inside) to the 0.5 level of a design image's channel."""
    H, W = alpha.shape
    xs, ys = np.arange(W) + 0.5, np.arange(H) + 0.5
    seg = sd.iso_segments(alpha.T, 0.5, xs, ys)                  # px, y down
    g = np.linspace(lo, hi, n)
    U, V = np.meshgrid(g, g, indexing='ij')
    px = PLATE_PNG / 2 + U * PLATE_FRAME * PLATE_PNG
    py = PLATE_PNG / 2 - V * PLATE_FRAME * PLATE_PNG
    P = np.stack([px.ravel(), py.ravel()], 1)
    d = sd.dist_to_segments(P, seg).reshape(n, n) / (PLATE_FRAME * PLATE_PNG)
    inside = sd.bilinear(alpha[..., None], px, py)[..., 0] >= 0.5
    return Grid2D(np.where(inside, -d, d), lo, hi)


_PLATE_CACHE = {}


def plate_fields(pid):
    """(outline, ink or None) signed distance functions of plate-width units (u right, v up, centred)."""
    if pid not in _PLATE_CACHE:
        img = sd.load_rgba(os.path.join(PLATE_DIR, f'{pid}.png'))
        outline = mask_sdf(img[..., 3])
        ink = None
        if INK.get(pid):
            lum = img[..., :3] @ LUMA
            ink_a = np.clip((0.85 - lum) / 0.3, 0, 1) * img[..., 3]
            ink = mask_sdf(ink_a)
        _PLATE_CACHE[pid] = (outline, ink)
    return _PLATE_CACHE[pid]


def eye_union_points(step=0.05):
    """Front-projected points (x, z) covered by any eye design (both eyes): what every plate must hold. step in eye
    units."""
    g = np.arange(-1.3, 1.3001, step)
    U = np.stack(np.meshgrid(g, g, indexing='ij'), -1).reshape(-1, 2)
    pts = []
    for side, c in eye_frames():
        cover = np.zeros(len(U), bool)
        for eid in EYES:
            for pc in eye_pieces(eid, side):
                cover |= pc['f'](U) <= 0
        Q = U[cover]
        pts.append(np.stack([c[0] + side * Q[:, 0] * FACE['eye_r'], c[1] + Q[:, 1] * FACE['eye_r']], 1))
    return np.vstack(pts)


def fit_plates(ids=PLATES):
    """Per plate: the largest width in FACE['plate_w'] and the height (plate centre z) at which every eye design sits at
    least eye_margin inside and the plate spans plate_bottom .. plate_top; among those heights the one with the most
    room around the eyes. -> {pid: {'w', 'cz', 'top', 'bottom', 'eyeRoom'}}."""
    meta = json.load(open(PLATES_JSON))['plates']
    E = eye_union_points()
    out = {}
    for pid in ids:
        outline, _ = plate_fields(pid)
        asp = meta[pid]['aspect']
        found = None
        for w in np.arange(FACE['plate_w'][1], FACE['plate_w'][0] - 1e-9, -0.005):
            h = asp * w
            lo_c = FACE['plate_bottom'] + h / 2
            hi_c = FACE['plate_top'] - h / 2
            best = None
            for cz in np.arange(lo_c, hi_c + 1e-9, 0.0025):
                U = np.stack([E[:, 0] / w, (E[:, 1] - cz) / w], 1)
                room = -float(outline(U).max()) * w
                if room >= FACE['eye_margin'] and (best is None or room > best[1]):
                    best = (float(cz), room)
            if best:
                found = {'w': round(float(w), 4), 'cz': round(best[0], 4), 'top': round(best[0] + h / 2, 4),
                         'bottom': round(best[0] - h / 2, 4), 'eyeRoom': round(best[1], 4)}
                break
        if not found:
            raise RuntimeError(f'plate {pid}: no size and height holds every eye design')
        out[pid] = found
    return out


def plate_uv(P, fit):
    """Front-projected points (x, z) -> plate-width units of one fitted plate."""
    return np.stack([P[:, 0] / fit['w'], (P[:, 1] - fit['cz']) / fit['w']], 1)


# ================================================================================================ 2D preview
def raster_face(pid, eid, fit, px=360, span=(-0.36, 0.36, 0.85, 1.51), bg='#5B6078'):
    """Front view of one plate + one pair of eyes (flat colours, walls as a thin rim): (px, px*h/w, 3) sRGB float."""
    x0, x1, z0, z1 = span
    Wp = px
    Hp = int(round(px * (z1 - z0) / (x1 - x0)))
    ss = 2
    xs = x0 + (np.arange(Wp * ss) + 0.5) / (Wp * ss) * (x1 - x0)
    zs = z1 - (np.arange(Hp * ss) + 0.5) / (Hp * ss) * (z1 - z0)
    X, Z = np.meshgrid(xs, zs)
    P = np.stack([X.ravel(), Z.ravel()], 1)
    pxu = (x1 - x0) / (Wp * ss)
    img = np.repeat(sd.hex_rgb(bg)[None], len(P), 0)

    def over(d, rgb, rim=None, rim_px=1.6):
        a = np.clip(0.5 - d / pxu, 0, 1)[:, None]
        nonlocal img
        if rim is not None:
            a_in = np.clip(0.5 - (d + rim_px * pxu) / pxu, 0, 1)[:, None]
            base = img * (1 - a) + sd.hex_rgb(rim)[None] * a
            img = base * (1 - a_in) + rgb * a_in
        else:
            img = img * (1 - a) + rgb * a
    outline, ink = plate_fields(pid)
    U = plate_uv(P, fit)
    over(outline(U) * fit['w'], sd.hex_rgb(PLATE_WHITE)[None], rim=PLATE_WALL)
    if ink is not None:
        over(ink(U) * fit['w'], sd.hex_rgb(INK[pid])[None])
    for layer in ('base', 'inset'):
        for side, c in eye_frames():
            Ue = to_eye(P, side, c)
            for pc in eye_pieces(eid, side):
                if pc['layer'] != layer:
                    continue
                lin = colour_at(pc['top'], Ue)
                srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.maximum(lin, 0), 1 / 2.4) - 0.055)
                over(pc['f'](Ue) * FACE['eye_r'], srgb, rim=pc['wall'])
    return img.reshape(Hp * ss, Wp * ss, 3).reshape(Hp, ss, Wp, ss, 3).mean(axis=(1, 3))


def mode_preview(args):
    fits = fit_plates()
    for pid, f in fits.items():
        log(f'fit {pid:12s} w {f["w"]:.3f}  z {f["bottom"]:.3f}..{f["top"]:.3f}  eye room {f["eyeRoom"]:.3f}')
    tiles = [raster_face(pid, EYES[i % len(EYES)], fits[pid], px=300) for i, pid in enumerate(PLATES)]
    tiles += [raster_face(PLATES[(i + 5) % len(PLATES)], eid, fits[PLATES[(i + 5) % len(PLATES)]], px=300) for i, eid in enumerate(EYES)]
    img = sd.grid_sheet(tiles, 5, pad=8, bg=(0.08, 0.09, 0.14))
    path = args.out or os.path.join(GEN, 'preview-2d.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sd.save_png(path, img)
    log('preview', path)


# ================================================================================================ the v3 body
# The antenna loses its orb: the head profile stops at 1.87 and a short stalk (radius ~0.036) rises into the topper
# charm, whose bottom edge sits in a small goo collar. The button eyes (domes + grooves) are left out.
STALK = [(1.90, 0.037), (1.95, 0.036), (2.00, 0.034), (2.04, 0.028), (2.07, 0.017), (2.085, 0.005)]
TOPPER = {'size': 0.36, 'z': 2.10, 'axis': (0.1027, 0.0640), 'collar': (0.050, 0.044, 0.030), 'collar_k': 0.02, 'collar_z': 0.012}
FACE_BOX = (np.array([-0.42, -0.58, 0.78]), np.array([0.42, -0.02, 1.58]))


def v3_base_ops():
    p = dict(sb.BASE)
    p['head_r'] = [q for q in sb.BASE['head_r'] if q[0] <= 1.87] + STALK
    ops = [o for o in sb.base_ops(p) if o[1].name != 'orb']
    ax, ay = TOPPER['axis']
    zc = TOPPER['z'] - TOPPER['size'] / 2 + TOPPER['collar_z']
    ops.append(('u', sb.ellipsoid([ax, ay, zc], TOPPER['collar'], name='collar'), TOPPER['collar_k']))
    return ops


class BodyV3:
    """The v3 body as fields (the soul_decor.Body interface): `body` smooth goo, `full` + the baseline's drips (the
    same ones, laid on the baseline goo; none sits on the orb), no eyes. `face` = the ops near the face."""

    def __init__(self, log_=lambda *a: None):
        self.body = v3_base_ops()
        ax, ay = TOPPER['axis']
        drips = sb.splat_ops(sb.base_ops(), log=log_)
        keep = [op for op in drips if not (op[1].hi[2] > 1.86 and math.hypot((op[1].lo[0] + op[1].hi[0]) / 2 - ax, (op[1].lo[1] + op[1].hi[1]) / 2 - ay) < 0.32)]
        self.dropped = len(drips) - len(keep)
        self.eye_list, self.eyes = [], []
        self.full = self.body + keep
        self.smooth = self.body
        self.floor = -0.02189
        self.face = sd.ops_near(self.body, *FACE_BOX)

    def f(self, P, which='body'):
        return sb.eval_ops_points(getattr(self, which), np.atleast_2d(P))


def eye_surface(B):
    """(centre, normal) on the goo under both eye centres (front projection), character's left first."""
    out = []
    for side, (x, z) in eye_frames():
        p, _ = sb.march(B.face, np.array([[x, -1.5, z]]), np.array([[0.0, 1.0, 0.0]]), 0.0, 3.0, 600)
        out.append((p[0], sb.gradient(B.face, p)[0]))
    return out


def face_proj(P, fb):
    """Front projection (x, z) of points near the face, taken where the head's radial line through the point meets
    the goo, so footprints follow the surface normal and the walls of a raised piece stand square on it."""
    rho = np.hypot(P[:, 0], P[:, 1])
    k = np.clip((rho - fb) / np.maximum(rho, 1e-6), 0.8, 1.2)
    return np.stack([P[:, 0] * k, P[:, 2]], 1)


def shell(fb, d2, lo, hi, re):
    """A raised piece: footprint d2 (model units) between offsets lo..hi over the goo, edges rounded by re."""
    return r_and(d2, np.abs(fb - (lo + hi) / 2) - (hi - lo) / 2, re)


def topper_slot():
    """The antenna charm as a soul_decor slot (model space): facing front, its outline's middle on the stalk axis."""
    S = TOPPER['size']
    ax, ay = TOPPER['axis']
    mid_edge = float(sd.charm_back_z(0.5)) + sd.CHARM['edge'] / 2   # local z of the charm's middle at its outline
    origin = np.array([ax, ay + mid_edge * S, TOPPER['z']])         # front normal -Y: origin = axis + Y * mid * S
    return {'index': 'topper', 'centre': sd.to_model(origin), 'normal': [0.0, 0.0, 1.0], 'up': [0.0, 1.0, 0.0], 'size': S, 'sink': 0.0}


# ================================================================================================ plates and eyes as parts
def plate_parts(pid, fit, B):
    outline, ink = plate_fields(pid)
    ops = B.face
    Tp = FACE['plate_t']

    def f_plate(P):
        fb = sb.eval_ops_points(ops, P)
        return shell(fb, outline(plate_uv(face_proj(P, fb), fit)) * fit['w'], -FACE['plate_in'], Tp, FACE['plate_round'])
    lo = np.array([-fit['w'] / 2 - 0.03, -0.48, fit['bottom'] - 0.03])
    hi = np.array([fit['w'] / 2 + 0.03, -0.10, fit['top'] + 0.03])
    parts = [dict(name='plate', fn=f_plate, lo=lo, hi=hi, vs=0.002, tris=2000, top=PLATE_WHITE, wall=PLATE_RIM.get(pid, PLATE_WALL), rough=0.3)]
    if ink is not None:
        def f_ink(P):
            fb = sb.eval_ops_points(ops, P)
            return shell(fb, ink(plate_uv(face_proj(P, fb), fit)) * fit['w'], Tp - 0.002, Tp + FACE['ink_t'], FACE['ink_round'])
        g = ink.v < 0.004
        uu = np.linspace(ink.lo, ink.hi, ink.n)
        U, V = np.meshgrid(uu, uu, indexing='ij')
        xs, zs = U[g] * fit['w'], fit['cz'] + V[g] * fit['w']
        lo_i = np.array([xs.min() - 0.02, -0.48, zs.min() - 0.02])
        hi_i = np.array([xs.max() + 0.02, -0.10, zs.max() + 0.02])
        parts.append(dict(name='ink', fn=f_ink, lo=lo_i, hi=hi_i, vs=0.001, tris=700, top=INK[pid], wall=None, rough=0.45))
    return parts


LAYERS = {'base': lambda: (FACE['plate_t'] - FACE['eye_in'], FACE['plate_t'] + FACE['eye_t'], FACE['eye_round']),
          'inset': lambda: (FACE['plate_t'] + FACE['eye_t'] - 0.003, FACE['plate_t'] + FACE['eye_t'] + FACE['inset_t'], FACE['inset_round'])}


def eye_parts(eid, B):
    """One part per material: every piece of that colour on both eyes is one mesh."""
    ops = B.face
    groups = {}
    for side, c in eye_frames():
        for pc in eye_pieces(eid, side):
            key = (pc['layer'], json.dumps(pc['top']), pc['wall'], pc['rough'])
            g = groups.setdefault(key, {'pc': pc, 'eyes': [], 'names': []})
            g['eyes'].append((side, c, pc['f']))
            g['names'].append(pc['name'])
    parts = []
    for (layer, _, _, _), g in groups.items():
        pc = g['pc']
        name = g['names'][0].rstrip('0123456789') or 'eye'
        lo_o, hi_o, re = LAYERS[layer]()

        def fn(P, pieces=g['eyes'], lo_o=lo_o, hi_o=hi_o, re=re):
            fb = sb.eval_ops_points(ops, P)
            Q = face_proj(P, fb)
            d2 = None
            for side, c, f_ in pieces:
                d = f_(to_eye(Q, side, c)) * FACE['eye_r']
                d2 = d if d2 is None else np.minimum(d2, d)
            return shell(fb, d2, lo_o, hi_o, re)
        xs = [c[0] for _, c, _ in g['eyes']]
        lo = np.array([min(xs) - 0.14, -0.47, FACE['eye_z'] - 0.14])
        hi = np.array([max(xs) + 0.14, -0.22, FACE['eye_z'] + 0.14])
        spec = pc['top']

        def colour_fn(P, spec=spec):
            fb = sb.eval_ops_points(ops, P)
            Q = face_proj(P, fb)
            out = np.zeros((len(P), 3))
            for side, c in eye_frames():
                m = np.sign(Q[:, 0]) == side
                if m.any():
                    out[m] = colour_at(spec, to_eye(Q[m], side, c))
            return out
        parts.append(dict(name=f'{layer}_{name}', fn=fn, lo=lo, hi=hi, vs=0.0011 if layer == 'base' else 0.0008,
                          tris=1500 if layer == 'base' else 600, top=spec, wall=pc['wall'], rough=pc['rough'], emit=pc.get('emit', 0.0),
                          colour_fn=colour_fn))
    return parts


def mesh_part(part):
    """Sparse OpenVDB level set of a part -> decimated (verts, normals, tris), Blender coords."""
    lo, hi = sd.snap_box(part['lo'], part['hi'], part['vs'])
    prim = sd.field_prim(part['fn'], lo, hi, part['name'])
    grid = sb.sparse_grid([('u', prim, 0.0)], lo, hi, part['vs'], log=lambda *a: None)
    verts, tq, qd = sb.mesh_from_grid(grid, lo, part['vs'])
    if not len(verts):
        raise RuntimeError(f'{part["name"]}: empty mesh')
    return sd.mesh_to_arrays(verts, tq, qd, part['tris'], part['name'])


def split_part(part, v, n, t, ops):
    """Primitives of one part: its top (faces looking out of the goo) in the top colour and its sides in the wall colour
    (one primitive when the part has no wall colour). Gradients become vertex colours."""
    if part.get('wall') is None:
        groups = [('top', np.arange(len(t)))]
    else:
        c = v[t].mean(1)
        fn_ = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
        fn_ /= np.maximum(np.linalg.norm(fn_, axis=1, keepdims=True), 1e-12)
        top = (fn_ * sb.gradient(ops, c)).sum(1) > 0.5
        groups = [('top', np.nonzero(top)[0]), ('wall', np.nonzero(~top)[0])]
    out = []
    for kind, idx in groups:
        if not len(idx):
            continue
        tt = t[idx]
        used = np.unique(tt)
        remap = -np.ones(len(v), int)
        remap[used] = np.arange(len(used))
        P, N = v[used], n[used]
        spec = part['top'] if kind == 'top' else part['wall']
        C = None if isinstance(spec, str) else part['colour_fn'](P)
        out.append({'name': f'{part["name"]}_{kind}', 'P': P, 'N': N, 'I': remap[tt], 'C': C,
                    'mat': {'name': f'{part["name"]}_{kind}', 'base': spec if isinstance(spec, str) else None, 'rough': part['rough'],
                            'emit': part.get('emit', 0.0) if kind == 'top' else 0.0}})
    return out


def face_glb(name, prims, meta):
    """Plate / eyes GLB: model space at identity, KHR_mesh_quantization, one primitive per colour (int16 POSITION,
    int8 NORMAL, uint16 COLOR_0 for gradients), core PBR materials."""
    P_all = np.vstack([sd.blender_to_model(p['P']) for p in prims])
    lo, hi = P_all.min(0), P_all.max(0)
    centre = (lo + hi) / 2
    half = float(np.max(hi - lo) / 2) * 1.0001
    mats, blobs, accessors, gl_prims = [], [], [], []
    for pr in prims:
        m = pr['mat']
        base = (sd.linear_hex(m['base']) if m['base'] else [1.0, 1.0, 1.0]) + [1.0]
        mats.append({'name': m['name'], 'pbrMetallicRoughness': {'baseColorFactor': base, 'metallicFactor': 0.0, 'roughnessFactor': m['rough']}})
        if m.get('emit'):
            mats[-1]['emissiveFactor'] = [round(v * m['emit'], 5) for v in base[:3]]
            if pr['C'] is not None:
                mats[-1]['extras'] = {'emissiveFromVertexColor': True}
        q = np.round((sd.blender_to_model(pr['P']) - centre) / half * 32767).astype(np.int16)
        pos = np.zeros((len(q), 4), np.int16)
        pos[:, :3] = q
        attrs = {'POSITION': len(accessors)}
        accessors.append({'bufferView': len(blobs), 'componentType': 5122, 'normalized': True, 'count': len(q), 'type': 'VEC3',
                          'min': q.min(0).astype(int).tolist(), 'max': q.max(0).astype(int).tolist()})
        blobs.append((pos.tobytes(), 8, 34962))
        attrs['NORMAL'] = len(accessors)
        accessors.append({'bufferView': len(blobs), 'componentType': 5120, 'normalized': True, 'count': len(q), 'type': 'VEC3'})
        blobs.append((sd.pack_normals(sd.blender_to_model(pr['N'])).tobytes(), 4, 34962))
        if pr['C'] is not None:
            col = np.ones((len(q), 4))
            col[:, :3] = np.clip(pr['C'], 0, 1)
            attrs['COLOR_0'] = len(accessors)
            accessors.append({'bufferView': len(blobs), 'componentType': 5123, 'normalized': True, 'count': len(q), 'type': 'VEC4'})
            blobs.append((np.round(col * 65535).astype(np.uint16).tobytes(), 8, 34962))
        idx = pr['I'].astype(np.uint16 if len(q) < 65536 else np.uint32).ravel()
        ind = len(accessors)
        accessors.append({'bufferView': len(blobs), 'componentType': 5123 if len(q) < 65536 else 5125, 'count': int(idx.size), 'type': 'SCALAR'})
        blobs.append((idx.tobytes(), None, 34963))
        gl_prims.append({'attributes': attrs, 'indices': ind, 'material': len(mats) - 1, 'extras': {'part': pr['name']}})
    gl = {'asset': {'version': '2.0', 'generator': 'ariskill tools/ai/blender/soul_face.py', 'extras': meta},
          'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
          'scene': 0, 'scenes': [{'nodes': [0]}],
          'nodes': [{'name': name, 'mesh': 0, 'translation': [round(float(v), 7) for v in centre], 'scale': [round(half, 7)] * 3}],
          'meshes': [{'name': name, 'primitives': gl_prims}], 'materials': mats, 'accessors': accessors}
    return sd._glb_pack(gl, blobs)


def build_face_glb(kind, fid, parts, B, out_dir):
    t0 = time.time()
    prims = []
    for part in parts:
        v, n, t = mesh_part(part)
        prims += split_part(part, v, n, t, B.face)
    meta = {kind: fid, 'frame': 'model space of the baseline Soul GLBs (+Y up, +Z front); place at identity',
            'parts': [p['name'] for p in prims], 'triangles': int(sum(len(p['I']) for p in prims))}
    data = face_glb(f'{kind}-{fid}', prims, meta)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f'{kind}-{fid}.glb')
    with open(path, 'wb') as fh:
        fh.write(data)
    log(f'{kind} {fid}: {meta["triangles"]} tris, {len(data)} bytes in {time.time() - t0:.1f}s')
    record(f'{os.path.basename(out_dir)}/{kind}-{fid}.glb', path, triangles=meta['triangles'])
    return path


# ================================================================================================ skill face kits, refitted
def kit_parts_v3(B, face):
    """The three kits on the new face: glasses around the new eyes, the patch over the character's left eye, the halo;
    the bandana and the halo are the stage-12 parts unchanged. Tubes over the face ride on the plate (plate_t higher)
    and step down to the goo past the plate's edge (about 44 degrees round the head)."""
    E = eye_surface(B)
    Tp = FACE['plate_t']
    shim = sd.NearBody.__new__(sd.NearBody)
    shim.body, shim.eye_list, shim.full, shim.smooth, shim.floor = B.face, [], B.face, B.face, B.floor
    shim.eyes = [(c, n, FACE['eye_r']) for c, n in E]

    def plate_w(P):
        az = np.degrees(np.abs(np.arctan2(P[:, 0], -P[:, 1])))
        wz = np.clip((P[:, 2] - (FACE['plate_bottom'] - 0.03)) / 0.03, 0, 1) * np.clip(((FACE['plate_top'] + 0.03) - P[:, 2]) / 0.03, 0, 1)
        return np.clip((50.0 - az) / 6.0, 0, 1) * wz

    def ride(P, h):
        """Surface points lifted by h, plus the plate where there is one."""
        Ps, nrm = sb.project_to_surface(B.face, np.atleast_2d(P))
        return Ps + nrm * (h + Tp * plate_w(Ps))[:, None]
    parts = []
    if face == 'nerdy':
        r_rim, r_bridge, r_temple, R = 0.016, 0.011, 0.0095, 0.118
        rims = []
        for i, (c, n) in enumerate(E):
            F = sb.frame_from_normal(n)
            t = np.linspace(0, 2 * math.pi, 72, endpoint=False)
            ring = ride(c[None] + R * (np.cos(t)[:, None] * F[0][None] + np.sin(t)[:, None] * F[1][None]), 0.003 + r_rim)
            rims.append(ring)
            nm = 'rim_left' if i == 0 else 'rim_right'
            parts.append((nm, 'frame', [('u', sb.polyline_tube(ring, r_rim, closed=True, name=nm), 0.0)], ring.min(0) - 0.03, ring.max(0) + 0.03, 1000))
        inner_l = rims[0][np.argmin(rims[0][:, 0])]
        inner_r = rims[1][np.argmax(rims[1][:, 0])]
        mid = ride(sd.head_point(shim, 0.0, E[0][0][2] + 0.03), 0.006 + r_bridge)[0]
        ctrl = sd.smooth_polyline(np.array([inner_l, 0.5 * (inner_l + mid) + np.array([0, -0.003, 0.008]), mid,
                                            0.5 * (inner_r + mid) + np.array([0, -0.003, 0.008]), inner_r]), 4)
        parts.append(('bridge', 'frame', [('u', sb.polyline_tube(ctrl, r_bridge, closed=False, name='bridge'), 0.0)], ctrl.min(0) - 0.03, ctrl.max(0) + 0.03, 300))
        for i, sgn in ((0, 1.0), (1, -1.0)):
            ring = rims[i]
            outer = ring[np.argmax(sgn * ring[:, 0])]
            az0 = math.degrees(math.atan2(outer[0], -outer[1]))
            back = ride(sd.head_points(shim, sgn * np.linspace(abs(az0) + 6, 118, 12), outer[2] + 0.004), 0.003 + r_temple)
            path = sd.smooth_polyline(np.vstack([outer[None], back]), 3)
            nm = 'temple_left' if i == 0 else 'temple_right'
            parts.append((nm, 'frame', [('u', sb.polyline_tube(path, r_temple, closed=False, name=nm), 0.0)], path.min(0) - 0.03, path.max(0) + 0.03, 350))
    elif face == 'pirate':
        c, n = E[0]
        rx, rz = 0.13, 0.12
        lo_o, hi_o = Tp - 0.002, Tp + FACE['eye_t'] + 0.009
        xc, zc = FACE['eye_x'], FACE['eye_z']

        def patch_fn(P):
            fb = sb.eval_ops_points(B.face, P)
            Q = face_proj(P, fb)
            d2 = (np.hypot((Q[:, 0] - xc) / rx, (Q[:, 1] - zc) / rz) - 1.0) * min(rx, rz)
            return shell(fb, d2, lo_o, hi_o, 0.006)
        lo_p, hi_p = c - np.array([0.17, 0.12, 0.16]), c + np.array([0.17, 0.12, 0.16])
        parts.append(('patch', 'patch', [('u', sd.field_prim(patch_fn, lo_p, hi_p, 'patch'), 0.0)], lo_p, hi_p, 900))
        # the strap: as stage 12 (a plane through the patch and two points under the bandana brim), riding the plate
        tip = c + n * (hi_o - 0.004)
        a1 = sd.head_point(shim, -28.0, 1.445)
        a2 = sd.head_point(shim, 150.0, 1.415)
        pn = np.cross(a1 - tip, a2 - tip)
        pn /= np.linalg.norm(pn)
        azs = np.linspace(0, 360, 96, endpoint=False)
        zs_ = np.linspace(1.0, 1.62, 32)
        grid_ = sd.head_points(shim, azs[:, None], zs_[None, :])
        f = (grid_ - tip[None, None]) @ pn
        loop = []
        for k_ in range(len(azs)):
            fk, pk = f[k_], grid_[k_]
            j = int(np.argmin(np.abs(fk)))
            j2 = min(max(j + (1 if fk[j] * fk[min(j + 1, 31)] < 0 else -1), 0), 31)
            t_ = fk[j] / (fk[j] - fk[j2]) if fk[j] != fk[j2] else 0.0
            loop.append(pk[j] + (pk[j2] - pk[j]) * t_)
        loop = ride(np.array(loop), 0.004 + 0.010)
        brim_at = 1.43 - 0.03 * (1 - np.cos(np.radians(azs))) / 2
        inside = loop[:, 2] < brim_at + 0.03
        k0 = int(np.argmin(np.abs(((azs - math.degrees(math.atan2(c[0], -c[1]))) + 180) % 360 - 180)))
        lo_k, hi_k = k0, k0
        while inside[(lo_k - 1) % len(loop)] and hi_k - lo_k < len(loop) - 2:
            lo_k -= 1
        while inside[(hi_k + 1) % len(loop)] and hi_k - lo_k < len(loop) - 2:
            hi_k += 1
        arc = sd.smooth_polyline(loop[[k % len(loop) for k in range(lo_k - 1, hi_k + 2)]], 2)
        parts.append(('strap', 'patch', [('u', sb.polyline_tube(arc, 0.010, closed=False, name='strap'), 0.0)], arc.min(0) - 0.03, arc.max(0) + 0.03, 600))
        parts += [p_ for p_ in sd.kit_parts(shim, 'pirate') if p_[0].startswith('bandana')]
    elif face == 'angel':
        parts += sd.kit_parts(shim, 'angel')
    return parts


def build_kit_v3(B, face, out_dir):
    t0 = time.time()
    prims = []
    for name, mat, ops, lo, hi, tris in kit_parts_v3(B, face):
        lo, hi = sd.snap_box(lo, hi, sd.KIT_VOXEL)
        grid = sb.sparse_grid(ops, lo, hi, sd.KIT_VOXEL, log=lambda *a: None)
        verts, tq, qd = sb.mesh_from_grid(grid, lo, sd.KIT_VOXEL)
        v, n_, t = sd.mesh_to_arrays(verts, tq, qd, tris, f'{face}_{name}')
        prims.append({'name': name, 'material': mat, 'P': sd.blender_to_model(v), 'N': sd.blender_to_model(n_), 'I': t})
    meta = {'face': face, 'version': 3, 'frame': 'model space of the baseline Soul GLBs (+Y up, +Z front); place at identity',
            'parts': [p_['name'] for p_ in prims], 'triangles': int(sum(len(p_['I']) for p_ in prims))}
    data = sd.kit_glb(face, prims, meta)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f'face-{face}.glb')
    with open(path, 'wb') as fh:
        fh.write(data)
    log(f'kit {face}: {meta["triangles"]} tris, {len(data)} bytes in {time.time() - t0:.1f}s')
    record(f'kits/face-{face}.glb', path, triangles=meta['triangles'])
    return path


# ================================================================================================ review renders
def face_material_blender(mat, name, has_col):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    pb = mat['pbrMetallicRoughness']
    sb.set_bsdf(bsdf, base=tuple(pb['baseColorFactor']), rough=pb['roughnessFactor'], coat=0.5, coat_rough=0.12)
    if has_col:
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        nt.links.new(attr.outputs['Color'], sb._in(bsdf, 'Base Color'))
    if 'emissiveFactor' in mat:
        if has_col and mat.get('extras', {}).get('emissiveFromVertexColor'):
            nt.links.new(attr.outputs['Color'], sb._in(bsdf, 'Emission Color'))
            sb._in(bsdf, 'Emission Strength').default_value = mat['emissiveFactor'][0]
        else:
            sb._in(bsdf, 'Emission Color').default_value = tuple(mat['emissiveFactor']) + (1.0,)
            sb._in(bsdf, 'Emission Strength').default_value = 1.0
    return m


def place_glb(path, tag):
    _, prims = sd.decode_glb(path)
    obs = []
    for k, pr in enumerate(prims):
        C = pr.get('C')
        ob = sd.mesh_object(f'{tag}_{k}', sd.model_to_blender(pr['P']), pr['I'], colors=C)
        ob.data.materials.append(face_material_blender(pr['material'], f'{tag}_mat_{k}', C is not None))
        obs.append(ob)
    return obs


class StageV3(sd.SoulStage):
    """soul_decor.SoulStage on the v3 body: plate, eyes, kit, charms and the antenna charm swap in and out."""

    def __init__(self, B, cat, voxel):
        sd.new_scene()
        self.B, self.cat = B, cat
        self.body, self.verts, self.mask = sd.build_body(B, voxel, log_=log)
        self.mask[:, 3] = 0.0  # no orb, no orb glow
        self.mat = sd.body_material('#FFFFFF')
        self.body.data.materials.append(self.mat)
        self.slots = json.load(open(os.path.join(sd.GEN_DIR, 'slots.json')))['slots']
        self.extra = []

    def decorate_v3(self, plate=None, eyes=None, face=None, charms=(), topper=None):
        self.clear()
        if plate:
            self.extra += place_glb(os.path.join(GEN, 'plates', f'plate-{plate}.glb'), f'plate_{plate}')
        if eyes:
            self.extra += place_glb(os.path.join(GEN, 'eyes', f'eyes-{eyes}.glb'), f'eyes_{eyes}')
        if face:
            self.extra += sd.place_kit(os.path.join(GEN, 'kits', f'face-{face}.glb'), tag=face)
        charm_dir = os.path.join(sd.GEN_DIR, 'charms')
        for sl, cid in zip(self.slots, charms):
            self.extra.append(sd.place_charm(cid, sl, charm_dir))
        if topper:
            self.extra.append(sd.place_charm(topper, topper_slot(), charm_dir, name=f'topper_{topper}'))


def build_all(B, fits, rebuild=False):
    for pid in PLATES:
        path = os.path.join(GEN, 'plates', f'plate-{pid}.glb')
        if rebuild or not os.path.exists(path):
            build_face_glb('plate', pid, plate_parts(pid, fits[pid], B), B, os.path.dirname(path))
    for eid in EYES:
        path = os.path.join(GEN, 'eyes', f'eyes-{eid}.glb')
        if rebuild or not os.path.exists(path):
            build_face_glb('eyes', eid, eye_parts(eid, B), B, os.path.dirname(path))
    for face in FACES:
        path = os.path.join(GEN, 'kits', f'face-{face}.glb')
        if rebuild or not os.path.exists(path):
            build_kit_v3(B, face, os.path.dirname(path))


def close_up(W, H, az=22.0, el=5.0):
    """The head (z 0.67 .. 1.77) filling the frame; the caption bar covers only the body under the face."""
    span = 1.10
    return sb.orbit_cam(az, el_deg=el, W=W, H=H, fill=2.30 / span, target_z=1.22)


def mode_renders(args):
    t0 = time.time()
    cat = sd.read_catalog()
    G = {g['id']: g for g in cat['gradients']}
    fits = fit_plates()
    B = BodyV3(log)
    log(f'v3 body: {B.dropped} drips dropped near the antenna; face ops {len(B.face)}')
    build_all(B, fits, args.rebuild)
    rdir = os.path.join(GEN, 'renders')
    os.makedirs(rdir, exist_ok=True)
    os.makedirs(QA_DIR, exist_ok=True)
    st = StageV3(B, cat, args.voxel)
    configs = json.load(open(args.configs)) if args.configs else []
    only = set(args.only.split(',')) if args.only else None
    if not only or 'plates' in only:
        st.set_gradient(G['sky'])
        tiles = []
        for pid in PLATES:
            st.decorate_v3(plate=pid, eyes='button', topper='core-classic-lemon')
            tiles.append(st.shot(os.path.join(rdir, f'plate-{pid}.png'), 460, 520, cam=close_up(460, 520), caption=f'face: {pid}'))
        sd.save_png(os.path.join(QA_DIR, 'decor-v3-plates.png'), sd.grid_sheet(tiles, 5))
        log('sheet decor-v3-plates.png')
    if not only or 'eyes' in only:
        st.set_gradient(G['lilac'])
        tiles = []
        for eid in EYES:
            st.decorate_v3(plate='round', eyes=eid, topper='soft-sunflower')
            tiles.append(st.shot(os.path.join(rdir, f'eyes-{eid}.png'), 460, 520, cam=close_up(460, 520), caption=f'eyes: {eid}'))
        sd.save_png(os.path.join(QA_DIR, 'decor-v3-eyes.png'), sd.grid_sheet(tiles, 5))
        log('sheet decor-v3-eyes.png')
    if configs and (not only or 'examples' in only):
        tiles = []
        for i, cfg in enumerate(configs):
            st.set_gradient(cat['gradients'][cfg['gradient']])
            st.decorate_v3(plate=cfg['plate'], eyes=cfg['eyes'], face=cfg['face'], charms=cfg['charms'], topper=cfg['topper'])
            tiles.append(st.shot(os.path.join(rdir, f'example-{i}.png'), 600, 720, fill=0.80, target_z=1.10, caption=cfg.get('caption')))
            if i == args.hero:
                hero = st.shot(os.path.join(rdir, 'example-hero.png'), 1200, 1414, fill=0.78, target_z=1.10)
                sd.save_png(os.path.join(QA_DIR, 'decor-v3-example-soul.png'), sd.to_u8(hero))
        sd.save_png(os.path.join(QA_DIR, 'decor-v3-examples.png'), sd.grid_sheet(tiles, min(4, len(tiles))))
        log('sheet decor-v3-examples.png')
    log(f'renders in {time.time() - t0:.1f}s')


# ================================================================================================ production
# Staged outputs: GEN/<group>/<file> with provenance.json (sha256 per file); tools/assets/build-soul-face.js copies them
# byte for byte to assets/souls/v3/<file>. The data module lists every file with ?v=<sha256 prefix>.
RUNTIME = os.path.join(ROOT, 'assets', 'souls', 'v3')
RUNTIME_URL = '/assets/souls/v3/'
DATA_JS = os.path.join(ROOT, 'packages', 'ui', 'soul-face-data.js')
GENERATOR = 'tools/ai/blender/soul_face.py'
SHA_CHARS = 10
BODY_TRIS = {'hero': 24000, 'lite': 6000}     # the baseline GLBs' LODs
BASE_HEIGHT = 2.29087  # landmarks.height of the baseline GLBs (feet .. orb top): the v3 Soul with its topper keeps the scale
BASE_FLOOR = -0.02189
SPRITE_PX = 800        # sprites render the 200 viewBox at 4 px per unit (the stage-12 face sprites' scale), then crop
VIEW = {'cx': 100.0, 'y0': 178.6, 'scale': 70.0}   # soul-baseline-shape.js MAPPING


def record(key, path, **extra):
    """Provenance of one staged file (sha256, bytes, extras)."""
    prov = read_prov()
    prov.setdefault('files', {})[key] = dict(extra, bytes=os.path.getsize(path), sha256=sd.sha256_file(path))
    write_prov(prov)


def read_prov():
    path = os.path.join(GEN, 'provenance.json')
    return json.load(open(path)) if os.path.exists(path) else {}


def write_prov(prov):
    os.makedirs(GEN, exist_ok=True)
    prov.update({'generator': GENERATOR, 'catalogVersion': _CAT['version'], 'spec': 'docs/art/soul-faces.md',
                 'license': 'internal original; traced from the partner-supplied sheets docs/art/reference/soul-{faces,eyes}-reference.png'})
    prov['files'] = dict(sorted(prov.get('files', {}).items()))
    with open(os.path.join(GEN, 'provenance.json'), 'w') as fh:
        json.dump(prov, fh, indent=2)
        fh.write('\n')


def source_hashes():
    rels = [GENERATOR, 'tools/ai/blender/soul_decor.py', 'tools/ai/blender/soul_baseline.py', 'tools/ai/blender/soul_baseline_splats.json',
            'packages/game-rules/src/soul-catalog.js', 'assets-src/soul-face/plates.json', 'tools/assets/build-soul-shape.py']
    return {r: sd.sha256_file(os.path.join(ROOT, r)) for r in rels}


def body_glb(verts, normals, tris, mask, meta):
    """The baseline GLB format (soul_baseline.write_glb) for the v3 body: int16 POSITION, int8 NORMAL, uint8 COLOR_0 mask."""
    P = sd.blender_to_model(verts)
    N = sd.blender_to_model(normals)
    pos, q, centre, half = sd.quantise(P)
    col = np.round(np.clip(mask, 0, 1) * 255).astype(np.uint8)
    big = len(P) >= 65536
    idx = tris.astype(np.uint32 if big else np.uint16).ravel()
    gl = {'asset': {'version': '2.0', 'generator': 'ariskill ' + GENERATOR, 'extras': meta},
          'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
          'scene': 0, 'scenes': [{'nodes': [0]}],
          'nodes': [{'name': 'ariseSoulV3', 'mesh': 0, 'translation': centre, 'scale': [half, half, half]}],
          'materials': [{'name': 'soul', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.4}}],
          'meshes': [{'name': 'ariseSoulV3', 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'COLOR_0': 2}, 'indices': 3, 'material': 0}]}],
          'accessors': [
              {'bufferView': 0, 'componentType': 5122, 'normalized': True, 'count': len(P), 'type': 'VEC3',
               'min': q.min(0).astype(int).tolist(), 'max': q.max(0).astype(int).tolist()},
              {'bufferView': 1, 'componentType': 5120, 'normalized': True, 'count': len(P), 'type': 'VEC3'},
              {'bufferView': 2, 'componentType': 5121, 'normalized': True, 'count': len(P), 'type': 'VEC4'},
              {'bufferView': 3, 'componentType': 5125 if big else 5123, 'count': int(idx.size), 'type': 'SCALAR'}]}
    return sd._glb_pack(gl, [(pos.tobytes(), 8, 34962), (sd.pack_normals(N).tobytes(), 4, 34962), (col.tobytes(), 4, 34962), (idx.tobytes(), None, 34963)])


def mode_body(B, args):
    """body-hero.glb / body-lite.glb: the v3 body level set, drips in mask R (G, B, A are 0), decimated like the baseline."""
    t0 = time.time()
    sd.new_scene()
    ob, verts, mask = sd.build_body(B, args.voxel, log_=log)
    mask[:, 1:] = 0.0
    ob.data.color_attributes['soul_mask'].data.foreach_set('color', mask.astype(np.float32).ravel())
    E = eye_surface(B)
    tc = [TOPPER['axis'][0], TOPPER['axis'][1], TOPPER['z']]
    landmarks = {'orb': {'centre': sd.to_model(tc), 'radius': TOPPER['size'] / 2},
                 'eyes': [{'side': 'left' if i == 0 else 'right', 'centre': sd.to_model(c), 'normal': sd.to_model(n), 'radius': FACE['eye_r']}
                          for i, (c, n) in enumerate(E)],
                 'height': BASE_HEIGHT, 'floor': BASE_FLOOR,
                 'badge_anchor': sd.to_model([sb.BASE['orb']['c'][0] + 0.30, sb.BASE['orb']['c'][1], 1.62]),
                 'topper': {'centre': sd.to_model(tc), 'size': TOPPER['size']}}
    meta = {'name': 'Arise Soul v3 body', 'version': 1, 'units': 'model units; 1.0 = 290 px of the reference', 'landmarks': landmarks,
            'mask': {'r': 'goo drips', 'g': 'unused (0)', 'b': 'unused (0)', 'a': 'unused (0)'},
            'front': '+Z', 'up': '+Y', 'source': GENERATOR, 'spec': 'docs/art/soul-faces.md'}
    os.makedirs(os.path.join(GEN, 'body'), exist_ok=True)
    for lod, target in BODY_TRIS.items():
        dup = sb.decimated_copy(ob, target, f'v3_{lod}')
        v, n, t, col = sb.mesh_arrays(dup.data)
        path = os.path.join(GEN, 'body', f'body-{lod}.glb')
        with open(path, 'wb') as fh:
            fh.write(body_glb(v, n, t, col, dict(meta, lod=lod, triangles=int(len(t)))))
        record(f'body/body-{lod}.glb', path, triangles=int(len(t)), vertices=int(len(v)))
        log(f'body {lod}: {len(t)} tris, {os.path.getsize(path)} bytes')
    log(f'body done in {time.time() - t0:.1f}s')


def crop_sprite(img, pad=2):
    """Crop an 800 px front render to its content (+pad px): (image, rect [x, y, w, h] in the 200 viewBox)."""
    ys, xs = np.nonzero(img[..., 3] > 1.0 / 255)
    if not len(xs):
        raise RuntimeError('empty sprite')
    x0, x1 = max(int(xs.min()) - pad, 0), min(int(xs.max()) + pad + 1, img.shape[1])
    y0, y1 = max(int(ys.min()) - pad, 0), min(int(ys.max()) + pad + 1, img.shape[0])
    k = 200.0 / SPRITE_PX
    return img[y0:y1, x0:x1], [round(x0 * k, 2), round(y0 * k, 2), round((x1 - x0) * k, 2), round((y1 - y0) * k, 2)]


def mode_sprites(B, args):
    """2D sprites: each plate / eyes / kit alone, orthographic over the 200 viewBox, the v3 body as a holdout (parts
    behind it are cut away; the angel's halo stays whole with the stage-12 soft glow), cropped to its content."""
    t0 = time.time()
    sd.new_scene()
    body, _, _ = sd.build_body(B, max(args.voxel, 0.004), log_=log)
    sb.eevee_setup(SPRITE_PX, SPRITE_PX)
    sd.front_ortho_camera(SPRITE_PX)
    body.is_holdout = True
    tmp = os.path.join(GEN, 'renders')
    os.makedirs(tmp, exist_ok=True)
    os.makedirs(os.path.join(GEN, 'sprites'), exist_ok=True)
    jobs = [('plates', f'plate-{p}') for p in PLATES] + [('eyes', f'eyes-{e}') for e in EYES] + [('kits', f'face-{f}') for f in FACES]
    for group, name in jobs:
        path = os.path.join(GEN, group, f'{name}.glb')
        obs = sd.place_kit(path, tag=name) if group == 'kits' else place_glb(path, name)
        angel = name == 'face-angel'
        body.hide_render = angel
        img = sd.render_rgba(os.path.join(tmp, f'sprite-{name}.png'))
        if angel:
            for o in obs:
                o.hide_render = 'halo' not in o.name
            halo = sd.render_rgba(os.path.join(tmp, 'sprite-halo.png'))[..., 3]
            g = np.clip(sd.soft_glow(halo, 9) * 0.75, 0, 1)
            warm = sd.hex_rgb(sd.KIT_COLOURS['halo']['emit'])
            a = img[..., 3:4]
            out_a = a + g[..., None] * (1 - a)
            img = np.concatenate([(img[..., :3] * a + warm * g[..., None] * (1 - a)) / np.maximum(out_a, 1e-6), out_a], 2)
        for o in obs:
            bpy.data.objects.remove(o)
        crop, rect = crop_sprite(img)
        out = os.path.join(GEN, 'sprites', f'{name}.png')
        n_, kind, _ = sd.save_png_small(out, sd.to_u8(crop))
        record(f'sprites/{name}.png', out, rect=rect, px=[int(crop.shape[1]), int(crop.shape[0])])
        log(f'sprite {name}: {crop.shape[1]}x{crop.shape[0]} px, {n_} bytes ({kind}), rect {rect}')
    body.hide_render = False
    log(f'sprites done in {time.time() - t0:.1f}s')


def mode_shape(B):
    """The v3 outline for the 2D renderer: the front scan of the v3 body (drips included) through
    tools/assets/build-soul-shape.py's contour and curve fitting, in the baseline MAPPING -> GEN/shape.json."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('build_soul_shape', os.path.join(ROOT, 'tools', 'assets', 'build-soul-shape.py'))
    bss = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bss)
    t0 = time.time()
    xs, ys, zs, g, _ = bss.scan(B.full)
    loops = bss.contours(g, xs, zs)
    loops.sort(key=lambda L: -abs(bss.signed_area(L)))

    def to_view(P):
        P = np.asarray(P, float)
        return np.stack([VIEW['cx'] + VIEW['scale'] * P[..., 0], VIEW['y0'] - VIEW['scale'] * P[..., 1]], axis=-1)
    sil = to_view(loops[0])
    if bss.signed_area(sil) < 0:
        sil = sil[::-1]
    path = bss.closed_path(bss.fit_closed(sil, bss.TOLERANCE))
    for L in loops[1:]:
        V = to_view(L)
        if abs(bss.signed_area(V)) < 4.0:
            continue
        if bss.signed_area(V) > 0:
            V = V[::-1]
        path += bss.closed_path(bss.fit_closed(V, bss.TOLERANCE))
    doc = {'silhouette': path, 'mapping': VIEW, 'tolerance': bss.TOLERANCE, 'top': round(float(sil[:, 1].min()), 2),
           'generator': f'{GENERATOR} --mode shape (tools/assets/build-soul-shape.py scan + fit)'}
    with open(os.path.join(GEN, 'shape.json'), 'w') as fh:
        json.dump(doc, fh, indent=2)
        fh.write('\n')
    log(f'shape: {len(path)} chars, top y {doc["top"]} in {time.time() - t0:.1f}s')


def asset_file(group, name):
    """The staged output, else the runtime copy (the staged PNGs are git-ignored), else None."""
    for p in (os.path.join(GEN, group, name), os.path.join(RUNTIME, name)):
        if os.path.exists(p):
            return p
    return None


def face_data():
    """The data module's object (docs/art/soul-faces.md "Data module")."""
    files = read_prov().get('files', {})
    shape = json.load(open(os.path.join(GEN, 'shape.json')))

    def url(group, name):
        p = asset_file(group, name)
        if not p:
            raise SystemExit(f'{group}/{name} is not built yet (npm run ai:soul-face)')
        return f'{RUNTIME_URL}{name}?v={sd.sha256_file(p)[:SHA_CHARS]}'

    def part(group, name):
        return {'glb': url(group, f'{name}.glb'), 'sprite': url('sprites', f'{name}.png'), 'rect': files[f'sprites/{name}.png']['rect']}
    slot = topper_slot()
    front2d = {'x': round(VIEW['cx'] + VIEW['scale'] * TOPPER['axis'][0], 2), 'y': round(VIEW['y0'] - VIEW['scale'] * TOPPER['z'], 2),
               'r': round(VIEW['scale'] * TOPPER['size'] / 2, 2)}
    return sd._clean({
        'stub': False, 'version': 1, 'catalogVersion': _CAT['version'],
        'generator': f'{GENERATOR} --mode data (npm run ai:soul-face)',
        'frame': 'glTF model space of the baseline GLBs: +Y up, +Z front, model units, feet at y = floor',
        'floor': BASE_FLOOR, 'height': BASE_HEIGHT,
        'body': {lod: url('body', f'body-{lod}.glb') for lod in BODY_TRIS},
        'plates': {p: part('plates', f'plate-{p}') for p in PLATES},
        'eyes': {e: part('eyes', f'eyes-{e}') for e in EYES},
        'faces': {f: part('kits', f'face-{f}') for f in FACES},
        'topper': dict({k: slot[k] for k in ('centre', 'normal', 'up', 'size', 'sink')}, front2d=front2d),
        'shape': {'silhouette': shape['silhouette']},
        'source': {'generator': GENERATOR, 'sha256': source_hashes()},
    })


def data_module_text():
    body = json.dumps(face_data(), indent=2, ensure_ascii=True)
    head = [
        '// GENERATED FILE - do not hand-edit. Regenerate with: npm run ai:soul-face (tools/ai/blender/soul_face.py --mode data).',
        '// Stage 13 (D-31, docs/art/soul-faces.md): the v3 body, the 10 face plates, the 10 eye designs, the refitted face kits,',
        '// the antenna-charm slot and the v3 2D outline. Frozen data, no imports: Node and browsers. Every URL carries',
        '// ?v=<sha256 prefix> of its file. Plates, eyes and kits are model-space GLBs placed at identity; their sprites are drawn',
        '// at rect [x, y, w, h] of the 200 viewBox. topper is a charm slot: charmPlacement(topper, SOUL_DECOR.charm.thickness)',
        '// in 3D, the charm PNG 2 r wide centred on topper.front2d in 2D. shape.silhouette is the v3 body outline (MAPPING of',
        '// soul-baseline-shape.js).',
    ]
    return ('\n'.join(head) + "\n\nfunction deepFreeze(o) {\n  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); "
            "for (const k of Object.keys(o)) deepFreeze(o[k]); }\n  return o;\n}\n\nexport const SOUL_FACE = deepFreeze(" + body + ');\n\nexport default SOUL_FACE;\n')


def mode_data(args):
    text = data_module_text()
    if args.check:
        cur = open(DATA_JS, encoding='utf8').read() if os.path.exists(DATA_JS) else ''
        if cur != text:
            raise SystemExit(f'STALE: {os.path.relpath(DATA_JS, ROOT)} differs from a fresh generation (npm run ai:soul-face -- --mode data)')
        log('data module is current')
        return
    with open(DATA_JS, 'w', encoding='utf8') as fh:
        fh.write(text)
    log(f'data: wrote {os.path.relpath(DATA_JS, ROOT)} ({len(text.encode())} bytes)')


# ================================================================================================ main
def parse(argv):
    ap = argparse.ArgumentParser(description='Soul faces v3 (D-31): plates, eyes, kits, v3 body, sprites, 2D outline, data module')
    ap.add_argument('--mode', default='produce', choices=['trace', 'preview', 'parts', 'body', 'sprites', 'shape', 'data', 'renders', 'produce'])
    ap.add_argument('--out', default=None)
    ap.add_argument('--voxel', type=float, default=0.003)
    ap.add_argument('--check', action='store_true', help='data: exit 1 when the checked-in module is stale')
    ap.add_argument('--configs', default=None, help='renders: JSON list of example configs (plate, eyes, face, charms, topper, gradient)')
    ap.add_argument('--only', default=None, help='renders: plates,eyes,examples')
    ap.add_argument('--hero', type=int, default=0, help='renders: which example also renders large')
    ap.add_argument('--rebuild', action='store_true', help='renders: rebuild every GLB')
    return ap.parse_args(argv)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    args = parse(argv)
    t0 = time.time()
    if args.mode == 'trace':
        trace_plates()
    elif args.mode == 'preview':
        mode_preview(args)
    elif args.mode == 'data':
        mode_data(args)
    elif args.mode == 'renders':
        mode_renders(args)
    else:
        if bpy is None and args.mode != 'shape':
            raise SystemExit(f'--mode {args.mode} runs inside Blender (npm run ai:soul-face -- --mode {args.mode})')
        B = BodyV3(log)
        if args.mode in ('parts', 'produce'):
            build_all(B, fit_plates(), rebuild=True)
        if args.mode in ('body', 'produce'):
            mode_body(B, args)
        if args.mode in ('sprites', 'produce'):
            mode_sprites(B, args)
        if args.mode in ('shape', 'produce'):
            mode_shape(B)
        if args.mode == 'produce':
            args.check = False
            mode_data(args)
            args.rebuild = False
            mode_renders(args)
    log(f'{args.mode} done in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
