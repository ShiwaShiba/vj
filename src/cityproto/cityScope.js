// CityScope — 音→建物変調レイヤ。純コア（geom/frameUniforms/computeScope）＋薄い factory。
// reveal.js が transformed.y を所有し、本レイヤは建物ごとの scope∈[0,1] を毎フレ計算して
// building-index テクスチャへ書くだけ（scope=1 で現状一致）。THREE/DOM/RNG/Date 無。
import { clamp } from './scopeModes.js';

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
  };
}

export function initScopeState() {
  return { front: 1, lastDropT: -1e9, clk: 0 };
}

// 音/ビート → 毎フレのスカラ。state.front / state.lastDropT を前進させる（純：入力同一→出力同一）。
export function frameUniforms(features, dt, cfg, state) {
  state.clk += dt;
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

  return { beatsFloat, beatIndex, level, linePos, barPhase2, front: state.front, envFloor };
}
