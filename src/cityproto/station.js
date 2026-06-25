import * as THREE from '../vendor/three.module.js';
import { terrainHeight } from './geo.js';

// The station landmark: a small bright structure at the apex + a restrained
// white glow node (single accent, matching the reference's glowing station —
// NOT decorative bloom everywhere). 旧駅舎 craft comes in Plan 2/3.
export function buildStation({ SCALE = 6, VSCALE = 5 } = {}) {
  const grp = new THREE.Group();
  const wx = 0, wz = (0 - 0.3) * SCALE, wy = terrainHeight(0, 0) * VSCALE;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.55, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xe8edf4 }),
  );
  box.position.set(wx, wy + 0.275, wz);
  grp.add(box);

  const c = document.createElement('canvas'); c.width = c.height = 128;
  const gx = c.getContext('2d'); const gr = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.32, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, depthTest: false,
  }));
  spr.position.set(wx, wy + 0.5, wz); spr.scale.set(2.6, 2.6, 1); spr.renderOrder = 20;
  grp.add(spr);
  return grp;
}

// JR Chuo Line: crisp bright double track + a faint center line, lifted and
// drawn on top so it reads as a sharp horizontal axis.
export function buildRailway({ SCALE = 6, VSCALE = 5, LIFT = 0.014 } = {}) {
  const grp = new THREE.Group();
  const mkLine = (vv, op, ro) => {
    const pts = [];
    for (let k = 0; k <= 60; k++) { const u = -1.75 + 3.5 * (k / 60); pts.push(new THREE.Vector3(u * SCALE, (terrainHeight(u, vv) + LIFT) * VSCALE, (vv - 0.3) * SCALE)); }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op, depthTest: false }));
    l.renderOrder = ro; return l;
  };
  grp.add(mkLine(-0.118, 0.95, 12));
  grp.add(mkLine(-0.152, 0.95, 12));
  grp.add(mkLine(-0.135, 0.22, 11));
  return grp;
}
