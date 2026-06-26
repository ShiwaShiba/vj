import * as THREE from '../vendor/three.module.js';
import { particleEndpoints } from './seasons.js';
import { makeGroundSampler } from './groundSampler.js';

// Plan 3 step 5 — the falling particles (花びら / 落ち葉 / 雪) along the 大学通り 並木.
// ONE THREE.Points system, reused across the four seasons: the per-season look comes
// entirely from seasons.js PARTICLE (single source of truth), blended prev→cur by the
// SAME per-instance sweep (progI) as the canopy so the petals/leaves/snow fall exactly
// where the season has arrived. The fall itself is GPU-driven — `mod(uTime - aBirth,
// life)` in the vertex shader, NO CPU respawn, no per-frame position writes (守る線:
// GPU-driven, no re-lighting). Mono (achromatic) by default; chroma is the uMode opt-in.
// planEmit is PURE (node-testable); buildParticles is the THREE half — mirrors trees.js.

// PURE: turn the avenue plant list into emission columns. Subsample the avenue (we don't
// need one emitter per tree), jitter (u,v) so columns aren't a perfect line, carry aPhase
// from the source point (emission syncs to the染め sweep), and stamp a desynced aBirth so
// the shared-uTime fall is well-distributed from frame zero. Per-particle aLife jitter
// breaks any residual banding. No THREE, no terrain.
export function planEmit(avenue, opts = {}) {
  const perCol = opts.perColumn ?? 6;        // particles stacked per emitter column
  const stride = opts.stride ?? 2;           // take every Nth avenue point as an emitter
  const jitter = opts.jitter ?? 0.018;       // (u,v) scatter around the emitter
  const life = opts.life ?? 3.2;             // seconds birth→ground (matches fallDist feel)

  let s = 0x9e3779b9 >>> 0;                   // own seed (independent of trees' xorshift)
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

  const emit = [];
  for (let i = 0; i < avenue.length; i += stride) {
    const a = avenue[i];
    for (let k = 0; k < perCol; k++) {
      emit.push({
        u: a.u + (rnd() - 0.5) * 2 * jitter,
        v: a.v + (rnd() - 0.5) * 2 * jitter,
        aPhase: a.aPhase,                      // CARRIED — emission gated by the same sweep
        aSeed: rnd(),
        aBirth: rnd() * life,                  // desync: uniform in [0, life)
        aLife: life * (0.8 + rnd() * 0.4),     // ±20% life jitter → no synchronized curtain
      });
    }
  }
  return { emit, life };
}

const VERT = `
attribute float aGround;
attribute float aBirth;
attribute float aLife;
attribute float aSeed;
attribute float aPhase;
uniform float uTime;
uniform float uFallDist;
uniform float uScale;          // 0.5 * drawingBufferHeight (size-attenuation)
uniform vec2 uEmit;            // prev, cur emission amount
uniform vec2 uSize;            // prev, cur world-radius
uniform vec2 uSway;
uniform vec2 uSpin;
uniform vec2 uFall;
uniform float uProg;
uniform float uStagger;        // MUST match the canopy (0.7)
uniform float uBand;           // MUST match the canopy (0.3)
uniform float uEmitMul;        // live emission multiplier (audio LIVE density; default 1)
uniform float uAppear;         // reveal gate (0→1) — petals appear WITH the 並木 (after buildings)
varying float vAlpha;
varying float vProgI;
void main() {
  // GPU recycle — shared uTime, per-particle aBirth desync. No CPU respawn.
  float age = mod(uTime - aBirth, aLife);
  float frac = age / aLife;                                  // 0 (top) → 1 (ground)

  // same sweep gate as the canopy: only fall where the season has arrived
  float _pStart = min(aPhase * uStagger, 1.0 - uBand);
  float progI = smoothstep(_pStart, _pStart + uBand, uProg);

  float emit = mix(uEmit.x, uEmit.y, progI);
  float sway = mix(uSway.x, uSway.y, progI);
  float spin = mix(uSpin.x, uSpin.y, progI);
  float psz  = mix(uSize.x, uSize.y, progI);
  float fall = mix(uFall.x, uFall.y, progI);

  // vertical fall: from (aGround + uFallDist) down to aGround. fall>1 lands before frac=1.
  vec3 pos = position;                                       // position.y is the spawn top
  float drop = clamp(frac * fall, 0.0, 1.0) * uFallDist;
  pos.y = (aGround + uFallDist) - drop;

  // horizontal sway, seed-phased so columns don't move in lockstep; ×frac so it starts
  // tight at birth and opens up as it falls (two axes → a tumble feel).
  float w = uTime * spin + aSeed * 31.4159;
  pos.x += sway * frac * sin(w);
  pos.z += sway * frac * cos(w * 0.83 + aSeed * 7.0);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(psz * uScale / max(-mv.z, 0.05), 1.0, 16.0);

  float fadeIn = smoothstep(0.0, 0.08, frac);
  float fadeOut = 1.0 - smoothstep(0.85, 1.0, frac);
  vAlpha = fadeIn * fadeOut * progI * emit * uEmitMul * uAppear;
  vProgI = progI;
}`;

