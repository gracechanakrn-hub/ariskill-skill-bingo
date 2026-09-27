"""AriSkill sign (D-41): chunky glossy 3D "AriSkill" with a white sticker outline, a lime BINGO pill and a gold spark,
rendered with a transparent background for the landing and Join screens. No key, Blender 5.2 Eevee, a few seconds.

    blender -b -P tools/ai/blender/ariskill_sign.py -- [--out apps/employee-mobile/art]

Font: Fredoka Bold (SIL OFL 1.1, assets-src/fonts/Fredoka-Bold.ttf), the same family as the sticker badge lettering.
"""
import bpy, math, os, sys
from mathutils import Vector

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, ARGV[ARGV.index('--out') + 1] if '--out' in ARGV else 'apps/employee-mobile/art')
FONT = os.path.join(ROOT, 'assets-src/fonts/Fredoka-Bold.ttf')
os.makedirs(OUT, exist_ok=True)


def lin(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def mat(name, col, rough=0.28, coat=1.0, emit=None, strength=0.0, grad=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(col), 1); b.inputs['Roughness'].default_value = rough
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
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    ob = bpy.data.objects.new(body, cu); bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc); ob.rotation_euler = (math.radians(90), 0, 0)   # stand up, face -Y (the camera)
    if material: cu.materials.append(material)
    return ob


def pill(w, h, depth, material, loc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object; ob.scale = (w, depth, h)
    bev = ob.modifiers.new('b', 'BEVEL'); bev.width = h * 0.5; bev.segments = 10; bev.limit_method = 'NONE'
    bpy.ops.object.modifier_apply(modifier='b'); bpy.ops.object.shade_smooth()
    ob.data.materials.append(material)
    return ob


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'; sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x, sc.render.resolution_y = 1200, 640
sc.render.film_transparent = True; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
try: sc.eevee.taa_render_samples = 64
except Exception: pass
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (*lin('#2A1A6E'), 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8

letters = mat('letters', '#B9A8FF', grad=('#D9D0FF', '#6A4FE0', -0.5, 0.7), emit='#8B7CF0', strength=0.12)
white = mat('outline', '#FFFFFF', rough=0.45, coat=0.2, emit='#FFFFFF', strength=0.35)
deep = mat('shadow', '#2D2670', rough=0.5, coat=0.2)
lime = mat('lime', '#B6FF5C', rough=0.3, emit='#B6FF5C', strength=0.25)
navy = mat('navy', '#0B1030', rough=0.4, coat=0.3)
gold = mat('gold', '#F6B93B', rough=0.25, emit='#F6A623', strength=0.6)

text('AriSkill', 1.5, 0.16, 0.035, material=letters, loc=(0, -0.05, 0.42))
text('AriSkill', 1.5, 0.10, 0.02, offset=0.06, material=deep, loc=(0.04, 0.12, 0.36))      # deep drop layer
text('AriSkill', 1.5, 0.06, 0.02, offset=0.10, material=white, loc=(0, 0.26, 0.42))        # sticker die-cut
pill(1.9, 0.52, 0.22, white, (0, 0.18, -0.68))
pill(1.78, 0.42, 0.24, lime, (0, 0.10, -0.68))
b = text('BINGO', 0.42, 0.04, 0.01, material=navy, loc=(0, -0.06, -0.70))
b.data.space_character = 1.25
# gold four-point spark by the top-right of the word
for rot in (0, 90):
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.07, depth=0.42, location=(2.0, -0.1, 1.0), rotation=(0, math.radians(rot), 0))
    s = bpy.context.active_object; s.data.materials.append(gold)
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.07, depth=0.42, location=(2.0, -0.1, 1.0), rotation=(0, math.radians(rot + 180), 0))
    bpy.context.active_object.data.materials.append(gold)

for name, loc, energy, size, col in (('key', (-3, -5, 4), 1400, 5, '#FFF4E8'), ('fill', (4, -4, -1), 500, 5, '#C9D6FF'), ('rim', (0, 4, 3), 1600, 4, '#7CF5C8')):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy, ld.size, ld.color = energy, size, lin(col)
    lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo); lo.location = Vector(loc)
    lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
cd = bpy.data.cameras.new('cam'); cd.lens = 70
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); cam.location = (0.6, -11.5, 1.6)
cam.rotation_euler = (Vector((0, 0, 0.05)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam
sc.render.filepath = os.path.join(ROOT, 'assets-src/generated/landing3d/ariskill-sign.png')
bpy.ops.render.render(write_still=True)
print('wrote', sc.render.filepath)
