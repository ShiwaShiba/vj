import { TWO_PI } from '../../lib/math.js';
import { Choreographer } from './Choreographer.js';
import { groove } from './groove.js';
import { applyCouplings } from './couplings.js';

// Kraftwerk-style mannequin with a real articulated rig: a flexible multi-node
// SPINE, SCAPULA (shoulders that lift/protract), and HIP joints (thighs swing
// from the socket, pelvis rolls with the weight shift). Drawn as thin rods +
// ball-joints, an outlined trapezoid torso, a round head. Proportions are a
// fraction of total height H.
// Pictogram proportions (the original Kraftwerk mannequin — UNCHANGED so the
// existing rod look + its tuned hinge/twist behaviour is preserved exactly).
const PROP = {
  pelvisHalf: 0.085,
  waist: 0.07,
  torsoH: 0.26,      // split across two spine segments
  shoulderHalf: 0.115,
  waistHalf: 0.06,
  neck: 0.10,
  head: 0.072,
  upperArm: 0.16, foreArm: 0.14, hand: 0.085,
  thigh: 0.21, shin: 0.19, foot: 0.07,
  rod: 0.020,
  joint: 0.028,
};
// Graphic (brush-croquis) proportions: elongated limbs, small egg head, slim
// torso — a dancer's body. Used ONLY by the graphic renderer; sloping shoulders
// (なで肩) come from shDropK in _skeleton. Same DOF rig, different lengths.
const PROP_GFX = {
  pelvisHalf: 0.070,
  waist: 0.085,
  torsoH: 0.28,
  shoulderHalf: 0.100,
  waistHalf: 0.05,
  neck: 0.068,
  head: 0.058,
  upperArm: 0.205, foreArm: 0.185, hand: 0.10,
  thigh: 0.27, shin: 0.255, foot: 0.085,
  rod: 0.020,
  joint: 0.028,
};
const SH_DROP_GFX = 0.5;   // なで肩 shoulder-drop factor for graphic (0 = level/pictogram)
const LEAN_DEPTH = 0.6;    // damping on lean's forward depth-fold (flat trunk can't go fully edge-on)
const FOCAL = 4.5;
const lerp = (a, b, t) => a + (b - a) * t;

// Per-node spine bend weights (s1, s2, s3, chest), applied to lateralBend
// (azimuth / side-bend) and lean (forward fold). The chest weight is NEGATIVE
// for lateral so the upper torso curls back the other way — a real S-curve /
// counterpoise rather than a stiff C. Lean eases off at the chest so a deep
// contract folds the lower back without face-planting the chest. Neck/head
// inherit only a fraction so the head clears the shoulders on a deep fold.
const SPINE = {
  latW: [0.5, 1.1, 1.5, 0.82],
  leanW: [0.52, 1.05, 1.32, 0.5],
  neckLatK: -0.18, neckLeanK: 0.5,
};

// Elbow = a real HINGE. The forearm used to be built as upper-arm azimuth + elR,
// so flexing only swung the forearm OUTWARD in the frontal plane (abduction) — a
// bent elbow fanned the hand out beside the torso instead of folding it forward
// and up toward the body (the "ヒラヒラ" flutter). Now elbow flex rotates the
// forearm about a hinge axis ⟂ the upper arm, carrying it ANTERIORLY (+z, toward
// camera) then up toward the shoulder/chest = anatomical flexion. The hinge axis
// is derived per-frame from the live upper-arm direction so it folds correctly in
// any shoulder position and from any camera view.
//   EL_STRAIGHT — elR below this reads as a straight (extended/punch/reach) arm.
//   EL_FLEX     — radians of fold per unit flex; ~2.4 → elR≈0.95 folds ~90°.
//   WR_FOLD     — wrist break: continues the curl by a fraction of the cock value.
const EL_STRAIGHT = 0.28;
const EL_FLEX = 2.4;
const WR_FOLD = 0.6;

// Vector helpers for the hinge: a unit direction from (azimuth, depth) matching A()'s
// convention, and walking a point along a direction by a length.
const dir = (az, dep) => { const cd = Math.cos(dep); return [Math.sin(az) * cd, Math.cos(az) * cd, Math.sin(dep)]; };
const vadd = (p, d, len) => [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];

