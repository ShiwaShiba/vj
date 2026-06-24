// Plan space: u=east(+)/west(-), v=north(-)/south(+), apex (station) at (0,0).
export function terrainHeight(u, v) {
  return -0.014 * v + 0.006 * u
    + 0.018 * Math.sin(u * 1.7 + 0.4) * Math.cos(v * 1.3 - 0.2)
    + 0.012 * Math.sin(u * 3.1 - v * 2.2 + 1.0)
    + 0.008 * Math.cos(v * 2.6 + 0.7);
}

// West (Fujimi) district is the larger side — fan opens wider for u<0.
export function inHomePlate(u, v) {
  if (v <= -0.08 || v >= 1.18) return false;
  const fanW = 0.18 + Math.max(0, v) * 1.25;
  const fanE = 0.14 + Math.max(0, v) * 0.85;
  return u < 0 ? -u < fanW : u < fanE;
}

// Named avenues as plan-space segments from the apex.
export const AVENUES = [
  { name: 'daigaku', ax: 0, av: -0.02, bx: 0, bv: 1.21, w: 2.6, bright: 0.95 },
  { name: 'fujimi', ax: 0, av: 0, bx: -0.95, bv: 0.74, w: 2.3, bright: 0.9 },
  { name: 'asahi', ax: 0, av: 0, bx: 0.5, bv: 0.49, w: 2.0, bright: 0.86 },
  { name: 'chuo', ax: -1.7, av: -0.135, bx: 1.7, bv: -0.135, w: 2.4, bright: 0.85 },
];

export function distToSeg(u, v, a) {
  const dx = a.bx - a.ax, dy = a.bv - a.av, L = dx * dx + dy * dy;
  let t = L > 0 ? ((u - a.ax) * dx + (v - a.av) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(u - (a.ax + t * dx), v - (a.av + t * dy));
}

export const GREEN = [
  [0.30, 0.66, 0.72, 1.04], [-0.55, 0.72, -0.18, 1.0], [-1.04, 0.8, -0.6, 1.14],
];
export const inGreen = (u, v) => GREEN.some((g) => u > g[0] && u < g[2] && v > g[1] && v < g[3]);
