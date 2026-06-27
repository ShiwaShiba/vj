import assert from 'node:assert';
import { test } from 'node:test';
import {
  hash01, defaultShotConfig, initShotState, stepShot, createShotDirector,
} from '../../src/cityproto/shotDirector.js';

// a synthetic 並木 centerline: straight line at X≈0, Z south(20)→north(0), gentle ground
const LINE = Array.from({ length: 21 }, (_, i) => ({ x: 0, y: 0.1, z: 20 - i }));
const BASE = { camX: -5.1, camY: 55.3, camZ: 50, fov: 50, lookX: -5.1, lookY: 0, lookV: 16.8 };
const CFG = (o = {}) => ({ ...defaultShotConfig(), ...o });
const bf = (beatsFloat) => ({ beatsFloat });

test('hash01 is deterministic and in [0,1)', () => {
  assert.strictEqual(hash01(7), hash01(7));
  for (const n of [0, 1, 2, 99, 1234]) { const h = hash01(n); assert.ok(h >= 0 && h < 1); }
  assert.notStrictEqual(hash01(0), hash01(1)); // mixes
});

test('disabled / no centerline → base passes straight through', () => {
  const off = stepShot(initShotState(), BASE, bf(10), 0.016, CFG({ enabled: false }), LINE);
  assert.deepStrictEqual(off.cam, BASE);
  const noLine = stepShot(initShotState(), BASE, bf(10), 0.016, CFG(), null);
  assert.deepStrictEqual(noLine.cam, BASE);
});

test('avenueRatio=0 is always 俯瞰 (passthrough); =1 is always アップ (low fly)', () => {
  // ratio 0: every group resolves to aerial → cam equals base after the blend settles
  let s = initShotState();
  for (let b = 0; b < 64; b++) { const r = stepShot(s, BASE, bf(b), 1.0, CFG({ avenueRatio: 0, blendSec: 0 }), LINE); s = r.state; assert.strictEqual(s.shot, 'aerial'); assert.deepStrictEqual(r.cam, BASE); }
  // ratio 1: always avenue → camera sits low (near ground+lowHeight), avenue fov
  let s2 = initShotState();
  const cfg = CFG({ avenueRatio: 1, blendSec: 0, lowHeight: 2.6 });
  const r = stepShot(s2, BASE, bf(9), 1.0, cfg, LINE);
  assert.strictEqual(r.state.shot, 'avenue');
  assert.strictEqual(r.cam.fov, cfg.avenueFov);
  assert.ok(r.cam.camY < 5, `avenue cam should be low, got camY=${r.cam.camY}`);
  assert.ok(Math.abs(r.cam.camY - (0.1 + cfg.lowHeight)) < 1.0);
});

test('switching is quantised to bars (no change within a bar-group)', () => {
  const cfg = CFG({ switchBars: 2, barBeats: 4, blendSec: 0 }); // group = 8 beats
  let s = initShotState();
  // step across beats 0..7 (one group): shot decided at entry, stable through the group
  let first = null;
  for (let b = 0; b < 8; b++) { const r = stepShot(s, BASE, bf(b + 0.5), 0.1, cfg, LINE); s = r.state; if (first === null) first = s.shot; assert.strictEqual(s.group, 0); assert.strictEqual(s.shot, first); }
  // crossing into beats 8.. is a new group (may pick a different shot, but group advances)
  const r2 = stepShot(s, BASE, bf(8.5), 0.1, cfg, LINE); assert.strictEqual(r2.state.group, 1);
});

