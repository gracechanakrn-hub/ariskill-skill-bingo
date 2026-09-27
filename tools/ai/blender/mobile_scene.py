"""Employee mobile v2 art (D-34): portrait backdrop, 4 x 4 board tray and tile states, in the sticker clay language
(docs/art/sticker-art-direction.md). Review renders only; nothing here is wired into the app yet.

    blender -b -P tools/ai/blender/mobile_scene.py -- [--only backdrop|board|tiles] [--out assets-src/generated/mobile-v2]

Outputs (PNG): backdrop-1080x2340.png, backdrop-540x1170.png, board-tray.png (transparent, 1200 px),
tile-empty.png / tile-picked.png / tile-matched.png (transparent, 320 px).
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, arg('--out', 'assets-src/generated/mobile-v2'))
ONLY = arg('--only')
os.makedirs(OUT, exist_ok=True)


def hex_lin(h, a=1.0):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c) + (a,)


# ---- scene helpers ------------------------------------------------------------------------------------------
def reset(ui=False):
    """ui=True keeps token colours exact (Standard view) for board and tile assets; the backdrop uses AgX."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    if ui:
        sc.view_settings.view_transform = 'Standard'
    else:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    try:
        sc.eevee.taa_render_samples = 64
        sc.eevee.use_shadows = True
    except Exception:
        pass
    sc.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('World'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = hex_lin('#0B1030')
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    return sc


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def clay(name, base, rough=0.32, coat=1.0, sheen=0.5, emit=None, emit_strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = hex_lin(base)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = 0.12
    b.inputs['Sheen Weight'].default_value = sheen
    b.inputs['Sheen Tint'].default_value = hex_lin('#FFB27A')
    if emit:
        b.inputs['Emission Color'].default_value = hex_lin(emit)
        b.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    return m


def emissive(name, col, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = hex_lin(col); e.inputs['Strength'].default_value = strength
    o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0], o.inputs[0])
    return m


def area(name, loc, energy, size, col, target=(0, 0, 0)):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy, ld.size, ld.color = energy, size, hex_lin(col)[:3]
    lo = link(bpy.data.objects.new(name, ld)); lo.location = Vector(loc)
    lo.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return lo


def camera(loc, target, ortho=None, lens=50):
    cd = bpy.data.cameras.new('cam')
    if ortho: cd.type = 'ORTHO'; cd.ortho_scale = ortho
    else: cd.lens = lens
    co = link(bpy.data.objects.new('cam', cd)); co.location = Vector(loc)
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = co
    return co


def rounded_box(name, sx, sy, sz, bevel, segs=8, mat=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = link(bpy.data.objects.new(name, me)); ob.location = Vector(loc)
    if mat: ob.data.materials.append(mat)
    return ob


def sphere(name, r, loc, mat, seg=48, scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = link(bpy.data.objects.new(name, me)); ob.location = Vector(loc); ob.scale = scale
    ob.data.materials.append(mat)
    return ob


def cone(name, r1, r2, h, loc, mat, seg=40):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges], offset=min(r1, h) * 0.18, segments=6, affect='EDGES')
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = link(bpy.data.objects.new(name, me)); ob.location = Vector(loc); ob.data.materials.append(mat)
    return ob


def torus(name, R, r, loc, mat, rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    segs, rings = 96, 24
    verts = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        row = []
        for j in range(rings):
            b = 2 * math.pi * j / rings
            row.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b) * 0.35)))
        verts.append(row)
    for i in range(segs):
        for j in range(rings):
            bm.faces.new((verts[i][j], verts[(i + 1) % segs][j], verts[(i + 1) % segs][(j + 1) % rings], verts[i][(j + 1) % rings]))
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = link(bpy.data.objects.new(name, me)); ob.location = Vector(loc); ob.rotation_euler = rot; ob.data.materials.append(mat)
    return ob


