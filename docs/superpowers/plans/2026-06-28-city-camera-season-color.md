# 国立シティ カメラ演出＋季節色/COLOR操作 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 国立シティに (A) 俯瞰の緩旋回＋呼吸＋新ショット、(B) 季節色のワンタッチ操作パネル、(C) 全体COLORパレットによる建物/地面の控えめ着色 を追加する。

**Architecture:** すべてランタイム（再ベイク無し）。純粋ロジックは node テスト可能なモジュールへ分離（`aerialCam`/`cityColorControls`/`cityTint`）、THREE/DOM 結合部はヘッドレスCDPで視覚検証。Engine.js・glb・manifest 無改変。

**Tech Stack:** buildless ESM, vendored three.module.js, node --test, headless CDP (`.superpowers/sdd/devshot/shot.mjs`), dev server localhost:8125。

## Global Constraints（全タスク厳守）

- mono基調維持：着色は単一色相・低強度＝**虹色化しない**。季節chromaは既存opt-inのまま。雪は常時白。建物per-building個体差は付けない（ボツ要素禁止）。
- strobe ≤3Hz・既定OFF（光感受性）。
- 決定論：旋回角・ショット振り分けは `beatsFloat`／`hash01` のみ。`Math.random`/`Date` 禁止。
- `dist/city.glb`・`dist/city.manifest.json` は **byte 不変**（コミット前に `git status` で差分無しを確認）。
- `Engine.js`・dancers・dots 既存シーン無改変。iPad PWA・three vendored。
- 各機能の「無効/0」状態は**現状ピクセル一致**（旋回0＝固定一致、tint strength0＝着色無し、色モノ既定）。
- 視覚は実物スクショ確認してから報告（[[verify-visual-before-claiming]]）。

---

## Task 1: 俯瞰旋回＋呼吸＋俯瞰ニア（shotDirector.js 純粋拡張）

**Files:**
- Modify: `src/cityproto/shotDirector.js`
- Test: `tests/cityproto/aerialCam.test.mjs`（新規）

**Interfaces:**
- Produces: `export function aerialCam(base, cfg, beatsFloat, variant) → {camX,camY,camZ,fov,lookX,lookY,lookV}`（純粋・決定論）。`defaultShotConfig()` に新キー `orbitRate, orbitDir, breatheBars, breatheAmp, nearRatio, nearRadiusMul, nearHeightMul, nearFov` を追加。`stepShot` のショット選択が `'avenue' | 'aerialNear' | 'aerial'` の3値に。
- Consumes: 既存 `hash01`, `lerpParams`, `clamp`, `smooth01`, `avenueCam`。

**現状の該当コード（shotDirector.js）:**
- `defaultShotConfig()` は lines 33-50（`enabled, barBeats, switchBars, blendSec, avenueRatio, travelBars, lowHeight, eyeOffsetX, aheadFrac, lookLift, avenueFov, maxBlendSec, minDwellBars`）。
- `stepShot` の選択 line 118: `s.shot = hash01(group) < cfg.avenueRatio ? 'avenue' : 'aerial';`
- target line 122: `const target = s.shot === 'avenue' ? avenueCam(s, cfg, centerline, beatsFloat) : { ...base };`
- `initShotState().shot` は `'aerial'`（line 56）。

- [ ] **Step 1: 失敗するテストを書く** — `tests/cityproto/aerialCam.test.mjs`

```js
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
```

- [ ] **Step 2: テスト失敗を確認** — Run: `node --test tests/cityproto/aerialCam.test.mjs` → `aerialCam is not a function` 等で FAIL。

- [ ] **Step 3: `defaultShotConfig()` に新キーを追加** — `src/cityproto/shotDirector.js` の `defaultShotConfig` の `minDwellBars: 1,` の直後（`return { ... }` 内末尾）に追記：

```js
    minDwellBars: 1,        // floor on switchBars so it can't strobe the framing
    // --- aerial 俯瞰の動き（決定論・酔わせない）---
    orbitRate: 0.02,        // 俯瞰公転の角速度 [rad/beat]。0=固定。~1周/78小節（遅い）
    orbitDir: 1,            // 公転方向 ±1
    breatheBars: 24,        // 呼吸ズームの周期（小節）
    breatheAmp: 0.06,       // 呼吸の半径振幅（±割合）
    nearRatio: 0.25,        // 非avenue空間のうち「俯瞰ニア」になる割合
    nearRadiusMul: 0.62,    // 俯瞰ニアの寄り（半径倍率 <1）
    nearHeightMul: 0.66,    // 俯瞰ニアの高さ倍率 <1
    nearFov: 46,            // 俯瞰ニアのFOV
```

