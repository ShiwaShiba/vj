import assert from 'node:assert';
import { test } from 'node:test';
import { cohesionAt, smoother, CYCLE, STATION } from '../../src/scenes/dots/purposeMakerChoreo.js';

test('smoother pins endpoints with zero slope', () => {
  assert.strictEqual(smoother(0), 0);
  assert.strictEqual(smoother(1), 1);
  assert.ok(smoother(0.01) < 0.001, 'slow start');
});

test('station R holds full cohesion at its hold midpoint, B stays 0', () => {
  const s = cohesionAt(2.6 + 1.2); // R gather(2.6)+half hold
  assert.strictEqual(s.station, 'R');
  assert.ok(s.cR > 0.99 && s.phase === 'hold');
  assert.strictEqual(s.cL, 0);
});

test('sequence is R -> L -> Both across one cycle', () => {
  assert.strictEqual(cohesionAt(3.8).station, 'R');
  assert.strictEqual(cohesionAt(STATION + 3.8).station, 'L');
  assert.strictEqual(cohesionAt(2 * STATION + 3.8).station, 'Both');
  assert.ok(cohesionAt(2 * STATION + 3.8).cR > 0.99 && cohesionAt(2 * STATION + 3.8).cL > 0.99);
});

test('gap returns zero cohesion (hand fully dissolved)', () => {
  const s = cohesionAt(7.45); // R disperse ends 7.2, gap to 7.7
  assert.strictEqual(s.phase, 'gap');
  assert.ok(s.cR < 1e-6 && s.cL < 1e-6);
});

test('seamless: cohesion is continuous and returns to 0 at every station boundary', () => {
  for (let k = 0; k < 3; k++) {
    const b = k * STATION; // boundary
    const before = cohesionAt(b - 0.001), after = cohesionAt(b + 0.001);
    assert.ok(Math.abs(before.cR) < 1e-3 && Math.abs(before.cL) < 1e-3, 'cohesion 0 just before boundary');
    assert.ok(Math.abs(after.cR) < 1e-3 && Math.abs(after.cL) < 1e-3, 'cohesion 0 just after boundary');
  }
});

test('deterministic and loops with the cycle period', () => {
  assert.deepStrictEqual(cohesionAt(5.123), cohesionAt(5.123));
  assert.deepStrictEqual(cohesionAt(1.0), cohesionAt(1.0 + CYCLE));
});

test('pace scales durations (pace=2 stretches time by 2x)', () => {
  const a = cohesionAt(3.8, { pace: 1 });
  const b = cohesionAt(7.6, { pace: 2 });
  assert.strictEqual(a.station, b.station);
  assert.ok(Math.abs(a.cR - b.cR) < 1e-9);
});
