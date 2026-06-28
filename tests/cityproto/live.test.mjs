import assert from 'node:assert';
import { test } from 'node:test';
import {
  PHASE, defaultModeConfig, initPhaseState, initFeat, initKnobs,
  extractFeatures, reduce, smoothKnobs,
} from '../../src/cityproto/live.js';
import { seasonEndpoints, particleEndpoints } from '../../src/cityproto/seasons.js';

// ---- synthetic-audio harness (no browser, no mic) -----------------------------------
const PARK = { camX: -5.1, camY: 55.3, camZ: 50, fov: 50, lookX: -5.1, lookY: 0, lookV: 16.8 };

function mkFrame(audio = {}, opts = {}) {
  return {
    dt: opts.dt ?? 1 / 60,
    audio: { level: 0, bass: 0, mid: 0, treble: 0, beat: false, beatHold: 0, bpm: 120, ...audio },
    clock: { beatPhase: 0, beats: 0, beatJustWrapped: false, ...(opts.clock || {}) },
    directorCam: opts.directorCam || null,
  };
}

// run a stream of frames through the full pure pipeline, logging every step
function run(frames, init = {}) {
  const cfg = init.cfg || defaultModeConfig();
  let ps = init.ps || initPhaseState(cfg);
  let feat = init.feat || initFeat();
  let knobs = init.knobs || initKnobs(cfg);
  const log = [];
  for (const fr of frames) {
    const aState = { ...fr.audio, directorCam: fr.directorCam };
    feat = extractFeatures(aState, fr.clock, feat, fr.dt, cfg);
    const r = reduce(ps, feat, cfg, fr.dt);
    ps = r.next;
    knobs = smoothKnobs(knobs, r.targets, fr.dt, cfg);
    log.push({ feat, ps: { ...ps }, targets: r.targets, knobs: { ...knobs } });
  }
  return { ps, feat, knobs, log, cfg };
}

// a LIVE-phase start state (parked at the winter ④ hero), so we can exercise §6 mapping
function liveStart(cfg = defaultModeConfig(), seasonIndex = 3) {
  return { phase: PHASE.LIVE, tSec: 0, clk: 0, armed: true, frozenTSec: cfg.winterCycleStart + cfg.hold4Start, seasonIndex, seasonProg: 1, chromaEnv: 0, lastDropT: -1e9, lastAdvanceBeat: -1e9, parkParams: { ...PARK } };
}

const rep = (n, audio, opts) => Array.from({ length: n }, () => mkFrame(audio, opts));

// ---- 1. silence → resting attractor (LIVE) ------------------------------------------
test('silence settles to the quiet idle: no breath, idle snow, mono', () => {
  const cfg = defaultModeConfig();
  const { knobs, ps } = run(rep(180, { level: 0, bass: 0, treble: 0, bpm: 0 }), { ps: liveStart(cfg) });
  assert.ok(knobs.camBreath < 0.01, `camBreath≈0 (${knobs.camBreath})`);
  assert.ok(Math.abs(knobs.petalDensity - cfg.petalIdleMul) < 0.05, `petalDensity→idle (${knobs.petalDensity})`);
  assert.strictEqual(knobs.chromaMix, 0, 'pure mono in silence');
  assert.strictEqual(ps.seasonIndex, 3, 'winter freeze');
});

// ---- 2. steady level → camBreath converges monotonically, bounded -------------------
test('steady level: camBreath rises monotonically toward pow(level,1.5), bounded, no drop', () => {
  const cfg = defaultModeConfig();
  const { knobs, ps, log } = run(rep(240, { level: 0.5, bass: 0.2, bpm: 120 }), { ps: liveStart(cfg) });
  const target = Math.pow(0.5, 1.5);
  for (const e of log) assert.ok(e.knobs.camBreath >= 0 && e.knobs.camBreath <= 1, 'camBreath bounded [0,1]');
  for (let i = 1; i < 60; i++) assert.ok(log[i].knobs.camBreath >= log[i - 1].knobs.camBreath - 1e-9, 'monotonic rise');
  assert.ok(Math.abs(knobs.camBreath - target) < 0.03, `camBreath→${target.toFixed(3)} (${knobs.camBreath.toFixed(3)})`);
  assert.strictEqual(ps.seasonIndex, 3, 'no season change from steady level');
});

