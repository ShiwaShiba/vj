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

test('all reveal channels (terrain/roads/buildings/petals) reach 1 and stay', () => {
  const d = mk();
  const r = d.update(60).reveal;
  assert.strictEqual(r.terrain, 1);
  assert.strictEqual(r.roads, 1);
  assert.strictEqual(r.buildings, 1);
  assert.strictEqual(r.petals, 1);
});

test('petals appear on their OWN gentle ramp — wider & later-finishing than the 並木 curtain', () => {
  // The 「満開で突然散り出す」 fix: petals are decoupled from reveal.trees so they fade in slowly
  // instead of bursting with the canopy. At the end of the 並木 grow-in the petals must still be
  // only partway up (a gentle drizzle, NOT a full curtain), and only reach full distinctly later.
  const d = mk();
  const T = d.tuning;
  const treeEnd = T.treeWin[1];                 // canopy fully grown
  assert.strictEqual(d.update(treeEnd).reveal.trees, 1, 'canopy full at treeWin end');
  assert.ok(d.update(treeEnd).reveal.petals < 0.4, 'petals still a gentle drizzle when canopy completes');
  assert.ok(d.update(treeEnd).reveal.petals > 0, 'petals have begun (not empty)');
  assert.strictEqual(d.update(T.petalWin[1]).reveal.petals, 1, 'petals reach full only at their own (later) window end');
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

test('look-lag: progColor/progPetal trail the structural prog so 散り→新緑 overlaps', () => {
  // The 「散りが薄く尾を引いた上に新芽(緑)が芽吹く」 fix: the canopy COLOR and the petal AMOUNT
  // ride lagged progs (seasonColorWin/seasonPetalWin) behind the structural prog. Petals must
  // linger LONGER than the color (a thin tail past the green), and all three must reach 1 and be
  // boundary-continuous (0 at local 0) so the 4-cycle wrap never pops.
  const d = mk();
  const C = d.cycleDur;
  // sampled mid-transition, color and petals are BEHIND structure; petals are behind color
  const s = d.update(C + 6).season;   // 6s into the summer cycle (春→夏 transition)
  assert.ok(s.progColor < s.prog, 'color lags structure');
  assert.ok(s.progPetal < s.progColor, 'petals lag even the color (longer 余韻 tail)');
  // all reach 1 well before the wrap, and are 0 at each cycle start (continuous)
  const late = d.update(C + 20).season;
  assert.strictEqual(late.prog, 1); assert.strictEqual(late.progColor, 1); assert.strictEqual(late.progPetal, 1);
  const start = d.update(2 * C).season;     // exact cycle boundary
  assert.ok(start.prog < 0.05 && start.progColor < 0.05 && start.progPetal < 0.05, 'all ~0 at cycle start');
});

test('season.age: 夏の経年は color が入りきった後にゆっくり進み、サイクル境界で 1(=settled, wrap安全)', () => {
  // 新緑→濃緑→黄緑 の経年。color(≈13s)が入りきるまでは ~0 で新緑に着地し、その後ズームの移動を
  // 跨いで進み、wrap 直前で 1 に飽和＝秋へ pop 無し。構造/色prog からは独立した別チャンネル。
  const d = mk();
  const C = d.cycleDur;
  const early = d.update(C + 12).season;   // 春→夏の色が入りきる手前 ⇒ まだ新緑(age~0)
  assert.ok(early.age < 0.05, 'age ~0 while still landing on 新緑');
  const mid = d.update(C + 28).season;     // ③市街の見せ場あたり ⇒ 濃緑へ深まる
  assert.ok(mid.age > 0.3 && mid.age < 0.9, `age deepening mid-cycle (got ${mid.age})`);
  assert.ok(mid.age > early.age, 'age advances across the zoom moves');
  const late = d.update(C + 44).season;    // 復路近接の終盤 ⇒ 黄緑(settled)に達する
  assert.strictEqual(late.age, 1, 'age saturates to 1 before the wrap');
  const start = d.update(2 * C).season;     // 次サイクル境界
  assert.ok(start.age < 0.05, 'age resets ~0 at cycle start (continuous)');
});

test('season.age 秋: 銀杏黄を保ち、④全域(最広)以降の最後の方からオレンジへ(late window)', () => {
  // 秋(index 2)は窓[33,43]＝③市街の見せ場の間は age~0(銀杏黄を保持)、④全域(≈local32-33)を
  // 過ぎた最後の方から age が立ち上がり、復路近接の終盤(≈43s)で 1(オレンジ=settled)に達する。
  const d = mk();
  const C = d.cycleDur;
  const body = d.update(2 * C + 28).season;   // 秋サイクルの③見せ場あたり ⇒ まだ銀杏黄
  assert.strictEqual(body.index, 2, 'autumn cycle');
  assert.ok(body.age < 0.05, `銀杏黄を保持(age~0) got ${body.age}`);
  const wide = d.update(2 * C + 40).season;    // ④全域を過ぎた後 ⇒ オレンジへ立ち上がり
  assert.ok(wide.age > 0.4 && wide.age < 1, `④以降にオレンジへ (got ${wide.age})`);
  assert.ok(wide.age > body.age, 'age が最後の方で進む');
  const end = d.update(2 * C + 44).season;     // wrap 直前 ⇒ オレンジ(settled)
  assert.strictEqual(end.age, 1, 'オレンジに達する(冬prev=秋settled で連続)');
});

test('season progress ramps from 0 at cycle start to ~1 by the end of the ③ hold', () => {
  const d = mk();
  // derive the ③(holdMid) end from the actual segment list so this stays correct as the
  // timeline is retuned (close-hold segments were inserted before ③).
  let endOfHold = 0;
  for (const s of d.segments) { endOfHold += s.dur; if (s.name === 'holdMid') break; }
  assert.ok(d.update(0).season.prog < 0.05, 'starts at season 0');
  assert.ok(d.update(endOfHold + 0.3).season.prog > 0.95, 'completes its arc by ③ end');
});
