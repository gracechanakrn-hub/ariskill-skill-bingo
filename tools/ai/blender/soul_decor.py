#!/usr/bin/env python3
"""tools/ai/blender/soul_decor.py - Soul decorations (stage 12, D-29, docs/art/soul-decorations.md).

Builds everything the renderers need to decorate the approved baseline Soul (D-27, soul_baseline.py, imported for its
functions only; its shape never changes here):
  stars    the 50 procedural star icons (10 shapes x 5 shades of packages/game-rules/src/soul-catalog.js) in the
           sticker style of the Gemini icons: bold plum outline, two-tone cel shading, small upper-left highlight,
           thick white die-cut rim -> assets-src/charms/icons/core-<shape>-<shade>.png (256 x 256 RGBA)
  charms   icon PNG -> puffy 3D sticker charm: alpha -> 2D signed distance -> pillow height profile -> OpenVDB level
           set -> decimated closed mesh with planar UVs (the icon on the front, the white rim wrapping the sides),
           written as a quantised GLB whose material points at <id>.png by relative URI, plus the re-framed 128 px PNG
           that is both its texture and the flat 2D charm
  faces    the three face kits (nerdy glasses, pirate patch + strap + bandana, angel halo + blush) as SDF shells and
           tubes on the body, in model space: face-<face>.glb + face-<face>-front.png (800 x 800 front sprite)
  slots    the 10 fixed charm slots on the front of the body (centre, normal, up, size, sink, front2d)
  renders  review sheets (Eevee, the D-27 colour-render look) -> reports/qa/screens/decor-*.png
  data     packages/ui/soul-decor-data.js (generated, deterministic, checked in)

Frames. Blender: Z up, the character faces -Y, its left is +X (soul_baseline.py). Model space = the glTF scene space of
the baseline GLBs = Blender (x, z, -y): +Y up, +Z front. A charm's local frame: origin at the centre of its back
face, +Z front, +Y icon up, outline (die-cut) diameter 1.0; a slot places it with basis (x = up x normal, y = up,
z = normal) at centre - normal * sink * thickness * size, scaled by size.

Run inside Blender 5.2 (bundled numpy + openvdb; no PIL there):
  Blender --background --factory-startup --python tools/ai/blender/soul_decor.py -- --mode produce
  ... -- --mode charms --kind technical          rebuild one kind (or --only id,id)
  ... -- --mode data --check                     exit 1 when packages/ui/soul-decor-data.js is stale
The pure section (catalog, stars, gradient maths, slot solver, GLB/PNG writers, data module) also runs in plain
python3 + numpy (tools/ai/test/soul-decor.test.js); `--mode stars`, `--mode slots` and `--mode data` work there too.
"""
import argparse
import hashlib
import json
import math
import os
import struct
import sys
import time
import zlib

import numpy as np

try:
    import bpy  # type: ignore
    from mathutils import Vector  # type: ignore
except ImportError:  # the pure section runs in plain python3 (numpy only)
    bpy = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # no __pycache__ next to the checked-in sources
import soul_baseline as sb  # noqa: E402  (the approved model; importing it defines functions only)

CATALOG_PATH = os.path.join(ROOT, 'packages', 'game-rules', 'src', 'soul-catalog.js')
ICON_DIR = os.path.join(ROOT, 'assets-src', 'charms', 'icons')
GEN_DIR = os.path.join(ROOT, 'assets-src', 'generated', 'soul-decor', 'v1')
DATA_JS = os.path.join(ROOT, 'packages', 'ui', 'soul-decor-data.js')
QA_DIR = os.path.join(ROOT, 'reports', 'qa', 'screens')
GENERATOR = 'tools/ai/blender/soul_decor.py'
RUNTIME_URL = {'charms': '/assets/souls/charms/', 'faces': '/assets/souls/faces/'}

PLUM = '#2B2350'          # icon outline ink (the Gemini icons use the same)
RIM_WHITE = '#FFFFFF'     # die-cut rim


def log(*a):
    print('[soul-decor]', *a, flush=True)


# ------------------------------------------------------------------------------------------------ catalog
def read_catalog(path=CATALOG_PATH):
    """The strict-JSON block between the markers of soul-catalog.js (the module is never edited here)."""
    txt = open(path, encoding='utf8').read()
    a = txt.index('// BEGIN SOUL_CATALOG_JSON')
    b = txt.index('// END SOUL_CATALOG_JSON')
    blk = txt[a:b]
    return json.loads(blk[blk.index('{'):blk.rindex('}') + 1])


def sha256_file(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


# ------------------------------------------------------------------------------------------------ colour
def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def srgb_to_linear(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ------------------------------------------------------------------------------------------------ png io
def png_bytes(img):
    """Deterministic PNG (8-bit RGBA or RGB) with per-row adaptive filtering (min sum of |signed bytes|)."""
    img = np.ascontiguousarray(img, dtype=np.uint8)
    H, W, C = img.shape
    x = img.reshape(H, W * C).astype(np.int16)
    up = np.vstack([np.zeros((1, W * C), np.int16), x[:-1]])
    left = np.hstack([np.zeros((H, C), np.int16), x[:, :-C]])
    ul = np.hstack([np.zeros((H, C), np.int16), up[:, :-C]])
    p = left + up - ul
    pa, pb, pc = np.abs(p - left), np.abs(p - up), np.abs(p - ul)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    cands = np.stack([x, x - left, x - up, x - ((left + up) >> 1), x - paeth]) & 255
    cost = np.where(cands > 127, 256 - cands, cands).sum(axis=2)
    best = np.argmin(cost, axis=0)
    rows = cands[best, np.arange(H)].astype(np.uint8)
    raw = np.hstack([best.astype(np.uint8)[:, None], rows]).tobytes()

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ctype = {4: 6, 3: 2}[C]
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, ctype, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def save_png(path, img):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    data = png_bytes(img)
    with open(path, 'wb') as fh:
        fh.write(data)
    return len(data)


def quantise_rgba(img, n=256, iters=6):
    """Deterministic palette for an RGBA uint8 image: exact when it has <= n colours, else a weighted median cut
    refined by k-means in premultiplied space. Returns (palette (k, 4) uint8, indices (H, W) uint8). Fully transparent
    pixels share one white entry."""
    H, W, _ = img.shape
    px = img.reshape(-1, 4).astype(np.int64)
    clear = px[:, 3] == 0
    uniq, inv, counts = np.unique(px[~clear], axis=0, return_inverse=True, return_counts=True)
    inv = inv.ravel()

    def feat(c):
        c = np.asarray(c, float)
        a = c[:, 3:4] / 255.0
        return np.hstack([c[:, :3] * a, c[:, 3:4] * 1.5])
    if len(uniq) <= n - 1:
        pal = uniq
        lab = np.arange(len(uniq))
    else:
        f = feat(uniq)
        boxes = [np.arange(len(uniq))]
        while len(boxes) < n - 1:
            score = [(np.ptp(f[b], axis=0).max() * np.sqrt(counts[b].sum())) if len(b) > 1 else -1 for b in boxes]
            j = int(np.argmax(score))
            if score[j] <= 0:
                break
            b = boxes.pop(j)
            ax = int(np.argmax(np.ptp(f[b], axis=0)))
            o = b[np.argsort(f[b, ax], kind='stable')]
            cw = np.cumsum(counts[o])
            k = int(np.clip(np.searchsorted(cw, cw[-1] / 2), 1, len(o) - 1))
            boxes += [o[:k], o[k:]]
        cent = np.array([(f[b] * counts[b, None]).sum(0) / counts[b].sum() for b in boxes])
        for _ in range(iters):
            d = ((f[:, None, :] - cent[None]) ** 2).sum(-1)
            lab = np.argmin(d, axis=1)
            w = np.bincount(lab, weights=counts, minlength=len(cent))
            for ch in range(4):
                s_ = np.bincount(lab, weights=counts * f[:, ch], minlength=len(cent))
                cent[:, ch] = np.where(w > 0, s_ / np.maximum(w, 1e-9), cent[:, ch])
        d = ((f[:, None, :] - cent[None]) ** 2).sum(-1)
        lab = np.argmin(d, axis=1)
        pal = np.zeros((len(cent), 4), np.int64)
        for j in range(len(cent)):
            m = lab == j
            if m.any():
                pal[j] = np.round((uniq[m] * counts[m, None]).sum(0) / counts[m].sum())
    pal = np.vstack([[255, 255, 255, 0], np.clip(pal, 0, 255)]).astype(np.uint8)
    idx = np.zeros(len(px), np.int64)
    idx[~clear] = lab[inv] + 1
    return pal, idx.reshape(H, W).astype(np.uint8)


def png_indexed_bytes(pal, idx):
    """8-bit palette PNG (PLTE + tRNS), per-row adaptive filtering like png_bytes."""
    H, W = idx.shape
    x = idx.astype(np.int16)
    up = np.vstack([np.zeros((1, W), np.int16), x[:-1]])
    left = np.hstack([np.zeros((H, 1), np.int16), x[:, :-1]])
    ul = np.hstack([np.zeros((H, 1), np.int16), up[:, :-1]])
    p = left + up - ul
    pa, pb, pc = np.abs(p - left), np.abs(p - up), np.abs(p - ul)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    cands = np.stack([x, x - left, x - up, x - ((left + up) >> 1), x - paeth]) & 255
    cost = np.where(cands > 127, 256 - cands, cands).sum(axis=2)
    best = np.argmin(cost, axis=0)
    rows = cands[best, np.arange(H)].astype(np.uint8)
    raw = np.hstack([best.astype(np.uint8)[:, None], rows]).tobytes()

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    trns = pal[:, 3].tobytes()
    last = len(trns.rstrip(b'\xff'))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 3, 0, 0, 0)) + chunk(b'PLTE', pal[:, :3].tobytes())
            + (chunk(b'tRNS', trns[:last]) if last else b'') + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def save_png_small(path, img):
    """The smaller of truecolour RGBA and a 256-colour palette PNG. The palette one is used only when it is visually
    lossless on the premultiplied colour: mean error <= 1.5 / 255 and 99.9th percentile <= 12 / 255 (cel-shaded sticker
    art has few colours; halves the bytes). Returns (bytes, kind, p99.9 error)."""
    img = np.ascontiguousarray(img, np.uint8)
    full = png_bytes(img)
    pal, idx = quantise_rgba(img)
    q = pal[idx].astype(float)
    a0, a1 = img[..., 3:4] / 255.0, q[..., 3:4] / 255.0
    e = np.abs(np.concatenate([img[..., :3] * a0, img[..., 3:4]], 2) - np.concatenate([q[..., :3] * a1, q[..., 3:4]], 2)).max(2)
    err = float(np.percentile(e, 99.9))
    small = png_indexed_bytes(pal, idx) if (e.mean() <= 1.5 and err <= 12.0) else None
    data, kind = (small, 'palette') if small is not None and len(small) < len(full) else (full, 'rgba')
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(data)
    return len(data), kind, err


def to_u8(rgba_float):
    return np.round(np.clip(rgba_float, 0.0, 1.0) * 255.0).astype(np.uint8)


# ------------------------------------------------------------------------------------------------ 2D shapes (stars)
def sd_polygon(P, V):
    """Exact signed distance (negative inside) from points P (N, 2) to the closed polygon V (M, 2) (iq's sdPolygon)."""
    px, py = P[:, 0], P[:, 1]
    d = np.full(len(P), np.inf)
    s = np.ones(len(P))
    n = len(V)
    for i in range(n):
        ax, ay = V[i]
        bx, by = V[i - 1]
        ex, ey = bx - ax, by - ay
        wx, wy = px - ax, py - ay
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey), 0.0, 1.0)
        qx, qy = wx - ex * t, wy - ey * t
        d = np.minimum(d, qx * qx + qy * qy)
        c1 = py >= ay
        c2 = py < by
        c3 = ex * wy > ey * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)


def fillet(V, radii, k=10):
    """Closed polygon with every corner replaced by a tangent arc of its radius (convex and concave corners)."""
    V = np.asarray(V, float)
    n = len(V)
    radii = np.broadcast_to(np.asarray(radii, float), (n,))
    out = []
    for i in range(n):
        A, B, C = V[i - 1], V[i], V[(i + 1) % n]
        u = (A - B) / np.linalg.norm(A - B)
        v = (C - B) / np.linalg.norm(C - B)
        th = math.acos(float(np.clip(u @ v, -1.0, 1.0)))
        r = float(radii[i])
        if r <= 0 or th < 1e-3 or th > math.pi - 1e-3:
            out.append(B)
            continue
        t = r / math.tan(th / 2)
        t = min(t, 0.49 * np.linalg.norm(A - B), 0.49 * np.linalg.norm(C - B))
        r = t * math.tan(th / 2)
        bis = (u + v) / np.linalg.norm(u + v)
        O = B + bis * (r / math.sin(th / 2))
        P1, P2 = B + u * t, B + v * t
        a1 = math.atan2(P1[1] - O[1], P1[0] - O[0])
        a2 = math.atan2(P2[1] - O[1], P2[0] - O[0])
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        for j in range(k + 1):
            a = a1 + da * j / k
            out.append(O + r * np.array([math.cos(a), math.sin(a)]))
    return np.array(out)


def star_poly(n, r_out, r_in, rot=90.0, centre=(0.0, 0.0)):
    """Star polygon (counter-clockwise), first tip at `rot` degrees (90 = pointing up)."""
    pts = []
    for i in range(2 * n):
        a = math.radians(rot) + math.pi * i / n
        r = r_out if i % 2 == 0 else r_in
        pts.append((centre[0] + r * math.cos(a), centre[1] + r * math.sin(a)))
    return np.array(pts)


def rounded_star(n, r_out, r_in, tip, valley, rot=90.0, centre=(0.0, 0.0), k=10):
    return fillet(star_poly(n, r_out, r_in, rot, centre), [tip, valley] * n, k)


def swirl(V, k, r_ref):
    """Pinwheel twist: each point turns by k * (rho / r_ref)^2 radians."""
    rho = np.hypot(V[:, 0], V[:, 1])
    a = np.arctan2(V[:, 1], V[:, 0]) + k * (rho / r_ref) ** 2
    return np.stack([rho * np.cos(a), rho * np.sin(a)], axis=1)