- [ ] **Step 4: `aerialCam` を実装** — `avenueCam` 関数の直後（line 96 の後）に追加：

```js
// 俯瞰（俯瞰ワイド/ニア）の framing。lookAt(lookX,lookV) 周りで camX/camZ を beatsFloat 由来の
// 角度でゆっくり公転し、半径に緩い呼吸を重畳（純粋・決定論・酔わせない）。orbitRate=0 かつ
// breatheAmp=0 の 'wide' は base と完全一致＝固定復帰（現状ピクセル一致の保証）。
export function aerialCam(base, cfg, beatsFloat, variant) {
  const isNear = variant === 'near';
  const radiusMul = isNear ? cfg.nearRadiusMul : 1;
  const heightMul = isNear ? cfg.nearHeightMul : 1;
  const dx = base.camX - base.lookX, dz = base.camZ - base.lookV;
  const r0 = Math.hypot(dx, dz) || 1;
  const a0 = Math.atan2(dz, dx);
  const dir = cfg.orbitDir < 0 ? -1 : 1;
  const ang = a0 + (cfg.orbitRate || 0) * beatsFloat * dir;
  const breathePeriod = Math.max(1e-3, (cfg.breatheBars || 1) * cfg.barBeats);
  const breathe = 1 + (cfg.breatheAmp || 0) * Math.sin((2 * Math.PI * beatsFloat) / breathePeriod);
  const r = r0 * radiusMul * breathe;
  return {
    camX: base.lookX + Math.cos(ang) * r,
    camY: base.camY * heightMul,
    camZ: base.lookV + Math.sin(ang) * r,
    fov: isNear ? cfg.nearFov : base.fov,
    lookX: base.lookX, lookY: base.lookY, lookV: base.lookV,
  };
}
```

- [ ] **Step 5: `stepShot` の選択とtargetを3値化** — line 118 の選択を置換：

置換前:
```js
    s.shot = hash01(group) < cfg.avenueRatio ? 'avenue' : 'aerial';
```
置換後:
```js
    // 3値 決定論振り分け：avenue 確率は avenueRatio を保ち、非avenue空間を nearRatio で分ける。
    const rr = hash01(group);
    if (rr < cfg.avenueRatio) s.shot = 'avenue';
    else if (rr < cfg.avenueRatio + (cfg.nearRatio || 0) * (1 - cfg.avenueRatio)) s.shot = 'aerialNear';
    else s.shot = 'aerial';
```

line 122 の target を置換：

置換前:
```js
  const target = s.shot === 'avenue' ? avenueCam(s, cfg, centerline, beatsFloat) : { ...base };
```
置換後:
```js
  let target;
  if (s.shot === 'avenue') target = avenueCam(s, cfg, centerline, beatsFloat);
  else if (s.shot === 'aerialNear') target = aerialCam(base, cfg, beatsFloat, 'near');
  else target = aerialCam(base, cfg, beatsFloat, 'wide');
```

注意：早期returnブランチ（`!cfg.enabled` 時、lines 103-106）は **変更しない**（`{ ...base }` のまま）＝「固定」モードは完全パススルー維持。

- [ ] **Step 6: テスト合格を確認** — Run: `node --test tests/cityproto/aerialCam.test.mjs` → PASS（6 tests）。続けて全体回帰：`node --test` → 既存全green維持。

- [ ] **Step 7: コミット**

```bash
git add src/cityproto/shotDirector.js tests/cityproto/aerialCam.test.mjs
git commit -m "feat(city): 俯瞰旋回+呼吸+俯瞰ニア shot (aerialCam, deterministic)"
```

---

## Task 2: 操作パネル — 俯瞰旋回スライダー＋季節色グループ

**Files:**
- Create: `src/cityproto/cityColorControls.js`（純粋マッピング）
- Test: `tests/cityproto/cityColorControls.test.mjs`
- Modify: `src/scenes/city/CityScene.js`（パネル追加＋配線）