// Fold unit direction `u` by `ang` (radians, >=0) about the hinge axis ⟂u that
// carries u toward +z (anterior). Rodrigues rotation; the axis is cross(u, +z),
// with a lateral fallback when u is parallel to z (degenerate hinge).
function foldHinge(u, ang) {
  if (ang <= 0) return u;
  let kx = u[1], ky = -u[0], kz = 0;          // cross(u, [0,0,1])
  let m = Math.hypot(kx, ky, kz);
  if (m < 1e-4) { kx = 1; ky = 0; kz = 0; m = 1; } // u ∥ z → hinge sideways
  kx /= m; ky /= m; kz /= m;
  const c = Math.cos(ang), s = Math.sin(ang);
  const kdu = kx * u[0] + ky * u[1] + kz * u[2];   // ~0 (k⟂u); kept for correctness
  const cx = ky * u[2] - kz * u[1], cy = kz * u[0] - kx * u[2], cz = kx * u[1] - ky * u[0];
  return [
    u[0] * c + cx * s + kx * kdu * (1 - c),
    u[1] * c + cy * s + ky * kdu * (1 - c),
    u[2] * c + cz * s + kz * kdu * (1 - c),
  ];
}

export class DancerRig {
  constructor(x, groundY, H, seed = 1) {
    this.x = x; this.groundY = groundY; this.H = H; this.seed = seed;
    this.L = {
      sink: 0, swayX: 0, pelYaw: 0, lean: 0, lateralBend: 0, shYaw: 0, raise: 0.28,
      armR: 0, armL: 0, elR: 0.5, elL: 0.5, wrR: 0, wrL: 0,
      hipR: 0, hipL: 0, kneeR: 0.2, kneeL: 0.2, head: 0, headYaw: 0, stance: 0, lift: 0,
    };
    this.style = 0;          // 0 = pictogram rods, 1 = brush-croquis graphic (set by scene)
    this.choreo = new Choreographer(seed);
    this.spine = SPINE;      // spine bend weights (tunable per rig)
    this.elFlex = EL_FLEX;   // elbow hinge fold strength, radians/flex (tunable per rig)
    // Pelvis / leg-root placement (× pelvisHalf), tunable per rig for visual fitting. Legs
    // descend from near the pelvis's WIDEST point (greater trochanter) so the outer thigh
    // continues the hip edge — no "shelf" where the iliac flares wider than the leg attaches.
    this.sockIn = 0.82;      // hip-socket lateral position = leg root width
    this.sockDown = 0.50;    // hip-socket drop below the iliac crest
    this.pubDrop = 0.72;     // pubic point depth below root
    this.iliacW = 0.95;      // iliac crest width
    this._g = {};            // reused groove output
    this._wSign = -1;        // weighted side (pre-groove), with hysteresis
  }

  // ctrl = { dt, beatsF, beatHold, poseAmp, weightAmp, bounceImpulse, band,
  //          bpmScale, drop, modeFavored, micro }
  update(dt, ctrl) {
    // Layer A — advance the pose clock and step the springs.
    this.choreo.update(ctrl);
    const s = this.choreo.bank.read();

    // Pick the weighted side from the PRE-groove (pose/spring) swayX, with a
    // hysteresis band so the groove oscillation can't flip the legs mid-hold.
    if (s.swayX < -0.15) this._wSign = -1;
    else if (s.swayX > 0.15) this._wSign = 1;

    // Layer B — groove added on top.
    const g = groove(ctrl.beatsF, ctrl.bounceImpulse, ctrl.beatHold, ctrl.weightAmp, this._g);

    const L = this.L;
    for (const k in s) L[k] = s[k];
    // Genre stance floor: open the thighs to the genre's base plié width (Krump
    // stomp / House footwork wide; Vogue / Popping narrow). Added on top of the
    // pose's own stance, clamped so it can't fan the legs past a crouch.
    const sb = ctrl.stanceBias || 0;
    if (sb) { const st = L.stance + sb; L.stance = st > 0.6 ? 0.6 : st; }
    L.sink += g.sink;
    L.swayX += g.swayX;
    L.pelYaw += g.pelYaw;
    L.shYaw += g.shYaw;
    L.head += g.head;
    // Spine undulation: the torso never sits as a rigid plank through a hold.
    L.lateralBend += g.lateralBend;
    L.lean += g.lean;
    // Micro articulation: distal joints keep styling through a held pose. The
    // pose-driven wrist is scaled up so hand gestures read at a distance.
    L.wrR = L.wrR * 1.35 + g.wrR; L.wrL = L.wrL * 1.35 + g.wrL;
    L.elR += g.elR; L.elL += g.elL;
    L.headYaw += g.headYaw;
    if (this._wSign < 0) L.kneeR += g.kneeFreeBob; else L.kneeL += g.kneeFreeBob; // free leg only

    // Tiny treble micro-accents (already gated/clamped upstream).
    const micro = ctrl.micro || 0;
    if (micro) {
      L.head += micro;
      L.headYaw += micro * 0.5;
      L.wrR += micro;
      L.wrL -= micro;
    }

    // Couplings (knee bounce dip on the free leg). Scapula stays in draw().
    applyCouplings(L, this._wSign, ctrl.bounceImpulse);
  }

