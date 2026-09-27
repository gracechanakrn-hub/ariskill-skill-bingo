#!/usr/bin/env python3
"""tools/assets/build-soul-shape.py - the flat front view of the Arise Soul baseline, for the 2D SVG renderer.

Writes packages/ui/soul-baseline-shape.js (checked in, generated, deterministic) from the same signed-distance
model that builds the 3D Soul (tools/ai/blender/soul_baseline.py, docs/art/soul-baseline.md), so the flat Soul in
thumbnails, the public Galaxy atlas and the fallbacks is a projection of the 3D character, not a redrawing.

How
  1. Build the model's op list exactly as the 3D build does (body + button eyes + the 25 reference drips + 18 seeded
     back drips) and sample it on a regular grid (STEP, 4 mm). Per image column (x, z) keep the smallest field value
     along the view axis (the silhouette field) and the first surface crossing seen from the front (the character
     faces -Y; the front view looks along +Y, orthographic, so the character's left lands on the viewer's right).
  2. Silhouette: marching squares on the silhouette field, then a least-squares cubic Bezier fit (Schneider) to
     TOLERANCE viewBox units.
  3. Surface masks at the front points come from the model's own vertex_masks (R drips, G eye discs, B groove ring),
     so the 2D colours land where the 3D palette material puts them. Each drip blob becomes an ellipse (image
     moments; a blob that one ellipse fits badly is split) and is written as a round-capped stroke; the eyes become
     the disc ellipse plus the groove-ring centre line.
  4. Inner lines: the chin crease is the valley between head and belly in the body-only depth map (no drips, no
     eyes), the arm slits are the see-through gaps between belly and arms in the body-only silhouette field.
  5. Highlight: where the head normal best mirrors the 3D key light (soul_baseline.eevee_setup) into the viewer;
     the orb gets the same specular point.
  6. Model (x, z) maps to viewBox (CX + SCALE * x, Y0 - SCALE * z); Y0 centres the figure (feet .. orb) at y 100.
     Every coordinate is rounded to 0.1.

Run (Blender 5.2 bundles numpy; the model module also imports in plain python3 + numpy, but Blender is the reference):
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python tools/assets/build-soul-shape.py -- [--check] [--debug <dir>]
  --check   exit 1 if the generated module differs from the checked-in one (nothing is written)
  --debug   also write front-shaded.png (numpy shading of the front surface) and overlay.svg (the extracted
            geometry drawn over it) for review
About 10 s. Same model + same script -> byte-identical module (packages/ui/test/soul-renderer.test.js checks the
recorded model and drip-list hashes, so a model change without a regenerated shape fails the tests).
"""
import argparse
import hashlib
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MODEL_DIR = os.path.join(ROOT, 'tools', 'ai', 'blender')
sys.path.insert(0, MODEL_DIR)
sys.dont_write_bytecode = True  # no __pycache__ next to the checked-in sources
import soul_baseline as sb  # noqa: E402  (the 3D model; importing it defines functions only)

OUT_JS = os.path.join(ROOT, 'packages', 'ui', 'soul-baseline-shape.js')
SHAPE_VERSION = '1.0.0'
GENERATOR = 'tools/assets/build-soul-shape.py'

STEP = 0.004                                  # grid step, model units (the 3D mesh uses 3 mm voxels)
LO = np.array([-0.80, -0.62, -0.08])
HI = np.array([0.80, 0.58, 2.30])
SCALE = 70.0                                  # viewBox units per model unit (1 model unit = 290 reference px)
CX = 100.0                                    # viewBox x of the model's vertical axis
VIEW_CENTRE_Y = 100.0                         # the figure's vertical extent is centred here
TOLERANCE = 0.4                               # max silhouette fit error, viewBox units (0.48 px at 240 px)
DRIP_MIN_R = 0.9                              # drips smaller than this equivalent radius (viewBox units) are dropped
DRIP_SPLIT_IOU = 0.85                         # a drip blob an ellipse covers worse than this is split in two (clusters)
KEY_LIGHT = np.array([-2.2, -3.0, 3.6])       # soul_baseline.eevee_setup key light (upper left, in front)


def log(*a):
    print('[soul-shape]', *a, flush=True)


# ------------------------------------------------------------------------------------------------ sampling
def scan(ops, step=STEP, lo=LO, hi=HI, slab=10):
    """Front orthographic scan: silhouette field g(x, z) = min_y f and the first crossing y_front(x, z)."""
    n = (np.ceil((hi - lo) / step).astype(int) + 1)
    xs = (lo[0] + step * np.arange(n[0])).astype(np.float32)
    ys = (lo[1] + step * np.arange(n[1])).astype(np.float32)
    zs = (lo[2] + step * np.arange(n[2])).astype(np.float32)
    g = np.full((n[0], n[2]), 10.0, np.float64)
    front = np.full((n[0], n[2]), np.nan, np.float64)
    for k0 in range(0, n[2], slab):
        zk = zs[k0:k0 + slab]
        d = sb.eval_box(ops, xs, ys, zk, 3 * step).astype(np.float64)
        g[:, k0:k0 + len(zk)] = d.min(axis=1)
        inside = d < 0
        hit = inside.any(axis=1)
        j = inside.argmax(axis=1)
        ii, kk = np.nonzero(hit)
        jj = j[ii, kk]
        jp = np.maximum(jj - 1, 0)
        d1 = d[ii, jp, kk]
        d2 = d[ii, jj, kk]
        t = np.where(jj > 0, d1 / np.maximum(d1 - d2, 1e-12), 0.0)
        front[ii, k0 + kk] = ys[jp].astype(np.float64) + t * step
    return xs.astype(np.float64), ys.astype(np.float64), zs.astype(np.float64), g, front


