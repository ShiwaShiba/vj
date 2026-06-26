# City Audio-Reactive Mapping — Design Spec

**Date:** 2026-06-26
**Status:** design — corrected after adversarial critique **and** a pre-implementation code audit (GO-WITH-EDITS); the audit punch-list (2 blockers, 6 majors, 7 minors) is applied below. Ready to implement.
**Scope:** the standalone `city-proto.html` / `src/cityproto/proto.js` page. Production `SceneManager`/`Scene` integration is an explicit *later* step (see §3 → Future-Scene note).
**Branch context:** `feat/city-webgl-render`. Plan 3 (staged-zoom seasonal-reveal intro) steps 1–6 are complete & committed.

This spec makes the WebGL city scene react to live mic audio while preserving the authored seasonal-reveal intro. It does **not** build new audio DSP — it consumes the existing `src/audio/*` stack.

---

## 1. Locked decisions (user-approved — design lives within these)

1. **Two-phase structure.** Phase 1 = the authored staged-zoom seasonal intro (4 cycles = 4 seasons, camera rig ①→④ round-trip + building reveal) plays **once on its own clock**; audio adds only light *accents* during the intro. At the end it **hands off** to Phase 2.
2. **Phase 2 = held / breathing camera.** The camera parks at a hero framing and only *breathes* (a `level`-driven micro-dolly). It never orbits, pans, or jumps on a beat/drop. Beats are received as **in-frame** accents (particles / 染めsweep), not camera moves.
3. **Phase 2 color control = three coexisting, switchable modes** (default `burst`): (a) `burst` — season frozen at 冬, audio drives a mono↔chroma bloom; (b) `advance` — phrase/drop advances the season 冬→春→夏→秋; (c) `manual` — VJ picks season/variant by hand. All three resolve color through `seasons.js` only.

---

## 2. Non-goals & 守る線 (hard constraints)

**Refused mappings:**
- **No camera travel on beats/drops.** Phase-2 camera = parked hero + micro-dolly breath only.
- **No per-beat color flips.** Chroma is a bounded, decaying opt-in, never latched per beat.
- **No audio-forced strobe.** The winter white strobe stays behind the VJ `S` key (`strobeEnabled`). Audio may modulate the strobe *rate* **only while the VJ has already enabled the gate**. The reactor never emits a strobe *gate*. (This is a corrected breach — see §9.)
- **No new palettes / no RGB from the reactor.** The reactor emits `seasonIndex` (int) + `chromaMix` (0..1) only; all color resolves through `seasons.js` (`CHROMA_VARIANTS`, `seasonEndpoints`, `particleEndpoints`).
- **No re-lighting / no additive glow.** `particles.js` keeps `NormalBlending`. Snow stays white in every mode/variant.
- **No new DSP.** Drop/build detection uses only the existing `level / bass / bpm / beat / beatHold` features (no spectral flux). Reuse `src/audio/smoothing.js` `EnvelopeFollower`.
- **Audio does not seek the intro.** `director.update(tSec)` runs on its own clock in Phase 1; the authored arc is deterministic.

**Invariants (each asserted by a headless test):**
- `strobeRate = min(3, bpm/60)` — single hard clamp, fuzz-tested over bpm ∈ [0,600] to never exceed 3 Hz (光感受性). `setStrobeRate` already clamps too (belt-and-suspenders).
- `chromaMix` resting target = **0** (mono) in every mode. Chroma is always a transient bloom.
- Determinism: identical synthetic frame arrays ⇒ byte-identical knob sequences (pure `extractFeatures`/`reduce`/`smoothKnobs`).
- `seasons.js` stays the single source of truth for all palettes.

---

## 3. Architecture

### Files

- **`src/cityproto/live.js`** — **PURE** (no THREE / DOM / AudioEngine / `Math.random` / `Date`). The whole reactive contract: feature extraction, the 2-phase reducer, and knob smoothing. 100% unit-testable in node.
- **`src/cityproto/liveDriver.js`** — the thin **non-pure adapter**. Owns the `AudioEngine` instance + a `Clock`, the tap-to-start gesture, the `phaseState`/`prevKnobs`/`prevFeat` carry, and the per-frame writes into THREE objects. This is the **only** file a future Scene wrapper re-authors.

### Existing files that must change (not just new files)

