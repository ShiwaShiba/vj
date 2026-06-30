import assert from 'node:assert';
import { test } from 'node:test';
import { formAt, riseFall, GHOLD } from '../../src/scenes/dots/purposeMakerForm.js';

const SILENT = { level: 0, bass: 0, treble: 0, beatHold: 0 };
const KICK = { level: 0.7, bass: 0.9, treble: 0.3, beatHold: 1 };

test('riseFall is a bell: 0 outside [lo,hi], 1 at mid, smooth between', () => {
  assert.strictEqual(riseFall(0.05, 0.1, 0.5, 0.9), 0); // at lo
  assert.strictEqual(riseFall(0.95, 0.1, 0.5, 0.9), 0); // beyond hi
  assert.strictEqual(riseFall(0.5, 0.1, 0.5, 0.9), 1);  // at mid
  assert.ok(riseFall(0.3, 0.1, 0.5, 0.9) > 0 && riseFall(0.3, 0.1, 0.5, 0.9) < 1);
  assert.ok(riseFall(0.7, 0.1, 0.5, 0.9) > 0 && riseFall(0.7, 0.1, 0.5, 0.9) < 1);
});

test('endpoints: at g=0 and g=1 the morph weights vanish (dust / flat hand, no stray bands)', () => {
  const a = formAt(0, SILENT, {}), b = formAt(1, SILENT, {});
  assert.strictEqual(a.line, 0); assert.strictEqual(a.sheet, 0);
  assert.strictEqual(b.line, 0); assert.strictEqual(b.sheet, 0);
  assert.ok(a.conv < 1e-9, 'no convergence at g=0');
  assert.ok(b.conv > 1 - 1e-9, 'full convergence (flat hand) at g=1');
});

test('conv rises monotonically with g (hand resolves only in the back half of gather)', () => {
  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const g = i / 20;
    const c = formAt(g, SILENT, {}).conv;
    assert.ok(c >= prev - 1e-12, `conv non-decreasing at g=${g}`);
    prev = c;
  }
  assert.strictEqual(formAt(GHOLD, SILENT, {}).conv, 0, 'no hand before the GHOLD onset');
  assert.ok(formAt(0.7, SILENT, {}).conv > 0, 'hand resolving past GHOLD');
});

test('morph order: lines peak before sheets (dust -> line -> band)', () => {
  let lineArg = 0, lineMax = -1, sheetArg = 0, sheetMax = -1;
  for (let i = 0; i <= 100; i++) {
    const g = i / 100, f = formAt(g, SILENT, {});
    if (f.line > lineMax) { lineMax = f.line; lineArg = g; }
    if (f.sheet > sheetMax) { sheetMax = f.sheet; sheetArg = g; }
  }
  assert.ok(lineArg < sheetArg, `line peak (${lineArg}) precedes sheet peak (${sheetArg})`);
});

test('advance (streaming carry) dies as the hand locks', () => {
  assert.ok(formAt(0.2, SILENT, {}).advance > formAt(0.95, SILENT, {}).advance);
  assert.ok(formAt(1, SILENT, {}).advance < 1e-9, 'no carry at the fully-formed hand');
});

test('audio rides the SAME signal: a beat raises line-snap & convergence nudge, never lowers them', () => {
  for (let i = 0; i <= 20; i++) {
    const g = i / 20;
    const hit = formAt(g, KICK, {}), quiet = formAt(g, SILENT, {});
    assert.ok(hit.snapLine >= quiet.snapLine, `beat never lowers snapLine at g=${g}`);
    assert.ok(hit.snapConv >= 0 && hit.snapConv <= 1, 'snapConv in [0,1]');
    assert.strictEqual(hit.conv, quiet.conv, 'base conv is pure-g (audio boost applied in the scene)');
  }
  assert.ok(formAt(0.3, KICK, {}).snapLine > 0.5, 'a kick clearly punches the line-snap');
});

test('audioOn:false ignores audio entirely (operator/output mirror determinism)', () => {
  const loud = formAt(0.5, KICK, { react: 3, audioOn: false });
  const silent = formAt(0.5, SILENT, { react: 3, audioOn: false });
  assert.deepStrictEqual(loud, silent);
  assert.strictEqual(loud.snapLine, 0);
  assert.strictEqual(loud.flash, 0);
});

test('flash tracks the beat transient and is additive-ready (0..1)', () => {
  assert.strictEqual(formAt(0.5, SILENT, {}).flash, 0);
  assert.strictEqual(formAt(0.5, { beatHold: 1 }, {}).flash, 1);
  assert.strictEqual(formAt(0.5, { beatHold: 0.4 }, {}).flash, 0.4);
});

test('deterministic and a pure function of g (=> reverse-expand replays gather backwards)', () => {
  assert.deepStrictEqual(formAt(0.37, KICK, { react: 2 }), formAt(0.37, KICK, { react: 2 }));
  // Same g reached on gather (g rising) or disperse (g falling) yields the identical descriptor,
  // so the dissolve is the build played in reverse with no extra code path.
  assert.deepStrictEqual(formAt(0.5, SILENT, {}), formAt(0.5, SILENT, {}));
});
