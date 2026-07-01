# Oscilloscope 操作パネル整理 — 設計 (design spec)

**日付:** 2026-07-01
**対象:** `src/scenes/dots/Oscilloscope.js`, `src/ui/ControlPanel.js`, `src/ui/ui.css`（＋テスト）
**種別:** UI/UX 再編＋ Auto の挙動作り直し（機能は削除しない）

---

## 1. 背景・目的

Oscilloscope の操作パネルは、`scope` を選ぶと **約20行が一律フラットに羅列**される：

- Mode ボタン4：Line / Circle / XY / Sphere
- ボタン群6：Drive(帯) / Flip / Spin / Form / Spread / Auto
- スライダー10：Thickness / React / Gain / Range / Phase / Rotate / Drive(深さ) / Density / Core / Count

ユーザーの不満は3点：

1. **無関係でも全部出る** — 例：Line モードでも Form/Spread/Phase/Density/Core/Count が並ぶ（そのモードでは何もしない）。
2. **スライダー↔機能の対応が不明** — 例：「Drive」がボタン群（帯選択）とスライダー（呼吸の深さ）で二重定義。
3. **関連性が見えない** — Spin(ON/OFF) と Rotate(スライダー) は連動するのに別セクション。Mode→Form→Spread の入れ子構造も画面に出ない。

**目的:** 全機能を残したまま、(a) 意味でグループ化し、(b) いま効くか（relevance）を点灯/減光で示し、(c) アコーディオンで畳めるようにして「見やすく・対応が分かる・関連が見える」状態にする。あわせて **Auto を「ON で全部一括奪取」から「軸ごとに委ねる先を選べる」に作り直す**。

**非目標（別作業）:** モード/機能の削除・統合。他シーン（City/Dancers 等）への横展開。描画数式そのものの変更。

---

## 2. 設計方針（確定した決定）

ブレインストーミングで以下を順に確定：

1. **整理のみ** — 全機能キープ（削除しない）。
2. **アコーディオン方式** — 見出しで開閉するグループ構造。
3. **何も完全には隠さない／点灯・減光で relevance を表す** — グループ見出しは常時5つ表示（＝導線）。個別コントロールも消さず減光（触れはする＝逃げ道）。将来ある軸を別モードに配線したら「その場で点灯」できる余地を残す。
4. **Auto は「マスター再生/停止 ＋ 軸ごとアーム」** — 何を Auto に委ねるかを選べる。既定は控えめ。
5. **アームは「動き」グループに1行でまとめて配置**（Auto が触る範囲を一望できる）。
6. **Auto 作り直しを今回に畳み込む**。

---

## 3. 全体構造

```
Mode:  Line  Circle  XY  Sphere       ← 最上段・常時固定（マスター選択）

▾/▸ 描画        Thickness, React
▾/▸ サイズ      Gain, Range
▾/▸ 図形        Phase, Flip, Band, Drive
▾/▸ 動き        Auto ＋「動かす軸」, Spin, Rotate
▾/▸ 立体構造    Form, Spread, Density, Core, Count
```

**5グループのメンバー（固定）:**

| グループ | key | メンバー（型: p=スライダー, g=単一選択群, m=複数選択群） |
|---|---|---|
| 描画 | `draw` | `p:thickness`, `p:react` |
| サイズ | `size` | `p:gain`, `p:range` |
| 図形 | `figure` | `p:phase`, `g:flip`, `g:drive`(=Band), `p:drive`(=Drive深さ) |
| 動き | `motion` | `g:auto`, `m:autoArm`(=動かす軸), `g:spin`, `p:rotate` |
| 立体構造 | `solid` | `g:sphere`(=Form), `g:spread`, `p:density`, `p:core`, `p:count` |

- `g:drive` と `p:drive` は key が同じ 'drive' だが **namespace が別**（modeGroups vs params）。UI 宣言は型付きアイテム `{t,k}` で区別し、内部識別子は `"g:drive"` / `"p:drive"`。
- `m:autoArm` は新規の複数選択群（後述 §6）。

---

## 4. Relevance（点灯／減光）

### 4.1 判定関数

