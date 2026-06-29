// Pose library + phrases (Layer A data). A POSE is a partial full-DOF snapshot;
// missing fields fall back to REST. The Choreographer snaps the SpringBank to
// these on the beat grid. Drawn from real dance vocabulary (locking, popping,
// robot/tutting, waacking, vogue, ballet, house, contrapposto) so EVERY joint —
// elbows, wrists, knees, hips, head — articulates distinctly; the user's core
// note was that distal joints barely moved and arms were monotonous.
//
// Sign conventions (from the draw-contract analysis of DancerRig.draw()):
//   swayX <0 = weight screen-LEFT;  lean >0 = fold FORWARD (depth axis)
//   lateralBend >0 = side-bend screen-left
//   pelYaw/shYaw OPPOSITE = contrapposto twist; SAME large sign = whole-body TURN
//   raise = symmetric arm/shoulder elevation; armR/L = per-arm depth (toward camera)
//   elR/L elbow flex (0.5 rest, 0.15 straight, ~0.9 folded); wrR/L wrist cock
//   hipR/L thigh depth swing; knee larger = more bend (free leg deep, support straight)
//   sink >0 = down; head <0 = chin down

export const REST = {
  sink: 0, swayX: 0, pelYaw: 0, lean: 0, lateralBend: 0, shYaw: 0, raise: 0.28,
  armR: 0, armL: 0, elR: 0.5, elL: 0.5, wrR: 0, wrL: 0,
  hipR: 0, hipL: 0, kneeR: 0.2, kneeL: 0.2, head: 0, headYaw: 0,
  stance: 0, // outward thigh splay (plié / second position); 0 = original narrow stance
  lift: 0,   // airborne height (jump/leap); 0 = grounded
};

// DOFs that get an anticipation backswing on a snap step (the "hit" limbs).
export const SNAP_DOFS = new Set(['armR', 'armL', 'elR', 'elL', 'wrR', 'wrL', 'raise', 'shYaw', 'lean', 'lateralBend', 'head']);

// Mirror a pose left<->right.
export function mirror(pose) {
  const swap = { armR: 'armL', armL: 'armR', elR: 'elL', elL: 'elR', wrR: 'wrL', wrL: 'wrR', hipR: 'hipL', hipL: 'hipR', kneeR: 'kneeL', kneeL: 'kneeR' };
  const neg = { swayX: 1, pelYaw: 1, shYaw: 1, lateralBend: 1, headYaw: 1 };
  const m = {};
  for (const k in pose) {
    if (swap[k]) m[swap[k]] = pose[k];
    else if (neg[k]) m[k] = -pose[k];
    else m[k] = pose[k];
  }
  return m;
}

// Resolve a (partial) pose to a full DOF snapshot, scaling deviation from REST by amp.
export function scalePoseFromRest(pose, amp, out) {
  const o = out || {};
  for (const k in REST) {
    const base = REST[k];
    const tgt = pose[k] != null ? pose[k] : base;
    o[k] = base + (tgt - base) * amp;
  }
  return o;
}

