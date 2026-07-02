import { DancersScene } from './dancers/DancersScene.js';
import { SineGrid } from './dots/SineGrid.js';
import { FlowField } from './dots/FlowField.js';
import { ParticleField } from './dots/ParticleField.js';
import { PurposeMaker } from './dots/PurposeMaker.js';
import { Tunnel } from './dots/Tunnel.js';
import { FallingCubes } from './dots/FallingCubes.js';
import { CityScene } from './city/CityScene.js';
import { OrbScene } from './orb/OrbScene.js';
import { YeastScene } from './yeast/YeastScene.js';
import { Kaleidoscope } from './dots/Kaleidoscope.js';
import { Lissajous } from './dots/Lissajous.js';
import { Moire } from './dots/Moire.js';
import { SpectrumBars } from './dots/SpectrumBars.js';
import { Oscilloscope } from './dots/Oscilloscope.js';
import { Datamatrix } from './dots/Datamatrix.js';

// シーンボタンの並び順＝この配列順（最新順＝最終更新日が新しい順）。起動時の既定シーンは
// 配列の先頭ではなく main.js の scenes.start('scope') で明示指定している。
// 上段＝通常グループ / 下段＝改善予定グループ（IMPROVEMENT_SCENE_IDS）。操作パネルの
// SceneGrid が改善予定の先頭に「改善予定」セパレータを挿入して二群に分ける。
export function createScenes() {
  return [
    // --- 通常（最終更新日が新しい順）---
    new DancersScene(),
    new YeastScene(),
    new Oscilloscope(),
    new OrbScene(),
    new PurposeMaker(),
    new FlowField(),
    new FallingCubes(),
    new CityScene(),
    // --- 改善予定（指定順）---
    new Datamatrix(),
    new SpectrumBars(),
    new SineGrid(),
    new ParticleField(),
    new Tunnel(),
    new Kaleidoscope(),
    new Lissajous(),
    new Moire(),
  ];
}

// 改善予定グループ（操作パネルで下段に分離表示するシーン群）。SceneGrid が最初の該当
// シーンの直前に「改善予定」セパレータを一度だけ挿入する。表示順は createScenes() 側で管理。
export const IMPROVEMENT_SCENE_IDS = new Set([
  'data', 'spectrum', 'sineGrid', 'particles', 'tunnel', 'kaleido', 'lissajous', 'moire',
]);
