# WebGL「Noise Orb」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参照 `vj-blob.html` 品質（Three.js・140k GPU点・AdditiveBlending・UnrealBloom・simplex FBM5oct＋Worley）を、決定論・モノクロ・帯域別音反応の独立WebGLシーン **「Noise Orb」**（id `orb`）として本体VJに統合する。

**Architecture:** CityScene 同型の opacity 合成パターン。専用 `<canvas id="orb-gl">` に THREE.WebGLRenderer を遅延生成し、毎フレーム composer(RenderPass→UnrealBloomPass) で描画、`draw(ctx,alpha)` で `canvas.style.opacity=alpha`。ロジックは3層に分離: PURE な `orbDrive.js`（幾何生成＋音→uniform写像＋バースト/sweep時間発展・ユニットテスト対象） / THREE を所有する `orbCore.js`（GLSL＋composer） / `Scene` アダプタ `OrbScene.js`。

**Tech Stack:** Vanilla JS ES Modules・vendored three r160（`src/vendor/three.module.js`）・vendored three-addons postprocessing（新規同梱・importmap 解決）・GLSL ShaderMaterial・Canvas2D エンジンと共存・依存追加なし。

## Global Constraints（全タスク共通・spec §4 逐語）

- **決定論:** `src/` 配下の実行時コードに `Math.random` / `Date` / `performance.now` **禁止**。per-point シードは整数ハッシュ（`hash01`）、時刻は `clock.time` のみ。（vendored three 内部は視覚再現に無影響のため対象外。UnrealBloom の gauss カーネルは固定値で乱数非依存。）
- **モノクロ:** 白 on 黒のみ（`palette.fg`）。色・虹グロー**禁止**。カラースウォッチ不採用。
- **依存ゼロ:** npm 依存追加なし。addon の vendoring は依存追加ではない（three 本体・GLTFLoader と同じ同梱方式）。
- **加算 / 非機械的モーション:** `AdditiveBlending`。動きは有機的・非等速・継ぎ目なし。
- **音反応は強く明確に:** 3帯域（BASS スウェル＋キックバースト / MID 走る光front / TREBLE 微粒シマー）が視覚的に判別できる。
- **本番デプロイは明示承認後のみ。** 素URL（クエリ無し）で検証。`CACHE_VERSION` v46→v47。
- **視覚は実物スクショ確認してから「できた」と言う**（未検証の「直った」は厳禁）。
- **ブランチ:** 作業は既存の `feat/webgl-noise-orb`（`d3f6012` にspecコミット済）上で行う。main 直編集しない。

## 発見した実装現実（spec からの補正）

1. **importmap が既にある** → `index.html` に `{"three":"./src/vendor/three.module.js","three/addons/":"./src/vendor/three-addons/"}`。`cityasset.js` が `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'` で解決している。**よって vendored bloom addon の import 指定子パッチは不要**（spec §5.2/§12 は patch を示唆したが、importmap で `from 'three'` も `from 'three/addons/…'` も解決される）。addon は r160 から**無改変**で配置し、`orbCore.js` は bare `three/addons/postprocessing/…` で import する。
2. **vendored three は r160**（`const REVISION = '160'`）＝参照の `three@0.160.0` と完全一致。addon も r160 を採る。
3. **SW ASSETS は precache リストで網羅ではない**（network-first）。`CityScene.js`・`src/cityproto/*`・`three.module.js`・`three-addons/*` は ASSETS に**無い**が動く。よって orb でも deploy 時の必須アクションは `CACHE_VERSION` bump のみ。ASSETS 追記はオフライン完全性のため任意で行う（下記デプロイ節）。
4. **scene 選択 API:** `window.__vj.scenes.start('orb')` / `window.__vj.scenes.byId['orb']`（`SceneManager.start(id)` は `byId` 参照）。
5. **params は onChange 不要:** `OrbScene.update()` が毎フレーム `this.p(key)` を読んで `setUniforms` へ push する（CityScene の imperative setter と違い、orb は uniform を毎フレーム同期する）。base `Scene.defineParam(key,value,min,max,step,label)` をそのまま使う。
6. **テスト実行:** `npm test`（= `node --test`、`tests/**/*.test.mjs` を自動発見）。個別は `node --test tests/scenes/orb/orbDrive.test.mjs`。

## ファイル構成

- **NEW** `src/vendor/three-addons/postprocessing/{Pass,EffectComposer,RenderPass,ShaderPass,MaskPass,UnrealBloomPass}.js`（r160 無改変）
- **NEW** `src/vendor/three-addons/shaders/{CopyShader,LuminosityHighPassShader}.js`（r160 無改変）
- **NEW** `src/scenes/orb/orbDrive.js`（PURE・THREE非依存・テスト対象）
- **NEW** `src/scenes/orb/orbCore.js`（THREE 所有・GLSL・composer）
- **NEW** `src/scenes/orb/OrbScene.js`（`Scene` アダプタ）
- **EDIT** `index.html`（`<canvas id="orb-gl">` 1枚＋CSS セレクタ拡張）
- **EDIT** `src/scenes/registry.js`（import＋配列に1行）
- **NEW(test)** `tests/scenes/orb/vendor.test.mjs`（addon 同梱の構造チェック）
- **NEW(test)** `tests/scenes/orb/orbDrive.test.mjs`（PURE 関数の決定論・境界・単調性）
- **EDIT(deploy時のみ)** `sw.js`（`CACHE_VERSION` v46→v47・任意で ASSETS 追記）

## タスク依存順（並列可）

`{T1, T2} → T3 → T4 → T5 → T6 → T7`。T1 と T2 は独立（並列可）。T3 は T1(addon)＋T2(orbDrive) の両方に依存。

---

### Task 1: Vendor the UnrealBloom postprocessing addons (r160)

**Files:**
- Create: `src/vendor/three-addons/postprocessing/Pass.js`
- Create: `src/vendor/three-addons/postprocessing/EffectComposer.js`
- Create: `src/vendor/three-addons/postprocessing/RenderPass.js`
- Create: `src/vendor/three-addons/postprocessing/ShaderPass.js`
- Create: `src/vendor/three-addons/postprocessing/MaskPass.js`
- Create: `src/vendor/three-addons/postprocessing/UnrealBloomPass.js`
- Create: `src/vendor/three-addons/shaders/CopyShader.js`
- Create: `src/vendor/three-addons/shaders/LuminosityHighPassShader.js`
- Test: `tests/scenes/orb/vendor.test.mjs`

**Interfaces:**
- Consumes: nothing (leaf task). Existing importmap `"three/addons/": "./src/vendor/three-addons/"`.
- Produces: modules importable as `three/addons/postprocessing/EffectComposer.js`, `three/addons/postprocessing/RenderPass.js`, `three/addons/postprocessing/UnrealBloomPass.js`. `EffectComposer(renderer)`, `RenderPass(scene,camera)`, `UnrealBloomPass(Vector2, strength, radius, threshold)`. T3 imports these three by name.

