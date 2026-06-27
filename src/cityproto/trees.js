import * as THREE from '../vendor/three.module.js';
import { GRAD, seasonEndpoints } from './seasons.js';
import { makeGroundSampler } from './groundSampler.js';

// Plan 3 step 4 — the 大学通り 並木 carry the seasons (monochrome). Two instanced
// canopies: avenueMesh (大学通り both sides = the seasonal star) and scatterMesh
// (green zones = damped greenery). A per-instance shader blends each canopy from
// the previous season's settled look toward the current one as the director's
// season.prog ramps 0→1, staggered by aPhase (position down the avenue) so the
// change sweeps downstream. Greys only by default (守る線); chroma is the step-6
// uMode opt-in. instanceMatrix (base size + DEM-raycast position) is never rewritten
// — all season motion is uniform-driven (no re-lighting). seeds + layout come from
// the pure planLayout below (node-testable; mirrors reveal.js's pure/THREE split).

// PURE: plan where canopies stand, in manifest (u,v) space — no THREE, no terrain.
// Returns { avenue:[{u,v,aPhase,seed}], scatter:[{u,v,aPhase,seed}] }. aPhase is the
// avenue's v-extent normalized to [0,1] (the染め sweep axis); scatter aPhase is 0.
export function planLayout(manifest, opts = {}) {
  const bounds = opts.bounds || { u0: -1.85, u1: 1.72, v0: -0.42, v1: 1.3 };
  // The avenue gets its OWN (taller) v-bound so the 並木 reaches the 大学通り terminus
  // (manifest road runs to v≈3.53) WITHOUT admitting more green-zone scatter — raising the
  // shared bounds.v1 would also spawn scatter between v=1.3..3.55. Independent by design.
  const avenueBounds = opts.avenueBounds || { ...bounds, v1: 3.55 };
  const cell = opts.cell ?? 0.028;          // ~12 m thinning grid (prevents clumping)
  const avenueOffset = opts.avenueOffset ?? 0.022;

  // seeded xorshift → stable layout + per-instance seed across reloads
  let s = 0x2545f491 >>> 0;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

  const inB = (b, u, v) => u > b.u0 && u < b.u1 && v > b.v0 && v < b.v1;
  const taken = new Set();                   // grid-thin shared across both lists
  const plant = (u, v, arr, b) => {
    if (!inB(b, u, v)) return;
    const k = Math.floor(u / cell) + ',' + Math.floor(v / cell);
    if (taken.has(k)) return;
    taken.add(k);
    arr.push({ u, v, seed: rnd() });         // one seed per accepted instance, in stream order
  };

  // scatter first (green rects), then the avenue — preserves the original plant order
  const scatter = [];
  for (const rect of manifest.green || []) {
    const [a0, b0, a1, b1] = rect;
    const u0 = Math.min(a0, a1), v0 = Math.min(b0, b1);
    const du = Math.abs(a1 - a0), dv = Math.abs(b1 - b0);
    const n = Math.min(240, Math.max(6, Math.round((du * dv) / (cell * cell) * 3)));
    for (let i = 0; i < n; i++) plant(u0 + rnd() * du, v0 + rnd() * dv, scatter, bounds);
  }

  const avenue = [];
  for (const r of manifest.roads || []) {
    if (!r.name || !r.name.includes('大学通り')) continue;
    const P = r.points;
    for (let i = 0; i + 1 < P.length; i++) {
      const au = P[i][0], av = P[i][1], bu = P[i + 1][0], bv = P[i + 1][1];
      const segLen = Math.hypot(bu - au, bv - av);
      const steps = Math.max(1, Math.round(segLen / 0.035));
      let px = -(bv - av), py = (bu - au); const pl = Math.hypot(px, py) || 1; px /= pl; py /= pl;
      for (let k = 0; k < steps; k++) {
        const t = k / steps, cu = au + (bu - au) * t, cv = av + (bv - av) * t;
        plant(cu + px * avenueOffset, cv + py * avenueOffset, avenue, avenueBounds);
        plant(cu - px * avenueOffset, cv - py * avenueOffset, avenue, avenueBounds);
      }
    }
  }

  // aPhase = normalized v across the PLANTED avenue extent, so the sweep spans the
  // visible trees 0..1. Guard a degenerate (constant-v) avenue → aPhase 0 (no NaN).
  let V0 = Infinity, V1 = -Infinity;
  for (const p of avenue) { if (p.v < V0) V0 = p.v; if (p.v > V1) V1 = p.v; }
  const span = V1 - V0;
  for (const p of avenue) p.aPhase = span > 1e-9 ? (p.v - V0) / span : 0;
  for (const p of scatter) p.aPhase = 0;     // sweep is avenue-only

  // 空き地の木: greenery in the building carpet's INTERIOR gaps (vacant lots), returned as
  // its OWN list so buildTrees can give it a distinct canopy size (uDamp) from the green-zone
  // scatter. Off unless BOTH a density and the building vertex world-positions are supplied
  // (proto.js extracts them from the loaded buildings mesh). avenue + scatter are untouched,
  // so the particles' planLayout(manifest) call (no buildingPositions) stays byte-identical.
  const vacant = ((opts.vacantDensity ?? 0) > 0 && opts.buildingPositions)
    ? planVacant(opts.buildingPositions, manifest, opts) : [];

  return { avenue, scatter, vacant };
}

