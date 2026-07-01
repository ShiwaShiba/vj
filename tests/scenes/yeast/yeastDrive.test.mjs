// tests/scenes/yeast/yeastDrive.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { YEAST, hash01, buildCells } from '../../../src/scenes/yeast/yeastDrive.js';

test('hash01 in [0,1), deterministic, varies per input', () => {
  for (let i = 0; i < 500; i++) {
    const v = hash01(i, i * 2, i * 3, 5);
    assert.ok(v >= 0 && v < 1, `range at ${i}`);
  }
  assert.strictEqual(hash01(3, 4, 5, 1), hash01(3, 4, 5, 1));
  assert.notStrictEqual(hash01(3, 4, 5, 1), hash01(3, 4, 5, 2));
  assert.notStrictEqual(hash01(3, 4, 5, 1), hash01(4, 4, 5, 1));
});

test('buildCells: deterministic, interleaved n=2*count, cells inside FOV, valid ranges', () => {
  const a = buildCells(120, 7);
  const b = buildCells(120, 7);
  assert.strictEqual(a.count, 120);
  assert.strictEqual(a.n, 240);
  assert.strictEqual(a.baseX.length, 240);
  assert.strictEqual(a.px.length, 240);
  assert.deepStrictEqual(a.baseX, b.baseX);      // deterministic
  assert.deepStrictEqual(a.depth, b.depth);
  for (let k = 0; k < a.count; k++) {
    const mi = 2 * k, bi = 2 * k + 1;
    const rr = Math.hypot(a.baseX[mi], a.baseY[mi]);
    assert.ok(rr <= YEAST.FOV, `main cell ${k} inside FOV: ${rr}`);
    assert.ok(a.depth[mi] >= 0 && a.depth[mi] <= 1, `depth in [0,1] at ${k}`);
    assert.ok(a.radius0[mi] > 0, `main radius > 0 at ${k}`);
    assert.strictEqual(a.radius0[bi], 0, `bud lobe starts radius 0 at ${k}`);
    assert.strictEqual(a.kind[mi], 0, `main kind=0 at ${k}`);
    assert.ok(a.kind[bi] === 1 || a.kind[bi] === 2, `bud kind 1|2 at ${k}`);
  }
});

test('buildCells: different seeds give different layouts', () => {
  const a = buildCells(80, 1), b = buildCells(80, 2);
  let diff = 0;
  for (let i = 0; i < a.baseX.length; i++) if (a.baseX[i] !== b.baseX[i]) diff++;
  assert.ok(diff > a.baseX.length * 0.5, `seeds diverge: ${diff}`);
});

import { cellFrame } from '../../../src/scenes/yeast/yeastDrive.js';

test('cellFrame: deterministic for same (state,time,audio); cells stay within FOV+margin', () => {
  const s1 = buildCells(100, 3), s2 = buildCells(100, 3);
  const audio = { bass: 0.6, mid: 0.4, beat: 0, level: 0.5 };
  cellFrame(s1, 12.34, audio); cellFrame(s2, 12.34, audio);
  assert.deepStrictEqual(s1.px, s2.px);
  assert.deepStrictEqual(s1.pr, s2.pr);
  for (let i = 0; i < s1.n; i++) {
    const rr = Math.hypot(s1.px[i], s1.py[i]);
    assert.ok(rr <= YEAST.FOV * 1.12, `slot ${i} within FOV+margin: ${rr}`);
  }
});

test('cellFrame: main-cell radii positive; bud lobe grows 0->1 monotonically over time', () => {
  const s = buildCells(60, 9);
  // find a cell that actually buds (kind of its lobe slot is 1 or 2 AND it is selected to bud)
  let k = -1;
  for (let c = 0; c < s.count; c++) if (hash01(c, 0, 5, 23) < YEAST.BUD_PROB) { k = c; break; }   // MUST match cellFrame's bud gate exactly
  assert.ok(k >= 0, 'found a budding cell');
  const bi = 2 * k + 1;
  let prev = -1;
  for (let t = 0; t <= 8; t += 1) {
    cellFrame(s, t, null);
    assert.ok(s.pr[2 * k] > 0, 'main radius stays positive');
    assert.ok(s.pbud[bi] >= prev - 1e-6, `budAmount monotonic at t=${t}: ${s.pbud[bi]} < ${prev}`);
    assert.ok(s.pbud[bi] >= 0 && s.pbud[bi] <= 1, 'budAmount in [0,1]');
    prev = s.pbud[bi];
  }
  assert.ok(s.pbud[bi] > 0, 'the found cell actually budded (test is non-vacuous, not the else-branch pbud=0)');
});

