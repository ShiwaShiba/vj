import { test } from 'node:test';
import assert from 'node:assert';
import { applyCityColorGroup, CITY_VARIANTS } from '../../src/cityproto/cityColorControls.js';

function fakes() {
  const calls = [];
  const adapter = {
    modeConfig: {},
    setColorMode: (m) => calls.push(['setColorMode', m]),
  };
  const core = {
    setChromaVariant: (n) => calls.push(['setChromaVariant', n]),
    setStrobe: (b) => calls.push(['setStrobe', b]),
  };
  return { calls, adapter, core, ctx: { core, adapter } };
}

test('cityColor 季節色(idx1) → manual + chromaMix=1', () => {
  const f = fakes();
  assert.strictEqual(applyCityColorGroup('cityColor', 1, f.ctx), true);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'manual']]);
  assert.strictEqual(f.adapter.modeConfig.manualChromaMix, 1);
});

test('cityColor モノ(idx0) → burst', () => {
  const f = fakes();
  applyCityColorGroup('cityColor', 0, f.ctx);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'burst']]);
});

test('citySeason idx2(秋) → manual + manualSeason=2 + chromaMix=1', () => {
  const f = fakes();
  applyCityColorGroup('citySeason', 2, f.ctx);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'manual']]);
  assert.strictEqual(f.adapter.modeConfig.manualSeason, 2);
  assert.strictEqual(f.adapter.modeConfig.manualChromaMix, 1);
});

test('cityVariant idx1 → setChromaVariant(muted)', () => {
  const f = fakes();
  applyCityColorGroup('cityVariant', 1, f.ctx);
  assert.deepStrictEqual(f.calls, [['setChromaVariant', CITY_VARIANTS[1]]]);
  assert.strictEqual(CITY_VARIANTS[1], 'muted');
});

test('cityStrobe ON/OFF → setStrobe(true/false)', () => {
  const f1 = fakes(); applyCityColorGroup('cityStrobe', 1, f1.ctx);
  assert.deepStrictEqual(f1.calls, [['setStrobe', true]]);
  const f0 = fakes(); applyCityColorGroup('cityStrobe', 0, f0.ctx);
  assert.deepStrictEqual(f0.calls, [['setStrobe', false]]);
});

test('未知キー → false・呼び出し無し', () => {
  const f = fakes();
  assert.strictEqual(applyCityColorGroup('switchBars', 1, f.ctx), false);
  assert.deepStrictEqual(f.calls, []);
});

test('core/adapter 欠如 → false・throw無し', () => {
  assert.strictEqual(applyCityColorGroup('cityColor', 1, { core: null, adapter: null }), false);
});