**Why no patching:** the r160 addon files import `from 'three'` and relative `./Pass.js` / `../shaders/CopyShader.js`. The existing importmap resolves `three` and `three/addons/`, so the files work **unmodified** — same as the already-vendored `GLTFLoader.js` which keeps `} from 'three';`.

- [ ] **Step 1: Fetch the 8 addon files from unpkg r160 (unmodified) into the vendor tree**

Create the two directories and download each file verbatim. unpkg r160 is reachable (verified: HTTP 200). Run from repo root:

```bash
mkdir -p src/vendor/three-addons/postprocessing src/vendor/three-addons/shaders
BASE="https://unpkg.com/three@0.160.0/examples/jsm"
for f in postprocessing/Pass.js postprocessing/EffectComposer.js postprocessing/RenderPass.js \
         postprocessing/ShaderPass.js postprocessing/MaskPass.js postprocessing/UnrealBloomPass.js \
         shaders/CopyShader.js shaders/LuminosityHighPassShader.js; do
  curl -fsSL "$BASE/$f" -o "src/vendor/three-addons/$f"
done
```

If `curl` is unavailable, use WebFetch on each `https://unpkg.com/three@0.160.0/examples/jsm/<path>` URL and Write the returned body verbatim to the corresponding vendor path. Do **not** hand-edit the files — they must stay byte-identical to r160 so the API matches.

- [ ] **Step 2: Sanity-check the download and the import graph**

Run: `head -5 src/vendor/three-addons/postprocessing/UnrealBloomPass.js && grep -n "from 'three'" src/vendor/three-addons/postprocessing/EffectComposer.js`
Expected: real JS source (not an HTML error page), and `EffectComposer.js` shows `} from 'three';`. Confirm no file starts with `<!DOCTYPE` (a failed fetch).

- [ ] **Step 3: Write the vendor structure test**

```js
// tests/scenes/orb/vendor.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PP = join(root, 'src/vendor/three-addons/postprocessing');
const SH = join(root, 'src/vendor/three-addons/shaders');

const FILES = [
  [join(PP, 'Pass.js'), 'Pass'],
  [join(PP, 'EffectComposer.js'), 'EffectComposer'],
  [join(PP, 'RenderPass.js'), 'RenderPass'],
  [join(PP, 'ShaderPass.js'), 'ShaderPass'],
  [join(PP, 'MaskPass.js'), 'MaskPass'],
  [join(PP, 'UnrealBloomPass.js'), 'UnrealBloomPass'],
  [join(SH, 'CopyShader.js'), 'CopyShader'],
  [join(SH, 'LuminosityHighPassShader.js'), 'LuminosityHighPassShader'],
];

test('all bloom addon files are vendored and reference their symbol', () => {
  for (const [path, sym] of FILES) {
    assert.ok(existsSync(path), `missing ${path}`);
    const src = readFileSync(path, 'utf8');
    assert.ok(src.length > 200, `${path} looks truncated`);
    assert.ok(new RegExp(`\\b${sym}\\b`).test(src), `${path} references ${sym}`);
    assert.ok(!/^<!DOCTYPE/i.test(src.trimStart()), `${path} is an HTML error page`);
  }
});

test('vendored addons carry no absolute/CDN import URLs (importmap-resolved)', () => {
  for (const [path] of FILES) {
    const src = readFileSync(path, 'utf8');
    assert.ok(!/from\s+['"]https?:\/\//.test(src), `${path} has an absolute import`);
    assert.ok(!/unpkg|cdn\.jsdelivr|skypack/.test(src), `${path} references a CDN`);
  }
});
```

- [ ] **Step 4: Run the vendor test**

Run: `node --test tests/scenes/orb/vendor.test.mjs`
Expected: PASS (2 tests). Functional load of the addon graph in a browser is verified in T3.

- [ ] **Step 5: Commit**

```bash
git add src/vendor/three-addons/postprocessing src/vendor/three-addons/shaders tests/scenes/orb/vendor.test.mjs
git commit -m "feat(orb): vendor three r160 UnrealBloom postprocessing addons (importmap-resolved, unmodified)"
```

---

### Task 2: `orbDrive.js` — PURE deterministic drive + unit tests

**Files:**
- Create: `src/scenes/orb/orbDrive.js`
- Test: `tests/scenes/orb/orbDrive.test.mjs`

**Interfaces:**
- Consumes: nothing (leaf task, no THREE, no DOM).
- Produces (T3 uses `buildOrbGeometry`, `ORB`; T5 uses `bandUniforms`, `updateBurst`, `burstFrame`, `sweepFrame`, `ORB`):
  - `ORB` — const object of tuning numbers (`COUNT`, `SMOOTH`, burst/wave constants, `FAST_FLOW_RATE`, `JITTER`).
  - `hash01(x,y,z,c) → number` in `[0,1)`.
  - `buildOrbGeometry(count) → { positions: Float32Array(3*count), seeds: Float32Array(count) }`, every `positions` triple unit-length.
  - `updateBurst(state, bass, time) → state` — mutates `{t0,n,amp,prevBass}` on a bass rising-edge past `BURST_BASS_HI` with `BURST_MIN_GAP` refractory.
  - `burstFrame(state, time) → { axis:[x,y,z] unit, cos:number, env:number, active:boolean }`.
  - `sweepFrame(time, mid) → { axis:[x,y,z] unit, k:number, flow:number }`.
  - `bandUniforms(audio, prev, coef) → prev` — mutates `{bassSwell,travelAmt,treble,exposureLoud}` toward gained band targets.
