// Dance "modes" = GENRES. Each genre owns an EXCLUSIVE phrase pool (its signature
// killer moves), so switching genre visibly changes the vocabulary instead of
// just reshuffling the same poses. Auto freely rotates the full tempo-band pool;
// Minimal scales the amplitude down (`scale` multiplies poseAmp). MODE_FAVORED
// maps a genre to its phrase ids (see poses.js PHRASES). Because the genre ids
// aren't in BAND_POOL, phrasesForBand's band-intersection is empty and it falls
// back to the genre list = exclusivity, for free.
export const MODES = [
  { name: 'Auto' },
  { name: 'Vogue' },
  { name: 'Popping' },
  { name: 'Waacking' },
  { name: 'House' },
  { name: 'Krump' },
  { name: 'Flex' },                   // 軟体 / contortion
  { name: 'Minimal', scale: 0.6 },
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
