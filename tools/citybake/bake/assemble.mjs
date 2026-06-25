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
    const lm = osm.landmark.ring
      ? extrudeBuilding(lSoup, { ...osm.landmark, heightM: Math.max(osm.landmark.heightM, 9) }, projector, planHeight, P)
      : pointBox(lSoup, osm.landmark.point, projector, planHeight, P, 14, 9);
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
