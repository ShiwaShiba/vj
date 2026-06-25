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

// Tuning knobs for the landmark gable (env, with readable defaults). The baker is a
// CLI tool; unset env ⇒ deterministic defaults, so assembleCity stays test-pure.
// Defaults chosen by eye (CPU-rasterized previews at the ①hero framing): a tall, steep,
// south-facing gable reads as the iconic 1926 三角屋根 even when small in frame, and stands
// above its neighbours as the monument. Overridable per-bake via env for further tuning.
function gableTuning() {
  return {
    hScale: +process.env.LM_HSCALE || 2.2,                          // ridge-height boost for prominence
    eaveFrac: process.env.LM_EAVE != null ? +process.env.LM_EAVE : 0.30, // wall top as a fraction of total H (low walls, tall roof)
    peakFrac: process.env.LM_PEAK != null ? +process.env.LM_PEAK : 1.0,  // ridge as a fraction of total H
    ridgeAxis: process.env.RIDGE_AXIS === 'long' ? 'long' : 'short',      // gable END faces the ① camera (south) by default
  };
}

// Idealize the 旧国立駅舎 footprint into a clean gabled monument: a PCA-oriented
// rectangular box (walls baseY→eaveY) capped by a triangular roof that rises to a
// ridge along the long axis. Gives the 1926 三角屋根 a legible silhouette at the
// ①hero framing, where the raw OSM polygon would just read as a flat box. Same single
// material (AO-shaded later); geometry only. Deterministic (no RNG). Returns a
// perBuilding entry of the same shape extrudeBuilding/pointBox produce.
export function buildLandmarkGable(soup, ring2d, baseY, params, opts = {}) {
  const { SCALE, VSCALE, vOffset, mpu } = params;
  const T = gableTuning();

  // --- PCA: centroid + 2×2 covariance → larger-eigenvalue eigenvector = long axis ---
  let cu = 0, cv = 0;
  for (const p of ring2d) { cu += p.u; cv += p.v; }
  cu /= ring2d.length; cv /= ring2d.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of ring2d) { const du = p.u - cu, dv = p.v - cv; sxx += du * du; sxy += du * dv; syy += dv * dv; }
  const tr = sxx + syy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - (sxx * syy - sxy * sxy)));
  const lam = tr / 2 + disc;                       // larger eigenvalue
  let e1u, e1v;
  if (Math.abs(sxy) > 1e-12) { e1u = lam - syy; e1v = sxy; }
  else { e1u = sxx >= syy ? 1 : 0; e1v = sxx >= syy ? 0 : 1; }
  const eL = Math.hypot(e1u, e1v) || 1; e1u /= eL; e1v /= eL;
  if (e1u < 0 || (e1u === 0 && e1v < 0)) { e1u = -e1u; e1v = -e1v; } // sign canonicalization (deterministic)
  let e2u = -e1v, e2v = e1u;

  // half-extents along the two axes (oriented bounding box)
  let L = 0, Wd = 0;
  for (const p of ring2d) {
    const du = p.u - cu, dv = p.v - cv;
    L = Math.max(L, Math.abs(du * e1u + dv * e1v));
    Wd = Math.max(Wd, Math.abs(du * e2u + dv * e2v));
  }
  if (T.ridgeAxis === 'short') { [e1u, e2u] = [e2u, e1u]; [e1v, e2v] = [e2v, e1v]; [L, Wd] = [Wd, L]; }

  // --- heights: walls to eave, roof to ridge ---
  const H = (Math.max(opts.heightM ?? 9, 9) / mpu) * VSCALE * T.hScale;
  const eaveY = baseY + H * T.eaveFrac;
  const ridgeY = baseY + H * T.peakFrac;

  // plan corners (e1,e2 frame) + world projector
  const cor = (s1, s2) => ({ u: cu + s1 * L * e1u + s2 * Wd * e2u, v: cv + s1 * L * e1v + s2 * Wd * e2v });
  const A = cor(-1, -1), B = cor(+1, -1), C = cor(+1, +1), D = cor(-1, +1);
  const R0 = { u: cu - L * e1u, v: cv - L * e1v }, R1 = { u: cu + L * e1u, v: cv + L * e1v };
  const W = (p, y) => ({ x: p.u * SCALE, y, z: (p.v - vOffset) * SCALE });
  const Aw = W(A, eaveY), Bw = W(B, eaveY), Cw = W(C, eaveY), Dw = W(D, eaveY);
  const R0w = W(R0, ridgeY), R1w = W(R1, ridgeY);

  const vStart = soup.positions.length / 3;
  // walls: reuse the box extruder (its eave-height top cap sits hidden under the roof)
  extrude(soup, [A, B, C, D], baseY, eaveY, SCALE, vOffset);

  // roof: push each tri with the winding that makes its flat normal point outward
  const face = (P0, P1, P2, nx, ny, nz) => {
    const ux = P1.x - P0.x, uy = P1.y - P0.y, uz = P1.z - P0.z;
    const vx = P2.x - P0.x, vy = P2.y - P0.y, vz = P2.z - P0.z;
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const ccw = gx * nx + gy * ny + gz * nz >= 0;
    const Q = ccw ? P1 : P2, R = ccw ? P2 : P1;
    pushTri(soup, P0.x, P0.y, P0.z, Q.x, Q.y, Q.z, R.x, R.y, R.z);
  };
  face(Cw, Dw, R0w, e2u, 0.5, e2v); face(Cw, R0w, R1w, e2u, 0.5, e2v);   // +e2 slope
  face(Bw, Aw, R0w, -e2u, 0.5, -e2v); face(Bw, R0w, R1w, -e2u, 0.5, -e2v); // -e2 slope
  face(Bw, Cw, R1w, e1u, 0, e1v);                                          // +e1 gable end
  face(Aw, Dw, R0w, -e1u, 0, -e1v);                                        // -e1 gable end

  return { u: cu, v: cv, height: (ridgeY - baseY) / VSCALE, revealKey: Math.hypot(cu, cv), vStart, vCount: soup.positions.length / 3 - vStart };
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