def sky_card(w, h, loc):
    """Vertical gradient sky card with an aurora band, all procedural (no textures)."""
    m = bpy.data.materials.new('sky'); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear(); L = nt.links.new
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L(tc.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); L(sep.outputs['Z'], ramp.inputs[0])  # the card stands in XZ
    cr = ramp.color_ramp; cr.elements[0].position = 0.25; cr.elements[0].color = hex_lin('#4A3796'); cr.elements[1].position = 1.0; cr.elements[1].color = hex_lin('#070A22')
    e = cr.elements.new(0.55); e.color = hex_lin('#151C48')
    # aurora: a soft diagonal band (height Z tilted by X), teal -> lime, broken up by a wave texture
    tilt = nt.nodes.new('ShaderNodeMath'); tilt.operation = 'MULTIPLY_ADD'; tilt.inputs[1].default_value = 0.28
    L(sep.outputs['X'], tilt.inputs[0]); L(sep.outputs['Z'], tilt.inputs[2])
    wave = nt.nodes.new('ShaderNodeTexWave'); wave.inputs['Scale'].default_value = 2.2; wave.inputs['Distortion'].default_value = 4.0; wave.inputs['Detail'].default_value = 2.0
    wave.bands_direction = 'X'
    L(tc.outputs['Generated'], wave.inputs['Vector'])
    band = nt.nodes.new('ShaderNodeValToRGB'); L(tilt.outputs[0], band.inputs[0])
    b = band.color_ramp; b.interpolation = 'EASE'
    b.elements[0].position = 0.70; b.elements[0].color = (0, 0, 0, 1); b.elements[1].position = 1.0; b.elements[1].color = (0, 0, 0, 1)
    mid = b.elements.new(0.84); mid.color = (1, 1, 1, 1)
    sep2 = sep
    hue = nt.nodes.new('ShaderNodeValToRGB'); L(sep2.outputs['X'], hue.inputs[0])
    hue.color_ramp.elements[0].color = hex_lin('#4FE3C1'); hue.color_ramp.elements[1].color = hex_lin('#B6FF5C'); hue.color_ramp.elements[0].position = 0.15; hue.color_ramp.elements[1].position = 1.0
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; L(band.outputs[0], mul.inputs[0]); L(wave.outputs['Fac'], mul.inputs[1])
    mul2 = nt.nodes.new('ShaderNodeMath'); mul2.operation = 'MULTIPLY'; mul2.inputs[1].default_value = 0.5; L(mul.outputs[0], mul2.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'ADD'
    # the Mix node has float / vector / colour sockets sharing names; the RGBA ones are A=6, B=7, Result=2
    L(mul2.outputs[0], mix.inputs[0]); L(ramp.outputs[0], mix.inputs[6]); L(hue.outputs[0], mix.inputs[7])
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.0; L(mix.outputs[2], em.inputs[0])
    out = nt.nodes.new('ShaderNodeOutputMaterial'); L(em.outputs[0], out.inputs[0])
    me = bpy.data.meshes.new('sky'); bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    for v in bm.verts: v.co = Vector((v.co.x * w, 0, v.co.y * h))
    bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new('sky', me)); ob.location = Vector(loc); ob.data.materials.append(m)
    return ob