test('blendSec=0 is an instant cut; blendSec>0 eases through intermediate frames', () => {
  const line = LINE;
  // force an aerial→avenue switch at group 1 boundary by choosing a ratio that picks avenue there
  // (we assert mechanics, not which shot: compare cut vs eased at the same instant past a switch)
  const cfgCut = CFG({ blendSec: 0, avenueRatio: 1, switchBars: 1 });
  const cfgEase = CFG({ blendSec: 0.5, avenueRatio: 1, switchBars: 1 });
  // prime both with a known fromCam by stepping one group as aerial first
  const aer = CFG({ blendSec: 0, avenueRatio: 0, switchBars: 1 });
  let sCut = stepShot(initShotState(), BASE, bf(0.5), 0.1, aer, line).state;
  let sEase = stepShot(initShotState(), BASE, bf(0.5), 0.1, aer, line).state;
  // now cross into group 1 (avenue). Cut → already at target; ease → partway.
  const cut = stepShot(sCut, BASE, bf(4.5), 0.05, cfgCut, line);
  const ease = stepShot(sEase, BASE, bf(4.5), 0.05, cfgEase, line); // t-blendStart=0.05 of 0.5 → ~0.1
  // cut camY should equal the avenue target; ease camY should still be near BASE (just left aerial)
  assert.ok(Math.abs(ease.cam.camY - BASE.camY) < Math.abs(cut.cam.camY - BASE.camY), 'ease lags the cut');
  assert.ok(cut.cam.camY < 5, 'cut lands on the low avenue cam immediately');
});

test('blendSec is comfort-capped to maxBlendSec (no runaway slow sweep)', () => {
  const cfg = CFG({ blendSec: 99, maxBlendSec: 1.2, avenueRatio: 1, switchBars: 1 });
  // after maxBlendSec seconds past a switch the blend must be complete (==1)
  let s = stepShot(initShotState(), BASE, bf(0.5), 0.1, CFG({ avenueRatio: 0, switchBars: 1 }), LINE).state;
  s = stepShot(s, BASE, bf(4.5), 0.001, cfg, LINE).state; // enter avenue group, blendStart set
  const done = stepShot(s, BASE, bf(4.6), 1.3, cfg, LINE); // 1.3s later > cap
  const target = stepShot(initShotState(), BASE, bf(4.6), 1.0, CFG({ blendSec: 0, avenueRatio: 1, switchBars: 1 }), LINE);
  assert.ok(Math.abs(done.cam.camY - target.cam.camY) < 0.5, 'blend completed by the cap');
});

test('avenue fly travels forward over musical time (phase advances, stays on the line)', () => {
  const cfg = CFG({ avenueRatio: 1, blendSec: 0, switchBars: 8, travelBars: 16 });
  // same group (so shot/entry fixed), advance beatsFloat → eye Z should move monotonically
  let s = stepShot(initShotState(), BASE, bf(0.0), 0.0, cfg, LINE).state;
  const z0 = stepShot(s, BASE, bf(0.0), 0.0, cfg, LINE).cam.camZ;
  const z1 = stepShot(s, BASE, bf(4.0), 0.0, cfg, LINE).cam.camZ;
  assert.notStrictEqual(z0, z1); // it moves
  // stays within the avenue Z span (with the small lateral/height offset, X stays ~0)
  const c = stepShot(s, BASE, bf(2.0), 0.0, cfg, LINE).cam;
  assert.ok(c.camZ >= -2 && c.camZ <= 22, `eye Z within avenue span, got ${c.camZ}`);
});

test('determinism: two identical runs are byte-identical', () => {
  const run = () => { let s = initShotState(); const out = []; for (let b = 0; b < 40; b++) { const r = stepShot(s, BASE, bf(b * 0.5), 0.05, CFG(), LINE); s = r.state; out.push(r.cam); } return out; };
  assert.deepStrictEqual(run(), run());
});

test('createShotDirector wrapper mutates cam in place and respects setConfig', () => {
  const sd = createShotDirector(LINE, { avenueRatio: 0 });
  const cam = { ...BASE };
  sd.apply(cam, bf(1), 0.016);
  assert.deepStrictEqual(cam, BASE); // ratio 0 → passthrough
  sd.setConfig({ avenueRatio: 1, blendSec: 0, switchBars: 1 });
  const cam2 = { ...BASE };
  sd.apply(cam2, bf(8), 1.0);
  assert.ok(cam2.camY < 5, 'after setConfig the wrapper produces the low avenue cam');
});
