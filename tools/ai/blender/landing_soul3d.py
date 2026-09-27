"""3D landing mascot (D-41): the owner's Arise Soul sticker rebuilt in 3D and animated flying in to say hi.

    blender -b -P tools/ai/blender/landing_soul3d.py -- [--preview] [--out apps/employee-mobile/art]

Model: a hooded galaxy suit built from merged metaballs (hood with a carved face opening, body, arms, legs, antenna
stalk), converted to one smooth mesh with vertex colours (deep violet suit, star specks, lilac / mint / cyan goo
blobs), navy shoes, a glowing antenna orb, and the sticker's own face (assets-src/landing/face.png) inside the hood.
The right arm is a separate part pivoting at the shoulder so it can wave.

Animation (24 fps, one timeline exported as one glTF clip; the web player plays 0-104 once, then loops 104-152):
  0-44  fly in from far behind / above right, banking along an arc, stretched by speed
  44-58 touch down in front of the camera: squash, rebound
  58-100 wave hello (three swings), a small happy hop
  104-152 idle loop: gentle bob and breathing, arm resting

Outputs: soul-hi.glb (the web landing), soul-hi.webp (still of the waving pose for Join and fallbacks),
and with --preview a contact sheet in reports/qa/screens/landing-soul3d-preview.png.
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, noise

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, arg('--out', 'apps/employee-mobile/art'))
FACE = os.path.join(ROOT, 'assets-src/landing/face.png')
PREVIEW = '--preview' in ARGV
FPS, END = 24, 152
os.makedirs(OUT, exist_ok=True)


def hex_rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
def lin(c):
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)
def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.view_settings.view_transform = 'AgX'
    sc.render.fps = FPS; sc.frame_start = 0; sc.frame_end = END
    try: sc.eevee.taa_render_samples = 32
    except Exception: pass
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (*lin(hex_rgb('#1A1250')), 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    return sc


def link(ob):
    bpy.context.scene.collection.objects.link(ob); return ob


# ---- suit: metaballs -> mesh ----------------------------------------------------------------------------------
HOOD_C = Vector((0, 0, 1.36))
DRIPS = [  # (position on/near the surface, radius, colour)
    ((-0.42, -0.36, 1.66), 0.09, '#B9A8FF'), ((0.40, -0.40, 1.70), 0.10, '#B9A8FF'), ((0.55, -0.12, 1.30), 0.08, '#B9A8FF'),
    ((-0.58, -0.10, 1.18), 0.08, '#63E6FF'), ((0.10, -0.52, 1.93), 0.07, '#B9A8FF'), ((-0.25, -0.45, 0.85), 0.08, '#B9A8FF'),
    ((0.32, -0.46, 0.62), 0.09, '#B9A8FF'), ((-0.44, -0.30, 0.48), 0.07, '#63E6FF'), ((0.05, -0.50, 0.40), 0.06, '#B9A8FF'),
    ((0.55, -0.20, 0.85), 0.07, '#B9A8FF'), ((-0.12, -0.30, 2.00), 0.06, '#63E6FF'), ((0.28, 0.40, 1.50), 0.09, '#B9A8FF'),
    ((-0.35, 0.42, 1.10), 0.08, '#7CF5C8'), ((0.0, 0.50, 0.70), 0.08, '#B9A8FF'),
]


def build_suit():
    """Sticker proportions: a big round hood, a pear-shaped body, stubby limbs; goo blobs sit half-sunk in the surface."""
    mb = bpy.data.metaballs.new('suit'); mb.resolution = 0.028; mb.render_resolution = 0.028; mb.threshold = 0.12
    ob = link(bpy.data.objects.new('suit', mb))
    def el(co, r, kind='BALL', size=(1, 1, 1), neg=False, stiff=2.0, rot=None):
        e = mb.elements.new(); e.type = kind; e.co = Vector(co); e.radius = r; e.stiffness = stiff; e.use_negative = neg
        if kind in ('ELLIPSOID', 'CAPSULE'): e.size_x, e.size_y, e.size_z = size
        if rot is not None: e.rotation = rot
        return e
    el(HOOD_C, 0.76, 'ELLIPSOID', (1.0, 0.94, 0.98))                     # hood / head
    el((0, 0, 0.72), 0.70, 'ELLIPSOID', (1.02, 0.84, 0.86))              # pear body
    el((0, 0, 1.02), 0.50)                                               # neck blend
    el((0, -0.74, 1.33), 0.56, 'ELLIPSOID', (0.74, 0.55, 0.88), neg=True, stiff=3.0)   # face opening (negative)
    for i, z in enumerate((2.02, 2.12, 2.20)):                           # antenna stalk tapering
        el((0, 0.02, z), 0.11 - 0.025 * i, stiff=2.6)
    from mathutils import Quaternion
    def cap(a_, b_, r):                                                  # capsule element between two points
        a_, b_ = Vector(a_), Vector(b_); d = b_ - a_
        q = Vector((1, 0, 0)).rotation_difference(d.normalized())
        el((a_ + b_) / 2, r, 'CAPSULE', (d.length / 2, 1, 1), rot=q, stiff=2.4)
    for sx in (-1, 1):
        cap((0.24 * sx, 0, 0.42), (0.25 * sx, -0.02, 0.14), 0.19)        # legs
    cap((-0.58, 0.02, 1.02), (-0.86, 0.04, 0.78), 0.17)                  # left upper arm (akimbo)
    cap((-0.86, 0.04, 0.78), (-0.66, -0.06, 0.56), 0.16)                 # left forearm to the hip
    rnd = random.Random(7)
    for (co, r, _) in DRIPS:                                             # goo: pushed out to the surface, half-sunk
        c = Vector(co); centre = HOOD_C if c.z > 1.05 else Vector((0, 0, 0.72))
        rad = 0.78 if c.z > 1.05 else 0.66
        d = (c - centre); d.y *= 1.0; d.normalize()
        el(centre + d * rad * 0.9, r * 1.1, 'ELLIPSOID', (1.0, 1.0, 0.8), stiff=1.4)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    dec = ob.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.3
    bpy.ops.object.modifier_apply(modifier='dec')
    bpy.ops.object.shade_smooth()
    colour_suit(ob)
    return ob


def colour_suit(ob, rnd=random.Random(41)):
    me = ob.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    deep, mid, rim = lin(hex_rgb('#1E1250')), lin(hex_rgb('#3A2380')), lin(hex_rgb('#3F7FA8'))
    def pushed(c):
        c = Vector(c); centre = HOOD_C if c.z > 1.05 else Vector((0, 0, 0.72)); rad = 0.78 if c.z > 1.05 else 0.66
        return centre + (c - centre).normalized() * rad * 0.9
    drips = [(pushed(c), r * 1.15, lin(hex_rgb(col))) for c, r, col in DRIPS]
    for v in me.vertices:
        p = v.co
        n = noise.noise(p * 3.1) * 0.5 + 0.5
        c = mix(deep, mid, max(0.0, min(1.0, 0.35 + 0.55 * n)))
        c = mix(c, rim, max(0.0, min(0.3, (noise.noise(p * 1.4 + Vector((5, 5, 5))) - 0.35) * 0.9)))   # faint teal nebula glints
        if noise.noise(p * 38.0) > 0.66:                                                               # star specks
            c = mix(c, (1.0, 1.0, 1.0), 0.85)
        for dc, r, col in drips:
            d = (p - dc).length
            if d < r * 1.9:
                c = mix(c, col, max(0.0, min(1.0, 1.25 - d / (r * 1.9))))
        attr.data[v.index].color = (*c, 1.0)
    mat = bpy.data.materials.new('suit'); mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    vc = mat.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    mat.node_tree.links.new(vc.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.38
    b.inputs['Coat Weight'].default_value = 0.6; b.inputs['Coat Roughness'].default_value = 0.15
    me.materials.append(mat)


def capsule(name, a, b_, r, mat):
    """Capsule from point a to b_ (built along -Z from the origin at a)."""
    L = (Vector(b_) - Vector(a)).length
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=r)
    for v in bm.verts:
        if v.co.z < 0: v.co.z -= L
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = link(bpy.data.objects.new(name, me)); ob.data.materials.append(mat)
    return ob, L


def solid(name, col, rough=0.4, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(hex_rgb(col)), 1); b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(hex_rgb(emit)), 1); b.inputs['Emission Strength'].default_value = strength
    return m


def sphere(name, r, co, mat, scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=r)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = link(bpy.data.objects.new(name, me)); ob.location = Vector(co); ob.scale = scale; ob.data.materials.append(mat)
    return ob


def face_card():
    img = bpy.data.images.load(FACE)
    m = bpy.data.materials.new('face'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 0.55      # the painted face keeps its own light
    nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.8
    try: m.surface_render_method = 'BLENDED'
    except Exception: pass
    w = 0.98; h = w * img.size[1] / img.size[0]
    me = bpy.data.meshes.new('face'); bm = bmesh.new(); bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_grid(bm, x_segments=8, y_segments=8, size=0.5, calc_uvs=True)
    for v in bm.verts:
        x, y = v.co.x * w, v.co.y * h
        v.co = Vector((x, -0.02 * (x * x + y * y) * 4, y))   # a slight bulge so it sits like a face, not a poster
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = link(bpy.data.objects.new('face', me)); ob.location = (0, -0.52, 1.30); ob.data.materials.append(m)
    return ob


def build():
    sc = reset()
    root = link(bpy.data.objects.new('ariseSoulHi', None))
    suit = build_suit(); suit.parent = root
    face = face_card(); face.parent = root
    shoe = solid('shoe', '#1E1A4A', 0.45)
    for sx in (-1, 1):
        sphere(f'shoe{sx}', 0.19, (0.26 * sx, -0.08, 0.06), shoe, scale=(1.0, 1.35, 0.62)).parent = root
    orb = sphere('orb', 0.17, (0, 0.02, 2.40), solid('orb', '#FFE7A3', 0.3, emit='#FFD27A', strength=6.0)); orb.parent = root
    # waving right arm: pivot at the shoulder, hanging along -Z at rest
    arm_mat = bpy.data.materials['suit']
    pivot = link(bpy.data.objects.new('armR', None)); pivot.location = (0.60, 0.0, 1.02); pivot.parent = root
    arm, L = capsule('armRmesh', (0, 0, 0), (0, 0, -0.40), 0.17, arm_mat); arm.parent = pivot
    hand = sphere('handR', 0.19, (0, 0, -0.5), arm_mat); hand.parent = pivot
    # vertex colour for the arm parts (same palette as the suit)
    for o in (arm, hand):
        a = o.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for v in o.data.vertices:
            a.data[v.index].color = (*mix(lin(hex_rgb('#1E1250')), lin(hex_rgb('#3A2380')), 0.5 + 0.4 * noise.noise(v.co * 4)), 1)
    animate(sc, root, pivot)
    return sc, root, pivot


def key(ob, f, loc=None, rot=None, scale=None):
    if loc is not None: ob.location = Vector(loc); ob.keyframe_insert('location', frame=f)
    if rot is not None: ob.rotation_euler = tuple(math.radians(v) for v in rot); ob.keyframe_insert('rotation_euler', frame=f)
    if scale is not None: ob.scale = Vector(scale); ob.keyframe_insert('scale', frame=f)


def animate(sc, root, arm):
    # rotation about +Y turns the hanging arm (-Z) toward -X, so the right arm (on +X) uses negative angles to go outward
    REST = (0, -28, 0)      # arm hangs out a little from the body
    UP = (0, -145, 0)       # raised up and out to wave
    # fly in: far behind / high right -> arc -> land at the origin facing the camera
    path = [(0, (3.2, 14.0, 5.5), (0, -30, -40), (0.92, 0.92, 1.12)),
            (14, (2.6, 8.0, 4.2), (-10, -35, -25), (0.92, 0.92, 1.14)),
            (28, (-1.4, 3.2, 2.6), (-18, 25, 20), (0.94, 0.94, 1.10)),
            (40, (-0.4, 0.6, 0.9), (-8, 10, 8), (0.97, 0.97, 1.05)),
            (46, (0.0, 0.0, 0.0), (0, 0, 0), (1.0, 1.0, 1.0)),
            (49, (0.0, 0.0, 0.0), (0, 0, 0), (1.16, 1.16, 0.82)),      # squash on touchdown
            (54, (0.0, 0.0, 0.10), (0, 0, 0), (0.95, 0.95, 1.07)),     # rebound
            (58, (0.0, 0.0, 0.0), (0, 0, 0), (1.0, 1.0, 1.0))]
    for f, loc, rot, sc_ in path:
        key(root, f, loc, rot, sc_)
    key(arm, 0, rot=(0, -110, 0)); key(arm, 44, rot=(0, -60, 0)); key(arm, 58, rot=REST)
    # wave hello: raise, three swings, a small hop on the second
    key(arm, 64, rot=UP)
    for i, f in enumerate((70, 76, 82, 88, 94)):
        key(arm, f, rot=(0, UP[1] + (24 if i % 2 == 0 else -20), 0))
    key(root, 76, (0, 0, 0.0)); key(root, 80, (0, 0, 0.16), (0, 0, 4)); key(root, 84, (0, 0, 0.0), (0, 0, 0))
    key(arm, 100, rot=UP); key(arm, 104, rot=REST)
    # idle loop 104-152: bob + breathe (first and last keys equal -> seamless)
    for f in range(104, END + 1, 6):
        t = (f - 104) / (END - 104)
        s = math.sin(math.tau * t)
        key(root, f, (0, 0, 0.05 * (s + 1) / 2), (0, 0, 1.5 * math.sin(math.tau * t + 0.8)), (1 - 0.012 * s, 1 - 0.012 * s, 1 + 0.015 * s))
        key(arm, f, rot=(0, REST[1] + 3 * math.sin(math.tau * t), 0))
    for ob in (root, arm):
        if ob.animation_data and ob.animation_data.action:
            for fc in getattr(ob.animation_data.action, 'fcurves', []):
                for kp in fc.keyframe_points: kp.interpolation = 'BEZIER'


def lights_and_camera(sc):
    def area(name, loc, energy, size, col):
        ld = bpy.data.lights.new(name, 'AREA'); ld.energy, ld.size, ld.color = energy, size, lin(hex_rgb(col))
        lo = link(bpy.data.objects.new(name, ld)); lo.location = Vector(loc)
        lo.rotation_euler = (Vector((0, 0, 1.0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    area('key', (-2.5, -4, 4), 900, 3, '#FFF1E0'); area('fill', (3, -3, 1.5), 300, 3, '#B9C8FF'); area('rim', (1.5, 3.5, 3), 900, 2, '#7CF5C8')
    cd = bpy.data.cameras.new('cam'); cd.lens = 50
    cam = link(bpy.data.objects.new('cam', cd)); cam.location = (0, -7.2, 1.25)
    cam.rotation_euler = (Vector((0, 0, 1.15)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam


def export(sc):
    for o in bpy.context.scene.objects: o.select_set(o.type in ('MESH', 'EMPTY'))
    path = os.path.join(OUT, 'soul-hi.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='SCENE', export_frame_range=True, export_force_sampling=True,
                              export_apply=True, export_yup=True, export_image_format='AUTO')
    print('wrote', path, os.path.getsize(path), 'bytes')


def still(sc, frame, path, size=(480, 600)):
    sc.frame_set(frame)
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


sc, root, arm = build()
lights_and_camera(sc)
export(sc)
tmp = os.path.join(ROOT, 'assets-src/generated/landing3d'); os.makedirs(tmp, exist_ok=True)
still(sc, 82, os.path.join(tmp, 'soul-hi.png'))
if PREVIEW:
    for f in (0, 14, 28, 40, 49, 70, 82, 128):
        still(sc, f, os.path.join(tmp, f'preview-{f:03d}.png'), (360, 450))
