// operator↔output の状態シリアライズ層（純粋・DOM/THREE/BroadcastChannel 非依存）。
// frame=毎フレームの音、control=操作（シーン/モード/パラメータ/パレット/オーバーレイ）。

export function buildFrame(a) {
  return {
    level: a.level, bass: a.bass, mid: a.mid, treble: a.treble,
    beat: a.beat, beatHold: a.beatHold, bpm: a.bpm,
    spectrum: a.spectrum, waveform: a.waveform,
  };
}

export function applyFrame(f, remoteAudio) {
  const s = remoteAudio.state;
  s.level = f.level; s.bass = f.bass; s.mid = f.mid; s.treble = f.treble;
  s.beat = f.beat; s.beatHold = f.beatHold; s.bpm = f.bpm;
  s.spectrum = f.spectrum; s.waveform = f.waveform;
  s.ready = true;
}

export function buildControlSnapshot({ scenes, palette, overlay }) {
  const scene = scenes.currentScene();
  const snap = {
    sceneId: scene ? scene.id : null,
    modeIndex: scene ? (scene.modeIndex || 0) : 0,
    viewIndex: scene && typeof scene.viewIndex === 'number' ? scene.viewIndex : null,
    modeGroups: {},
    params: {},
    palette: {
      index: palette.index,
      brightness: palette.brightness,
      contrast: palette.contrast,
      accentStrength: palette.accentStrength,
      invert: palette.invert,
    },
    overlay: {
      hud: overlay.hud, grain: overlay.grain,
      scanlines: overlay.scanlines, vignette: overlay.vignette,
    },
  };
  if (scene && scene.modeGroups) for (const g of scene.modeGroups) snap.modeGroups[g.key] = g.index;
  if (scene && scene.params) for (const k in scene.params) snap.params[k] = scene.params[k].value;
  return snap;
}

export function applyControlSnapshot(snap, { scenes, palette, overlay }) {
  if (!snap) return;
  // シーン切替: 目標 id が active でも next でもなければ goto。
  if (snap.sceneId && scenes.activeId() !== snap.sceneId &&
      (!scenes.next || scenes.next.id !== snap.sceneId)) {
    scenes.goto(snap.sceneId);
  }
  // 目標シーンのインスタンスへ直接適用（crossfade 中は next 側でも確実に設定するため byId 優先）。
  const scene = (snap.sceneId && scenes.byId[snap.sceneId]) || scenes.currentScene();
  if (scene) {
    if (typeof snap.modeIndex === 'number' && scene.modes) scene.setMode(snap.modeIndex);
    if (typeof snap.viewIndex === 'number' && scene.setView) scene.setView(snap.viewIndex);
    if (scene.modeGroups && snap.modeGroups) {
      for (const key in snap.modeGroups) scene.setModeGroup(key, snap.modeGroups[key]);
    }
    if (scene.params && snap.params) {
      for (const k in snap.params) {
        const e = scene.params[k];
        if (!e) continue;
        e.value = snap.params[k];
        if (e.onChange) e.onChange(e.value); // city: setShot/setScope 駆動
      }
    }
  }
  if (snap.palette) {
    palette.set(snap.palette.index);
    palette.setBrightness(snap.palette.brightness);
    palette.setContrast(snap.palette.contrast);
    palette.setAccentStrength(snap.palette.accentStrength);
    palette.setInvert(snap.palette.invert);
  }
  if (snap.overlay) {
    overlay.hud = snap.overlay.hud;
    overlay.grain = snap.overlay.grain;
    overlay.scanlines = snap.overlay.scanlines;
    overlay.vignette = snap.overlay.vignette;
  }
}

// snap は固定キー順で組むので文字列化比較で十分（差分検出用）。
export function controlsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
