# Building Contact-AO Bake深化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** generic 建物の bake AO に「短半径 contact 項」を二スケールで足し、足元・隣接の谷間に中庸の接地感／奥行きを出す（landmark/station/terrain は不変）。

**Architecture:** 既存の単一キャスト半球 AO（`bakeAO` in `ao.mjs`）で、最近ヒット距離 `hits[0].distance` をソフトフォールオフで重み付けし `occContact` を積算。`ao = ambientAO × contactAO`。contact は `contactMask`（generic 頂点のみ 1.0）でゲートし、`contactStrength=0` で現行と byte 一致。レイ追加なし＝バケ時間不変。

**Tech Stack:** Node.js + vendored three.js（headless raycast）、`node --test`、buildless ESM。

## Global Constraints

- モノクロ厳守（COLOR_0 は r=g=b 単一グレー）。色/グロー/再ライティング無し。
- 決定論: seed=1、`Math.random`/`Date` を出力に使わない。同入力→byte 一致。
- ジオメトリ・量子化・`dist/city.manifest.json` は不変。変わるのは **generic 建物の COLOR_0 のみ**。
- `ao.mjs` API 既定 `contactStrength=0` は現行ピクセル完全一致（安全弁）。出荷 default（`bake.mjs`）は中庸値＝非0。
- 任意 per-building グレー個体差は一切入れない（[[building-differentiation-ao-only]]）。
- landmark/station/terrain は byte 不変（`contactMask=0`）。
- `CONTACT_RADIUS` は world unit。コード内で `min(CONTACT_RADIUS, RADIUS)` にクランプ。
- commit はユーザーの明示許可後のみ（各 Task の commit step は許可済みとして進めてよい。最終 `dist` 再ベイク commit は Task 4 で別途確認）。

---

### Task 1: 共有シーン抽出 ＋ 凍結ゴールデンフィクスチャ（挙動不変リファクタ）

contact 実装の**前に**、現行 `bakeAO` の出力を凍結して回帰の基準にする（自己参照トートロジー回避）。
`buildScene` を共有モジュールへ出し、現行コードのままゴールデンを生成・コミットする。

**Files:**
- Create: `tools/citybake/tests/citybake/aoScene.mjs`
- Create: `tools/citybake/tests/citybake/fixtures/ao-golden.json`
- Modify: `tools/citybake/tests/citybake/ao.test.mjs`
- (read only, 未変更) `tools/citybake/bake/ao.mjs`

**Interfaces:**
- Produces: `buildScene()` → `{ soup:{positions,indices,normals}, OPEN:number, BASE:number }`（既存と同形）。
- Produces: `fixtures/ao-golden.json` = `Array.from(bakeAO(buildScene().soup, GOLDEN_OPTS))`、`GOLDEN_OPTS = { rays: 8, radius: 1.5, seed: 1 }`。

- [ ] **Step 1: `buildScene` を共有モジュールへ移す**

`tools/citybake/tests/citybake/aoScene.mjs` を作成し、`ao.test.mjs:8-29` の `buildScene` を**そのまま**移して `export`：

```js
// Shared test scene: flat ground + a small patch hugging a tall box's wall.
// BASE hugs the wall (occluded / near a contact occluder); OPEN is a far corner.
export function buildScene() {
  const positions = [], indices = [], normals = [];
  const pushV = (x, y, z, nx, ny, nz) => { positions.push(x, y, z); normals.push(nx, ny, nz); return positions.length / 3 - 1; };
  const A = pushV(-2, 0, -2, 0, 1, 0), B = pushV(2, 0, -2, 0, 1, 0), C = pushV(2, 0, 2, 0, 1, 0), D = pushV(-2, 0, 2, 0, 1, 0);
  indices.push(A, C, B, A, D, C);
  const E = pushV(0.15, 0, 0.0, 0, 1, 0), E2 = pushV(0.4, 0, 0.0, 0, 1, 0), E3 = pushV(0.15, 0, 0.25, 0, 1, 0);
  indices.push(E, E2, E3);
  const box = [
    [-0.1, 0, -0.1], [0.1, 0, -0.1], [0.1, 0, 0.1], [-0.1, 0, 0.1],
    [-0.1, 1, -0.1], [0.1, 1, -0.1], [0.1, 1, 0.1], [-0.1, 1, 0.1],
  ];
  const bi = box.map((p) => pushV(p[0], p[1], p[2], 0, 1, 0));
  const quad = (a, b, c, d) => indices.push(bi[a], bi[b], bi[c], bi[a], bi[c], bi[d]);
  quad(4, 5, 6, 7); quad(0, 1, 5, 4); quad(1, 2, 6, 5); quad(2, 3, 7, 6); quad(3, 0, 4, 7);
  return {
    soup: { positions: new Float32Array(positions), indices: new Uint32Array(indices), normals: new Float32Array(normals) },
    OPEN: A, BASE: E,
  };
}
```