// PURE: plant trees in the city's vacant interior lots — gaps in the building carpet
// that are still surrounded by buildings (excludes the open outer field). buildingPositions
// is a flat Float32Array of building vertex WORLD positions [x,y,z, x,y,z, …]; converted to
// (u,v) via manifest.scale, exactly mirroring the approved scratchpad prototype. Returns
// [{u,v,seed,aPhase:0}]. Deterministic: an xorshift drives placement, a SECOND independent
// xorshift draws per-instance seeds so adding seed variety never shifts the placement stream.
export function planVacant(buildingPositions, manifest, opts = {}) {
  const density = opts.vacantDensity ?? 0;
  if (density <= 0 || !buildingPositions || !buildingPositions.length) return [];
  const { SCALE, vOffset } = manifest.scale;
  const OCC = opts.vacantOcc ?? 0.012;       // ~5 m occupancy cell (UV)
  const STEP = opts.vacantStep ?? 0.022;     // ~9 m planting lattice
  const R = opts.vacantNearR ?? 4;           // nearBuilt search radius (cells)
  const NEAR = opts.vacantNearMin ?? 6;      // ≥ this many built cells within R ⇒ interior gap
  const jitterF = opts.vacantJitter ?? 0.8;  // lattice jitter as a fraction of STEP

  // Pack a cell (cu,cv) into one Number key (bijective for cells in [-32768,32767]) — a
  // string-concat key here was a large startup cost (51.7万頂点 occ build + 81 lookups/格子点).
  const KOFF = 32768;
  const ckey = (cu, cv) => (cu + KOFF) * 65536 + (cv + KOFF);
  const occ = new Set();
  let U0 = Infinity, U1 = -Infinity, V0 = Infinity, V1 = -Infinity;
  for (let i = 0; i < buildingPositions.length; i += 3) {
    const u = buildingPositions[i] / SCALE, v = buildingPositions[i + 2] / SCALE + vOffset;
    occ.add(ckey(Math.floor(u / OCC), Math.floor(v / OCC)));
    if (u < U0) U0 = u; if (u > U1) U1 = u; if (v < V0) V0 = v; if (v > V1) V1 = v;
  }
  // dilate occ by 1 cell so footprint interiors read as occupied (no trees on rooftops)
  const occD = new Set(occ);
  for (const k of occ) { const cu = Math.floor(k / 65536) - KOFF, cv = (k % 65536) - KOFF; for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) occD.add(ckey(cu + du, cv + dv)); }
  const isOcc = (u, v) => occD.has(ckey(Math.floor(u / OCC), Math.floor(v / OCC)));
  const nearBuilt = (u, v) => { let c = 0; const cu = Math.floor(u / OCC), cv = Math.floor(v / OCC); for (let du = -R; du <= R; du++) for (let dv = -R; dv <= R; dv++) if (occ.has(ckey(cu + du, cv + dv))) { c++; if (c >= NEAR) return true; } return false; };

  let s = 0x6d2b79f5 >>> 0;                   // placement stream (jitter + accept) — own seed
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  let s2 = 0x85ebca6b >>> 0;                  // seed stream (canopy size variety), independent
  const rnd2 = () => { s2 ^= s2 << 13; s2 ^= s2 >>> 17; s2 ^= s2 << 5; s2 >>>= 0; return s2 / 4294967296; };

  const out = [];
  for (let u = U0; u <= U1; u += STEP) for (let v = V0; v <= V1; v += STEP) {
    const ju = u + (rnd() - 0.5) * STEP * jitterF, jv = v + (rnd() - 0.5) * STEP * jitterF;
    if (isOcc(ju, jv)) continue;             // a building stands here
    if (!nearBuilt(ju, jv)) continue;        // open field / outer void → skip (interior gaps only)
    if (rnd() > density) continue;
    out.push({ u: ju, v: jv, seed: rnd2(), aPhase: 0 });
  }
  return out;
}

