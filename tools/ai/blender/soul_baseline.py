#!/usr/bin/env python3
"""tools/ai/blender/soul_baseline.py - the Arise Soul baseline character, sculpted as a signed-distance field.

References (docs/art/reference/):
  soul-baseline-reference.png  3/4 clay view supplied 2026-09-24 (the target this model is fitted to)
  Arise soul 1 (2).png         front view of the same character (blue jelly)

How it works
  1. The body is a smooth union of analytic primitives (ellipsoids, round cones, spheres) in Blender units, Z up,
     facing -Y. Eyes are domed buttons ringed by a groove; goo drips are chains of small spheres laid on the surface.
  2. The field is sampled on a voxel grid (numpy, chunked) and meshed with OpenVDB (bundled with Blender).
  3. A pinhole camera is fitted to the reference silhouette (--mode fit) so renders line up pixel for pixel, and
     the drips listed in soul_baseline_splats.json (pixel positions in the reference) are back-projected onto the
     body through that camera. Drips on the unseen back are seeded (deterministic).

Run inside Blender (Blender bundles numpy and openvdb):
  Blender --background --factory-startup --python tools/ai/blender/soul_baseline.py -- --mode fit   --out <dir>
  Blender --background --factory-startup --python tools/ai/blender/soul_baseline.py -- --mode build --out <dir>
Outputs land in <dir>; nothing here is imported by the apps or the service.
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
    from mathutils import Vector  # type: ignore
except ImportError:  # the pure section also runs in plain python3 (numpy only)
    bpy = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
REF_PATH = os.path.join(ROOT, 'docs', 'art', 'reference', 'soul-baseline-reference.png')
SPLATS_PATH = os.path.join(HERE, 'soul_baseline_splats.json')
REF_W, REF_H = 738, 818

# ------------------------------------------------------------------------------------------------ SDF primitives
F32 = np.float32


def smin(a, b, k):
    """Polynomial smooth minimum (blend radius k)."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * (k * 0.25)


def smax(a, b, k):
    return -smin(-a, -b, k)


def frame_from_normal(n, hint=(0.0, 0.0, 1.0)):
    """Orthonormal rows (t1, t2, n) with t2 roughly along -hint projected (t2 points 'down' the surface)."""
    n = np.asarray(n, dtype=float)
    n = n / np.linalg.norm(n)
    h = np.asarray(hint, dtype=float)
    down = -h - np.dot(-h, n) * n
    if np.linalg.norm(down) < 1e-6:
        down = np.cross(n, [1.0, 0.0, 0.0])
    t2 = down / np.linalg.norm(down)
    t1 = np.cross(t2, n)
    return np.stack([t1, t2, n])


class Prim:
    """A field primitive: fn(X, Y, Z) -> distance, with an axis-aligned bound used to cull grid chunks."""

    def __init__(self, fn, lo, hi, name=''):
        self.fn, self.lo, self.hi, self.name = fn, np.asarray(lo, float), np.asarray(hi, float), name


def sphere(c, r, name='sphere'):
    c = np.asarray(c, float)

    def fn(X, Y, Z):
        return np.sqrt((X - c[0]) ** 2 + (Y - c[1]) ** 2 + (Z - c[2]) ** 2) - r
    return Prim(fn, c - r, c + r, name)


def ellipsoid(c, radii, frame=None, name='ellipsoid'):
    """iq's bound-correct ellipsoid approximation; frame rows are the local axes (default: world axes)."""
    c = np.asarray(c, float)
    rx, ry, rz = radii
    M = np.eye(3) if frame is None else np.asarray(frame, float)

    def fn(X, Y, Z):
        dx, dy, dz = X - c[0], Y - c[1], Z - c[2]
        lx = dx * M[0, 0] + dy * M[0, 1] + dz * M[0, 2]
        ly = dx * M[1, 0] + dy * M[1, 1] + dz * M[1, 2]
        lz = dx * M[2, 0] + dy * M[2, 1] + dz * M[2, 2]
        k0 = np.sqrt((lx / rx) ** 2 + (ly / ry) ** 2 + (lz / rz) ** 2)
        k1 = np.sqrt((lx / (rx * rx)) ** 2 + (ly / (ry * ry)) ** 2 + (lz / (rz * rz)) ** 2)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    r = max(radii)
    return Prim(fn, c - r, c + r, name)


