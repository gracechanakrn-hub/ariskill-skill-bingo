"""Cinematic mobile sky (D-41): four portrait layers rendered from one camera so they line up, animated in CSS.

    blender -b -P tools/ai/blender/mobile_sky.py -- [--size 1080x2340] [--only sky|aurora|meteors|ground] [--prefix stage-]

  A landscape --size (e.g. 1920x1080, for the stage dashboard, D-47) switches to a longer lens with a gentler tilt and
  moves the ringed planet into the wider, shorter frame; the horizon still sits about 20% from the bottom.

  sky      opaque   deep-space gradient, violet nebula, stars, a small ringed planet
  aurora   alpha    three curtains of aurora (teal -> lime -> violet) across the upper-middle sky
  meteors  alpha    drifting meteorites, two with glowing trails
  ground   alpha    alien surface silhouette: rolling ridge, rock spires, crater rims, a few mint crystals, rim-lit

Outputs PNG to assets-src/generated/mobile-sky/; tools/assets/build-sky.py packs them for the app.
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, noise

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'assets-src/generated/mobile-sky')
W, H = (int(v) for v in arg('--size', '1080x2340').split('x'))
ONLY = arg('--only')
PREFIX = arg('--prefix', '')
LANDSCAPE = W > H
os.makedirs(OUT, exist_ok=True)


def lin(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def link(ob):
    bpy.context.scene.collection.objects.link(ob); return ob


def nodes_mat(name, blended=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    if blended:
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    nt = m.node_tree; nt.nodes.clear()
    return m, nt, nt.links.new


def card(name, w, h, loc, mat, segs=(1, 1)):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_grid(bm, x_segments=segs[0], y_segments=segs[1], size=0.5, calc_uvs=True)
    for v in bm.verts: v.co = Vector((v.co.x * w, 0, v.co.y * h))
    bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me)); ob.location = Vector(loc); ob.data.materials.append(mat)
    return ob


# ---- layer builders ------------------------------------------------------------------------------------------
def build_sky():
    m, nt, L = nodes_mat('sky')
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L(tc.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); L(sep.outputs['Z'], ramp.inputs[0])
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0; cr.elements[0].color = (*lin('#2B1466'), 1)
    cr.elements[1].position = 1.0; cr.elements[1].color = (*lin('#04030F'), 1)
    for pos, col in ((0.18, '#1B0F4A'), (0.5, '#0C0A2C')):
        e = cr.elements.new(pos); e.color = (*lin(col), 1)
    # nebula: two noise octaves tinted violet / magenta, masked to soft clouds
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 2.2; nz.inputs['Detail'].default_value = 8; nz.inputs['Roughness'].default_value = 0.62
    L(tc.outputs['Generated'], nz.inputs['Vector'])
    neb = nt.nodes.new('ShaderNodeValToRGB'); L(nz.outputs['Fac'], neb.inputs[0])
    neb.color_ramp.elements[0].position = 0.5; neb.color_ramp.elements[0].color = (0, 0, 0, 1)
    neb.color_ramp.elements[1].position = 0.78; neb.color_ramp.elements[1].color = (*lin('#6A2FB0'), 1)
    add = nt.nodes.new('ShaderNodeMix'); add.data_type = 'RGBA'; add.blend_type = 'ADD'; add.inputs[0].default_value = 0.55
    L(ramp.outputs[0], add.inputs[6]); L(neb.outputs[0], add.inputs[7])
    # stars: tiny voronoi points, two sizes
    def stars(scale, thresh, bright):
        v = nt.nodes.new('ShaderNodeTexVoronoi'); v.feature = 'F1'; v.inputs['Scale'].default_value = scale; v.inputs['Randomness'].default_value = 1.0
        L(tc.outputs['Generated'], v.inputs['Vector'])
        r = nt.nodes.new('ShaderNodeValToRGB'); L(v.outputs['Distance'], r.inputs[0])
        r.color_ramp.elements[0].position = 0.0; r.color_ramp.elements[0].color = (bright, bright, bright, 1)
        r.color_ramp.elements[1].position = thresh; r.color_ramp.elements[1].color = (0, 0, 0, 1)
        return r
    s1, s2 = stars(420, 0.035, 3.0), stars(120, 0.03, 6.0)
    a1 = nt.nodes.new('ShaderNodeMix'); a1.data_type = 'RGBA'; a1.blend_type = 'ADD'; a1.inputs[0].default_value = 1.0
    L(add.outputs[2], a1.inputs[6]); L(s1.outputs[0], a1.inputs[7])
    a2 = nt.nodes.new('ShaderNodeMix'); a2.data_type = 'RGBA'; a2.blend_type = 'ADD'; a2.inputs[0].default_value = 1.0
    L(a1.outputs[2], a2.inputs[6]); L(s2.outputs[0], a2.inputs[7])
    em = nt.nodes.new('ShaderNodeEmission'); L(a2.outputs[2], em.inputs[0])
    out = nt.nodes.new('ShaderNodeOutputMaterial'); L(em.outputs[0], out.inputs[0])
    card('sky', 240, 150, (0, 60, 18), m) if LANDSCAPE else card('sky', 90, 190, (0, 60, 18), m)
    # small ringed planet, upper left
    pm, pnt, PL = nodes_mat('planet')
    b = pnt.nodes.new('ShaderNodeBsdfPrincipled'); b.inputs['Base Color'].default_value = (*lin('#6B4FD8'), 1); b.inputs['Roughness'].default_value = 0.5
    o = pnt.nodes.new('ShaderNodeOutputMaterial'); PL(b.outputs[0], o.inputs[0])
    planet_at = (-27, 55, 25) if LANDSCAPE else (-9, 45, 40)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=2.2, location=planet_at, segments=64, ring_count=32); bpy.ops.object.shade_smooth()
    bpy.context.active_object.data.materials.append(pm)
    bpy.ops.mesh.primitive_torus_add(major_radius=3.6, minor_radius=0.12, location=planet_at, rotation=(math.radians(76), math.radians(-20), 0))
    rm, rnt, RL = nodes_mat('ring')
    rb = rnt.nodes.new('ShaderNodeEmission'); rb.inputs['Color'].default_value = (*lin('#C9B6FF'), 1); rb.inputs['Strength'].default_value = 0.8
    ro = rnt.nodes.new('ShaderNodeOutputMaterial'); RL(rb.outputs[0], ro.inputs[0])
    bpy.context.active_object.data.materials.append(rm)


def build_aurora():
    rnd = random.Random(11)
    curtains = ((-22, 20, 40, 60, 18, 0.10), (18, 25, 48, 70, 22, -0.08), (0, 16, 34, 50, 12, 0.05)) if LANDSCAPE else ((-10, 22, 40, 40, 18, 0.18), (8, 27, 48, 46, 22, -0.12), (-2, 17, 34, 30, 12, 0.08))
    for i, (x0, z0, depth, width, height, tilt) in enumerate(curtains):
        m, nt, L = nodes_mat(f'aurora{i}', blended=True)
        tc = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L(tc.outputs['UV'], sep.inputs[0])
        # vertical rays: noise stretched along height
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (22 + i * 6, 0.6, 1); L(tc.outputs['UV'], mp.inputs[0])
        rays = nt.nodes.new('ShaderNodeTexNoise'); rays.inputs['Scale'].default_value = 1.0; rays.inputs['Detail'].default_value = 3
        rays.noise_dimensions = '4D'; rays.inputs['W'].default_value = i * 3.7; L(mp.outputs[0], rays.inputs['Vector'])
        rr = nt.nodes.new('ShaderNodeValToRGB'); L(rays.outputs['Fac'], rr.inputs[0])
        rr.color_ramp.elements[0].position = 0.38; rr.color_ramp.elements[0].color = (0.05, 0.05, 0.05, 1)
        rr.color_ramp.elements[1].position = 0.72; rr.color_ramp.elements[1].color = (1, 1, 1, 1)
        # height profile: sharp lower edge, long soft fade upward
        hp = nt.nodes.new('ShaderNodeFloatCurve'); L(sep.outputs['Y'], hp.inputs['Value'])
        c = hp.mapping.curves[0]; c.points[0].location = (0, 0); c.points[1].location = (1, 0)
        c.points.new(0.08, 1.0); c.points.new(0.35, 0.55); c.points.new(0.8, 0.1); hp.mapping.update()
        # colour along height: teal -> lime -> violet
        cramp = nt.nodes.new('ShaderNodeValToRGB'); L(sep.outputs['Y'], cramp.inputs[0])
        cramp.color_ramp.elements[0].position = 0.0; cramp.color_ramp.elements[0].color = (*lin('#4FE3C1'), 1)
        cramp.color_ramp.elements[1].position = 0.85; cramp.color_ramp.elements[1].color = (*lin('#8B4FE8'), 1)
        e = cramp.color_ramp.elements.new(0.22); e.color = (*lin('#B6FF5C'), 1)
        # side fade so curtains end softly
        sx = nt.nodes.new('ShaderNodeFloatCurve'); L(sep.outputs['X'], sx.inputs['Value'])
        c2 = sx.mapping.curves[0]; c2.points[0].location = (0, 0); c2.points[1].location = (1, 0); c2.points.new(0.2, 1); c2.points.new(0.8, 1); sx.mapping.update()
        m1 = nt.nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; L(rr.outputs[0], m1.inputs[0]); L(hp.outputs[0], m1.inputs[1])
        m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'; L(m1.outputs[0], m2.inputs[0]); L(sx.outputs[0], m2.inputs[1])
        m3 = nt.nodes.new('ShaderNodeMath'); m3.operation = 'MULTIPLY'; m3.inputs[1].default_value = 0.85; L(m2.outputs[0], m3.inputs[0])
        em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 0.9; L(cramp.outputs[0], em.inputs[0])
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mx = nt.nodes.new('ShaderNodeMixShader'); L(m3.outputs[0], mx.inputs[0]); L(tr.outputs[0], mx.inputs[1]); L(em.outputs[0], mx.inputs[2])
        o = nt.nodes.new('ShaderNodeOutputMaterial'); L(mx.outputs[0], o.inputs[0])
        ob = card(f'aurora{i}', width, height, (x0, depth, z0), m, segs=(64, 1))
        for v in ob.data.vertices:                 # ribbon: a wavy fold in depth
            t = v.co.x / width
            v.co.y += 5.0 * math.sin(t * 7.0 + i) + 2.0 * math.sin(t * 17.0)
            v.co.z += tilt * v.co.x
        ob.rotation_euler = (0, 0, math.radians(rnd.uniform(-8, 8)))


def rock_material():
    m, nt, L = nodes_mat('rock')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); b.inputs['Base Color'].default_value = (*lin('#241A3E'), 1); b.inputs['Roughness'].default_value = 0.85
    o = nt.nodes.new('ShaderNodeOutputMaterial'); L(b.outputs[0], o.inputs[0])
    return m


def lumpy(name, r, loc, mat, seed, stretch=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=r, location=loc)
    ob = bpy.context.active_object; ob.name = name
    for v in ob.data.vertices:
        n = noise.noise(v.co * (2.2 / r) + Vector((seed, seed, seed)))
        v.co += v.co.normalized() * r * (0.28 * n + 0.1 * noise.noise(v.co * (7 / r)))
    ob.scale = stretch
    bpy.ops.object.shade_smooth(); ob.data.materials.append(mat)
    return ob


def build_meteors():
    rm = rock_material()
    tm, nt, L = nodes_mat('trail', blended=True)
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L(tc.outputs['UV'], sep.inputs[0])
    fade = nt.nodes.new('ShaderNodeMath'); fade.operation = 'POWER'; fade.inputs[1].default_value = 2.2; L(sep.outputs['X'], fade.inputs[0])
    side = nt.nodes.new('ShaderNodeFloatCurve'); L(sep.outputs['Y'], side.inputs['Value'])
    c = side.mapping.curves[0]; c.points[0].location = (0, 0); c.points[1].location = (1, 0); c.points.new(0.5, 1); side.mapping.update()
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; L(fade.outputs[0], mul.inputs[0]); L(side.outputs[0], mul.inputs[1])
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*lin('#FFC47A'), 1); em.inputs['Strength'].default_value = 4
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
    L(mul.outputs[0], mx.inputs[0]); L(tr.outputs[0], mx.inputs[1]); L(em.outputs[0], mx.inputs[2])
    o = nt.nodes.new('ShaderNodeOutputMaterial'); L(mx.outputs[0], o.inputs[0])
    specs = [((7.5, 24, 30), 1.1, True), ((-8.5, 30, 17), 1.6, False), ((4.5, 18, 9), 0.6, False), ((-3, 22, 36), 0.5, True), ((9, 34, 4), 0.9, False)]
    for i, (loc, r, trail) in enumerate(specs):
        lumpy(f'meteor{i}', r, loc, rm, i * 3.1, stretch=(1.1, 1, 0.9))
        if trail:
            t = card(f'trail{i}', r * 9, r * 1.6, (loc[0] + r * 4.6, loc[1] + 0.3, loc[2] + r * 2.4), tm)
            t.rotation_euler = (0, math.radians(-28), 0)


def build_ground():
    rm, nt, L = nodes_mat('ground')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); b.inputs['Base Color'].default_value = (*lin('#050414'), 1); b.inputs['Roughness'].default_value = 0.8
    b.inputs['Specular IOR Level'].default_value = 0.15   # matte: only the grazing edges catch the aurora rim
    o = nt.nodes.new('ShaderNodeOutputMaterial'); L(b.outputs[0], o.inputs[0])
    # rolling foreground ridge
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=240, y_subdivisions=120, size=1, location=(0, 12, -9.5))
    g = bpy.context.active_object; g.scale = (60, 40, 1); bpy.ops.object.transform_apply(scale=True)
    for v in g.data.vertices:
        x, y = v.co.x, v.co.y
        h = 2.2 * noise.noise(Vector((x * 0.08, y * 0.08, 0.3))) + 0.8 * noise.noise(Vector((x * 0.3, y * 0.3, 1.7)))
        crater = min(1.0, math.hypot(x + 4, y - 3) / 3.0)
        h += 0.9 * math.exp(-((crater - 1.0) ** 2) / 0.02) - 0.6 * (1 - crater)   # a crater rim
        v.co.z += h
    bpy.ops.object.shade_smooth(); g.data.materials.append(rm)
    # rock spires
    rnd = random.Random(5)
    for i, (x, y, hgt) in enumerate(((-8, 14, 9.0), (-5.6, 18, 6.0), (7.8, 16, 11.0), (10.5, 22, 7.0), (3.5, 26, 4.5), (-11, 24, 7.5))):
        bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=1.4 + rnd.random() * 0.8, radius2=0.15, depth=hgt, location=(x, y, -8 + hgt / 2 + 0.5))
        sp = bpy.context.active_object
        sub = sp.modifiers.new('s', 'SUBSURF'); sub.levels = 2
        bpy.ops.object.modifier_apply(modifier='s')
        for v in sp.data.vertices:
            v.co += v.co.normalized() * 0.35 * noise.noise(v.co * 0.9 + Vector((i, i, i)))
        sp.rotation_euler = (math.radians(rnd.uniform(-6, 6)), math.radians(rnd.uniform(-8, 8)), 0)
        bpy.ops.object.shade_smooth(); sp.data.materials.append(rm)
    # a few glowing crystals near the ridge
    cm, cnt, CL = nodes_mat('crystal')
    ce = cnt.nodes.new('ShaderNodeEmission'); ce.inputs['Color'].default_value = (*lin('#7CF5C8'), 1); ce.inputs['Strength'].default_value = 5
    co = cnt.nodes.new('ShaderNodeOutputMaterial'); CL(ce.outputs[0], co.inputs[0])
    for i, (x, y, z, s) in enumerate(((-6.2, 9, -6.2, 0.5), (-5.5, 9.5, -6.4, 0.35), (6.4, 10, -6.0, 0.45), (2.2, 8, -7.2, 0.3))):
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=s * 0.45, depth=s * 2.4, location=(x, y, z), rotation=(math.radians(rnd.uniform(-20, 20)), math.radians(rnd.uniform(-20, 20)), 0))
        bpy.context.active_object.data.materials.append(cm)


def lights_camera(sc):
    def area(name, loc, energy, size, col, target):
        ld = bpy.data.lights.new(name, 'AREA'); ld.energy, ld.size, ld.color = energy, size, lin(col)
        lo = link(bpy.data.objects.new(name, ld)); lo.location = Vector(loc)
        lo.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    area('rim-aurora', (0, 60, 2), 60000, 30, '#4FE3C1', (0, 10, -4))      # aurora light from behind: a thin teal rim on ridge and spires
    area('rim-violet', (-30, 40, -2), 25000, 20, '#8B4FE8', (0, 12, -4))
    area('key-soft', (10, -6, 12), 1200, 20, '#B9A8FF', (0, 20, 10))
    # wide lens tilted up 20 deg: the horizon sits ~20% from the bottom, the sky and aurora fill the rest
    cd = bpy.data.cameras.new('cam'); cd.lens = 30 if LANDSCAPE else 18; cd.sensor_fit = 'VERTICAL'
    cam = link(bpy.data.objects.new('cam', cd)); cam.location = (0, -14, -3.0)
    cam.rotation_euler = (math.radians(100 if LANDSCAPE else 110), 0, 0)
    sc.camera = cam


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'; sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.resolution_x, sc.render.resolution_y = W, H
    try: sc.eevee.taa_render_samples = 48
    except Exception: pass
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (*lin('#0B0A2A'), 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.15
    return sc


LAYERS = {'sky': (build_sky, False), 'aurora': (build_aurora, True), 'meteors': (build_meteors, True), 'ground': (build_ground, True)}
for name, (fn, alpha) in LAYERS.items():
    if ONLY and ONLY != name:
        continue
    sc = setup(); fn(); lights_camera(sc)
    sc.render.film_transparent = alpha
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA' if alpha else 'RGB'
    sc.render.filepath = os.path.join(OUT, f'{PREFIX}{name}.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath)
