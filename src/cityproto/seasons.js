// Plan 3 step 4 — the single source of truth for how the 大学通り 並木 read across
// the four seasons. PURE (no THREE): trees.js installs a shader that blends each
// instance from the PREVIOUS season's settled look toward the CURRENT one as the
// director's season.prog ramps 0→1, staggered per-instance so the change sweeps
// downstream along the avenue. seasonEndpoints() hands the shader the two ends of
// that blend; the continuity invariant cur(i) === prev(i+1) is what keeps the
// 4-cycle loop seamless at the wrap (no pop).
//
// Greys are LINEAR and kept low — sRGB output lifts them, so these match the
// existing baked canopy gradient (0.11→0.31) and stay clearly below the white
// building carpet (守る線: monochrome). Colour is the step-6 opt-in (uMode), never
// the default.
export { SEASON_NAMES } from './director.js';

// The canopy's baked vertical grey gradient: grey = base + span*t (t = 0 base → 1
// crown). Single source so the shader's gradient-recovery can never drift from the
// trees.js bake — both import GRAD.
export const GRAD = { base: 0.11, span: 0.20 };

// Per-season "settled" (peak) look. scale = canopy size multiplier; density =
// fraction of instances kept (the rest thin out); toneLo/toneHi = base→crown grey
// range; shimmer = autumn twinkle amount; snow = winter crown frosting. Index
// order matches SEASON_NAMES: 0 spring, 1 summer, 2 autumn, 3 winter.
export const MONO_SETTLED = [
  { scale: 1.05, density: 0.90, toneLo: 0.20, toneHi: 0.46, shimmer: 0.00, snow: 0.0 }, // 春 桜: bright bloom
  { scale: 1.18, density: 1.00, toneLo: 0.09, toneHi: 0.22, shimmer: 0.00, snow: 0.0 }, // 夏 新緑→濃緑: densest, darkest
  { scale: 0.98, density: 0.62, toneLo: 0.14, toneHi: 0.34, shimmer: 0.10, snow: 0.0 }, // 秋: shimmer, thinning
  { scale: 0.82, density: 0.42, toneLo: 0.11, toneHi: 0.40, shimmer: 0.02, snow: 0.7 }, // 冬: sparse, snow crown
];

// Season hues for the step-6 colour mode. [r,g,b] in 0..1 LINEAR — these feed GLSL
// vec3 uniforms directly (NOT the 0..255 helpers in lib/math.js). Unused while
// uMode=0 (the monochrome default).
export const COLOR_PALETTE = [
  [0.95, 0.62, 0.72], // 春 sakura pink
  [0.36, 0.58, 0.30], // 夏 leaf green
  [0.85, 0.50, 0.18], // 秋 amber
  [0.80, 0.86, 0.95], // 冬 icy white-blue
];

// The two ends of this frame's blend: prev = where instances start (= last cycle's
// settled look), cur = where they arrive by prog=1. The wrap is continuous because
// cur(i) === prev((i+1)%4) by construction.
export function seasonEndpoints(index) {
  const i = ((index % 4) + 4) % 4;
  const p = (i + 3) % 4;
  return {
    prev: MONO_SETTLED[p], cur: MONO_SETTLED[i],
    colorPrev: COLOR_PALETTE[p], colorCur: COLOR_PALETTE[i],
  };
}

// --- step 5: falling particles (one reused THREE.Points system) ---
// petals (春) / leaves (秋) / snow (冬) are all the SAME points; the per-season FIELDS
// below are what make them read differently:
//   amount = emission strength 0..1 (scales per-particle alpha; 0 = nothing falls)
//   size   = point world-radius for size-attenuation (snow small/dense, leaves large)
//   sway   = horizontal drift amplitude (world units) — leaves flutter, snow barely drifts
//   fall   = ground-reach factor: drop = clamp(frac*fall,0,1)·fallDist. >1 lands early then
//            rests on the ground; <1 never quite settles (snow blows). petals ~1, leaves fast.
//   grey   = mono brightness (snow near-white, leaves mid grey) — achromatic by default
//   spin   = sway frequency multiplier (leaves tumble fast, petals lazy)
// summer amount=0 so petals fade fully out before 新緑; the prev→cur blend (particleEndpoints)
// carries the SAME continuity invariant as seasonEndpoints, so the 4-cycle wrap is seamless.
export const PARTICLE = [
  { amount: 0.85, size: 0.060, sway: 0.22, fall: 1.00, grey: 0.78, spin: 0.6 }, // 春 桜吹雪: slow, broad, bright
  { amount: 0.00, size: 0.045, sway: 0.10, fall: 1.00, grey: 0.30, spin: 1.0 }, // 夏: (almost) none
  { amount: 0.70, size: 0.075, sway: 0.34, fall: 1.40, grey: 0.42, spin: 1.6 }, // 秋 落葉: large, fast flutter
  { amount: 1.00, size: 0.042, sway: 0.12, fall: 0.95, grey: 0.92, spin: 0.4 }, // 冬 雪: small, dense, near-white
];

// Particle chroma for the step-6 uMode. Petals/leaves track their canopy hue (reuse
// COLOR_PALETTE), but snow is the achromatic exception — winter particle stays WHITE in
// BOTH modes (守る線: snow is white). 0..1 linear, fed straight into vec3 uniforms.
export const PARTICLE_COLOR = [
  COLOR_PALETTE[0], COLOR_PALETTE[1], COLOR_PALETTE[2], [1.0, 1.0, 1.0],
];

// Mirror of seasonEndpoints for the particle look — same wrap construction, so emission
// amount/size/sway/fall blend continuously across the season boundary (no burst/stop pop).
export function particleEndpoints(index) {
  const i = ((index % 4) + 4) % 4;
  const p = (i + 3) % 4;
  return {
    prev: PARTICLE[p], cur: PARTICLE[i],
    colorPrev: PARTICLE_COLOR[p], colorCur: PARTICLE_COLOR[i],
  };
}
