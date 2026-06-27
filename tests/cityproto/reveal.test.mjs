import assert from 'node:assert';
import { test } from 'node:test';
import { buildRevealAttributes, clusterRevealKeys, buildIndexAttribute } from '../../src/cityproto/reveal.js';

// A unit-square footprint (4 verts) centred at (cx,cz), half-size s.
const square = (cx, cz, s = 0.5) => [[cx - s, cz - s], [cx + s, cz - s], [cx + s, cz + s], [cx - s, cz + s]];

test('aReveal/aBaseY broadcast per building; aBaseY is the floor (min raw Y)', () => {
  const perBuilding = [
    { vStart: 0, vCount: 3, revealKey: 2.0 },
    { vStart: 3, vCount: 3, revealKey: 5.0 },
  ];
  const YS = [10, 5, 8, 20, 14, 17];                     // raw quantized Y per vertex
  const { aReveal, aBaseY, maxRevealKey } = buildRevealAttributes(perBuilding, (i) => YS[i], 6);
  assert.deepStrictEqual([...aReveal], [2, 2, 2, 5, 5, 5], 'distance key broadcast to each vert');
  assert.deepStrictEqual([...aBaseY], [5, 5, 5, 14, 14, 14], 'floor = min raw Y over the range');
  assert.strictEqual(maxRevealKey, 5.0, 'sweep target = farthest building');
});

test('buildIndexAttribute maps each vertex to its building index', () => {
  const perBuilding = [
    { vStart: 0, vCount: 3 },
    { vStart: 3, vCount: 2 },
  ];
  const idx = buildIndexAttribute(perBuilding, 5);
  assert.deepStrictEqual([...idx], [0, 0, 0, 1, 1]);
});

test('vertices outside any building range stay 0 (no spurious reveal data)', () => {
  const perBuilding = [{ vStart: 1, vCount: 2, revealKey: 3.0 }];
  const { aReveal, aBaseY } = buildRevealAttributes(perBuilding, (i) => 7, 4);
  assert.deepStrictEqual([...aReveal], [0, 3, 3, 0]);
  assert.deepStrictEqual([...aBaseY], [0, 7, 7, 0]);
});

// --- clustering: overlapping footprints rise in lockstep (shared min revealKey) ---

test('clusterRevealKeys: overlapping buildings share the cluster MIN key; separate ones keep theirs', () => {
  // B0 & B1 fully overlap at origin; B2 sits far away.
  const fp = [...square(0, 0), ...square(0, 0), ...square(10, 10)];
  const perBuilding = [
    { vStart: 0, vCount: 4, revealKey: 1.2 },
    { vStart: 4, vCount: 4, revealKey: 0.5 },
    { vStart: 8, vCount: 4, revealKey: 3.0 },
  ];
  const keys = clusterRevealKeys(perBuilding, (i) => fp[i][0], (i) => fp[i][1], 0.5);
  assert.strictEqual(keys[0], 0.5, 'B0 snaps to cluster min');
  assert.strictEqual(keys[1], 0.5, 'B1 keeps cluster min');
  assert.strictEqual(keys[2], 3.0, 'B2 (no overlap) unchanged');
});

test('clusterRevealKeys: mere touching (below overlap fraction) does NOT cluster', () => {
  // Two unit squares sharing only an edge: zero overlap area.
  const fp = [...square(0, 0), ...square(1, 0)];
  const perBuilding = [
    { vStart: 0, vCount: 4, revealKey: 1.0 },
    { vStart: 4, vCount: 4, revealKey: 2.0 },
  ];
  const keys = clusterRevealKeys(perBuilding, (i) => fp[i][0], (i) => fp[i][1], 0.5);
  assert.deepStrictEqual([...keys], [1.0, 2.0], 'adjacent (no area overlap) stays independent');
});