# ---- backdrop -------------------------------------------------------------------------------------------------
def backdrop():
    sc = reset()
    rnd = random.Random(33)
    W, H = 1080, 2340
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.film_transparent = False
    sc.render.image_settings.color_mode = 'RGB'
    try:
        sc.eevee.use_bloom = True
    except Exception:
        pass
    camera((0, -14, 1.2), (0, 0, 1.2), lens=40)
    # sky card far behind
    sky_card(30, 30, (0, 14, 1.5))
    # stars
    star_mats = [emissive('star-w', '#FFFFFF', 6), emissive('star-c', '#63E6FF', 5), emissive('star-g', '#F6C453', 5)]
    for i in range(260):
        x, z = rnd.uniform(-12, 12), rnd.uniform(-2, 14)
        r = rnd.choice([0.018, 0.022, 0.03, 0.045]) if rnd.random() < 0.92 else 0.07
        sphere(f'star{i}', r, (x, 12.5, z), rnd.choice(star_mats) if rnd.random() < 0.3 else star_mats[0], seg=8)
    # clay planet ground (big sphere) with rolling hills
    ground = clay('ground', '#2A1F66', rough=0.5, coat=0.5, sheen=0.3)
    sphere('planet', 30, (0, 6, -34.2), ground, seg=128)
    hill = clay('hill', '#5A45B0', rough=0.4, coat=0.8)
    hill2 = clay('hill2', '#2D2670', rough=0.45, coat=0.6)
    for i, (x, y, s) in enumerate([(-6, 8, 3.8), (5.5, 9, 4.2), (-1.5, 10, 3.0), (8, 6, 2.6), (-8.5, 5.5, 2.4)]):
        sphere(f'hill{i}', s, (x, y, -5.1 - s * 0.35), hill if i % 2 == 0 else hill2, scale=(1.4, 1, 0.8))
    # clay trees: gumdrop cones in lilac / violet with glowing tips, front row larger
    tree_cols = ['#8B7CF0', '#6E5BD6', '#A596FF', '#5A45B0']
    trunk = clay('trunk', '#2D2670', rough=0.5)
    glow_mats = [emissive('glow-mint', '#7CF5C8', 9), emissive('glow-cyan', '#63E6FF', 8), emissive('glow-gold', '#F6C453', 8)]
    spots = []
    for i in range(34):
        x = rnd.uniform(-9.5, 9.5); y = rnd.uniform(-1.5, 9)
        if abs(x) < 2.2 and y < 3: continue
        spots.append((x, y))
    for i, (x, y) in enumerate(sorted(spots, key=lambda p: -p[1])):
        s = 1.25 - y * 0.06 + rnd.uniform(-0.15, 0.2)
        base = -3.9 + y * 0.12 - 0.012 * x * x
        sphere(f'trunk{i}', 0.1 * s, (x, y, base + 0.3 * s), trunk, seg=16, scale=(1, 1, 3))
        m = clay(f'tree{i}', rnd.choice(tree_cols), rough=0.3)
        sphere(f'tree{i}', 0.55 * s, (x, y, base + 1.15 * s), m, seg=48, scale=(1, 1, 1.35))
        sphere(f'treetop{i}', 0.36 * s, (x, y, base + 1.85 * s), m, seg=40, scale=(1, 1, 1.2))
        sphere(f'tip{i}', 0.09 * s, (x, y, base + 2.35 * s), rnd.choice(glow_mats), seg=16)
    # glowing mushroom orbs and fireflies near the ground
    for i in range(40):
        x = rnd.uniform(-9, 9); y = rnd.uniform(-2.5, 7)
        sphere(f'fly{i}', rnd.uniform(0.03, 0.07), (x, y, -3.4 + rnd.uniform(0, 3.2) + y * 0.1), rnd.choice(glow_mats), seg=12)
    # sticker speckles on the ground (mint / cyan / lilac, two sizes)
    speck = [clay('sp-mint', '#7CF5C8', rough=0.3, emit='#7CF5C8', emit_strength=0.3), clay('sp-cyan', '#63E6FF', rough=0.3, emit='#63E6FF', emit_strength=0.3), clay('sp-lilac', '#A596FF', rough=0.3)]
    for i in range(70):
        x = rnd.uniform(-10, 10); y = rnd.uniform(-3, 8)
        z = -4.2 - (x * x + (y - 6) ** 2) / 60.0
        r = rnd.choice([0.06, 0.08, 0.12, 0.16])
        sphere(f'speck{i}', r, (x, y, z), rnd.choice(speck), seg=16, scale=(1, 1, 0.35))
    # ringed planet and a small moon (sticker doodads, upper corners)
    planet_m = clay('planet-lilac', '#8B7CF0', rough=0.28)
    sphere('ringed', 1.0, (-3.3, 8, 8.2), planet_m)
    torus('ring', 1.7, 0.13, (-3.3, 8, 8.2), clay('ring', '#F6C453', rough=0.25), rot=(math.radians(72), math.radians(-18), 0))
    sphere('moon', 0.5, (3.9, 8, 5.4), clay('moon', '#FFB27A', rough=0.3))
    for i in range(5):
        sphere(f'crater{i}', 0.1, (3.9 + rnd.uniform(-0.28, 0.28), 7.55, 5.4 + rnd.uniform(-0.28, 0.28)), clay('crater', '#E8935A'), seg=12)
    area('key', (-6, -8, 10), 1400, 8, '#FFE9D6', target=(0, 4, -3))
    area('fill', (8, -6, 2), 350, 8, '#9FB3FF', target=(0, 4, -3))
    area('rim', (0, 14, 1), 450, 10, '#B9A8FF', target=(0, 4, -2))
    for name, (w, h) in [('backdrop-1080x2340.png', (1080, 2340)), ('backdrop-540x1170.png', (540, 1170))]:
        sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.render.filepath = os.path.join(OUT, name)
        bpy.ops.render.render(write_still=True)
        print('wrote', sc.render.filepath)


