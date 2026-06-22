// Dance "modes". Auto lets the Choreographer freely rotate phrases; the others
// bias which phrase pool dominates (and Minimal scales the amplitude down). The
// `scale` field multiplies poseAmp. MODE_FAVORED maps a mode to a subset of
// phrase ids (see poses.js) — null = the full tempo-band pool.
export const MODES = [
  { name: 'Auto' },
  { name: 'Groove' },
  { name: 'Step' },
  { name: 'Swing' },
  { name: 'Nod' },
  { name: 'Minimal', scale: 0.6 },
];

export const MODE_FAVORED = {
  Auto: null,
  Groove: ['GROOVE', 'WAACK', 'TWIST'],
  Step: ['STEP', 'LOCK'],
  Swing: ['WAACK', 'FLOW', 'TURN'],   // arm-led
  Nod: ['TURN', 'TUT'],
  Minimal: ['IDLE', 'GROOVE'],
};