- [ ] **Step 2: `ao.test.mjs` を共有シーン import に置換（挙動不変）**

`ao.test.mjs` の冒頭 import に追加し、ローカルの `buildScene` 定義（行 8-29）を削除：

```js
import assert from 'node:assert';
import { test } from 'node:test';
import { bakeAO } from '../../bake/ao.mjs';
import { buildScene } from './aoScene.mjs';
```

（`ao.test.mjs` 内の既存2テストはそのまま。`buildScene` の重複定義のみ除去。）

- [ ] **Step 3: ゴールデンを現行コードで生成・保存**

`tools/citybake/` で次を実行し、フィクスチャを書き出す（**ao.mjs は未変更の現行コード**）：

```bash
cd tools/citybake && mkdir -p tests/citybake/fixtures && node --input-type=module -e "
import { buildScene } from './tests/citybake/aoScene.mjs';
import { bakeAO } from './bake/ao.mjs';
import { writeFileSync } from 'node:fs';
const col = bakeAO(buildScene().soup, { rays: 8, radius: 1.5, seed: 1 });
writeFileSync('tests/citybake/fixtures/ao-golden.json', JSON.stringify(Array.from(col)));
console.log('golden verts:', col.length / 3);
"
```

Expected: `golden verts: 17`（ground4 + patch3 + box8 = 15… 実際の頂点数を出力でそのまま受け入れる。数値の正否は次 Step の一致で担保）。

- [ ] **Step 4: ゴールデン回帰テストを追加**

`ao.test.mjs` に追記（JSON 数値は ECMAScript の Number↔String 往復で厳密一致）：

```js
import golden from './fixtures/ao-golden.json' with { type: 'json' };

const GOLDEN_OPTS = { rays: 8, radius: 1.5, seed: 1 };

test('frozen golden: current bakeAO matches committed snapshot', () => {
  const col = bakeAO(buildScene().soup, GOLDEN_OPTS);
  assert.deepStrictEqual(Array.from(col), golden);
});
```

- [ ] **Step 5: テスト実行（全 green）**

Run: `cd tools/citybake && node --test tests/citybake/ao.test.mjs`
Expected: PASS（既存2 + golden 1 = 3 テスト green）。

- [ ] **Step 6: Commit**

```bash
git add tools/citybake/tests/citybake/aoScene.mjs tools/citybake/tests/citybake/fixtures/ao-golden.json tools/citybake/tests/citybake/ao.test.mjs
git commit -m "test(cityproto): freeze pre-change AO golden + share buildScene

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

### Task 2: `bakeAO` に二スケール contact 項（ソフトフォールオフ＋mask＋クランプ）

**Files:**
- Modify: `tools/citybake/bake/ao.mjs:43-92`（`bakeAO` 本体）
- Modify: `tools/citybake/tests/citybake/ao.test.mjs`（contact テスト追加）

**Interfaces:**
- Consumes: `buildScene()`, `golden`, `GOLDEN_OPTS`（Task 1）。
- Produces: `bakeAO(soup, opts)` の新 opts — `contactStrength?:number=0`, `contactRadius?:number=radius*0.3`,
  `contactMask?:Float32Array|null=null`。戻り値は従来どおり長さ `nv*3` の Float32 grey。

- [ ] **Step 1: 失敗するテストを書く（contact が BASE を暗化・OPEN は不変・単調・mask0=golden・clamp）**

`ao.test.mjs` に追記：

```js
test('contact term darkens wall-hugging base but not the open corner', () => {
  const { soup, OPEN, BASE } = buildScene();
  const off = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1, contactStrength: 0 });
  const on = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1, contactStrength: 0.6 });
  const g = (c, i) => c[i * 3];
  assert.ok(g(on, BASE) < g(off, BASE) - 0.02, `base should darken: ${g(off,BASE).toFixed(3)}→${g(on,BASE).toFixed(3)}`);
  assert.ok(Math.abs(g(on, OPEN) - g(off, OPEN)) < 1e-6, 'open corner (no near occluder) unchanged');
  for (let i = 0; i < on.length; i += 3) {
    assert.ok(on[i] === on[i + 1] && on[i + 1] === on[i + 2], 'grey');
    assert.ok(on[i] >= 0 && on[i] <= 1, '[0,1]');
  }
});

