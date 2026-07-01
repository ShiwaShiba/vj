import assert from 'node:assert';
import { test } from 'node:test';
import { Oscilloscope } from '../../src/scenes/dots/Oscilloscope.js';
import { SPREAD_GAIN } from '../../src/scenes/dots/scopeControls.js';

test('controlGroups covers every param and modeGroup exactly once', () => {
  const s = new Oscilloscope();
  const declared = new Set();
  for (const g of s.controlGroups) for (const it of g.items) {
    if (it.t === 'm') continue; // synthetic arm selector
    const id = it.t + ':' + it.k;
    assert.ok(!declared.has(id), `duplicate ${id}`);
    declared.add(id);
  }
  const expected = new Set();
  for (const k in s.params) expected.add('p:' + k);
  for (const g of s.modeGroups) expected.add('g:' + g.key);
  assert.deepStrictEqual([...declared].sort(), [...expected].sort());
});

test('Band relabel: drive modeGroup labelled Band, options intact', () => {
  const s = new Oscilloscope();
  const g = s.modeGroups.find((x) => x.key === 'drive');
  assert.strictEqual(g.label, 'Band');
  assert.deepStrictEqual(g.options, ['BASS', 'TREBLE', 'LEVEL']);
});

test('default autoArm is the curated subset', () => {
  const s = new Oscilloscope();
  assert.deepStrictEqual(s.autoArm, { phase: true, flip: false, band: false, spread: true, rot: true });
});

test('isGroupActive: Line → only draw+size', () => {
  const s = new Oscilloscope();
  s.setMode(0);
  assert.strictEqual(s.isGroupActive('draw'), true);
  assert.strictEqual(s.isGroupActive('size'), true);
  assert.strictEqual(s.isGroupActive('figure'), false);
  assert.strictEqual(s.isGroupActive('motion'), false);
  assert.strictEqual(s.isGroupActive('solid'), false);
});

test('isControlActive + canArm reflect mode (XY)', () => {
  const s = new Oscilloscope();
  s.setMode(2);
  assert.strictEqual(s.isControlActive('p', 'phase'), true);
  assert.strictEqual(s.isControlActive('g', 'sphere'), false);
  assert.strictEqual(s.canArm('phase'), true);
  assert.strictEqual(s.canArm('spread'), false);
});

test('toggleArm flips an axis', () => {
  const s = new Oscilloscope();
  assert.strictEqual(s.autoArm.flip, false);
  s.toggleArm('flip');
  assert.strictEqual(s.autoArm.flip, true);
});

test('setModeGroup: GAIN is sticky per Spread, defaults from SPREAD_GAIN', () => {
  const s = new Oscilloscope();
  s.setMode(3);                     // Sphere
  s.setModeGroup('sphere', 2);      // Form → LISSA, loads spread 0 default
  assert.strictEqual(s.p('gain'), SPREAD_GAIN[0]);
  s.params.gain.value = 2.4;        // operator drags GAIN in LISSA (spread 0)
  s.setModeGroup('spread', 5);      // → HELIX, first visit → its default 0.5
  assert.strictEqual(s.p('gain'), SPREAD_GAIN[5]);
  s.params.gain.value = 0.8;        // operator drags GAIN in HELIX
  s.setModeGroup('spread', 0);      // back to LISSA → remembers 2.4 (not the default)
  assert.strictEqual(s.p('gain'), 2.4);
  s.setModeGroup('spread', 5);      // back to HELIX → remembers 0.8
  assert.strictEqual(s.p('gain'), 0.8);
});

test('a Mode/Form/Spread change arms the switch crossfade; unchanged / non-structural do not', () => {
  const s = new Oscilloscope();
  assert.strictEqual(s._switchT, 0);
  s.setMode(2);                       // Line → XY: changed → armed
  assert.ok(s._switchT > 0);
  s._switchT = 0;
  s.setMode(2);                       // same Mode → not re-armed
  assert.strictEqual(s._switchT, 0);
  s.setModeGroup('sphere', 2);        // Form 0 → 2 → armed
  assert.ok(s._switchT > 0);
  s._switchT = 0;
  s.setModeGroup('sphere', 2);        // same Form → not re-armed
  assert.strictEqual(s._switchT, 0);
  s.setModeGroup('flip', 1);          // non-structural → never arms
  assert.strictEqual(s._switchT, 0);
});

test('update decays the switch crossfade timer to zero', () => {
  const s = new Oscilloscope();
  const audio = { waveform: new Uint8Array(64).fill(128), level: 0, bass: 0, mid: 0, treble: 0 };
  const clock = { time: 0, beats: 0 };
  s.setMode(3);
  assert.ok(s._switchT > 0);
  let guard = 0;
  while (s._switchT > 0 && guard++ < 100) s.update(0.1, audio, null, clock);
  assert.strictEqual(s._switchT, 0);
  assert.ok(guard < 100, 'timer should reach zero well within the guard');
});

test('setModeGroup: leaving the LISSA family never clobbers GAIN, and remembers on the way out', () => {
  const s = new Oscilloscope();
  s.setMode(3);
  s.setModeGroup('sphere', 2);      // LISSA (spread 0)
  s.params.gain.value = 1.9;
  s.setModeGroup('sphere', 3);      // → TERRAIN (non-family): GAIN untouched
  assert.strictEqual(s.p('gain'), 1.9);
  s.params.gain.value = 0.4;        // tune GAIN for TERRAIN
  s.setModeGroup('sphere', 2);      // back to LISSA spread 0 → restores the remembered 1.9
  assert.strictEqual(s.p('gain'), 1.9);
});