純関数 `isControlActive(t, k) -> bool` を Oscilloscope に実装。参照する状態（すべて**手動選択値**で、時間依存なし＝パネルがちらつかない）：

- `mode` = `this.modeIndex`（0 Line / 1 Circle / 2 XY / 3 Sphere）
- `form` = `this.mg('sphere')`（0 GLOBE / 1 WRAP / 2 LISSA / 3 TERRAIN）
- `spread` = `this.mg('spread')`（0 LISSA / 1 SPHERE / 2 TOROID / 3 QUAD / 4 RIBBON / 5 HELIX）
- `auto` = `this.mg('auto') === 1`
- `spinOn` = `this.mg('spin') === 1`
- `arm` = `this.autoArm`（§6 の per-axis 真偽）

派生：`sphere = mode===3`、`rotatable = mode===2 || mode===3`。

### 4.2 各コントロールの active 条件（実挙動から導出）

| 識別子 | active（点灯）の条件 | 減光の理由 |
|---|---|---|
| `p:thickness` | 常に true | — |
| `p:react` | `!(sphere && form===3)` | TERRAIN は線幅不使用（Thickness=粒径のみ） |
| `p:gain` | 常に true | — |
| `p:range` | 常に true | — |
| `p:phase` | `(mode===2 \|\| (sphere&&form===2)) && !(auto&&arm.phase)` | Line/Circle/GLOBE/WRAP/TERRAIN は lag 不使用／Auto 委譲中 |
| `g:flip` | `(mode===2 \|\| (sphere&&form===2)) && !(auto&&arm.flip)` | 同上／Auto 委譲中 |
| `g:drive`(Band) | `(mode===2 \|\| (sphere&&form<=2)) && !(auto&&arm.band)` | TERRAIN は生帯域直読み（Band 無効）／Auto 委譲中 |
| `p:drive`(深さ) | `mode===2 \|\| sphere` | Line/Circle は breathing 不使用（Auto は触らない） |
| `g:auto` | `rotatable` | Line/Circle は Auto 無効。マスターなので自己減光しない |
| `m:autoArm` | `rotatable`（中身は canArm でモード限定・§6） | — |
| `g:spin` | `rotatable && !(auto&&arm.rot)` | 回転を Auto に委譲中は減光 |
| `p:rotate` | `rotatable && !(auto&&arm.rot) && spinOn` | Auto 委譲中／Spin OFF で凍結中は減光 |
| `g:sphere`(Form) | `sphere` | Sphere 以外は立体構造なし |
| `g:spread` | `sphere && form===2 && !(auto&&arm.spread)` | LISSA 以外は spread 無効／Auto 委譲中 |
| `p:density` | `sphere && (form===0 \|\| form===1 \|\| form===3 \|\| (form===2 && spread===5))` | GLOBE=リング/WRAP=巻数/TERRAIN=セル/HELIX=巻数でのみ使用 |
| `p:core` | `sphere && (form===3 \|\| (form===2 && spread!==4))` | TERRAIN=bloom / LISSA(RIBBON除く)=核。RIBBON は core 無視 |
| `p:count` | `sphere && form===2 && spread===4` | RIBBON のみ（画面内コピー数） |

**グループ active:** `isGroupActive(groupKey)` = そのグループのメンバーのいずれかが `isControlActive` を満たす。

### 4.3 モード別サマリ（人間レビュー用）

| グループ | Line | Circle | XY | GLOBE/WRAP | LISSA | TERRAIN |
|---|---|---|---|---|---|---|
| 描画 | ✓ | ✓ | ✓ | ✓ | ✓ | Thickのみ(React減光) |
| サイズ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 図形 | 減光畳み | 減光畳み | ✓ | Band,Driveのみ | ✓ | Driveのみ |
| 動き | 減光畳み | 減光畳み | ✓ | ✓ | ✓ | ✓(回転のみ) |
| 立体構造 | 減光畳み | 減光畳み | 減光畳み | Form,Density | Form,Spread,Core(+Count=RIBBON,+Density=HELIX) | Form,Density,Core |

（"減光畳み" = グループに active コントロールが0 → 見出しだけ減光表示で畳む＝導線）

---

## 5. アコーディオン挙動

