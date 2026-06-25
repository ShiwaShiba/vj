import assert from 'node:assert';
import { test } from 'node:test';
import { writeGlb } from '../../bake/glb.mjs';

function parseGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint32(0, true), version = dv.getUint32(4, true), length = dv.getUint32(8, true);
  let off = 12; const chunks = [];
  while (off < length) {
    const clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
    chunks.push({ ctype, data: bytes.subarray(off + 8, off + 8 + clen) });
    off += 8 + clen;
  }
  return { magic, version, length, chunks };
}

test('writes a valid 2-chunk glb with POSITION+COLOR_0+indices and a LINES node', () => {
  const tri = {
    name: 'tri', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    colors: new Float32Array([0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.3, 0.3, 0.3]), indices: new Uint32Array([0, 1, 2]),
  };
  const line = { name: 'terrainGrid', mode: 1, positions: new Float32Array([0, 0, 0, 1, 1, 1]), indices: new Uint32Array([0, 1]) };
  const bytes = writeGlb({ nodes: [tri, line] });
  const { magic, version, chunks } = parseGlb(bytes);

  assert.strictEqual(magic, 0x46546c67, 'glTF magic');
  assert.strictEqual(version, 2);
  assert.strictEqual(chunks.length, 2);
  assert.strictEqual(chunks[0].ctype, 0x4e4f534a, 'JSON chunk');
  assert.strictEqual(chunks[1].ctype, 0x004e4942, 'BIN chunk');

  const json = JSON.parse(new TextDecoder().decode(chunks[0].data));
  assert.strictEqual(json.asset.version, '2.0');
  assert.ok(json.extensionsUsed.includes('KHR_materials_unlit'));
  assert.strictEqual(json.scene, 0);
  assert.strictEqual(json.scenes[0].nodes.length, 2);
  assert.strictEqual(json.nodes.length, 2);

  const triMesh = json.meshes[json.nodes.find((n) => n.name === 'tri').mesh];
  const prim = triMesh.primitives[0];
  assert.ok(Number.isInteger(prim.attributes.POSITION));
  assert.ok(Number.isInteger(prim.attributes.COLOR_0));
  assert.ok(Number.isInteger(prim.indices));
  assert.strictEqual(json.accessors[prim.attributes.POSITION].count, 3);
  assert.strictEqual(json.accessors[prim.attributes.POSITION].type, 'VEC3');
  assert.ok(json.accessors[prim.attributes.POSITION].min && json.accessors[prim.attributes.POSITION].max);
  assert.strictEqual(json.accessors[prim.indices].count, 3);

  const lineMesh = json.meshes[json.nodes.find((n) => n.name === 'terrainGrid').mesh];
  assert.strictEqual(lineMesh.primitives[0].mode, 1, 'LINES mode');
  assert.strictEqual(lineMesh.primitives[0].attributes.COLOR_0, undefined, 'line node has no colours');

  assert.strictEqual(chunks[1].data.length, json.buffers[0].byteLength, 'BIN length matches buffer');
});