test('contact strength is monotonic (stronger → darker base)', () => {
  const { soup, BASE } = buildScene();
  const a = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1, contactStrength: 0.3 });
  const b = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1, contactStrength: 0.6 });
  assert.ok(b[BASE * 3] < a[BASE * 3], 'higher contactStrength darkens base further');
});

test('contactStrength=0 is byte-identical to frozen golden (safety valve)', () => {
  const col = bakeAO(buildScene().soup, { ...GOLDEN_OPTS, contactStrength: 0 });
  assert.deepStrictEqual(Array.from(col), golden);
});

test('all-zero contactMask is byte-identical to golden (type gate inert)', () => {
  const { soup } = buildScene();
  const mask = new Float32Array(soup.positions.length / 3); // all 0
  const col = bakeAO(soup, { ...GOLDEN_OPTS, contactStrength: 0.6, contactMask: mask });
  assert.deepStrictEqual(Array.from(col), golden);
});

test('contactRadius is clamped to radius (no throw, valid grey)', () => {
  const { soup } = buildScene();
  const col = bakeAO(soup, { rays: 16, radius: 1.5, seed: 1, contactStrength: 0.5, contactRadius: 10 });
  for (let i = 0; i < col.length; i += 3) assert.ok(col[i] >= 0 && col[i] <= 1, '[0,1]');
});

