import assert from 'node:assert';
import { test } from 'node:test';
import { makeKeyframes } from '../../src/cityproto/camrig.js';
import { createDirector } from '../../src/cityproto/director.js';

const FULL = { camX: -5.1, camY: 55.3, camZ: 50, fov: 50, lookX: -5.1, lookY: 0, lookV: 16.8 };
const KF = makeKeyframes({ full: FULL, landmark: { x: 2, y: 1, z: -3 }, station: { x: 0, z: -1.8 } });
const mk = () => createDirector({ keyframes: KF });

test('update(tSec) is a pure function of time', () => {
  const d = mk();
  assert.deepStrictEqual(d.update(3.0), d.update(3.0));
});

test('cycle opens on ① (the 旧駅舎 hero framing)', () => {
  const d = mk();
  assert.deepStrictEqual(d.update(0).cam, KF[0]);
});

test('the cycle loops seamlessly — t=cycleDur frames the same as t=0', () => {
  const d = mk();
  assert.deepStrictEqual(d.update(d.cycleDur).cam, d.update(0).cam);
});

test('③ 市街 is the longest hold (見せ場)', () => {
  const d = mk();
  const longest = d.segments.reduce((a, s) => (s.dur > a.dur ? s : a));
  assert.strictEqual(longest.name, 'holdMid');
});

test('the building ripple is a one-shot: 0 at start, latched at 1, never decreasing', () => {
  const d = mk();
  assert.ok(d.update(0).reveal.buildings < 0.01, 'starts hidden');
  let prev = -1;
  for (let t = 0; t <= 30; t += 1.5) {
    const b = d.update(t).reveal.buildings;
    assert.ok(b >= prev - 1e-9, `monotonic non-decreasing at t=${t}`);
    assert.ok(b >= 0 && b <= 1, `in range at t=${t}`);
    prev = b;
  }
  assert.strictEqual(d.update(30).reveal.buildings, 1, 'fully revealed later');
  assert.strictEqual(d.update(d.cycleDur * 3 + 1).reveal.buildings, 1, 'stays built across cycles');
});

test('all reveal channels (terrain/roads/buildings) reach 1 and stay', () => {
  const d = mk();
  const r = d.update(60).reveal;
  assert.strictEqual(r.terrain, 1);
  assert.strictEqual(r.roads, 1);
  assert.strictEqual(r.buildings, 1);
});

test('seasons cycle 春→夏→秋→冬 then wrap to 春', () => {
  const d = mk();
  const C = d.cycleDur;
  assert.strictEqual(d.update(1).season.index, 0);
  assert.strictEqual(d.update(C + 1).season.index, 1);
  assert.strictEqual(d.update(2 * C + 1).season.index, 2);
  assert.strictEqual(d.update(3 * C + 1).season.index, 3);
  assert.strictEqual(d.update(4 * C + 1).season.index, 0);
  assert.strictEqual(d.update(1).season.name, 'spring');
});

test('season progress ramps from 0 at cycle start to ~1 by the end of the ③ hold', () => {
  const d = mk();
  const T = d.tuning;
  const endOfHold = T.hold1 + T.out12 + T.hold2 + T.out23 + T.holdMid;
  assert.ok(d.update(0).season.prog < 0.05, 'starts at season 0');
  assert.ok(d.update(endOfHold + 0.3).season.prog > 0.95, 'completes its arc by ③ end');
});
