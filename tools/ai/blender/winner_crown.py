"""Bingo winner's gold crown for the big screen (stage 15, D-36): the approved code-built draft of
packages/ui/soul3d/winner.js (buildWinnerCharm 'crown') rebuilt in Blender and written as a GLB, so the winning Soul
wears a Blender-made charm like the other Soul decorations (D-29 charms, D-31 face kits). No key, Blender 5.2, seconds.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/ai/blender/winner_crown.py -- [--no-preview] [--check]

What. A flared gold band (the draft's lathe profile (r, y) = (0.328, 0) (0.348, 0) (0.366, 0.1) (0.346, 0.1) revolved in
72 steps), five front spikes tilted outwards (16-sided cones, radius 0.058, height 0.15) each with a ruby (even) or
sapphire (odd) jewel on its tip, three sapphire gems on the band under the even spikes, and four plain 12-sided spikes
(radius 0.05, height 0.12) at the draft's "back" angles. Gold, ruby and sapphire are core glTF PBR with a little
emission. No textures, and no white die-cut: the big screen has none.
Why. D-36 (stage 15): on the big screen the winner wears the crown instead of the small Bingo Star medallion, so the
winning Soul stands out in the Galaxy. The review approved the procedural draft; like the other decorations, the shipped
piece is a Blender GLB published through the asset pipeline (tools/assets/build-winner-crown.js, manifest id
soul_winner_crown).
Frame. The crown's own frame, i.e. the draft's group before it is placed: origin at the centre of the band's base, +Y up,
+Z front (the viewer side: middle spike and ruby), in the units of the Soul's glTF model space (the Soul is 2.29 tall).
winner.js places it on the head (position (0.015, 1.49, -0.005), roll z -0.07) for the GLB and the procedural fallback
alike, so that placement is NOT applied here. Each piece's own transform in the crown is applied to its vertices.
Blender works Z up with the front at -Y; the export maps Blender (x, y, z) to glTF (x, z, -y).
Exactness. Band and cones are built with Blender's own operators (spin, cone) and come out vertex for vertex as the
draft's three.js geometry (same segment counts and phase); the band's quads are split along the draft's diagonals. The
normals are the draft's, set as Blender custom normals: smooth round the axis, each inner profile corner of the band the
length-weighted mean of its two sides, the band's base inner edge and the cone bases creased, the cone tips as three.js
builds them. The export writes those same analytic normals (Blender stores custom normals lossily; they are checked to
agree). The jewels and band gems are 12 x 8 UV spheres (the draft used 16 x 12 and 14 x 10): at 0.06 and 0.044 across
the difference is sub-pixel, and it keeps the file near 33 KB.
Format. The face-kit GLB format (soul_decor.kit_glb, written with its packer _glb_pack): KHR_mesh_quantization with
normalized int16 POSITION (raw-integer accessor min/max), normalized int8 NORMAL and uint16 indices; one mesh with one
primitive per material (extras.part gold / ruby / sapphire). The single root node "winner-crown" (the scene is unnamed,
so GLTFLoader keeps that name) has no transform: positions are stored in model units (the crown fits inside +-1), so the
runtime may set that node's own position and rotation. Vertices and triangles are written in a canonical sorted order, so a rebuild is byte-identical (Blender's
spin and sphere operators weld their seams in a run-dependent element order).

Writes assets-src/generated/winner/crown.glb and crown-preview.png (the shipped GLB decoded and rendered alone on dark
violet: EEVEE, AgX, the Galaxy's 3/4 azimuth; git-ignored). --no-preview skips the render; --check rebuilds in memory
and exits 1 when the committed GLB differs. Then node tools/assets/build-winner-crown.js publishes the GLB.
"""
import argparse
import math
import os
import sys
import time

import numpy as np

import bpy  # type: ignore
import bmesh  # type: ignore
from mathutils import Matrix, Vector  # type: ignore

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # no __pycache__ next to the checked-in sources
import soul_decor as sd  # noqa: E402  (the project's GLB packer and decoder; importing it defines functions only)