test('clusterRevealKeys is deterministic and transitive across a chain of overlaps', () => {
  // A overlaps B overlaps C (all stacked at origin) → one cluster, min key.
  const fp = [...square(0, 0), ...square(0.1, 0), ...square(0.2, 0)];
  const perBuilding = [
    { vStart: 0, vCount: 4, revealKey: 4.0 },
    { vStart: 4, vCount: 4, revealKey: 1.5 },
    { vStart: 8, vCount: 4, revealKey: 2.7 },
  ];
  const a = clusterRevealKeys(perBuilding, (i) => fp[i][0], (i) => fp[i][1], 0.5);
  const b = clusterRevealKeys(perBuilding, (i) => fp[i][0], (i) => fp[i][1], 0.5);
  assert.deepStrictEqual([...a], [...b], 'pure / deterministic');
  assert.deepStrictEqual([...a], [1.5, 1.5, 1.5], 'transitive cluster → shared min');
});

test('clusterRevealKeys: a wide footprint at QUANTIZED scale does not overflow the grid Map', () => {
  // Runtime regression guard. installReveal feeds RAW KHR_mesh_quantization positions
  // (range ~0..65535), NOT world units. The old fixed world-scale cell (Math.min(4,…)) made
  // a single wide footprint span (extent/cell)² ≈ 10^8 grid cells at that scale, blowing the
  // Map past V8's ~16.7M limit ("Map maximum size exceeded") and failing the entire city
  // load. The span-relative cell keeps the grid to ~n buckets at any scale. With the OLD
  // code this call throws; it must simply complete and return the building's own key.
  const wide = [[0, 0], [40000, 0], [40000, 40000], [0, 40000]]; // 40000-unit (quantized) footprint
  const perBuilding = [{ vStart: 0, vCount: 4, revealKey: 1.0 }];
  const keys = clusterRevealKeys(perBuilding, (i) => wide[i][0], (i) => wide[i][1], 0.5);
  assert.deepStrictEqual([...keys], [1.0], 'completes without overflow; lone building keeps its key');
});

test('clusterRevealKeys: overlap detection is scale-invariant (overlapping pair clusters at quantized scale)', () => {
  // Same geometry as the world-scale tests but translated/scaled into the quantized range:
  // an overlapping pair near map centre + a building in a far corner. The pair must share the
  // cluster MIN; the distant one stays independent. (Node scale is uniform-sign per axis, so
  // the overlap-area fraction is preserved → clustering matches the world-scale result.)
  const pairA = square(32000, 32000, 60), pairB = square(32010, 32000, 60); // ~120-unit footprints overlapping
  const far = square(8000, 60000, 60);                                       // far corner, no overlap
  const fp = [...pairA, ...pairB, ...far];
  const perBuilding = [
    { vStart: 0, vCount: 4, revealKey: 4.0 },
    { vStart: 4, vCount: 4, revealKey: 1.5 },
    { vStart: 8, vCount: 4, revealKey: 7.0 },
  ];
  const keys = clusterRevealKeys(perBuilding, (i) => fp[i][0], (i) => fp[i][1], 0.5);
  assert.deepStrictEqual([...keys], [1.5, 1.5, 7.0], 'pair → shared min; distant → own key');
});

test('buildRevealAttributes applies clustering when getX/getZ are supplied (opt-in, back-compat without)', () => {
  const fp = [...square(0, 0), ...square(0, 0)];
  const perBuilding = [
    { vStart: 0, vCount: 4, revealKey: 1.5 },
    { vStart: 4, vCount: 4, revealKey: 0.5 },
  ];
  const YS = fp.map(() => 7);
  // without getX/getZ → legacy behaviour (each keeps its own key)
  const legacy = buildRevealAttributes(perBuilding, (i) => YS[i], 8);
  assert.deepStrictEqual([...legacy.aReveal], [1.5, 1.5, 1.5, 1.5, 0.5, 0.5, 0.5, 0.5]);
  // with getX/getZ → overlapping pair shares the min key
  const clustered = buildRevealAttributes(perBuilding, (i) => YS[i], 8, { getX: (i) => fp[i][0], getZ: (i) => fp[i][1] });
  assert.deepStrictEqual([...clustered.aReveal], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  assert.strictEqual(clustered.maxRevealKey, 1.5, 'sweep target unchanged (max original key still reached)');
});