def depth_normals(front, step=STEP):
    """Unit normals (toward the viewer, -Y) of the front surface y = Y(x, z) by central differences."""
    dx = np.gradient(front, step, axis=0)
    dz = np.gradient(front, step, axis=1)
    nrm = np.stack([dx, -np.ones_like(dx), dz], axis=-1)
    return nrm / np.linalg.norm(nrm, axis=-1, keepdims=True)


# ------------------------------------------------------------------------------------------------ contours
_SEGS = {1: [(3, 0)], 2: [(0, 1)], 3: [(3, 1)], 4: [(1, 2)], 6: [(0, 2)], 7: [(3, 2)], 8: [(2, 3)], 9: [(0, 2)],
         11: [(1, 2)], 12: [(1, 3)], 13: [(0, 1)], 14: [(0, 3)]}


def contours(V, xs, zs, level=0.0):
    """Closed iso-lines of V (nx, nz) at `level` (inside is V < level) as (N, 2) arrays of (x, z) points."""
    nx, nz = V.shape
    ins = V < level
    case = (ins[:-1, :-1].astype(np.int32) | (ins[1:, :-1].astype(np.int32) << 1) |
            (ins[1:, 1:].astype(np.int32) << 2) | (ins[:-1, 1:].astype(np.int32) << 3))

    def edge(i, k, e):  # 0 bottom, 1 right, 2 top, 3 left -> (kind, i, k) with kind 0 = along x, 1 = along z
        return {0: (0, i, k), 1: (1, i + 1, k), 2: (0, i, k + 1), 3: (1, i, k)}[e]

    adj = {}
    for i, k in zip(*np.nonzero((case > 0) & (case < 15))):
        c = int(case[i, k])
        if c in (5, 10):
            centre = (V[i, k] + V[i + 1, k] + V[i + 1, k + 1] + V[i, k + 1]) / 4 < level
            segs = ([(0, 1), (2, 3)] if centre else [(3, 0), (1, 2)]) if c == 5 else ([(3, 0), (1, 2)] if centre else [(0, 1), (2, 3)])
        else:
            segs = _SEGS[c]
        for a, b in segs:
            ea, eb = edge(i, k, a), edge(i, k, b)
            adj.setdefault(ea, []).append(eb)
            adj.setdefault(eb, []).append(ea)

    def point(e):
        kind, i, k = e
        if kind == 0:
            v0, v1 = V[i, k], V[i + 1, k]
            t = (level - v0) / (v1 - v0)
            return xs[i] + t * (xs[i + 1] - xs[i]), zs[k]
        v0, v1 = V[i, k], V[i, k + 1]
        t = (level - v0) / (v1 - v0)
        return xs[i], zs[k] + t * (zs[k + 1] - zs[k])

    loops, seen = [], set()
    for start in sorted(adj):
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [e for e in adj[cur] if e != prev]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            if cur == start:
                break
            if cur in seen:
                break
            seen.add(cur)
            loop.append(cur)
        if len(loop) > 8:
            loops.append(np.array([point(e) for e in loop]))
    return loops


