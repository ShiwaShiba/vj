# City Touch Prototype — Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Three.js prototype that reproduces the reference image's *touch* (photoreal monochrome: soft baked AO, terrain relief, smooth AA, grain) on procedural Kunitachi-shaped geometry — validating the riskiest unknown before investing in the real-data pipeline.

**Architecture:** A self-contained dev page (`city-proto.html` + `src/cityproto/*.js`) renders a WebGL scene (terrain heightfield + low-rise building field + main avenues) with a vendored Three.js. AA = renderer MSAA. The "rendered photo" feel = per-vertex baked AO/shading in `MeshBasicMaterial` (unlit) + a 2D `<canvas>` overlay for grain/vignette/haze on top. No app integration, no real data yet — both are later plans.

**Tech Stack:** Three.js (vendored ESM, no bundler), plain ES modules, Canvas 2D overlay. Verified via the existing `vj` preview server (`.claude/launch.json`, port 8125) + `preview_screenshot` compared to the reference.

**Out of scope (later plans):** real OSM/DEM data + raycast AO bake (Plan 2); integration into the Scene framework, reveal animation, mic reactivity, trees, 旧駅舎 craft, perf (Plan 3). This plan uses a *faked-but-convincing* AO (vertex-color gradients + density darkening); Plan 2 replaces it with true baked AO.

---

## File Structure

- `city-proto.html` — standalone dev page: full-screen WebGL canvas + 2D overlay canvas, loads the proto module.
- `src/vendor/three.module.js` — vendored Three.js ESM build (offline/PWA-friendly, SW-cacheable).
- `src/cityproto/proto.js` — entry: renderer, camera, scene assembly, render loop, overlay.
- `src/cityproto/geo.js` — plan geometry constants + projection-free helpers (home-plate fan, terrain height fn, avenue segments). Pure data, unit-testable.
- `src/cityproto/terrain.js` — builds the terrain heightfield `BufferGeometry` with per-vertex AO colors.
- `src/cityproto/buildings.js` — builds the merged building `BufferGeometry` (low-rise field, vertex-color AO/shading).
- `src/cityproto/avenues.js` — builds the main-road `LineSegments` (大学/富士見/旭/中央線).
- `src/cityproto/overlay.js` — 2D overlay: grain + vignette + haze (+ a one-line title).
- `tests/cityproto/geo.test.mjs` — Node tests for the pure geometry helpers.

**Convention:** plan space matches the existing scene — `u` = east(+)/west(−), `v` = north(−)/south(+), apex (station) at `(0,0)`, 富士見 = west/long, 旭 = east/short.

---

## Task 1: Vendor Three.js and scaffold the proto page

**Files:**
- Create: `src/vendor/three.module.js`
- Create: `city-proto.html`
- Create: `src/cityproto/proto.js`

- [ ] **Step 1: Download the Three.js ESM build into the repo**

Run:
```bash
mkdir -p src/vendor src/cityproto && \
curl -sL https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js -o src/vendor/three.module.js && \
wc -l src/vendor/three.module.js && head -3 src/vendor/three.module.js
```
Expected: a multi-thousand-line file; first lines contain the Three.js license banner / `const REVISION = '160'`.

- [ ] **Step 2: Create the standalone page**

`city-proto.html`:
```html
<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Kunitachi City — touch proto</title>
<style>
  html,body{margin:0;height:100%;background:#07080a;overflow:hidden}
  #gl,#ov{position:fixed;inset:0;width:100vw;height:100vh;display:block}
  #ov{pointer-events:none}
</style>
<canvas id="gl"></canvas>
<canvas id="ov"></canvas>
<script type="module" src="./src/cityproto/proto.js"></script>
```

- [ ] **Step 3: Minimal renderer + camera + a test cube in proto.js**

`src/cityproto/proto.js`:
```js
import * as THREE from '../vendor/three.module.js';

const glCanvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x07080a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 9, 11);
camera.lookAt(0, 0, 1.2);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0x999999 }),
);
scene.add(cube);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

function loop() { renderer.render(scene, camera); requestAnimationFrame(loop); }
loop();

window.__proto = { THREE, scene, camera, renderer };
```

- [ ] **Step 4: Verify it renders**

Run: `preview_start` (name `vj`), then `preview_resize` to 1280×720, navigate to `http://localhost:8125/city-proto.html`, `preview_console_logs` (level error) → expect none, `preview_screenshot` → expect a gray cube on near-black.