// ---- 3. beat train → strobe ≤3Hz, in-frame kicks, camera unmoved --------------------
test('beat train @128bpm: strobeRate→min(3,128/60), camera never moves, ≤3Hz', () => {
  const cfg = defaultModeConfig();
  const period = 60 / 128;
  let acc = 0, beats = 0;
  const frames = [];
  for (let i = 0; i < 300; i++) {
    acc += 1 / 60; let beat = false;
    if (acc >= period) { acc -= period; beat = true; beats++; }
    frames.push(mkFrame({ level: 0.4, bass: 0.5, treble: 0.3, beat, beatHold: beat ? 1 : 0, bpm: 128 },
      { clock: { beatPhase: (i / 60) % 1, beats, beatJustWrapped: beat } }));
  }
  const { knobs, log } = run(frames, { ps: liveStart(cfg) });
  for (const e of log) assert.ok(e.targets.strobeRate <= 3 + 1e-9, 'strobeRate never > 3Hz');
  for (const e of log) assert.deepStrictEqual(e.knobs.camParams, PARK, 'camParams unchanged on beats');
  assert.ok(Math.abs(knobs.strobeRate - Math.min(3, 128 / 60)) < 0.05, `strobeRate≈2.13 (${knobs.strobeRate.toFixed(3)})`);
  const maxPetal = Math.max(...log.map((e) => e.knobs.petalDensity));
  assert.ok(maxPetal > cfg.petalIdleMul + 0.05, 'beat kicks lift petalDensity above idle');
  assert.ok(cfg.beatPulseGainWinter < cfg.beatPulseGain, 'winter pulse attenuated (≤3Hz luminance guard)');
});

// ---- 4. build→drop in each color mode ----------------------------------------------
function buildDropFrames() {
  // ~1.5s low energy (establish a low levelSlow baseline), then a hard drop at a phrase
  const frames = rep(90, { level: 0.08, bass: 0.05, bpm: 124 }, { clock: { beats: 8 } });
  // the drop frame (a phrase boundary), then a breakdown (low energy) so chroma drains
  // and no further drops re-fire (the §6 "drains on the breakdown" intent)
  frames.push(mkFrame({ level: 0.9, bass: 0.9, bpm: 124 }, { clock: { beats: 16, beatJustWrapped: true }, directorCam: PARK }));
  for (let i = 0; i < 360; i++) frames.push(mkFrame({ level: 0.15, bass: 0.08, bpm: 124 }, { clock: { beats: 16 } }));
  return frames;
}

test('burst: a drop blooms chroma then it decays back to mono', () => {
  const cfg = { ...defaultModeConfig(), colorMode: 'burst' };
  const { log } = run(buildDropFrames(), { cfg, ps: liveStart(cfg) });
  const peak = Math.max(...log.map((e) => e.knobs.chromaMix));
  assert.ok(peak > 0.8 * cfg.chromaBurst, `chroma blooms on drop (peak ${peak.toFixed(3)})`);
  assert.ok(log[log.length - 1].knobs.chromaMix < 0.05, 'chroma decays back to mono');
});

test('advance: a drop steps the season exactly once (min-dwell blocks re-fire)', () => {
  const cfg = { ...defaultModeConfig(), colorMode: 'advance' };
  const { ps, log } = run(buildDropFrames(), { cfg, ps: liveStart(cfg, 3) });
  assert.strictEqual(ps.seasonIndex, 0, 'winter(3) → spring(0), one step');
  const changes = log.filter((e, i) => i > 0 && e.ps.seasonIndex !== log[i - 1].ps.seasonIndex).length;
  assert.strictEqual(changes, 1, 'exactly one season change');
});

