# Oscilloscope 操作パネル整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Oscilloscope の操作パネルを、意味でグループ化した開閉アコーディオン＋relevance点灯/減光に再編し、Auto を「軸ごとに委ねる先を選べる」方式へ作り直す（全機能キープ）。

**Architecture:** relevance/グループ判定は DOM 非依存の純モジュール `scopeControls.js` に集約（ユニットテスト対象）。Oscilloscope はそれを import して `controlGroups` 宣言と `autoArm` 状態を持ち、`_eff*`/spinRate を `autoDrives` でゲート。ControlPanel は「`controlGroups` があればアコーディオン描画、無ければ従来フラット」で分岐（他シーン無改変）。パネルとロジックが同じ純関数を共有し、減光と実挙動が一致する。

**Tech Stack:** Buildless ES modules（`"type":"module"`）、Canvas2D/WebGL、Node 組み込みテスト（`node --test` / `node:assert`）、依存ゼロ。

**Spec:** `docs/superpowers/specs/2026-07-01-oscilloscope-control-reorg-design.md`

**実行前提:** 全コマンドはリポジトリルート `/Users/shiwa/Claude-Atelier/VJ` から実行。ローカル配信は既存の `http://localhost:8125`（起動済み想定）。

## Global Constraints

- **決定論:** `src` ランタイムで `Math.random` / `Date` / `performance.now` 不使用。追加ロジックは真偽/選択値のみ、自動値は既存の `clock.time`/`clock.beats` 由来の数式のまま（改変しない）。
- **モノクロ:** canvas 描画の数式は変更しない。UI chrome は既存 `.vj` CSS 変数（`--vj-fg`/`--vj-dim`/`--vj-line`）に準拠。
- **依存ゼロ:** 新規ライブラリ追加禁止。
- **内部キー据え置き:** `this.mg('drive')` / `this.p('drive')` 等のロジックは無改変。変えるのは modeGroup `drive` の**表示ラベルのみ**（`'Drive'`→`'Band'`）。
- **他シーン無改変:** ControlPanel の従来フラット描画は `controlGroups` 未宣言のシーンにそのまま残す。
- **本番デプロイはユーザー明示承認時のみ**（このプランにデプロイは含まない）。承認時は素URL検証＋`CACHE_VERSION` bump。
- **視覚はスクショで実見してから完了報告。**
- **コミット trailer（各コミットの末尾に付与）:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi
  ```

---

## File Structure

- **Create** `src/scenes/dots/scopeControls.js` — 純モジュール：`CONTROL_GROUPS`（5グループ構造）、`AUTO_AXES`、`DEFAULT_AUTO_ARM`、`autoDrives`、`canArm`、`isControlActive`、`isGroupActive`。DOM/時間非依存。
- **Create** `tests/dots/scopeControls.test.mjs` — 純関数のユニットテスト（relevance/canArm/autoDrives）。
- **Create** `tests/dots/scopeControlModel.test.mjs` — Oscilloscope への配線テスト（構造網羅/Band/既定arm/group-active）。
- **Create** `tests/dots/scopeAutoArm.test.mjs` — Auto 軸ゲートのテスト（`_eff*`＋回転を update 経由）。
- **Modify** `src/scenes/dots/Oscilloscope.js` — import 追加、constructor に `controlGroups`/`autoArm`＋Band ラベル、`_ctrlState`/`isControlActive`/`isGroupActive`/`canArm`/`toggleArm` メソッド（Task 2）、`_eff*`/spinRate ゲート（Task 3）。
- **Modify** `src/ui/ControlPanel.js` — `_groupState` 初期化、`_modeGroupRow` 抽出、`_renderAccordion`/`_renderItem`/`_autoArmRow` 追加、`_rebuildSceneControls` 分岐（Task 4）。
- **Modify** `src/ui/ui.css` — アコーディオン＋減光スタイル（Task 4）。

---

## Task 1: 純制御モデル `scopeControls.js`

**Files:**
- Create: `src/scenes/dots/scopeControls.js`
- Test: `tests/dots/scopeControls.test.mjs`

**Interfaces:**
- Consumes: なし（純粋）。`state` は `{ mode:int, form:int, spread:int, auto:bool, spinOn:bool, arm:{phase,flip,band,spread,rot} }`。
- Produces:
  - `AUTO_AXES: string[]` = `['phase','flip','band','spread','rot']`
  - `DEFAULT_AUTO_ARM: object` = `{ phase:true, flip:false, band:false, spread:true, rot:true }`
  - `CONTROL_GROUPS: {key,label,items:{t,k}[]}[]`（t: 'p'|'g'|'m'）
  - `autoDrives(axis, state) -> bool`
  - `canArm(axis, state) -> bool`
  - `isControlActive(id, state) -> bool`（id = `` `${t}:${k}` ``）
  - `isGroupActive(groupKey, state) -> bool`

- [ ] **Step 1: 失敗するテストを書く** — `tests/dots/scopeControls.test.mjs`

```js
import assert from 'node:assert';
import { test } from 'node:test';
import {
  isControlActive, isGroupActive, canArm, autoDrives,
  CONTROL_GROUPS, AUTO_AXES, DEFAULT_AUTO_ARM,
} from '../../src/scenes/dots/scopeControls.js';

