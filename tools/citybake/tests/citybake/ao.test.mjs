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
