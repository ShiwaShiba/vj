import * as THREE from '../vendor/three.module.js';
import { terrainHeight } from './geo.js';

// Faked soft light baked into vertex colors (MeshBasicMaterial is unlit). The
// surface normal (from the height gradient, exaggerated K so the delicate relief
// reads) is lit by a fixed direction -> gentle slope shading. Terrain stays a
// DARK quiet base; buildings carry the brightness. True raycast AO arrives in Plan 2.
const Lx = -0.45, Ly = 0.82, Lz = -0.35, LL = Math.hypot(Lx, Ly, Lz);

export function buildTerrain({ SCALE = 6, VSCALE = 5, NX = 120, NV = 80 } = {}) {
  const u0 = -1.85, u1 = 1.72, v0 = -0.42, v1 = 1.3;
  const pos = [], col = [], idx = [];
  const H = (u, v) => terrainHeight(u, v);
  const D = 0.04, K = 9;
  for (let j = 0; j <= NV; j++) {
    const v = v0 + (v1 - v0) * (j / NV);
    for (let i = 0; i <= NX; i++) {
      const u = u0 + (u1 - u0) * (i / NX);
      const h = H(u, v);
      pos.push(u * SCALE, h * VSCALE, (v - 0.3) * SCALE);
      const gu = (H(u + D, v) - H(u - D, v)) / (2 * D) * K;
      const gv = (H(u, v + D) - H(u, v - D)) / (2 * D) * K;
      const nx = -gu, ny = 1, nz = -gv, nl = Math.hypot(nx, ny, nz);
      const sh = Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / nl / LL);
      const ao = THREE.MathUtils.clamp(0.045 + 0.13 * sh, 0.035, 0.19);
      col.push(ao, ao, ao);
    }
  }
  const w = NX + 1;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NX; i++) {
    const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
}

// Thin grid overlay so the terrain reads as an undulating lattice (reveal layer 1).
export function buildTerrainGrid({ SCALE = 6, VSCALE = 5 } = {}) {
  const pts = [], step = 0.085;
  const seg = (a0, b0, a1, b1, n) => {
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const ua = a0 + (a1 - a0) * t0, va = b0 + (b1 - b0) * t0;
      const ub = a0 + (a1 - a0) * t1, vb = b0 + (b1 - b0) * t1;
      pts.push(ua * SCALE, terrainHeight(ua, va) * VSCALE, (va - 0.3) * SCALE);
      pts.push(ub * SCALE, terrainHeight(ub, vb) * VSCALE, (vb - 0.3) * SCALE);
    }
  };
  for (let u = -1.8; u <= 1.7; u += step) seg(u, -0.42, u, 1.3, 30);
  for (let v = -0.4; v <= 1.28; v += step) seg(-1.82, v, 1.72, v, 40);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb0b8c4, transparent: true, opacity: 0.12 }));
}
