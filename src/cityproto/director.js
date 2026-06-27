// The master timeline for Plan 3. One cycle is a camera round-trip
// ① 旧駅舎寄り → ★近接(①②中間)で停止＝散り見せ場 → ② 扇 → ③ 市街(長め hold) → ④ 全域
// → 逆ドリーで再び★近接で停止 → ①へ. Four cycles = 春夏秋冬, then it wraps. The city
// builds ONCE (the reveal channels are one-shots tied to absolute time); afterwards only
// the camera flies and the 並木 changes season.
//
// ★近接ホールド(kMid = ①と②の中間距離)は往路・復路の2回置き、桜/落ち葉/雪が大きく読める
// 距離でしっかり鑑賞させる(ユーザー要望)。kMid は camrig を変えず lerpParams(k1,k2,midFrac)
// で内製＝keyframe 配列(①②③④)と camrig.test は不変。
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
  // 尺(秒)。往路 ①→[★近接hold]→②→③(見せ場)→④、復路 ④→[★近接hold]→①。★近接は holdLow を
  // 往復で2回使う＝散り(桜/落葉/雪)を大きく読める距離で計13秒鑑賞。cycleDur = 45.0s。
  hold1: 3.0,    // ① 旧駅舎寄り hold
  out1m: 1.8,    // ① → ★近接(kMid) へ寄る
  holdLow: 6.5,  // ★①②中間距離での停止＝散りの近接ショーケース(往路/復路で共用)
  outm2: 1.2,    // ★近接 → ② 扇
  hold2: 1.0,    // ② 扇 hold
  out23: 3.0,    // ② → ③ 市街
  holdMid: 13.0, // ③ 市街の見せ場 (最長 hold)
  out34: 2.5,    // ③ → ④ 全域
  hold4: 1.2,    // ④ 全域 hold
  out4m: 3.5,    // ④ → ★近接 へ沈む(復路、②付近を通過)
  revm1: 1.8,    // ★近接 → ① へ戻って一周
  parallaxAmt: 0.8,
  midFrac: 0.42, // kMid = lerpParams(①,②, midFrac) ＝「①と②の中間ぐらいの距離感」(寄り≒高さ9)
  // 季節の染め(並木の色＋落下粒子のブルーム)を、最初の★近接ホールドの終盤で満開にする。こうすると
  // 往路の近接ショーケースで既に桜が咲き、③でも満開のまま見せられる。下記 seasonRampEnd を参照。
  seasonRampFrac: 0.90,
  // ★見た目の遅延(春→夏などの遷移を自然に魅せる)。構造(prog: 木の大きさ/密度/咲き込み)は据え置き、
  // 「色」と「花びらの量」だけを遅らせる＝散りが薄く尾を引いている上に新芽(緑)が後から芽吹いて重なる。
  // local秒の窓。seasonColorWin=樹冠の色(prev→cur)が入りきる窓、seasonPetalWin=花びらが薄く消えきる窓
  // (色より長い尾＝緑が満ちた後も最後の花びらが少し残る余韻)。両端 0/1 でサイクル境界は連続(pop無し)。
  seasonColorWin: [2.0, 13.0],
  seasonPetalWin: [2.5, 16.0],
  // ★季節の「経年」(サイクル内の色ドリフト)の窓[start,end](local秒)、season ごとに別。dummy=春/冬は
  // seasonEndpoints が age を無視するので使わない。
  //  夏[13,43]: 色が入りきった後(≈13s)から②→③(市街の見せ場)→④→復路を跨いでゆっくり 新緑→濃緑→黄緑。
  //  秋[33,44]: 銀杏黄を保ち、④全域(最広, hold4≈local32-33)を過ぎた最後の方からオレンジ→最後の数秒で赤。
  // いずれも cycleDur(45s)手前で 1 に飽和＝サイクル境界で settled に達し pop 無し。秋は赤(settled)を 44-45s で保持。
  seasonAgeWins: [[0, 1], [13.0, 43.0], [33.0, 44.0], [0, 1]],
  // Staged reveal order = terrain → roads → buildings → 木々. 粒子は uAppear(=trees reveal)で
  // ゲートされるので、最初の★近接ホールド(t≈4.8–11.3s)の中で桜が出始めるよう treeWin を前倒し。
  terrainWin: [0.0, 2.5], roadWin: [1.2, 4.7], buildWin: [4.7, 9.0], treeWin: [9.0, 11.0],
  // 粒子(花びら)の出現は並木リビール(treeWin)から切り離し、長くゆるやかなランプにする。treeWin と
  // 同じ t9 開始(木が無い所から花びらは降らせない)だが、2秒で満タンの並木と違い ~7秒かけて薄く湧かせ、
  // ②→③移動の頃に満開へ。これで「満開停止中に突然散り出す」バーストが消える(cycle0)。定常春は
  // tSec が大きく petalWin を常に越える＝uAppear=1 で従来どおりホールド中ずっと降る。
  petalWin: [9.0, 16.0],
};

