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
    setStrobeAll: (b) => calls.push(['setStrobeAll', b]),
  };
  return { calls, adapter, core, ctx: { core, adapter } };
}

test('cityColor 季節色(idx1) → manual + chromaMix=1 + autoSeason=false', () => {
  const f = fakes();
  assert.strictEqual(applyCityColorGroup('cityColor', 1, f.ctx), true);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'manual']]);
  assert.strictEqual(f.adapter.modeConfig.manualChromaMix, 1);
  assert.strictEqual(f.adapter.modeConfig.autoSeason, false);
});

test('cityColor 季節オート(idx2) → manual + chromaMix=1 + autoSeason=true', () => {
  const f = fakes();
  applyCityColorGroup('cityColor', 2, f.ctx);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'manual']]);
  assert.strictEqual(f.adapter.modeConfig.manualChromaMix, 1);
  assert.strictEqual(f.adapter.modeConfig.autoSeason, true);
});

test('cityColor モノ(idx0) → burst + autoSeason=false', () => {
  const f = fakes();
  applyCityColorGroup('cityColor', 0, f.ctx);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'burst']]);
  assert.strictEqual(f.adapter.modeConfig.autoSeason, false);
});

test('citySeason idx2(秋) → manual + manualSeason=2 + chromaMix=1 + autoSeason解除', () => {
  const f = fakes();
  f.adapter.modeConfig.autoSeason = true; // 直前がオートでも手動選択で解除される
  applyCityColorGroup('citySeason', 2, f.ctx);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'manual']]);
  assert.strictEqual(f.adapter.modeConfig.manualSeason, 2);
  assert.strictEqual(f.adapter.modeConfig.manualChromaMix, 1);
  assert.strictEqual(f.adapter.modeConfig.autoSeason, false);
});

test('cityVariant idx1 → setChromaVariant(muted)', () => {
  const f = fakes();
  applyCityColorGroup('cityVariant', 1, f.ctx);
  assert.deepStrictEqual(f.calls, [['setChromaVariant', CITY_VARIANTS[1]]]);
  assert.strictEqual(CITY_VARIANTS[1], 'muted');
});

test('cityStrobe ON/OFF → setStrobe + setStrobeAll(全季節常時)', () => {
  const f1 = fakes(); applyCityColorGroup('cityStrobe', 1, f1.ctx);
  assert.deepStrictEqual(f1.calls, [['setStrobe', true], ['setStrobeAll', true]]);
  const f0 = fakes(); applyCityColorGroup('cityStrobe', 0, f0.ctx);
  assert.deepStrictEqual(f0.calls, [['setStrobe', false], ['setStrobeAll', false]]);
});

test('未知キー → false・呼び出し無し', () => {
  const f = fakes();
  assert.strictEqual(applyCityColorGroup('switchBars', 1, f.ctx), false);
  assert.deepStrictEqual(f.calls, []);
});

test('core/adapter 欠如 → false・throw無し', () => {
  assert.strictEqual(applyCityColorGroup('cityColor', 1, { core: null, adapter: null }), false);
});
