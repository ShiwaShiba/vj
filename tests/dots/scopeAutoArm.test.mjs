import assert from 'node:assert';
import { test } from 'node:test';
import { Oscilloscope } from '../../src/scenes/dots/Oscilloscope.js';

const stubAudio = () => ({ waveform: new Uint8Array(64).fill(128), level: 0, bass: 0, mid: 0, treble: 0 });

test('_effPhase gates on auto AND arm.phase', () => {
  const s = new Oscilloscope();
  s.setMode(2); s.setModeGroup('auto', 1);
  s.t = 0; s.beats = 0;
  s.autoArm.phase = false;
  assert.strictEqual(s._effPhase(), s.p('phase')); // manual (8)
  s.autoArm.phase = true;
  assert.strictEqual(s._effPhase(), 32);           // auto sweep at t=0 → 4 + 0.5*56
});

test('_effFlip gates on auto AND arm.flip', () => {
  const s = new Oscilloscope();
  s.setMode(2); s.setModeGroup('auto', 1);
  s.beats = 16; // auto branch → floor(16/16)%2===1 → true
  s.autoArm.flip = false;
  assert.strictEqual(s._effFlip(), false); // manual OFF
  s.autoArm.flip = true;
  assert.strictEqual(s._effFlip(), true);  // auto
});

test('_effBandIndex gates on auto AND arm.band', () => {
  const s = new Oscilloscope();
  s.setMode(2); s.setModeGroup('auto', 1);
  s.beats = 32; // auto branch → floor(32/32)%3 === 1
  s.setModeGroup('drive', 0); // manual BASS = 0
  s.autoArm.band = false;
  assert.strictEqual(s._effBandIndex(), 0); // manual
  s.autoArm.band = true;
  assert.strictEqual(s._effBandIndex(), 1); // auto
});

test('_effSpread gates on auto AND arm.spread', () => {
  const s = new Oscilloscope();
  s.setMode(3); s.setModeGroup('sphere', 2); s.setModeGroup('spread', 3); s.setModeGroup('auto', 1);
  s.beats = 0; s.t = 0;
  s.autoArm.spread = false;
  assert.strictEqual(s._effSpread(), 3);      // manual QUAD
  s.autoArm.spread = true;
  assert.notStrictEqual(s._effSpread(), 3);   // auto walk (order[0]=1 at beats0)
});

test('rotation: auto+arm.rot spins even with Spin OFF; unarmed frozen', () => {
  const s = new Oscilloscope();
  s.setMode(2); s.setModeGroup('auto', 1); s.setModeGroup('spin', 0);
  s.params.rotate.value = 0;
  const clock = { time: 0, beats: 0 };
  s.autoArm.rot = false; s._spin = 0;
  s.update(0.1, stubAudio(), null, clock);
  assert.strictEqual(s._spin, 0);             // unarmed + Spin OFF → frozen
  s.autoArm.rot = true; s._spin = 0;
  s.update(0.1, stubAudio(), null, clock);
  assert.ok(s._spin > 0);                     // armed → auto wander advances
});
