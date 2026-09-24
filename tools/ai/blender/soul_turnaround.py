#!/usr/bin/env python3
"""tools/ai/blender/soul_turnaround.py - clay Arise Soul turnarounds and a 6-body x 3-palette contact sheet (bpy, Eevee).

The pure section (no bpy) is a line-for-line port of apps/employee-mobile/src/scene/soul-params.js (BODY_PROFILES,
lean/bump, Catmull-Rom lathe profile, FNV hashSeed) and packages/game-rules/src/soul.js (cyrb53 hashString ->
soulConfigFromSeed), so a given seed renders the same body/palette here as on the phone. tools/ai/test/blender-port.test.js
compares `--print-profiles` output with the JS modules (1e-6).

Run inside Blender (the Node wrapper tools/ai/blender-render.js does this):
  Blender --background --factory-startup --python tools/ai/blender/soul_turnaround.py -- --mode turnaround --seed abc --out <dir>
Run outside Blender (no bpy needed):
  python3 tools/ai/blender/soul_turnaround.py --print-profiles --seed abc

Outputs are reference renders (not shipped at runtime). Python stdlib only.
"""
import argparse
import json
import math
import os
import sys
import time
from decimal import Decimal, ROUND_HALF_UP

try:
    import bpy  # type: ignore
    import bmesh  # type: ignore
    from mathutils import Vector  # type: ignore
except ImportError:  # outside Blender: the pure section still works
    bpy = None

# ---------------------------------------------------------------- pure port of soul-params.js / soul.js / soul-renderer.js
UNIT = 0.0135
HEM_Y = 170
HEAD_CENTER_Y = 84

BODY_PROFILES = {
    "drop":   [[0, 52], [0.20, 60], [0.28, 70], [0.31, 84], [0.32, 100], [0.36, 120], [0.42, 146], [0.40, 160], [0.28, 168], [0, 170]],
    "bell":   [[0, 54], [0.20, 62], [0.30, 88], [0.30, 120], [0.34, 134], [0.42, 150], [0.54, 166], [0.50, 170], [0, 171]],
    "cloud":  [[0, 52], [0.22, 60], [0.32, 84], [0.36, 98], [0.50, 112], [0.46, 130], [0.52, 150], [0.40, 168], [0, 172]],
    "pebble": [[0, 56], [0.24, 64], [0.36, 80], [0.38, 94], [0.50, 120], [0.48, 152], [0.34, 168], [0, 172]],
    "flame":  [[0, 34], [0.04, 44], [0.08, 52], [0.18, 62], [0.28, 74], [0.30, 92], [0.40, 100], [0.44, 118], [0.50, 136], [0.48, 152], [0.30, 168], [0, 170]],
    "bean":   [[0, 54], [0.20, 62], [0.32, 88], [0.34, 100], [0.42, 118], [0.54, 138], [0.50, 158], [0.36, 168], [0, 170]],
}
BODY_LEAN = {"drop": 0, "bell": 0, "cloud": 0, "pebble": 0, "flame": 0.06, "bean": 0.16}
BODY_BUMP = {"drop": 0, "bell": 0, "cloud": 0.045, "pebble": 0.02, "flame": 0.03, "bean": 0.015}

TRAITS = {
    "body": ["drop", "bell", "cloud", "pebble", "flame", "bean"],
    "palette": ["aurora", "lagoon", "sunset", "orchid", "mint", "coral", "sky", "lilac"],
    "eyes": ["dot", "star", "sleepy", "wide", "wink", "sparkle"],
    "antenna": ["orb", "ring", "leaf", "spark", "none", "twin"],
    "mouth": ["smile", "open", "tiny", "none"],
    "glow": ["soft", "ring", "halo"],
}
PALETTES = {  # packages/ui/soul-renderer.js PALETTES
    "aurora": {"fill": "#74D6C8", "highlight": "#E3FFF8", "outline": "#2A5AA6", "glow": "#72E8CF"},
    "lagoon": {"fill": "#7CC8FF", "highlight": "#E9F6FF", "outline": "#2E4DB8", "glow": "#82D9FF"},
    "sunset": {"fill": "#FFB58C", "highlight": "#FFEBDD", "outline": "#A8436E", "glow": "#FFB07C"},
    "orchid": {"fill": "#E3A3F2", "highlight": "#FAE8FF", "outline": "#6E3AB8", "glow": "#E69EFF"},
    "mint":   {"fill": "#95DE95", "highlight": "#EEFFEC", "outline": "#2C7F66", "glow": "#98F0A4"},
    "coral":  {"fill": "#FFA0A8", "highlight": "#FFE6E8", "outline": "#A3376A", "glow": "#FF9EB4"},
    "sky":    {"fill": "#A3B8FF", "highlight": "#EEF1FF", "outline": "#3A44A8", "glow": "#A9BEFF"},
    "lilac":  {"fill": "#CDB9FF", "highlight": "#F4EEFF", "outline": "#5D3FA6", "glow": "#D0BCFF"},
}
# docs/art/sticker-art-direction.md palette additions (design-tokens 1.2.0 pending; names final).
STICKER = {"navy": "#0B1030", "space": "#151C48", "mint": "#7CF5C8", "cyan": "#63E6FF", "lilac": "#8B7CF0",
           "violet_deep": "#3B2A7A", "peach": "#FFB27A", "gold": "#F6C453", "rose": "#FF6FA5", "outline": "#FFFFFF"}

