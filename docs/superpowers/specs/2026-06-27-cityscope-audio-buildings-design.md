# CityScope — 音反応 建物変調レイヤ（オシロスコープ都市）設計

**日付:** 2026-06-27
**対象:** `src/cityproto/`（city WebGL プロトタイプ、LIVE フェーズ）
**ステータス:** 設計承認済み（ユーザー承認 2026-06-27）。実装は陣ごとに段階実施。

## Goal

静止画（固定カメラ＝LIVE フェーズ）の時、各建物が音／ビートに連動して個別に建つ・縮む・消える＝
地図全体がオシロスコープのように脈動する。VJ がライブ中に切り替えて飽きない、互いに運動の質が
ハッキリ違う「遊べるモード」を8つ、段階的に積み増す。

## 土台（不変の決定事項）

- **B（音波形/スペクトラム）が連続的な土台、A（ビート毎にハッシュ抽選した一部の建物が瞬間的に跳ねる/消える
  アクセント）を上乗せ。** A/B 比率はスライダーで連続調整。
- **空間モードは3択トグル**：
  1. 同心円リップル（駅＝北端の旧駅舎中心、`aReveal/maxRevealKey`＝正規化半径を流用）
  2. 並木に沿う（大学通り南北Z軸、新属性 `aScopeZ`）
  3. 両方（重畳）
  - 空間トグルを切るだけで同一モードが別物に化けるのが「遊び」の核。各モードは相性の良い空間モードを持つ。
- mono 単一チャンネルのみ（明度/高さ/可視性の変調だけ。色相変化・グロー・再ライティング無）。

## Architecture

### 1レイヤ＋モード差し替え

新レイヤ **`cityScope`（音→建物変調）を reveal.js の上に薄く乗せる**。reveal は `transformed.y` の
唯一の所有者であり続ける。

- 現状 reveal シェーダ：`transformed.y = mix(aBaseY, fullY, _rv)`（`_rv`＝イントロ距離スイープ progress）。
- 拡張後：`transformed.y = mix(aBaseY, fullY, _rv * scope)`。`scope∈[0,1]` が音駆動の reveal 係数。
  - **`scope = 1`（無効/イントロ中/無音）→ 現状ピクセル完全一致**（後退ゼロの保証）。
  - `scope` は building（or vertex）ごとに、選択モード＋空間モード＋音特徴＋ノブから決まる。
- 一部モードは高さでなく「可視性（discard）」のみを切り替える（二値マトリクス等）。reveal の既存
  `if (vReveal < 0.03) discard;` と同じ機構を `scope` 起源の値で駆動する。

### モジュール構成

- **`src/cityproto/cityScope.js`** — 純粋コア＋薄い THREE アダプタ。
  - 純粋部：モードごとの `scope` 算出ロジック（uniform 値・1Dテクスチャ内容・building-index テクスチャ内容を
    生成する純関数。RNG/Date 無、hash01 のみ）。node `--test` 可。
  - アダプタ部：毎フレ `update(features, clock, knobs)` を呼び、結果を reveal が公開する uniform/テクスチャへ書く。
- **`src/cityproto/reveal.js`（拡張）** — `installReveal` に scope 用 uniform/属性/シェーダ patch と、
  外部から書き込むためのハンドル（`uScope*`、`setScopeMode` 等）を追加。`transformed.y` 所有・イントロ
  `_rv` 経路・discard 機構は不変。並木Z用 `aScopeZ` 属性をロード時に1本追加（tone 計画と同じ手口、glb 不変）。
- **`src/cityproto/scopeModes.js`** — 8モードの registry。各モードは同一インターフェースを実装：
  ```js
  // mode = {
  //   id: string,            // 'scanbar' 等
  //   name: string,          // 表示名
  //   tier: 'uniform' | 'tex1d' | 'texbuilding',
  //   spatialFit: string,    // 相性メモ
  //   update(features, clock, knobs, io)  // io = uniform/テクスチャ書込口
  // }
  ```
  registry に1個 push するだけでモードが増え、既存モードに触れない。