**Interfaces:**
- Produces: `export function applyCityColorGroup(key, idx, ctx) → boolean`（`ctx={core,adapter}`、季節色系の選択を注入setter経由で適用、処理したら true）。`CITY_SEASONS`,`CITY_VARIANTS` 定数。
- Consumes: `adapter.setColorMode`/`adapter.modeConfig`（`sceneAudioAdapter`）、`core.setChromaVariant`/`core.setStrobe`/`core.setShot`（cityCore）。

**背景（確認済み）:** 本番 body-scene は LIVE ドライバ所有。manual モードで `seasonIndex=cfg.manualSeason`(0-3 wrap)・`chromaMix=clamp(cfg.manualChromaMix,0,1)`。`setColorMode` 有効値 `'burst'|'advance'|'manual'`。`setChromaVariant` 有効値 `'current'|'muted'|'mid'`。

- [ ] **Step 1: 失敗するテストを書く** — `tests/cityproto/cityColorControls.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { applyCityColorGroup, CITY_VARIANTS } from '../../src/cityproto/cityColorControls.js';

function fakes() {
  const calls = [];
  const adapter = {
    modeConfig: {},
    setColorMode: (m) => calls.push(['setColorMode', m]),
  };
  const core = {
    setChromaVariant: (n) => calls.push(['setChromaVariant', n]),
    setStrobe: (b) => calls.push(['setStrobe', b]),
  };
  return { calls, adapter, core, ctx: { core, adapter } };
}

test('cityColor 季節色(idx1) → manual + chromaMix=1', () => {
  const f = fakes();
  assert.strictEqual(applyCityColorGroup('cityColor', 1, f.ctx), true);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'manual']]);
  assert.strictEqual(f.adapter.modeConfig.manualChromaMix, 1);
});

test('cityColor モノ(idx0) → burst', () => {
  const f = fakes();
  applyCityColorGroup('cityColor', 0, f.ctx);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'burst']]);
});

test('citySeason idx2(秋) → manual + manualSeason=2 + chromaMix=1', () => {
  const f = fakes();
  applyCityColorGroup('citySeason', 2, f.ctx);
  assert.deepStrictEqual(f.calls, [['setColorMode', 'manual']]);
  assert.strictEqual(f.adapter.modeConfig.manualSeason, 2);
  assert.strictEqual(f.adapter.modeConfig.manualChromaMix, 1);
});

test('cityVariant idx1 → setChromaVariant(muted)', () => {
  const f = fakes();
  applyCityColorGroup('cityVariant', 1, f.ctx);
  assert.deepStrictEqual(f.calls, [['setChromaVariant', CITY_VARIANTS[1]]]);
  assert.strictEqual(CITY_VARIANTS[1], 'muted');
});

test('cityStrobe ON/OFF → setStrobe(true/false)', () => {
  const f1 = fakes(); applyCityColorGroup('cityStrobe', 1, f1.ctx);
  assert.deepStrictEqual(f1.calls, [['setStrobe', true]]);
  const f0 = fakes(); applyCityColorGroup('cityStrobe', 0, f0.ctx);
  assert.deepStrictEqual(f0.calls, [['setStrobe', false]]);
});

test('未知キー → false・呼び出し無し', () => {
  const f = fakes();
  assert.strictEqual(applyCityColorGroup('switchBars', 1, f.ctx), false);
  assert.deepStrictEqual(f.calls, []);
});

test('core/adapter 欠如 → false・throw無し', () => {
  assert.strictEqual(applyCityColorGroup('cityColor', 1, { core: null, adapter: null }), false);
});
```

- [ ] **Step 2: テスト失敗を確認** — Run: `node --test tests/cityproto/cityColorControls.test.mjs` → モジュール未存在で FAIL。

- [ ] **Step 3: `cityColorControls.js` を実装**

