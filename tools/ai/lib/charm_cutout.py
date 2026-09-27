#!/usr/bin/env python3
# tools/ai/lib/charm_cutout.py - cut-out, QA and contact sheets for the Gemini charm icons (docs/art/soul-decorations.md),
# driven by tools/ai/gemini-charms.js. Plain python3 + numpy + PIL (no scipy): 4-connected flood fill and labelling by
# alternating run sweeps, 3x3 morphology, premultiplied float resampling. Deterministic: the same raw image always gives
# the same icon bytes.
#
#   python3 tools/ai/lib/charm_cutout.py cutout < job.json   {key: [r,g,b], size, pad, items: [{id, raw, out}]} -> JSON
#   python3 tools/ai/lib/charm_cutout.py sheet < job.json    {out, title, columns, background, items: [{id, icon, pass, failed, review}]}
#   python3 tools/ai/lib/charm_cutout.py topng <out.png> < raw  lossless PNG of a raw image returned as JPEG
#
# Cut-out: the raw image is one sticker (object + white die-cut rim) on a flat key colour. The background is flood-filled
# from the image border over key-like pixels (close to the measured key, or strongly key-hued so a slight gradient still
# goes), the largest remaining component is the sticker, flat key-coloured holes inside it (a donut hole) are painted
# white, and the pixels along the outer edge are unmixed between the key and white: alpha = 1 - key share, colour moved
# to white (the only thing that touches the key is the white rim). The die-cut bounding box, padded by `pad` of its long
# side, is centred on a square and resampled to `size` px (premultiplied). Fully transparent pixels are stored white so
# texture filtering never pulls a dark or key-coloured fringe into the edge.
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image, ImageDraw, ImageFont

WHITE = np.array([255.0, 255.0, 255.0], np.float32)
HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = [os.path.join(HERE, '..', '..', '..', 'packages', 'vendor', 'fredoka', 'fredoka-latin.woff2'),
         '/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf', '/System/Library/Fonts/Helvetica.ttc']

# Cut-out tuning (raw-image scale; RGB distances are 0..441).
CUT = {
    'frame': 0.02,       # outer band (share of the side) that measures the key
    'floodTol': 90.0,    # background: RGB distance to the measured key ...
    'floodKey': 0.5,     # ... or keyness >= this share of the key's own keyness
    'holeTol': 48.0,     # key-coloured pixels inside the sticker are see-through gaps (painted white; no palette colour is this close)
    'edgeBand': 2,       # px either side of the sticker edge that get alpha from key/white unmixing
    'spillFloor': 180.0,  # rim spill: non-key channels at least this light count as tinted white
}
# QA thresholds, recorded in reports/ai/charms-qa.json.
QA = {
    'bgMatch': 0.97,      # background pixels within bgTol of the measured key
    'bgTol': 36.0,
    'keyDrift': 60.0,     # measured key vs requested key
    'minPart': 0.002,     # a second foreground component this large (share of the frame) is a second sticker
    'rawCover': [0.55, 0.95],  # raw sticker bbox long side / frame side (the prompt asks for about 0.75)
    'rawMargin': 0.01,    # the sticker must not touch the raw frame
    'fill': [0.22, 0.86],  # opaque share of the final icon
    'rimCover': 0.95,     # white share of the outline rings 2 and 3 px inside the edge (final icon)
    'rimMinPx': 3,        # rim at least this wide almost everywhere (leading rings >= 90% white, final icon)
    'centrePx': 2.0,      # final die-cut bbox centre offset, px
    'centroid': 0.12,     # final alpha centroid offset, share of the side
    'keyInside': 0.002,   # key-like share of the opaque icon
}


# ---------------------------------------------------------------- masks without scipy

def _runs(mask):
    """Horizontal runs of a C-contiguous 2D bool mask -> (flat indices, run id per index, index of each run start)."""
    w = mask.shape[1]
    idx = np.flatnonzero(mask.ravel())
    if idx.size == 0:
        return idx, idx, idx
    new = np.empty(idx.size, bool)
    new[0] = True
    new[1:] = (np.diff(idx) != 1) | (idx[1:] % w == 0)
    return idx, np.cumsum(new) - 1, np.flatnonzero(new)


def _sweep_any(reach, runs):
    idx, run, starts = runs
    hit = np.logical_or.reduceat(reach.ravel()[idx], starts)
    out = np.zeros(reach.size, bool)
    out[idx] = hit[run]
    return out.reshape(reach.shape)


