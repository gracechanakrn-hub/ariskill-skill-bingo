"""Cinematic space backdrop for the big screen (stage 15, D-36): the Galaxy region's sky, rendered once in Blender and
moved a little at runtime (apps/public-galaxy/src/renderer: drift, twinkle, spin, falling stars).

    blender -b -P tools/ai/blender/galaxy_space.py -- [--only backdrop|meteors]

  backdrop   opaque  deep-space gradient, violet / blue / magenta nebula, a diagonal milky-way band with dust lanes and
                     a dense faint starfield, a distant galaxy, and a dark planet limb silhouetted in the lower right
  meteors    alpha   five meteorite rocks, one sprite each (dark, rim-lit in violet and teal) so each can spin and drift

Same palette and look as the phone's cinematic sky (D-41, tools/ai/blender/mobile_sky.py): EEVEE, AgX. PNGs go to
assets-src/generated/galaxy-space/; tools/assets/build-galaxy-space.py packs them (JPEG / WebP) with the constellation
lines, the falling-star streak and space.json into assets/space/.
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, noise

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'assets-src/generated/galaxy-space')
REGION, OVERSCAN = (1248, 1080), 1.1
W, H = round(REGION[0] * OVERSCAN), round(REGION[1] * OVERSCAN)       # 1373 x 1188
ONLY = arg('--only')
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


def card(name, w, h, loc, mat):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5, calc_uvs=True)
    for v in bm.verts: v.co = Vector((v.co.x * w, 0, v.co.y * h))
    bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me)); ob.location = Vector(loc); ob.data.materials.append(mat)
    return ob


def setup(w, h, transparent):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'; sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.resolution_x, sc.render.resolution_y = w, h
    try: sc.eevee.taa_render_samples = 64
    except Exception: pass
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    bg = world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (*lin('#05041A'), 1); bg.inputs['Strength'].default_value = 0.0
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    return sc


def ortho_camera(sc, width_units, loc=(0, -20, 0)):
    cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = width_units; cd.sensor_fit = 'HORIZONTAL'
    cam = link(bpy.data.objects.new('cam', cd)); cam.location = Vector(loc)
    cam.rotation_euler = (math.radians(90), 0, 0)     # looks along +Y at the XZ plane
    sc.camera = cam
    return cam


# ---- backdrop ------------------------------------------------------------------------------------------------
def build_backdrop():
    sc = setup(W, H, False)
    CW, CH = W / 100, H / 100                           # 1 unit = 100 px
    ortho_camera(sc, CW)
    m, nt, L = nodes_mat('sky')
    N = nt.nodes
    tc = N.new('ShaderNodeTexCoord')
    sep = N.new('ShaderNodeSeparateXYZ'); L(tc.outputs['UV'], sep.inputs[0])            # X right, Y up, 0..1
    UP = 'Y'

    def math_node(op, a=None, b=None, va=None, vb=None):
        n = N.new('ShaderNodeMath'); n.operation = op
        if a is not None: L(a, n.inputs[0])
        elif va is not None: n.inputs[0].default_value = va
        if b is not None: L(b, n.inputs[1])
        elif vb is not None: n.inputs[1].default_value = vb
        return n.outputs[0]

    def ramp(src, stops):
        r = N.new('ShaderNodeValToRGB'); L(src, r.inputs[0])
        cr = r.color_ramp
        cr.elements[0].position, cr.elements[0].color = stops[0][0], (*lin(stops[0][1]), 1) if isinstance(stops[0][1], str) else stops[0][1]
        cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*lin(stops[-1][1]), 1) if isinstance(stops[-1][1], str) else stops[-1][1]
        for pos, col in stops[1:-1]:
            e = cr.elements.new(pos); e.color = (*lin(col), 1) if isinstance(col, str) else col
        return r.outputs[0]

    def add(a, b, fac=1.0):
        mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'ADD'; mx.inputs[0].default_value = fac
        L(a, mx.inputs[6]); L(b, mx.inputs[7]); return mx.outputs[2]

    def mul(a, b):
        mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1.0
        L(a, mx.inputs[6]); L(b, mx.inputs[7]); return mx.outputs[2]

    def noise_tex(scale, detail, rough, w, distortion=0.0, dims='4D'):
        nz = N.new('ShaderNodeTexNoise'); nz.noise_dimensions = dims
        nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = detail; nz.inputs['Roughness'].default_value = rough
        nz.inputs['Distortion'].default_value = distortion
        if dims == '4D': nz.inputs['W'].default_value = w
        L(tc.outputs['UV'], nz.inputs['Vector'])
        return nz.outputs['Fac']

    # radial base: a deep indigo glow left of centre, fading to near-black at the edges (the Souls sit on the calm middle)
    dx = math_node('SUBTRACT', sep.outputs['X'], vb=0.44); dz = math_node('SUBTRACT', sep.outputs[UP], vb=0.5)
    dist = math_node('SQRT', math_node('ADD', math_node('MULTIPLY', dx, dx), math_node('MULTIPLY', dz, dz)))
    base = ramp(dist, [(0.0, '#170E46'), (0.35, '#0B0826'), (0.62, '#050416'), (0.9, '#02010B')])

    # nebula clouds: violet (broad), blue (upper left), magenta (lower right); domain-warped noise, soft thresholds
    violet = ramp(noise_tex(1.5, 9, 0.62, 1.3, distortion=0.5), [(0.5, (0, 0, 0, 1)), (0.68, '#4E2398'), (0.86, '#B06CF5')])
    blue = ramp(noise_tex(2.3, 8, 0.6, 7.7, distortion=0.4), [(0.58, (0, 0, 0, 1)), (0.76, '#1E2F86'), (0.9, '#5B7CFF')])
    magenta = ramp(noise_tex(2.0, 8, 0.6, 3.1, distortion=0.6), [(0.54, (0, 0, 0, 1)), (0.72, '#7A2270'), (0.88, '#F063AE')])
    teal = ramp(noise_tex(3.4, 6, 0.55, 11.3, distortion=0.4), [(0.66, (0, 0, 0, 1)), (0.86, '#1E8E8A')])
    # masks: blue toward the upper left, magenta toward the lower right, all quieter in the middle
    upper_left = math_node('SUBTRACT', sep.outputs[UP], sep.outputs['X'])             # +1 top-left .. -1 bottom-right
    ul = ramp(upper_left, [(-0.2, (0, 0, 0, 1)), (0.6, (1, 1, 1, 1))])
    lr = ramp(upper_left, [(-0.6, (1, 1, 1, 1)), (0.1, (0, 0, 0, 1))])
    calm = ramp(dist, [(0.0, (0.45, 0.45, 0.45, 1)), (0.42, (1, 1, 1, 1))])
    neb = add(mul(violet, calm), mul(mul(blue, ul), calm), 0.6)
    neb = add(neb, mul(mul(magenta, lr), calm), 1.0)
    neb = add(neb, mul(teal, calm), 0.35)
    col = add(base, neb, 0.85)

    # milky-way band: a soft diagonal band (lower left -> upper right) with fine glow, crossed by dark dust lanes
    band_d = math_node('ABSOLUTE', math_node('SUBTRACT', sep.outputs[UP], math_node('ADD', math_node('MULTIPLY', sep.outputs['X'], vb=0.62), vb=0.2)))
    band = ramp(band_d, [(0.0, (1, 1, 1, 1)), (0.16, (0, 0, 0, 1))])
    band_glow = mul(band, ramp(noise_tex(6.0, 10, 0.7, 5.2, distortion=0.3), [(0.3, (0, 0, 0, 1)), (0.72, '#5A4AC8'), (0.9, '#C8B8FF')]))
    dust = ramp(noise_tex(9.0, 12, 0.7, 9.9, distortion=1.4), [(0.45, (1, 1, 1, 1)), (0.6, (0.25, 0.25, 0.3, 1))])
    col = add(col, mul(band_glow, calm), 1.0)                          # quieter where the Souls orbit
    px = math_node('SUBTRACT', sep.outputs['X'], vb=0.93); py = math_node('SUBTRACT', sep.outputs[UP], vb=0.12)
    pd = math_node('SQRT', math_node('ADD', math_node('MULTIPLY', px, px), math_node('MULTIPLY', py, py)))
    col = add(col, ramp(pd, [(0.0, '#8C3C9E'), (0.3, '#3A1C66'), (0.62, (0, 0, 0, 1))]), 0.9)
    col = mul(col, add(mul(band, dust), ramp(band_d, [(0.0, (0, 0, 0, 1)), (0.16, (1, 1, 1, 1))]), 1.0))

    # stars: faint dense field (denser in the band) and a sprinkle of brighter ones; the runtime adds the twinkling stars
    def stars(scale, radius, keep, bright, w):
        # Voronoi cells scaled on UV (x stretched to the card's aspect so the dots are round); a dot in `keep` of them
        mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (CW / CH, 1, 1); L(tc.outputs['UV'], mp.inputs[0])
        v = N.new('ShaderNodeTexVoronoi'); v.voronoi_dimensions = '4D'; v.feature = 'F1'
        v.inputs['Scale'].default_value = scale; v.inputs['Randomness'].default_value = 1.0; v.inputs['W'].default_value = w
        L(mp.outputs[0], v.inputs['Vector'])
        dot = ramp(v.outputs['Distance'], [(0.0, (bright, bright, bright * 1.06, 1)), (radius, (0, 0, 0, 1))])
        cs = N.new('ShaderNodeSeparateColor'); L(v.outputs['Color'], cs.inputs[0])
        lit = math_node('GREATER_THAN', cs.outputs[0], vb=1 - keep)
        gate = N.new('ShaderNodeCombineColor'); L(lit, gate.inputs[0]); L(lit, gate.inputs[1]); L(lit, gate.inputs[2])
        return mul(dot, gate.outputs[0])
    col = add(col, stars(110, 0.09, 0.35, 0.9, 0.3), 1.0)                  # a fine field (~1 px)
    col = add(col, mul(stars(160, 0.08, 0.55, 1.1, 2.2), band), 1.0)       # denser along the milky way
    col = add(col, stars(34, 0.06, 0.25, 4.0, 4.4), 1.0)                   # a few bright ones (~2 px)

    em = N.new('ShaderNodeEmission'); L(col, em.inputs[0])
    out = N.new('ShaderNodeOutputMaterial'); L(em.outputs[0], out.inputs[0])
    card('sky', CW * 1.02, CH * 1.02, (0, 10, 0), m)

    # a distant galaxy, upper right: an inclined disc with a bright core and bluish arms
    gm, gnt, GL = nodes_mat('galaxy', blended=True)
    gtc = gnt.nodes.new('ShaderNodeTexCoord'); gsep = gnt.nodes.new('ShaderNodeSeparateXYZ'); GL(gtc.outputs['UV'], gsep.inputs[0])
    def gmath(op, a=None, b=None, va=None, vb=None):
        n = gnt.nodes.new('ShaderNodeMath'); n.operation = op
        if a is not None: GL(a, n.inputs[0])
        elif va is not None: n.inputs[0].default_value = va
        if b is not None: GL(b, n.inputs[1])
        elif vb is not None: n.inputs[1].default_value = vb
        return n.outputs[0]
    gx = gmath('SUBTRACT', gsep.outputs['X'], vb=0.5); gy = gmath('SUBTRACT', gsep.outputs['Y'], vb=0.5)
    gr = gmath('SQRT', gmath('ADD', gmath('MULTIPLY', gx, gx), gmath('MULTIPLY', gy, gy)))
    ga = gmath('ARCTAN2', gy, gx)
    arms = gmath('MULTIPLY', gmath('ADD', gmath('SINE', gmath('SUBTRACT', gmath('MULTIPLY', ga, vb=2.0), gmath('MULTIPLY', gr, vb=26.0))), vb=1.0), vb=0.5)
    fall = gnt.nodes.new('ShaderNodeValToRGB'); GL(gr, fall.inputs[0])
    fall.color_ramp.elements[0].position = 0.0; fall.color_ramp.elements[0].color = (1, 1, 1, 1)
    fall.color_ramp.elements[1].position = 0.5; fall.color_ramp.elements[1].color = (0, 0, 0, 1)
    e = fall.color_ramp.elements.new(0.08); e.color = (0.55, 0.55, 0.55, 1)
    dens = gmath('MULTIPLY', fall.outputs[0], gmath('ADD', gmath('MULTIPLY', arms, vb=0.7), vb=0.3))
    gcol = gnt.nodes.new('ShaderNodeValToRGB'); GL(gr, gcol.inputs[0])
    gcol.color_ramp.elements[0].position = 0.0; gcol.color_ramp.elements[0].color = (*lin('#FFF1D6'), 1)
    gcol.color_ramp.elements[1].position = 0.45; gcol.color_ramp.elements[1].color = (*lin('#6E8BFF'), 1)
    gem = gnt.nodes.new('ShaderNodeEmission'); gem.inputs['Strength'].default_value = 1.4; GL(gcol.outputs[0], gem.inputs[0])
    gtr = gnt.nodes.new('ShaderNodeBsdfTransparent'); gmx = gnt.nodes.new('ShaderNodeMixShader')
    GL(dens, gmx.inputs[0]); GL(gtr.outputs[0], gmx.inputs[1]); GL(gem.outputs[0], gmx.inputs[2])
    gout = gnt.nodes.new('ShaderNodeOutputMaterial'); GL(gmx.outputs[0], gout.inputs[0])
    gal = card('galaxy', 1.5, 1.5, (CW * 0.3, 9, CH * 0.3), gm)
    gal.rotation_euler = (0, math.radians(-28), 0); gal.scale = (1, 1, 0.42)

    # a dark planet limb in the lower right corner: near-black disc with a thin blue-violet atmosphere rim
    pm, pnt, PL = nodes_mat('planet')
    pb = pnt.nodes.new('ShaderNodeBsdfPrincipled'); pb.inputs['Base Color'].default_value = (*lin('#07061A'), 1); pb.inputs['Roughness'].default_value = 0.9
    po = pnt.nodes.new('ShaderNodeOutputMaterial'); PL(pb.outputs[0], po.inputs[0])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=CH * 0.62, location=(CW * 0.5 + CH * 0.18, 6, -CH * 0.5 - CH * 0.3), segments=128, ring_count=64)
    bpy.ops.object.shade_smooth(); bpy.context.active_object.data.materials.append(pm)
    am, ant, AL = nodes_mat('atmos', blended=True)
    lw = ant.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.22
    ac = ant.nodes.new('ShaderNodeValToRGB'); AL(lw.outputs['Facing'], ac.inputs[0])
    ac.color_ramp.elements[0].position = 0.35; ac.color_ramp.elements[0].color = (0, 0, 0, 1)
    ac.color_ramp.elements[1].position = 1.0; ac.color_ramp.elements[1].color = (1, 1, 1, 1)
    aem = ant.nodes.new('ShaderNodeEmission'); aem.inputs['Color'].default_value = (*lin('#7B8CFF'), 1); aem.inputs['Strength'].default_value = 3.2
    atr = ant.nodes.new('ShaderNodeBsdfTransparent'); amx = ant.nodes.new('ShaderNodeMixShader')
    AL(ac.outputs[0], amx.inputs[0]); AL(atr.outputs[0], amx.inputs[1]); AL(aem.outputs[0], amx.inputs[2])
    ao = ant.nodes.new('ShaderNodeOutputMaterial'); AL(amx.outputs[0], ao.inputs[0])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=CH * 0.63, location=(CW * 0.5 + CH * 0.18, 5.9, -CH * 0.5 - CH * 0.3), segments=128, ring_count=64)
    bpy.ops.object.shade_smooth(); bpy.context.active_object.data.materials.append(am)
    # a violet key from the upper left grazes the limb
    ld = bpy.data.lights.new('key', 'SUN'); ld.energy = 1.2; ld.color = lin('#9C8CFF')
    lo = link(bpy.data.objects.new('key', ld)); lo.rotation_euler = (math.radians(60), math.radians(-40), 0)
    sc.render.filepath = os.path.join(OUT, 'backdrop.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath)


# ---- meteors ---------------------------------------------------------------------------------------------------
def lumpy(r, seed, craters, amp=0.26):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6, radius=r, location=(0, 0, 0))
    ob = bpy.context.active_object
    rnd = random.Random(seed)
    pits = [(Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized(), rnd.uniform(0.18, 0.36)) for _ in range(craters)]
    off = Vector((seed * 1.7, seed * 0.9, seed * 2.3))
    for v in ob.data.vertices:
        d = v.co.normalized()
        h = amp * noise.noise(d * 1.6 + off) + 0.08 * noise.noise(d * 5.0 + off) + 0.03 * noise.noise(d * 14.0 + off)
        for c, s in pits:                                  # shallow craters with a raised rim
            a = (d - c).length / s
            if a < 1.25: h += (-0.07 * (1 - a * a) if a < 1 else 0.025 * (1.25 - a) * 4)
        v.co = d * r * (1 + h)
    bpy.ops.object.shade_smooth()
    return ob


def build_meteors():
    # (index, crater count, lumpiness, stretch): a big chunky one, an elongated shard, a round one, a knobbly one, a pebble
    specs = [(1, 12, 0.3, (1.25, 1.0, 0.85)), (2, 7, 0.36, (1.7, 1.0, 0.7)), (3, 6, 0.18, (1.05, 1.0, 0.95)), (4, 9, 0.42, (1.2, 1.0, 1.0)), (5, 5, 0.3, (1.35, 1.0, 0.8))]
    for i, craters, amp, stretch in specs:
        sc = setup(512, 512, True)
        m, nt, L = nodes_mat('rock')
        b = nt.nodes.new('ShaderNodeBsdfPrincipled'); b.inputs['Base Color'].default_value = (*lin('#1C1634'), 1)
        b.inputs['Roughness'].default_value = 0.88; b.inputs['Specular IOR Level'].default_value = 0.25
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 9; nz.inputs['Detail'].default_value = 10
        L(nz.outputs['Fac'], bump.inputs['Height']); L(bump.outputs[0], b.inputs['Normal'])
        o = nt.nodes.new('ShaderNodeOutputMaterial'); L(b.outputs[0], o.inputs[0])
        rock = lumpy(1.0, i * 3.7 + 1, craters, amp)
        rock.data.materials.append(m)
        rnd = random.Random(i * 13)
        rock.rotation_euler = (rnd.uniform(0, 6.28), rnd.uniform(0, 6.28), rnd.uniform(0, 6.28))
        rock.scale = stretch
        ortho_camera(sc, 3.0 * max(stretch) / 1.25, loc=(0, -10, 0))
        def area(name, loc, energy, size, col):
            ld = bpy.data.lights.new(name, 'AREA'); ld.energy, ld.size, ld.color = energy, size, lin(col)
            lo = link(bpy.data.objects.new(name, ld)); lo.location = Vector(loc)
            lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        area('rim-violet', (3.0, 3.4, 2.8), 5200, 2.5, '#9C7BFF')     # behind, upper right: a violet rim
        area('rim-teal', (-3.2, 3.0, -1.6), 2600, 2.0, '#4FE3C1')     # behind, lower left: a thin teal rim
        area('fill', (0.8, -4, 1.5), 70, 4.0, '#7A6ADC')              # a little fill so the craters read
        sc.render.filepath = os.path.join(OUT, f'meteor-{i}.png')
        bpy.ops.render.render(write_still=True)
        print('wrote', sc.render.filepath)


if not ONLY or ONLY == 'backdrop':
    build_backdrop()
if not ONLY or ONLY == 'meteors':
    build_meteors()
