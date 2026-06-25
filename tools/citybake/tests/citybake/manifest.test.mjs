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
  assert.ok(m.attribution.includes('© OpenStreetMap contributors'));
  assert.ok(m.attribution.some((a) => a.includes('地理院')));
});

test('roads include the primary avenue and a horizontal chuo polyline', () => {
  const m = buildManifest({ osm, projector, perBuilding, params });
  const daigaku = m.roads.find((r) => r.name === '大学通り');
  assert.ok(daigaku && daigaku.primary && daigaku.points.length >= 2);
  // due-south avenue → ~vertical (Δu ≈ 0, Δv large)
  const du = Math.abs(daigaku.points[0][0] - daigaku.points[1][0]);
  assert.ok(du < 1e-3, `daigaku should be vertical, du=${du}`);

  const chuo = m.roads.find((r) => r.name === 'chuo');
  assert.ok(chuo && chuo.points.length >= 2, 'chuo polyline present');
  const vs = chuo.points.map((p) => p[1]);
  assert.ok(Math.max(...vs) - Math.min(...vs) < 1e-3, 'chuo must be horizontal');
});