test('contact bake stays deterministic with contactStrength>0', () => {
  const { soup } = buildScene();
  const o = { rays: 16, radius: 1.0, seed: 7, contactStrength: 0.5 };
  assert.deepStrictEqual(Array.from(bakeAO(soup, o)), Array.from(bakeAO(soup, o)));
});
```

- [ ] **Step 2: テスト実行で失敗を確認**

Run: `cd tools/citybake && node --test tests/citybake/ao.test.mjs`
Expected: 新規 contact テストが FAIL（`contactStrength` 未対応＝BASE 暗化せず `g(on,BASE) < g(off,BASE)-0.02` で落ちる等）。既存3 green。

- [ ] **Step 3: `bakeAO` に contact 項を実装**

`tools/citybake/bake/ao.mjs` の `bakeAO` を編集。

(3a) opts 分解（`ao.mjs:44-45` 直後）に追加：

```js
export function bakeAO(soup, opts = {}) {
  const { rays = 24, radius = 1.0, seed = 1, ambient = 0.35, aoStrength = 1 } = opts;
  const baseGreyOpt = opts.baseGrey ?? 0.8;
  const contactStrength = opts.contactStrength ?? 0;
  const contactRadius = Math.min(opts.contactRadius ?? radius * 0.3, radius);
  const contactMask = opts.contactMask ?? null;
```

(3b) 内側ループ（現 `ao.mjs:73-90`）を置換：

```js
    for (const i of v) {
      n.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
      let occ = 0, occContact = 0;
      if (mesh) {
        origin.set(positions[i * 3] + n.x * eps, positions[i * 3 + 1] + n.y * eps, positions[i * 3 + 2] + n.z * eps);
        for (let s = 0; s < rays; s++) {
          const u1 = (s + 0.5) / rays;
          const u2 = (radicalInverse2(s + 1) + hash01(i, seed)) % 1;
          hemisphereDir(n, u1, u2, dir);
          rc.set(origin, dir);
          const hits = rc.intersectObject(mesh, false); // sorted ascending by distance
          if (hits.length) {
            occ++;
            // soft falloff: nearer occluders weigh more; beyond contactRadius → 0.
            const w = 1 - hits[0].distance / contactRadius;
            if (w > 0) occContact += w;
          }
        }
      }
      const cmask = contactMask ? contactMask[i] : 1;
      const ambientAO = 1 - aoStrength * (occ / rays);            // unchanged term
      const contactAO = 1 - contactStrength * cmask * (occContact / rays);
      const ao = ambientAO * contactAO;                          // contactStrength=0 → ao===ambientAO
      const light = ambient + (1 - ambient) * Math.max(0, n.x * Lx + n.y * Ly + n.z * Lz);
      const grey = Math.max(0, Math.min(1, greyOf(i) * light * ao));
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = grey;
    }
```

（注: `occ` の数え方は現行と同一＝`ambientAO` 不変。`x*1.0===x` の IEEE 恒等で `contactStrength=0` は byte 一致。）

- [ ] **Step 4: テスト実行で全 green を確認**

Run: `cd tools/citybake && node --test tests/citybake/ao.test.mjs`
Expected: PASS（既存3 + contact 6 = 9 テスト green。特に golden / mask0 が byte 一致）。

- [ ] **Step 5: 全テスト走らせて回帰なしを確認**

Run: `node --test`（リポジトリルート）
Expected: 全 green（既存スイートに影響なし）。

- [ ] **Step 6: Commit**

```bash
git add tools/citybake/bake/ao.mjs tools/citybake/tests/citybake/ao.test.mjs
git commit -m "feat(cityproto): two-scale contact AO in bakeAO (soft falloff + mask + clamp)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

### Task 3: `bake.mjs` 配線（env 読み＋クランプ＋generic-only contactMask＋発火率ログ）

**Files:**
- Modify: `tools/citybake/bake.mjs:20-24`（env 読み）、`:85-95`（mask 構築）、`:103`（bakeAO 呼び出し）

**Interfaces:**
- Consumes: `bakeAO`（Task 2 の新 opts）。
- Produces: コミット時の出荷挙動（`CONTACT_STRENGTH` 環境変数で contact 強度を制御、未指定時は Task 4 で確定する中庸 default）。

- [ ] **Step 1: env を読む**

`bake.mjs` の env 群（`AO_STRENGTH` を読む `:24` の近く）に追加。`CONTACT_DEFAULT` は Task 4 で確定するまで暫定 `0`：

```js
const CONTACT_STRENGTH = process.env.CONTACT_STRENGTH !== undefined ? +process.env.CONTACT_STRENGTH : 0; // TODO Task4: 中庸default
const CONTACT_RADIUS = process.env.CONTACT_RADIUS !== undefined ? +process.env.CONTACT_RADIUS : RADIUS * 0.3;
```

- [ ] **Step 2: generic-only contactMask を構築**

`bake.mjs:85` の配列確保に `contactMask` を追加：

```js
const positions = new Float32Array(NP), normals = new Float32Array(NP), indices = new Uint32Array(NI), baseGrey = new Float32Array(NP / 3), contactMask = new Float32Array(NP / 3);
```

`bake.mjs:92` の `baseGrey.fill(...)` 直後に追加（generic レンジのみ 1.0、他は 0 のまま）：

```js
  if (t.type === 'generic') contactMask.fill(1, vb, vb + vcount);
```

- [ ] **Step 3: bakeAO へ opts を渡す**

`bake.mjs:103` を置換：

```js
  const colors = bakeAO({ positions, indices, normals }, { rays: RAYS, radius: RADIUS, seed: 1, baseGrey, aoStrength: AO_STRENGTH, contactStrength: CONTACT_STRENGTH, contactRadius: CONTACT_RADIUS, contactMask });
  const fired = (() => { let n = 0, d = 0; for (let i = 0; i < contactMask.length; i++) if (contactMask[i]) { d++; } return { d }; })();
  console.log(`AO bake ${((Date.now() - t0) / 1000).toFixed(1)}s  (${NP / 3} verts, ${NI / 3} tris, ${RAYS} rays r=${RADIUS}, contact=${CONTACT_STRENGTH}@${CONTACT_RADIUS.toFixed(3)} on ${fired.d} generic verts)`);
```

（既存の `console.log(...)` 行 `:104` はこの新ログに置換する。発火“頂点率”の厳密計測は Task 4 のラスタライズ前ログで行う。）

- [ ] **Step 4: 低レイ・byte 不変スモーク（CONTACT_STRENGTH=0 で glb が現行と一致するか）**

`CONTACT_STRENGTH=0` の出荷 default 時、最終 RAYS=20 で glb が現行コミットと byte 一致するはず（Task 2 の golden が保証）。重い全バケはここでは回さず、配線が走ることだけ低レイで確認：

Run: `cd tools/citybake && CONTACT_STRENGTH=0 RAYS=2 node bake.mjs`
Expected: 例外なく完走し、ログに `contact=0@... on <N> generic verts`（N>0）。`dist` は RAYS=2 の暫定出力になるので**この glb はコミットしない**（最終は Task 4 の RAYS=20）。

- [ ] **Step 5: dist を作業前へ戻す（RAYS=2 の暫定 glb を捨てる）**

Run: `git checkout -- tools/citybake/dist/city.glb tools/citybake/dist/city.manifest.json`
Expected: `git status` で dist がクリーン（Task 4 で正式に再ベイクする）。

- [ ] **Step 6: Commit（配線のみ・dist 除く）**

```bash
git add tools/citybake/bake.mjs
git commit -m "feat(cityproto): wire CONTACT_STRENGTH/RADIUS + generic-only contactMask into bake

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

### Task 4: ビジュアル検証・中庸値チューニング・最終再ベイク（[[verify-visual-before-claiming]]）

TDD 対象外の検証＆チューニングフェーズ。CPU ラスタライザでモンタージュを作り、ユーザーと中庸値を確定してから最終バケ。

**Files:**
- Create（scratchpad・未コミット）: `render.mjs`（実 glb をラスタライズ）
- Modify（最終）: `tools/citybake/bake.mjs`（`CONTACT_STRENGTH` default を確定値へ）、`tools/citybake/dist/city.glb`（再ベイク）

- [ ] **Step 1: `render.mjs` の色パイプライン整合を確認**
  scratchpad の `render.mjs` が COLOR_0 を runtime（`MeshBasicMaterial vertexColors` + renderer の linear→sRGB 出力）と同じ
  エンコードで解釈することを確認・必要なら合わせる。差があるとモンタージュ値が実機へ転送されない。

- [ ] **Step 2: 候補強度でモンタージュ生成（ultracode 並列）**
  `CONTACT_STRENGTH ∈ {0, 0.25, 0.35, 0.5}` を `RAYS=4-5` 全バケ（各 ≈4-5分）→ 各 glb を scratchpad 退避 →
  `render.mjs` で ①広域 ②密集コア拡大 ③建物足元拡大 ④旧駅舎周辺 をレンダ → モンタージュ化。発火頂点率もログ。

- [ ] **Step 3: 承認済み look と並べて受入判定**
  `shots/roads5_full.jpg` と並べ: ①密集コアが潰れて near-black 化しない（濁らない）②足元の接触線がリング/段差なく滑らか
  ③旧駅舎・現役駅・terrain が不変 ④図解化しない。低レイは段差を過大表示する点を注記。ユーザーへ送付し**中庸値を確定**。

- [ ] **Step 4: 確定値の RAYS=20 確認タイル**
  確定強度で RAYS=20 のタイルを1枚焼き、低レイ判断が滑らかな最終と一致することを確認。

- [ ] **Step 5: default 反映＋最終全バケ**
  `bake.mjs` の `CONTACT_STRENGTH` default を確定値へ。`cd tools/citybake && node bake.mjs`（RAYS=20・≈25分）で最終 `dist/city.glb` を生成。
  `git status` で `dist/city.manifest.json` に差分が無いこと、`city.glb` のみ変わることを確認。

- [ ] **Step 6: 最終レンダで回帰確認 → ユーザー明示許可後に commit**
  最終 glb を `render.mjs` でレンダしユーザーへ提示。**明示許可後**に `bake.mjs`（default）＋ `dist/city.glb` を commit。

---

## Self-Review

- **Spec coverage:** 二スケール機構=Task2 / generic-only mask=Task2-3 / ソフトフォールオフ=Task2 / env+クランプ=Task2-3 /
  凍結ゴールデン回帰=Task1-2 / 不変条件テスト群=Task2 / render.mjs sRGB 整合・モンタージュ・RAYS20確認・最終バケ=Task4。spec 全要件に対応タスクあり。
- **Placeholder scan:** 各コード step に実コードあり。Task3 の `CONTACT_STRENGTH` default `0` は Task4 で確定する旨を明示（TODO の所在が一意）。
- **Type consistency:** `bakeAO` の新 opts 名（`contactStrength`/`contactRadius`/`contactMask`）は Task2 定義と Task3 呼び出しで一致。
  `buildScene`/`golden`/`GOLDEN_OPTS` は Task1 で定義し Task2 で参照（名前一致）。
