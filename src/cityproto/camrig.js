// Camera rig for the Plan 3 reveal: the four framings (① 旧駅舎寄り → ② 扇 → ③ 市街
// → ④ 全域) and their interpolation. Operates on plain param objects of the shape
// applyCamera() consumes — {camX,camY,camZ,fov,lookX,lookY,lookV} — so it stays
// THREE-free and node-testable. proto.js resolves the landmark world position and
// passes it in as plain numbers.

const TWO_PI = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

// Default framing tuning (dialed by looking — see window.__proto.director.params).
// d* = distance from the lookAt along the oblique bearing; h* = camera height;
// fov* = field of view; south = ③ lookAt shift down 大学通り (+v / +world Z).
const DEF = {
  d1: 6, h1: 4, fov1: 30,
  d2: 18, h2: 16, fov2: 40,
  d3: 26, h3: 20, fov3: 44,
  south: 10,
};

// Build the 4 keyframes. The full-city framing ④ defines the fixed oblique bearing
// (the look angle the reference image fixes); ①②③ reuse that bearing so the camera
// only pulls out/up, never swings off-axis.
export function makeKeyframes({ full, landmark, station }, opts = {}) {
  const T = { ...DEF, ...opts };
  const dx = full.camX - full.lookX, dz = full.camZ - full.lookV;
  const L = Math.hypot(dx, dz) || 1;
  const bx = dx / L, bz = dz / L; // unit oblique bearing in the XZ plane

  const frame = (look, dist, camY, fov) => ({
    camX: look.x + bx * dist, camY, camZ: look.z + bz * dist, fov,
    lookX: look.x, lookY: look.y, lookV: look.z,
  });

  const k1 = frame({ x: landmark.x, y: landmark.y, z: landmark.z }, T.d1, T.h1, T.fov1); // ① hero
  const k2 = frame({ x: station.x, y: 0, z: station.z }, T.d2, T.h2, T.fov2);            // ② fan
  const k3 = frame({ x: station.x, y: 0, z: station.z + T.south }, T.d3, T.h3, T.fov3);  // ③ city
  const k4 = { ...full };                                                                 // ④ full

  return [k1, k2, k3, k4];
}

// Interpolate every camera field. easedT is already eased by the caller.
export function lerpParams(a, b, t) {
  return {
    camX: lerp(a.camX, b.camX, t), camY: lerp(a.camY, b.camY, t), camZ: lerp(a.camZ, b.camZ, t),
    fov: lerp(a.fov, b.fov, t),
    lookX: lerp(a.lookX, b.lookX, t), lookY: lerp(a.lookY, b.lookY, t), lookV: lerp(a.lookV, b.lookV, t),
  };
}

// The micro-parallax variant: a slow sinusoidal drift layered on a framing so the
// pull-out breathes. amt=0 is a pure straight dolly (no-op). phase in [0,1].
const PX = { x: 0.6, y: 0.4, look: 0.25 };
export function applyParallax(p, phase, amt) {
  if (!amt) return { ...p };
  const a = phase * TWO_PI;
  return {
    ...p,
    camX: p.camX + Math.sin(a) * amt * PX.x,
    camY: p.camY + Math.sin(a + 1.7) * amt * PX.y,
    lookX: p.lookX + Math.cos(a) * amt * PX.look,
  };
}
