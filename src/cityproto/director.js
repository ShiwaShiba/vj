// The master timeline for Plan 3. One cycle is a camera round-trip
// ① 旧駅舎寄り → ② 扇 → ③ 市街(長め hold) → ④ 全域 → ゆっくり逆ドリーで①へ.
// Four cycles = 春夏秋冬, then it wraps. The city builds ONCE (the reveal channels
// are one-shots tied to absolute time); afterwards only the camera flies and the
// 並木 changes season.
//
// update(tSec) is a PURE function of elapsed seconds → {cam, reveal, season}, so
// it is fully scrubbable and node-testable. proto.js feeds it performance.now and
// applies the result. Authored as named segments so audio can later drive it.
import { lerpParams, applyParallax } from './camrig.js';
import { byName } from './ease.js';
import { clamp, smoothstep } from '../lib/math.js';

export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

// Durations in seconds + reveal windows (absolute seconds, during cycle 0). All
// tunable live via window.__proto.director.tuning — 緩急 is dialed by looking.
const DEFAULTS = {
  // ① 駅前アップ(hold1) と ③ 市街の見せ場(holdMid) を長くして、旧駅舎の寄りと 並木の落下粒子
  // (桜/落ち葉/雪) をしっかり見せる尺に。holdMid 9→13 で落下エフェクトの鑑賞を約4秒延長。cycleDur = 30.2s。
  hold1: 3.0, out12: 2.5, hold2: 1.0, out23: 3.0, holdMid: 13.0, out34: 2.5, hold4: 1.2, reverse: 4.0,
  parallaxAmt: 0.8,
  // 季節の染め(並木の色＋落下粒子のブルーム)が見せ場のどこで満開になるか。1.0=見せ場の終端
  // (＝カメラが引く瞬間に満開=遅すぎ)。0.45=見せ場の序盤で満開→残り約5秒を満開のまま見せられる。
  seasonRampFrac: 0.45,
  // Staged reveal order = terrain → roads → buildings → 木々. buildWin slowed a touch; treeWin
  // starts AFTER the buildings finish so the 並木 (and its petals) grow in last, not before the
  // city. With the longer holdMid the ③ showpiece now runs 9.5–22.5s: buildings finish at its head
  // and the 並木(+petals) reveal 10–12s, so the petals stay fully visible for ~10.5s of the hold.
  terrainWin: [0.0, 2.5], roadWin: [1.2, 4.7], buildWin: [4.7, 10.0], treeWin: [10.0, 12.0],
};

export function createDirector({ keyframes, tuning = {}, parallax = false }) {
  const T = { ...DEFAULTS, ...tuning };
  const [k1, k2, k3, k4] = keyframes;

  // One cycle's segments. Flat holds (from===to) are the 溜め (緩); eased moves are
  // the 引き (急). The reverse dolly ④→① sinks back on a gentle sine.
  const segments = [
    { name: 'hold1', dur: T.hold1, from: k1, to: k1, ease: 'linear' },
    { name: 'out12', dur: T.out12, from: k1, to: k2, ease: 'easeInOutCubic' },
    { name: 'hold2', dur: T.hold2, from: k2, to: k2, ease: 'linear' },
    { name: 'out23', dur: T.out23, from: k2, to: k3, ease: 'easeInOutCubic' },
    { name: 'holdMid', dur: T.holdMid, from: k3, to: k3, ease: 'linear' },
    { name: 'out34', dur: T.out34, from: k3, to: k4, ease: 'easeInOutCubic' },
    { name: 'hold4', dur: T.hold4, from: k4, to: k4, ease: 'linear' },
    { name: 'reverse', dur: T.reverse, from: k4, to: k1, ease: 'easeInOutSine' },
  ];
  const cycleDur = segments.reduce((a, s) => a + s.dur, 0);
  // Season染め peaks PART-WAY into ③ (not at its exit), so the 並木の色 and falling petals reach
  // full bloom with hold left to watch them before the camera dollies back. seasonRampFrac dials it.
  const showStart = T.hold1 + T.out12 + T.hold2 + T.out23;
  const seasonRampEnd = showStart + T.holdMid * T.seasonRampFrac;

  function activeSegment(local) {
    let acc = 0;
    for (const s of segments) {
      if (local < acc + s.dur) return { seg: s, segT: s.dur > 0 ? (local - acc) / s.dur : 0 };
      acc += s.dur;
    }
    return { seg: segments[segments.length - 1], segT: 1 }; // local === cycleDur edge
  }

  function update(tSec, opts = {}) {
    const local = ((tSec % cycleDur) + cycleDur) % cycleDur;
    const { seg, segT } = activeSegment(local);
    let cam = lerpParams(seg.from, seg.to, byName(seg.ease)(clamp(segT, 0, 1)));
    if (opts.parallax ?? parallax) cam = applyParallax(cam, local / cycleDur, T.parallaxAmt);

    const reveal = {
      terrain: smoothstep(T.terrainWin[0], T.terrainWin[1], tSec),
      roads: smoothstep(T.roadWin[0], T.roadWin[1], tSec),
      buildings: smoothstep(T.buildWin[0], T.buildWin[1], tSec),
      trees: smoothstep(T.treeWin[0], T.treeWin[1], tSec),
    };

    const index = ((Math.floor(tSec / cycleDur) % 4) + 4) % 4;
    const season = { index, prog: smoothstep(0, seasonRampEnd, local), name: SEASON_NAMES[index] };

    return { cam, reveal, season };
  }

  return { update, cycleDur, segments, tuning: T };
}
