// src/scenes/orb/orbDrive.js
// PURE, deterministic drive for the WebGL "Noise Orb" scene.
// No THREE, no DOM, no Math.random/Date/performance.now — geometry from an
// integer hash, every time-varying value from clock.time + audio scalars only.
// Unit-tested core: geometry generation, one-pole band smoothing, beat-burst
// ignition, and the traveling light-front's axis/phase evolution.

export const ORB = {
  COUNT: 140000,
  JITTER: 0.006,          // deterministic positional jitter so the fibonacci lattice never reads as a grid
  BURST_BASS_HI: 0.55,    // bass rising-edge threshold that ignites a kick burst
  BURST_MIN_GAP: 0.22,    // refractory seconds between bursts
  BURST_LIFE: 1.1,        // burst envelope lifetime (s)
  BURST_SPEED: 3.3,       // ring expansion rate in cos-space
  BURST_DECAY: 2.1,       // burst brightness exp decay
  BURST_W: 4.0,           // ring angular width (matches the GLSL literal 4.0)
  BURST_GAIN: 1.3,        // burst brightness gain applied by the scene
  WAVE_K: 9.0,            // nominal light-front band count (reference lever)
  WAVE_SPEED: 0.8,        // traveling front phase rate (pure time => seamless + monotonic)
  WAVE_SPEED_MID: 2.4,    // reserved mid speed factor (reference lever)
  WALL_TRAVEL: 1.15,      // reserved wall-travel gain (reference lever)
  FAST_FLOW_RATE: 1.9,    // treble crackle fast-phase rate
  SMOOTH: 0.18,           // one-pole smoothing coefficient
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

// Fibonacci sphere + tiny deterministic jitter, renormalized so every direction is unit length.
export function buildOrbGeometry(count) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const denom = count > 1 ? count - 1 : 1;
  for (let i = 0; i < count; i++) {
    let y = 1 - (i / denom) * 2;                    // 1 -> -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    let x = Math.cos(theta) * r;
    let z = Math.sin(theta) * r;
    x += (hash01(i, 0, 0, 1) - 0.5) * ORB.JITTER;
    y += (hash01(i, 0, 0, 2) - 0.5) * ORB.JITTER;
    z += (hash01(i, 0, 0, 3) - 0.5) * ORB.JITTER;
    const inv = 1 / Math.sqrt(x * x + y * y + z * z); // renormalize => |dir| = 1
    positions[i * 3] = x * inv;
    positions[i * 3 + 1] = y * inv;
    positions[i * 3 + 2] = z * inv;
    seeds[i] = hash01(i, 0, 0, 7);
  }
  return { positions, seeds };
}

// Ignite a burst on a bass rising-edge past HI, with a refractory gap. Mutates + returns state.
export function updateBurst(state, bass, time) {
  const b = clamp01(bass);
  const rising = b > ORB.BURST_BASS_HI && state.prevBass <= ORB.BURST_BASS_HI;
  const ready = (time - state.t0) > ORB.BURST_MIN_GAP;
  if (rising && ready) {
    state.t0 = time;
    state.n = (state.n + 1) | 0;
    state.amp = 0.45 + 0.55 * clamp01((b - ORB.BURST_BASS_HI) / (1 - ORB.BURST_BASS_HI));
  }
  state.prevBass = b;
  return state;
}

// Current burst ring: golden-angle axis hop per burst, cos-space outward sweep, exp-decay envelope.
export function burstFrame(state, time) {
  const age = time - state.t0;
  if (!(age >= 0 && age < ORB.BURST_LIFE)) return { axis: [0, 1, 0], cos: -2, env: 0, active: false };
  const gA = Math.PI * (3 - Math.sqrt(5));
  const yy = 1 - ((state.n * 0.61803398875) % 1) * 2;   // deterministic per-burst latitude
  const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
  const th = gA * state.n;
  const axis = [Math.cos(th) * rr, yy, Math.sin(th) * rr]; // unit by construction (rr^2 + yy^2 = 1)
  const cos = 1 - ORB.BURST_SPEED * age;                   // ring sweeps outward from the pole
  const env = state.amp * Math.exp(-ORB.BURST_DECAY * age);
  return { axis, cos, env, active: true };
}

// Traveling MID light-front: a precessing UNIT axis (never collapses), breathing band count,
// and a phase that advances purely with time (=> monotonic + seamless, no frame-to-frame jumps).
export function sweepFrame(time, mid) {
  const m = clamp01(mid);
  const a = time * 0.19, b = time * 0.11 + 0.6;
  const cb = Math.cos(b);
  const axis = [Math.cos(a) * cb, Math.sin(b), Math.sin(a) * cb]; // |axis| = 1 exactly (spherical param)
  const k = 8 + 2.5 * Math.sin(time * 0.23) - 0.5 * m * Math.cos(time * 0.11); // in [5,11]
  const flow = time * ORB.WAVE_SPEED;
  return { axis, k, flow };
}

// One-pole smooth the three bands (and level) toward their gained targets. Mutates + returns prev.
export function bandUniforms(audio, prev, coef) {
  const a = audio || {};
  const gain = coef == null ? 1 : coef;
  const s = ORB.SMOOTH;
  prev.bassSwell    += (clamp01(clamp01(a.bass) * gain)   - prev.bassSwell) * s;
  prev.travelAmt    += (clamp01(clamp01(a.mid) * gain)    - prev.travelAmt) * s;
  prev.treble       += (clamp01(clamp01(a.treble) * gain) - prev.treble) * s;
  prev.exposureLoud += (clamp01(clamp01(a.level) * gain)  - prev.exposureLoud) * s;
  return prev;
}