export function createDirector({ keyframes, tuning = {}, parallax = false }) {
  const T = { ...DEFAULTS, ...tuning };
  const [k1, k2, k3, k4] = keyframes;
  // ★近接ホールドの画角＝①と②の中間距離(camrig を変えず内製)。①(寄り)と②(扇)の補間なので
  // bearing は両者と同じ＝軸外しにならない。散る粒子が大きく読める寄りの停止点。
  const kMid = lerpParams(k1, k2, T.midFrac);

  // One cycle's segments. Flat holds (from===to) are the 溜め (緩); eased moves are
  // the 引き (急). ★holdLowA/B = 往復2回の近接ショーケース。④→★→① の沈みは gentle sine。
  const segments = [
    { name: 'hold1', dur: T.hold1, from: k1, to: k1, ease: 'linear' },
    { name: 'out1m', dur: T.out1m, from: k1, to: kMid, ease: 'easeInOutCubic' },
    { name: 'holdLowA', dur: T.holdLow, from: kMid, to: kMid, ease: 'linear' },   // ★往路の散り見せ場
    { name: 'outm2', dur: T.outm2, from: kMid, to: k2, ease: 'easeInOutCubic' },
    { name: 'hold2', dur: T.hold2, from: k2, to: k2, ease: 'linear' },
    { name: 'out23', dur: T.out23, from: k2, to: k3, ease: 'easeInOutCubic' },
    { name: 'holdMid', dur: T.holdMid, from: k3, to: k3, ease: 'linear' },
    { name: 'out34', dur: T.out34, from: k3, to: k4, ease: 'easeInOutCubic' },
    { name: 'hold4', dur: T.hold4, from: k4, to: k4, ease: 'linear' },
    { name: 'out4m', dur: T.out4m, from: k4, to: kMid, ease: 'easeInOutSine' },
    { name: 'holdLowB', dur: T.holdLow, from: kMid, to: kMid, ease: 'linear' },   // ★復路の散り見せ場
    { name: 'revm1', dur: T.revm1, from: kMid, to: k1, ease: 'easeInOutSine' },
  ];
  const cycleDur = segments.reduce((a, s) => a + s.dur, 0);
  // Season染め を最初の★近接ホールド(holdLowA)の終盤で満開にする。showStart=holdLowA 開始時刻、
  // seasonRampEnd は holdLowA の seasonRampFrac(0.9)地点＝近接ショーケースで桜が咲ききり、②③でも満開。
  const showStart = T.hold1 + T.out1m;
  const seasonRampEnd = showStart + T.holdLow * T.seasonRampFrac;

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
      petals: smoothstep(T.petalWin[0], T.petalWin[1], tSec), // 粒子専用の長くゆるやかな出現(バースト回避)
    };

    const index = ((Math.floor(tSec / cycleDur) % 4) + 4) % 4;
    // prog = 構造(木の成長/密度/咲き込み)。progColor = 樹冠の色(遅延)。progPetal = 花びらの量(更に長い尾)。
    // 見た目だけを構造から遅らせて「散り→新緑」を重ねる(seasonColorWin/seasonPetalWin)。
    const season = {
      index,
      prog: smoothstep(0, seasonRampEnd, local),
      progColor: smoothstep(T.seasonColorWin[0], T.seasonColorWin[1], local),
      progPetal: smoothstep(T.seasonPetalWin[0], T.seasonPetalWin[1], local),
      age: smoothstep(T.seasonAgeWins[index][0], T.seasonAgeWins[index][1], local), // サイクル内の経年(夏=樹冠の深まり / 秋=銀杏→オレンジ)
      name: SEASON_NAMES[index],
    };

    return { cam, reveal, season };
  }

  return { update, cycleDur, segments, tuning: T };
}
