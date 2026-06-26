// Shared ground-height sampler for trees.js + particles.js.
//
// Both layers drop each canopy / particle column onto the DEM by finding the terrain
// surface height at an (x,z). The old idiom raycast the FULL terrain mesh (~68k tris,
// no acceleration structure) once PER emitter — O(triangles) × N — which dominated
// startup (~8 s for the few-thousand trees + particles). The terrain is a single-valued
// heightfield, so we bucket its triangles into an xz grid ONCE and each query tests only
// the handful of triangles in its cell: O(1) amortised, returning the SAME interpolated
// height as the downward raycast (verified against THREE.Raycaster in the tests).

// PURE core (no THREE — node-testable). Inputs are WORLD-space vertex arrays + optional
// index buffer. Returns { sample(qx,qz) } where sample mirrors a vertical raycast: the
// interpolated surface y at (qx,qz), or 0 when no triangle covers the point (matches the
// raycast's no-hit fallback).
export function buildGroundGrid({ wx, wy, wz, index, triCount }, opts = {}) {
  const EPS = opts.eps ?? 1e-7;           // barycentric edge tolerance (points on a shared edge)
  const nv = wx.length;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = wx[i], z = wz[i];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  // ~sqrt(triCount) cells per axis ⇒ a few triangles per cell for a regular heightfield.
  const cols = Math.max(1, Math.min(2048, Math.round(Math.sqrt(triCount))));
  const rows = cols;
  const spanX = (maxX - minX) || 1, spanZ = (maxZ - minZ) || 1;
  const cw = spanX / cols, ch = spanZ / rows;
  const clampCx = (cx) => (cx < 0 ? 0 : cx >= cols ? cols - 1 : cx);
  const clampCz = (cz) => (cz < 0 ? 0 : cz >= rows ? rows - 1 : cz);
  const vi = (t, k) => { const o = t * 3 + k; return index ? index[o] : o; };

  const buckets = new Array(cols * rows);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
    const tMinX = Math.min(wx[a], wx[b], wx[c]), tMaxX = Math.max(wx[a], wx[b], wx[c]);
    const tMinZ = Math.min(wz[a], wz[b], wz[c]), tMaxZ = Math.max(wz[a], wz[b], wz[c]);
    const cx0 = clampCx(Math.floor((tMinX - minX) / cw)), cx1 = clampCx(Math.floor((tMaxX - minX) / cw));
    const cz0 = clampCz(Math.floor((tMinZ - minZ) / ch)), cz1 = clampCz(Math.floor((tMaxZ - minZ) / ch));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) buckets[cz * cols + cx].push(t);
  }

  function sample(qx, qz) {
    if (qx < minX || qx > maxX || qz < minZ || qz > maxZ) return 0;   // outside terrain ⇒ no hit
    const cx = clampCx(Math.floor((qx - minX) / cw)), cz = clampCz(Math.floor((qz - minZ) / ch));
    const cell = buckets[cz * cols + cx];
    let bestY = null;
    for (let j = 0; j < cell.length; j++) {
      const t = cell[j], a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
      const ax = wx[a], az = wz[a], bx = wx[b], bz = wz[b], cxx = wx[c], czz = wz[c];
      const d = (bz - czz) * (ax - cxx) + (cxx - bx) * (az - czz);
      if (Math.abs(d) < 1e-14) continue;                              // degenerate (zero xz-area) triangle
      const wa = ((bz - czz) * (qx - cxx) + (cxx - bx) * (qz - czz)) / d;
      const wb = ((czz - az) * (qx - cxx) + (ax - cxx) * (qz - czz)) / d;
      const wc = 1 - wa - wb;
      if (wa < -EPS || wb < -EPS || wc < -EPS) continue;              // outside this triangle
      const y = wa * wy[a] + wb * wy[b] + wc * wy[c];
      if (bestY === null || y > bestY) bestY = y;                     // topmost = first hit of a downward ray
    }
    return bestY === null ? 0 : bestY;
  }
  return { sample, cols, rows, minX, maxX, minZ, maxZ };
}

// THREE wrapper: bake terrain.matrixWorld into world-space verts (the glb terrain node
// carries the KHR-quantization TRS, so local≠world), then build the grid. Returns a bare
// groundY(wx,wz) function — a drop-in for the old raycast idiom in trees.js / particles.js.
export function makeGroundSampler(terrain, opts = {}) {
  terrain.updateWorldMatrix(true, false);
  const pos = terrain.geometry.attributes.position;
  const index = terrain.geometry.index ? terrain.geometry.index.array : null;
  const e = terrain.matrixWorld.elements;
  const nv = pos.count;
  const wx = new Float64Array(nv), wy = new Float64Array(nv), wz = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    wx[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    wy[i] = e[1] * x + e[5] * y + e[9] * z + e[13];
    wz[i] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  const triCount = index ? index.length / 3 : nv / 3;
  const grid = buildGroundGrid({ wx, wy, wz, index, triCount }, opts);
  return (qx, qz) => grid.sample(qx, qz);
}