def superellipse(a, b, p, count=480, rot=0.0):
    t = np.linspace(0, 2 * math.pi, count, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    x = a * np.sign(c) * np.abs(c) ** (2.0 / p)
    y = b * np.sign(s) * np.abs(s) ** (2.0 / p)
    r = math.radians(rot)
    return np.stack([x * math.cos(r) - y * math.sin(r), x * math.sin(r) + y * math.cos(r)], axis=1)


def ellipse_poly(cx, cy, a, b, rot_deg, count=160):
    t = np.linspace(0, 2 * math.pi, count, endpoint=False)
    r = math.radians(rot_deg)
    x, y = a * np.cos(t), b * np.sin(t)
    return np.stack([cx + x * math.cos(r) - y * math.sin(r), cy + x * math.sin(r) + y * math.cos(r)], axis=1)


def tail_poly(p0, p1, bend, w0, w1, count=48):
    """Tapered comet tail along a circular arc from p0 (wide, width w0) to p1 (narrow, w1), round tip."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    s = np.linspace(0.0, 1.0, count)
    mid = (p0 + p1) / 2
    nrm = np.array([-(p1 - p0)[1], (p1 - p0)[0]]) / np.linalg.norm(p1 - p0)
    ctrl = mid + nrm * bend
    c = ((1 - s) ** 2)[:, None] * p0 + (2 * (1 - s) * s)[:, None] * ctrl + (s ** 2)[:, None] * p1
    tang = np.gradient(c, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    n = np.stack([-tang[:, 1], tang[:, 0]], axis=1)
    w = (w0 + (w1 - w0) * s ** 0.9) / 2
    left, right = c + n * w[:, None], c - n * w[:, None]
    tip = [c[-1] + w[-1] * np.array([math.cos(a), math.sin(a)])
           for a in np.linspace(math.atan2(n[-1, 1], n[-1, 0]), math.atan2(n[-1, 1], n[-1, 0]) - math.pi, 9)[1:-1]]
    return np.vstack([left, np.array(tip), right[::-1]])


# Star shapes in unit coordinates (y up, the icon centre at 0; the die-cut outline is fitted to ICON afterwards).
# Each shape is a list of parts drawn back to front: (name, kind, geometry, shaded, highlight). 'clip' parts are only
# drawn inside the previous part (the front half of the orbit ring crossing the star).
def star_parts(shape):
    if shape == 'classic':
        return [('star', rounded_star(5, 1.0, 0.47, 0.10, 0.05), (-0.30, 0.20, 0.17, 0.075, 35))]
    if shape == 'chubby':
        return [('star', rounded_star(5, 1.0, 0.64, 0.25, 0.12), (-0.33, 0.22, 0.17, 0.08, 35))]
    if shape == 'sparkle':
        V = superellipse(0.84, 1.0, 0.62)
        return [('star', V, (-0.20, 0.25, 0.14, 0.06, 55))]
    if shape == 'six':
        return [('star', rounded_star(6, 1.0, 0.56, 0.10, 0.05), (-0.30, 0.22, 0.17, 0.075, 40))]
    if shape == 'burst':
        return [('star', rounded_star(8, 1.0, 0.74, 0.08, 0.05, rot=90.0 + 22.5 / 1.0), (-0.36, 0.24, 0.18, 0.08, 40))]
    if shape == 'shooting':
        st = rounded_star(5, 0.62, 0.30, 0.07, 0.04, rot=90.0 + 8, centre=(0.33, 0.30))
        tail = tail_poly((0.30, 0.26), (-0.98, -0.80), -0.20, 0.74, 0.11)
        return [('tail', tail, None), ('star', st, (0.14, 0.44, 0.10, 0.05, 30))]
    if shape == 'ringed':
        st = rounded_star(5, 0.80, 0.39, 0.09, 0.05, centre=(0.0, 0.05))
        ring_o = ellipse_poly(0.0, -0.06, 1.0, 0.35, 18, 200)
        ring_i = ellipse_poly(0.0, -0.06, 0.80, 0.18, 18, 200)
        return [('ring', (ring_o, ring_i), None), ('star', st, (-0.24, 0.20, 0.14, 0.06, 35)),
                ('ring-front', (ring_o, ring_i), None)]
    if shape == 'twin':
        big = rounded_star(5, 0.82, 0.40, 0.10, 0.05, rot=90.0 - 6, centre=(-0.20, -0.16))
        small = rounded_star(5, 0.44, 0.21, 0.07, 0.035, rot=90.0 + 14, centre=(0.55, 0.52))
        return [('star', big, (-0.44, 0.02, 0.14, 0.065, 35)), ('star', small, (0.47, 0.60, 0.07, 0.035, 40))]
    if shape == 'pinwheel':
        V = swirl(rounded_star(5, 1.0, 0.46, 0.13, 0.05, k=14), 0.95, 1.0)
        return [('star', V, (-0.20, 0.28, 0.14, 0.065, 10))]
    if shape == 'soft7':
        return [('star', rounded_star(7, 1.0, 0.64, 0.17, 0.09), (-0.32, 0.24, 0.17, 0.08, 40))]
    raise KeyError(shape)


def convex_hull(P):
    """Monotone chain; returns the hull vertices counter-clockwise."""
    pts = sorted(set(map(tuple, np.round(np.asarray(P, float), 9))))
    if len(pts) < 3:
        return np.array(pts)

    def half(seq):
        h = []
        for p in seq:
            while len(h) >= 2 and ((h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0])) <= 0:
                h.pop()
            h.append(p)
        return h
    lo, hi = half(pts), half(pts[::-1])
    return np.array(lo[:-1] + hi[:-1])


def min_enclosing_circle(P):
    """Smallest circle around the points (Welzl, iterative, on the convex hull; deterministic order)."""
    H = convex_hull(P)
    rng = np.random.default_rng(20260924)
    H = H[rng.permutation(len(H))]
    eps = 1e-9

    def circ2(a, b):
        c = (a + b) / 2
        return c, float(np.linalg.norm(a - c))

    def circ3(a, b, c):
        d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
        if abs(d) < 1e-12:
            best = max((circ2(a, b), circ2(a, c), circ2(b, c)), key=lambda t: t[1])
            return best
        ux = ((a @ a) * (b[1] - c[1]) + (b @ b) * (c[1] - a[1]) + (c @ c) * (a[1] - b[1])) / d
        uy = ((a @ a) * (c[0] - b[0]) + (b @ b) * (a[0] - c[0]) + (c @ c) * (b[0] - a[0])) / d
        o = np.array([ux, uy])
        return o, float(np.linalg.norm(a - o))
    c, r = H[0].copy(), 0.0
    for i in range(1, len(H)):
        if np.linalg.norm(H[i] - c) > r + eps:
            c, r = H[i].copy(), 0.0
            for j in range(i):
                if np.linalg.norm(H[j] - c) > r + eps:
                    c, r = circ2(H[i], H[j])
                    for k in range(j):
                        if np.linalg.norm(H[k] - c) > r + eps:
                            c, r = circ3(H[i], H[j], H[k])
    return c, r


def iso_segments(V, level, xs, ys):
    """Marching squares as a segment soup: V (nx, ny) sampled at xs x ys; returns (S, 2, 2) segment end points."""
    a = V[:-1, :-1] - level
    b = V[1:, :-1] - level
    c = V[1:, 1:] - level
    d = V[:-1, 1:] - level
    X0, X1 = xs[:-1][:, None], xs[1:][:, None]
    Y0, Y1 = ys[:-1][None, :], ys[1:][None, :]
    shape = a.shape
    edges = []  # per edge: (crossing mask, x, y)
    for p, q, xa, ya, xb, yb in ((a, b, X0, Y0, X1, Y0), (b, c, X1, Y0, X1, Y1), (d, c, X0, Y1, X1, Y1), (a, d, X0, Y0, X0, Y1)):
        m = (p < 0) != (q < 0)
        t = np.where(m, p / np.where(m, p - q, 1.0), 0.0)
        edges.append((m, np.broadcast_to(xa + (xb - xa) * t, shape), np.broadcast_to(ya + (yb - ya) * t, shape)))
    cnt = sum(e[0].astype(int) for e in edges)
    segs = []
    two = cnt == 2
    if two.any():
        pts = []
        for m, x, y in edges:
            pts.append((m & two, x, y))
        # the first and the second crossing of each 2-crossing cell
        first = np.full(shape, -1)
        for k, (m, _, _) in enumerate(pts):
            first = np.where(m & (first < 0), k, first)
        second = np.full(shape, -1)
        for k, (m, _, _) in enumerate(pts):
            second = np.where(m & (k != first) & (second < 0), k, second)
        ii, jj = np.nonzero(two)
        ex = np.stack([e[1] for e in edges])
        ey = np.stack([e[2] for e in edges])
        f, s = first[ii, jj], second[ii, jj]
        segs.append(np.stack([np.stack([ex[f, ii, jj], ey[f, ii, jj]], 1), np.stack([ex[s, ii, jj], ey[s, ii, jj]], 1)], 1))
    four = cnt == 4
    if four.any():
        ii, jj = np.nonzero(four)
        ex = np.stack([e[1] for e in edges])
        ey = np.stack([e[2] for e in edges])
        for p_, q_ in ((0, 3), (1, 2)):
            segs.append(np.stack([np.stack([ex[p_, ii, jj], ey[p_, ii, jj]], 1), np.stack([ex[q_, ii, jj], ey[q_, ii, jj]], 1)], 1))
    return np.concatenate(segs) if segs else np.zeros((0, 2, 2))


def dist_to_segments(P, S, chunk=4096):
    """Unsigned distance from points P (N, 2) to the nearest segment of S (M, 2, 2)."""
    out = np.full(len(P), np.inf)
    if not len(S):
        return out
    A = S[:, 0]
    E = S[:, 1] - S[:, 0]
    L2 = np.maximum((E * E).sum(1), 1e-18)
    for i in range(0, len(P), chunk):
        p = P[i:i + chunk]
        wx = p[:, None, 0] - A[None, :, 0]
        wy = p[:, None, 1] - A[None, :, 1]
        t = np.clip((wx * E[None, :, 0] + wy * E[None, :, 1]) / L2[None], 0.0, 1.0)
        dx = wx - E[None, :, 0] * t
        dy = wy - E[None, :, 1] * t
        out[i:i + chunk] = np.sqrt((dx * dx + dy * dy).min(1))
    return out


# Icon layout (px of the 256 icon), measured on the Gemini icons (tools/ai/gemini-charms.js: 6 % padding, so the
# die-cut spans ~227 px; ~12 px white rim; ~5 px plum outline) so stars and tools read as one sticker family. `cut` is
# the radius of the die-cut's smallest enclosing circle, `close` rounds the valleys of the die-cut between star arms.
ICON = {'size': 256, 'ss': 2, 'cut': 114.0, 'rim': 12.0, 'outline': 5.5, 'close': 10.0}


def _over(P, A, rgb, a):
    """Premultiplied 'over' of a flat colour with coverage a (H, W)."""
    a = a[..., None]
    return P * (1 - a) + rgb[None, None, :] * a, A * (1 - a[..., 0]) + a[..., 0]


def draw_star_icon(shape, shade, layout=ICON):
    """One star icon: (256, 256, 4) uint8 RGBA, straight alpha, white under the transparent area."""
    N, ss = layout['size'], layout['ss']
    M = N * ss
    parts = star_parts(shape)
    # fit: the parts' minimum enclosing circle -> radius cut - outline/2 - rim (px), centred
    pts = []
    for _, geom, _ in parts:
        pts.append(np.vstack(geom) if isinstance(geom, tuple) else geom)
    c, r = min_enclosing_circle(np.vstack(pts))
    scale = (layout['cut'] - layout['outline'] / 2 - layout['rim']) / r

    def T(V):
        return (np.asarray(V, float) - c) * scale
    xs = (np.arange(M) + 0.5) / ss - N / 2          # px, x right
    ys = N / 2 - (np.arange(M) + 0.5) / ss          # px, y up (row 0 = top)
    X, Y = np.meshgrid(xs, ys)                      # (M rows, M cols)
    P = np.stack([X.ravel(), Y.ravel()], 1)

    def part_sdfs(Q):
        out = []
        for name, geom, hl in parts:
            if name.startswith('ring'):
                out.append(np.maximum(sd_polygon(Q, T(geom[0])), -sd_polygon(Q, T(geom[1]))))
            else:
                out.append(sd_polygon(Q, T(geom)))
        return out
    sdfs = [d.reshape(M, M) for d in part_sdfs(P)]
    solid = [i for i, (n_, _, _) in enumerate(parts) if n_ != 'ring-front']
    U = np.min([sdfs[i] for i in solid], axis=0)
    # die-cut: the union grown by outline/2 + rim + close, then shrunk by close (fills the valleys between arms). The
    # grown outline is traced on a padded 1x grid so it never runs off the canvas.
    o = layout['outline'] / 2 + layout['rim']
    cl = layout['close']
    pad = int(math.ceil(o + cl + 4))
    gx = np.arange(-N / 2 - pad, N / 2 + pad + 1, 1.0)
    GX, GY = np.meshgrid(gx, gx, indexing='ij')
    Q = np.stack([GX.ravel(), GY.ravel()], 1)
    Ug = np.min([d for i, d in enumerate(part_sdfs(Q)) if i in solid], axis=0).reshape(len(gx), len(gx))
    seg = iso_segments(Ug, o + cl, gx, gx)
    band = (U > o - 3) & (U < o + cl + 3)
    dist = np.full(U.shape, np.inf)
    bi = np.nonzero(band.ravel())[0]
    dist.ravel()[bi] = dist_to_segments(P[bi], seg)
    cut = np.where(U >= o + cl, cl + (U - (o + cl)), cl - dist)
    cut = np.where(U <= o - 3, -1e3, cut)
    cov = lambda d: np.clip(0.5 - d * ss, 0.0, 1.0)  # noqa: E731  (d in 1x px, coverage at the sample)
    Pm = np.zeros((M, M, 3))
    Am = np.zeros((M, M))
    Pm, Am = _over(Pm, Am, hex_rgb(RIM_WHITE), cov(cut))
    plum = hex_rgb(PLUM)
    fill, light, deep = hex_rgb(shade['fill']), hex_rgb(shade['light']), hex_rgb(shade['outline'])
    shadow = fill * 0.70 + deep * 0.30
    Lxy = np.array([-1.0, 1.0]) / math.sqrt(2.0)
    prev = None
    for (name, geom, hl), d in zip(parts, sdfs):
        clip = 1.0
        if name == 'ring-front':
            # the front half of the orbit ring, only where it crosses the star drawn before it
            clip = cov(prev - layout['outline'] / 2 - 0.5)
            ring_c = T(np.array([[0.0, -0.06]]))[0]
            rr = math.radians(18)
            yl = -(X - ring_c[0]) * math.sin(rr) + (Y - ring_c[1]) * math.cos(rr)
            clip = clip * np.clip(0.5 - yl * ss, 0.0, 1.0)
        gy, gx = np.gradient(-d, 1.0 / ss)
        gy = -gy                                       # rows run down; y is up
        facing = -(gx * Lxy[0] + gy * Lxy[1])
        tone = np.clip(0.5 + facing * 6.0, 0.0, 1.0)[..., None]
        col = shadow[None, None] * (1 - tone) + fill[None, None] * tone
        a_out = cov(d - layout['outline'] / 2) * clip
        a_fill = cov(d + layout['outline'] / 2) * clip
        Pm, Am = _over(Pm, Am, plum, a_out)
        a3 = a_fill[..., None]
        Pm, Am = Pm * (1 - a3) + col * a3, Am * (1 - a_fill) + a_fill
        if hl:
            hx, hy, hrx, hry, hrot = hl
            q = T(np.array([[hx, hy]]))[0]
            rx, ry = hrx * scale, hry * scale
            t = math.radians(hrot)
            u = ((X - q[0]) * math.cos(t) + (Y - q[1]) * math.sin(t)) / rx
            v = (-(X - q[0]) * math.sin(t) + (Y - q[1]) * math.cos(t)) / ry
            dh = (np.sqrt(u * u + v * v) - 1.0) * ry
            dot_c = q + np.array([math.cos(t + math.pi), math.sin(t + math.pi)]) * 0 + np.array([math.cos(t), math.sin(t)]) * (-1.75 * rx)
            dd = np.hypot(X - dot_c[0], Y - dot_c[1]) - 0.42 * ry
            a_h = np.maximum(cov(dh), cov(dd)) * cov(d + layout['outline'] / 2 + 2.0)
            Pm, Am = _over(Pm, Am, light, a_h)
        prev = d
    # box-filter the supersamples (premultiplied), then straight alpha with white under the transparent area
    Pd = Pm.reshape(N, ss, N, ss, 3).mean(axis=(1, 3))
    Ad = Am.reshape(N, ss, N, ss).mean(axis=(1, 3))
    rgb = np.where(Ad[..., None] > 1e-6, Pd / np.maximum(Ad[..., None], 1e-6), 1.0)
    rgb = np.where(Ad[..., None] < 1.0 / 255, 1.0, rgb)
    return to_u8(np.concatenate([rgb, Ad[..., None]], axis=2))


def star_icons(cat, only=None):
    """{charm id: RGBA uint8} for the core charms (catalog order)."""
    shades = {s['id']: s for s in cat['starShades']}
    out = {}
    cache = {}
    for ch in cat['charms']:
        if ch['kind'] != 'core' or (only and ch['id'] not in only):
            continue
        key = (ch['shape'], ch['shade'])
        cache[key] = draw_star_icon(ch['shape'], shades[ch['shade']])
        out[ch['id']] = cache[key]
    return out


def checker_sheet(tiles, cols, cell, pad=12, bg=(0.086, 0.106, 0.227), label_rows=None):
    """Compose RGBA tiles (uint8) over a dark sheet: (H, W, 3) uint8."""
    rows = (len(tiles) + cols - 1) // cols
    W = cols * (cell + pad) + pad
    H = rows * (cell + pad) + pad
    img = np.ones((H, W, 3)) * np.array(bg)
    for i, t in enumerate(tiles):
        r_, c_ = divmod(i, cols)
        y0, x0 = pad + r_ * (cell + pad), pad + c_ * (cell + pad)
        t = t.astype(float) / 255.0
        if t.shape[0] != cell:
            t = resample_rgba(t, cell)
        a = t[..., 3:4]
        img[y0:y0 + cell, x0:x0 + cell] = img[y0:y0 + cell, x0:x0 + cell] * (1 - a) + t[..., :3] * a
    return to_u8(img)


def resample_rgba(img, size):
    """Area-weighted resample of a float RGBA image (straight alpha) to size x size, premultiplied internally."""
    H, W = img.shape[:2]
    pre = np.concatenate([img[..., :3] * img[..., 3:4], img[..., 3:4]], axis=2)

    def axis_weights(n_in, n_out):
        Wm = np.zeros((n_out, n_in))
        s = n_in / n_out
        for o in range(n_out):
            a, b = o * s, (o + 1) * s
            for i in range(int(math.floor(a)), min(n_in, int(math.ceil(b)))):
                Wm[o, i] = max(0.0, min(b, i + 1) - max(a, i))
        return Wm / Wm.sum(1, keepdims=True)
    Wy, Wx = axis_weights(H, size), axis_weights(W, size)
    out = np.einsum('oh,hwc->owc', Wy, pre)
    out = np.einsum('pw,owc->opc', Wx, out)
    a = out[..., 3:4]
    rgb = np.where(a > 1e-6, out[..., :3] / np.maximum(a, 1e-6), 1.0)
    return np.concatenate([rgb, a], axis=2)


# ------------------------------------------------------------------------------------------------ charms (icon -> puffy sticker)
# Local frame (docs/art/soul-decorations.md): origin at the centre of the back face, +Z front, +Y icon up, die-cut
# outline diameter 1.0 (the smallest circle around the outline). The back is a shallow bowl (radius back_radius, in
# diameters) so the charm hugs the body's curvature; the front is a pillow: `edge` thick at the outline with a round
# edge (radius `round`), swelling to `thickness` within `bulge` of the outline. `thickness` (front height at the centre
# above the back's centre) is the unit of the slot's sink. The runtime PNG (texture and 2D sprite, 128 px) is the icon
# re-framed so the outline circle is the image's inscribed circle (`frame` 1.0): a sprite drawn 2 r wide at front2d is the
# charm at its true size. The planar UVs follow the same framing. The material keeps the icon's colours under the AgX
# studio look: the PNG is both baseColorTexture and emissiveTexture (x `emissive`).
CHARM = {'thickness': 0.30, 'edge': 0.18, 'round': 0.07, 'bulge': 0.22, 'back_radius': 2.6, 'voxel': 1.0 / 128,
         'tris': 900, 'png': 128, 'frame': 1.0, 'roughness': 0.45, 'emissive': 0.32}


def load_rgba(path):
    """(H, W, 4) float RGBA, straight alpha, row 0 = top. Blender's own PNG loader inside Blender, PIL elsewhere."""
    if bpy is not None:
        img = bpy.data.images.load(path, check_existing=False)
        img.colorspace_settings.name = 'Non-Color'  # raw byte values, no view transform
        W, H = img.size
        px = np.empty(W * H * 4, np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        return px.reshape(H, W, 4)[::-1].astype(np.float64)
    from PIL import Image  # plain python3 (tests)
    return np.asarray(Image.open(path).convert('RGBA')).astype(np.float64) / 255.0


def bilinear(img, x, y):
    """Sample img (H, W, C) at float pixel coordinates (x right, y down; pixel centres at +0.5), clamped."""
    H, W = img.shape[:2]
    fx = np.clip(x - 0.5, 0, W - 1)
    fy = np.clip(y - 0.5, 0, H - 1)
    x0 = np.floor(fx).astype(int)
    y0 = np.floor(fy).astype(int)
    x1, y1 = np.minimum(x0 + 1, W - 1), np.minimum(y0 + 1, H - 1)
    tx, ty = (fx - x0)[..., None], (fy - y0)[..., None]
    return ((img[y0, x0] * (1 - tx) + img[y0, x1] * tx) * (1 - ty) + (img[y1, x0] * (1 - tx) + img[y1, x1] * tx) * ty)


def largest_component(mask):
    """Keep the biggest 4-connected blob of a boolean image and fill its holes (the die-cut is one piece)."""
    H, W = mask.shape
    lab = np.zeros(mask.shape, np.int32)
    best, best_n, cur = 0, 0, 0
    for i0, j0 in zip(*np.nonzero(mask)):
        if lab[i0, j0]:
            continue
        cur += 1
        stack = [(i0, j0)]
        lab[i0, j0] = cur
        n = 0
        while stack:
            i, j = stack.pop()
            n += 1
            for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if 0 <= a < H and 0 <= b < W and mask[a, b] and not lab[a, b]:
                    lab[a, b] = cur
                    stack.append((a, b))
        if n > best_n:
            best, best_n = cur, n
    keep = lab == best
    # holes: background not connected to the border
    bg = ~keep
    seen = np.zeros(mask.shape, bool)
    stack = [(i, j) for i in (0, H - 1) for j in range(W) if bg[i, j]] + [(i, j) for j in (0, W - 1) for i in range(H) if bg[i, j]]
    for i, j in stack:
        seen[i, j] = True
    while stack:
        i, j = stack.pop()
        for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
            if 0 <= a < H and 0 <= b < W and bg[a, b] and not seen[a, b]:
                seen[a, b] = True
                stack.append((a, b))
    return ~seen


def icon_outline(icon):
    """Die-cut outline of an icon: segments (px, x right / y down) of alpha = 0.5 on the kept blob + its smallest
    enclosing circle (centre px, radius px)."""
    a = icon[..., 3]
    keep = largest_component(a >= 0.5)
    af = np.where(keep, np.maximum(a, 0.5), np.minimum(a, 0.4999))  # the kept blob only, holes filled
    H, W = a.shape
    xs = np.arange(W) + 0.5
    ys = np.arange(H) + 0.5
    seg = iso_segments(af.T, 0.5, xs, ys)  # af.T[i, j] = pixel (x = i, y = j)
    c, r = min_enclosing_circle(seg.reshape(-1, 2))
    return seg, c, r, af


def reframe_icon(icon, c, r, size, frame):
    """The icon resampled so the outline circle (centre c, radius r, px) is centred and spans `frame` of a
    size x size image; 4 x 4 supersampling, premultiplied. RGBA float, white under the transparent area."""
    ssn = 4
    k = (2 * r) / (frame * size)  # source px per output px
    o = (np.arange(size * ssn) + 0.5) / ssn - size / 2
    X, Y = np.meshgrid(c[0] + o * k, c[1] + o * k)
    pre = np.concatenate([icon[..., :3] * icon[..., 3:4], icon[..., 3:4]], axis=2)
    s = bilinear(pre, X, Y)
    s = s.reshape(size, ssn, size, ssn, 4).mean(axis=(1, 3))
    a = s[..., 3:4]
    rgb = np.where(a > 1e-4, s[..., :3] / np.maximum(a, 1e-4), 1.0)
    rgb = np.where(a < 1.0 / 255, 1.0, rgb)
    return np.concatenate([np.clip(rgb, 0, 1), a], axis=2)


def charm_sdf2d(seg, c, r, af, n, lim):
    """2D signed distance to the outline (local units, negative inside) on an n x n grid spanning [-lim, lim]^2.
    Local (x, y) = ((px - cx), (cy - py)) / (2 r): outline circle diameter 1, y up."""
    g = np.linspace(-lim, lim, n)
    X, Y = np.meshgrid(g, g, indexing='ij')           # [i, j] = (x_i, y_j)
    px = c[0] + X * 2 * r
    py = c[1] - Y * 2 * r
    P = np.stack([px.ravel(), py.ravel()], 1)
    d = dist_to_segments(P, seg).reshape(n, n) / (2 * r)
    inside = bilinear(af[..., None], px, py)[..., 0] >= 0.5
    return g, np.where(inside, -d, d)


def charm_field(d2, g, zs, p=CHARM):
    """Pillow level set (negative inside) on the grid g x g x zs from the 2D distance d2 (all local units)."""
    X = g[:, None, None]
    Y = g[None, :, None]
    Z = zs[None, None, :]
    Rb = p['back_radius']
    zb = -(Rb - np.sqrt(Rb * Rb - (X * X + Y * Y)))
    e = np.clip(-d2[:, :, None] / p['bulge'], 0.0, 1.0)
    t = p['edge'] + (p['thickness'] - p['edge']) * e * e * (3 - 2 * e)
    w = t / 2
    re = p['round']
    qx = d2[:, :, None] + re
    qy = np.abs(Z - (zb + w)) - w + re
    return np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - re


def charm_back_z(rho, p=CHARM):
    """z of the charm's back surface at radius rho (local units)."""
    Rb = p['back_radius']
    return -(Rb - np.sqrt(Rb * Rb - np.asarray(rho, float) ** 2))


# ------------------------------------------------------------------------------------------------ glb writing
def _glb_pack(gl, blobs):
    """Assemble a GLB from the JSON dict and a list of (bytes, stride or None, target) buffer views."""
    views, binbuf = [], b''
    for b, st, target in blobs:
        binbuf += b'\x00' * ((-len(binbuf)) % 4)
        v = {'buffer': 0, 'byteOffset': len(binbuf), 'byteLength': len(b)}
        if st:
            v['byteStride'] = st
        if target:
            v['target'] = target
        views.append(v)
        binbuf += b
    binbuf += b'\x00' * ((-len(binbuf)) % 4)
    gl['bufferViews'] = views
    gl['buffers'] = [{'byteLength': len(binbuf)}]
    js = json.dumps(gl, separators=(',', ':'), sort_keys=False).encode()
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binbuf)
    return struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binbuf), 0x004E4942) + binbuf


