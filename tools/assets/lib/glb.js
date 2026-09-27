// Minimal glTF 2.0 binary (GLB) reader for the asset pipeline: header + JSON chunk + BIN chunk, and a VEC3 accessor
// reader that understands KHR_mesh_quantization (normalized int8/int16/uint8/uint16) and float data. Zero third-party
// code; used by tools/assets/build-soul-baseline.js and build-soul-decor.js (deep checks) and validate-manifest.js (header check).

export const GLB_MAGIC = 0x46546c67;      // 'glTF'
export const CHUNK_JSON = 0x4e4f534a;     // 'JSON'
export const CHUNK_BIN = 0x004e4942;      // 'BIN\0'
export const COMPONENT = Object.freeze({ 5120: { bytes: 1, max: 127, get: 'getInt8' }, 5121: { bytes: 1, max: 255, get: 'getUint8' }, 5122: { bytes: 2, max: 32767, get: 'getInt16' }, 5123: { bytes: 2, max: 65535, get: 'getUint16' }, 5125: { bytes: 4, max: 4294967295, get: 'getUint32' }, 5126: { bytes: 4, max: 1, get: 'getFloat32' } });
export const TYPE_SIZE = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 });

/**
 * Parse the GLB container. Never throws: { ok, reason, version, length, json, bin (Buffer | null) }.
 * Checks: magic, version 2, declared length == buffer length, first chunk JSON (parseable), optional BIN chunk.
 */
export function readGlb(buf) {
  const r = { ok: false, reason: null, version: null, length: null, json: null, bin: null };
  try {
    if (!buf || buf.length < 20) { r.reason = 'file shorter than a GLB header'; return r; }
    if (buf.readUInt32LE(0) !== GLB_MAGIC) { r.reason = 'bad magic (not glTF binary)'; return r; }
    r.version = buf.readUInt32LE(4); r.length = buf.readUInt32LE(8);
    if (r.version !== 2) { r.reason = `glTF binary version ${r.version} != 2`; return r; }
    if (r.length !== buf.length) { r.reason = `declared length ${r.length} != file size ${buf.length}`; return r; }
    const jsonLen = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== CHUNK_JSON) { r.reason = 'first chunk is not JSON'; return r; }
    if (20 + jsonLen > buf.length) { r.reason = 'JSON chunk exceeds file'; return r; }
    r.json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    let off = 20 + jsonLen;
    if (off + 8 <= buf.length) {
      const binLen = buf.readUInt32LE(off);
      if (buf.readUInt32LE(off + 4) !== CHUNK_BIN) { r.reason = 'second chunk is not BIN'; return r; }
      if (off + 8 + binLen > buf.length) { r.reason = 'BIN chunk exceeds file'; return r; }
      r.bin = buf.subarray(off + 8, off + 8 + binLen);
      off += 8 + binLen;
    }
    r.ok = true;
    return r;
  } catch (err) { r.reason = String(err && err.message || err); return r; }
}

/** Read one accessor as plain numbers (normalized integer data dequantised to [-1, 1] / [0, 1]). Returns number[][]. */
export function readAccessor(json, bin, index) {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`accessor ${index} missing`);
  const comp = COMPONENT[acc.componentType];
  const size = TYPE_SIZE[acc.type];
  if (!comp || !size) throw new Error(`accessor ${index}: unsupported componentType ${acc.componentType} / type ${acc.type}`);
  const view = json.bufferViews?.[acc.bufferView];
  if (!view) throw new Error(`accessor ${index}: bufferView ${acc.bufferView} missing`);
  const stride = view.byteStride || comp.bytes * size;
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const end = base + stride * (acc.count - 1) + comp.bytes * size;
  if (!bin || end > (view.byteOffset || 0) + view.byteLength || end > bin.length) throw new Error(`accessor ${index} exceeds its bufferView / BIN chunk`);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    const row = new Array(size);
    for (let c = 0; c < size; c++) {
      const v = dv[comp.get](base + i * stride + c * comp.bytes, true);
      row[c] = acc.normalized ? (comp.get.startsWith('getInt') ? Math.max(v / comp.max, -1) : v / comp.max) : v;
    }
    out[i] = row;
  }
  return out;
}

/** Axis-aligned bounds of the first mesh's POSITION data in scene space (node translation/scale applied). */
export function meshBounds(json, bin) {
  const nodeIndex = (json.scenes?.[json.scene ?? 0]?.nodes || [0])[0];
  const node = json.nodes?.[nodeIndex] || {};
  const mesh = json.meshes?.[node.mesh ?? 0];
  const prim = mesh?.primitives?.[0];
  if (!prim || prim.attributes?.POSITION === undefined) throw new Error('no POSITION attribute');
  const s = node.scale || [1, 1, 1], t = node.translation || [0, 0, 0];
  if (node.rotation && node.rotation.some((v, i) => Math.abs(v - [0, 0, 0, 1][i]) > 1e-9)) throw new Error('node rotation is not supported by the bounds reader');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of readAccessor(json, bin, prim.attributes.POSITION)) {
    for (let k = 0; k < 3; k++) { const v = p[k] * s[k] + t[k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  }
  return { min, max };
}

/** Axis-aligned bounds over every primitive of the first node's mesh (scene space; face kits have one primitive per part). */
export function meshBoundsAll(json, bin) {
  const nodeIndex = (json.scenes?.[json.scene ?? 0]?.nodes || [0])[0];
  const node = json.nodes?.[nodeIndex] || {};
  const prims = json.meshes?.[node.mesh ?? 0]?.primitives || [];
  if (!prims.length) throw new Error('no mesh primitive');
  const s = node.scale || [1, 1, 1], t = node.translation || [0, 0, 0];
  if (node.rotation && node.rotation.some((v, i) => Math.abs(v - [0, 0, 0, 1][i]) > 1e-9)) throw new Error('node rotation is not supported by the bounds reader');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const prim of prims) {
    if (prim.attributes?.POSITION === undefined) throw new Error('primitive without POSITION');
    for (const p of readAccessor(json, bin, prim.attributes.POSITION)) {
      for (let k = 0; k < 3; k++) { const v = p[k] * s[k] + t[k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    }
  }
  return { min, max };
}

/**
 * Images a GLB refers to: [{ index, uri, bufferView, external, relative }]. `external` = loaded by URI (not packed in the
 * BIN chunk); `relative` = a plain relative reference (no scheme, no leading '/', no '..', not data: or blob:), the only
 * kind the page CSP lets GLTFLoader fetch next to the model.
 */
export function imageRefs(json) {
  return (json.images || []).map((img, index) => {
    const uri = typeof img.uri === 'string' ? img.uri : null;
    const relative = !!uri && !/^[a-z][a-z0-9+.-]*:/i.test(uri) && !uri.startsWith('/') && !uri.split(/[\\/]/).includes('..');
    return { index, uri, bufferView: img.bufferView ?? null, external: !!uri && img.bufferView === undefined, relative };
  });
}
