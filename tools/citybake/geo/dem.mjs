// GSI 標高タイル (DEM) parsing + heightfield sampling.
//
// A GSI .txt tile is 256 rows × 256 comma-separated elevations in metres
// (row = south-increasing, col = east-increasing). No-data is the literal `e`.
// We stitch a block of z-tiles into one grid, sample it with the slippy-map
// pixel projection, and turn metres into plan-space heights.
const TS = 256;
const clampI = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export function parseDemTxt(text) {
  const lines = text.trim().split('\n');
  const rows = lines.length;
  const values = [];
  let cols = 0;
  for (const line of lines) {
    const parts = line.split(',');
    cols = parts.length;
    for (const p of parts) {
      const t = p.trim();
      values.push(t === 'e' || t === '' ? NaN : Number(t));
    }
  }
  return { rows, cols, values };
}

// Bilinear sample at fractional column fx / row fy; renormalises around NaN corners.
export function bilinear(grid, fx, fy) {
  const { cols, rows, values } = grid;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const at = (xx, yy) => values[clampI(yy, 0, rows - 1) * cols + clampI(xx, 0, cols - 1)];
  const corners = [
    [at(x0, y0), (1 - tx) * (1 - ty)],
    [at(x0 + 1, y0), tx * (1 - ty)],
    [at(x0, y0 + 1), (1 - tx) * ty],
    [at(x0 + 1, y0 + 1), tx * ty],
  ];
  let sum = 0, wsum = 0;
  for (const [v, w] of corners) if (w > 0 && !Number.isNaN(v)) { sum += v * w; wsum += w; }
  return wsum > 0 ? sum / wsum : NaN;
}

// Web-Mercator (slippy) global pixel coordinate of a lat/lon at zoom z.
export function lonLatToGlobalPx(lat, lon, z) {
  const n = 2 ** z;
  const x = (lon + 180) / 360 * n * TS;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n * TS;
  return { x, y };
}

// Assemble [{x,y,grid}] z-tiles into one big grid; record the block's pixel origin.
export function stitchTiles(tiles, z) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) {
    minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x); maxY = Math.max(maxY, t.y);
  }
  const cols = (maxX - minX + 1) * TS, rows = (maxY - minY + 1) * TS;
  const values = new Array(cols * rows).fill(NaN);
  for (const t of tiles) {
    const ox = (t.x - minX) * TS, oy = (t.y - minY) * TS, g = t.grid;
    for (let r = 0; r < TS && r < g.rows; r++)
      for (let c = 0; c < TS && c < g.cols; c++)
        values[(oy + r) * cols + (ox + c)] = g.values[r * g.cols + c];
  }
  return { rows, cols, values, originPxX: minX * TS, originPxY: minY * TS, z };
}

export function makeDemSampler(stitched) {
  const { originPxX, originPxY, z } = stitched;
  return {
    stitched,
    elevationAt(lat, lon) {
      const { x, y } = lonLatToGlobalPx(lat, lon, z);
      return bilinear(stitched, x - originPxX, y - originPxY);
    },
  };
}

// plan height h(u,v) = (elev − ref) / metresPerUnit × verticalExaggeration.
// No-data falls back to the flat reference plane (h = 0).
export function makePlanHeight({ sampler, projector, refElevation, vexag = 1 }) {
  const mpu = projector.metersPerUnit;
  return function planHeight(u, v) {
    const { lat, lon } = projector.toLatLon(u, v);
    const e = sampler.elevationAt(lat, lon);
    if (Number.isNaN(e)) return 0;
    return (e - refElevation) / mpu * vexag;
  };
}