  // Render style: 0 = pictogram rods (original), 1 = brush-croquis graphic. Set
  // per-rig by the scene. Each style uses its own proportions + renderer; the
  // (camYaw,camPitch,PROP,shDropK) skeleton is shared. The PROP parameter SHADOWS
  // the module pictogram PROP inside _skeleton, so the geometry rescales to the
  // active proportion set with no other change.
  draw(ctx, color, camYaw = 0, camPitch = 0, alpha = 1) {
    if (this.style === 1) {
      const sk = this._skeleton(camYaw, camPitch, PROP_GFX, SH_DROP_GFX);
      return this._renderBrush(ctx, color, sk, alpha);
    }
    const sk = this._skeleton(camYaw, camPitch, PROP, 0);
    return this._renderRods(ctx, color, sk, alpha);
  }

  _skeleton(camYaw, camPitch, PROP, shDropK) {
    const H = this.H, L = this.L;
    const A = (p, ang, dep, len) => {
      const cd = Math.cos(dep);
      return [p[0] + Math.sin(ang) * cd * len, p[1] + Math.cos(ang) * cd * len, p[2] + Math.sin(dep) * len];
    };

    // --- SPINE: flexible chain. lateralBend curves it sideways (azimuth / screen-x),
    // lean folds it FORWARD into depth (dep) — the two are orthogonal and stack into
    // a real C/S curve. Clamped so extreme poses can't over-shorten or flip a segment.
    const cl = (v) => (v < -0.9 ? -0.9 : v > 0.9 ? 0.9 : v);
    const root = [0, 0, 0];
    // 4-segment spine: the lumbar/thoracic build a deep C with lateralBend/lean;
    // the chest segment COUNTER-bends (-cTop*) so the torso curls back into an S
    // and a deep fold doesn't face-plant. Neck/head inherit only a FRACTION of the
    // chest bend (anti-crowd) so the head clears the shoulders on a deep contract.
    // lean folds the spine into DEPTH (+z). The trunk lobes are flat coronal sheets, so a
    // deep fold rotated toward edge-on (side / 3-4 camera) collapses to a thin sliver — the
    // "pelvis stretches" artifact. Damp the depth fold so the trunk keeps on-screen width
    // from those angles while still reading as a forward lean.
    const lb = L.lateralBend, ln = L.lean * LEAN_DEPTH, W = this.spine;
    const s1 = A(root, Math.PI + cl(lb * W.latW[0]), cl(ln * W.leanW[0]), PROP.waist * H);
    const s2 = A(s1, Math.PI + cl(lb * W.latW[1]), cl(ln * W.leanW[1]), PROP.torsoH * 0.34 * H);
    const s3 = A(s2, Math.PI + cl(lb * W.latW[2]), cl(ln * W.leanW[2]), PROP.torsoH * 0.33 * H);
    const chestC = A(s3, Math.PI + cl(lb * W.latW[3]), cl(ln * W.leanW[3]), PROP.torsoH * 0.33 * H);
    const neckLb = cl(lb * W.neckLatK), neckLn = cl(ln * W.neckLeanK);
    const neckTop = A(chestC, Math.PI + neckLb, neckLn, PROP.neck * H);
    const headC = A(neckTop, Math.PI + neckLb + L.headYaw, neckLn + L.head, PROP.head * H);

    // --- SCAPULA (scapulohumeral rhythm): the shoulder point (ACROMION) is NOT a
    // fixed bracket on the chest — it rides an ARC about the sternoclavicular joint
    // (≈ chestC, the neck base) as the scapula UPWARDLY ROTATES with arm elevation.
    // Anatomy: total arm elevation is ~1/3 scapular travel + ~2/3 glenohumeral, so
    // the socket itself climbs up-and-inward by (raise·SCAP_K) while the upper arm
    // swings only GH_FRAC of `raise` from that TRAVELLING socket (see uR/uL below).
    // なで肩 lives in the REST acromion (arm down = out + dropped by shDrop); raising
    // the arm rotates that rest vector up toward the ear — unifying なで肩 (rest) and
    // the drive (motion) in one structure. armR/L depth PROTRACTS (slides forward).
    const shDrop = PROP.shoulderHalf * shDropK * H;
    const RAISE0 = 0.22;    // baseline elevation below which the scapula stays neutral (preserves なで肩 idle)
    const SCAP_K = 0.5;     // scapular upward-rotation gain (rad per unit raise above RAISE0)
    const GH_FRAC = 0.7;    // glenohumeral share of frontal elevation (the rest is the scapula's)
    const PROTRACT = 0.12;  // forward slide of the acromion per unit arm depth
    const acromion = (sg, armV) => {
      const phi = Math.max(0, L.raise - RAISE0) * SCAP_K;   // scapular upward rotation
      const cs = Math.cos(phi), sn = Math.sin(phi);
      const x0 = sg * PROP.shoulderHalf * H, y0 = shDrop;   // rest acromion: out + なで肩 drop
      // rotate the rest vector up about chestC (sg flips handedness; -y = up)
      const x = x0 * cs + sg * y0 * sn;
      const y = -sg * x0 * sn + y0 * cs;
      return [chestC[0] + x, chestC[1] + y, chestC[2] + armV * PROTRACT * H];
    };
    const shR = acromion(1, L.armR);
    const shL = acromion(-1, L.armL);
    // WAIST: the trunk pinches into a narrow くびれ that DIVIDES the thorax (above) from
    // the pelvis (below). Two stacked waist rings a short span apart — an upper RIB ring
    // and a lower PELVIS ring — let the thorax rotate with the chest twist (ys3) and the
    // pelvis with the pelvis twist (ys1), so the short waist band between them SHEARS like
    // a wrung towel on counter-rotation, instead of one fused slab merely skewing. Pinched
    // narrow so the division — and the twist — reads.
    // Anterior PELVIC TILT (hip hinge): the pelvis tips forward WITH the lean so the trunk
    // folds as one piece instead of leaving a stretched gap between a leaned rib cage and a
    // static pelvis. Applied to every pelvis-anchored point (rotation about root's x-axis),
    // including the hip sockets — so the legs hinge with the pelvis, as in a real forward bow.
    const pelTilt = -ln * 0.55;
    const ctp = Math.cos(pelTilt), stp = Math.sin(pelTilt);
    const tilt = (q) => [q[0], q[1] * ctp - q[2] * stp, q[1] * stp + q[2] * ctp];
    const waistHi = [lerp(s1[0], s2[0], 0.30), lerp(s1[1], s2[1], 0.30), lerp(s1[2], s2[2], 0.30)];
    const rwHalf = PROP.waistHalf * 0.70 * H, wsHalf = PROP.waistHalf * 0.80 * H;
    const rwR = [waistHi[0] + rwHalf, waistHi[1], waistHi[2]];   // rib (upper) waist — on the spine, LEANS
    const rwL = [waistHi[0] - rwHalf, waistHi[1], waistHi[2]];
    // PELVIS waist = TOP of the pelvis girdle, anchored to the PELVIS (no spine lean) so the
    // pelvis stays a compact rigid mass; it follows the lean only via the pelvic tilt above,
    // so the short waist-core band between rib and pelvis flexes (= the lumbar) without the
    // pelvis bones elongating into a long thin spike.
    const wsR = tilt([wsHalf, -PROP.waist * H, 0]);
    const wsL = tilt([-wsHalf, -PROP.waist * H, 0]);

    // The shoulder sets the upper-arm direction (raise = elevation in the frontal
    // plane, armR = depth toward camera). The ELBOW then folds the forearm forward
    // and up about a hinge ⟂ the upper arm (foldHinge), so flex brings the hand in
    // FRONT of / up toward the body — never fanning out to the side. The WRIST
    // continues the curl by a fraction of its cock. Left mirrors right: its upper
    // arm uses -raise, and the cross-product hinge folds it anteriorly all the same;
    // wrL is negated so a symmetric pose breaks both wrists symmetrically.
    const uR = dir(L.raise * GH_FRAC, L.armR);
    const uL = dir(-L.raise * GH_FRAC, L.armL);
    const elR = vadd(shR, uR, PROP.upperArm * H);
    const elL = vadd(shL, uL, PROP.upperArm * H);
    const faR = foldHinge(uR, Math.max(0, L.elR - EL_STRAIGHT) * this.elFlex);
    const faL = foldHinge(uL, Math.max(0, L.elL - EL_STRAIGHT) * this.elFlex);
    const wrR = vadd(elR, faR, PROP.foreArm * H);
    const wrL = vadd(elL, faL, PROP.foreArm * H);
    const haR = vadd(wrR, foldHinge(faR, L.wrR * WR_FOLD), PROP.hand * H);
    const haL = vadd(wrL, foldHinge(faL, -L.wrL * WR_FOLD), PROP.hand * H);

    // --- PELVIS + LEGS: pelvis rolls with weight; thighs swing from the hip ---
    // TWO-PART PELVIS: the pelvis is two iliac halves, so each hip socket HIKES with
    // its OWN thigh's forward/upward lift (hip flexion tilts the pelvis toward the
    // working leg) while the spine stays centred at root — a real pelvic tilt, not
    // the whole girdle sliding up. Only positive (forward/up) lift hikes; a trailing
    // leg doesn't drop its hip. Lives in the SHARED skeleton so BOTH the pictogram
    // and the graphic articulate the pelvis as two parts. (-y = up.)
    const roll = L.swayX * 0.6;
    const PEL_HIKE = 0.12;   // subtle pelvic tilt with leg lift; kept low so the pelvis does NOT ride up like an extension of the thigh
    const hikeR = Math.max(0, L.hipR) * PROP.pelvisHalf * PEL_HIKE * H;
    const hikeL = Math.max(0, L.hipL) * PROP.pelvisHalf * PEL_HIKE * H;
    // ILIAC CRESTS: the wide top corners of the pelvis = its silhouette. FIXED pelvis
    // points (they do NOT follow the thigh) so a lifting leg can't drag the pelvis out of
    // shape; each crest hikes with its own side (pelvic tilt).
    const iliR = tilt([PROP.pelvisHalf * this.iliacW * H, roll * H - hikeR, 0]);
    const iliL = tilt([-PROP.pelvisHalf * this.iliacW * H, -roll * H - hikeL, 0]);
    // HIP SOCKETS (acetabula) = the true LEG ROOT: set LOWER and more MEDIAL than the
    // iliac crest (≈ a femoral-head spacing, near pubic level), where the femur hangs. A
    // too-high, too-wide root (socket == crest) is what splayed the leg root and broke the
    // pelvis when the thigh swung up; dropping/narrowing the socket fixes both.
    const sockDown = PROP.pelvisHalf * this.sockDown * H;
    const hipR = tilt([PROP.pelvisHalf * this.sockIn * H, roll * H - hikeR + sockDown, 0]);
    const hipL = tilt([-PROP.pelvisHalf * this.sockIn * H, -roll * H - hikeL + sockDown, 0]);
    // `stance` opens the thighs outward (plié / second position); the splay decays
    // down the chain so the shin returns toward vertical and the foot stays
    // planted-forward = a turned-out crouch, not a fanned-out leg. At stance=0 the
    // azimuths fall back to the original fixed 0.08 (identical to before).
    const splayR = 0.08 + L.stance, splayL = -0.08 - L.stance;
    const knR = A(hipR, splayR, L.hipR, PROP.thigh * H);
    const anR = A(knR, 0.08 + L.stance * 0.5, L.hipR - L.kneeR, PROP.shin * H);
    const ftR = A(anR, 0.08, L.hipR - L.kneeR + 0.95, PROP.foot * H);
    const knL = A(hipL, splayL, L.hipL, PROP.thigh * H);
    const anL = A(knL, -(0.08 + L.stance * 0.5), L.hipL - L.kneeL, PROP.shin * H);
    const ftL = A(anL, -0.08, L.hipL - L.kneeL + 0.95, PROP.foot * H);

    // --- Twist winds up the spine: pelvis (pelYaw) -> chest (shYaw) ---
    const yaw = (p, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c]; };
    const yU = L.shYaw, yLp = L.pelYaw;
    const ys1 = lerp(yLp, yU, 0.22), ys2 = lerp(yLp, yU, 0.50), ys3 = lerp(yLp, yU, 0.78);
    const F = FOCAL * H;
    // Global CAMERA: yaw about the vertical axis + pitch about the horizontal,
    // applied to every point before perspective so the whole figure is seen from
    // the chosen viewpoint (front / 3-4 / side / overhead).
    const ccy = Math.cos(camYaw), scy = Math.sin(camYaw);
    const ccp = Math.cos(camPitch), scp = Math.sin(camPitch);
    const cam = (p) => {
      const x = p[0] * ccy - p[2] * scy;
      const z = p[0] * scy + p[2] * ccy;
      const y = p[1] * ccp - z * scp;
      const z2 = p[1] * scp + z * ccp;
      return [x, y, z2];
    };
    const pr = (p) => { const q = cam(p); const f = F / (F - q[2]); return [q[0] * f, q[1] * f, f]; };
    const P = (p, a) => pr(yaw(p, a));

