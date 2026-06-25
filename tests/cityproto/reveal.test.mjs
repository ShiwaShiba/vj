import assert from 'node:assert';
import { test } from 'node:test';
import { buildRevealAttributes } from '../../src/cityproto/reveal.js';

test('aReveal/aBaseY broadcast per building; aBaseY is the floor (min raw Y)', () => {
  const perBuilding = [
    { vStart: 0, vCount: 3, revealKey: 2.0 },
    { vStart: 3, vCount: 3, revealKey: 5.0 },
  ];
  const YS = [10, 5, 8, 20, 14, 17];                     // raw quantized Y per vertex
  const { aReveal, aBaseY, maxRevealKey } = buildRevealAttributes(perBuilding, (i) => YS[i], 6);
  assert.deepStrictEqual([...aReveal], [2, 2, 2, 5, 5, 5], 'distance key broadcast to each vert');
  assert.deepStrictEqual([...aBaseY], [5, 5, 5, 14, 14, 14], 'floor = min raw Y over the range');
  assert.strictEqual(maxRevealKey, 5.0, 'sweep target = farthest building');
});

test('vertices outside any building range stay 0 (no spurious reveal data)', () => {
  const perBuilding = [{ vStart: 1, vCount: 2, revealKey: 3.0 }];
  const { aReveal, aBaseY } = buildRevealAttributes(perBuilding, (i) => 7, 4);
  assert.deepStrictEqual([...aReveal], [0, 3, 3, 0]);
  assert.deepStrictEqual([...aBaseY], [0, 7, 7, 0]);
});