def quantise(P):
    """int16 positions (padded to 4) + the node translation/scale that dequantises them (uniform scale)."""
    lo, hi = P.min(0), P.max(0)
    centre = (lo + hi) / 2
    half = float(np.max(hi - lo) / 2) * 1.0001
    q = np.round((P - centre) / half * 32767).astype(np.int16)
    pos = np.zeros((len(q), 4), np.int16)
    pos[:, :3] = q
    return pos, q, [round(float(v), 7) for v in centre], round(half, 7)


def pack_normals(N):
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    nb = np.zeros((len(N), 4), np.int8)
    nb[:, :3] = np.round(N * 127).astype(np.int8)
    return nb


def charm_glb(verts, normals, uvs, tris, meta, image_uri, roughness=CHARM['roughness'], emissive=CHARM['emissive']):
    """Charm GLB bytes: KHR_mesh_quantization (int16 POSITION, int8 NORMAL, uint16 TEXCOORD_0), one primitive, the
    icon as an external baseColorTexture and emissiveTexture (relative URI: the page CSP blocks the blob: fetch that
    embedded images need)."""
    pos, q, centre, half = quantise(verts)
    nb = pack_normals(normals)
    uv = np.round(np.clip(uvs, 0, 1) * 65535).astype(np.uint16)
    idx = tris.astype(np.uint16).ravel()
    assert len(verts) < 65536
    gl = {
        'asset': {'version': '2.0', 'generator': 'ariskill ' + GENERATOR, 'extras': meta},
        'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': meta['id'], 'mesh': 0, 'translation': centre, 'scale': [half, half, half]}],
        'meshes': [{'name': meta['id'], 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': [{'name': 'charm', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0, 'texCoord': 0},
                                                                  'metallicFactor': 0.0, 'roughnessFactor': roughness},
                       'emissiveTexture': {'index': 0, 'texCoord': 0}, 'emissiveFactor': [emissive, emissive, emissive]}],
        'textures': [{'sampler': 0, 'source': 0}],
        'images': [{'uri': image_uri, 'mimeType': 'image/png'}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5122, 'normalized': True, 'count': len(verts), 'type': 'VEC3',
             'min': q.min(0).astype(int).tolist(), 'max': q.max(0).astype(int).tolist()},  # raw stored values (glTF 2.0)
            {'bufferView': 1, 'componentType': 5120, 'normalized': True, 'count': len(verts), 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5123, 'normalized': True, 'count': len(verts), 'type': 'VEC2'},
            {'bufferView': 3, 'componentType': 5123, 'count': int(idx.size), 'type': 'SCALAR'},
        ],
    }
    return _glb_pack(gl, [(pos.tobytes(), 8, 34962), (nb.tobytes(), 4, 34962), (uv.tobytes(), 4, 34962), (idx.tobytes(), None, 34963)])


def read_glb(path_or_bytes):
    """(json, bin) of a GLB (tests and checks)."""
    b = open(path_or_bytes, 'rb').read() if isinstance(path_or_bytes, str) else path_or_bytes
    jl = struct.unpack('<I', b[12:16])[0]
    gl = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack('<I', b[off:off + 4])[0]
    return gl, b[off + 8:off + 8 + bl]



# ------------------------------------------------------------------------------------------------ body frames
def to_model(v):
    """Blender (x, y, z) -> model / glTF space (x, z, -y), rounded to 5 decimals."""
    v = np.asarray(v, float)
    return [round(float(v[0]) + 0.0, 5), round(float(v[2]) + 0.0, 5), round(float(-v[1]) + 0.0, 5)]


def to_view(v):
    """Blender (x, z) -> the renderer's 200 viewBox (docs/art/soul-baseline.md "Flat 2D Soul")."""
    return 100.0 + 70.0 * float(v[0]), 178.6 - 70.0 * float(v[2])


class Body:
    """The approved model as fields: `body` (smooth goo: head, arms, belly, slits, feet, orb), `eyes` (dome + groove),
    `full` (+ the 25 reference and 18 back drips), the eye frames and the model floor (Blender z of the feet)."""

    def __init__(self, log_=lambda *a: None):
        self.body = sb.base_ops()
        self.eye_list = sb.eye_ops(self.body)
        self.eyes = sb.eye_frames(self.body)              # [(centre, normal, radius)] character's left (+X) first
        self.full = sb.model_ops(with_details=True, log=log_)
        self.smooth = self.body + self.eye_list
        self.floor = -0.02189                              # landmarks.floor of the baseline GLBs (Blender z)

    def f(self, P, which='body'):
        return sb.eval_ops_points(getattr(self, which), np.atleast_2d(P))




