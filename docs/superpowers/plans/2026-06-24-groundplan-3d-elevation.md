# GroundPlan 3D立体化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 承認済みの平面地図（通電完了）から街が3Dで立ち上がり、保持→沈む→再構築を繰り返すループを実装。範囲/カメラ/高さ/スタイルの4軸を独立切替可能にする。

**Architecture:** 現 `GroundPlan` シーンを拡張し `ENERGIZE→RISE→HOLD→SINK→(再)RISE` の状態機械を足す。3D描画は保全済み旧版(`5bd28e3`)と `FallingCubes` の弱透視 yaw/pitch 投影・モノクロ階調・裏面カリング・遠近ソート・vantage walker を流用。4軸は Scene/ControlPanel に追加する汎用 `modeGroups` 機構で出す。承認済み平面ジオメトリは凍結。

**Tech Stack:** Plain ES Modules, Canvas 2D（ビルド/依存なし）。検証は preview MCP のスクショ/eval（テストフレームワーク無し）。

**Spec:** `docs/superpowers/specs/2026-06-24-groundplan-3d-elevation-design.md`

---

## 検証方法（全タスク共通）

テストランナーが無いため、各タスクは **preview MCP で視覚検証**する:
1. `preview_start`（既存 launch config `vj`）。
2. SWキャッシュ汚染を避けるため eval で unregister + caches 削除 → `window.location.reload()`。
3. eval で起動＋シーン切替: `document.getElementById('start').click(); window.__vj.scenes.start('groundplan')`。
4. 状態を eval で固定（例: `s._phase=...; s._rise=...; s.params.buildSpeed.value=0`）してから `preview_screenshot`。
5. `preview_console_logs level:error` で 0 件を確認。
`window.__vj = { engine, scenes, audio, palette, clock, canvas }`、シーンは `window.__vj.scenes.byId['groundplan']`。

## File Structure
- `src/scenes/Scene.js` — 基底に `modeGroups` / `setModeGroup` / `mg` を追加（後方互換・小）。
- `src/ui/ControlPanel.js` — `_rebuildSceneControls()` に modeGroups ボタン行描画を追加（小）。
- `src/scenes/dots/GroundPlan.js` — 状態機械・`_buildBlocks`・3D投影/描画・4軸を追加（大・自己完結。FallingCubes は変更しない）。
- 参照（コピー元、変更しない）: `src/scenes/dots/FallingCubes.js`、旧版 `git show 5bd28e3:src/scenes/dots/GroundPlan.js`。

---

## Task 1: modeGroups 汎用機構（Scene + ControlPanel）

**Files:**
- Modify: `src/scenes/Scene.js`
- Modify: `src/ui/ControlPanel.js:116-160`（`_rebuildSceneControls`）

- [ ] **Step 1: Scene 基底に modeGroups を追加**

`src/scenes/Scene.js` の constructor に `this.modeGroups = null;` を追加（`this.modeIndex = 0;` の直後）。メソッドを追加:

```js
// optional named button-groups: [{ key, label, options:[string], index }]
setModeGroup(key, i) {
  const g = this.modeGroups && this.modeGroups.find((x) => x.key === key);
  if (!g) return;
  g.index = ((i % g.options.length) + g.options.length) % g.options.length;
}
mg(key) {
  const g = this.modeGroups && this.modeGroups.find((x) => x.key === key);
  return g ? g.index : 0;
}
```

- [ ] **Step 2: ControlPanel に modeGroups ボタン行を描画**

`src/ui/ControlPanel.js` `_rebuildSceneControls()` の views ブロック（`if (scene.views && scene.setView)` の閉じ `}` の直後、slider 生成の前）に追加:

