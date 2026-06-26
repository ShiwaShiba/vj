import assert from 'node:assert';
import { test } from 'node:test';
import { buildManifest } from '../../bake/manifest.mjs';
import { makeProjector } from '../../geo/project.mjs';

const origin = { lat: 35.6991, lon: 139.4462 };
const projector = makeProjector({ origin, metersPerUnit: 420, thetaDeg: 0 });
const bounds = { u0: -1.85, u1: 1.72, v0: -0.42, v1: 1.3 };

const osm = {
  footprints: [], green: [{ ring: [{ lat: 35.6985, lon: 139.4459 }, { lat: 35.6985, lon: 139.4463 }, { lat: 35.6982, lon: 139.4463 }] }],
  roads: [
    { name: '大学通り', primary: true, points: [{ lat: 35.6990, lon: 139.4462 }, { lat: 35.6950, lon: 139.4462 }] }, // due south → vertical
    { name: '名無し', primary: false, points: [{ lat: 35.700, lon: 139.44 }, { lat: 35.701, lon: 139.441 }] },
    { name: '甲州街道', primary: false, highway: 'primary', points: [{ lat: 35.6988, lon: 139.4455 }, { lat: 35.6988, lon: 139.4470 }] }, // named arterial → secondary tier
    { name: '裏路地', primary: false, highway: 'residential', points: [{ lat: 35.6986, lon: 139.4458 }, { lat: 35.6985, lon: 139.4460 }] }, // minor capillary → dropped
  ],
  rails: [{ name: '中央本線', points: [{ lat: 35.6991, lon: 139.4400 }, { lat: 35.6991, lon: 139.4500 }] }], // const lat → horizontal
  landmark: { name: '旧国立駅舎' }, station: { point: { lat: 35.6992, lon: 139.4465 } },
};
const perBuilding = [{ revealKey: 0.1, type: 'generic', vStart: 0, vCount: 24 }, { revealKey: 1.2, type: 'generic', vStart: 24, vCount: 24 }];
const params = { SCALE: 6, VSCALE: 5, vexag: 2.5, bounds, bbox: [35.690, 139.435, 35.705, 139.458], vOffset: 0.3 };

test('manifest carries the required shape', () => {
  const m = buildManifest({ osm, projector, perBuilding, params });
  assert.deepStrictEqual(m.origin, origin);
  assert.deepStrictEqual(m.bbox, params.bbox);
  for (const k of ['SCALE', 'VSCALE', 'metersPerUnit', 'vexag', 'thetaDeg']) assert.ok(k in m.scale, `scale.${k}`);
  assert.strictEqual(m.scale.metersPerUnit, 420);
  assert.strictEqual(m.landmarkNode, 'landmark');
  assert.ok(m.station && typeof m.station.u === 'number' && typeof m.station.v === 'number');
  assert.deepStrictEqual(m.buildings, perBuilding.map((b) => ({ revealKey: b.revealKey, type: b.type, vStart: b.vStart, vCount: b.vCount })));
  assert.ok(Array.isArray(m.green) && m.green.length === 1 && m.green[0].length === 4);
  // all three data sources must be credited — the runtime overlay reads this array
  // verbatim (single source of truth), and OSM(ODbL)/GSI/PLATEAU each require notice.
  assert.ok(m.attribution.includes('© OpenStreetMap contributors'));
  assert.ok(m.attribution.some((a) => a.includes('地理院')));
  assert.ok(m.attribution.some((a) => a.includes('PLATEAU')), 'PLATEAU (3D都市モデル) must be credited');
});

test('roads include the primary avenue and a horizontal chuo polyline', () => {
  const m = buildManifest({ osm, projector, planHeight: (u, v) => 0.02 * v, perBuilding, params });
  const daigaku = m.roads.find((r) => r.name === '大学通り');
  assert.ok(daigaku && daigaku.primary && daigaku.points.length >= 2);
  assert.strictEqual(daigaku.points[0].length, 3, 'road points carry [u,v,h]');
  // due-south avenue → ~vertical (Δu ≈ 0, Δv large)
  const du = Math.abs(daigaku.points[0][0] - daigaku.points[1][0]);
  assert.ok(du < 1e-3, `daigaku should be vertical, du=${du}`);

  const chuo = m.roads.find((r) => r.name === 'chuo');
  assert.ok(chuo && chuo.points.length >= 2, 'chuo polyline present');
  const vs = chuo.points.map((p) => p[1]);
  assert.ok(Math.max(...vs) - Math.min(...vs) < 1e-3, 'chuo must be horizontal');
});

test('named arterials become a secondary tier; minor capillaries stay dropped', () => {
  const m = buildManifest({ osm, projector, planHeight: () => 0, perBuilding, params });
  const arterial = m.roads.find((r) => r.name === '甲州街道');
  assert.ok(arterial, 'named arterial present in manifest');
  assert.strictEqual(arterial.primary, false, 'arterial is secondary (primary:false)');
  assert.strictEqual(arterial.highway, 'primary', 'arterial carries its highway class');
  assert.ok(arterial.points.length >= 2 && arterial.points[0].length === 3, 'arterial carries [u,v,h]');
  assert.ok(!m.roads.some((r) => r.name === '裏路地'), 'residential capillary dropped');
  assert.ok(!m.roads.some((r) => r.name === '名無し'), 'unclassified non-primary dropped');
});

test('国立停車場谷保線 の谷保天満宮分岐は id で除外（tier 不問・白でもグレーでも描かない）', () => {
  // Both are name付き secondary → would normally both render as grey secondary lines.
  // Only the OSM id distinguishes the 谷保天満宮 branch (28213299, heads west/u<0) from
  // an otherwise-identical sibling (heads east/u>0). DROP_IDS must remove only the branch.
  const branchOsm = {
    ...osm,
    roads: [
      ...osm.roads,
      { id: 28213299, name: '国立停車場谷保線', primary: false, highway: 'secondary', points: [{ lat: 35.6960, lon: 139.4460 }, { lat: 35.6955, lon: 139.4456 }] }, // 谷保天満宮分岐 → drop
      { id: 99999999, name: '国立停車場谷保線', primary: false, highway: 'secondary', points: [{ lat: 35.6960, lon: 139.4464 }, { lat: 35.6955, lon: 139.4468 }] }, // 同名・同クラスの sibling → 残る
    ],
  };
  const m = buildManifest({ osm: branchOsm, projector, planHeight: () => 0, perBuilding, params });
  const named = m.roads.filter((r) => r.name === '国立停車場谷保線');
  assert.strictEqual(named.length, 1, 'only the non-branch sibling survives (branch id dropped)');
  assert.ok(named[0].points.every(([u]) => u > 0), 'survivor is the east sibling, not the west 谷保天満宮 branch');
});