- State literals (created by OrbScene in T4): burst `{ t0:-99, n:0, amp:0, prevBass:0 }`, band `{ bassSwell:0, travelAmt:0, treble:0, exposureLoud:0 }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/scenes/orb/orbDrive.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import {
  ORB, hash01, buildOrbGeometry, updateBurst, burstFrame, sweepFrame, bandUniforms,
} from '../../../src/scenes/orb/orbDrive.js';

const len = (a) => Math.hypot(a[0], a[1], a[2]);

test('hash01 is in [0,1), deterministic, and varies per input', () => {
  for (let i = 0; i < 500; i++) {
    const v = hash01(i, i * 2, i * 3, 7);
    assert.ok(v >= 0 && v < 1, `range at ${i}`);
  }
  assert.strictEqual(hash01(3, 4, 5, 1), hash01(3, 4, 5, 1));
  assert.notStrictEqual(hash01(3, 4, 5, 1), hash01(3, 4, 5, 2)); // c changes output
  assert.notStrictEqual(hash01(3, 4, 5, 1), hash01(4, 4, 5, 1)); // x changes output
});

test('buildOrbGeometry: deterministic, right lengths, unit directions, seeds in [0,1)', () => {
  const n = 2000;
  const a = buildOrbGeometry(n);
  const b = buildOrbGeometry(n);
  assert.strictEqual(a.positions.length, 3 * n);
  assert.strictEqual(a.seeds.length, n);
  assert.deepStrictEqual(a.positions, b.positions); // deterministic
  assert.deepStrictEqual(a.seeds, b.seeds);
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(a.positions[i * 3], a.positions[i * 3 + 1], a.positions[i * 3 + 2]);
    assert.ok(Math.abs(d - 1) < 1e-5, `|dir|≈1 at ${i} got ${d}`);
    assert.ok(a.seeds[i] >= 0 && a.seeds[i] < 1, `seed range at ${i}`);
  }
});

test('updateBurst: fires on bass rising-edge, respects refractory, amp in [0.45,1]', () => {
  const s = { t0: -99, n: 0, amp: 0, prevBass: 0 };
  updateBurst(s, 0.2, 0.0);              // below threshold
  assert.strictEqual(s.n, 0);
  updateBurst(s, 0.9, 0.5);              // rising edge past HI → fire
  assert.strictEqual(s.n, 1);
  assert.strictEqual(s.t0, 0.5);
  assert.ok(s.amp >= 0.45 && s.amp <= 1, `amp ${s.amp}`);
  updateBurst(s, 0.2, 0.55);             // drop below (prevBass resets)
  updateBurst(s, 0.9, 0.6);              // re-rise within MIN_GAP (0.22) of t0=0.5 → NO fire
  assert.strictEqual(s.n, 1, 'refractory blocks re-fire');
  updateBurst(s, 0.2, 0.9);
  updateBurst(s, 0.9, 1.0);              // re-rise after refractory → fire
  assert.strictEqual(s.n, 2);
  assert.strictEqual(s.prevBass, 0.9);   // tracks last bass
});

test('burstFrame: active only within BURST_LIFE, env decays monotonically, axis unit, axis varies by n', () => {
  const s1 = { t0: 0, n: 1, amp: 1, prevBass: 0 };
  assert.strictEqual(burstFrame(s1, ORB.BURST_LIFE + 0.01).active, false); // past life
  let prevEnv = Infinity;
  for (let age = 0; age < ORB.BURST_LIFE; age += 0.05) {
    const f = burstFrame(s1, age);
    assert.ok(f.active, `active at age ${age}`);
    assert.ok(Math.abs(len(f.axis) - 1) < 1e-6, 'axis unit');
    assert.ok(f.env <= prevEnv + 1e-9, 'env monotonic non-increasing');
    prevEnv = f.env;
  }
  const s2 = { t0: 0, n: 2, amp: 1, prevBass: 0 };
  const ax1 = burstFrame(s1, 0.1).axis, ax2 = burstFrame(s2, 0.1).axis;
  assert.ok(len([ax1[0] - ax2[0], ax1[1] - ax2[1], ax1[2] - ax2[2]]) > 0.05, 'axis hops per burst');
});

test('sweepFrame: axis is ALWAYS unit (never collapses), k in [5,11], flow monotonic in time', () => {
  let prevFlow = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const t = i * 0.017;
    const f = sweepFrame(t, (i % 5) / 5);
    assert.ok(Math.abs(len(f.axis) - 1) < 1e-5, `axis unit at t=${t} got ${len(f.axis)}`);
    assert.ok(f.k >= 5 - 1e-6 && f.k <= 11 + 1e-6, `k in [5,11] got ${f.k}`);
    assert.ok(f.flow > prevFlow, `flow strictly increases at t=${t}`);
    prevFlow = f.flow;
  }
});

test('bandUniforms: approaches gained targets and stays bounded [0,1]', () => {
  const prev = { bassSwell: 0, travelAmt: 0, treble: 0, exposureLoud: 0 };
  const audio = { bass: 1, mid: 1, treble: 1, level: 1 };
  for (let i = 0; i < 300; i++) bandUniforms(audio, prev, 1);
  for (const k of ['bassSwell', 'travelAmt', 'treble', 'exposureLoud']) {
    assert.ok(prev[k] > 0.95 && prev[k] <= 1, `${k} approached target: ${prev[k]}`);
  }
  const prev2 = { bassSwell: 0.5, travelAmt: 0.5, treble: 0.5, exposureLoud: 0.5 };
  for (let i = 0; i < 300; i++) bandUniforms({ bass: 0, mid: 0, treble: 0, level: 0 }, prev2, 1);
  for (const k of ['bassSwell', 'travelAmt', 'treble', 'exposureLoud']) {
    assert.ok(prev2[k] >= 0 && prev2[k] < 0.05, `${k} decays to 0: ${prev2[k]}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/scenes/orb/orbDrive.test.mjs`
Expected: FAIL — `Cannot find module '.../src/scenes/orb/orbDrive.js'`.

- [ ] **Step 3: Write `orbDrive.js`**

```js
// src/scenes/orb/orbDrive.js
// PURE, deterministic drive for the WebGL "Noise Orb" scene.
// No THREE, no DOM, no Math.random/Date/performance.now — geometry from an
// integer hash, every time-varying value from clock.time + audio scalars only.
// Unit-tested core: geometry generation, one-pole band smoothing, beat-burst
// ignition, and the traveling light-front's axis/phase evolution.

export const ORB = {
  COUNT: 140000,
  JITTER: 0.006,          // deterministic positional jitter so the fibonacci lattice never reads as a grid
  BURST_BASS_HI: 0.55,    // bass rising-edge threshold that ignites a kick burst
  BURST_MIN_GAP: 0.22,    // refractory seconds between bursts
  BURST_LIFE: 1.1,        // burst envelope lifetime (s)
  BURST_SPEED: 3.3,       // ring expansion rate in cos-space
  BURST_DECAY: 2.1,       // burst brightness exp decay
  BURST_W: 4.0,           // ring angular width (matches the GLSL literal 4.0)
  BURST_GAIN: 1.3,        // burst brightness gain applied by the scene
  WAVE_K: 9.0,            // nominal light-front band count (reference lever)
  WAVE_SPEED: 0.8,        // traveling front phase rate (pure time => seamless + monotonic)
  WAVE_SPEED_MID: 2.4,    // reserved mid speed factor (reference lever)
  WALL_TRAVEL: 1.15,      // reserved wall-travel gain (reference lever)
  FAST_FLOW_RATE: 1.9,    // treble crackle fast-phase rate
  SMOOTH: 0.18,           // one-pole smoothing coefficient
};

function clamp01(v) { return v == null ? 0 : v < 0 ? 0 : v > 1 ? 1 : v; }

