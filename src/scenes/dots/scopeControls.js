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
    case 'p:react':     return !(sphere && (form === 3 || (form === 2 && spread === 4))); // dead in TERRAIN (no stroke) + RIBBON (_drawRibbon overwrites lineWidth)
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

// Per-Spread *initial* GAIN for the LISSA family (mode Sphere, form LISSA). Each
// Lissajous variant fills the frame at a different natural amplitude, so its good
// starting gain differs. These are only the first-visit defaults: the scene then
// remembers wherever you last left GAIN for each Spread (sticky per-Spread), so
// returning to a Spread restores your position rather than resetting it.
// Index order = Spread modeGroup: LISSA SPHERE TOROID QUAD RIBBON HELIX.
// GAIN slider is 0.3..3.0 (visual centre 1.65), stepping by 0.1.
export const SPREAD_GAIN = [1.6, 1.3, 1.0, 2.0, 2.0, 0.5];

// True when Spread is meaningful — Sphere mode, form LISSA. GAIN is remembered
// per Spread only within this family; elsewhere GAIN is a single shared value.
export function isLissaFamily(state) {
  return state.mode === 3 && state.form === 2;
}
