import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PurposeMaker } from '../../src/scenes/dots/PurposeMaker.js';
import { DURATIONS } from '../../src/scenes/dots/purposeMakerChoreo.js';

// Minimal mock 2D context: records nothing, just satisfies the calls draw() makes.
function mockCtx() {
  return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 800, height: 800 } : () => {}) });
}
const audio = { level: 0.3, bass: 0.2, treble: 0.1, beat: false, beatHold: 0 };
const clock = { time: 0, beats: 0, beatPhase: 0, quality: 1 };
// Phase time points on the slow 19s station (gather 10 / hold 3 / disperse 5 / gap 1).
const GATHER_MID = 5;                                          // g~0.5, mid gather
const SHEET_T = 6;                                             // g~0.6, band/sheet phase
const HOLD_MID = DURATIONS.gather + DURATIONS.hold / 2;        // 11.5
const GAP_MID = DURATIONS.gather + DURATIONS.hold + DURATIONS.disperse + DURATIONS.gap / 2; // 18.5
const CYCLE5 = DURATIONS.gather + DURATIONS.hold + DURATIONS.disperse + DURATIONS.gap;      // one station (×5 = full)

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
  // Step at 1/40 to keep the suite quick over the long 19s station (convergence is dt-based).
  for (let t = 0; t <= T + 1e-9; t += 1 / 40) { clock.time = t; s.update(1 / 40, aud || audio, s.palette, clock); }
}

test('seq modeGroup exists and defaults to R,L,R,L,Both (2 alternations then both hands)', () => {
  const s = new PurposeMaker();
  const grp = s.modeGroups.find((g) => g.key === 'seq');
  assert.ok(grp, 'seq modeGroup defined');
  assert.strictEqual(grp.options[grp.index], 'R L R L Both');
});

test('recruited grains converge onto the R hand at hold, then dissolve at the gap', () => {
  const s = freshScene(9000);
  driveTo(s, HOLD_MID);                         // station 0 = R, hold midpoint (g=1)
  const hold = meanTargetDist(s);
  assert.ok(hold < 0.10, `grains sit on the hand at hold (mean dist ${hold.toFixed(3)})`);
  driveTo(s, GAP_MID);                        // same station, gap (g=0): grains rejoin the field
  const gap = meanTargetDist(s);
  assert.ok(gap > 0.2 && gap > hold * 2.5, `gap far more dispersed than hold (${gap.toFixed(3)} vs ${hold.toFixed(3)})`);
});

test('directional convergence front: the wrist (entry edge) leads the fingertips', () => {
  // Hand A enters from +x; its wrist sits at high u (near the entry edge), fingertips at low u.
  // The front sweeps edge->locus, so mid-gather the wrist side has higher convergence progress
  // (cv) than the tips. Measure cv directly (target POSITION confounds a distance metric, since
  // the wrist targets sit far from the ambient cloud regardless of the front).
  const s = freshScene(11000);
  driveTo(s, GATHER_MID);                         // gather mid-sweep (g~0.5): wrist leading, tips not yet
  const recruit = s.p('recruit');
  const meanCv = (uLo, uHi) => {
    let sum = 0, k = 0;
    for (let i = 0; i < s.n; i++) {
      if (s._h(i * 7 + 99) >= recruit) continue;
      const t = targetOf(s, i);
      if (t.u < uLo || t.u >= uHi) continue;
      sum += s.cv[i]; k++;
    }
    return k ? sum / k : 0;
  };
  const wristCv = meanCv(0.6, 1.01), tipsCv = meanCv(0.0, 0.4);
  assert.ok(wristCv > tipsCv + 0.15, `wrist leads the fingertips (cv ${wristCv.toFixed(2)} > tips ${tipsCv.toFixed(2)})`);
});

test('3D sheets: recruited grains layer into depth bands mid-build, then flatten at the hand plane', () => {
  const s = freshScene(12000);
  const recruit = s.p('recruit');
  // group recruited grains by their sheet-band hash (mirrors _h(i*5+3) in PurposeMaker.js) and
  // take the mean Z per band. With z-sheets the outer bands separate in depth; without, Z is
  // independent of the band hash so the means coincide.
  const bandMeans = () => {
    const b = [[], [], [], []];
    for (let i = 0; i < s.n; i++) if (s._h(i * 7 + 99) < recruit) { const k = Math.min(3, (s._h(i * 5 + 3) * 4) | 0); b[k].push(s.Z[i]); }
    return b.map((a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0));
  };
  driveTo(s, SHEET_T);                         // band phase (g~0.63, sheet weight high)
  const mB = bandMeans();
  assert.ok(mB[3] - mB[0] > 0.08, `depth bands separate in z (${mB[3].toFixed(3)} vs ${mB[0].toFixed(3)})`);
  driveTo(s, HOLD_MID);                         // hold: a flat, crisp hand
  const mH = bandMeans();
  assert.ok(Math.abs(mH[3] - mH[0]) < 0.05, `bands collapse to the hand plane at hold (${(mH[3] - mH[0]).toFixed(3)})`);
});

