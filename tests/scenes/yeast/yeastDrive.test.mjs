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
