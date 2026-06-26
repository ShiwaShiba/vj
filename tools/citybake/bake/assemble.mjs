// Assemble the plan-space triangle soup the AO baker will shade: a DEM terrain
// mesh, the fine reveal-layer-1 grid lattice (sampled on the DEM), and extruded
// building prisms (generic field + distinct 旧駅舎 landmark + current station).
//
// World mapping matches the proto: world = (u*SCALE, h*VSCALE, (v - vOffset)*SCALE).

// --- 2D ear-clipping triangulator (for footprint caps) -------------------
const signedArea = (p) => { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[(i + 1) % n]; a += p[i].x * q.y - q.x * p[i].y; } return a / 2; };
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
function pointInTri(px, py, a, b, c) {
  const d1 = cross(b.x - a.x, b.y - a.y, px - a.x, py - a.y);
  const d2 = cross(c.x - b.x, c.y - b.y, px - b.x, py - b.y);
  const d3 = cross(a.x - c.x, a.y - c.y, px - c.x, py - c.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
export function earClip(poly) {
  const n = poly.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  if (signedArea(poly) < 0) idx.reverse();           // make CCW
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10 * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i - 1 + idx.length) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      const A = poly[a], B = poly[b], C = poly[c];
      if (cross(B.x - A.x, B.y - A.y, C.x - A.x, C.y - A.y) <= 0) continue; // reflex
      let ear = true;
      for (const k of idx) { if (k === a || k === b || k === c) continue; if (pointInTri(poly[k].x, poly[k].y, A, B, C)) { ear = false; break; } }
      if (ear) { tris.push([a, b, c]); idx.splice(i, 1); clipped = true; break; }
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// --- geometry helpers ----------------------------------------------------
function pushTri(soup, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const base = soup.positions.length / 3;
  // flat normal
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
  soup.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  for (let i = 0; i < 3; i++) soup.normals.push(nx, ny, nz);
  soup.indices.push(base, base + 1, base + 2);
}
const emptySoup = () => ({ positions: [], normals: [], indices: [] });
const finalize = (s) => ({ positions: new Float32Array(s.positions), normals: new Float32Array(s.normals), indices: new Uint32Array(s.indices) });

// Extrude a projected plan ring [{u,v}] between world baseY..topY into `soup`.
function extrude(soup, ring2d, baseY, topY, SCALE, vOffset) {
  const W = (p) => ({ x: p.u * SCALE, z: (p.v - vOffset) * SCALE });
  const w = ring2d.map(W);
  const n = w.length;
  const tris = earClip(ring2d.map((p) => ({ x: p.u, y: p.v })));
  for (const [a, b, c] of tris) { // top cap (up)
    pushTri(soup, w[a].x, topY, w[a].z, w[b].x, topY, w[b].z, w[c].x, topY, w[c].z);
    pushTri(soup, w[a].x, baseY, w[a].z, w[c].x, baseY, w[c].z, w[b].x, baseY, w[b].z); // bottom (down)
  }
  for (let i = 0; i < n; i++) { // walls
    const j = (i + 1) % n;
    pushTri(soup, w[i].x, baseY, w[i].z, w[j].x, baseY, w[j].z, w[j].x, topY, w[j].z);
    pushTri(soup, w[i].x, baseY, w[i].z, w[j].x, topY, w[j].z, w[i].x, topY, w[i].z);
  }
}

function planCentroid(ring2d) { let u = 0, v = 0; for (const p of ring2d) { u += p.u; v += p.v; } return { u: u / ring2d.length, v: v / ring2d.length }; }
const inBounds = (c, b) => c.u > b.u0 && c.u < b.u1 && c.v > b.v0 && c.v < b.v1;

function buildTerrain({ planHeight, bounds, NX, NV, SCALE, VSCALE, vOffset }) {
  const { u0, u1, v0, v1 } = bounds;
  const positions = [], normals = [], indices = [];
  const D = 0.02;
  for (let j = 0; j <= NV; j++) {
    const v = v0 + (v1 - v0) * (j / NV);
    for (let i = 0; i <= NX; i++) {
      const u = u0 + (u1 - u0) * (i / NX);
      const h = planHeight(u, v);
      positions.push(u * SCALE, h * VSCALE, (v - vOffset) * SCALE);
      const gu = (planHeight(u + D, v) - planHeight(u - D, v)) / (2 * D);
      const gv = (planHeight(u, v + D) - planHeight(u, v - D)) / (2 * D);
      let nx = -gu * VSCALE, ny = SCALE, nz = -gv * VSCALE; const L = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / L, ny / L, nz / L);
    }
  }
  const w = NX + 1;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NX; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; indices.push(a, c, b, b, c, d); }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

function buildTerrainGrid({ planHeight, bounds, gridStep, SCALE, VSCALE, vOffset }) {
  const { u0, u1, v0, v1 } = bounds;
  const positions = [];
  const seg = (a0, b0, a1, b1, n) => {
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const ua = a0 + (a1 - a0) * t0, va = b0 + (b1 - b0) * t0, ub = a0 + (a1 - a0) * t1, vb = b0 + (b1 - b0) * t1;
      positions.push(ua * SCALE, planHeight(ua, va) * VSCALE, (va - vOffset) * SCALE);
      positions.push(ub * SCALE, planHeight(ub, vb) * VSCALE, (vb - vOffset) * SCALE);
    }
  };
  for (let u = u0; u <= u1; u += gridStep) seg(u, v0, u, v1, 30);
  for (let v = v0; v <= v1; v += gridStep) seg(u0, v, u1, v, 40);
  return { positions: new Float32Array(positions) };
}

