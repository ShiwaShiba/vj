import assert from 'node:assert';
import { test } from 'node:test';
import * as THREE from '../../src/vendor/three.module.js';
import { buildGroundGrid, makeGroundSampler } from '../../src/cityproto/groundSampler.js';

// PURE core: a single tilted triangle. Interpolated height at the centroid is the mean of
// the three vertex heights; a point outside the triangle (but inside the xz bbox) is a miss.
test('buildGroundGrid interpolates height inside a triangle, 0 outside', () => {
  const wx = new Float64Array([0, 4, 0]);
  const wy = new Float64Array([0, 2, 8]);     // varying heights
  const wz = new Float64Array([0, 0, 4]);
  const g = buildGroundGrid({ wx, wy, wz, index: null, triCount: 1 });
  assert.ok(Math.abs(g.sample(4 / 3, 4 / 3) - (0 + 2 + 8) / 3) < 1e-9, 'centroid = mean height');
  assert.strictEqual(g.sample(3.5, 3.5), 0, 'corner outside the triangle ⇒ miss');
  assert.strictEqual(g.sample(100, 100), 0, 'outside bounds ⇒ 0');
});

// Build a synthetic DEM heightfield as a THREE mesh, give it a non-identity TRS (mirrors
// the glb terrain node's KHR-quantization translation+scale), and assert the sampler
// matches an actual downward THREE.Raycaster at many query points.
function makeTerrainMesh(N, amp) {
  const verts = [], idx = [];
  const h = (i, j) => amp * Math.sin(i * 0.7) * Math.cos(j * 0.5) + 0.01 * i * j;   // bumpy heightfield
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) verts.push(i, h(i, j), j);
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const a = i * N + j, b = i * N + j + 1, c = (i + 1) * N + j, d = (i + 1) * N + j + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.set(-2.5, 1.3, 0.8);          // non-identity TRS like the quantized terrain node
  mesh.scale.set(0.3, 0.5, 0.3);
  mesh.updateMatrixWorld(true);
  return mesh;
}

test('makeGroundSampler matches THREE.Raycaster across the heightfield (world TRS)', () => {
  const mesh = makeTerrainMesh(12, 1.5);
  const groundY = makeGroundSampler(mesh);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
  const refY = (wx, wz) => { from.set(wx, 60, wz); ray.set(from, down); const hh = ray.intersectObject(mesh, false); return hh.length ? hh[0].point.y : 0; };

  // sweep interior world-space xz (avoid the outer edge where raycast/sample agree on miss=0)
  let s = 0x12345678 >>> 0; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  let checked = 0, maxDiff = 0;
  for (let k = 0; k < 400; k++) {
    const wx = -2.0 + rnd() * 2.6, wz = 1.0 + rnd() * 2.6;   // inside the transformed footprint
    const ref = refY(wx, wz);
    if (ref === 0) continue;                                  // skip misses (edge gaps)
    const got = groundY(wx, wz);
    const d = Math.abs(got - ref);
    if (d > maxDiff) maxDiff = d;
    checked++;
    assert.ok(d < 1e-4, `height mismatch at (${wx.toFixed(3)},${wz.toFixed(3)}): got ${got}, ref ${ref}`);
  }
  assert.ok(checked > 100, `expected many interior hits, got ${checked}`);
});

// Non-indexed primitive (pushTri-style: every 3 verts is a triangle) also works.
test('buildGroundGrid handles non-indexed geometry', () => {
  const wx = new Float64Array([0, 2, 0, 2, 2, 0]);
  const wy = new Float64Array([1, 1, 1, 1, 1, 1]);   // flat at y=1
  const wz = new Float64Array([0, 0, 2, 0, 2, 2]);
  const g = buildGroundGrid({ wx, wy, wz, index: null, triCount: 2 });
  assert.ok(Math.abs(g.sample(1, 1) - 1) < 1e-9, 'flat quad samples its height');
});