test('cellFrame: louder bass agitates motion more than quiet', () => {
  const quiet = buildCells(80, 4), loud = buildCells(80, 4);
  const base = buildCells(80, 4);
  cellFrame(base, 0, null);
  const bx = Float32Array.from(base.px), by = Float32Array.from(base.py);
  cellFrame(quiet, 0.5, { bass: 0.0, mid: 0, beat: 0, level: 0 });
  cellFrame(loud, 0.5, { bass: 1.0, mid: 0, beat: 0, level: 1 });
  let dq = 0, dl = 0;
  for (let i = 0; i < base.n; i++) {
    dq += Math.hypot(quiet.px[i] - bx[i], quiet.py[i] - by[i]);
    dl += Math.hypot(loud.px[i] - bx[i], loud.py[i] - by[i]);
  }
  assert.ok(dl > dq, `loud agitates more than quiet: ${dl} vs ${dq}`);
});

import { driftFrame, bandUniforms } from '../../../src/scenes/yeast/yeastDrive.js';

test('driftFrame: deterministic, all fields in [0,1]', () => {
  for (let i = 0; i < 200; i++) {
    const t = i * 0.37;
    const d1 = driftFrame(t, null, 'auto'), d2 = driftFrame(t, null, 'auto');
    for (const key of ['density', 'fusion', 'fill', 'focusPlane', 'rim', 'halo', 'tint']) {
      assert.strictEqual(d1[key], d2[key], `${key} deterministic at t=${t}`);
      assert.ok(d1[key] >= 0 && d1[key] <= 1, `${key} in [0,1] at t=${t}: ${d1[key]}`);
    }
  }
});

test('driftFrame: tint fixed unless auto', () => {
  for (let i = 0; i < 50; i++) {
    const t = i * 1.7;
    assert.strictEqual(driftFrame(t, null, 'mono').tint, 0, 'mono tint = 0');
    assert.strictEqual(driftFrame(t, null, 'slate').tint, 1, 'slate tint = 1');
  }
  // auto tint actually varies over time
  const vals = new Set();
  for (let i = 0; i < 200; i++) vals.add(Math.round(driftFrame(i * 2.3, null, 'auto').tint * 100));
  assert.ok(vals.size > 5, `auto tint varies: ${vals.size} distinct`);
});

test('driftFrame: aperiodic — no short repeat period on density/fusion', () => {
  // For each candidate period, SOME sample differs beyond tolerance => not periodic with that period.
  for (const P of [1, 2, 4, 8, 16]) {
    let maxDiff = 0;
    for (let i = 0; i < 400; i++) {
      const t = i * 0.19;
      const d = Math.abs(driftFrame(t, null, 'auto').density - driftFrame(t + P, null, 'auto').density);
      const f = Math.abs(driftFrame(t, null, 'auto').fusion - driftFrame(t + P, null, 'auto').fusion);
      maxDiff = Math.max(maxDiff, d, f);
    }
    assert.ok(maxDiff > 1e-3, `not periodic with P=${P}: maxDiff=${maxDiff}`);
  }
});

test('bandUniforms: approaches gained targets and decays, bounded [0,1]', () => {
  const prev = { swell: 0, flow: 0, shimmer: 0, loud: 0 };
  const hi = { bass: 1, mid: 1, treble: 1, level: 1 };
  for (let i = 0; i < 300; i++) bandUniforms(hi, prev, 1);
  for (const k of ['swell', 'flow', 'shimmer', 'loud']) assert.ok(prev[k] > 0.95 && prev[k] <= 1, `${k} approached: ${prev[k]}`);
  const p2 = { swell: 0.5, flow: 0.5, shimmer: 0.5, loud: 0.5 };
  for (let i = 0; i < 300; i++) bandUniforms({ bass: 0, mid: 0, treble: 0, level: 0 }, p2, 1);
  for (const k of ['swell', 'flow', 'shimmer', 'loud']) assert.ok(p2[k] >= 0 && p2[k] < 0.05, `${k} decays: ${p2[k]}`);
});