def round_cone(a, b, r1, r2, scale=(1.0, 1.0, 1.0), name='round_cone'):
    """iq's exact round cone between a (radius r1) and b (radius r2); optional anisotropic scale about a."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    s = np.asarray(scale, float)
    bs = a + (b - a) / s  # endpoints in the unscaled space
    ba = bs - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    smin_scale = float(s.min())

    def fn(X, Y, Z):
        px = (X - a[0]) / s[0]
        py = (Y - a[1]) / s[1]
        pz = (Z - a[2]) / s[2]
        y = px * ba[0] + py * ba[1] + pz * ba[2]
        z = y - l2
        qx = px * l2 - ba[0] * y
        qy = py * l2 - ba[1] * y
        qz = pz * l2 - ba[2] * y
        x2 = qx * qx + qy * qy + qz * qz
        y2 = y * y * l2
        z2 = z * z * l2
        k = math.copysign(1.0, rr) * rr * rr * x2
        d_b = np.sqrt(x2 + z2) * il2 - r2
        d_a = np.sqrt(x2 + y2) * il2 - r1
        d_m = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - r1
        out = np.where(np.sign(z) * a2 * z2 > k, d_b, np.where(np.sign(y) * a2 * y2 < k, d_a, d_m))
        return out * smin_scale
    rmax = max(r1, r2) * float(s.max())
    lo = np.minimum(a, b) - rmax
    hi = np.maximum(a, b) + rmax
    return Prim(fn, lo, hi, name)


def torus(c, n, R, r, name='torus'):
    c = np.asarray(c, float)
    n = np.asarray(n, float) / np.linalg.norm(n)

    def fn(X, Y, Z):
        dx, dy, dz = X - c[0], Y - c[1], Z - c[2]
        h = dx * n[0] + dy * n[1] + dz * n[2]
        rx, ry, rz = dx - h * n[0], dy - h * n[1], dz - h * n[2]
        q = np.sqrt(rx * rx + ry * ry + rz * rz) - R
        return np.sqrt(q * q + h * h) - r
    ext = R + r
    return Prim(fn, c - ext, c + ext, name)


class Pchip:
    """Monotone cubic (Fritsch-Carlson) interpolation with derivative; vectorised; clamps outside the knots."""

    def __init__(self, xs, ys):
        x = np.asarray(xs, float)
        y = np.asarray(ys, float)
        h = np.diff(x)
        dl = np.diff(y) / h
        m = np.zeros_like(y)
        for k in range(1, len(x) - 1):
            if dl[k - 1] * dl[k] > 0:
                w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
                m[k] = (w1 + w2) / (w1 / dl[k - 1] + w2 / dl[k])
        m[0] = self._edge(h[0], h[1], dl[0], dl[1]) if len(x) > 2 else dl[0]
        m[-1] = self._edge(h[-1], h[-2], dl[-1], dl[-2]) if len(x) > 2 else dl[-1]
        self.x, self.y, self.h, self.m = x, y, h, m

    @staticmethod
    def _edge(h0, h1, d0, d1):
        d = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
        if np.sign(d) != np.sign(d0):
            return 0.0
        if np.sign(d0) != np.sign(d1) and abs(d) > abs(3 * d0):
            return 3 * d0
        return d

    def __call__(self, q):
        x, y, h, m = self.x, self.y, self.h, self.m
        qc = np.clip(q, x[0], x[-1])
        i = np.clip(np.searchsorted(x, qc, side='right') - 1, 0, len(x) - 2)
        hi = h[i]
        t = (qc - x[i]) / hi
        t2, t3 = t * t, t * t * t
        val = (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * hi * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * hi * m[i + 1]
        der = ((6 * t2 - 6 * t) * y[i] + (-6 * t2 + 6 * t) * y[i + 1]) / hi + (3 * t2 - 4 * t + 1) * m[i] + (3 * t2 - 2 * t) * m[i + 1]
        der = np.where((q < x[0]) | (q > x[-1]), 0.0, der)
        return val, der


class Table:
    """Dense, Gaussian-smoothed lookup (value, derivative) built from a Pchip; removes measurement ripple."""

    def __init__(self, pts, sigma, step=0.004):
        base = Pchip([p[0] for p in pts], [p[1] for p in pts])
        z0, z1 = pts[0][0], pts[-1][0]
        pad = 4 * sigma
        zs = np.arange(z0 - pad, z1 + pad + step, step)
        v, _ = base(zs)
        if sigma > 0:
            ks = np.arange(-int(4 * sigma / step), int(4 * sigma / step) + 1) * step
            w = np.exp(-0.5 * (ks / sigma) ** 2)
            w /= w.sum()
            v = np.convolve(np.pad(v, len(ks) // 2, mode='edge'), w, mode='valid')
        self.zs, self.v = zs, v
        self.dv = np.gradient(v, step)
        self.z0, self.z1 = z0, z1

    def __call__(self, q):
        return np.interp(q, self.zs, self.v), np.interp(q, self.zs, self.dv)


def smooth_table(pts, sigma):
    return Table(pts, sigma) if sigma > 0 else Pchip([p[0] for p in pts], [p[1] for p in pts])


def revolve_z(radius_pts, axis_pts=None, axis_dir=(1.0, 0.0), sy=1.0, smooth=0.02, sy_pts=None, name='revolve'):
    """Surface of revolution around a (possibly curved) near-vertical axis.

    radius_pts: [(z, r)] cross-section radius along X; sy scales the Y semi-axis (elliptical sections).
    axis_pts:   [(z, offset)] axis offset from the Z axis along axis_dir (unit XY vector)."""
    R = smooth_table(radius_pts, smooth)
    A = smooth_table(axis_pts, smooth) if axis_pts else None
    SY = smooth_table(sy_pts, 0.03) if sy_pts else None
    ad = np.asarray(axis_dir, float)
    ad = ad / np.linalg.norm(ad)
    zmin, zmax = radius_pts[0][0], radius_pts[-1][0]
    rmax = max(p[1] for p in radius_pts)
    omax = max(abs(p[1]) for p in axis_pts) if axis_pts else 0.0
    kscale = min(1.0, sy, min(p[1] for p in sy_pts) if sy_pts else 1.0)

    def fn(X, Y, Z):
        zc = np.clip(Z, zmin, zmax)
        r, dr = R(zc)
        if A is not None:
            off, _ = A(zc)
            cx, cy = off * ad[0], off * ad[1]
        else:
            cx, cy = 0.0, 0.0
        dx = X - cx
        syz = SY(zc)[0] if SY is not None else sy
        dy = (Y - cy) / syz
        rho = np.sqrt(dx * dx + dy * dy)
        d = (rho - r) / np.sqrt(1.0 + dr * dr)
        d = np.maximum(d, np.maximum(zmin - Z, Z - zmax))
        return d * kscale
    ext = rmax + omax
    return Prim(fn, [-ext, -ext, zmin], [ext, ext, zmax], name)


def polyline_tube(pts, r, closed=True, name='tube'):
    """Distance to a polyline minus r: a tube that can follow a curve drawn on the surface."""
    P = np.asarray(pts, float)
    segs = list(zip(P, np.roll(P, -1, axis=0))) if closed else list(zip(P[:-1], P[1:]))

    def fn(X, Y, Z):
        d = None
        for a, b in segs:
            ba = b - a
            l2 = float(ba @ ba)
            pax, pay, paz = X - a[0], Y - a[1], Z - a[2]
            h = np.clip((pax * ba[0] + pay * ba[1] + paz * ba[2]) / l2, 0.0, 1.0)
            dx, dy, dz = pax - ba[0] * h, pay - ba[1] * h, paz - ba[2] * h
            dd = np.sqrt(dx * dx + dy * dy + dz * dz)
            d = dd if d is None else np.minimum(d, dd)
        return d - r
    return Prim(fn, P.min(0) - r, P.max(0) + r, name)


# ------------------------------------------------------------------------------------------------ the character
# Units: 1 unit = 290 px in the reference; z = 0 at the lowest point; front is -Y; the character's left is +X.
# Profiles are the reference silhouette half-widths measured row by row (tools/ai/blender/soul_baseline.py
# --mode fit re-fits the camera so these line up).
BASE = {
    # teardrop head: widest at the eyes, pinching into a 0.04 neck; its axis drifts toward the antenna side
    'head_r': [(0.40, 0.02), (0.48, 0.10), (0.58, 0.17), (0.67, 0.22), (0.75, 0.27), (0.85, 0.335), (0.95, 0.378), (1.03, 0.395), (1.13, 0.402), (1.24, 0.41), (1.29, 0.412),
               (1.34, 0.407), (1.39, 0.395), (1.445, 0.378), (1.50, 0.354), (1.55, 0.322), (1.60, 0.277),
               (1.65, 0.222), (1.685, 0.172), (1.72, 0.118), (1.75, 0.088), (1.78, 0.068), (1.81, 0.054),
               (1.84, 0.045), (1.87, 0.038), (1.90, 0.042), (1.95, 0.07), (2.00, 0.07), (2.05, 0.05), (2.09, 0.02)],
    'head_axis': [(0.40, 0.0), (1.40, 0.0), (1.50, 0.005), (1.55, 0.010), (1.60, 0.016), (1.65, 0.031),
                  (1.685, 0.052), (1.72, 0.080), (1.75, 0.097), (1.78, 0.106), (1.81, 0.112), (1.87, 0.121),
                  (2.09, 0.121)],
    'axis_dir': (0.849, 0.529),
    'head_sy': [(0.40, 0.80), (0.82, 0.80), (0.93, 0.88), (1.03, 1.0), (2.09, 1.0)],
    # lower body: a round belly between two hanging arm lobes, separated by narrow slits near the bottom
    'belly': {'c': [0.0, -0.08, 0.46], 'r': [0.38, 0.37, 0.48], 'k': 0.10},
    'arm': {'a': [0.20, 0.02, 1.00], 'b': [0.555, -0.08, 0.165], 'ra': 0.13, 'rb': 0.17, 'sy': 0.85, 'k': 0.16},
    'slit': {'x': 0.345, 'y': -0.02, 'z': 0.10, 'r': (0.032, 0.30, 0.38), 'k': 0.035},
    'foot': {'c': [0.14, -0.14, 0.05], 'r': [0.12, 0.12, 0.07], 'k': 0.05},
    'orb': {'c': [0.105, 0.065, 2.10], 'r': 0.169, 'k': 0.03},
}
EYE = {'azimuth_deg': 31.4, 'elev_deg': 0.0, 'z': 1.165, 'radius': 0.148, 'dome': 0.028, 'groove_r': 0.0075, 'groove_depth': 0.0065}


def base_ops(p=BASE):
    """Ordered (op, prim, k) list for the smooth body without eyes or drips."""
    ops = [('u', revolve_z(p['head_r'], p['head_axis'], p['axis_dir'], sy_pts=p['head_sy'], name='head'), 0.0)]
    arm = p['arm']
    for s in (-1.0, 1.0):
        a = [s * arm['a'][0], arm['a'][1], arm['a'][2]]
        b = [s * arm['b'][0], arm['b'][1], arm['b'][2]]
        ops.append(('u', round_cone(a, b, arm['ra'], arm['rb'], scale=(1.0, arm['sy'], 1.0), name='arm'), arm['k']))
    ops.append(('u', ellipsoid(p['belly']['c'], p['belly']['r'], name='belly'), p['belly']['k']))
    sl = p['slit']
    for s in (-1.0, 1.0):
        ops.append(('s', ellipsoid([s * sl['x'], sl['y'], sl['z']], sl['r'], name='slit'), sl['k']))
    foot = p['foot']
    for s in (-1.0, 1.0):
        ops.append(('u', ellipsoid([s * foot['c'][0], foot['c'][1], foot['c'][2]], foot['r'], name='foot'), foot['k']))
    ops.append(('u', sphere(p['orb']['c'], p['orb']['r'], name='orb'), p['orb']['k']))
    return ops


def eval_ops_points(ops, P):
    """Evaluate an op list at points P (N, 3)."""
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    d = np.full(len(P), 10.0)
    for kind, prim, k in ops:
        b = prim.fn(X, Y, Z)
        d = smin(d, b, k) if kind == 'u' else (d - b if kind == 'd' else smax(d, -b, k))
    return d


def gradient(ops, P, eps=1e-3):
    g = np.zeros_like(P)
    for i in range(3):
        e = np.zeros(3)
        e[i] = eps
        g[:, i] = eval_ops_points(ops, P + e) - eval_ops_points(ops, P - e)
    return g / np.linalg.norm(g, axis=1, keepdims=True)


def march(ops, origins, dirs, t0=0.0, t1=6.0, steps=600):
    """First outside->inside crossing along each ray (camera rays) or inside->outside (from the axis).

    Returns hit points (N, 3) and a mask. Uses dense sampling plus bisection (robust for thin parts)."""
    origins = np.atleast_2d(origins).astype(float)
    dirs = np.atleast_2d(dirs).astype(float)
    ts = np.linspace(t0, t1, steps)
    n = len(origins)
    hit_t = np.full(n, np.nan)
    prev = eval_ops_points(ops, origins + dirs * ts[0])
    start_sign = np.sign(prev)
    for i in range(1, steps):
        cur = eval_ops_points(ops, origins + dirs * ts[i])
        crossed = np.isnan(hit_t) & (np.sign(cur) != start_sign) & (start_sign != 0)
        if crossed.any():
            lo = np.full(n, ts[i - 1])
            hi = np.full(n, ts[i])
            for _ in range(40):
                mid = 0.5 * (lo + hi)
                dm = eval_ops_points(ops, origins + dirs * mid[:, None])
                same = np.sign(dm) == start_sign
                lo = np.where(same, mid, lo)
                hi = np.where(same, hi, mid)
            hit_t = np.where(crossed, 0.5 * (lo + hi), hit_t)
        prev = cur
        if not np.isnan(hit_t).any():
            break
    mask = ~np.isnan(hit_t)
    pts = origins + dirs * np.nan_to_num(hit_t)[:, None]
    return pts, mask


def project_to_surface(ops, P, normals_hint=None):
    """Snap points to the surface by marching along +/- the field gradient."""
    P = np.atleast_2d(P).astype(float)
    n = gradient(ops, P) if normals_hint is None else np.atleast_2d(normals_hint)
    d = eval_ops_points(ops, P)
    for _ in range(12):
        P = P - n * d[:, None]
        d = eval_ops_points(ops, P)
        n = gradient(ops, P)
    return P, n


# ------------------------------------------------------------------------------------------------ eyes and drips
def dome_bump(c, n, R, h, power=0.55, name='eye_dome'):
    """Outward displacement h * (1 - (rho/R)^2)^power around axis n through c (zero at rho >= R)."""
    c = np.asarray(c, float)
    n = np.asarray(n, float) / np.linalg.norm(n)

    def fn(X, Y, Z):
        dx, dy, dz = X - c[0], Y - c[1], Z - c[2]
        a = dx * n[0] + dy * n[1] + dz * n[2]
        rx, ry, rz = dx - a * n[0], dy - a * n[1], dz - a * n[2]
        q = np.clip(1.0 - (rx * rx + ry * ry + rz * rz) / (R * R), 0.0, 1.0)
        fade = np.clip(1.0 - np.abs(a) / (4.0 * R), 0.0, 1.0)  # only near the surface patch
        return h * np.power(q, power) * fade
    return Prim(fn, c - 1.2 * R, c + 1.2 * R, name)


def eye_ops(ops, eye=EYE, head_c=None):
    """Button eyes: a shallow dome ringed by a thin groove that follows the head surface."""
    head_c = np.asarray([0.0, 0.0, eye['z']] if head_c is None else head_c, float)
    out = []
    for s_ in (-1.0, 1.0):
        az = math.radians(eye['azimuth_deg']) * s_
        el = math.radians(eye['elev_deg'])
        d = np.array([math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)])
        p, _ = march(ops, head_c[None], d[None], 0.0, 1.0, 200)
        p = p[0]
        n = gradient(ops, p[None])[0]
        F = frame_from_normal(n)
        R = eye['radius']
        ts = np.linspace(0, 2 * math.pi, 96, endpoint=False)
        rim = p[None] + R * (np.cos(ts)[:, None] * F[0][None] + np.sin(ts)[:, None] * F[1][None])
        rim_s, rim_n = project_to_surface(ops, rim)
        out.append(('d', dome_bump(p, n, R, eye['dome']), 0.0))
        centres = rim_s + rim_n * (eye['groove_r'] - eye['groove_depth'])
        out.append(('s', polyline_tube(centres, eye['groove_r'], name='eye_groove'), 0.003))
    return out


def drip_chain(ops, start, end, r_start, r_end, count=None, flat=0.56, sink=0.08, lumpy=0.22, seed=0, name='drip', **_):
    """Goo drip: rounded, normal-aligned blobs laid along the surface from start to end.

    The chain is trimmed so its outer edge (not the blob centres) spans start..end; blob radii wobble by +/- lumpy
    (seeded) so a drip reads as a few merged lumps rather than a pill."""
    start = np.asarray(start, float)
    end = np.asarray(end, float)
    L = float(np.linalg.norm(end - start))
    if L > 1e-6:
        u = (end - start) / L
        trim = min(0.45 * L, 0.6 * r_start), min(0.45 * L, 0.6 * r_end)
        start, end = start + u * trim[0], end - u * trim[1]
        L = float(np.linalg.norm(end - start))
    rmin = min(r_start, r_end)
    if count is None:
        count = 1 if L < 0.2 * rmin else max(2, int(math.ceil(L / (0.35 * rmin))) + 1)
    if count > 3:
        lumpy *= 0.45
    ts = np.linspace(0.0, 1.0, count)
    pts = start[None] * (1 - ts[:, None]) + end[None] * ts[:, None]
    pts, nrm = project_to_surface(ops, pts)
    rng = np.random.default_rng(seed)
    prims = []
    for i, t in enumerate(ts):
        r = (r_start + (r_end - r_start) * (t ** 1.2)) * (1.0 + lumpy * rng.uniform(-1, 1) if count > 1 else 1.0)
        F = frame_from_normal(nrm[i])
        c = pts[i] - nrm[i] * (sink * r)
        prims.append(('u', ellipsoid(c, (r, r, flat * r), frame=F, name=name), min(0.03, 0.6 * r)))
    return prims


# ------------------------------------------------------------------------------------------------ grid + mesh
def evaluate_grid(ops, lo, hi, vs, chunk=40, log=print):
    lo = np.asarray(lo, float)
    hi = np.asarray(hi, float)
    nx, ny, nz = (np.ceil((hi - lo) / vs).astype(int) + 1).tolist()
    xs = (lo[0] + vs * np.arange(nx)).astype(F32)
    ys = (lo[1] + vs * np.arange(ny)).astype(F32)
    zs = (lo[2] + vs * np.arange(nz)).astype(F32)
    out = np.empty((nx, ny, nz), dtype=F32)
    t0 = time.time()
    for z0 in range(0, nz, chunk):
        z1 = min(nz, z0 + chunk)
        d = np.full((nx, ny, z1 - z0), 10.0, dtype=F32)
        for kind, prim, k in ops:
            m = k + 3 * vs
            plo, phi = prim.lo - m, prim.hi + m
            i0 = max(0, int(math.floor((plo[0] - lo[0]) / vs)))
            i1 = min(nx, int(math.ceil((phi[0] - lo[0]) / vs)) + 1)
            j0 = max(0, int(math.floor((plo[1] - lo[1]) / vs)))
            j1 = min(ny, int(math.ceil((phi[1] - lo[1]) / vs)) + 1)
            k0 = max(z0, int(math.floor((plo[2] - lo[2]) / vs)))
            k1 = min(z1, int(math.ceil((phi[2] - lo[2]) / vs)) + 1)
            if i0 >= i1 or j0 >= j1 or k0 >= k1:
                continue
            X, Y, Z = np.meshgrid(xs[i0:i1], ys[j0:j1], zs[k0:k1], indexing='ij')
            b = prim.fn(X, Y, Z).astype(F32)
            sub = d[i0:i1, j0:j1, k0 - z0:k1 - z0]
            sub[...] = smin(sub, b, k) if kind == 'u' else (sub - b if kind == 'd' else smax(sub, -b, k))
        out[:, :, z0:z1] = d
    log(f'  field {nx}x{ny}x{nz} ({nx * ny * nz / 1e6:.1f} M voxels, {len(ops)} ops) in {time.time() - t0:.1f}s')
    return out, lo


def eval_box(ops, xs, ys, zs, pad):
    """Field on one box of sample coordinates; ops outside the box (plus blend margin) are skipped."""
    d = np.full((len(xs), len(ys), len(zs)), 10.0, dtype=F32)
    blo = np.array([xs[0], ys[0], zs[0]], float)
    bhi = np.array([xs[-1], ys[-1], zs[-1]], float)
    vs = float(xs[1] - xs[0]) if len(xs) > 1 else pad
    for kind, prim, k in ops:
        m = k + pad
        plo, phi = prim.lo - m, prim.hi + m
        if np.any(phi < blo) or np.any(plo > bhi):
            continue
        i0 = max(0, int(math.floor((plo[0] - blo[0]) / vs)))
        i1 = min(len(xs), int(math.ceil((phi[0] - blo[0]) / vs)) + 1)
        j0 = max(0, int(math.floor((plo[1] - blo[1]) / vs)))
        j1 = min(len(ys), int(math.ceil((phi[1] - blo[1]) / vs)) + 1)
        k0 = max(0, int(math.floor((plo[2] - blo[2]) / vs)))
        k1 = min(len(zs), int(math.ceil((phi[2] - blo[2]) / vs)) + 1)
        if i0 >= i1 or j0 >= j1 or k0 >= k1:
            continue
        X, Y, Z = np.meshgrid(xs[i0:i1], ys[j0:j1], zs[k0:k1], indexing='ij')
        b = prim.fn(X, Y, Z).astype(F32)
        sub = d[i0:i1, j0:j1, k0:k1]
        sub[...] = smin(sub, b, k) if kind == 'u' else (sub - b if kind == 'd' else smax(sub, -b, k))
    return d


def sparse_grid(ops, lo, hi, vs, block=32, coarse_factor=8, log=print):
    """Narrow-band OpenVDB level set: a coarse pass finds the surface, fine blocks are evaluated only there."""
    import openvdb as vdb
    t0 = time.time()
    lo = np.asarray(lo, float)
    cs = vs * coarse_factor
    coarse, _ = evaluate_grid(ops, lo, hi, cs, log=lambda *a: None)
    near = np.abs(coarse) < 1.6 * cs
    per = block // coarse_factor
    band = 3.0 * vs
    grid = vdb.FloatGrid(band)
    nfine = (np.ceil((np.asarray(hi) - lo) / vs).astype(int) + 1)
    blocks = 0
    for bi in range(0, near.shape[0], per):
        for bj in range(0, near.shape[1], per):
            for bk in range(0, near.shape[2], per):
                if not near[bi:bi + per + 1, bj:bj + per + 1, bk:bk + per + 1].any():
                    continue
                i0, j0, k0 = bi * coarse_factor, bj * coarse_factor, bk * coarse_factor
                i1 = min(nfine[0], i0 + block + 1)
                j1 = min(nfine[1], j0 + block + 1)
                k1 = min(nfine[2], k0 + block + 1)
                xs = (lo[0] + vs * np.arange(i0, i1)).astype(F32)
                ys = (lo[1] + vs * np.arange(j0, j1)).astype(F32)
                zs = (lo[2] + vs * np.arange(k0, k1)).astype(F32)
                d = eval_box(ops, xs, ys, zs, 3 * vs)
                grid.copyFromArray(np.clip(d, -band, band).astype(F32), (i0, j0, k0), 1e-7)
                blocks += 1
    grid.signedFloodFill()
    log(f'  sparse field: {blocks} blocks of {block}^3 at {vs} ({grid.activeVoxelCount() / 1e6:.1f} M active voxels) in {time.time() - t0:.1f}s')
    return grid


def mesh_from_grid(grid, lo, vs, adaptivity=0.0):
    res = grid.convertToPolygons(0.0, adaptivity)
    points, tris, quads = res[0], res[1], res[2]
    verts = np.asarray(points, float) * vs + np.asarray(lo, float)
    return verts, np.asarray(tris, np.int64).reshape(-1, 3), np.asarray(quads, np.int64).reshape(-1, 4)


def mesh_from_field(field, lo, vs, adaptivity=0.0):
    import openvdb as vdb  # bundled with Blender
    band = 3.0 * vs
    arr = np.clip(field, -band, band).astype(F32)
    g = vdb.FloatGrid(band)
    g.copyFromArray(arr, (0, 0, 0), 1e-7)
    res = g.convertToPolygons(0.0, adaptivity)
    points, tris, quads = res[0], res[1], res[2]
    verts = np.asarray(points, float) * vs + lo
    return verts, np.asarray(tris, np.int64).reshape(-1, 3), np.asarray(quads, np.int64).reshape(-1, 4)


# ------------------------------------------------------------------------------------------------ camera model
def cam_basis(params):
    az, el, dist, scale, tx, tz = params
    a, e = math.radians(az), math.radians(el)
    target = np.array([tx, 0.0, tz])
    d = np.array([math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)])
    C = target + d * dist
    f = target - C
    f /= np.linalg.norm(f)
    r = np.cross(f, [0.0, 0.0, 1.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return C, f, r, u, scale * dist  # focal length in pixels


def project(params, P, W=REF_W, H=REF_H):
    C, f, r, u, F = cam_basis(params)
    v = P - C
    zc = v @ f
    return W / 2 + (v @ r) / zc * F, H / 2 - (v @ u) / zc * F, zc


def pixel_rays(params, px, py, W=REF_W, H=REF_H):
    C, f, r, u, F = cam_basis(params)
    px = np.atleast_1d(px).astype(float)
    py = np.atleast_1d(py).astype(float)
    dirs = f[None] + ((px - W / 2) / F)[:, None] * r[None] - ((py - H / 2) / F)[:, None] * u[None]
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    return np.repeat(C[None], len(px), axis=0), dirs


def raster_points(px, py, W=REF_W, H=REF_H, rad=2):
    img = np.zeros((H, W), bool)
    xi = np.round(px).astype(int)
    yi = np.round(py).astype(int)
    for dx in range(-rad, rad + 1):
        for dy in range(-rad, rad + 1):
            if dx * dx + dy * dy > rad * rad + 1:
                continue
            x = xi + dx
            y = yi + dy
            ok = (x >= 0) & (x < W) & (y >= 0) & (y < H)
            img[y[ok], x[ok]] = True
    return img


def reference_mask(path=REF_PATH):
    from PIL import Image  # plain python3 only; Blender runs use load_png_gray
    im = np.asarray(Image.open(path).convert('RGB')).astype(int)
    return mask_from_rgb(im)


def mask_from_rgb(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    gray = (r + g + b) / 3
    lime = (g - b) > 40
    m = (gray > 58) & ~lime
    keep = np.zeros_like(m)
    keep[30:780, 120:660] = True  # the character sits well inside; drops the rounded lime frame and its corners
    return m & keep


def iou(a, b):
    inter = np.logical_and(a, b).sum()
    uni = np.logical_or(a, b).sum()
    return float(inter) / float(max(uni, 1))


REF_LANDMARKS = {'eye_r': (408.0, 393.0), 'eye_l': (299.0, 381.0), 'orb': (427.0, 120.0)}


def eye_centres(ops, az_deg, z):
    """Surface points of both eyes (character's left +X first) for a given azimuth and height."""
    pts = []
    for s_ in (1.0, -1.0):
        a = math.radians(az_deg) * s_
        d = np.array([math.sin(a), -math.cos(a), 0.0])
        p, _ = march(ops, np.array([[0.0, 0.0, z]]), d[None], 0.0, 1.0, 160)
        pts.append(p[0])
    return np.array(pts)


def fit_camera(verts, ref_mask, init, ops=None, eye_init=(28.0, 1.18), log=print, iters=80, w_land=0.0025):
    """Coordinate descent on camera (az, el, dist, px/unit, target x, target z) + eye (azimuth, height).

    Score = silhouette IoU - w_land * mean landmark error (px) over the two eye centres and the orb centre."""
    sub = verts[:: max(1, len(verts) // 250000)]
    params = list(init) + list(eye_init)
    steps = [6.0, 4.0, 1.5, 12.0, 0.04, 0.04, 4.0, 0.04]
    lims = [(-80, 80), (-30, 40), (2.0, 40.0), (100, 600), (-0.5, 0.5), (0.5, 1.6), (10.0, 60.0), (0.95, 1.40)]
    orb_c = np.array(BASE['orb']['c'])
    ref_pts = np.array([REF_LANDMARKS['eye_r'], REF_LANDMARKS['eye_l'], REF_LANDMARKS['orb']])
    cache = {}

    def land_err(pr):
        if ops is None:
            return 0.0
        key = (round(pr[6], 4), round(pr[7], 4))
        if key not in cache:
            cache[key] = eye_centres(ops, pr[6], pr[7])
        P = np.vstack([cache[key], orb_c[None]])
        x, y, _ = project(pr[:6], P)
        return float(np.mean(np.hypot(x - ref_pts[:, 0], y - ref_pts[:, 1])))

    def score(pr):
        x, y, _ = project(pr[:6], sub)
        return iou(raster_points(x, y), ref_mask) - w_land * land_err(pr)
    best = score(params)
    for it in range(iters):
        improved = False
        for i in range(len(params)):
            for sgn in (1, -1):
                cand = list(params)
                cand[i] = min(max(cand[i] + sgn * steps[i], lims[i][0]), lims[i][1])
                sc = score(cand)
                if sc > best + 1e-5:
                    best, params, improved = sc, cand, True
        if not improved:
            steps = [st * 0.5 for st in steps]
            if max(steps[:2]) < 0.05:
                break
    x, y, _ = project(params[:6], sub)
    raw = iou(raster_points(x, y), ref_mask)
    log(f'  camera fit IoU {raw:.4f} landmark err {land_err(params):.1f}px params {[round(v, 4) for v in params]}')
    return params[:6], params[6:], raw


def overlay_image(model_mask, ref_mask):
    """RGB uint8: grey = both, red = reference only, cyan = model only."""
    H, W = ref_mask.shape
    img = np.zeros((H, W, 3), np.uint8)
    both = model_mask & ref_mask
    img[both] = (150, 150, 150)
    img[ref_mask & ~model_mask] = (235, 70, 70)
    img[model_mask & ~ref_mask] = (60, 210, 230)
    return img


# ------------------------------------------------------------------------------------------------ png io (no PIL in Blender)
def save_png_rgb(path, rgb):
    import zlib
    import struct
    H, W, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[y].tobytes() for y in range(H))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    with open(path, 'wb') as fh:
        fh.write(png)


def load_png_rgb(path):
    """Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) so Blender runs need no PIL."""
    import zlib
    import struct
    with open(path, 'rb') as fh:
        data = fh.read()
    pos = 8
    idat = b''
    W = H = ctype = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        t = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if t == b'IHDR':
            W, H, depth, ctype = struct.unpack('>IIBB', body[:10])
        elif t == b'IDAT':
            idat += body
        pos += 12 + ln
    ch = {2: 3, 6: 4, 0: 1, 4: 2}[ctype]
    raw = zlib.decompress(idat)
    stride = W * ch
    out = np.zeros((H, stride), np.uint8)
    prev = np.zeros(stride, np.int32)
    p = 0
    for y in range(H):
        ft = raw[p]
        line = np.frombuffer(raw[p + 1:p + 1 + stride], np.uint8).astype(np.int32)
        p += 1 + stride
        if ft == 0:
            cur = line
        elif ft == 2:
            cur = (line + prev) & 255
        else:
            cur = np.zeros(stride, np.int32)
            for x in range(stride):
                a = cur[x - ch] if x >= ch else 0
                b = prev[x]
                c = prev[x - ch] if x >= ch else 0
                if ft == 1:
                    v = a
                elif ft == 3:
                    v = (a + b) >> 1
                else:
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    v = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[x] = (line[x] + v) & 255
        out[y] = cur
        prev = cur
    img = out.reshape(H, W, ch)
    return img[..., :3] if ch >= 3 else np.repeat(img[..., :1], 3, axis=2)


# ------------------------------------------------------------------------------------------------ assembling the model
def model_ops(with_details=True, log=print):
    ops = base_ops()
    if not with_details:
        return ops
    body = list(ops)
    details = eye_ops(body)
    details += splat_ops(body, log=log)
    return ops + details


def ray_to_surface(ops, o, d, t0, t1, steps=900):
    """First hit along each ray; rays that miss snap from their closest approach to the nearest surface."""
    hits, ok = march(ops, o, d, t0, t1, steps)
    if ok.all():
        return hits
    ts = np.linspace(t0, t1, steps)
    for i in np.where(~ok)[0]:
        P = o[i][None] + d[i][None] * ts[:, None]
        best = P[int(np.argmin(eval_ops_points(ops, P)))]
        hits[i] = project_to_surface(ops, best[None])[0][0]
    return hits


def splat_ops(body_ops, log=print, scale_r=1.25):
    """Drips from soul_baseline_splats.json: 'ref' items are back-projected through the fitted camera."""
    if not os.path.exists(SPLATS_PATH):
        return []
    spec = json.load(open(SPLATS_PATH))
    cam = spec.get('camera')
    out = []
    for n_, item in enumerate(spec.get('ref', [])):
        if cam is None:
            break
        pts = [item['from'], item.get('to', item['from'])]
        o, dirs = pixel_rays(cam, [p[0] for p in pts], [p[1] for p in pts])
        hits = ray_to_surface(body_ops, o, dirs, 0.5, cam[2] + 3.0)
        px_per_unit = cam[3]
        r0 = item['r0'] * scale_r / px_per_unit
        r1 = item.get('r1', item['r0']) * scale_r / px_per_unit
        out += drip_chain(body_ops, hits[0], hits[1], r0, r1, seed=1000 + n_, name=item.get('id', 'drip'))
    rng = np.random.default_rng(spec.get('seed', 20260924))
    for i in range(spec.get('back_count', 0)):
        az = rng.uniform(100, 260)
        z = rng.uniform(0.15, 1.55)
        d = np.array([math.sin(math.radians(az)), -math.cos(math.radians(az)), 0.0])
        o = np.array([0.0, 0.03, z])
        p, ok = march(body_ops, o[None], d[None], 0.0, 1.2, 240)
        if not ok[0]:
            continue
        n = gradient(body_ops, p)[0]
        F = frame_from_normal(n)
        L = rng.uniform(0.05, 0.16)
        r0 = rng.uniform(0.026, 0.040)
        end, _ = project_to_surface(body_ops, (p[0] + F[1] * L)[None])
        out += drip_chain(body_ops, p[0], end[0], r0, r0 * rng.uniform(1.15, 1.6), seed=2000 + i, name=f'back{i}')
    return out


def bounds():
    return np.array([-0.80, -0.62, -0.06]), np.array([0.80, 0.58, 2.34])


# ------------------------------------------------------------------------------------------------ Blender side
def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_mesh_object(name, verts, tris, quads):
    # OpenVDB winding can face inwards for a level set; flip before building if the signed volume is negative.
    tri_all = np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]], tris]) if len(quads) else tris
    if mesh_signed_volume(verts, tri_all) < 0:
        quads = quads[:, ::-1]
        tris = tris[:, ::-1]
    me = bpy.data.meshes.new(name)
    loops = np.concatenate([quads.ravel(), tris.ravel()]).astype(np.int32)
    starts = np.concatenate([np.arange(len(quads)) * 4, len(quads) * 4 + np.arange(len(tris)) * 3]).astype(np.int32)
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.astype(np.float32).ravel())
    me.loops.add(len(loops))
    me.loops.foreach_set('vertex_index', loops)
    me.polygons.add(len(starts))
    me.polygons.foreach_set('loop_start', starts)
    me.update(calc_edges=True)
    me.validate(verbose=False)
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mesh_signed_volume(v, t):
    a, b, c = v[t[:, 0]], v[t[:, 1]], v[t[:, 2]]
    return float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6.0)


