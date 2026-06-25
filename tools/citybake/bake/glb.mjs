// Minimal, conformant binary glTF (.glb) writer. Hand-rolled to avoid the
// DOM-bound GLTFExporter — we only emit POSITION + (optional) COLOR_0 + indices
// per node, an unlit material, and one scene. The runtime loads it with the
// standard GLTFLoader; emitting KHR_materials_unlit keeps it correct elsewhere.
const GLB_MAGIC = 0x46546c67, JSON_TYPE = 0x4e4f534a, BIN_TYPE = 0x004e4942;
const FLOAT = 5126, UINT = 5125, ARRAY_BUFFER = 34962, ELEMENT_ARRAY = 34963;

function vec3MinMax(arr) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { const v = arr[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max };
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
    const posView = addView(node.positions, ARRAY_BUFFER);
    const { min, max } = vec3MinMax(node.positions);
    const POSITION = accessors.length;
    accessors.push({ bufferView: posView, componentType: FLOAT, count: node.positions.length / 3, type: 'VEC3', min, max });
    const attributes = { POSITION };
    if (node.colors && node.colors.length) {
      const colView = addView(node.colors, ARRAY_BUFFER);
      accessors.push({ bufferView: colView, componentType: FLOAT, count: node.colors.length / 3, type: 'VEC3' });
      attributes.COLOR_0 = accessors.length - 1;
    }
    const idxView = addView(node.indices, ELEMENT_ARRAY);
    const indices = accessors.length;
    accessors.push({ bufferView: idxView, componentType: UINT, count: node.indices.length, type: 'SCALAR' });
    meshes.push({ name: node.name, primitives: [{ attributes, indices, material: 0, mode: node.mode ?? 4 }] });
    gltfNodes.push({ name: node.name, mesh: meshes.length - 1 });
  }

  const gltf = {
    asset: { version: '2.0', generator: 'citybake' },
    extensionsUsed: ['KHR_materials_unlit'],
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
