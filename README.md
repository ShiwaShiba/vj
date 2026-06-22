# VJ — Mic Visuals (iPad)

iPad の Safari で開く、マイク音に反応する簡易 VJ アプリです。幾何学的なドット/データパターンと、踊るピクトグラムの小人が、周囲の音・音楽・声・ビートに合わせて動きます。タッチでシーン切替・ループ・色変更・パラメータ調整ができます。

**アートディレクションはミニマルテクノ**（Ryoji Ikeda / Raster-Noton・Alva Noto / Carsten Nicolai / テストパターン / Swiss・Bauhaus）。モノクロ基調・高コントラスト・精密な幾何・データ HUD・グレイン/ビネット。

ビルドツール不要・依存ライブラリなしの **プレーンな ES Modules + Canvas 2D** で、オフラインでも動作します（PWA）。

## 特徴

- **音反応**: マイクの音量・低/中/高域・ビートを解析（Web Audio API）。声でも手拍子でも音楽でも反応します。
- **11シーン**: 踊る小人 / データマトリクス（バーコード・マトリクス・スキャン）/ スペクトラム / 波グリッド / フローフィールド / パーティクル / トンネル / 万華鏡 / リサージュ / モアレ / オシロスコープ。
- **踊るピクトグラム小人**: 手続き的スケルトンアニメの単色フラットシルエット。BPM に同期し、隊列の位相をずらして「ウェーブ」。Bounce / Twist / Jack / Wave / Robot / Disco の6ムーブ + Auto 切替。低音の強打でモノクロの角形シャッター。
- **データ HUD**: シーン番号 / BPM / タイムコード / 校正フレーム / レベルメータ（等幅・計器調）。グレイン・ビネット・走査線はトグル可。
- **6配色（モノクロ基調）**: MONO（白×黒）/ PAPER（黒×白）/ SIGNAL（赤の差し色）/ AMBER / CYAN / INK。小人は単色なので、PAPER を選べば「黒のみ」のピクトグラムになります。
- **ハイブリッド操作**: 音に自動反応しつつ、タッチでシーン切替・パターン切替・ループ・配色切替・各種スライダ。
- **iPad 対応**: タップ起動でマイク許可、Wake Lock で画面が消えない、ホーム画面に追加でフルスクリーンの PWA。

## 操作

- 起動画面を **タップ** するとマイクを許可して開始します（iPad の仕様上、最初のタップが必須）。
- 左上の **≡** でコントロールパネルの表示/非表示。無操作 4.5 秒で自動的に隠れます。
- **SCENES**: シーンを選択（クロスフェード切替）。
- **COLOR**: 配色を切替（なめらかに遷移）。
- **PATTERN / PARAMS**: 現在のシーンのモード（小人はダンスのムーブ）とパラメータ。
- **PERFORM**: `LOOP`（自動でシーン/配色を送る）/ `PATTERN`（モード送り）/ `TAP TEMPO` と `TAP`（ビート検出が不安定なときの手動テンポ）/ `FULL`（フルスクリーン）。
- **AUDIO**: マイク感度。

## ローカルで動かす（開発・デスクトップ）

`localhost` は HTTP でもマイクが使えます。

```sh
cd VJ
python3 -m http.server 8000
# ブラウザで http://localhost:8000
```

デスクトップでは音楽を再生し、ブラウザにマイク許可を与えると反応します（`d` キーでデバッグ表示）。

## iPad の実機で動かす

マイクには HTTPS（または localhost）が必要です。LAN の IP 直叩き（`http://192.168.x.x`）は非セキュアでマイクが使えません。次のいずれかを使ってください。

- **推奨: GitHub Pages に公開** して、その HTTPS URL を iPad の Safari で開く。
- 開発中の高速確認: `npx localtunnel --port 8000` などの HTTPS トンネル経由で iPad から開く。

iPad では Safari で開いた後、共有 → **「ホーム画面に追加」** すると、フルスクリーン（横向き固定）の PWA として起動できます。

## GitHub Pages へ公開

ビルド不要・全パス相対参照なので、リポジトリをそのまま公開できます。

```sh
git init && git add -A && git commit -m "VJ app"
# GitHub にリポジトリを作成して push
# リポジトリの Settings > Pages > Source: Branch = main, Folder = / (root)
```

公開 URL: `https://<ユーザー名>.github.io/<リポジトリ名>/`

## アイコンの再生成

```sh
python3 tools/gen_icons.py
```

## 構成

```
index.html / manifest.webmanifest / sw.js
src/
  main.js, config.js
  engine/  (Canvas, Engine, Clock)
  render/  (Overlay — グレイン/ビネット/校正フレーム/データHUD)
  audio/   (AudioEngine, BeatDetector, smoothing)
  scenes/  (Scene, SceneManager, registry, dots/*, dancers/*)
  color/   (palettes, PaletteManager)
  ui/      (ControlPanel, SceneGrid, Sliders, Toggles, ui.css)
  platform/(wakelock, fullscreen, pwa)
  lib/     (math, noise)
```