### 空間座標

- **同心円**：既存 `aReveal`（=building の駅からの距離キー）を `maxRevealKey` で割った正規化半径 ∈[0,1]。新規不要。
- **並木Z**：頂点ローカル位置から大学通り中心線に沿う正規化座標 `aScopeZ ∈[0,1]`（南端0→駅側1 など）を
  ロード時に計算し属性追加。`buildRevealAttributes` と同じ純関数パターンで算出（決定論）。
- **両方**：シェーダ内で2座標を合成。

### 3階層 ＝ 3陣（実装順）

| Tier | 駆動 | モード | 陣 |
|------|------|--------|----|
| Tier1 | uniform のみ（純解析・最軽量） | ③スキャンバー ⑤呼吸 ⑦沈黙と開花 ②EQゾーン版 ⑧砂丘 | 第1陣 |
| Tier2 | 1Dテクスチャ lookup | ①レーダーping（音履歴リング） ②EQビン版 | 第2陣 |
| Tier3 | building-index テクスチャ＋CPU状態 | ④二値マトリクス ⑥落下バネ | 第3陣 |

第1陣で土台（cityScope レイヤ＋reveal 拡張＋HUD＋空間3択）を据え、純解析の3モードで映えを即確認する。
Tier2/Tier3 はテクスチャ配管を段階的に足すが、いずれも reveal の所有権・既存モードに触れない。

## 8モード定義（curated menu）

| # | モード | 一言 | 相性空間 | 酔い | Tier |
|---|--------|------|---------|------|------|
| 1 | レーダーping（進行波スイープ） | 駅から音の輪が残光を曳いて外周へ走り抜ける（距離=時間遅れ） | 同心円◎ | med | tex1d |
| 2 | スペクトラムEQ（定在アナライザ） | 半径/Z=周波数。各帯がその場で脈動する地形化EQ | 同心円/並木 | low | uniform(ゾーン)/tex1d(ビン) |
| 3 | スキャンバー（走査行進） | 硬い帯がビート毎に一歩ずつ街を貫くドラムマシン走査 | 並木◎ | low | uniform |
| 4 | 二値マトリクス | 中間高さ無し。0/1のデータ行列がビート毎に入替（池田 data.matrix） | 両方◎ | low | texbuilding |
| 5 | 都市の呼吸（タイダル・ブレス） | 街全体が一枚の肺のようにゆっくり満ち引き | 同心円 | low | uniform |
| 6 | グラビティ・ドロップ（落下と弾み） | 一部街区が崩落→バネで弾みながら建ち直る点描落下 | 並木 | low | texbuilding |
| 7 | 沈黙と開花（マクロ崩壊開花） | 静寂で都市が沈み、ドロップで全市ゼロ崩落→駅から開花リセット | 同心円 | med | uniform(setProgress) |
| 8 | デューン・ドリフト（砂丘うねり） | 建物の稜線が砂紋のようにうねり横へ流れる（最も静か） | 両方 | low | uniform |

### 各モードの駆動詳細

- **①レーダーping**：CPU に過去 N フレの連続レベル/RMS（低音BPFで土台を太く）リングバッファ（長さ256）を持ち
  1Dテクスチャへ push。shader は正規化半径（=aReveal/maxRevealKey）を座標に `level[now − radius*delay]` を
  サンプル＝距離=時間遅れ。波速/残光/波の太さをノブ化。残光は `max(new, prev*decay≈0.9)` で離散沈降。
- **②スペクトラムEQ**：空間軸（同心円=半径帯／並木=Z位置）を低→中→高の周波数ビンに割当、高さ=担当帯域振幅。
  ゾーン版＝`uZoneLevel[3..5]` uniform 配列（Tier1）。ビン版＝極小1Dテクスチャ（Tier2、レーダーと同一 lookup
  配管のデータ違い）。fast-attack/slow-release 包絡＋peak-hold。