```js
// Generic named mode-groups (e.g. GroundPlan: 範囲 / カメラ / 高さ / スタイル).
if (scene.modeGroups && scene.setModeGroup) {
  for (const g of scene.modeGroups) {
    const grow = document.createElement('div');
    grow.className = 'vj-row vj-modes';
    const lab = document.createElement('span');
    lab.className = 'vj-mg-label';
    lab.textContent = g.label;
    grow.appendChild(lab);
    g.options.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'vj-btn small' + (i === g.index ? ' active' : '');
      b.textContent = name;
      b.addEventListener('click', () => { scene.setModeGroup(g.key, i); this._rebuildSceneControls(); });
      grow.appendChild(b);
    });
    c.appendChild(grow);
  }
}
```

- [ ] **Step 3: 視覚検証（後方互換）**

preview 起動 → 既存シーン（dancers, tunnel）に切替し、modes/views/sliders が従来どおり出る＆エラー0を確認（modeGroups 未定義シーンは無影響）。GroundPlan の4軸は Task 6 で実描画確認。

- [ ] **Step 4: Commit**

```bash
git add src/scenes/Scene.js src/ui/ControlPanel.js
git commit -m "feat(ui): Scene に汎用 modeGroups（複数ボタン群）を追加"
```

---

## Task 2: 建物 footprint 生成（`_buildBlocks`）

**Files:** Modify `src/scenes/dots/GroundPlan.js`

footprint は平面ジオメトリ（凍結）から一度だけ生成。block = `{ uMin,uMax,vMin,vMax, hNorm, key, kind }`。
`u` は px（plan x）、`v` は py（plan y）。`key` = apex からの距離を `_reach` 正規化（near→far スイープ順）。`kind`: 0=inside, 1=outside, 2=landmark。

- [ ] **Step 1: 定数とブロック生成を追加**

GroundPlan に定数を追加（ファイル上部）:

```js
const MAX_BLOCKS = 240;
const K_INSIDE = 0, K_OUTSIDE = 1, K_LAND = 2;
```

`_build()` の末尾（`this._seg = seg;` の後）で `this._buildBlocks()` を呼ぶ。新メソッド:

```js
_buildBlocks() {
  const k = this.p('density');
  const dv = DV_BASE / k, dh = DH_BASE / k;
  const blocks = [];
  const reach = this._reach || 1.4;
  const distKey = (u, v) => clamp(Math.hypot(u, v) / reach, 0, 1);
  const inPent = (u, v) => v >= 0 && v <= SOUTH && u > this._xLb(v) && u < this._xRb(v);
  const inCamp = (u, v) => this._campus.some((c) => u > c[0] && u < c[2] && v > c[1] && v < c[3]);

  // landmarks first (never culled by the cap)
  blocks.push({ uMin: -0.05, uMax: 0.05, vMin: -0.06, vMax: 0.04, hNorm: 1.4, key: 0.02, kind: K_LAND }); // 駅舎タワー
  for (const c of this._campus) {
    blocks.push({ uMin: c[0], uMax: c[2], vMin: c[1], vMax: c[3], hNorm: 0.5,
      key: distKey((c[0] + c[2]) / 2, (c[1] + c[3]) / 2), kind: K_LAND }); // 一橋 西/東
  }

  // grid cells -> blocks (inset a hair so faces read as separate lots)
  const inset = Math.min(dv, dh) * 0.16;
  for (let v = 0.10; v < EXT_S - dh; v += dh) {
    for (let u = -EXT_X + dv; u < EXT_X; u += dv) {
      const cu = u + dv / 2, cv = v + dh / 2;
      if (Math.abs(cu) < CL) continue;                 // spine corridor
      if (inCamp(cu, cv)) continue;                    // campuses are explicit
      const inside = inPent(cu, cv);
      const kind = inside ? K_INSIDE : K_OUTSIDE;
      const n = this.noise.noise2D(cu * 3.1, cv * 3.1) * 0.5 + 0.5; // 0..1 stable
      const spineBoost = 1 + 0.5 * smoothstep(0.5, 0.0, Math.abs(cu)); // taller near 大学通り
      const hNorm = (inside ? 0.35 + 0.6 * n : 0.18 + 0.25 * n) * spineBoost;
      blocks.push({ uMin: u + inset, uMax: u + dv - inset, vMin: v + inset, vMax: v + dh - inset,
        hNorm, key: distKey(cu, cv), kind });
    }
  }
  // keep landmarks + nearest blocks under the cap (sort inside/outside by key)
  const land = blocks.filter((b) => b.kind === K_LAND);
  const rest = blocks.filter((b) => b.kind !== K_LAND).sort((a, b) => a.key - b.key);
  this._blocks = land.concat(rest).slice(0, MAX_BLOCKS);
}
```

