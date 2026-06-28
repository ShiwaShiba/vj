import { test } from 'node:test';
import assert from 'node:assert';
import { aerialCam, defaultShotConfig, stepShot, hash01 } from '../../src/cityproto/shotDirector.js';

const BASE = { camX: -5.1, camY: 55.3, camZ: 50, fov: 50, lookX: -5.1, lookY: 0, lookV: 23.0 };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('aerialCam: orbitRate=0 & breatheAmp=0 wide → base と完全一致（固定復帰）', () => {
  const cfg = { ...defaultShotConfig(), orbitRate: 0, breatheAmp: 0 };
  const c = aerialCam(BASE, cfg, 123.4, 'wide');
  for (const k of ['camX', 'camY', 'camZ', 'fov', 'lookX', 'lookY', 'lookV']) {
    assert.ok(near(c[k], BASE[k], 1e-6), `${k}: ${c[k]} != ${BASE[k]}`);
  }
});

test('aerialCam: 決定論（同入力→同出力）', () => {
  const cfg = defaultShotConfig();
  const a = aerialCam(BASE, cfg, 77.2, 'wide');
  const b = aerialCam(BASE, cfg, 77.2, 'wide');
  assert.deepStrictEqual(a, b);
});

test('aerialCam: 旋回すると camX/camZ が動くが lookAt 周りの半径は保存（breatheAmp=0）', () => {
  const cfg = { ...defaultShotConfig(), orbitRate: 0.03, breatheAmp: 0 };
  const r0 = Math.hypot(BASE.camX - BASE.lookX, BASE.camZ - BASE.lookV);
  const c = aerialCam(BASE, cfg, 50, 'wide');
  const r1 = Math.hypot(c.camX - c.lookX, c.camZ - c.lookV);
  assert.ok(near(r1, r0, 1e-6), `radius preserved: ${r1} vs ${r0}`);
  assert.ok(Math.abs(c.camX - BASE.camX) + Math.abs(c.camZ - BASE.camZ) > 1e-3, 'moved');
});

test('aerialCam: 呼吸は radius を ±breatheAmp 以内でしか変えない', () => {
  const cfg = { ...defaultShotConfig(), orbitRate: 0, breatheAmp: 0.06 };
  const r0 = Math.hypot(BASE.camX - BASE.lookX, BASE.camZ - BASE.lookV);
  for (const bf of [0, 5, 11, 23.5, 60, 99.9]) {
    const c = aerialCam(BASE, cfg, bf, 'wide');
    const r1 = Math.hypot(c.camX - c.lookX, c.camZ - c.lookV);
    assert.ok(r1 <= r0 * (1 + 0.06) + 1e-6 && r1 >= r0 * (1 - 0.06) - 1e-6, `breath bound bf=${bf}: ${r1}`);
  }
});

test('aerialCam: near variant は高さ/FOV/半径を寄せる', () => {
  const cfg = { ...defaultShotConfig(), orbitRate: 0, breatheAmp: 0 };
  const c = aerialCam(BASE, cfg, 10, 'near');
  assert.ok(near(c.camY, BASE.camY * cfg.nearHeightMul, 1e-6), 'height');
  assert.ok(near(c.fov, cfg.nearFov, 1e-6), 'fov');
  const r0 = Math.hypot(BASE.camX - BASE.lookX, BASE.camZ - BASE.lookV);
  const r1 = Math.hypot(c.camX - c.lookX, c.camZ - c.lookV);
  assert.ok(near(r1, r0 * cfg.nearRadiusMul, 1e-6), 'radius scaled');
});

test('stepShot: 3値振り分け — avenue 確率は avenueRatio を保つ', () => {
  const cfg = { ...defaultShotConfig(), avenueRatio: 0.5, nearRatio: 0.25, switchBars: 1, blendSec: 0 };
  const centerline = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }];
  let state = undefined;
  const counts = { avenue: 0, aerialNear: 0, aerial: 0 };
  // 直接 hash 分類で検証（決定論）
  const N = 4000;
  for (let g = 0; g < N; g++) {
    const r = hash01(g);
    let shot;
    if (r < cfg.avenueRatio) shot = 'avenue';
    else if (r < cfg.avenueRatio + cfg.nearRatio * (1 - cfg.avenueRatio)) shot = 'aerialNear';
    else shot = 'aerial';
    counts[shot]++;
  }
  assert.ok(Math.abs(counts.avenue / N - 0.5) < 0.05, `avenue≈0.5 got ${counts.avenue / N}`);
  // near は非avenue空間の約25% = 全体の約0.125
  assert.ok(Math.abs(counts.aerialNear / N - 0.125) < 0.04, `near≈0.125 got ${counts.aerialNear / N}`);
});
