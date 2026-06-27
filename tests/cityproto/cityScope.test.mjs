// tests/cityproto/cityScope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScopeGeom, defaultScopeConfig, initScopeState, frameUniforms } from '../../src/cityproto/cityScope.js';

const feat = (o = {}) => ({ level: 0, levelSlow: 0, bass: 0, beat: false, beats: 0, beatPhase: 0, ...o });

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

test('frameUniforms: linePos steps with whole beats', () => {
  const cfg = defaultScopeConfig(); cfg.steps = 4;
  const s = initScopeState();
  const u0 = frameUniforms(feat({ beats: 0, beatPhase: 0.2 }), 0.016, cfg, s);
  const u1 = frameUniforms(feat({ beats: 1, beatPhase: 0.9 }), 0.016, cfg, s);
  assert.equal(u0.linePos, 0 / 4);
  assert.equal(u1.linePos, 1 / 4);
});

test('frameUniforms: drop resets bloom front to 0 then it rises', () => {
  const cfg = defaultScopeConfig();
  const s = initScopeState();                       // front starts settled at 1
  // big level jump over levelSlow → drop fires → front snaps toward 0
  const d = frameUniforms(feat({ level: 0.9, levelSlow: 0.1, bass: 0.5, beats: 4 }), 0.016, cfg, s);
  assert.ok(d.front < 0.2, `front after drop ${d.front}`);
  // refractory: a second immediate drop must NOT re-reset (front keeps rising)
  const r = frameUniforms(feat({ level: 0.9, levelSlow: 0.1, bass: 0.5, beats: 4 }), 0.5, cfg, s);
  assert.ok(r.front > d.front, 'front rises after the reset');
});

test('frameUniforms: deterministic for same inputs', () => {
  const cfg = defaultScopeConfig();
  const a = frameUniforms(feat({ level: 0.4, beats: 2, beatPhase: 0.3 }), 0.016, cfg, initScopeState());
  const b = frameUniforms(feat({ level: 0.4, beats: 2, beatPhase: 0.3 }), 0.016, cfg, initScopeState());
  assert.deepEqual(a, b);
});
