// WebGL2 renderer (primary, fallback tier 1). Batched textured quads through ONE vertex array object
// (unit quad + interleaved per-instance buffer, drawArraysInstanced), point sprites for the three star layers,
// GL_LINES for the dashed orbit rings. Textures: nebula (rasterised once), atlas pages (re-uploaded only when
// atlas.version changes), a shared radial glow. Context loss is handled: the renderer disposes itself and
// calls onLost so galaxy.js can hand over to canvas2d.js.
import { hexToRgba } from './atlas.js';
import { resolveSoul, PALETTES } from '../../../../packages/ui/soul-renderer.js';

const SPRITE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_unit;
layout(location=1) in vec2 a_center;
layout(location=2) in vec2 a_size;
layout(location=3) in vec4 a_uv;
layout(location=4) in vec4 a_tint;
uniform vec2 u_resolution;
out vec2 v_uv; out vec4 v_tint;
void main(){
  vec2 px = a_center + (a_unit - 0.5) * a_size;
  vec2 clip = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, a_unit);
  v_tint = a_tint;
}`;
const SPRITE_FS = `#version 300 es
precision mediump float;
in vec2 v_uv; in vec4 v_tint; uniform sampler2D u_tex; out vec4 o;
void main(){ vec4 c = texture(u_tex, v_uv); o = c * v_tint; }`;

const STAR_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;   // normalised 0..1
layout(location=1) in float a_r;    // radius px @1080
layout(location=2) in float a_b;    // brightness
layout(location=3) in float a_t;    // twinkle phase 0..1
uniform vec2 u_resolution; uniform vec2 u_offset; uniform float u_time; uniform float u_amp; uniform float u_period;
uniform float u_scale; uniform float u_ripple; uniform float u_dpr;
out float v_a;
void main(){
  vec2 px = a_pos * u_resolution + u_offset;
  vec2 clip = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float tw = 1.0 + u_amp * sin(6.2831853 * (u_time / u_period + a_t));
  v_a = min(1.0, a_b * tw * u_ripple * 1.3);
  gl_PointSize = max(2.0, a_r * 3.2 * u_scale) * u_dpr;
}`;
const STAR_FS = `#version 300 es
precision mediump float; in float v_a; uniform vec3 u_color; out vec4 o;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = smoothstep(1.0, 0.25, r); a = a * a; o = vec4(u_color * a * v_a, a * v_a); }`;

const LINE_VS = `#version 300 es
precision highp float; layout(location=0) in vec2 a_pos; uniform vec2 u_resolution; uniform vec2 u_offset;
void main(){ vec2 clip = ((a_pos + u_offset) / u_resolution) * 2.0 - 1.0; gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0); }`;
const LINE_FS = `#version 300 es
precision mediump float; uniform vec4 u_color; out vec4 o; void main(){ o = u_color; }`;

const FLOATS_PER_INSTANCE = 12;

function compile(gl, type, src) {
  const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(sh); gl.deleteShader(sh); throw new Error('shader: ' + log); }
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram(); gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(p));
  return p;
}
function hexToRgb(hex) { const h = String(hex).replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }

