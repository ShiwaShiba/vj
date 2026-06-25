import * as THREE from '../vendor/three.module.js';

// Monochrome vegetation instancing (Plan 3, option B). Fills the southern void —
// 一橋大学キャンパス + parks (manifest.green rects) — and lines 大学通り (the iconic
// 並木道) with low grey canopies so the foreground reads as planted ground, not
// black emptiness. Greys only (守る線: monochrome, no chroma). Canopies are
// raycast onto the baked DEM terrain so they sit on the real relief.
export function buildTrees(manifest, terrain, opts = {}) {
  const { SCALE, VSCALE, vOffset } = manifest.scale;
  const bounds = opts.bounds || { u0: -1.85, u1: 1.72, v0: -0.42, v1: 1.3 };
  const cell = opts.cell ?? 0.028;        // ~12 m thinning grid (prevents clumping)
  const radius = opts.radius ?? 0.072;    // canopy radius in world units (~5 m)
  const avenueOffset = opts.avenueOffset ?? 0.022;

  // seeded xorshift → stable layout across reloads (looks intentional, not flickering)
  let s = 0x2545f491 >>> 0;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

  const inB = (u, v) => u > bounds.u0 && u < bounds.u1 && v > bounds.v0 && v < bounds.v1;

  // grid-thin: one plant per occupied cell, dedupes overlapping green rects
  const taken = new Set();
  const plant = (u, v, pts) => {
    if (!inB(u, v)) return;
    const k = Math.floor(u / cell) + ',' + Math.floor(v / cell);
    if (taken.has(k)) return;
    taken.add(k);
    pts.push([u, v]);
  };

  const pts = [];
  // 1. scatter within green rects (oversample → grid thinning fills cells evenly)
  for (const rect of manifest.green) {
    const [a0, b0, a1, b1] = rect;
    const u0 = Math.min(a0, a1), v0 = Math.min(b0, b1);
    const du = Math.abs(a1 - a0), dv = Math.abs(b1 - b0);
    const n = Math.min(240, Math.max(6, Math.round((du * dv) / (cell * cell) * 3)));
    for (let i = 0; i < n; i++) plant(u0 + rnd() * du, v0 + rnd() * dv, pts);
  }
  // 2. line 大学通り both sides — the 並木道
  for (const r of manifest.roads) {
    if (!r.name || !r.name.includes('大学通り')) continue;
    const P = r.points;
    for (let i = 0; i + 1 < P.length; i++) {
      const au = P[i][0], av = P[i][1], bu = P[i + 1][0], bv = P[i + 1][1];
      const segLen = Math.hypot(bu - au, bv - av);
      const steps = Math.max(1, Math.round(segLen / 0.035));
      let px = -(bv - av), py = (bu - au); const pl = Math.hypot(px, py) || 1; px /= pl; py /= pl;
      for (let k = 0; k < steps; k++) {
        const t = k / steps, cu = au + (bu - au) * t, cv = av + (bv - av) * t;
        plant(cu + px * avenueOffset, cv + py * avenueOffset, pts);
        plant(cu - px * avenueOffset, cv - py * avenueOffset, pts);
      }
    }
  }

  if (!pts.length) return new THREE.Group();

  // canopy: low-poly icosahedron with a baked vertical grey gradient (top lighter,
  // base darker) so the unlit material still reads as a rounded mass. Monochrome.
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  geo.scale(1, 1.3, 1);
  const pos = geo.attributes.position;
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - ymin) / (ymax - ymin || 1);
    // linear greys; sRGB output lifts them, so keep low → a mid-grey vegetation
    // mass that stays clearly below the white building carpet (守る線).
    const g = 0.11 + 0.20 * t;            // 0.11 base → 0.31 crown
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = g;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });

  // sit each canopy on the DEM via a downward raycast against the terrain mesh
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
  const groundY = (wx, wz) => { from.set(wx, 60, wz); ray.set(from, down); const h = ray.intersectObject(terrain, false); return h.length ? h[0].point.y : 0; };

  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0;
  for (const [u, v] of pts) {
    const wx = u * SCALE, wz = (v - vOffset) * SCALE;
    const gy = groundY(wx, wz);
    const j = 0.75 + rnd() * 0.65;        // size variety
    sc.set(j, j * (0.9 + rnd() * 0.5), j);
    p.set(wx, gy + radius * sc.y * 0.7, wz);
    m.compose(p, q, sc);
    mesh.setMatrixAt(n++, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = n;
  mesh.userData.type = 'trees';
  mesh.userData.revealKey = 99;           // last reveal layer (Plan 3 anim)
  return mesh;
}
