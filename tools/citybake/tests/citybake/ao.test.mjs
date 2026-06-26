import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { bakeAO } from '../../bake/ao.mjs';
import { buildScene } from './aoScene.mjs';

const golden = JSON.parse(readFileSync(new URL('./fixtures/ao-golden.json', import.meta.url)));
const GOLDEN_OPTS = { rays: 8, radius: 1.5, seed: 1 };

test('open ground is bright, wall-hugging base is darker, output is grey', () => {
  const { soup, OPEN, BASE } = buildScene();
  const col = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1 });
  assert.strictEqual(col.length, soup.positions.length);
  const grey = (i) => col[i * 3];
  assert.ok(grey(OPEN) > grey(BASE) + 0.1, `open ${grey(OPEN).toFixed(3)} should exceed occluded ${grey(BASE).toFixed(3)} by >0.1`);
  for (let i = 0; i < col.length; i += 3) {
    assert.ok(col[i] === col[i + 1] && col[i + 1] === col[i + 2], 'must be grey');
    assert.ok(col[i] >= 0 && col[i] <= 1, 'in [0,1]');
  }
});

test('AO bake is deterministic (no Math.random)', () => {
  const { soup } = buildScene();
  const a = bakeAO(soup, { rays: 16, radius: 1.0, seed: 7 });
  const b = bakeAO(soup, { rays: 16, radius: 1.0, seed: 7 });
  assert.deepStrictEqual(Array.from(a), Array.from(b));
});

test('frozen golden: current bakeAO matches committed snapshot', () => {
  const col = bakeAO(buildScene().soup, GOLDEN_OPTS);
  assert.deepStrictEqual(Array.from(col), golden);
});

test('contact term darkens wall-hugging base but not the open corner', () => {
  const { soup, OPEN, BASE } = buildScene();
  const off = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1, contactStrength: 0 });
  const on = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1, contactStrength: 0.6 });
  const g = (c, i) => c[i * 3];
  assert.ok(g(on, BASE) < g(off, BASE) - 0.02, `base should darken: ${g(off, BASE).toFixed(3)}→${g(on, BASE).toFixed(3)}`);
  assert.ok(Math.abs(g(on, OPEN) - g(off, OPEN)) < 1e-6, 'open corner (no near occluder) unchanged');
  for (let i = 0; i < on.length; i += 3) {
    assert.ok(on[i] === on[i + 1] && on[i + 1] === on[i + 2], 'grey');
    assert.ok(on[i] >= 0 && on[i] <= 1, '[0,1]');
  }
});

test('contact strength is monotonic (stronger → darker base)', () => {
  const { soup, BASE } = buildScene();
  const a = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1, contactStrength: 0.3 });
  const b = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1, contactStrength: 0.6 });
  assert.ok(b[BASE * 3] < a[BASE * 3], 'higher contactStrength darkens base further');
});

test('contactStrength=0 is byte-identical to frozen golden (safety valve)', () => {
  const col = bakeAO(buildScene().soup, { ...GOLDEN_OPTS, contactStrength: 0 });
  assert.deepStrictEqual(Array.from(col), golden);
});

test('all-zero contactMask is byte-identical to golden (type gate inert)', () => {
  const { soup } = buildScene();
  const mask = new Float32Array(soup.positions.length / 3); // all 0
  const col = bakeAO(soup, { ...GOLDEN_OPTS, contactStrength: 0.6, contactMask: mask });
  assert.deepStrictEqual(Array.from(col), golden);
});

test('contactRadius is clamped to radius (no throw, valid grey)', () => {
  const { soup } = buildScene();
  const col = bakeAO(soup, { rays: 16, radius: 1.5, seed: 1, contactStrength: 0.5, contactRadius: 10 });
  for (let i = 0; i < col.length; i += 3) assert.ok(col[i] >= 0 && col[i] <= 1, '[0,1]');
});

test('contact bake stays deterministic with contactStrength>0', () => {
  const { soup } = buildScene();
  const o = { rays: 16, radius: 1.0, seed: 7, contactStrength: 0.5 };
  assert.deepStrictEqual(Array.from(bakeAO(soup, o)), Array.from(bakeAO(soup, o)));
});
