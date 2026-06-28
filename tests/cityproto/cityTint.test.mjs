import { test } from 'node:test';
import assert from 'node:assert';
import { paletteToCityTint } from '../../src/cityproto/cityTint.js';

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('MONO(白fg) → (1,1,1) 恒等（mono保持）', () => {
  const t = paletteToCityTint({ fg: [255, 255, 255] }, 1);
  assert.ok(near(t.r, 1) && near(t.g, 1) && near(t.b, 1));
});

test('グレーfg → (1,1,1)（無彩色は無着色）', () => {
  const t = paletteToCityTint({ fg: [128, 128, 128] }, 0.8);
  assert.ok(near(t.r, 1) && near(t.g, 1) && near(t.b, 1));
});

test('AMBER(暖色fg) → r>b、luma≈1（明度保存・色相のみ）', () => {
  const t = paletteToCityTint({ fg: [255, 176, 0] }, 0.5);
  assert.ok(t.r > t.b, `warm: r=${t.r} b=${t.b}`);
  assert.ok(near(luma(t.r, t.g, t.b), 1, 1e-3), `luma≈1 got ${luma(t.r, t.g, t.b)}`);
});

test('strength クランプ [0,1]', () => {
  assert.strictEqual(paletteToCityTint({ fg: [255, 0, 0] }, -1).strength, 0);
  assert.strictEqual(paletteToCityTint({ fg: [255, 0, 0] }, 2).strength, 1);
});

test('palette欠如 → 恒等(1,1,1) strength0安全', () => {
  const t = paletteToCityTint(null, 0.5);
  assert.ok(near(t.r, 1) && near(t.g, 1) && near(t.b, 1));
});
