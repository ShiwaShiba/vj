import * as THREE from '../vendor/three.module.js';
import { buildAvenues } from './avenues.js';
import { makeOverlay } from './overlay.js';
import { buildStation, buildRailway } from './station.js';
import { buildTrees } from './trees.js';
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
  state: () => ({ tSec, paused, parallax }),
};

// Swap the procedural city for the baked OSM/DEM/AO asset. Layers are added in
// reveal order (terrain → roads → buildings → trees) so Plan 3's reveal anim
// can drive them.
loadCity('./tools/citybake/dist/city.glb', './tools/citybake/dist/city.manifest.json').then((city) => {
  const { terrain, terrainGrid, buildings, landmark, station, manifest } = city;
  if (terrain) scene.add(terrain);                 // 1. terrain (DEM relief) — always visible (the stage)
  if (terrainGrid) scene.add(terrainGrid);         //    fine lattice baked onto the DEM (reveals in)
  const avenuesGroup = buildAvenues(manifest); scene.add(avenuesGroup); // 2. roads (manifest polylines)
  const railGroup = buildRailway(manifest); scene.add(railGroup);
  if (buildings) scene.add(buildings);             // 3. buildings (real footprints + baked AO)
  if (buildings) reveal = installReveal(THREE, buildings, manifest.buildings); // ripple from the station
  if (landmark) scene.add(landmark);
  if (station) scene.add(station);
  scene.add(buildStation(manifest));               // station glow accent (runtime canvas texture)
  let trees = null;
  if (terrain) { trees = buildTrees(manifest, terrain); scene.add(trees); } // 4. 木々 (green zones + 大学通り 並木)

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
  const keyframes = makeKeyframes({ full: { ...params }, landmark: landmarkW, station: stationW });
  director = createDirector({ keyframes });

  // Intro reveals: the 格子 lattice fades up, then the roads electrify (the symbolic
  // white avenues + 中央線 lead, the grey network fills behind them).
  const roadMaterials = [];
  for (const g of [avenuesGroup, railGroup]) g.traverse((o) => {
    if (o.material) roadMaterials.push({ material: o.material, phase: o.renderOrder <= 6 ? 0.35 : 0.0 });
  });
  intro = installIntroLayers({ gridMaterials: terrainGrid ? [terrainGrid.material] : [], roadMaterials });

  window.__proto.city = city;
  window.__proto.trees = trees;
  window.__proto.manifest = manifest;
  window.__proto.director = director;
  window.__proto.reveal = reveal;
  window.__proto.intro = intro;
  window.__proto.keyframes = keyframes;
}).catch((e) => console.error('city load failed', e));

// Tuning controls (city-proto stage): dial 緩急 by looking. Later → ControlPanel.
addEventListener('keydown', (e) => {
  if (e.key === ' ') { paused = !paused; e.preventDefault(); }       // freeze / resume clock
  else if (e.key === '[') { tSec = Math.max(0, tSec - 1.0); }        // scrub back 1s
  else if (e.key === ']') { tSec += 1.0; }                            // scrub forward 1s
  else if (e.key === 'p' || e.key === 'P') { parallax = !parallax; } // straight dolly ↔ micro-parallax
});