function extrudeBuilding(soup, footprint, projector, planHeight, params) {
  const { SCALE, VSCALE, vOffset, bounds, mpu } = params;
  const ring2d = footprint.ring.map((p) => projector.toPlan(p.lat, p.lon));
  const c = planCentroid(ring2d);
  if (!inBounds(c, bounds)) return null;
  const baseY = planHeight(c.u, c.v) * VSCALE;
  const bh = (footprint.heightM / mpu) * VSCALE;     // metres -> plan units -> world
  const vStart = soup.positions.length / 3;
  extrude(soup, ring2d, baseY, baseY + bh, SCALE, vOffset);
  return { u: c.u, v: c.v, height: footprint.heightM / mpu, revealKey: Math.hypot(c.u, c.v), vStart, vCount: soup.positions.length / 3 - vStart };
}

export function assembleCity({ osm, projector, planHeight, params }) {
  const mpu = projector.metersPerUnit;
  const P = { SCALE: 6, VSCALE: 5, NX: 120, NV: 80, vOffset: 0.3, gridStep: 0.06, ...params, mpu };

  const terrain = buildTerrain({ planHeight, ...P });
  const terrainGrid = buildTerrainGrid({ planHeight, ...P });

  const bSoup = emptySoup(), perBuilding = [];
  for (const f of osm.footprints) {
    const pb = extrudeBuilding(bSoup, f, projector, planHeight, P);
    if (pb) { pb.type = 'generic'; perBuilding.push(pb); }
  }
  const buildings = { ...finalize(bSoup), perBuilding };

  let landmark = null;
  if (osm.landmark) {
    const lSoup = emptySoup();
    let lm = null;
    if (osm.landmark.ring) {                          // idealize the footprint into a legible gabled monument
      const ring2d = osm.landmark.ring.map((p) => projector.toPlan(p.lat, p.lon));
      const c = planCentroid(ring2d);
      if (inBounds(c, P.bounds)) lm = buildLandmarkGable(lSoup, ring2d, planHeight(c.u, c.v) * P.VSCALE, P, { heightM: Math.max(osm.landmark.heightM, 9) });
    } else {
      lm = pointBox(lSoup, osm.landmark.point, projector, planHeight, P, 14, 9);
    }
    if (lm) { lm.type = 'landmark'; landmark = { ...finalize(lSoup), perBuilding: [lm] }; }
  }

  let station = null;
  if (osm.station && osm.station.point) {
    const sSoup = emptySoup();
    const st = pointBox(sSoup, osm.station.point, projector, planHeight, P, 16, 5); // current station: small, scaled down
    if (st) { st.type = 'station'; station = { ...finalize(sSoup), perBuilding: [st] }; }
  }

  return { terrain, terrainGrid, buildings, landmark, station };
}

