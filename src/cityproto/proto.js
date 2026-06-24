import * as THREE from '../vendor/three.module.js';
import { buildTerrain, buildTerrainGrid } from './terrain.js';
import { buildBuildings } from './buildings.js';
import { buildAvenues } from './avenues.js';
import { makeOverlay } from './overlay.js';

const glCanvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x07080a, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0.6, 8.2, 12.5);
camera.lookAt(0.4, 0, 1.4);

scene.add(buildTerrain());
scene.add(buildTerrainGrid());
scene.add(buildBuildings());
scene.add(buildAvenues());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const drawOverlay = makeOverlay(document.getElementById('ov'));

function loop() { renderer.render(scene, camera); drawOverlay(); requestAnimationFrame(loop); }
loop();

window.__proto = { THREE, scene, camera, renderer };