- **見出しは常時5つ全部**表示（位置不変）。関係0のグループも見出しを残す（導線）。
- **既定の開閉:** active グループ = 開く／dormant グループ = 減光＋畳み。
- **手動トグル:** 見出しタップで開閉。**一度手で操作したグループはセッション中その状態を記憶**（未操作のグループは relevance に自動追従。例：Sphere で立体構造が開き、Line で畳む）。
  - 実装：ControlPanel が `_groupState[sceneId + ':' + groupKey] = 'open' | 'collapsed' | undefined` を保持。`undefined` は relevance 追従（`collapsed = !isGroupActive`）、明示値はそれを優先。DOM 再構築（`_rebuildSceneControls`）を跨いで残る。
- **中身の減光:** グループのメンバーは固定。`isControlActive` が false のコントロールは減光クラスを付す。**pointer-events は殺さない**（減光でも触れる＝逃げ道）。

---

## 6. Auto 作り直し（軸ごとアーム）

### 6.1 モデル

**シーケンサーのトランスポート発想:**

- **マスター Auto**（既存 `g:auto` の ON/OFF）＝ 全体の再生/停止（ライブで即凍結できる）。
- **軸ごとアーム** `this.autoArm = { phase, flip, band, spread, rot }`（真偽）＝ 何を Auto に委ねるか。

Auto ON でも **アームした軸だけが自動で動く**。

**既定アーム（控えめ＝闇雲に全部を防ぐ）:**
`phase: true, spread: true, rot: true, flip: false, band: false`
（形の evolve と回転はゆっくり動く／飛ぶような Flip・反応帯の入替は既定オフ）

### 6.2 `_eff*` 改修（機能変更はここだけ）

現状は `if (this.mg('auto') === 1)` で無条件に自動値を返す。これを `auto && arm.<axis>` ゲートに変更：

- `_effPhase()`：`(auto && arm.phase)` のとき自動スイープ、他は `p('phase')`。
- `_effFlip()`：`(auto && arm.flip)` のとき自動フリップ、他は `mg('flip')===1`。
- `_effBandIndex()`：`(auto && arm.band)` のとき自動サイクル、他は `mg('drive')`。
- `_effSpread()`：`(auto && arm.spread)` のとき自動ウォーク、他は `mg('spread')`。
- `update()` の spinRate：
  ```
  if (auto && arm.rot)      spinRate = <slow wander>;   // 従来 Auto の回転
  else if (mg('spin')===1)  spinRate = <rotate slider + deadzone>;
  else                      spinRate = 0;
  ```

自動値の**数式は現状のまま**（値の作り方は不変、発火条件だけ arm でゲート）。決定論も不変（clock 時間/beats 由来）。

### 6.3 「動かす軸」セレクタ（`m:autoArm`）

- **配置:** 「動き」グループ内に1行、`g:auto` の直下。ラベル「動かす軸」。
- **中身:** 複数選択トグル。軸 = `Phase / Flip / Band / Spread / 回転`。armed な軸はボタン active 表示。タップで `autoArm.<axis>` を反転。
- **モード限定表示（`canArm(axis)`）:** その軸の自動値が現在のモードで効くものだけ出す。
  - `phase`: `mode===2 || (sphere&&form===2)`
  - `flip`:  `mode===2 || (sphere&&form===2)`
  - `band`:  `mode===2 || (sphere&&form<=2)`
  - `spread`:`sphere && form===2`
  - `rot`:   `mode===2 || sphere`
  - 例：XY=`[Phase][Flip][Band][回転]`／LISSA=全5／GLOBE=`[Band][回転]`／TERRAIN=`[回転]`／Line・Circle=なし（動きグループごと dormant）。
- **dim 連動:** §4.2 の通り、`(auto && arm.<axis>)` の軸コントロール（Phase/Flip/Band/Spread/Spin/Rotate）は減光＝「その軸は今 Auto に委ねている」と一目で分かる。

---

## 7. ラベル改称

- modeGroup `drive`（BASS/TREBLE/LEVEL）の **表示ラベル `'Drive'` → `'Band'`**。
- param `drive`（呼吸の深さ）は表示ラベル `'Drive'` のまま。
- **内部キーは据え置き**（`this.mg('drive')` / `this.p('drive')` 等のロジックは無改変）＝低リスク。これで "Drive" 二重定義が UI 上で解消。