- [ ] **Step 5: Commit**

```bash
git add src/vendor/three.module.js city-proto.html src/cityproto/proto.js
git commit -m "feat(cityproto): vendor three.js + standalone proto page with test cube

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Plan geometry helpers (pure, tested)

**Files:**
- Create: `src/cityproto/geo.js`
- Test: `tests/cityproto/geo.test.mjs`

- [ ] **Step 1: Write the failing test**

`tests/cityproto/geo.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { terrainHeight, inHomePlate, AVENUES } from '../../src/cityproto/geo.js';

test('terrain is gentle (|h| < 0.06 over the field)', () => {
  for (let u = -1.8; u <= 1.7; u += 0.3)
    for (let v = -0.4; v <= 1.25; v += 0.3)
      assert.ok(Math.abs(terrainHeight(u, v)) < 0.06, `h too large at ${u},${v}`);
});

test('home-plate fan is wider on the west (Fujimi) side', () => {
  // at v=0.6, a west cell at u=-0.7 is inside, the mirrored east u=0.7 is not
  assert.ok(inHomePlate(-0.7, 0.6), 'west should be inside');
  assert.ok(!inHomePlate(0.7, 0.6), 'east should be outside (shorter)');
});

test('AVENUES has the four named roads with correct asymmetry', () => {
  const names = AVENUES.map((a) => a.name);
  assert.deepStrictEqual(names, ['daigaku', 'fujimi', 'asahi', 'chuo']);
  const fujimi = AVENUES.find((a) => a.name === 'fujimi');
  const asahi = AVENUES.find((a) => a.name === 'asahi');
  const len = (a) => Math.hypot(a.bx - a.ax, a.bv - a.av);
  assert.ok(len(fujimi) > len(asahi) * 1.4, 'fujimi must be the long side');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/cityproto/geo.test.mjs`
Expected: FAIL — `Cannot find module '.../geo.js'`.

- [ ] **Step 3: Implement geo.js**

`src/cityproto/geo.js`:
```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/cityproto/geo.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cityproto/geo.js tests/cityproto/geo.test.mjs
git commit -m "feat(cityproto): pure plan-geometry helpers + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Terrain heightfield mesh with baked-AO vertex colors

**Files:**
- Create: `src/cityproto/terrain.js`
- Modify: `src/cityproto/proto.js`

- [ ] **Step 1: Build the terrain geometry**

`src/cityproto/terrain.js`:
```js
import * as THREE from '../vendor/three.module.js';
import { terrainHeight } from './geo.js';

// A grid mesh over the plan field. World = (u*SCALE, height*VSCALE, v*SCALE).
// AO is faked from local slope: concave/valley cells get darker (the reference's
// soft terrain shading). Replaced by true raycast AO in Plan 2.
export function buildTerrain({ SCALE = 6, VSCALE = 5, NX = 120, NV = 80 } = {}) {
  const u0 = -1.85, u1 = 1.72, v0 = -0.42, v1 = 1.3;
  const pos = [], col = [], idx = [];
  const H = (u, v) => terrainHeight(u, v);
  for (let j = 0; j <= NV; j++) {
    const v = v0 + (v1 - v0) * (j / NV);
    for (let i = 0; i <= NX; i++) {
      const u = u0 + (u1 - u0) * (i / NX);
      const h = H(u, v);
      pos.push(u * SCALE, h * VSCALE, (v - 0.3) * SCALE);
      const lap = (4 * h - H(u + 0.03, v) - H(u - 0.03, v) - H(u, v + 0.03) - H(u, v - 0.03));
      const ao = THREE.MathUtils.clamp(0.10 + 0.06 * Math.sign(lap) - lap * 1.4, 0.05, 0.18);
      col.push(ao, ao, ao);
    }
  }
  const w = NX + 1;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NX; i++) {
    const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  return new THREE.Mesh(g, m);
}

// Thin grid overlay so the terrain reads as an undulating lattice (reveal layer 1).
export function buildTerrainGrid({ SCALE = 6, VSCALE = 5 } = {}) {
  const pts = [], step = 0.085;
  const seg = (u0, v0, u1, v1, n) => {
    for (let k = 0; k < n; k++) {
      const a = k / n, b = (k + 1) / n;
      const ua = u0 + (u1 - u0) * a, va = v0 + (v1 - v0) * a;
      const ub = u0 + (u1 - u0) * b, vb = v0 + (v1 - v0) * b;
      pts.push(ua * SCALE, terrainHeight(ua, va) * VSCALE, (va - 0.3) * SCALE);
      pts.push(ub * SCALE, terrainHeight(ub, vb) * VSCALE, (vb - 0.3) * SCALE);
    }
  };
  for (let u = -1.8; u <= 1.7; u += step) seg(u, -0.42, u, 1.3, 30);
  for (let v = -0.4; v <= 1.28; v += step) seg(-1.82, v, 1.72, v, 40);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb0b8c4, transparent: true, opacity: 0.12 }));
}
```

- [ ] **Step 2: Add terrain to the scene, remove the cube**

In `proto.js`, replace the cube block with:
```js
import { buildTerrain, buildTerrainGrid } from './terrain.js';
scene.add(buildTerrain());
scene.add(buildTerrainGrid());
```
And retune the camera for the aerial framing:
```js
camera.position.set(0.6, 8.2, 12.5);
camera.lookAt(0.4, 0, 1.4);
```

- [ ] **Step 3: Verify the terrain renders with relief**

Run: reload `city-proto.html`, `preview_console_logs` (error) → none, `preview_screenshot` → a near-black field with a faintly-lit, gently-undulating grid surface; the railway latitude (v≈-0.13) sits in the upper third.

- [ ] **Step 4: Commit**

```bash
git add src/cityproto/terrain.js src/cityproto/proto.js
git commit -m "feat(cityproto): terrain heightfield + grid with faked AO shading

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Low-rise building field (merged geometry, vertex-AO shading)

**Files:**
- Create: `src/cityproto/buildings.js`
- Modify: `src/cityproto/proto.js`

- [ ] **Step 1: Build the merged building geometry**

`src/cityproto/buildings.js`:
```js
import * as THREE from '../vendor/three.module.js';
import { terrainHeight, inHomePlate, inGreen, AVENUES, distToSeg } from './geo.js';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cmask = (u, v) => Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sin(u * 1.25 + 0.5) * Math.cos(v * 1.05 - 0.3) + 0.2 * Math.sin(u * 0.8 - v * 0.9)));