def setup_render(W, H, engine='BLENDER_WORKBENCH', transparent=True):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.resolution_x = W
    sc.render.resolution_y = H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    if engine == 'BLENDER_WORKBENCH':
        sh = sc.display.shading
        look = os.environ.get('SOUL_LOOK', 'matcap:basic_bright.exr')
        kind, _, name = look.partition(':')
        sh.light = kind.upper()
        if name:
            sh.studio_light = name
        sh.color_type = 'SINGLE'
        sh.single_color = (0.80, 0.80, 0.80)
        sh.show_cavity = False
        sh.cavity_type = 'BOTH'
        sh.curvature_ridge_factor = 0.5
        sh.curvature_valley_factor = 1.0
        sc.display.render_aa = '8'
    sc.view_settings.view_transform = 'Standard'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    sc.world.color = (0.012, 0.012, 0.012)


def add_camera(params, W=REF_W, H=REF_H):
    C, f, r, u, F = cam_basis(params)
    cam = bpy.data.cameras.new('cam')
    cam.sensor_fit = 'VERTICAL'
    cam.sensor_height = 36.0
    cam.lens = F * 36.0 / H
    ob = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(C.tolist())
    ob.rotation_euler = Vector(f.tolist()).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    return ob


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------------------------------------ production helpers
def read_palettes(path=os.path.join(ROOT, 'packages', 'ui', 'soul-renderer.js')):
    """Palettes straight from the app's Soul renderer so colours can never drift."""
    import re
    txt = open(path).read()
    pat = re.compile(r"\{\s*name:\s*'(\w+)',\s*fill:\s*'(#[0-9A-Fa-f]{6})',\s*highlight:\s*'(#[0-9A-Fa-f]{6})',\s*outline:\s*'(#[0-9A-Fa-f]{6})',\s*glow:\s*'(#[0-9A-Fa-f]{6})'\s*\}")
    return {m[0]: {'fill': m[1], 'highlight': m[2], 'outline': m[3], 'glow': m[4]} for m in pat.findall(txt)}