このタスクでは `this.noise` が必要。constructor に `this.noise = new SimplexNoise(19);` を追加し、import に `SimplexNoise`（`'../../lib/noise.js'`）を足す。`_build()` を density 変更で再構築する既存導線（update 内）で blocks も再生成される。

- [ ] **Step 2: 視覚検証（データのみ）**

reload 後 eval:
```js
const s=window.__vj.scenes.byId['groundplan'];
const k={}; for(const b of s._blocks) k[b.kind]=(k[b.kind]||0)+1; ({total:s._blocks.length, byKind:k});
```
landmark=3、inside/outside が妥当な数、total ≤ 240 を確認。平面表示は不変（描画未変更）、エラー0。

- [ ] **Step 3: Commit**

```bash
git add src/scenes/dots/GroundPlan.js
git commit -m "feat(groundplan): 平面ジオメトリから建物 footprint を生成（_buildBlocks）"
```

---

## Task 3: 3D投影を導入し、地面（道路網/格子）を投影描画に切替（平面の見えを保つ）

**Files:** Modify `src/scenes/dots/GroundPlan.js`

現在の地面描画は ortho（`cx + u*S`）。3Dでカメラが傾くと地面も傾く必要があるため、`5bd28e3`/`FallingCubes` の弱透視投影に統一。**真俯瞰時は弱透視≒ortho** なので、承認済みの平面の見えを保てる（要スクショ確認）。

- [ ] **Step 1: 投影・カメラを追加**

定数 `const FOCAL = 4.5;` を追加。constructor にカメラ状態 `this._camYaw = 0; this._camPitch = -1.55;`（pitch負=俯瞰）を追加。投影ヘルパを追加（`5bd28e3` の `_project`/`_pv` と同型。`basis = {ccy,scy,ccp,scp,F,cx,cy}`、`F=FOCAL*H`）:

```js
_project(wx, wy, wz, b, out) {
  const X = wx * b.ccy - wz * b.scy;
  const Z = wx * b.scy + wz * b.ccy;
  const Y = wy * b.ccp - Z * b.scp;
  const Z2 = wy * b.scp + Z * b.ccp;
  const f = b.F / (b.F - Z2);
  out[0] = b.cx + X * f; out[1] = b.cy + Y * f; out[2] = f;
}
```

world 座標系: `wx = u*spanX`, `wz = (v-0.5)*2*spanZ`, `wy` は地面=0、上=負（高さ h は base=0, top=-h）。`spanX=H*0.5`, `spanZ=H*0.5` を `_layout` で算出（plan u,v が等倍で投影されるよう調整）。

- [ ] **Step 2: 地面描画を `_toScreen` から `_project` へ**

`draw()` の地面ループで、各 segment 端点を `wx=u*spanX, wy=0, wz=(v-0.5)*2*spanZ` として `_project(...,basis,out)` で 2D 化（`_toScreen` を置換）。basis は現在のカメラ（ENERGIZE 中は俯瞰固定）で構築。`cx=w/2`, `cy=h*0.5 + H*lerp(...)`（旧版同様、立ち上げで原点を少し上げる。当面は俯瞰固定値）。

- [ ] **Step 3: 視覚検証（平面の見えを保持）**

reload → groundplan → `s._front=1` で完成形をスクショ。**承認済み平面地図（b583a67）とほぼ同一**に見えること（角度・五角形・内外格子・大学通り）。差が大きければ `FOCAL`/`spanX`/`spanZ`/`cy` を調整。エラー0。

- [ ] **Step 4: Commit**