    const Proot = pr(root);
    const Ps1 = P(s1, ys1), Ps2 = P(s2, ys2), Ps3 = P(s3, ys3), PchestC = P(chestC, yU), PneckTop = P(neckTop, yU), PheadC = P(headC, yU);
    const PshR = P(shR, yU), PshL = P(shL, yU);
    const PwsR = P(wsR, yLp), PwsL = P(wsL, yLp);   // pelvis waist — twists with the pelvis (pelYaw)
    const PrwR = P(rwR, ys3), PrwL = P(rwL, ys3);   // rib waist (chest twist)
    const PelR = P(elR, yU), PwrR = P(wrR, yU), PhaR = P(haR, yU);
    const PelL = P(elL, yU), PwrL = P(wrL, yU), PhaL = P(haL, yU);
    // TENSEGRITY ANCHOR: feet RESIST the pelvis twist so a contrapposto winds up as
    // visible tension — a spiral line from a planted foot through the turning core —
    // instead of the whole lower body swivelling on a lazy-susan (feet used to share
    // pelYaw rigidly). The rotation the pelvis and chest AGREE on (same-sign shared
    // magnitude) is a whole-body TURN, which the feet DO follow; the pelvis twist
    // BEYOND that is shed down the leg (knee 0.55 -> ankle 0.25 -> foot 0 = planted)
    // so the ground stays gripped and the force flows up the chain.
    const turnYaw = Math.sign(yLp) === Math.sign(yU) ? Math.sign(yLp) * Math.min(Math.abs(yLp), Math.abs(yU)) : 0;
    const kneeYaw = lerp(turnYaw, yLp, 0.48), ankYaw = lerp(turnYaw, yLp, 0.18);
    const PhipR = P(hipR, yLp), PhipL = P(hipL, yLp);
    // PUBIC center: a SHALLOW point just below the hip sockets at the body midline
    // (the pubic symphysis where the two pelvic bones meet) — only a soft groin
    // notch, deliberately NOT a deep downward spike (which read as a sacral triangle).
    // The graphic pelvis is built as two iliac halves meeting here (see _renderBrush).
    const pub = tilt([0, PROP.pelvisHalf * this.pubDrop * H, 0]);
    const Ppub = P(pub, yLp);
    const PiliR = P(iliR, yLp), PiliL = P(iliL, yLp);   // iliac crests (pelvis silhouette)
    const PknR = P(knR, kneeYaw), PanR = P(anR, ankYaw), PftR = P(ftR, turnYaw);
    const PknL = P(knL, kneeYaw), PanL = P(anL, ankYaw), PftL = P(ftL, turnYaw);