// Tuning knobs for the landmark (env, with readable defaults). The baker is a CLI tool;
// unset env ⇒ deterministic defaults, so assembleCity stays test-pure.
function gableTuning() {
  const num = (k, d) => (process.env[k] != null ? +process.env[k] : d);
  return {
    scaleM: num('LM_SCALE', 2.0),      // world units per reference-plan-unit (horizontal) — sets footprint size
    pitchRatio: num('LM_PITCH', 0.175),// vertical:horizontal unit ratio (reference hsc/S → ~51° main gable)
    winDepth: num('LM_WIN_DEPTH', 0.022), // south-facade window recess depth (world)
    winOn: process.env.LM_WIN !== '0', // build the recessed south-facade windows
    archR: num('LM_ARCH_R', 0.020),    // iconic arch window half-width (ref plan-units; _drawStation 0.025 scaled 0.8)
    archSpring: num('LM_ARCH_SPRING', 0.312), // spring line: vertical shaft below, semicircle crown above (wz1)
    archSill: num('LM_ARCH_SILL', 0.216),     // arch window sill height (wz0); window shrunk 0.8 about its centre
    archSeg: Math.max(2, Math.round(num('LM_ARCH_SEG', 8))), // crown facets (matches _drawStation's 8)
  };
}

// The south facade (the camera-facing wall + gable triangle of the main hall), rebuilt
// with the iconic 旧駅舎 windows recessed into it (so the AO bake reads them as dark): the
// big semicircular-arch window at the eave line + three tall windows high in the gable.
// The facade is a stack of trapezoid strips that follow the gable slope (silhouette stays
// clean); window columns are left open and a blind recess (back panel + inward rim) sits
// behind each. Windows carry a half-width profile half(h), so the arch's crown narrows to
// a point (a true half-circle), while rectangular windows keep a constant width. Replaces
// ST_REF faces 0 (S wall) + 4 (S gable).
function addSouthFacade(soup, C) {
  const { Cx, Cz, baseY, M, HZ, mu, mv, vS, uE, hW, hR, depth, archR, archSpring, archSill, archSeg } = C;
  const zS = Cz + (vS - mv) * M;                       // south plane world z (toward the ① camera)
  const Pf = (a, h, d = 0) => ({ x: Cx + (a - mu) * M, y: baseY + h * HZ, z: zS - d }); // d pushes inward (north)
  const wOf = (h) => (h <= hW ? uE : Math.max(0, uE * (hR - h) / (hR - hW))); // facade half-width at height h
  const Nf = [0, 0, 1];                                // outward (south)
  const eps = 1e-9;
  const quad = (c0, c1, c2, c3, n) => { faceTri(soup, c0, c1, c2, n[0], n[1], n[2]); faceTri(soup, c0, c2, c3, n[0], n[1], n[2]); };

  // Each window = { c (centre, plan-u), hB, hT (height span), half(h) (half-width at h) };
  // its opening at height h spans [c−half(h), c+half(h)]. The iconic arch: a vertical shaft
  // (sill→spring) under a true half-circle crown. zr undoes the baker's 0.175 vertical:
  // horizontal squash so the crown reads round in world (matches _drawStation wr/wz0/wz1/zr).
  const wr = archR, wz0 = archSill, wz1 = archSpring, zr = wr / 0.175;
  const archHalf = (h) => {
    if (h <= wz1) return wr;
    const t = (h - wz1) / zr;
    return t >= 1 ? 0 : wr * Math.sqrt(1 - t * t);
  };
  const WIN = [
    { c: 0, hB: wz0, hT: wz1 + zr, half: archHalf },                          // iconic semicircular arch
    { c: -0.008, hB: 0.50, hT: 0.59, half: () => 0.0025 },                    // three tall windows high in the gable
    { c: 0, hB: 0.50, hT: 0.59, half: () => 0.0025 },
    { c: 0.008, hB: 0.50, hT: 0.59, half: () => 0.0025 },
  ];

  // strip boundaries: structural lines + each window's sill/head + the arch-crown facets
  const hbsSet = new Set([0, hW, hR]);
  for (const w of WIN) { hbsSet.add(w.hB); hbsSet.add(w.hT); }
  for (let k = 0; k <= archSeg; k++) hbsSet.add(wz1 + zr * Math.sin((Math.PI / 2) * (k / archSeg)));
  const sorted = [...hbsSet].filter((h) => h >= -eps && h <= hR + eps).sort((a, b) => a - b);
  const hbs = [];                                      // merge near-equal heights (avoid sliver strips)
  for (const h of sorted) if (!hbs.length || h - hbs[hbs.length - 1] > 1e-6) hbs.push(h);

  for (let s = 0; s < hbs.length - 1; s++) {           // facade strips, cut into columns around the window edges
    const h0 = hbs[s], h1 = hbs[s + 1], wb = wOf(h0), wt = wOf(h1);
    const cols = WIN.filter((w) => w.hB <= h0 + eps && w.hT >= h1 - eps).sort((a, b) => a.c - b.c)
      .map((w) => ({ L0: w.c - w.half(h0), L1: w.c - w.half(h1), R0: w.c + w.half(h0), R1: w.c + w.half(h1) }));
    if (cols.length === 0) { quad(Pf(-wb, h0), Pf(wb, h0), Pf(wt, h1), Pf(-wt, h1), Nf); continue; }
    quad(Pf(-wb, h0), Pf(cols[0].L0, h0), Pf(cols[0].L1, h1), Pf(-wt, h1), Nf);                 // left outer column
    for (let i = 0; i < cols.length - 1; i++)                                                   // columns between windows
      quad(Pf(cols[i].R0, h0), Pf(cols[i + 1].L0, h0), Pf(cols[i + 1].L1, h1), Pf(cols[i].R1, h1), Nf);
    const last = cols[cols.length - 1];
    quad(Pf(last.R0, h0), Pf(wb, h0), Pf(wt, h1), Pf(last.R1, h1), Nf);                         // right outer column
  }

  for (const w of WIN) {                               // blind recess behind each window, banded along its profile
    const hs = hbs.filter((h) => h >= w.hB - eps && h <= w.hT + eps);
    for (let k = 0; k < hs.length - 1; k++) {
      const h0 = hs[k], h1 = hs[k + 1];
      const l0 = w.c - w.half(h0), r0 = w.c + w.half(h0), l1 = w.c - w.half(h1), r1 = w.c + w.half(h1);
      if (Math.abs(r1 - l1) < eps) faceTri(soup, Pf(l0, h0, depth), Pf(r0, h0, depth), Pf(w.c, h1, depth), Nf[0], Nf[1], Nf[2]);
      else quad(Pf(l0, h0, depth), Pf(r0, h0, depth), Pf(r1, h1, depth), Pf(l1, h1, depth), Nf); // back panel
      const lx = (h1 - h0) * HZ, ly = -(l1 - l0) * M, ln = lx >= 0 ? [lx, ly, 0] : [-lx, -ly, 0]; // left rim normal (toward +u)
      quad(Pf(l0, h0, 0), Pf(l1, h1, 0), Pf(l1, h1, depth), Pf(l0, h0, depth), ln);              // left rim
      const rx = (h1 - h0) * HZ, ry = -(r1 - r0) * M, rn = rx <= 0 ? [rx, ry, 0] : [-rx, -ry, 0]; // right rim normal (toward −u)
      quad(Pf(r0, h0, 0), Pf(r1, h1, 0), Pf(r1, h1, depth), Pf(r0, h0, depth), rn);              // right rim
    }
    const lB = w.c - w.half(w.hB), rB = w.c + w.half(w.hB);
    quad(Pf(lB, w.hB, 0), Pf(rB, w.hB, 0), Pf(rB, w.hB, depth), Pf(lB, w.hB, depth), [0, 1, 0]); // bottom rim (faces up)
    if (w.half(w.hT) > eps) {                                                                    // flat head (rect windows): top rim
      const lT = w.c - w.half(w.hT), rT = w.c + w.half(w.hT);
      quad(Pf(lT, w.hT, 0), Pf(rT, w.hT, 0), Pf(rT, w.hT, depth), Pf(lT, w.hT, depth), [0, -1, 0]); // top rim (faces down)
    }
  }
}