const TONE_HI = GRAD.base + GRAD.span;

// Build the shared season uniforms. One {value} object per uniform, referenced by
// BOTH meshes' materials so a single write updates both programs.
function makeUniforms() {
  return {
    uProg: { value: 0 },
    uProgColor: { value: 0 },                          // 見た目(色/トーン)専用の遅延prog。構造(uProg)から分離
    uAppear: { value: 1 },                             // reveal gate (0→1) — 木々 grow in AFTER the buildings
    uScale: { value: new THREE.Vector2(1, 1) },        // prev, cur canopy scale
    uDensity: { value: new THREE.Vector2(1, 1) },      // prev, cur fraction kept
    uToneLo: { value: new THREE.Vector2(GRAD.base, GRAD.base) },
    uToneHi: { value: new THREE.Vector2(TONE_HI, TONE_HI) },
    uShimmer: { value: new THREE.Vector2(0, 0) },
    uSnow: { value: new THREE.Vector2(0, 0) },
    uColor0: { value: new THREE.Vector3(1, 1, 1) },    // step-6 chroma (dead at uMode=0)
    uColor1: { value: new THREE.Vector3(1, 1, 1) },
    uMode: { value: 0 },                               // 0 mono (default), 1 chroma
    uTime: { value: 0 },
    uStagger: { value: 0.7 },                          // 0.7 + uBand(0.3) = 1.0 → full sweep, no wrap pop
    uBand: { value: 0.3 },
    uGradBase: { value: GRAD.base },                   // single-source gradient recovery
    uGradSpan: { value: GRAD.span },
    uStrobe: { value: 0 },                             // 0..1 envelope (eased; winter + S-gated; default off)
    uStrobeRate: { value: 2.5 },                       // Hz of the traveling white pulse — ≤3 (光感受性)
    uStrobeSpan: { value: 1.0 },                       // how far down-avenue the pulse phase travels
  };
}