---

## 8. アーキテクチャ / ファイル

### 8.1 `src/scenes/dots/Oscilloscope.js`
- `constructor`：`this.controlGroups`（§3 の宣言）、`this.autoArm`（§6.1 既定）を追加。modeGroup `drive` の label を `'Band'` に。
- 追加メソッド（純関数中心）：`isControlActive(t,k)`、`isGroupActive(groupKey)`、`canArm(axis)`、`toggleArm(axis)`。
- `_effPhase/_effFlip/_effBandIndex/_effSpread` と `update()` の spinRate を §6.2 に改修。

### 8.2 `src/ui/ControlPanel.js`
- `_rebuildSceneControls`：Mode 行・View 行の後で、**`scene.controlGroups` があればアコーディオン描画**、無ければ従来のフラット描画（他シーン無改変）。
- アコーディオン描画：
  - グループごとに header（開閉・dormant/collapsed クラス）＋ body。
  - body 内アイテムを型で分岐レンダー：`p`→`createSlider`、`g`→既存の単一選択ボタン行、`m`→複数選択トグル行（`canArm` でフィルタ、armed を active 表示、タップで `scene.toggleArm`）。
  - `isControlActive` false のアイテムに減光クラス（pointer-events は維持）。
- 既存の単一 modeGroup 描画・param 描画ロジックを小ヘルパー（`_renderParam(key)` / `_renderModeGroup(def)`）へ抽出し、アイテム単位で呼べるように。
- `_groupState`（§5）を constructor で初期化・保持。

### 8.3 `src/ui/ui.css`
- アコーディオン用スタイル（`.vj-acc-header` / `.vj-acc-body` / `.collapsed` / `.dormant`）と減光（`.inactive` = opacity 低め・操作は可）を既存 `.vj-section` / `.vj-btn` 系に調和させて追加。

### 8.4 テスト
- 既存テストスイートに純関数ユニットを追加：
  - `isControlActive`：Line/Circle/XY/GLOBE/WRAP/LISSA(各spread)/TERRAIN で active 集合が §4.3 と一致。
  - `_eff*`：`auto` × `arm.<axis>` の真理値表（arm ON→自動値／OFF→手動値）。spinRate の3分岐。
  - `canArm`：モード別の軸集合。
  - 構造テスト：`controlGroups` が全 param キーと全 modeGroup キーを**ちょうど1回ずつ**内包（孤児コントロール検出）。
- 視覚：headless（既存 devshot）でパネルを実見 — Line / XY(auto off) / XY(auto on＋arm) / Sphere-LISSA / TERRAIN で、開閉・減光・「動かす軸」行を確認。

---

## 9. Global Constraints（プロジェクト共通）

- **決定論:** `src` ランタイムで `Math.random`/`Date`/`performance.now` 不使用（本設計は追加ロジックも真偽/選択値のみ・時間依存の relevance 無し）。自動値の数式は既存の clock 由来を維持。
- **モノクロ:** canvas 描画は白/黒のみ（本設計は描画数式を変えない）。UI chrome は既存 `.vj` スタイル準拠。
- **依存ゼロ**（新規ライブラリ無し）。
- **本番デプロイはユーザー明示承認時のみ**・素URL検証・`CACHE_VERSION` bump。
- **視覚確認はスクショで実見してから完了報告。**

---

## 10. 受け入れ基準

1. 各モードで、**関係するコントロールが点灯・無関係は減光**、関係0グループは**減光畳み見出しのみ**で表示される。
2. 見出し5つは**常に同じ位置**にあり、タップで開閉、手動状態がセッション中保持される。
3. 「Drive」二重定義が解消（Band と Drive）。
4. Auto は **ON/OFF＋「動かす軸」**で、アームした軸だけが自動化される。既定は控えめ（Phase/Spread/回転）。
5. 委ねた軸のコントロールが減光し、「Auto がその軸を握っている」ことが分かる。
6. 他シーン（City/Dancers 等）のパネルは**無改変**で従来通り。
7. 追加ユニットテスト・構造テストが緑、headless 実見でパネルが設計通り。