export function createWebgl2Renderer({ container, atlas, nebula = null, starLayers = [], background = '#0B0F1F', dpr = 1, onLost = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'galaxy__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance', desynchronized: true });
  if (!gl) throw new Error('webgl2 unavailable');
  container.appendChild(canvas);
  let width = 1, height = 1, disposed = false, lost = false;
  const bg = hexToRgb(background);

  const spriteProg = program(gl, SPRITE_VS, SPRITE_FS);
  const starProg = program(gl, STAR_VS, STAR_FS);
  const lineProg = program(gl, LINE_VS, LINE_FS);
  const U = (p, n) => gl.getUniformLocation(p, n);
  const su = { res: U(spriteProg, 'u_resolution'), tex: U(spriteProg, 'u_tex') };
  const stu = { res: U(starProg, 'u_resolution'), off: U(starProg, 'u_offset'), time: U(starProg, 'u_time'), amp: U(starProg, 'u_amp'), period: U(starProg, 'u_period'), scale: U(starProg, 'u_scale'), ripple: U(starProg, 'u_ripple'), dpr: U(starProg, 'u_dpr'), color: U(starProg, 'u_color') };
  const lu = { res: U(lineProg, 'u_resolution'), off: U(lineProg, 'u_offset'), color: U(lineProg, 'u_color') };

  // ---- single VAO for all textured quads ----
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const unit = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, unit);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  let instCapacity = 1024;
  gl.bufferData(gl.ARRAY_BUFFER, instCapacity * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);
  const stride = FLOATS_PER_INSTANCE * 4;
  [[1, 2, 0], [2, 2, 8], [3, 4, 16], [4, 4, 32]].forEach(([loc, n, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off); gl.vertexAttribDivisor(loc, 1); });
  gl.bindVertexArray(null);
  let instData = new Float32Array(instCapacity * FLOATS_PER_INSTANCE);

  // ---- star VAOs (static per layer) ----
  const starVaos = starLayers.map(layer => {
    const v = gl.createVertexArray(); gl.bindVertexArray(v);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const data = new Float32Array(layer.stars.length * 5);
    layer.stars.forEach((s, i) => { data.set([s.x, s.y, s.r, s.b, s.t], i * 5); });
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    [[0, 2, 0], [1, 1, 8], [2, 1, 12], [3, 1, 16]].forEach(([loc, n, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 20, off); });
    gl.bindVertexArray(null);
    return { vao: v, count: layer.stars.length, layer, color: hexToRgb(layer.color || '#DCE6FF') };
  });

  // ---- ring lines (rebuilt on resize) ----
  const ringVao = gl.createVertexArray(); const ringBuf = gl.createBuffer();
  let ringVertexCount = 0, ringKey = '';
  function buildRings(rings) {
    const key = rings.map(r => `${r.rx.toFixed(1)}:${r.ry.toFixed(1)}`).join('|');
    if (key === ringKey) return; ringKey = key;
    const verts = [];
    for (const r of rings) {
      const circ = Math.PI * (3 * (r.rx + r.ry) - Math.sqrt((3 * r.rx + r.ry) * (r.rx + 3 * r.ry)));
      const dashes = Math.max(24, Math.floor(circ / 14));
      for (let i = 0; i < dashes; i++) {
        const a0 = (i / dashes) * Math.PI * 2, a1 = ((i + 4 / 14) / dashes) * Math.PI * 2;
        verts.push(r.rx * Math.cos(a0), r.ry * Math.sin(a0), r.rx * Math.cos(a1), r.ry * Math.sin(a1));
      }
    }
    gl.bindVertexArray(ringVao); gl.bindBuffer(gl.ARRAY_BUFFER, ringBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    ringVertexCount = verts.length / 2;
  }

  // ---- textures ----
  function makeTexture(source) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  function glowCanvas() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c;
  }
  const glowTex = makeTexture(glowCanvas());
  let nebulaTex = null, nebulaSize = null;
  function ensureNebula() {
    if (nebulaTex || !nebula) return;
    const c = document.createElement('canvas'); c.width = nebula.width; c.height = nebula.height;
    c.getContext('2d').drawImage(nebula, 0, 0);
    nebulaTex = makeTexture(c); nebulaSize = { w: nebula.width, h: nebula.height };
  }
  const pageTex = [];
  let atlasVersion = -1;
  function ensureAtlas() {
    if (atlas.version === atlasVersion) return;
    atlasVersion = atlas.version;
    atlas.pages.forEach((p, i) => {
      if (!pageTex[i]) pageTex[i] = makeTexture(p.canvas);
      else { gl.bindTexture(gl.TEXTURE_2D, pageTex[i]); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, p.canvas); }
    });
  }
  const labelCache = new Map();
  function labelTexture(text) {
    let e = labelCache.get(text);
    if (e) return e;
    const c = document.createElement('canvas'); c.width = 96; c.height = 32;
    const x = c.getContext('2d'); x.font = '600 20px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#B4BCE0'; x.fillText(text, 48, 16);
    e = { tex: makeTexture(c), w: 96, h: 32}; labelCache.set(text, e); return e;
  }

  // ---- batching ----
  let batch = [], batchCount = 0;
  function push(cx, cy, w, h, u0, v0, u1, v1, r, g, b, a) {
    if (batchCount >= instCapacity) return;
    const o = batchCount * FLOATS_PER_INSTANCE;
    instData[o] = cx; instData[o + 1] = cy; instData[o + 2] = w; instData[o + 3] = h; instData[o + 4] = u0; instData[o + 5] = v0; instData[o + 6] = u1; instData[o + 7] = v1;
    instData[o + 8] = r * a; instData[o + 9] = g * a; instData[o + 10] = b * a; instData[o + 11] = a; // premultiplied tint
    batchCount++;
  }
  function flush(texture, additive) {
    if (!batchCount) return;
    gl.useProgram(spriteProg);
    gl.uniform2f(su.res, width, height); gl.uniform1i(su.tex, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData, 0, batchCount * FLOATS_PER_INSTANCE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batchCount);
    gl.bindVertexArray(null);
    batchCount = 0;
  }
  function growInstances(n) {
    if (n <= instCapacity) return;
    instCapacity = Math.max(n, instCapacity * 2);
    instData = new Float32Array(instCapacity * FLOATS_PER_INSTANCE);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferData(gl.ARRAY_BUFFER, instCapacity * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);
  }

  function pushSprite(item, detail, size, alpha, scale) {
    const entry = atlas.get(item, detail, size * dpr);
    const d = size * (scale || 1);
    if (entry.ready && entry.page >= 0 && pageTex[entry.page]) {
      const ps = atlas.pageSize;
      return { tex: pageTex[entry.page], add: false, args: [item.x, item.y, d, d, entry.x / ps, entry.y / ps, (entry.x + entry.w) / ps, (entry.y + entry.h) / ps, 1, 1, 1, alpha] };
    }
    return { tex: glowTex, add: true, args: [item.x, item.y, d * 0.7, d * 0.7, 0, 0, 1, 1, 0.75, 0.8, 1, alpha * 0.5] };
  }
  function drawSpriteList(list, detailOf) {
    // group by texture to keep draw calls low (souls: by atlas page)
    const groups = new Map();
    for (const item of list) {
      const s = pushSprite(item, detailOf(item), item.size, item.alpha ?? 1, item.scale ?? 1);
      let g = groups.get(s.tex); if (!g) { g = { add: s.add, items: [] }; groups.set(s.tex, g); }
      g.items.push(s.args);
    }
    for (const [tex, g] of groups) { growInstances(g.items.length); for (const a of g.items) push(...a); flush(tex, g.add); }
  }

  function glowOf(item) { const s = resolveSoul(item.config); return hexToRgb(s.pal ? s.pal.glow : PALETTES[0].glow); }

  function resize(w, h) {
    width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render(f) {
    if (disposed || lost) return;
    ensureNebula(); ensureAtlas();
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    // 1 nebula (cover fit)
    if (nebulaTex && f.nebula) {
      const s = Math.max(width / nebulaSize.w, height / nebulaSize.h);
      push(width / 2 + f.camera.dx * 0.1, height / 2 + f.camera.dy * 0.1, nebulaSize.w * s, nebulaSize.h * s, 0, 0, 1, 1, 1, 1, 1, 1);
      flush(nebulaTex, false);
    }
    // 2-4 stars (additive point sprites)
    gl.useProgram(starProg);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform2f(stu.res, width, height); gl.uniform1f(stu.scale, f.layout.scale); gl.uniform1f(stu.dpr, dpr);
    gl.uniform1f(stu.ripple, 1 + 0.10 * (f.ripple || 0));
    const twinkle = f.level.twinkle;
    for (let i = 0; i < Math.min(f.level.starLayers, starVaos.length); i++) {
      const sv = starVaos[i];
      const par = f.stars[i] ? f.stars[i].parallax : sv.layer.parallax;
      gl.uniform2f(stu.off, f.camera.dx * par, f.camera.dy * par);
      gl.uniform1f(stu.time, f.timeSec || 0); gl.uniform1f(stu.amp, twinkle ? sv.layer.twinkleAmplitude : 0); gl.uniform1f(stu.period, sv.layer.twinklePeriodSeconds || 9);
      gl.uniform3f(stu.color, sv.color[0], sv.color[1], sv.color[2]);
      gl.bindVertexArray(sv.vao); gl.drawArrays(gl.POINTS, 0, sv.count); gl.bindVertexArray(null);
    }
    // 5 rings
    if (f.rings.length) {
      buildRings(f.rings);
      gl.useProgram(lineProg); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(lu.res, width, height); gl.uniform2f(lu.off, f.rings[0].cx, f.rings[0].cy); gl.uniform4f(lu.color, 0.66, 0.75, 1, 0.16);
      gl.bindVertexArray(ringVao); gl.drawArrays(gl.LINES, 0, ringVertexCount); gl.bindVertexArray(null);
    }
    // 6 souls + clusters
    drawSpriteList(f.souls, it => it.detail);
    if (f.clusters.length) {
      drawSpriteList(f.clusters, () => 'dot');
      for (const c of f.clusters) if (c.label) { const l = labelTexture(c.label); push(c.x, c.y + c.size / 2 + 12, l.w, l.h, 0, 0, 1, 1, 1, 1, 1, 1); flush(l.tex, false); }
    }
    // 7 entrances: trail + glow (additive) then sprite (normal)
    for (const e of f.entrances) {
      const c = glowOf(e);
      if (f.level.entranceTrail && e.trail) for (const tp of e.trail) push(tp.x, tp.y, e.size * 0.5, e.size * 0.5, 0, 0, 1, 1, c[0], c[1], c[2], Math.max(0, tp.alpha));
      if (e.glow > 0) push(e.x, e.y, e.size * 1.9, e.size * 1.9, 0, 0, 1, 1, c[0], c[1], c[2], 0.35 * e.glow);
      flush(glowTex, true);
    }
    drawSpriteList(f.entrances, () => 'full');
    // 8 foreground vignette glow (<= 12 %)
    push(width / 2, height / 2, Math.max(width, height) * 1.4, Math.max(width, height) * 1.4, 0, 0, 1, 1, 0.65, 0.58, 1, 0.10);
    flush(glowTex, true);
  }

  function handleLost(ev) {
    ev.preventDefault();
    lost = true;
    if (typeof onLost === 'function') onLost();
  }
  canvas.addEventListener('webglcontextlost', handleLost, false);

  return {
    kind: 'webgl2', canvas, resize, render,
    dispose() {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', handleLost);
      try { const ext = gl.getExtension('WEBGL_lose_context'); if (ext && !lost) ext.loseContext(); } catch { /* ignore */ }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
    onLost(fn) { onLost = fn; },
    get lost() { return lost; },
  };
}