const base = { mode: 0, form: 0, spread: 0, auto: false, spinOn: true, arm: { ...DEFAULT_AUTO_ARM } };
const st = (o) => ({ ...base, ...o });
const armset = (s) => AUTO_AXES.filter((a) => canArm(a, s));

test('CONTROL_GROUPS has the five groups in order', () => {
  assert.deepStrictEqual(CONTROL_GROUPS.map((g) => g.key), ['draw', 'size', 'figure', 'motion', 'solid']);
});

test('Line/Circle: figure/motion/solid all dim, draw/size lit', () => {
  for (const mode of [0, 1]) {
    const s = st({ mode });
    assert.strictEqual(isControlActive('p:thickness', s), true);
    assert.strictEqual(isControlActive('p:gain', s), true);
    assert.strictEqual(isControlActive('p:phase', s), false);
    assert.strictEqual(isControlActive('g:spin', s), false);
    assert.strictEqual(isControlActive('g:sphere', s), false);
    assert.strictEqual(isGroupActive('draw', s), true);
    assert.strictEqual(isGroupActive('figure', s), false);
    assert.strictEqual(isGroupActive('motion', s), false);
    assert.strictEqual(isGroupActive('solid', s), false);
  }
});

test('XY (auto off): figure+motion active, solid dim', () => {
  const s = st({ mode: 2, auto: false });
  assert.strictEqual(isControlActive('p:phase', s), true);
  assert.strictEqual(isControlActive('g:flip', s), true);
  assert.strictEqual(isControlActive('g:drive', s), true);
  assert.strictEqual(isControlActive('p:drive', s), true);
  assert.strictEqual(isControlActive('g:spin', s), true);
  assert.strictEqual(isControlActive('p:rotate', s), true);
  assert.strictEqual(isGroupActive('solid', s), false);
});

test('XY (auto on, default arm): armed dim, unarmed lit, master lit', () => {
  const s = st({ mode: 2, auto: true });
  assert.strictEqual(isControlActive('p:phase', s), false); // armed → auto → dim
  assert.strictEqual(isControlActive('g:flip', s), true);   // unarmed → manual → lit
  assert.strictEqual(isControlActive('g:drive', s), true);  // band unarmed → lit
  assert.strictEqual(isControlActive('g:spin', s), false);  // rot armed → dim
  assert.strictEqual(isControlActive('p:rotate', s), false);
  assert.strictEqual(isControlActive('g:auto', s), true);
});

test('rotate dims when Spin OFF', () => {
  const s = st({ mode: 2, auto: false, spinOn: false });
  assert.strictEqual(isControlActive('g:spin', s), true);
  assert.strictEqual(isControlActive('p:rotate', s), false);
});

test('GLOBE: Band/Drive lit, Phase/Flip dim; Form/Density lit', () => {
  const s = st({ mode: 3, form: 0, auto: false });
  assert.strictEqual(isControlActive('p:phase', s), false);
  assert.strictEqual(isControlActive('g:flip', s), false);
  assert.strictEqual(isControlActive('g:drive', s), true);
  assert.strictEqual(isControlActive('p:drive', s), true);
  assert.strictEqual(isControlActive('g:sphere', s), true);
  assert.strictEqual(isControlActive('p:density', s), true);
  assert.strictEqual(isControlActive('g:spread', s), false);
  assert.strictEqual(isControlActive('p:core', s), false);
  assert.strictEqual(isControlActive('p:count', s), false);
});

test('TERRAIN: React/Band dim, Drive lit; Form/Density/Core lit', () => {
  const s = st({ mode: 3, form: 3, auto: false });
  assert.strictEqual(isControlActive('p:react', s), false);
  assert.strictEqual(isControlActive('p:thickness', s), true);
  assert.strictEqual(isControlActive('g:drive', s), false);
  assert.strictEqual(isControlActive('p:drive', s), true);
  assert.strictEqual(isControlActive('p:density', s), true);
  assert.strictEqual(isControlActive('p:core', s), true);
  assert.strictEqual(isControlActive('p:count', s), false);
});

