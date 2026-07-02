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
  // Variety so voguing isn't the same hand-frame on a loop: a low DUCKWALK squat and a SPIN.
  VOGUE_DUCK_R: { sink: 0.42, stance: 0.45, swayX: 0.18, pelYaw: 0.12, raise: 0.52, armR: 0.42, elR: 0.92, wrR: 0.45, armL: 0.36, elL: 0.92, wrL: -0.45, hipR: 0.28, kneeR: 0.72, hipL: 0.12, kneeL: 0.64, lean: 0.12, head: 0.04, headYaw: -0.16 },
  VOGUE_SPIN: { pelYaw: 0.58, shYaw: 0.55, swayX: 0.12, raise: 0.6, armR: 0.5, elR: 0.42, wrR: 0.34, armL: 0.24, elL: 0.85, wrL: -0.34, hipL: 0.14, hipR: -0.04, kneeR: 0.2, kneeL: 0.36, head: 0.06, headYaw: 0.34 },

  // --- POPPING: arm-wave keyframes + rigid robot freeze ---
  WAVE_A_R: { raise: 0.7, armR: 0.9, elR: 0.18, wrR: 0.5, armL: 0.2, elL: 0.9, wrL: -0.4, stance: 0.1, kneeR: 0.3, kneeL: 0.3, head: 0.04 },
  WAVE_B_R: { raise: 0.5, armR: 0.4, elR: 0.92, wrR: -0.4, armL: 0.6, elL: 0.4, wrL: 0.5, stance: 0.1, kneeR: 0.3, kneeL: 0.3, head: -0.02 },
  ROBOT_FREEZE_R: { raise: 0.55, armR: 0.85, elR: 0.16, wrR: -0.3, armL: -0.05, elL: 0.95, wrL: 0.34, stance: 0.06, kneeR: 0.2, kneeL: 0.2, head: 0 },

  // --- HOUSE: the "jack" torso pulse (footwork reuses STEP / HOUSE_LOFT) ---
  JACK_R: { swayX: 0.3, lean: 0.16, raise: 0.3, armR: 0.2, elR: 0.7, wrR: 0.2, armL: -0.2, elL: 0.7, wrL: -0.2, stance: 0.2, kneeR: 0.2, kneeL: 0.5, hipL: 0.3, hipR: -0.08, head: -0.04, headYaw: 0.12 },

  // --- KRUMP: hard arm swing (wide stomp stance) + chest pop (lean reversal) ---
  KRUMP_HIT_R: { swayX: 0.34, shYaw: 0.4, pelYaw: -0.3, raise: 0.5, armR: 0.9, elR: 0.2, wrR: -0.4, armL: -0.2, elL: 0.9, wrL: 0.4, stance: 0.4, kneeR: 0.5, kneeL: 0.62, hipL: 0.3, hipR: -0.05, lean: 0.14, head: 0.06, headYaw: 0.1 },
  CHEST_POP: { lean: -0.22, raise: 0.4, armR: -0.2, elR: 0.85, armL: -0.2, elL: 0.85, wrR: -0.4, wrL: 0.4, stance: 0.5, kneeR: 0.55, kneeL: 0.55, sink: 0.18, head: -0.06 },

  // --- CHARLESTON: 1920s jazz footwork — alternating forward KICK / back TOUCH with a
  // knees-in swivel (stance goes slightly NEGATIVE = pigeon-toe) and contralateral arm
  // swing (arm opposite the working leg pumps forward). Showcases the fixed knee hinge:
  // the kicking leg folds cleanly, the trailing leg tucks behind, and the pelvis holds
  // through the forward/back weight rock. Bouncy 4-count loop.
  CHARLESTON_KICK_R: { swayX: 0.16, pelYaw: 0.14, shYaw: -0.22, raise: 0.32, hipR: 0.85, kneeR: 0.3, hipL: -0.22, kneeL: 0.52, stance: -0.05, armL: 0.6, elL: 0.28, wrL: 0.24, armR: -0.4, elR: 0.44, wrR: -0.22, lean: -0.05, sink: 0.06, head: 0.07, headYaw: -0.14 },
  CHARLESTON_BACK_R: { swayX: 0.06, pelYaw: -0.1, shYaw: 0.16, raise: 0.3, hipR: -0.55, kneeR: 0.62, hipL: 0.14, kneeL: 0.34, stance: 0.1, armL: -0.3, elL: 0.42, wrL: 0.2, armR: 0.55, elR: 0.3, wrR: -0.24, lean: 0.06, sink: 0.1, head: -0.04, headYaw: 0.12 },
  // Jazz SWIVEL (the "mess around"): both knees swung to one side, pelvis twisted counter to
  // the chest — breaks up the kick/back loop.
  CHARLESTON_SWIVEL_R: { swayX: 0.2, pelYaw: -0.3, shYaw: 0.2, lateralBend: -0.15, raise: 0.36, armR: 0.4, elR: 0.5, wrR: 0.2, armL: 0.3, elL: 0.55, wrL: -0.2, hipR: 0.2, kneeR: 0.45, hipL: 0.3, kneeL: 0.5, stance: -0.15, lean: 0.06, head: 0.05, headYaw: -0.2 },

  // --- TRAIN (locomotion / choo-choo): piston arms pumping fore/aft (bent elbows, fists
  // near the chest), a marching knee-up CHUG that travels side to side, forward lean and
  // a bouncy sink = a chugging locomotive. TRAIN_WHISTLE is the "pull the horn" accent
  // (one arm up, cocked). Mechanical feel comes from the low lag in MODE_STYLE (limbs move
  // as one piston, not an unfurling whip).
  TRAIN_CHUG_R: { swayX: 0.38, pelYaw: 0.16, shYaw: -0.12, lean: 0.14, sink: 0.14, raise: 0.44, armR: 0.55, elR: 0.85, wrR: 0.12, armL: -0.42, elL: 0.9, wrL: -0.12, hipR: 0.5, kneeR: 0.72, hipL: -0.06, kneeL: 0.5, stance: 0.06, head: 0.05, headYaw: 0.14 },
  TRAIN_WHISTLE: { raise: 0.72, armR: 0.12, elR: 0.62, wrR: 0.42, armL: -0.28, elL: 0.86, wrL: -0.18, sink: 0.16, hipR: 0.12, kneeR: 0.55, hipL: 0.12, kneeL: 0.55, stance: 0.16, lean: 0.05, head: 0.12, headYaw: 0.08 },
  // Variety so it isn't just the same chug: a HIGH piston (fists pumping up) and a lean-back BRAKE.
  TRAIN_CHUG_HI_R: { swayX: 0.34, pelYaw: 0.14, shYaw: -0.1, lean: 0.1, sink: 0.1, raise: 0.72, armR: 0.5, elR: 0.92, wrR: 0.1, armL: -0.38, elL: 0.95, wrL: -0.1, hipR: 0.42, kneeR: 0.66, hipL: -0.05, kneeL: 0.48, stance: 0.06, head: 0.04, headYaw: 0.12 },
  TRAIN_BRAKE: { lean: -0.14, sink: 0.12, raise: 0.5, armR: -0.35, elR: 0.7, wrR: -0.2, armL: -0.35, elL: 0.7, wrL: 0.2, hipR: 0.15, kneeR: 0.5, hipL: 0.15, kneeL: 0.5, stance: 0.1, head: -0.04 },

  // --- BIRD (The Bird / バードステップ): WING-FLAP arms — high `raise` throws both arms
  // OUT to the sides and up (frontal-plane elevation = wings spread), elbows folded so the
  // forearms angle in; the flap is raise oscillating UP↔DOWN each beat. A knee bob rides the
  // flap, and a head-forward "peck" strut (BIRD_PECK) travels side to side. UP/DOWN are
  // symmetric (no twin); PECK mirrors.
  BIRD_UP: { raise: 1.7, armR: 0.05, armL: -0.05, elR: 0.55, elL: 0.55, wrR: 0.24, wrL: -0.24, sink: -0.06, hipR: 0.06, hipL: 0.06, kneeR: 0.34, kneeL: 0.34, stance: 0.08, lean: -0.03, head: 0.08 },
  BIRD_DOWN: { raise: 0.5, armR: 0.05, armL: -0.05, elR: 0.5, elL: 0.5, wrR: -0.22, wrL: 0.22, sink: 0.16, hipR: 0.1, hipL: 0.1, kneeR: 0.52, kneeL: 0.52, stance: 0.1, lean: 0.05, head: -0.06 },
  BIRD_PECK_R: { swayX: 0.3, pelYaw: 0.12, shYaw: -0.1, lean: 0.16, raise: 0.5, armR: 0.15, elR: 0.85, wrR: 0.3, armL: -0.15, elL: 0.85, wrL: -0.3, hipR: -0.05, kneeR: 0.42, hipL: 0.35, kneeL: 0.6, stance: 0.06, sink: 0.1, head: 0.16, headYaw: -0.1 },
  // Variety so the wings don't just spread symmetrically over and over:
  // BIRD_TILT = a BANKING beat — wings still spread but the torso tips (lateralBend) so one
  // wing rides high and the other low, and the elbows differ (one wing extended, one folded).
  BIRD_TILT_R: { raise: 1.45, lateralBend: -0.5, swayX: 0.16, armR: 0.05, armL: -0.05, elR: 0.38, elL: 0.68, wrR: 0.3, wrL: -0.18, hipR: 0.08, hipL: 0.08, kneeR: 0.36, kneeL: 0.32, stance: 0.08, head: 0.04, headYaw: -0.16 },
  // BIRD_PREEN = a grooming dip: wings fold in low and the head tucks down toward one wing.
  BIRD_PREEN_R: { raise: 0.5, lean: 0.14, lateralBend: -0.22, swayX: 0.12, armR: 0.12, elR: 0.92, wrR: 0.44, armL: -0.12, elL: 0.66, wrL: -0.2, hipR: 0.08, hipL: 0.08, kneeR: 0.5, kneeL: 0.5, stance: 0.1, sink: 0.12, head: -0.3, headYaw: -0.32 },
  // BIRD_STRUT = a pigeon strut step: wings half-folded at the sides, weight shift + knee-up,
  // head bobbing forward. Low and struttin', a total break from the overhead flap.
  BIRD_STRUT_R: { swayX: 0.28, pelYaw: 0.14, shYaw: -0.12, raise: 0.42, armR: 0.0, elR: 0.76, wrR: -0.2, armL: 0.0, elL: 0.76, wrL: 0.2, hipR: 0.32, kneeR: 0.56, hipL: -0.04, kneeL: 0.4, stance: 0.06, lean: 0.08, sink: 0.06, head: 0.1, headYaw: 0.16 },

  // --- TANGO: dramatic staccato — elongated held LINE / FRAME, deep CORTE dip, crossed-leg
  // OCHO pivot, and a sharp BOLEO leg-flick (the shin whips up behind = the knee hinge's
  // showcase). Long holds punctuated by 1-beat snaps = the tango's controlled tension.
  // Proud chest (lean<0), sharp head-to-profile (headYaw), close arm frame.
  TANGO_FRAME_R: { swayX: -0.35, pelYaw: 0.1, shYaw: 0.05, lean: -0.08, raise: 0.42, armR: 0.7, elR: 0.2, wrR: 0.3, armL: 0.1, elL: 0.9, wrL: -0.2, hipR: 0.16, kneeR: 0.14, hipL: -0.02, kneeL: 0.4, stance: 0.05, head: 0.06, headYaw: -0.42 },
  TANGO_CORTE_R: { swayX: 0.22, pelYaw: -0.12, shYaw: 0.18, lean: 0.2, sink: 0.24, raise: 0.4, armR: 0.5, elR: 0.28, wrR: 0.3, armL: -0.35, elL: 0.6, wrL: -0.3, hipR: 0.4, kneeR: 0.7, hipL: -0.6, kneeL: 0.14, stance: 0.1, head: 0.04, headYaw: 0.16 },
  TANGO_OCHO_R: { swayX: -0.2, pelYaw: 0.4, shYaw: 0.5, lean: -0.04, raise: 0.4, armR: 0.3, elR: 0.75, wrR: 0.3, armL: 0.35, elL: 0.75, wrL: -0.3, hipR: 0.12, kneeR: 0.5, hipL: 0.1, kneeL: 0.45, stance: -0.12, head: 0.05, headYaw: 0.3 },
  TANGO_BOLEO_R: { swayX: -0.3, pelYaw: 0.2, shYaw: -0.15, lean: 0.05, raise: 0.44, armR: 0.4, elR: 0.7, wrR: 0.3, armL: -0.2, elL: 0.7, wrL: -0.3, hipR: -0.4, kneeR: 0.95, hipL: 0.02, kneeL: 0.42, stance: 0.0, head: 0.06, headYaw: -0.24 },

  // === RARE showcase poses — one per new style, injected occasionally by the *_SHOW
  // phrases (held long as a highlight). Big, distinctive silhouettes. ===
  // Charleston FAN: a high side fan-kick, opposite arm flung up, a jaunty little hop.
  CHARLESTON_FAN_R: { swayX: 0.32, pelYaw: 0.2, shYaw: -0.28, lateralBend: -0.2, lean: -0.06, raise: 0.7, hipR: 0.9, kneeR: 0.2, hipL: -0.05, kneeL: 0.5, stance: 0.35, armR: -0.3, elR: 0.3, wrR: -0.3, armL: 0.8, elL: 0.24, wrL: 0.3, head: 0.14, headYaw: -0.2, lift: 0.12 },
  // Train EXPRESS: full-speed forward-lean lunge, BOTH arms driving forward, rear leg pushing off.
  TRAIN_EXPRESS: { swayX: 0.12, pelYaw: 0.1, lean: 0.28, sink: 0.16, raise: 0.5, armR: 0.7, elR: 0.45, wrR: 0.3, armL: 0.62, elL: 0.5, wrL: -0.3, hipR: 0.55, kneeR: 0.55, hipL: -0.5, kneeL: 0.2, stance: 0.06, head: 0.12, headYaw: 0.0 },
  // Bird SOAR: wings FULLY spread (straight, near-horizontal) and HELD — a glide, not a flap —
  // pitched forward with the trailing leg streamed back (arabesque). The still-wing highlight.
  BIRD_SOAR: { raise: 2.0, armR: 0.05, armL: -0.05, elR: 0.2, elL: 0.2, wrR: 0.34, wrL: -0.34, lean: 0.18, hipR: -0.5, kneeR: 0.16, hipL: 0.12, kneeL: 0.42, stance: 0.06, sink: -0.05, head: 0.18, lift: 0.1 },
  // Tango DIP: dramatic OVERSWAY — deep lateral lean, one leg extended in a long line, the
  // other bent under, an arm swept high overhead, head thrown. The showstopper finish.
  TANGO_DIP_R: { swayX: -0.4, lateralBend: 0.42, lean: 0.14, pelYaw: 0.2, shYaw: -0.3, raise: 0.7, armR: 0.85, elR: 0.2, wrR: 0.4, armL: -0.3, elL: 0.5, wrL: -0.3, hipR: 0.16, kneeR: 0.12, hipL: 0.1, kneeL: 0.55, stance: 0.18, head: -0.14, headYaw: 0.2 },

  // --- ROBOT: mechanical isolations — rigid RIGHT-ANGLE arms (elbows ~90°), dead-stop poses,
  // stiff marching knee-ups. The MODE_STYLE makes it read robotic: max stiffness + max damping
  // (zeta clamped high = NO overshoot), low lag (joints lock together), minimal groove. Wrists
  // held flat (wr 0) so the hands read as rigid blocks. Rare pose = a GLITCH malfunction freeze.
  ROBOT_ARMS_R: { raise: 0.55, armR: 0.5, elR: 0.92, wrR: 0.0, armL: 0.1, elL: 0.92, wrL: 0.0, hipR: 0.05, hipL: 0.05, kneeR: 0.22, kneeL: 0.22, stance: 0.05, shYaw: 0.12, pelYaw: -0.06, head: 0.0, headYaw: 0.16 },
  ROBOT_STEP_R: { swayX: 0.2, raise: 0.5, armR: 0.3, elR: 0.9, wrR: 0.0, armL: -0.1, elL: 0.9, wrL: 0.0, hipR: 0.6, kneeR: 0.9, hipL: -0.02, kneeL: 0.28, stance: 0.04, sink: 0.05, pelYaw: 0.08, head: 0.0, headYaw: -0.14 },
  ROBOT_SCAN: { raise: 0.6, armR: 0.85, elR: 0.15, wrR: 0.0, armL: 0.15, elL: 0.95, wrL: 0.0, hipR: 0.05, hipL: 0.05, kneeR: 0.22, kneeL: 0.22, stance: 0.06, shYaw: -0.1, head: 0.02, headYaw: 0.34 },
  // RARE: ROBOT_GLITCH — a malfunction freeze: torqued spine, one arm shot up rigid, the other
  // cocked, head snapped hard to the side/down. A "system error" held beat.
  ROBOT_GLITCH: { swayX: -0.18, pelYaw: 0.24, shYaw: -0.34, lateralBend: 0.18, lean: 0.1, raise: 0.85, armR: 0.4, elR: 0.9, wrR: 0.4, armL: 0.7, elL: 0.16, wrL: -0.4, hipR: 0.1, kneeR: 0.35, hipL: -0.05, kneeL: 0.45, stance: 0.08, head: -0.2, headYaw: -0.4 },
  // RARE (sequence): ROBOT_TIP — the rigid body TOPPLES to one side as if falling, arms flung
  // out straight for balance, legs locked; held frozen at the tipping point, then the showcase
  // snaps back to upright = 倒れかけ→静止→復帰. Big lateralBend + weight shift + a slight lift so
  // the far foot reads as leaving the floor mid-topple.
  ROBOT_TIP_R: { swayX: -0.32, lateralBend: 0.62, lean: 0.08, pelYaw: 0.05, raise: 0.62, armR: 0.6, elR: 0.18, wrR: 0.0, armL: 0.55, elL: 0.18, wrL: 0.0, hipR: 0.14, kneeR: 0.2, hipL: -0.06, kneeL: 0.2, stance: 0.12, head: 0.0, headYaw: -0.22, lift: 0.06 },
  // RARE #2 (sequence): PUPPET_CUT — the marionette's strings are cut: the body drops into a
  // FULL STRADDLE SPLIT on the floor (stance flung wide = legs flat to the sides, sunk to the
  // ground), torso slumped forward, arms hanging limp, head lolling down. Held frozen, then the
  // showcase yanks it back upright (strings reattached) = 完全開脚で座り込み→静止→復帰. Symmetric.
  PUPPET_CUT: { sink: 0.55, stance: 1.5, kneeR: 0.12, kneeL: 0.12, hipR: 0.06, hipL: 0.06, lean: 0.42, raise: 0.12, armR: -0.12, elR: 0.4, wrR: 0.0, armL: -0.12, elL: 0.4, wrL: 0.0, head: -0.34, shYaw: 0.04 },

  // ============================================================
  // AIRBORNE — croquis leap vocabulary. `lift` raises the WHOLE figure off the
  // ground (shared skeleton, so it works in BOTH render styles). There is no
  // foot-IK, so a thrown/folded leg + hip swing reads as a leap, kick, or split
  // rather than a glitch. Traced from the gesture-drawing references — slender
  // dancers caught mid-flight. poseAmp scales lift, so quiet passages barely
  // leave the floor and only strong energy fully flies (gating for free).
  // ============================================================
  // Grand jeté: front-back split in the air. Lead thigh (R) thrown forward+up,
  // rear thigh (L) driven back, both knees near-straight, arms in opposition,
  // chest lifted, gaze up the leading line. The signature reference pose.
  JETE_R: { lift: 0.5, swayX: -0.08, hipR: 1.26, hipL: -1.16, kneeR: 0.12, kneeL: 0.16, raise: 0.76, armR: 1.0, armL: 0.74, elR: 0.2, elL: 0.34, wrR: 0.34, wrL: -0.3, lean: 0.06, head: 0.14, headYaw: -0.12 },
  // Stag leap: lead thigh high but the knee FOLDED (foot tucked under), trailing
  // leg streamed straight back — the arched "deer" silhouette.
  STAG_R: { lift: 0.54, hipR: 1.04, kneeR: 0.92, hipL: -1.04, kneeL: 0.12, raise: 0.8, armR: 0.92, armL: 0.46, elR: 0.3, elL: 0.66, wrR: 0.3, wrL: -0.28, lean: -0.04, head: 0.16, headYaw: -0.1 },
  // Tuck / gather jump: both thighs drawn up toward the chest, knees folded, arms
  // swept up — a curled, compact airborne ball. Symmetric (no twin).
  TUCK_AIR: { lift: 0.62, hipR: 0.58, hipL: 0.58, kneeR: 1.02, kneeL: 1.02, raise: 0.74, armR: 0.78, armL: 0.78, elR: 0.3, elL: 0.3, wrR: 0.3, wrL: -0.3, stance: 0.16, lean: -0.05, head: 0.12 },
  // High battement leap: a low hop while one leg whips up to a near-vertical front
  // kick, the support leg trailing; arms framing the kicking line.
  KICK_AIR_R: { lift: 0.3, swayX: 0.16, hipR: 1.42, kneeR: 0.08, hipL: -0.14, kneeL: 0.12, raise: 0.72, armR: 0.5, armL: 0.86, elR: 0.46, elL: 0.28, wrR: 0.3, wrL: -0.3, lean: -0.08, head: 0.12, headYaw: 0.1 },
  // Arabesque leap: flying forward — torso pitched over, one leg streamed straight
  // back, both arms reaching ahead along the line of flight.
  ARAB_LEAP_R: { lift: 0.44, lean: 0.24, hipR: -0.72, kneeR: 0.12, hipL: 0.26, kneeL: 0.18, raise: 0.66, armR: 0.86, armL: 0.72, elR: 0.24, elL: 0.3, wrR: 0.32, wrL: -0.3, head: 0.18, headYaw: -0.08 },
  // Straddle / second-position split jump: legs flung wide to the sides in the
  // air, knees straight, arms lifted in a high V. Symmetric (no twin).
  STRADDLE_AIR: { lift: 0.56, stance: 0.92, kneeR: 0.12, kneeL: 0.12, hipR: 0.22, hipL: 0.22, raise: 0.84, armR: 0.6, armL: 0.6, elR: 0.4, elL: 0.4, wrR: 0.3, wrL: -0.3, head: 0.1 },
  // Plié wind-up / landing for leaps: a deep gather with the arms swept down-back
  // (anticipation). The spring overshoot off this pose IS the launch pop, and
  // returning to it reads as the landing absorb. Symmetric.
  LEAP_PREP: { sink: 0.36, stance: 0.32, kneeR: 0.52, kneeL: 0.52, hipR: 0.18, hipL: 0.18, raise: 0.18, armR: -0.24, armL: -0.24, elR: 0.5, elL: 0.5, wrR: -0.2, wrL: 0.2, lean: 0.14, head: -0.06 },
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
POSES.CHARLESTON_KICK_L = mirror(POSES.CHARLESTON_KICK_R);
POSES.CHARLESTON_BACK_L = mirror(POSES.CHARLESTON_BACK_R);
POSES.TRAIN_CHUG_L = mirror(POSES.TRAIN_CHUG_R);
POSES.TRAIN_CHUG_HI_L = mirror(POSES.TRAIN_CHUG_HI_R);
POSES.VOGUE_DUCK_L = mirror(POSES.VOGUE_DUCK_R);
POSES.CHARLESTON_SWIVEL_L = mirror(POSES.CHARLESTON_SWIVEL_R);
POSES.BIRD_PECK_L = mirror(POSES.BIRD_PECK_R);
POSES.BIRD_TILT_L = mirror(POSES.BIRD_TILT_R);
POSES.BIRD_PREEN_L = mirror(POSES.BIRD_PREEN_R);
POSES.BIRD_STRUT_L = mirror(POSES.BIRD_STRUT_R);
POSES.TANGO_FRAME_L = mirror(POSES.TANGO_FRAME_R);
POSES.TANGO_CORTE_L = mirror(POSES.TANGO_CORTE_R);
POSES.TANGO_OCHO_L = mirror(POSES.TANGO_OCHO_R);
POSES.TANGO_BOLEO_L = mirror(POSES.TANGO_BOLEO_R);
POSES.CHARLESTON_FAN_L = mirror(POSES.CHARLESTON_FAN_R);
POSES.ROBOT_ARMS_L = mirror(POSES.ROBOT_ARMS_R);
POSES.ROBOT_STEP_L = mirror(POSES.ROBOT_STEP_R);
POSES.ROBOT_SCAN_L = mirror(POSES.ROBOT_SCAN);
POSES.ROBOT_TIP_L = mirror(POSES.ROBOT_TIP_R);
// Airborne leap twins (TUCK_AIR / STRADDLE_AIR / LEAP_PREP are symmetric — no twin).
POSES.JETE_L = mirror(POSES.JETE_R);
POSES.STAG_L = mirror(POSES.STAG_R);
POSES.KICK_AIR_L = mirror(POSES.KICK_AIR_R);
POSES.ARAB_LEAP_L = mirror(POSES.ARAB_LEAP_R);

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
    { p: 'VOGUE_DUCK_R', beats: 1, hold: 0.35, snap: true }, { p: 'VOGUE_SPIN', beats: 1, hold: 0.3, snap: true },
    { p: 'VOGUE_FRAME_L', beats: 1, hold: 0.3, snap: true }, { p: 'VOGUE_DUCK_L', beats: 1, hold: 0.35, snap: true },
    { p: 'VOGUE_FRAME_R', beats: 1, hold: 0.3, snap: true }, { p: 'VOGUE_SPIN', beats: 1, hold: 0.3, snap: true },
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
  // Charleston: kick/back, then a jazz swivel section — not just the same 4-count on repeat.
  CHARLESTON: [
    { p: 'CHARLESTON_KICK_R', beats: 1, hold: 0.3, snap: true }, { p: 'CHARLESTON_BACK_R', beats: 1, hold: 0.3, snap: true },
    { p: 'CHARLESTON_KICK_L', beats: 1, hold: 0.3, snap: true }, { p: 'CHARLESTON_BACK_L', beats: 1, hold: 0.3, snap: true },
    { p: 'CHARLESTON_SWIVEL_R', beats: 1, hold: 0.32, snap: true }, { p: 'CHARLESTON_SWIVEL_L', beats: 1, hold: 0.32, snap: true },
    { p: 'CHARLESTON_KICK_R', beats: 1, hold: 0.3, snap: true }, { p: 'CHARLESTON_SWIVEL_L', beats: 1, hold: 0.32, snap: true },
  ],
  // Train: chug varied by arm HEIGHT (mid ↔ high piston) with whistle + a lean-back brake.
  TRAIN: [
    { p: 'TRAIN_CHUG_R', beats: 1, hold: 0.22, snap: true }, { p: 'TRAIN_CHUG_L', beats: 1, hold: 0.22, snap: true },
    { p: 'TRAIN_CHUG_HI_R', beats: 1, hold: 0.24, snap: true }, { p: 'TRAIN_CHUG_HI_L', beats: 1, hold: 0.24, snap: true },
    { p: 'TRAIN_WHISTLE', beats: 1, hold: 0.32, snap: true }, { p: 'TRAIN_CHUG_R', beats: 1, hold: 0.22, snap: true },
    { p: 'TRAIN_BRAKE', beats: 1, hold: 0.3, snap: true }, { p: 'TRAIN_CHUG_L', beats: 1, hold: 0.22, snap: true },
  ],
  // Bird: the flap is now the ACCENT, not the whole dance — a full wing-spread (BIRD_UP) lands
  // only occasionally, woven through banking tilts, a preen, pigeon struts and pecks so the
  // wings never just open-and-close monotonously. Varied holds keep the rhythm alive too.
  BIRD: [
    { p: 'BIRD_UP', beats: 1, hold: 0.18, snap: true }, { p: 'BIRD_TILT_R', beats: 1, hold: 0.26, snap: true },
    { p: 'BIRD_PECK_R', beats: 1, hold: 0.28, snap: true }, { p: 'BIRD_STRUT_R', beats: 1, hold: 0.3, snap: true },
    { p: 'BIRD_TILT_L', beats: 1, hold: 0.26, snap: true }, { p: 'BIRD_PREEN_R', beats: 1, hold: 0.36, snap: true },
    { p: 'BIRD_DOWN', beats: 1, hold: 0.2, snap: true }, { p: 'BIRD_STRUT_L', beats: 1, hold: 0.3, snap: true },
    { p: 'BIRD_TILT_R', beats: 1, hold: 0.26, snap: true }, { p: 'BIRD_PECK_L', beats: 1, hold: 0.28, snap: true },
    { p: 'BIRD_TILT_L', beats: 1, hold: 0.26, snap: true }, { p: 'BIRD_PREEN_L', beats: 1, hold: 0.36, snap: true },
  ],
  // Tango: hold the LINE (2-beat drama) → sharp BOLEO flick → deep CORTE hold → OCHO pivot.
  TANGO: [
    { p: 'TANGO_FRAME_R', beats: 2, hold: 0.6, snap: true }, { p: 'TANGO_BOLEO_R', beats: 1, hold: 0.25, snap: true },
    { p: 'TANGO_CORTE_R', beats: 2, hold: 0.6, snap: true }, { p: 'TANGO_OCHO_R', beats: 1, hold: 0.3, snap: true },
    { p: 'TANGO_FRAME_L', beats: 2, hold: 0.6, snap: true }, { p: 'TANGO_BOLEO_L', beats: 1, hold: 0.25, snap: true },
    { p: 'TANGO_CORTE_L', beats: 2, hold: 0.6, snap: true }, { p: 'TANGO_OCHO_L', beats: 1, hold: 0.3, snap: true },
  ],
  // === *_SHOW: showcase phrases that inject each style's RARE pose (held long) among its
  // normal vocabulary. Listed alongside the normal phrase in MODE_FAVORED, so the choreo
  // alternates normal ↔ showcase and the rare pose surfaces only occasionally. ===
  CHARLESTON_SHOW: [
    { p: 'CHARLESTON_KICK_R', beats: 1, hold: 0.3, snap: true }, { p: 'CHARLESTON_BACK_R', beats: 1, hold: 0.3, snap: true },
    { p: 'CHARLESTON_FAN_R', beats: 2, hold: 0.45, snap: true }, { p: 'CHARLESTON_KICK_L', beats: 1, hold: 0.3, snap: true },
    { p: 'CHARLESTON_BACK_L', beats: 1, hold: 0.3, snap: true }, { p: 'CHARLESTON_FAN_L', beats: 2, hold: 0.45, snap: true },
  ],
  TRAIN_SHOW: [
    { p: 'TRAIN_CHUG_R', beats: 1, hold: 0.22, snap: true }, { p: 'TRAIN_CHUG_L', beats: 1, hold: 0.22, snap: true },
    { p: 'TRAIN_EXPRESS', beats: 2, hold: 0.5, snap: true }, { p: 'TRAIN_CHUG_R', beats: 1, hold: 0.22, snap: true },
    { p: 'TRAIN_CHUG_L', beats: 1, hold: 0.22, snap: true }, { p: 'TRAIN_WHISTLE', beats: 1, hold: 0.32, snap: true },
  ],
  BIRD_SHOW: [
    { p: 'BIRD_TILT_R', beats: 1, hold: 0.26, snap: true }, { p: 'BIRD_PECK_R', beats: 1, hold: 0.28, snap: true },
    { p: 'BIRD_SOAR', beats: 2, hold: 0.55, snap: true }, { p: 'BIRD_STRUT_L', beats: 1, hold: 0.3, snap: true },
    { p: 'BIRD_TILT_L', beats: 1, hold: 0.26, snap: true }, { p: 'BIRD_PREEN_R', beats: 1, hold: 0.36, snap: true },
  ],
  TANGO_SHOW: [
    { p: 'TANGO_FRAME_R', beats: 2, hold: 0.6, snap: true }, { p: 'TANGO_BOLEO_R', beats: 1, hold: 0.25, snap: true },
    { p: 'TANGO_DIP_R', beats: 2, hold: 0.7, snap: true }, { p: 'TANGO_OCHO_R', beats: 1, hold: 0.3, snap: true },
    { p: 'TANGO_CORTE_R', beats: 2, hold: 0.6, snap: true },
  ],
  // Robot: rigid isolations — arms, march step, scan — with dead-stop holds.
  ROBOT: [
    { p: 'ROBOT_ARMS_R', beats: 1, hold: 0.5, snap: true }, { p: 'ROBOT_SCAN', beats: 1, hold: 0.45, snap: true },
    { p: 'ROBOT_STEP_R', beats: 1, hold: 0.4, snap: true }, { p: 'ROBOT_ARMS_L', beats: 1, hold: 0.5, snap: true },
    { p: 'ROBOT_SCAN_L', beats: 1, hold: 0.45, snap: true }, { p: 'ROBOT_STEP_L', beats: 1, hold: 0.4, snap: true },
  ],
  ROBOT_SHOW: [
    { p: 'ROBOT_ARMS_R', beats: 1, hold: 0.4, snap: true }, { p: 'ROBOT_TIP_R', beats: 3, hold: 0.8, snap: true },
    { p: 'ROBOT_ARMS_R', beats: 1, hold: 0.4, snap: true }, { p: 'ROBOT_SCAN', beats: 1, hold: 0.4, snap: true },
    { p: 'ROBOT_TIP_L', beats: 3, hold: 0.8, snap: true }, { p: 'ROBOT_ARMS_L', beats: 1, hold: 0.4, snap: true },
  ],
  // Robot rare #2: strings-cut full-split collapse → freeze → yanked back upright.
  ROBOT_PUPPET: [
    { p: 'ROBOT_ARMS_R', beats: 1, hold: 0.4, snap: true }, { p: 'PUPPET_CUT', beats: 3, hold: 0.85, snap: true },
    { p: 'ROBOT_ARMS_R', beats: 1, hold: 0.4, snap: true }, { p: 'ROBOT_SCAN', beats: 1, hold: 0.4, snap: true },
  ],
  COIL_PH: [
    { p: 'COIL_R', beats: 1, hold: 0.3, snap: true }, { p: 'FOLD_THROUGH_R', beats: 1, hold: 0.25, snap: true },
    { p: 'COIL_L', beats: 1, hold: 0.3, snap: true }, { p: 'FOLD_THROUGH_L', beats: 1, hold: 0.25, snap: true },
  ],
  CONTORT: [
    { p: 'CONTORT_R', beats: 2, hold: 0.5, snap: true }, { p: 'DEEP_PLIE', beats: 1, hold: 0.4, snap: true },
    { p: 'CONTORT_L', beats: 2, hold: 0.5, snap: true }, { p: 'DEEP_PLIE', beats: 1, hold: 0.4, snap: true },
  ],
  // --- AIRBORNE leap phrases: plié wind-up → leap (snap = the arm fling) →
  // plié landing. The lift spring's slight overshoot makes rise→hang→land read
  // organic. Alternates the leading side so a crowd never leaps in lock-step. ---
  LEAP_JETE: [
    { p: 'LEAP_PREP', beats: 1, hold: 0.4 }, { p: 'JETE_R', beats: 1, hold: 0.3, snap: true },
    { p: 'LEAP_PREP', beats: 1, hold: 0.4 }, { p: 'JETE_L', beats: 1, hold: 0.3, snap: true },
  ],
  LEAP_STAG: [
    { p: 'LEAP_PREP', beats: 1, hold: 0.4 }, { p: 'STAG_R', beats: 1, hold: 0.3, snap: true },
    { p: 'LEAP_PREP', beats: 1, hold: 0.4 }, { p: 'STAG_L', beats: 1, hold: 0.3, snap: true },
  ],
  LEAP_KICK: [
    { p: 'LEAP_PREP', beats: 1, hold: 0.3 }, { p: 'KICK_AIR_R', beats: 1, hold: 0.3, snap: true },
    { p: 'WEIGHT_R', beats: 1, hold: 0.3 }, { p: 'KICK_AIR_L', beats: 1, hold: 0.3, snap: true },
  ],
  LEAP_MIX: [
    { p: 'LEAP_PREP', beats: 1, hold: 0.4 }, { p: 'JETE_R', beats: 1, hold: 0.3, snap: true },
    { p: 'LEAP_PREP', beats: 1, hold: 0.35 }, { p: 'STRADDLE_AIR', beats: 1, hold: 0.3, snap: true },
    { p: 'LEAP_PREP', beats: 1, hold: 0.4 }, { p: 'TUCK_AIR', beats: 1, hold: 0.3, snap: true },
    { p: 'LEAP_PREP', beats: 1, hold: 0.35 }, { p: 'ARAB_LEAP_R', beats: 1, hold: 0.3, snap: true },
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
// Leaps are gated by tempo here (none at slow, occasional at mid, frequent at
// fast) AND by loudness via poseAmp scaling lift — so a quiet or slow passage
// stays grounded and only strong/fast energy takes flight.
const BAND_POOL = {
  slow: ['GROOVE', 'TWIST', 'TURN', 'STAB', 'TUT', 'FLOW', 'CHARLESTON', 'TANGO'],
  mid: ['GROOVE', 'TWIST', 'TURN', 'STEP', 'STAB', 'LOCK', 'TUT', 'WAACK', 'FLOW', 'LEAP_JETE', 'LEAP_MIX', 'CHARLESTON', 'TRAIN', 'BIRD', 'TANGO', 'ROBOT'],
  fast: ['GROOVE', 'STEP', 'STAB', 'LOCK', 'WAACK', 'LEAP_JETE', 'LEAP_STAG', 'LEAP_KICK', 'LEAP_MIX', 'TRAIN', 'BIRD'],
};

export function phrasesForBand(band, modeFavored) {
  const base = BAND_POOL[band] || BAND_POOL.mid;
  if (modeFavored && modeFavored.length) {
    const inter = base.filter((id) => modeFavored.includes(id));
    return inter.length ? inter : modeFavored;
  }
  return base;
}