MASK = 0xFFFFFFFF


def imul(a, b):
    """JS Math.imul as an unsigned 32-bit value."""
    return ((a & MASK) * (b & MASK)) & MASK


def hash_string(s, seed=0):
    """cyrb53 (packages/game-rules/src/random.js hashString) - 53-bit integer."""
    h1 = (0xDEADBEEF ^ seed) & MASK
    h2 = (0x41C6CE57 ^ seed) & MASK
    for ch in s:
        c = ord(ch)
        h1 = imul(h1 ^ c, 2654435761)
        h2 = imul(h2 ^ c, 1597334677)
    h1 = imul(h1 ^ (h1 >> 16), 2246822507)
    h1 ^= imul(h2 ^ (h2 >> 13), 3266489909)
    h1 &= MASK
    h2 = imul(h2 ^ (h2 >> 16), 2246822507)
    h2 ^= imul(h1 ^ (h1 >> 13), 3266489909)
    h2 &= MASK
    return 4294967296 * (2097151 & h2) + h1


def hash_seed(s):
    """FNV-1a (apps/employee-mobile/src/scene/soul-params.js hashSeed) - unsigned 32-bit."""
    h = 0x811C9DC5
    for ch in str(s):
        h ^= ord(ch)
        h = imul(h, 0x01000193)
    return h & MASK


def soul_config_from_seed(seed):
    """Trait indices exactly as soulConfigFromSeed (constellation omitted: it never affects the body)."""
    def pick(name):
        return hash_string(f"{seed}:{name}") % len(TRAITS[name])
    return {
        "seed": seed,
        "body": pick("body"), "palette": pick("palette"), "eyes": pick("eyes"),
        "antenna": pick("antenna"), "mouth": pick("mouth"), "glow": pick("glow"),
        "driftPhase": (hash_string(f"{seed}:drift") % 1000) / 1000,
    }


def to_fixed(x, digits=5):
    """JS Number(x.toFixed(digits)): round half away from zero on the exact binary value."""
    q = Decimal(1).scaleb(-digits)
    return float(Decimal(x).quantize(q, rounding=ROUND_HALF_UP))


def lathe_profile(body, subdivisions=6):
    """Catmull-Rom densified profile [{r, y}] from the hem (y=0) up, as latheProfile() in soul-params.js."""
    raw = BODY_PROFILES.get(body) or BODY_PROFILES["drop"]
    pts = [{"r": r * 100 * UNIT, "y": (HEM_Y - sy) * UNIT} for r, sy in raw]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
        for s in range(subdivisions):
            t = s / subdivisions
            t2, t3 = t * t, t * t * t
            r = 0.5 * ((2 * p1["r"]) + (-p0["r"] + p2["r"]) * t + (2 * p0["r"] - 5 * p1["r"] + 4 * p2["r"] - p3["r"]) * t2 + (-p0["r"] + 3 * p1["r"] - 3 * p2["r"] + p3["r"]) * t3)
            y = 0.5 * ((2 * p1["y"]) + (-p0["y"] + p2["y"]) * t + (2 * p0["y"] - 5 * p1["y"] + 4 * p2["y"] - p3["y"]) * t2 + (-p0["y"] + 3 * p1["y"] - 3 * p2["y"] + p3["y"]) * t3)
            out.append({"r": max(0.0, to_fixed(r)), "y": to_fixed(y)})
    last = pts[-1]
    out.append({"r": 0.0, "y": to_fixed(last["y"])})
    out.reverse()
    out[0] = {"r": 0.0, "y": out[0]["y"]}
    out[-1] = {"r": 0.0, "y": out[-1]["y"]}
    return out


