// Per-DOF spring bank — the heart of the pose-to-pose system. Each DOF is a
// 1-D damped harmonic oscillator that chases a `target` set ONLY at beat-grid
// boundaries (by the Choreographer). Between boundaries the target is fixed, so
// the figure settles into a held silhouette instead of chasing a moving sine.
//
// ODE:  x'' = STIFF*(target-x) - 2*sqrt(STIFF)*ZETA*v
// ZETA is a true damping ratio: ZETA>=1 = no overshoot (support DOFs), ZETA<1 =
// overshoot (limbs snap and slightly overshoot). Semi-implicit (symplectic) Euler
// + substeps for stability on 60..120Hz refresh.
//
// FOLLOW-THROUGH / OVERLAPPING ACTION: each DOF has a `lag` (seconds). When a pose
// retargets, proximal joints (shoulder, hip, pelvis) move immediately while distal
// ones (elbow, then wrist; knee; head) adopt the new target a few ms later, so a
// limb UNFURLS from the body outward instead of moving rigidly as one piece. This
// is what reads as "every joint dancing" rather than a stiff armature.

// [STIFF (1/s^2), ZETA, LAG (s)] per logical joint group.
const SPRING_DEFS = {
  sink:        [150, 1.0, 0],
  swayX:       [130, 1.0, 0],
  pelYaw:      [130, 1.0, 0],
  lean:        [110, 0.95, 0.03],
  lateralBend: [110, 0.95, 0.03],
  // shYaw TRAILS pelYaw (lag) so an axial twist propagates HIP -> CHEST -> arms as a
  // kinetic chain, not a rigid plate: the pelvis initiates (pelYaw lag 0) and the
  // chest unwinds a beat-fraction later. Softer stiff than the old 180 lets the
  // trailing twist linger instead of snapping flat. (lag scales with the genre lagMul.)
  shYaw:       [150, 0.85, 0.12],
  raise:       [180, 0.85, 0.015],
  armR:        [300, 0.6, 0.03],
  armL:        [300, 0.6, 0.03],
  // Elbow/wrist/knee ZETA lowered (more overshoot = whip/follow-through) and lag
  // raised (distal joints trail proximal further). The on-beat SNAP punch is the
  // anticipation backswing in _apply (stiffness-scaled, ZETA-independent), so it
  // survives — we keep the hit, gain the supple settle. lag gradient
  // shoulder .03 -> elbow .085 -> wrist .12 is the overlapping-action chain.
  elR:         [230, 0.52, 0.085],
  elL:         [230, 0.52, 0.085],
  wrR:         [190, 0.58, 0.12],
  wrL:         [190, 0.58, 0.12],
  hipR:        [150, 0.85, 0.03],
  hipL:        [150, 0.85, 0.03],
  kneeR:       [190, 0.62, 0.075],
  kneeL:       [190, 0.62, 0.075],
  head:        [140, 0.85, 0.06],
  headYaw:     [140, 0.85, 0.06],
  stance:      [150, 0.9, 0.02],
};

// Backswing as a constant FRACTION of the move, independent of stiffness.
const ANTIC_FRAC = 0.3;
const ANTIC_EPS = 0.02;

// Limb / expressive DOFs that take the per-genre zeta & lag multipliers (rigid vs
// whippy, locked vs unfurling). The structural DOFs (sink, swayX, pelYaw, stance,
// hips, headYaw) are LEFT at their base damping so the weight-shift and the
// sink/plié never overshoot and wobble — only the limbs change feel by genre.
const STYLE_ZETA_DOFS = new Set([
  'armR', 'armL', 'elR', 'elL', 'wrR', 'wrL', 'raise', 'shYaw', 'lean', 'lateralBend', 'head', 'kneeR', 'kneeL',
]);
const clampZeta = (z) => (z < 0.42 ? 0.42 : z > 1.4 ? 1.4 : z);

