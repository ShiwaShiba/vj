// Beat-driven 俯瞰⇔アップ shot switcher. A PURE, deterministic layer that sits between the
// base camera (passthrough) and a low avenue fly-along, and cuts/blends between them on the
// musical bar grid. Used in BOTH phases (proto.js for INTRO, liveDriver.js for LIVE) sharing
// ONE state object, so the switch rhythm carries across the intro→live handoff.
//
// base camera = whatever owns the framing underneath: INTRO = the director's authored zoom,
// LIVE = the parked hero framing. When the current shot is 俯瞰 we pass the base straight
// through (so the authored move / park still reads). When it's アップ we replace it with a
// camera gliding low along the 並木 centerline, looking ahead down the boulevard — the trees
// pass close so the seasonal colour/落葉 reads. Switching is quantised to bars; blends ease
// with smoothstep and are comfort-capped so it stays punchy-but-not-nauseating (酔わせない):
// big framing jumps land as a clean cut / short whip, never a long fast sweep.
//
// Determinism (守る線): shot picks come from a hash of the bar-group index, NOT RNG/Date, so
// the timeline is reproducible and node-testable. Musical time enters as a single continuous
// `beatsFloat` (clock.beats + clock.beatPhase); travel + switching derive from it, so the
// camera advances on the internal clock even before the mic starts.
import { lerpParams } from './camrig.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