```js
// 季節色/COLOR の操作パネル選択 → cityCore/sceneAudioAdapter のsetter呼び出しへの純粋マッピング。
// 本番 body-scene は LIVE ドライバ所有なので core.setMode/setSeason ではなく adapter.setColorMode +
// modeConfig.manual* を使う（proto の C/N/B キー相当）。CityScene.setModeGroup から呼ぶ。
export const CITY_SEASONS = ['spring', 'summer', 'autumn', 'winter']; // idx→季節（表示は春夏秋冬）
export const CITY_VARIANTS = ['current', 'muted', 'mid'];            // idx→chroma register

// 季節色系の mode-group 選択を適用。ctx={core,adapter}。処理したら true、対象外キーは false。
export function applyCityColorGroup(key, idx, ctx) {
  const core = ctx && ctx.core, adapter = ctx && ctx.adapter;
  if (!core || !adapter) return false;
  if (key === 'cityColor') {
    if (idx === 1) { adapter.setColorMode('manual'); adapter.modeConfig.manualChromaMix = 1; }
    else { adapter.setColorMode('burst'); }            // モノ＝音反応の既定（rest=mono）
    return true;
  }
  if (key === 'citySeason') {
    adapter.setColorMode('manual');
    adapter.modeConfig.manualSeason = ((idx % 4) + 4) % 4;
    adapter.modeConfig.manualChromaMix = 1;            // 季節を選んだら色ON
    return true;
  }
  if (key === 'cityVariant') { core.setChromaVariant(CITY_VARIANTS[idx] || 'current'); return true; }
  if (key === 'cityStrobe') { core.setStrobe(idx === 1); return true; }
  return false;
}
```

- [ ] **Step 4: テスト合格を確認** — Run: `node --test tests/cityproto/cityColorControls.test.mjs` → PASS（7 tests）。

- [ ] **Step 5: CityScene にカメラ「動き」スライダーを追加** — `src/scenes/city/CityScene.js` の `this.params = { ... }`（lines 36-42）の `travel:` の直後に追記：

```js
      travel:    { label: '前進(小=速)', value: 16, min: 6, max: 32, step: 1, onChange: (v) => this._core && this._core.setShot({ travelBars: v }) },
      orbit:     { label: '俯瞰の動き', value: 0.4, min: 0, max: 1, step: 0.02, onChange: (v) => this._core && this._core.setShot({ orbitRate: v * 0.05, breatheAmp: v * 0.12 }) },
      near:      { label: '俯瞰ニア比率', value: 0.25, min: 0, max: 1, step: 0.05, onChange: (v) => this._core && this._core.setShot({ nearRatio: v }) },
```

（注：`shotDirector` の新キー既定は **0=固定**（共有モジュールの後方互換）。動きは CityScene が opt-in で与える。`orbit` スライダー 0..1 は **公転 orbitRate 0..0.05 rad/beat と呼吸 breatheAmp 0..0.12 を一括**制御し、**0で完全静止**。`near` は 0..1 → `nearRatio`。これらは下の Step 5b で読込時にも core へ適用するため、ユーザー操作前から俯瞰が動く。）

- [ ] **Step 5b: 読込完了時にカメラ動きの既定値を core へ適用** — モジュール既定が0でも VJ シーンが起動から動くよう、`preload()`（lines 68-74）の `.then(...)` 内、`this._core.goLive(this._adapter); this._ready = true;` の直後にパネル既定の適用を追加：

```js
    if (!this._loading) this._loading = this._core.load(() => {}).then(() => {
      this._core.goLive(this._adapter); this._ready = true;
      // パネル既定の「動き」を core へ反映（モジュール既定0=固定に対する CityScene の opt-in）。
      this._core.setShot({
        orbitRate: this.params.orbit.value * 0.05,
        breatheAmp: this.params.orbit.value * 0.12,
        nearRatio: this.params.near.value,
      });
    }).catch((e) => console.error('[city] preload failed', e));
```

- [ ] **Step 6: CityScene に季節色 modeGroups を追加** — `this.modeGroups = [ ... ]`（lines 27-33）の最後の要素（空間）の後に追記：

```js
      { label: '空間', key: 'scopeSpatial', index: 0, options: SCOPE_SPATIAL_JA },
      { label: '色', key: 'cityColor', index: 0, options: ['モノ', '季節色'] },
      { label: '季節', key: 'citySeason', index: 0, options: ['春', '夏', '秋', '冬'] },
      { label: '色変種', key: 'cityVariant', index: 0, options: ['現行', '淡', '中'] },
      { label: '冬ストロボ', key: 'cityStrobe', index: 0, options: ['OFF', 'ON'] },
```