```bash
git add src/scenes/dots/GroundPlan.js
git commit -m "feat(groundplan): 地面描画を弱透視投影に統一（俯瞰では平面の見えを維持）"
```

---

## Task 4: フェーズ状態機械 + カメラ傾き

**Files:** Modify `src/scenes/dots/GroundPlan.js`

- [ ] **Step 1: 状態とフェーズ進行を追加**

定数:
```js
const PH_ENERGIZE = 0, PH_RISE = 1, PH_HOLD = 2, PH_SINK = 3;
const BAR = 4, SEC_BEATS = BAR * 8, HOLD_SECTIONS = 3;
const SINK_RATE = 0.26;   // 音非依存（停止しない）
```
constructor: `this._phase = PH_ENERGIZE; this._rise = 0; this._riseView = 0; this._secStart = 0; this._holdN = 0;`

`update(dt, audio, palette, clock)` に状態機械を追加（既存の `_front` 通電進行はそのまま）:

```js
const beatsF = clock.beats + clock.beatPhase;
const drive = clamp(audio.level * 0.7 + Math.max(0, audio.level - this._energy) * 1.6 + audio.bass * 0.5, 0, 1.5);
switch (this._phase) {
  case PH_ENERGIZE:
    if (this._front >= 1) { this._phase = PH_RISE; }
    break;
  case PH_RISE:
    this._rise = clamp(this._rise + dt * this.p('riseSpeed') * Math.max(STALL, drive), 0, 1);
    if (this._rise >= 1) { this._phase = PH_HOLD; this._secStart = beatsF; this._holdN = 0; }
    break;
  case PH_HOLD:
    if (beatsF - this._secStart >= SEC_BEATS) {
      this._secStart = beatsF;
      if (++this._holdN >= HOLD_SECTIONS) this._phase = PH_SINK;
    }
    break;
  case PH_SINK:
    this._rise -= dt * SINK_RATE;
    if (this._rise <= 0) { this._rise = 0; this._phase = PH_RISE; } // 地図は通電済みのまま再構築
    break;
}
this._riseView += (this._rise - this._riseView) * Math.min(1, dt * 4); // anti-pop
```

`riseSpeed` パラメータを追加: `this.defineParam('riseSpeed', 0.16, 0.04, 0.5, 0.02, 'Rise Speed');`

- [ ] **Step 2: カメラ傾きを `_riseView` に連動**

`update` 末でカメラ目標を更新（当面 Tilt 相当・default 値）:
```js
const tilt = smoothstep(0.0, 1.0, this._riseView);
const pitchTgt = lerp(1.55, 0.62, tilt);   // 俯瞰 -> 3/4
const yawTgt = lerp(0.0, 0.45, tilt);
this._camPitch += (-pitchTgt - this._camPitch) * Math.min(1, dt * 3);
this._camYaw += (yawTgt - this._camYaw) * Math.min(1, dt * 3);
```
`cy` の持ち上げも `_riseView` 連動に（旧版同様 `lerp(0.05, -0.10, tilt)`）。

- [ ] **Step 3: 視覚検証（フェーズ遷移）**

eval で各フェーズを固定してスクショ:
- `s._front=1; s._phase=1; s._rise=0.0`（RISE開始＝ほぼ俯瞰）
- `s._rise=0.5`（傾き途中、地面が3/4に傾く）
- `s._rise=1`（傾き切り）
地面（道路網・格子）が傾いて見えること、エラー0。建物はまだ未描画でOK。

- [ ] **Step 4: Commit**

```bash
git add src/scenes/dots/GroundPlan.js
git commit -m "feat(groundplan): ENERGIZE→RISE→HOLD→SINK ループ + カメラ傾き"
```

---

## Task 5: 建物の押し出し描画 + スタイル軸（Hybrid/Wire/Solid）

**Files:** Modify `src/scenes/dots/GroundPlan.js`

`5bd28e3` の面描画（`BOX_F`・world法線シェーディング・camera法線z 裏面カリング・遠→近ソート・トーンバケツ）を流用し、`_riseView` で高さを near→far にスイープ。