def eye_frames(ops, eye=EYE):
    """(centre, normal, radius) of both eyes, character's left (+X) first."""
    out = []
    for s_ in (1.0, -1.0):
        az = math.radians(eye['azimuth_deg']) * s_
        d = np.array([math.sin(az), -math.cos(az), 0.0])
        p, _ = march(ops, np.array([[0.0, 0.0, eye['z']]]), d[None], 0.0, 1.0, 200)
        out.append((p[0], gradient(ops, p)[0], eye['radius']))
    return out


def vertex_masks(verts, body_ops, eye_list, eyes, batch=200000):
    """RGBA per vertex: R goo drips, G eye disc, B eye groove ring, A antenna orb (soft 0..1 edges)."""
    no_drip = body_ops + eye_list
    d = np.concatenate([eval_ops_points(no_drip, verts[i:i + batch]) for i in range(0, len(verts), batch)])
    drip = np.clip((d - 0.0015) / 0.006, 0.0, 1.0)
    disc = np.zeros(len(verts))
    ring = np.zeros(len(verts))
    for c, n, R in eyes:
        rel = verts - c
        a = rel @ n
        rho = np.linalg.norm(rel - a[:, None] * n[None], axis=1)
        near = a > -0.08
        disc = np.maximum(disc, np.where(near, np.clip((R - 0.009 - rho) / 0.004, 0.0, 1.0), 0.0))
        ring = np.maximum(ring, np.where(near, np.clip(1.0 - (np.abs(rho - R) - 0.006) / 0.006, 0.0, 1.0), 0.0))
    oc = np.asarray(BASE['orb']['c'])
    orb = np.clip((BASE['orb']['r'] + 0.006 - np.linalg.norm(verts - oc, axis=1)) / 0.012, 0.0, 1.0)
    orb = np.where(verts[:, 2] > oc[2] - BASE['orb']['r'] * 0.85, orb, 0.0)
    drip = drip * (1.0 - disc) * (1.0 - ring)
    return np.stack([drip, disc, ring, orb], axis=1).astype(np.float32)