# ------------------------------------------------------------------------------------------------ slots
# One charm diameter everywhere (BR-17). Each charm sinks `sink` of its thickness into the goo, measured at its centre
# along the normal; with the bowl-shaped back the whole outline then sits below the goo surface (the goo wraps above the
# charm's widest point, so it reads as set into the body rather than stuck on it) while the white rim stays visible.
SLOT = {'size': 0.20, 'sink': 0.35, 'count': 10, 'top': 1.40, 'facing': 0.6, 'rest_facing': 0.4, 'rest_azimuth': 28.0,
        'gap': 0.012,                      # min clear gap between two charms (centre spacing >= size + gap)
        'sink_range': (0.22, 0.52),        # per-slot sink stays in this band of the charm thickness
        'embed_max': 0.010, 'rim_min': -0.035,   # seating tolerances x size (see seat_sink)
        # Front positions (Blender x, z) snapped onto the goo. Chosen by a max-min spacing search (0.02 grid) over the
        # admissible region: front-facing goo below the chin crease, clear of eyes / glasses / cheeks / slits / feet,
        # no drip under a charm face, and a rigid charm seats there with some sink in sink_range. 0.20 is the largest
        # size for which ten such charms still keep a gap (0.21 already touches). Rows top to bottom, viewer's left first:
        # chest, arms and upper belly, mid belly, lower belly.
        'layout': [(-0.04, 0.76), (0.26, 0.74), (-0.44, 0.62), (0.14, 0.64), (0.44, 0.58), (-0.14, 0.48), (0.08, 0.44),
                   (-0.20, 0.28), (0.00, 0.22), (0.20, 0.28)],
        # drips allowed under a charm (x size) at footprint radius 0 .. 0.33 / 0.42 / 0.5 (local): never through the icon
        # face; low drip edges may run under the rim, where the goo meets the charm anyway
        'drip_limits': (0.04, 0.055, 0.12)}


# Face-kit clearances for charms (model units, beyond the charm radius): from the eye centre, the eye radius + the
# glasses rim (just outside the groove) + margin; from the blush ellipse (under the eyes, toward the sides) a margin.
FACE_CLEAR = {'glasses': 0.075, 'blush': 0.02}
SLIT_TOP = 0.45  # Blender z where the arm slits close (docs/art/soul-baseline.md: slits from mid-height down)
CREASE = {'z0': 0.876, 'z1': 0.827, 'x1': 0.356}  # the chin crease arch (soul-baseline-shape.js LINES): charms stay below
BLUSH = {'azimuth_deg': 42.0, 'z': 0.955, 'rx': 0.12, 'ry': 0.075}


def blush_centres(B):
    """Surface points of the two cheeks (character's left first): below the eyes, toward the sides."""
    out = []
    for s_ in (1.0, -1.0):
        a = math.radians(BLUSH['azimuth_deg']) * s_
        d = np.array([[math.sin(a), -math.cos(a), 0.0]])
        p_, _ = sb.march(B.body, np.array([[0.0, 0.0, BLUSH['z']]]), d, 0.0, 1.0, 200)
        out.append(p_[0])
    return out


def slot_frames(B, xz, size=None, sink=None, p=CHARM):
    """Slot frames for front positions xz (N, 2) (Blender x, z): the surface point on the smooth goo, the normal averaged
    over the charm's disc (so the charm sits on the goo's mean plane, not tilted by local curvature), up (world up
    orthogonalised), x = up x normal and the charm origin (back centre) = centre - normal * sink * thickness * size.
    `sink` may be one value or one per slot. Vectorised."""
    size = SLOT['size'] if size is None else size
    xz = np.atleast_2d(np.asarray(xz, float))
    n_ = len(xz)
    sink = np.broadcast_to(np.asarray(SLOT['sink'] if sink is None else sink, float), (n_,)).copy()
    o = np.stack([xz[:, 0], np.full(n_, -1.5), xz[:, 1]], 1)
    c, ok = sb.march(B.body, o, np.tile([0.0, 1.0, 0.0], (n_, 1)), 0.0, 3.0, 600)
    n0 = sb.gradient(B.body, c)
    up0 = np.array([0.0, 0.0, 1.0])[None] - n0 * n0[:, 2:3]
    up0 /= np.linalg.norm(up0, axis=1, keepdims=True)
    ex0 = np.cross(up0, n0)
    rr = np.repeat([0.0, 0.2, 0.35, 0.5], [1, 6, 10, 14])
    aa = np.concatenate([np.linspace(0, 2 * math.pi, k_, endpoint=False) for k_ in (1, 6, 10, 14)])
    w = np.repeat([1.0, 6 * 0.04, 10 * 0.0525, 14 * 0.075], [1, 6, 10, 14])  # ~ring areas
    disc = c[:, None] + size * ((rr * np.cos(aa))[None, :, None] * ex0[:, None] + (rr * np.sin(aa))[None, :, None] * up0[:, None])
    _, dn = sb.project_to_surface(B.body, disc.reshape(-1, 3))
    n = (dn.reshape(n_, -1, 3) * w[None, :, None]).sum(1)
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    up = np.array([0.0, 0.0, 1.0])[None] - n * n[:, 2:3]
    up /= np.linalg.norm(up, axis=1, keepdims=True)
    ex = np.cross(up, n)
    O = c - n * (sink[:, None] * p['thickness'] * size)
    return {'ok': ok, 'centre': c, 'normal': n, 'up': up, 'x': ex, 'origin': O, 'size': size, 'sink': sink}


def seat_sink(M, F, p=CHARM, s=None):
    """Per-slot sink that seats a rigid charm: the goo covers the outline's widest ring all round (embed <= embed_max)
    while the rim's top shows (rim >= rim_min), both scaled by the size; the value nearest the nominal sink inside that
    window (field values move ~1:1 with the push). Returns (sinks, feasible)."""
    s = s or SLOT
    T = p['thickness'] * F['size']
    lo = F['sink'] + (M['embed'] - s['embed_max'] * F['size']) / T
    hi = F['sink'] + (M['rim'] - s['rim_min'] * F['size']) / T
    lo = np.maximum(lo, s['sink_range'][0])
    hi = np.minimum(hi, s['sink_range'][1])
    sink = np.clip(s['sink'], lo, hi)
    sink = np.where(sink > s['sink'], np.ceil(sink * 100 - 1e-6), np.floor(sink * 100 + 1e-6)) / 100
    return sink, lo <= hi + 1e-9


def charm_to_world(F, i, local):
    """Local charm points (M, 3) of slot i -> Blender world."""
    L = np.atleast_2d(local)
    return F['origin'][i][None] + F['size'] * (L[:, :1] * F['x'][i][None] + L[:, 1:2] * F['up'][i][None] + L[:, 2:3] * F['normal'][i][None])


def slot_metrics(B, F, p=CHARM, k=24):
    """Per slot: facing (front view), embed (max goo field at the outline's widest ring: <= 0 means the goo wraps above
    the widest point all round), rim (min goo field at the outline's top ring: > 0 means the white rim edge shows all
    round), bump (max height of drips / eye domes over the goo within the footprint + margin, model units)."""
    n = len(F['centre'])
    ang = np.linspace(0, 2 * math.pi, k, endpoint=False)
    zb = float(charm_back_z(0.5, p))
    ring = lambda z: np.stack([0.5 * np.cos(ang), 0.5 * np.sin(ang), np.full(k, z)], 1)  # noqa: E731
    wide = np.vstack([charm_to_world(F, i, ring(zb + p['round'])) for i in range(n)])
    top = np.vstack([charm_to_world(F, i, ring(zb + p['edge'])) for i in range(n)])
    rings = (0.0, 0.17, 0.33, 0.42, 0.5)
    counts = (1, 8, 12, 16, 20)
    rr = np.repeat(rings, counts)
    aa = np.concatenate([np.linspace(0, 2 * math.pi, k_, endpoint=False) + 0.1 * j for j, k_ in enumerate(counts)])
    disc = np.vstack([charm_to_world(F, i, np.stack([rr * np.cos(aa), rr * np.sin(aa), np.full(len(rr), F['sink'][i] * p['thickness'])], 1))
                      for i in range(n)])
    ds, _ = sb.project_to_surface(B.body, disc)
    hb = np.maximum(-B.f(ds, 'full').reshape(n, -1), 0.0)
    edges = np.cumsum((0,) + counts)
    drip = np.stack([hb[:, edges[j]:edges[j + 1]].max(1) for j in range(len(rings))], 1)
    return {'facing': -F['normal'][:, 1], 'embed': B.f(wide, 'body').reshape(n, k).max(1),
            'rim': B.f(top, 'body').reshape(n, k).min(1), 'bump': hb.max(1), 'drip': drip, 'rings': rings}




# ------------------------------------------------------------------------------------------------ body colour (spec maths)
EYE_WHITE = '#F7F8FF'


def gradient_fill(h, grad, span):
    """Body fill for heights h above the floor (model units): t = clamp((top - h) / (top - bottom), 0, 1), then
    mix(top, bottom, t) in sRGB, then to linear. (N, 3) linear RGB."""
    h = np.asarray(h, float)
    t = np.clip((span['top'] - h) / (span['top'] - span['bottom']), 0.0, 1.0)[..., None]
    srgb = hex_rgb(grad['top']) * (1.0 - t) + hex_rgb(grad['bottom']) * t
    return srgb_to_linear(srgb)


def tint_vertices(h, mask, grad, span):
    """Per-vertex linear colour: the gradient fill, then the D-27 mask mixes in linear light, in this order: drips (R)
    toward highlight, eye discs (G) toward #F7F8FF, groove (B) toward outline, orb (A) toward highlight. Returns
    (colour (N, 3), glow weight (N,)); the orb also glows in `glow` x A (x the renderer's strength)."""
    c = gradient_fill(h, grad, span)
    m = np.clip(np.nan_to_num(np.asarray(mask, float)), 0.0, 1.0)
    for ch, target in ((0, grad['highlight']), (1, EYE_WHITE), (2, grad['outline']), (3, grad['highlight'])):
        c = c + (srgb_to_linear(hex_rgb(target))[None] - c) * m[:, ch:ch + 1]
    return c, m[:, 3]



# ================================================================================================ Blender side
def vdb_mesh(field, lo, vs, adaptivity=0.0):
    """Dense level set (negative inside) -> (verts, tris, quads) via OpenVDB (bundled with Blender)."""
    import openvdb as vdb
    band = 3.0 * vs
    grid = vdb.FloatGrid(band)
    grid.copyFromArray(np.clip(field, -band, band).astype(np.float32), (0, 0, 0), 1e-7)
    res = grid.convertToPolygons(0.0, adaptivity)
    verts = np.asarray(res[0], float) * vs + np.asarray(lo, float)
    return verts, np.asarray(res[1], np.int64).reshape(-1, 3), np.asarray(res[2], np.int64).reshape(-1, 4)


def mesh_to_arrays(verts, tris, quads, target_tris, name):
    """Blender mesh from the level-set polygons, decimated to about target_tris: (verts, normals, tris)."""
    ob = sb.build_mesh_object(name, verts, tris, quads)
    dup = sb.decimated_copy(ob, target_tris, name + '_lod') if target_tris else ob
    v, n, t, _ = sb.mesh_arrays(dup.data)
    for o in {ob, dup}:
        me = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)
    return v.astype(np.float64), n.astype(np.float64), t


def build_charm(cid, icon_path, out_dir, p=CHARM):
    """One charm: <id>.png (re-framed icon, the texture and the 2D sprite) and <id>.glb. Returns its record."""
    icon = load_rgba(icon_path)
    seg, c, r, af = icon_outline(icon)
    png = reframe_icon(icon, c, r, p['png'], p['frame'])
    png_path = os.path.join(out_dir, cid + '.png')
    png_bytes_, png_kind, _ = save_png_small(png_path, to_u8(png))
    vs = p['voxel']
    lim = 0.5 + 3 * vs
    n = int(round(2 * lim / vs)) + 1
    g, d2 = charm_sdf2d(seg, c, r, af, n, lim)
    z0 = float(charm_back_z(lim, p)) - 3 * vs
    zs = z0 + vs * np.arange(int(math.ceil((p['thickness'] + 3 * vs - z0) / vs)) + 1)
    field = charm_field(d2, g, zs, p)
    verts, tris, quads = vdb_mesh(field, (g[0], g[0], zs[0]), vs)
    v, nrm, t = mesh_to_arrays(verts, tris, quads, p['tris'], cid)
    uv = np.stack([0.5 + v[:, 0] * p['frame'], 0.5 - v[:, 1] * p['frame']], 1)
    meta = {'id': cid, 'frame': 'origin back centre, +Z front, +Y up, outline diameter 1', 'thickness': p['thickness'],
            'textureFrame': p['frame'], 'triangles': int(len(t))}
    data = charm_glb(v, nrm, uv, t, meta, cid + '.png', p['roughness'], p['emissive'])
    glb_path = os.path.join(out_dir, cid + '.glb')
    with open(glb_path, 'wb') as fh:
        fh.write(data)
    return {'id': cid, 'triangles': int(len(t)), 'vertices': int(len(v)), 'glbBytes': len(data), 'pngBytes': png_bytes_, 'pngKind': png_kind,
            'extent': [round(float(x), 4) for x in (v[:, 0].min(), v[:, 0].max(), v[:, 1].min(), v[:, 1].max(), v[:, 2].min(), v[:, 2].max())]}



def build_body(B, voxel, log_=log):
    """The baseline body as a Blender mesh (the model's own ops, sparse OpenVDB level set) with its D-27 mask."""
    t0 = time.time()
    lo, hi = sb.bounds()
    grid = sb.sparse_grid(B.full, lo, hi, voxel, log=lambda *a: None)
    verts, tris, quads = sb.mesh_from_grid(grid, lo, voxel)
    ob = sb.build_mesh_object('soul_body', verts, tris, quads)
    mask = sb.vertex_masks(verts, B.body, B.eye_list, B.eyes)
    attr = ob.data.color_attributes.new('soul_mask', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', mask.ravel())
    log_(f'body: {len(verts)} verts at {voxel} in {time.time() - t0:.1f}s (mesh floor {float(verts[:, 2].min()):.5f})')
    return ob, verts, mask


def bake_gradient(ob, verts, mask, grad, span, floor):
    """Bake the spec colour into the 'decor_rgb' attribute (linear) and the orb glow weight into its alpha."""
    col, glow = tint_vertices(verts[:, 2] - floor, mask, grad, span)
    name = 'decor_rgb'
    attr = ob.data.color_attributes.get(name) or ob.data.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.concatenate([col, glow[:, None]], 1).astype(np.float32).ravel())


def body_material(glow_hex, strength=2.2, name='decor_body'):
    """The D-27 glossy clay (soul_baseline.soul_material) with the baked colour instead of the palette mixes."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    sb.set_bsdf(bsdf, rough=0.32, coat=0.8, coat_rough=0.12, sheen=0.35, sheen_tint=sb.hex_lin('#FFB27A'), emit_str=0.0)
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'decor_rgb'
    nt.links.new(attr.outputs['Color'], sb._in(bsdf, 'Base Color'))
    emit = nt.nodes.new('ShaderNodeMath')
    emit.operation = 'MULTIPLY'
    nt.links.new(attr.outputs['Alpha'], emit.inputs[0])
    emit.inputs[1].default_value = strength
    nt.links.new(emit.outputs[0], sb._in(bsdf, 'Emission Strength'))
    sb._in(bsdf, 'Emission Color').default_value = sb.hex_lin(glow_hex)
    return m


def decode_glb(path):
    """Primitives of a GLB written here: [{'P', 'N', 'UV', 'C', 'I', 'material'}] in scene space (node TRS applied)."""
    gl, binb = read_glb(path)
    comp = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def acc(i):
        a = gl['accessors'][i]
        v = gl['bufferViews'][a['bufferView']]
        dt = np.dtype(comp[a['componentType']])
        n, k = a['count'], size[a['type']]
        stride = v.get('byteStride', dt.itemsize * k)
        raw = np.frombuffer(binb, np.uint8, count=v['byteLength'], offset=v['byteOffset'])
        rows = np.lib.stride_tricks.as_strided(raw, shape=(n, stride), strides=(stride, 1))
        out = np.frombuffer(rows[:, :dt.itemsize * k].tobytes(), dt).reshape(n, k).astype(np.float64)
        if a.get('normalized'):
            out = np.maximum(out / float(np.iinfo(dt).max), -1.0)
        return out
    node = gl['nodes'][gl['scenes'][0]['nodes'][0]]
    s_ = np.asarray(node.get('scale', [1, 1, 1]), float)
    t_ = np.asarray(node.get('translation', [0, 0, 0]), float)
    out = []
    for prim in gl['meshes'][node['mesh']]['primitives']:
        at = prim['attributes']
        d = {'P': acc(at['POSITION']) * s_ + t_, 'N': acc(at['NORMAL']), 'I': acc(prim['indices']).astype(np.int64).reshape(-1, 3),
             'material': gl['materials'][prim['material']]}
        if 'TEXCOORD_0' in at:
            d['UV'] = acc(at['TEXCOORD_0'])
        if 'COLOR_0' in at:
            d['C'] = acc(at['COLOR_0'])
        out.append(d)
    return gl, out


def model_to_blender(P):
    P = np.atleast_2d(np.asarray(P, float))
    return np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)


def mesh_object(name, verts_b, tris, uvs=None, colors=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(verts_b, float).tolist(), [], np.asarray(tris, int).tolist())
    me.update()
    if uvs is not None:
        uvl = me.uv_layers.new(name='UVMap')
        loop_v = np.empty(len(me.loops), np.int64)
        me.loops.foreach_get('vertex_index', loop_v)
        uv = np.asarray(uvs, float)[loop_v].copy()
        uv[:, 1] = 1.0 - uv[:, 1]  # glTF v runs down, Blender's up
        uvl.data.foreach_set('uv', uv.astype(np.float32).ravel())
    if colors is not None:
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        attr.data.foreach_set('color', np.asarray(colors, np.float32).ravel())
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def charm_material(png_path, name):
    """Blender stand-in for the GLB material: the icon (sRGB) as base colour and emission (x CHARM emissive), roughness as
    the GLB, plus the clear coat the phone's body material gets (MeshPhysicalMaterial clearcoat ~0.8)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    sb.set_bsdf(bsdf, rough=CHARM['roughness'], coat=0.5, coat_rough=0.15, emit_str=CHARM['emissive'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    img = bpy.data.images.load(png_path, check_existing=True)
    img.colorspace_settings.name = 'sRGB'
    tex.image = img
    tex.interpolation = 'Linear'
    tex.extension = 'EXTEND'
    nt.links.new(tex.outputs['Color'], sb._in(bsdf, 'Base Color'))
    nt.links.new(tex.outputs['Color'], sb._in(bsdf, 'Emission Color'))
    return m