// Deterministic integer hash -> [0,1). Distinct outputs per (x,y,z,c).
export function hash01(x, y, z, c) {
  let h = Math.imul((x | 0) ^ 0x9e3779b1, 0x85ebca77);
  h = Math.imul((h ^ (h >>> 15)) + (y | 0), 0xc2b2ae3d);
  h = Math.imul((h ^ (h >>> 13)) + (z | 0), 0x27d4eb2f);
  h = Math.imul((h ^ (h >>> 16)) + (c | 0), 0x165667b1);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Fibonacci sphere + tiny deterministic jitter, renormalized so every direction is unit length.
export function buildOrbGeometry(count) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const denom = count > 1 ? count - 1 : 1;
  for (let i = 0; i < count; i++) {
    let y = 1 - (i / denom) * 2;                    // 1 -> -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    let x = Math.cos(theta) * r;
    let z = Math.sin(theta) * r;
    x += (hash01(i, 0, 0, 1) - 0.5) * ORB.JITTER;
    y += (hash01(i, 0, 0, 2) - 0.5) * ORB.JITTER;
    z += (hash01(i, 0, 0, 3) - 0.5) * ORB.JITTER;
    const inv = 1 / Math.sqrt(x * x + y * y + z * z); // renormalize => |dir| = 1
    positions[i * 3] = x * inv;
    positions[i * 3 + 1] = y * inv;
    positions[i * 3 + 2] = z * inv;
    seeds[i] = hash01(i, 0, 0, 7);
  }
  return { positions, seeds };
}

// Ignite a burst on a bass rising-edge past HI, with a refractory gap. Mutates + returns state.
export function updateBurst(state, bass, time) {
  const b = clamp01(bass);
  const rising = b > ORB.BURST_BASS_HI && state.prevBass <= ORB.BURST_BASS_HI;
  const ready = (time - state.t0) > ORB.BURST_MIN_GAP;
  if (rising && ready) {
    state.t0 = time;
    state.n = (state.n + 1) | 0;
    state.amp = 0.45 + 0.55 * clamp01((b - ORB.BURST_BASS_HI) / (1 - ORB.BURST_BASS_HI));
  }
  state.prevBass = b;
  return state;
}

// Current burst ring: golden-angle axis hop per burst, cos-space outward sweep, exp-decay envelope.
export function burstFrame(state, time) {
  const age = time - state.t0;
  if (!(age >= 0 && age < ORB.BURST_LIFE)) return { axis: [0, 1, 0], cos: -2, env: 0, active: false };
  const gA = Math.PI * (3 - Math.sqrt(5));
  const yy = 1 - ((state.n * 0.61803398875) % 1) * 2;   // deterministic per-burst latitude
  const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
  const th = gA * state.n;
  const axis = [Math.cos(th) * rr, yy, Math.sin(th) * rr]; // unit by construction (rr^2 + yy^2 = 1)
  const cos = 1 - ORB.BURST_SPEED * age;                   // ring sweeps outward from the pole
  const env = state.amp * Math.exp(-ORB.BURST_DECAY * age);
  return { axis, cos, env, active: true };
}

// Traveling MID light-front: a precessing UNIT axis (never collapses), breathing band count,
// and a phase that advances purely with time (=> monotonic + seamless, no frame-to-frame jumps).
export function sweepFrame(time, mid) {
  const m = clamp01(mid);
  const a = time * 0.19, b = time * 0.11 + 0.6;
  const cb = Math.cos(b);
  const axis = [Math.cos(a) * cb, Math.sin(b), Math.sin(a) * cb]; // |axis| = 1 exactly (spherical param)
  const k = 8 + 2.5 * Math.sin(time * 0.23) - 0.5 * m * Math.cos(time * 0.11); // in [5,11]
  const flow = time * ORB.WAVE_SPEED;
  return { axis, k, flow };
}

