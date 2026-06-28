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
    // 0=モノ(burst) / 1=季節色(固定) / 2=季節オート(春→夏→秋→冬 循環)
    if (idx === 0) { adapter.setColorMode('burst'); adapter.modeConfig.autoSeason = false; } // モノ＝音反応の既定(rest=mono)
    else {
      adapter.setColorMode('manual');
      adapter.modeConfig.manualChromaMix = 1;
      adapter.modeConfig.autoSeason = idx === 2;
    }
    return true;
  }
  if (key === 'citySeason') {
    adapter.setColorMode('manual');
    adapter.modeConfig.manualSeason = ((idx % 4) + 4) % 4;
    adapter.modeConfig.manualChromaMix = 1;            // 季節を選んだら色ON
    adapter.modeConfig.autoSeason = false;             // 手動で季節を選んだらオート解除
    return true;
  }
  if (key === 'cityVariant') { core.setChromaVariant(CITY_VARIANTS[idx] || 'current'); return true; }
  if (key === 'cityStrobe') { core.setStrobe(idx === 1); core.setStrobeAll(idx === 1); return true; } // 常時ストロボ(全季節)
  return false;
}
