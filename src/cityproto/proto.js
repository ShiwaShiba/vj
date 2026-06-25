import * as THREE from '../vendor/three.module.js';
import { buildAvenues } from './avenues.js';
import { makeOverlay } from './overlay.js';
import { buildStation, buildRailway } from './station.js';
import { loadCity } from './cityasset.js';

const glCanvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x07080a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const params = { camX: 0, camY: 12, camZ: 8, fov: 47, lookX: 0, lookY: 0, lookV: 0.5 };
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

const drawOverlay = makeOverlay(document.getElementById('ov'));
function loop() { renderer.render(scene, camera); drawOverlay(); requestAnimationFrame(loop); }
loop();

window.__proto = { THREE, scene, camera, renderer, params, applyCamera };

// Swap the procedural city for the baked OSM/DEM/AO asset. Layers are added in
// reveal order (terrain → roads → buildings → trees) so Plan 3's reveal anim
// can drive them; trees arrive in Plan 3.
loadCity('./tools/citybake/dist/city.glb', './tools/citybake/dist/city.manifest.json').then((city) => {
  const { terrain, terrainGrid, buildings, landmark, station, manifest } = city;
  if (terrain) scene.add(terrain);                 // 1. terrain (DEM relief)
  if (terrainGrid) scene.add(terrainGrid);         //    fine lattice baked onto the DEM
  scene.add(buildAvenues(manifest));               // 2. roads (manifest polylines, depthTest off)
  scene.add(buildRailway(manifest));
  if (buildings) scene.add(buildings);             // 3. buildings (real footprints + baked AO)
  if (landmark) scene.add(landmark);
  if (station) scene.add(station);
  scene.add(buildStation(manifest));               // station glow accent (runtime canvas texture)
  window.__proto.city = city;
  window.__proto.manifest = manifest;
}).catch((e) => console.error('city load failed', e));
