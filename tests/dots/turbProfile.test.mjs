import assert from 'node:assert';
import { test } from 'node:test';
import { decodeTurbProfile } from '../../src/scenes/dots/turbProfile.js';

test('decodeTurbProfile returns a valid density map and scalars', () => {
  const p = decodeTurbProfile();
  assert.ok(p.dim >= 16, 'has a grid');
  assert.strictEqual(p.density.length, p.dim * p.dim);
  let lo = Infinity, hi = -Infinity;
  for (const v of p.density) { assert.ok(v >= 0 && v <= 1); if (v < lo) lo = v; if (v > hi) hi = v; }
  assert.ok(hi > lo, 'density has contrast (not all one value)');
  assert.ok(Number.isFinite(p.flowAngle));
  assert.ok(p.coherence >= 0 && p.coherence <= 1);
  assert.ok(p.scale > 0 && p.scale < 1);
});
