# CityScope 第1陣 実装Plan（土台レイヤ＋Tier1 3モード）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（または subagent-driven-development）でタスク毎に実装。各ステップは `- [ ]` で追跡。

**Goal:** LIVE（固定カメラ）で各建物が音/ビートに連動して建つ・縮む・消える「CityScope」レイヤを据え、純解析の3モード（③スキャンバー・⑤都市の呼吸・⑦沈黙と開花）と空間3択（同心円/並木/両方）＋A/B比率スライダーを画面HUDから操作可能にする。

**Architecture:** reveal.js が `transformed.y` を所有し続ける。新レイヤ CityScope は **CPUが純JSで毎フレ `scope[建物]∈[0,1]` を計算 → building-index データテクスチャへアップ → reveal シェーダが building index で1回 lookup し `transformed.y = mix(aBaseY, fullY, _rv * scope)`** を適用する。モードmathは全てJS純関数（`scopeModes.js`）＝CPU検証mathと実機mathが同一（GLSL/JS二重化なし＝false-green防止）。`scope=1`（無効/INTRO/無音）で現状ピクセル完全一致。

**Tech Stack:** buildless ESM, three vendored (`src/vendor/three.module.js`), node `--test`, CPUラスタライザ検証（scratchpad）。iPad PWA。

## Global Constraints（spec 守る線 / 各タスクで遵守）

- glb・manifest **byte不変**：`git status --short -- tools/citybake/dist/` が空（純ランタイム、再ベイク無）。
- **OFF で現状一致**：`uScopeEnabled=0`（INTRO/無効）で現状look完全復帰。INTRO の `_rv` 経路・段階ズーム/四季/粒子に触れない。
- scope は **LIVE のみ**作動（LIVE は intro 完了＝並木リビール済みなので追加ゲート不要）。
- **mono 単一チャンネルのみ**・色相変化/グロー/再ライティング無・`THREE.NormalBlending` 系不変。明度/高さ/可視性の変調だけ。
- **≤3Hz**・**決定論**（`hash01` のみ、`Math.random`/`Date` 禁止）。
- 「図解」リグレッション禁止：音駆動の一時変調で無音時に消える層（静的per-buildingグレー個体差ではない）。
- 他レイヤ無編集：terrain/station/roads/trees/particles/seasons/shotDir カメラ/2D配信地図。
- false-green 禁止：各モード「できた」前に実 glb＋実テクスチャ math の CPU ラスタPNGで視覚確認。
- 既存テスト（159 green）は不変で維持。

## File Structure

- **Create** `src/cityproto/scopeModes.js` — 純関数モード registry（`scope[建物]` 算出）。THREE/RNG/Date 無。
- **Create** `src/cityproto/cityScope.js` — 純コア（geom 構築・frameUniforms・computeScope）＋薄い factory（毎フレ reveal へ書く）。
- **Create** `tests/cityproto/scopeModes.test.mjs`, `tests/cityproto/cityScope.test.mjs`。
- **Modify** `src/cityproto/reveal.js` — `aBuildIndex` 属性＋scopeテクスチャ uniform＋シェーダ patch（lookup×1）＋ハンドル返却。
- **Modify** `src/cityproto/proto.js` — geom 構築・cityScope 生成・driver ctx 受け渡し・`window.__proto.setScope`。
- **Modify** `src/cityproto/liveDriver.js` — LIVE ブロックで `ctx.cityScope.frame(...)` 呼び出し。
- **Modify** `city-proto.html` — CityScope HUD（モード循環・空間3択・mix/比率スライダー・ON/OFF）。
- **Create**（scratchpad・未コミット） `scope_verify.mjs` — CPUラスタで各モード×空間を montage。

---

### Task 1: `hash01` と純ユーティリティ（scopeModes 土台）

**Files:**
- Create: `src/cityproto/scopeModes.js`
- Test: `tests/cityproto/scopeModes.test.mjs`

**Interfaces:**
- Produces: `hash01(n:number)→[0,1)`, `clamp(x,a,b)`, `lerp(a,b,t)`, `smooth01(x)→[0,1]`（shotDirector と同式・決定論）。

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/cityproto/scopeModes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash01, clamp, lerp, smooth01 } from '../../src/cityproto/scopeModes.js';

test('hash01 deterministic & in [0,1)', () => {
  for (let i = 0; i < 50; i++) {
    const a = hash01(i), b = hash01(i);
    assert.equal(a, b);
    assert.ok(a >= 0 && a < 1, `hash01(${i})=${a}`);
  }
  assert.notEqual(hash01(1), hash01(2));
});

