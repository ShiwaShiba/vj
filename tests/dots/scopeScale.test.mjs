import assert from 'node:assert';
import { test } from 'node:test';
import { softCap, fitScale } from '../../src/scenes/dots/scopeScale.js';

test('softCap is identity below the knee', () => {
  assert.strictEqual(softCap(0.3, 1.0, 0.9), 0.3);
  assert.strictEqual(softCap(0.0, 1.0, 0.9), 0);
  assert.strictEqual(softCap(0.9, 1.0, 0.9), 0.9); // exactly at the knee
});

test('softCap never exceeds the cap, however large the input (touches it at most)', () => {
  for (const e of [1.0, 2.0, 10, 1e3, 1e6]) {
    const v = softCap(e, 1.0, 0.9);
    assert.ok(v <= 1.0, `softCap(${e}) = ${v} must stay <= cap`);
    assert.ok(v >= 0.9, `softCap(${e}) = ${v} must stay >= knee`);
  }
});

test('softCap is continuous and monotonic across the knee', () => {
  let prev = -1;
  for (let e = 0; e <= 3; e += 0.05) {
    const v = softCap(e, 1.0, 0.9);
    assert.ok(v >= prev - 1e-9, `non-monotonic at ${e}`);
    assert.ok(v <= 1.0 + 1e-9, `over cap at ${e}`);
    prev = v;
  }
  // scales with cap
  assert.ok(Math.abs(softCap(2.0, 100, 0.9) - 2.0) < 1e-9); // still linear (2 << 90 knee)
  assert.ok(softCap(500, 100, 0.9) <= 100 && softCap(500, 100, 0.9) > 90);
});

test('fitScale == 1 below the knee, < 1 above, and fitScale*e == softCap(e)', () => {
  assert.strictEqual(fitScale(0.3, 1.0, 0.9), 1);
  assert.strictEqual(fitScale(0, 1.0, 0.9), 1);
  const e = 3.0;
  const f = fitScale(e, 1.0, 0.9);
  assert.ok(f < 1);
  assert.ok(Math.abs(f * e - softCap(e, 1.0, 0.9)) < 1e-9);
  assert.ok(f * e <= 1.0); // fitted extent is within the cap
});

test('fitScale reels a 6x-frame overflow back inside the frame', () => {
  const cap = 0.48;            // half min-dimension (fraction) with a 4% margin
  const raw = 6 * 0.5;         // 6x the frame half-extent (e.g. gain 3 x loud)
  assert.ok(raw * fitScale(raw, cap, 0.9) <= cap);
});
