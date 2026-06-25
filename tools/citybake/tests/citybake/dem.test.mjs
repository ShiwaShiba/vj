import assert from 'node:assert';
import { test } from 'node:test';
import {
  parseDemTxt, bilinear, lonLatToGlobalPx, stitchTiles, makeDemSampler, makePlanHeight,
} from '../../geo/dem.mjs';
import { makeProjector } from '../../geo/project.mjs';

test('parses comma grid in metres and marks `e` as NaN', () => {
  const grid = parseDemTxt('10,20\n30,e'); // 2 rows × 2 cols
  assert.strictEqual(grid.rows, 2);
  assert.strictEqual(grid.cols, 2);
  assert.strictEqual(grid.values[0], 10);
  assert.ok(Number.isNaN(grid.values[3])); // the `e`
});

test('bilinear interpolates along the east gradient', () => {
  const grid = { rows: 2, cols: 2, values: [0, 10, 0, 10] };
  assert.ok(Math.abs(bilinear(grid, 0.5, 0) - 5) < 1e-9);
  assert.ok(Math.abs(bilinear(grid, 0, 0) - 0) < 1e-9);
});

test('bilinear renormalises weights around NaN corners', () => {
  const grid = { rows: 2, cols: 2, values: [0, 10, NaN, 20] };
  // (0+10+20)*0.25 / 0.75 = 10
  assert.ok(Math.abs(bilinear(grid, 0.5, 0.5) - 10) < 1e-9);
});

test('lonLatToGlobalPx lands the station in GSI tile 14538/6450 at z14', () => {
  // Standard slippy formula (verified vs Tokyo Station = 14552/6451).
  const { x, y } = lonLatToGlobalPx(35.6991, 139.4462, 14);
  assert.strictEqual(Math.floor(x / 256), 14538);
  assert.strictEqual(Math.floor(y / 256), 6450);
});

test('sampler reads a stitched tile back at the right pixel', () => {
  // one synthetic tile at z14/14538/6450 whose value == row index (south-increasing)
  const TS = 256, vals = new Array(TS * TS);
  for (let r = 0; r < TS; r++) for (let c = 0; c < TS; c++) vals[r * TS + c] = r;
  const stitched = stitchTiles([{ x: 14538, y: 6450, grid: { rows: TS, cols: TS, values: vals } }], 14);
  const s = makeDemSampler(stitched);
  const e = s.elevationAt(35.6991, 139.4462);
  assert.ok(e >= 0 && e < 256 && !Number.isNaN(e), `elev=${e}`);
});

test('planHeight scales (elev-ref)/metersPerUnit*vexag and grows with elevation', () => {
  const proj = makeProjector({ origin: { lat: 35.7, lon: 139.44 }, metersPerUnit: 420 });
  const hi = makePlanHeight({ sampler: { elevationAt: () => 42 }, projector: proj, refElevation: 0, vexag: 2 });
  const lo = makePlanHeight({ sampler: { elevationAt: () => 21 }, projector: proj, refElevation: 0, vexag: 2 });
  assert.ok(Math.abs(hi(0, 0) - (42 / 420 * 2)) < 1e-9, `h=${hi(0, 0)}`);
  assert.ok(hi(0, 0) > lo(0, 0));
});

test('planHeight falls back to the reference plane on no-data', () => {
  const proj = makeProjector({ origin: { lat: 35.7, lon: 139.44 }, metersPerUnit: 420 });
  const ph = makePlanHeight({ sampler: { elevationAt: () => NaN }, projector: proj, refElevation: 30, vexag: 2 });
  assert.strictEqual(ph(0.3, -0.2), 0);
});