test('clamp/lerp/smooth01 basics', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(smooth01(0), 0);
  assert.equal(smooth01(1), 1);
  assert.ok(Math.abs(smooth01(0.5) - 0.5) < 1e-9);
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/cityproto/scopeModes.test.mjs`
Expected: FAIL（`Cannot find module` / `hash01 is not a function`）。

- [ ] **Step 3: 最小実装**

```js
// src/cityproto/scopeModes.js
// CityScope モード registry — PURE（THREE/DOM/RNG/Date 無、hash01 のみ）。各モードは
// (geom, frameUniforms, cfg) から建物ごとの reveal 係数 scope∈[0,1] を返す純関数。
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
// 整数 → [0,1) の決定論ハッシュ（shotDirector.hash01 と同一式）。
export function hash01(n) {
  let h = (Math.floor(n) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}
```

- [ ] **Step 4: パス確認**

Run: `node --test tests/cityproto/scopeModes.test.mjs`
Expected: PASS（2 tests）。

- [ ] **Step 5: commit**

```bash
git add src/cityproto/scopeModes.js tests/cityproto/scopeModes.test.mjs
git commit -m "feat(cityproto): CityScope 純ユーティリティ(hash01/clamp/lerp/smooth01)"
```

---

### Task 2: 空間 geom 構築（建物ごとの正規化 radius / avenue-Z）

**Files:**
- Create: `src/cityproto/cityScope.js`
- Test: `tests/cityproto/cityScope.test.mjs`

**Interfaces:**
- Consumes: manifest 形 `perBuilding[b] = {revealKey, vStart, vCount}`（`bake/manifest.mjs`）。
- Produces: `buildScopeGeom(perBuilding, getWorldZ) → { radius:Float32Array, zc:Float32Array }`。
  - `radius[b] = revealKey[b]/max(revealKey)`（駅からの正規化距離 ∈[0,1]）。
  - `zc[b]` = 建物頂点の world Z 平均を全建物 min/max で正規化（南端0→北端/駅側1 ∈[0,1]）。

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/cityproto/cityScope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScopeGeom } from '../../src/cityproto/cityScope.js';

// 3 建物: vStart/vCount/revealKey、worldZ は index で与える合成データ
const PB = [
  { revealKey: 0, vStart: 0, vCount: 2 },   // 駅 (radius 0), z 小
  { revealKey: 5, vStart: 2, vCount: 2 },   // 中間 (radius .5), z 中
  { revealKey: 10, vStart: 4, vCount: 2 },  // 外周 (radius 1), z 大
];
const Z = [0, 0, 10, 10, 20, 20];           // 頂点 i の world Z
const getWorldZ = (i) => Z[i];

test('radius normalized by max revealKey', () => {
  const { radius } = buildScopeGeom(PB, getWorldZ);
  assert.equal(radius[0], 0);
  assert.equal(radius[1], 0.5);
  assert.equal(radius[2], 1);
});

test('zc normalized 0..1 by world-Z extent', () => {
  const { zc } = buildScopeGeom(PB, getWorldZ);
  assert.equal(zc[0], 0);
  assert.equal(zc[1], 0.5);
  assert.equal(zc[2], 1);
});

test('deterministic', () => {
  const a = buildScopeGeom(PB, getWorldZ), b = buildScopeGeom(PB, getWorldZ);
  assert.deepEqual([...a.radius], [...b.radius]);
  assert.deepEqual([...a.zc], [...b.zc]);
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/cityproto/cityScope.test.mjs`
Expected: FAIL（module / `buildScopeGeom` 未定義）。

- [ ] **Step 3: 最小実装**

```js
// src/cityproto/cityScope.js
// CityScope — 音→建物変調レイヤ。純コア（geom/frameUniforms/computeScope）＋薄い factory。
// reveal.js が transformed.y を所有し、本レイヤは建物ごとの scope∈[0,1] を毎フレ計算して
// building-index テクスチャへ書くだけ（scope=1 で現状一致）。THREE/DOM/RNG/Date 無。

// 建物ごとの空間座標を1回構築。radius=駅からの正規化距離、zc=並木Z軸の正規化位置。
export function buildScopeGeom(perBuilding, getWorldZ) {
  const n = perBuilding.length;
  const radius = new Float32Array(n);
  const meanZ = new Float32Array(n);
  let maxRK = 0, zMin = Infinity, zMax = -Infinity;
  for (let b = 0; b < n; b++) if (perBuilding[b].revealKey > maxRK) maxRK = perBuilding[b].revealKey;
  for (let b = 0; b < n; b++) {
    const pb = perBuilding[b], end = pb.vStart + pb.vCount;
    let zs = 0; for (let i = pb.vStart; i < end; i++) zs += getWorldZ(i);
    const z = pb.vCount > 0 ? zs / pb.vCount : 0;
    meanZ[b] = z; if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    radius[b] = maxRK > 0 ? perBuilding[b].revealKey / maxRK : 0;
  }
  const zspan = (zMax - zMin) || 1;
  const zc = new Float32Array(n);
  for (let b = 0; b < n; b++) zc[b] = (meanZ[b] - zMin) / zspan;
  return { radius, zc };
}
```

- [ ] **Step 4: パス確認**

Run: `node --test tests/cityproto/cityScope.test.mjs`
Expected: PASS（3 tests）。

- [ ] **Step 5: commit**

```bash
git add src/cityproto/cityScope.js tests/cityproto/cityScope.test.mjs
git commit -m "feat(cityproto): CityScope 空間geom構築(正規化radius/avenue-Z)"
```

---

### Task 3: frameUniforms（音/ビート → 毎フレのスカラ＋state 前進）

**Files:**
- Modify: `src/cityproto/cityScope.js`
- Test: `tests/cityproto/cityScope.test.mjs`（追記）

**Interfaces:**
- Consumes: `features`（`live.js extractFeatures` の出力：`level, levelSlow, bass, beat, beats, beatPhase`）。
- Produces:
  - `defaultScopeConfig() → {enabled, mode, spatial, mix, aRatio, barBeats, steps, barWidth, scanFloor, breathDepth, breathFloor, breathSpread, bloomBand, bloomRise, dropThresh, dropRefractoryS}`
  - `initScopeState() → {front:1, lastDropT:-1e9}`
  - `frameUniforms(features, dt, cfg, state) → { beatsFloat, beatIndex, level, linePos, barPhase2, front, envFloor }`（`state.front`/`state.lastDropT` を前進）。

- [ ] **Step 1: 失敗するテストを書く**（既存ファイルに追記）

```js
import { defaultScopeConfig, initScopeState, frameUniforms } from '../../src/cityproto/cityScope.js';

const feat = (o = {}) => ({ level: 0, levelSlow: 0, bass: 0, beat: false, beats: 0, beatPhase: 0, ...o });

test('frameUniforms: linePos steps with whole beats', () => {
  const cfg = defaultScopeConfig(); cfg.steps = 4;
  const s = initScopeState();
  const u0 = frameUniforms(feat({ beats: 0, beatPhase: 0.2 }), 0.016, cfg, s);
  const u1 = frameUniforms(feat({ beats: 1, beatPhase: 0.9 }), 0.016, cfg, s);
  assert.equal(u0.linePos, 0 / 4);
  assert.equal(u1.linePos, 1 / 4);
});

test('frameUniforms: drop resets bloom front to 0 then it rises', () => {
  const cfg = defaultScopeConfig();
  const s = initScopeState();                       // front starts settled at 1
  // big level jump over levelSlow → drop fires → front snaps toward 0
  const d = frameUniforms(feat({ level: 0.9, levelSlow: 0.1, bass: 0.5, beats: 4 }), 0.016, cfg, s);
  assert.ok(d.front < 0.2, `front after drop ${d.front}`);
  // refractory: a second immediate drop must NOT re-reset (front keeps rising)
  const r = frameUniforms(feat({ level: 0.9, levelSlow: 0.1, bass: 0.5, beats: 4 }), 0.5, cfg, s);
  assert.ok(r.front > d.front, 'front rises after the reset');
});

test('frameUniforms: deterministic for same inputs', () => {
  const cfg = defaultScopeConfig();
  const a = frameUniforms(feat({ level: 0.4, beats: 2, beatPhase: 0.3 }), 0.016, cfg, initScopeState());
  const b = frameUniforms(feat({ level: 0.4, beats: 2, beatPhase: 0.3 }), 0.016, cfg, initScopeState());
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/cityproto/cityScope.test.mjs`
Expected: FAIL（`defaultScopeConfig` 未定義）。

- [ ] **Step 3: 最小実装**（`cityScope.js` に追記）

```js
import { clamp, smooth01 } from './scopeModes.js';

export function defaultScopeConfig() {
  return {
    enabled: true,
    mode: 'breathing',        // 'breathing' | 'scanbar' | 'bloom'
    spatial: 'rings',         // 'rings' | 'avenue' | 'both'
    mix: 1.0,                 // master blend（0=OFF, scope→1）
    aRatio: 0.0,              // A層（ビート抽選 跳ね/消し）の濃度 0..1
    barBeats: 4,
    steps: 16,                // scanbar の量子化ステップ数
    barWidth: 0.06,           // scanbar の帯幅（座標 0..1）
    scanFloor: 0.0,           // scanbar 非点灯時の高さ（0=床へ崩落→discard）
    breathDepth: 0.32,        // 呼吸の最大沈み込み
    breathFloor: 0.45,        // 呼吸が割り込まない下限（discard 回避）
    breathSpread: 0.5,        // 半径/Z に沿う呼吸の位相勾配（リップル感）
    bloomBand: 0.18,          // 開花フロントのにじみ幅
    bloomRise: 1.2,           // 崩落→満開までの秒
    dropThresh: 0.25,         // drop 検出（level-levelSlow）
    dropRefractoryS: 2.0,     // drop 不応期（秒）
  };
}

export function initScopeState() {
  return { front: 1, lastDropT: -1e9, clk: 0 };
}

// 音/ビート → 毎フレのスカラ。state.front / state.lastDropT を前進させる（純：入力同一→出力同一）。
export function frameUniforms(features, dt, cfg, state) {
  state.clk += dt;
  const beatsFloat = (features.beats || 0) + (features.beatPhase || 0);
  const beatIndex = Math.floor(beatsFloat);
  const level = clamp(features.level || 0, 0, 1);

  // scanbar: 整数ビートで段送りする走査線位置 0..1
  const steps = Math.max(1, cfg.steps | 0);
  const linePos = (((features.beats || 0) % steps) + steps) % steps / steps;

  // breathing: 2小節で1呼吸の位相
  const barPhase2 = (beatsFloat / (cfg.barBeats * 2)) % 1;

  // bloom: drop で front を 0 へ（不応期つき）、毎フレ満開(1)へイーズ
  const drop = (level - (features.levelSlow || 0)) > cfg.dropThresh
    && (features.bass || 0) > (features.levelSlow || 0);
  if (drop && (state.clk - state.lastDropT) > cfg.dropRefractoryS) {
    state.lastDropT = state.clk; state.front = 0;
  }
  state.front = Math.min(1, state.front + dt / Math.max(1e-3, cfg.bloomRise));
  const envFloor = clamp(0.15 + (features.levelSlow || 0) * 0.85, 0, 1);

  return { beatsFloat, beatIndex, level, linePos, barPhase2, front: state.front, envFloor };
}
```

- [ ] **Step 4: パス確認**

Run: `node --test tests/cityproto/cityScope.test.mjs`
Expected: PASS（geom 3 + frameUniforms 3 = 6 tests）。

- [ ] **Step 5: commit**

```bash
git add src/cityproto/cityScope.js tests/cityproto/cityScope.test.mjs
git commit -m "feat(cityproto): CityScope frameUniforms(音/ビート→毎フレscalar+state)"
```

---

### Task 4: モード3種＋A層＋computeScope（建物ごとの scope 配列）

**Files:**
- Modify: `src/cityproto/scopeModes.js`
- Modify: `src/cityproto/cityScope.js`
- Test: `tests/cityproto/scopeModes.test.mjs`（追記）

**Interfaces:**
- Produces（`scopeModes.js`）:
  - `coordOf(geom, b, spatial) → number`（spatial に応じ radius/zc/平均）
  - `MODES = { breathing(c,u,cfg), scanbar(c,u,cfg), bloom(c,u,cfg) } → scope∈[0,1]`
  - `applyA(scope, b, u, cfg) → scope`（ビート抽選の跳ね/消し）
- Produces（`cityScope.js`）:
  - `computeScope(out:Float32Array, geom, u, cfg) → out`（OFF/無効時は全 1）

- [ ] **Step 1: 失敗するテストを書く**（`scopeModes.test.mjs` 追記）

```js
import { coordOf, MODES, applyA } from '../../src/cityproto/scopeModes.js';
import { defaultScopeConfig } from '../../src/cityproto/cityScope.js';

const GEOM = { radius: new Float32Array([0, 0.5, 1]), zc: new Float32Array([1, 0.5, 0]) };

test('coordOf picks radius/zc/blend by spatial', () => {
  assert.equal(coordOf(GEOM, 1, 'rings'), 0.5);
  assert.equal(coordOf(GEOM, 0, 'avenue'), 1);
  assert.equal(coordOf(GEOM, 2, 'both'), 0.5); // (1+0)/2
});

test('breathing stays within [breathFloor,1] and dips with level', () => {
  const cfg = defaultScopeConfig();
  const u = { barPhase2: 0.5, level: 1 };          // cos(π)=-1 → max dip
  const s = MODES.breathing(0.0, u, cfg);
  assert.ok(s >= cfg.breathFloor - 1e-6 && s <= 1);
  assert.ok(s < 1, 'dips below full at the trough');
});

test('scanbar: on the line → 1, far → scanFloor', () => {
  const cfg = defaultScopeConfig(); cfg.barWidth = 0.1; cfg.scanFloor = 0;
  const u = { linePos: 0.5 };
  assert.ok(MODES.scanbar(0.5, u, cfg) > 0.95, 'on line');
  assert.ok(MODES.scanbar(0.0, u, cfg) < 0.05, 'far off line collapses');
});

test('bloom: building inside the front is up, outside is envFloor', () => {
  const cfg = defaultScopeConfig();
  const u = { front: 0.5, envFloor: 0.2 };
  assert.ok(MODES.bloom(0.1, u, cfg) > 0.9, 'near (radius<front) bloomed');
  assert.ok(Math.abs(MODES.bloom(0.95, u, cfg) - 0.2) < 1e-6, 'far holds envFloor');
});

test('applyA spikes/clears a hash-selected building deterministically', () => {
  const cfg = defaultScopeConfig(); cfg.aRatio = 1.0; // すべて被選択
  const u = { beatIndex: 7 };
  const base = 0.4;
  const a1 = applyA(base, 3, u, cfg);
  const a2 = applyA(base, 3, u, cfg);
  assert.equal(a1, a2, 'deterministic');
  assert.notEqual(a1, base, 'selected building is modified');
  // aRatio=0 → 無改変
  const cfg0 = defaultScopeConfig(); cfg0.aRatio = 0;
  assert.equal(applyA(base, 3, u, cfg0), base);
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/cityproto/scopeModes.test.mjs`
Expected: FAIL（`coordOf`/`MODES`/`applyA` 未定義）。

- [ ] **Step 3: 最小実装**

`scopeModes.js` に追記：

```js
export function coordOf(geom, b, spatial) {
  if (spatial === 'avenue') return geom.zc[b];
  if (spatial === 'both') return 0.5 * (geom.radius[b] + geom.zc[b]);
  return geom.radius[b]; // 'rings'
}

export const MODES = {
  // ⑤ 都市の呼吸: 2小節で1呼吸、深さは level、座標で位相をずらしリップル。下限 breathFloor。
  breathing(c, u, cfg) {
    const phase = (u.barPhase2 - c * cfg.breathSpread);
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);  // 0..1
    const depth = cfg.breathDepth * (0.3 + 0.7 * (u.level || 0));
    return clamp(1 - depth * w, cfg.breathFloor, 1);
  },
  // ③ スキャンバー: 走査線 linePos に近い建物だけ満高、他は scanFloor（0→崩落→discard）。
  // 座標は環状（0と1が連続）扱いで帯が途切れない。
  scanbar(c, u, cfg) {
    const d = Math.abs(c - u.linePos);
    const dd = Math.min(d, 1 - d);
    const on = 1 - smooth01(dd / Math.max(1e-4, cfg.barWidth));
    return lerp(cfg.scanFloor, 1, on);
  },
  // ⑦ 沈黙と開花: 開花フロント front が建物座標 c を越えたら満高、未到達は envFloor。
  bloom(c, u, cfg) {
    const reveal = smooth01((u.front - (c - cfg.bloomBand)) / Math.max(1e-4, cfg.bloomBand));
    return Math.max(u.envFloor, reveal);
  },
};

// A層: ビート毎 hash01(b ⊕ beatIndex) で抽選した建物を、跳ね(+δ)か消し(0)に。aRatio=濃度。
export function applyA(scope, b, u, cfg) {
  if (cfg.aRatio <= 0) return scope;
  const h = hash01((b * 2654435761) ^ (u.beatIndex | 0));
  if (h >= cfg.aRatio) return scope;
  // 抽選内で半々に跳ね/消し（別ハッシュ）
  const flip = hash01((b ^ 0x5bd1e995) + (u.beatIndex | 0));
  return flip < 0.5 ? 0 : Math.min(1, scope + 0.6);
}
```

`cityScope.js` に追記：

```js
import { coordOf, MODES, applyA } from './scopeModes.js';

// 建物ごとの scope を out へ。enabled=false / mix=0 は全 1（＝現状一致）。
export function computeScope(out, geom, u, cfg) {
  const n = out.length;
  if (!cfg.enabled || cfg.mix <= 0) { out.fill(1); return out; }
  const fn = MODES[cfg.mode] || MODES.breathing;
  for (let b = 0; b < n; b++) {
    const c = coordOf(geom, b, cfg.spatial);
    let s = fn(c, u, cfg);
    s = applyA(s, b, u, cfg);
    // mix: 1 で完全適用、0 で無効(=1)。中間は線形ブレンド。
    out[b] = 1 - cfg.mix * (1 - clamp(s, 0, 1));
  }
  return out;
}
```

- [ ] **Step 4: パス確認**

Run: `node --test tests/cityproto/scopeModes.test.mjs tests/cityproto/cityScope.test.mjs`
Expected: PASS（全 scopeModes + cityScope tests）。

- [ ] **Step 5: computeScope の OFF=全1 を検証するテスト追記（cityScope.test.mjs）**

```js
import { computeScope } from '../../src/cityproto/cityScope.js';
test('computeScope OFF or mix=0 → all ones (現状一致)', () => {
  const geom = { radius: new Float32Array([0, 0.5, 1]), zc: new Float32Array([0, 0.5, 1]) };
  const out = new Float32Array(3);
  const cfg = defaultScopeConfig(); cfg.enabled = false;
  computeScope(out, geom, { barPhase2: 0.5, level: 1 }, cfg);
  assert.deepEqual([...out], [1, 1, 1]);
  cfg.enabled = true; cfg.mix = 0;
  computeScope(out, geom, { barPhase2: 0.5, level: 1 }, cfg);
  assert.deepEqual([...out], [1, 1, 1]);
});
```

Run: `node --test tests/cityproto/cityScope.test.mjs` → PASS。

- [ ] **Step 6: commit**

```bash
git add src/cityproto/scopeModes.js src/cityproto/cityScope.js tests/cityproto/scopeModes.test.mjs tests/cityproto/cityScope.test.mjs
git commit -m "feat(cityproto): CityScope モード3種(呼吸/走査/開花)+A層+computeScope"
```

---

### Task 5: reveal.js に scope テクスチャ lookup を増設（OFFで現状一致）

**Files:**
- Modify: `src/cityproto/reveal.js`
- Test: `tests/cityproto/reveal.test.mjs`（`buildIndexAttribute` の純テスト追記）

**Interfaces:**
- Produces（`reveal.js`）:
  - `buildIndexAttribute(perBuilding, count) → Float32Array`（頂点 i → 所属建物 index）
  - `installReveal(...)` の返り値に追加：`{ writeScope(scope:Float32Array), setScopeEnabled(b:boolean), scopeCount:number }`
- シェーダ：頂点で `aBuildIndex` を使い `uScopeTex` を1回 lookup → `scope`、`transformed.y = mix(aBaseY, fullY, _rv*scope)`、`vReveal = _rv*scope`。`uScopeEnabled=0` で `scope=1`（INTRO/OFF＝現状一致）。

- [ ] **Step 1: 失敗するテストを書く**（`tests/cityproto/reveal.test.mjs` に追記。無ければ新規）

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexAttribute } from '../../src/cityproto/reveal.js';

test('buildIndexAttribute maps each vertex to its building index', () => {
  const perBuilding = [
    { vStart: 0, vCount: 3 },
    { vStart: 3, vCount: 2 },
  ];
  const idx = buildIndexAttribute(perBuilding, 5);
  assert.deepEqual([...idx], [0, 0, 0, 1, 1]);
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/cityproto/reveal.test.mjs`
Expected: FAIL（`buildIndexAttribute` 未 export）。

- [ ] **Step 3: 実装** — `reveal.js` に純関数を追加（`buildRevealAttributes` の隣）：

```js
// 頂点 → 所属建物 index（scope テクスチャ lookup 用）。純・決定論。
export function buildIndexAttribute(perBuilding, count) {
  const aIdx = new Float32Array(count);
  for (let bi = 0; bi < perBuilding.length; bi++) {
    const b = perBuilding[bi], end = b.vStart + b.vCount;
    for (let i = b.vStart; i < end; i++) aIdx[i] = bi;
  }
  return aIdx;
}
```

`installReveal` 内、`geo.setAttribute('aBaseY', ...)` の直後に追加：

```js
  // scope テクスチャ: 建物ごとの reveal 係数を毎フレ書く RGBA8（.r に scope, nearest）。
  const n = perBuilding.length;
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  geo.setAttribute('aBuildIndex', new THREE.BufferAttribute(buildIndexAttribute(perBuilding, pos.count), 1));
  const scopeBytes = new Uint8Array(side * side * 4).fill(255);   // 既定 1.0（OFF=全フル）
  const scopeTex = new THREE.DataTexture(scopeBytes, side, side, THREE.RGBAFormat);
  scopeTex.magFilter = THREE.NearestFilter; scopeTex.minFilter = THREE.NearestFilter;
  scopeTex.needsUpdate = true;
  const uScopeTex = { value: scopeTex };
  const uScopeSize = { value: side };
  const uScopeEnabled = { value: 0 };   // INTRO/既定は無効＝現状一致
```

`mat.onBeforeCompile` 内の uniforms 登録に追加：

```js
    shader.uniforms.uScopeTex = uScopeTex;
    shader.uniforms.uScopeSize = uScopeSize;
    shader.uniforms.uScopeEnabled = uScopeEnabled;
```

頂点シェーダ patch を差し替え（`#include <common>` と `#include <begin_vertex>`）：

```js
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aReveal;\nattribute float aBaseY;\nattribute float aBuildIndex;\nuniform float uReveal;\nuniform float uBand;\nuniform sampler2D uScopeTex;\nuniform float uScopeSize;\nuniform float uScopeEnabled;\nvarying float vReveal;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'
        + 'float _scope = 1.0;\n'
        + 'if (uScopeEnabled > 0.5) {\n'
        + '  float _sx = mod(aBuildIndex, uScopeSize);\n'
        + '  float _sy = floor(aBuildIndex / uScopeSize);\n'
        + '  vec2 _suv = (vec2(_sx, _sy) + 0.5) / uScopeSize;\n'
        + '  _scope = texture2D(uScopeTex, _suv).r;\n'
        + '}\n'
        + 'float _rv = smoothstep(aReveal - uBand, aReveal, uReveal) * _scope;\n'
        + 'vReveal = _rv;\n'
        + 'transformed.y = mix(aBaseY, transformed.y, _rv);');
```

（フラグメントの `discard` patch は不変：`vReveal`＝`_rv*_scope` なので scope→0 の建物も自動で消える。）

返り値に追加（`return { material, ... }` 内）：

```js
    scopeCount: n,
    setScopeEnabled: (b) => { uScopeEnabled.value = b ? 1 : 0; },
    writeScope: (scope) => {
      const m = Math.min(n, scope.length);
      for (let b = 0; b < m; b++) {
        const v = scope[b] < 0 ? 0 : scope[b] > 1 ? 255 : (scope[b] * 255 + 0.5) | 0;
        scopeBytes[b * 4] = v;            // .r に格納（mono）
      }
      scopeTex.needsUpdate = true;
    },
```

- [ ] **Step 4: パス確認 ＋ 全体 green ＋ glb 不変**

Run: `node --test tests/cityproto/reveal.test.mjs`
Expected: PASS。
Run: `node --test`
Expected: 既存全 green（新規分のみ増加）。
Run: `git status --short -- tools/citybake/dist/`
Expected: 空（再ベイク無し）。

- [ ] **Step 5: commit**

```bash
git add src/cityproto/reveal.js tests/cityproto/reveal.test.mjs
git commit -m "feat(cityproto): reveal に scope テクスチャ lookup 増設(OFFで現状一致)"
```

---

### Task 6: proto.js / liveDriver.js 配線（LIVE で scope 駆動、setScope）

**Files:**
- Modify: `src/cityproto/proto.js`
- Modify: `src/cityproto/liveDriver.js`

**Interfaces:**
- Consumes: `installReveal` の返り値 `{ writeScope, setScopeEnabled, scopeCount }`、`buildScopeGeom`、`defaultScopeConfig/initScopeState/frameUniforms/computeScope`。
- Produces: `window.__proto.setScope(partial)`、driver ctx の `cityScope`。

- [ ] **Step 1: cityScope factory を追加（`cityScope.js`）**

```js
// 薄い factory: 毎フレ reveal へ scope を書く。LIVE でのみ frame() が呼ばれる前提
// （INTRO は誰も呼ばず uScopeEnabled=0 のまま＝現状一致）。
export function createCityScope(geom, sink, config = {}) {
  const cfg = { ...defaultScopeConfig(), ...config };
  const state = initScopeState();
  const out = new Float32Array(geom.radius.length);
  return {
    setConfig(partial) { Object.assign(cfg, partial); },
    get config() { return cfg; },
    frame(features, dt) {
      const u = frameUniforms(features, dt, cfg, state);
      computeScope(out, geom, u, cfg);
      sink.writeScope(out);
      sink.setScopeEnabled(cfg.enabled && cfg.mix > 0);
    },
  };
}
```

（テスト追記：`createCityScope` が sink.writeScope/​setScopeEnabled を呼ぶこと、`enabled:false` で `setScopeEnabled(false)` になることを fake sink で検証。）

```js
// tests/cityproto/cityScope.test.mjs 追記
import { createCityScope } from '../../src/cityproto/cityScope.js';
test('createCityScope writes scope and toggles enable via config', () => {
  const geom = { radius: new Float32Array([0, 1]), zc: new Float32Array([0, 1]) };
  let wrote = null, en = null;
  const sink = { writeScope: (a) => { wrote = [...a]; }, setScopeEnabled: (b) => { en = b; } };
  const cs = createCityScope(geom, sink, { mode: 'breathing' });
  cs.frame({ level: 1, beats: 0, beatPhase: 0.5 }, 0.016);
  assert.equal(wrote.length, 2); assert.equal(en, true);
  cs.setConfig({ enabled: false });
  cs.frame({ level: 1, beats: 0, beatPhase: 0.5 }, 0.016);
  assert.deepEqual(wrote, [1, 1]); assert.equal(en, false);
});
```

Run: `node --test tests/cityproto/cityScope.test.mjs` → PASS。

- [ ] **Step 2: proto.js import 追加**（`installReveal` import 行付近）

```js
import { buildScopeGeom, createCityScope } from './cityScope.js';
```

- [ ] **Step 3: proto.js モジュール state 追加**（`let shotOpts = {};` の下）

```js
// 音反応 建物変調レイヤ（CityScope）。城ロード後に生成。scopeOpts は HUD の上書きを蓄積。
let cityScope = null;
let scopeOpts = {};
```

- [ ] **Step 4: proto.js — reveal install 後に geom 構築＋cityScope 生成**
`loadCity(...).then` 内、`shotDir = createShotDirector(...)` の直後（`terrain` ブロック内）に追加：

```js
    // CityScope geom: 建物の world Z で並木軸を、revealKey で半径を正規化。world 位置は
    // trees と同じ matrixWorld 経由（KHR 量子化 → world）。
    if (buildings && reveal) {
      buildings.updateWorldMatrix(true, false);
      const bp = buildings.geometry.attributes.position, _w = new THREE.Vector3();
      const worldZ = new Float32Array(bp.count);
      for (let i = 0; i < bp.count; i++) { _w.fromBufferAttribute(bp, i).applyMatrix4(buildings.matrixWorld); worldZ[i] = _w.z; }
      const geom = buildScopeGeom(manifest.buildings, (i) => worldZ[i]);
      cityScope = createCityScope(geom, reveal, scopeOpts);
      window.__proto.cityScope = cityScope;
    }
```

- [ ] **Step 5: proto.js — driver ctx に cityScope を渡す**
`driver.frame(dt, now, { ... })` の ctx に追加：

```js
      shotDir, beat,
      cityScope, // LIVE で建物 scope を駆動（INTRO は無効のまま）
```

- [ ] **Step 6: proto.js — `window.__proto.setShot` の下に setScope を追加**

```js
  setScope: (partial) => { Object.assign(scopeOpts, partial); if (cityScope) cityScope.setConfig(scopeOpts); }, // 音反応 建物変調(HUD)
```

- [ ] **Step 7: liveDriver.js — LIVE ブロックで cityScope.frame を呼ぶ**
`applyCamera();` を含む park ブロックの後、`if (trees) { ... }` の前に追加：

```js
      // 音反応 建物変調（CityScope）: 固定カメラの LIVE でのみ建物が音/ビートに連動。
      // feat は extractFeatures の出力（level/levelSlow/bass/beat/beats/beatPhase を含む）。
      if (ctx.cityScope) ctx.cityScope.frame(feat, dt);
```

- [ ] **Step 8: 全体 green ＋ glb 不変**

Run: `node --test` → 既存＋新規すべて green。
Run: `git status --short -- tools/citybake/dist/` → 空。

- [ ] **Step 9: commit**

```bash
git add src/cityproto/cityScope.js src/cityproto/proto.js src/cityproto/liveDriver.js tests/cityproto/cityScope.test.mjs
git commit -m "feat(cityproto): CityScope を proto/liveDriver に配線(LIVE駆動+setScope)"
```

---

### Task 7: city-proto.html に CityScope HUD

**Files:**
- Modify: `city-proto.html`

**Interfaces:**
- Consumes: `window.__proto.setScope({ enabled, mode, spatial, mix, aRatio })`。

- [ ] **Step 1: CAM HUD（`#shothud`）の下に SCOPE HUD を追加**（HTML、`</div>` 直後）

```html
<div id="scopehud">
  <div id="scopehud-h"><span>SCOPE · 建物連動</span><span id="scopehud-t">▾</span></div>
  <div id="scopehud-b">
    <div class="row"><span>有効</span><input type="checkbox" id="sc-en" checked></div>
    <label><span>モード</span><span class="v" id="sc-mv">呼吸</span></label>
    <input type="range" id="sc-mo" min="0" max="2" step="1" value="0">
    <label><span>空間</span><span class="v" id="sc-sv">同心円</span></label>
    <input type="range" id="sc-sp" min="0" max="2" step="1" value="0">
    <label><span>強さ(mix)</span><span class="v" id="sc-xv">1.00</span></label>
    <input type="range" id="sc-mx" min="0" max="1" step="0.02" value="1">
    <label><span>A比率(跳ね/消し)</span><span class="v" id="sc-av">0.00</span></label>
    <input type="range" id="sc-ar" min="0" max="1" step="0.02" value="0">
  </div>
</div>
```

- [ ] **Step 2: CSS を追加**（`#shothud` ブロックの後、`#scopehud` は左下に置き CAM HUD と被らせない）

```css
  #scopehud{position:fixed;left:12px;bottom:12px;z-index:9;width:192px;
    background:rgba(7,8,10,0.42);backdrop-filter:blur(3px);border:1px solid rgba(194,202,214,0.12);
    color:rgba(194,202,214,0.62);font:11px/1.5 -apple-system,"Helvetica Neue",Arial,sans-serif;
    letter-spacing:0.06em;-webkit-user-select:none;user-select:none}
  #scopehud-h{padding:6px 9px;cursor:pointer;display:flex;justify-content:space-between;
    border-bottom:1px solid rgba(194,202,214,0.10)}
  #scopehud-b{padding:7px 9px 9px}
  #scopehud.col #scopehud-b{display:none}
  #scopehud.col #scopehud-h{border-bottom:none}
  #scopehud label{display:block;margin:7px 0 2px;display:flex;justify-content:space-between}
  #scopehud .v{color:rgba(194,202,214,0.85)}
  #scopehud input[type=range]{width:100%;height:2px;margin:3px 0 0;accent-color:rgba(194,202,214,0.7);
    background:rgba(194,202,214,0.18);-webkit-appearance:none;appearance:none}
  #scopehud input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;
    border-radius:50%;background:rgba(194,202,214,0.85)}
  #scopehud .row{display:flex;justify-content:space-between;align-items:center;margin-top:2px}
```

- [ ] **Step 3: 配線スクリプトを追加**（既存の `(function(){ ... })();`（CAM HUD）の後）

```html
<script>
  (function () {
    var MODES = ['breathing', 'scanbar', 'bloom'], MODE_JA = ['呼吸', '走査', '開花'];
    var SPATIAL = ['rings', 'avenue', 'both'], SPATIAL_JA = ['同心円', '並木', '両方'];
    var $ = function (id) { return document.getElementById(id); };
    var set = function (o) { if (window.__proto && window.__proto.setScope) window.__proto.setScope(o); };
    var hud = $('scopehud');
    $('scopehud-h').addEventListener('click', function () {
      hud.classList.toggle('col'); $('scopehud-t').textContent = hud.classList.contains('col') ? '▸' : '▾';
    });
    $('sc-en').addEventListener('input', function (e) { set({ enabled: e.target.checked }); });
    $('sc-mo').addEventListener('input', function (e) { var i = +e.target.value; $('sc-mv').textContent = MODE_JA[i]; set({ mode: MODES[i] }); });
    $('sc-sp').addEventListener('input', function (e) { var i = +e.target.value; $('sc-sv').textContent = SPATIAL_JA[i]; set({ spatial: SPATIAL[i] }); });
    $('sc-mx').addEventListener('input', function (e) { var v = +e.target.value; $('sc-xv').textContent = v.toFixed(2); set({ mix: v }); });
    $('sc-ar').addEventListener('input', function (e) { var v = +e.target.value; $('sc-av').textContent = v.toFixed(2); set({ aRatio: v }); });
  })();
</script>
```

- [ ] **Step 4: commit**

```bash
git add city-proto.html
git commit -m "feat(cityproto): CityScope HUD(モード/空間/mix/A比率 スライダー)"
```

---

### Task 8: CPU ラスタライザで視覚検証（false-green 防止）

**Files:**
- Create（scratchpad・未コミット）: `<scratchpad>/scope_verify.mjs`

CPU ラスタライザは既存の `shot_verify.mjs` / storyboard 系を雛形にする。**実 glb を解析し（KHR 量子化 dequant）、本番と同一の `computeScope`（`src/cityproto/cityScope.js` を import）で建物ごとの scope を出し、各頂点 `transformed.y = mix(aBaseY, fullY, _rv*scope)` を適用**してソフトラスタ→PNG。実機シェーダは scope を lookup するだけなので、この CPU 値＝実機値（二重実装なし）。

- [ ] **Step 1: 各モード×空間の montage を出力**
- 3モード（breathing/scanbar/bloom）× 3空間（rings/avenue/both）の代表フレーム＋OFF(mix=0)＝現状一致 を 1 枚に。
- 合成音特徴を時間で振る（level の山、beats 進行、drop 1 発）。
- 出力：`shots/scope_verify.png`。

- [ ] **Step 2: 目視チェックリスト**
- `mix=0` が現状（全建物フル）とピクセル一致。
- breathing：全市が緩く沈む/戻る、下限割れ（床ポップ）無し。
- scanbar：帯の建物だけ立ち他は消える、帯が連続（環状）。
- bloom：drop で崩落→駅中心に放射開花。
- mono 厳守（単一チャンネル）・landmark/terrain/道路/木々/particles 不変。
- muddy 化しない。

- [ ] **Step 3: PNG をユーザーへ送付**（`:8125/shots/scope_verify.png`）し承認を待つ。

---

## 第1陣 完了条件（守る線 機械チェック）

1. `node --test` 全 green（既存 159 を割らない）。
2. `git status --short -- tools/citybake/dist/` が空（glb/manifest byte 不変）。
3. CPU ラスタ PNG で `mix=0`＝現状一致、3モード×3空間が意図通り、mono 厳守、他レイヤ不変を確認。
4. 実機 `:8125/city-proto.html`（任意）で L キー→LIVE→SCOPE HUD ダイヤルを体感。
5. ユーザー承認後に最終確認 → 既に各 Task で commit 済み → **Compact** → 第2陣（レーダーping/EQ）へ。

## Self-Review

- **Spec coverage:** 土台レイヤ（cityScope＋reveal拡張＋HUD＋空間3択＋A/B比率）=Task2-7、Tier1 3モード=Task4、検証=Task8、守る線=Global Constraints＋完了条件。spec の「Tier1=uniform」は per-building テクスチャ方式へ統合（GLSL/JS 二重化排除＝false-green 防止）— 挙動・モード集合・守る線は不変。
- **Placeholder scan:** 無し（全コード/コマンド/期待値を明記）。
- **Type consistency:** `buildScopeGeom→{radius,zc}`、`frameUniforms→u{linePos,barPhase2,front,envFloor,level,beatIndex}`、`MODES[mode](c,u,cfg)`、`computeScope(out,geom,u,cfg)`、`reveal.{writeScope,setScopeEnabled,scopeCount}`、`createCityScope(geom,sink,cfg).frame(features,dt)` が全 Task で一致。