test('LISSA spreads: RIBBON→count / HELIX→density+core / plain→core', () => {
  const ribbon = st({ mode: 3, form: 2, spread: 4, auto: false });
  assert.strictEqual(isControlActive('p:count', ribbon), true);
  assert.strictEqual(isControlActive('p:core', ribbon), false);
  assert.strictEqual(isControlActive('p:density', ribbon), false);
  const helix = st({ mode: 3, form: 2, spread: 5, auto: false });
  assert.strictEqual(isControlActive('p:density', helix), true);
  assert.strictEqual(isControlActive('p:core', helix), true);
  assert.strictEqual(isControlActive('p:count', helix), false);
  const plain = st({ mode: 3, form: 2, spread: 0, auto: false });
  assert.strictEqual(isControlActive('p:core', plain), true);
  assert.strictEqual(isControlActive('p:density', plain), false);
  assert.strictEqual(isControlActive('p:count', plain), false);
});

test('canArm by mode', () => {
  assert.deepStrictEqual(armset(st({ mode: 2 })), ['phase', 'flip', 'band', 'rot']);
  assert.deepStrictEqual(armset(st({ mode: 3, form: 2 })), ['phase', 'flip', 'band', 'spread', 'rot']);
  assert.deepStrictEqual(armset(st({ mode: 3, form: 0 })), ['band', 'rot']);
  assert.deepStrictEqual(armset(st({ mode: 3, form: 3 })), ['rot']);
  assert.deepStrictEqual(armset(st({ mode: 0 })), []);
});