- **③スキャンバー**：線位置＝`beats`（整数カウンタ）を段量子化（1ビート=1ステップ、≤2.5Hz）。既存片側
  smoothstep を `|aReveal − linePos| < uBand で建つ` のバンドパスに変えるだけ。帯幅→B レベルで可変。並木最適。
- **④二値マトリクス**：中間高さ無し、満高(1)か床(0)の二値。更新は `beat`(bool) のみ＝毎ビート1回（≤2.5Hz）。
  (a)ランダム点呼 `hash01(idx⊕beats) < fill率`、(b)群インターリーブ＝4群を1拍ずつ点灯。CPU が毎ビート
  per-building 0/1 を building-index テクスチャへ書き、shader が building index で引く。building index 属性が新規。
- **⑤都市の呼吸**：全建物上端 ~30% が一様に沈み→戻る、超ゆっくり（~0.2–0.3Hz、1呼吸=2小節）。連続RMSを
  強ローパスした1値が深さ。`uReveal` を「小節同期の緩い正弦×レベル」に差し替え、各キー位相を aReveal で僅かにずらす。
  純解析、CPU 不要。discard 閾値を割らない振幅でポップ無し。無音時フルハイト静止＝現状look。
- **⑥グラビティ・ドロップ**：拍ごと hash 抽選の数十〜数百棟が床へ崩落→約1小節で臨界減衰バネ＋僅かオーバーシュート
  で建ち直る。各棟2次バネを CPU 積分し building-index テクスチャへ毎フレ書く。同時落下数＝レベル×A/B比率。
- **⑦沈黙と開花**：曲の総エネルギー（遅い RMS 包絡）で既存 `setProgress`（global uReveal floor）を駆動。
  ドロップ検出で one-shot：全市 instant collapse（uReveal→0）→1小節で駅中心放射リビール（0→1、イントロの
  段階ズームリビール配管を音駆動に再利用）。崩落スナップは1ドロップ毎＝数十秒に1回へ制限し酔い回避。
- **⑧デューン・ドリフト**：空間座標に沿った超低周波正弦うねり（1–2波）で長い尾根/谷。`beatPhase` で毎小節
  ゆっくり横ドリフト。低帯域=振幅、中帯域=波長。純解析、CPU 不要、最軽量・最静か。

### 全モード共通の A レイヤ

各モードの B 土台の上に、ビート毎 `hash01(idx⊕beats)` 抽選の少数棟が +δ で跳ねる／discard 閾値を一拍上げて
欠落する、をスライダー比率で重畳。却下した「トランジェント粒弾き」はこの A 層に吸収済み。

### 却下モード（記録）

- リサジュー（XYビーム）＝2D軌跡描画は単一スカラ scope で表現不可・最重実装。将来の野心枠として保留。
- トランジェント・スナイパー（粒弾き）＝A 層と本質同義。A 比率スライダへ吸収。
- トリガ掃引（波形レリーフ）＝スキャンバーと定在EQの中間で見た目が両者に近接。2モードでカバー。
- レーダー4候補（残光/波及/粘性/パルス波）→「レーダーping」1本に統合、差分はノブ化。
- EQ4候補（ピークホールド/鍵盤/通りEQ/成層）→「スペクトラムEQ」1本に統合、空間モード差・ノブ差。
- 間と一撃（Kraftwerk的静と衝撃）→「沈黙と開花」のマクロ崩壊に統合。

## 守る線（不変条件・各陣で機械的にチェック）

1. **glb・manifest byte不変**：`git status --short -- tools/citybake/dist/` が空（純ランタイム、再ベイク無）。
2. **OFF で現状一致**：`scope=1`（無音/無効）で現状look完全復帰。承認済み見た目を壊さない。
3. **イントロ不可侵**：scope は LIVE かつ並木リビール完了後のみ作動（shotDir と同じゲート）。`_rv` 経路・
   段階ズーム/四季/粒子は不変。