def radius_at(profile, y):
    for i in range(len(profile) - 1):
        a, b = profile[i], profile[i + 1]
        lo, hi = min(a["y"], b["y"]), max(a["y"], b["y"])
        if lo <= y <= hi:
            if hi == lo:
                return max(a["r"], b["r"])
            t = (y - a["y"]) / (b["y"] - a["y"])
            return a["r"] + (b["r"] - a["r"]) * t
    return 0.0


def mulberry32(seed):
    """Port of packages/game-rules/src/random.js seededRng().float for a numeric seed."""
    a = seed & MASK

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & MASK
        t = imul(a ^ (a >> 15), (1 | a))
        t = ((t + imul(t ^ (t >> 7), (61 | t))) ^ t) & MASK
        return ((t ^ (t >> 14)) & MASK) / 4294967296
    return nxt


def speckle_layout(seed, profile, lean=0.0):
    """9-14 bubble speckles in two sizes (art direction v2 spec 3), seeded from the Soul seed. Positions in scene units."""
    rnd = mulberry32(hash_seed(f"{seed}:speckle"))
    top = max(p["y"] for p in profile)
    count = 9 + int(rnd() * 6)
    colours = ["mint", "cyan", "lilac"]
    out = []
    for _ in range(count):
        y = (0.12 + rnd() * 0.72) * top
        theta = rnd() * math.pi * 2
        big = rnd() < 0.35
        colour = colours[int(rnd() * 3)]
        r = radius_at(profile, y)
        out.append({"x": round(r * math.cos(theta) + lean * y, 5), "y": round(r * math.sin(theta), 5), "z": round(y, 5),
                    "size": round((0.055 if big else 0.032) * (0.9 + 0.2 * rnd()), 5), "colour": colour})
    return out


def soul_params(seed, body=None, palette=None):
    cfg = soul_config_from_seed(seed)
    body_name = body or TRAITS["body"][cfg["body"]]
    pal_name = palette or TRAITS["palette"][cfg["palette"]]
    profile = lathe_profile(body_name)
    head_y = (HEM_Y - HEAD_CENTER_Y) * UNIT
    return {
        "seed": seed, "config": cfg, "body": body_name, "palette": pal_name, "colors": PALETTES[pal_name],
        "eyes": TRAITS["eyes"][cfg["eyes"]], "mouth": TRAITS["mouth"][cfg["mouth"]], "antenna": TRAITS["antenna"][cfg["antenna"]],
        "profile": profile, "lean": BODY_LEAN[body_name], "bump": BODY_BUMP[body_name],
        "headY": head_y, "headR": radius_at(profile, head_y), "topY": max(p["y"] for p in profile),
        "bobPhase": round((hash_seed(seed) % 1000) / 1000 * math.pi * 2, 4),
        "speckles": speckle_layout(seed, profile, BODY_LEAN[body_name]),
    }


def print_profiles(seed):
    data = {
        "unit": UNIT, "hemY": HEM_Y, "headCenterY": HEAD_CENTER_Y,
        "profiles": {b: lathe_profile(b) for b in TRAITS["body"]},
        "lean": BODY_LEAN, "bump": BODY_BUMP,
        "hashString": {b: hash_string(f"{seed}:{b}") for b in ["body", "palette", "eyes", "antenna", "mouth", "glow", "drift"]},
        "hashSeed": hash_seed(seed),
        "config": soul_config_from_seed(seed),
        "params": soul_params(seed),
    }
    json.dump(data, sys.stdout)
    sys.stdout.write("\n")


# ---------------------------------------------------------------- bpy section
def hex_rgba(h, alpha=1.0):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    # sRGB -> linear for Blender node inputs
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), alpha)


def set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def clay_material(name, base_hex, sheen_hex=STICKER["peach"], emission_hex=None, emission_strength=0.0, roughness=0.35):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, ["Base Color"], hex_rgba(base_hex))
    set_input(bsdf, ["Roughness"], roughness)
    set_input(bsdf, ["Coat Weight", "Clearcoat"], 1.0)
    set_input(bsdf, ["Coat Roughness", "Clearcoat Roughness"], 0.15)
    set_input(bsdf, ["Sheen Weight", "Sheen"], 0.6)
    set_input(bsdf, ["Sheen Tint"], hex_rgba(sheen_hex))
    if emission_hex:
        set_input(bsdf, ["Emission Color", "Emission"], hex_rgba(emission_hex))
        set_input(bsdf, ["Emission Strength"], emission_strength)
    return mat