export const POSES = {
  IDLE_CENTER: { raise: 0.26, armR: 0.04, armL: -0.04, elR: 0.42, elL: 0.5, wrR: 0.12, wrL: -0.1, hipR: 0.04, hipL: -0.04, kneeR: 0.18, kneeL: 0.2, head: 0.02, headYaw: 0.06 },

  WEIGHT_R: { swayX: 0.5, pelYaw: -0.3, shYaw: 0.4, lateralBend: -0.26, raise: 0.34, armR: -0.12, armL: 0.18, elR: 0.4, elL: 0.62, wrR: -0.24, wrL: 0.3, hipL: -0.06, hipR: 0.22, kneeR: 0.14, kneeL: 0.52, head: -0.03, headYaw: -0.14 },

  REACH_R_HIGH: { swayX: -0.35, pelYaw: 0.3, shYaw: -0.45, lateralBend: 0.16, raise: 0.7, armR: 1.1, armL: 0.14, elR: 0.16, elL: 0.6, wrR: 0.42, wrL: -0.28, hipR: 0.18, hipL: -0.06, kneeR: 0.5, kneeL: 0.16, lean: -0.06, head: 0.08, headYaw: -0.16 },

  PUSH_DOWN: { armR: -0.32, armL: -0.32, elR: 0.78, elL: 0.66, wrR: -0.4, wrL: 0.36, raise: 0.18, sink: 0.34, kneeR: 0.42, kneeL: 0.46, hipR: 0.08, hipL: 0.04, lean: 0.12, head: -0.08, headYaw: 0.1 },

  TWIST_OPEN_R: { shYaw: -0.6, pelYaw: 0.35, swayX: 0.28, raise: 0.36, armL: 0.42, armR: -0.3, elL: 0.34, elR: 0.6, wrL: 0.4, wrR: -0.34, hipL: 0.16, hipR: -0.05, kneeL: 0.46, kneeR: 0.16, head: 0.04, headYaw: -0.26 },

  STEP_R: { swayX: 0.34, pelYaw: 0.16, shYaw: -0.12, raise: 0.32, armR: 0.34, armL: -0.34, elR: 0.34, elL: 0.6, wrR: 0.34, wrL: -0.3, hipL: 0.4, hipR: -0.12, kneeL: 0.72, kneeR: 0.16, lean: 0.05, head: 0.04, headYaw: -0.1 },

  CONTRACT: { lean: 0.5, raise: 0.14, armR: -0.22, armL: -0.22, elR: 0.92, elL: 0.9, wrR: 0.34, wrL: -0.34, kneeR: 0.5, kneeL: 0.52, hipR: 0.06, hipL: 0.06, head: -0.22, sink: 0.2, shYaw: 0, pelYaw: 0 },

  RELEASE_UP: { lean: -0.2, armR: 0.92, armL: 0.92, elR: 0.2, elL: 0.24, wrR: 0.3, wrL: -0.3, raise: 0.76, kneeR: 0.22, kneeL: 0.24, hipR: 0.04, hipL: 0.04, sink: -0.18, head: 0.18, headYaw: 0.06 },

  TURN_R: { pelYaw: 0.6, shYaw: 0.58, swayX: 0.14, headYaw: 0.32, lateralBend: -0.08, raise: 0.38, armR: 0.22, armL: 0.5, elR: 0.4, elL: 0.66, wrR: 0.28, wrL: -0.24, hipL: 0.12, hipR: -0.04, kneeR: 0.16, kneeL: 0.34, head: 0.04 },

  TUT_BOX_R: { swayX: -0.42, pelYaw: 0.26, shYaw: -0.3, lateralBend: 0.18, raise: 0.34, armR: 0.2, armL: 0.24, elR: 0.9, elL: 0.88, wrR: 0.42, wrL: -0.38, hipR: 0.2, hipL: -0.05, kneeR: 0.5, kneeL: 0.14, head: -0.04, headYaw: 0.14 },

  ROBOT_PUNCH_R: { swayX: -0.3, pelYaw: 0.2, shYaw: -0.22, lateralBend: 0.1, raise: 0.6, armR: 0.95, armL: -0.1, elR: 0.16, elL: 0.92, wrR: -0.3, wrL: 0.34, hipR: 0.18, hipL: -0.04, kneeR: 0.46, kneeL: 0.14, head: 0.05, headYaw: -0.18 },

  LOCK_POINT_R: { swayX: 0.24, pelYaw: -0.18, shYaw: 0.26, lateralBend: -0.12, raise: 0.5, armR: 0.85, armL: 0.1, elR: 0.15, elL: 0.95, wrR: 0.4, wrL: -0.42, hipL: 0.22, hipR: -0.06, kneeL: 0.48, kneeR: 0.14, head: 0.08, headYaw: 0.22 },

  FREEZE_LOW_R: { sink: 0.4, swayX: -0.36, pelYaw: 0.3, shYaw: -0.36, lateralBend: 0.22, raise: 0.24, armR: 0.3, armL: -0.18, elR: 0.9, elL: 0.78, wrR: -0.44, wrL: 0.3, hipR: 0.34, hipL: 0.04, kneeR: 0.74, kneeL: 0.16, lean: 0.16, head: -0.16, headYaw: 0.2 },

  SCARECROW_T: { swayX: 0.18, pelYaw: -0.14, shYaw: 0.16, lateralBend: 0, raise: 0.7, armR: 0.12, armL: 0.12, elR: 0.82, elL: 0.82, wrR: -0.36, wrL: -0.36, hipL: 0.18, hipR: -0.05, kneeL: 0.4, kneeR: 0.16, head: 0.12, headYaw: 0 },

  WAACK_FRAME_R: { swayX: -0.42, pelYaw: 0.3, shYaw: -0.34, lateralBend: 0.22, raise: 0.5, armR: 0.85, elR: 0.86, wrR: 0.42, armL: -0.28, elL: 0.2, wrL: -0.34, kneeL: 0.14, kneeR: 0.5, hipR: 0.2, hipL: -0.05, head: 0.05, headYaw: -0.14 },

  PORT_DE_BRAS_R: { swayX: -0.5, pelYaw: 0.28, shYaw: -0.36, lateralBend: 0.3, raise: 0.68, armR: 0.62, elR: 0.3, wrR: 0.36, armL: 0.18, elL: 0.78, wrL: -0.3, kneeL: 0.14, kneeR: 0.56, hipR: 0.26, hipL: -0.06, lean: -0.08, head: 0.1, headYaw: 0.16 },

  HOUSE_LOFT_R: { swayX: 0.32, pelYaw: 0.2, shYaw: -0.18, lateralBend: -0.14, raise: 0.4, armR: -0.26, elR: 0.7, wrR: 0.3, armL: 0.5, elL: 0.36, wrL: -0.28, kneeR: 0.15, kneeL: 0.74, hipL: 0.42, hipR: -0.14, lean: 0.1, head: 0.06, headYaw: 0.18 },

  ATTITUDE_BACK_R: { swayX: -0.46, pelYaw: 0.32, shYaw: -0.3, lateralBend: 0.24, raise: 0.56, armR: 0.4, elR: 0.6, wrR: 0.34, armL: 0.66, elL: 0.26, wrL: -0.3, kneeL: 0.14, kneeR: 0.66, hipR: -0.3, hipL: -0.04, lean: -0.06, head: 0.12, headYaw: 0.1 },

  WHIP_LOW_R: { swayX: -0.36, pelYaw: 0.24, shYaw: -0.4, lateralBend: 0.2, raise: 0.34, armR: -0.1, elR: 0.28, wrR: -0.42, armL: 0.3, elL: 0.9, wrL: 0.44, kneeL: 0.15, kneeR: 0.5, hipR: 0.18, hipL: -0.04, head: -0.08, headYaw: -0.24 },

  SPIRAL_REACH_R: { swayX: -0.34, pelYaw: 0.34, shYaw: -0.52, lateralBend: 0.1, raise: 0.58, armR: 1, elR: 0.34, wrR: -0.4, armL: -0.3, elL: 0.82, wrL: 0.28, kneeL: 0.16, kneeR: 0.5, hipR: 0.22, hipL: -0.04, lean: 0.08, head: 0.04, headYaw: -0.28 },

  // --- Flexibility / "supple" vocabulary (exploit stance splay + elbow depth-curl) ---
  // Deep symmetric plié: knees open wide, hips sink, elbows fold in toward camera.
  DEEP_PLIE: { sink: 0.42, stance: 0.5, kneeR: 0.66, kneeL: 0.66, hipR: 0.12, hipL: 0.12, raise: 0.3, armR: -0.1, armL: 0.1, elR: 0.95, elL: 0.95, wrR: 0.3, wrL: -0.3, lean: 0.1, head: -0.06 },
  // Coil: one knee deep, torso spiraled hard, near arm fully folded (depth-curl shows the fold).
  COIL_R: { swayX: 0.4, sink: 0.2, stance: 0.22, pelYaw: -0.34, shYaw: 0.46, lateralBend: -0.2, raise: 0.4, armR: 0.2, elR: 1.0, wrR: -0.34, armL: 0.3, elL: 0.34, wrL: 0.3, kneeR: 0.16, kneeL: 0.7, hipL: 0.3, hipR: -0.1, lean: 0.06, head: 0.04, headYaw: 0.2 },
  // Both elbows folded, coiled to unfurl on the next snap step.
  FOLD_THROUGH_R: { swayX: -0.3, raise: 0.55, armR: 0.45, elR: 0.92, wrR: 0.4, armL: 0.25, elL: 0.55, wrL: -0.3, stance: 0.16, kneeR: 0.5, kneeL: 0.18, hipR: 0.18, hipL: -0.05, head: 0.06, headYaw: -0.16 },
  // Contortion freeze: extreme lateral C + fold + side-lean = a bone-bending illusion.
  CONTORT_R: { swayX: -0.4, lateralBend: 0.5, lean: 0.2, pelYaw: 0.3, shYaw: -0.55, raise: 0.5, armR: 0.7, elR: 0.95, wrR: 0.5, armL: -0.3, elL: 0.9, wrL: -0.5, stance: 0.3, kneeR: 0.6, kneeL: 0.3, hipR: 0.2, hipL: 0.05, head: -0.12, headYaw: -0.3 },

  // --- VOGUE: hand-performance frames + dramatic back-bend "dip" illusion ---
  VOGUE_FRAME_R: { swayX: -0.4, pelYaw: 0.3, shYaw: -0.4, lateralBend: 0.2, raise: 0.62, armR: 0.5, elR: 0.95, wrR: 0.5, armL: 0.5, elL: 0.95, wrL: -0.5, stance: 0.18, hipR: 0.18, hipL: -0.05, kneeR: 0.5, kneeL: 0.16, head: 0.06, headYaw: -0.18 },
  VOGUE_DIP_R: { lean: -0.34, sink: 0.3, stance: 0.42, swayX: 0.28, pelYaw: -0.2, shYaw: 0.3, raise: 0.7, armR: 0.9, elR: 0.3, wrR: 0.4, armL: 0.8, elL: 0.34, wrL: -0.4, kneeR: 0.6, kneeL: 0.5, hipR: 0.1, hipL: 0.1, head: 0.22 },

  // --- POPPING: arm-wave keyframes + rigid robot freeze ---
  WAVE_A_R: { raise: 0.7, armR: 0.9, elR: 0.18, wrR: 0.5, armL: 0.2, elL: 0.9, wrL: -0.4, stance: 0.1, kneeR: 0.3, kneeL: 0.3, head: 0.04 },
  WAVE_B_R: { raise: 0.5, armR: 0.4, elR: 0.92, wrR: -0.4, armL: 0.6, elL: 0.4, wrL: 0.5, stance: 0.1, kneeR: 0.3, kneeL: 0.3, head: -0.02 },
  ROBOT_FREEZE_R: { raise: 0.55, armR: 0.85, elR: 0.16, wrR: -0.3, armL: -0.05, elL: 0.95, wrL: 0.34, stance: 0.06, kneeR: 0.2, kneeL: 0.2, head: 0 },

  // --- HOUSE: the "jack" torso pulse (footwork reuses STEP / HOUSE_LOFT) ---
  JACK_R: { swayX: 0.3, lean: 0.16, raise: 0.3, armR: 0.2, elR: 0.7, wrR: 0.2, armL: -0.2, elL: 0.7, wrL: -0.2, stance: 0.2, kneeR: 0.2, kneeL: 0.5, hipL: 0.3, hipR: -0.08, head: -0.04, headYaw: 0.12 },

  // --- KRUMP: hard arm swing (wide stomp stance) + chest pop (lean reversal) ---
  KRUMP_HIT_R: { swayX: 0.34, shYaw: 0.4, pelYaw: -0.3, raise: 0.5, armR: 0.9, elR: 0.2, wrR: -0.4, armL: -0.2, elL: 0.9, wrL: 0.4, stance: 0.4, kneeR: 0.16, kneeL: 0.6, hipL: 0.3, hipR: -0.05, lean: 0.14, head: 0.06, headYaw: 0.1 },
  CHEST_POP: { lean: -0.22, raise: 0.4, armR: -0.2, elR: 0.85, armL: -0.2, elL: 0.85, wrR: -0.4, wrL: 0.4, stance: 0.5, kneeR: 0.55, kneeL: 0.55, sink: 0.18, head: -0.06 },
};

