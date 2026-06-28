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
  const weight = Math.sin(bar2 * TWO_PI);            // 1 cycle / 2 beats (pelvis LEADS)
  const breath = Math.sin(beatsF * Math.PI * 0.25) * 0.015;
  // Kinetic-chain twist WAVE: each segment up the body trails the one below by a
  // PHASE (no state needed — just retard the sine), so the continuous groove twist
  // PROPAGATES hip -> chest -> gaze instead of the torso snapping as one rigid plate.
  // The phase offset is the point: at the cycle peak the pelvis is fully wound while
  // the chest is still catching up = a visible spiral, the tension flowing up the body.
  const TW_SH = 0.22, TW_HEAD = 0.36;                // chest trails hips ~0.44 beat; gaze trails further
  const weightSh = Math.sin((bar2 - TW_SH) * TWO_PI);
  const weightHead = Math.sin((bar2 - TW_HEAD) * TWO_PI);
  o.swayX = weightAmp * weight;
  o.pelYaw = 0.26 * weight;                          // pelvis LEADS the twist (the hip-led chain)
  o.shYaw = -0.34 * weightSh;                        // chest counter-rotates, phase-lagged = travelling twist
  o.sink = -bounceImpulse * 0.10 + breath; // global vertical translate (0.12->0.10: gentler whole-figure bob)
  o.head = beatHold * 0.1 + Math.sin(frac(beatsF) * TWO_PI) * 0.04;
  o.weight = weight;

  // --- micro articulation (distal joints breathe through holds) ---
  const ph = frac(beatsF);
  const w = Math.sin(ph * TWO_PI);
  const w2 = Math.sin(ph * TWO_PI + Math.PI);        // opposite phase
  const wE = Math.sin(frac(beatsF - 0.125) * TWO_PI); // forearm, lagged 1/8 beat
  const s2 = Math.sin(beatsF * Math.PI * 0.5);        // slow drift
  // Wrists: a per-beat flick (w) + a slower half-rate wave so the hands keep
  // articulating without buzzing. L/R counter-phased; peak ~0.16 rad stays well
  // under the pose wrist range so it styles a hold, never buries it.
  const wWave = Math.sin(frac(beatsF / 2) * TWO_PI + Math.PI * 0.5);
  o.wrR = 0.10 * w  + 0.06 * wWave;
  o.wrL = 0.10 * w2 - 0.06 * wWave;
  o.elR = 0.06 * wE; o.elL = -0.06 * wE;              // forearm breathing (folds keep articulating)
  o.headYaw = 0.05 * s2 - 0.14 * weightHead;          // gaze is the chain's last link: trails the chest twist
  o.kneeFreeBob = 0.10 * Math.abs(Math.sin(frac(beatsF / 2) * TWO_PI)); // free-leg only (sign-gated in rig)

  // --- spine undulation (low-amp, beat-synced): the torso sways/breathes against
  // the hip weight-shift so the upper body is never a rigid plank through a hold.
  o.lateralBend = 0.05 * Math.sin(frac(beatsF / 2) * TWO_PI + Math.PI * 0.66);
  o.lean = 0.035 * Math.sin(frac(beatsF) * TWO_PI) + 0.02;
  return o;
}
