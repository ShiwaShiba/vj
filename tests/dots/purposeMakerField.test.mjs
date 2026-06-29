import assert from 'node:assert';
import { test } from 'node:test';
import { breathAt, baseBreath } from '../../src/scenes/dots/purposeMakerField.js';

const SILENT = { level: 0, bass: 0, treble: 0, beatHold: 0 };

test('baseBreath stays in [0,1], is deterministic, and oscillates', () => {
  let lo = 1, hi = 0;
  for (let i = 0; i < 400; i++) {
    const t = i * 0.05;
    const v = baseBreath(t);
    assert.ok(v >= 0 && v <= 1, `in range at t=${t}`);
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  assert.strictEqual(baseBreath(3.21), baseBreath(3.21));
  assert.ok(hi - lo > 0.6, 'genuinely swings between dust and lines');
});

test('breathAt is deterministic and all controls land in sane ranges', () => {
  const a = breathAt(4.2, { level: 0.5, bass: 0.5, treble: 0.5, beatHold: 0.3 }, { react: 2 });
  const b = breathAt(4.2, { level: 0.5, bass: 0.5, treble: 0.5, beatHold: 0.3 }, { react: 2 });
  assert.deepStrictEqual(a, b);
  for (let i = 0; i < 200; i++) {
    const t = i * 0.1;
    const s = breathAt(t, { level: (i % 7) / 7, bass: (i % 5) / 5, treble: (i % 3) / 3, beatHold: (i % 2) }, { react: 2 });
    assert.ok(s.K >= 0 && s.K <= 1, 'K in [0,1]');
    assert.ok(s.scatter >= 0 && s.scatter <= 1, 'scatter in [0,1]');
    assert.ok(s.speed > 0 && s.elong > 0 && s.bright > 0, 'positive magnitudes');
    assert.ok(s.forward > 0, 'always drifts forward');
  }
});

test('audio pushes K toward the LINE regime (structure snaps to the beat)', () => {
  // Sample many phases so we are not at a baseline extreme by luck.
  let beats = 0;
  for (let i = 0; i < 50; i++) {
    const t = i * 0.31;
    const quiet = breathAt(t, SILENT, { react: 2 });
    const hit = breathAt(t, { level: 0.8, bass: 0.9, treble: 0.4, beatHold: 1 }, { react: 2 });
    assert.ok(hit.K >= quiet.K - 1e-9, `beat never lowers K at t=${t}`);
    if (hit.K > quiet.K + 0.05) beats++;
  }
  assert.ok(beats > 40, 'a kick visibly raises coherence across phases');
});

test('flash tracks the beat transient and is silent when audio is off', () => {
  assert.strictEqual(breathAt(1.0, { beatHold: 1 }, { react: 1, audioOn: false }).flash, 0);
  const kick = breathAt(1.0, { beatHold: 1, bass: 0.8 }, { react: 1 });
  const between = breathAt(1.0, { beatHold: 0.05, bass: 0.3 }, { react: 1 });
  assert.ok(kick.flash > between.flash + 0.5, 'flash spikes on the kick, decays between');
});

test('K stays off the rail on a kick (soft-knee leaves headroom for the snap)', () => {
  // With a realistic kick at the default react, K must NOT pin at 1.0 (else "always lines").
  const kick = breathAt(2.0, { level: 0.6, bass: 0.85, beatHold: 1 }, { react: 1 });
  assert.ok(kick.K > 0.7 && kick.K < 0.99, `kick K in (0.7,0.99): ${kick.K.toFixed(3)}`);
  const between = breathAt(2.0, { level: 0.35, bass: 0.3, beatHold: 0.08 }, { react: 1 });
  assert.ok(between.K < kick.K - 0.2, 'clear dust<->line gap between kick and rest');
});

test('audioOn:false ignores audio entirely (pure baseline breathing)', () => {
  const loud = breathAt(2.0, { level: 1, bass: 1, treble: 1, beatHold: 1 }, { react: 4, audioOn: false });
  const silent = breathAt(2.0, SILENT, { react: 4, audioOn: false });
  assert.deepStrictEqual(loud, silent);
  assert.strictEqual(loud.shimmer, 0);
  assert.strictEqual(loud.ripple, 0);
});

test('derived controls move monotonically with K (line state = faster/longer/brighter, less scatter)', () => {
  // Force two K levels by audio drive at the same instant.
  const lowK = breathAt(1.3, SILENT, { react: 0 });
  const highK = breathAt(1.3, { level: 1, bass: 1, treble: 0, beatHold: 1 }, { react: 3 });
  assert.ok(highK.K > lowK.K);
  assert.ok(highK.speed > lowK.speed && highK.elong > lowK.elong && highK.bright > lowK.bright);
  assert.ok(highK.forward > lowK.forward && highK.scatter < lowK.scatter);
});

test('seamless: K is continuous in time (no jumps)', () => {
  let prev = breathAt(0, SILENT, {}).K;
  for (let t = 0.01; t < 30; t += 0.01) {
    const k = breathAt(t, SILENT, {}).K;
    assert.ok(Math.abs(k - prev) < 0.02, `continuous at t=${t.toFixed(2)}`);
    prev = k;
  }
});
