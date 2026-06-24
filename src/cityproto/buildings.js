import * as THREE from '../vendor/three.module.js';
import { terrainHeight, inHomePlate, inGreen, AVENUES, distToSeg } from './geo.js';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cmask = (u, v) => Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sin(u * 1.25 + 0.5) * Math.cos(v * 1.05 - 0.3) + 0.2 * Math.sin(u * 0.8 - v * 0.9)));

// One big BufferGeometry of low boxes. Vertex colors bake the look: top faces
// light, walls darker toward the base (contact-shadow gradient), denser
// clusters darker overall (faked AO). Real raycast AO arrives in Plan 2.
export function buildBuildings({ SCALE = 6, VSCALE = 5, HSCALE = 1.0 } = {}) {
  const r = rng(20260624);
  const pos = [], col = [], idx = [];
  const fj = AVENUES[1], as = AVENUES[2];
  const pushBox = (u, v, fw, fd, h, topG, cl) => {
    const z0 = terrainHeight(u, v), z1 = z0 + h;
    const x0 = (u - fw) * SCALE, x1 = (u + fw) * SCALE;
    const zc0 = (v - fd - 0.3) * SCALE, zc1 = (v + fd - 0.3) * SCALE;
    const y0 = z0 * VSCALE, y1 = z1 * VSCALE;
    const base = pos.length / 3;
    const C = [[x0, y0, zc0], [x1, y0, zc0], [x1, y0, zc1], [x0, y0, zc1],
              [x0, y1, zc0], [x1, y1, zc0], [x1, y1, zc1], [x0, y1, zc1]];
    for (const c of C) pos.push(c[0], c[1], c[2]);
    const wall = topG * (0.5 - 0.18 * cl), baseG = wall * 0.5, top = topG;
    const cAt = (i) => i >= 4 ? top : baseG;
    for (let i = 0; i < 8; i++) { const g = cAt(i); col.push(g, g, g); }
    const F = [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]];
    for (const f of F) idx.push(base+f[0],base+f[1],base+f[2],base+f[0],base+f[2],base+f[3]);
  };
  for (let v = -0.40; v < 1.30; v += 0.039) {
    for (let u = -1.82; u < 1.72; u += 0.045) {
      const cu = u + (r() - 0.5) * 0.022, cv = v + (r() - 0.5) * 0.022;
      if (Math.abs(cu) < 0.05) continue;            // 大学通り corridor
      if (Math.abs(cv + 0.12) < 0.03) continue;      // 中央線 corridor
      if (inGreen(cu, cv)) continue;
      if (Math.abs(cu) < 0.12 && cv > -0.12 && cv < 0.07) continue; // station footprint
      if (distToSeg(cu, cv, fj) < 0.03 || distToSeg(cu, cv, as) < 0.03) continue;
      const cl = cmask(cu, cv);
      const inH = inHomePlate(cu, cv);
      const north = cv <= -0.08 && cv > -0.40 && Math.abs(cu) < 1.05;
      let pres = inH ? 0.92 : north ? (0.5 * cl + 0.30)
        : Math.max(0.26, Math.min(0.9, 0.5 + 0.30 * Math.sin(cu * 1.3 + 0.4) * Math.cos(cv * 1.2) + 0.12 * Math.sin(cu * 0.6 - cv * 0.8)));
      if (r() > pres) continue;
      const spine = 1 + 0.55 * Math.exp(-Math.abs(cu) * 6.5);
      const h = (0.020 + 0.052 * cl * cl) * spine * (0.7 + 0.6 * r()) * HSCALE;
      const topG = 0.62 + 0.30 * Math.min(1, h * 8);
      pushBox(cu, cv, 0.019 * (0.7 + 0.6 * r()), 0.016 * (0.7 + 0.6 * r()), h, topG, cl);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}
