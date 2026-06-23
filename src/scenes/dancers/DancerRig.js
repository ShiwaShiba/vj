import { TWO_PI } from '../../lib/math.js';
import { Choreographer } from './Choreographer.js';
import { groove } from './groove.js';
import { applyCouplings } from './couplings.js';

// Kraftwerk-style mannequin with a real articulated rig: a flexible multi-node
// SPINE, SCAPULA (shoulders that lift/protract), and HIP joints (thighs swing
// from the socket, pelvis rolls with the weight shift). Drawn as thin rods +
// ball-joints, an outlined trapezoid torso, a round head. Proportions are a
// fraction of total height H.
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
const LEG_REACH = PROP.thigh + PROP.shin;
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

// Elbow flex -> forearm/hand DEPTH fold. The forearm used to share the upper
// arm's depth (armR), so a bent elbow only swung in-plane and read flat from the
// front. EL_CURL converts elbow flex (beyond the ~0.15 straight value) into a
// forward depth offset so a fold comes toward the camera = a real 3D bend in
// front/3-4 views. Side view stays correct because the global camera rotates the
// +z contribution into screen-x. Tunable per rig via `this.elCurl`.
const EL_CURL = 0.55;

export class DancerRig {
  constructor(x, groundY, H, seed = 1) {
    this.x = x; this.groundY = groundY; this.H = H; this.seed = seed;
    this.L = {
      sink: 0, swayX: 0, pelYaw: 0, lean: 0, lateralBend: 0, shYaw: 0, raise: 0.28,
      armR: 0, armL: 0, elR: 0.5, elL: 0.5, wrR: 0, wrL: 0,
      hipR: 0, hipL: 0, kneeR: 0.2, kneeL: 0.2, head: 0, headYaw: 0, stance: 0,
    };
    this.choreo = new Choreographer(seed);
    this.spine = SPINE;      // spine bend weights (tunable per rig)
    this.elCurl = EL_CURL;   // elbow depth-fold strength (tunable per rig)
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

  draw(ctx, color, camYaw = 0, camPitch = 0, alpha = 1) {
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
    const lb = L.lateralBend, ln = L.lean, W = this.spine;
    const s1 = A(root, Math.PI + cl(lb * W.latW[0]), cl(ln * W.leanW[0]), PROP.waist * H);
    const s2 = A(s1, Math.PI + cl(lb * W.latW[1]), cl(ln * W.leanW[1]), PROP.torsoH * 0.34 * H);
    const s3 = A(s2, Math.PI + cl(lb * W.latW[2]), cl(ln * W.leanW[2]), PROP.torsoH * 0.33 * H);
    const chestC = A(s3, Math.PI + cl(lb * W.latW[3]), cl(ln * W.leanW[3]), PROP.torsoH * 0.33 * H);
    const neckLb = cl(lb * W.neckLatK), neckLn = cl(ln * W.neckLeanK);
    const neckTop = A(chestC, Math.PI + neckLb, neckLn, PROP.neck * H);
    const headC = A(neckTop, Math.PI + neckLb + L.headYaw, neckLn + L.head, PROP.head * H);

    // --- SCAPULA: shoulders lift (shrug) + protract (forward) with the arm ---
    const liftR = (L.raise * 0.10 + Math.max(0, L.armR) * 0.10) * H;
    const liftL = (L.raise * 0.10 + Math.max(0, L.armL) * 0.10) * H;
    const shR = [chestC[0] + PROP.shoulderHalf * H, chestC[1] - liftR, chestC[2] + L.armR * 0.10 * H];
    const shL = [chestC[0] - PROP.shoulderHalf * H, chestC[1] - liftL, chestC[2] + L.armL * 0.10 * H];
    const wsR = [s1[0] + PROP.waistHalf * H, s1[1], s1[2]];
    const wsL = [s1[0] - PROP.waistHalf * H, s1[1], s1[2]];

    // Elbow flex folds the forearm + hand FORWARD in depth so a bent elbow reads
    // as a real 3D fold (front/3-4), not a flat in-plane swing. cd() keeps an
    // over-folded elbow from flipping past the upper arm.
    const cd2 = (v) => (v < -1.4 ? -1.4 : v > 1.4 ? 1.4 : v);
    const curlR = Math.max(0, L.elR - 0.15) * this.elCurl;
    const curlL = Math.max(0, L.elL - 0.15) * this.elCurl;
    const fdR = cd2(L.armR + curlR), fdL = cd2(L.armL + curlL);
    const elR = A(shR, L.raise, L.armR, PROP.upperArm * H);
    const wrR = A(elR, L.raise + L.elR, fdR, PROP.foreArm * H);
    const haR = A(wrR, L.raise + L.elR + L.wrR, fdR, PROP.hand * H);
    const elL = A(shL, -L.raise, L.armL, PROP.upperArm * H);
    const wrL = A(elL, -(L.raise + L.elL), fdL, PROP.foreArm * H);
    const haL = A(wrL, -(L.raise + L.elL + L.wrL), fdL, PROP.hand * H);

    // --- PELVIS + LEGS: pelvis rolls with weight; thighs swing from the hip ---
    const roll = L.swayX * 0.6;
    const hipR = [PROP.pelvisHalf * H, roll * H, 0];
    const hipL = [-PROP.pelvisHalf * H, -roll * H, 0];
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
    const PshR = P(shR, yU), PshL = P(shL, yU), PwsR = P(wsR, ys1), PwsL = P(wsL, ys1);
    const PelR = P(elR, yU), PwrR = P(wrR, yU), PhaR = P(haR, yU);
    const PelL = P(elL, yU), PwrL = P(wrL, yU), PhaL = P(haL, yU);
    const PhipR = P(hipR, yLp), PhipL = P(hipL, yLp);
    const PknR = P(knR, yLp), PanR = P(anR, yLp), PftR = P(ftR, yLp);
    const PknL = P(knL, yLp), PanL = P(anL, yLp), PftL = P(ftL, yLp);

    // Feet stay planted (no horizontal figure translation) so they never skate;
    // the weight shift reads from pelvis ROLL (below), the contrapposto knee split,
    // the lateral spine bend and the shoulder/pelvis counter-rotation. A small
    // sway-driven drift keeps it alive without sliding the whole body off its feet.
    const hx = this.x + L.swayX * H * 0.12;
    const hy = this.groundY - LEG_REACH * H + L.sink * H;

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
    // Pelvis bar (separate part).
    this._rod(ctx, PhipL, PhipR, rod * 1.5);
    // Spine chain (root -> s1 -> s2 -> s3 -> chest), curved & twisting.
    this._rod(ctx, Proot, Ps1, rod); this._rod(ctx, Ps1, Ps2, rod);
    this._rod(ctx, Ps2, Ps3, rod); this._rod(ctx, Ps3, PchestC, rod);
    // Arms.
    this._rod(ctx, PshR, PelR, rod); this._rod(ctx, PelR, PwrR, rod);
    this._rod(ctx, PshL, PelL, rod); this._rod(ctx, PelL, PwrL, rod);
    // Hand blades (wrist -> hand): a short flat paddle so wrist cock reads.
    this._rod(ctx, PwrR, PhaR, rod * 1.15); this._rod(ctx, PwrL, PhaL, rod * 1.15);
    this._rod(ctx, PchestC, PneckTop, rod);

    // Torso trapezoid (shoulders -> waist).
    ctx.lineWidth = rod;
    ctx.beginPath();
    ctx.moveTo(PshL[0], PshL[1]); ctx.lineTo(PshR[0], PshR[1]);
    ctx.lineTo(PwsR[0], PwsR[1]); ctx.lineTo(PwsL[0], PwsL[1]);
    ctx.closePath(); ctx.stroke();

    for (const j of [PshR, PshL, PelR, PelL, PwrR, PwrL, PhipR, PhipL, PknR, PknL, PanR, PanL, Ps1, Ps2, Ps3, PneckTop]) this._joint(ctx, j, jr);
    this._joint(ctx, PhaR, jr * 0.9); this._joint(ctx, PhaL, jr * 0.9);

    ctx.beginPath();
    ctx.arc(PheadC[0], PheadC[1], PROP.head * H * PheadC[2], 0, TWO_PI);
    ctx.fill();

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