// One-pole smooth the three bands (and level) toward their gained targets. Mutates + returns prev.
export function bandUniforms(audio, prev, coef) {
  const a = audio || {};
  const gain = coef == null ? 1 : coef;
  const s = ORB.SMOOTH;
  prev.bassSwell    += (clamp01(clamp01(a.bass) * gain)   - prev.bassSwell) * s;
  prev.travelAmt    += (clamp01(clamp01(a.mid) * gain)    - prev.travelAmt) * s;
  prev.treble       += (clamp01(clamp01(a.treble) * gain) - prev.treble) * s;
  prev.exposureLoud += (clamp01(clamp01(a.level) * gain)  - prev.exposureLoud) * s;
  return prev;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/scenes/orb/orbDrive.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: all prior tests still pass, plus the new orb tests.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/orb/orbDrive.js tests/scenes/orb/orbDrive.test.mjs
git commit -m "feat(orb): orbDrive.js PURE deterministic geometry/burst/sweep/band drive + unit tests"
```

---

### Task 3: `orbCore.js` — THREE renderer/points/GLSL/composer

**Files:**
- Create: `src/scenes/orb/orbCore.js`

**Interfaces:**
- Consumes: `buildOrbGeometry`, `ORB` from `./orbDrive.js`; `EffectComposer`, `RenderPass`, `UnrealBloomPass` from vendored addons (T1); `THREE` passed in by the caller.
- Produces: `createOrbCore({ THREE, renderer }) → { scene, camera, points, uniforms, resize(w,h), setUniforms(obj), setTint(rgb255), setBloom(strength), setDrawFraction(frac), rotate(rx,ry), render(), dispose() }`. `setUniforms` accepts float values and 3-element arrays (for `uSweepAxis`/`uBurstAxis`, applied via `Vector3.fromArray`). `setTint` takes `palette.fg` = `[r,g,b]` in 0..255. Uniform names match the GLSL below. T4 constructs the core and calls `resize/render/rotate/setUniforms/setTint/setBloom`.

- [ ] **Step 1: Write `orbCore.js` (GLSL from the reference, extended with the band terms)**

The `snoise`/`fbm`/`worley` block is copied **verbatim** from the reference `vj-blob.html`. The vertex `main` extends the reference with the MID sweep, BASS burst, and TREBLE shimmer terms (spec §7.2).

```js
// src/scenes/orb/orbCore.js
// Owns all THREE state for the Noise Orb: 140k GPU points on a unit sphere, a
// simplex-FBM + Worley displacement/brightness shader (AdditiveBlending), and a
// RenderPass -> UnrealBloomPass composer. Pure rendering; all time/audio values
// arrive through setUniforms from OrbScene. Deterministic (no random here).
import { buildOrbGeometry, ORB } from './orbDrive.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- Ashima simplex 3D + 5-octave FBM + Worley cellular (verbatim from reference vj-blob.html) ---
const GLSL_NOISE = /* glsl */`
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float fbm(vec3 p){
    float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.0; a*=0.5; } return s;
  }
  vec3 hash3(vec3 p){
    p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
    return fract(sin(p)*43758.5453123);
  }
  float worley(vec3 p){
    vec3 ip=floor(p); vec3 fp=fract(p); float d=1.0;
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){
      vec3 g=vec3(float(x),float(y),float(z));
      vec3 o=hash3(ip+g); vec3 r=g+o-fp; d=min(d,dot(r,r));
    }
    return sqrt(d);
  }
`;

const VERT = GLSL_NOISE + /* glsl */`
  uniform float uTime,uMorphSpeed,uNoiseScale,uDisplace,uCellEdge,uPointSize,uPixelRatio;
  uniform float uBassSwell,uTravelAmt,uTreble,uFastFlow,uSweepK,uSweepFlow,uBurstCos,uBurstEnv;
  uniform vec3 uSweepAxis,uBurstAxis;
  attribute float aSeed;
  varying float vBright;
  void main(){
    vec3 dir=normalize(position);
    float t=uTime*uMorphSpeed;
    vec3 sp=dir*uNoiseScale;
    float f=fbm(sp+vec3(0.0,0.0,t));
    float cell=worley(sp*1.45+vec3(t*0.6));
    float wall=1.0-smoothstep(0.0,0.45,cell);                 // bright at cell walls
    float disp=f*0.55+wall*uCellEdge*0.7;
    float radius=1.0+uDisplace*disp+uBassSwell*0.28;          // BASS: global swell
    radius+=uTreble*0.05*snoise(dir*9.0+vec3(uFastFlow));     // TREBLE: fine radial crackle
    vec4 mv=modelViewMatrix*vec4(dir*radius,1.0);
    gl_Position=projectionMatrix*mv;
    gl_PointSize=uPointSize*(0.7+0.6*aSeed)*uPixelRatio*(4.0/-mv.z); // k=4.0 (guards against giant splats)
    // MID: morphing light-front sweeping the worley walls (wobbling axis, breathing band count)
    float cr=0.5+0.5*sin(dot(dir,uSweepAxis)*uSweepK-uSweepFlow+aSeed*1.1);
    // BASS kick: expanding ring burst in cos-space (no acos/exp on the GPU)
    float q=(dot(dir,uBurstAxis)-uBurstCos)*4.0; q=1.0-q*q;
    cr=max(cr, q>0.0 ? q*q*uBurstEnv : 0.0);
    float depthFade=clamp(0.55+0.45*(radius-0.8),0.3,1.2);
    float base=(0.10+1.5*wall*uCellEdge+0.45*max(disp,0.0))*(0.8+0.6*aSeed);
    vBright=base*depthFade*(1.0+uBassSwell*0.8)
          + wall*uCellEdge*uTravelAmt*cr*cr*cr*depthFade*(0.8+0.6*aSeed);
    if(uTreble>0.001) vBright*=1.0+uTreble*0.7*snoise(dir*7.0-vec3(uFastFlow)); // brightness shimmer
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor; uniform float uExposure;
  varying float vBright;
  void main(){
    vec2 uv=gl_PointCoord-0.5; float d=length(uv);
    float a=smoothstep(0.5,0.0,d); a*=a;                       // soft round sprite
    gl_FragColor=vec4(uColor*vBright*uExposure, a);
  }
`;

export function createOrbCore({ THREE, renderer }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 4.4);

  const { positions, seeds } = buildOrbGeometry(ORB.COUNT);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime:      { value: 0 },
    uMorphSpeed:{ value: 0.45 }, uNoiseScale: { value: 1.70 }, uDisplace: { value: 0.42 },
    uCellEdge:  { value: 0.55 }, uPointSize:  { value: 1.70 }, uExposure: { value: 1.15 },
    uColor:     { value: new THREE.Color(1, 1, 1) },
    uPixelRatio:{ value: renderer.getPixelRatio() },
    uBassSwell: { value: 0 }, uTravelAmt: { value: 0 }, uTreble: { value: 0 }, uFastFlow: { value: 0 },
    uSweepAxis: { value: new THREE.Vector3(0, 1, 0) }, uSweepK: { value: ORB.WAVE_K }, uSweepFlow: { value: 0 },
    uBurstAxis: { value: new THREE.Vector3(0, 1, 0) }, uBurstCos: { value: -2 }, uBurstEnv: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: VERT, fragmentShader: FRAG,
  });

  const points = new THREE.Points(geo, material);
  scene.add(points);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.05, 0.6, 0.0);
  composer.addPass(bloom);

  function resize(w, h) {
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h);
    uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }
  function setUniforms(o) {
    for (const k in o) {
      const u = uniforms[k]; if (!u) continue;
      const v = o[k];
      if (Array.isArray(v) && u.value && u.value.fromArray) u.value.fromArray(v);
      else u.value = v;
    }
  }
  function setTint(rgb) {               // palette.fg is [0..255]; assign components directly (no colorspace conversion, stays monochrome)
    const c = uniforms.uColor.value;
    c.r = rgb[0] / 255; c.g = rgb[1] / 255; c.b = rgb[2] / 255;
  }
  function setBloom(strength) { bloom.strength = strength; }
  function setDrawFraction(frac) {
    const f = Math.min(1, Math.max(0.05, frac));
    geo.setDrawRange(0, Math.max(1, Math.floor(ORB.COUNT * f)));
  }
  function rotate(rx, ry) { points.rotation.x = rx; points.rotation.y = ry; }
  function render() { composer.render(); }
  function dispose() {
    geo.dispose(); material.dispose();
    if (bloom.dispose) bloom.dispose();
    if (composer.dispose) composer.dispose();
  }
  return { scene, camera, points, uniforms, resize, setUniforms, setTint, setBloom, setDrawFraction, rotate, render, dispose };
}
```

- [ ] **Step 2: Syntax-check the module**

Run: `node --check src/scenes/orb/orbCore.js`
Expected: no output (valid syntax). (Node can't resolve the bare `three` imports without the browser importmap — that's expected; functional load is verified in T4/T7 in the browser.)

- [ ] **Step 3: Commit**

```bash
git add src/scenes/orb/orbCore.js
git commit -m "feat(orb): orbCore.js — 140k point ShaderMaterial (FBM+Worley) + UnrealBloom composer"
```

---

### Task 4: `OrbScene.js` + `index.html` canvas + registry — scene renders a rotating monochrome orb

**Files:**
- Create: `src/scenes/orb/OrbScene.js`
- Modify: `index.html` (add `<canvas id="orb-gl">`, extend the `#city-gl` CSS selector)
- Modify: `src/scenes/registry.js` (import + one array entry)

**Interfaces:**
- Consumes: `createOrbCore` (T3); `Scene` base; `THREE` from `../../vendor/three.module.js`. This task wires only geometry/motion/params/palette uniforms — the audio→uniform mapping is added in T5 (a marked seam in `update()`).
- Produces: `class OrbScene extends Scene` with `id='orb'`, name `'Noise Orb'`, registered so `window.__vj.scenes.byId['orb']` exists. Fields `this._burst`, `this._band`, `this._rotY` (used by T5). Params: `rotSpeed, morphSpeed, noiseScale, displace, cellEdge, pointSize, exposure, bloom, audioGain`.