def _sweep_min(lab, runs):
    idx, run, starts = runs
    mins = np.minimum.reduceat(lab.ravel()[idx], starts)
    out = lab.ravel().copy()
    out[idx] = mins[run]
    return out.reshape(lab.shape)


def flood(mask, seed):
    """Pixels of `mask` 4-connected to a `seed` pixel: alternate horizontal and vertical run sweeps until stable."""
    mask = np.ascontiguousarray(mask)
    rh, rv = _runs(mask), _runs(np.ascontiguousarray(mask.T))
    reach, n = seed & mask, -1
    while True:
        reach = _sweep_any(reach, rh)
        reach = np.ascontiguousarray(_sweep_any(np.ascontiguousarray(reach.T), rv).T)
        c = int(reach.sum())
        if c == n:
            return reach
        n = c


def label(mask):
    """4-connected component labels (0 = not in mask) and the area of each label."""
    mask = np.ascontiguousarray(mask)
    rh, rv = _runs(mask), _runs(np.ascontiguousarray(mask.T))
    lab = np.zeros(mask.shape, np.int64)
    if rh[0].size == 0:
        return lab, np.zeros(1, np.int64)
    lab.ravel()[rh[0]] = rh[1] + 1
    while True:
        new = np.ascontiguousarray(_sweep_min(np.ascontiguousarray(_sweep_min(lab, rh).T), rv).T)
        if np.array_equal(new, lab):
            break
        lab = new
    u, inv = np.unique(lab, return_inverse=True)
    lab = inv.reshape(mask.shape) + (1 if u[0] != 0 else 0)  # label 0 stays "not in mask" even for a full mask
    return lab, np.bincount(lab.ravel())


def erode(m, square=False):
    e = m.copy()
    e[1:] &= m[:-1]; e[:-1] &= m[1:]; e[:, 1:] &= m[:, :-1]; e[:, :-1] &= m[:, 1:]
    if square:
        e[1:, 1:] &= m[:-1, :-1]; e[1:, :-1] &= m[:-1, 1:]; e[:-1, 1:] &= m[1:, :-1]; e[:-1, :-1] &= m[1:, 1:]
    e[0] = e[-1] = False
    e[:, 0] = e[:, -1] = False
    return e


def dilate(m, r=1):
    for i in range(r):
        d = m.copy()
        d[1:] |= m[:-1]; d[:-1] |= m[1:]; d[:, 1:] |= m[:, :-1]; d[:, :-1] |= m[:, 1:]
        if i % 2:
            d[1:, 1:] |= m[:-1, :-1]; d[1:, :-1] |= m[:-1, 1:]; d[:-1, 1:] |= m[1:, :-1]; d[:-1, :-1] |= m[1:, 1:]
        m = d
    return m


def depth(m, dmax):
    """Ring index from the outside of `m` (1 = outermost ring), octagonal metric, capped at dmax; 0 outside."""
    out = np.zeros(m.shape, np.int32)
    cur = m
    for d in range(dmax):
        out += cur
        cur = erode(cur, square=d % 2 == 1)
        if not cur.any():
            break
    return out


# ---------------------------------------------------------------- colour helpers

def key_channels(key):
    hi = np.asarray(key) >= 128
    if hi.all() or not hi.any():
        raise ValueError(f'key {key} must be a saturated primary or secondary colour (e.g. #00FF00)')
    return hi


def keyness(rgb, hi):
    """How strongly a pixel leans to the key hue: min of the key's high channels minus max of its low channels."""
    return rgb[..., hi].min(-1) - rgb[..., ~hi].max(-1)


def whiteish(rgb, floor, spread):
    return (rgb.min(-1) >= floor) & (rgb.max(-1) - rgb.min(-1) <= spread)


def load_rgb(path):
    im = Image.open(path)
    im.load()
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        flat = Image.new('RGBA', im.size, (0, 0, 0, 255))
        im = Image.alpha_composite(flat, im)
    return np.asarray(im.convert('RGB'), dtype=np.float32)


# ---------------------------------------------------------------- cut-out + QA

