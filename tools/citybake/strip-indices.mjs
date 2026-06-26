// Post-process an existing city.glb: drop redundant fully-sequential index buffers
// WITHOUT re-baking. A primitive whose index accessor is exactly 0,1,…,n-1 (and
// n === POSITION count) is rewritten as a non-indexed primitive — three draws it
// identically, so positions and colours stay byte-for-byte unchanged. Only the
// dead index bytes (the buildings carpet alone is ~6 MB) leave the file.
//
// This mirrors the same drop the baker now does at write time (bake/glb.mjs:
// isSequential), letting us shrink the already-shipped dist/city.glb without
// re-running the AO bake (positions/colours provably identical to the old asset).
//
//   node tools/citybake/strip-indices.mjs            # rewrites dist/city.glb in place
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const JSON_TYPE = 0x4e4f534a, BIN_TYPE = 0x004e4942, GLB_MAGIC = 0x46546c67;
const UINT = 5125;

function parseGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a glb');
  const length = dv.getUint32(8, true);
  let off = 12, json = null, bin = null;
  while (off < length) {
    const clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
    const data = bytes.subarray(off + 8, off + 8 + clen);
    if (ctype === JSON_TYPE) json = JSON.parse(new TextDecoder().decode(data));
    else if (ctype === BIN_TYPE) bin = data;
    off += 8 + clen;
  }
  if (!json || !bin) throw new Error('glb missing JSON or BIN chunk');
  return { json, bin };
}

// True when accessor `ai` is a u32 SCALAR holding 0,1,…,vcount-1 (and length===vcount).
function indexIsSequential(json, bin, ai, vcount) {
  const a = json.accessors[ai];
  if (a.componentType !== UINT || a.type !== 'SCALAR' || a.count !== vcount) return false;
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset + base, a.count * 4);
  for (let i = 0; i < a.count; i++) if (dv.getUint32(i * 4, true) !== i) return false;
  return true;
}

// Rewrite glb bytes with every fully-sequential primitive index dropped. Surviving
// bufferViews are re-packed contiguously (4-byte aligned) and all accessor/bufferView
// cross-references are remapped. Returns a new Uint8Array; input is untouched.
export function stripIndices(glbBytes) {
  const { json, bin } = parseGlb(glbBytes);

  // 1. Find the index accessors to drop (and the bufferViews they own).
  const dropAcc = new Set();
  for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    if (prim.indices == null) continue;
    const vcount = json.accessors[prim.attributes.POSITION].count;
    if (indexIsSequential(json, bin, prim.indices, vcount)) dropAcc.add(prim.indices);
  }
  const dropBV = new Set([...dropAcc].map((ai) => json.accessors[ai].bufferView));

  // 2. Re-pack surviving bufferViews into a fresh contiguous buffer (4-byte aligned).
  const bvMap = new Map();                 // old bufferView index -> new index
  const newViews = [];
  const chunks = []; let binLen = 0;
  json.bufferViews.forEach((bv, i) => {
    if (dropBV.has(i)) return;
    const start = bv.byteOffset || 0;
    const slice = bin.subarray(start, start + bv.byteLength);
    chunks.push(slice);
    const view = { buffer: 0, byteOffset: binLen, byteLength: bv.byteLength };
    if (bv.target !== undefined) view.target = bv.target;
    if (bv.byteStride !== undefined) view.byteStride = bv.byteStride;
    bvMap.set(i, newViews.length);
    newViews.push(view);
    binLen += bv.byteLength;
    const pad = (4 - (binLen % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); binLen += pad; }
  });

  // 3. Re-index surviving accessors and remap their bufferView refs.
  const accMap = new Map();                // old accessor index -> new index
  const newAccessors = [];
  json.accessors.forEach((a, i) => {
    if (dropAcc.has(i)) return;
    const na = { ...a, bufferView: bvMap.get(a.bufferView) };
    accMap.set(i, newAccessors.length);
    newAccessors.push(na);
  });

  // 4. Rewrite primitive references through the accessor map; drop dead .indices.
  for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    for (const k of Object.keys(prim.attributes)) prim.attributes[k] = accMap.get(prim.attributes[k]);
    if (prim.indices != null) {
      if (dropAcc.has(prim.indices)) delete prim.indices;
      else prim.indices = accMap.get(prim.indices);
    }
  }

  json.bufferViews = newViews;
  json.accessors = newAccessors;
  json.buffers = [{ byteLength: binLen }];

  // 5. Assemble: BIN chunk (pad to 4 with zeros), JSON chunk (pad to 4 with spaces).
  const newBin = new Uint8Array(binLen);
  { let o = 0; for (const c of chunks) { newBin.set(c, o); o += c.length; } }
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(jsonBytes.length + jpad); t.set(jsonBytes); t.fill(0x20, jsonBytes.length); jsonBytes = t; }

  const total = 12 + 8 + jsonBytes.length + 8 + newBin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  dv.setUint32(p, GLB_MAGIC, true); dv.setUint32(p + 4, 2, true); dv.setUint32(p + 8, total, true); p += 12;
  dv.setUint32(p, jsonBytes.length, true); dv.setUint32(p + 4, JSON_TYPE, true); p += 8; out.set(jsonBytes, p); p += jsonBytes.length;
  dv.setUint32(p, newBin.length, true); dv.setUint32(p + 4, BIN_TYPE, true); p += 8; out.set(newBin, p);
  return out;
}

// CLI: rewrite dist/city.glb in place (unless a path is given).
if (import.meta.url === `file://${process.argv[1]}`) {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const target = process.argv[2] || join(HERE, 'dist', 'city.glb');
  const before = readFileSync(target);
  const after = stripIndices(before);
  writeFileSync(target, after);
  const mb = (n) => (n / 1048576).toFixed(2);
  console.log(`strip-indices: ${target}`);
  console.log(`  ${mb(before.length)} MB -> ${mb(after.length)} MB  (-${mb(before.length - after.length)} MB)`);
}
