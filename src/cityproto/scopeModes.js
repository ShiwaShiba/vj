// CityScope モード registry — PURE（THREE/DOM/RNG/Date 無、hash01 のみ）。各モードは
// (geom, frameUniforms, cfg) から建物ごとの reveal 係数 scope∈[0,1] を返す純関数。
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
// 整数 → [0,1) の決定論ハッシュ（shotDirector.hash01 と同一式）。
export function hash01(n) {
  let h = (Math.floor(n) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

export function coordOf(geom, b, spatial) {
  if (spatial === 'avenue') return geom.zc[b];
  if (spatial === 'both') return 0.5 * (geom.radius[b] + geom.zc[b]);
  return geom.radius[b]; // 'rings'
}

// リングバッファ hist を head（最新書込位置）から samplesBack サンプル遡って読む（端数は線形補間）。
export function sampleHistory(hist, head, samplesBack) {
  const n = hist.length;
  if (n === 0) return 0;
  const sb = clamp(samplesBack, 0, n - 1);
  const i0 = Math.floor(sb), frac = sb - i0;
  const a = hist[((head - i0) % n + n) % n];
  const b = hist[((head - i0 - 1) % n + n) % n];
  return a + (b - a) * frac;
}

export const MODES = {
  // ⑤ 都市の呼吸: 2小節で1呼吸、深さは level、座標で位相をずらしリップル。下限 breathFloor。
  breathing(c, u, cfg) {
    const phase = (u.barPhase2 - c * cfg.breathSpread);
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);  // 0..1
    const depth = cfg.breathDepth * (0.3 + 0.7 * (u.level || 0));
    return clamp(1 - depth * w, cfg.breathFloor, 1);
  },
  // ③ スキャンバー: 走査線 linePos に近い建物だけ満高、他は scanFloor（0→崩落→discard）。
  // 座標は環状（0と1が連続）扱いで帯が途切れない。
  scanbar(c, u, cfg) {
    const d = Math.abs(c - u.linePos);
    const dd = Math.min(d, 1 - d);
    const on = 1 - smooth01(dd / Math.max(1e-4, cfg.barWidth));
    return lerp(cfg.scanFloor, 1, on);
  },
  // ⑦ 沈黙と開花: 開花フロント front が建物座標 c を越えたら満高、未到達は envFloor。
  bloom(c, u, cfg) {
    const reveal = smooth01((u.front - (c - cfg.bloomBand)) / Math.max(1e-4, cfg.bloomBand));
    return Math.max(u.envFloor, reveal);
  },
  // ① レーダーping: 座標 c を時間遅延に写し、c·sweepSec 秒前の音エネルギーを表示＝
  // マップに巻いたオシロスコープ。kick で生まれた明るいリングが駅から外周へ進行する。
  radar(c, u, cfg) {
    const delay = c * cfg.sweepSec;
    const e = sampleHistory(u.hist, u.histHead, delay / Math.max(1e-3, u.histDt));
    return lerp(cfg.radarFloor, 1, smooth01(e * cfg.radarGain));
  },
};

// A層: ビート毎 hash01(b ⊕ beatIndex) で抽選した建物を、跳ね(+δ)か消し(0)に。aRatio=濃度。
export function applyA(scope, b, u, cfg) {
  if (cfg.aRatio <= 0) return scope;
  const h = hash01((b * 2654435761) ^ (u.beatIndex | 0));
  if (h >= cfg.aRatio) return scope;
  // 抽選内で半々に跳ね/消し（別ハッシュ）
  const flip = hash01((b ^ 0x5bd1e995) + (u.beatIndex | 0));
  return flip < 0.5 ? 0 : Math.min(1, scope + 0.6);
}