- [ ] **Step 7: setModeGroup に配線＋import追加** — ファイル冒頭の import に追加：

```js
import { applyCityColorGroup } from '../../cityproto/cityColorControls.js';
```

`setModeGroup`（lines 47-56）の最後の `else if (key === 'scopeSpatial') ...` の後に追記：

```js
    else if (key === 'scopeSpatial') c.setScope({ spatial: SCOPE_SPATIAL[idx] });
    else applyCityColorGroup(key, idx, { core: c, adapter: this._adapter });
```

- [ ] **Step 8: テスト＋ヘッドレス検証** — `node --test` 全green。dev server（:8125）でヘッドレスCDP：
  - `pkill -f cdp-shot` 後、city シーンを起動し操作パネルを開く。
  - 「色→季節色」「季節→秋」を選び `#city-gl` に色が出ることをスクショ確認、「色→モノ」でモノ復帰を確認。
  - 既定（操作前）で俯瞰が動いていること、さらに「俯瞰の動き」を上げ下げして時間差スクショ2枚で公転/呼吸の変化を確認。0で静止。
  - mono基調維持・虹色化しないことを確認。

- [ ] **Step 9: コミット**

```bash
git add src/cityproto/cityColorControls.js tests/cityproto/cityColorControls.test.mjs src/scenes/city/CityScene.js
git commit -m "feat(city): 操作パネルに俯瞰旋回スライダー+季節色グループ(モノ既定/ワンタッチ色)"
```

---

## Task 3: 全体COLORパレットで建物/地面を控えめ着色

**Files:**
- Create: `src/cityproto/cityTint.js`（純粋 `paletteToCityTint`）
- Test: `tests/cityproto/cityTint.test.mjs`
- Modify: `src/cityproto/reveal.js`（建物 tint uniform）、`src/cityproto/cityCore.js`（`setTint`＋地形）、`src/scenes/city/CityScene.js`（update で palette→setTint＋強さスライダー）

**Interfaces:**
- Produces: `export function paletteToCityTint(palette, strength) → {r,g,b,strength}`（0..1 LINEAR乗数・luma≈1・無彩色→(1,1,1)）。`reveal` 返り値に `setTint(tint)`。`cityCore` 返り値に `setTint(tint)`。
- Consumes: `palette.fg`（`[r,g,b]` 0-255、`PaletteManager`）。

**背景（確認済み）:** 建物material＝reveal所有 `MeshBasicMaterial(vertexColors)`＋`onBeforeCompile`あり。地形DEM＝`terrainRef.material` `MeshBasicMaterial(vertexColors)`、`onBeforeCompile`無し→`material.color` 乗算で着色（vColor×color）。`reveal`/`terrainRef` は cityCore のsetter位置のスコープ内。`uCityTintStr=0` 既定で現状ピクセル一致。`reveal.js:12` の「monochrome-safe」コメントを意図的に緩める旨を明記すること。

- [ ] **Step 1: 失敗するテストを書く** — `tests/cityproto/cityTint.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { paletteToCityTint } from '../../src/cityproto/cityTint.js';

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('MONO(白fg) → (1,1,1) 恒等（mono保持）', () => {
  const t = paletteToCityTint({ fg: [255, 255, 255] }, 1);
  assert.ok(near(t.r, 1) && near(t.g, 1) && near(t.b, 1));
});

test('グレーfg → (1,1,1)（無彩色は無着色）', () => {
  const t = paletteToCityTint({ fg: [128, 128, 128] }, 0.8);
  assert.ok(near(t.r, 1) && near(t.g, 1) && near(t.b, 1));
});

test('AMBER(暖色fg) → r>b、luma≈1（明度保存・色相のみ）', () => {
  const t = paletteToCityTint({ fg: [255, 176, 0] }, 0.5);
  assert.ok(t.r > t.b, `warm: r=${t.r} b=${t.b}`);
  assert.ok(near(luma(t.r, t.g, t.b), 1, 1e-3), `luma≈1 got ${luma(t.r, t.g, t.b)}`);
});

test('strength クランプ [0,1]', () => {
  assert.strictEqual(paletteToCityTint({ fg: [255, 0, 0] }, -1).strength, 0);
  assert.strictEqual(paletteToCityTint({ fg: [255, 0, 0] }, 2).strength, 1);
});

test('palette欠如 → 恒等(1,1,1) strength0安全', () => {
  const t = paletteToCityTint(null, 0.5);
  assert.ok(near(t.r, 1) && near(t.g, 1) && near(t.b, 1));
});
```