GENERATOR = 'tools/ai/blender/winner_crown.py'
OUT_DIR = os.path.join(ROOT, 'assets-src', 'generated', 'winner')
NODE = 'winner-crown'

# ------------------------------------------------------------------------------------ the approved design (winner.js)
BAND = {'profile': ((0.328, 0.0), (0.348, 0.0), (0.366, 0.1), (0.346, 0.1)), 'segments': 72}  # closed: back to the first point
BAND_TOP = 0.1
FRONT = {'count': 5, 'step': 0.56, 'ring': 0.356, 'radius': 0.058, 'height': 0.15, 'segments': 16, 'tilt': 0.12}
BACK = {'first': 5, 'last': 8, 'step': 2 * math.pi / 9, 'offset': 0.2, 'ring': 0.35, 'radius': 0.05, 'height': 0.12, 'segments': 12}
JEWEL = {'radius': 0.03, 'out': 1.02, 'rise': 0.16, 'segments': 12, 'rings': 8}
GEM = {'radius': 0.022, 'ring': 0.37, 'y': 0.05, 'segments': 12, 'rings': 8}
# The draft's MeshStandardMaterial colours (sRGB hex); glTF stores linear factors, emissive = colour x strength.
MATERIALS = {
    'gold': {'base': '#F6C453', 'metallic': 0.85, 'roughness': 0.3, 'emissive': '#7A5410', 'strength': 0.35},
    'ruby': {'base': '#E0356B', 'metallic': 0.2, 'roughness': 0.15, 'emissive': '#5A0A22', 'strength': 0.6},
    'sapphire': {'base': '#4D7DFF', 'metallic': 0.2, 'roughness': 0.15, 'emissive': '#0D1E66', 'strength': 0.6},
}
PREVIEW = {'size': (1200, 900), 'azimuth': 28.0, 'elevation': 20.0, 'lens': 70.0, 'fit': 0.8, 'background': '#1B1035'}


def log(*a):
    print('winner_crown:', *a, flush=True)


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def unit(v):
    v = np.asarray(v, float)
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def node_tree(idblock):
    """The node tree of a new material or world (Blender 5 always makes one; use_nodes is deprecated there)."""
    if idblock.node_tree is None:  # Blender 4
        idblock.use_nodes = True
    return idblock.node_tree


def pieces():
    """The draft's meshes in its build order: (name, kind, material, size, position, euler XYZ) in the crown's frame."""
    out = [('band', 'lathe', 'gold', None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))]
    for i in range(FRONT['count']):
        a = math.pi / 2 + (i - 2) * FRONT['step']  # across the front half, from +X toward +Z; i = 2 faces the viewer
        x, z = math.cos(a) * FRONT['ring'], math.sin(a) * FRONT['ring']
        out.append((f'spike_{i}', 'cone', 'gold', (FRONT['radius'], FRONT['height'], FRONT['segments']),
                    (x, BAND_TOP + FRONT['height'] / 2, z), (math.sin(a) * FRONT['tilt'], 0.0, -math.cos(a) * FRONT['tilt'])))
        out.append((f'jewel_{i}', 'sphere', 'sapphire' if i % 2 else 'ruby', (JEWEL['radius'], JEWEL['segments'], JEWEL['rings']),
                    (x * JEWEL['out'], BAND_TOP + JEWEL['rise'], z * JEWEL['out']), (0.0, 0.0, 0.0)))
        if i % 2 == 0:
            out.append((f'gem_{i}', 'sphere', 'sapphire', (GEM['radius'], GEM['segments'], GEM['rings']),
                        (math.cos(a) * GEM['ring'], GEM['y'], math.sin(a) * GEM['ring']), (0.0, 0.0, 0.0)))
    for i in range(BACK['first'], BACK['last'] + 1):
        # as approved: 301.5, 341.5, 21.5 and 61.5 degrees, so spikes 7 and 8 stand beside front spikes 0 and 1
        a = math.pi / 2 + i * BACK['step'] + BACK['offset']
        out.append((f'spike_{i}', 'cone', 'gold', (BACK['radius'], BACK['height'], BACK['segments']),
                    (math.cos(a) * BACK['ring'], BAND_TOP + BACK['height'] / 2, math.sin(a) * BACK['ring']), (0.0, 0.0, 0.0)))
    return out


