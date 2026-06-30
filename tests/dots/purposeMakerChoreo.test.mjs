import assert from 'node:assert';
import { test } from 'node:test';
import { cohesionAt, smoother, CYCLE, STATION, cycleOf, STATION_SEQ, DURATIONS } from '../../src/scenes/dots/purposeMakerChoreo.js';

// Time points derived from DURATIONS so the suite survives timing tweaks.
const HOLD_MID = DURATIONS.gather + DURATIONS.hold / 2;                                 // inside hold
const GAP_MID = DURATIONS.gather + DURATIONS.hold + DURATIONS.disperse + DURATIONS.gap / 2; // inside gap

test('smoother pins endpoints with zero slope', () => {
  assert.strictEqual(smoother(0), 0);
  assert.strictEqual(smoother(1), 1);
  assert.ok(smoother(0.01) < 0.001, 'slow start');
});

test('the hand emergence (gather) takes ~10s — slow, contemplative', () => {
  assert.ok(DURATIONS.gather >= 10, `gather is at least 10s (${DURATIONS.gather})`);
  assert.ok(Math.abs(STATION - 19) < 1e-9, 'one station = 19s');
  // g rises slowly across the long gather: still well below full at 5s in.
  assert.ok(cohesionAt(5).c < 0.7, 'half-way through gather the hand is not yet resolved');
});

test('station R holds full cohesion at its hold midpoint, B stays 0', () => {
  const s = cohesionAt(HOLD_MID);
  assert.strictEqual(s.station, 'R');
  assert.ok(s.cR > 0.99 && s.phase === 'hold');
  assert.strictEqual(s.cL, 0);
});

test('sequence is R -> L -> Both across one cycle', () => {
  assert.strictEqual(cohesionAt(HOLD_MID).station, 'R');
  assert.strictEqual(cohesionAt(STATION + HOLD_MID).station, 'L');
  assert.strictEqual(cohesionAt(2 * STATION + HOLD_MID).station, 'Both');
  const both = cohesionAt(2 * STATION + HOLD_MID);
  assert.ok(both.cR > 0.99 && both.cL > 0.99);
});

test('gap returns zero cohesion (hand fully dissolved)', () => {
  const s = cohesionAt(GAP_MID);
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
  const a = cohesionAt(HOLD_MID, { pace: 1 });
  const b = cohesionAt(2 * HOLD_MID, { pace: 2 });
  assert.strictEqual(a.station, b.station);
  assert.ok(Math.abs(a.cR - b.cR) < 1e-9);
});

// --- build-progress signal (g) + arbitrary sequence ---

test('cohesionAt exposes c (build progress), phase, idx, next', () => {
  const s = cohesionAt(HOLD_MID); // R hold midpoint (default seq)
  assert.strictEqual(s.idx, 0);
  assert.strictEqual(s.station, 'R');
  assert.strictEqual(s.next, 'L');
  assert.strictEqual(s.phase, 'hold');
  assert.strictEqual(s.c, 1, 'c is the raw build progress, =1 at hold');
  assert.ok(Math.abs(s.c - s.cR) < 1e-9, 'c equals cR on an R station');
});

test('default exports unchanged: STATION_SEQ length 3, CYCLE = STATION*3', () => {
  assert.strictEqual(STATION_SEQ.length, 3);
  assert.ok(Math.abs(CYCLE - STATION * 3) < 1e-9);
});

test('cycleOf scales with the sequence length', () => {
  assert.ok(Math.abs(cycleOf(['R', 'L', 'R', 'L', 'Both']) - STATION * 5) < 1e-9);
  assert.ok(Math.abs(cycleOf(['R', 'Both']) - STATION * 2) < 1e-9);
});

test('arbitrary seq R,L,R,L,Both maps each station by index', () => {
  const seq = ['R', 'L', 'R', 'L', 'Both'];
  assert.strictEqual(cohesionAt(0 * STATION + HOLD_MID, { seq }).station, 'R');
  assert.strictEqual(cohesionAt(1 * STATION + HOLD_MID, { seq }).station, 'L');
  assert.strictEqual(cohesionAt(2 * STATION + HOLD_MID, { seq }).station, 'R');
  assert.strictEqual(cohesionAt(3 * STATION + HOLD_MID, { seq }).station, 'L');
  const both = cohesionAt(4 * STATION + HOLD_MID, { seq });
  assert.strictEqual(both.station, 'Both');
  assert.strictEqual(both.idx, 4);
  assert.ok(both.cR > 0.99 && both.cL > 0.99);
});

test('arbitrary seq: next wraps at end and loops deterministically over cycleOf', () => {
  const seq = ['R', 'L', 'R', 'L', 'Both'];
  const cyc = cycleOf(seq);
  assert.strictEqual(cohesionAt(1 * STATION + HOLD_MID, { seq }).next, 'R'); // seq[2]
  assert.strictEqual(cohesionAt(4 * STATION + HOLD_MID, { seq }).next, 'R'); // wraps to seq[0]
  assert.deepStrictEqual(cohesionAt(5.0, { seq }), cohesionAt(5.0 + cyc, { seq }));
});

test('arbitrary seq stays seamless: cohesion ~0 at every station boundary', () => {
  const seq = ['R', 'L', 'R', 'L', 'Both'];
  for (let k = 0; k < seq.length; k++) {
    const b = k * STATION;
    const before = cohesionAt(b - 0.001, { seq }), after = cohesionAt(b + 0.001, { seq });
    assert.ok(Math.abs(before.cR) < 1e-3 && Math.abs(before.cL) < 1e-3, 'cohesion 0 just before boundary');
    assert.ok(Math.abs(after.cR) < 1e-3 && Math.abs(after.cL) < 1e-3, 'cohesion 0 just after boundary');
  }
});