- **`src/cityproto/particles.js`** — add a `uEmitMul` uniform (default `1.0`) multiplied into `vAlpha` in `VERT` (`vAlpha = fadeIn*fadeOut*progI*emit*uEmitMul`). This is the *cheap per-frame density knob*. Rationale: `proto.js`'s `setPetals` calls `rebuildParticles()` which **disposes + rebuilds the whole `THREE.Points` system** — unusable per-frame/per-beat. `uEmitMul` lets the reactor scale emission live with zero allocation. `NormalBlending` is preserved (`particles.js:178`), so `uEmitMul>1` saturates toward opaque, never additive glow. (Corrected gap — see §9.)
- **`src/cityproto/overlay.js`** — `overlayIntensity` is a first-class knob but `makeOverlay(canvas, getCredits)` today returns a parameterless `draw()` with hardcoded grain alpha `0.05` / vignette `0.55` / haze `0.85`. Add a live `getIntensity()` (mirroring `getCredits`) that scales **grain alpha `0.04→0.10`** (vignette/haze optional). Resting default reproduces the current look (grain `0.05`). The loop passes `knobs.overlayIntensity`. (Corrected gap M1.)
- **`city-proto.html` + `src/cityproto/proto.js`** — **tap-to-start mic gesture.** `AudioEngine.start()` must run inside a user gesture (`AudioEngine.js:39`); the standalone page has only `#gl`/`#ov` canvases (`#ov` is `pointer-events:none`) and keydown listeners. Add a one-time **tap-anywhere overlay / Start affordance** on `#gl` whose handler calls `audio.start()` (with the getUserMedia "tap to enable mic" permission UX); on denial, visuals keep running on the internal clock (mirror `main.js`'s non-blocking start). (Corrected gap M4.)
- **`src/cityproto/proto.js`** — the render loop gets an explicit **LIVE branch** (materially more than a few lines): in LIVE, the director's camera/season/reveal writes are **suppressed** and the driver becomes the sole writer of camera params + `trees`/`particles` `uMode`. In INTRO, the director stays authoritative and the driver only layers accents. Construct the `liveDriver` after `loadCity` resolves; call `driver.frame(dt, now)` once per frame. Also add the `M` key → `setColorMode` cycling (leave the existing `C` key, which toggles mono↔chroma, intact — see §7).

### Pure contract (`live.js`)

```js
export const PHASE = { INTRO: 'intro', LIVE: 'live' };

// plain-data config; one object per color-mode test case
export function defaultModeConfig() // → {
//   colorMode: 'burst',          // 'burst' | 'advance' | 'manual'
//   heroFraming: 'k4',           // park keyframe for LIVE (k4 = ④ 全域; k1 = ① 旧駅舎)
//   // handoff geometry, supplied by the driver from director timing (keeps reduce pure):
//   cycleDur, winterCycleStart,  // = 3*cycleDur
//   hold4Start, hold4Dur,        // local offsets of winter ④ hold4 within a cycle
//   handoffWindowBeats: 16,      // musical-cue window after entering hold4 before fallback
//   // drop/season tuning (device-tuned later):
//   dropThresh: 0.25, dropRefractoryS: 2.0, advanceOnPhrase: false,
//   seasonMinDwellBeats: 4,      // ≥1 bar dwell so rapid drops can't thrash seasons
//   manualSeason: 3, manualVariant: 'current',
//   chromaCeil: 0.35, chromaBurst: 0.6, chromaDecayTau: 2.0,
//   breathAmp: 0.04, petalIdleMul: 0.2, petalCap: 2.0,
//   beatPulseGain: 0.5, beatPulseGainWinter: 0.18, // winter pulse attenuated (m6 ≤3Hz guard)
//   bpmMedianWindow: 8,                            // pure median-hold on audioState.bpm
// }

export function initPhaseState(cfg) // → {
//   phase:'intro', tSec:0, armed:false, frozenTSec:null,
//   seasonIndex:3, seasonProg:1,
//   chromaEnv:0,                 // single owner of chroma decay (NOT also smoothed driver-side)
//   slowLevel:0,                 // explicit EMA baseline for drop detection (plain number)
//   lastDropT:-1e9, lastDropBeat:-1e9, lastAdvanceBeat:-1e9,
//   parkParams:null
// }

// pure: raw audio.state + clock → smoothed musical-structure features.
// prevFeat threads the smoothing state as plain numbers (no hidden followers).
export function extractFeatures(audioState, clock, prevFeat, dt) // → feat {
//   levelSlow, levelFast, bassSlow, buildAmt, dropFired:bool,
//   beatPulse, silenceSec, treble, mid, bpm, beatPhase, beats, beatJustWrapped
// }

// pure: the 2-phase state machine. Threads phaseState explicitly.
export function reduce(phaseState, feat, modeConfig, dt) // → { next, targets }

// pure: ease prevKnobs toward targets via the STATELESS expSmooth (smoothing.js:5-8),
// threading prevKnobs[field] as `current`. live.js constructs NO EnvelopeFollower
// instances (EF is a stateful class that also clamps to [0,1]). Per-knob coefficient
// k = 1 - exp(-dt/τ) so dt is honored frame-rate-independently. Clamp to [0,1] ONLY the
// genuine 0..1 knobs (chromaMix, petalDensity, overlayIntensity, camBreath); camParams /
// fov / strobeRate are smoothed UNCLAMPED and bounded by their own domain (strobeRate by
// min(3,·)). Lives here (not the driver) so the temporal envelopes the tests assert are pure.
export function smoothKnobs(prevKnobs, targets, dt) // → knobs
```

`targets` / `knobs` shape (every field a **final value**, eased by `smoothKnobs`):

```js
{
  phase,            // 'intro' | 'live'
  camParams,        // {camX,camY,camZ,fov,lookX,lookY,lookV} — k(hero) in LIVE, ignored in INTRO
  camBreath,        // 0..1 micro-dolly scalar applied to camZ (LIVE only)
  seasonIndex,      // int 0..3 — reactor-owned in LIVE; director-owned (ignored) in INTRO
  seasonProg,       // 0..1 — reactor-owned in LIVE
  chromaMix,        // 0..1 continuous → trees/particles uMode (NOT 0/1)
  petalDensity,     // → particles uEmitMul (NEVER setPetals per-frame)
  strobeRate,       // Hz, hard-clamped ≤3 (only meaningful while VJ gate on)
  overlayIntensity  // grain/vignette/haze scalar (→ overlay.js getIntensity)
  // NOTE: no strobeGate — the gate is the VJ S-key only (守る線).
  // NOTE: sweepPulse was dropped (M3) — reveal.setProgress is an absolute write with no
  //       nudge hook, and a per-beat seasonProg reset transiently flashes autumn; the
  //       in-frame accent budget is covered by petalDensity + chroma + overlay instead.
}
```

### Smoothing — one owner each (corrected)

- The per-knob easing lives in the **pure** `smoothKnobs`, built from the **stateless** `expSmooth(current, target, attack, release)` (`smoothing.js:5-8`) with `prevKnobs` threaded as `current`. `live.js` constructs **no** `EnvelopeFollower` instances — `EnvelopeFollower` (`smoothing.js:11-21`) is a stateful class that mutates `this.value` and hard-clamps targets to `[0,1]`, which would silently collapse `strobeRate` (0..3) and `camParams`/`fov`. So determinism/temporal tests run headlessly without constructing `AudioEngine`.
- Each per-knob coefficient is `k = 1 - exp(-dt/τ)` (computed inside `smoothKnobs`), so the τ values in §6 are delivered frame-rate-independently and `dt` is actually consumed. `[0,1]` clamps apply **only** to the genuine 0..1 knobs; `camParams`/`fov`/`strobeRate` are smoothed unclamped and bounded by their own domain.
- `chromaMix` decay has **one** owner: `phaseState.chromaEnv` inside `reduce`. The driver/`smoothKnobs` do **not** additionally smooth `chromaMix`. (Corrected double-smoothing — see §9.)
- `slowLevel` (drop baseline) is an explicit EMA threaded as a plain number in `phaseState` — fully testable, no hidden follower.

### AudioEngine adapter seam (`liveDriver.js`)

Each frame: `audio.update(now)` → `clock.update(dt, audio.state.bpm, audio.state.beat)` (the real signature, `Clock.js:15`; the clock then exposes `beatPhase/beats/beatJustWrapped`) → `feat = extractFeatures(audio.state, clock, prevFeat, dt)` → `{next, targets} = reduce(phaseState, feat, modeConfig, dt)` → `knobs = smoothKnobs(prevKnobs, targets, dt)` → write THREE.

**Handoff geometry is read from the live director, not cached.** `setTiming → rebuildDirector` (`proto.js:93,110-116`) swaps the director with new durations live, and `createDirector` returns `{update, cycleDur, segments, tuning}` (no hold4 offsets). So each frame (or on each rebuild) the driver derives and passes into `reduce`: `cycleDur = director.cycleDur`, `winterCycleStart = 3*cycleDur`, `hold4Start = Σ dur of segments before the one named 'hold4'`, `hold4Dur = that segment's dur`.

**Single writer of `uMode` in LIVE:** the driver calls `trees.update(season, /*mode=*/null, dt, {strobe})` and `particles.update(season, /*mode=*/null, dt)` (passing `mode=null` leaves their internal `modeTarget` untouched), **but `update()` still eases `U.uMode.value` toward `modeTarget` every frame** (`trees.js:251-252`, `particles.js:198-199`). So the driver must override `trees.uniforms.uMode.value` and `particles.uniforms.uMode.value` to `knobs.chromaMix` **unconditionally, after** the `update()` calls, every frame. The reactor is then the **sole effective** writer of `uMode` in LIVE.

### Future-Scene note

`live.js` is the portable contract: a future `Scene.update(dt, audio, palette, clock)` feeds the same `extractFeatures`/`reduce`/`smoothKnobs` with `audio.state` + `clock` straight from `Engine.js` (already contract-compatible). Only `liveDriver.js` is re-authored into the Scene. `live.js` never learns about `SceneManager`.

---

## 4. Two-phase state machine

`reduce` **is** the machine. Two states, one-way latch (mirrors the `reveal` one-shot idiom — never returns to INTRO).

### Phase 1 — INTRO

`director.update(tSec)` stays fully authoritative over camera / reveal / season (unchanged, on its own clock). The reactor owns **no** season/camera here; it emits only additive accents:
- `beatPulse → sweepPulse` (small reveal re-pulse / 染めsweep nudge).
- `treble → petalDensity` shimmer (small, via `uEmitMul`).
- `levelSlow → overlayIntensity` grain riding the music.

### Handoff — arm in the winter cycle, freeze at the ④ pose (corrected)

director season index = `floor(tSec/cycleDur) % 4` with `SEASON_NAMES = [spring, summer, autumn, winter]`. So **winter = cycle index 3**, `tSec ∈ [3·cycleDur, 4·cycleDur)`. (Arming at `tSec ≥ 4·cycleDur` would land in **spring** — the prior bug. Corrected.)

1. **Arm** when `phase==='intro' && tSec ≥ winterCycleStart (=3·cycleDur)`. Set `armed=true`. The winter cycle plays normally (camera ①→②→③→④).
2. **Fire** once the winter camera reaches **hold4** (local `∈ [hold4Start, hold4Start+hold4Dur]`) on the **first** of: the next `feat.dropFired`, OR the next phrase boundary (`beatJustWrapped && beats % 16 === 0`), within `handoffWindowBeats`.
3. **Fallback:** if no musical cue by the **end of hold4**, fire unconditionally at `hold4Start+hold4Dur` (so the camera never enters the reverse leg). This bounds the transition for ambient/flat tracks and the test harness.

On fire: `phase='live'`; `frozenTSec = 3·cycleDur + hold4Start` (the winter ④ hold4 pose); `parkParams =` a **snapshot of the live director camera at the fire frame** (i.e. the exact `cam` the director just produced, *including any parallax offset*); latch `seasonIndex=3, seasonProg=1, chromaMix=0`. proto stops ticking the director.

> Snapshotting the live camera (not raw `k4`) makes "park == current camera" hold **regardless of the P-key parallax toggle**: with parallax off the snapshot equals `k4` exactly (hold4 is `from===to===k4`, `director.js:37`); with parallax on, `director.update` applies `applyParallax(k4, local/cycleDur, amt)` (`director.js:57`), so freezing to raw `k4` would be a visible cut — the snapshot avoids it. Either way: no snap, no ease. The handoff lands on the kick when music is present and always completes headlessly.

### Phase 2 — LIVE

The director no longer travels. The reactor owns `{camParams=k(hero)+camBreath, seasonIndex, seasonProg, chromaMix, petalDensity, strobeRate, overlayIntensity, sweepPulse}`.

---

## 5. Phase-2 held / breathing camera

- **Default park = `k4` (④ 国立全域).** Reasoning: a wide frame hides micro-reactivity (restraint); ① 旧駅舎 is more iconic but jitter-prone, so it's `heroFraming:'k1'` opt-in. Decided by eye on device.
- The only live camera modulation is `camBreath` → micro-dolly on `camZ` (and an optional ∓ small FOV breath), bounded to ±`breathAmp`·camZ (≈±2 world units of 50) — reads as breathing, never nausea.
- `camBreath` is driven by `level` through a slow envelope (breath τ≈0.8 s), optionally phase-synced to `clock.beatPhase` for smoothness — but it **never** moves the camera position on a beat.

---

## 6. Audio→visual mapping table

Smoothing = the τ of the stateless `expSmooth` step inside `smoothKnobs` (per-knob `k=1-exp(-dt/τ)`), or the in-`feat` EMA τ. No `EnvelopeFollower` instances.

| Feature | City knob | Curve / amplitude | Smoothing τ |
|---|---|---|---|
| `level` | `camBreath` → micro-dolly on `camZ` (+ optional FOV) | `pow(level,1.5)` → ±`breathAmp`·camZ / ∓~1.5° FOV | τ≈0.8 s (breath) |
| `levelSlow` | `overlayIntensity` → grain alpha `0.04→0.10` (vignette/haze optional) | linear | τ≈1.2 s |
| `bass` | `petalDensity` floor | floor `0.8+0.6·bass` | τ≈0.25 s |
| `beat`/`beatJustWrapped` | `petalDensity` pulse (in-frame accent, **not** camera) | `+pulseGain` impulse on onset, decays with `beatHold`. **In winter/burst the pulse gain is attenuated** so the effective luminance-change of the near-white snow stays well under 3 Hz (m6 guard) | τ≈0.25 s rise / longer fall |
| `audioState.bpm` | `strobeRate` (only while VJ gate on) | **`min(3, bpm/60)`** — hard cap 3 Hz | `bpm` jitter-smoothed (median-hold) **inside `extractFeatures`** — pure |
| `treble` | `petalDensity` sparkle + top haze | map [0.1,0.7]→sparkle add, clamped | τ≈0.3 s (hi-hat) |
| (drop event) | `chromaMix` bloom (mode `burst`) | drop → `chromaEnv += chromaBurst`; decays to **0** (τ=`chromaDecayTau`) — **transient only, no sustain** | owned by `phaseState.chromaEnv` |
| `clock.beatPhase` | accent timing + breath LFO sync | continuous; phase-locks accents | from Clock |
| `clock.beats` | phrase counter (16-beat) → mode-`advance` + handoff gate | integer | from Clock |

**`petalDensity` composition (single `uEmitMul` scalar, m5):** combine the contributions explicitly and cap:
`petalDensity = clamp( max(petalIdleMul, bassFloor) + beatPulse + trebleSparkle, 0, petalCap )`.
So silence ⇒ `petalDensity == petalIdleMul` (test #1 well-defined), and the sum can never run away.

**Drop / build detector (pure, in `phaseState`, no new DSP — uses only `level`/`bass`/`bpm`/`beat`):** keep `slowLevel = EMA(release≈3 s)` of `level`. A **drop fires** when `level − slowLevel > dropThresh` AND `bass` jumps AND `tSec − lastDropT > dropRefractoryS` AND `≥ seasonMinDwellBeats` since `lastAdvanceBeat`. On a drop: `burst` adds `chromaBurst` to `chromaEnv`; `advance` increments `seasonIndex`. `buildAmt = clamp((levelFast−levelSlow)/0.3, 0, 1)` over ≥4 beats — a hint for mode-`advance`.

**Quietest idle (silence):** `camBreath≈0`; `petalDensity → petalIdleMul (≈0.2)` so the dense winter snow (`PARTICLE[3].amount=1.0`) thins to a few flakes via `uEmitMul` (NOT a rebuild); `chromaMix→0` pure mono winter; overlay grain/vignette breathe on their own slow LFO. Energy *emerges*: first treble adds sparkle, then a detected drop blooms color (`burst`) or advances the season (`advance`). Nothing orbits, nothing flashes unbidden, and color is never the resting state.

---

## 7. The three coexisting Phase-2 color modes

`modeConfig.colorMode ∈ {'burst','advance','manual'}`, **default `'burst'`**. All three are *layers over one `seasonIndex` + one continuous `chromaMix`* — the reactor emits an index + a 0..1 mix, **never RGB**. `seasons.js` stays the single source of truth.

- **(a) `burst` (default)** — season frozen at winter (3). `chromaMix` is **transient-only**: a detected drop adds `chromaBurst` to `phaseState.chromaEnv`, which then decays to **0** (τ=`chromaDecayTau`≈2 s). There is **no mid-driven sustain** — the resting `chromaMix` is exactly 0 (strict mono), satisfying the §2 invariant. The room flushes with color on the drop and drains fully back to monochrome. (`chromaEnv` clamped to `[0, chromaCeil]`, with `chromaCeil` here acting as the bloom peak cap.)
- **(b) `advance`** — each detected drop (or every 4th phrase if `advanceOnPhrase`) → `seasonIndex=(i+1)%4` (冬→春→夏→秋), `seasonProg` reset to 0 so the existing 染めsweep + particle-type swap (雪→花びら→(緑)→落ち葉) animate via `seasonEndpoints`/`particleEndpoints`. `chromaMix` held low so the season *type* reads, not a rave. **Min dwell `seasonMinDwellBeats` (≥1 bar)** so rapid drops can't thrash 冬↔春.
- **(c) `manual`** — reactor leaves `seasonIndex`/`chromaMix` pinned to `manualSeason`/`manualVariant`; the VJ uses the existing `setChromaVariant` + a promoted **C** key. Audio still drives `camBreath` + particle accents only.

**Switching:** the **`M` key** (free — `C`/`S`/`P`/space/`[`/`]` are taken; `proto.js:170-177`) cycles `colorMode` via `setColorMode(name)`, which only writes `modeConfig.colorMode` — no driver state touched, so there is no fight. The existing **`C` key is left intact** (it toggles the intro mono↔chroma `mode`); `manual` mode then uses `setChromaVariant` + `C` for the VJ's hand-pick. Existing setters stay valid: in `manual` they set absolute values; in `burst`/`advance` they set *ceilings/variants* the reactor modulates under (e.g. `setPetals` sets the base `uEmitMul` rides on — but the per-frame rebuild path is avoided in the live loop).

---

## 8. Remote headless verification plan

`tests/cityproto/live.test.mjs` (node, no browser/mic). Helper `mkFrame({level,bass,mid,treble,beat,beatHold,bpm})` + a fake `clock` exposing `{beatPhase, beats, beatJustWrapped}`. Feed synthetic streams to `extractFeatures`/`reduce`/`smoothKnobs`:

1. **silence** (all-zero, N frames) → `camBreath≈0`, `petalDensity ≤ petalIdleMul`, `chromaMix→0`, no drop, phase unchanged.
2. **steady `level=0.5`** → `camBreath` converges monotonically (via `smoothKnobs`), bounded ±`breathAmp`; no spurious drop; no `seasonIndex` change.
3. **beat train @128 bpm** (`bpm` supplied via `mkFrame` → `audioState.bpm`) → `strobeRate ≈ min(3, 128/60)`; one decaying `petalDensity` kick per beat (count == beats); **assert `strobeRate` never > 3 Hz**; **assert `camParams` unchanged on beats**; **assert the winter beat-pulse luminance-change rate stays ≤3 Hz** (m6 guard).
4. **build→drop** (≥1 bar low, then `level`+`bass` jump at a phrase boundary) → exactly one `dropFired`, debounced (second inside refractory → no change). `advance`: `seasonIndex` increments exactly once (min-dwell blocks a second within 1 bar). `burst`: `chromaEnv`→`chromaMix` rises > 0.8·burst then decays < 0.05 within N s. `manual`: `seasonIndex`/`chromaMix` unchanged.
5. **handoff** — drive synthetic `tSec` into the winter cycle (`≥3·cycleDur`), reach hold4, inject a drop → assert `phase` flips intro→live **exactly once**, lands on `beatJustWrapped` when a cue is present, `frozenTSec` = winter hold4, `parkParams ==` the **last director camera** passed in at the fire frame (== `k4` with parallax off; == the parallaxed pose with parallax on), `seasonIndex=3`, never reverts. Separate case: reach hold4 with **no** cue → fallback fires by `hold4Start+hold4Dur` (never enters reverse). Separate case: assert arming at `3·cycleDur` keeps the season at winter (regression for the off-by-one).
6. **strobe clamp fuzz** — random `bpm` ∈ [0,600], `treble=1`, VJ gate on → `strobeRate ∈ [0,3]` always; gate off → strobe never engaged by audio.
7. **determinism** — replay an identical frame array twice, each run from a fresh `initPhaseState` + zeroed `prevFeat` + zeroed `prevKnobs`, → byte-identical `{feat, next, targets, knobs}` sequences across the whole pipeline (`extractFeatures`+`reduce`+`smoothKnobs`). Plus a static assertion that `live.js` holds **no module-level mutable state** (all state threaded through `phaseState`/`prevFeat`/`prevKnobs`).
8. **season continuity at advance** — import pure `seasonEndpoints`/`particleEndpoints` and assert `colorCur(prevIndex) === colorPrev(newIndex)` at the boundary. (This tests `seasons.js`'s continuity invariant; `seasonProg` itself intentionally steps 1→0.)
9. **mode isolation** — `colorMode='manual'` → reactor never overrides `seasonIndex`/`chromaMix`.

**Provable now (headless):** all knob math, the state machine + one-way latch, handoff arm/fire/fallback + winter-freeze, all clamps, mode switching, drop refractory + min-dwell, determinism, season-endpoint continuity.

**Still needs a device to tune (cannot be asserted headlessly):**
- Absolute thresholds — `dropThresh`, the interplay with `AudioEngine.sensitivity` — room/gain-dependent.
- `camBreath` amplitude aesthetics — the headless test only *bounds* it, doesn't judge feel.
- Whether `BeatDetector` fires cleanly live, and whether `bpm` octave-jumps (→ `strobeRate` jitter).
- Whether the drop detector false-fires on minimal-techno's flat builds (no real silence) — tune `dropThresh`/level-gate.
- Park-framing taste call (`k4` vs `k1`) — `modeConfig.heroFraming`, decided by eye.

---

## 9. Corrections applied after critique (audit trail)

The first synthesized draft was adversarially reviewed; these real defects were found (confirmed against code) and are already folded into §2–§8:
1. **Audio-forced winter strobe (守る線 breach).** Draft mapped `beatHold → strobeGate`; LIVE default season is winter, so every beat would auto-flash. **Fix:** reactor emits no gate; strobe stays VJ-`S`-keyed; audio only modulates *rate* when the gate is already on.
2. **New DSP (spectral flux).** **Fix:** drop/build detector uses only existing `level/bass/bpm/beat`.
3. **Purity leak.** Temporal envelopes the tests assert lived in the non-pure driver. **Fix:** `smoothKnobs` is a pure `live.js` export built from the **stateless** `expSmooth` (not `EnvelopeFollower`, which is stateful and clamps to [0,1]); `k=1-exp(-dt/τ)`; clamps only the 0..1 knobs.
4. **`chromaMix` double-smoothed.** **Fix:** single owner `phaseState.chromaEnv`.
5. **Handoff season off-by-one.** Arming at `4·cycleDur` lands in spring → spring→winter pop. **Fix:** arm in the winter cycle, freeze at winter ④ hold4.
6. **Park-snap = a camera cut.** **Fix:** freeze at hold4 (`from===to===k4`) so park == current camera, no cut.
7. **`uMode` not single-writer via a ~6-line change.** The director keeps wrapping seasons in LIVE. **Fix:** explicit LIVE branch in `proto.js` suppresses director writes; driver is sole `uMode` writer.
8. **`petalDensity` = full GPU rebuild.** `setPetals → rebuildParticles` disposes/rebuilds. **Fix:** add `uEmitMul` uniform to `particles.js`; never `setPetals` per-frame.
9. **Winter idle "few snowflakes" was false.** `PARTICLE[3].amount=1.0` = dense snow. **Fix:** `petalIdleMul` scales emission down via `uEmitMul` at idle.

---

## 10. Open questions (revisit during device tuning)

1. **BPM stability** — `BeatDetector` already medians inter-onset intervals (`BeatDetector.js:60`), but bpm can still octave-jump on sparse tracks → `strobeRate` jitter under the 3 Hz ceiling. `extractFeatures` adds a pure median-hold on `audioState.bpm`; tune its window on device.
2. **Drop detection on flat builds** — minimal-techno has no real silence; `slowLevel` baseline + refractory + level-gate mitigate, but need real tuning. Phrase-counting (every N beats) may be a more reliable cadence for mode-`advance` than raw level deltas.
3. **Park framing** — `k4` (restraint) vs `k1` (iconic). `modeConfig.heroFraming`; decide by eye.
4. **Handoff window** — `handoffWindowBeats=16` (one phrase) before fallback; may need shortening if settle feels long.
5. **`uMode` continuous path across a season advance** — confirm feeding `trees`/`particles` an external continuous `uMode` (via `mode=null` + direct override) shows no pop where the internal ease used to run (test #8 covers the color endpoints; confirm visually).

---

## 11. Files

- **New:** `src/cityproto/live.js` (pure), `src/cityproto/liveDriver.js` (adapter), `tests/cityproto/live.test.mjs`.
- **Edit:**
  - `src/cityproto/particles.js` — add `uEmitMul` uniform (× into `vAlpha`).
  - `src/cityproto/overlay.js` — `makeOverlay(canvas, getCredits, getIntensity)`; scale grain alpha `0.04→0.10` from `getIntensity()`; resting default = current look (M1).
  - `src/cityproto/proto.js` — LIVE branch (suppress director writes; override `uMode` after `update()`); construct/​drive `liveDriver`; derive hold4 offsets from live `director.segments`; wire `overlayIntensity`; add `M` key → `setColorMode`.
  - `city-proto.html` — tap-to-start affordance for `audio.start()` (mic gesture + permission UX), non-blocking on denial (M4).
- **Reference (unchanged, single sources):** `src/audio/AudioEngine.js`, `src/audio/BeatDetector.js`, `src/audio/smoothing.js` (use the stateless `expSmooth`), `src/engine/Clock.js`, `src/cityproto/seasons.js`, `src/cityproto/director.js`, `src/cityproto/trees.js`, `src/cityproto/camrig.js` (keyframes carry `fov`), `src/cityproto/reveal.js`.

---

## 12. Pre-implementation audit fixes (audit trail)

A 4-lens code audit (守る線 / purity / integration / completeness) verified every spec claim against the actual files. Verdict **GO-WITH-EDITS**; these are applied above:

- **B1 — `smoothKnobs` purity/clamp defect.** `EnvelopeFollower` is stateful + clamps to `[0,1]` (would collapse `strobeRate`/`camParams`). → use stateless `expSmooth`, `k=1-exp(-dt/τ)`, clamp only 0..1 knobs (§3, §6).
- **B2 — `chromaMix` invariant contradiction.** The default `burst` had a mid-sustain that broke "rests at 0". → chroma is **transient-only** (drop-triggered, decays to 0); strict mono default (§2, §6, §7a, test #4).
- **M1 — `overlayIntensity` had no sink.** → `overlay.js` gains `getIntensity()`; added to edit list (§3, §11).
- **M2 — park-snap parallax-conditional.** → `parkParams` snapshots the **live** director camera, not raw `k4` (§4, test #5).
- **M3 — `sweepPulse` had no API.** → **dropped** (reveal is an absolute write; a seasonProg reset flashes autumn) (§3, §6).
- **M4 — tap-to-start undefined.** → `city-proto.html` gesture affordance for `audio.start()` added to scope (§3, §11).
- **M5/M6 — smoothing `dt` ignored; bpm source contradictory.** → `k=1-exp(-dt/τ)`; `strobeRate` reads `audioState.bpm` (median-hold inside `extractFeatures`); fake-clock test aligned (§6, §8).
- **Minors** — `M` key for `setColorMode` (leave `C`); `clock.update(dt,bpm,beat)`; derive hold4 from live `director.segments`; override `uMode` after `update()`; explicit `petalDensity` combine+cap; winter beat-pulse ≤3 Hz guard; determinism test surface + no-module-state assertion.

**Confirmed sound (no change):** strobe-gate guard, handoff off-by-one fix (`cycleDur≈20.4 s`), hold4=`k4`, `uEmitMul` plan (`NormalBlending` → no glow), snow white in every mode, single-owner `chromaEnv`, FOV breath buildable.