- [ ] **Step 1: 面定数・バッファ・modeGroups を追加**

`BOX_F`（top+4壁、`5bd28e3` からコピー）、`NTONE=16`、ライト定数 `LNX/LNY/LNZ`、投影/面スクラッチ（`_pvx/_pvy/_pvf/_fSlot/_fIdx/_fCz/_fBucket/_fOrder/_toneCss`、`MAX_BLOCKS*8` / `MAX_BLOCKS*5`）。modeGroups を定義（4軸・default★）:

```js
this.modeGroups = [
  { key: 'scope',  label: '範囲',     options: ['District', 'City', 'Landmark'], index: 0 },
  { key: 'cam',    label: 'カメラ',   options: ['Tilt', 'Live', 'Plan'],         index: 1 },
  { key: 'height', label: '高さ',     options: ['Vary', 'Even', 'Pulse'],        index: 0 },
  { key: 'style',  label: 'スタイル', options: ['Hybrid', 'Wire', 'Solid'],      index: 0 },
];
this.defineParam('light', 0.6, 0, 1, 0.05, 'Light');
```

- [ ] **Step 2: ブロック投影＋描画を draw に追加**

地面描画（far半分）→ ブロック描画 → 地面描画（near半分）の順は当面省略可（まず全地面→全ブロックでよい）。各 block について `local = smoothstep(b.key, b.key+0.14, front3d)`（`front3d = 1.15*smoothstep(0,1,this._riseView)`）、`h = b.hNorm * hScale * local`（`hScale = H*0.105`）。8頂点を `_pv` で投影、`BOX_F` を world法線シェーディング＋camera法線z カリング、遠→近ソートして塗り。トーンは `bg→fg` バケツ（`_toneCss`）。`5bd28e3` の draw のブロック節をそのまま移植し、`bView` を `this._riseView` に読み替える。

`style` 軸: `Wire`=面を塗らず可視エッジを stroke、`Solid`=面塗りのみ、`Hybrid`=面塗り＋明エッジ（`5bd28e3` の mode 0/1/2 と同じ分岐。`this.mg('style')` で選択）。

- [ ] **Step 3: 視覚検証（立ち上がり・スタイル）**

`s._front=1; s._phase=2; s._rise=1`（HOLD・完成）でスクショ。建物が地図から立ち上がっていること。`s.setModeGroup('style',0/1/2)` で Hybrid/Wire/Solid が切り替わること。`s._rise=0.5` で near→far に途中まで立つこと。monochrome（赤は駅ノードのみ）、エラー0。

- [ ] **Step 4: Commit**

```bash
git add src/scenes/dots/GroundPlan.js
git commit -m "feat(groundplan): 建物の押し出し3D描画 + スタイル軸（Hybrid/Wire/Solid）"
```

---

## Task 6: 範囲・高さ・カメラ軸の配線

**Files:** Modify `src/scenes/dots/GroundPlan.js`

- [ ] **Step 1: Scope（どのブロックを立てるか）**

ブロック描画ループ先頭で scope により間引く（`this.mg('scope')`）:
- `District`(0): `kind===K_OUTSIDE` はスキップ（外側は地面=平面のまま）。
- `City`(1): 全て描画（外側は hNorm 低めのまま）。
- `Landmark`(2): `kind!==K_LAND` はスキップ。
地面（道路網・内外格子）は全 scope で従来どおり投影描画（外側格子は地面として残る）。

- [ ] **Step 2: Height（hNorm の決め方）**

`hScale` 算出時に height 軸を反映（`this.mg('height')`）:
- `Vary`(0): 現状（`_buildBlocks` の hNorm をそのまま）。
- `Even`(1): 描画時に `hEff = (b.kind===K_LAND ? b.hNorm : 0.6)` と均一化。
- `Pulse`(2): `hEff = b.hNorm * (0.5 + 1.2 * band)`。band は領域で `audio.bass/mid/treble` を割当（例: `Math.abs(cu)` 帯で選択。block に算出済みの帯 index を持たせるか、`b.uMin` から導出）。

