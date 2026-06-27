// tests/cityproto/scopeModes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash01, clamp, lerp, smooth01 } from '../../src/cityproto/scopeModes.js';

test('hash01 deterministic & in [0,1)', () => {
  for (let i = 0; i < 50; i++) {
    const a = hash01(i), b = hash01(i);
    assert.equal(a, b);
    assert.ok(a >= 0 && a < 1, `hash01(${i})=${a}`);
  }
  assert.notEqual(hash01(1), hash01(2));
});

test('clamp/lerp/smooth01 basics', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(smooth01(0), 0);
  assert.equal(smooth01(1), 1);
  assert.ok(Math.abs(smooth01(0.5) - 0.5) < 1e-9);
});