// Patch an unlit canopy material with the season shader (the reveal.js onBeforeCompile
// idiom). uDamp is per-material (1.0 avenue, <1 scatter); the rest of U is shared.
function installSeasonShader(mat, U, uDampValue) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, { uDamp: { value: uDampValue } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPhase;
attribute float aSeed;
uniform float uProg;
uniform float uProgColor;
uniform float uAppear;
uniform vec2 uScale;
uniform vec2 uDensity;
uniform float uStagger;
uniform float uBand;
uniform float uDamp;
varying float vProgI;
varying float vProgColorI;
varying float vSeed;
varying float vPhase;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float _pStart = min(aPhase * uStagger, 1.0 - uBand);
float progI = smoothstep(_pStart, _pStart + uBand, uProg);
float progColorI = smoothstep(_pStart, _pStart + uBand, uProgColor);  // 色は遅延prog の同じスイープ
float dens = mix(uDensity.x, uDensity.y, progI);
float keep = 1.0 - smoothstep(dens - 0.06, dens, aSeed);
float sScale = mix(uScale.x, uScale.y, progI) * uDamp;
transformed *= sScale * keep * uAppear;            // uAppear scales the canopy in (reveal gate)
transformed.y -= 999.0 * (1.0 - keep);
vProgI = progI;
vProgColorI = progColorI;
vSeed = aSeed;
vPhase = aPhase;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec2 uToneLo;
uniform vec2 uToneHi;
uniform vec2 uShimmer;
uniform vec2 uSnow;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform float uMode;
uniform float uTime;
uniform float uGradBase;
uniform float uGradSpan;
uniform float uStrobe;
uniform float uStrobeRate;
uniform float uStrobeSpan;
varying float vProgI;
varying float vProgColorI;
varying float vSeed;
varying float vPhase;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float gradT = clamp((diffuseColor.r - uGradBase) / uGradSpan, 0.0, 1.0);
// 見た目(トーン/シマー/雪/色)は vProgColorI(遅延)で。構造(大きさ/密度)は vProgI のまま＝色だけ後から入る。
float grey = mix(mix(uToneLo.x, uToneLo.y, vProgColorI), mix(uToneHi.x, uToneHi.y, vProgColorI), gradT);
grey += mix(uShimmer.x, uShimmer.y, vProgColorI) * 0.06 * (sin(uTime * 1.7 + vSeed * 43.0) * 0.5 + 0.5);
grey = mix(grey, 0.85, mix(uSnow.x, uSnow.y, vProgColorI) * smoothstep(0.45, 1.0, gradT));
vec3 seasonC = mix(uColor0, uColor1, vProgColorI) * (0.45 + 0.55 * gradT);
diffuseColor.rgb = mix(vec3(grey), seasonC, uMode);
// 冬 christmas-light strobe: a white pulse that travels DOWN the avenue (vPhase offset).
// White only (守る線), ≤3Hz (uStrobeRate), soft in/out window (no hard square). The whole
// term is gated by the uStrobe envelope (winter + S-key, eased; default 0 = invisible).
float flashPhase = fract(uTime * uStrobeRate - vPhase * uStrobeSpan);
float pulse = smoothstep(0.0, 0.18, flashPhase) * (1.0 - smoothstep(0.32, 0.5, flashPhase));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uStrobe * pulse);`);
  };
  mat.needsUpdate = true;
}

// Build the canopy base geometry: a low-poly icosahedron with a baked vertical grey
// gradient (GRAD.base → GRAD.base+span) the shader later recovers and reseasons.
function makeCanopyGeo(radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  geo.scale(1, 1.3, 1);
  const pos = geo.attributes.position;
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - ymin) / (ymax - ymin || 1);
    const g = GRAD.base + GRAD.span * t;     // single source (seasons.js GRAD) — shader recovers t
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = g;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Build one InstancedMesh from a plant list. Each gets its OWN cloned geometry (it
// carries per-instance aPhase/aSeed) + its own material (its own uDamp). DEM-raycast
// position + seed-driven base size go into instanceMatrix once and are never rewritten.
function buildMesh(list, baseGeo, U, uDamp, radius, groundY, SCALE, vOffset) {
  const geo = baseGeo.clone();
  const aPhase = new Float32Array(list.length);
  const aSeed = new Float32Array(list.length);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  installSeasonShader(mat, U, uDamp);

  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.frustumCulled = false;                // in-shader resize ⇒ CPU bounds would be wrong
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < list.length; i++) {
    const { u, v, aPhase: ph, seed } = list[i];
    aPhase[i] = ph; aSeed[i] = seed;
    const wx = u * SCALE, wz = (v - vOffset) * SCALE;
    const gy = groundY(wx, wz);
    const j = 0.75 + seed * 0.65;            // base size variety (deterministic from seed)
    const ys = 0.9 + ((seed * 7.0) % 1) * 0.5;
    sc.set(j, j * ys, j);
    p.set(wx, gy + radius * sc.y * 0.7, wz);
    m.compose(p, q, sc);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  return mesh;
}

// THREE: build the seasonal 並木 controller. Returns { group, update(season, mode, dt),
// setMode(mode) }. proto.js adds group, calls update(f.season, mode, dt) each frame.
export function buildTrees(manifest, terrain, opts = {}) {
  const { SCALE, vOffset } = manifest.scale;
  const radius = opts.radius ?? 0.072;       // canopy radius in world units (~5 m)
  const { avenue, scatter, vacant } = planLayout(manifest, opts);
  const vacantDamp = opts.vacantDamp ?? 0.65;   // canopy size of the 空き地 trees (user-chosen)

  const group = new THREE.Group();
  group.userData.type = 'trees';
  const U = makeUniforms();

  // sit each canopy on the DEM. groundY samples the terrain heightfield via a one-time
  // xz triangle grid (groundSampler.js) — same height as a downward raycast, O(1)/query
  // instead of O(68k tris)/query (the old per-tree raycast dominated startup).
  const groundY = makeGroundSampler(terrain);

  const baseGeo = makeCanopyGeo(radius);
  if (avenue.length) group.add(buildMesh(avenue, baseGeo, U, 1.0, radius, groundY, SCALE, vOffset));
  if (scatter.length) group.add(buildMesh(scatter, baseGeo, U, 0.45, radius, groundY, SCALE, vOffset));
  if (vacant.length) group.add(buildMesh(vacant, baseGeo, U, vacantDamp, radius, groundY, SCALE, vOffset)); // 空き地の木

  let modeTarget = 0;
  function update(season, mode, dt, opts = {}) {
    const ep = seasonEndpoints(season.index);
    U.uScale.value.set(ep.prev.scale, ep.cur.scale);
    U.uDensity.value.set(ep.prev.density, ep.cur.density);
    U.uToneLo.value.set(ep.prev.toneLo, ep.cur.toneLo);
    U.uToneHi.value.set(ep.prev.toneHi, ep.cur.toneHi);
    U.uShimmer.value.set(ep.prev.shimmer, ep.cur.shimmer);
    U.uSnow.value.set(ep.prev.snow, ep.cur.snow);
    U.uColor0.value.set(ep.colorPrev[0], ep.colorPrev[1], ep.colorPrev[2]);
    U.uColor1.value.set(ep.colorCur[0], ep.colorCur[1], ep.colorCur[2]);
    U.uProg.value = season.prog;
    U.uProgColor.value = season.progColor ?? season.prog; // 色は遅延prog(無ければ構造progで後方互換)
    U.uTime.value += dt || 0;
    if (mode != null) modeTarget = mode ? 1 : 0;
    U.uMode.value += (modeTarget - U.uMode.value) * Math.min(1, (dt || 0) * 4); // ~0.6s crossfade
    // Winter strobe: only season 3, only when the S-key gate is on, ramped via uStrobe so
    // onset/offset are smooth (no abrupt full-rate flash). Default gate off ⇒ eases to 0.
    const gate = opts.strobe ? 1 : 0;
    const strobeTarget = (season.index === 3 ? season.prog : 0) * gate;
    U.uStrobe.value += (strobeTarget - U.uStrobe.value) * Math.min(1, (dt || 0) * 3); // ~1s ramp
  }
  function setMode(mode) { modeTarget = mode ? 1 : 0; }

  return { group, update, setMode, uniforms: U };
}