- [ ] **Step 3: Camera（Tilt/Live/Plan）**

Task 4 のカメラ目標を `this.mg('cam')` で分岐:
- `Tilt`(0): 現状（俯瞰→3/4 固定）。
- `Live`(1, default): HOLD 中に `LIVE_VANTAGES`（`5bd28e3` からコピー）を crossfade する walker で pitch/yaw を動かす（`SEC_BEATS` 毎に次 vantage、`_xfade` で補間）。
- `Plan`(2): pitch を俯瞰寄り（`lerp(1.54, 1.30, tilt)`）に保ち軽いあおりのみ。

- [ ] **Step 4: 視覚検証（全軸）**

reload → groundplan。`s._phase=2; s._rise=1` 固定で:
- `scope` 0/1/2 → 押し出し範囲が District/City/Landmark で変化。
- `height` 0/1/2 → 高さ分布が変化（Pulse は eval で audio を擬似注入 or マイクで上下）。
- `cam` 0/1/2 → アングル挙動（Live は数秒観察で視点移動）。
各スクショ取得、ControlPanel に4行のボタンが出てクリック切替できること、エラー0。

- [ ] **Step 5: Commit**

```bash
git add src/scenes/dots/GroundPlan.js
git commit -m "feat(groundplan): 範囲/高さ/カメラ軸を配線（4軸切替が機能）"
```

---

## Task 7: 仕上げ・通しループ検証・性能

**Files:** Modify `src/scenes/dots/GroundPlan.js`（微調整）

- [ ] **Step 1: 通しループ + 性能の確認**

`buildSpeed`/`riseSpeed` を既定に戻し、マイク（または eval で audio 擬似）で `ENERGIZE→RISE→HOLD→SINK→再RISE` が自律で回ることを確認。`clock.quality<0.7` で面/格子を間引く節があること（無ければ追加）。`MAX_BLOCKS` 上限で重さが出ないこと（FPS 確認）。

- [ ] **Step 2: 美学・整合の最終確認**

スクショで: monochrome 厳守（虹色なし・赤は駅ノードのみ）、`District` の外側が地面として残る、`Wire/Solid/Hybrid` 各正常、平面（ENERGIZE）が承認版の見えを保つ。`docs/.../specs` の各 Scope/Camera/Height/Style 要件にスクショで対応づけ。console エラー0。height noise レンジ・HOLD長さ・SINKレートを必要に応じ調整。

- [ ] **Step 3: Commit**

```bash
git add src/scenes/dots/GroundPlan.js
git commit -m "polish(groundplan): 3D立ち上げの通しループ・性能・美学を調整"
```

- [ ] **Step 4: （任意）デプロイ**

ユーザー承認後: `sw.js` の `CACHE_VERSION` を `vj-v14→v15` に bump → commit → `git push origin main`。本番 `sw.js` が v15、`GroundPlan.js` が3D版であることを curl で確認。

---

## Self-Review（このプランの自己点検）

- **Spec coverage:** 流れ(状態機械=T4)、4軸(modeGroups=T1, style=T5, scope/height/cam=T6)、3Dエンジン流用(T3/T5)、footprint(T2)、地面統合(T3)、美学/性能(T7)、検証(各T)。spec の全節に対応タスクあり。
- **Placeholder scan:** 各 step に具体コード/手順/検証を記載。`Pulse` の帯域割当のみ実装時に確定（T6-Step2 に算出方針明記）。
- **Type/名前整合:** `this.mg(key)` / `setModeGroup(key,i)`（T1）、`_blocks` 要素 `{uMin,uMax,vMin,vMax,hNorm,key,kind}`（T2）、`_riseView`/`_phase`/`PH_*`（T4）、`BOX_F`/`_toneCss`/`front3d`（T5）を一貫使用。`K_INSIDE/K_OUTSIDE/K_LAND`（T2）と scope 分岐（T6）整合。
