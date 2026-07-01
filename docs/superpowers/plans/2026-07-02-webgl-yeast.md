# WebGL 酵母シーン「YEAST」 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kölsch 酵母の顕微鏡フィールドを、スクリーン空間メタボール・スプラットで描き、全質感を不規則に巡回させる mic 反応 WebGL シーン「YEAST」を本体 VJ に統合する。

**Architecture:** Noise Orb 同型の 3 ファイル分離。`yeastDrive.js`（PURE・決定論・単体テスト）が細胞レイアウト/モーション/見た目ドリフト/音平滑を数値で供給し、`yeastCore.js`（THREE/GLSL）が pass1=場を HalfFloat RT に加算スプラット → pass2=iso 閾値シェーディング（リム/ハロー/核/DoF/FOV）→ pass3=UnrealBloom で描画し、`YeastScene.js`（Scene アダプタ）が `#yeast-gl` canvas に事前レンダして opacity 合成する。

**Tech Stack:** buildless ES modules / three.js r160（vendored・importmap 解決・無改変）/ WebGL2 HalfFloat RenderTarget（加算ブレンド）/ 既存 UnrealBloom addon（orb で vendored 済・再利用）/ `node --test` 単体テスト / headless Chrome(ANGLE) 視覚検証。

## Global Constraints

以下はスペックの全プロジェクト要件。**全タスクの要件に暗黙的に含まれる**（各値は spec からそのまま）。

- **決定論**：`yeastDrive.js` は純関数。`Math.random()` / `Date.now()` / `performance.now()` / `new Date()` 非依存。乱数は seeded `hash01` のみ。同一 `(time, seed, params, audio)` → 同一出力。単体テスト対象。
- **モノ＋寒色のみ**：既定 MONO（白/黒）。スレートは寒色低彩度のみ（`slateBg=vec3(18,27,38)/255`, `slateLight=vec3(205,219,232)/255`）。**虹色グロー禁止**。
- **依存ゼロ / buildless**：npm・ビルドステップ無し。ES modules のみ。新規 npm 依存を足さない。
- **three.js 無改変**：`src/vendor/three.module.js`（r160）＋既存 importmap（`"three"`, `"three/addons/"`）で解決。vendor ファイルを編集しない。WebGL2 前提。
- **統合パリティ**：Noise Orb / 国立シティと同型。専用 `#yeast-gl` canvas に事前レンダ → `draw()` で `opacity=alpha` 合成。遅延 init（`_ensureCore`）でアイドルコスト 0。共有マイク。registry 1 行で選択可能。**既存シーン無改変**。
- **音反応は既定で強め・明確**。scene は `audio.{level,bass,mid,treble,beat,beatHold,bpm,ready}` を読む。
- **動きは有機的・継ぎ目なし**：非等速 ease、ハードカット無し、ループ点を感じさせない。見た目ドリフトはアペリオディック。
- **HalfFloat RT を使う**（`THREE.HalfFloatType`）。float32 加算ブレンドは iPad WebGL2 で `EXT_float_blend` を要し不安定。HalfFloat は `EXT_color_buffer_float` で描画・加算可能。

---

## File Structure

新規（すべて `feat/webgl-yeast` ブランチ、既に spec commit 済）：

- `src/scenes/yeast/yeastDrive.js` — PURE 数値ドライブ。定数・hash・細胞レイアウト・毎フレーム進行・見た目ドリフト・音平滑。THREE/DOM 非依存。
- `src/scenes/yeast/yeastCore.js` — `createYeastCore({THREE, renderer})`。全 THREE 状態（splat 場 RT / iso シェーディング / bloom composer）。render のみ。乱数無し。
- `src/scenes/yeast/YeastScene.js` — `extends Scene`。params・tint モードグループ・遅延 core 生成・lifecycle・毎フレームで drive→uniforms 配線。
- `tests/scenes/yeast/yeastDrive.test.mjs` — `yeastDrive` の決定論/範囲/アペリオディシティ単体テスト。
- `tests/scenes/yeast/harness.html` — headless 視覚検証用の単体ハーネス（three＋yeastCore＋yeastDrive を直接駆動、query で mood/audio/tint を注入）。

変更：

- `index.html` — `#yeast-gl` を CSS セレクタ群に追加 ＋ `<canvas id="yeast-gl">` を body に追加。
- `src/scenes/registry.js` — `import { YeastScene }` ＋ `new YeastScene()` を 1 行追加。

**座標系の規約（全タスク共通）：** `yeastDrive` の細胞位置 `px,py` と半径 `pr` はすべて**正規化空間**（画面中心 = 原点、短辺方向で ±1、DPR/ピクセル非依存）。`yeastCore` が uniform `uScale = 0.5*min(bufW,bufH)`, `uHalf = (bufW*0.5, bufH*0.5)` でピクセルへ写像する（`uScale` はスカラー → 顕微鏡円は常に真円）。`bufW,bufH` = `renderer.getDrawingBufferSize()`。FOV 円半径 = `YEAST.FOV`（正規化）。

**インスタンス配置の規約：** 総スロット数 `n = 2*count`。スロットは**インターリーブ**：`2k`=細胞 k 本体、`2k+1`=細胞 k の出芽ローブ（未出芽時は半径 0 → 面積 0 の quad → 何も描かない）。密度ドリフトは有効細胞数 `activeCells` を減らす → `instanceCount = 2*activeCells`（末尾の細胞＋ローブごと落とす）。

---

## Task 1: yeastDrive — 定数・hash・細胞レイアウト

**Files:**
- Create: `src/scenes/yeast/yeastDrive.js`
- Test: `tests/scenes/yeast/yeastDrive.test.mjs`

**Interfaces:**
- Consumes: なし（新規）。
- Produces:
  - `export const YEAST` — 定数オブジェクト（下記フィールド）。
  - `export function hash01(x, y, z, c) -> number` in `[0,1)`。
  - `export function buildCells(count, seed) -> state`。`state` は下記の Float32Array 群を持つオブジェクト（`count`, `n`, 静的: `baseX,baseY,depth,radius0,phase,kind,seedArr`, ライブ: `px,py,pr,pd,pbud`。全長 `n = 2*count`、インターリーブ配置）。

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/scenes/yeast/yeastDrive.test.mjs`:

```js
// tests/scenes/yeast/yeastDrive.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { YEAST, hash01, buildCells } from '../../../src/scenes/yeast/yeastDrive.js';

test('hash01 in [0,1), deterministic, varies per input', () => {
  for (let i = 0; i < 500; i++) {
    const v = hash01(i, i * 2, i * 3, 5);
    assert.ok(v >= 0 && v < 1, `range at ${i}`);
  }
  assert.strictEqual(hash01(3, 4, 5, 1), hash01(3, 4, 5, 1));
  assert.notStrictEqual(hash01(3, 4, 5, 1), hash01(3, 4, 5, 2));
  assert.notStrictEqual(hash01(3, 4, 5, 1), hash01(4, 4, 5, 1));
});

test('buildCells: deterministic, interleaved n=2*count, cells inside FOV, valid ranges', () => {
  const a = buildCells(120, 7);
  const b = buildCells(120, 7);
  assert.strictEqual(a.count, 120);
  assert.strictEqual(a.n, 240);
  assert.strictEqual(a.baseX.length, 240);
  assert.strictEqual(a.px.length, 240);
  assert.deepStrictEqual(a.baseX, b.baseX);      // deterministic
  assert.deepStrictEqual(a.depth, b.depth);
  for (let k = 0; k < a.count; k++) {
    const mi = 2 * k, bi = 2 * k + 1;
    const rr = Math.hypot(a.baseX[mi], a.baseY[mi]);
    assert.ok(rr <= YEAST.FOV, `main cell ${k} inside FOV: ${rr}`);
    assert.ok(a.depth[mi] >= 0 && a.depth[mi] <= 1, `depth in [0,1] at ${k}`);
    assert.ok(a.radius0[mi] > 0, `main radius > 0 at ${k}`);
    assert.strictEqual(a.radius0[bi], 0, `bud lobe starts radius 0 at ${k}`);
    assert.strictEqual(a.kind[mi], 0, `main kind=0 at ${k}`);
    assert.ok(a.kind[bi] === 1 || a.kind[bi] === 2, `bud kind 1|2 at ${k}`);
  }
});

test('buildCells: different seeds give different layouts', () => {
  const a = buildCells(80, 1), b = buildCells(80, 2);
  let diff = 0;
  for (let i = 0; i < a.baseX.length; i++) if (a.baseX[i] !== b.baseX[i]) diff++;
  assert.ok(diff > a.baseX.length * 0.5, `seeds diverge: ${diff}`);
});
```

- [ ] **Step 2: テストが失敗するのを確認**

Run: `node --test tests/scenes/yeast/yeastDrive.test.mjs`
Expected: FAIL — `Cannot find module '.../yeastDrive.js'`

- [ ] **Step 3: 最小実装を書く**

Create `src/scenes/yeast/yeastDrive.js`:

```js
// src/scenes/yeast/yeastDrive.js
// PURE, deterministic numeric drive for the WebGL "YEAST" scene.
// No THREE, no DOM, no Math.random/Date/performance.now. All geometry from an
// integer hash; all time-varying values from clock.time + audio scalars only.
// Coordinates are NORMALIZED (screen center = origin, ±1 on the short axis);
// yeastCore maps them to device pixels. Slots are INTERLEAVED: slot 2k = cell k
// body, slot 2k+1 = cell k's bud lobe (radius 0 until it buds).

