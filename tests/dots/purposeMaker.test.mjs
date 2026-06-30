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

// --- T4: the hand is the fluid converging into the hand grains ---

// Mirror of the single-hand mapping constants in PurposeMaker.js, so the test can measure how
// tightly recruited particles sit on their own hand-cloud target points.
const SPANX = 1.64, SPANY = 0.92, OFFA = -0.30;
function targetOf(s, i) {
  const A = s.hands.A, idx = i % A.n;
  return { tx: OFFA + SPANX * (A.u[idx] / 32767), ty: (0.5 - A.v[idx] / 32767) * SPANY, u: A.u[idx] / 32767 };
}
// mean distance of recruited (R-hand) particles to their targets, optionally filtered by u side
function meanTargetDist(s, uLo, uHi) {
  const recruit = s.p('recruit');
  let sum = 0, k = 0;
  for (let i = 0; i < s.n; i++) {
    if (s._h(i * 7 + 99) >= recruit) continue; // ambient
    const t = targetOf(s, i);
    if (uLo != null && (t.u < uLo || t.u >= uHi)) continue;
    const dx = s.X[i] - t.tx, dy = s.Y[i] - t.ty;
    sum += Math.sqrt(dx * dx + dy * dy); k++;
  }
  return k ? sum / k : 0;
}
function freshScene(count) {
  const s = new PurposeMaker();
  s.init(mockCtx(), 800, 800);
  s.palette = { fg: [240, 240, 240], bg: [0, 0, 0] };
  if (count) s.params.count.value = count;
  return s;
}
function driveTo(s, T, aud) {
  for (let t = 0; t <= T + 1e-9; t += 1 / 60) { clock.time = t; s.update(1 / 60, aud || audio, s.palette, clock); }
}

test('seq modeGroup exists and defaults to R,L,R,L,Both (2 alternations then both hands)', () => {
  const s = new PurposeMaker();
  const grp = s.modeGroups.find((g) => g.key === 'seq');
  assert.ok(grp, 'seq modeGroup defined');
  assert.strictEqual(grp.options[grp.index], 'R L R L Both');
});

test('recruited grains converge onto the R hand at hold, then dissolve at the gap', () => {
  const s = freshScene(9000);
  driveTo(s, 3.8);                         // station 0 = R, hold midpoint (g=1)
  const hold = meanTargetDist(s);
  assert.ok(hold < 0.10, `grains sit on the hand at hold (mean dist ${hold.toFixed(3)})`);
  driveTo(s, 7.45);                        // same station, gap (g=0): grains rejoin the field
  const gap = meanTargetDist(s);
  assert.ok(gap > 0.2 && gap > hold * 2.5, `gap far more dispersed than hold (${gap.toFixed(3)} vs ${hold.toFixed(3)})`);
});

test('directional convergence front: the wrist (entry edge) resolves before the fingertips', () => {
  // Hand A enters from +x; its wrist sits at high u (near the entry edge), fingertips at low u.
  // The front sweeps edge->locus, so mid-gather the wrist side is converged while the tips are not.
  const s = freshScene(11000);
  driveTo(s, 1.6);                         // mid-gather, g ~ 0.67
  const wrist = meanTargetDist(s, 0.6, 1.01); // near entry edge
  const tips = meanTargetDist(s, 0.0, 0.4);   // far side
  assert.ok(wrist < 0.12, `wrist (entry edge) has resolved (${wrist.toFixed(3)})`);
  assert.ok(tips > wrist * 1.8, `fingertips still arriving (${tips.toFixed(3)} >> ${wrist.toFixed(3)})`);
});

test('full RLRLBoth cycle (incl. Both + disperse, with a kick) stays finite — no NaN', () => {
  const s = freshScene(6000);
  const kick = { level: 0.6, bass: 0.8, treble: 0.4, beat: true, beatHold: 1 };
  for (let f = 0; f < 60 * 39; f += 3) { clock.time = f / 60; s.update(3 / 60, kick, s.palette, clock); }
  let ok = 0;
  for (let i = 0; i < s.n; i += 100) {
    assert.ok(Number.isFinite(s.X[i]) && Number.isFinite(s.Y[i]) && Number.isFinite(s.Z[i]));
    ok++;
  }
  assert.ok(ok > 0);
});