# ------------------------------------------------------------------------------------------------ Blender scene helpers
def slot_basis_blender(slot):
    """(origin, x, up, normal) of a slot in Blender coordinates (model space -> Blender (x, -z, y))."""
    c = model_to_blender([slot['centre']])[0]
    n = model_to_blender([slot['normal']])[0]
    up = model_to_blender([slot['up']])[0]
    up = up - n * (up @ n)
    up /= np.linalg.norm(up)
    n /= np.linalg.norm(n)
    ex = np.cross(up, n)
    origin = c - n * (slot['sink'] * CHARM['thickness'] * slot['size'])
    return origin, ex, up, n


def place_charm(cid, slot, charm_dir, name=None):
    """The charm GLB (decoded here, so the render uses the shipped bytes) placed at a slot exactly as the renderer does:
    basis (up x normal, up, normal), origin centre - normal * sink * thickness * size, scale size."""
    gl, prims = decode_glb(os.path.join(charm_dir, cid + '.glb'))
    pr = prims[0]
    P = pr['P']
    O, ex, up, n = slot_basis_blender(slot)
    s = slot['size']
    Wp = O[None] + s * (P[:, :1] * ex[None] + P[:, 1:2] * up[None] + P[:, 2:3] * n[None])
    ob = mesh_object(name or f'charm_{slot["index"]}_{cid}', Wp, pr['I'], pr['UV'])
    key = 'charm_mat_' + cid
    mat = bpy.data.materials.get(key) or charm_material(os.path.join(charm_dir, cid + '.png'), key)
    ob.data.materials.append(mat)
    return ob



# ------------------------------------------------------------------------------------------------ face kits
# Three kits of equal visual weight (BR-17: nothing gold, rare or ranked; no weapons), authored on the body in
# model space so they sit at identity. Every part is its own primitive with a fixed core-PBR colour.
KIT_COLOURS = {
    'frame': {'base': '#2B2350', 'rough': 0.28},                      # nerdy: plum acetate glasses
    'patch': {'base': '#2B2350', 'rough': 0.55},                      # pirate: plum felt patch and strap
    'bandana': {'base': '#E0505F', 'rough': 0.6},                     # pirate: cherry-red bandana ...
    'dots': {'base': '#FFF7F2', 'rough': 0.6},                        # ... with white polka dots
    'halo': {'base': '#FFF6E4', 'rough': 0.35, 'emit': '#FFEFD2'},    # angel: warm white glowing ring (not gold)
    'blush': {'base': '#FF5E94', 'rough': 0.7, 'blend': True},        # angel: soft rose cheeks
}
KIT_VOXEL = 0.0025
PATCH_EYE = 0  # the pirate patch covers the character's left eye (+X, the viewer's right; nearest the 3/4 rest camera)
BAND = 0.125  # height of the pirate's bandana band above its brim (model units)


def head_points(B, az_deg, z, ops=None):
    """Surface points of the head seen from its axis at heights z, azimuths az (degrees; 0 = front -Y, +90 = the
    character's left +X). Vectorised: az and z broadcast to one batch of rays."""
    az, z = np.broadcast_arrays(np.atleast_1d(np.asarray(az_deg, float)), np.atleast_1d(np.asarray(z, float)))
    a = np.radians(az.ravel())
    o = np.stack([np.zeros_like(a), np.zeros_like(a), z.ravel()], 1)
    tab = np.array(sb.BASE['head_axis'])  # the head's axis drifts toward the antenna above the brow
    off = np.interp(z.ravel(), tab[:, 0], tab[:, 1])
    o[:, 0] += off * sb.BASE['axis_dir'][0]
    o[:, 1] += off * sb.BASE['axis_dir'][1]
    d = np.stack([np.sin(a), -np.cos(a), np.zeros_like(a)], 1)
    p, _ = sb.march(ops or B.body, o, d, 0.0, 1.0, 300)
    return p.reshape(az.shape + (3,))


def head_point(B, az_deg, z, ops=None):
    return head_points(B, az_deg, z, ops)[0]


def lift(ops, P, h):
    """Points snapped to the surface of `ops` and pushed out along its normal by h."""
    Ps, n = sb.project_to_surface(ops, np.atleast_2d(P))
    return Ps + n * h


def smooth_polyline(P, k=4, closed=False):
    """Chaikin corner cutting (k rounds): smooth tubes from coarse control points."""
    P = np.asarray(P, float)
    for _ in range(k):
        Q = np.roll(P, -1, axis=0) if closed else P[1:]
        A = P if closed else P[:-1]
        new = np.empty((2 * len(A), 3))
        new[0::2] = 0.75 * A + 0.25 * Q
        new[1::2] = 0.25 * A + 0.75 * Q
        P = new if closed else np.vstack([P[:1], new, P[-1:]])
    return P


def field_prim(fn_points, lo, hi, name):
    """soul_baseline Prim from a points function (N, 3) -> (N,) (for fields built from other op lists)."""
    def fn(X, Y, Z):
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
        return fn_points(P).reshape(X.shape)
    return sb.Prim(fn, lo, hi, name)


def eye_rim(B, i, radius, count=64):
    """Closed ring of points at `radius` around eye i in its tangent frame, on the goo + eye surface."""
    c, n, _ = B.eyes[i]
    F = sb.frame_from_normal(n)
    t = np.linspace(0, 2 * math.pi, count, endpoint=False)
    ring = c[None] + radius * (np.cos(t)[:, None] * F[0][None] + np.sin(t)[:, None] * F[1][None])
    return ring


def kit_parts(B, face):
    """[(part name, material key, op list, bounds lo, hi, target triangles)] for one face kit (Blender coords)."""
    parts = []
    if face == 'nerdy':
        r_rim, r_bridge, r_temple = 0.025, 0.017, 0.013
        rims = []
        for i in (0, 1):
            ring = lift(B.smooth, eye_rim(B, i, 0.181, 72), 0.004 + r_rim)
            rims.append(ring)
            name = 'rim_left' if i == 0 else 'rim_right'
            parts.append((name, 'frame', [('u', sb.polyline_tube(ring, r_rim, closed=True, name=name), 0.0)], ring.min(0) - 0.03, ring.max(0) + 0.03, 1100))
        # bridge: from each rim's inner point (toward the other eye) over the top of the nose, arching up a little
        (cl, nl, _), (cr, nr, _) = B.eyes[0], B.eyes[1]
        inner_l = rims[0][np.argmin(rims[0][:, 0])]
        inner_r = rims[1][np.argmax(rims[1][:, 0])]
        mid = lift(B.smooth, head_point(B, 0.0, cl[2] + 0.035), 0.012 + r_bridge)[0]
        ctrl = smooth_polyline(np.array([inner_l, 0.5 * (inner_l + mid) + np.array([0, -0.004, 0.012]), mid,
                                         0.5 * (inner_r + mid) + np.array([0, -0.004, 0.012]), inner_r]), 4)
        parts.append(('bridge', 'frame', [('u', sb.polyline_tube(ctrl, r_bridge, closed=False, name='bridge'), 0.0)], ctrl.min(0) - 0.03, ctrl.max(0) + 0.03, 300))
        # temples: from each rim's outer point back along the head at eye height
        for i, sgn in ((0, 1.0), (1, -1.0)):
            ring = rims[i]
            outer = ring[np.argmax(sgn * ring[:, 0])]
            az0 = math.degrees(math.atan2(outer[0], -outer[1]))
            back = lift(B.body, head_points(B, sgn * np.linspace(abs(az0) + 8, 118, 9), outer[2] + 0.006), 0.003 + r_temple)
            path = smooth_polyline(np.vstack([outer[None], back]), 3)
            name = 'temple_left' if i == 0 else 'temple_right'
            parts.append((name, 'frame', [('u', sb.polyline_tube(path, r_temple, closed=False, name=name), 0.0)], path.min(0) - 0.03, path.max(0) + 0.03, 350))
    elif face == 'pirate':
        c, n, R = B.eyes[PATCH_EYE]
        F = sb.frame_from_normal(n)
        cap = sb.ellipsoid(c, (0.172, 0.165, 0.058), frame=F, name='patch_cap')
        smooth = B.smooth

        def patch_fn(P):
            return sb.smax(cap.fn(P[:, 0], P[:, 1], P[:, 2]), -sb.eval_ops_points(smooth, P) + 0.002, 0.012)
        lo_p, hi_p = c - 0.22, c + 0.22
        patch = field_prim(patch_fn, lo_p, hi_p, 'patch')
        parts.append(('patch', 'patch', [('u', patch, 0.0)], lo_p, hi_p, 700))
        # strap: the head cut by the plane through the patch centre and two points under the bandana brim; it runs on the
        # goo, so it slips under the patch and comes out at its edges
        tip = c + n * 0.012
        a1 = head_point(B, -28.0, 1.445)
        a2 = head_point(B, 150.0, 1.415)
        pn = np.cross(a1 - tip, a2 - tip)
        pn /= np.linalg.norm(pn)
        # per azimuth, the height where the head surface meets the plane (a sign change of pn . (p - tip))
        azs = np.linspace(0, 360, 96, endpoint=False)
        zs_ = np.linspace(1.0, 1.62, 32)
        grid_ = head_points(B, azs[:, None], zs_[None, :])
        f = (grid_ - tip[None, None]) @ pn
        loop = []
        for k_ in range(len(azs)):
            fk, pk = f[k_], grid_[k_]
            j = int(np.argmin(np.abs(fk)))
            j2 = min(max(j + (1 if fk[j] * fk[min(j + 1, 31)] < 0 else -1), 0), 31)
            t_ = fk[j] / (fk[j] - fk[j2]) if fk[j] != fk[j2] else 0.0
            loop.append(pk[j] + (pk[j2] - pk[j]) * t_)
        loop = lift(B.body, np.array(loop), 0.004 + 0.011)  # under the eye dome, so hidden by the patch there
        # keep the arc through the patch up to where both ends are tucked 0.03 inside the band (the band hides the rest)
        brim_at = 1.43 - 0.03 * (1 - np.cos(np.radians(azs))) / 2
        inside = loop[:, 2] < brim_at + 0.03
        k0 = int(np.argmin(np.abs(((azs - math.degrees(math.atan2(c[0], -c[1]))) + 180) % 360 - 180)))
        lo_k, hi_k = k0, k0
        while inside[(lo_k - 1) % len(loop)] and hi_k - lo_k < len(loop) - 2:
            lo_k -= 1
        while inside[(hi_k + 1) % len(loop)] and hi_k - lo_k < len(loop) - 2:
            hi_k += 1
        arc = loop[[k % len(loop) for k in range(lo_k - 1, hi_k + 2)]]
        arc = smooth_polyline(arc, 2)
        parts.append(('strap', 'patch', [('u', sb.polyline_tube(arc, 0.011, closed=False, name='strap'), 0.0)], arc.min(0) - 0.03, arc.max(0) + 0.03, 600))
        # bandana: a 0.024 cloth band tied round the upper head, brim (1.43 front .. 1.40 back) to BAND above it, the
        # crown and the antenna neck stay free
        body = B.body
        t_out, t_in = 0.024, 0.004

        def brim_z(P):
            az = np.arctan2(P[:, 0], -P[:, 1])
            return 1.43 - 0.03 * (1 - np.cos(az)) / 2

        def band_fn(P):
            fb = sb.eval_ops_points(body, P)
            shell = np.maximum(fb - t_out, -fb - t_in)
            return np.maximum(np.maximum(shell, brim_z(P) - P[:, 2]), P[:, 2] - brim_z(P) - BAND)
        lo_b, hi_b = np.array([-0.46, -0.46, 1.36]), np.array([0.46, 0.46, 1.43 + BAND + 0.03])
        parts.append(('bandana', 'bandana', [('u', field_prim(band_fn, lo_b, hi_b, 'bandana'), 0.0)], lo_b, hi_b, 1800))
        # rolled hem along the brim and a soft ring around the neck opening
        haz = np.linspace(0, 360, 72, endpoint=False)
        hem = head_points(B, haz, 1.43 - 0.03 * (1 - np.cos(np.radians(haz))) / 2 + 0.004)
        hem = lift(body, hem, t_out - 0.004)
        parts.append(('bandana_hem', 'bandana', [('u', sb.polyline_tube(hem, 0.016, closed=True, name='hem'), 0.0)], hem.min(0) - 0.03, hem.max(0) + 0.03, 500))
        top = head_points(B, haz, 1.43 - 0.03 * (1 - np.cos(np.radians(haz))) / 2 + BAND - 0.004)
        top = lift(body, top, t_out - 0.004)
        parts.append(('bandana_top', 'bandana', [('u', sb.polyline_tube(top, 0.014, closed=True, name='band_top'), 0.0)], top.min(0) - 0.03, top.max(0) + 0.03, 450))
        # side knot on the character's right (-X), behind the temple: a knot ball, two lobes and two short tails
        kc = lift(body, head_point(B, -104.0, 1.455), t_out + 0.012)[0]
        kn = sb.gradient(body, kc[None])[0]
        KF = sb.frame_from_normal(kn)  # rows: t1 (horizontal-ish), t2 (down the surface), n
        up_ = -KF[1]
        back = np.cross(kn, up_)
        back = back if back[1] > 0 else -back
        knot = [('u', sb.sphere(kc, 0.038, name='knot'), 0.0),
                ('u', sb.ellipsoid(kc + up_ * 0.05 + back * 0.035, (0.062, 0.036, 0.03), frame=sb.frame_from_normal(kn, hint=tuple(up_ + back)), name='lobe'), 0.02),
                ('u', sb.ellipsoid(kc - up_ * 0.012 + back * 0.066, (0.062, 0.036, 0.03), frame=sb.frame_from_normal(kn, hint=tuple(back)), name='lobe'), 0.02),
                ('u', sb.round_cone(kc, kc - up_ * 0.16 + back * 0.05 + kn * 0.012, 0.031, 0.018, name='tail'), 0.02),
                ('u', sb.round_cone(kc, kc - up_ * 0.13 + back * 0.13 + kn * 0.012, 0.029, 0.017, name='tail'), 0.02)]
        parts.append(('bandana_knot', 'bandana', knot, kc - 0.2, kc + 0.2, 700))
        # polka dots on the bandana's outer surface
        dots = []
        for z_ in (1.47, 1.525):
            ring_r = float(np.linalg.norm(head_point(B, 0.0, z_)[:2]))
            count = max(5, int(2 * math.pi * ring_r / 0.095))
            off = 0.5 if int(round(z_ * 100)) % 2 else 0.0
            for j in range(count):
                az = 360.0 * (j + off) / count
                if -128 < az - 360 * (az > 180) < -80 and z_ < 1.6:
                    continue  # the knot sits here
                p_ = head_point(B, az, z_)
                if p_[2] < brim_z(p_[None])[0] + 0.035:
                    continue
                q = lift(body, p_, t_out)[0]
                nq = sb.gradient(body, q[None])[0]
                dots.append(('u', sb.ellipsoid(q - nq * 0.001, (0.02, 0.02, 0.0045), frame=sb.frame_from_normal(nq), name='dot'), 0.0))
        pts_ = np.array([d_[1].lo for d_ in dots] + [d_[1].hi for d_ in dots])
        parts.append(('bandana_dots', 'dots', dots, pts_.min(0) - 0.01, pts_.max(0) + 0.01, 900))
    elif face == 'angel':
        axis_c = np.array([0.100, 0.062, 1.84])
        tilt = math.radians(18.0)
        n = np.array([0.0, -math.sin(tilt), math.cos(tilt)])
        halo = sb.torus(axis_c, n, 0.232, 0.030, name='halo')
        parts.append(('halo', 'halo', [('u', halo, 0.0)], halo.lo - 0.01, halo.hi + 0.01, 1100))
    return parts


