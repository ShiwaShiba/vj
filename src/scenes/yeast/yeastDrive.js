// src/scenes/yeast/yeastDrive.js
// PURE, deterministic numeric drive for the WebGL "YEAST" scene.
// No THREE, no DOM, no Math.random/Date/performance.now. All geometry from an
// integer hash; all time-varying values from clock.time + audio scalars only.
// Coordinates are NORMALIZED (screen center = origin, ±1 on the short axis);
// yeastCore maps them to device pixels. Slots are INTERLEAVED: slot 2k = cell k
// body, slot 2k+1 = cell k's bud lobe (radius 0 until it buds).

export const YEAST = {
  COUNT: 150,          // number of cells (main); total instance slots = 2*COUNT
  FOV: 0.9,            // normalized microscope field-of-view radius
  SCATTER_R: 0.86,     // cluster centers scattered within FOV*this
  CLUSTER_SPREAD: 0.20,// gaussian spread of cells around their cluster center
  BASE_R: 0.055,       // base cell radius (normalized)
  R_JITTER: 0.6,       // per-cell radius jitter factor (0..this added to 0.72 base)
  DEPTH_DIM: 0.34,     // far cells shrink by up to this (radius0 *= 1 - DEPTH_DIM*depth)
  ISO_T: 0.165,        // iso threshold (body edge) — shared with yeastCore uT default
  SUP_A: 1.14, SUP_B: 0.44,   // support factor = SUP_A + SUP_B*fusion
  DOF_R: 0.34, DOF_AMP: 0.52, // DoF: far/off-focus cells broaden R / dim amp
  BUD_PROB: 0.55,      // fraction of cells that carry a bud lobe
  DIV_PROB: 0.22,      // of budding cells, fraction that become near-equal divisions
  BUD_GROW: 0.18,      // bud growth rate per second (budAmount 0->1)
  FLOW: 0.045,         // curl-ish roaming flow magnitude (normalized/sec baseline)
  BROWNIAN: 0.010,     // brownian jitter magnitude (quiet baseline)
  BROWNIAN_HOT: 0.055, // brownian magnitude at full bass agitation
  SMOOTH: 0.18,        // one-pole band smoothing coefficient
};

function clamp01(v) { return v == null ? 0 : v < 0 ? 0 : v > 1 ? 1 : v; }

