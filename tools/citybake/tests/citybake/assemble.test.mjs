import assert from 'node:assert';
import { test } from 'node:test';
import { assembleCity, earClip } from '../../bake/assemble.mjs';
import { makeProjector } from '../../geo/project.mjs';

const projector = makeProjector({ origin: { lat: 35.6991, lon: 139.4462 }, metersPerUnit: 420 });
const flat = () => 0;
const PARAMS = { SCALE: 6, VSCALE: 5, NX: 20, NV: 14, bounds: { u0: -1.85, u1: 1.72, v0: -0.42, v1: 1.3 }, gridStep: 0.2, vOffset: 0.3 };

const sq = (lat, lon, d) => [
  { lat: lat + d, lon: lon - d }, { lat: lat + d, lon: lon + d },
  { lat: lat - d, lon: lon + d }, { lat: lat - d, lon: lon - d },
];
const minY = (pos) => { let m = Infinity; for (let i = 1; i < pos.length; i += 3) m = Math.min(m, pos[i]); return m; };
const maxY = (pos) => { let m = -Infinity; for (let i = 1; i < pos.length; i += 3) m = Math.max(m, pos[i]); return m; };
const maxAbsY = (pos) => { let m = 0; for (let i = 1; i < pos.length; i += 3) m = Math.max(m, Math.abs(pos[i])); return m; };
const hasYNear = (pos, y, eps) => { for (let i = 1; i < pos.length; i += 3) if (Math.abs(pos[i] - y) < eps) return true; return false; };

test('earClip triangulates a concave (L-shaped) polygon into n-2 triangles', () => {
  const L = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
  const tris = earClip(L);
  assert.strictEqual(tris.length, L.length - 2, `got ${tris.length} tris`);
});

test('terrain grid has (NX+1)*(NV+1) vertices and conforms to the DEM', () => {
  const osm = { footprints: [], roads: [], rails: [], green: [], landmark: null, station: null };
  const out = assembleCity({ osm, projector, planHeight: flat, params: PARAMS });
  assert.strictEqual(out.terrain.positions.length, (PARAMS.NX + 1) * (PARAMS.NV + 1) * 3);
  assert.ok(out.terrainGrid.positions.length > 0);
  assert.ok(maxAbsY(out.terrainGrid.positions) < 1e-6, 'flat DEM -> flat grid');
});

test('buildings carry reveal keys that grow with distance and sit on the DEM', () => {
  const near = sq(35.6989, 139.4462, 0.0003);          // close to the station
  const far = sq(35.6950, 139.4510, 0.0003);           // far SE, still inside bounds
  const osm = {
    footprints: [
      { ring: near, heightM: 6.4, levels: 2, name: '', tags: {} },
      { ring: far, heightM: 6.4, levels: 2, name: '', tags: {} },
    ], roads: [], rails: [], green: [], landmark: null, station: null,
  };
  const out = assembleCity({ osm, projector, planHeight: flat, params: PARAMS });
  const pb = out.buildings.perBuilding;
  assert.strictEqual(pb.length, 2);
  for (const b of pb) for (const k of ['u', 'v', 'height', 'revealKey', 'type', 'vStart', 'vCount'])
    assert.ok(k in b, `perBuilding missing ${k}`);
  assert.strictEqual(pb[0].type, 'generic');
  assert.ok(pb[0].revealKey < pb[1].revealKey, `near ${pb[0].revealKey} should precede far ${pb[1].revealKey}`);
  assert.ok(Math.abs(minY(out.buildings.positions)) < 1e-6, 'building base sits on the flat DEM');
  assert.ok(out.buildings.indices.length > 0 && out.buildings.normals.length === out.buildings.positions.length);
});

test('landmark and station become distinct nodes', () => {
  const osm = {
    footprints: [], roads: [], rails: [], green: [],
    landmark: { ring: sq(35.6988, 139.4462, 0.0004), heightM: 9, levels: 2, name: '旧国立駅舎', tags: { historic: 'building' } },
    station: { point: { lat: 35.6992, lon: 139.4465 }, tags: { railway: 'station' }, name: '国立' },
  };
  const out = assembleCity({ osm, projector, planHeight: flat, params: PARAMS });
  assert.ok(out.landmark && out.landmark.positions.length > 0, 'landmark node present');
  assert.ok(out.station && out.station.positions.length > 0, 'station node present');
});

test('landmark is the asymmetric 旧駅舎: a tall main gable over a distinctly lower west wing, on the DEM', () => {
  const osm = {
    footprints: [], roads: [], rails: [], green: [],
    landmark: { ring: sq(35.6988, 139.4462, 0.0004), heightM: 9, levels: 2, name: '旧国立駅舎', tags: { historic: 'building' } },
    station: null,
  };
  const out = assembleCity({ osm, projector, planHeight: flat, params: PARAMS });
  const pos = out.landmark.positions;
  // ported ST_REF (baseY 0 on the flat DEM): main ridge z=0.683, west-wing ridge z=0.40 — both
  // scale by HZ so the ratio is exact; the wing ridge plateau sits below the main ridge.
  const top = maxY(pos);
  const wingRidge = top * (0.40 / 0.683);
  assert.ok(Math.abs(minY(pos)) < 1e-6, 'base sits on the flat DEM');
  assert.ok(top > 0, 'main ridge above base');
  assert.ok(hasYNear(pos, wingRidge, top * 0.03), 'a distinctly lower west-wing ridge plateau exists');
  assert.ok(wingRidge < top * 0.95, 'west wing is lower than the main ridge (stepped silhouette)');
  assert.ok(pos.length / 3 > 80, `multi-volume mesh (main + wing + canopy), got ${pos.length / 3} verts`);
  for (const k of ['u', 'v', 'height', 'revealKey', 'type', 'vStart', 'vCount'])
    assert.ok(k in out.landmark.perBuilding[0], `landmark perBuilding missing ${k}`);
});

test('landmark gable is deterministic (byte-identical across calls)', () => {
  const osm = () => ({
    footprints: [], roads: [], rails: [], green: [], station: null,
    landmark: { ring: sq(35.6988, 139.4470, 0.0005), heightM: 11, levels: 2, name: '旧国立駅舎', tags: { historic: 'building' } },
  });
  const a = assembleCity({ osm: osm(), projector, planHeight: flat, params: PARAMS }).landmark.positions;
  const b = assembleCity({ osm: osm(), projector, planHeight: flat, params: PARAMS }).landmark.positions;
  assert.deepStrictEqual([...a], [...b]);
});