def cutout(raw_path, key, size=256, pad=0.06, out=None):
    rgb = load_rgb(raw_path)
    h, w = rgb.shape[:2]
    hi = key_channels(key)
    key = np.asarray(key, np.float32)
    b = max(2, int(round(CUT['frame'] * min(h, w))))
    frame = np.zeros((h, w), bool)
    frame[:b] = frame[-b:] = True
    frame[:, :b] = frame[:, -b:] = True
    key_m = np.median(rgb[frame], axis=0).astype(np.float32)
    kn_key = float(keyness(key_m[None], hi)[0])
    m = {'size': [w, h], 'keyMeasured': [round(float(v), 1) for v in key_m],
         'keyDrift': round(float(np.linalg.norm(key_m - key)), 1)}
    if kn_key < 64:
        m.update({'error': 'the image border is not the key colour'})
        return m, _checks(m)

    dist = np.sqrt(((rgb - key_m) ** 2).sum(-1))
    kn = keyness(rgb, hi)
    cand = (dist <= CUT['floodTol']) | (kn >= CUT['floodKey'] * kn_key)
    edge = np.zeros((h, w), bool)
    edge[0] = edge[-1] = True
    edge[:, 0] = edge[:, -1] = True
    bg = flood(cand, edge)

    lab, areas = label(~bg)
    if areas.size < 2:
        m.update({'error': 'no sticker found'})
        return m, _checks(m)
    fg_areas = areas[1:]
    order = np.argsort(fg_areas)[::-1]
    main = int(order[0]) + 1
    others = fg_areas[order[1:]]
    big = others[others >= QA['minPart'] * h * w]
    sticker = lab == main
    sticker |= ~flood(~sticker, edge)                  # anything the sticker encloses belongs to it
    m['components'] = 1 + int(big.size)
    m['extraAreas'] = [round(float(a) / (h * w), 4) for a in big[:5]]
    m['specksDropped'] = int(others.size - big.size)

    # background uniformity (away from the sticker edge)
    far_bg = bg & ~dilate(sticker, 6)
    m['bgMatch'] = round(float((dist[far_bg] <= QA['bgTol']).mean()) if far_bg.any() else 0.0, 4)
    m['bgStd'] = round(float(rgb[far_bg].std(0).mean()) if far_bg.any() else 0.0, 2)

    # raw framing
    ys, xs = np.nonzero(sticker)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    m['rawCover'] = round(max(x1 - x0, y1 - y0) / min(w, h), 4)
    m['rawMargin'] = round(min(x0, y0, w - x1, h - y1) / min(w, h), 4)
    m['rawCentreOffset'] = round(float(np.hypot((x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2)) / min(w, h), 4)

    t = np.clip(kn / kn_key, 0.0, 1.0)
    out_rgb = rgb.copy()
    lift = (WHITE - key_m)

    # key-coloured holes and specks inside the sticker become white die-cut paper
    holes = sticker & (dist <= CUT['holeTol'])
    m['holeArea'] = round(float(holes.sum()) / (h * w), 4)
    if holes.any():
        zone = dilate(holes, 3) & sticker
        out_rgb[zone] += t[zone, None] * lift
        # JPEG chroma blur leaves the old rim/key seam light grey after unmixing: snap near-white back to white
        snap = zone & whiteish(np.clip(out_rgb, 0.0, 255.0), 190.0, 50.0)
        out_rgb[snap] = 255.0

    # rim width (raw) and spill: key-tinted near-white pixels in the outer part of the rim go back to white
    dmax = max(8, int(0.08 * min(h, w)))
    dep = depth(sticker, dmax)
    white_raw = whiteish(rgb, 200.0, 40.0)
    rim_raw = 0
    for d in range(3, dmax + 1):                       # rings 1-2 are the anti-aliased edge
        ring = dep == d
        if not ring.any() or white_raw[ring].mean() < 0.5:
            break
        rim_raw = d
    band = max(3, int(round(0.6 * rim_raw)))
    spill = sticker & (dep <= band) & (kn > 0) & (rgb[..., ~hi].min(-1) >= CUT['spillFloor'])
    out_rgb[spill] += t[spill, None] * lift
    m['rimRawPx'] = rim_raw

    # alpha: 1 inside, 0 outside, unmixed key/white along the edge
    alpha = sticker.astype(np.float32)
    e = CUT['edgeBand']
    ring = dilate(sticker, e) & ~erode_n(sticker, e)
    alpha[ring] = 1.0 - t[ring]
    out_rgb[ring] += t[ring, None] * lift
    out_rgb = np.clip(out_rgb, 0.0, 255.0)
    alpha[~dilate(sticker, e)] = 0.0

    icon = _square(out_rgb, alpha, pad, size)
    m.update(_final_metrics(icon, hi, key_m, kn_key))
    if out:
        os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
        Image.fromarray(icon, 'RGBA').save(out, 'PNG', optimize=True)
    return m, _checks(m)


def erode_n(m, n):
    for i in range(n):
        m = erode(m, square=i % 2 == 1)
    return m


def _square(rgb, alpha, pad, size):
    """Crop to the die-cut bbox, pad by `pad` of its long side, centre on a square, resample premultiplied."""
    ys, xs = np.nonzero(alpha > 0.02)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = int(round(max(x1 - x0, y1 - y0) * (1 + 2 * pad)))
    ox = int(round((x0 + x1) / 2 - side / 2))
    oy = int(round((y0 + y1) / 2 - side / 2))
    h, w = alpha.shape
    pre = np.zeros((side, side, 4), np.float32)
    sx0, sy0, sx1, sy1 = max(ox, 0), max(oy, 0), min(ox + side, w), min(oy + side, h)
    a = alpha[sy0:sy1, sx0:sx1]
    pre[sy0 - oy:sy1 - oy, sx0 - ox:sx1 - ox, 3] = a
    pre[sy0 - oy:sy1 - oy, sx0 - ox:sx1 - ox, :3] = rgb[sy0:sy1, sx0:sx1] / 255.0 * a[..., None]
    chans = [np.asarray(Image.fromarray(pre[..., c], 'F').resize((size, size), Image.LANCZOS), np.float32) for c in range(4)]
    res = np.stack(chans, -1)
    a = np.clip(res[..., 3], 0.0, 1.0)
    a8 = np.round(a * 255.0)
    a8[a8 <= 2] = 0                                      # resampling ringing outside the edge
    col = np.where(a[..., None] > 1e-4, res[..., :3] / np.maximum(a[..., None], 1e-4), 1.0)
    col = np.clip(np.round(col * 255.0), 0, 255)
    col[a8 < 255] = 255.0                                # partial alpha only occurs on the white rim's outer edge
    return np.dstack([col, a8]).astype(np.uint8)


def _final_metrics(icon, hi, key_m, kn_key):
    rgb = icon[..., :3].astype(np.float32)
    a = icon[..., 3].astype(np.float32) / 255.0
    n = icon.shape[0]
    solid = a >= 0.5
    ys, xs = np.nonzero(solid)
    bx = (xs.min() + xs.max() + 1) / 2 - n / 2
    by = (ys.min() + ys.max() + 1) / 2 - n / 2
    gy, gx = np.mgrid[0:n, 0:n]
    cx = float((a * (gx + 0.5)).sum() / a.sum()) - n / 2
    cy = float((a * (gy + 0.5)).sum() / a.sum()) - n / 2
    dep = depth(solid, 16)
    white = whiteish(rgb, 225.0, 30.0)
    rings = []
    for d in range(1, 17):
        sel = dep == d
        rings.append(round(float(white[sel].mean()), 3) if sel.any() else 0.0)
    lead = lambda thr: next((i for i, v in enumerate(rings) if v < thr), len(rings))
    key_like = (np.sqrt(((rgb - key_m) ** 2).sum(-1)) <= CUT['holeTol']) | (keyness(rgb, hi) >= CUT['floodKey'] * kn_key)
    return {
        'fill': round(float(solid.mean()), 4),
        'bboxOffsetPx': round(float(np.hypot(bx, by)), 2),
        'centroidOffset': round(float(np.hypot(cx, cy)) / n, 4),
        'rimRings': rings[:12],
        'rimCover': min(rings[1], rings[2]),
        'rimMinPx': lead(0.9),
        'rimWidthPx': lead(0.5),
        'keyInside': round(float((key_like & solid).sum()) / max(1, int(solid.sum())), 5),
    }


def _checks(m):
    if 'error' in m:
        return {'bgUniform': False, 'oneComponent': False, 'coverage': False, 'rim': False, 'centred': False, 'noKeyInside': False}
    lo, hi = QA['rawCover']
    flo, fhi = QA['fill']
    return {k: bool(v) for k, v in {
        'bgUniform': m['bgMatch'] >= QA['bgMatch'] and m['keyDrift'] <= QA['keyDrift'],
        'oneComponent': m['components'] == 1,
        'coverage': lo <= m['rawCover'] <= hi and m['rawMargin'] >= QA['rawMargin'] and flo <= m['fill'] <= fhi,
        'rim': m['rimCover'] >= QA['rimCover'] and m['rimMinPx'] >= QA['rimMinPx'],
        'centred': m['bboxOffsetPx'] <= QA['centrePx'] and m['centroidOffset'] <= QA['centroid'],
        'noKeyInside': m['keyInside'] <= QA['keyInside'],
    }.items()}


def _cut_item(args):
    item, key, size, pad = args
    try:
        metrics, checks = cutout(item['raw'], key, size, pad, item.get('out'))
    except Exception as e:  # a broken raw file fails its QA instead of the whole batch
        metrics, checks = {'error': f'{type(e).__name__}: {e}'}, _checks({'error': True})
    return {'id': item.get('id'), 'raw': item['raw'], 'out': item.get('out'), 'pass': all(checks.values()),
            'checks': checks, 'metrics': metrics}


def run_cutout(job):
    key, size, pad = job['key'], int(job.get('size', 256)), float(job.get('pad', 0.06))
    items = job['items']
    work = [(it, key, size, pad) for it in items]
    if len(work) > 2:
        with ProcessPoolExecutor(max_workers=min(8, os.cpu_count() or 2)) as ex:
            results = list(ex.map(_cut_item, work))
    else:
        results = [_cut_item(w) for w in work]
    return {'cut': CUT, 'qa': QA, 'items': results}


# ---------------------------------------------------------------- contact sheet

def _font(size):
    for f in FONTS:
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _hex(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def run_sheet(job):
    items, cols = job['items'], int(job.get('columns', 10))
    icon, thumb, pad = int(job.get('iconPx', 128)), int(job.get('thumbPx', 48)), 12
    cw, ch, head = icon + thumb + 3 * pad, icon + 2 * pad + 34, 70
    rows = max(1, (len(items) + cols - 1) // cols)
    im = Image.new('RGBA', (cols * cw + 2 * pad, head + rows * ch + pad), _hex(job.get('background', '#6C5CC8')) + (255,))
    draw = ImageDraw.Draw(im)
    draw.text((pad + 4, 16), job.get('title', ''), fill=(255, 255, 255, 255), font=_font(26))
    if job.get('subtitle'):
        draw.text((pad + 4, 46), job['subtitle'], fill=(232, 226, 255, 255), font=_font(14))
    lab, small = _font(15), _font(12)
    for i, it in enumerate(items):
        r, c = divmod(i, cols)
        x, y = pad + c * cw, head + r * ch
        if it.get('icon') and os.path.exists(it['icon']):
            ic = Image.open(it['icon']).convert('RGBA')
            im.alpha_composite(ic.resize((icon, icon), Image.LANCZOS), (x + pad, y + pad))
            im.alpha_composite(ic.resize((thumb, thumb), Image.LANCZOS), (x + 2 * pad + icon, y + pad + icon - thumb))
        draw.text((x + pad, y + pad + icon + 6), it['id'], fill=(255, 255, 255, 255), font=lab)
        if not it.get('pass', True):
            draw.rounded_rectangle([x + 3, y + 3, x + cw - 3, y + ch - 3], radius=10, outline=(255, 86, 110, 255), width=3)
            draw.text((x + pad, y + pad + icon + 22), 'QA: ' + ', '.join(it.get('failed') or ['missing']), fill=(255, 214, 222, 255), font=small)
        elif it.get('review'):
            draw.rounded_rectangle([x + 3, y + 3, x + cw - 3, y + ch - 3], radius=10, outline=(255, 196, 64, 255), width=3)
            draw.text((x + pad, y + pad + icon + 22), 'review: regenerate', fill=(255, 232, 170, 255), font=small)
    os.makedirs(os.path.dirname(job['out']) or '.', exist_ok=True)
    im.convert('RGB').save(job['out'], 'PNG', optimize=True)
    return {'out': job['out'], 'size': list(im.size), 'items': len(items)}


def to_png(data, out):
    """Lossless PNG of a raw image the API returned in another format (the decoded pixels, as the cutter sees them)."""
    import io
    im = Image.open(io.BytesIO(data))
    im.load()
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    im.convert('RGB').save(out, 'PNG')
    return {'out': out, 'size': list(im.size), 'from': im.format}


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'topng':
        print(json.dumps(to_png(sys.stdin.buffer.read(), sys.argv[2])))
        sys.exit(0)
    job = json.load(sys.stdin)
    if cmd == 'cutout':
        print(json.dumps(run_cutout(job)))
    elif cmd == 'sheet':
        print(json.dumps(run_sheet(job)))
    else:
        sys.exit('usage: charm_cutout.py cutout|sheet < job.json')