def hex_lin(h):
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = h.lstrip('#')
    return tuple(lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def _in(node, name, kind=None):
    for sock in node.inputs:
        if sock.name == name and (kind is None or sock.type == kind):
            return sock
    raise KeyError(f'{node.bl_idname}.{name}')


def set_bsdf(bsdf, **vals):
    names = {'base': 'Base Color', 'rough': 'Roughness', 'coat': 'Coat Weight', 'coat_rough': 'Coat Roughness',
             'sheen': 'Sheen Weight', 'sheen_tint': 'Sheen Tint', 'emit': 'Emission Color', 'emit_str': 'Emission Strength',
             'spec': 'Specular IOR Level'}
    for k, v in vals.items():
        try:
            _in(bsdf, names[k]).default_value = v
        except KeyError:
            pass


def clay_material():
    m = bpy.data.materials.new('clay')
    m.use_nodes = True
    set_bsdf(m.node_tree.nodes['Principled BSDF'], base=(0.62, 0.62, 0.64, 1.0), rough=0.42)
    return m


def soul_material(pal, name):
    """Palette material driven by the soul_mask colour attribute (drips, eye discs, groove ring, orb)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    set_bsdf(bsdf, rough=0.32, coat=0.8, coat_rough=0.12, sheen=0.35, sheen_tint=hex_lin('#FFB27A'), emit_str=0.0)
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'soul_mask'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(attr.outputs['Color'], sep.inputs['Color'])

    def mix(fac_sock, a_col, b_col_or_sock):
        n = nt.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        nt.links.new(fac_sock, _in(n, 'Factor', 'VALUE'))
        if isinstance(a_col, tuple):
            _in(n, 'A', 'RGBA').default_value = a_col
        else:
            nt.links.new(a_col, _in(n, 'A', 'RGBA'))
        if isinstance(b_col_or_sock, tuple):
            _in(n, 'B', 'RGBA').default_value = b_col_or_sock
        else:
            nt.links.new(b_col_or_sock, _in(n, 'B', 'RGBA'))
        return [o for o in n.outputs if o.type == 'RGBA'][0]
    c = mix(sep.outputs['Red'], hex_lin(pal['fill']), hex_lin(pal['highlight']))
    c = mix(sep.outputs['Green'], c, hex_lin('#F7F8FF'))
    c = mix(sep.outputs['Blue'], c, hex_lin(pal['outline']))
    c = mix(attr.outputs['Alpha'], c, hex_lin(pal['highlight']))
    nt.links.new(c, _in(bsdf, 'Base Color'))
    emit = nt.nodes.new('ShaderNodeMath')
    emit.operation = 'MULTIPLY'
    nt.links.new(attr.outputs['Alpha'], emit.inputs[0])
    emit.inputs[1].default_value = 2.2
    nt.links.new(emit.outputs[0], _in(bsdf, 'Emission Strength'))
    _in(bsdf, 'Emission Color').default_value = hex_lin(pal['glow'])
    return m


def mesh_arrays(me):
    """(verts, vertex normals, triangles, mask RGBA) from a Blender mesh."""
    me.calc_loop_triangles()
    nv = len(me.vertices)
    v = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get('co', v)
    nrm = np.empty(nv * 3, np.float32)
    me.vertex_normals.foreach_get('vector', nrm)
    t = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get('vertices', t)
    col = np.zeros(nv * 4, np.float32)
    if 'soul_mask' in me.color_attributes:
        me.color_attributes['soul_mask'].data.foreach_get('color', col)
    return v.reshape(-1, 3), nrm.reshape(-1, 3), t.reshape(-1, 3), col.reshape(-1, 4)


def write_glb(path, verts, normals, tris, mask, meta):
    """glTF 2.0 binary with KHR_mesh_quantization: int16 positions, int8 normals, uint8 mask colours.

    Blender Z-up / -Y front becomes glTF Y-up / +Z front. The node transform carries the dequantisation."""
    import struct
    P = np.stack([verts[:, 0], verts[:, 2], -verts[:, 1]], axis=1).astype(np.float64)
    N = np.stack([normals[:, 0], normals[:, 2], -normals[:, 1]], axis=1)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    lo_, hi_ = P.min(0), P.max(0)
    centre = (lo_ + hi_) / 2
    half = float(np.max(hi_ - lo_) / 2) * 1.0001
    q = np.round((P - centre) / half * 32767).astype(np.int16)
    pos = np.zeros((len(q), 4), np.int16)
    pos[:, :3] = q
    nb = np.zeros((len(N), 4), np.int8)
    nb[:, :3] = np.round(N * 127).astype(np.int8)
    col = np.round(np.clip(mask, 0, 1) * 255).astype(np.uint8)
    idx_type = 5123 if len(P) < 65536 else 5125
    idx = tris.astype(np.uint16 if idx_type == 5123 else np.uint32).ravel()
    blobs = [pos.tobytes(), nb.tobytes(), col.tobytes(), idx.tobytes()]
    views, off, binbuf = [], 0, b''
    strides = [8, 4, 4, None]
    for b, st in zip(blobs, strides):
        pad = (-len(binbuf)) % 4
        binbuf += b'\x00' * pad
        off = len(binbuf)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(b)}
        if st:
            v['byteStride'] = st
            v['target'] = 34962
        else:
            v['target'] = 34963
        views.append(v)
        binbuf += b
    binbuf += b'\x00' * ((-len(binbuf)) % 4)
    qmin = (np.min(q, 0)).astype(int).tolist()
    qmax = (np.max(q, 0)).astype(int).tolist()
    gl = {
        'asset': {'version': '2.0', 'generator': 'ariskill tools/ai/blender/soul_baseline.py', 'extras': meta},
        'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': 'ariseSoulBaseline', 'mesh': 0, 'translation': centre.tolist(), 'scale': [half, half, half]}],
        'materials': [{'name': 'soul', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.4}}],
        'meshes': [{'name': 'ariseSoulBaseline', 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'COLOR_0': 2}, 'indices': 3, 'material': 0}]}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5122, 'normalized': True, 'count': len(P), 'type': 'VEC3',
             'min': qmin, 'max': qmax},  # raw stored int16 values: glTF says `normalized` never applies to min/max
            {'bufferView': 1, 'componentType': 5120, 'normalized': True, 'count': len(P), 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5121, 'normalized': True, 'count': len(P), 'type': 'VEC4'},
            {'bufferView': 3, 'componentType': idx_type, 'count': int(idx.size), 'type': 'SCALAR'},
        ],
        'bufferViews': views, 'buffers': [{'byteLength': len(binbuf)}],
    }
    js = json.dumps(gl, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binbuf)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        fh.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        fh.write(struct.pack('<II', len(binbuf), 0x004E4942) + binbuf)
    return total


def decimated_copy(ob, target_tris, name):
    me = ob.data
    me.calc_loop_triangles()
    cur = len(me.loop_triangles)
    mod = ob.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, target_tris / max(cur, 1))
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.remove(mod)
    me2.name = name
    ob2 = bpy.data.objects.new(name, me2)
    bpy.context.scene.collection.objects.link(ob2)
    me2.shade_smooth()
    return ob2


def eevee_setup(W, H, world_hex='#0B1030'):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.eevee.taa_render_samples = 48
    except Exception:
        pass
    w = sc.world or bpy.data.worlds.new('World')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = hex_lin(world_hex)
        bg.inputs['Strength'].default_value = 0.6
    for o in [o for o in sc.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(o)
    for nm, loc, energy, size, col in [('key', (-2.2, -3.0, 3.6), 900, 2.5, '#FFF4E8'), ('fill', (3.0, -2.4, 1.6), 260, 3.0, '#C9D6FF'),
                                        ('rim', (1.2, 3.2, 3.2), 700, 1.5, '#E6DDFF')]:
        ld = bpy.data.lights.new(nm, 'AREA')
        ld.energy, ld.size, ld.color = energy, size, hex_lin(col)[:3]
        lo = bpy.data.objects.new(nm, ld)
        sc.collection.objects.link(lo)
        lo.location = Vector(loc)
        lo.rotation_euler = (Vector((0.0, 0.0, 1.0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def orbit_cam(az_deg, el_deg=6.0, dist=7.0, W=768, H=900, fill=0.86, target_z=1.12, height=2.30):
    """Camera params (fit_camera layout) framing the whole character at a given azimuth."""
    scale = fill * H / height
    return [az_deg, el_deg, dist, scale, 0.0, target_z]


def set_camera(params, W, H):
    for o in [o for o in bpy.context.scene.objects if o.type == 'CAMERA']:
        bpy.data.objects.remove(o)
    return add_camera(params, W=W, H=H)


# ------------------------------------------------------------------------------------------------ modes
def run(args):
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    t0 = time.time()
    cache = os.path.join(out, 'ref-mask.npy')
    if os.path.exists(cache):
        ref = np.load(cache)
    else:
        ref = mask_from_rgb(load_png_rgb(REF_PATH))
        np.save(cache, ref)
    lo, hi = bounds()
    with_details = args.mode != 'fit'
    ops = model_ops(with_details=with_details)
    if args.mode == 'fit':
        field, lo = evaluate_grid(ops, lo, hi, args.voxel)
        verts, tris, quads = mesh_from_field(field, lo, args.voxel)
    else:
        grid = sparse_grid(ops, lo, hi, args.voxel)
        verts, tris, quads = mesh_from_grid(grid, lo, args.voxel, args.adaptivity)
    print(f'  mesh {len(verts)} verts, {len(quads)} quads, {len(tris)} tris')
    spec = json.load(open(SPLATS_PATH)) if os.path.exists(SPLATS_PATH) else {}
    cam = spec.get('camera')
    if args.mode == 'fit' or cam is None:
        init = cam or [22.0, 3.0, 4.8, 290.0, -0.07, 1.10]
        cam, eye, score = fit_camera(verts, ref, init, ops=base_ops())
        with open(os.path.join(out, 'camera.json'), 'w') as fh:
            json.dump({'camera': cam, 'eye': eye, 'iou': score}, fh)
    x, y, _ = project(cam, verts[:: max(1, len(verts) // 250000)])
    mm = raster_points(x, y)
    score = iou(mm, ref)
    save_png_rgb(os.path.join(out, 'overlay.png'), overlay_image(mm, ref))
    rows = []
    for yy in range(80, 730, 30):
        a = np.where(ref[yy])[0]
        b = np.where(mm[yy])[0]
        if len(a) and len(b):
            rows.append(f'y{yy}:L{int(b.min() - a.min()):+d}/R{int(b.max() - a.max()):+d}')
    print('  edge deltas model-ref (px):', ' '.join(rows))
    print(f'  silhouette IoU vs reference: {score:.4f}')
    clear_scene()
    ob = build_mesh_object('ariseSoulBaseline', verts, tris, quads)
    setup_render(REF_W, REF_H)
    add_camera(cam)
    render(os.path.join(out, 'match.png'))
    if args.mode == 'build':
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'soul-baseline.blend'))
    if args.mode == 'produce':
        produce(ob, cam, out, args, verts)
    print(f'done in {time.time() - t0:.1f}s -> {out}')


def produce(ob, cam, out, args, verts):
    """Masks, materials, master .blend, renders and the quantised web GLBs (hero + lite)."""
    import hashlib
    body = base_ops()
    eyes_l = eye_ops(body)
    frames = eye_frames(body)
    t = time.time()
    mask = vertex_masks(verts, body, eyes_l, frames)
    me = ob.data
    attr = me.color_attributes.new('soul_mask', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', mask.ravel())
    print(f'  masks on {len(verts)} verts in {time.time() - t:.1f}s (drip {float((mask[:, 0] > 0.5).mean()):.3f}, eye {float((mask[:, 1] > 0.5).mean()):.4f})')
    pals = read_palettes()
    clay = clay_material()
    ob.data.materials.append(clay)
    mats = {k: soul_material(v, f'soul_{k}') for k, v in pals.items()}
    files = {}
    # gray clay renders (matcap, like the reference)
    setup_render(REF_W, REF_H)
    set_camera(cam, REF_W, REF_H)
    render(os.path.join(out, 'match.png'))
    for az in (0, 35, 90, 150, 180, 270):
        W, H = 768, 900
        setup_render(W, H)
        set_camera(orbit_cam(az, W=W, H=H), W, H)
        render(os.path.join(out, f'turn-{az:03d}.png'))
    # palette renders (Eevee, glossy clay)
    ob.data.materials.clear()
    for pal in args.palettes.split(','):
        ob.data.materials.append(mats[pal])
        W, H = 900, 1000
        eevee_setup(W, H)
        set_camera(orbit_cam(28, el_deg=7.0, W=W, H=H, fill=0.84), W, H)
        render(os.path.join(out, f'colour-{pal}.png'))
        ob.data.materials.clear()
    ob.data.materials.append(mats[args.palettes.split(',')[0]])
    # web GLBs
    def gl(v):  # Blender Z-up/-Y front -> glTF Y-up/+Z front
        return [round(float(v[0]), 5), round(float(v[2]), 5), round(float(-v[1]), 5)]
    landmarks = {'orb': {'centre': gl(BASE['orb']['c']), 'radius': BASE['orb']['r']},
                 'eyes': [{'side': 'left' if i == 0 else 'right', 'centre': gl(c), 'normal': gl(n), 'radius': float(R)}
                          for i, (c, n, R) in enumerate(frames)],
                 'height': round(float(verts[:, 2].max() - verts[:, 2].min()), 5), 'floor': round(float(verts[:, 2].min()), 5),
                 'badge_anchor': gl([BASE['orb']['c'][0] + 0.30, BASE['orb']['c'][1], 1.62])}
    meta = {'name': 'Arise Soul baseline', 'version': args.version, 'units': 'model units; 1.0 = 290 px of the reference',
            'landmarks': landmarks,
            'mask': {'r': 'goo drips', 'g': 'eye disc', 'b': 'eye groove ring', 'a': 'antenna orb'},
            'front': '+Z', 'up': '+Y', 'source': 'tools/ai/blender/soul_baseline.py', 'reference': 'docs/art/reference/soul-baseline-reference.png'}
    for lod, target in (('hero', args.hero_tris), ('lite', args.lite_tris)):
        dup = decimated_copy(ob, target, f'soul_{lod}')
        v, n, tri, col = mesh_arrays(dup.data)
        path = os.path.join(out, f'soul-baseline-{lod}.glb')
        size = write_glb(path, v, n, tri, col, dict(meta, lod=lod, triangles=int(len(tri))))
        files[os.path.basename(path)] = {'bytes': size, 'triangles': int(len(tri)), 'vertices': int(len(v))}
        print(f'  {lod}: {len(tri)} tris, {len(v)} verts, {size / 1024:.0f} KB')
        dup.hide_render = True
        dup.hide_set(True)
    blend = os.path.join(out, 'soul-baseline.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    for fn in sorted(os.listdir(out)):
        fp = os.path.join(out, fn)
        if fn.endswith(('.png', '.glb', '.blend')) and os.path.isfile(fp):
            h = hashlib.sha256(open(fp, 'rb').read()).hexdigest()
            files.setdefault(fn, {})['sha256'] = h
            files[fn].setdefault('bytes', os.path.getsize(fp))
    prov = {'generator': 'tools/ai/blender/soul_baseline.py', 'version': args.version, 'blender': bpy.app.version_string,
            'voxel': args.voxel, 'camera': cam, 'eye': EYE, 'reference': 'docs/art/reference/soul-baseline-reference.png',
            'script_sha256': hashlib.sha256(open(__file__, 'rb').read()).hexdigest(),
            'splats_sha256': hashlib.sha256(open(SPLATS_PATH, 'rb').read()).hexdigest(), 'files': files,
            'license': 'internal original; sculpted procedurally from the supplied reference'}
    with open(os.path.join(out, 'provenance.json'), 'w') as fh:
        json.dump(prov, fh, indent=2)


def parse(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', default='build', choices=['fit', 'build', 'produce'])
    ap.add_argument('--out', default=os.path.join(ROOT, 'assets-src', 'generated', 'soul-baseline'))
    ap.add_argument('--voxel', type=float, default=0.008)
    ap.add_argument('--adaptivity', type=float, default=0.0)
    ap.add_argument('--palettes', default='lagoon,orchid,mint')
    ap.add_argument('--hero-tris', dest='hero_tris', type=int, default=24000)
    ap.add_argument('--lite-tris', dest='lite_tris', type=int, default=6000)
    ap.add_argument('--version', default='1.0.0')
    return ap.parse_args(argv)


if __name__ == '__main__':
    raw = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    a = parse(raw)
    if bpy is None:
        sys.exit('run inside Blender: Blender --background --factory-startup --python soul_baseline.py -- ...')
    run(a)
