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
