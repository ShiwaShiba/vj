import * as THREE from '../vendor/three.module.js';
import { buildAvenues } from './avenues.js';
import { makeOverlay } from './overlay.js';
import { buildStation, buildRailway } from './station.js';
import { planLayout, buildTrees } from './trees.js';
import { planEmit, buildParticles } from './particles.js';
import { setChromaVariant } from './seasons.js';
import { loadCity } from './cityasset.js';
import { makeKeyframes } from './camrig.js';
import { createDirector } from './director.js';
import { installReveal } from './reveal.js';
import { installIntroLayers } from './intro.js';

const glCanvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x07080a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const params = { camX: -5.1, camY: 55.3, camZ: 50, fov: 50, lookX: -5.1, lookY: 0, lookV: 16.8 }; // ④ 国立市全域フレーミング
function applyCamera() {
  camera.fov = params.fov;
  camera.position.set(params.camX, params.camY, params.camZ);
  camera.lookAt(params.lookX, params.lookY, params.lookV);
  camera.updateProjectionMatrix();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize(); applyCamera();

// --- Plan 3 reveal director (camera + building ripple; season leg wires in later) ---
let director = null;     // set once the city + keyframes exist
let reveal = null;       // building ripple controller (installReveal)
let intro = null;        // terrain-lattice + road opacity reveals (installIntroLayers)
let tSec = 0;            // director clock (seconds) — scrubbable
let last = null;         // perf timestamp of the previous frame
let paused = false;      // freeze the clock to inspect a framing
let parallax = false;    // straight dolly (false) vs micro-parallax (true), A/B by looking
let trees = null;        // seasonal 並木 controller (buildTrees → {group, update, setMode})
let particles = null;    // falling petals/leaves/snow along the 並木 (buildParticles → {points, update})
let mode = 0;            // 0 = monochrome (step-4 default); 1 = chroma (step-6 C key)
let strobeEnabled = false; // 冬 white strobe gate (S key). Default OFF (光感受性 safety)

// Live-tuning state (step 6). Initial values reproduce the current look EXACTLY — they
// only move when a window.__proto setter fires (no on-screen HUD yet; that lands at
// SceneManager integration). Kept at module scope so the rebuild helpers can reach them.
let terrainRef = null;     // DEM mesh, kept for particle rebuilds (setPetals)
let manifestRef = null;    // baked manifest, kept for the rebuilds
let kfInputs = null;       // {full,landmark,station} snapshot for keyframe rebuilds
let petalOpts = { perColumn: 7, stride: 1 }; // emit density (live via setPetals)
let framingOpts = {};      // camrig DEF overrides (live via setFraming); {} = DEF
let timingOpts = {};       // director DEFAULTS overrides (live via setTiming); {} = DEFAULTS
const fallDist = 0.32;     // canopy-height fall distance (step5 visual tune)

const drawOverlay = makeOverlay(document.getElementById('ov'));
function loop(now) {
  if (director) {
    if (last === null) last = now;
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!paused) tSec += dt;
    const f = director.update(tSec, { parallax });
    Object.assign(params, f.cam);
    applyCamera();
    if (reveal) reveal.setProgress(f.reveal.buildings); // intro ripple; latches at 1
    if (intro) { intro.setTerrain(f.reveal.terrain); intro.setRoads(f.reveal.roads); } // 格子 → 通電
    if (trees) trees.update(f.season, mode, dt, { strobe: strobeEnabled }); // 並木 seasons + 冬 strobe
    if (particles) particles.update(f.season, mode, dt); // 花びら/落ち葉/雪 (GPU fall, sweep-synced)
  }
  renderer.render(scene, camera);
  drawOverlay();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.__proto = {
  THREE, scene, camera, renderer, params, applyCamera,
  seek: (t) => { tSec = Math.max(0, t); },          // jump the director clock (seconds)
  setPaused: (b) => { paused = !!b; },
  setParallax: (b) => { parallax = !!b; },
  setMode: (b) => { mode = b ? 1 : 0; },            // 0 mono / 1 chroma (also the C key)
  setStrobe: (b) => { strobeEnabled = !!b; },        // 冬 white strobe gate (also the S key)
  // step 6 live-tuning knobs (no HUD yet). Initial state == the current look.
  setChromaVariant: (name) => setChromaVariant(name),         // swap chroma register (look-pick)
  setStrobeRate: (hz) => { if (trees) trees.uniforms.uStrobeRate.value = Math.max(0, Math.min(3, hz)); }, // ≤3Hz (守る線)
  setPetals: (partial) => { Object.assign(petalOpts, partial); rebuildParticles(); },   // particle emit density
  setTiming: (partial) => { Object.assign(timingOpts, partial); rebuildDirector(); },   // director 緩急 overrides
  setFraming: (partial) => { Object.assign(framingOpts, partial); rebuildDirector(); }, // camrig framing overrides
  state: () => ({ tSec, paused, parallax, mode, strobeEnabled }),
};

// Rebuild helpers for the live knobs. Both reuse the pure planners + THREE builders and
// neither resets the director clock (tSec), so tuning is seamless. No-op until the city loads.
function rebuildParticles() {
  if (!particles || !terrainRef || !manifestRef) return;
  scene.remove(particles.points);
  particles.points.geometry.dispose();
  particles.points.material.dispose();
  const { avenue } = planLayout(manifestRef);
  particles = buildParticles(planEmit(avenue, petalOpts), terrainRef, manifestRef, { renderer, fallDist });
  scene.add(particles.points);
  window.__proto.particles = particles;
}
function rebuildDirector() {
  if (!kfInputs) return;
  const keyframes = makeKeyframes(kfInputs, framingOpts);
  director = createDirector({ keyframes, tuning: timingOpts });
  window.__proto.director = director;
  window.__proto.keyframes = keyframes;
}

// Swap the procedural city for the baked OSM/DEM/AO asset. Layers are added in
// reveal order (terrain → roads → buildings → trees) so Plan 3's reveal anim
// can drive them.
loadCity('./tools/citybake/dist/city.glb', './tools/citybake/dist/city.manifest.json').then((city) => {
  const { terrain, terrainGrid, buildings, landmark, station, manifest } = city;
  terrainRef = terrain; manifestRef = manifest;    // keep for the live-tuning rebuilds (setPetals/setFraming/setTiming)
  if (terrain) scene.add(terrain);                 // 1. terrain (DEM relief) — always visible (the stage)
  if (terrainGrid) scene.add(terrainGrid);         //    fine lattice baked onto the DEM (reveals in)
  const avenuesGroup = buildAvenues(manifest); scene.add(avenuesGroup); // 2. roads (manifest polylines)
  const railGroup = buildRailway(manifest); scene.add(railGroup);
  if (buildings) scene.add(buildings);             // 3. buildings (real footprints + baked AO)
  if (buildings) reveal = installReveal(THREE, buildings, manifest.buildings); // ripple from the station
  if (landmark) scene.add(landmark);
  if (station) scene.add(station);
  scene.add(buildStation(manifest));               // station glow accent (runtime canvas texture)
  if (terrain) { trees = buildTrees(manifest, terrain); scene.add(trees.group); } // 4. 木々 (green zones + 大学通り 並木, seasonal)
  if (terrain) {                                    // 5. falling particles along the 並木 (reuse the avenue layout)
    const { avenue } = planLayout(manifest);        // pure + deterministic → byte-identical to buildTrees' avenue
    particles = buildParticles(planEmit(avenue, petalOpts), terrain, manifest, { renderer, fallDist });
    scene.add(particles.points);
  }

  // Keyframes: ④ = the current full-city params; ① is the 旧駅舎 (landmark) hero.
  const { SCALE, VSCALE, vOffset } = manifest.scale;
  const s = manifest.station || { u: 0, v: 0, h: 0 };
  const stationW = { x: s.u * SCALE, z: (s.v - vOffset) * SCALE };
  let landmarkW = { x: stationW.x, y: 0, z: stationW.z };       // fallback: station
  if (landmark) {
    landmark.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(landmark).getCenter(new THREE.Vector3());
    landmarkW = { x: c.x, y: c.y, z: c.z };
  }
  kfInputs = { full: { ...params }, landmark: landmarkW, station: stationW }; // snapshot ④ before the loop mutates params
  rebuildDirector();                               // builds keyframes + director from kfInputs / framingOpts / timingOpts

  // Intro reveals: the 格子 lattice fades up, then the roads electrify (the symbolic
  // white avenues + 中央線 lead, the grey network fills behind them).
  const roadMaterials = [];
  for (const g of [avenuesGroup, railGroup]) g.traverse((o) => {
    if (o.material) roadMaterials.push({ material: o.material, phase: o.renderOrder <= 6 ? 0.35 : 0.0 });
  });
  intro = installIntroLayers({ gridMaterials: terrainGrid ? [terrainGrid.material] : [], roadMaterials });

  window.__proto.city = city;
  window.__proto.trees = trees;
  window.__proto.particles = particles;
  window.__proto.manifest = manifest;
  window.__proto.reveal = reveal;
  window.__proto.intro = intro;
}).catch((e) => console.error('city load failed', e));

// Tuning controls (city-proto stage): dial 緩急 by looking. Later → ControlPanel.
addEventListener('keydown', (e) => {
  if (e.key === ' ') { paused = !paused; e.preventDefault(); }       // freeze / resume clock
  else if (e.key === '[') { tSec = Math.max(0, tSec - 1.0); }        // scrub back 1s
  else if (e.key === ']') { tSec += 1.0; }                            // scrub forward 1s
  else if (e.key === 'p' || e.key === 'P') { parallax = !parallax; } // straight dolly ↔ micro-parallax
  else if (e.key === 'c' || e.key === 'C') { mode = mode ? 0 : 1; }  // mono ↔ chroma 季節色 (step 6; ~0.6s ease)
  else if (e.key === 's' || e.key === 'S') { strobeEnabled = !strobeEnabled; } // 冬 white strobe (default off)
});
