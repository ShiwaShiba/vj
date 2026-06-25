import assert from 'node:assert';
import { test } from 'node:test';
import { planEmit } from '../../src/cityproto/particles.js';

// planEmit is PURE — it turns the avenue plant list into falling-particle emission
// columns (no THREE, no terrain). Mirrors trees.js's planLayout / buildTrees split:
// the GPU fall lives in buildParticles' shader, planEmit just stamps per-particle
// aBirth / aSeed / aPhase so the fall is desynced and synced to the染め sweep.
const AVENUE = () => {
  const a = [];
  for (let i = 0; i < 12; i++) a.push({ u: 0.01 * i, v: 0.2 + i * 0.25, aPhase: i / 11, seed: i / 12 });
  return a;
};

test('planEmit returns { emit, life } with a positive life and non-empty emit', () => {
  const { emit, life } = planEmit(AVENUE());
  assert.ok(life > 0, 'life positive');
  assert.ok(emit.length > 0, 'emits particles');
});

test('emit count = ceil(avenue/stride) * perColumn', () => {
  const avenue = AVENUE();
  const { emit } = planEmit(avenue, { perColumn: 5, stride: 3 });
  const cols = Math.ceil(avenue.length / 3);
  assert.strictEqual(emit.length, cols * 5);
});

test('every aBirth in [0, life) and every aLife > 0', () => {
  const { emit, life } = planEmit(AVENUE());
  for (const e of emit) {
    assert.ok(e.aBirth >= 0 && e.aBirth < life, `aBirth in [0,${life})`);
    assert.ok(e.aLife > 0, 'aLife positive');
    assert.ok(e.aSeed >= 0 && e.aSeed < 1, 'aSeed in [0,1)');
  }
});

test('aPhase is carried from the source avenue (sweep stays synced)', () => {
  const avenue = AVENUE();
  const src = new Set(avenue.map((a) => a.aPhase));
  const { emit } = planEmit(avenue);
  for (const e of emit) assert.ok(src.has(e.aPhase), 'emit aPhase came from an avenue point');
});

test('deterministic: two calls give a byte-identical emit plan', () => {
  assert.deepStrictEqual(planEmit(AVENUE()), planEmit(AVENUE()));
});

test('empty avenue → emit:[] without throwing', () => {
  const { emit } = planEmit([]);
  assert.deepStrictEqual(emit, []);
});