// push a triangle with the winding that makes its flat normal point along (nx,ny,nz).
function faceTri(soup, P0, P1, P2, nx, ny, nz) {
  const ux = P1.x - P0.x, uy = P1.y - P0.y, uz = P1.z - P0.z;
  const vx = P2.x - P0.x, vy = P2.y - P0.y, vz = P2.z - P0.z;
  const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
  const ccw = gx * nx + gy * ny + gz * nz >= 0;
  const Q = ccw ? P1 : P2, R = ccw ? P2 : P1;
  pushTri(soup, P0.x, P0.y, P0.z, Q.x, Q.y, Q.z, R.x, R.y, R.z);
}

// The 旧国立駅舎 (1926) reference model — a faithful 3D port of the finished canvas-2D
// _drawStation (src/scenes/dots/GroundPlan.js): an asymmetric stepped landmark whose
// identity is a tall steep MAIN gable facing south (the ① camera) over a LOWER west
// cross-wing (its E-W ridge inserts into the main hall → step + valley), plus a low
// south entrance canopy. Measured ratios; +u east, +v south, +z up.
export const ST_REF = (() => {
  const uW = -0.060, uE = 0.060, vS = 0.065, vN = -0.037, hW = 0.26, hR = 0.683;        // MAIN gable (~51°)
  const wuW = -0.140, wuE = -0.050, wvS = 0.058, wvN = -0.026, wRv = 0.016, whW = 0.17, whR = 0.40; // LEFT low gable
  const cuW = -0.062, cuE = 0.062, cvN = 0.065, cvS = 0.118, cb = 0.12, ct = 0.175;     // south canopy
  const verts = [
    [uW, vS, 0], [uE, vS, 0], [uE, vN, 0], [uW, vN, 0],
    [uW, vS, hW], [uE, vS, hW], [uE, vN, hW], [uW, vN, hW], [0, vS, hR], [0, vN, hR],
    [wuW, wvS, 0], [wuE, wvS, 0], [wuE, wvN, 0], [wuW, wvN, 0],
    [wuW, wvS, whW], [wuE, wvS, whW], [wuE, wvN, whW], [wuW, wvN, whW], [wuW, wRv, whR], [wuE, wRv, whR],
    [cuW, cvS, cb], [cuE, cvS, cb], [cuE, cvN, cb], [cuW, cvN, cb],
    [cuW, cvS, ct], [cuE, cvS, ct], [cuE, cvN, ct], [cuW, cvN, ct],
  ];
  const faces = [
    [0, 1, 5, 4], [1, 2, 6, 5], [3, 0, 4, 7], [2, 3, 7, 6],            // main walls S,E,W,N
    [4, 5, 8], [7, 6, 9], [4, 7, 9, 8], [5, 8, 9, 6],                  // main gable + slopes (idx4=S gable)
    [10, 11, 15, 14], [13, 10, 14, 17], [12, 13, 17, 16],             // 小屋 walls S,W,N
    [14, 15, 19, 18], [16, 17, 18, 19], [14, 17, 18],                 // 小屋 S slope, N slope, W gable
    [24, 25, 26, 27], [20, 21, 25, 24], [21, 22, 26, 25], [23, 20, 24, 27], // canopy top,S,E,W
  ];
  let mu = 0, mv = 0; for (const r of verts) { mu += r[0]; mv += r[1]; } mu /= verts.length; mv /= verts.length;
  return { verts, faces, mu, mv, vS, uE, hW, hR };                     // mu,mv = plan centroid; dims for the windowed facade
})();