# ------------------------------------------------------------------------------------ frames
# glTF model space -> Blender: (x, y, z) -> (x, -z, y); a model-space matrix M becomes C M C^-1.
C = Matrix(((1.0, 0.0, 0.0, 0.0), (0.0, 0.0, -1.0, 0.0), (0.0, 1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)))


def model_matrix(position, euler):
    """A three.js Object3D matrix in model space: T Rx Ry Rz (Euler order 'XYZ')."""
    ex, ey, ez = euler
    return Matrix.Translation(Vector(position)) @ Matrix.Rotation(ex, 4, 'X') @ Matrix.Rotation(ey, 4, 'Y') @ Matrix.Rotation(ez, 4, 'Z')


def to_blender(M):
    return C @ M @ C.inverted()


def blender_to_model(P):
    P = np.atleast_2d(np.asarray(P, float))
    return np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)


def model_to_blender(P):
    P = np.atleast_2d(np.asarray(P, float))
    return np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)


def three_angle(co):
    """three.js's angle round the Y axis (from model +Z toward +X; x = r sin t, z = r cos t) of Blender coordinates."""
    return np.arctan2(co[:, 0], -co[:, 1])


# ------------------------------------------------------------------------------------ meshes, normals, diagonals
def bm_mesh(bm, name):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])  # outward winding (glTF front faces are counter-clockwise)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def lathe_mesh(name):
    """The draft's LatheGeometry(profile, 72): the meridian at angle 0 (model +Z, Blender -Y) spun round the axis."""
    bm = bmesh.new()
    vs = [bm.verts.new((0.0, -r, y)) for r, y in BAND['profile']]
    es = [bm.edges.new((vs[k], vs[(k + 1) % len(vs)])) for k in range(len(vs))]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0.0, 0.0, 0.0), axis=(0.0, 0.0, 1.0), angle=2 * math.pi, steps=BAND['segments'], use_merge=True)
    return bm_mesh(bm, name)


