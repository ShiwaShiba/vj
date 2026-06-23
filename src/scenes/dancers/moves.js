// Dance "modes" = GENRES. Each genre owns an EXCLUSIVE phrase pool (its signature
// killer moves), so switching genre visibly changes the vocabulary instead of
// just reshuffling the same poses. Auto freely rotates the full tempo-band pool.
// MODE_FAVORED maps a genre to its phrase ids (see poses.js PHRASES). Because the
// genre ids aren't in BAND_POOL, phrasesForBand's band-intersection is empty and
// it falls back to the genre list = exclusivity, for free.
export const MODES = [
  { name: 'Auto' },
  { name: 'Vogue' },
  { name: 'Popping' },
  { name: 'Waacking' },
  { name: 'House' },
  { name: 'Krump' },
  { name: 'Flex' },                   // 軟体 / contortion
  { name: 'Minimal' },
];

export const MODE_FAVORED = {
  Auto: null,                                   // full tempo-band rotation
  Vogue: ['VOGUE_HANDS', 'VOGUE_DIP'],          // hand frames + back-bend dip illusion
  Popping: ['WAVE', 'ROBOT_FREEZE', 'ISO_BOX'], // waves, freezes, isolations
  Waacking: ['WAACK_WHIP', 'WAACK_SPIN'],       // arm whips + in-place spins
  House: ['HOUSE_FOOT', 'JACK'],                // footwork + torso jack
  Krump: ['KRUMP_HIT', 'CHEST_POP_PH'],         // hard hits + chest pops
  Flex: ['COIL_PH', 'CONTORT'],                 // coils + contortion freezes
  Minimal: ['IDLE', 'GROOVE'],
};

// MODE_STYLE = each genre's MOTION DNA. Picking different phrases wasn't enough:
// every genre still moved at the same tempo, the same spring feel, the same
// groove energy and the same stance, so the bodies blurred together. These are
// MULTIPLIERS on the existing dynamics (base = Auto = 1) wired into the spring
// bank, the choreographer's step pace, the groove amplitude and the stance floor.
//   scale        — poseAmp (pose excursion from REST).
//   stepBeatsMul — beats held per pose: <1 snappier / faster, >1 sustained.
//   stiffMul     — spring stiffness (all DOFs): higher = crisper settle.
//   zetaMul      — limb damping: >1 rigid (no overshoot), <1 whip/overshoot.
//   lagMul       — follow-through lag on limbs: >1 joints unfurl in sequence.
//   grooveMul    — gross groove (weight sway + bounce dip) amplitude.
//   stanceBias   — additive plié / second-position thigh splay floor.
//   snapMul      — anticipation backswing on snap steps: the percussive "hit".
// Intended reads: Popping = stiff robot (no overshoot, locked, sharp hits, small);
// Flex = boneless slow-mo (lowest zeta + longest lag = joints peel apart, long
// holds); Krump = heavy power (stiff, max snap, big bounce, wide stomp); House =
// bouncy fast footwork (open stance, big weight shift); Vogue = poised held frames;
// Waacking = fast whipping arms; Minimal = sparse and calm.
export const MODE_STYLE = {
  Auto:     { scale: 1.00, stepBeatsMul: 1.00, stiffMul: 1.00, zetaMul: 1.00, lagMul: 1.00, grooveMul: 1.00, stanceBias: 0.00, snapMul: 1.00 },
  Vogue:    { scale: 1.05, stepBeatsMul: 1.15, stiffMul: 1.00, zetaMul: 0.90, lagMul: 1.20, grooveMul: 0.85, stanceBias: 0.05, snapMul: 1.00 },
  Popping:  { scale: 1.00, stepBeatsMul: 0.85, stiffMul: 1.30, zetaMul: 1.35, lagMul: 0.45, grooveMul: 0.50, stanceBias: 0.00, snapMul: 1.40 },
  Waacking: { scale: 1.10, stepBeatsMul: 0.80, stiffMul: 1.15, zetaMul: 0.65, lagMul: 1.45, grooveMul: 1.05, stanceBias: 0.10, snapMul: 1.25 },
  House:    { scale: 1.00, stepBeatsMul: 0.70, stiffMul: 1.05, zetaMul: 0.90, lagMul: 1.10, grooveMul: 1.30, stanceBias: 0.18, snapMul: 0.95 },
  Krump:    { scale: 1.15, stepBeatsMul: 0.80, stiffMul: 1.40, zetaMul: 0.85, lagMul: 0.70, grooveMul: 1.35, stanceBias: 0.28, snapMul: 1.55 },
  Flex:     { scale: 1.05, stepBeatsMul: 1.45, stiffMul: 0.82, zetaMul: 0.50, lagMul: 1.60, grooveMul: 0.70, stanceBias: 0.20, snapMul: 0.80 },
  Minimal:  { scale: 0.60, stepBeatsMul: 1.60, stiffMul: 0.85, zetaMul: 1.05, lagMul: 0.80, grooveMul: 0.40, stanceBias: 0.00, snapMul: 0.60 },
};
