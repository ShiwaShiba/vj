// CityScope — 音→建物変調レイヤ。純コア（geom/frameUniforms/computeScope）＋薄い factory。
// reveal.js が transformed.y を所有し、本レイヤは建物ごとの scope∈[0,1] を毎フレ計算して
// building-index テクスチャへ書くだけ（scope=1 で現状一致）。THREE/DOM/RNG/Date 無。
import { clamp, coordOf, MODES, applyA } from './scopeModes.js';

// 建物ごとの空間座標を1回構築。radius=駅からの正規化距離、zc=並木Z軸の正規化位置。
export function buildScopeGeom(perBuilding, getWorldZ) {
  const n = perBuilding.length;
  const radius = new Float32Array(n);
  const meanZ = new Float32Array(n);
  let maxRK = 0, zMin = Infinity, zMax = -Infinity;
  for (let b = 0; b < n; b++) if (perBuilding[b].revealKey > maxRK) maxRK = perBuilding[b].revealKey;
  for (let b = 0; b < n; b++) {
    const pb = perBuilding[b], end = pb.vStart + pb.vCount;
    let zs = 0; for (let i = pb.vStart; i < end; i++) zs += getWorldZ(i);
    const z = pb.vCount > 0 ? zs / pb.vCount : 0;
    meanZ[b] = z; if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    radius[b] = maxRK > 0 ? perBuilding[b].revealKey / maxRK : 0;
  }
  const zspan = (zMax - zMin) || 1;
  const zc = new Float32Array(n);
  for (let b = 0; b < n; b++) zc[b] = (meanZ[b] - zMin) / zspan;
  return { radius, zc };
}

export function defaultScopeConfig() {
  return {
    enabled: true,
    mode: 'breathing',        // 'breathing' | 'scanbar' | 'bloom'
    spatial: 'rings',         // 'rings' | 'avenue' | 'both'
    mix: 1.0,                 // master blend（0=OFF, scope→1）
    aRatio: 0.0,              // A層（ビート抽選 跳ね/消し）の濃度 0..1
    barBeats: 4,
    steps: 16,                // scanbar の量子化ステップ数
    barWidth: 0.06,           // scanbar の帯幅（座標 0..1）
    scanFloor: 0.0,           // scanbar 非点灯時の高さ（0=床へ崩落→discard）
    breathDepth: 0.32,        // 呼吸の最大沈み込み
    breathFloor: 0.45,        // 呼吸が割り込まない下限（discard 回避）
    breathSpread: 0.5,        // 半径/Z に沿う呼吸の位相勾配（リップル感）
    bloomBand: 0.18,          // 開花フロントのにじみ幅
    bloomRise: 1.2,           // 崩落→満開までの秒
    dropThresh: 0.25,         // drop 検出（level-levelSlow）
    dropRefractoryS: 2.0,     // drop 不応期（秒）
    histN: 96,                // radar: 音履歴リングバッファ長
    histDt: 0.033,            // radar: 履歴サンプル間隔（秒, 時間駆動で frame-rate 非依存）
    sweepSec: 1.4,            // radar: 外周(c=1)で見せる遅延秒＝進行波の到達時間
    radarGain: 1.6,           // radar: 履歴エネルギーのコントラスト
    radarFloor: 0.2,          // radar: 静か帯の下限高さ
    eqGain: 1.5,              // eq: 帯エネルギーのコントラスト
    eqFloor: 0.18,            // eq: 無音帯の下限高さ
  };
}

export function initScopeState() {
  return { front: 1, lastDropT: -1e9, clk: 0 };
}