def blush_patch(B, centre, n=15, m=11):
    """A soft ellipse on the cheek (on the full surface incl. drips): (verts, tris, alpha)."""
    nrm = sb.gradient(B.full, centre[None])[0]
    F = sb.frame_from_normal(nrm)
    u = np.linspace(-1, 1, n)
    v = np.linspace(-1, 1, m)
    U, V = np.meshgrid(u, v, indexing='ij')
    ex = F[0] if F[0][0] * np.sign(centre[0] + 1e-9) >= 0 else -F[0]
    ey = np.cross(nrm, ex)
    ey = ey if ey[2] >= 0 else -ey
    P = centre[None, None] + BLUSH['rx'] * U[..., None] * ex[None, None] + BLUSH['ry'] * V[..., None] * ey[None, None]
    P = lift(B.full, P.reshape(-1, 3), 0.0028)
    rho = np.sqrt(U ** 2 + V ** 2).ravel()
    alpha = np.clip(1.0 - rho ** 2.5, 0.0, 1.0) ** 0.8 * 0.9  # full in the middle, soft toward the edge
    idx = np.arange(n * m).reshape(n, m)
    tris = []
    for i in range(n - 1):
        for j in range(m - 1):
            a, b, c_, d = idx[i, j], idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]
            if min(rho[a], rho[b], rho[c_], rho[d]) >= 1.0:
                continue
            tris += [(a, b, c_), (a, c_, d)]
    tris = np.array(tris)
    # face the viewer (outward normal)
    e1 = P[tris[:, 1]] - P[tris[:, 0]]
    e2 = P[tris[:, 2]] - P[tris[:, 0]]
    if (np.cross(e1, e2) @ nrm).mean() < 0:
        tris = tris[:, ::-1]
    used = np.unique(tris)
    remap = -np.ones(len(P), int)
    remap[used] = np.arange(len(used))
    return P[used], remap[tris], alpha[used]



def ops_near(ops, lo, hi, margin=0.02):
    """The ops whose bounds (grown by their blend radius) touch the box: the same field inside it, much cheaper."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    return [(k_, pr, b) for k_, pr, b in ops if not (np.any(pr.hi + b + margin < lo) or np.any(pr.lo - b - margin > hi))]


class NearBody:
    """A Body whose op lists are cut down to one region (face-kit parts only ever touch the head)."""

    def __init__(self, B, lo, hi):
        self.eyes = B.eyes
        for name in ('body', 'eye_list', 'full'):
            setattr(self, name, ops_near(getattr(B, name), lo, hi))
        self.smooth = self.body + self.eye_list
        self.floor = B.floor


def linear_hex(h):
    return [round(float(v), 5) for v in srgb_to_linear(hex_rgb(h))]


def kit_material(key):
    c = KIT_COLOURS[key]
    m = {'name': key, 'pbrMetallicRoughness': {'baseColorFactor': linear_hex(c['base']) + [1.0], 'metallicFactor': 0.0, 'roughnessFactor': c['rough']}}
    if 'emit' in c:
        m['emissiveFactor'] = linear_hex(c['emit'])
    if c.get('blend'):
        m['alphaMode'] = 'BLEND'
    return m


def snap_box(lo, hi, vs, coarse=8):
    """Grow a box to whole coarse cells of soul_baseline.sparse_grid (its last block must hold fine samples)."""
    lo = np.asarray(lo, float)
    cs = vs * coarse
    n = np.ceil((np.asarray(hi, float) - lo) / cs - 1e-9)
    return lo, lo + n * cs - 1e-9


def kit_glb(face, prims, meta):
    """Face kit GLB bytes: one node (the shared dequantisation), one mesh, one primitive per part (POSITION int16,
    NORMAL int8, COLOR_0 uint8 RGBA for the soft blush), a core-PBR material per colour. Model space, identity."""
    allP = np.vstack([pr['P'] for pr in prims])
    lo, hi = allP.min(0), allP.max(0)
    centre = (lo + hi) / 2
    half = float(np.max(hi - lo) / 2) * 1.0001
    mats, mat_index = [], {}
    blobs, accessors, gl_prims = [], [], []
    for pr in prims:
        if pr['material'] not in mat_index:
            mat_index[pr['material']] = len(mats)
            mats.append(kit_material(pr['material']))
        q = np.round((pr['P'] - centre) / half * 32767).astype(np.int16)
        pos = np.zeros((len(q), 4), np.int16)
        pos[:, :3] = q
        attrs = {}
        attrs['POSITION'] = len(accessors)
        accessors.append({'bufferView': len(blobs), 'componentType': 5122, 'normalized': True, 'count': len(q), 'type': 'VEC3',
                          'min': q.min(0).astype(int).tolist(), 'max': q.max(0).astype(int).tolist()})
        blobs.append((pos.tobytes(), 8, 34962))
        attrs['NORMAL'] = len(accessors)
        accessors.append({'bufferView': len(blobs), 'componentType': 5120, 'normalized': True, 'count': len(q), 'type': 'VEC3'})
        blobs.append((pack_normals(pr['N']).tobytes(), 4, 34962))
        if pr.get('C') is not None:
            attrs['COLOR_0'] = len(accessors)
            col = np.round(np.clip(pr['C'], 0, 1) * 255).astype(np.uint8)
            accessors.append({'bufferView': len(blobs), 'componentType': 5121, 'normalized': True, 'count': len(q), 'type': 'VEC4'})
            blobs.append((col.tobytes(), 4, 34962))
        idx = pr['I'].astype(np.uint16 if len(q) < 65536 else np.uint32).ravel()
        ind = len(accessors)
        accessors.append({'bufferView': len(blobs), 'componentType': 5123 if len(q) < 65536 else 5125, 'count': int(idx.size), 'type': 'SCALAR'})
        blobs.append((idx.tobytes(), None, 34963))
        gl_prims.append({'attributes': attrs, 'indices': ind, 'material': mat_index[pr['material']], 'extras': {'part': pr['name']}})
    gl = {
        'asset': {'version': '2.0', 'generator': 'ariskill ' + GENERATOR, 'extras': meta},
        'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': 'face-' + face, 'mesh': 0, 'translation': [round(float(v), 7) for v in centre], 'scale': [round(half, 7)] * 3}],
        'meshes': [{'name': 'face-' + face, 'primitives': gl_prims}],
        'materials': mats, 'accessors': accessors,
    }
    return _glb_pack(gl, blobs)


def build_kit(B, face, out_dir, log_=log):
    """Mesh every part of a kit (sparse OpenVDB level sets, decimated), write face-<face>.glb; returns the record."""
    t0 = time.time()
    prims = []
    for name, mat, ops, lo, hi, tris in kit_parts(B, face):
        lo, hi = snap_box(lo, hi, KIT_VOXEL)
        grid = sb.sparse_grid(ops, lo, hi, KIT_VOXEL, log=lambda *a: None)
        verts, tq, qd = sb.mesh_from_grid(grid, lo, KIT_VOXEL)
        v, n_, t = mesh_to_arrays(verts, tq, qd, tris, f'{face}_{name}')
        prims.append({'name': name, 'material': mat, 'P': blender_to_model(v), 'N': blender_to_model(n_), 'I': t})
        log_(f'  {face}/{name}: {len(t)} tris')
    if face == 'angel':
        for side, bc in zip(('left', 'right'), blush_centres(B)):
            v, t, a = blush_patch(B, bc)
            e1, e2 = v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]]
            fn = np.cross(e1, e2)
            vn = np.zeros_like(v)
            for k in range(3):
                np.add.at(vn, t[:, k], fn)
            C = np.concatenate([np.ones((len(v), 3)), a[:, None]], 1)
            prims.append({'name': f'blush_{side}', 'material': 'blush', 'P': blender_to_model(v), 'N': blender_to_model(vn), 'I': t, 'C': C})
    meta = {'face': face, 'frame': 'model space of the baseline Soul GLBs (+Y up, +Z front); place at identity',
            'parts': [p_['name'] for p_ in prims], 'triangles': int(sum(len(p_['I']) for p_ in prims))}
    data = kit_glb(face, prims, meta)
    path = os.path.join(out_dir, f'face-{face}.glb')
    os.makedirs(out_dir, exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(data)
    log_(f'face {face}: {meta["triangles"]} tris, {len(data)} bytes in {time.time() - t0:.1f}s')
    return {'bytes': len(data), 'triangles': meta['triangles'], 'parts': meta['parts']}


def blender_to_model(P):
    P = np.atleast_2d(np.asarray(P, float))
    return np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)


def gl_material_to_blender(mat, name):
    """Blender stand-in for a face-kit glTF material (same colours; the halo glows, the blush blends by vertex alpha)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    pb = mat['pbrMetallicRoughness']
    sb.set_bsdf(bsdf, base=tuple(pb['baseColorFactor']), rough=pb['roughnessFactor'], coat=0.3, coat_rough=0.2)
    if 'emissiveFactor' in mat:
        sb._in(bsdf, 'Emission Color').default_value = tuple(mat['emissiveFactor']) + (1.0,)
        sb._in(bsdf, 'Emission Strength').default_value = 3.2
    if mat.get('alphaMode') == 'BLEND':
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        nt.links.new(attr.outputs['Alpha'], sb._in(bsdf, 'Alpha'))
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            m.blend_method = 'BLEND'
    return m


def place_kit(path, tag=''):
    """The face-kit GLB (decoded here) as Blender objects at identity; returns them."""
    gl, prims = decode_glb(path)
    obs = []
    for pr in prims:
        name = pr.get('part') or pr['material']['name']
        C = pr.get('C')
        ob = mesh_object(f'kit{tag}_{name}_{len(obs)}', model_to_blender(pr['P']), pr['I'], colors=C)
        key = f'kitmat_{pr["material"]["name"]}'
        mat = bpy.data.materials.get(key) or gl_material_to_blender(pr['material'], key)
        ob.data.materials.append(mat)
        obs.append(ob)
    return obs


def front_ortho_camera(size_px):
    """Orthographic front camera covering the renderer's 200 x 200 viewBox exactly (x = 100 + 70 X, y = 178.6 - 70 Z)."""
    for o in [o for o in bpy.context.scene.objects if o.type == 'CAMERA']:
        bpy.data.objects.remove(o)
    cam = bpy.data.cameras.new('front_ortho')
    cam.type = 'ORTHO'
    cam.ortho_scale = 200.0 / 70.0
    cam.sensor_fit = 'HORIZONTAL'
    ob = bpy.data.objects.new('front_ortho', cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector((0.0, -6.0, (178.6 - 100.0) / 70.0))
    ob.rotation_euler = (math.pi / 2, 0.0, 0.0)
    bpy.context.scene.camera = ob
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = size_px
    return ob


def render_rgba(path):
    """Render the scene to an RGBA float array (and nothing else on disk)."""
    sc = bpy.context.scene
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = load_rgba(path)
    return img


# ================================================================================================ modes
def charm_ids(cat, only=None, kind=None):
    ids = [c['id'] for c in cat['charms'] if (kind is None or c['kind'] == kind)]
    if only:
        want = set(only)
        unknown = want - {c['id'] for c in cat['charms']}
        if unknown:
            raise SystemExit(f'unknown charm ids: {sorted(unknown)}')
        ids = [i for i in ids if i in want]
    return ids


def mode_stars(cat, args):
    """Draw the 50 star icons (catalog order) into assets-src/charms/icons/ and the review sheet."""
    t0 = time.time()
    only = set(args.only.split(',')) if args.only else None
    icons = star_icons(cat, only)
    for cid, img in icons.items():
        save_png(os.path.join(ICON_DIR, cid + '.png'), img)
    if not only:
        tiles = [icons[c['id']] for c in cat['charms'] if c['kind'] == 'core']
        save_png(os.path.join(QA_DIR, 'decor-stars.png'), star_sheet(cat, tiles))
    log(f'stars: {len(icons)} icons in {time.time() - t0:.1f}s')


def star_sheet(cat, tiles):
    """10 shapes (rows) x 5 shades (columns) on the dark sky, 160 px tiles."""
    return checker_sheet(tiles, 5, 160, pad=16)


def read_provenance():
    path = os.path.join(GEN_DIR, 'provenance.json')
    return json.load(open(path)) if os.path.exists(path) else {}


def write_provenance(prov):
    os.makedirs(GEN_DIR, exist_ok=True)
    with open(os.path.join(GEN_DIR, 'provenance.json'), 'w') as fh:
        json.dump(prov, fh, indent=2, sort_keys=True)
        fh.write('\n')


def source_hashes():
    return {'tools/ai/blender/soul_decor.py': sha256_file(os.path.abspath(__file__)),
            'tools/ai/blender/soul_baseline.py': sha256_file(os.path.join(HERE, 'soul_baseline.py')),
            'packages/game-rules/src/soul-catalog.js': sha256_file(CATALOG_PATH)}


def mode_charms(cat, args):
    """Build the charm GLB + PNG for every requested id whose icon exists; records them in provenance.json."""
    ids = charm_ids(cat, args.only.split(',') if args.only else None, args.kind)
    out = os.path.join(GEN_DIR, 'charms')
    os.makedirs(out, exist_ok=True)
    prov = read_provenance()
    files = prov.setdefault('files', {})
    icons = prov.setdefault('icons', {})
    built, missing = [], []
    t0 = time.time()
    for cid in ids:
        src = os.path.join(ICON_DIR, cid + '.png')
        if not os.path.exists(src):
            missing.append(cid)
            continue
        rec = build_charm(cid, src, out)
        files[f'charms/{cid}.glb'] = {'bytes': rec['glbBytes'], 'triangles': rec['triangles'], 'vertices': rec['vertices'],
                                      'sha256': sha256_file(os.path.join(out, cid + '.glb'))}
        files[f'charms/{cid}.png'] = {'bytes': rec['pngBytes'], 'format': rec['pngKind'], 'sha256': sha256_file(os.path.join(out, cid + '.png'))}
        icons[cid] = {'file': f'assets-src/charms/icons/{cid}.png', 'sha256': sha256_file(src)}
        built.append(cid)
    prov.update({'generator': GENERATOR, 'catalogVersion': cat['version'], 'charm': CHARM, 'sources': source_hashes()})
    write_provenance(prov)
    log(f'charms: built {len(built)} in {time.time() - t0:.1f}s; no icon yet for {len(missing)}' + (f': {",".join(missing)}' if missing else ''))
    return built, missing


def rest_view(az_deg=SLOT['rest_azimuth'], el_deg=6.0):
    """Unit vector from the Soul toward the rest-pose camera (the phone's 3/4 yaw, like the D-27 colour renders)."""
    a, e = math.radians(az_deg), math.radians(el_deg)
    return np.array([math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)])


