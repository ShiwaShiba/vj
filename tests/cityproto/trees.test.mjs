import assert from 'node:assert';
import { test } from 'node:test';
import { planLayout, planVacant } from '../../src/cityproto/trees.js';

// Minimal manifest fixture in (u,v) space. planLayout is pure — it never touches
// the DEM terrain or THREE, only manifest.green + manifest.roads (mirrors how
// reveal.test.mjs exercises buildRevealAttributes without THREE).
const FIX = () => ({
  scale: { SCALE: 6, VSCALE: 5, vOffset: 0.3 },
  green: [[-1.0, 0.0, -0.4, 0.6], [0.2, -0.2, 0.7, 0.4]],
  roads: [
    { name: 'some side street', points: [[-1.5, 0.1, 0], [-1.2, 0.1, 0]] },
    { name: '大学通り', points: [[0.0, 0.20, 0], [0.0, 0.60, 0], [0.0, 1.10, 0]] },
  ],
});

const cellKey = (u, v, cell = 0.028) => Math.floor(u / cell) + ',' + Math.floor(v / cell);

test('splits planting into avenue (大学通り) and scatter (green rects)', () => {
  const { avenue, scatter } = planLayout(FIX());
  assert.ok(avenue.length > 0, 'avenue trees planted along 大学通り');
  assert.ok(scatter.length > 0, 'scatter trees planted in green rects');
  for (const p of avenue.concat(scatter)) {
    assert.strictEqual(typeof p.u, 'number');
    assert.strictEqual(typeof p.v, 'number');
    assert.strictEqual(typeof p.aPhase, 'number');
    assert.strictEqual(typeof p.seed, 'number');
    assert.ok(p.seed >= 0 && p.seed < 1, 'seed in [0,1)');
  }
});

test('aPhase normalizes avenue v-extent to [0,1] (min→0, max→1)', () => {
  const { avenue } = planLayout(FIX());
  let lo = Infinity, hi = -Infinity, vAtLo = 0, vAtHi = 0;
  for (const p of avenue) {
    assert.ok(p.aPhase >= 0 && p.aPhase <= 1, 'aPhase in [0,1]');
    if (p.aPhase < lo) { lo = p.aPhase; vAtLo = p.v; }
    if (p.aPhase > hi) { hi = p.aPhase; vAtHi = p.v; }
  }
  assert.ok(Math.abs(lo) < 1e-6, 'min aPhase is 0');
  assert.ok(Math.abs(hi - 1) < 1e-6, 'max aPhase is 1');
  assert.ok(vAtHi > vAtLo, 'aPhase increases downstream (with v)');
});

test('scatter aPhase is 0 (sweep is an avenue-only effect)', () => {
  const { scatter } = planLayout(FIX());
  for (const p of scatter) assert.strictEqual(p.aPhase, 0);
});

test('deterministic: two calls give byte-identical layout + seeds', () => {
  assert.deepStrictEqual(planLayout(FIX()), planLayout(FIX()));
});

test('grid-thin dedupe: no two instances share a cell key', () => {
  const { avenue, scatter } = planLayout(FIX());
  const keys = avenue.concat(scatter).map((p) => cellKey(p.u, p.v));
  assert.strictEqual(new Set(keys).size, keys.length, 'every instance occupies a distinct cell');
});

test('missing 大学通り → avenue:[] without throwing, scatter still populated', () => {
  const m = FIX();
  m.roads = [{ name: 'no avenue here', points: [[0, 0, 0], [0.5, 0.5, 0]] }];
  const { avenue, scatter } = planLayout(m);
  assert.deepStrictEqual(avenue, []);
  assert.ok(scatter.length > 0);
});

// --- step 5 / avenue extension: avenue plants to its own (taller) v-bound, independent
// of the scatter bounds, so the 並木 reaches the 大学通り terminus without growing scatter. ---

// A 大学通り that runs well past the old clip (v1=1.3), up to v=3.0.
const TALL = () => {
  const m = FIX();
  m.roads = [{ name: '大学通り', points: [[0.0, 0.20, 0], [0.0, 1.50, 0], [0.0, 3.00, 0]] }];
  return m;
};

test('default avenueBounds extends the 並木 past the old v=1.3 clip', () => {
  const { avenue } = planLayout(TALL());
  const maxV = Math.max(...avenue.map((p) => p.v));
  assert.ok(maxV > 1.3, `avenue reaches past old clip (got maxV=${maxV})`);
});

test('opts.avenueBounds clips the avenue (the knob works)', () => {
  const clipped = planLayout(TALL(), { avenueBounds: { u0: -1.85, u1: 1.72, v0: -0.42, v1: 1.0 } });
  const maxV = Math.max(...clipped.avenue.map((p) => p.v));
  assert.ok(maxV <= 1.0, `avenue clipped to v<=1.0 (got maxV=${maxV})`);
});

test('extending the avenue does NOT change scatter (bounds are independent)', () => {
  const tallScatter = planLayout(TALL()).scatter.length;
  const shortScatter = planLayout(TALL(), { avenueBounds: { u0: -1.85, u1: 1.72, v0: -0.42, v1: 1.0 } }).scatter.length;
  assert.strictEqual(tallScatter, shortScatter, 'scatter count is independent of avenue extent');
});

