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

// --- step 6: seasonal colour mode (the `C`-key uMode opt-in) ---
// Season hues for chroma mode. [r,g,b] in 0..1 LINEAR — fed straight into GLSL vec3
// uniforms (NOT the 0..255 helpers in lib/math.js). Dead while uMode=0 (the monochrome
// default, 守る線). Three named registers so the look can be picked by eye (固定カメラ
// スクショ比較) WITHOUT touching the shader: `current` (saturated baseline), `muted`
// (low-chroma, dimmed — closest to the minimal/Ikeda register), `mid` (between). The
// chosen register is then baked as DEFAULT_CHROMA below.
export const CHROMA_VARIANTS = {
  current: [
    [0.95, 0.62, 0.72], // 春 sakura pink
    [0.36, 0.58, 0.30], // 夏 leaf green
    [0.85, 0.50, 0.18], // 秋 amber
    [0.80, 0.86, 0.95], // 冬 icy white-blue
  ],
  muted: [
    [0.62, 0.52, 0.55], // 春 greyed rose
    [0.40, 0.46, 0.38], // 夏 sage grey
    [0.56, 0.47, 0.37], // 秋 greyed tan
    [0.70, 0.73, 0.78], // 冬 cool grey
  ],
  mid: [
    [0.80, 0.57, 0.63], // 春 soft rose
    [0.38, 0.52, 0.34], // 夏 muted leaf
    [0.72, 0.49, 0.27], // 秋 dim amber
    [0.75, 0.80, 0.87], // 冬 pale ice
  ],
};

// The active canopy palette. Swappable live via setChromaVariant() for the look-pick;
// reads route through chromaCanopy/chromaParticle so a swap re-colours canopy AND
// particles in lockstep. Particle chroma derives from the canopy — petals/leaves track
// the canopy hue, snow is the achromatic exception (always white, 守る線).
const DEFAULT_CHROMA = 'current';
let _chroma = CHROMA_VARIANTS[DEFAULT_CHROMA];
export function setChromaVariant(name) {
  if (CHROMA_VARIANTS[name]) _chroma = CHROMA_VARIANTS[name];
  return _chroma;
}
const wrap4 = (i) => ((i % 4) + 4) % 4;
const chromaCanopy = (i) => _chroma[wrap4(i)];
const chromaParticle = (i) => (wrap4(i) === 3 ? [1.0, 1.0, 1.0] : _chroma[wrap4(i)]);

// Back-compat named export = the default register. COLOR_PALETTE must equal the default
// _chroma so endpoint colours match it at the uMode default (seasons.test relies on this).
export const COLOR_PALETTE = CHROMA_VARIANTS[DEFAULT_CHROMA];

// The two ends of this frame's blend: prev = where instances start (= last cycle's
// settled look), cur = where they arrive by prog=1. The wrap is continuous because
// cur(i) === prev((i+1)%4) by construction.
export function seasonEndpoints(index) {
  const i = ((index % 4) + 4) % 4;
  const p = (i + 3) % 4;
  return {
    prev: MONO_SETTLED[p], cur: MONO_SETTLED[i],
    colorPrev: chromaCanopy(p), colorCur: chromaCanopy(i),
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
  { amount: 0.85, size: 0.115, sway: 0.26, fall: 1.00, grey: 0.78, spin: 0.6 }, // 春 桜吹雪: bright mid-large, broad & lazy (俯瞰で読める大粒)
  { amount: 0.00, size: 0.045, sway: 0.10, fall: 1.00, grey: 0.30, spin: 1.0 }, // 夏: (almost) none — amount===0 不可視 (size据置)
  { amount: 0.70, size: 0.150, sway: 0.42, fall: 1.40, grey: 0.45, spin: 1.8 }, // 秋 落葉: largest point, widest & fastest tumble (散る)
  { amount: 1.00, size: 0.070, sway: 0.15, fall: 0.90, grey: 0.92, spin: 0.4 }, // 冬 雪: smallest, dense, narrow drift, never settles (white)
];

// Particle chroma for the step-6 uMode — derived from the active canopy register via
// chromaParticle(): petals/leaves track their canopy hue, but snow is the achromatic
// exception — winter particle stays WHITE in BOTH modes and in EVERY variant (守る線:
// snow is white). Back-compat export reflects the default register.
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
    colorPrev: chromaParticle(p), colorCur: chromaParticle(i),
  };
}
