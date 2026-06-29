import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PurposeMaker } from '../../src/scenes/dots/PurposeMaker.js';

// Minimal mock 2D context: records nothing, just satisfies the calls draw() makes.
function mockCtx() {
  return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 800, height: 800 } : () => {}) });
}
const audio = { level: 0.3, bass: 0.2, treble: 0.1, beat: false, beatHold: 0 };
const clock = { time: 0, beats: 0, beatPhase: 0, quality: 1 };

test('constructs with id, params, and four station modes', () => {
  const s = new PurposeMaker();
  assert.strictEqual(s.id, 'purposeMaker');
  assert.deepStrictEqual(s.modes.map((m) => m.name), ['Cycle', 'Right', 'Left', 'Both']);
  for (const key of ['count', 'recruit', 'flow', 'scale', 'cohesion', 'thread', 'react', 'pace'])
    assert.ok(s.p(key) !== undefined, `param ${key} defined`);
});

test('update advances particles without producing NaN over many frames', () => {
  const s = new PurposeMaker();
  s.init(mockCtx(), 800, 800);
  s.palette = { fg: [240, 240, 240], bg: [0, 0, 0] };
  for (let f = 0; f < 120; f++) { clock.time = f / 60; s.update(1 / 60, audio, s.palette, clock); }
  let checked = 0;
  for (let i = 0; i < s.n; i += 200) { assert.ok(Number.isFinite(s.X[i]) && Number.isFinite(s.Y[i])); checked++; }
  assert.ok(checked > 0);
});

test('draw runs against a mock context without throwing', () => {
  const s = new PurposeMaker();
  s.init(mockCtx(), 800, 800);
  s.palette = { fg: [240, 240, 240], bg: [0, 0, 0] };
  clock.time = 3.8; s.update(1 / 60, audio, s.palette, clock);
  assert.doesNotThrow(() => s.draw(mockCtx(), 1));
});

// registry.js statically imports CityScene, which transitively `import`s 'three'
// (resolved in-browser by index.html's importmap, but unresolvable under `node --test`).
// Per the repo convention (cf. tests/cityproto/cityCore.test.mjs), assert on the source
// text instead of importing the module, so the check is honest on a fresh clone.
test('PurposeMaker is imported and registered in registry.js', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/scenes/registry.js', import.meta.url)), 'utf8');
  assert.match(src, /import\s*\{\s*PurposeMaker\s*\}\s*from\s*['"]\.\/dots\/PurposeMaker\.js['"]/);
  assert.match(src, /new\s+PurposeMaker\(\)/);
});