// One big BufferGeometry of low boxes. Vertex colors bake the look: top faces
// light, walls darker toward the base (contact-shadow gradient), denser
// clusters darker overall (faked AO). Real raycast AO arrives in Plan 2.
export function buildBuildings({ SCALE = 6, VSCALE = 5, HSCALE = 1.0 } = {}) {
  const r = rng(20260624);
  const pos = [], col = [], idx = [];
  const fj = AVENUES[1], as = AVENUES[2];
  const pushBox = (u, v, fw, fd, h, topG, cl) => {
    const z0 = terrainHeight(u, v), z1 = z0 + h;
    const x0 = (u - fw) * SCALE, x1 = (u + fw) * SCALE;
    const zc0 = (v - fd - 0.3) * SCALE, zc1 = (v + fd - 0.3) * SCALE;
    const y0 = z0 * VSCALE, y1 = z1 * VSCALE;
    const base = pos.length / 3;
    // 8 corners: 0-3 bottom (NW,NE,SE,SW), 4-7 top
    const C = [[x0, y0, zc0], [x1, y0, zc0], [x1, y0, zc1], [x0, y0, zc1],
              [x0, y1, zc0], [x1, y1, zc0], [x1, y1, zc1], [x0, y1, zc1]];
    for (const c of C) pos.push(c[0], c[1], c[2]);
    const wall = topG * (0.5 - 0.18 * cl), baseG = wall * 0.5, top = topG;
    const cAt = (i) => i >= 4 ? top : baseG;
    for (let i = 0; i < 8; i++) { const g = cAt(i); col.push(g, g, g); }
    const F = [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]];
    for (const f of F) idx.push(base+f[0],base+f[1],base+f[2],base+f[0],base+f[2],base+f[3]);
  };
  for (let v = -0.40; v < 1.30; v += 0.039) {
    for (let u = -1.82; u < 1.72; u += 0.045) {
      const cu = u + (r() - 0.5) * 0.022, cv = v + (r() - 0.5) * 0.022;
      if (Math.abs(cu) < 0.05) continue;            // 大学通り corridor
      if (Math.abs(cv + 0.12) < 0.03) continue;      // 中央線 corridor
      if (inGreen(cu, cv)) continue;
      if (Math.abs(cu) < 0.12 && cv > -0.12 && cv < 0.07) continue; // station footprint
      if (distToSeg(cu, cv, fj) < 0.03 || distToSeg(cu, cv, as) < 0.03) continue;
      const cl = cmask(cu, cv);
      const inH = inHomePlate(cu, cv);
      const north = cv <= -0.08 && cv > -0.40 && Math.abs(cu) < 1.05;
      let pres = inH ? 0.92 : north ? (0.5 * cl + 0.30)
        : Math.max(0.26, Math.min(0.9, 0.5 + 0.30 * Math.sin(cu * 1.3 + 0.4) * Math.cos(cv * 1.2) + 0.12 * Math.sin(cu * 0.6 - cv * 0.8)));
      if (r() > pres) continue;
      const spine = 1 + 0.55 * Math.exp(-Math.abs(cu) * 6.5);
      const h = (0.020 + 0.052 * cl * cl) * spine * (0.7 + 0.6 * r()) * HSCALE;
      const topG = 0.62 + 0.30 * Math.min(1, h * 8);
      pushBox(cu, cv, 0.019 * (0.7 + 0.6 * r()), 0.016 * (0.7 + 0.6 * r()), h, topG, cl);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
}
```

- [ ] **Step 2: Add buildings to the scene**

In `proto.js`: `import { buildBuildings } from './buildings.js';` then `scene.add(buildBuildings());`.

- [ ] **Step 3: Verify the carpet renders**

Run: reload, `preview_console_logs` (error) → none, `preview_screenshot` → a dense low-rise monochrome carpet filling the field, denser toward the home-plate and wider on the west; no buildings on 大学通り/富士見/旭/中央線 corridors. Compare side-by-side with the reference for density/touch.

- [ ] **Step 4: Commit**

```bash
git add src/cityproto/buildings.js src/cityproto/proto.js
git commit -m "feat(cityproto): low-rise building field with baked vertex-AO shading

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Main avenues as bright overlay lines (not buried)

**Files:**
- Create: `src/cityproto/avenues.js`
- Modify: `src/cityproto/proto.js`

- [ ] **Step 1: Build the avenue lines**

`src/cityproto/avenues.js`:
```js
import * as THREE from '../vendor/three.module.js';
import { terrainHeight, AVENUES } from './geo.js';

// Bright primary roads, slightly lifted off the terrain and rendered last
// (depthTest off) so they never get buried by the carpet — 国立の象徴.
export function buildAvenues({ SCALE = 6, VSCALE = 5, LIFT = 0.012 } = {}) {
  const group = new THREE.Group();
  for (const a of AVENUES) {
    const pts = [];
    const N = 40;
    for (let k = 0; k <= N; k++) {
      const t = k / N, u = a.ax + (a.bx - a.ax) * t, v = a.av + (a.bv - a.av) * t;
      pts.push(new THREE.Vector3(u * SCALE, (terrainHeight(u, v) + LIFT) * VSCALE, (v - 0.3) * SCALE));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: a.bright, depthTest: false });
    const line = new THREE.Line(g, m); line.renderOrder = 10;
    group.add(line);
  }
  return group;
}
```

- [ ] **Step 2: Add avenues to the scene**

In `proto.js`: `import { buildAvenues } from './avenues.js';` then `scene.add(buildAvenues());`.

- [ ] **Step 3: Verify avenues are legible over the carpet**

Run: reload, `preview_screenshot` → 大学通り (vertical from station), 富士見 (down-left, longer), 旭 (down-right, shorter), 中央線 (horizontal) all read as bright continuous lines on top of the carpet, in cleared corridors.

- [ ] **Step 4: Commit**

```bash
git add src/cityproto/avenues.js src/cityproto/proto.js
git commit -m "feat(cityproto): main avenues as bright overlay lines

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 2D overlay — grain, vignette, haze (the final "rendered" touch)

**Files:**
- Create: `src/cityproto/overlay.js`
- Modify: `src/cityproto/proto.js`

- [ ] **Step 1: Build the overlay**

`src/cityproto/overlay.js`:
```js
// 2D canvas drawn over the WebGL canvas: film grain + vignette + top haze.
// This is what tips the image from "CG render" to "rendered photo".
export function makeOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  const grain = document.createElement('canvas'); grain.width = grain.height = 220;
  const gx = grain.getContext('2d'), id = gx.createImageData(220, 220), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = 200 + ((Math.random() * 55) | 0); d[i] = d[i+1] = d[i+2] = n; d[i+3] = 255; }
  gx.putImageData(id, 0, 0);
  function resize() { canvas.width = innerWidth * Math.min(devicePixelRatio, 2); canvas.height = innerHeight * Math.min(devicePixelRatio, 2); canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px'; }
  addEventListener('resize', resize); resize();
  return function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const vg = ctx.createRadialGradient(W*0.5, H*0.46, H*0.25, W*0.5, H*0.5, H*0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    const hz = ctx.createLinearGradient(0, H*0.12, 0, H*0.42);
    hz.addColorStop(0, 'rgba(7,8,10,0.85)'); hz.addColorStop(1, 'rgba(7,8,10,0)');
    ctx.fillStyle = hz; ctx.fillRect(0, H*0.12, W, H*0.30);
    ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = 'overlay';
    for (let y = 0; y < H; y += 220) for (let x = 0; x < W; x += 220) ctx.drawImage(grain, x, y);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };
}
```

- [ ] **Step 2: Drive the overlay from the loop**

In `proto.js`, after the renderer setup:
```js
import { makeOverlay } from './overlay.js';
const drawOverlay = makeOverlay(document.getElementById('ov'));
```
Change `loop()` to:
```js
function loop() { renderer.render(scene, camera); drawOverlay(); requestAnimationFrame(loop); }
```

- [ ] **Step 3: Verify the touch**

Run: reload, `preview_screenshot` at 1280×720 → soft monochrome city with grain, darkened edges, hazed far/top. Place it next to the reference; the *touch* (soft AO field + grain + smooth AA) should now read close. Note remaining gaps (real footprints, true AO) for Plan 2.

- [ ] **Step 4: Commit**

```bash
git add src/cityproto/overlay.js src/cityproto/proto.js
git commit -m "feat(cityproto): 2D grain/vignette/haze overlay — rendered-photo touch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Camera/tone tuning + live knobs, side-by-side with the reference

