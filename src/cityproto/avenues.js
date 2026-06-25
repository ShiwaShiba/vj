import * as THREE from '../vendor/three.module.js';
import { terrainHeight, AVENUES } from './geo.js';

// Bright primary roads, slightly lifted off the terrain and rendered last
// (depthTest off) so they never get buried by the carpet — 国立の象徴.
export function buildAvenues({ SCALE = 6, VSCALE = 5, LIFT = 0.012 } = {}) {
  const group = new THREE.Group();
  for (const a of AVENUES) {
    if (a.name === 'chuo') continue; // railway is drawn by station.js (crisp double track)
    const pts = [];
    const N = 40;
    for (let k = 0; k <= N; k++) {
      const t = k / N, u = a.ax + (a.bx - a.ax) * t, v = a.av + (a.bv - a.av) * t;
      pts.push(new THREE.Vector3(u * SCALE, (terrainHeight(u, v) + LIFT) * VSCALE, (v - 0.3) * SCALE));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: a.bright, depthTest: false });
    const line = new THREE.Line(g, m); line.renderOrder = 10;
    group.add(line);
  }
  return group;
}
