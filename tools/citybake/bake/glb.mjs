// Minimal, conformant binary glTF (.glb) writer. Hand-rolled to avoid the
// DOM-bound GLTFExporter — we emit POSITION + (optional) COLOR_0 + indices per
// node, an unlit material, and one scene. To keep the iPad payload light the
// asset is QUANTIZED: POSITION → UNSIGNED_SHORT via KHR_mesh_quantization (a
// per-node translation+scale dequantizes it), COLOR_0 → normalized UNSIGNED_BYTE
// (RGBA). This roughly halves the glb vs Float32. The runtime loads it with the
// standard GLTFLoader (three supports KHR_mesh_quantization + ubyte colours).
const GLB_MAGIC = 0x46546c67, JSON_TYPE = 0x4e4f534a, BIN_TYPE = 0x004e4942;
const USHORT = 5123, UBYTE = 5121, UINT = 5125, ARRAY_BUFFER = 34962, ELEMENT_ARRAY = 34963;
const QMAX = 65535;

function vec3MinMax(arr) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { const v = arr[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max };
}

// Float32 VEC3 world positions → UNSIGNED_SHORT VEC3 + a node translation/scale
// that maps q back to world: world = q * scale + translation.
function quantizePositions(arr) {
  const { min, max } = vec3MinMax(arr);
  const range = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const scale = range.map((r) => (r > 0 ? r / QMAX : 1)); // degenerate dim → q≡0, world=min
  const n = arr.length / 3;
  const q = new Uint16Array(n * 3);
  const qmin = [QMAX, QMAX, QMAX], qmax = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const v = range[k] > 0 ? Math.max(0, Math.min(QMAX, Math.round((arr[i * 3 + k] - min[k]) / range[k] * QMAX))) : 0;
    q[i * 3 + k] = v;
    if (v < qmin[k]) qmin[k] = v; if (v > qmax[k]) qmax[k] = v;
  }
  return { q, translation: min, scale, qmin, qmax };
}

// Float32 VEC3 grey → normalized UNSIGNED_BYTE VEC4 (RGBA, A=255).
function quantizeColors(arr) {
  const n = arr.length / 3;
  const c = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) c[i * 4 + k] = Math.max(0, Math.min(255, Math.round(arr[i * 3 + k] * 255)));
    c[i * 4 + 3] = 255;
  }
  return c;
}

export function writeGlb({ nodes }) {
  const bufferViews = [], accessors = [], meshes = [], gltfNodes = [];
  const chunks = []; let binLength = 0;

  const addView = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.byteLength, target });
    chunks.push(bytes); binLength += bytes.byteLength;
    const pad = (4 - (binLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); binLength += pad; }
    return bufferViews.length - 1;
  };

  for (const node of nodes) {
    const { q, translation, scale, qmin, qmax } = quantizePositions(node.positions);
    const posView = addView(q, ARRAY_BUFFER);
    const POSITION = accessors.length;
    accessors.push({ bufferView: posView, componentType: USHORT, count: q.length / 3, type: 'VEC3', min: qmin, max: qmax });
    const attributes = { POSITION };
    if (node.colors && node.colors.length) {
      const colView = addView(quantizeColors(node.colors), ARRAY_BUFFER);
      accessors.push({ bufferView: colView, componentType: UBYTE, normalized: true, count: node.colors.length / 3, type: 'VEC4' });
      attributes.COLOR_0 = accessors.length - 1;
    }
    const idxView = addView(node.indices, ELEMENT_ARRAY);
    const indices = accessors.length;
    accessors.push({ bufferView: idxView, componentType: UINT, count: node.indices.length, type: 'SCALAR' });
    meshes.push({ name: node.name, primitives: [{ attributes, indices, material: 0, mode: node.mode ?? 4 }] });
    gltfNodes.push({ name: node.name, mesh: meshes.length - 1, translation, scale });
  }

  const gltf = {
    asset: { version: '2.0', generator: 'citybake' },
    extensionsUsed: ['KHR_materials_unlit', 'KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
    materials: [{ name: 'unlit', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, extensions: { KHR_materials_unlit: {} } }],
    buffers: [{ byteLength: binLength }],
    bufferViews, accessors, meshes, nodes: gltfNodes,
    scenes: [{ nodes: gltfNodes.map((_, i) => i) }], scene: 0,
  };

  // JSON chunk (pad to 4 with spaces)
  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(jsonBytes.length + jpad); t.set(jsonBytes); t.fill(0x20, jsonBytes.length); jsonBytes = t; }

  // BIN chunk
  const bin = new Uint8Array(binLength); { let o = 0; for (const c of chunks) { bin.set(c, o); o += c.length; } }

  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  dv.setUint32(p, GLB_MAGIC, true); dv.setUint32(p + 4, 2, true); dv.setUint32(p + 8, total, true); p += 12;
  dv.setUint32(p, jsonBytes.length, true); dv.setUint32(p + 4, JSON_TYPE, true); p += 8; out.set(jsonBytes, p); p += jsonBytes.length;
  dv.setUint32(p, bin.length, true); dv.setUint32(p + 4, BIN_TYPE, true); p += 8; out.set(bin, p);
  return out;
}
