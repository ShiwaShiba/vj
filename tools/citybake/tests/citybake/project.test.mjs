import assert from 'node:assert';
import { test } from 'node:test';
import { makeProjector } from '../../geo/project.mjs';

const ORIGIN = { lat: 35.6991, lon: 139.4462 }; // 国立駅
const P = makeProjector({ origin: ORIGIN, metersPerUnit: 420, thetaDeg: 0 });

test('station projects to the apex (0,0)', () => {
  const { u, v } = P.toPlan(ORIGIN.lat, ORIGIN.lon);
  assert.ok(Math.hypot(u, v) < 1e-6, `apex off: ${u},${v}`);
});
test('south of the station is +v (south), within scale', () => {
  const south = P.toPlan(ORIGIN.lat - 420 / 110540, ORIGIN.lon); // ~420 m south
  assert.ok(south.v > 0.9 && south.v < 1.1, `v=${south.v}`);
  assert.ok(Math.abs(south.u) < 1e-3, `u=${south.u}`);
});
test('east of the station is +u (east)', () => {
  const east = P.toPlan(ORIGIN.lat, ORIGIN.lon + 420 / (110540 * Math.cos(ORIGIN.lat * Math.PI / 180)));
  assert.ok(east.u > 0.9 && east.u < 1.1, `u=${east.u}`);
});
test('round-trips toPlan→toLatLon', () => {
  const ll = P.toLatLon(0.7, -0.3);
  const back = P.toPlan(ll.lat, ll.lon);
  assert.ok(Math.hypot(back.u - 0.7, back.v + 0.3) < 1e-6);
});
test('rotation θ tilts the axes consistently and still round-trips', () => {
  const R = makeProjector({ origin: ORIGIN, metersPerUnit: 420, thetaDeg: 3 });
  const ll = R.toLatLon(0.5, 0.2);
  const back = R.toPlan(ll.lat, ll.lon);
  assert.ok(Math.hypot(back.u - 0.5, back.v - 0.2) < 1e-6, `rot round-trip ${back.u},${back.v}`);
});