// Build the ported 旧駅舎 at the footprint centroid, scaled to the baker's world. The
// footprint only supplies placement (centroid); the shape + ratios come from ST_REF.
// Same single material (AO-shaded later); geometry only, deterministic (no RNG).
export function buildLandmarkGable(soup, ring2d, baseY, params, opts = {}) {
  const { SCALE, VSCALE, vOffset } = params;
  const T = gableTuning();
  const M = T.scaleM, HZ = M * T.pitchRatio;   // horizontal & vertical world-per-ref-unit

  let cu = 0, cv = 0;
  for (const p of ring2d) { cu += p.u; cv += p.v; }
  cu /= ring2d.length; cv /= ring2d.length;
  const Cx = cu * SCALE, Cz = (cv - vOffset) * SCALE; // world anchor; +v(south) → +z (toward ① camera)

  // ref(u,v,z) → world, centred on the model plan-centroid so the main hall sits on the anchor
  const Wv = ST_REF.verts.map((r) => ({ x: Cx + (r[0] - ST_REF.mu) * M, y: baseY + r[2] * HZ, z: Cz + (r[1] - ST_REF.mv) * M }));
  let mx = 0, my = 0, mz = 0;
  for (const p of Wv) { mx += p.x; my += p.y; mz += p.z; } mx /= Wv.length; my /= Wv.length; mz /= Wv.length;

  const vStart = soup.positions.length / 3;
  let maxY = baseY;
  // the two camera-facing south faces (wall idx0 + gable idx4) are replaced by the windowed facade
  const skip = T.winOn ? new Set([0, 4]) : new Set();
  for (let fi = 0; fi < ST_REF.faces.length; fi++) {
    if (skip.has(fi)) continue;
    const id = ST_REF.faces[fi];
    const P = id.map((i) => Wv[i]);
    // outward face normal = geometric normal flipped to point away from the model centroid
    const ax = P[1].x - P[0].x, ay = P[1].y - P[0].y, az = P[1].z - P[0].z;
    const bx = P[2].x - P[0].x, by = P[2].y - P[0].y, bz = P[2].z - P[0].z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    let fx = 0, fy = 0, fz = 0; for (const p of P) { fx += p.x; fy += p.y; fz += p.z; } fx /= P.length; fy /= P.length; fz /= P.length;
    if ((fx - mx) * nx + (fy - my) * ny + (fz - mz) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (let j = 1; j < P.length - 1; j++) faceTri(soup, P[0], P[j], P[j + 1], nx, ny, nz); // fan-triangulate the polygon
    for (const p of P) if (p.y > maxY) maxY = p.y;
  }
  if (T.winOn) addSouthFacade(soup, { Cx, Cz, baseY, M, HZ, mu: ST_REF.mu, mv: ST_REF.mv, vS: ST_REF.vS, uE: ST_REF.uE, hW: ST_REF.hW, hR: ST_REF.hR, depth: T.winDepth, archR: T.archR, archSpring: T.archSpring, archSill: T.archSill, archSeg: T.archSeg });

  return { u: cu, v: cv, height: (maxY - baseY) / VSCALE, revealKey: Math.hypot(cu, cv), vStart, vCount: soup.positions.length / 3 - vStart };
}

// A small distinct block at a point (footprint-less station/landmark nodes).
function pointBox(soup, point, projector, planHeight, params, widthM, heightM) {
  const { SCALE, VSCALE, vOffset, bounds, mpu } = params;
  const c = projector.toPlan(point.lat, point.lon);
  if (!inBounds(c, bounds)) return null;
  const r = (widthM / mpu) / 2;
  const ring2d = [{ u: c.u - r, v: c.v - r }, { u: c.u + r, v: c.v - r }, { u: c.u + r, v: c.v + r }, { u: c.u - r, v: c.v + r }];
  const baseY = planHeight(c.u, c.v) * VSCALE, bh = (heightM / mpu) * VSCALE;
  const vStart = soup.positions.length / 3;
  extrude(soup, ring2d, baseY, baseY + bh, SCALE, vOffset);
  return { u: c.u, v: c.v, height: heightM / mpu, revealKey: Math.hypot(c.u, c.v), vStart, vCount: soup.positions.length / 3 - vStart };
}