// 音/ビート → 毎フレのスカラ。state.front / state.lastDropT を前進させる（純：入力同一→出力同一）。
export function frameUniforms(features, dt, cfg, state) {
  state.clk += dt;

  // radar: 音履歴リングバッファ。histDt 秒ごとに energy を1つ push（時間駆動＝frame-rate 非依存・決定論）。
  // energy は level + bass を畳んだ単一チャンネル（kick で明るい外向きリングが出る）。
  const histN = Math.max(2, cfg.histN | 0);
  if (!state.hist || state.hist.length !== histN) { state.hist = new Float32Array(histN); state.histHead = 0; state.acc = 0; }
  const energy = clamp(0.7 * clamp(features.level || 0, 0, 1) + 0.6 * (features.bass || 0), 0, 1);
  const histDt = Math.max(1e-3, cfg.histDt);
  state.acc += dt;
  let guard = 0;
  while (state.acc >= histDt && guard < 512) {
    state.histHead = (state.histHead + 1) % histN;
    state.hist[state.histHead] = energy;
    state.acc -= histDt; guard++;
  }

  const beatsFloat = (features.beats || 0) + (features.beatPhase || 0);
  const beatIndex = Math.floor(beatsFloat);
  const level = clamp(features.level || 0, 0, 1);

  // scanbar: 整数ビートで段送りする走査線位置 0..1
  const steps = Math.max(1, cfg.steps | 0);
  const linePos = (((features.beats || 0) % steps) + steps) % steps / steps;

  // breathing: 2小節で1呼吸の位相
  const barPhase2 = (beatsFloat / (cfg.barBeats * 2)) % 1;

  // bloom: drop で front を 0 へ（不応期つき）、毎フレ満開(1)へイーズ
  const drop = (level - (features.levelSlow || 0)) > cfg.dropThresh
    && (features.bass || 0) > (features.levelSlow || 0);
  if (drop && (state.clk - state.lastDropT) > cfg.dropRefractoryS) {
    state.lastDropT = state.clk; state.front = 0;
  }
  state.front = Math.min(1, state.front + dt / Math.max(1e-3, cfg.bloomRise));
  const envFloor = clamp(0.15 + (features.levelSlow || 0) * 0.85, 0, 1);

  // eq: 周波数3帯（bass/mid/treble）を 0..1 に。
  const bands = [clamp(features.bass || 0, 0, 1), clamp(features.mid || 0, 0, 1), clamp(features.treble || 0, 0, 1)];

  return {
    beatsFloat, beatIndex, level, linePos, barPhase2, front: state.front, envFloor,
    hist: state.hist, histHead: state.histHead, histDt, sweepSec: cfg.sweepSec, bands,
  };
}

// 建物ごとの scope を out へ。enabled=false / mix=0 は全 1（＝現状一致）。
export function computeScope(out, geom, u, cfg) {
  const n = out.length;
  if (!cfg.enabled || cfg.mix <= 0) { out.fill(1); return out; }
  const fn = MODES[cfg.mode] || MODES.breathing;
  for (let b = 0; b < n; b++) {
    const c = coordOf(geom, b, cfg.spatial);
    let s = fn(c, u, cfg);
    s = applyA(s, b, u, cfg);
    // mix: 1 で完全適用、0 で無効(=1)。中間は線形ブレンド。
    out[b] = 1 - cfg.mix * (1 - clamp(s, 0, 1));
  }
  return out;
}

// 薄い factory: 毎フレ reveal（sink）へ scope を書く。LIVE でのみ frame() が呼ばれる前提
// （INTRO は誰も呼ばず uScopeEnabled=0 のまま＝現状一致）。
export function createCityScope(geom, sink, config = {}) {
  const cfg = { ...defaultScopeConfig(), ...config };
  const state = initScopeState();
  const out = new Float32Array(geom.radius.length);
  return {
    setConfig(partial) { Object.assign(cfg, partial); },
    get config() { return cfg; },
    frame(features, dt) {
      const u = frameUniforms(features, dt, cfg, state);
      computeScope(out, geom, u, cfg);
      sink.writeScope(out);
      sink.setScopeEnabled(cfg.enabled && cfg.mix > 0);
    },
  };
}