    // Feet stay planted (no horizontal figure translation) so they never skate;
    // the weight shift reads from pelvis ROLL (below), the contrapposto knee split,
    // the lateral spine bend and the shoulder/pelvis counter-rotation. A small
    // sway-driven drift keeps it alive without sliding the whole body off its feet.
    // AIRBORNE: `lift` raises the whole figure off the ground (jump/leap). With
    // raised-leg poses (tuck/kick/split) the feet leave the floor naturally — the
    // rig has no foot-IK, so a bent/raised knee reads as airborne, not an error.
    const legReach = PROP.thigh + PROP.shin;
    const hx = this.x + L.swayX * H * 0.12;
    const hy = this.groundY - legReach * H + L.sink * H - (L.lift || 0) * H;

    return {
      H, hx, hy,
      Proot, Ps1, Ps2, Ps3, PchestC, PneckTop, PheadC,
      PshR, PshL, PwsR, PwsL, PrwR, PrwL,
      PelR, PwrR, PhaR, PelL, PwrL, PhaL,
      PhipR, PhipL, PiliR, PiliL, Ppub, PknR, PanR, PftR, PknL, PanL, PftL,
    };
  }

  _renderRods(ctx, color, sk, alpha) {
    const H = sk.H;
    const {
      Proot, Ps1, Ps2, Ps3, PchestC, PneckTop, PheadC,
      PshR, PshL, PwsR, PwsL, PrwR, PrwL, PelR, PwrR, PhaR, PelL, PwrL, PhaL,
      PhipR, PhipL, PiliR, PiliL, Ppub, PknR, PanR, PftR, PknL, PanL, PftL, hx, hy,
    } = sk;
    ctx.save();
    ctx.translate(hx, hy);
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const rod = PROP.rod * H;
    const jr = PROP.joint * H;

    // Legs.
    this._rod(ctx, PhipR, PknR, rod); this._rod(ctx, PknR, PanR, rod); this._rod(ctx, PanR, PftR, rod * 1.4);
    this._rod(ctx, PhipL, PknL, rod); this._rod(ctx, PknL, PanL, rod); this._rod(ctx, PanL, PftL, rod * 1.4);
    // Pelvis as TWO parts: each hip socket links to a central pubic joint (an
    // inverted-V girdle), and each socket HIKES with its own thigh (skeleton level)
    // so the two halves tilt independently — the same two-bone pelvis the graphic
    // uses, expressed in rods.
    // Pelvis as ONE compact solid girdle (waist → iliac crest → socket → pub), FILLED —
    // a single clean mass instead of a web of crossing rods. The legs hang from the sockets
    // (drawn above); the socket joints redraw on top so the leg root still reads.
    ctx.beginPath();
    ctx.moveTo(PwsL[0], PwsL[1]); ctx.lineTo(PwsR[0], PwsR[1]);
    ctx.lineTo(PiliR[0], PiliR[1]); ctx.lineTo(PhipR[0], PhipR[1]);
    ctx.lineTo(Ppub[0], Ppub[1]);
    ctx.lineTo(PhipL[0], PhipL[1]); ctx.lineTo(PiliL[0], PiliL[1]);
    ctx.closePath(); ctx.fill();
    // Spine chain (root -> s1 -> s2 -> s3 -> chest), curved & twisting.
    this._rod(ctx, Proot, Ps1, rod); this._rod(ctx, Ps1, Ps2, rod);
    this._rod(ctx, Ps2, Ps3, rod); this._rod(ctx, Ps3, PchestC, rod);
    // Arms.
    this._rod(ctx, PshR, PelR, rod); this._rod(ctx, PelR, PwrR, rod);
    this._rod(ctx, PshL, PelL, rod); this._rod(ctx, PelL, PwrL, rod);
    // Hand blades (wrist -> hand): a short flat paddle so wrist cock reads.
    this._rod(ctx, PwrR, PhaR, rod * 1.15); this._rod(ctx, PwrL, PhaL, rod * 1.15);
    this._rod(ctx, PchestC, PneckTop, rod);

    // Trunk as two masses: THORAX trapezoid (shoulders -> narrow rib waist, chest twist)
    // and a short WAIST-CORE band down to the pelvis waist (pelvis twist) that shears on
    // counter-rotation. The pelvis lobe is the inverted-V girdle below (drawn with the legs).
    ctx.lineWidth = rod;
    ctx.beginPath();
    ctx.moveTo(PshL[0], PshL[1]); ctx.lineTo(PshR[0], PshR[1]);
    ctx.lineTo(PrwR[0], PrwR[1]); ctx.lineTo(PrwL[0], PrwL[1]);
    ctx.closePath(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(PrwL[0], PrwL[1]); ctx.lineTo(PrwR[0], PrwR[1]);
    ctx.lineTo(PwsR[0], PwsR[1]); ctx.lineTo(PwsL[0], PwsL[1]);
    ctx.closePath(); ctx.stroke();

    for (const j of [PshR, PshL, PelR, PelL, PwrR, PwrL, PhipR, PhipL, PknR, PknL, PanR, PanL, Ps1, Ps2, Ps3, PneckTop]) this._joint(ctx, j, jr);
    this._joint(ctx, PhaR, jr * 0.9); this._joint(ctx, PhaL, jr * 0.9);

    ctx.beginPath();
    ctx.arc(PheadC[0], PheadC[1], PROP.head * H * PheadC[2], 0, TWO_PI);
    ctx.fill();

    ctx.restore();
  }

  // ---- PROTOTYPE: brush-croquis renderer (comparison only) -------------------
  // Slim filled tapered strokes over the SAME live joints — each bone thins
  // distally (= croquis line-weight), hands/feet taper to points, small head,
  // slim torso whose top PEAKS at the neck base (chestC) and slopes down to the
  // なで肩 shoulders. Single Path2D, one fill (mono union).
  _renderBrush(ctx, color, sk, alpha) {
    const H = sk.H, p = new Path2D();
    // Sliver half-widths per joint (× H × depth). The leg taper is kept GENTLE and
    // even (thigh only modestly thicker than shin) so a thigh never reads as a wide
    // triangular fin when a raised knee foreshortens it; the shin holds a slim
    // constant width down to the ankle, where a short foot tapers to a pointe.
    const R = { neck: 0.013, ua: 0.024, el: 0.015, fa: 0.014, wr: 0.009, th: 0.027, kn: 0.016, sh: 0.014, an: 0.011 };
    const TIP = 0.0015;
    const seg = (a, b, ra, rb) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, A1 = ra * H * a[2], B1 = rb * H * b[2];
      p.moveTo(a[0] + nx * A1, a[1] + ny * A1);
      p.lineTo(b[0] + nx * B1, b[1] + ny * B1);
      p.lineTo(b[0] - nx * B1, b[1] - ny * B1);
      p.lineTo(a[0] - nx * A1, a[1] - ny * A1);
      p.closePath();
    };
    const blob = (c, r) => { const rr = r * H * c[2]; p.moveTo(c[0] + rr, c[1]); p.arc(c[0], c[1], rr, 0, TWO_PI); };
    // Legs (taper to pointed feet) / arms (taper to pointed hands) / neck.
    seg(sk.PhipR, sk.PknR, R.th, R.kn); seg(sk.PknR, sk.PanR, R.kn, R.sh); seg(sk.PanR, sk.PftR, R.sh, TIP);
    seg(sk.PhipL, sk.PknL, R.th, R.kn); seg(sk.PknL, sk.PanL, R.kn, R.sh); seg(sk.PanL, sk.PftL, R.sh, TIP);
    seg(sk.PshR, sk.PelR, R.ua, R.el); seg(sk.PelR, sk.PwrR, R.el, R.fa); seg(sk.PwrR, sk.PhaR, R.fa, TIP);
    seg(sk.PshL, sk.PelL, R.ua, R.el); seg(sk.PelL, sk.PwrL, R.el, R.fa); seg(sk.PwrL, sk.PhaL, R.fa, TIP);
    seg(sk.PchestC, sk.PneckTop, R.neck, R.neck);
    // Sloping shoulder line: a thin stroke from the neck base down to each shoulder.
    seg(sk.PchestC, sk.PshR, R.neck, R.ua); seg(sk.PchestC, sk.PshL, R.neck, R.ua);
    // Smooth EVERY bending joint so two angled slivers fuse without a notch — this
    // is what kills the "strange" look at a raised/folded knee (and a cocked wrist).
    // Knees/elbows get a slightly fuller blob (kneecap/elbow) to round a sharp fold;
    // ankles & wrists get their own node so the pointed foot/hand reads as a distinct
    // appendage instead of merging into one long spike with the shin/forearm.
    blob(sk.PknR, R.kn * 1.2); blob(sk.PknL, R.kn * 1.2);
    blob(sk.PelR, R.el * 1.15); blob(sk.PelL, R.el * 1.15);
    blob(sk.PanR, R.an); blob(sk.PanL, R.an);
    blob(sk.PwrR, R.wr); blob(sk.PwrL, R.wr);
    blob(sk.PshR, R.ua); blob(sk.PshL, R.ua); blob(sk.PhipR, R.th); blob(sk.PhipL, R.th);
    // TRUNK as TWO masses divided by a narrow waist. THORAX lobe: top PEAKS at the neck
    // base (なで肩 slope) and tapers to the narrow rib waist (PrwR/PrwL, which carry the
    // CHEST twist). A short WAIST-CORE band joins the rib waist to the pelvis waist
    // (PwsR/PwsL, which carry the PELVIS twist); on counter-rotation the two rings rotate
    // oppositely and the band SHEARS into a parallelogram = the body's wring made visible.
    // PELVIS lobe: the pelvis waist flares to the two iliac halves and down to the shallow
    // pubic point (the two-bone pelvis preserved) — NO deep sacral spike.
    p.moveTo(sk.PshL[0], sk.PshL[1]); p.lineTo(sk.PchestC[0], sk.PchestC[1]); p.lineTo(sk.PshR[0], sk.PshR[1]);
    p.lineTo(sk.PrwR[0], sk.PrwR[1]); p.lineTo(sk.PrwL[0], sk.PrwL[1]); p.closePath();
    p.moveTo(sk.PrwL[0], sk.PrwL[1]); p.lineTo(sk.PrwR[0], sk.PrwR[1]);
    p.lineTo(sk.PwsR[0], sk.PwsR[1]); p.lineTo(sk.PwsL[0], sk.PwsL[1]); p.closePath();
    // pelvis waist → out to each iliac CREST (wide, fixed) → in/down to the hip SOCKET
    // (leg root) → pubic center. The crest holds the silhouette; the socket is where the
    // thigh hangs, so a raised leg swings from the socket without dragging the crest.
    p.moveTo(sk.PwsL[0], sk.PwsL[1]); p.lineTo(sk.PwsR[0], sk.PwsR[1]);
    p.lineTo(sk.PiliR[0], sk.PiliR[1]); p.lineTo(sk.PhipR[0], sk.PhipR[1]);
    p.lineTo(sk.Ppub[0], sk.Ppub[1]);
    p.lineTo(sk.PhipL[0], sk.PhipL[1]); p.lineTo(sk.PiliL[0], sk.PiliL[1]); p.closePath();
    // Small egg-shaped head: a slim ellipse whose long axis follows the neck
    // (taller than wide, tilts with the head) — not a perfect circle/sphere.
    const hr = PROP_GFX.head * H * sk.PheadC[2];
    const rx = hr * 0.82, ry = hr * 1.14;
    const ndx = sk.PheadC[0] - sk.PneckTop[0], ndy = sk.PheadC[1] - sk.PneckTop[1];
    const hrot = Math.atan2(ndy, ndx) - Math.PI / 2;   // long axis along the neck
    p.moveTo(sk.PheadC[0] + rx * Math.cos(hrot), sk.PheadC[1] + rx * Math.sin(hrot));
    p.ellipse(sk.PheadC[0], sk.PheadC[1], rx, ry, hrot, 0, TWO_PI);
    ctx.save();
    ctx.translate(sk.hx, sk.hy);
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill(p);
    ctx.restore();
  }

  _rod(ctx, a, b, w) {
    ctx.lineWidth = w * (a[2] + b[2]) * 0.5;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  _joint(ctx, p, r) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], r * p[2], 0, TWO_PI);
    ctx.fill();
  }
}
