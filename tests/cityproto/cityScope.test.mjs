// tests/cityproto/cityScope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScopeGeom, defaultScopeConfig, initScopeState, frameUniforms, computeScope, createCityScope } from '../../src/cityproto/cityScope.js';

const feat = (o = {}) => ({ level: 0, levelSlow: 0, bass: 0, mid: 0, treble: 0, beat: false, beats: 0, beatPhase: 0, ...o });

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

test('frameUniforms: ring buffer fills with energy and exposes hist/bands', () => {
  const cfg = defaultScopeConfig(); cfg.histN = 8; cfg.histDt = 0.05;
  const s = initScopeState();
  // 0.2s at dt=0.05 → 4 pushes of energy(level 1, bass 1) ≈ clamp(0.7+0.6)=1
  let u;
  for (let i = 0; i < 4; i++) u = frameUniforms(feat({ level: 1, bass: 1, mid: 0.4, treble: 0.7 }), 0.05, cfg, s);
  assert.equal(u.hist.length, 8);
  assert.ok(u.hist[u.histHead] > 0.99, 'most-recent slot holds full energy');
  assert.equal(u.histDt, 0.05);
  assert.deepEqual(u.bands.map(x => +x.toFixed(2)), [1, 0.4, 0.7]);
});

test('frameUniforms: exposes clk (advances) and dropT (=lastDropT, set on drop)', () => {
  const cfg = defaultScopeConfig();
  const s = initScopeState();
  const u0 = frameUniforms(feat({ level: 0.1, levelSlow: 0.1 }), 0.1, cfg, s);
  assert.ok(Math.abs(u0.clk - 0.1) < 1e-9, 'clk advances by dt');
  assert.ok(u0.dropT < -1e8, 'no drop yet → dropT stays at initial -1e9');
  // a real drop sets dropT to the current clk
  const u1 = frameUniforms(feat({ level: 0.9, levelSlow: 0.1, bass: 0.5 }), 0.1, cfg, s);
  assert.ok(Math.abs(u1.dropT - u1.clk) < 1e-9, 'dropT snaps to clk on drop');
});

test('frameUniforms: ring buffer push count is time-driven (deterministic)', () => {
  const cfg = defaultScopeConfig(); cfg.histN = 100; cfg.histDt = 0.05;
  const a = initScopeState(), b = initScopeState();
  let ua, ub;
  for (let i = 0; i < 10; i++) { ua = frameUniforms(feat({ level: 0.5, bass: 0.3 }), 0.05, cfg, a); }
  for (let i = 0; i < 10; i++) { ub = frameUniforms(feat({ level: 0.5, bass: 0.3 }), 0.05, cfg, b); }
  assert.equal(ua.histHead, ub.histHead);
  assert.deepEqual([...ua.hist], [...ub.hist]);
});

test('computeScope OFF or mix=0 → all ones (現状一致)', () => {
  const geom = { radius: new Float32Array([0, 0.5, 1]), zc: new Float32Array([0, 0.5, 1]) };
  const out = new Float32Array(3);
  const cfg = defaultScopeConfig(); cfg.enabled = false;
  computeScope(out, geom, { barPhase2: 0.5, level: 1 }, cfg);
  assert.deepEqual([...out], [1, 1, 1]);
  cfg.enabled = true; cfg.mix = 0;
  computeScope(out, geom, { barPhase2: 0.5, level: 1 }, cfg);
  assert.deepEqual([...out], [1, 1, 1]);
});

test('createCityScope writes scope and toggles enable via config', () => {
  const geom = { radius: new Float32Array([0, 1]), zc: new Float32Array([0, 1]) };
  let wrote = null, en = null;
  const sink = { writeScope: (a) => { wrote = [...a]; }, setScopeEnabled: (b) => { en = b; } };
  const cs = createCityScope(geom, sink, { mode: 'breathing' });
  cs.frame({ level: 1, beats: 0, beatPhase: 0.5 }, 0.016);
  assert.equal(wrote.length, 2); assert.equal(en, true);
  cs.setConfig({ enabled: false });
  cs.frame({ level: 1, beats: 0, beatPhase: 0.5 }, 0.016);
  assert.deepEqual(wrote, [1, 1]); assert.equal(en, false);
});
