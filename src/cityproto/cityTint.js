// 全体VJパレット → 国立シティの控えめ tint（純粋）。fg の色相だけを低彩度・明度保存で取り出し、
// 0..1 LINEAR の「乗数」(luma≈1) として返す＝建物/地面に掛けても明るさは変えず色相だけ淡く転ぶ。
// 無彩色(MONO/グレー)は (1,1,1)=恒等＝mono保持（守る線）。虹色化しない（半分だけ彩度を残す）。
const SAT = 0.5;
export function paletteToCityTint(palette, strength) {
  const fg = palette && Array.isArray(palette.fg) && palette.fg.length === 3 ? palette.fg : [255, 255, 255];
  let r = fg[0] / 255, g = fg[1] / 255, b = fg[2] / 255;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r = y + (r - y) * SAT; g = y + (g - y) * SAT; b = y + (b - y) * SAT; // 彩度を半分へ
  if (y > 1e-4) { r /= y; g /= y; b /= y; }                            // luma→1（明度保存）
  const s = Math.max(0, Math.min(1, +strength || 0));
  return { r, g, b, strength: s };
}
