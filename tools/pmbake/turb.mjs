// Measure turbulence structure from video frames (all grayscale, same w×h).
// Pure: same frames -> same profile. No Date/random.

export function downsample(frame, dim) {
  const { w, h, lum } = frame;
  const g = new Float32Array(dim * dim);
  for (let gy = 0; gy < dim; gy++) {
    const y0 = (gy * h / dim) | 0, y1 = Math.max(y0 + 1, ((gy + 1) * h / dim) | 0);
    for (let gx = 0; gx < dim; gx++) {
      const x0 = (gx * w / dim) | 0, x1 = Math.max(x0 + 1, ((gx + 1) * w / dim) | 0);
      let s = 0, c = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum[y * w + x]; c++; }
      g[gy * dim + gx] = s / c;
    }
  }
  return g;
}

export function structureTensor(grid, dim) {
  let Jxx = 0, Jyy = 0, Jxy = 0;
  for (let y = 1; y < dim - 1; y++) for (let x = 1; x < dim - 1; x++) {
    const gx = grid[y * dim + x + 1] - grid[y * dim + x - 1];
    const gy = grid[(y + 1) * dim + x] - grid[(y - 1) * dim + x];
    Jxx += gx * gx; Jyy += gy * gy; Jxy += gx * gy;
  }
  const tr = Jxx + Jyy;
  const diff = Math.sqrt((Jxx - Jyy) * (Jxx - Jyy) + 4 * Jxy * Jxy);
  const l1 = (tr + diff) / 2, l2 = (tr - diff) / 2;
  const coherence = tr > 1e-6 ? (l1 - l2) / (l1 + l2) : 0;
  // gradient orientation; filaments run perpendicular (+90°)
  const gradAngle = 0.5 * Math.atan2(2 * Jxy, Jxx - Jyy);
  return { angle: gradAngle + Math.PI / 2, coherence };
}

export function centroidDrift(frames) {
  const cs = frames.map((f) => {
    const { w, h, lum } = f; let sx = 0, sy = 0, s = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const L = lum[y * w + x]; sx += x * L; sy += y * L; s += L; }
    return s > 1e-6 ? { x: sx / s, y: sy / s, w, h } : { x: w / 2, y: h / 2, w, h };
  });
  let dx = 0, dy = 0, d = 0;
  for (let i = 1; i < cs.length; i++) { dx += cs[i].x - cs[i - 1].x; dy += cs[i].y - cs[i - 1].y; d += Math.hypot(cs[i].x - cs[i - 1].x, cs[i].y - cs[i - 1].y); }
  const n = Math.max(1, cs.length - 1);
  const W = frames[0].w;
  // image y is down; flip to math-up so angle 0 = +x (right), positive = up
  const angle = Math.atan2(-dy / n, dx / n);
  return { angle, streak: (d / n) / W };
}

function autocorrScale(grid, dim) {
  // mean over rows of horizontal autocorrelation; find lag where it drops to 1/e
  let m = 0; for (const v of grid) m += v; m /= grid.length;
  const c0 = (() => { let s = 0; for (const v of grid) s += (v - m) * (v - m); return s / grid.length || 1; })();
  for (let lag = 1; lag < dim; lag++) {
    let s = 0, cnt = 0;
    for (let y = 0; y < dim; y++) for (let x = 0; x + lag < dim; x++) { s += (grid[y * dim + x] - m) * (grid[y * dim + x + lag] - m); cnt++; }
    const c = (s / cnt) / c0;
    if (c < Math.exp(-1)) return lag / dim;
  }
  return 0.5;
}

function maskCorners(density, dim) {
  // neutralize IG-UI corner marks: set a corner block to the global median
  const sorted = Float32Array.from(density).sort();
  const med = sorted[sorted.length >> 1];
  const b = Math.max(1, (dim * 0.12) | 0);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const corner = (x < b || x >= dim - b) && (y < b || y >= dim - b);
    if (corner) density[y * dim + x] = med;
  }
}

export function measureTurb(frames, dim = 64) {
  const grids = frames.map((f) => downsample(f, dim));
  // mean density map
  const dens = new Float32Array(dim * dim);
  for (const g of grids) for (let i = 0; i < g.length; i++) dens[i] += g[i];
  for (let i = 0; i < dens.length; i++) dens[i] /= grids.length;
  maskCorners(dens, dim);
  let lo = Infinity, hi = -Infinity;
  for (const v of dens) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const density = new Uint8Array(dim * dim);
  for (let i = 0; i < dens.length; i++) density[i] = Math.round(((dens[i] - lo) / span) * 255);
  // direction & anisotropy from a late, well-developed frame's grid
  const late = grids[grids.length - 1];
  const st = structureTensor(late, dim);
  const drift = centroidDrift(frames);
  // prefer signed drift direction when motion is meaningful, else tensor axis
  const flowAngle = drift.streak > 0.002 ? drift.angle : st.angle;
  // luminance stats (0..1)
  let sum = 0, cnt = 0; const vals = [];
  for (const g of grids) for (const v of g) { sum += v; cnt++; vals.push(v); }
  vals.sort((a, b) => a - b);
  const mean = sum / cnt / 255;
  const p50 = vals[(vals.length * 0.5) | 0], p95 = vals[(vals.length * 0.95) | 0];
  return {
    dim, density,
    flowAngle, coherence: st.coherence,
    scale: autocorrScale(late, dim),
    streakLen: drift.streak,
    mean, contrast: Math.max(0, (p95 - p50) / 255),
  };
}