def cone_mesh(name, radius, height, segments):
    """ConeGeometry(radius, height, segments): apex up at +height / 2, the base a triangle fan at -height / 2."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=segments, radius1=radius, radius2=0.0, depth=height)
    return bm_mesh(bm, name)


def sphere_mesh(name, radius, segments, rings):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    return bm_mesh(bm, name)


def loops(me):
    """(vertex coordinates (n, 3), loop -> vertex, loop -> polygon) of a mesh."""
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', lv)
    lp = np.empty(len(me.loops), np.int64)
    for p in me.polygons:
        lp[p.loop_start:p.loop_start + p.loop_total] = p.index
    return co.reshape(-1, 3).astype(np.float64), lv.astype(np.int64), lp


def corner_normals(me):
    cn = np.empty(len(me.loops) * 3, np.float32)
    me.corner_normals.foreach_get('vector', cn)
    return cn.reshape(-1, 3).astype(np.float64)


def band_shading(me):
    """The band's normals per loop and quad diagonals, as LatheGeometry makes them. Normals: each profile side's
    (dy, -dx) (as long as the side), summed at the inner corners, turned round the axis with the vertex; the first / last
    point (the base's inner edge) keeps its two sides apart. Diagonal: from (next angle, start of the side) to (previous
    angle, end of the side). Returns (normals, {polygon: loop offset the diagonal starts from})."""
    prof = np.asarray(BAND['profile'], float)
    n = len(prof)
    d = np.vstack([prof[1:], prof[:1]]) - prof
    side = np.stack([d[:, 1], -d[:, 0]], 1)
    init = np.array([unit(side[0])] + [unit(side[j - 1] + side[j]) for j in range(1, n)] + [unit(side[-1])])
    co, lv, lp = loops(me)
    r = np.hypot(co[:, 0], co[:, 1])
    jv = np.argmin(np.hypot(r[:, None] - prof[None, :, 0], co[:, 2:3] - prof[None, :, 1]), axis=1)  # profile point per vertex
    steps = BAND['segments']
    ring = np.mod(np.round(three_angle(co) / (2 * math.pi / steps)).astype(np.int64), steps)  # meridian per vertex
    seg = np.empty(len(me.polygons), np.int64)  # the profile side each face spans
    diag = {}
    for p in me.polygons:
        vs = list(p.vertices)
        js = sorted({int(jv[v]) for v in vs})
        k = n - 1 if js == [0, n - 1] else js[0]
        seg[p.index] = k
        r0, r1 = sorted({int(ring[v]) for v in vs})
        nxt = r1 if (r1 - r0) % steps == 1 else r0  # the meridian one step further in the draft's angle
        diag[p.index] = next(c for c, v in enumerate(vs) if jv[v] == k and ring[v] == nxt)
    j = jv[lv]
    pick = np.where((j == 0) & (seg[lp] == n - 1), n, j)
    radial = co[lv, :2] / r[lv, None]
    return unit(np.column_stack([init[pick, 0:1] * radial, init[pick, 1]])), diag


def cone_normals(me, radius, height, segments):
    """ConeGeometry's normals: model (sin t, radius / height, cos t) on the sides, t the vertex's three.js angle; the tip
    of each side triangle takes its next base vertex's normal (as three.js builds the tip); -Y on the base."""
    co, lv, lp = loops(me)
    slope = radius / height
    theta = three_angle(co)
    apex = co[:, 2] > height / 2 - 1e-6
    base = co[:, 2] < -height / 2 + 1e-6
    N = np.zeros((len(lv), 3))
    for p in me.polygons:
        vs = list(p.vertices)
        if all(base[v] for v in vs):
            N[p.loop_start:p.loop_start + p.loop_total] = (0.0, 0.0, -1.0)
            continue
        a, b = [v for v in vs if not apex[v]]
        nxt = b if (theta[b] - theta[a]) % (2 * math.pi) < math.pi else a
        for k, v in enumerate(vs):
            t = theta[nxt if apex[v] else v]
            N[p.loop_start + k] = (math.sin(t), -math.cos(t), slope)  # Blender form of model (sin t, slope, cos t)
    return unit(N)


def sphere_normals(me):
    co, lv, _ = loops(me)
    return unit(co[lv])


def lowest_corner_diagonals(me):
    """A fixed split for quads that have no draft diagonal (the UV spheres): from the corner with the lowest (x, y, z)."""
    co, _, _ = loops(me)
    key = np.round(co, 6)
    return {p.index: min(range(4), key=lambda c: tuple(key[p.vertices[c]])) for p in me.polygons if p.loop_total == 4}


def triangles(me, diag):
    """Loop triangles of a mesh of triangles and quads, each quad split along diag[polygon] (winding kept)."""
    tris = []
    for p in me.polygons:
        ls = list(range(p.loop_start, p.loop_start + p.loop_total))
        if len(ls) == 3:
            tris.append(ls)
        elif len(ls) == 4:
            a, b, c, d = (ls[(diag[p.index] + k) % 4] for k in range(4))
            tris += [[a, b, c], [a, c, d]]
        else:
            raise SystemExit(f'winner_crown: {me.name} has a {len(ls)}-gon')
    return np.array(tris, np.int64)


def material(key):
    spec = MATERIALS[key]
    m = bpy.data.materials.new(key)
    b = node_tree(m).nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(spec['base']), 1.0)
    b.inputs['Metallic'].default_value = spec['metallic']
    b.inputs['Roughness'].default_value = spec['roughness']
    b.inputs['Emission Color'].default_value = (*lin(spec['emissive']), 1.0)
    b.inputs['Emission Strength'].default_value = spec['strength']
    return m