- [ ] **Step 1: Add the `orb-gl` canvas + CSS to `index.html`**

Extend the existing `#city-gl` rule to also cover `#orb-gl` (identical fixed full-screen overlay). Change:

```html
    #city-gl {
```
to:
```html
    #city-gl, #orb-gl {
```

Then add the canvas right after the city canvas. Change:
```html
  <canvas id="city-gl"></canvas>
```
to:
```html
  <canvas id="city-gl"></canvas>
  <canvas id="orb-gl"></canvas>
```

- [ ] **Step 2: Write `OrbScene.js` (geometry/motion/params only; audio seam marked for T5)**

```js
// src/scenes/orb/OrbScene.js
// Scene adapter for the WebGL Noise Orb. Mirrors CityScene's opacity-composited
// pattern: a dedicated #orb-gl canvas with a lazily-created WebGLRenderer, shown
// by writing canvas.style.opacity = alpha in draw() and 0 in onExit(). Params are
// plain sliders read every frame into uniforms (no onChange needed).
import * as THREE from '../../vendor/three.module.js';
import { Scene } from '../Scene.js';
import { createOrbCore } from './orbCore.js';

export class OrbScene extends Scene {
  constructor() {
    super('orb', 'Noise Orb');
    this._core = null; this._renderer = null; this._orbGl = null;
    this._rotY = 0;                                        // accumulated Y spin (clock.dt driven)
    this._burst = { t0: -99, n: 0, amp: 0, prevBass: 0 };  // burst state (T5)
    this._band = { bassSwell: 0, travelAmt: 0, treble: 0, exposureLoud: 0 }; // band smoothing (T5)
    this.defineParam('rotSpeed', 0.18, 0, 1.2, 0.01, '回転速度')
        .defineParam('morphSpeed', 0.45, 0, 1.5, 0.01, 'モーフ速度')
        .defineParam('noiseScale', 1.70, 0.6, 4.0, 0.01, 'ノイズ密度')
        .defineParam('displace', 0.42, 0, 0.9, 0.005, '変位')
        .defineParam('cellEdge', 0.55, 0, 1.0, 0.01, 'フィラメント')
        .defineParam('pointSize', 1.70, 0.5, 4.0, 0.05, 'グレイン')
        .defineParam('exposure', 1.15, 0.2, 2.5, 0.01, '露光')
        .defineParam('bloom', 1.05, 0, 2.0, 0.01, 'ブルーム')
        .defineParam('audioGain', 1.10, 0, 2.5, 0.01, '音の深さ');
  }

  _ensureCore() {
    if (this._core) return;
    this._orbGl = document.getElementById('orb-gl');
    this._renderer = new THREE.WebGLRenderer({ canvas: this._orbGl, antialias: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 1);
    this._core = createOrbCore({ THREE, renderer: this._renderer });
    this._core.resize(this.w || innerWidth, this.h || innerHeight);
  }

  init(ctx, w, h) { this.w = w; this.h = h; this._ensureCore(); this._core.resize(w, h); }
  onResize(w, h) { this.w = w; this.h = h; if (this._core) this._core.resize(w, h); }

  update(dt, audio, palette, clock) {
    if (!this._core) return;
    const t = clock ? clock.time : 0;
    this._rotY += dt * this.p('rotSpeed');
    this._core.rotate(Math.sin(t * 0.08) * 0.18, this._rotY); // gentle deterministic wobble + spin

    // --- T5 seam: audio -> uniforms goes here (bandUniforms / updateBurst / burstFrame / sweepFrame). ---
    this._core.setUniforms({
      uTime: t,
      uMorphSpeed: this.p('morphSpeed'), uNoiseScale: this.p('noiseScale'),
      uDisplace: this.p('displace'), uCellEdge: this.p('cellEdge'),
      uPointSize: this.p('pointSize'), uExposure: this.p('exposure'),
    });

    if (palette && palette.fg) this._core.setTint(palette.fg);
    this._core.setBloom(this.p('bloom'));
  }

  draw(ctx, alpha) {
    if (!this._orbGl || !this._core) return;
    this._core.render();
    this._orbGl.style.opacity = String(alpha);
  }

  onExit() { this._orbGl && (this._orbGl.style.opacity = 0); }
  dispose() {
    if (this._orbGl) this._orbGl.style.opacity = 0;
    if (this._core) this._core.dispose();
    if (this._renderer) this._renderer.dispose();
    this._core = null; this._renderer = null;
  }
}
```

- [ ] **Step 3: Register the scene in `registry.js`**

Add the import next to the other WebGL scene (`CityScene`). Change:
```js
import { CityScene } from './city/CityScene.js';
```
to:
```js
import { CityScene } from './city/CityScene.js';
import { OrbScene } from './orb/OrbScene.js';
```

Add the instance to the array right after `new CityScene()`. Change:
```js
    new CityScene(),
    new Kaleidoscope(),
```
to:
```js
    new CityScene(),
    new OrbScene(),
    new Kaleidoscope(),
```

- [ ] **Step 4: Start the dev server and switch to the orb scene in a headless browser**

Start the server (background) and drive it with the existing headless shot tool:
```bash
python3 -m http.server 8125 >/dev/null 2>&1 &
node .superpowers/sdd/devshot/shot.mjs --url "http://localhost:8125/" \
  --eval "window.__vj.scenes.start('orb')" --wait 1500 \
  --out /private/tmp/claude-501/-Users-shiwa-Claude-Atelier-VJ/00583d7b-34ee-4ce0-911c-7a662b779b30/scratchpad/orb-t4.png
```
(Consult `.superpowers/sdd/devshot/shot.mjs` for its exact flag names — match them; the intent is: load the bare URL, run the eval to switch scenes, wait, screenshot.)

Expected: the screenshot shows a rotating **monochrome** filamented sphere (bright worley walls, soft additive glow), **no rectangle/background artifacts**, no rainbow. Console has no GLSL/link errors.

- [ ] **Step 5: If headless WebGL is unavailable, fall back to on-device**

