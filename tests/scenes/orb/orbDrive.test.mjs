// tests/scenes/orb/orbDrive.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import {
  ORB, hash01, buildOrbGeometry, updateBurst, burstFrame, sweepFrame, bandUniforms,
} from '../../../src/scenes/orb/orbDrive.js';

const len = (a) => Math.hypot(a[0], a[1], a[2]);

test('hash01 is in [0,1), deterministic, and varies per input', () => {
  for (let i = 0; i < 500; i++) {
    const v = hash01(i, i * 2, i * 3, 7);
    assert.ok(v >= 0 && v < 1, `range at ${i}`);
  }
  assert.strictEqual(hash01(3, 4, 5, 1), hash01(3, 4, 5, 1));
  assert.notStrictEqual(hash01(3, 4, 5, 1), hash01(3, 4, 5, 2)); // c changes output
  assert.notStrictEqual(hash01(3, 4, 5, 1), hash01(4, 4, 5, 1)); // x changes output
});

test('buildOrbGeometry: deterministic, right lengths, unit directions, seeds in [0,1)', () => {
  const n = 2000;
  const a = buildOrbGeometry(n);
  const b = buildOrbGeometry(n);
  assert.strictEqual(a.positions.length, 3 * n);
  assert.strictEqual(a.seeds.length, n);
  assert.deepStrictEqual(a.positions, b.positions); // deterministic
  assert.deepStrictEqual(a.seeds, b.seeds);
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(a.positions[i * 3], a.positions[i * 3 + 1], a.positions[i * 3 + 2]);
    assert.ok(Math.abs(d - 1) < 1e-5, `|dir|≈1 at ${i} got ${d}`);
    assert.ok(a.seeds[i] >= 0 && a.seeds[i] < 1, `seed range at ${i}`);
  }
});

test('updateBurst: fires on bass rising-edge, respects refractory, amp in [0.45,1]', () => {
  const s = { t0: -99, n: 0, amp: 0, prevBass: 0 };
  updateBurst(s, 0.2, 0.0);              // below threshold
  assert.strictEqual(s.n, 0);
  updateBurst(s, 0.9, 0.5);              // rising edge past HI → fire
  assert.strictEqual(s.n, 1);
  assert.strictEqual(s.t0, 0.5);
  assert.ok(s.amp >= 0.45 && s.amp <= 1, `amp ${s.amp}`);
  updateBurst(s, 0.2, 0.55);             // drop below (prevBass resets)
  updateBurst(s, 0.9, 0.6);              // re-rise within MIN_GAP (0.22) of t0=0.5 → NO fire
  assert.strictEqual(s.n, 1, 'refractory blocks re-fire');
  updateBurst(s, 0.2, 0.9);
  updateBurst(s, 0.9, 1.0);              // re-rise after refractory → fire
  assert.strictEqual(s.n, 2);
  assert.strictEqual(s.prevBass, 0.9);   // tracks last bass
});

test('burstFrame: active only within BURST_LIFE, env decays monotonically, axis unit, axis varies by n', () => {
  const s1 = { t0: 0, n: 1, amp: 1, prevBass: 0 };
  assert.strictEqual(burstFrame(s1, ORB.BURST_LIFE + 0.01).active, false); // past life
  let prevEnv = Infinity;
  for (let age = 0; age < ORB.BURST_LIFE; age += 0.05) {
    const f = burstFrame(s1, age);
    assert.ok(f.active, `active at age ${age}`);
    assert.ok(Math.abs(len(f.axis) - 1) < 1e-6, 'axis unit');
    assert.ok(f.env <= prevEnv + 1e-9, 'env monotonic non-increasing');
    prevEnv = f.env;
  }
  const s2 = { t0: 0, n: 2, amp: 1, prevBass: 0 };
  const ax1 = burstFrame(s1, 0.1).axis, ax2 = burstFrame(s2, 0.1).axis;
  assert.ok(len([ax1[0] - ax2[0], ax1[1] - ax2[1], ax1[2] - ax2[2]]) > 0.05, 'axis hops per burst');
});

test('sweepFrame: axis is ALWAYS unit (never collapses), k in [5,11], flow monotonic in time', () => {
  let prevFlow = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const t = i * 0.017;
    const f = sweepFrame(t, (i % 5) / 5);
    assert.ok(Math.abs(len(f.axis) - 1) < 1e-5, `axis unit at t=${t} got ${len(f.axis)}`);
    assert.ok(f.k >= 5 - 1e-6 && f.k <= 11 + 1e-6, `k in [5,11] got ${f.k}`);
    assert.ok(f.flow > prevFlow, `flow strictly increases at t=${t}`);
    prevFlow = f.flow;
  }
});

test('bandUniforms: approaches gained targets and stays bounded [0,1]', () => {
  const prev = { bassSwell: 0, travelAmt: 0, treble: 0, exposureLoud: 0 };
  const audio = { bass: 1, mid: 1, treble: 1, level: 1 };
  for (let i = 0; i < 300; i++) bandUniforms(audio, prev, 1);
  for (const k of ['bassSwell', 'travelAmt', 'treble', 'exposureLoud']) {
    assert.ok(prev[k] > 0.95 && prev[k] <= 1, `${k} approached target: ${prev[k]}`);
  }
  const prev2 = { bassSwell: 0.5, travelAmt: 0.5, treble: 0.5, exposureLoud: 0.5 };
  for (let i = 0; i < 300; i++) bandUniforms({ bass: 0, mid: 0, treble: 0, level: 0 }, prev2, 1);
  for (const k of ['bassSwell', 'travelAmt', 'treble', 'exposureLoud']) {
    assert.ok(prev2[k] >= 0 && prev2[k] < 0.05, `${k} decays to 0: ${prev2[k]}`);
  }
});