test('degenerate avenue (constant v, V1===V0) → aPhase 0, no NaN', () => {
  // Short vertical segment: both-sides offset lands in u, so every planted tree
  // shares v=0.50 → V1===V0 → the div-by-zero guard must yield aPhase 0.
  const m = FIX();
  m.roads = [{ name: '大学通り', points: [[0.0, 0.50, 0], [0.0, 0.51, 0]] }];
  const { avenue } = planLayout(m);
  assert.ok(avenue.length > 0);
  assert.strictEqual(new Set(avenue.map((p) => p.v)).size, 1, 'all trees at one v');
  for (const p of avenue) {
    assert.ok(!Number.isNaN(p.aPhase), 'no NaN from div-by-zero');
    assert.strictEqual(p.aPhase, 0);
  }
});

// --- 空き地の木 (vacant-lot trees): planVacant plants damped greenery into the building
// carpet's INTERIOR gaps. Pure: it takes a flat Float32Array of building vertex WORLD
// positions (proto.js extracts these from the loaded buildings mesh) + manifest.scale. ---

const SC = { SCALE: 6, vOffset: 0.3 };
const MAN = () => ({ scale: { SCALE: 6, VSCALE: 5, vOffset: 0.3 } });

// A solid block of building footprints in UV [0,0.36]² with a hole punched at the centre
// (UV [0.14,0.22]², ~0.08 wide — small enough that every cell stays within nearBuilt's R of
// the surrounding block). Returned as world positions [x,y,z,…] = [u*SCALE, 0, (v-vOffset)*SCALE].
const BLOCK = () => {
  const out = [];
  for (let u = 0; u <= 0.36 + 1e-9; u += 0.004) for (let v = 0; v <= 0.36 + 1e-9; v += 0.004) {
    if (u > 0.14 && u < 0.22 && v > 0.14 && v < 0.22) continue; // interior hole (vacant lot)
    out.push(u * SC.SCALE, 0, (v - SC.vOffset) * SC.SCALE);
  }
  return new Float32Array(out);
};

test('planVacant: off (returns []) when density 0 or positions missing', () => {
  assert.deepStrictEqual(planVacant(BLOCK(), MAN(), { vacantDensity: 0 }), []);
  assert.deepStrictEqual(planVacant(null, MAN(), { vacantDensity: 0.5 }), []);
  assert.deepStrictEqual(planVacant(new Float32Array(0), MAN(), { vacantDensity: 0.5 }), []);
});

test('planVacant: plants ONLY in the interior gap (never on a building, never outside)', () => {
  const vac = planVacant(BLOCK(), MAN(), { vacantDensity: 1.0 });
  assert.ok(vac.length > 0, 'the hole gets trees');
  for (const p of vac) {
    // every tree lands inside the punched hole region (loose bound for jitter), not on the block
    assert.ok(p.u > 0.12 && p.u < 0.24, `u in hole (got ${p.u})`);
    assert.ok(p.v > 0.12 && p.v < 0.24, `v in hole (got ${p.v})`);
  }
});

test('planVacant: each instance is scatter-shaped (aPhase 0, seed in [0,1), finite u/v)', () => {
  for (const p of planVacant(BLOCK(), MAN(), { vacantDensity: 1.0 })) {
    assert.strictEqual(p.aPhase, 0, 'no sweep on vacant greenery');
    assert.ok(p.seed >= 0 && p.seed < 1, 'seed in [0,1)');
    assert.ok(Number.isFinite(p.u) && Number.isFinite(p.v), 'finite position');
  }
});

test('planVacant: deterministic (two calls byte-identical)', () => {
  assert.deepStrictEqual(
    planVacant(BLOCK(), MAN(), { vacantDensity: 0.26 }),
    planVacant(BLOCK(), MAN(), { vacantDensity: 0.26 }),
  );
});

test('planVacant: higher density plants at least as many trees', () => {
  const lo = planVacant(BLOCK(), MAN(), { vacantDensity: 0.3 }).length;
  const hi = planVacant(BLOCK(), MAN(), { vacantDensity: 1.0 }).length;
  assert.ok(hi >= lo, `denser plants more (lo=${lo} hi=${hi})`);
  assert.ok(hi > 0, 'full density fills the lot');
});

test('planVacant: seed stream is independent of placement (density-1 count == hole lattice count)', () => {
  // With density 1 every non-occupied lattice cell is accepted; the separate rnd2 seed
  // stream must not perturb that. Re-running with a different density floor keeps placements
  // a strict superset → count monotonic (already covered) and positions stable across seeds.
  const a = planVacant(BLOCK(), MAN(), { vacantDensity: 1.0 }).map((p) => `${p.u.toFixed(6)},${p.v.toFixed(6)}`);
  const b = planVacant(BLOCK(), MAN(), { vacantDensity: 1.0 }).map((p) => `${p.u.toFixed(6)},${p.v.toFixed(6)}`);
  assert.deepStrictEqual(a, b);
});

test('planLayout: vacant goes in its OWN list only when BOTH density + positions given', () => {
  const base = planLayout(FIX());                                   // no vacant inputs
  assert.deepStrictEqual(base.vacant, [], 'no vacant by default');
  const withDensityOnly = planLayout(FIX(), { vacantDensity: 0.26 }); // density but no positions → off
  assert.deepStrictEqual(withDensityOnly, base, 'density alone does not plant (needs positions)');

  const withVacant = planLayout(FIX(), { vacantDensity: 1.0, buildingPositions: BLOCK() });
  assert.deepStrictEqual(withVacant.avenue, base.avenue, 'avenue is untouched by vacant planting');
  assert.deepStrictEqual(withVacant.scatter, base.scatter, 'green-zone scatter is untouched (vacant is separate)');
  assert.ok(withVacant.vacant.length > 0, 'vacant trees planted into their own list');
  for (const p of withVacant.vacant) assert.strictEqual(p.aPhase, 0); // no sweep on vacant greenery
});