If `shot.mjs` reports no GL context (SwiftShader/ANGLE), verify on the Mac/iPad: open `http://<host>:8125/`, tap start, switch to **Noise Orb** in the scene grid, and screenshot. Record which path was used. Do not claim the visual is correct without a real screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/scenes/orb/OrbScene.js index.html src/scenes/registry.js
git commit -m "feat(orb): OrbScene adapter + #orb-gl canvas + registry — rotating monochrome orb renders"
```

---

### Task 5: Rich per-band audio wiring + audioGain

**Files:**
- Modify: `src/scenes/orb/OrbScene.js` (`update()` — replace the T5 seam)

**Interfaces:**
- Consumes: `bandUniforms`, `updateBurst`, `burstFrame`, `sweepFrame`, `ORB` from `./orbDrive.js`; `audio.state` fields `bass/mid/treble/level` (0..1); `clock.time`.
- Produces: per-frame uniform updates so BASS→`uBassSwell`/burst, MID→`uTravelAmt`/`uSweepAxis`/`uSweepK`/`uSweepFlow`, TREBLE→`uTreble`/`uFastFlow`, all scaled by the `audioGain` param.

- [ ] **Step 1: Add the imports**

Change:
```js
import { createOrbCore } from './orbCore.js';
```
to:
```js
import { createOrbCore } from './orbCore.js';
import { ORB, bandUniforms, updateBurst, burstFrame, sweepFrame } from './orbDrive.js';
```

- [ ] **Step 2: Replace the T5 seam in `update()` with the full audio→uniform mapping**

Replace this block:
```js
    // --- T5 seam: audio -> uniforms goes here (bandUniforms / updateBurst / burstFrame / sweepFrame). ---
    this._core.setUniforms({
      uTime: t,
      uMorphSpeed: this.p('morphSpeed'), uNoiseScale: this.p('noiseScale'),
      uDisplace: this.p('displace'), uCellEdge: this.p('cellEdge'),
      uPointSize: this.p('pointSize'), uExposure: this.p('exposure'),
    });
```
with:
```js
    const a = audio || {};
    const gain = this.p('audioGain');
    const band = bandUniforms(a, this._band, gain);              // smoothed BASS/MID/TREBLE/level
    updateBurst(this._burst, a.bass, t);                        // ignite ring burst on bass rising-edge
    const bf = burstFrame(this._burst, t);
    const sf = sweepFrame(t, a.mid);                            // traveling MID light-front
    this._core.setUniforms({
      uTime: t,
      uMorphSpeed: this.p('morphSpeed'), uNoiseScale: this.p('noiseScale'),
      uDisplace: this.p('displace'), uCellEdge: this.p('cellEdge'),
      uPointSize: this.p('pointSize'),
      uExposure: this.p('exposure') * (1 + 0.5 * band.exposureLoud), // loudness lifts exposure
      uBassSwell: band.bassSwell, uTravelAmt: band.travelAmt, uTreble: band.treble,
      uFastFlow: t * ORB.FAST_FLOW_RATE,
      uSweepAxis: sf.axis, uSweepK: sf.k, uSweepFlow: sf.flow,
      uBurstAxis: bf.axis, uBurstCos: bf.cos, uBurstEnv: bf.env * ORB.BURST_GAIN * gain,
    });
```

- [ ] **Step 3: Headless verify the three bands are visually distinct**

Drive the scene with four injected audio states (idle / bass / mid / treble) and screenshot each. `window.__vj.audio.state` holds the live band scalars — override them after switching scenes and before the wait. Example (adapt flag names to `shot.mjs`):
```bash
node .superpowers/sdd/devshot/shot.mjs --url "http://localhost:8125/" \
  --eval "window.__vj.scenes.start('orb'); const s=window.__vj.audio.state; s.bass=0.95; s.mid=0.1; s.treble=0.1; s.level=0.8;" \
  --wait 1200 --out .../scratchpad/orb-bass.png
```
Repeat with `mid=0.95` (others low) and `treble=0.95` (others low), and an idle frame (all ~0).

Expected, compared against the reference video:
- **idle:** quiet rotation + gentle breathing, no bursts.
- **bass:** whole orb swells brighter; on a rising kick, an expanding bright ring sweeps across the surface.
- **mid:** a moving light-front travels along the worley wall network (bands visibly sweep).
- **treble:** fine radial crackle + brightness shimmer on the grains.

If headless GL is unavailable, use the on-device fallback (T4 Step 5). Do not claim done without screenshots.

- [ ] **Step 4: Run the suite (orbDrive still green; scene edit is JS-valid)**

Run: `npm test && node --check src/scenes/orb/OrbScene.js`
Expected: tests pass, no syntax error.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/orb/OrbScene.js
git commit -m "feat(orb): rich per-band audio wiring (BASS swell+burst / MID light-front / TREBLE shimmer) x audioGain"
```

---

### Task 6: Adaptive quality (clock.quality → bloom, then point count)

**Files:**
- Modify: `src/scenes/orb/OrbScene.js` (`update()` — bloom + draw-fraction)

**Interfaces:**
- Consumes: `clock.quality` (0..1 adaptive quality from the engine); `setBloom`, `setDrawFraction` (T3).
- Produces: under load, dims bloom first, then thins the cloud — the spec §8 order (bloom → points). No new exports.

- [ ] **Step 1: Replace the tail of `update()` (the `setBloom` line) with adaptive logic**

Replace:
```js
    if (palette && palette.fg) this._core.setTint(palette.fg);
    this._core.setBloom(this.p('bloom'));
```
with:
```js
    if (palette && palette.fg) this._core.setTint(palette.fg);

    // Adaptive: below full quality, dim bloom first (cheapest win), then thin the point cloud.
    const q = clock && clock.quality != null ? clock.quality : 1;
    this._core.setBloom(this.p('bloom') * (q < 1 ? Math.max(0.3, q) : 1));
    this._core.setDrawFraction(q < 0.6 ? Math.max(0.4, q) : 1);
```

- [ ] **Step 2: Headless verify adaptation does not error and visibly responds**

Force low quality and confirm no error + a thinner/dimmer render:
```bash
node .superpowers/sdd/devshot/shot.mjs --url "http://localhost:8125/" \
  --eval "window.__vj.scenes.start('orb'); window.__vj.clock.quality=0.4;" \
  --wait 1200 --out .../scratchpad/orb-lowq.png
```
Expected: renders (fewer points, softer bloom), no console error. At `quality=1` the full 140k render returns.

- [ ] **Step 3: Run checks**

Run: `npm test && node --check src/scenes/orb/OrbScene.js`
Expected: green, no syntax error.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/orb/OrbScene.js
git commit -m "feat(orb): adaptive quality — clock.quality dims bloom then thins points (spec §8 order)"
```

---

### Task 7: Visual gate — headless (or on-device) confirmation against the reference

**Files:** none (verification task; only touch code if a defect is found).

**Interfaces:**
- Consumes: the running app at `http://localhost:8125/`, `window.__vj` (scenes/audio/clock).

- [ ] **Step 1: Sweep the four audio states and capture screenshots**

With the dev server running, capture idle / bass(+kick) / mid / treble frames (T5 Step 3 commands). Because the drive is deterministic (hash + clock.time), the same inject reproduces the same frame.

- [ ] **Step 2: Inspect each screenshot against the reference `vj-blob.html` anatomy**