test('autoDrives = auto AND arm', () => {
  assert.strictEqual(autoDrives('phase', st({ auto: true })), true);
  assert.strictEqual(autoDrives('phase', st({ auto: false })), false);
  assert.strictEqual(autoDrives('flip', st({ auto: true })), false); // flip unarmed by default
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/dots/scopeControls.test.mjs`
Expected: FAIL（`Cannot find module '.../scopeControls.js'`）

- [ ] **Step 3: 実装** — `src/scenes/dots/scopeControls.js` を新規作成

```js
// src/scenes/dots/scopeControls.js
// Pure control-model for the Oscilloscope panel: which controls exist, how they
// group, and whether each is "active" (lit) or inert (dimmed) for a given manual
// mode state. No DOM, no time — so the accordion panel and the _eff* behaviour
// gating share one source of truth and the panel never jitters.
// state = { mode, form, spread, auto, spinOn, arm } — mode 0 Line/1 Circle/2 XY/
// 3 Sphere; form 0 GLOBE/1 WRAP/2 LISSA/3 TERRAIN; spread 0..5; arm = per-axis bool.

// Axes Auto can drive, and the tasteful default arm set (not "blindly everything").
export const AUTO_AXES = ['phase', 'flip', 'band', 'spread', 'rot'];
export const DEFAULT_AUTO_ARM = { phase: true, flip: false, band: false, spread: true, rot: true };

// Five accordion groups. Items typed: t='p' param slider, 'g' single-select
// modeGroup, 'm' the Auto arm selector. Every param key and modeGroup key appears
// exactly once (a structural test in scopeControlModel guards this).
export const CONTROL_GROUPS = [
  { key: 'draw',   label: '描画',     items: [{ t: 'p', k: 'thickness' }, { t: 'p', k: 'react' }] },
  { key: 'size',   label: 'サイズ',   items: [{ t: 'p', k: 'gain' }, { t: 'p', k: 'range' }] },
  { key: 'figure', label: '図形',     items: [{ t: 'p', k: 'phase' }, { t: 'g', k: 'flip' }, { t: 'g', k: 'drive' }, { t: 'p', k: 'drive' }] },
  { key: 'motion', label: '動き',     items: [{ t: 'g', k: 'auto' }, { t: 'm', k: 'autoArm' }, { t: 'g', k: 'spin' }, { t: 'p', k: 'rotate' }] },
  { key: 'solid',  label: '立体構造', items: [{ t: 'g', k: 'sphere' }, { t: 'g', k: 'spread' }, { t: 'p', k: 'density' }, { t: 'p', k: 'core' }, { t: 'p', k: 'count' }] },
];

export function autoDrives(axis, state) {
  return !!state.auto && !!state.arm[axis];
}

// Which axes have an effect in this mode (drives the "動かす軸" row).
export function canArm(axis, state) {
  const sphere = state.mode === 3;
  switch (axis) {
    case 'phase':  return state.mode === 2 || (sphere && state.form === 2);
    case 'flip':   return state.mode === 2 || (sphere && state.form === 2);
    case 'band':   return state.mode === 2 || (sphere && state.form <= 2);
    case 'spread': return sphere && state.form === 2;
    case 'rot':    return state.mode === 2 || sphere;
    default:       return false;
  }
}

// Lit (true) or dimmed (false) for this state. id = `${t}:${k}`.
export function isControlActive(id, state) {
  const sphere = state.mode === 3;
  const rotatable = state.mode === 2 || sphere;
  const form = state.form, spread = state.spread;
  switch (id) {
    case 'p:thickness': return true;
    case 'p:react':     return !(sphere && form === 3);
    case 'p:gain':      return true;
    case 'p:range':     return true;
    case 'p:phase':     return (state.mode === 2 || (sphere && form === 2)) && !autoDrives('phase', state);
    case 'g:flip':      return (state.mode === 2 || (sphere && form === 2)) && !autoDrives('flip', state);
    case 'g:drive':     return (state.mode === 2 || (sphere && form <= 2)) && !autoDrives('band', state);
    case 'p:drive':     return state.mode === 2 || sphere;
    case 'g:auto':      return rotatable;
    case 'm:autoArm':   return rotatable;
    case 'g:spin':      return rotatable && !autoDrives('rot', state);
    case 'p:rotate':    return rotatable && !autoDrives('rot', state) && state.spinOn;
    case 'g:sphere':    return sphere;
    case 'g:spread':    return sphere && form === 2 && !autoDrives('spread', state);
    case 'p:density':   return sphere && (form === 0 || form === 1 || form === 3 || (form === 2 && spread === 5));
    case 'p:core':      return sphere && (form === 3 || (form === 2 && spread !== 4));
    case 'p:count':     return sphere && form === 2 && spread === 4;
    default:            return true;
  }
}

export function isGroupActive(groupKey, state) {
  const g = CONTROL_GROUPS.find((x) => x.key === groupKey);
  return g ? g.items.some((it) => isControlActive(it.t + ':' + it.k, state)) : false;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/dots/scopeControls.test.mjs`
Expected: PASS（全 test ケース pass、fail 0）

- [ ] **Step 5: コミット**

```bash
git add src/scenes/dots/scopeControls.js tests/dots/scopeControls.test.mjs
git commit -m "feat(scope): pure control-model (groups + relevance dim + auto arm)"
```
（＋ Global Constraints の trailer を付与）

---

## Task 2: Oscilloscope に制御モデルを配線

**Files:**
- Modify: `src/scenes/dots/Oscilloscope.js`
- Test: `tests/dots/scopeControlModel.test.mjs`

**Interfaces:**
- Consumes: `scopeControls.js`（Task 1）。
- Produces: Oscilloscope インスタンスに
  - フィールド `controlGroups`（=CONTROL_GROUPS）、`autoArm`（=DEFAULT_AUTO_ARM のコピー）
  - `_ctrlState() -> state`
  - `isControlActive(t, k) -> bool`、`isGroupActive(groupKey) -> bool`、`canArm(axis) -> bool`、`toggleArm(axis) -> void`
  - modeGroup `drive` の label が `'Band'`

- [ ] **Step 1: 失敗するテストを書く** — `tests/dots/scopeControlModel.test.mjs`

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { Oscilloscope } from '../../src/scenes/dots/Oscilloscope.js';

test('controlGroups covers every param and modeGroup exactly once', () => {
  const s = new Oscilloscope();
  const declared = new Set();
  for (const g of s.controlGroups) for (const it of g.items) {
    if (it.t === 'm') continue; // synthetic arm selector
    const id = it.t + ':' + it.k;
    assert.ok(!declared.has(id), `duplicate ${id}`);
    declared.add(id);
  }
  const expected = new Set();
  for (const k in s.params) expected.add('p:' + k);
  for (const g of s.modeGroups) expected.add('g:' + g.key);
  assert.deepStrictEqual([...declared].sort(), [...expected].sort());
});

test('Band relabel: drive modeGroup labelled Band, options intact', () => {
  const s = new Oscilloscope();
  const g = s.modeGroups.find((x) => x.key === 'drive');
  assert.strictEqual(g.label, 'Band');
  assert.deepStrictEqual(g.options, ['BASS', 'TREBLE', 'LEVEL']);
});

test('default autoArm is the curated subset', () => {
  const s = new Oscilloscope();
  assert.deepStrictEqual(s.autoArm, { phase: true, flip: false, band: false, spread: true, rot: true });
});

test('isGroupActive: Line → only draw+size', () => {
  const s = new Oscilloscope();
  s.setMode(0);
  assert.strictEqual(s.isGroupActive('draw'), true);
  assert.strictEqual(s.isGroupActive('size'), true);
  assert.strictEqual(s.isGroupActive('figure'), false);
  assert.strictEqual(s.isGroupActive('motion'), false);
  assert.strictEqual(s.isGroupActive('solid'), false);
});

test('isControlActive + canArm reflect mode (XY)', () => {
  const s = new Oscilloscope();
  s.setMode(2);
  assert.strictEqual(s.isControlActive('p', 'phase'), true);
  assert.strictEqual(s.isControlActive('g', 'sphere'), false);
  assert.strictEqual(s.canArm('phase'), true);
  assert.strictEqual(s.canArm('spread'), false);
});

test('toggleArm flips an axis', () => {
  const s = new Oscilloscope();
  assert.strictEqual(s.autoArm.flip, false);
  s.toggleArm('flip');
  assert.strictEqual(s.autoArm.flip, true);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/dots/scopeControlModel.test.mjs`
Expected: FAIL（`s.controlGroups` undefined / `s.isGroupActive is not a function` 等）

- [ ] **Step 3: 実装** — `src/scenes/dots/Oscilloscope.js` を編集

3-1. import を追加（既存の import 群の直後、`import { SimplexNoise } ...` の下）：

```js
import { CONTROL_GROUPS, DEFAULT_AUTO_ARM, isControlActive as ctrlActive, isGroupActive as groupActive, canArm as axisCanArm, autoDrives } from './scopeControls.js';
```

3-2. constructor 内の modeGroups の `drive` 行のラベルを変更：

```js
      { key: 'drive', label: 'Band', options: ['BASS', 'TREBLE', 'LEVEL'], index: 0 },
```

3-3. constructor 内、modeGroups 配列定義の**直後**に2行追加：

```js
    this.controlGroups = CONTROL_GROUPS;      // accordion structure consumed by ControlPanel
    this.autoArm = { ...DEFAULT_AUTO_ARM };    // which axes Auto animates (per-axis opt-in)
```

3-4. constructor の閉じ括弧の**直後**（`update(dt, audio, palette, clock) {` の直前）にメソッドを追加：

```js
  // Manual selections → the pure control-model state (no time term → no jitter).
  _ctrlState() {
    return {
      mode: this.modeIndex,
      form: this.mg('sphere'),
      spread: this.mg('spread'),
      auto: this.mg('auto') === 1,
      spinOn: this.mg('spin') === 1,
      arm: this.autoArm,
    };
  }
  isControlActive(t, k) { return ctrlActive(t + ':' + k, this._ctrlState()); }
  isGroupActive(key) { return groupActive(key, this._ctrlState()); }
  canArm(axis) { return axisCanArm(axis, this._ctrlState()); }
  toggleArm(axis) { if (axis in this.autoArm) this.autoArm[axis] = !this.autoArm[axis]; }
```

（注：`autoDrives` の import は Task 3 で使う。Task 2 単独では未使用のままで良い。）

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/dots/scopeControlModel.test.mjs`
Expected: PASS

- [ ] **Step 5: 回帰確認＋コミット**

Run: `node --test`
Expected: fail 0（既存 292 ＋ Task1/2 分が増えて全 pass）

```bash
git add src/scenes/dots/Oscilloscope.js tests/dots/scopeControlModel.test.mjs
git commit -m "feat(scope): expose control-model on Oscilloscope + Drive→Band label"
```
（＋ trailer）

---

## Task 3: Auto を軸ごとアームでゲート

**Files:**
- Modify: `src/scenes/dots/Oscilloscope.js`
- Test: `tests/dots/scopeAutoArm.test.mjs`

**Interfaces:**
- Consumes: `autoDrives`（Task 1 import 済）、`this.autoArm`/`this._ctrlState()`（Task 2）。
- Produces: `_effPhase`/`_effFlip`/`_effBandIndex`/`_effSpread` と update() の spinRate が `auto && arm.<axis>` でのみ自動化。既定 arm では flip/band は自動化されない。

- [ ] **Step 1: 失敗するテストを書く** — `tests/dots/scopeAutoArm.test.mjs`

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { Oscilloscope } from '../../src/scenes/dots/Oscilloscope.js';

const stubAudio = () => ({ waveform: new Uint8Array(64).fill(128), level: 0, bass: 0, mid: 0, treble: 0 });

test('_effPhase gates on auto AND arm.phase', () => {
  const s = new Oscilloscope();
  s.setMode(2); s.setModeGroup('auto', 1);
  s.t = 0; s.beats = 0;
  s.autoArm.phase = false;
  assert.strictEqual(s._effPhase(), s.p('phase')); // manual (8)
  s.autoArm.phase = true;
  assert.strictEqual(s._effPhase(), 32);           // auto sweep at t=0 → 4 + 0.5*56
});

test('_effFlip gates on auto AND arm.flip', () => {
  const s = new Oscilloscope();
  s.setMode(2); s.setModeGroup('auto', 1);
  s.beats = 16; // auto branch → floor(16/16)%2===1 → true
  s.autoArm.flip = false;
  assert.strictEqual(s._effFlip(), false); // manual OFF
  s.autoArm.flip = true;
  assert.strictEqual(s._effFlip(), true);  // auto
});

test('_effBandIndex gates on auto AND arm.band', () => {
  const s = new Oscilloscope();
  s.setMode(2); s.setModeGroup('auto', 1);
  s.beats = 32; // auto branch → floor(32/32)%3 === 1
  s.setModeGroup('drive', 0); // manual BASS = 0
  s.autoArm.band = false;
  assert.strictEqual(s._effBandIndex(), 0); // manual
  s.autoArm.band = true;
  assert.strictEqual(s._effBandIndex(), 1); // auto
});

test('_effSpread gates on auto AND arm.spread', () => {
  const s = new Oscilloscope();
  s.setMode(3); s.setModeGroup('sphere', 2); s.setModeGroup('spread', 3); s.setModeGroup('auto', 1);
  s.beats = 0; s.t = 0;
  s.autoArm.spread = false;
  assert.strictEqual(s._effSpread(), 3);      // manual QUAD
  s.autoArm.spread = true;
  assert.notStrictEqual(s._effSpread(), 3);   // auto walk (order[0]=1 at beats0)
});

test('rotation: auto+arm.rot spins even with Spin OFF; unarmed frozen', () => {
  const s = new Oscilloscope();
  s.setMode(2); s.setModeGroup('auto', 1); s.setModeGroup('spin', 0);
  s.params.rotate.value = 0;
  const clock = { time: 0, beats: 0 };
  s.autoArm.rot = false; s._spin = 0;
  s.update(0.1, stubAudio(), null, clock);
  assert.strictEqual(s._spin, 0);             // unarmed + Spin OFF → frozen
  s.autoArm.rot = true; s._spin = 0;
  s.update(0.1, stubAudio(), null, clock);
  assert.ok(s._spin > 0);                     // armed → auto wander advances
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/dots/scopeAutoArm.test.mjs`
Expected: FAIL（現状は master Auto ON で arm 無関係に全自動化 → `_effFlip`/`_effBandIndex` が arm OFF でも auto を返す、rotation が unarmed でも回る）

- [ ] **Step 3: 実装** — `src/scenes/dots/Oscilloscope.js` の各 `_eff*` と spinRate を編集

3-1. `_effPhase`：判定条件を差し替え

```js
  _effPhase() {
    if (autoDrives('phase', this._ctrlState())) {
      return 4 + (Math.sin(this.t * 0.08 * TWO_PI) * 0.5 + 0.5) * 56;
    }
    return this.p('phase');
  }
```

3-2. `_effFlip`：

```js
  _effFlip() {
    if (autoDrives('flip', this._ctrlState())) return Math.floor(this.beats / 16) % 2 === 1;
    return this.mg('flip') === 1;
  }
```

3-3. `_effBandIndex`：

```js
  _effBandIndex() {
    if (autoDrives('band', this._ctrlState())) return Math.floor(this.beats / 32) % 3;
    return this.mg('drive');
  }
```

3-4. `_effSpread`：先頭 `if` の条件のみ差し替え（order/k の中身は不変）

```js
  _effSpread() {
    if (autoDrives('spread', this._ctrlState())) {
      const order = [1, 2, 4, 0, 3, 5, 2, 4, 1, 5, 3, 0];
      const k = (((Math.floor(this.beats / 11 + 0.6 * Math.sin(this.beats * 0.17))) % order.length) + order.length) % order.length;
      return order[k];
    }
    return this.mg('spread');
  }
```

3-5. update() 内の spinRate 分岐の先頭条件のみ差し替え：

```js
    let spinRate;
    if (autoDrives('rot', this._ctrlState())) {
      spinRate = 0.05 + 0.035 * Math.sin(this.t * 0.045 * TWO_PI); // ~0.015..0.085 rev/s
    } else if (this.mg('spin') === 1) {
      let r = this.p('rotate'); // rev/s
      if (Math.abs(r) < 0.03) r = 0; // centre dead-zone
      spinRate = r;
    } else {
      spinRate = 0; // Spin OFF — frozen
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/dots/scopeAutoArm.test.mjs`
Expected: PASS

- [ ] **Step 5: 回帰確認＋コミット**

Run: `node --test`
Expected: fail 0

```bash
git add src/scenes/dots/Oscilloscope.js tests/dots/scopeAutoArm.test.mjs
git commit -m "feat(scope): Auto per-axis arm gating (master transport + armed axes)"
```
（＋ trailer）

---

## Task 4: ControlPanel アコーディオン描画＋CSS

**Files:**
- Modify: `src/ui/ControlPanel.js`
- Modify: `src/ui/ui.css`
- Verify: headless スクショ（`.superpowers/sdd/devshot/shot.mjs`）＋ `node --test` 回帰

**Interfaces:**
- Consumes: `scene.controlGroups`/`isGroupActive`/`isControlActive`/`canArm`/`autoArm`/`toggleArm`（Task 2）、既存 `scene.setModeGroup`/`params`/`modeGroups`、`createSlider`。
- Produces: `controlGroups` 宣言シーンでアコーディオン描画（他シーンは従来通り）。CSS クラス `.vj-acc-header(.dormant)` / `.vj-acc-body` / `.inactive`。

（このタスクは DOM 描画のためユニットテスト対象外。回帰は `node --test`、見た目は headless スクショで実見確認する。）

- [ ] **Step 1: `ControlPanel` に `_groupState` を追加** — constructor（`constructor(ctx) { this.ctx = ctx; ...`）の `this._build();` の**前**に：

```js
    this._groupState = {}; // (sceneId:groupKey) -> 'open' | 'collapsed'; 手動開閉を rebuild を跨いで保持
```

- [ ] **Step 2: `_rebuildSceneControls` の末尾（modeGroups ループ＋sliders ブロック）を分岐に差し替え**

`_rebuildSceneControls` 内の「`// Generic named mode-groups ...` の `if (scene.modeGroups && scene.setModeGroup) { ... }` ブロック」と、その後の「`const sliders = ...` から `c.appendChild(sliders);` まで」を、以下で置き換える：

```js
    // Accordion for scenes that declare controlGroups (Oscilloscope); every other
    // scene keeps the generic flat layout below (unchanged).
    if (scene.controlGroups && scene.isGroupActive) {
      this._renderAccordion(scene, c);
    } else {
      if (scene.modeGroups && scene.setModeGroup) {
        for (const g of scene.modeGroups) c.appendChild(this._modeGroupRow(scene, g));
      }
      const sliders = document.createElement('div');
      sliders.className = 'vj-sliders';
      for (const key in scene.params) {
        const entry = scene.params[key];
        sliders.appendChild(createSlider(entry.label, entry, (v) => { entry.value = v; if (entry.onChange) entry.onChange(v); }));
      }
      c.appendChild(sliders);
    }
  }
```

- [ ] **Step 3: ヘルパーメソッドを追加** — 上で閉じた `_rebuildSceneControls` の直後（`markAudioUnavailable()` の前）に：

```js
  _modeGroupRow(scene, g) {
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
    return grow;
  }

  _renderAccordion(scene, c) {
    for (const group of scene.controlGroups) {
      const active = scene.isGroupActive(group.key);
      const stKey = scene.id + ':' + group.key;
      const stored = this._groupState[stKey];
      const collapsed = stored === undefined ? !active : stored === 'collapsed';

      const header = document.createElement('button');
      header.className = 'vj-acc-header' + (active ? '' : ' dormant');
      header.textContent = (collapsed ? '▸ ' : '▾ ') + group.label;
      header.addEventListener('click', () => {
        this._groupState[stKey] = collapsed ? 'open' : 'collapsed';
        this._rebuildSceneControls();
      });
      c.appendChild(header);
      if (collapsed) continue;

      const body = document.createElement('div');
      body.className = 'vj-acc-body';
      for (const item of group.items) {
        const el = this._renderItem(scene, item);
        if (!el) continue;
        if (!scene.isControlActive(item.t, item.k)) el.classList.add('inactive');
        body.appendChild(el);
      }
      c.appendChild(body);
    }
  }

  _renderItem(scene, item) {
    if (item.t === 'p') {
      const entry = scene.params[item.k];
      if (!entry) return null;
      return createSlider(entry.label, entry, (v) => { entry.value = v; if (entry.onChange) entry.onChange(v); });
    }
    if (item.t === 'g') {
      const g = scene.modeGroups && scene.modeGroups.find((x) => x.key === item.k);
      return g ? this._modeGroupRow(scene, g) : null;
    }
    if (item.t === 'm' && item.k === 'autoArm') return this._autoArmRow(scene);
    return null;
  }

  _autoArmRow(scene) {
    const row = document.createElement('div');
    row.className = 'vj-row vj-modes';
    const lab = document.createElement('span');
    lab.className = 'vj-mg-label';
    lab.textContent = '動かす軸';
    row.appendChild(lab);
    const AXES = [['phase', 'Phase'], ['flip', 'Flip'], ['band', 'Band'], ['spread', 'Spread'], ['rot', '回転']];
    for (const [k, label] of AXES) {
      if (!scene.canArm(k)) continue;
      const b = document.createElement('button');
      b.className = 'vj-btn small' + (scene.autoArm[k] ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { scene.toggleArm(k); this._rebuildSceneControls(); });
      row.appendChild(b);
    }
    return row;
  }
```

- [ ] **Step 4: CSS を追加** — `src/ui/ui.css` の末尾に追記

```css
/* Oscilloscope accordion — collapsible control groups. Headers are always present
   (導線); a dormant group is dimmed; an inactive item is dimmed but still
   interactive (逃げ道). Mono, matches the existing .vj-* chrome. */
.vj-acc-header {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 42px;
  padding: 0 4px;
  border: none;
  border-bottom: 1px solid var(--vj-line);
  background: transparent;
  color: var(--vj-dim);
  font-size: 10px;
  letter-spacing: 0.24em;
  font-weight: 600;
  text-align: left;
}
.vj-acc-header.dormant { opacity: 0.4; }
.vj-acc-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 2px 4px;
}
.vj-acc-body .inactive { opacity: 0.35; }
```

- [ ] **Step 5: 回帰確認**

Run: `node --test`
Expected: fail 0（DOM 変更なので既存テストは不変で全 pass）

- [ ] **Step 6: headless で実見確認**（素の DOM パネルを撮る）

以下を各状態で実行し、PNG を確認する（`--eval` は start をクリック → scope を選択 → モード設定 → `scenes.onChange` を呼んでパネル再構築）。

```bash
node /Users/shiwa/Claude-Atelier/VJ/.superpowers/sdd/devshot/shot.mjs \
  --url=http://localhost:8125/index.html \
  --out=/Users/shiwa/Claude-Atelier/VJ/.superpowers/sdd/devshot/scope_xy.png \
  --wait=1200 \
  --eval="document.getElementById('start')?.click(); const s=window.__vj.scenes; s.start('scope'); const c=s.byId.scope; c.setMode(2); c.setModeGroup('auto',0); if(s.onChange) s.onChange('scope');"
```

同様に out/eval を替えて：
- `scope_line.png` … `c.setMode(0);`（描画/サイズのみ、他グループは減光畳み1行）
- `scope_xy_auto.png` … `c.setMode(2); c.setModeGroup('auto',1);`（Auto ON → Phase/回転が減光、Flip/Band は点灯、「動かす軸」行に `[Phase][Flip][Band][回転]`）
- `scope_lissa.png` … `c.setMode(3); c.setModeGroup('sphere',2);`（立体構造に Form/Spread/Core、「動かす軸」に Spread も登場）
- `scope_terrain.png` … `c.setMode(3); c.setModeGroup('sphere',3);`（React 減光・Drive のみ点灯・「動かす軸」は回転のみ）

**Expected（実見で確認する点）:**
1. 見出し5つ（描画/サイズ/図形/動き/立体構造）が常に同じ位置。dormant は薄い畳み1行。
2. active グループは開き、無関係な個別コントロールは薄く（触れる）表示。
3. 「動き」に `Auto[ON/OFF]` と「動かす軸」行が並び、モードに応じて軸ボタンが増減。
4. Auto ON で委譲軸（Phase/回転）が減光。
5. 「Band」ラベルになっている（旧 Drive ボタン群）。

- [ ] **Step 7: コミット**

```bash
git add src/ui/ControlPanel.js src/ui/ui.css
git commit -m "feat(scope): accordion control panel (grouped, relevance-dim, auto-arm row)"
```
（＋ trailer）

---

## Plan Self-Review

- **Spec coverage:** §3 構造→Task2(controlGroups)+Task4(描画)。§4 relevance→Task1(純関数)+Task2(配線). §5 アコーディオン/記憶→Task4(`_groupState`). §6 Auto arm→Task1(autoDrives/canArm)+Task2(autoArm/toggleArm)+Task3(_eff*/spin)+Task4(動かす軸行). §7 Band→Task2. §8 ファイル→全タスク. §10 受け入れ基準→Task4 Step6 実見＋各ユニット。ギャップ無し。
- **Placeholder scan:** 各コード step は完全なコードを掲載、TODO/曖昧記述無し。
- **Type consistency:** `state` 形（mode/form/spread/auto/spinOn/arm）、id 表記 `` `${t}:${k}` ``、メソッド名（isControlActive(t,k) / isGroupActive(key) / canArm(axis) / toggleArm(axis)）、import エイリアス（ctrlActive/groupActive/axisCanArm/autoDrives）を全タスクで一致させた。`autoArm` キー（phase/flip/band/spread/rot）も一貫。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-01-oscilloscope-control-reorg.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — タスクごとに fresh subagent を dispatch、タスク間でレビュー、最後に whole-branch レビュー。
**2. Inline Execution** — このセッションで executing-plans によりバッチ実行＋チェックポイント。

**Which approach?**