// Deterministic integer hash -> [0,1). Distinct outputs per (x,y,z,c).
export function hash01(x, y, z, c) {
  let h = Math.imul((x | 0) ^ 0x9e3779b1, 0x85ebca77);
  h = Math.imul((h ^ (h >>> 15)) + (y | 0), 0xc2b2ae3d);
  h = Math.imul((h ^ (h >>> 13)) + (z | 0), 0x27d4eb2f);
  h = Math.imul((h ^ (h >>> 16)) + (c | 0), 0x165667b1);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Build cell layout: cluster centers scattered in the FOV, cells gaussian-scattered
// around them, plus per-cell depth/radius/phase and a (possibly-dividing) bud lobe slot.
export function buildCells(count, seed) {
  const n = 2 * count;
  const baseX = new Float32Array(n), baseY = new Float32Array(n);
  const depth = new Float32Array(n), radius0 = new Float32Array(n);
  const phase = new Float32Array(n), kind = new Float32Array(n), seedArr = new Float32Array(n);
  const nClusters = Math.max(1, Math.round(Math.sqrt(count)));
  const s = seed | 0;
  for (let k = 0; k < count; k++) {
    // pick a cluster center (deterministic) within FOV*SCATTER_R
    const cl = Math.floor(hash01(k, s, 0, 11) * nClusters);
    const ca = hash01(cl, s, 0, 12) * Math.PI * 2;
    const cr = Math.sqrt(hash01(cl, s, 0, 13)) * YEAST.FOV * YEAST.SCATTER_R;
    const gx = Math.cos(ca) * cr, gy = Math.sin(ca) * cr;
    // gaussian-ish scatter around the cluster (two hashes -> box-muller-lite)
    const u1 = hash01(k, s, 1, 14), u2 = hash01(k, s, 1, 15);
    const mag = Math.sqrt(-2 * Math.log(u1 + 1e-6)) * YEAST.CLUSTER_SPREAD * 0.5;
    let x = gx + Math.cos(u2 * Math.PI * 2) * mag;
    let y = gy + Math.sin(u2 * Math.PI * 2) * mag;
    // clamp inside FOV
    const rr = Math.hypot(x, y);
    if (rr > YEAST.FOV) { const f = YEAST.FOV / rr; x *= f; y *= f; }
    const dp = hash01(k, s, 2, 16);
    const r = YEAST.BASE_R * (0.72 + YEAST.R_JITTER * hash01(k, s, 2, 17)) * (1 - YEAST.DEPTH_DIM * dp);
    const mi = 2 * k, bi = 2 * k + 1;
    baseX[mi] = x; baseY[mi] = y; depth[mi] = dp; radius0[mi] = r;
    phase[mi] = hash01(k, s, 3, 18) * Math.PI * 2; kind[mi] = 0; seedArr[mi] = hash01(k, s, 3, 19);
    // bud lobe slot: same depth, position offset applied live in cellFrame; radius starts 0
    const dividing = hash01(k, s, 4, 20) < YEAST.DIV_PROB;
    baseX[bi] = x; baseY[bi] = y; depth[bi] = dp; radius0[bi] = 0;
    phase[bi] = hash01(k, s, 4, 21) * Math.PI * 2; kind[bi] = dividing ? 2 : 1; seedArr[bi] = hash01(k, s, 4, 22);
  }
  return {
    count, n, baseX, baseY, depth, radius0, phase, kind, seedArr,
    px: new Float32Array(n), py: new Float32Array(n), pr: new Float32Array(n),
    pd: new Float32Array(n), pbud: new Float32Array(n),
  };
}

// Smooth deterministic 2D flow (curl-ish): two orthogonal sine fields of position+time.
// No noise texture needed; low frequencies read as slow roaming with no loop point.
function flowAt(x, y, time, ph) {
  const fx = Math.sin(x * 1.7 + time * 0.23 + ph) + Math.cos(y * 1.3 - time * 0.17 + ph * 0.5);
  const fy = Math.cos(x * 1.1 - time * 0.19 - ph) + Math.sin(y * 1.9 + time * 0.13 + ph * 0.7);
  return [fx * 0.5, fy * 0.5];
}

// Weighted sum of sines with non-integer frequency ratios, normalized to [0,1].
// Distinct frequency sets per field => the "mood" never realigns to a short loop.
function lfo(t, fs) {
  let s = 0, tot = 0;
  for (let i = 0; i < fs.length; i++) { s += fs[i][2] * Math.sin(t * fs[i][0] + fs[i][1]); tot += fs[i][2]; }
  return 0.5 + 0.5 * (s / tot);
}

// The global "look mood": each aesthetic axis wanders aperiodically in [0,1]. The scene
// maps these onto sliders (slider = center, drift = bounded offset). `time` is the
// audio-advanced drift clock kept by the scene, so beats nudge the whole mood forward.
export function driftFrame(time, audio, tintMode) {
  const t = time;
  const lvl = clamp01(audio && audio.level);
  const density = clamp01(lfo(t, [[0.053, 0.0, 1], [0.017, 2.1, 0.6], [0.007, 4.0, 0.4]]) + 0.10 * lvl);
  const fusion = lfo(t, [[0.041, 1.3, 1], [0.019, 3.7, 0.7], [0.011, 5.5, 0.4]]);
  const fill = lfo(t, [[0.037, 0.6, 1], [0.023, 4.4, 0.6]]);
  const focusPlane = lfo(t, [[0.029, 2.7, 1], [0.013, 1.1, 0.5]]);
  const rim = lfo(t, [[0.047, 3.2, 1], [0.021, 0.4, 0.5]]);
  const halo = lfo(t, [[0.031, 5.0, 1], [0.015, 2.9, 0.6]]);
  let tint = 0;
  if (tintMode === 'auto') {
    // black-weighted: bias toward 0 (mono), occasionally rise toward slate
    const raw = lfo(t, [[0.009, 1.7, 1], [0.019, 4.2, 0.5]]);
    tint = clamp01(Math.pow(raw, 2.2));   // pow biases the distribution toward black
  } else if (tintMode === 'slate') tint = 1;
  return { density, fusion, fill, focusPlane, rim, halo, tint };
}

// One-pole smooth the bands toward gained targets (audio strong by default). Mutates + returns prev.
export function bandUniforms(audio, prev, coef) {
  const a = audio || {};
  const gain = coef == null ? 1 : coef;
  const s = YEAST.SMOOTH;
  prev.swell   += (clamp01(clamp01(a.bass) * gain)   - prev.swell) * s;
  prev.flow    += (clamp01(clamp01(a.mid) * gain)    - prev.flow) * s;
  prev.shimmer += (clamp01(clamp01(a.treble) * gain) - prev.shimmer) * s;
  prev.loud    += (clamp01(clamp01(a.level) * gain)  - prev.loud) * s;
  return prev;
}

// Advance every slot: main cells roam (flow + brownian, agitation scaled by bass/level),
// bud lobes sit beside their mother and grow (budAmount 0->1, faster on beat), dividers
// drift outward as they mature. Writes px,py,pr,pd,pbud. Deterministic in (state,time,audio).
export function cellFrame(state, time, audio) {
  const a = audio || {};
  const bass = clamp01(a.bass), mid = clamp01(a.mid), lvl = clamp01(a.level), beat = clamp01(a.beat);
  const brown = YEAST.BROWNIAN + (YEAST.BROWNIAN_HOT - YEAST.BROWNIAN) * Math.max(bass, lvl);
  const flowMag = YEAST.FLOW * (0.6 + 0.9 * mid);
  const budRate = YEAST.BUD_GROW * (1 + 1.5 * beat);
  for (let k = 0; k < state.count; k++) {
    const mi = 2 * k, bi = 2 * k + 1;
    const ph = state.phase[mi];
    // main cell: base + slow flow + brownian wobble (brownian uses sin of time*hash => deterministic)
    const fl = flowAt(state.baseX[mi], state.baseY[mi], time, ph);
    const bwx = Math.sin(time * (0.7 + state.seedArr[mi]) + ph) * brown;
    const bwy = Math.cos(time * (0.9 + state.seedArr[mi] * 0.8) + ph * 1.3) * brown;
    let x = state.baseX[mi] + fl[0] * flowMag + bwx;
    let y = state.baseY[mi] + fl[1] * flowMag + bwy;
    const rr = Math.hypot(x, y);
    if (rr > YEAST.FOV) { const f = YEAST.FOV / rr; x *= f; y *= f; }   // soft FOV containment
    state.px[mi] = x; state.py[mi] = y; state.pd[mi] = state.depth[mi];
    state.pr[mi] = state.radius0[mi]; state.pbud[mi] = 0;
    // bud lobe: only if this cell was selected to bud
    const buds = hash01(k, 0, 5, 23) < YEAST.BUD_PROB;   // NOTE: uses seed-independent selection by design (stable per index)
    if (buds) {
      // budAmount ramps with a per-cell phase so cells are asynchronous; saw-like 0->1 then hold near 1
      const grown = Math.min(1, budRate * time * (0.5 + state.seedArr[bi]));
      const dividing = state.kind[bi] === 2;
      const ba = state.phase[bi];
      const dist = state.radius0[mi] * (dividing ? (1.15 + 0.4 * grown) : (0.72 + 0.3 * grown));
      state.px[bi] = x + Math.cos(ba) * dist;
      state.py[bi] = y + Math.sin(ba) * dist;
      state.pd[bi] = state.depth[bi];
      const target = state.radius0[mi] * (dividing ? (0.82 + 0.15 * grown) : (0.48 + 0.28 * grown));
      state.pr[bi] = target * grown;         // grows 0 -> target
      state.pbud[bi] = grown;
    } else {
      state.pr[bi] = 0; state.pbud[bi] = 0;  // no lobe: zero radius => no splat
      state.px[bi] = x; state.py[bi] = y; state.pd[bi] = state.depth[bi];
    }
  }
  return state;
}