def compute_slots(B, p=CHARM, s=SLOT):
    """The 10 slots: frames on the goo, seated sinks, 2D positions and the check metrics (all deterministic)."""
    xz = np.array(s['layout'], float)
    F = slot_frames(B, xz, s['size'], s['sink'], p)
    if not F['ok'].all():
        raise SystemExit('slot layout point misses the body')
    sink, _ = seat_sink(slot_metrics(B, F, p), F, p, s)
    F = slot_frames(B, xz, s['size'], sink, p)
    M = slot_metrics(B, F, p)
    view = rest_view()
    T = p['thickness'] * s['size']
    slots = []
    for i in range(len(xz)):
        face = F['origin'][i] + F['normal'][i] * T  # centre of the charm's front, the icon centre seen head-on
        x2, y2 = to_view([face[0], 0.0, face[2]])
        slots.append({
            'index': i,
            'centre': to_model(F['centre'][i]), 'normal': to_model(F['normal'][i]), 'up': to_model(F['up'][i]),
            'size': s['size'], 'sink': round(float(sink[i]), 2),
            'front2d': {'x': round(x2, 1), 'y': round(y2, 1), 'r': round(s['size'] * 35.0, 2)},
            'check': {'facing': round(float(M['facing'][i]), 3), 'rest': round(float(F['normal'][i] @ view), 3),
                      'embed': round(float(M['embed'][i]), 4), 'rim': round(float(M['rim'][i]), 4),
                      'drip': [round(float(v), 4) for v in M['drip'][i]]},
        })
    return slots, F


def slot_problems(B, slots, F, s=SLOT, p=CHARM):
    """Hard rules for the layout (the same ones tools/ai/test/soul-decor.test.js asserts)."""
    out = []
    c = F['centre']
    R = s['size'] / 2
    D = np.linalg.norm(c[:, None] - c[None], axis=-1)
    np.fill_diagonal(D, 9.0)
    if len(slots) != s['count']:
        out.append(f'{len(slots)} slots != {s["count"]}')
    if D.min() < s['size'] + s['gap']:
        out.append(f'centre spacing {D.min():.3f} < size + gap {s["size"] + s["gap"]:.3f}')
    for sl, ci in zip(slots, c):
        k = sl['check']
        if k['facing'] < s['facing'] or k['rest'] < s['rest_facing']:
            out.append(f'slot {sl["index"]}: faces away (front {k["facing"]}, rest pose {k["rest"]})')
        if k['embed'] > s['embed_max'] * s['size'] + 1e-4 or k['rim'] < s['rim_min'] * s['size'] - 1e-4 \
                or not (s['sink_range'][0] - 1e-9 <= sl['sink'] <= s['sink_range'][1] + 1e-9):
            out.append(f'slot {sl["index"]}: not seated (sink {sl["sink"]}, embed {k["embed"]}, rim {k["rim"]})')
        lim = [v * s['size'] for v in s['drip_limits']]
        if max(k['drip'][:3]) > lim[0] or k['drip'][3] > lim[1] or k['drip'][4] > lim[2]:
            out.append(f'slot {sl["index"]}: a drip reaches under the charm face {k["drip"]}')
        if ci[2] + R > s['top']:
            out.append(f'slot {sl["index"]}: above z {s["top"]} (bandana)')
        for ec, en, er in B.eyes:
            if np.linalg.norm(ci - ec) < er + FACE_CLEAR['glasses'] + R:
                out.append(f'slot {sl["index"]}: overlaps the glasses')
        for bc in blush_centres(B):  # the blush ellipse grown by the charm radius + margin, in the front view
            ex_ = (ci[0] - bc[0]) / (BLUSH['rx'] + R + FACE_CLEAR['blush'])
            ez_ = (ci[2] - bc[2]) / (BLUSH['ry'] + R + FACE_CLEAR['blush'])
            if ex_ * ex_ + ez_ * ez_ < 1.0:
                out.append(f'slot {sl["index"]}: overlaps a cheek')
        for sx in (-1.0, 1.0):
            dz = min(max(ci[2], -0.1), SLIT_TOP)
            if math.hypot(ci[0] - sx * sb.BASE['slit']['x'], ci[2] - dz) < R + 0.035:
                out.append(f'slot {sl["index"]}: too close to an arm slit')
        if ci[2] - R < 0.10:
            out.append(f'slot {sl["index"]}: on the feet')
        if abs(ci[0]) < 0.36 and ci[2] + R > CREASE['z0'] - (CREASE['z0'] - CREASE['z1']) * (ci[0] / CREASE['x1']) ** 2 - 0.005:
            out.append(f'slot {sl["index"]}: crosses the chin crease')
    # nothing of the body stands between a charm and the camera, front and rest pose (5 points across each face)
    T = p['thickness'] * s['size']
    face = np.array([[0, 0, T / s['size']], [0.3, 0, 0.2], [-0.3, 0, 0.2], [0, 0.3, 0.2], [0, -0.3, 0.2]])
    rays, tags = [], []
    for name, view in (('front', np.array([0.0, -1.0, 0.0])), ('rest pose', rest_view())):
        for i, sl in enumerate(slots):
            pts = charm_to_world(F, i, face) + F['normal'][i][None] * 0.004 + view[None] * 0.002
            rays += [(q, view) for q in pts]
            tags += [(name, sl['index'])] * len(pts)
    _, hit = sb.march(B.full, np.array([r[0] for r in rays]), np.array([r[1] for r in rays]), 0.0, 1.6, 320)
    for name, idx in sorted({t for t, h in zip(tags, hit) if h}):
        out.append(f'slot {idx}: hidden by the body in the {name} view')
    return out


def mode_slots(B, args):
    slots, F = compute_slots(B)
    probs = slot_problems(B, slots, F)
    os.makedirs(GEN_DIR, exist_ok=True)
    with open(os.path.join(GEN_DIR, 'slots.json'), 'w') as fh:
        json.dump({'size': SLOT['size'], 'thickness': CHARM['thickness'], 'slots': slots}, fh, indent=2)
        fh.write('\n')
    for sl in slots:
        log(f'slot {sl["index"]}: model {sl["centre"]} n {sl["normal"]} 2D {sl["front2d"]} {sl["check"]}')
    if probs:
        raise SystemExit('slot problems:\n  ' + '\n  '.join(probs))
    return slots




# ------------------------------------------------------------------------------------------------ face kits + review renders (Blender)
def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mode_faces(cat, B, args):
    """Build face-<face>.glb (model space) and face-<face>-front.png (800 x 800 front sprite, body as holdout)."""
    out = os.path.join(GEN_DIR, 'faces')
    near = NearBody(B, [-0.7, -0.7, 0.7], [0.7, 0.7, 2.4])
    prov = read_provenance()
    files = prov.setdefault('files', {})
    new_scene()
    for f in FACES:
        rec = build_kit(near, f, out)
        files[f'faces/face-{f}.glb'] = dict(rec, sha256=sha256_file(os.path.join(out, f'face-{f}.glb')))
    weights = face_sprites(B, out, args.voxel)
    for f in FACES:
        path = os.path.join(out, f'face-{f}-front.png')
        files[f'faces/face-{f}-front.png'] = {'bytes': os.path.getsize(path), 'sha256': sha256_file(path), 'weight': weights[f]}
    prov.update({'generator': GENERATOR, 'catalogVersion': cat['version'], 'sources': source_hashes(), 'faceWeight': weights})
    write_provenance(prov)


def srgb_to_lab(rgb):
    """sRGB (0..1) -> CIE L*a*b* (D65)."""
    lin = srgb_to_linear(rgb)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def visual_weight(img, inside):
    """Front-sprite ink: sum of alpha x colour contrast (CIE76 delta E) against what the kit covers, per 1000 px of the
    800 x 800 sprite: the body (a neutral of the gradients' shared mean luminance 0.575, L* 80.4) inside the flat Soul's
    silhouette, the sky (#0B1030) outside. BR-17: the three kits stay within +-25 % of their mean."""
    lab = srgb_to_lab(img[..., :3])
    ref = np.where(inside[..., None], np.array([80.4, 0.0, 0.0]), srgb_to_lab(hex_rgb('#0B1030')))
    return round(float((img[..., 3] * np.linalg.norm(lab - ref, axis=-1)).sum() / 1000.0), 1)


def soft_glow(alpha, radius):
    """Three box blurs (~Gaussian) of a mask, radius in px."""
    a = np.asarray(alpha, float)
    r = max(1, int(radius))
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if k == ax else (0, 0) for k in range(2)], mode='constant'), axis=ax)
            a = (np.take(c, range(2 * r + 1, c.shape[ax]), axis=ax) - np.take(c, range(0, c.shape[ax] - 2 * r - 1), axis=ax)) / (2 * r + 1)
    return a


def face_sprites(B, out, voxel):
    """800 x 800 front sprites: the kit alone, orthographic over the 200 viewBox, the body as a holdout so parts behind
    it are cut away (the angel's halo ring stays whole and gets a soft warm glow, as the 3D bloom shows it)."""
    new_scene()
    body, _, _ = build_body(B, max(voxel, 0.004))
    sb.eevee_setup(800, 800)
    front_ortho_camera(800)
    tmp = os.path.join(GEN_DIR, 'renders')
    os.makedirs(tmp, exist_ok=True)
    inside = render_rgba(os.path.join(tmp, 'sprite-silhouette.png'))[..., 3] > 0.5
    body.is_holdout = True
    weights = {}
    for f in FACES:
        obs = place_kit(os.path.join(out, f'face-{f}.glb'), tag=f)
        body.hide_render = f == 'angel'
        img = render_rgba(os.path.join(tmp, f'sprite-{f}.png'))
        if f == 'angel':
            halo = np.zeros(img.shape[:2])
            for o in obs:
                o.hide_render = 'halo' not in o.name
            halo = render_rgba(os.path.join(tmp, 'sprite-halo.png'))[..., 3]
            for o in obs:
                o.hide_render = False
            g = np.clip(soft_glow(halo, 9) * 0.75, 0, 1)
            warm = hex_rgb(KIT_COLOURS['halo']['emit'])
            a = img[..., 3:4]
            out_a = a + g[..., None] * (1 - a)
            img = np.concatenate([(img[..., :3] * a + warm * g[..., None] * (1 - a)) / np.maximum(out_a, 1e-6), out_a], 2)
        for o in obs:
            bpy.data.objects.remove(o)
        n_, kind, _ = save_png_small(os.path.join(out, f'face-{f}-front.png'), to_u8(img))
        weights[f] = visual_weight(img, inside)
        log(f'face sprite {f}: {n_} bytes ({kind}), visual weight {weights[f]}')
    body.hide_render = False
    return weights


def label(cam_ob, text, size=0.042, y=-0.455):
    """A caption on a dark bar along the bottom of the frame (text and bar parented to the camera)."""
    cu = bpy.data.curves.new('label', 'FONT')
    cu.body = text
    cu.align_x = 'CENTER'
    cu.size = 1.0
    ob = bpy.data.objects.new('label', cu)
    bpy.context.scene.collection.objects.link(ob)
    cam = cam_ob.data
    d = 3.0
    half_h = d * (cam.sensor_height / 2) / cam.lens if cam.type == 'PERSP' else cam.ortho_scale / 2
    ob.parent = cam_ob
    ob.location = (0.0, y * 2 * half_h, -d)
    ob.scale = (size * 2 * half_h,) * 3
    m = bpy.data.materials.get('label_mat')
    if m is None:
        m = bpy.data.materials.new('label_mat')
        m.use_nodes = True
        em = m.node_tree.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (0.85, 0.87, 0.95, 1.0)
        em.inputs['Strength'].default_value = 1.0
        m.node_tree.links.new(em.outputs[0], m.node_tree.nodes['Material Output'].inputs['Surface'])
    cu.materials.append(m)
    bar_h = 2.6 * size * 2 * half_h
    verts = [(-2 * half_h, 0, 0), (2 * half_h, 0, 0), (2 * half_h, bar_h, 0), (-2 * half_h, bar_h, 0)]
    me = bpy.data.meshes.new('label_bar')
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    bar = bpy.data.objects.new('label_bar', me)
    bpy.context.scene.collection.objects.link(bar)
    bar.parent = cam_ob
    bar.location = (0.0, -half_h, -d - 0.001)
    bm = bpy.data.materials.get('label_bar_mat')
    if bm is None:
        bm = bpy.data.materials.new('label_bar_mat')
        bm.use_nodes = True
        em = bm.node_tree.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = sb.hex_lin('#0B1030')
        bm.node_tree.links.new(em.outputs[0], bm.node_tree.nodes['Material Output'].inputs['Surface'])
    me.materials.append(bm)
    ob['bar'] = bar.name
    return ob


