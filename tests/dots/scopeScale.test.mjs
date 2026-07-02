import assert from 'node:assert';
import { test } from 'node:test';
import { softCap, fitScale, lissaExtentFrac } from '../../src/scenes/dots/scopeScale.js';

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

test('lissaExtentFrac: peak=1 matches the prior full-scale sizing; monotonic in peak', () => {
  // Self-correlation spreads collapse to a point at silence; SPHERE/TOROID keep
  // a structural radius that never collapses (a nonzero floor).
  assert.strictEqual(lissaExtentFrac(0, 0), 0);      // LISSA — collapses
  assert.strictEqual(lissaExtentFrac(3, 0), 0);      // QUAD  — collapses
  assert.strictEqual(lissaExtentFrac(4, 0), 0);      // RIBBON — collapses
  assert.ok(lissaExtentFrac(1, 0) > 0.5);            // SPHERE — structural floor
  assert.ok(lissaExtentFrac(2, 0) > 0.6);            // TOROID — structural floor
  // peak=1 reproduces the prior constants (LISSA/QUAD 1.15, RIBBON 1.30, SPHERE/
  // TOROID their exact 1.0 radius) so a loud figure sizes as before.
  for (const [sp, v] of [[0, 1.15], [3, 1.15], [4, 1.30], [1, 1.0], [2, 1.0]]) {
    assert.ok(Math.abs(lissaExtentFrac(sp, 1) - v) < 1e-9, `spread ${sp} @peak1`);
  }
  // monotonic non-decreasing in peak for every spread, and clamps out-of-range.
  for (const sp of [0, 1, 2, 3, 4]) {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = lissaExtentFrac(sp, p);
      assert.ok(v >= prev - 1e-9, `spread ${sp} non-monotonic at ${p}`);
      prev = v;
    }
    assert.strictEqual(lissaExtentFrac(sp, 2), lissaExtentFrac(sp, 1)); // peak clamped to 1
    assert.strictEqual(lissaExtentFrac(sp, -1), lissaExtentFrac(sp, 0)); // and to 0
  }
});

test('peak-aware sizing grows a quiet LISSA figure >=2x at max gain, still inside the frame', () => {
  // Model the on-screen half-extent at max gain/range for a typical quiet-ish mic
  // waveform. reach = gain·1.15 (drive 0); baseR = mn·0.34·range; cap = 0.48·mn.
  const mn = 1000, cap = 0.48 * mn, knee = 0.9;
  const reach = 3 * 1.15, baseR = mn * 0.34 * 2.2;   // gain 3, range 2.2
  const peak = 0.3;                                  // a quiet-ish waveform
  // The on-screen extent is (true-geometry ∝ peak)·reach·R, where R sizes off the
  // clamp. OLD reserved full-scale headroom (frac at peak=1); NEW sizes on peak.
  const extent = (fracArg) => peak * reach * (baseR * fitScale(fracArg * reach * baseR, cap, knee));
  const extOld = extent(lissaExtentFrac(0, 1));      // full-scale-reserved (prior behaviour)
  const extNew = extent(lissaExtentFrac(0, peak));   // peak-aware (this change)
  assert.ok(extNew >= 2 * extOld, `expected >=2x, got ${(extNew / extOld).toFixed(2)}x`);
  assert.ok(extNew <= cap + 1e-6, `must stay within the frame cap (${extNew.toFixed(1)} <= ${cap})`);
});