def signed_area(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


# ------------------------------------------------------------------------------------------------ Bezier fitting
def _bez(c, t):
    mt = 1.0 - t
    return ((mt ** 3)[:, None] * c[0] + (3 * mt * mt * t)[:, None] * c[1] + (3 * mt * t * t)[:, None] * c[2] + (t ** 3)[:, None] * c[3])


def _bez1(c, t):
    mt = 1.0 - t
    return (3 * mt * mt)[:, None] * (c[1] - c[0]) + (6 * mt * t)[:, None] * (c[2] - c[1]) + (3 * t * t)[:, None] * (c[3] - c[2])


def _bez2(c, t):
    mt = 1.0 - t
    return (6 * mt)[:, None] * (c[2] - 2 * c[1] + c[0]) + (6 * t)[:, None] * (c[3] - 2 * c[2] + c[1])


def _unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def _chord(P):
    d = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    return d / d[-1]


def _generate(P, u, t1, t2):
    p0, p3 = P[0], P[-1]
    mt = 1.0 - u
    b0, b1, b2, b3 = mt ** 3, 3 * mt * mt * u, 3 * mt * u * u, u ** 3
    A1 = b1[:, None] * t1
    A2 = b2[:, None] * t2
    C = np.array([[np.sum(A1 * A1), np.sum(A1 * A2)], [np.sum(A1 * A2), np.sum(A2 * A2)]])
    tmp = P - (b0 + b1)[:, None] * p0 - (b2 + b3)[:, None] * p3
    X = np.array([np.sum(A1 * tmp), np.sum(A2 * tmp)])
    det = C[0, 0] * C[1, 1] - C[0, 1] * C[1, 0]
    seg = np.linalg.norm(p3 - p0)
    if abs(det) > 1e-12:
        al = (X[0] * C[1, 1] - X[1] * C[0, 1]) / det
        ar = (C[0, 0] * X[1] - C[1, 0] * X[0]) / det
    else:
        al = ar = seg / 3.0
    if al < 1e-6 * seg or ar < 1e-6 * seg:
        al = ar = seg / 3.0
    return np.array([p0, p0 + t1 * al, p3 + t2 * ar, p3])


def _max_error(P, c, u):
    d = np.linalg.norm(_bez(c, u) - P, axis=1)
    i = int(np.argmax(d))
    return float(d[i]), i


def _reparam(P, c, u):
    q, q1, q2 = _bez(c, u) - P, _bez1(c, u), _bez2(c, u)
    num = np.sum(q * q1, axis=1)
    den = np.sum(q1 * q1, axis=1) + np.sum(q * q2, axis=1)
    return np.clip(np.where(np.abs(den) > 1e-12, u - num / np.where(np.abs(den) > 1e-12, den, 1.0), u), 0.0, 1.0)


def _tangent(P, i, w=3):
    a, b = max(0, i - w), min(len(P) - 1, i + w)
    return _unit(P[b] - P[a])


def fit_cubic(P, t1, t2, err):
    """Schneider's least-squares cubic fit of an open polyline P; t1 leaves P[0], t2 leaves P[-1] backwards."""
    if len(P) < 3:
        dist = np.linalg.norm(P[-1] - P[0]) / 3.0
        return [np.array([P[0], P[0] + t1 * dist, P[-1] + t2 * dist, P[-1]])]
    u = _chord(P)
    c = _generate(P, u, t1, t2)
    e, split = _max_error(P, c, u)
    if e < err:
        return [c]
    if e < 4 * err:
        for _ in range(24):
            u = _reparam(P, c, u)
            c = _generate(P, u, t1, t2)
            e, split = _max_error(P, c, u)
            if e < err:
                return [c]
    split = min(max(split, 2), len(P) - 3)
    tc = _tangent(P, split)
    return fit_cubic(P[:split + 1], t1, -tc, err) + fit_cubic(P[split:], tc, t2, err)


def fit_closed(P, err):
    """Closed smooth curve: start at the lowest point (largest viewBox y), tangent-continuous everywhere."""
    s = int(np.argmax(P[:, 1] - 1e-6 * P[:, 0]))
    Q = np.vstack([np.roll(P, -s, axis=0), np.roll(P, -s, axis=0)[:1]])
    ring = np.vstack([Q[-4:-1], Q, Q[1:4]])
    t0 = _unit(ring[3 + 3] - ring[3 - 3])
    return fit_cubic(Q, t0, -t0, err)


# ------------------------------------------------------------------------------------------------ number / path text
def fmt(v):
    s = f'{round(float(v) + 0.0, 1):.1f}'
    if s.endswith('.0'):
        s = s[:-2]
    if s in ('-0', '-0.0'):
        s = '0'
    if s.startswith('0.'):
        s = s[1:]
    elif s.startswith('-0.'):
        s = '-' + s[2:]
    return s


def nums(vals):
    out = ''
    for v in vals:
        t = fmt(v)
        if out and not t.startswith('-'):
            out += ' '
        out += t
    return out


def r1(v):
    return round(float(v) + 0.0, 1)


def closed_path(curves):
    """Absolute rounded control points -> 'M x y c ... z' with relative cubic segments (no drift)."""
    pts = [[r1(v) for v in c.ravel()] for c in curves]
    x, y = pts[0][0], pts[0][1]
    d = 'M' + nums([x, y])
    for c in pts:
        d += 'c' + nums([c[2] - x, c[3] - y, c[4] - x, c[5] - y, c[6] - x, c[7] - y])
        x, y = c[6], c[7]
    return d + 'z'


def open_path(curves):
    pts = [[r1(v) for v in c.ravel()] for c in curves]
    x, y = pts[0][0], pts[0][1]
    d = 'M' + nums([x, y])
    for c in pts:
        d += 'c' + nums([c[2] - x, c[3] - y, c[4] - x, c[5] - y, c[6] - x, c[7] - y])
        x, y = c[6], c[7]
    return d


def drip_strokes(drips):
    """Drips as round-capped strokes, grouped by width: an ellipse (cx, cy, a, b, rot) becomes a capsule of width 2b
    (0.5 steps) and length 2a along its major axis. About 40 % of the bytes of arc ellipses, same look at Soul sizes."""
    groups = {}
    for cx, cy, a, b, rot in drips:
        w = round(4 * b) / 2
        h = max(0.05, a - w / 2)
        t = math.radians(rot)
        dx, dy = r1(2 * h * math.cos(t)), r1(2 * h * math.sin(t))
        if dx == 0 and dy == 0:
            dx = 0.1  # never a zero-length subpath
        x0, y0 = r1(cx - dx / 2), r1(cy - dy / 2)
        groups.setdefault(w, []).append('M' + nums([x0, y0]) + 'l' + nums([dx, dy]))
    return [(w, ''.join(groups[w])) for w in sorted(groups)]


# ------------------------------------------------------------------------------------------------ blobs and ellipses
def label(mask):
    """4-connected components of a boolean image -> list of index arrays (row-major discovery order)."""
    lab = np.zeros(mask.shape, np.int32)
    comps = []
    H, W = mask.shape
    for i0, k0 in zip(*np.nonzero(mask)):
        if lab[i0, k0]:
            continue
        cur = len(comps) + 1
        stack = [(i0, k0)]
        lab[i0, k0] = cur
        members = []
        while stack:
            i, k = stack.pop()
            members.append((i, k))
            for a, b in ((i + 1, k), (i - 1, k), (i, k + 1), (i, k - 1)):
                if 0 <= a < H and 0 <= b < W and mask[a, b] and not lab[a, b]:
                    lab[a, b] = cur
                    stack.append((a, b))
        comps.append(np.array(members))
    return comps


PIXEL = STEP * SCALE                          # one grid sample in viewBox units


def moment_ellipse(P):
    """Ellipse with the same first and second moments as the filled pixel set P (N, 2): (cx, cy, a, b, deg)."""
    c = P.mean(axis=0)
    cov = np.cov((P - c).T, bias=True) + np.eye(2) * (PIXEL * PIXEL / 12.0)  # pixel footprint
    w, v = np.linalg.eigh(cov)
    a, b = 2 * math.sqrt(max(w[1], 1e-12)), 2 * math.sqrt(max(w[0], 1e-12))
    ang = math.degrees(math.atan2(v[1, 1], v[0, 1]))
    ang = (ang + 90.0) % 180.0 - 90.0
    return c[0], c[1], a, b, ang


def ellipse_iou(P, e):
    cx, cy, a, b, ang = e
    t = math.radians(ang)
    dx, dy = P[:, 0] - cx, P[:, 1] - cy
    u = (dx * math.cos(t) + dy * math.sin(t)) / a
    v = (-dx * math.sin(t) + dy * math.cos(t)) / b
    inside = (u * u + v * v) <= 1.0
    area_e = math.pi * a * b
    inter = float(inside.sum()) * PIXEL * PIXEL
    return inter / (len(P) * PIXEL * PIXEL + area_e - inter)


def split_blob(P, e, depth=0):
    """Split a blob that one ellipse fits badly into two along its major axis (2-means), recursively."""
    if depth >= 2 or len(P) < 40 or ellipse_iou(P, e) >= DRIP_SPLIT_IOU:
        return [e]
    cx, cy, a, b, ang = e
    t = math.radians(ang)
    axis = np.array([math.cos(t), math.sin(t)])
    s = (P - [cx, cy]) @ axis
    cut = 0.0
    for _ in range(12):
        m1, m2 = s[s < cut].mean(), s[s >= cut].mean()
        cut = 0.5 * (m1 + m2)
    parts = [P[s < cut], P[s >= cut]]
    if min(len(p) for p in parts) < 12:
        return [e]
    out = []
    for p in parts:
        out += split_blob(p, moment_ellipse(p), depth + 1)
    return out


# ------------------------------------------------------------------------------------------------ inner lines
def chin_crease(xs, zs, yb, zlo=0.62, zhi=1.12, xmax=0.5, thr=0.02):
    """The valley between head and belly: per column the deepest front point, kept where it is a real valley
    (both sides come forward by > thr) and continuous with the centre column. [(x, z, prominence)]"""
    kz = np.nonzero((zs >= zlo) & (zs <= zhi))[0]
    found = {}
    for i in np.nonzero(np.abs(xs) <= xmax)[0]:
        col = yb[i, kz]
        if np.isnan(col).any():
            continue
        k = int(np.argmax(col))
        if k < 3 or k > len(kz) - 4:
            continue
        prom = col[k] - max(col[:k].min(), col[k + 1:].min())
        if prom > thr:
            found[int(i)] = (float(xs[i]), float(zs[kz[k]]), float(prom))
    if not found:
        return []
    centre = min(found, key=lambda i: abs(xs[i]))
    floor = 0.5 * found[centre][2]  # the line ends where the valley is half as deep as at the centre
    keep = [centre]
    for step_ in (1, -1):  # walk outward while the valley stays continuous (no jump to another feature)
        i = centre
        while ((i + step_) in found and abs(found[i + step_][1] - found[i][1]) <= 2.5 * STEP
               and found[i + step_][2] >= floor):
            i += step_
            keep.append(i)
    return [found[i] for i in sorted(keep)]


def arm_slit(xs, zs, gb, side, zlo=-0.05, zhi=1.0, xin=0.16, xout=0.70):
    """The see-through slit between belly and arm on one side (a gap in the body silhouette field between two
    solid runs), row by row from the bottom: [(x, z, width)]."""
    sel = np.nonzero((side * xs >= xin) & (side * xs <= xout))[0]
    if side < 0:
        sel = sel[::-1]  # walk outward from the belly
    out = []
    for k in np.nonzero((zs >= zlo) & (zs <= zhi))[0]:
        solid = gb[sel, k] < 0
        idx = np.nonzero(solid)[0]
        if len(idx) < 6:
            continue
        gaps = np.nonzero(np.diff(idx) > 1)[0]
        if not len(gaps):
            if out:
                break  # the slit closed; the first closed row above it ends the line
            continue
        a, b = idx[gaps[0]], idx[gaps[0] + 1]
        # sub-sample edges from the field (linear zero crossings on both sides of the gap)
        va, va1 = gb[sel[a], k], gb[sel[a + 1], k]
        vb, vb1 = gb[sel[b], k], gb[sel[b - 1], k]
        xa = xs[sel[a]] + (xs[sel[a + 1]] - xs[sel[a]]) * va / (va - va1)
        xb = xs[sel[b]] + (xs[sel[b - 1]] - xs[sel[b]]) * vb / (vb - vb1)
        out.append((0.5 * (xa + xb), float(zs[k]), abs(xb - xa)))
    return out


def fit_single(P, t1, t2, iters=24):
    """One cubic through the ordered points P with fixed end tangents (least squares + Newton reparameterisation)."""
    u = _chord(P)
    c = _generate(P, u, t1, t2)
    for _ in range(iters):
        u = _reparam(P, c, u)
        c = _generate(P, u, t1, t2)
    return c


def crease_curve(C):
    """Symmetric arch through the crease points: least-squares parabola y = a + c (x - CX)^2, written as the exact
    cubic of that parabola between the outermost points (control points on the end tangents)."""
    dx = C[:, 0] - CX
    A = np.stack([np.ones_like(dx), dx * dx], axis=1)
    a, c = np.linalg.lstsq(A, C[:, 1], rcond=None)[0]
    h = float(np.abs(dx).max())
    p0, p2 = np.array([CX - h, a + c * h * h]), np.array([CX + h, a + c * h * h])
    q = np.array([CX, a + c * h * h - 2 * c * h * h])
    err = float(np.abs(a + c * dx * dx - C[:, 1]).max())
    log(f'chin crease: parabola fit max error {err:.2f} units')
    return np.array([p0, p0 + 2 / 3 * (q - p0), p2 + 2 / 3 * (q - p2), p2])


def fit_line(pts, err):
    """Smooth open stroke through ordered points (viewBox units)."""
    P = np.asarray(pts, float)
    if len(P) < 4:
        return None
    # light smoothing of the sampled centre line (it is quantised to the grid)
    K = np.array([1, 2, 3, 2, 1], float)
    K /= K.sum()
    Ps = np.stack([np.convolve(np.pad(P[:, j], 2, mode='edge'), K, mode='valid') for j in (0, 1)], axis=1)
    Ps[0], Ps[-1] = P[0], P[-1]
    t1 = _tangent(Ps, 0, 4)
    t2 = -_tangent(Ps, len(Ps) - 1, 4)
    return fit_cubic(Ps, t1, t2, err)


# ------------------------------------------------------------------------------------------------ main
def build(debug_dir=None):
    t0 = time.time()
    body = sb.base_ops()
    eyes_ops = sb.eye_ops(body)
    frames = sb.eye_frames(body)
    ops = sb.model_ops(with_details=True, log=lambda *a: None)
    log(f'model: {len(ops)} ops ({len(body)} body, {len(eyes_ops)} eye) in {time.time() - t0:.1f}s')

    t = time.time()
    xs, ys, zs, g, front = scan(ops)
    log(f'full scan {len(xs)}x{len(ys)}x{len(zs)} in {time.time() - t:.1f}s')
    t = time.time()
    _, _, _, gb, fb = scan(body)
    log(f'body scan in {time.time() - t:.1f}s')

    # -- mapping (feet .. orb centred at VIEW_CENTRE_Y)
    loops = contours(g, xs, zs)
    loops.sort(key=lambda L: -abs(signed_area(L)))
    outer = loops[0]
    zmin, zmax = float(outer[:, 1].min()), float(outer[:, 1].max())
    y0 = r1(VIEW_CENTRE_Y + SCALE * (zmin + zmax) / 2)

    def to_view(P):
        P = np.asarray(P, float)
        return np.stack([CX + SCALE * P[..., 0], y0 - SCALE * P[..., 1]], axis=-1)

    # -- silhouette (outer loop, clockwise on screen) + see-through holes (opposite winding)
    sil = to_view(outer)
    if signed_area(sil) < 0:
        sil = sil[::-1]
    curves = fit_closed(sil, TOLERANCE)
    silhouette = closed_path(curves)
    holes = []
    for L in loops[1:]:
        V = to_view(L)
        if abs(signed_area(V)) < 4.0:  # < 4 square units: invisible
            continue
        if signed_area(V) > 0:
            V = V[::-1]
        holes.append(closed_path(fit_closed(V, TOLERANCE)))
    log(f'silhouette: {len(outer)} contour points -> {len(curves)} cubic segments, {len(holes)} holes, z {zmin:.3f}..{zmax:.3f}')

    # -- surface masks at the front points (the model's own tinting masks)
    hit = ~np.isnan(front)
    ii, kk = np.nonzero(hit)
    P = np.stack([xs[ii], front[ii, kk], zs[kk]], axis=1)
    t = time.time()
    m = sb.vertex_masks(P, body, eyes_ops, frames)
    masks = np.zeros(front.shape + (4,), np.float32)
    masks[ii, kk] = m
    log(f'masks on {len(P)} front points in {time.time() - t:.1f}s')

    def pix_to_view(idx):
        return to_view(np.stack([xs[idx[:, 0]], zs[idx[:, 1]]], axis=1))

    # drips: R > 0.5 blobs -> ellipses
    drips = []
    for comp in label(masks[..., 0] > 0.5):
        V = pix_to_view(comp)
        for part in split_blob(V, moment_ellipse(V)):
            cx, cy, a, b, ang = part
            if math.sqrt(a * b) < DRIP_MIN_R:
                continue
            drips.append((r1(cx), r1(cy), r1(a), r1(b), int(round(ang))))
    drips.sort(key=lambda e: (e[1], e[0]))
    log(f'drips: {len(drips)} ellipses')

    # eyes: G disc (filled ellipse moments), B groove ring (disc ellipse grown to the ring centre line)
    eyes = []
    comps = sorted(label(masks[..., 1] > 0.5), key=len, reverse=True)[:2]
    ring_mask = masks[..., 2] > 0.5
    for comp in sorted(comps, key=lambda c: xs[c[:, 0]].mean()):
        V = pix_to_view(comp)
        cx, cy, a, b, ang = moment_ellipse(V)
        # ring pixels near this eye: median elliptic radius of the ring (its centre line), width from its area
        ri, rk = np.nonzero(ring_mask)
        RV = to_view(np.stack([xs[ri], zs[rk]], axis=1))
        tt = math.radians(ang)
        du, dv = RV[:, 0] - cx, RV[:, 1] - cy
        u = (du * math.cos(tt) + dv * math.sin(tt)) / a
        v = (-du * math.sin(tt) + dv * math.cos(tt)) / b
        rho = np.sqrt(u * u + v * v)
        near = (rho > 0.7) & (rho < 1.6)
        grow = float(np.median(rho[near])) if near.any() else 1.08
        width = float(near.sum()) * PIXEL * PIXEL / (math.pi * (a + b) * grow)
        eyes.append({'cx': r1(cx), 'cy': r1(cy), 'rx': r1(a), 'ry': r1(b), 'rot': int(round(ang)),
                     'ring': {'rx': r1(a * grow), 'ry': r1(b * grow), 'w': r1(width)}})
    if len(eyes) == 2:  # the model's eyes are mirror images (azimuth +-EYE.azimuth_deg): average the two measurements
        a_, b_ = eyes
        m_ = {'cx': r1(0.5 * (a_['cx'] + 2 * CX - b_['cx'])), 'cy': r1(0.5 * (a_['cy'] + b_['cy'])),
              'rx': r1(0.5 * (a_['rx'] + b_['rx'])), 'ry': r1(0.5 * (a_['ry'] + b_['ry'])),
              'rot': int(round(0.5 * (a_['rot'] - b_['rot']))),
              'ring': {k: r1(0.5 * (a_['ring'][k] + b_['ring'][k])) for k in ('rx', 'ry', 'w')}}
        eyes = [m_, dict(m_, cx=r1(2 * CX - m_['cx']), rot=-m_['rot'], ring=dict(m_['ring']))]
    log('eyes:', json.dumps(eyes))

    # orb (sphere -> circle) and the badge anchor of the 3D landmarks
    oc = sb.BASE['orb']['c']
    orb_v = to_view([oc[0], oc[2]])
    orb = {'cx': r1(orb_v[0]), 'cy': r1(orb_v[1]), 'r': r1(sb.BASE['orb']['r'] * SCALE)}
    # specular point of the orb sphere for the key light (half vector of light and view directions)
    ocv = np.asarray(oc, float)
    hv = (KEY_LIGHT - ocv) / np.linalg.norm(KEY_LIGHT - ocv) + np.array([0.0, -1.0, 0.0])
    hv /= np.linalg.norm(hv)
    spec_v = to_view([oc[0] + sb.BASE['orb']['r'] * hv[0], oc[2] + sb.BASE['orb']['r'] * hv[2]])
    orb['spec'] = {'x': r1(spec_v[0]), 'y': r1(spec_v[1])}
    ba = to_view([oc[0] + 0.30, 1.62])
    badge_anchor = {'x': r1(ba[0]), 'y': r1(ba[1])}

    # -- inner lines from the body-only depth map. The lower body of the model is mirror-symmetric (only the head
    #    axis leans, above the chin), so each line is averaged with its mirror image and fitted once: the 2D lines
    #    are exactly symmetric, like the 3D body.
    def mirror(V):
        return np.stack([2 * CX - V[:, 0], V[:, 1]], axis=1)

    lines = []
    crease = chin_crease(xs, zs, fb)
    if len(crease) > 3:
        C = to_view([(x, z) for x, z, _ in crease])            # left -> right
        C = 0.5 * (C + mirror(C)[::-1])
        lines.append(open_path([crease_curve(C)]))
    slits = {side: arm_slit(xs, zs, gb, side) for side in (-1.0, 1.0)}
    right, left = slits[1.0], slits[-1.0]
    if len(right) > 3 and len(right) == len(left):
        V = 0.5 * (to_view([(x, z) for x, z, _ in right]) + mirror(to_view([(x, z) for x, z, _ in left])))
        fit = fit_line(V[::-1], 0.4)  # top of the slit -> bottom edge
        if fit:
            lines.append(open_path([mirror(c) for c in fit]))  # viewer's left slit first
            lines.append(open_path(fit))
    log(f'lines: crease {len(crease)} pts, slits {len(slits[-1.0])}/{len(slits[1.0])} pts'
        + (f' (slit top z {max(z for _, z, _ in slits[1.0]):.3f})' if slits[1.0] else ''))

    # -- highlight: where the head normal best mirrors the 3D key light into the viewer; the brightest `area` of
    #    that specular term gives centre, size and orientation (image moments)
    nb = depth_normals(fb)
    highlights = []
    view = np.array([0.0, -1.0, 0.0])
    for (zlo_, zhi_), area in (((1.05, 1.75), 60.0),):
        sel_k = np.nonzero((zs >= zlo_) & (zs <= zhi_))[0]
        sub = nb[:, sel_k]
        Pp = np.stack(np.broadcast_arrays(xs[:, None], fb[:, sel_k], zs[None, sel_k]), axis=-1)
        L = KEY_LIGHT[None, None, :] - Pp
        L /= np.linalg.norm(L, axis=-1, keepdims=True)
        H = L + view[None, None, :]
        H /= np.linalg.norm(H, axis=-1, keepdims=True)
        spec = np.nan_to_num(np.sum(sub * H, axis=-1), nan=-1.0).ravel()
        count = int(area / (PIXEL * PIXEL))
        order = np.argsort(-spec, kind='stable')[:count]
        idx = np.stack(np.unravel_index(order, sub.shape[:2]), axis=1)
        V = to_view(np.stack([xs[idx[:, 0]], zs[sel_k[idx[:, 1]]]], axis=1))
        cx, cy, a, b, ang = moment_ellipse(V)
        highlights.append((r1(cx), r1(cy), r1(a), r1(b), int(round(ang))))
    log('highlights:', highlights)

    # bounds of the drawn figure
    bx = sil[:, 0]
    by = sil[:, 1]
    bounds = {'x0': r1(bx.min()), 'y0': r1(by.min()), 'x1': r1(bx.max()), 'y1': r1(by.max())}

    shape = {
        'mapping': {'scale': SCALE, 'cx': CX, 'y0': y0},
        'bounds': bounds, 'silhouette': silhouette, 'holes': holes, 'lines': lines, 'eyes': eyes, 'orb': orb,
        'drips': drips, 'highlights': highlights, 'badgeAnchor': badge_anchor,
    }
    if debug_dir:
        write_debug(debug_dir, xs, zs, front, masks, to_view, shape, crease, slits)
    log(f'built in {time.time() - t0:.1f}s')
    return shape


def write_debug(out, xs, zs, front, masks, to_view, shape, crease, slits):
    """Review aids: a numpy-shaded front view of the model and the extracted geometry drawn over it."""
    os.makedirs(out, exist_ok=True)
    n = depth_normals(front)
    ldir = KEY_LIGHT / np.linalg.norm(KEY_LIGHT)
    lam = np.clip(np.nan_to_num(np.sum(n * ldir[None, None, :], axis=-1), nan=0.0), 0, 1)
    shade = 0.35 + 0.65 * lam
    base = np.array([0.62, 0.78, 1.0])
    rgb = shade[..., None] * base
    rgb = rgb * (1 - masks[..., :1]) + shade[..., None] * np.array([0.93, 0.97, 1.0]) * masks[..., :1]
    rgb = rgb * (1 - masks[..., 1:2]) + np.array([0.97, 0.97, 1.0]) * masks[..., 1:2]
    rgb = rgb * (1 - masks[..., 2:3]) + np.array([0.18, 0.30, 0.72]) * masks[..., 2:3]
    rgb[np.isnan(front)] = (0.043, 0.063, 0.19)
    img = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    img = np.transpose(img, (1, 0, 2))[::-1]  # rows = -z (top first), cols = x
    sb.save_png_rgb(os.path.join(out, 'front-shaded.png'), np.ascontiguousarray(img))
    # geometry of the image in viewBox units
    tl = to_view([xs[0], zs[-1]])
    br = to_view([xs[-1], zs[0]])
    w, h = br[0] - tl[0], br[1] - tl[1]
    ells = ''.join(f'<ellipse cx="{e[0]}" cy="{e[1]}" rx="{e[2]}" ry="{e[3]}" transform="rotate({e[4]} {e[0]} {e[1]})" fill="none" stroke="#f0f" stroke-width=".3"/>' for e in shape['drips'])
    eyes = ''.join(f'<ellipse cx="{e["cx"]}" cy="{e["cy"]}" rx="{e["rx"]}" ry="{e["ry"]}" transform="rotate({e["rot"]} {e["cx"]} {e["cy"]})" fill="none" stroke="#0f0" stroke-width=".3"/>'
                   f'<ellipse cx="{e["cx"]}" cy="{e["cy"]}" rx="{e["ring"]["rx"]}" ry="{e["ring"]["ry"]}" transform="rotate({e["rot"]} {e["cx"]} {e["cy"]})" fill="none" stroke="#00f" stroke-width="{e["ring"]["w"]}" opacity=".6"/>' for e in shape['eyes'])
    hl = ''.join(f'<ellipse cx="{e[0]}" cy="{e[1]}" rx="{e[2]}" ry="{e[3]}" transform="rotate({e[4]} {e[0]} {e[1]})" fill="none" stroke="#ff0" stroke-width=".4"/>' for e in shape['highlights'])
    pts = ''.join(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r=".25" fill="#f80"/>' for p in to_view([(x, z) for x, z, _ in crease + slits[-1.0] + slits[1.0]]) ) if (crease or slits[1.0]) else ''
    o = shape['orb']
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="1000" height="1000">'
           f'<rect width="200" height="200" fill="#222"/>'
           f'<image href="front-shaded.png" x="{tl[0]:.3f}" y="{tl[1]:.3f}" width="{w:.3f}" height="{h:.3f}" preserveAspectRatio="none"/>'
           f'<path d="{shape["silhouette"]}{"".join(shape["holes"])}" fill="none" stroke="#f00" stroke-width=".35"/>'
           f'{ells}{eyes}{hl}<circle cx="{o["cx"]}" cy="{o["cy"]}" r="{o["r"]}" fill="none" stroke="#0ff" stroke-width=".3"/>'
           f'<path d="{"".join(shape["lines"])}" fill="none" stroke="#f80" stroke-width=".5"/>{pts}'
           f'<circle cx="{shape["badgeAnchor"]["x"]}" cy="{shape["badgeAnchor"]["y"]}" r="1.5" fill="#fc0"/></svg>')
    with open(os.path.join(out, 'overlay.svg'), 'w') as fh:
        fh.write(svg)
    log('debug ->', out)


# ------------------------------------------------------------------------------------------------ module text
def js_module(shape):
    def sha(p):
        return hashlib.sha256(open(p, 'rb').read()).hexdigest()
    src = {
        'model': 'tools/ai/blender/soul_baseline.py', 'modelSha256': sha(os.path.join(MODEL_DIR, 'soul_baseline.py')),
        'drips': 'tools/ai/blender/soul_baseline_splats.json', 'dripsSha256': sha(sb.SPLATS_PATH),
        'generator': GENERATOR, 'step': STEP, 'tolerance': TOLERANCE,
    }

    def js(v):
        return json.dumps(v, separators=(', ', ': ')).replace('"', "'")

    def obj(d):
        return '{ ' + ', '.join(f'{k}: {js(v) if not isinstance(v, dict) else "Object.freeze(" + obj(v) + ")"}' for k, v in d.items()) + ' }'
    eyes = ',\n  '.join(f'Object.freeze({obj(e)})' for e in shape['eyes'])
    drips = ',\n  '.join(', '.join(f'[{e[0]}, {e[1]}, {e[2]}, {e[3]}, {e[4]}]' for e in shape['drips'][i:i + 4]) for i in range(0, len(shape['drips']), 4))
    hls = ', '.join(f'[{e[0]}, {e[1]}, {e[2]}, {e[3]}, {e[4]}]' for e in shape['highlights'])
    strokes = ',\n  '.join(f"[{w}, '{d}']" for w, d in drip_strokes(shape['drips']))
    lines = [
        '// GENERATED by tools/assets/build-soul-shape.py - do not edit by hand (docs/art/soul-baseline.md "Flat 2D Soul").',
        '// Front orthographic projection of the Arise Soul baseline 3D model (tools/ai/blender/soul_baseline.py) in the',
        '// 200 x 200 Soul viewBox: model (x, z) -> (MAPPING.cx + MAPPING.scale * x, MAPPING.y0 - MAPPING.scale * z), 0.1 units.',
        '// Pure data, no imports; packages/ui/soul-renderer.js draws it. Regenerate with:',
        '//   Blender --background --factory-startup --python tools/assets/build-soul-shape.py',
        '',
        f"export const SHAPE_VERSION = '{SHAPE_VERSION}';",
        f'export const SHAPE_SOURCE = Object.freeze({obj(src)});',
        f'export const MAPPING = Object.freeze({obj(shape["mapping"])});',
        '/** Bounding box of the silhouette (feet .. antenna orb), viewBox units. */',
        f'export const BOUNDS = Object.freeze({obj(shape["bounds"])});',
        '/** Outer silhouette (body, arms, feet, neck, orb and the drips on the outline), closed cubic path. */',
        f"export const SILHOUETTE = '{shape['silhouette']}{''.join(shape['holes'])}';",
        '/** Inner lines: chin crease, then the two arm slits (open strokes). */',
        f"export const LINES = '{''.join(shape['lines'])}';",
        '/** Button eyes (viewer\'s left first): disc ellipse + groove-ring centre line (rot in degrees). */',
        f'export const EYES = Object.freeze([\n  {eyes},\n]);',
        '/** Antenna orb (the 3D sphere seen from the front). */',
        f'export const ORB = Object.freeze({obj(shape["orb"])});',
        '/** Goo drips seen from the front: [cx, cy, rx, ry, rotDeg], top to bottom. */',
        f'export const DRIPS = Object.freeze([\n  {drips},\n].map(Object.freeze));',
        '/** DRIPS as round-capped strokes grouped by width: [strokeWidth, pathData] (capsule 2a x 2b per drip). */',
        f'export const DRIP_STROKES = Object.freeze([\n  {strokes},\n].map(Object.freeze));',
        '/** Specular highlight of the 3D key light on the head: [cx, cy, rx, ry, rotDeg]. */',
        f'export const HIGHLIGHTS = Object.freeze([{hls}].map(Object.freeze));',
        '/** 3D badge anchor (glTF landmarks.badge_anchor) projected; the 2D badge keeps BADGE_CENTER. */',
        f'export const BADGE_ANCHOR = Object.freeze({obj(shape["badgeAnchor"])});',
        '',
    ]
    return '\n'.join(lines)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--debug', default=None)
    ap.add_argument('--out', default=OUT_JS)
    a = ap.parse_args(argv)
    shape = build(a.debug)
    text = js_module(shape)
    if a.check:
        cur = open(a.out).read() if os.path.exists(a.out) else ''
        if cur != text:
            log('DIFFERS from', os.path.relpath(a.out, ROOT))
            sys.exit(1)
        log('up to date:', os.path.relpath(a.out, ROOT))
        return
    with open(a.out, 'w') as fh:
        fh.write(text)
    log(f'wrote {os.path.relpath(a.out, ROOT)} ({len(text.encode())} bytes)')


if __name__ == '__main__':
    # Inside Blender its own flags fill sys.argv, so script args must follow '--'. Under plain python3 the args are
    # sys.argv[1:] (without this, `python3 build-soul-shape.py --check` silently rewrote the module).
    in_blender = 'bpy' in sys.modules or os.path.basename(sys.argv[0]).lower().startswith('blender')
    raw = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ([] if in_blender else sys.argv[1:])
    main(raw)