class SoulStage:
    """One baked body reused for every review render: gradient, face kit and charms swap in and out."""

    def __init__(self, B, cat, voxel):
        new_scene()
        self.B, self.cat = B, cat
        self.body, self.verts, self.mask = build_body(B, voxel)
        self.mat = body_material('#FFFFFF')
        self.body.data.materials.append(self.mat)
        self.slots = json.load(open(os.path.join(GEN_DIR, 'slots.json')))['slots']
        self.extra = []

    def set_gradient(self, grad):
        bake_gradient(self.body, self.verts, self.mask, grad, self.cat['gradientSpan'], self.B.floor)
        sb._in(self.mat.node_tree.nodes['Principled BSDF'], 'Emission Color').default_value = sb.hex_lin(grad['glow'])

    def decorate(self, face=None, charms=()):
        self.clear()
        if face:
            self.extra += place_kit(os.path.join(GEN_DIR, 'faces', f'face-{face}.glb'), tag=face)
        for sl, cid in zip(self.slots, charms):
            self.extra.append(place_charm(cid, sl, os.path.join(GEN_DIR, 'charms')))

    def clear(self):
        for o in self.extra:
            bpy.data.objects.remove(o)
        self.extra = []

    def shot(self, path, W, H, az=SLOT['rest_azimuth'], el=6.0, fill=0.86, target_z=1.12, caption=None, cam=None):
        sb.eevee_setup(W, H)
        cam_ob = sb.set_camera(cam or sb.orbit_cam(az, el_deg=el, W=W, H=H, fill=fill, target_z=target_z), W, H)
        lab = label(cam_ob, caption) if caption else None
        bpy.context.scene.render.film_transparent = False
        bpy.context.scene.render.image_settings.color_mode = 'RGB'
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        tile = load_rgba(path)[..., :3]
        halos = [o for o in self.extra if '_halo' in o.name]
        if halos:
            # the halo's light, as the scenes' bloom shows it: its own coverage (the body still occludes it), blurred
            others = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o not in halos]
            for o in others:
                o.is_holdout = True
            if lab:
                lab.hide_render = True
                bar_ob = bpy.data.objects.get(lab.get('bar', ''))
                if bar_ob:
                    bar_ob.hide_render = True
            a = render_rgba(path[:-4] + '-halo.png')[..., 3]
            for o in others:
                o.is_holdout = False
            tile = np.clip(tile + hex_rgb(KIT_COLOURS['halo']['emit'])[None, None] * soft_glow(a, max(3, W // 70))[..., None] * 0.55, 0, 1)
        if lab:
            bar = bpy.data.objects.get(lab.get('bar', ''))
            if bar:
                bpy.data.objects.remove(bar)
            bpy.data.objects.remove(lab)
        return tile


def grid_sheet(tiles, cols, pad=10, bg=(0.043, 0.063, 0.19)):
    """Tiles (H, W, 3 float) of one size in a grid on the sky colour -> uint8 RGB."""
    H, W = tiles[0].shape[:2]
    rows = (len(tiles) + cols - 1) // cols
    img = np.ones((rows * (H + pad) + pad, cols * (W + pad) + pad, 3)) * np.array(bg)
    for i, t in enumerate(tiles):
        r_, c_ = divmod(i, cols)
        img[pad + r_ * (H + pad):pad + r_ * (H + pad) + H, pad + c_ * (W + pad):pad + c_ * (W + pad) + W] = t
    return to_u8(img)


def pick_charms(cat, mix, seed):
    """A deterministic charm mix {kind: count} from the charms that are built (review renders only)."""
    rng = np.random.default_rng(seed)
    out = []
    for kind, k in mix.items():
        pool = [c['id'] for c in cat['charms'] if c['kind'] == kind and os.path.exists(os.path.join(GEN_DIR, 'charms', c['id'] + '.glb'))]
        out += [pool[i] for i in rng.choice(len(pool), size=k, replace=False)]
    return [out[i] for i in rng.permutation(len(out))]


def slot_markers(slots):
    """Numbered discs at the slots (decor-slots.png)."""
    obs = []
    m = bpy.data.materials.new('slot_mark')
    m.use_nodes = True
    sb.set_bsdf(m.node_tree.nodes['Principled BSDF'], base=sb.hex_lin('#FF4FA3'), rough=0.4, emit=sb.hex_lin('#FF4FA3'), emit_str=0.6)
    for sl in slots:
        O, ex, up, n = slot_basis_blender(sl)
        t = np.linspace(0, 2 * math.pi, 48, endpoint=False)
        r = sl['size'] / 2
        c = O + n * (CHARM['thickness'] * sl['size'] * 0.8)
        ring = c[None] + r * (np.cos(t)[:, None] * ex[None] + np.sin(t)[:, None] * up[None])
        verts = np.vstack([c[None], ring])
        tris = np.array([[0, 1 + i, 1 + (i + 1) % 48] for i in range(48)])
        ob = mesh_object(f'slot_{sl["index"]}', verts, tris)
        ob.data.materials.append(m)
        obs.append(ob)
        cu = bpy.data.curves.new('n', 'FONT')
        cu.body = str(sl['index'])
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.size = sl['size'] * 0.7
        tob = bpy.data.objects.new(f'slot_n{sl["index"]}', cu)
        bpy.context.scene.collection.objects.link(tob)
        tob.location = Vector((c + n * 0.004).tolist())
        tob.rotation_euler = Vector(n.tolist()).to_track_quat('Z', 'Y').to_euler()
        wm = bpy.data.materials.get('slot_num') or bpy.data.materials.new('slot_num')
        wm.use_nodes = True
        sb.set_bsdf(wm.node_tree.nodes['Principled BSDF'], base=(1, 1, 1, 1), emit=(1, 1, 1, 1), emit_str=1.5)
        cu.materials.append(wm)
        obs.append(tob)
    return obs


def mode_renders(cat, B, args):
    """Review sheets in reports/qa/screens/ (Eevee, the D-27 colour-render look: AgX, key / fill / rim area lights)."""
    t0 = time.time()
    rdir = os.path.join(GEN_DIR, 'renders')
    os.makedirs(rdir, exist_ok=True)
    os.makedirs(QA_DIR, exist_ok=True)
    st = SoulStage(B, cat, args.voxel)
    G = {g['id']: g for g in cat['gradients']}
    # slots: front (the 2D mapping's view) and the 3/4 rest pose, numbered discs at charm size
    st.set_gradient(G['sky'])
    marks = slot_markers(st.slots)
    tiles = [st.shot(os.path.join(rdir, 'slots-front.png'), 700, 800, az=0.0, el=0.0, fill=0.8, target_z=1.03, caption='slots, front'),
             st.shot(os.path.join(rdir, 'slots-rest.png'), 700, 800, fill=0.8, target_z=1.03, caption='slots, rest pose')]
    for o in marks:
        bpy.data.objects.remove(o)
    save_png(os.path.join(QA_DIR, 'decor-slots.png'), grid_sheet(tiles, 2))
    log(f'renders: decor-slots in {time.time() - t0:.0f}s')
    # 12 plain Souls, one per gradient
    tiles = []
    for g in cat['gradients']:
        st.set_gradient(g)
        tiles.append(st.shot(os.path.join(rdir, f'gradient-{g["id"]}.png'), 420, 500, fill=0.8, target_z=1.03, caption=g['name']))
    save_png(os.path.join(QA_DIR, 'decor-gradients.png'), grid_sheet(tiles, 6))
    log(f'renders: decor-gradients in {time.time() - t0:.0f}s')
    # 3 faces x 3 gradients
    tiles = []
    for gid in ('lagoon', 'coral', 'lemonade'):
        st.set_gradient(G[gid])
        for f in FACES:
            st.decorate(face=f)
            tiles.append(st.shot(os.path.join(rdir, f'face-{f}-{gid}.png'), 480, 560, fill=0.8, target_z=1.03, caption=f'{f}, {G[gid]["name"]}'))
    st.clear()
    save_png(os.path.join(QA_DIR, 'decor-faces.png'), grid_sheet(tiles, 3))
    log(f'renders: decor-faces in {time.time() - t0:.0f}s')
    # 6 decorated Souls
    examples = [('aurora', 'nerdy', {'technical': 4, 'core': 4, 'soft': 2}), ('sunset', 'pirate', {'technical': 8, 'soft': 1, 'core': 1}),
                ('orchid', 'angel', {'soft': 6, 'technical': 2, 'core': 2}), ('mint', 'nerdy', {'core': 10}),
                ('berry', 'pirate', {'technical': 5, 'core': 3, 'soft': 2}), ('twilight', 'angel', {'soft': 4, 'technical': 4, 'core': 2})]
    tiles = []
    for k, (gid, f, mix) in enumerate(examples):
        st.set_gradient(G[gid])
        st.decorate(face=f, charms=pick_charms(cat, mix, 100 + k))
        mix_s = ' / '.join(f'{v} {kk}' for kk, v in mix.items())
        tiles.append(st.shot(os.path.join(rdir, f'example-{k}.png'), 560, 660, fill=0.8, target_z=1.03, caption=f'{G[gid]["name"]}, {f}, {mix_s}'))
    save_png(os.path.join(QA_DIR, 'decor-examples.png'), grid_sheet(tiles, 3))
    log(f'renders: decor-examples in {time.time() - t0:.0f}s')
    # close-ups of charms seated in the goo: belly (rest pose), left arm and shoulder, a grazing side view
    st.set_gradient(G['lilac'])
    st.decorate(face=None, charms=pick_charms(cat, {'technical': 4, 'core': 3, 'soft': 3}, 7))
    tiles = [st.shot(os.path.join(rdir, 'close-belly.png'), 640, 640, az=20.0, el=8.0, fill=2.3, target_z=0.48, caption='belly, rest pose'),
             st.shot(os.path.join(rdir, 'close-arm.png'), 640, 640, az=-42.0, el=6.0, fill=2.3, target_z=0.55, caption='left arm and shoulder'),
             st.shot(os.path.join(rdir, 'close-side.png'), 640, 640, az=62.0, el=2.0, fill=2.3, target_z=0.5, caption='grazing view: seated in the goo')]
    st.clear()
    save_png(os.path.join(QA_DIR, 'decor-charms-sample.png'), grid_sheet(tiles, 3))
    log(f'renders: done in {time.time() - t0:.0f}s')


# ------------------------------------------------------------------------------------------------ data module
RUNTIME_DIR = {'charms': os.path.join(ROOT, 'assets', 'souls', 'charms'), 'faces': os.path.join(ROOT, 'assets', 'souls', 'faces')}
FACES = ('nerdy', 'pirate', 'angel')
SHA_CHARS = 10  # cache-busting query length (hex of the file's sha256)


def asset_file(group, name):
    """The staged Blender output, else the runtime copy (the staged PNGs are git-ignored), else None."""
    for base in (os.path.join(GEN_DIR, group), RUNTIME_DIR[group]):
        p = os.path.join(base, name)
        if os.path.exists(p):
            return p
    return None


def baseline_landmarks():
    for base in (os.path.join(ROOT, 'assets', 'souls', 'baseline'), os.path.join(ROOT, 'assets-src', 'generated', 'soul-baseline', 'v1')):
        path = os.path.join(base, 'soul-baseline-hero.glb')
        if os.path.exists(path):
            return read_glb(path)[0]['asset']['extras']['landmarks']
    raise SystemExit('baseline GLB not found (assets/souls/baseline/soul-baseline-hero.glb)')


def _clean(v):
    """JSON-ready copy: -0.0 -> 0.0, integral floats kept as floats except where given as int."""
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, float):
        return v + 0.0 if v != 0 else 0.0
    return v


def decor_data(cat):
    """The data module's object (same shape as the stage-12 stub, plus additive fields)."""
    lm = baseline_landmarks()
    slots_doc = json.load(open(os.path.join(GEN_DIR, 'slots.json')))
    files, missing = {}, []
    for ch in cat['charms']:
        g, p_ = asset_file('charms', ch['id'] + '.glb'), asset_file('charms', ch['id'] + '.png')
        if not g or not p_:
            missing.append(ch['id'])
            continue
        files[ch['id']] = {'glb': f"{RUNTIME_URL['charms']}{ch['id']}.glb?v={sha256_file(g)[:SHA_CHARS]}",
                           'png': f"{RUNTIME_URL['charms']}{ch['id']}.png?v={sha256_file(p_)[:SHA_CHARS]}"}
    faces = {}
    for f in FACES:
        g, sp = asset_file('faces', f'face-{f}.glb'), asset_file('faces', f'face-{f}-front.png')
        if not g or not sp:
            raise SystemExit(f'face kit {f} is not built yet (run --mode faces)')
        faces[f] = {'glb': f"{RUNTIME_URL['faces']}face-{f}.glb?v={sha256_file(g)[:SHA_CHARS]}",
                    'sprite': f"{RUNTIME_URL['faces']}face-{f}-front.png?v={sha256_file(sp)[:SHA_CHARS]}"}
    slots = [{k: sl[k] for k in ('index', 'centre', 'normal', 'up', 'size', 'sink', 'front2d')} for sl in slots_doc['slots']]
    return _clean({
        'stub': False,
        'version': 1,
        'catalogVersion': cat['version'],
        'generator': f'{GENERATOR} --mode produce (npm run ai:soul-decor)',
        'frame': 'glTF model space of assets/souls/baseline/soul-baseline-*.glb: +Y up, +Z front, model units, feet at y = floor',
        'floor': lm['floor'],
        'height': lm['height'],
        'gradientSpan': {'top': cat['gradientSpan']['top'], 'bottom': cat['gradientSpan']['bottom']},
        'charm': {
            'thickness': CHARM['thickness'],
            'files': files,
            'missing': missing,
        },
        'slots': slots,
        'faces': faces,
        'sprite2d': {'viewBox': 200, 'size': 800, 'map': {'x0': 100, 'sx': 70, 'y0': 178.6, 'sy': -70}},
        'source': {'generator': GENERATOR, 'sha256': source_hashes(), 'slots': 'assets-src/generated/soul-decor/v1/slots.json'},
    })


def data_module_text(cat):
    d = decor_data(cat)
    body = json.dumps(d, indent=2, ensure_ascii=True)
    head = [
        '// GENERATED FILE - do not hand-edit. Regenerate with: npm run ai:soul-decor (tools/ai/blender/soul_decor.py --mode produce).',
        '// Decoration geometry and files for the baseline Soul (D-29, docs/art/soul-decorations.md): the 10 charm slots (model space',
        '// + 2D viewBox), charm and face-kit file URLs, and the 2D sprite mapping. Frozen data, no imports: Node and browsers.',
        '// charm.files lists only the charms whose GLB and PNG exist; charm.missing names the rest (the renderer skips them).',
        '// Every URL carries ?v=<sha256 prefix> of its file. A charm GLB loads its texture as the relative URI <id>.png (sRGB,',
        '// glTF UV orientation); a loader that keeps the query string can map that URI to files[id].png.',
        '// A charm PNG (128 px) is also its flat 2D sprite: the outline circle is the image\'s inscribed circle, so it is drawn',
        '// 2 r wide centred on slots[i].front2d. slots[i].sink seats each charm (fraction of charm.thickness x size).',
    ]
    return '\n'.join(head) + '\n\nfunction deepFreeze(o) {\n  if (o && typeof o === \'object\' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }\n  return o;\n}\n\nexport const SOUL_DECOR = deepFreeze(' + body + ');\n\nexport default SOUL_DECOR;\n'


def mode_data(cat, B, args):
    text = data_module_text(cat)
    if args.check:
        cur = open(DATA_JS, encoding='utf8').read() if os.path.exists(DATA_JS) else ''
        if cur != text:
            raise SystemExit(f'STALE: {os.path.relpath(DATA_JS, ROOT)} differs from a fresh generation (npm run ai:soul-decor -- --mode data)')
        log('data module is current')
        return
    with open(DATA_JS, 'w', encoding='utf8') as fh:
        fh.write(text)
    d = decor_data(cat)
    log(f"data: wrote {os.path.relpath(DATA_JS, ROOT)} ({len(text.encode())} bytes, {len(d['charm']['files'])} charms"
        + (f", missing {len(d['charm']['missing'])}: {','.join(d['charm']['missing'])}" if d['charm']['missing'] else '') + ')')


def parse(argv):
    ap = argparse.ArgumentParser(description='Soul decorations (D-29): stars, charms, face kits, slots, renders, data module')
    ap.add_argument('--mode', default='produce', choices=['produce', 'stars', 'charms', 'slots', 'faces', 'renders', 'data'])
    ap.add_argument('--only', default=None, help='comma-separated charm ids (stars / charms)')
    ap.add_argument('--kind', default=None, choices=['core', 'technical', 'soft'], help='charm kind (charms)')
    ap.add_argument('--voxel', type=float, default=0.003, help='body voxel size for the review renders')
    ap.add_argument('--check', action='store_true', help='data: exit 1 when the checked-in module is stale')
    ap.add_argument('--skip-renders', action='store_true', help='produce: build assets and data only')
    return ap.parse_args(argv)


def main(argv):
    args = parse(argv)
    cat = read_catalog()
    t0 = time.time()
    needs_blender = args.mode in ('produce', 'charms', 'faces', 'renders')
    if needs_blender and bpy is None:
        raise SystemExit(f'--mode {args.mode} runs inside Blender: Blender --background --factory-startup --python {GENERATOR} -- --mode {args.mode}')
    if args.mode in ('stars', 'produce'):
        mode_stars(cat, args)
    if args.mode in ('charms', 'produce'):
        mode_charms(cat, args)
    B = None
    if args.mode in ('slots', 'produce', 'faces', 'renders'):
        B = Body()
    if args.mode in ('slots', 'produce'):
        mode_slots(B, args)
    if args.mode in ('faces', 'produce'):
        mode_faces(cat, B, args)
    if args.mode in ('data', 'produce'):
        mode_data(cat, B, args)
    if args.mode == 'renders' or (args.mode == 'produce' and not args.skip_renders):
        mode_renders(cat, B, args)
    log(f'{args.mode} done in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    # Inside Blender its own flags fill sys.argv, so script args follow '--'; under plain python3 they are argv[1:].
    in_blender = bpy is not None
    raw = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ([] if in_blender else sys.argv[1:])
    main(raw)