export const YEAST = {
  COUNT: 220,          // number of cells (main); total instance slots = 2*COUNT
  FOV: 0.9,            // normalized microscope field-of-view radius
  SCATTER_R: 0.86,     // cluster centers scattered within FOV*this
  CLUSTER_SPREAD: 0.16,// gaussian spread of cells around their cluster center
  BASE_R: 0.055,       // base cell radius (normalized)
  R_JITTER: 0.6,       // per-cell radius jitter factor (0..this added to 0.72 base)
  DEPTH_DIM: 0.34,     // far cells shrink by up to this (radius0 *= 1 - DEPTH_DIM*depth)
  ISO_T: 0.165,        // iso threshold (body edge) — shared with yeastCore uT default
  SUP_A: 1.32, SUP_B: 0.78,   // support factor = SUP_A + SUP_B*fusion
  DOF_R: 0.34, DOF_AMP: 0.52, // DoF: far/off-focus cells broaden R / dim amp
  BUD_PROB: 0.55,      // fraction of cells that carry a bud lobe
  DIV_PROB: 0.22,      // of budding cells, fraction that become near-equal divisions
  BUD_GROW: 0.18,      // bud growth rate per second (budAmount 0->1)
  FLOW: 0.045,         // curl-ish roaming flow magnitude (normalized/sec baseline)
  BROWNIAN: 0.010,     // brownian jitter magnitude (quiet baseline)
  BROWNIAN_HOT: 0.055, // brownian magnitude at full bass agitation
  SMOOTH: 0.18,        // one-pole band smoothing coefficient
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

// Build cell layout: cluster centers scattered in the FOV, cells gaussian-scattered
// around them, plus per-cell depth/radius/phase and a (possibly-dividing) bud lobe slot.
export function buildCells(count, seed) {
  const n = 2 * count;
  const baseX = new Float32Array(n), baseY = new Float32Array(n);
  const depth = new Float32Array(n), radius0 = new Float32Array(n);
  const phase = new Float32Array(n), kind = new Float32Array(n), seedArr = new Float32Array(n);
  const nClusters = Math.max(1, Math.round(Math.sqrt(count)));
  const s = seed | 0;
  for (let k = 0; k < count; k++) {
    // pick a cluster center (deterministic) within FOV*SCATTER_R
    const cl = Math.floor(hash01(k, s, 0, 11) * nClusters);
    const ca = hash01(cl, s, 0, 12) * Math.PI * 2;
    const cr = Math.sqrt(hash01(cl, s, 0, 13)) * YEAST.FOV * YEAST.SCATTER_R;
    const gx = Math.cos(ca) * cr, gy = Math.sin(ca) * cr;
    // gaussian-ish scatter around the cluster (two hashes -> box-muller-lite)
    const u1 = hash01(k, s, 1, 14), u2 = hash01(k, s, 1, 15);
    const mag = Math.sqrt(-2 * Math.log(u1 + 1e-6)) * YEAST.CLUSTER_SPREAD * 0.5;
    let x = gx + Math.cos(u2 * Math.PI * 2) * mag;
    let y = gy + Math.sin(u2 * Math.PI * 2) * mag;
    // clamp inside FOV
    const rr = Math.hypot(x, y);
    if (rr > YEAST.FOV) { const f = YEAST.FOV / rr; x *= f; y *= f; }
    const dp = hash01(k, s, 2, 16);
    const r = YEAST.BASE_R * (0.72 + YEAST.R_JITTER * hash01(k, s, 2, 17)) * (1 - YEAST.DEPTH_DIM * dp);
    const mi = 2 * k, bi = 2 * k + 1;
    baseX[mi] = x; baseY[mi] = y; depth[mi] = dp; radius0[mi] = r;
    phase[mi] = hash01(k, s, 3, 18) * Math.PI * 2; kind[mi] = 0; seedArr[mi] = hash01(k, s, 3, 19);
    // bud lobe slot: same depth, position offset applied live in cellFrame; radius starts 0
    const dividing = hash01(k, s, 4, 20) < YEAST.DIV_PROB;
    baseX[bi] = x; baseY[bi] = y; depth[bi] = dp; radius0[bi] = 0;
    phase[bi] = hash01(k, s, 4, 21) * Math.PI * 2; kind[bi] = dividing ? 2 : 1; seedArr[bi] = hash01(k, s, 4, 22);
  }
  return {
    count, n, baseX, baseY, depth, radius0, phase, kind, seedArr,
    px: new Float32Array(n), py: new Float32Array(n), pr: new Float32Array(n),
    pd: new Float32Array(n), pbud: new Float32Array(n),
  };
}
```

- [ ] **Step 4: テストが通るのを確認**

Run: `node --test tests/scenes/yeast/yeastDrive.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 5: 全テストが緑を確認**

Run: `npm test`
Expected: 既存 329 ＋新規 3 = 332 pass, 0 fail

- [ ] **Step 6: コミット**

```bash
git add src/scenes/yeast/yeastDrive.js tests/scenes/yeast/yeastDrive.test.mjs
git commit -m "feat(yeast): yeastDrive constants + hash01 + buildCells (deterministic cell layout)"
```

---

## Task 2: yeastDrive — cellFrame（毎フレームのモーション・出芽・分裂）

**Files:**
- Modify: `src/scenes/yeast/yeastDrive.js`（`cellFrame` を追記）
- Test: `tests/scenes/yeast/yeastDrive.test.mjs`（テスト追記）

**Interfaces:**
- Consumes: `YEAST`, `hash01`, `buildCells` の `state`（Task 1）。
- Produces:
  - `export function cellFrame(state, time, audio) -> state`。`state.px,py,pr,pd,pbud`（全 `n` スロット）を書き換える。`audio` は `{bass,mid,beat,level}` 相当（`null` 可＝静穏）。細胞本体は base 位置＋乱流フロー＋ブラウンで漂い、出芽ローブは母の隣に配置され `pbud`（0→1）に応じて `pr` が育つ。

- [ ] **Step 1: 失敗するテストを追記**

Append to `tests/scenes/yeast/yeastDrive.test.mjs`:

```js
import { cellFrame } from '../../../src/scenes/yeast/yeastDrive.js';

test('cellFrame: deterministic for same (state,time,audio); cells stay within FOV+margin', () => {
  const s1 = buildCells(100, 3), s2 = buildCells(100, 3);
  const audio = { bass: 0.6, mid: 0.4, beat: 0, level: 0.5 };
  cellFrame(s1, 12.34, audio); cellFrame(s2, 12.34, audio);
  assert.deepStrictEqual(s1.px, s2.px);
  assert.deepStrictEqual(s1.pr, s2.pr);
  for (let i = 0; i < s1.n; i++) {
    const rr = Math.hypot(s1.px[i], s1.py[i]);
    assert.ok(rr <= YEAST.FOV * 1.12, `slot ${i} within FOV+margin: ${rr}`);
  }
});

test('cellFrame: main-cell radii positive; bud lobe grows 0->1 monotonically over time', () => {
  const s = buildCells(60, 9);
  // find a cell that actually buds (kind of its lobe slot is 1 or 2 AND it is selected to bud)
  let k = -1;
  for (let c = 0; c < s.count; c++) if (hash01(c, 9, 5, 23) < YEAST.BUD_PROB) { k = c; break; }
  assert.ok(k >= 0, 'found a budding cell');
  const bi = 2 * k + 1;
  let prev = -1;
  for (let t = 0; t <= 8; t += 1) {
    cellFrame(s, t, null);
    assert.ok(s.pr[2 * k] > 0, 'main radius stays positive');
    assert.ok(s.pbud[bi] >= prev - 1e-6, `budAmount monotonic at t=${t}: ${s.pbud[bi]} < ${prev}`);
    assert.ok(s.pbud[bi] >= 0 && s.pbud[bi] <= 1, 'budAmount in [0,1]');
    prev = s.pbud[bi];
  }
});

test('cellFrame: louder bass agitates motion more than quiet', () => {
  const quiet = buildCells(80, 4), loud = buildCells(80, 4);
  const base = buildCells(80, 4);
  cellFrame(base, 0, null);
  const bx = Float32Array.from(base.px), by = Float32Array.from(base.py);
  cellFrame(quiet, 0.5, { bass: 0.0, mid: 0, beat: 0, level: 0 });
  cellFrame(loud, 0.5, { bass: 1.0, mid: 0, beat: 0, level: 1 });
  let dq = 0, dl = 0;
  for (let i = 0; i < base.n; i++) {
    dq += Math.hypot(quiet.px[i] - bx[i], quiet.py[i] - by[i]);
    dl += Math.hypot(loud.px[i] - bx[i], loud.py[i] - by[i]);
  }
  assert.ok(dl > dq, `loud agitates more than quiet: ${dl} vs ${dq}`);
});
```

- [ ] **Step 2: テストが失敗するのを確認**

Run: `node --test tests/scenes/yeast/yeastDrive.test.mjs`
Expected: FAIL — `cellFrame is not a function` / import undefined

- [ ] **Step 3: cellFrame を実装（yeastDrive.js に追記）**

Append to `src/scenes/yeast/yeastDrive.js`:

```js
// Smooth deterministic 2D flow (curl-ish): two orthogonal sine fields of position+time.
// No noise texture needed; low frequencies read as slow roaming with no loop point.
function flowAt(x, y, time, ph) {
  const fx = Math.sin(x * 1.7 + time * 0.23 + ph) + Math.cos(y * 1.3 - time * 0.17 + ph * 0.5);
  const fy = Math.cos(x * 1.1 - time * 0.19 - ph) + Math.sin(y * 1.9 + time * 0.13 + ph * 0.7);
  return [fx * 0.5, fy * 0.5];
}

// Advance every slot: main cells roam (flow + brownian, agitation scaled by bass/level),
// bud lobes sit beside their mother and grow (budAmount 0->1, faster on beat), dividers
// drift outward as they mature. Writes px,py,pr,pd,pbud. Deterministic in (state,time,audio).
export function cellFrame(state, time, audio) {
  const a = audio || {};
  const bass = clamp01(a.bass), mid = clamp01(a.mid), lvl = clamp01(a.level), beat = clamp01(a.beat);
  const brown = YEAST.BROWNIAN + (YEAST.BROWNIAN_HOT - YEAST.BROWNIAN) * Math.max(bass, lvl);
  const flowMag = YEAST.FLOW * (0.6 + 0.9 * mid);
  const budRate = YEAST.BUD_GROW * (1 + 1.5 * beat);
  for (let k = 0; k < state.count; k++) {
    const mi = 2 * k, bi = 2 * k + 1;
    const ph = state.phase[mi];
    // main cell: base + slow flow + brownian wobble (brownian uses sin of time*hash => deterministic)
    const fl = flowAt(state.baseX[mi], state.baseY[mi], time, ph);
    const bwx = Math.sin(time * (0.7 + state.seedArr[mi]) + ph) * brown;
    const bwy = Math.cos(time * (0.9 + state.seedArr[mi] * 0.8) + ph * 1.3) * brown;
    let x = state.baseX[mi] + fl[0] * flowMag + bwx;
    let y = state.baseY[mi] + fl[1] * flowMag + bwy;
    const rr = Math.hypot(x, y);
    if (rr > YEAST.FOV) { const f = YEAST.FOV / rr; x *= f; y *= f; }   // soft FOV containment
    state.px[mi] = x; state.py[mi] = y; state.pd[mi] = state.depth[mi];
    state.pr[mi] = state.radius0[mi]; state.pbud[mi] = 0;
    // bud lobe: only if this cell was selected to bud
    const buds = hash01(k, 0, 5, 23) < YEAST.BUD_PROB;   // NOTE: uses seed-independent selection by design (stable per index)
    if (buds) {
      // budAmount ramps with a per-cell phase so cells are asynchronous; saw-like 0->1 then hold near 1
      const grown = Math.min(1, budRate * time * (0.5 + state.seedArr[bi]));
      const dividing = state.kind[bi] === 2;
      const ba = state.phase[bi];
      const dist = state.radius0[mi] * (dividing ? (1.15 + 0.4 * grown) : (0.72 + 0.3 * grown));
      state.px[bi] = x + Math.cos(ba) * dist;
      state.py[bi] = y + Math.sin(ba) * dist;
      state.pd[bi] = state.depth[bi];
      const target = state.radius0[mi] * (dividing ? (0.82 + 0.15 * grown) : (0.48 + 0.28 * grown));
      state.pr[bi] = target * grown;         // grows 0 -> target
      state.pbud[bi] = grown;
    } else {
      state.pr[bi] = 0; state.pbud[bi] = 0;  // no lobe: zero radius => no splat
      state.px[bi] = x; state.py[bi] = y; state.pd[bi] = state.depth[bi];
    }
  }
  return state;
}
```

- [ ] **Step 4: テストが通るのを確認**

Run: `node --test tests/scenes/yeast/yeastDrive.test.mjs`
Expected: PASS（Task1 の 3 ＋ Task2 の 3 = 6）

- [ ] **Step 5: 全テストが緑を確認**

Run: `npm test`
Expected: 332 → 335 pass, 0 fail

- [ ] **Step 6: コミット**

```bash
git add src/scenes/yeast/yeastDrive.js tests/scenes/yeast/yeastDrive.test.mjs
git commit -m "feat(yeast): cellFrame — roaming flow + brownian + async budding/division"
```

---

## Task 3: yeastDrive — driftFrame（見た目ドリフト）＋ bandUniforms（音平滑）

**Files:**
- Modify: `src/scenes/yeast/yeastDrive.js`（`driftFrame`, `bandUniforms` を追記）
- Test: `tests/scenes/yeast/yeastDrive.test.mjs`（テスト追記）

**Interfaces:**
- Consumes: `YEAST`（Task 1）。
- Produces:
  - `export function driftFrame(time, audio, tintMode) -> { density, fusion, fill, focusPlane, rim, halo, tint }`。各値 `[0,1]`。非整数比 LFO の重ね合わせで**アペリオディック**。`tint` は `tintMode==='auto'` のときのみ時間で動き、`'mono'`→0 固定、`'slate'`→1 固定。`time` は「音で少し前進した drift クロック」を scene が渡す（driftFrame 自体は純粋）。
  - `export function bandUniforms(audio, prev, coef) -> prev`。`prev={swell,flow,shimmer,loud}` を各バンドの gain 済みターゲットへ one-pole 平滑。境界 `[0,1]`。

- [ ] **Step 1: 失敗するテストを追記**

Append to `tests/scenes/yeast/yeastDrive.test.mjs`:

```js
import { driftFrame, bandUniforms } from '../../../src/scenes/yeast/yeastDrive.js';

test('driftFrame: deterministic, all fields in [0,1]', () => {
  for (let i = 0; i < 200; i++) {
    const t = i * 0.37;
    const d1 = driftFrame(t, null, 'auto'), d2 = driftFrame(t, null, 'auto');
    for (const key of ['density', 'fusion', 'fill', 'focusPlane', 'rim', 'halo', 'tint']) {
      assert.strictEqual(d1[key], d2[key], `${key} deterministic at t=${t}`);
      assert.ok(d1[key] >= 0 && d1[key] <= 1, `${key} in [0,1] at t=${t}: ${d1[key]}`);
    }
  }
});

test('driftFrame: tint fixed unless auto', () => {
  for (let i = 0; i < 50; i++) {
    const t = i * 1.7;
    assert.strictEqual(driftFrame(t, null, 'mono').tint, 0, 'mono tint = 0');
    assert.strictEqual(driftFrame(t, null, 'slate').tint, 1, 'slate tint = 1');
  }
  // auto tint actually varies over time
  const vals = new Set();
  for (let i = 0; i < 200; i++) vals.add(Math.round(driftFrame(i * 2.3, null, 'auto').tint * 100));
  assert.ok(vals.size > 5, `auto tint varies: ${vals.size} distinct`);
});

test('driftFrame: aperiodic — no short repeat period on density/fusion', () => {
  // For each candidate period, SOME sample differs beyond tolerance => not periodic with that period.
  for (const P of [1, 2, 4, 8, 16]) {
    let maxDiff = 0;
    for (let i = 0; i < 400; i++) {
      const t = i * 0.19;
      const d = Math.abs(driftFrame(t, null, 'auto').density - driftFrame(t + P, null, 'auto').density);
      const f = Math.abs(driftFrame(t, null, 'auto').fusion - driftFrame(t + P, null, 'auto').fusion);
      maxDiff = Math.max(maxDiff, d, f);
    }
    assert.ok(maxDiff > 1e-3, `not periodic with P=${P}: maxDiff=${maxDiff}`);
  }
});

test('bandUniforms: approaches gained targets and decays, bounded [0,1]', () => {
  const prev = { swell: 0, flow: 0, shimmer: 0, loud: 0 };
  const hi = { bass: 1, mid: 1, treble: 1, level: 1 };
  for (let i = 0; i < 300; i++) bandUniforms(hi, prev, 1);
  for (const k of ['swell', 'flow', 'shimmer', 'loud']) assert.ok(prev[k] > 0.95 && prev[k] <= 1, `${k} approached: ${prev[k]}`);
  const p2 = { swell: 0.5, flow: 0.5, shimmer: 0.5, loud: 0.5 };
  for (let i = 0; i < 300; i++) bandUniforms({ bass: 0, mid: 0, treble: 0, level: 0 }, p2, 1);
  for (const k of ['swell', 'flow', 'shimmer', 'loud']) assert.ok(p2[k] >= 0 && p2[k] < 0.05, `${k} decays: ${p2[k]}`);
});
```

- [ ] **Step 2: テストが失敗するのを確認**

Run: `node --test tests/scenes/yeast/yeastDrive.test.mjs`
Expected: FAIL — `driftFrame is not a function`

- [ ] **Step 3: driftFrame と bandUniforms を実装（yeastDrive.js に追記）**

Append to `src/scenes/yeast/yeastDrive.js`:

```js
// Weighted sum of sines with non-integer frequency ratios, normalized to [0,1].
// Distinct frequency sets per field => the "mood" never realigns to a short loop.
function lfo(t, fs) {
  let s = 0, tot = 0;
  for (let i = 0; i < fs.length; i++) { s += fs[i][2] * Math.sin(t * fs[i][0] + fs[i][1]); tot += fs[i][2]; }
  return 0.5 + 0.5 * (s / tot);
}

// The global "look mood": each aesthetic axis wanders aperiodically in [0,1]. The scene
// maps these onto sliders (slider = center, drift = bounded offset). `time` is the
// audio-advanced drift clock kept by the scene, so beats nudge the whole mood forward.
export function driftFrame(time, audio, tintMode) {
  const t = time;
  const lvl = clamp01(audio && audio.level);
  const density = clamp01(lfo(t, [[0.053, 0.0, 1], [0.017, 2.1, 0.6], [0.007, 4.0, 0.4]]) + 0.10 * lvl);
  const fusion = lfo(t, [[0.041, 1.3, 1], [0.019, 3.7, 0.7], [0.011, 5.5, 0.4]]);
  const fill = lfo(t, [[0.037, 0.6, 1], [0.023, 4.4, 0.6]]);
  const focusPlane = lfo(t, [[0.029, 2.7, 1], [0.013, 1.1, 0.5]]);
  const rim = lfo(t, [[0.047, 3.2, 1], [0.021, 0.4, 0.5]]);
  const halo = lfo(t, [[0.031, 5.0, 1], [0.015, 2.9, 0.6]]);
  let tint = 0;
  if (tintMode === 'auto') {
    // black-weighted: bias toward 0 (mono), occasionally rise toward slate
    const raw = lfo(t, [[0.009, 1.7, 1], [0.019, 4.2, 0.5]]);
    tint = clamp01(Math.pow(raw, 2.2));   // pow biases the distribution toward black
  } else if (tintMode === 'slate') tint = 1;
  return { density, fusion, fill, focusPlane, rim, halo, tint };
}

// One-pole smooth the bands toward gained targets (audio strong by default). Mutates + returns prev.
export function bandUniforms(audio, prev, coef) {
  const a = audio || {};
  const gain = coef == null ? 1 : coef;
  const s = YEAST.SMOOTH;
  prev.swell   += (clamp01(clamp01(a.bass) * gain)   - prev.swell) * s;
  prev.flow    += (clamp01(clamp01(a.mid) * gain)    - prev.flow) * s;
  prev.shimmer += (clamp01(clamp01(a.treble) * gain) - prev.shimmer) * s;
  prev.loud    += (clamp01(clamp01(a.level) * gain)  - prev.loud) * s;
  return prev;
}
```

- [ ] **Step 4: テストが通るのを確認**

Run: `node --test tests/scenes/yeast/yeastDrive.test.mjs`
Expected: PASS（6 ＋ 4 = 10）

- [ ] **Step 5: 全テストが緑を確認**

Run: `npm test`
Expected: 335 → 339 pass, 0 fail

- [ ] **Step 6: コミット**

```bash
git add src/scenes/yeast/yeastDrive.js tests/scenes/yeast/yeastDrive.test.mjs
git commit -m "feat(yeast): driftFrame (aperiodic look-drift) + bandUniforms (band smoothing)"
```

---

## Task 4: yeastCore — 場のスプラット（HalfFloat RT）＋パススルー＋視覚ハーネス

**Files:**
- Create: `src/scenes/yeast/yeastCore.js`
- Create: `tests/scenes/yeast/harness.html`

**Interfaces:**
- Consumes: `YEAST`, `buildCells`, `cellFrame`, `driftFrame`, `bandUniforms`（Tasks 1-3）。`THREE`（vendored）。
- Produces:
  - `export function createYeastCore({ THREE, renderer }) -> core`。この Task では API = `resize(w,h)`, `setInstances(state)`, `setUniforms(obj)`, `render()`, `dispose()`。`render()` はスプラット→`fieldRT`（HalfFloat・加算）→パススルーでグレースケール場を画面へ。`setInstances(state)` は `state.px,py,pr,pd,pbud` を per-instance 属性へ upload し `instanceCount` を設定。

この Task はビルド不能なテスト（GLSL/GPU）を避け、`node --check` による構文検証＋ headless 視覚チェックポイントで検証する。

- [ ] **Step 1: yeastCore.js を作成（splat + passthrough）**

Create `src/scenes/yeast/yeastCore.js`:

```js
// src/scenes/yeast/yeastCore.js
// Owns all THREE state for YEAST. Screen-space metaball splat:
//   pass 1 — instanced quads additively splat a Wyvill field into a HalfFloat RT
//   pass 2 — (Task 5) fullscreen iso-threshold shading turns the field into cells
//   pass 3 — (Task 5) UnrealBloom
// This file has NO randomness; all geometry/time/audio arrive via setInstances/setUniforms.
import { YEAST } from './yeastDrive.js';

// --- pass 1: splat. Base quad in [-1,1]^2; instance places it at aCenter with support R.
// gl_Position computed directly in clip space from uViewport (no camera matrices).
const SPLAT_VERT = /* glsl */`
  precision highp float;
  attribute vec3 position;            // base quad corner, xy in [-1,1]
  attribute vec2 aCenter;             // normalized cell center
  attribute float aRadius;            // normalized cell radius (0 => no splat)
  attribute float aDepth;             // [0,1]
  attribute float aBud;               // budAmount [0,1] (bud lobes dim slightly)
  uniform vec2 uViewport;             // drawing-buffer size (px)
  uniform vec2 uHalf;                 // uViewport*0.5
  uniform float uScale;               // 0.5*min(uViewport) — normalized->px, scalar => round FOV
  uniform float uFusion, uFocusPlane, uDof;
  varying vec2 vLocal;
  varying float vAmp;
  void main() {
    float blur = abs(aDepth - uFocusPlane);
    float sup = ${YEAST.SUP_A.toFixed(3)} + ${YEAST.SUP_B.toFixed(3)} * uFusion;
    float Rn = aRadius * sup * (1.0 + ${YEAST.DOF_R.toFixed(3)} * blur * 2.0 * uDof);
    float amp = (1.0 - ${YEAST.DOF_AMP.toFixed(3)} * blur * 2.0 * uDof) * (aBud > 0.001 ? 0.9 : 1.0);
    vLocal = position.xy;
    vAmp = aRadius > 0.0 ? max(amp, 0.0) : 0.0;     // radius 0 => contributes nothing
    vec2 px = aCenter * uScale + uHalf + position.xy * (Rn * uScale);
    vec2 clip = (px / uViewport) * 2.0 - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
`;

const SPLAT_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vLocal;
  varying float vAmp;
  void main() {
    float q = dot(vLocal, vLocal);                  // (d/R)^2 within the quad
    if (q >= 1.0 || vAmp <= 0.0) discard;
    float t = 1.0 - q;
    gl_FragColor = vec4(vAmp * t * t * t, 0.0, 0.0, 1.0);   // Wyvill kernel, additive
  }
`;

// --- pass-through (Task 4 only; replaced by shading in Task 5): show the raw field grayscale.
const FS_VERT = /* glsl */`
  precision highp float;
  attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const PASSTHRU_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uField; varying vec2 vUv;
  void main() { float F = texture2D(uField, vUv).r; float v = clamp(F * 0.6, 0.0, 1.0); gl_FragColor = vec4(v, v, v, 1.0); }
`;

export function createYeastCore({ THREE, renderer }) {
  // ensure half-float color buffers are renderable/blendable on WebGL2
  const gl = renderer.getContext();
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_color_buffer_half_float');

  const N = 2 * YEAST.COUNT;
  // --- splat scene: instanced quads
  const base = new THREE.InstancedBufferGeometry();
  const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  base.setAttribute('position', new THREE.BufferAttribute(quad, 3));
  base.setIndex([0, 1, 2, 0, 2, 3]);
  const aCenter = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
  const aRadius = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  const aDepth = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  const aBud = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  aCenter.setUsage(THREE.DynamicDrawUsage); aRadius.setUsage(THREE.DynamicDrawUsage);
  aDepth.setUsage(THREE.DynamicDrawUsage); aBud.setUsage(THREE.DynamicDrawUsage);
  base.setAttribute('aCenter', aCenter); base.setAttribute('aRadius', aRadius);
  base.setAttribute('aDepth', aDepth); base.setAttribute('aBud', aBud);
  base.instanceCount = N;

  const splatUniforms = {
    uViewport: { value: new THREE.Vector2(1, 1) }, uHalf: { value: new THREE.Vector2(0.5, 0.5) },
    uScale: { value: 1 }, uFusion: { value: 0.6 }, uFocusPlane: { value: 0.5 }, uDof: { value: 0.6 },
  };
  const splatMat = new THREE.RawShaderMaterial({
    uniforms: splatUniforms, vertexShader: SPLAT_VERT, fragmentShader: SPLAT_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const splatScene = new THREE.Scene();
  splatScene.add(new THREE.Mesh(base, splatMat));
  const dummyCam = new THREE.Camera();   // shader ignores it; render() needs some camera

  // --- field RT (HalfFloat, additive target)
  let fieldRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });

  // --- fullscreen pass-through (Task 4). Replaced by shading composer in Task 5.
  const fsQuad = new THREE.BufferGeometry();
  fsQuad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  fsQuad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const showUniforms = { uField: { value: fieldRT.texture } };
  const showMat = new THREE.RawShaderMaterial({ uniforms: showUniforms, vertexShader: FS_VERT, fragmentShader: PASSTHRU_FRAG });
  const showScene = new THREE.Scene();
  showScene.add(new THREE.Mesh(fsQuad, showMat));

  function resize(w, h) {
    renderer.setSize(w, h);
    const v = new THREE.Vector2(); renderer.getDrawingBufferSize(v);
    fieldRT.setSize(v.x, v.y);
    showUniforms.uField.value = fieldRT.texture;
    splatUniforms.uViewport.value.set(v.x, v.y);
    splatUniforms.uHalf.value.set(v.x * 0.5, v.y * 0.5);
    splatUniforms.uScale.value = 0.5 * Math.min(v.x, v.y);
  }
  function setInstances(state) {
    aCenter.array.set(interleaveXY(state.px, state.py, aCenter.array));
    aRadius.array.set(state.pr); aDepth.array.set(state.pd); aBud.array.set(state.pbud);
    aCenter.needsUpdate = aRadius.needsUpdate = aDepth.needsUpdate = aBud.needsUpdate = true;
    if (state.activeSlots != null) base.instanceCount = Math.max(1, Math.min(N, state.activeSlots | 0));
  }
  function setUniforms(o) {
    for (const k in o) { const u = splatUniforms[k]; if (u) u.value = o[k]; }
  }
  function render() {
    renderer.setRenderTarget(fieldRT);
    renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(splatScene, dummyCam);
    renderer.setRenderTarget(null);
    renderer.render(showScene, dummyCam);
  }
  function dispose() {
    base.dispose(); splatMat.dispose(); fsQuad.dispose(); showMat.dispose(); fieldRT.dispose();
  }
  return { resize, setInstances, setUniforms, render, dispose, _splatUniforms: splatUniforms };
}

// pack px[],py[] (length n) into a flat xy array of length 2n
function interleaveXY(px, py, out) {
  for (let i = 0; i < px.length; i++) { out[i * 2] = px[i]; out[i * 2 + 1] = py[i]; }
  return out;
}
```

- [ ] **Step 2: 構文チェック**

Run: `node --check src/scenes/yeast/yeastCore.js`
Expected: 出力なし（構文 OK）。ESM の import は `--check` では解決されないが構文は検証される。

- [ ] **Step 3: 視覚ハーネスを作成**

Create `tests/scenes/yeast/harness.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>yeast harness</title>
<style>html,body{margin:0;background:#000;overflow:hidden}#yeast-gl{display:block}</style>
<script type="importmap">
{ "imports": { "three": "../../../src/vendor/three.module.js", "three/addons/": "../../../src/vendor/three-addons/" } }
</script>
</head><body>
<canvas id="yeast-gl"></canvas>
<script type="module">
import * as THREE from '../../../src/vendor/three.module.js';
import { YEAST, buildCells, cellFrame, driftFrame, bandUniforms } from '../../../src/scenes/yeast/yeastDrive.js';
import { createYeastCore } from '../../../src/scenes/yeast/yeastCore.js';

const Q = new URLSearchParams(location.search);
const size = parseInt(Q.get('size') || '760', 10);
const tintMode = Q.get('tint') || 'auto';           // auto|mono|slate
const scene = Q.get('scene') || 'idle';             // idle|bass|beat
const fixedT = Q.get('t') != null ? parseFloat(Q.get('t')) : null;  // pin drift clock (a "mood")
const cvs = document.getElementById('yeast-gl');
cvs.width = size; cvs.height = size; cvs.style.width = size + 'px'; cvs.style.height = size + 'px';

const renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 1);
const core = createYeastCore({ THREE, renderer });
core.resize(size, size);

const state = buildCells(YEAST.COUNT, 7);
const band = { swell: 0, flow: 0, shimmer: 0, loud: 0 };
const AUDIO = {
  idle: { bass: 0, mid: 0.05, treble: 0.03, beat: 0, level: 0.04 },
  bass: { bass: 0.95, mid: 0.4, treble: 0.2, beat: 0, level: 0.9 },
  beat: { bass: 0.8, mid: 0.5, treble: 0.6, beat: 1, level: 0.85 },
}[scene];

let frame = 0;
function loop() {
  const t = fixedT != null ? fixedT : frame * 0.016;
  cellFrame(state, frame * 0.016, AUDIO);
  const dr = driftFrame(fixedT != null ? fixedT : frame * 0.016, AUDIO, tintMode);
  bandUniforms(AUDIO, band, 1);
  state.activeSlots = 2 * Math.round(YEAST.COUNT * (0.55 + 0.45 * dr.density));
  core.setInstances(state);
  core.setUniforms({ uFusion: dr.fusion, uFocusPlane: dr.focusPlane, uDof: 0.6 });
  // Task 5+ will also drive shading/tint/bloom via core.setDrift/setTint/setBloom here.
  if (core.setDrift) core.setDrift({ fusion: dr.fusion, fill: dr.fill, focusPlane: dr.focusPlane, rim: dr.rim, halo: dr.halo });
  if (core.setTint) core.setTint(dr.tint);
  if (core.setUniforms) core.setUniforms({ uSwell: band.swell, uShimmer: band.shimmer, uExposure: 1.0 });
  if (core.setBloom) core.setBloom(0.6 + 0.8 * band.loud);
  core.render();
  frame++;
  if (frame < 120) requestAnimationFrame(loop); else window.__ready = true;
}
requestAnimationFrame(loop);
</script></body></html>
```

- [ ] **Step 4: headless で場スプラットを実見（視覚チェックポイント）**

Run:
```bash
SHOT=/private/tmp/claude-501/-Users-shiwa-Claude-Atelier-VJ/00583d7b-34ee-4ce0-911c-7a662b779b30/scratchpad/yeast-t4.png
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --use-gl=angle --use-angle=metal \
  --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=1 \
  --virtual-time-budget=6000 --window-size=780,780 \
  --screenshot="$SHOT" \
  "file:///Users/shiwa/Claude-Atelier/VJ/tests/scenes/yeast/harness.html?size=760&scene=idle&tint=mono"
```
Then Read `$SHOT`.
Expected: 黒地に**灰色の場のにじみ**（クラスタ状の丸い blob 群、円形 FOV 内）。まだ細胞のリム/ハローは無い（パススルーの生場）。矩形の継ぎ目やエラーで真っ黒でないこと。**もし真っ黒**なら HalfFloat 加算 RT が描けていない → `renderer.capabilities.isWebGL2` と拡張取得を確認（`--use-angle=metal` を `--use-angle=gl` に替えて再試行）。

- [ ] **Step 5: 全テストが緑を確認（既存テストが壊れていないこと）**

Run: `npm test`
Expected: 339 pass, 0 fail（新規 GPU テストは無し。既存不変）

- [ ] **Step 6: コミット**

```bash
git add src/scenes/yeast/yeastCore.js tests/scenes/yeast/harness.html
git commit -m "feat(yeast): yeastCore pass-1 additive field splat (HalfFloat RT) + visual harness"
```

---

## Task 5: yeastCore — iso 閾値シェーディング＋ composer（RenderPass＋UnrealBloom）

**Files:**
- Modify: `src/scenes/yeast/yeastCore.js`

**Interfaces:**
- Consumes: Task 4 の core 内部（`fieldRT`, `splatScene`, `resize/setInstances/setUniforms`）。既存 vendored addon（`three/addons/postprocessing/{EffectComposer,RenderPass,UnrealBloomPass}.js` — orb で vendored 済・無改変・`tests/scenes/orb/vendor.test.mjs` が担保）。
- Produces: パススルーを**削除**し、`fieldRT` を読む全画面 iso シェーディング（body/rim/halo/nucleus/fill/DoF は splat 側/FOV vignette/tint）を composer 経由で描画。API に追加：`setTint(v)`（`uTint` float `[0,1]`, 0=mono/1=slate）, `setDrift({fusion,fill,focusPlane,rim,halo})`, `setBloom(strength)`, `setMono(rgb)`（palette.fg の白）。`setUniforms` は shading uniform（`uSwell,uShimmer,uExposure`）と splat uniform 両方に配布。

- [ ] **Step 1: シェーディング FRAG を追加（yeastCore.js の SPLAT_FRAG 定義の後に）**

Add to `src/scenes/yeast/yeastCore.js`（`PASSTHRU_FRAG` の隣に新規追加。`PASSTHRU_FRAG` は削除しても良いが、置換のため残置→未使用でも可。DRY のため削除推奨）:

```js
// --- pass 2: fullscreen iso-threshold shading. Reads the field, turns it into translucent
// cell bodies with bright rims, phase-contrast halos, cored nuclei, hollow<->filled interpolation,
// a circular microscope vignette, and a mono<->slate tint. (Ported from the validated mockup.)
const SHADE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uField;
  uniform vec2 uTexel;          // 1/bufW, 1/bufH
  uniform vec2 uHalf;           // bufW/2, bufH/2
  uniform float uScale;         // 0.5*min(buf)
  uniform float uT;             // iso threshold
  uniform float uFill, uRim, uHalo;
  uniform float uSwell, uShimmer, uExposure;
  uniform float uTint;          // 0=mono, 1=slate
  uniform vec3 uMono;           // mono cell color (palette.fg/255)
  uniform float uFov;           // FOV radius (normalized)
  varying vec2 vUv;
  float sm(float a, float b, float x){ x = clamp((x - a) / (b - a), 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
  void main() {
    float F = texture2D(uField, vUv).r;
    float T = uT;
    float val = 0.0;
    if (F > 0.004) {
      float l = texture2D(uField, vUv - vec2(uTexel.x, 0.0)).r;
      float r = texture2D(uField, vUv + vec2(uTexel.x, 0.0)).r;
      float u = texture2D(uField, vUv - vec2(0.0, uTexel.y)).r;
      float d = texture2D(uField, vUv + vec2(0.0, uTexel.y)).r;
      float gmag = length(vec2(r - l, d - u));
      float rimW = T * (0.40 + 0.35 / max(0.2, uRim));
      float body = sm(T * 0.86, T * 1.16, F);
      float e = (F - T) / rimW;
      float rim = exp(-e * e) * (0.45 + 1.5 * min(1.0, gmag * 7.0));
      rim *= 1.0 + uShimmer * 0.8;                 // TREBLE: rim shimmer
      float o = T - F;
      float halo = 0.0;
      if (o > 0.0) {
        float h1 = (o - T * 0.55) / (T * 0.42);
        float h2 = (o - T * 1.5) / (T * 0.7);
        halo = exp(-h1 * h1) + 0.55 * exp(-h2 * h2);
        halo *= exp(-o * 3.4);
        halo *= 1.0 + uShimmer * 0.6;              // TREBLE: halo flicker
      }
      float nuc = sm(T * 2.1, T * 3.9, F);
      val = body * uFill + rim * uRim * 0.5 + halo * uHalo * 0.42 - nuc * 0.20;
      val = max(val, 0.0);
      val = pow(val, 0.88) * uExposure * (1.0 + uSwell * 0.5);   // BASS: swell brightens
    }
    vec2 pc = (gl_FragCoord.xy - uHalf) / uScale;
    float dist = length(pc);
    float vig = sm(uFov * 1.02, uFov * 0.80, dist);
    vec3 slateBg = vec3(18.0, 27.0, 38.0) / 255.0;
    vec3 slateLt = vec3(205.0, 219.0, 232.0) / 255.0;
    vec3 bg = mix(vec3(0.0), slateBg * (0.28 + 0.72 * vig), uTint);
    vec3 cell = mix(uMono * val * vig, slateLt * val, uTint);
    gl_FragColor = vec4(bg + cell, 1.0);
  }
`;
```

- [ ] **Step 2: composer/shading を core に組み込む（import ＋ 生成 ＋ API ＋ render 差し替え）**

Edit `src/scenes/yeast/yeastCore.js`:

(a) ファイル冒頭の import に追記:
```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
```

(b) `createYeastCore` 内、パススルー（`showUniforms/showMat/showScene`）を**削除**し、代わりにシェーディング scene＋composer を作る:
```js
  // --- pass 2: fullscreen shading scene (PlaneGeometry(2,2) fills clip space; vUv from uv)
  const shadeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const shadeUniforms = {
    uField: { value: fieldRT.texture },
    uTexel: { value: new THREE.Vector2(1, 1) }, uHalf: { value: new THREE.Vector2(0.5, 0.5) }, uScale: { value: 1 },
    uT: { value: YEAST.ISO_T }, uFill: { value: 0.34 }, uRim: { value: 1.0 }, uHalo: { value: 0.7 },
    uSwell: { value: 0 }, uShimmer: { value: 0 }, uExposure: { value: 1.0 },
    uTint: { value: 0 }, uMono: { value: new THREE.Color(1, 1, 1) }, uFov: { value: YEAST.FOV },
  };
  const shadeMat = new THREE.ShaderMaterial({
    uniforms: shadeUniforms,
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: SHADE_FRAG, depthTest: false, depthWrite: false,
  });
  const shadeScene = new THREE.Scene();
  shadeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shadeMat));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(shadeScene, shadeCam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.2);   // strength/radius/threshold
  composer.addPass(bloom);
```

(c) `resize(w,h)` の中で、`showUniforms.uField...` の行を**削除**し、シェーディング uniform を更新:
```js
    shadeUniforms.uField.value = fieldRT.texture;
    shadeUniforms.uTexel.value.set(1 / v.x, 1 / v.y);
    shadeUniforms.uHalf.value.set(v.x * 0.5, v.y * 0.5);
    shadeUniforms.uScale.value = 0.5 * Math.min(v.x, v.y);
    composer.setSize(w, h);
```

(d) `setUniforms(o)` を splat＋shading 両方へ配布するよう差し替え:
```js
  function setUniforms(o) {
    for (const k in o) {
      if (splatUniforms[k]) splatUniforms[k].value = o[k];
      if (shadeUniforms[k]) shadeUniforms[k].value = o[k];
    }
  }
```

(e) 新 API を追加（`setInstances` の後あたり）:
```js
  function setDrift(d) {
    if (d.fusion != null) splatUniforms.uFusion.value = d.fusion;
    if (d.focusPlane != null) splatUniforms.uFocusPlane.value = d.focusPlane;
    if (d.fill != null) shadeUniforms.uFill.value = 0.20 + 0.42 * d.fill;   // hollow<->filled band
    if (d.rim != null) shadeUniforms.uRim.value = 0.55 + 0.95 * d.rim;
    if (d.halo != null) shadeUniforms.uHalo.value = 0.30 + 0.85 * d.halo;
  }
  function setTint(v) { shadeUniforms.uTint.value = v < 0 ? 0 : v > 1 ? 1 : v; }
  function setMono(rgb) { const c = shadeUniforms.uMono.value; c.r = rgb[0] / 255; c.g = rgb[1] / 255; c.b = rgb[2] / 255; }
  function setBloom(s) { bloom.strength = s; }
```

(f) `render()` を composer 経由へ差し替え（パススルー描画を削除）:
```js
  function render() {
    renderer.setRenderTarget(fieldRT);
    renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(splatScene, dummyCam);
    renderer.setRenderTarget(null);
    composer.render();
  }
```

(g) `dispose()` に composer/bloom/shade を追加、削除した show 系を除去:
```js
  function dispose() {
    base.dispose(); splatMat.dispose(); shadeMat.dispose(); fieldRT.dispose();
    if (bloom.dispose) bloom.dispose(); if (composer.dispose) composer.dispose();
  }
```

(h) `return { ... }` に新 API を追加:
```js
  return { resize, setInstances, setUniforms, setDrift, setTint, setMono, setBloom, render, dispose };
```

- [ ] **Step 3: 構文チェック**

Run: `node --check src/scenes/yeast/yeastCore.js`
Expected: 出力なし（構文 OK）

- [ ] **Step 4: headless で実細胞を実見（複数 mood）**

Run（4 枚：mono idle / slate idle / bass / 別 mood）:
```bash
DIR=/private/tmp/claude-501/-Users-shiwa-Claude-Atelier-VJ/00583d7b-34ee-4ce0-911c-7a662b779b30/scratchpad
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FLAGS="--headless=new --use-gl=angle --use-angle=metal --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=1 --virtual-time-budget=6000 --window-size=780,780"
BASE="file:///Users/shiwa/Claude-Atelier/VJ/tests/scenes/yeast/harness.html?size=760"
"$CHROME" $FLAGS --screenshot="$DIR/yeast-t5-mono.png"  "$BASE&scene=idle&tint=mono&t=3"
"$CHROME" $FLAGS --screenshot="$DIR/yeast-t5-slate.png" "$BASE&scene=idle&tint=slate&t=3"
"$CHROME" $FLAGS --screenshot="$DIR/yeast-t5-bass.png"  "$BASE&scene=bass&tint=mono&t=3"
"$CHROME" $FLAGS --screenshot="$DIR/yeast-t5-mood.png"  "$BASE&scene=idle&tint=mono&t=41"
```
Then Read the four PNGs.
Expected:
- `mono`：黒地に**白く半透明の酵母細胞**、明るいリム、位相差ハロー、出芽ペア（figure-8）、円形 FOV ビネット。
- `slate`：スレートブルー地に白クリスプ細胞＋縁の暗いスレート。**寒色低彩度のみ（虹色無し）**。
- `bass`：全体が明るく沸き（swell）、ブルームがのっている。
- `mood`（t=41）：`t=3` と密度/融合/塗り/焦点が**目に見えて違う**（見た目ドリフトの別位相）。
- 虹色・矩形継ぎ目・真っ黒（全滅）が無いこと。

- [ ] **Step 5: 全テストが緑を確認**

Run: `npm test`
Expected: 339 pass, 0 fail（コード変更は yeastCore のみ、既存不変）

- [ ] **Step 6: コミット**

```bash
git add src/scenes/yeast/yeastCore.js
git commit -m "feat(yeast): iso-threshold shading (rim/halo/nucleus/fill/DoF/FOV/tint) + bloom composer"
```

---

## Task 6: YeastScene ＋ index.html canvas ＋ registry（統合）

**Files:**
- Create: `src/scenes/yeast/YeastScene.js`
- Modify: `index.html`（CSS セレクタ群 ＋ canvas 要素）
- Modify: `src/scenes/registry.js`（import ＋ instance）

**Interfaces:**
- Consumes: `Scene`（`../Scene.js`）, `THREE`（`../../vendor/three.module.js`）, `createYeastCore`（Task 5）, `YEAST/buildCells/cellFrame/driftFrame/bandUniforms`（Tasks 1-3）。
- Produces: `export class YeastScene extends Scene`。`super('yeast','YEAST')`。params（`density,size,fusion,fill,rim,halo,dof,driftSpeed,budRate,flow,audioGain,bloom,exposure`）＋ modeGroup `tint`（AUTO/MONO/SLATE 既定 AUTO）。`_ensureCore()` 遅延生成。`update` で drive→uniforms 配線、`draw` で opacity 合成。registry から `new YeastScene()` で選択可能。

- [ ] **Step 1: YeastScene.js を作成**

Create `src/scenes/yeast/YeastScene.js`:

```js
// src/scenes/yeast/YeastScene.js
// Scene adapter for the WebGL YEAST field. Mirrors OrbScene's opacity-composited pattern:
// a dedicated #yeast-gl canvas with a lazily-created WebGLRenderer, shown by writing
// canvas.style.opacity = alpha in draw() and 0 in onExit(). The PURE yeastDrive supplies
// cell geometry, aperiodic look-drift, and band smoothing; this adapter wires them to the core.
import * as THREE from '../../vendor/three.module.js';
import { Scene } from '../Scene.js';
import { createYeastCore } from './yeastCore.js';
import { YEAST, buildCells, cellFrame, driftFrame, bandUniforms } from './yeastDrive.js';

const TINT_MODES = ['auto', 'mono', 'slate'];   // modeGroup 'tint' index -> yeastDrive tintMode

export class YeastScene extends Scene {
  constructor() {
    super('yeast', 'YEAST');
    this._core = null; this._renderer = null; this._gl = null;
    this._state = buildCells(YEAST.COUNT, 7);                         // deterministic layout (seed 7)
    this._band = { swell: 0, flow: 0, shimmer: 0, loud: 0 };
    this._driftClock = 0;                                             // audio-advanced drift time
    // Named button-group (plain array, NOT a getter — base Scene ctor assigns modeGroups=null).
    this.modeGroups = [
      { label: '地色', key: 'tint', index: 0, options: ['オート', 'モノ', 'スレート'] },
    ];
    this.defineParam('density', 0.6, 0, 1, 0.02, '密度')
        .defineParam('size', 1.0, 0.6, 1.6, 0.01, 'サイズ')
        .defineParam('fusion', 0.6, 0, 1, 0.02, '融合')
        .defineParam('fill', 0.5, 0, 1, 0.02, '塗り')
        .defineParam('rim', 0.6, 0, 1, 0.02, 'リム')
        .defineParam('halo', 0.6, 0, 1, 0.02, 'ハロー')
        .defineParam('dof', 0.6, 0, 1, 0.02, '被写界深度')
        .defineParam('driftSpeed', 0.5, 0, 2, 0.02, '見た目ドリフト')
        .defineParam('budRate', 1.0, 0, 2, 0.02, '出芽率')
        .defineParam('flow', 1.0, 0, 2, 0.02, '回遊')
        .defineParam('audioGain', 1.1, 0, 2.5, 0.02, '音の深さ')
        .defineParam('bloom', 0.6, 0, 2, 0.02, 'ブルーム')
        .defineParam('exposure', 1.0, 0.4, 2.0, 0.02, '露光');
  }

  _ensureCore() {
    if (this._core) return;
    this._gl = document.getElementById('yeast-gl');
    this._renderer = new THREE.WebGLRenderer({ canvas: this._gl, antialias: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 1);
    this._core = createYeastCore({ THREE, renderer: this._renderer });
    this._core.resize(this.w || innerWidth, this.h || innerHeight);
  }

  init(ctx, w, h) { this.w = w; this.h = h; this._ensureCore(); this._core.resize(w, h); }
  onResize(w, h) { this.w = w; this.h = h; if (this._core) this._core.resize(w, h); }

  update(dt, audio, palette, clock) {
    if (!this._core) return;
    const t = clock ? clock.time : 0;
    const a = audio || {};
    const gain = this.p('audioGain');
    const band = bandUniforms(a, this._band, gain);
    // advance the drift clock by dt, sped by the driftSpeed slider and nudged forward on beats
    this._driftClock += dt * this.p('driftSpeed') * (1 + 1.2 * (a.beat || 0));

    // motion + budding (geometry) — reads audio for agitation/flow/bud-pop
    const budAudio = { bass: a.bass, mid: (a.mid || 0) * this.p('flow'), beat: (a.beat || 0) * this.p('budRate'), level: a.level };
    cellFrame(this._state, t, budAudio);

    // aperiodic look-drift; slider = center, drift = bounded offset around it
    const mode = TINT_MODES[this.mg('tint')];
    const dr = driftFrame(this._driftClock, a, mode);
    const off = (v, c, amp) => Math.max(0, Math.min(1, c + (v - 0.5) * 2 * amp));  // center c, ±amp
    const fusion = off(dr.fusion, this.p('fusion'), 0.35);
    const fill = off(dr.fill, this.p('fill'), 0.30);
    const rim = off(dr.rim, this.p('rim'), 0.30);
    const halo = off(dr.halo, this.p('halo'), 0.30);
    const density = off(dr.density, this.p('density'), 0.25);
    this._state.activeSlots = 2 * Math.max(8, Math.round(YEAST.COUNT * (0.45 + 0.55 * density)));

    this._core.setInstances(this._state);
    this._core.setUniforms({ uDof: this.p('dof'), uSwell: band.swell, uShimmer: band.shimmer,
      uExposure: this.p('exposure') * (1 + 0.5 * band.loud) * this.p('size') });   // size lifts apparent scale via exposure? see note
    this._core.setDrift({ fusion, fill, focusPlane: dr.focusPlane, rim, halo });
    this._core.setTint(dr.tint);
    if (palette && palette.fg) this._core.setMono(palette.fg);
    // adaptive: under low quality, dim bloom first (cheapest win)
    const q = clock && clock.quality != null ? clock.quality : 1;
    this._core.setBloom(this.p('bloom') * (0.6 + 0.8 * band.loud) * (q < 1 ? Math.max(0.4, q) : 1));
  }

  draw(ctx, alpha) {
    if (!this._gl || !this._core) return;
    this._core.render();
    this._gl.style.opacity = String(alpha);
  }

  onExit() { this._gl && (this._gl.style.opacity = 0); }
  dispose() {
    if (this._gl) this._gl.style.opacity = 0;
    if (this._core) this._core.dispose();
    if (this._renderer) this._renderer.dispose();
    this._core = null; this._renderer = null;
  }
}
```

> **NOTE on `size`:** `size` should scale apparent cell scale. The cleanest lever is a `uSize` uniform multiplying `uScale` in the splat (bigger cells) — but to avoid touching Task 5's shading distance metric, this task folds `size` into `exposure` as a placeholder ONLY IF a dedicated lever is not added. **Preferred:** add a `uSize` uniform to the splat (`Rn *= uSize` and `aCenter*uScale*uSize`? no — scaling positions changes FOV). Instead scale ONLY radius: in `setUniforms` pass `uSizeR` and multiply `Rn` by it in SPLAT_VERT. Implement the radius-only version below in Step 2 and remove the `* this.p('size')` from exposure.

- [ ] **Step 2: `size` を半径スケールとして正しく配線（splat に `uSizeR`）**

Edit `src/scenes/yeast/yeastCore.js`:

(a) `splatUniforms` に追加: `uSizeR: { value: 1 },`

(b) SPLAT_VERT の `Rn` 定義に乗算:
```glsl
    uniform float uSizeR;
    ...
    float Rn = aRadius * sup * (1.0 + ${YEAST.DOF_R.toFixed(3)} * blur * 2.0 * uDof) * uSizeR;
```

Edit `src/scenes/yeast/YeastScene.js` の `update` 内の `setUniforms` を:
```js
    this._core.setUniforms({ uDof: this.p('dof'), uSizeR: this.p('size'),
      uSwell: band.swell, uShimmer: band.shimmer, uExposure: this.p('exposure') * (1 + 0.5 * band.loud) });
```
（`* this.p('size')` を exposure から除去済みであること）

- [ ] **Step 3: index.html に canvas を配線**

Edit `index.html`:

(a) CSS セレクタ（line 40 付近）を:
```css
    #city-gl, #orb-gl, #yeast-gl {
```

(b) `<canvas id="orb-gl"></canvas>`（line 55）の直後に:
```html
  <canvas id="yeast-gl"></canvas>
```

- [ ] **Step 4: registry に登録**

Edit `src/scenes/registry.js`:

(a) import 群（`import { OrbScene } ...` の下）に:
```js
import { YeastScene } from './yeast/YeastScene.js';
```

(b) `new OrbScene(),` の下に:
```js
    new YeastScene(),
```

- [ ] **Step 5: 構文チェック＋全テスト**

Run: `node --check src/scenes/yeast/YeastScene.js && node --check src/scenes/registry.js && npm test`
Expected: 構文 OK。テスト 339 pass, 0 fail（registry は import されるがテストはシーン数を数えないため不変。もし registry のシーン数を数えるテストがあれば +1 を反映）。

- [ ] **Step 6: headless で本体経由の描画を実見**

Run（本体 index.html を開き、YEAST シーンへ切替えて自撮り。city/orb と同じ devshot 流儀。ローカル dev サーバ :8125 が動いていれば URL で、無ければ file:// ＋ 自動切替スクリプト）:
```bash
# 既存 devshot ハーネス（.superpowers/sdd/devshot/shot.mjs）が engine 起動+シーン切替+自撮りを行う。
# 無い場合は Task 4/5 の harness.html を使って yeastCore 経由の描画は既に実見済み。
# ここでは本体統合の“黒転び/例外”が無いことを console で確認:
node -e "console.log('registry import check');" # placeholder — 実確認は headless engine 切替で行う
```
Expected: YEAST を選ぶと `#yeast-gl` に酵母フィールドが出て、他シーンへ戻すと opacity=0 で消える。コンソール例外無し。**（この統合視覚確認は Task 7 の視覚ゲートで最終化する。）**

- [ ] **Step 7: コミット**

```bash
git add src/scenes/yeast/YeastScene.js src/scenes/yeast/yeastCore.js index.html src/scenes/registry.js
git commit -m "feat(yeast): YeastScene adapter + canvas/registry wiring (tint modeGroup, drift+audio uniforms, size lever)"
```

---

## Task 7: 最終 headless 視覚検証ゲート

**Files:**
- （プロダクションコード変更なし。`tests/scenes/yeast/harness.html` は Task 4 で作成済・Task 6 の新 API を既に呼ぶ。）

**Interfaces:**
- Consumes: 完成した 3 ファイル＋ harness。
- Produces: 各“気分”/音状態/tint の実見 PASS 記録（`verify-visual-before-claiming` 準拠）。欠陥があれば該当 Task へ差し戻し。

- [ ] **Step 1: 8 状態を headless 撮影**

Run:
```bash
DIR=/private/tmp/claude-501/-Users-shiwa-Claude-Atelier-VJ/00583d7b-34ee-4ce0-911c-7a662b779b30/scratchpad
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FLAGS="--headless=new --use-gl=angle --use-angle=metal --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=1 --virtual-time-budget=7000 --window-size=800,800"
B="file:///Users/shiwa/Claude-Atelier/VJ/tests/scenes/yeast/harness.html?size=780"
"$CHROME" $FLAGS --screenshot="$DIR/yeast-g1-idle.png"    "$B&scene=idle&tint=mono&t=3"    # 瞑想アイドル
"$CHROME" $FLAGS --screenshot="$DIR/yeast-g2-ring.png"    "$B&scene=idle&tint=mono&t=17"   # 中空リング寄り mood
"$CHROME" $FLAGS --screenshot="$DIR/yeast-g3-filled.png"  "$B&scene=idle&tint=mono&t=41"   # 詰まり寄り mood
"$CHROME" $FLAGS --screenshot="$DIR/yeast-g4-discrete.png" "$B&scene=idle&tint=mono&t=63"  # 低融合 mood
"$CHROME" $FLAGS --screenshot="$DIR/yeast-g5-slate.png"   "$B&scene=idle&tint=slate&t=29"  # スレート顕微鏡
"$CHROME" $FLAGS --screenshot="$DIR/yeast-g6-bass.png"    "$B&scene=bass&tint=mono&t=29"   # 低音エラプト
"$CHROME" $FLAGS --screenshot="$DIR/yeast-g7-beat.png"    "$B&scene=beat&tint=mono&t=29"   # ビート(出芽ポップ/シマー)
"$CHROME" $FLAGS --screenshot="$DIR/yeast-g8-auto.png"    "$B&scene=idle&tint=auto&t=88"   # AUTO 地色ドリフト
```
Then Read all 8.

- [ ] **Step 2: 各画像を判定（合格基準）**

各カットで確認し、記録する：
- **g1 idle**：静かな酵母フィールド、白半透明細胞＋リム＋ハロー、円形 FOV、出芽ペア。虹色/矩形/全滅なし。
- **g2/g3/g4**：`t` 違いで**中空↔詰まり／融合↔離散が目に見えて変化**（見た目ドリフトが効いている）。
- **g5 slate**：スレート地＋白クリスプ細胞、寒色低彩度のみ。
- **g6 bass**：全体スウェル＋ブルームで沸く（g1 より明るく大きく感じる）。
- **g7 beat**：リム/ハローのシマー、出芽が育っている。
- **g8 auto**：g1(mono) と**地色が違う**（黒優勢の中でスレート寄りに漂った位相）。
- いずれかが不合格 → 原因の Task（1-6）へ差し戻し、修正後に再撮影。

- [ ] **Step 3: crossfade-hide を確認**

harness に `&fade=0` を付けて（もしくは OrbScene 同様、`onExit` 相当で opacity=0 になることをコードで確認）、非アクティブ時に `#yeast-gl` が完全に消えることを Read で確認。
Expected: opacity=0 で下のシーンが透ける（残像なし）。
（harness は単体なので、この項目は本体統合の `onExit()`／`draw(alpha)` のコードレビューで担保：`draw` が `opacity=alpha`、`onExit`/`dispose` が `opacity=0` を設定していること — Task 6 実装で確認済み。）

- [ ] **Step 4: ledger と進捗を記録**

`.superpowers/sdd/progress.md` に YEAST の完了行を追記（SDD 実行時、controller が各 Task 完了ごとに追記）。視覚ゲート 8/8 の PASS/該当スクショ名を記す。

- [ ] **Step 5: 最終コミット（記録のみ・コード無変更なら不要）**

視覚ゲートでコード修正が発生した場合のみ、その Task のコミットに含める。ゲート自体は記録タスク。

---

## Self-Review（この計画 vs spec）

**1. Spec coverage:**
- スクリーン空間メタボール・スプラット（中間技法）→ Task 4（場スプラット）＋ Task 5（iso シェーディング）。✅
- リム/半透明/核/位相差ハロー → Task 5 SHADE_FRAG（rim/body/nuc/halo）。✅
- 被写界深度（focusPlane vs dof 別軸）→ Task 5 splat VS（`blur=abs(depth-uFocusPlane)`, `uDof`）＋ driftFrame focusPlane。✅
- 出芽/分裂（非同期）→ Task 2 cellFrame（budAmount 0→1、per-cell phase、div フラグ）。✅
- 密度&スケール → density ドリフト→`activeSlots`（Task 6）＋ `size`→`uSizeR`（Task 6 Step 2）。✅
- 見た目ドリフト（アペリオディック・全質感巡回・tint 含む）→ Task 3 driftFrame ＋ Task 6 で中心±offset マッピング＋ driftSpeed=0 ピン留め。✅
- 地色 AUTO/MONO/SLATE（既定 AUTO）→ Task 6 modeGroup `tint` ＋ Task 5 `uTint` lerp。✅
- 音反応（bass 撹拌/スウェル・beat 出芽ポップ/シマー・mid フロー・treble シマー/明滅・無音減衰）→ Task 2（bass/mid/beat が geometry）＋ Task 3 bandUniforms ＋ Task 6 uniforms。✅
- 決定論・単体テスト → Task 1-3（10 tests：決定論/範囲/単調/アペリオディック/減衰）。✅
- 統合パリティ（`#yeast-gl`/opacity/lazy/registry 1 行/既存無改変）→ Task 6。✅
- HalfFloat RT → Task 4。✅
- headless 視覚検証 → Task 4/5 チェックポイント＋ Task 7 ゲート。✅
- モノ＋寒色のみ・虹色禁止 → Task 5 tint（black/white/slate のみ）＋各視覚ゲートで確認。✅

**2. Placeholder scan:** Task 6 の `size` は当初 exposure 仮置き → Step 2 で `uSizeR` に正した（プレースホルダ解消）。Task 6 Step 6 の `node -e placeholder` は「本体 engine 切替の実確認は Task 7 ゲートで最終化」と明記済（統合の黒転び確認をゲートに集約）。他に TBD/TODO なし。

**3. Type consistency:**
- `buildCells` 返り値の全フィールド（`count,n,baseX,baseY,depth,radius0,phase,kind,seedArr,px,py,pr,pd,pbud`）を Task 2 cellFrame・Task 4 setInstances・Task 6 が同名で参照。✅
- core API：`resize/setInstances/setUniforms/setDrift/setTint/setMono/setBloom/render/dispose` を Task 5 で確定し Task 6 が同名呼び出し。✅
- `driftFrame` 返り値 `{density,fusion,fill,focusPlane,rim,halo,tint}` を Task 6 が全キー消費。✅
- uniform 名：`uFusion/uFocusPlane/uDof/uSizeR`（splat）, `uT/uFill/uRim/uHalo/uSwell/uShimmer/uExposure/uTint/uMono/uFov/uTexel/uHalf/uScale`（shade）— Task 5 定義と Task 6 setUniforms/setDrift のキーが一致。✅
- `state.activeSlots` を Task 4 setInstances が読み、Task 6 が書く。✅

---

## 実行ハンドオフ

この計画を保存後、実行方式を選ぶ（writing-plans 規約）：
1. **Subagent-Driven（推奨）** — Task ごとに fresh subagent ＋ タスクレビュー ＋ 最後に whole-branch レビュー。orb と同じ流儀。
2. **Inline Execution** — このセッションで executing-plans。

デプロイは別途・**ユーザーの明示承認後のみ**（`deploy-verify-bare-url` 準拠）。
