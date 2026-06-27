import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSceneAudioAdapter } from '../../src/cityproto/sceneAudioAdapter.js';

const src = readFileSync(fileURLToPath(new URL('../../src/cityproto/sceneAudioAdapter.js', import.meta.url)), 'utf8');

test('adapter はマイクを持たず、本体 state/clock を取り込む', () => {
  assert.ok(!/getUserMedia|new AudioEngine|createAnalyser/.test(src), 'no mic');
  const a = createSceneAudioAdapter();
  assert.equal(a.isLive(), true, 'scene is always LIVE');
  a.update({ ready:true, level:0.5, bass:0.4, mid:0.3, treble:0.2, beat:false, beatHold:0, bpm:120, spectrum:new Uint8Array(1024), waveform:new Uint8Array(2048) }, { beats: 8, beatPhase: 0.25 });
  assert.equal(a.audio.state.level, 0.5, 'state mirrored');
  assert.equal(a.clock.beats, 8, 'clock mirrored');
});

test('adapter は AudioContext / AudioEngine import を持たない（マイク非所有を強く保証）', () => {
  assert.ok(!/AudioContext|AudioEngine\.js|audio\/AudioEngine/.test(src), 'no AudioContext/AudioEngine');
});

test('adapter は Math.random / Date を使わない（決定論）', () => {
  assert.ok(!/Math\.random|new Date|Date\.now/.test(src), 'deterministic');
});

test('phase は最初から LIVE で、frame は camera を触らない（cityCore が所有）', () => {
  const a = createSceneAudioAdapter();
  assert.equal(a.phase, 'live', 'phase live from the start');
  assert.equal(a.ps.parkParams, null, 'parkParams stays null → adapter does not own camera');

  let cameraApplied = false;
  const scopeFrames = [];
  const ctx = {
    cityScope: { frame: (feat, dt) => scopeFrames.push({ feat, dt }) },
    trees: null, particles: null,
    params: { camZ: 100 },
    applyCamera: () => { cameraApplied = true; },
    setOverlayIntensity: () => {},
  };
  a.update({ ready:true, level:0.5, bass:0.4, mid:0.3, treble:0.2, beat:true, beatHold:0, bpm:120 }, { beats: 4, beatPhase: 0.0 });
  a.frame(1 / 60, 1000, ctx);

  assert.equal(cameraApplied, false, 'adapter must NOT call applyCamera (cityCore owns the camera)');
  assert.equal(scopeFrames.length, 1, 'cityScope.frame driven once per frame in LIVE');
});

test('frame は trees/particles に season+uMode+strobe を書き、strobe を ≤3Hz にクランプ', () => {
  const a = createSceneAudioAdapter();
  const mkUniforms = () => ({ uMode: { value: -1 }, uStrobeRate: { value: -1 } });
  const trees = { uniforms: mkUniforms(), update: () => {} };
  const particles = { uniforms: { uMode: { value: -1 }, uEmitMul: { value: -1 } }, update: () => {} };
  // bpm 600 → strobeRate target 10Hz; must clamp to ≤3
  a.update({ ready:true, level:0.8, bass:0.6, mid:0.4, treble:0.3, beat:true, beatHold:0, bpm:600 }, { beats: 4, beatPhase: 0 });
  let overlay = -1;
  a.frame(1 / 60, 1000, { trees, particles, setOverlayIntensity: (v) => { overlay = v; } });
  assert.ok(trees.uniforms.uStrobeRate.value >= 0 && trees.uniforms.uStrobeRate.value <= 3, 'strobe ≤3Hz');
  assert.notEqual(trees.uniforms.uMode.value, -1, 'trees uMode written');
  assert.notEqual(particles.uniforms.uMode.value, -1, 'particles uMode written');
  assert.notEqual(particles.uniforms.uEmitMul.value, -1, 'particle density written');
  assert.notEqual(overlay, -1, 'overlay intensity written');
});
