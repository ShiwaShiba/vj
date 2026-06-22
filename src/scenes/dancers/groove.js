import { TWO_PI } from '../../lib/math.js';

// Layer B — the continuous "life" layer added on top of the spring output every
// frame, so the body breathes even during a static pose hold. Runs on a
// CONTINUOUS beat counter (clock.beats + clock.beatPhase); integer clock.beats
// would turn these sines into a per-beat staircase.
//
// Two parts:
//  - GROSS groove: bounce, the 2-beat weight-shift sine, breath, pelvis/shoulder
//    counter-rotation (WEIGHT_AMP kept small so it animates rather than buries the
//    choreographed silhouette).
//  - MICRO articulation: tiny continuous wrist/elbow/head/knee motion so the
//    distal joints keep styling through a hold (amplitudes far below the pose
//    deviations they ride on; beat-synced, never noise — so it reads as alive,
//    not buzz). This is the layer that keeps "every joint dancing".

const frac = (x) => x - Math.floor(x);

export function groove(beatsF, bounceImpulse, beatHold, weightAmp, out) {
  const o = out || {};
  const bar2 = frac(beatsF / 2);
  const weight = Math.sin(bar2 * TWO_PI);            // 1 cycle / 2 beats
  const breath = Math.sin(beatsF * Math.PI * 0.25) * 0.015;
  o.swayX = weightAmp * weight;
  o.pelYaw = 0.18 * weight;
  o.shYaw = -0.22 * weight;
  o.sink = -bounceImpulse * 0.12 + breath;
  o.head = beatHold * 0.1 + Math.sin(frac(beatsF) * TWO_PI) * 0.04;
  o.weight = weight;

  // --- micro articulation (distal joints breathe through holds) ---
  const ph = frac(beatsF);
  const w = Math.sin(ph * TWO_PI);
  const w2 = Math.sin(ph * TWO_PI + Math.PI);        // opposite phase
  const wE = Math.sin(frac(beatsF - 0.125) * TWO_PI); // forearm, lagged 1/8 beat
  const s2 = Math.sin(beatsF * Math.PI * 0.5);        // slow drift
  o.wrR = 0.05 * w;  o.wrL = 0.05 * w2;               // hands flick against each other
  o.elR = 0.04 * wE; o.elL = -0.04 * wE;              // a hair of forearm breathing
  o.headYaw = 0.05 * s2;                              // gaze isn't frozen
  o.kneeFreeBob = 0.06 * Math.abs(Math.sin(frac(beatsF / 2) * TWO_PI)); // free-leg only (sign-gated in rig)
  return o;
}