- [ ] **Step 2: テスト失敗を確認** — Run: `node --test tests/cityproto/cityTint.test.mjs` → FAIL。

- [ ] **Step 3: `cityTint.js` を実装**

```js
// 全体VJパレット → 国立シティの控えめ tint（純粋）。fg の色相だけを低彩度・明度保存で取り出し、
// 0..1 LINEAR の「乗数」(luma≈1) として返す＝建物/地面に掛けても明るさは変えず色相だけ淡く転ぶ。
// 無彩色(MONO/グレー)は (1,1,1)=恒等＝mono保持（守る線）。虹色化しない（半分だけ彩度を残す）。
const SAT = 0.5;
export function paletteToCityTint(palette, strength) {
  const fg = palette && Array.isArray(palette.fg) && palette.fg.length === 3 ? palette.fg : [255, 255, 255];
  let r = fg[0] / 255, g = fg[1] / 255, b = fg[2] / 255;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r = y + (r - y) * SAT; g = y + (g - y) * SAT; b = y + (b - y) * SAT; // 彩度を半分へ
  if (y > 1e-4) { r /= y; g /= y; b /= y; }                            // luma→1（明度保存）
  const s = Math.max(0, Math.min(1, +strength || 0));
  return { r, g, b, strength: s };
}
```

- [ ] **Step 4: テスト合格を確認** — Run: `node --test tests/cityproto/cityTint.test.mjs` → PASS（5 tests）。

- [ ] **Step 5: reveal.js に建物 tint uniform を追加** — `src/cityproto/reveal.js` の `installReveal` 内。

(a) `const uReveal = { value: 0 };`（line 145）の直後に追加：
```js
    const uReveal = { value: 0 };
    const uBand = { value: band };
    const uCityTint = { value: new THREE.Vector3(1, 1, 1) }; // 全体COLOR tint（既定 恒等）
    const uCityTintStr = { value: 0 };                       // 強さ 0=現状ピクセル一致（守る線）
```

(b) `onBeforeCompile` 内の uniform 登録（lines 149-153 群）に追加：
```js
      shader.uniforms.uScopeEnabled = uScopeEnabled;
      shader.uniforms.uCityTint = uCityTint;
      shader.uniforms.uCityTintStr = uCityTintStr;
```

(c) フラグメントの `<common>` 置換（line 174）にuniform宣言を足し、`<color_fragment>` への乗算patchを連結。置換前：
```js
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vReveal;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vReveal < 0.03) discard;');
```
置換後：
```js
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vReveal;\nuniform vec3 uCityTint;\nuniform float uCityTintStr;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vReveal < 0.03) discard;')
        // 全体COLOR：建物のmono明度はそのまま色相だけ淡く掛ける（uCityTintStr=0 で恒等）。
        // reveal.js:12 の monochrome-safe 制約をここで意図的に緩める（控えめ・単一色相・虹色化しない）。
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uCityTint, uCityTintStr);');
```

(d) 返り値オブジェクト（lines 179-194）に setter を追加（`setScopeEnabled` の隣など）：
```js
      setScopeEnabled: (b) => { uScopeEnabled.value = b ? 1 : 0; },
      setTint: (tint) => {
        uCityTint.value.set(
          tint && tint.r != null ? tint.r : 1,
          tint && tint.g != null ? tint.g : 1,
          tint && tint.b != null ? tint.b : 1,
        );
        uCityTintStr.value = Math.max(0, Math.min(1, (tint && tint.strength) || 0));
      },
```

- [ ] **Step 6: cityCore.js に `setTint` を追加** — `src/cityproto/cityCore.js`。