def outline_material():
    """Sticker die-cut material for the hull: front faces are transparent, back faces emit white. Seen from the camera,
    only the far side of the hull shows around the silhouette - the classic inverted-hull outline without depending on
    per-material culling flags (which proved unreliable for modifier-generated shells)."""
    mat = bpy.data.materials.new("sticker-outline")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    mix = nodes.new("ShaderNodeMixShader")
    geo = nodes.new("ShaderNodeNewGeometry")
    clear = nodes.new("ShaderNodeBsdfTransparent")
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = hex_rgba(STICKER["outline"])
    emit.inputs["Strength"].default_value = 1.0
    links.new(geo.outputs["Backfacing"], mix.inputs["Fac"])
    links.new(clear.outputs["BSDF"], mix.inputs[1])
    links.new(emit.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])
    mat.use_backface_culling = False
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "DITHERED"
    return mat


def lathe_mesh(name, profile, lean=0.0, bump=0.0, seed_phase=0.0, segments=48):
    bm = bmesh.new()
    rings = []
    for p in profile:
        r, y = p["r"], p["y"]
        if r < 1e-6:
            rings.append([bm.verts.new((lean * y, 0.0, y))])
            continue
        ring = []
        for k in range(segments):
            th = 2 * math.pi * k / segments
            rr = r * (1.0 + bump * math.sin(5 * th + seed_phase) * math.sin(y * 9.0 + seed_phase))
            ring.append(bm.verts.new((rr * math.cos(th) + lean * y, rr * math.sin(th), y)))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for k in range(segments):
                bm.faces.new((a[0], b[k], b[(k + 1) % segments]))
        elif len(b) == 1:
            for k in range(segments):
                bm.faces.new((a[k], b[0], a[(k + 1) % segments]))
        else:
            for k in range(segments):
                bm.faces.new((a[k], a[(k + 1) % segments], b[(k + 1) % segments], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def sphere(name, radius, location, material, scale=(1, 1, 1), parent=None, segments=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=segments // 2, radius=radius)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    obj.scale = scale
    obj.data.materials.append(material)
    obj.parent = parent
    bpy.context.collection.objects.link(obj)
    return obj


def cylinder(name, radius, z0, z1, location_xy, material, parent=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=radius, radius2=radius * 0.8, depth=z1 - z0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    obj.location = (location_xy[0], location_xy[1], (z0 + z1) / 2)
    obj.data.materials.append(material)
    obj.parent = parent
    bpy.context.collection.objects.link(obj)
    return obj


def add_outline(obj, mat, thickness=0.045):
    """Inverted hull as a separate, shadow-less object: the mesh pushed outward along vertex normals (bmesh, no
    modifier), carrying the outline material whose front faces are transparent (see outline_material). A hull that
    casts shadows would put the body in its own shadow (dark, grainy renders), so `visible_shadow` is off."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    for v in bm.verts:
        v.co = v.co + v.normal * thickness
    me = bpy.data.meshes.new(obj.name + "-hull")
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    me.materials.append(mat)
    hull = bpy.data.objects.new(obj.name + "-hull", me)
    hull.parent = obj.parent
    hull.location, hull.rotation_euler, hull.scale = obj.location, obj.rotation_euler, obj.scale
    hull.visible_shadow = False
    bpy.context.collection.objects.link(hull)
    return hull


def build_soul(params, root_location, mats, outline=True):
    p = params
    root = bpy.data.objects.new(f"soul-{p['seed']}-{p['body']}-{p['palette']}", None)
    root.location = root_location
    bpy.context.collection.objects.link(root)
    pal = p["colors"]
    body_mat = clay_material(f"body-{p['palette']}", pal["fill"])
    body_mat.use_backface_culling = True
    body = lathe_mesh(f"body-{p['body']}", p["profile"], p["lean"], p["bump"], p["bobPhase"])
    body.data.materials.append(body_mat)
    body.parent = root
    if outline:
        add_outline(body, mats["outline"])
    head_y, head_r = p["headY"], p["headR"]
    lean_x = p["lean"] * head_y
    # feet nubs
    foot_mat = clay_material(f"foot-{p['palette']}", pal["outline"])
    for sx in (-1, 1):
        f = sphere("foot", 0.085, (sx * 0.17, -0.06, 0.05), foot_mat, parent=root)
        if outline:
            add_outline(f, mats["outline"], 0.03)
    # face: dot eyes + mouth (creature face, never a human likeness)
    ex = 0.10 if p["eyes"] != "wide" else 0.125
    ez = head_y + (0.0 if p["eyes"] != "sleepy" else -0.03)
    for sx in (-1, 1):
        depth = -math.sqrt(max(0.0, head_r * head_r - ex * ex)) * 0.985
        eye_scale = (1, 0.55, 0.35) if p["eyes"] == "sleepy" or (p["eyes"] == "wink" and sx > 0) else (1, 0.55, 1)
        sphere("eye", 0.045, (sx * ex + lean_x, depth, ez), mats["ink"], scale=eye_scale, parent=root)
        if p["eyes"] in ("sparkle", "star"):
            sphere("eye-spark", 0.014, (sx * ex + lean_x + 0.015, depth - 0.045, ez + 0.02), mats["white"], parent=root)
    if p["mouth"] != "none":
        w = {"smile": 0.07, "open": 0.045, "tiny": 0.035}[p["mouth"]]
        h = {"smile": 0.02, "open": 0.04, "tiny": 0.02}[p["mouth"]]
        sphere("mouth", 1.0, (lean_x, -head_r * 0.985, head_y - 0.16), mats["ink"], scale=(w, 0.02, h), parent=root)
    # antenna: the orb is always lit (art direction v2); 'twin' gets two tips
    top = p["topY"]
    stalk_mat = clay_material(f"stalk-{p['palette']}", pal["outline"])
    orb_mat = clay_material(f"orb-{p['palette']}", pal["highlight"], emission_hex=pal["glow"], emission_strength=6.0, roughness=0.2)
    tips = [(0.0, 0.16, 0.075)] if p["antenna"] != "twin" else [(-0.09, 0.14, 0.055), (0.09, 0.14, 0.055)]
    top_x = p["lean"] * top
    for tx, stalk, size in tips:
        st = cylinder("stalk", 0.018, top - 0.02, top + stalk, (top_x + tx, 0.0), stalk_mat, parent=root)
        if outline:
            add_outline(st, mats["outline"], 0.025)
        orb = sphere("orb", size, (top_x + tx, 0.0, top + stalk + size * 0.8), orb_mat, parent=root)
        if outline:
            add_outline(orb, mats["outline"], 0.03)
    # speckles from the seed
    for i, s in enumerate(p["speckles"]):
        sphere(f"speckle{i}", s["size"], (s["x"], s["y"], s["z"]), mats[s["colour"]], parent=root)
    return root


def setup_scene(size_px, samples, aspect=(1, 1)):
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    if hasattr(scene, "eevee"):
        if hasattr(scene.eevee, "taa_render_samples"):
            scene.eevee.taa_render_samples = samples
    scene.render.resolution_x = int(size_px * aspect[0])
    scene.render.resolution_y = int(size_px * aspect[1])
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 60
    try:
        scene.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    world = bpy.data.worlds.new("sky") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = hex_rgba(STICKER["space"])
        bg.inputs["Strength"].default_value = 0.35
    return scene


def light(name, kind, location, energy, colour, size=2.0, target=(0, 0, 0.8)):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = hex_rgba(colour)[:3]
    if kind == "AREA":
        data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(obj)
    return obj


def three_point(center=(0, 0, 0.8), scale=1.0):
    cx, cy, cz = center
    light("key", "AREA", (cx + 2.6 * scale, cy - 3.2 * scale, cz + 3.0 * scale), 380 * scale * scale, "#FFF4E6", 2.2 * scale, center)
    light("fill", "AREA", (cx - 3.6 * scale, cy - 2.4 * scale, cz + 1.0 * scale), 110 * scale * scale, "#DCE8FF", 3.0 * scale, center)
    light("rim", "AREA", (cx - 1.2 * scale, cy + 3.4 * scale, cz + 2.2 * scale), 320 * scale * scale, STICKER["peach"], 1.6 * scale, center)


def camera(location, target, ortho_scale=None, lens=55):
    data = bpy.data.cameras.new("cam")
    if ortho_scale:
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
    else:
        data.lens = lens
    obj = bpy.data.objects.new("cam", data)
    obj.location = location
    obj.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(obj)
    bpy.context.scene.camera = obj
    return obj


def render_to(path):
    bpy.context.scene.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    return round(time.time() - t0, 2)


def shared_materials():
    return {
        "outline": outline_material(),
        "ink": clay_material("ink", STICKER["navy"], roughness=0.5),
        "white": clay_material("white", "#FFFFFF", emission_hex="#FFFFFF", emission_strength=1.5),
        "mint": clay_material("speckle-mint", STICKER["mint"], emission_hex=STICKER["mint"], emission_strength=0.6),
        "cyan": clay_material("speckle-cyan", STICKER["cyan"], emission_hex=STICKER["cyan"], emission_strength=0.6),
        "lilac": clay_material("speckle-lilac", STICKER["lilac"], emission_hex=STICKER["lilac"], emission_strength=0.6),
    }


VIEWS = {"front": 0.0, "threequarter": math.radians(-40), "side": math.radians(-90)}


def run_blender(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(args.out, exist_ok=True)
    mats = shared_materials()
    log = {"mode": args.mode, "seed": args.seed, "size": args.size, "samples": args.samples, "blender": bpy.app.version_string, "renders": []}
    if args.mode in ("single", "turnaround", "smoke"):
        params = soul_params(args.seed, args.body, args.palette)
        setup_scene(args.size, args.samples)
        root = build_soul(params, (0, 0, 0), mats, outline=not args.no_outline)
        three_point()
        camera((0, -5.2, 1.15), (0, 0, 0.82))
        views = ["front", "threequarter", "side"] if args.mode == "turnaround" else [args.view]
        for v in views:
            root.rotation_euler = (0, 0, VIEWS[v])
            path = os.path.join(args.out, f"soul-{args.seed}-{params['body']}-{params['palette']}-{v}.png")
            secs = render_to(path)
            log["renders"].append({"file": os.path.basename(path), "view": v, "seconds": secs, "body": params["body"], "palette": params["palette"]})
            print(f"rendered {path} in {secs}s")
    elif args.mode == "sheet":
        palettes = [p.strip() for p in args.palettes.split(",") if p.strip()]
        for p in palettes:
            if p not in PALETTES:
                raise SystemExit(f"unknown palette {p}")
        bodies = TRAITS["body"]
        dx, dz = 2.3, 2.5
        setup_scene(args.size, args.samples, aspect=(4, 3))
        for row, pal in enumerate(palettes):
            for col, body in enumerate(bodies):
                params = soul_params(f"{args.seed}:{body}:{pal}", body, pal)
                build_soul(params, (col * dx - (len(bodies) - 1) * dx / 2, 0, (len(palettes) - 1 - row) * dz), mats, outline=not args.no_outline)
        width, height = len(bodies) * dx, len(palettes) * dz
        cz = (len(palettes) - 1) * dz / 2 + 0.8
        three_point((0, 0, cz), scale=3.2)
        camera((0, -30, cz), (0, 0, cz), ortho_scale=max(width + 0.6, (height + 0.8) * 4 / 3))
        path = os.path.join(args.out, f"contact-sheet-{args.seed}.png")
        secs = render_to(path)
        log["renders"].append({"file": os.path.basename(path), "view": "sheet", "seconds": secs, "bodies": bodies, "palettes": palettes})
        print(f"rendered {path} in {secs}s")
    with open(os.path.join(args.out, "render-log.json"), "w") as f:
        json.dump(log, f, indent=2)
    print("RENDER_LOG " + json.dumps(log))


def parse(argv):
    ap = argparse.ArgumentParser(description="Clay Arise Soul renders (bpy) / profile port printer (plain python3).")
    ap.add_argument("--print-profiles", action="store_true", help="print the profile table + seed mapping as JSON (no bpy needed)")
    ap.add_argument("--mode", default="turnaround", choices=["single", "turnaround", "sheet", "smoke"])
    ap.add_argument("--seed", default="demo-soul")
    ap.add_argument("--body", default=None, choices=TRAITS["body"])
    ap.add_argument("--palette", default=None, choices=TRAITS["palette"])
    ap.add_argument("--palettes", default="aurora,sunset,orchid", help="sheet rows (comma separated palette names)")
    ap.add_argument("--view", default="threequarter", choices=list(VIEWS))
    ap.add_argument("--no-outline", action="store_true", help="skip the white die-cut hull (debug / plain clay look)")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--samples", type=int, default=32, help="Eevee TAA render samples (16 is enough for a preview)")
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "assets-src", "generated", "blender"))
    return ap.parse_args(argv)


if __name__ == "__main__":
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    a = parse(raw)
    if a.print_profiles:
        print_profiles(a.seed)
    elif bpy is None:
        sys.exit("bpy is not importable: run this script through Blender (tools/ai/blender-render.js) or use --print-profiles")
    else:
        run_blender(a)