Confirm **by looking** (not by assuming):
- (a) idle = calm rotation + breathing; monochrome white-on-black; **no rectangle/background plane**.
- (b) bass = global swell; a rising kick fires an expanding ring burst.
- (c) mid = a light-front travels the worley wall network.
- (d) treble = fine radial crackle + brightness shimmer.
- (e) point sprites are soft and small — **no giant white splats** (k=4 held).
- (f) crossfade: switching orb↔another scene fades opacity smoothly; leaving orb hides `#orb-gl` (opacity 0), not a black rectangle over other scenes.

- [ ] **Step 3: If headless WebGL is unavailable, do the same on-device**

Per spec §10 risk: if `shot.mjs` can't get a GL context, verify on iPad Air M1 / MacBook Air M3 (tap start → select Noise Orb → observe the four states with real mic or the same `window.__vj.audio.state` overrides in Safari's console) and capture photos/screenshots.

- [ ] **Step 4: Only if a defect appears, fix and re-verify**

Typical fixes: giant splats → check `gl_PointSize` k stayed 4.0; washed-out/blown highlights → lower default `exposure`/`bloom`; a visible rectangle → confirm `#orb-gl` has no background and other scenes' canvases aren't showing through (opacity handling). Re-screenshot after any fix. **Do not mark T7 complete until a real screenshot shows all six checks pass.**

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(orb): <defect> found in visual gate"
```
(If no defect, T7 produces no commit — the confirmation itself is the deliverable.)

---

## Deploy (明示承認後のみ — NOT part of task execution)

Do **not** deploy without explicit user authorization. When authorized:

1. `sw.js`: bump `const CACHE_VERSION = 'vj-v46'` → `'vj-v47'` (the **required** action — re-activates the SW so network-first serves fresh code). Optionally add the new files to `ASSETS` for offline completeness (WebGL scene modules like `CityScene.js` are currently *not* precached and still work network-first, so this is optional-for-parity):
   ```js
     './src/scenes/orb/OrbScene.js',
     './src/scenes/orb/orbCore.js',
     './src/scenes/orb/orbDrive.js',
     './src/vendor/three-addons/postprocessing/Pass.js',
     './src/vendor/three-addons/postprocessing/EffectComposer.js',
     './src/vendor/three-addons/postprocessing/RenderPass.js',
     './src/vendor/three-addons/postprocessing/ShaderPass.js',
     './src/vendor/three-addons/postprocessing/MaskPass.js',
     './src/vendor/three-addons/postprocessing/UnrealBloomPass.js',
     './src/vendor/three-addons/shaders/CopyShader.js',
     './src/vendor/three-addons/shaders/LuminosityHighPassShader.js',
   ```
2. `git checkout main && git merge --ff-only feat/webgl-noise-orb && git push origin main` (GitHub Pages).
3. Verify on the **bare** URL (no `?cb=`): `https://shiwashiba.github.io/vj/` shows `vj-v47`, low age, MISS/new code served. iPad PWA reflects after one reload. (`?cb=` verification is a false-green — the CDN caches the bare URL with `max-age=600`, purged only on build completion.)

## リスクと対処（spec §12）

1. **headless WebGL 不可** → 実機（iPad/Mac）スクショ検証にフォールバック（T4 Step5 / T7 Step3）。
2. **point-size 白飛び**（最大の落とし穴）→ GLSL の `gl_PointSize` は `k=4.0` 固定・透視減衰のみ。T7 で監視。
3. **二 WebGL キャンバスのメモリ** → M1/8GB で問題なし・lazy init（`_ensureCore`）で未使用時コストゼロ。両者 opacity0 待機・active のみ点灯。
4. **iOS WebGL コンテキストロス** → 当面は Mac 退避が保険。復帰の最小実装はフォローアップ（本計画の対象外）。
5. **決定論** → シーン実行時は `hash01` + `clock.time` のみ。UnrealBloom は固定カーネル（乱数非依存）で対象外。

## Self-Review（spec 照合）

- **§3 スコープ:** 独立 GPU シーン `id='orb'`／名 `'Noise Orb'`（T4）✓・球ブロブ形状（T2 `buildOrbGeometry`）✓・TERRAIN 残置（本計画は Oscilloscope を触らない）✓。
- **§4 制約:** 決定論（T2 hash+time、テストで担保）✓・モノ（`setTint` 直接代入・カラーUIなし）✓・依存ゼロ（vendoring・importmap 解決）✓・加算（`AdditiveBlending`）✓・帯域別音反応（T5、視覚ゲート T7）✓・デプロイ承認後＋素URL（デプロイ節）✓・視覚実見（T4/T5/T7）✓。
- **§5 ファイル:** orbDrive/orbCore/OrbScene・index/registry・vendored addon・test — 全タスクに割当済 ✓。
- **§7.1 Uniforms 一覧:** 全 19 uniform を orbCore `uniforms` に定義、GLSL 宣言と一致（`uTime,uMorphSpeed,uNoiseScale,uDisplace,uCellEdge,uPointSize,uExposure,uColor,uPixelRatio,uBassSwell,uTravelAmt,uSweepAxis,uSweepK,uSweepFlow,uTreble,uFastFlow,uBurstAxis,uBurstCos,uBurstEnv`）✓。
- **§7.2 GLSL:** snoise/fbm/worley 逐語＋帯域項（T3）✓。**§7.3 シグネチャ:** `hash01/buildOrbGeometry/updateBurst/burstFrame/sweepFrame/bandUniforms` 一致（T2）✓。**§7.4 params:** 9 スライダ 既定/範囲一致（T4）✓・modeGroups なし ✓。
- **§8 perf:** 適応 bloom→点数（T6）✓・pixelRatio≤2（T4 `_ensureCore`）✓・lazy init ✓。
- **§10 テスト:** orbDrive 決定論/境界/単調（T2）＋ headless 視覚（T7）✓。
- **spec §7.3 との差分（意図的）:** `uSweepFlow` は time のみ（seamless+monotonic 保証のため）で mid は `uSweepK`/`uTravelAmt` を駆動。`uFastFlow` は `bandUniforms` でなく `t*FAST_FLOW_RATE`（純時間位相）。いずれも「音反応は強く明確に／継ぎ目なし」を満たす実装上の精緻化で、視覚要件は不変。
- **型整合:** `setUniforms` は float と 3要素配列（`uSweepAxis`/`uBurstAxis`）を扱う。`bandUniforms`/`burstFrame`/`sweepFrame` の戻り値キーが T5 の `setUniforms` 呼び出しと一致。state 初期値（burst/band）は T4 で生成し T2 の関数が消費。

## 実行方式

各タスクは 実装→自己レビュー→タスクレビュー（spec 準拠＋コード品質）→是正ループ。`{T1,T2}` 並列可、以降 T3→T4→T5→T6→T7 直列。最後に whole-branch レビュー＋ T7 実見ゲート → （承認後）デプロイ。