def build_crown():
    """The crown as Blender objects under the empty 'winner-crown' (the draft's group, at the origin), each piece's
    transform applied to its mesh. Returns ([(object, material key, loop normals, quad diagonals)], worst difference in
    degrees between Blender's custom normals and the analytic ones after the transforms)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    root = bpy.data.objects.new(NODE, None)
    sc.collection.objects.link(root)
    mats = {k: material(k) for k in MATERIALS}
    made = []
    for name, kind, key, size, pos, euler in pieces():
        if kind == 'lathe':
            me = lathe_mesh(name)
            N, diag = band_shading(me)
        elif kind == 'cone':
            me = cone_mesh(name, *size)
            N, diag = cone_normals(me, *size), {}
        else:
            me = sphere_mesh(name, *size)
            N, diag = sphere_normals(me), lowest_corner_diagonals(me)
        me.shade_smooth()
        me.normals_split_custom_set(N.tolist())
        me.materials.append(mats[key])
        ob = bpy.data.objects.new(name, me)
        sc.collection.objects.link(ob)
        ob.parent = root
        ob.matrix_basis = to_blender(model_matrix(pos, euler))
        made.append([ob, key, N, diag])
    bpy.context.view_layer.update()
    worst = 0.0
    for item in made:  # apply transforms: the piece's place in the crown goes into its vertices, the normals turn along
        ob, N = item[0], item[2]
        M = ob.matrix_world.copy()
        ob.data.transform(M)
        ob.matrix_basis = Matrix.Identity(4)
        ob.data.update()
        item[2] = unit(N @ np.array(M.to_3x3()).T)
        got = unit(corner_normals(ob.data))
        worst = max(worst, float(np.degrees(np.arccos(np.clip((item[2] * got).sum(1), -1.0, 1.0))).max()))
    if worst > 0.5:
        raise SystemExit(f'winner_crown: Blender custom normals differ by {worst:.2f} degrees from the analytic ones')
    return [tuple(item) for item in made], worst


# ------------------------------------------------------------------------------------ export
def crown_parts(made):
    """Per material: the triangle corners of its pieces as quantised (int16 position, int8 normal) rows, turned into
    canonical vertices (sorted rows, one per distinct pair) and triangles (each starting at its lowest index, sorted)."""
    corners = {k: [] for k in MATERIALS}
    names = {k: [] for k in MATERIALS}
    for ob, key, N, diag in made:
        co, lv, _ = loops(ob.data)
        P = blender_to_model(co)
        if np.abs(P).max() >= 1.0:
            raise SystemExit(f'winner_crown: {ob.name} leaves the +-1 range of normalized int16 model units')
        tl = triangles(ob.data, diag)
        q = np.round(P[lv[tl]] * 32767).astype(np.int64)
        nq = np.round(unit(blender_to_model(N.reshape(-1, 3)))[tl.ravel()].reshape(tl.shape + (3,)) * 127).astype(np.int64)
        corners[key].append(np.concatenate([q, nq], axis=2))
        names[key].append(ob.name)
    parts = {}
    for key, rows in corners.items():
        rows = np.concatenate(rows)
        V, inv = np.unique(rows.reshape(-1, 6), axis=0, return_inverse=True)
        I = inv.reshape(-1, 3)
        first = np.argmin(I, axis=1)
        I = np.stack([I[np.arange(len(I)), (first + k) % 3] for k in range(3)], 1)
        I = I[np.lexsort((I[:, 2], I[:, 1], I[:, 0]))]
        if len(V) >= 65536:
            raise SystemExit(f'winner_crown: {key} needs more than uint16 indices')
        parts[key] = {'Q': V[:, :3], 'NQ': V[:, 3:], 'I': I, 'pieces': names[key]}
    return parts


def gl_material(key):
    """Core glTF PBR from the Blender material: linear base colour, metallic, roughness, emissive = colour x strength."""
    b = bpy.data.materials[key].node_tree.nodes['Principled BSDF']
    s = float(b.inputs['Emission Strength'].default_value)
    return {'name': key,
            'pbrMetallicRoughness': {'baseColorFactor': [round(float(c), 5) for c in b.inputs['Base Color'].default_value[:3]] + [1.0],
                                     'metallicFactor': round(float(b.inputs['Metallic'].default_value), 5),
                                     'roughnessFactor': round(float(b.inputs['Roughness'].default_value), 5)},
            'emissiveFactor': [round(min(1.0, max(0.0, float(c) * s)), 5) for c in b.inputs['Emission Color'].default_value[:3]]}


def crown_glb(parts):
    """GLB bytes: KHR_mesh_quantization, one node 'winner-crown' without a transform, one primitive per material."""
    blobs, accessors, prims, mats = [], [], [], []
    for key, part in parts.items():
        Q, NQ, I = part['Q'], part['NQ'], part['I']
        pos = np.zeros((len(Q), 4), np.int16)
        pos[:, :3] = Q
        nrm = np.zeros((len(NQ), 4), np.int8)
        nrm[:, :3] = NQ
        attrs = {'POSITION': len(accessors)}
        accessors.append({'bufferView': len(blobs), 'componentType': 5122, 'normalized': True, 'count': len(Q), 'type': 'VEC3',
                          'min': Q.min(0).astype(int).tolist(), 'max': Q.max(0).astype(int).tolist()})  # raw stored values (glTF 2.0)
        blobs.append((pos.tobytes(), 8, 34962))
        attrs['NORMAL'] = len(accessors)
        accessors.append({'bufferView': len(blobs), 'componentType': 5120, 'normalized': True, 'count': len(NQ), 'type': 'VEC3'})
        blobs.append((nrm.tobytes(), 4, 34962))
        idx = I.astype(np.uint16).ravel()
        accessors.append({'bufferView': len(blobs), 'componentType': 5123, 'count': int(idx.size), 'type': 'SCALAR'})
        blobs.append((idx.tobytes(), None, 34963))
        prims.append({'attributes': attrs, 'indices': len(accessors) - 1, 'material': len(mats), 'extras': {'part': key}})
        mats.append(gl_material(key))
    meta = {'crown': 'winner', 'version': 1, 'design': 'packages/ui/soul3d/winner.js buildWinnerCharm crown (stage-15 draft, approved)',
            'frame': "the crown's own frame: origin at the centre of the band's base, +Y up, +Z front, Soul model units; winner.js places it on the head",
            'parts': list(parts), 'pieces': {k: v['pieces'] for k, v in parts.items()},
            'triangles': int(sum(len(v['I']) for v in parts.values())), 'vertices': int(sum(len(v['Q']) for v in parts.values()))}
    gl = {'asset': {'version': '2.0', 'generator': 'ariskill ' + GENERATOR, 'extras': meta},
          'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
          'scene': 0, 'scenes': [{'nodes': [0]}],  # unnamed: GLTFLoader names the scene first, the node keeps "winner-crown"
          'nodes': [{'name': NODE, 'mesh': 0}],
          'meshes': [{'name': NODE, 'primitives': prims}], 'materials': mats, 'accessors': accessors}
    return sd._glb_pack(gl, blobs), meta


# ------------------------------------------------------------------------------------ preview
def preview(glb_path, png_path):
    """The written GLB decoded and placed back in an empty scene (exactly what ships), alone on dark violet: EEVEE, AgX,
    the Galaxy's 3/4 camera azimuth (SOUL_VIEW.yaw, 28 degrees toward +X), a little above."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    gl, prims = sd.decode_glb(glb_path)
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for i, pr in enumerate(prims):
        g = pr['material']
        m = bpy.data.materials.new(g['name'])
        b = node_tree(m).nodes['Principled BSDF']
        pb = g['pbrMetallicRoughness']
        b.inputs['Base Color'].default_value = tuple(pb['baseColorFactor'])
        b.inputs['Metallic'].default_value = pb['metallicFactor']
        b.inputs['Roughness'].default_value = pb['roughnessFactor']
        b.inputs['Emission Color'].default_value = (*g.get('emissiveFactor', [0.0, 0.0, 0.0]), 1.0)
        b.inputs['Emission Strength'].default_value = 1.0
        V = model_to_blender(pr['P'])
        me = bpy.data.meshes.new(f'glb_{i}')
        me.from_pydata(V.tolist(), [], pr['I'].tolist())
        me.update()
        me.shade_smooth()
        me.normals_split_custom_set_from_vertices(unit(model_to_blender(pr['N'])).tolist())
        me.materials.append(m)
        sc.collection.objects.link(bpy.data.objects.new(f'glb_{i}', me))
        lo, hi = np.minimum(lo, V.min(0)), np.maximum(hi, V.max(0))
    W, H = PREVIEW['size']
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.eevee.taa_render_samples = 64
    except Exception:
        pass
    # world: the camera sees flat dark violet; lighting and reflections see a soft studio gradient (warm top, violet floor)
    w = bpy.data.worlds.new('preview')
    sc.world = w
    nt = node_tree(w)
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    seen = nt.nodes.new('ShaderNodeBackground')
    seen.inputs['Color'].default_value = (*lin(PREVIEW['background']), 1.0)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(sep.outputs['Z'], ramp.inputs[0])
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.0, (*lin('#2A1D52'), 1.0)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 1.0, (*lin('#FFF1DC'), 1.0)
    studio = nt.nodes.new('ShaderNodeBackground')
    studio.inputs['Strength'].default_value = 0.9
    nt.links.new(ramp.outputs['Color'], studio.inputs['Color'])
    path = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(path.outputs['Is Camera Ray'], mix.inputs['Fac'])
    nt.links.new(studio.outputs['Background'], mix.inputs[1])
    nt.links.new(seen.outputs['Background'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    centre = Vector(((lo + hi) / 2).tolist())
    radius = float(np.linalg.norm(hi - lo) / 2)
    for name, az, el, dist, energy, size, col in (('key', -35.0, 40.0, 3.0, 260.0, 1.6, '#FFF1E0'), ('fill', 70.0, 12.0, 3.0, 90.0, 2.0, '#C9D6FF'),
                                                  ('rim', 160.0, 35.0, 3.0, 220.0, 1.2, '#E6DDFF')):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.energy, ld.size, ld.color = energy, size, lin(col)
        lamp = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(lamp)
        a, e = math.radians(az), math.radians(el)
        lamp.location = centre + dist * Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
        lamp.rotation_euler = (centre - lamp.location).to_track_quat('-Z', 'Y').to_euler()
    cd = bpy.data.cameras.new('cam')
    cd.lens = PREVIEW['lens']
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    half_fov = math.atan(cd.sensor_width / 2 / cd.lens * min(1.0, H / W))  # the narrower (vertical) half angle
    a, e = math.radians(PREVIEW['azimuth']), math.radians(PREVIEW['elevation'])
    cam.location = centre + (radius * PREVIEW['fit'] / math.sin(half_fov)) * Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = png_path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------------------------ main
def parse(argv):
    ap = argparse.ArgumentParser(description='Bingo winner crown (stage 15, D-36): Blender model -> GLB + preview')
    ap.add_argument('--out', default=OUT_DIR, help='output directory (default assets-src/generated/winner)')
    ap.add_argument('--no-preview', action='store_true', help='write the GLB only')
    ap.add_argument('--check', action='store_true', help='rebuild in memory; exit 1 when <out>/crown.glb differs')
    return ap.parse_args(argv)


def main(argv):
    args = parse(argv)
    t0 = time.time()
    made, worst = build_crown()
    data, meta = crown_glb(crown_parts(made))
    out = os.path.abspath(args.out)
    glb_path = os.path.join(out, 'crown.glb')
    log(f'{meta["triangles"]} triangles, {meta["vertices"]} vertices, {len(data)} bytes; Blender custom normals within {worst:.3f} deg')
    if args.check:
        same = os.path.exists(glb_path) and open(glb_path, 'rb').read() == data
        log(f'{os.path.relpath(glb_path, ROOT)} is {"current" if same else "STALE (rebuild without --check)"}')
        return 0 if same else 1
    os.makedirs(out, exist_ok=True)
    with open(glb_path, 'wb') as fh:
        fh.write(data)
    log('wrote', os.path.relpath(glb_path, ROOT))
    if not args.no_preview:
        png_path = os.path.join(out, 'crown-preview.png')
        preview(glb_path, png_path)
        log('wrote', os.path.relpath(png_path, ROOT))
    log(f'done in {time.time() - t0:.1f}s')
    return 0


if __name__ == '__main__':
    code = main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if code:
        sys.exit(code)
