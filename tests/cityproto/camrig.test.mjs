import assert from 'node:assert';
import { test } from 'node:test';
import { makeKeyframes, lerpParams, applyParallax } from '../../src/cityproto/camrig.js';

// ④ full-city framing (the current proto params literal).
const FULL = { camX: -5.1, camY: 55.3, camZ: 50, fov: 50, lookX: -5.1, lookY: 0, lookV: 16.8 };
const LANDMARK = { x: 2, y: 1, z: -3 };   // 旧駅舎 world center (synthetic)
const STATION = { x: 0, z: -1.8 };          // station plaza world

function kf() { return makeKeyframes({ full: FULL, landmark: LANDMARK, station: STATION }); }

test('returns the four framings ①②③④', () => {
  const k = kf();
  assert.strictEqual(k.length, 4);
});

test('④ is exactly the full-city params', () => {
  assert.deepStrictEqual(kf()[3], FULL);
});

test('① looks at the 旧駅舎 landmark', () => {
  const k1 = kf()[0];
  assert.strictEqual(k1.lookX, LANDMARK.x);
  assert.strictEqual(k1.lookY, LANDMARK.y);
  assert.strictEqual(k1.lookV, LANDMARK.z);
});

test('camera climbs/pulls out monotonically ①<②<③<④ (height)', () => {
  const k = kf();
  assert.ok(k[0].camY < k[1].camY, '①<②');
  assert.ok(k[1].camY < k[2].camY, '②<③');
  assert.ok(k[2].camY < k[3].camY, '③<④');
});

test('all framings share the same oblique bearing (the fixed look angle)', () => {
  const k = kf();
  const bearing = (p) => {
    const dx = p.camX - p.lookX, dz = p.camZ - p.lookV, L = Math.hypot(dx, dz) || 1;
    return [dx / L, dz / L];
  };
  const ref = bearing(FULL);
  for (const p of k) {
    const b = bearing(p);
    assert.ok(Math.abs(b[0] - ref[0]) < 1e-6 && Math.abs(b[1] - ref[1]) < 1e-6, 'bearing drift');
  }
});

test('lerpParams interpolates every field', () => {
  const a = { camX: 0, camY: 0, camZ: 0, fov: 30, lookX: 0, lookY: 0, lookV: 0 };
  const b = { camX: 10, camY: 20, camZ: 30, fov: 50, lookX: 2, lookY: 4, lookV: 6 };
  assert.deepStrictEqual(lerpParams(a, b, 0), a);
  assert.deepStrictEqual(lerpParams(a, b, 1), b);
  const mid = lerpParams(a, b, 0.5);
  assert.strictEqual(mid.camY, 10);
  assert.strictEqual(mid.fov, 40);
  assert.strictEqual(mid.lookV, 3);
});

test('applyParallax with amt=0 is a no-op; amt>0 drifts the camera', () => {
  const p = { camX: 1, camY: 2, camZ: 3, fov: 40, lookX: 0, lookY: 0, lookV: 0 };
  assert.deepStrictEqual(applyParallax(p, 0.3, 0), p);
  const drifted = applyParallax(p, 0.3, 1);
  assert.notStrictEqual(drifted.camX, p.camX);
});
