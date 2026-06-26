import assert from 'node:assert';
import { test } from 'node:test';
import { stripIndices } from '../../strip-indices.mjs';

const JSON_TYPE = 0x4e4f534a, BIN_TYPE = 0x004e4942, GLB_MAGIC = 0x46546c67;

// Hand-build a 2-node glb (the patched writer no longer emits sequential indices,
// so we lay one out directly): node A is a triangle with a redundant sequential
// index [0,1,2]; node B is a quad whose [0,1,2,0,2,3] genuinely reuses vertices.
// POSITION is u16 (like the real quantized asset), COLOR_0 is ubyte VEC4, index u32.
function makeIndexedGlb() {
  const views = [], accessors = [], chunks = [];
  let binLen = 0;
  const addView = (typed) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    views.push({ buffer: 0, byteOffset: binLen, byteLength: bytes.byteLength });
    chunks.push(bytes); binLen += bytes.byteLength;
    const pad = (4 - (binLen % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); binLen += pad; }
    return views.length - 1;
  };
  const mesh = (posArr, colArr, idxArr) => {
    const pv = addView(posArr);
    accessors.push({ bufferView: pv, componentType: 5123, count: posArr.length / 3, type: 'VEC3', min: [0, 0, 0], max: [9, 9, 9] });
    const POSITION = accessors.length - 1;
    const cv = addView(colArr);
    accessors.push({ bufferView: cv, componentType: 5121, normalized: true, count: colArr.length / 4, type: 'VEC4' });
    const COLOR_0 = accessors.length - 1;
    const iv = addView(idxArr);
    accessors.push({ bufferView: iv, componentType: 5125, count: idxArr.length, type: 'SCALAR' });
    return { primitives: [{ attributes: { POSITION, COLOR_0 }, indices: accessors.length - 1, material: 0, mode: 4 }] };
  };
  const meshes = [
    mesh(new Uint16Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint8Array([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255]), new Uint32Array([0, 1, 2])),
    mesh(new Uint16Array([0, 0, 0, 9, 0, 0, 9, 9, 0, 0, 9, 0]), new Uint8Array([4, 4, 4, 255, 5, 5, 5, 255, 6, 6, 6, 255, 7, 7, 7, 255]), new Uint32Array([0, 1, 2, 0, 2, 3])),
  ];
  const json = {
    asset: { version: '2.0' }, buffers: [{ byteLength: binLen }],
    bufferViews: views, accessors,
    meshes, nodes: [{ name: 'seq', mesh: 0 }, { name: 'shared', mesh: 1 }],
    scenes: [{ nodes: [0, 1] }], scene: 0,
  };
  const bin = new Uint8Array(binLen); { let o = 0; for (const c of chunks) { bin.set(c, o); o += c.length; } }
  let jb = new TextEncoder().encode(JSON.stringify(json));
  const jp = (4 - (jb.length % 4)) % 4; if (jp) { const t = new Uint8Array(jb.length + jp); t.set(jb); t.fill(0x20, jb.length); jb = t; }
  const total = 12 + 8 + jb.length + 8 + bin.length;
  const out = new Uint8Array(total); const dv = new DataView(out.buffer); let p = 0;
  dv.setUint32(p, GLB_MAGIC, true); dv.setUint32(p + 4, 2, true); dv.setUint32(p + 8, total, true); p += 12;
  dv.setUint32(p, jb.length, true); dv.setUint32(p + 4, JSON_TYPE, true); p += 8; out.set(jb, p); p += jb.length;
  dv.setUint32(p, bin.length, true); dv.setUint32(p + 4, BIN_TYPE, true); p += 8; out.set(bin, p);
  return out;
}

function parse(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = dv.getUint32(8, true); let off = 12, json = null, bin = null;
  while (off < length) {
    const clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
    const data = bytes.subarray(off + 8, off + 8 + clen);
    if (ctype === JSON_TYPE) json = JSON.parse(new TextDecoder().decode(data));
    else if (ctype === BIN_TYPE) bin = data;
    off += 8 + clen;
  }
  return { json, bin };
}

// Read accessor data out of a parsed glb as a plain array of numbers.
function readAccessor(json, bin, ai) {
  const a = json.accessors[ai];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const n = a.count * comps;
  const dv = new DataView(bin.buffer, bin.byteOffset + base);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (a.componentType === 5123) out.push(dv.getUint16(i * 2, true));
    else if (a.componentType === 5121) out.push(dv.getUint8(i));
    else if (a.componentType === 5125) out.push(dv.getUint32(i * 4, true));
  }
  return out;
}

test('stripIndices: drops the sequential index, keeps the vertex-reusing one', () => {
  const out = stripIndices(makeIndexedGlb());
  const { json } = parse(out);
  const seq = json.meshes[json.nodes.find((n) => n.name === 'seq').mesh].primitives[0];
  const shared = json.meshes[json.nodes.find((n) => n.name === 'shared').mesh].primitives[0];
  assert.strictEqual(seq.indices, undefined, 'sequential index dropped');
  assert.ok(Number.isInteger(shared.indices), 'reusing index kept');
});

test('stripIndices: POSITION + COLOR_0 data is byte-identical before/after', () => {
  const before = makeIndexedGlb();
  const pb = parse(before), pa = parse(stripIndices(before));
  for (const name of ['seq', 'shared']) {
    const mb = pb.json.meshes[pb.json.nodes.find((n) => n.name === name).mesh].primitives[0];
    const ma = pa.json.meshes[pa.json.nodes.find((n) => n.name === name).mesh].primitives[0];
    assert.deepStrictEqual(readAccessor(pa.json, pa.bin, ma.attributes.POSITION), readAccessor(pb.json, pb.bin, mb.attributes.POSITION), `${name} POSITION identical`);
    assert.deepStrictEqual(readAccessor(pa.json, pa.bin, ma.attributes.COLOR_0), readAccessor(pb.json, pb.bin, mb.attributes.COLOR_0), `${name} COLOR_0 identical`);
  }
});

test('stripIndices: the kept index buffer round-trips its values', () => {
  const pa = parse(stripIndices(makeIndexedGlb()));
  const shared = pa.json.meshes[pa.json.nodes.find((n) => n.name === 'shared').mesh].primitives[0];
  assert.deepStrictEqual(readAccessor(pa.json, pa.bin, shared.indices), [0, 1, 2, 0, 2, 3], 'shared indices preserved');
});

test('stripIndices: buffer shrinks by exactly the dropped index bytes (3 u32 = 12B)', () => {
  const before = makeIndexedGlb();
  const pb = parse(before), pa = parse(stripIndices(before));
  assert.strictEqual(pb.json.buffers[0].byteLength - pa.json.buffers[0].byteLength, 12, 'one 3-index u32 buffer removed');
  assert.strictEqual(pb.json.accessors.length - pa.json.accessors.length, 1, 'one accessor removed');
  assert.strictEqual(pb.json.bufferViews.length - pa.json.bufferViews.length, 1, 'one bufferView removed');
});

test('stripIndices: idempotent (a stripped glb strips to itself)', () => {
  const once = stripIndices(makeIndexedGlb());
  const twice = stripIndices(once);
  assert.deepStrictEqual([...twice], [...once], 're-running changes nothing');
});