(a) `setScope`（line 243）の直後に関数を追加：
```js
    function setScope(partial) { Object.assign(scopeOpts, partial); if (cityScope) cityScope.setConfig(scopeOpts); }
    // 全体COLOR tint：建物(reveal shader)＋地形DEM(material.color 乗算)へ控えめ着色。
    // strength0 で恒等＝現状一致。tint={r,g,b,strength}（0..1 LINEAR乗数・luma≈1）。
    function setTint(tint) {
      if (reveal && reveal.setTint) reveal.setTint(tint);
      const s = Math.max(0, Math.min(1, (tint && tint.strength) || 0));
      if (terrainRef && terrainRef.material && terrainRef.material.color) {
        const tr = tint && tint.r != null ? tint.r : 1;
        const tg = tint && tint.g != null ? tint.g : 1;
        const tb = tint && tint.b != null ? tint.b : 1;
        // mix(1, tint, s) — vertexColors の乗数（既定 white=恒等）
        terrainRef.material.color.setRGB(1 + (tr - 1) * s, 1 + (tg - 1) * s, 1 + (tb - 1) * s);
      }
    }
```

(b) 返り値オブジェクト（line 270 `setShot, setScope,`）に追加：
```js
      setShot, setScope, setTint,
```

- [ ] **Step 7: CityScene を配線** — `src/scenes/city/CityScene.js`。

(a) import 追加（冒頭）：
```js
import { paletteToCityTint } from '../../cityproto/cityTint.js';
```

(b) constructor で強さ初期値を持ち、強さスライダーを params に追加。`this.params` の `near:`（Task2で追加）の直後に：
```js
      near:      { label: '俯瞰ニア比率', value: 0.25, min: 0, max: 1, step: 0.05, onChange: (v) => this._core && this._core.setShot({ nearRatio: v }) },
      cityTint:  { label: '全体色なじみ', value: 0.2, min: 0, max: 1, step: 0.02, onChange: (v) => { this._tintStr = v; } },
```
constructor 末尾（`this.params = {...}` の後）に：
```js
    this._tintStr = 0.2; // 全体COLOR着色の強さ（cityTint スライダー）
```

(c) `update`（lines 85-90）の core.update の直後に palette→setTint を追加：
```js
  update(dt, audio, palette, clock) {
    this._now += dt * 1000;
    if (!this._ready || !this._core) return;
    this._adapter.update(audio, clock);
    this._core.update(dt, this._now, { audioState: audio, driver: this._adapter, live: true, intro: false });
    if (palette) this._core.setTint(paletteToCityTint(palette, this._tintStr));
  }
```

- [ ] **Step 8: テスト＋ヘッドレス検証＋glb差分確認** —
  - Run: `node --test` → 全green。
  - ヘッドレスCDP：city シーンで全体COLORを MONO→AMBER→CYAN と切替え、`#city-gl` の建物/地面が**淡く**色相転ぶこと、MONO で無着色（モノ）に戻ることをスクショ確認。「全体色なじみ」0 で完全モノ復帰を確認。虹色化しないこと。
  - Run: `git status --porcelain dist/` → `dist/city.glb`・`dist/city.manifest.json` に差分が無いこと（再ベイク無し）。

- [ ] **Step 9: コミット**

```bash
git add src/cityproto/cityTint.js tests/cityproto/cityTint.test.mjs src/cityproto/reveal.js src/cityproto/cityCore.js src/scenes/city/CityScene.js
git commit -m "feat(city): 全体COLORパレットで建物/地面を控えめ着色 (paletteToCityTint+setTint)"
```

---

## 検証（全タスク後）

1. `node --test` 全green（既存＋新規 aerialCam/cityColorControls/cityTint）。
2. ヘッドレスCDP総合：旋回・季節色トグル・全体着色が同時に正しく動き、mono既定・虹色化しない・strobe既定OFF。
3. `git status` で `dist/` byte不変。
4. 二画面：`?role=output` で旋回/季節色/全体着色が出力側にも追従（既存スナップショット経由）— 可能ならヘッドレスで control snapshot 往復を確認。
5. 実機確認はユーザーに委ねる（PC/iPad）。

## Self-Review 反映済み
- 型整合：`tint={r,g,b,strength}` を reveal/cityCore/CityScene/cityTint 全箇所で統一。`orbitRate` の slider→cfg 写像（×0.05）と `defaultShotConfig().orbitRate=0.02` の既定一致を確認。
- 守る線：各機能の「0/既定」が現状ピクセル一致（旋回0=固定、tintStr0=無着色、色モノ=burst）。glb/manifest byte不変。