4. **mono厳守・グロー無・≤3Hz・決定論**（hash01 のみ、RNG/Date 禁止）。
5. **「図解」リグレッション禁止**：音駆動の一時変調で無音時に消える層。任意の静的 per-building グレー個体差
   （旧図解ボツ要素）ではない。[[building-differentiation-ao-only]]
6. **他レイヤ無編集**：terrain/station/roads/trees/particles/seasons/shotDir カメラ/2D配信地図に触れない。
7. **false-green 禁止**：各モード「できた」報告前に、実 glb＋実シェーダ math の CPU ラスタライズで広域＋ctx の
   PNG を撮り視覚確認してから報告。[[verify-visual-before-claiming]] 過去の faa7d6a（量子化生座標で city
   ロードが壊れた false-green）を繰り返さない。

## 各陣の進め方ルーチン（精度重視・節目で commit＋Compact）

陣ごとに：**spec確認 → plan → TDD実装（pure core にテスト）→ CPU視覚検証PNG を送付 → ユーザー承認 →
commit → Compact → 次陣へ**。陣の中は最小モードずつ。各陣末で守る線1–7を全チェック。

- **第1陣**：cityScope レイヤ＋reveal 拡張（scope 係数・aScopeZ・HUD・空間3択）＋Tier1 モード
  ③スキャンバー・⑤呼吸・⑦沈黙と開花（＋余力で②EQゾーン・⑧砂丘）。
- **第2陣**：Tier2 テクスチャ lookup ＝①レーダーping・②EQビン版。
- **第3陣**：Tier3 building-index テクスチャ＋CPU状態 ＝④二値マトリクス・⑥落下バネ。

## Testing

- 純粋コア（scope 算出・空間座標・hash01・各モード uniform/テクスチャ生成）を node `--test` で検証：
  決定論（2回 byte 一致）・`scope=1`（OFF）が現状一致を返す・各モードの境界（無音→現状復帰、
  ≤3Hz、座標範囲）・空間モード切替で値が変わる。
- CPU ラスタライザ（scratchpad）：実 glb 解析＋実シェーダ math を再現し、各モード×空間モードの広域＋ctx
  PNG を `:8125/shots/` で送付。muddy 化しない／mono 厳守／landmark・terrain・道路・木々・particles 不変を確認。
- 既存全テスト（159 green）は不変で維持。

## 重要ファイル

- 新規：`src/cityproto/cityScope.js`・`src/cityproto/scopeModes.js`・各 `tests/cityproto/*.test.mjs`
- 改修：`src/cityproto/reveal.js`（scope 係数・aScopeZ・uniform/テクスチャ口・discard 駆動）／
  `src/cityproto/proto.js`（cityScope 初期化・LIVE ゲート・`window.__proto.setScope*`）／
  `src/cityproto/liveDriver.js`（scope の毎フレ駆動を LIVE で呼ぶ）／`city-proto.html`（モード/空間/比率 HUD）
- 検証のみ（scratchpad・原則未コミット）：CPU ラスタに各モード再現を注入
- 参照（無編集）：`bake/manifest.mjs`（perBuilding 形）・`bake/glb.mjs`（NORMAL 無の根拠）

## Spec self-review

- Placeholder：無し（各モードの駆動・テスト・ファイルを具体化）。
- 内部整合：`scope=1`→現状一致 と「他レイヤ無編集」がガードレールと一致。reveal の `.y` 所有は全節で不変と明記。
- スコープ：1サブシステム（建物音変調）を3陣に分割。各陣が独立にテスト・commit 可能。
- 曖昧さ：空間座標の定義（aReveal 流用／aScopeZ 新規）、Tier↔陣の対応、A 層の式を明示。
