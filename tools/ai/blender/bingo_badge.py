"""BINGO! badge for the big screen's winner panel (stage 15, D-36): chunky glossy gold "BINGO!" with a deep violet drop
layer, the white sticker outline and gold sparks, on a transparent background - the same family as the AriSkill sign
(D-41, tools/ai/blender/ariskill_sign.py). No key, Blender 5.2 Eevee, a few seconds.

    blender -b -P tools/ai/blender/bingo_badge.py

Font: Fredoka Bold (SIL OFL 1.1, assets-src/fonts/Fredoka-Bold.ttf). Writes assets-src/generated/badges/bingo-badge.png
(git-ignored); the winner panel shows it cropped to its alpha bounds as apps/public-galaxy/art/bingo-badge.webp (1137 x 292):

    python3 -c "from PIL import Image; im = Image.open('assets-src/generated/badges/bingo-badge.png'); \
        im.crop(im.getbbox()).save('apps/public-galaxy/art/bingo-badge.webp', quality=90, method=6)"
"""
import bpy, math, os, sys
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FONT = os.path.join(ROOT, 'assets-src/fonts/Fredoka-Bold.ttf')
OUT = os.path.join(ROOT, 'assets-src/generated/badges')
os.makedirs(OUT, exist_ok=True)


def lin(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def mat(name, col, rough=0.28, coat=1.0, emit=None, strength=0.0, grad=None, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(col), 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat; b.inputs['Coat Roughness'].default_value = 0.08
    if emit: b.inputs['Emission Color'].default_value = (*lin(emit), 1); b.inputs['Emission Strength'].default_value = strength
    if grad:  # vertical gradient top -> bottom in object space
        tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs[0])
        mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = grad[2]; mr.inputs['From Max'].default_value = grad[3]
        nt.links.new(sep.outputs['Y'], mr.inputs['Value'])
        ramp = nt.nodes.new('ShaderNodeValToRGB'); nt.links.new(mr.outputs[0], ramp.inputs[0])
        ramp.color_ramp.elements[0].color = (*lin(grad[1]), 1); ramp.color_ramp.elements[1].color = (*lin(grad[0]), 1)
        nt.links.new(ramp.outputs[0], b.inputs['Base Color'])
    return m


def text(body, size, extrude, bevel, offset=0.0, material=None, loc=(0, 0, 0)):
    cu = bpy.data.curves.new(body, 'FONT'); cu.body = body; cu.font = bpy.data.fonts.load(FONT)
    cu.size = size; cu.extrude = extrude; cu.bevel_depth = bevel; cu.bevel_resolution = 4; cu.offset = offset
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.space_character = 1.04
    ob = bpy.data.objects.new(body, cu); bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc); ob.rotation_euler = (math.radians(90), 0, 0)   # stand up, face -Y (the camera)
    if material: cu.materials.append(material)
    return ob


def spark(loc, r, length, material, tilt=0.0):
    """A gold four-point sparkle: a thin concave star (points `length` / 2 long, waist `r`), solidified and bevelled."""
    return star(loc, length / 2, material, rot=tilt, depth=0.07, points=4, inner=r)


def star(loc, outer, material, rot=0.0, depth=0.08, points=5, inner=None):
    verts = []
    inner = outer * 0.45 if inner is None else inner
    for i in range(points * 2):
        r = outer if i % 2 == 0 else inner
        a = math.pi / 2 + i * math.pi / points + math.radians(rot)
        verts.append((math.cos(a) * r, 0, math.sin(a) * r))
    me = bpy.data.meshes.new('star'); me.from_pydata(verts, [], [list(range(points * 2))]); me.update()
    ob = bpy.data.objects.new('star', me); bpy.context.scene.collection.objects.link(ob); ob.location = Vector(loc)
    sol = ob.modifiers.new('s', 'SOLIDIFY'); sol.thickness = depth; sol.offset = 0
    bev = ob.modifiers.new('b', 'BEVEL'); bev.width = depth * 0.35; bev.segments = 3
    ob.data.materials.append(material)
    return ob


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'; sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x, sc.render.resolution_y = 1200, 520
sc.render.film_transparent = True; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
try: sc.eevee.taa_render_samples = 64
except Exception: pass
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (*lin('#2A1A6E'), 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8

goldtxt = mat('letters', '#F6C453', rough=0.24, metal=0.35, grad=('#FFF0A8', '#F29A1C', -0.55, 0.75), emit='#F6A623', strength=0.18)
white = mat('outline', '#FFFFFF', rough=0.45, coat=0.2, emit='#FFFFFF', strength=0.35)
deep = mat('shadow', '#2D2670', rough=0.5, coat=0.2)
gold = mat('gold', '#F6B93B', rough=0.25, emit='#F6A623', strength=0.6)
lilac = mat('lilac', '#B9A8FF', rough=0.3, emit='#8B7CF0', strength=0.25)

text('BINGO!', 1.7, 0.18, 0.04, material=goldtxt, loc=(0, -0.05, 0.02))
text('BINGO!', 1.7, 0.11, 0.02, offset=0.06, material=deep, loc=(0.05, 0.12, -0.05))      # deep drop layer
text('BINGO!', 1.7, 0.06, 0.02, offset=0.11, material=white, loc=(0, 0.26, 0.02))         # sticker die-cut
spark((-2.95, -0.1, 0.62), 0.08, 0.5, gold)
spark((3.05, -0.1, 0.72), 0.07, 0.42, gold)
spark((2.7, -0.1, -0.62), 0.05, 0.28, gold)
star((-2.7, -0.08, -0.55), 0.17, lilac, rot=12)
star((-3.2, -0.08, 0.05), 0.1, gold, rot=-8)

for name, loc, energy, size, col in (('key', (-3, -5, 4), 1400, 5, '#FFF4E8'), ('fill', (4, -4, -1), 500, 5, '#C9D6FF'), ('rim', (0, 4, 3), 1600, 4, '#FFD27A')):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy, ld.size, ld.color = energy, size, lin(col)
    lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo); lo.location = Vector(loc)
    lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
cd = bpy.data.cameras.new('cam'); cd.lens = 70
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); cam.location = (0.4, -13.5, 1.1)
cam.rotation_euler = (Vector((0, 0, 0.05)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam
sc.render.filepath = os.path.join(OUT, 'bingo-badge.png')
bpy.ops.render.render(write_still=True)
print('wrote', sc.render.filepath)