// L/R twins (the alternation is the dance). Authored one side; mirror() flips the other.
POSES.WEIGHT_L = mirror(POSES.WEIGHT_R);
POSES.REACH_L_HIGH = mirror(POSES.REACH_R_HIGH);
POSES.TWIST_OPEN_L = mirror(POSES.TWIST_OPEN_R);
POSES.STEP_L = mirror(POSES.STEP_R);
POSES.TURN_L = mirror(POSES.TURN_R);
POSES.TUT_BOX_L = mirror(POSES.TUT_BOX_R);
POSES.ROBOT_PUNCH_L = mirror(POSES.ROBOT_PUNCH_R);
POSES.LOCK_POINT_L = mirror(POSES.LOCK_POINT_R);
POSES.FREEZE_LOW_L = mirror(POSES.FREEZE_LOW_R);
POSES.WAACK_FRAME_L = mirror(POSES.WAACK_FRAME_R);
POSES.PORT_DE_BRAS_L = mirror(POSES.PORT_DE_BRAS_R);
POSES.HOUSE_LOFT_L = mirror(POSES.HOUSE_LOFT_R);
POSES.ATTITUDE_BACK_L = mirror(POSES.ATTITUDE_BACK_R);
POSES.WHIP_LOW_L = mirror(POSES.WHIP_LOW_R);
POSES.SPIRAL_REACH_L = mirror(POSES.SPIRAL_REACH_R);
// New flexibility + genre signatures (DEEP_PLIE / CHEST_POP are symmetric — no twin).
POSES.COIL_L = mirror(POSES.COIL_R);
POSES.FOLD_THROUGH_L = mirror(POSES.FOLD_THROUGH_R);
POSES.CONTORT_L = mirror(POSES.CONTORT_R);
POSES.VOGUE_FRAME_L = mirror(POSES.VOGUE_FRAME_R);
POSES.VOGUE_DIP_L = mirror(POSES.VOGUE_DIP_R);
POSES.WAVE_A_L = mirror(POSES.WAVE_A_R);
POSES.WAVE_B_L = mirror(POSES.WAVE_B_R);
POSES.ROBOT_FREEZE_L = mirror(POSES.ROBOT_FREEZE_R);
POSES.JACK_L = mirror(POSES.JACK_R);
POSES.KRUMP_HIT_L = mirror(POSES.KRUMP_HIT_R);

