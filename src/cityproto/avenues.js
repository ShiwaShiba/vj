import * as THREE from '../vendor/three.module.js';

// Roads built from the baked manifest polylines ([u,v,h], height baked so they
// hug the DEM), lifted slightly and rendered last (depthTest off) so they never
// get buried by the carpet. Two tiers: the bright white primary avenues (国立の
// 象徴) on top, and a readable grey secondary arterial network beneath them.
export function buildAvenues(manifest, { lift = 0.012 } = {}) {
  const { SCALE, VSCALE, vOffset } = manifest.scale;
  const group = new THREE.Group();
  const toW = ([u, v, h]) => new THREE.Vector3(u * SCALE, (h + lift) * VSCALE, (v - vOffset) * SCALE);

  // --- secondary arterial network: one merged LineSegments (1 draw call), grey,
  //     below the avenues so the symbolic fan still dominates ---
  const segPts = [];
  for (const r of manifest.roads) {
    if (r.primary || r.name === 'chuo') continue;
    const pts = r.points.map(toW);
    if (pts.length < 2) continue;
    for (let i = 0; i + 1 < pts.length; i++) { segPts.push(pts[i], pts[i + 1]); } // polyline → segment pairs
  }
  if (segPts.length) {
    const sg = new THREE.BufferGeometry().setFromPoints(segPts);
    const secondary = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({
      color: 0x9aa0a8,   // light-mid grey (gamma-lifted on output) — clearly below white
      transparent: true,
      opacity: 0.68,     // clearly readable over the building carpet, below the avenues
      depthTest: false,  // sit on top of terrain/buildings; no z-fight vs the DEM
    }));
    secondary.renderOrder = 6; // below avenues (10) + chuo (11-12), above terrain/grid
    group.add(secondary);
  }

  // --- primary avenues: bright white, per-road (so per-name opacity survives), on top ---
  for (const r of manifest.roads) {
    if (!r.primary || r.name === 'chuo') continue; // chuo is the railway (station.js)
    const pts = r.points.map(toW);
    if (pts.length < 2) continue;
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const op = r.name.includes('大学通り') ? 0.95 : 0.9;
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op, depthTest: false }));
    line.renderOrder = 10;
    group.add(line);
  }
  return group;
}
