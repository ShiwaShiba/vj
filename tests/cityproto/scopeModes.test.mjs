// tests/cityproto/scopeModes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash01, clamp, lerp, smooth01, coordOf, MODES, applyA, sampleHistory } from '../../src/cityproto/scopeModes.js';
import { defaultScopeConfig } from '../../src/cityproto/cityScope.js';

const GEOM = { radius: new Float32Array([0, 0.5, 1]), zc: new Float32Array([1, 0.5, 0]) };

test('hash01 deterministic & in [0,1)', () => {
  for (let i = 0; i < 50; i++) {
    const a = hash01(i), b = hash01(i);
    assert.equal(a, b);
    assert.ok(a >= 0 && a < 1, `hash01(${i})=${a}`);
  }
  assert.notEqual(hash01(1), hash01(2));
});

test('clamp/lerp/smooth01 basics', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(smooth01(0), 0);
  assert.equal(smooth01(1), 1);
  assert.ok(Math.abs(smooth01(0.5) - 0.5) < 1e-9);
});

test('coordOf picks radius/zc/blend by spatial', () => {
  assert.equal(coordOf(GEOM, 1, 'rings'), 0.5);
  assert.equal(coordOf(GEOM, 0, 'avenue'), 1);
  assert.equal(coordOf(GEOM, 2, 'both'), 0.5); // (1+0)/2
});

test('breathing stays within [breathFloor,1] and dips with level', () => {
  const cfg = defaultScopeConfig();
  const u = { barPhase2: 0.5, level: 1 };          // cos(π)=-1 → max dip
  const s = MODES.breathing(0.0, u, cfg);
  assert.ok(s >= cfg.breathFloor - 1e-6 && s <= 1);
  assert.ok(s < 1, 'dips below full at the trough');
});

test('scanbar: on the line → 1, far → scanFloor', () => {
  const cfg = defaultScopeConfig(); cfg.barWidth = 0.1; cfg.scanFloor = 0;
  const u = { linePos: 0.5 };
  assert.ok(MODES.scanbar(0.5, u, cfg) > 0.95, 'on line');
  assert.ok(MODES.scanbar(0.0, u, cfg) < 0.05, 'far off line collapses');
});

test('bloom: building inside the front is up, outside is envFloor', () => {
  const cfg = defaultScopeConfig();
  const u = { front: 0.5, envFloor: 0.2 };
  assert.ok(MODES.bloom(0.1, u, cfg) > 0.9, 'near (radius<front) bloomed');
  assert.ok(Math.abs(MODES.bloom(0.95, u, cfg) - 0.2) < 1e-6, 'far holds envFloor');
});

test('sampleHistory reads back from head with wrap + lerp', () => {
  const h = new Float32Array([0, 1, 2, 3]); // head=3 → most recent is 3
  assert.equal(sampleHistory(h, 3, 0), 3);
  assert.equal(sampleHistory(h, 3, 1), 2);
  assert.equal(sampleHistory(h, 3, 0.5), 2.5);
  assert.equal(sampleHistory(h, 0, 1), 3, 'wraps past index 0');
});

test('radar: near rings show recent audio, far rings show older (traveling wave)', () => {
  const cfg = defaultScopeConfig(); cfg.sweepSec = 1.0; cfg.histDt = 0.1; cfg.radarFloor = 0;
  // hist: most-recent loud, older silent → near (c~0) tall, far (c~1) short
  const hist = new Float32Array(16); const head = 5; hist[head] = 1; // newest loud only
  const u = { hist, histHead: head, histDt: 0.1, sweepSec: 1.0 };
  assert.ok(MODES.radar(0.0, u, cfg) > MODES.radar(0.9, u, cfg), 'wavefront nearer the centre');
});

test('applyA spikes/clears a hash-selected building deterministically', () => {
  const cfg = defaultScopeConfig(); cfg.aRatio = 1.0; // すべて被選択
  const u = { beatIndex: 7 };
  const base = 0.4;
  const a1 = applyA(base, 3, u, cfg);
  const a2 = applyA(base, 3, u, cfg);
  assert.equal(a1, a2, 'deterministic');
  assert.notEqual(a1, base, 'selected building is modified');
  // aRatio=0 → 無改変
  const cfg0 = defaultScopeConfig(); cfg0.aRatio = 0;
  assert.equal(applyA(base, 3, u, cfg0), base);
});
