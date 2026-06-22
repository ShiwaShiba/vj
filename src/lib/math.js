// Small math + color helpers. No dependencies.

export const TWO_PI = Math.PI * 2;
export const HALF_PI = Math.PI / 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const map = (v, a, b, c, d) => c + ((v - a) * (d - c)) / (b - a);
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const wrap01 = (x) => x - Math.floor(x);

// --- Color ---
// Colors are kept as [r,g,b] arrays (0-255) for cheap interpolation,
// and converted to CSS strings only at draw time.

export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbCss = (rgb, a = 1) =>
  a >= 1 ? `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`
         : `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${a})`;

// Optional `out` array lets hot loops avoid per-call allocation.
export function lerpRgb(a, b, t, out) {
  const r = a[0] + (b[0] - a[0]) * t;
  const g = a[1] + (b[1] - a[1]) * t;
  const bl = a[2] + (b[2] - a[2]) * t;
  if (out) { out[0] = r; out[1] = g; out[2] = bl; return out; }
  return [r, g, bl];
}

// Sample a multi-stop ramp (array of [r,g,b]) at t in [0,1].
export function rampAt(stops, t, out) {
  if (!stops || !stops.length) return out ? (out[0] = out[1] = out[2] = 128, out) : [128, 128, 128];
  t = clamp(t, 0, 1);
  if (stops.length === 1) {
    const s = stops[0];
    return out ? (out[0] = s[0], out[1] = s[1], out[2] = s[2], out) : s;
  }
  const x = t * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  return lerpRgb(stops[i], stops[i + 1], x - i, out);
}

// HSL -> RGB (h in [0,1], s/l in [0,1]) -> [r,g,b] 0-255
export function hslRgb(h, s, l) {
  h = wrap01(h);
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (tc) => {
    let t = wrap01(tc);
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hk(h + 1 / 3) * 255, hk(h) * 255, hk(h - 1 / 3) * 255];
}
