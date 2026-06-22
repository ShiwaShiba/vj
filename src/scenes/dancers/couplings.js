// Kinematic couplings — post-process applied to the final (spring + groove) DOFs.
// Keeps physically-linked joints from moving independently.
//
// NOTE on ownership decided in the plan:
//  - SCAPULA lift is owned by DancerRig.draw() (it already adds raise*0.10 +
//    max(0,arm)*0.10 into the shoulder point). We must NOT touch `raise` here or
//    the shoulders double-shrug.
//  - The base knee contrapposto (support straight / free deep) comes from the
//    POSES via the spring, so transitions are smooth. Here we only add the
//    per-beat BOUNCE dip, with the deeper dip on the free (unweighted) leg.
//  - `wSign` is derived upstream from the PRE-groove spring swayX with hysteresis,
//    so the groove's own oscillation can't flip the support/free roles mid-hold.

export function applyCouplings(L, wSign, bounce) {
  if (wSign < 0) {
    // Weight LEFT -> left leg supports (small dip), right leg free (deep dip).
    L.kneeL += bounce * 0.25;
    L.kneeR += bounce * 0.6;
  } else {
    L.kneeR += bounce * 0.25;
    L.kneeL += bounce * 0.6;
  }
}