# ---- board tray -----------------------------------------------------------------------------------------------
def tray():
    sc = reset(ui=True)
    sc.render.resolution_x = sc.render.resolution_y = 1200
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    camera((0, 0, 20), (0, 0, 0), ortho=4.6)
    # white die-cut rim, violet clay slab, 16 shallow wells
    rounded_box('diecut', 4.36, 4.36, 0.16, 0.5, mat=clay('white', '#FFFFFF', rough=0.4, coat=0.3, sheen=0.1, emit='#FFFFFF', emit_strength=0.35), loc=(0, 0, -0.08))
    rounded_box('slab', 4.16, 4.16, 0.28, 0.42, mat=clay('slab', '#4A3796', rough=0.3), loc=(0, 0, 0.0))
    well = clay('well', '#171243', rough=0.55, coat=0.3)
    step = 0.98
    for r in range(4):
        for c in range(4):
            x = (c - 1.5) * step; y = (1.5 - r) * step
            rounded_box(f'well{r}{c}', 0.9, 0.9, 0.02, 0.08, segs=4, mat=well, loc=(x, y, 0.141))
    area('key', (-4, -5, 9), 900, 6, '#FFF4E8')
    area('fill', (5, -3, 6), 300, 6, '#C9D6FF')
    area('rim', (2, 6, 5), 500, 4, '#E6DDFF')
    sc.render.filepath = os.path.join(OUT, 'board-tray.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath)


# ---- tiles ----------------------------------------------------------------------------------------------------
def star_mesh(name, r_out, r_in, depth, loc, mat):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rr = r_out if i % 2 == 0 else r_in
        pts.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), 0)))
    f = bm.faces.new(pts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)]: v.co.z += depth
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=depth * 0.35, segments=4, affect='EDGES')
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = link(bpy.data.objects.new(name, me)); ob.location = Vector(loc); ob.data.materials.append(mat)
    return ob


def tiles():
    variants = {
        'empty': dict(body=lambda: clay('empty', '#241C5C', rough=0.35, coat=0.8, alpha=0.9), rim='#6E5BD6'),
        'picked': dict(body=lambda: clay('picked', '#E6E0FF', rough=0.28, coat=1.0, sheen=0.2, emit='#E6E0FF', emit_strength=0.35), rim='#FFFFFF'),
        'matched': dict(body=lambda: clay('matched', '#7CF5C8', rough=0.26, coat=1.0, sheen=0.3, emit='#7CF5C8', emit_strength=0.25), rim='#FFFFFF', star=True),
    }
    for name, v in variants.items():
        sc = reset(ui=True)  # materials are made after the reset, which clears the file
        sc.render.resolution_x = sc.render.resolution_y = 320
        sc.render.film_transparent = True
        sc.render.image_settings.color_mode = 'RGBA'
        camera((0, 0, 20), (0, 0, 0), ortho=1.06)
        rounded_box('rim', 1.0, 1.0, 0.14, 0.2, mat=clay('rim', v['rim'], rough=0.4, coat=0.4, emit=v['rim'], emit_strength=0.3), loc=(0, 0, -0.06))
        rounded_box('tile', 0.9, 0.9, 0.22, 0.16, mat=v['body'](), loc=(0, 0, 0.02))
        if v.get('star'):
            star_mesh('star', 0.13, 0.06, 0.05, (0.3, 0.3, 0.14), clay('gold', '#F6C453', rough=0.22, emit='#F6C453', emit_strength=0.4))
        area('key', (-3, -4, 8), 260, 4, '#FFF4E8')
        area('fill', (4, -2, 5), 90, 4, '#C9D6FF')
        area('rim', (1, 4, 4), 140, 3, '#E6DDFF')
        sc.render.filepath = os.path.join(OUT, f'tile-{name}.png')
        bpy.ops.render.render(write_still=True)
        print('wrote', sc.render.filepath)


if ONLY in (None, 'backdrop'): backdrop()
if ONLY in (None, 'board'): tray()
if ONLY in (None, 'tiles'): tiles()
