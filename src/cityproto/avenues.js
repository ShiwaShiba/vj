import * as THREE from '../vendor/three.module.js';

// Bright primary roads built from the baked manifest polylines ([u,v,h], height
// baked so they hug the DEM), lifted slightly and rendered last (depthTest off)
// so they never get buried by the carpet — 国立の象徴.
export function buildAvenues(manifest, { lift = 0.012 } = {}) {
  const { SCALE, VSCALE, vOffset } = manifest.scale;
  const group = new THREE.Group();
  for (const r of manifest.roads) {
    if (!r.primary || r.name === 'chuo') continue; // chuo is the railway (station.js)
    const pts = r.points.map(([u, v, h]) => new THREE.Vector3(u * SCALE, (h + lift) * VSCALE, (v - vOffset) * SCALE));
    if (pts.length < 2) continue;
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const op = r.name.includes('大学通り') ? 0.95 : 0.9;
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op, depthTest: false }));
    line.renderOrder = 10;
    group.add(line);
  }
  return group;
}
