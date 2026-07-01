import assert from 'node:assert';
import { test } from 'node:test';
import { Oscilloscope } from '../../src/scenes/dots/Oscilloscope.js';

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
