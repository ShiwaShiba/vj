# tools/dancer-export

VJ 本体の **Dancers シーン**を、マイク不要でそのまま動く**単体 HTML** に書き出すためのビルドツール。
Claude（Design 等）上でダンサーの造形／振付を**再検討**するための持ち出しパッケージを再生成する。

これは**ツール**（＝ソース）で、書き出した HTML は生成物。生成物は git 管理しない（`.gitignore`）。
いつでも下記コマンドで作り直せる。

## 再生成（2 コマンド）

```sh
# このブランチの src/ から単体 HTML を組む → tools/dancer-export/dancers-standalone.html
node tools/dancer-export/build.mjs

# 組んだ HTML を headless Chrome で開いて描画/エラーを検証 → tools/dancer-export/shots/*.png
node tools/dancer-export/verify.mjs
```

`dancers-standalone.html` をブラウザで開く（ダブルクリック、または Claude にアップロード）だけで動く。
依存ゼロ・ネットワーク不要・オフライン可。全コードが 1 ファイルにインライン済み。

## どのブランチで実行するか（重要）

`build.mjs` は**このリポジトリの `src/` をそのまま束ねる**（スナップショットは持たない＝ DRY）。
つまり**チェックアウト中のブランチのダンサーコードが、そのまま書き出される**。

| ブランチ | 書き出される STYLE |
|---|---|
| `feat/dancer-graphic-airborne` | **GRAPHIC**（筆クロッキー＋空中跳躍＋二パーツ骨盤）＝再検討対象。**このツールの定位置** |
| `main` | PICTO/ベース（Kraftwerk 棒人間） |

GRAPHIC 版を作るなら `feat/dancer-graphic-airborne` を checkout した状態で `build.mjs` を実行する
（このツールがこのブランチに置いてあるのはそのため。checkout の往復が要らない）。

## 仕組みと忠実性

- **ダンサーのコードは本番と同一（verbatim）。** `build.mjs` が実アプリの各モジュール
  （`DancerRig` / `Choreographer` / `poses` / `groove` / `couplings` / `spring` / `moves` /
  `audioMap` / `DancersScene`）と依存（`lib/math` / `Scene` / `Clock` / パレット）を
  `src/` から読んで束ねる。改変は一切しない。
- **置き換えるのは外殻だけ（`harness.js`）。** 本体の `Engine` / `SceneManager` / `AudioEngine`
  / `Overlay` を、最小ハーネス（キャンバス＋描画ループ＋合成音）に差し替える。カメラ・
  パレット（MONO 白黒）・トレイル残像・描画順は本番と同型。
- **音は合成信号。** 実マイク FFT の代わりに、4 つ打ちキック＋8 分ハット＋8 小節スウェルの
  テクノ風シグナルで `level / bass / mid / treble / beat / beatHold / bpm` を生成し、ダンスを駆動する。
  → **ダンスの挙動・造形・振付ロジックは本番そのまま**。音の“入り口”だけが合成。

### ES モジュールの平坦化（IIFE レジストリ）

`build.mjs` は各モジュールを個別の IIFE で包み、戻り値を共有レジストリ `__mods` に登録する
（`__mods['dep']` を `const { A } = ...` で分配）。**モジュールごとにスコープが独立**するので、
モジュール私有の同名（例：`DancerRig` の `lerp`、`groove` の `frac`、ハーネスの `frac`）が衝突しない。
＝ ES モジュールグラフの忠実な平坦化。単純な strip-and-concat は同名衝突で壊れる。

## ファイル構成

```
tools/dancer-export/
  build.mjs        IIFE バンドラ（src/ → 単体 HTML）
  template.html    HTML 外殻（#c キャンバス＋操作パネル＋__err キャッチャ／__BUNDLE__・__HARNESS__ を差し込む）
  harness.js       Engine/SceneManager/AudioEngine/Overlay の最小代替＋合成テクノ音
  verify.mjs       file:// を headless Chrome で開き描画/__err を検証・PNG を shots/ に出力
  README.md        これ
  .gitignore       生成物（dancers-standalone.html, shots/）を除外
```

## 操作（生成 HTML 側）

| ボタン / キー | 役割 |
|---|---|
| PLAY / PAUSE（`space`） | 再生／一時停止 |
| MIC: ON / OFF（`i`） | ON=合成音でフルダンス／OFF=無音アイドル（本体の低振幅“生きたグルーヴ”に切替） |
| STYLE（`s`） | PICTO ↔ GRAPHIC |
| VIEW（`v`） | FRONT / 3-4 / SIDE / TOP |
| MODE（`m`） | ダンスの genre モード送り |
| ⚙（`h`） | パネル開閉（画面タップでも可） |

スライダー：DANCERS 1–100 / SIZE 0.2–1.0 / SPREAD 0–2.5 / TRAIL 0–0.55 / BPM 70–170 / ENERGY 0–1。

## 再検討の着目点

メモに残っていた未解決の造形課題：

> **平面トランクの深い前傾で edge-on に潰れる（立体的な厚みが不足）**

**VIEW = SIDE** にすると顕著（真横からトランクが板状に見える）。
STYLE = GRAPHIC・VIEW = SIDE・前傾の出る MODE で確認する。

## 前提

- Node 22+（`build.mjs`／`verify.mjs` はグローバル `WebSocket`・`fetch` を使用）。
- `verify.mjs` は macOS の `/Applications/Google Chrome.app` を headless 起動する（別 OS は `CHROME` 定数を調整）。
