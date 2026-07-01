import assert from 'node:assert';
import { test } from 'node:test';
import {
  isControlActive, isGroupActive, canArm, autoDrives, isLissaFamily,
  CONTROL_GROUPS, AUTO_AXES, DEFAULT_AUTO_ARM, SPREAD_GAIN,
} from '../../src/scenes/dots/scopeControls.js';

const base = { mode: 0, form: 0, spread: 0, auto: false, spinOn: true, arm: { ...DEFAULT_AUTO_ARM } };
const st = (o) => ({ ...base, ...o });
const armset = (s) => AUTO_AXES.filter((a) => canArm(a, s));

test('CONTROL_GROUPS has the five groups in order', () => {
  assert.deepStrictEqual(CONTROL_GROUPS.map((g) => g.key), ['draw', 'size', 'figure', 'motion', 'solid']);
});

test('Line/Circle: figure/motion/solid all dim, draw/size lit', () => {
  for (const mode of [0, 1]) {
    const s = st({ mode });
    assert.strictEqual(isControlActive('p:thickness', s), true);
    assert.strictEqual(isControlActive('p:gain', s), true);
    assert.strictEqual(isControlActive('p:phase', s), false);
    assert.strictEqual(isControlActive('g:spin', s), false);
    assert.strictEqual(isControlActive('g:sphere', s), false);
    assert.strictEqual(isGroupActive('draw', s), true);
    assert.strictEqual(isGroupActive('figure', s), false);
    assert.strictEqual(isGroupActive('motion', s), false);
    assert.strictEqual(isGroupActive('solid', s), false);
  }
});

test('XY (auto off): figure+motion active, solid dim', () => {
  const s = st({ mode: 2, auto: false });
  assert.strictEqual(isControlActive('p:phase', s), true);
  assert.strictEqual(isControlActive('g:flip', s), true);
  assert.strictEqual(isControlActive('g:drive', s), true);
  assert.strictEqual(isControlActive('p:drive', s), true);
  assert.strictEqual(isControlActive('g:spin', s), true);
  assert.strictEqual(isControlActive('p:rotate', s), true);
  assert.strictEqual(isGroupActive('solid', s), false);
});

test('XY (auto on, default arm): armed dim, unarmed lit, master lit', () => {
  const s = st({ mode: 2, auto: true });
  assert.strictEqual(isControlActive('p:phase', s), false); // armed → auto → dim
  assert.strictEqual(isControlActive('g:flip', s), true);   // unarmed → manual → lit
  assert.strictEqual(isControlActive('g:drive', s), true);  // band unarmed → lit
  assert.strictEqual(isControlActive('g:spin', s), false);  // rot armed → dim
  assert.strictEqual(isControlActive('p:rotate', s), false);
  assert.strictEqual(isControlActive('g:auto', s), true);
});

test('rotate dims when Spin OFF', () => {
  const s = st({ mode: 2, auto: false, spinOn: false });
  assert.strictEqual(isControlActive('g:spin', s), true);
  assert.strictEqual(isControlActive('p:rotate', s), false);
});

test('GLOBE: Band/Drive lit, Phase/Flip dim; Form/Density lit', () => {
  const s = st({ mode: 3, form: 0, auto: false });
  assert.strictEqual(isControlActive('p:phase', s), false);
  assert.strictEqual(isControlActive('g:flip', s), false);
  assert.strictEqual(isControlActive('g:drive', s), true);
  assert.strictEqual(isControlActive('p:drive', s), true);
  assert.strictEqual(isControlActive('g:sphere', s), true);
  assert.strictEqual(isControlActive('p:density', s), true);
  assert.strictEqual(isControlActive('g:spread', s), false);
  assert.strictEqual(isControlActive('p:core', s), false);
  assert.strictEqual(isControlActive('p:count', s), false);
});

test('TERRAIN: React/Band dim, Drive lit; Form/Density/Core lit', () => {
  const s = st({ mode: 3, form: 3, auto: false });
  assert.strictEqual(isControlActive('p:react', s), false);
  assert.strictEqual(isControlActive('p:thickness', s), true);
  assert.strictEqual(isControlActive('g:drive', s), false);
  assert.strictEqual(isControlActive('p:drive', s), true);
  assert.strictEqual(isControlActive('p:density', s), true);
  assert.strictEqual(isControlActive('p:core', s), true);
  assert.strictEqual(isControlActive('p:count', s), false);
});