test('dynamic tilt: the field tilts for depth during the band phase and is flat at the hold', () => {
  const s = freshScene(6000);
  driveTo(s, SHEET_T);                         // band phase
  const tiltBand = s._tilt;
  driveTo(s, HOLD_MID);                         // hold
  const tiltHold = s._tilt;
  assert.ok(typeof tiltBand === 'number' && typeof tiltHold === 'number', '_tilt is exposed');
  assert.ok(tiltBand > tiltHold + 0.05, `tilt larger during bands (${tiltBand.toFixed(3)}) than at hold (${tiltHold.toFixed(3)})`);
});

test('ambient density thins the calm background field (the converging mass stays the star)', () => {
  const s = freshScene(12000);
  driveTo(s, GAP_MID);                        // a gap: the hand is gone, background is just ambient
  const recruit = s.p('recruit');
  const drawnAmbientFrac = () => {
    let drawn = 0, amb = 0;
    for (let i = 0; i < s.n; i++) if (s._h(i * 7 + 99) >= recruit) { amb++; if (s.sval[i]) drawn++; }
    return drawn / amb;
  };
  s.params.ambient.value = 1.0; s.draw(mockCtx(), 1);
  const full = drawnAmbientFrac();
  s.params.ambient.value = 0.30; s.draw(mockCtx(), 1);
  const sparse = drawnAmbientFrac();
  assert.ok(full > 0.9, `all ambient grains drawn at density 1.0 (${full.toFixed(2)})`);
  assert.ok(sparse < 0.45, `ambient field thinned to calm at density 0.30 (${sparse.toFixed(2)})`);
});

test('mist flow modes: Radial emanates outward from centre (with a spread slider)', () => {
  const s = freshScene(10000);
  const grp = s.modeGroups.find((g) => g.key === 'flow');
  assert.ok(grp && grp.options.length === 3, 'flow modeGroup with 3 options (Directional/Radial/Wander)');
  assert.ok(s.p('spread') !== undefined, 'spread (range) param defined');
  s.setModeGroup('flow', grp.options.indexOf('Radial'));
  driveTo(s, 2.0);
  const rec = s.p('recruit');
  let outward = 0, k = 0;
  for (let i = 0; i < s.n; i++) {
    if (s._h(i * 7 + 99) < rec) continue; // ambient only
    const r0 = Math.hypot(s.PX[i], s.PY[i]), r1 = Math.hypot(s.X[i], s.Y[i]);
    if (Math.abs(r1 - r0) < 0.2) { if (r1 > r0) outward++; k++; } // skip reseed jumps
  }
  assert.ok(outward / k > 0.62, `most mist grains drift outward in Radial mode (${(outward / k).toFixed(2)})`);
});

test('the 綿毛 (mist/ambient) has its own sliders, separate from the hand', () => {
  const s = new PurposeMaker();
  for (const k of ['ambient', 'ambFlow', 'scale', 'ambReact']) assert.ok(s.p(k) !== undefined, `mist param ${k} defined`);
  for (const k of ['recruit', 'cohesion', 'flow', 'react']) assert.ok(s.p(k) !== undefined, `hand param ${k} defined`);
});

test('mist audio (ambReact) and hand audio (react) are independent knobs', () => {
  const kick = { level: 0.6, bass: 0.9, treble: 0.3, beat: true, beatHold: 1 };
  const meanCvAll = (s) => {
    const rec = s.p('recruit'); let sum = 0, k = 0;
    for (let i = 0; i < s.n; i++) if (s._h(i * 7 + 99) < rec) { sum += s.cv[i]; k++; }
    return k ? sum / k : 0;
  };
  // hand convergence must track the HAND audio (react), not the mist audio (ambReact)
  const a = freshScene(8000); a.params.react.value = 0; a.params.ambReact.value = 6; driveTo(a, GATHER_MID, kick);
  const b = freshScene(8000); b.params.react.value = 6; b.params.ambReact.value = 0; driveTo(b, GATHER_MID, kick);
  assert.ok(meanCvAll(b) > meanCvAll(a) + 1e-6, 'a kick on the HAND audio advances convergence; the mist audio does not');
});

test('full RLRLBoth cycle (incl. Both + disperse, with a kick) stays finite — no NaN', () => {
  const s = freshScene(6000);
  const kick = { level: 0.6, bass: 0.8, treble: 0.4, beat: true, beatHold: 1 };
  for (let f = 0; f < 60 * (CYCLE5 * 5 + 1); f += 3) { clock.time = f / 60; s.update(3 / 60, kick, s.palette, clock); }
  let ok = 0;
  for (let i = 0; i < s.n; i += 100) {
    assert.ok(Number.isFinite(s.X[i]) && Number.isFinite(s.Y[i]) && Number.isFinite(s.Z[i]));
    ok++;
  }
  assert.ok(ok > 0);
});