const FRAG = `
uniform vec2 uGrey;            // prev, cur mono brightness
uniform vec3 uColor0;          // prev, cur chroma (step-6 uMode)
uniform vec3 uColor1;
uniform float uMode;
varying float vAlpha;
varying float vProgI;
void main() {
  if (vAlpha <= 0.002) discard;
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;                                      // round point
  float soft = 1.0 - smoothstep(0.30, 0.5, r);
  float grey = mix(uGrey.x, uGrey.y, vProgI);
  vec3 chroma = mix(uColor0, uColor1, vProgI);
  vec3 col = mix(vec3(grey), chroma, uMode);                // mono default; snow stays white
  gl_FragColor = vec4(col, vAlpha * soft);
}`;

// THREE: build the reusable Points system. emit = planEmit().emit; terrain = the DEM mesh
// (raycast once per emitter for the ground Y, like trees.js). Returns { points, update }.
export function buildParticles(planned, terrain, manifest, opts = {}) {
  const { emit, life } = planned;
  const { SCALE, vOffset } = manifest.scale;
  const fallDist = opts.fallDist ?? 1.6;     // world units a particle falls before recycling
  const renderer = opts.renderer || null;    // for size-attenuation (drawing-buffer height)
  const n = emit.length;

  // ground height per emitter via the shared heightfield sampler (reuse the trees.js
  // groundY idiom) — one xz triangle grid, O(1)/query instead of a full-mesh raycast.
  const groundY = makeGroundSampler(terrain);

  const aOrigin = new Float32Array(n * 3);   // spawn top: x, gy+fallDist, z (also base xz)
  const aGround = new Float32Array(n);
  const aBirth = new Float32Array(n);
  const aLife = new Float32Array(n);
  const aSeed = new Float32Array(n);
  const aPhase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = emit[i];
    const wx = e.u * SCALE, wz = (e.v - vOffset) * SCALE;
    const gy = groundY(wx, wz);
    aOrigin[i * 3] = wx; aOrigin[i * 3 + 1] = gy + fallDist; aOrigin[i * 3 + 2] = wz;
    aGround[i] = gy; aBirth[i] = e.aBirth; aLife[i] = e.aLife;
    aSeed[i] = e.aSeed; aPhase[i] = e.aPhase;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(aOrigin, 3));
  geo.setAttribute('aGround', new THREE.BufferAttribute(aGround, 1));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(aBirth, 1));
  geo.setAttribute('aLife', new THREE.BufferAttribute(aLife, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  // particles drift in x/z and fall in y in-shader, so CPU bounds would be wrong → cull off.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

  const U = {
    uTime: { value: 0 },
    uFallDist: { value: fallDist },
    uScale: { value: 600 },                  // refreshed each frame from the renderer
    uEmit: { value: new THREE.Vector2(0, 0) },
    uSize: { value: new THREE.Vector2(0.05, 0.05) },
    uSway: { value: new THREE.Vector2(0.1, 0.1) },
    uSpin: { value: new THREE.Vector2(1, 1) },
    uFall: { value: new THREE.Vector2(1, 1) },
    uProg: { value: 0 },
    uStagger: { value: 0.7 },                 // match canopy sweep
    uBand: { value: 0.3 },
    uEmitMul: { value: 1 },                   // live density (audio LIVE); 1 = authored look
    uAppear: { value: 1 },                    // reveal gate (0→1) — petals appear with the 並木

    uGrey: { value: new THREE.Vector2(0.8, 0.8) },
    uColor0: { value: new THREE.Vector3(1, 1, 1) },
    uColor1: { value: new THREE.Vector3(1, 1, 1) },
    uMode: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.NormalBlending,           // 守る線: NOT additive — no glow
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;                    // after opaque so depthTest culls occluded points

  let modeTarget = 0;
  function update(season, mode, dt) {
    const ep = particleEndpoints(season.index);
    U.uEmit.value.set(ep.prev.amount, ep.cur.amount);
    U.uSize.value.set(ep.prev.size, ep.cur.size);
    U.uSway.value.set(ep.prev.sway, ep.cur.sway);
    U.uSpin.value.set(ep.prev.spin, ep.cur.spin);
    U.uFall.value.set(ep.prev.fall, ep.cur.fall);
    U.uGrey.value.set(ep.prev.grey, ep.cur.grey);
    U.uColor0.value.set(ep.colorPrev[0], ep.colorPrev[1], ep.colorPrev[2]);
    U.uColor1.value.set(ep.colorCur[0], ep.colorCur[1], ep.colorCur[2]);
    U.uProg.value = season.prog;
    U.uTime.value += dt || 0;
    if (renderer) U.uScale.value = 0.5 * renderer.domElement.height;
    if (mode != null) modeTarget = mode ? 1 : 0;
    U.uMode.value += (modeTarget - U.uMode.value) * Math.min(1, (dt || 0) * 4); // ~0.6s crossfade
  }

  return { points, update, uniforms: U, life };
}