test('LISSA spreads: RIBBON→count / HELIX→density+core / plain→core', () => {
  const ribbon = st({ mode: 3, form: 2, spread: 4, auto: false });
  assert.strictEqual(isControlActive('p:count', ribbon), true);
  assert.strictEqual(isControlActive('p:core', ribbon), false);
  assert.strictEqual(isControlActive('p:density', ribbon), false);
  const helix = st({ mode: 3, form: 2, spread: 5, auto: false });
  assert.strictEqual(isControlActive('p:density', helix), true);
  assert.strictEqual(isControlActive('p:core', helix), true);
  assert.strictEqual(isControlActive('p:count', helix), false);
  const plain = st({ mode: 3, form: 2, spread: 0, auto: false });
  assert.strictEqual(isControlActive('p:core', plain), true);
  assert.strictEqual(isControlActive('p:density', plain), false);
  assert.strictEqual(isControlActive('p:count', plain), false);
});

test('canArm by mode', () => {
  assert.deepStrictEqual(armset(st({ mode: 2 })), ['phase', 'flip', 'band', 'rot']);
  assert.deepStrictEqual(armset(st({ mode: 3, form: 2 })), ['phase', 'flip', 'band', 'spread', 'rot']);
  assert.deepStrictEqual(armset(st({ mode: 3, form: 0 })), ['band', 'rot']);
  assert.deepStrictEqual(armset(st({ mode: 3, form: 3 })), ['rot']);
  assert.deepStrictEqual(armset(st({ mode: 0 })), []);
});

test('autoDrives = auto AND arm', () => {
  assert.strictEqual(autoDrives('phase', st({ auto: true })), true);
  assert.strictEqual(autoDrives('phase', st({ auto: false })), false);
  assert.strictEqual(autoDrives('flip', st({ auto: true })), false); // flip unarmed by default
});

test('React dim in TERRAIN and RIBBON (lineWidth unused/overwritten), lit elsewhere', () => {
  assert.strictEqual(isControlActive('p:react', st({ mode: 3, form: 3 })), false);            // TERRAIN
  assert.strictEqual(isControlActive('p:react', st({ mode: 3, form: 2, spread: 4 })), false); // RIBBON
  assert.strictEqual(isControlActive('p:react', st({ mode: 3, form: 2, spread: 0 })), true);  // LISSA plain
  assert.strictEqual(isControlActive('p:react', st({ mode: 3, form: 0 })), true);             // GLOBE
  assert.strictEqual(isControlActive('p:react', st({ mode: 2 })), true);                      // XY
});

test('isLissaFamily: only Sphere + form LISSA', () => {
  assert.strictEqual(isLissaFamily(st({ mode: 3, form: 2, spread: 0 })), true);
  assert.strictEqual(isLissaFamily(st({ mode: 3, form: 2, spread: 5 })), true);
  assert.strictEqual(isLissaFamily(st({ mode: 3, form: 0 })), false); // GLOBE
  assert.strictEqual(isLissaFamily(st({ mode: 3, form: 1 })), false); // WRAP
  assert.strictEqual(isLissaFamily(st({ mode: 3, form: 3 })), false); // TERRAIN
  assert.strictEqual(isLissaFamily(st({ mode: 2, form: 2 })), false); // XY
  assert.strictEqual(isLissaFamily(st({ mode: 0 })), false);          // Line
});

test('SPREAD_GAIN initial defaults match the described slider positions', () => {
  assert.strictEqual(SPREAD_GAIN.length, 6);
  // TOROID < SPHERE < LISSA < QUAD == RIBBON, and HELIX is the lowest.
  assert.ok(SPREAD_GAIN[2] < SPREAD_GAIN[1] && SPREAD_GAIN[1] < SPREAD_GAIN[0]);
  assert.ok(SPREAD_GAIN[0] < SPREAD_GAIN[3]);
  assert.strictEqual(SPREAD_GAIN[3], SPREAD_GAIN[4]);
  assert.strictEqual(SPREAD_GAIN[5], Math.min(...SPREAD_GAIN));
  // Every default is within the GAIN slider range (0.3..3.0).
  for (const g of SPREAD_GAIN) assert.ok(g >= 0.3 && g <= 3.0);
});

test('WRAP mirrors GLOBE relevance', () => {
  const s = st({ mode: 3, form: 1, auto: false });
  assert.strictEqual(isControlActive('p:density', s), true);
  assert.strictEqual(isControlActive('g:sphere', s), true);
  assert.strictEqual(isControlActive('g:spread', s), false);
  assert.strictEqual(isControlActive('p:core', s), false);
  assert.strictEqual(isControlActive('p:count', s), false);
  assert.strictEqual(isControlActive('g:drive', s), true); // Band lit (form <= 2)
});
