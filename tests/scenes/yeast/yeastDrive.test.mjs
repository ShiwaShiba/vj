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
  for (let c = 0; c < s.count; c++) if (hash01(c, 9, 5, 23) < YEAST.BUD_PROB) { k = c; break; }
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