**Files:**
- Modify: `src/cityproto/proto.js`

- [ ] **Step 1: Expose tuning knobs**

In `proto.js`, add a `params` object and rebuild on change:
```js
const params = { camY: 8.2, camZ: 12.5, fov: 38, lookV: 1.4, hScale: 1.0, grain: 0.05 };
function applyCamera() { camera.fov = params.fov; camera.position.set(0.6, params.camY, params.camZ); camera.lookAt(0.4, 0, params.lookV); camera.updateProjectionMatrix(); }
window.__proto = { ...window.__proto, params, applyCamera };
```
Call `applyCamera()` once at startup. (Knobs are tuned live via the console during verification; a slider UI is Plan 3.)

- [ ] **Step 2: Verify against the reference and tune**

Run: reload, `preview_screenshot`. Adjust `__proto.params` + `__proto.applyCamera()` via `preview_eval` so that: 中央線 horizontal in the upper third, 大学通り descending toward the lower-center, the field filling the frame width, balanced left/right. Capture the final framing.

- [ ] **Step 3: Lock the tuned defaults into `params` and commit**

```bash
git add src/cityproto/proto.js
git commit -m "feat(cityproto): tune camera/tone to the reference framing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Plan 1 portion):** monochrome touch (soft AO + grain + AA) ✓ (Tasks 3,4,6); terrain relief ✓ (Task 3); low-rise dense carpet ✓ (Task 4); main roads legible/non-buried + Fujimi/Asahi asymmetry + balanced density ✓ (Tasks 2,4,5); reference camera ✓ (Task 7). Deferred to later plans (noted in spec): real OSM/DEM + true raycast AO (Plan 2); Scene-framework integration, reveal animation (terrain→roads→buildings→trees), mic reactivity, trees, 旧駅舎 craft, perf, HUD (Plan 3).

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every verify step has a concrete run + expected result. ✓

**Type consistency:** `geo.js` exports (`terrainHeight`, `inHomePlate`, `inGreen`, `AVENUES`, `distToSeg`, `GREEN`) are used with matching signatures across `terrain.js`, `buildings.js`, `avenues.js`; shared world constants (`SCALE=6`, `VSCALE=5`) are passed as options with identical defaults in each builder. ✓

---

## Execution Handoff

After this plan is approved, Plans 2 (offline OSM/DEM + baked-AO baker) and 3 (app integration + reveal + mic reactivity + polish) each get their own spec-confirmation and plan before implementation.
