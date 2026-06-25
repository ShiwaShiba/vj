import * as THREE from '../vendor/three.module.js';

// The station landmark accent: a restrained white glow node at the apex (the
// solid station box itself now comes from the baked glb 'station' node). A
// single accent matching the reference's glowing station — NOT bloom everywhere.
export function buildStation(manifest) {
  const { SCALE, VSCALE, vOffset } = manifest.scale;
  const grp = new THREE.Group();
  const s = manifest.station;
  if (!s) return grp;
  const wx = s.u * SCALE, wz = (s.v - vOffset) * SCALE, wy = (s.h || 0) * VSCALE;

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

// JR Chuo Line: crisp bright double track + a faint center line, built from the
// manifest's horizontal chuo polyline, lifted and drawn on top so it reads as a
// sharp horizontal axis.
export function buildRailway(manifest, { lift = 0.014, gauge = 0.017 } = {}) {
  const { SCALE, VSCALE, vOffset } = manifest.scale;
  const grp = new THREE.Group();
  const chuo = manifest.roads.find((r) => r.name === 'chuo');
  if (!chuo) return grp;
  const mk = (dv, op, ro) => {
    const pts = chuo.points.map(([u, v, h]) => new THREE.Vector3(u * SCALE, (h + lift) * VSCALE, (v + dv - vOffset) * SCALE));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op, depthTest: false }));
    l.renderOrder = ro; return l;
  };
  grp.add(mk(-gauge, 0.95, 12));
  grp.add(mk(gauge, 0.95, 12));
  grp.add(mk(0, 0.22, 11));
  return grp;
}