export class SpringBank {
  constructor(initial = {}) {
    this.dofs = {};
    for (const name in SPRING_DEFS) {
      const [stiff, zeta, lag] = SPRING_DEFS[name];
      const x = initial[name] != null ? initial[name] : 0;
      this.dofs[name] = { x, v: 0, target: x, stiff0: stiff, stiff, zeta0: zeta, zeta, lag0: lag, lag, pend: x, pendT: 0, pendSnap: false };
    }
    this._out = {};
    this._snapFrac = ANTIC_FRAC;
    // Cached style inputs so we only recompute the per-DOF stiff/zeta/lag when the
    // tempo band or the selected genre actually changes (every frame otherwise).
    this._sBpm = 1; this._sStiff = 1; this._sZeta = 1; this._sLag = 1; this._sSnap = 1;
  }

  // Apply tempo (bpmScale) + the genre's MOTION DNA multipliers. stiffMul scales
  // every DOF (overall crispness); zetaMul/lagMul reshape only the limb DOFs
  // (rigid robot ↔ boneless whip); snapMul sizes the percussive anticipation hit.
  setStyle(bpmScale = 1, stiffMul = 1, zetaMul = 1, lagMul = 1, snapMul = 1) {
    if (bpmScale === this._sBpm && stiffMul === this._sStiff && zetaMul === this._sZeta && lagMul === this._sLag && snapMul === this._sSnap) return;
    this._sBpm = bpmScale; this._sStiff = stiffMul; this._sZeta = zetaMul; this._sLag = lagMul; this._sSnap = snapMul;
    for (const name in this.dofs) {
      const d = this.dofs[name];
      d.stiff = d.stiff0 * bpmScale * stiffMul;
      if (STYLE_ZETA_DOFS.has(name)) { d.zeta = clampZeta(d.zeta0 * zetaMul); d.lag = d.lag0 * lagMul; }
      else { d.zeta = d.zeta0; d.lag = d.lag0; }
    }
    this._snapFrac = ANTIC_FRAC * snapMul;
  }

  // Apply a target now: inject the anticipation kick (snap DOFs) then set target.
  _apply(d, t, snap) {
    if (snap) {
      const delta = t - d.x;
      if (Math.abs(delta) > ANTIC_EPS) d.v += -Math.sign(delta) * this._snapFrac * Math.sqrt(d.stiff) * Math.abs(delta);
    }
    d.target = t;
  }

  // Set new targets. DOFs with a lag queue the switch so they trail proximal ones.
  retarget(targets, snapSet) {
    for (const name in this.dofs) {
      if (targets[name] == null) continue;
      const d = this.dofs[name];
      const t = targets[name];
      const snap = !!(snapSet && snapSet.has(name));
      if (d.lag > 0) { d.pend = t; d.pendT = d.lag; d.pendSnap = snap; }
      else this._apply(d, t, snap);
    }
  }

  step(dt) {
    // Release any pending (lagged) targets whose delay has elapsed.
    for (const name in this.dofs) {
      const d = this.dofs[name];
      if (d.pendT > 0) {
        d.pendT -= dt;
        if (d.pendT <= 0) this._apply(d, d.pend, d.pendSnap);
      }
    }
    const cdt = dt < 1 / 30 ? dt : 1 / 30; // bound stall-frame impulses
    const substeps = Math.max(1, Math.ceil(cdt * 90));
    const h = cdt / substeps;
    for (const name in this.dofs) {
      const d = this.dofs[name];
      const k = d.stiff;
      const c = 2 * Math.sqrt(k) * d.zeta;
      let x = d.x, v = d.v;
      const target = d.target;
      for (let i = 0; i < substeps; i++) {
        const a = k * (target - x) - c * v;
        v += a * h;
        x += v * h;
      }
      d.x = x; d.v = v;
    }
  }

  read() {
    const o = this._out;
    for (const name in this.dofs) o[name] = this.dofs[name].x;
    return o;
  }
}