test('manual: audio never overrides the VJ-pinned season/chroma', () => {
  const cfg = { ...defaultModeConfig(), colorMode: 'manual', manualSeason: 1, manualChromaMix: 0 };
  const { ps, log } = run(buildDropFrames(), { cfg, ps: liveStart(cfg, 3) });
  assert.strictEqual(ps.seasonIndex, 1, 'pinned to manualSeason');
  for (const e of log) assert.strictEqual(e.knobs.chromaMix, 0, 'chroma pinned');
});

test('manual autoSeason: 春→夏→秋→冬 を beats 周期で循環し境界で prog をリセット', () => {
  const cfg = { ...defaultModeConfig(), colorMode: 'manual', autoSeason: true, autoSeasonBeats: 4, manualChromaMix: 1 };
  // beats 0,1,..,17 を 1フレームずつ流す（feat.beats = clock.beats）。period=4 で idx=floor(beats/4)%4。
  const frames = Array.from({ length: 18 }, (_, b) => mkFrame({ bpm: 120 }, { clock: { beats: b } }));
  const { log } = run(frames, { cfg, ps: liveStart(cfg, 3) });
  const seasonAt = (b) => log[b].ps.seasonIndex;
  assert.strictEqual(seasonAt(0), 0, 'beats0 → 春(0)');
  assert.strictEqual(seasonAt(4), 1, 'beats4 → 夏(1)');
  assert.strictEqual(seasonAt(8), 2, 'beats8 → 秋(2)');
  assert.strictEqual(seasonAt(12), 3, 'beats12 → 冬(3)');
  assert.strictEqual(seasonAt(16), 0, 'beats16 → 春(0) 一巡');
  assert.strictEqual(log[4].ps.seasonProg, 0, '季節境界で prog=0（クロスフェード開始）');
  for (const e of log) assert.strictEqual(e.knobs.chromaMix, 1, 'オート中は色ON固定');
});

test('drop refractory: a second drop within the window does not fire', () => {
  const cfg = { ...defaultModeConfig(), colorMode: 'advance' };
  const frames = rep(90, { level: 0.08, bass: 0.05 }, { clock: { beats: 8 } });
  frames.push(mkFrame({ level: 0.9, bass: 0.9 }, { clock: { beats: 16, beatJustWrapped: true }, directorCam: PARK }));
  for (let i = 0; i < 24; i++) frames.push(mkFrame({ level: 0.2, bass: 0.1 }, { clock: { beats: 16 } })); // 0.4s
  frames.push(mkFrame({ level: 0.95, bass: 0.95 }, { clock: { beats: 16 } })); // 2nd spike inside refractory
  for (let i = 0; i < 30; i++) frames.push(mkFrame({ level: 0.2, bass: 0.1 }, { clock: { beats: 16 } }));
  const { ps } = run(frames, { cfg, ps: liveStart(cfg, 3) });
  assert.strictEqual(ps.seasonIndex, 0, 'only the first drop advanced (3→0); refractory blocked the 2nd');
});

// ---- 5. handoff: arm in winter, fire at hold4, latch once, freeze winter ------------
test('handoff arms in the winter cycle and fires at ④ hold4 on a cue (latches once)', () => {
  const cfg = defaultModeConfig();
  // jump to just inside winter hold4 (local ≥ hold4Start), then inject a drop
  const approach = mkFrame({ level: 0 }, { dt: cfg.winterCycleStart + cfg.hold4Start + 0.02 });
  const lowBaseline = rep(30, { level: 0.05 }, { clock: { beats: 64 } });
  const dropFrame = mkFrame({ level: 0.95, bass: 0.95 }, { dt: 1 / 60, clock: { beats: 65, beatJustWrapped: true }, directorCam: PARK });
  const tail = rep(120, { level: 0.5, bass: 0.4 }, { clock: { beats: 70 } });
  const { ps, log } = run([approach, ...lowBaseline, dropFrame, ...tail]);
  assert.strictEqual(ps.phase, PHASE.LIVE, 'handed off to LIVE');
  assert.ok(Math.abs(ps.frozenTSec - (cfg.winterCycleStart + cfg.hold4Start)) < 1e-6, 'frozen at winter ④ hold4');
  assert.deepStrictEqual(ps.parkParams, PARK, 'park = the live director camera at the fire frame');
  assert.strictEqual(ps.seasonIndex, 3, 'latched to winter');
  const flips = log.filter((e, i) => i > 0 && e.ps.phase !== log[i - 1].ps.phase).length;
  assert.strictEqual(flips, 1, 'intro→live exactly once, never reverts');
});