// Deterministic hash → [0,1). Integer in, well-mixed fraction out (no RNG/Date).
export function hash01(n) {
  let h = (Math.floor(n) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

export function defaultShotConfig() {
  return {
    enabled: true,
    barBeats: 4,            // beats per bar (assume 4/4) — bar grid for switching
    switchBars: 2,          // switch every N bars (slider: 1 / 2 / 4 / 8)
    blendSec: 0.18,         // 0 = hard cut; larger = smooth ease (clamped to maxBlendSec)
    avenueRatio: 0.5,       // P(アップ) per bar-group; 1-ratio is 俯瞰. 0 = always 俯瞰, 1 = always アップ
    travelBars: 16,         // bars for the fly to traverse the whole 並木 once (slow forward = 酔わない)
    lowHeight: 2.6,         // アップ camera height above the ground centerline
    eyeOffsetX: 1.4,        // lateral offset so the row reads obliquely (not dead-on)
    aheadFrac: 0.16,        // look-ahead along the centerline (fraction of its length)
    lookLift: 0.7,          // raise the look point off the ground so the horizon sits naturally
    avenueFov: 52,
    // comfort caps (酔わせない)
    maxBlendSec: 1.2,       // never let a blend become a long fast sweep across a big jump
    minDwellBars: 1,        // floor on switchBars so it can't strobe the framing
    // --- aerial 俯瞰の動き（決定論・酔わせない）---
    orbitRate: 0,           // 俯瞰公転の角速度 [rad/beat]。0=固定（デフォルトは固定=既存挙動保持）。有効値例: 0.02
    orbitDir: 1,            // 公転方向 ±1
    breatheBars: 24,        // 呼吸ズームの周期（小節）
    breatheAmp: 0,          // 呼吸の半径振幅（±割合）。0=固定（デフォルトは固定=既存挙動保持）。有効値例: 0.06
    nearRatio: 0,           // 非avenue空間のうち「俯瞰ニア」になる割合。0=無効（デフォルト）。有効値例: 0.25
    nearRadiusMul: 0.62,    // 俯瞰ニアの寄り（半径倍率 <1）
    nearHeightMul: 0.66,    // 俯瞰ニアの高さ倍率 <1
    nearFov: 46,            // 俯瞰ニアのFOV
  };
}

export function initShotState() {
  return {
    t: 0,             // internal seconds (blend timing)
    group: -1,        // last bar-group index (switch boundary)
    shot: 'aerial',   // current target shot: 'aerial' (passthrough) | 'avenue' (fly)
    blendStart: -1e9, // internal t at the last switch
    fromCam: null,    // snapshot of the camera we blend FROM (the last shown frame)
    lastCam: null,    // last emitted camera (so the next blend starts from reality)
    entry: 0,         // per-shot avenue entry offset (variety), set at switch
  };
}

// Sample the 並木 centerline at u∈[0,1] → {x,y,z}. centerline is an ordered list of world
// points (south→north). Linear between samples — the line is gentle so this reads smooth.
function sampleLine(centerline, u) {
  const n = centerline.length;
  if (n === 1) return { ...centerline[0] };
  const f = clamp(u, 0, 1) * (n - 1);
  const i = Math.floor(f), j = Math.min(n - 1, i + 1), t = f - i;
  const a = centerline[i], b = centerline[j];
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

// The low avenue fly framing for the current musical time. Eye glides along the centerline,
// offset sideways + up; look point sits a little ahead and lifted, so we travel down the
// boulevard with a stable horizon (no roll). Forward speed is slow (travelBars) by design.
function avenueCam(state, cfg, centerline, beatsFloat) {
  const rate = 1 / Math.max(1e-3, cfg.travelBars * cfg.barBeats); // loops in beats
  const phase = ((beatsFloat * rate + state.entry) % 1 + 1) % 1;
  const eyeP = sampleLine(centerline, phase);
  const aheadP = sampleLine(centerline, phase + cfg.aheadFrac);
  // lateral (perp to travel) in the XZ plane, so the single-file row reads obliquely
  const dx = aheadP.x - eyeP.x, dz = aheadP.z - eyeP.z;
  const L = Math.hypot(dx, dz) || 1;
  const lx = -dz / L, lz = dx / L; // left-hand normal in XZ
  return {
    camX: eyeP.x + lx * cfg.eyeOffsetX,
    camY: eyeP.y + cfg.lowHeight,
    camZ: eyeP.z + lz * cfg.eyeOffsetX,
    fov: cfg.avenueFov,
    lookX: aheadP.x,
    lookY: aheadP.y + cfg.lookLift,
    lookV: aheadP.z,
  };
}

// 俯瞰（俯瞰ワイド/ニア）の framing。lookAt(lookX,lookV) 周りで camX/camZ を beatsFloat 由来の
// 角度でゆっくり公転し、半径に緩い呼吸を重畳（純粋・決定論・酔わせない）。orbitRate=0 かつ
// breatheAmp=0 の 'wide' は base と完全一致＝固定復帰（現状ピクセル一致の保証）。
export function aerialCam(base, cfg, beatsFloat, variant) {
  const isNear = variant === 'near';
  // Fast passthrough: no orbit, no breathe, wide view → return base unchanged (exact pixel match).
  // Avoids floating-point trig rounding even when inputs are zero (cos(atan2(z,0)) ≠ 0 exactly).
  if (!isNear && !(cfg.orbitRate || 0) && !(cfg.breatheAmp || 0)) return { ...base };
  const radiusMul = isNear ? cfg.nearRadiusMul : 1;
  const heightMul = isNear ? cfg.nearHeightMul : 1;
  const dx = base.camX - base.lookX, dz = base.camZ - base.lookV;
  const r0 = Math.hypot(dx, dz) || 1;
  const a0 = Math.atan2(dz, dx);
  const dir = cfg.orbitDir < 0 ? -1 : 1;
  const ang = a0 + (cfg.orbitRate || 0) * beatsFloat * dir;
  const breathePeriod = Math.max(1e-3, (cfg.breatheBars || 1) * cfg.barBeats);
  const breathe = 1 + (cfg.breatheAmp || 0) * Math.sin((2 * Math.PI * beatsFloat) / breathePeriod);
  const r = r0 * radiusMul * breathe;
  return {
    camX: base.lookX + Math.cos(ang) * r,
    camY: base.camY * heightMul,
    camZ: base.lookV + Math.sin(ang) * r,
    fov: isNear ? cfg.nearFov : base.fov,
    lookX: base.lookX, lookY: base.lookY, lookV: base.lookV,
  };
}

// PURE step. Returns { state, cam }. `base` is the passthrough framing; `beat.beatsFloat` is
// continuous musical time. Same (state, base, beat, cfg, centerline) → same result.
export function stepShot(state, base, beat, dt, cfg = defaultShotConfig(), centerline = null) {
  const s = { ...state };
  s.t += dt;
  if (!cfg.enabled || !centerline || !centerline.length) {
    const cam = { ...base };
    return { state: { ...s, group: -1, shot: 'aerial', fromCam: null, lastCam: cam }, cam };
  }

  const beatsFloat = beat && typeof beat.beatsFloat === 'number' ? beat.beatsFloat : 0;
  const groupLen = Math.max(cfg.minDwellBars, cfg.switchBars) * cfg.barBeats; // beats per group
  const group = Math.floor(beatsFloat / Math.max(1e-3, groupLen));

  // bar-quantised switch: a new group flips us to a hash-chosen shot, blending FROM the frame
  // we last actually showed (so a switch mid-move still eases cleanly).
  if (group !== s.group) {
    s.group = group;
    s.fromCam = s.lastCam ? { ...s.lastCam } : { ...base };
    s.blendStart = s.t;
    // 3値 決定論振り分け：avenue 確率は avenueRatio を保ち、非avenue空間を nearRatio で分ける。
    const rr = hash01(group);
    if (rr < cfg.avenueRatio) s.shot = 'avenue';
    else if (rr < cfg.avenueRatio + (cfg.nearRatio || 0) * (1 - cfg.avenueRatio)) s.shot = 'aerialNear';
    else s.shot = 'aerial';
    s.entry = hash01(group * 2 + 1); // vary the avenue entry point per shot
  }

  let target;
  if (s.shot === 'avenue') target = avenueCam(s, cfg, centerline, beatsFloat);
  else if (s.shot === 'aerialNear') target = aerialCam(base, cfg, beatsFloat, 'near');
  else target = aerialCam(base, cfg, beatsFloat, 'wide');

  const blendSec = clamp(cfg.blendSec, 0, cfg.maxBlendSec);
  const bt = blendSec <= 1e-3 ? 1 : smooth01((s.t - s.blendStart) / blendSec);
  const from = s.fromCam || base;
  const cam = lerpParams(from, target, bt);

  s.lastCam = { ...cam };
  return { state: s, cam };
}

// Thin stateful wrapper for the imperative callers (proto.js / liveDriver.js). Holds the
// state + a live-mutable config and writes the blended result INTO `cam` in place (matching
// the existing `Object.assign(params, …)` style). `setConfig` is how the sliders dial it.
export function createShotDirector(centerline, config = {}) {
  let cfg = { ...defaultShotConfig(), ...config };
  let state = initShotState();
  return {
    // mutate `cam` (the base framing) into the shot-blended framing for this frame
    apply(cam, beat, dt) {
      const r = stepShot(state, cam, beat, dt, cfg, centerline);
      state = r.state;
      Object.assign(cam, r.cam);
      return cam;
    },
    setConfig(partial) { cfg = { ...cfg, ...partial }; },
    get config() { return cfg; },
    get shot() { return state.shot; },
  };
}
