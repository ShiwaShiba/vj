// Real raycast ambient occlusion bake. For every vertex we cast a cosine-
// weighted hemisphere of rays about its normal and count occlusions against the
// scene's triangle soup, accelerated by a uniform XZ grid (the scene is ~2.5D).
// We reuse three.js' Raycaster for the actual ray/triangle intersection — the
// vendored three.module.js runs headless in Node. AO × a soft slope-light term
// is baked into monochrome vertex colours (the proto's look, now from real geo).
import * as THREE from '../../../src/vendor/three.module.js';

const L0 = [-0.45, 0.82, -0.35];
const LL = Math.hypot(L0[0], L0[1], L0[2]);
const Lx = L0[0] / LL, Ly = L0[1] / LL, Lz = L0[2] / LL;

// deterministic per-vertex jitter + van der Corput radical inverse (base 2)
function hash01(i, seed) { let h = Math.imul(i ^ seed, 0x9e3779b1) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; }
function radicalInverse2(i) { let r = 0, f = 0.5; while (i > 0) { r += f * (i & 1); i >>>= 1; f *= 0.5; } return r; }

// cosine-weighted hemisphere direction (u1,u2) about normal n
function hemisphereDir(n, u1, u2, out) {
  const r = Math.sqrt(u1), theta = 2 * Math.PI * u2;
  const lx = r * Math.cos(theta), ly = r * Math.sin(theta), lz = Math.sqrt(Math.max(0, 1 - u1));
  // tangent basis around n
  const a = Math.abs(n.x) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  let tx = a[1] * n.z - a[2] * n.y, ty = a[2] * n.x - a[0] * n.z, tz = a[0] * n.y - a[1] * n.x;
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  const bx = n.y * tz - n.z * ty, by = n.z * tx - n.x * tz, bz = n.x * ty - n.y * tx;
  out.set(tx * lx + bx * ly + n.x * lz, ty * lx + by * ly + n.y * lz, tz * lx + bz * ly + n.z * lz).normalize();
}

// uniform XZ grid: cell -> list of triangle indices
function buildGrid(positions, indices, cell) {
  const grid = new Map();
  const key = (cx, cz) => cx + ',' + cz;
  const add = (cx, cz, t) => { const k = key(cx, cz); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(t); };
  for (let t = 0; t < indices.length; t += 3) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let e = 0; e < 3; e++) { const vi = indices[t + e]; const x = positions[vi * 3], z = positions[vi * 3 + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
      for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) add(cx, cz, t);
  }
  return grid;
}

export function bakeAO(soup, opts = {}) {
  const { rays = 24, radius = 1.0, seed = 1, ambient = 0.35, aoStrength = 1 } = opts;
  const baseGreyOpt = opts.baseGrey ?? 0.8;
  const contactStrength = opts.contactStrength ?? 0;
  const contactRadius = Math.min(opts.contactRadius ?? radius * 0.3, radius);
  const contactMask = opts.contactMask ?? null;
  const { positions, indices, normals } = soup;
  const nv = positions.length / 3;
  const cell = radius;
  const ring = Math.ceil(radius / cell) + 1;
  const grid = buildGrid(positions, indices, cell);

  // bin vertices by cell so we build each candidate mesh once per occupied cell
  const vcells = new Map();
  for (let i = 0; i < nv; i++) { const cx = Math.floor(positions[i * 3] / cell), cz = Math.floor(positions[i * 3 + 2] / cell); const k = cx + ',' + cz; let a = vcells.get(k); if (!a) vcells.set(k, a = { cx, cz, v: [] }); a.v.push(i); }

  const colors = new Float32Array(nv * 3);
  const rc = new THREE.Raycaster(); rc.near = 1e-4; rc.far = radius;
  const origin = new THREE.Vector3(), dir = new THREE.Vector3(), n = new THREE.Vector3();
  const eps = radius * 0.01;
  const greyOf = (i) => (typeof baseGreyOpt === 'function' ? baseGreyOpt(i) : (baseGreyOpt.length ? baseGreyOpt[i] : baseGreyOpt));

  for (const { cx, cz, v } of vcells.values()) {
    // gather candidate triangles from the cell neighbourhood
    const set = new Set();
    for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) { const a = grid.get((cx + dx) + ',' + (cz + dz)); if (a) for (const t of a) set.add(t); }
    let mesh = null;
    if (set.size) {
      const pos = new Float32Array(set.size * 9); let o = 0;
      for (const t of set) for (let e = 0; e < 3; e++) { const vi = indices[t + e]; pos[o++] = positions[vi * 3]; pos[o++] = positions[vi * 3 + 1]; pos[o++] = positions[vi * 3 + 2]; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeBoundingSphere();
      mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(true);
    }
    for (const i of v) {
      n.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
      let occ = 0, occContact = 0;
      if (mesh) {
        origin.set(positions[i * 3] + n.x * eps, positions[i * 3 + 1] + n.y * eps, positions[i * 3 + 2] + n.z * eps);
        for (let s = 0; s < rays; s++) {
          const u1 = (s + 0.5) / rays;
          const u2 = (radicalInverse2(s + 1) + hash01(i, seed)) % 1;
          hemisphereDir(n, u1, u2, dir);
          rc.set(origin, dir);
          const hits = rc.intersectObject(mesh, false); // sorted ascending by distance
          if (hits.length) {
            occ++;
            // soft falloff: nearer occluders weigh more; beyond contactRadius → 0.
            const w = 1 - hits[0].distance / contactRadius;
            if (w > 0) occContact += w;
          }
        }
      }
      // Two-scale AO: wide ambient (unchanged) × short-radius contact, gated to
      // generic buildings via contactMask. contactStrength=0 → contactAO=1 → ao===ambientAO.
      const cmask = contactMask ? contactMask[i] : 1;
      const ambientAO = 1 - aoStrength * (occ / rays); // aoStrength < 1 → soft contact shadow, not heavy darkening
      const contactAO = 1 - contactStrength * cmask * (occContact / rays);
      const ao = ambientAO * contactAO;
      const light = ambient + (1 - ambient) * Math.max(0, n.x * Lx + n.y * Ly + n.z * Lz);
      const grey = Math.max(0, Math.min(1, greyOf(i) * light * ao));
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = grey;
    }
  }
  return colors;
}
