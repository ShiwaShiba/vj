import * as THREE from '../vendor/three.module.js';
import { buildTerrain, buildTerrainGrid } from './terrain.js';
import { buildBuildings } from './buildings.js';
import { buildAvenues } from './avenues.js';
import { makeOverlay } from './overlay.js';
import { buildStation, buildRailway } from './station.js';

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

scene.add(buildTerrain());
scene.add(buildTerrainGrid());
const city = buildBuildings();
scene.add(city.solid);
scene.add(city.wire);
scene.add(buildAvenues());
scene.add(buildRailway());
scene.add(buildStation());

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