// Phrases: snappy 1-beat hits (more frequent than before so joints move often),
// always L/R balanced. `snap` triggers anticipation. DROP/IDLE are special
// (event-triggered / quiet) and excluded from the random rotation pool.
export const PHRASES = {
  GROOVE: [
    { p: 'WEIGHT_L', beats: 1, hold: 0.4 }, { p: 'REACH_R_HIGH', beats: 1, hold: 0.25, snap: true },
    { p: 'WEIGHT_R', beats: 1, hold: 0.4 }, { p: 'WAACK_FRAME_L', beats: 1, hold: 0.25, snap: true },
    { p: 'WEIGHT_L', beats: 1, hold: 0.4 }, { p: 'REACH_L_HIGH', beats: 1, hold: 0.25, snap: true },
    { p: 'WEIGHT_R', beats: 1, hold: 0.4 }, { p: 'WAACK_FRAME_R', beats: 1, hold: 0.25, snap: true },
  ],
  TWIST: [
    { p: 'WEIGHT_L', beats: 1, hold: 0.35 }, { p: 'TWIST_OPEN_R', beats: 1, hold: 0.3, snap: true },
    { p: 'SPIRAL_REACH_R', beats: 1, hold: 0.3, snap: true }, { p: 'WEIGHT_R', beats: 1, hold: 0.35 },
    { p: 'WEIGHT_R', beats: 1, hold: 0.35 }, { p: 'TWIST_OPEN_L', beats: 1, hold: 0.3, snap: true },
    { p: 'SPIRAL_REACH_L', beats: 1, hold: 0.3, snap: true }, { p: 'WEIGHT_L', beats: 1, hold: 0.35 },
  ],
  TURN: [
    { p: 'WEIGHT_L', beats: 1, hold: 0.35 }, { p: 'TURN_R', beats: 1, hold: 0.4, snap: true },
    { p: 'PORT_DE_BRAS_R', beats: 1, hold: 0.35, snap: true }, { p: 'WEIGHT_R', beats: 1, hold: 0.35 },
    { p: 'WEIGHT_R', beats: 1, hold: 0.35 }, { p: 'TURN_L', beats: 1, hold: 0.4, snap: true },
    { p: 'PORT_DE_BRAS_L', beats: 1, hold: 0.35, snap: true }, { p: 'WEIGHT_L', beats: 1, hold: 0.35 },
  ],
  STEP: [
    { p: 'STEP_R', beats: 1, hold: 0.25, snap: true }, { p: 'HOUSE_LOFT_R', beats: 1, hold: 0.3, snap: true },
    { p: 'WEIGHT_R', beats: 1, hold: 0.3 }, { p: 'STEP_L', beats: 1, hold: 0.25, snap: true },
    { p: 'HOUSE_LOFT_L', beats: 1, hold: 0.3, snap: true }, { p: 'WEIGHT_L', beats: 1, hold: 0.3 },
  ],
  STAB: [
    { p: 'WEIGHT_L', beats: 1, hold: 0.3 }, { p: 'PUSH_DOWN', beats: 1, hold: 0.2, snap: true },
    { p: 'FREEZE_LOW_R', beats: 1, hold: 0.3, snap: true }, { p: 'WEIGHT_R', beats: 1, hold: 0.3 },
    { p: 'PUSH_DOWN', beats: 1, hold: 0.2, snap: true }, { p: 'FREEZE_LOW_L', beats: 1, hold: 0.3, snap: true },
  ],
  LOCK: [
    { p: 'LOCK_POINT_R', beats: 1, hold: 0.3, snap: true }, { p: 'ROBOT_PUNCH_R', beats: 1, hold: 0.25, snap: true },
    { p: 'WEIGHT_L', beats: 1, hold: 0.3 }, { p: 'LOCK_POINT_L', beats: 1, hold: 0.3, snap: true },
    { p: 'ROBOT_PUNCH_L', beats: 1, hold: 0.25, snap: true }, { p: 'WEIGHT_R', beats: 1, hold: 0.3 },
  ],
  TUT: [
    { p: 'TUT_BOX_R', beats: 1, hold: 0.35, snap: true }, { p: 'SCARECROW_T', beats: 1, hold: 0.3, snap: true },
    { p: 'TUT_BOX_L', beats: 1, hold: 0.35, snap: true }, { p: 'WEIGHT_R', beats: 1, hold: 0.3 },
    { p: 'TUT_BOX_L', beats: 1, hold: 0.35, snap: true }, { p: 'SCARECROW_T', beats: 1, hold: 0.3, snap: true },
    { p: 'TUT_BOX_R', beats: 1, hold: 0.35, snap: true }, { p: 'WEIGHT_L', beats: 1, hold: 0.3 },
  ],
  WAACK: [
    { p: 'WAACK_FRAME_R', beats: 1, hold: 0.25, snap: true }, { p: 'WHIP_LOW_R', beats: 1, hold: 0.25, snap: true },
    { p: 'WAACK_FRAME_L', beats: 1, hold: 0.25, snap: true }, { p: 'WHIP_LOW_L', beats: 1, hold: 0.25, snap: true },
  ],
  FLOW: [
    { p: 'PORT_DE_BRAS_R', beats: 1, hold: 0.4, snap: true }, { p: 'ATTITUDE_BACK_R', beats: 1, hold: 0.35, snap: true },
    { p: 'WEIGHT_R', beats: 1, hold: 0.3 }, { p: 'PORT_DE_BRAS_L', beats: 1, hold: 0.4, snap: true },
    { p: 'ATTITUDE_BACK_L', beats: 1, hold: 0.35, snap: true }, { p: 'WEIGHT_L', beats: 1, hold: 0.3 },
  ],

  // --- Genre-exclusive phrases (one signature per dance style). Short holds +
  // snap = the inhuman precision; the depth-curl + low-ZETA springs make the
  // folds whip. Genres reuse existing poses where they overlap. ---
  VOGUE_HANDS: [
    { p: 'VOGUE_FRAME_R', beats: 1, hold: 0.3, snap: true }, { p: 'VOGUE_FRAME_L', beats: 1, hold: 0.3, snap: true },
    { p: 'WEIGHT_R', beats: 1, hold: 0.3 }, { p: 'VOGUE_FRAME_R', beats: 1, hold: 0.3, snap: true },
    { p: 'VOGUE_FRAME_L', beats: 1, hold: 0.3, snap: true }, { p: 'WEIGHT_L', beats: 1, hold: 0.3 },
  ],
  VOGUE_DIP: [
    { p: 'VOGUE_FRAME_R', beats: 1, hold: 0.3, snap: true }, { p: 'VOGUE_DIP_R', beats: 2, hold: 0.55, snap: true },
    { p: 'WEIGHT_L', beats: 1, hold: 0.4 }, { p: 'VOGUE_FRAME_L', beats: 1, hold: 0.3, snap: true },
    { p: 'VOGUE_DIP_L', beats: 2, hold: 0.55, snap: true }, { p: 'WEIGHT_R', beats: 1, hold: 0.4 },
  ],
  WAVE: [
    { p: 'WAVE_A_R', beats: 1, hold: 0.2, snap: true }, { p: 'WAVE_B_R', beats: 1, hold: 0.2, snap: true },
    { p: 'WAVE_A_L', beats: 1, hold: 0.2, snap: true }, { p: 'WAVE_B_L', beats: 1, hold: 0.2, snap: true },
  ],
  ROBOT_FREEZE: [
    { p: 'ROBOT_FREEZE_R', beats: 1, hold: 0.5, snap: true }, { p: 'WEIGHT_L', beats: 1, hold: 0.3 },
    { p: 'ROBOT_FREEZE_L', beats: 1, hold: 0.5, snap: true }, { p: 'WEIGHT_R', beats: 1, hold: 0.3 },
  ],
  ISO_BOX: [
    { p: 'TUT_BOX_R', beats: 1, hold: 0.3, snap: true }, { p: 'SCARECROW_T', beats: 1, hold: 0.25, snap: true },
    { p: 'TUT_BOX_L', beats: 1, hold: 0.3, snap: true }, { p: 'ROBOT_FREEZE_R', beats: 1, hold: 0.3, snap: true },
  ],
  WAACK_WHIP: [
    { p: 'WAACK_FRAME_R', beats: 1, hold: 0.2, snap: true }, { p: 'WHIP_LOW_R', beats: 1, hold: 0.2, snap: true },
    { p: 'WAACK_FRAME_L', beats: 1, hold: 0.2, snap: true }, { p: 'WHIP_LOW_L', beats: 1, hold: 0.2, snap: true },
  ],
  WAACK_SPIN: [
    { p: 'TURN_R', beats: 1, hold: 0.25, snap: true }, { p: 'SPIRAL_REACH_R', beats: 1, hold: 0.25, snap: true },
    { p: 'TURN_L', beats: 1, hold: 0.25, snap: true }, { p: 'SPIRAL_REACH_L', beats: 1, hold: 0.25, snap: true },
  ],
  HOUSE_FOOT: [
    { p: 'STEP_R', beats: 1, hold: 0.2, snap: true }, { p: 'HOUSE_LOFT_R', beats: 1, hold: 0.25, snap: true },
    { p: 'STEP_L', beats: 1, hold: 0.2, snap: true }, { p: 'HOUSE_LOFT_L', beats: 1, hold: 0.25, snap: true },
  ],
  JACK: [
    { p: 'JACK_R', beats: 1, hold: 0.2, snap: true }, { p: 'STEP_R', beats: 1, hold: 0.2, snap: true },
    { p: 'JACK_L', beats: 1, hold: 0.2, snap: true }, { p: 'STEP_L', beats: 1, hold: 0.2, snap: true },
  ],
  KRUMP_HIT: [
    { p: 'KRUMP_HIT_R', beats: 1, hold: 0.2, snap: true }, { p: 'CHEST_POP', beats: 1, hold: 0.25, snap: true },
    { p: 'KRUMP_HIT_L', beats: 1, hold: 0.2, snap: true }, { p: 'CHEST_POP', beats: 1, hold: 0.25, snap: true },
  ],
  CHEST_POP_PH: [
    { p: 'CHEST_POP', beats: 1, hold: 0.25, snap: true }, { p: 'WEIGHT_R', beats: 1, hold: 0.3 },
    { p: 'CHEST_POP', beats: 1, hold: 0.25, snap: true }, { p: 'WEIGHT_L', beats: 1, hold: 0.3 },
  ],
  COIL_PH: [
    { p: 'COIL_R', beats: 1, hold: 0.3, snap: true }, { p: 'FOLD_THROUGH_R', beats: 1, hold: 0.25, snap: true },
    { p: 'COIL_L', beats: 1, hold: 0.3, snap: true }, { p: 'FOLD_THROUGH_L', beats: 1, hold: 0.25, snap: true },
  ],
  CONTORT: [
    { p: 'CONTORT_R', beats: 2, hold: 0.5, snap: true }, { p: 'DEEP_PLIE', beats: 1, hold: 0.4, snap: true },
    { p: 'CONTORT_L', beats: 2, hold: 0.5, snap: true }, { p: 'DEEP_PLIE', beats: 1, hold: 0.4, snap: true },
  ],
  DROP: [
    { p: 'CONTRACT', beats: 1, hold: 0.5 }, { p: 'RELEASE_UP', beats: 1, hold: 0.3, snap: true },
    { p: 'SCARECROW_T', beats: 1, hold: 0.3, snap: true }, { p: 'CONTRACT', beats: 1, hold: 0.5 },
    { p: 'RELEASE_UP', beats: 1, hold: 0.3, snap: true },
  ],
  IDLE: [
    { p: 'WEIGHT_L', beats: 2, hold: 0.55 }, { p: 'IDLE_CENTER', beats: 1, hold: 0.45 },
    { p: 'WEIGHT_R', beats: 2, hold: 0.55 }, { p: 'IDLE_CENTER', beats: 1, hold: 0.45 },
  ],
};

// Tempo-band rotation pools (DROP and IDLE are special, excluded).
const BAND_POOL = {
  slow: ['GROOVE', 'TWIST', 'TURN', 'STAB', 'TUT', 'FLOW'],
  mid: ['GROOVE', 'TWIST', 'TURN', 'STEP', 'STAB', 'LOCK', 'TUT', 'WAACK', 'FLOW'],
  fast: ['GROOVE', 'STEP', 'STAB', 'LOCK', 'WAACK'],
};

export function phrasesForBand(band, modeFavored) {
  const base = BAND_POOL[band] || BAND_POOL.mid;
  if (modeFavored && modeFavored.length) {
    const inter = base.filter((id) => modeFavored.includes(id));
    return inter.length ? inter : modeFavored;
  }
  return base;
}
