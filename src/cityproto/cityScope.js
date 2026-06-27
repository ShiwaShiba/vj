// CityScope — 音→建物変調レイヤ。純コア（geom/frameUniforms/computeScope）＋薄い factory。
// reveal.js が transformed.y を所有し、本レイヤは建物ごとの scope∈[0,1] を毎フレ計算して
// building-index テクスチャへ書くだけ（scope=1 で現状一致）。THREE/DOM/RNG/Date 無。

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
