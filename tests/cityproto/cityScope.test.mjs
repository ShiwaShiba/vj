// tests/cityproto/cityScope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScopeGeom } from '../../src/cityproto/cityScope.js';

// 3 建物: vStart/vCount/revealKey、worldZ は index で与える合成データ
const PB = [
  { revealKey: 0, vStart: 0, vCount: 2 },   // 駅 (radius 0), z 小
  { revealKey: 5, vStart: 2, vCount: 2 },   // 中間 (radius .5), z 中
  { revealKey: 10, vStart: 4, vCount: 2 },  // 外周 (radius 1), z 大
];
const Z = [0, 0, 10, 10, 20, 20];           // 頂点 i の world Z
const getWorldZ = (i) => Z[i];

test('radius normalized by max revealKey', () => {
  const { radius } = buildScopeGeom(PB, getWorldZ);
  assert.equal(radius[0], 0);
  assert.equal(radius[1], 0.5);
  assert.equal(radius[2], 1);
});

test('zc normalized 0..1 by world-Z extent', () => {
  const { zc } = buildScopeGeom(PB, getWorldZ);
  assert.equal(zc[0], 0);
  assert.equal(zc[1], 0.5);
  assert.equal(zc[2], 1);
});

test('deterministic', () => {
  const a = buildScopeGeom(PB, getWorldZ), b = buildScopeGeom(PB, getWorldZ);
  assert.deepEqual([...a.radius], [...b.radius]);
  assert.deepEqual([...a.zc], [...b.zc]);
});