test('handoff fallback fires by end of hold4 even with no musical cue', () => {
  const cfg = defaultModeConfig();
  // arm just before hold4, then step quietly through the whole hold4 window
  const approach = mkFrame({ level: 0 }, { dt: cfg.winterCycleStart + cfg.hold4Start - 0.1 });
  const through = rep(60, { level: 0.05 }, { dt: cfg.hold4Dur / 30, clock: { beats: 64 }, directorCam: PARK });
  const { ps } = run([approach, ...through]);
  assert.strictEqual(ps.phase, PHASE.LIVE, 'fallback handoff completed headlessly');
});

test('handoff uses feat.tSec (the real director clock) when provided', () => {
  const cfg = defaultModeConfig();
  const ps = initPhaseState(cfg);
  // a director clock parked past the end of hold4 → fallback fires this frame, independent of dt
  const feat = {
    level: 0, levelSlow: 0, bass: 0, bassSlow: 0, mid: 0, treble: 0, beat: false, beatHold: 0,
    bpm: 120, buildAmt: 0, silenceSec: 0, beatPhase: 0, beats: 0, beatJustWrapped: false,
    directorCam: PARK, bpmHist: [], tSec: cfg.winterCycleStart + cfg.hold4Start + cfg.hold4Dur,
  };
  const r = reduce(ps, feat, cfg, 1 / 60);
  assert.strictEqual(r.next.phase, PHASE.LIVE, 'feat.tSec past hold4 → handoff fires in lockstep with the director');
  assert.deepStrictEqual(r.next.parkParams, PARK, 'parks at the director camera passed in');
});

test('handoff arms during WINTER (off-by-one regression)', () => {
  const cfg = defaultModeConfig();
  assert.strictEqual(Math.floor(cfg.winterCycleStart / cfg.cycleDur) % 4, 3, 'winterCycleStart is in the winter cycle (index 3), not spring');
});

// ---- 6. strobe clamp fuzz (fixed bpm set, deterministic) ----------------------------
test('strobeRate stays within [0,3] across the bpm range', () => {
  const cfg = defaultModeConfig();
  for (const bpm of [0, 30, 60, 90, 128, 174, 200, 300, 600]) {
    const { log } = run(rep(20, { level: 0.5, treble: 1, bpm }), { ps: liveStart(cfg) });
    for (const e of log) assert.ok(e.targets.strobeRate >= 0 && e.targets.strobeRate <= 3, `bpm ${bpm} → strobeRate ${e.targets.strobeRate}`);
  }
});

// ---- 7. determinism -----------------------------------------------------------------
test('identical synthetic frames → byte-identical pipeline output', () => {
  const cfg = defaultModeConfig();
  const frames = buildDropFrames();
  const a = run(frames, { cfg, ps: liveStart(cfg) });
  const b = run(frames, { cfg, ps: liveStart(cfg) });
  const strip = (l) => l.map((e) => ({ targets: e.targets, knobs: { ...e.knobs }, season: e.ps.seasonIndex, chroma: e.ps.chromaEnv }));
  assert.deepStrictEqual(strip(a.log), strip(b.log), 'deterministic across replays from fresh state');
});

// ---- 8. season-endpoint continuity (tests seasons.js SoT, used by `advance`) ---------
test('seasons.js endpoints are continuous at every wrap (cur(i) === prev(i+1))', () => {
  for (let i = 0; i < 4; i++) {
    assert.deepStrictEqual(seasonEndpoints(i).colorCur, seasonEndpoints(i + 1).colorPrev, `canopy continuity at ${i}`);
    assert.deepStrictEqual(particleEndpoints(i).colorCur, particleEndpoints(i + 1).colorPrev, `particle continuity at ${i}`);
  }
});
