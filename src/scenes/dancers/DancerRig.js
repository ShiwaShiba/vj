import { TWO_PI, lerp } from '../../lib/math.js';

// Body proportions as a fraction of total height H.
const PROP = {
  spine: 0.30,
  neck: 0.05,
  head: 0.10, // radius
  shoulderHalf: 0.11,
  hipHalf: 0.075,
  upperArm: 0.17,
  foreArm: 0.16,
  thigh: 0.22,
  shin: 0.22,
  limbThick: 0.07,
};
const LEG_REACH = PROP.thigh + PROP.shin; // straight-leg hip height above ground

// A single procedurally-animated pictogram. Joint angles are sines of the
// beat phase; forward kinematics gives world points; drawn as a filled
// silhouette (thick round-capped strokes = chunky limbs).
export class DancerRig {
  constructor(x, groundY, H) {
    this.x = x;
    this.groundY = groundY;
    this.H = H;
    this.move = null;
    this.prevMove = null;
    this.mix = 1; // 0..1 crossfade from prevMove -> move
    this.mixSpeed = 2; // ~0.5s transition
  }

  setMove(move) {
    if (this.move === move) return;
    this.prevMove = this.move || move;
    this.move = move;
    this.mix = 0;
  }

  update(dt, phase, energy, beatHold) {
    this.phase = phase;
    this.energy = energy;
    this.beatHold = beatHold;
    if (this.mix < 1) this.mix = Math.min(1, this.mix + dt * this.mixSpeed);
  }

  _angles(move, phase, energy) {
    const tp = phase * TWO_PI;
    const q = move.quantize;
    const osc = (o, extraPhase = 0) => {
      let v = Math.sin(o.w * tp + o.p + extraPhase);
      if (q) v = Math.round(v * q) / q;
      return o.b + o.A * energy * v;
    };
    const alt = move.alt ? Math.PI : 0;
    return {
      bob: move.bounce * Math.abs(Math.sin(Math.PI * phase)),
      sway: move.sway * Math.sin(TWO_PI * phase),
      spine: osc(move.spine),
      head: osc(move.head),
      armA: osc(move.arm),
      armB: osc(move.arm, alt),
      elbowA: osc(move.elbow),
      elbowB: osc(move.elbow, alt),
      legA: osc(move.leg),
      legB: osc(move.leg, alt),
      kneeA: osc(move.knee),
      kneeB: osc(move.knee, alt),
    };
  }

  _blend(a, b, t) {
    const o = {};
    for (const k in a) o[k] = lerp(a[k], b[k], t);
    return o;
  }

  _pose() {
    let a = this._angles(this.move, this.phase, this.energy);
    if (this.mix < 1 && this.prevMove) {
      const pa = this._angles(this.prevMove, this.phase, this.energy);
      a = this._blend(pa, a, this.mix);
    }
    const H = this.H;
    const add = (p, ang, len) => [p[0] + Math.sin(ang) * len, p[1] + Math.cos(ang) * len];
    const hip = [0, 0];
    const up = Math.PI + a.spine;
    const chest = add(hip, up, PROP.spine * H);
    const neckDir = up + a.head;
    const headBase = add(chest, neckDir, PROP.neck * H);
    const headC = add(headBase, neckDir, PROP.head * H);
    const shA = [chest[0] + PROP.shoulderHalf * H, chest[1]];
    const shB = [chest[0] - PROP.shoulderHalf * H, chest[1]];
    const elA = add(shA, a.armA, PROP.upperArm * H);
    const haA = add(elA, a.armA + a.elbowA, PROP.foreArm * H);
    const elB = add(shB, -a.armB, PROP.upperArm * H);
    const haB = add(elB, -(a.armB + a.elbowB), PROP.foreArm * H);
    const hiA = [hip[0] + PROP.hipHalf * H, hip[1]];
    const hiB = [hip[0] - PROP.hipHalf * H, hip[1]];
    const knA = add(hiA, a.legA, PROP.thigh * H);
    const ftA = add(knA, a.legA + a.kneeA, PROP.shin * H);
    const knB = add(hiB, -a.legB, PROP.thigh * H);
    const ftB = add(knB, -(a.legB + a.kneeB), PROP.shin * H);
    return { a, hip, chest, headBase, headC, shA, shB, elA, haA, elB, haB, hiA, hiB, knA, ftA, knB, ftB };
  }

  // Flat single-colour silhouette — like signage / a pictogram. `color` is a
  // CSS string (computed once per frame by the scene).
  draw(ctx, color) {
    const P = this._pose();
    const H = this.H;
    const hx = this.x + P.a.sway * H;
    const hy = this.groundY - LEG_REACH * H - P.a.bob * H;
    // squash & stretch around the hip
    const sq = (this.move.squash || 0) * Math.abs(Math.sin(Math.PI * this.phase));
    const pop = this.beatHold * 0.12;
    const sy = 1 - sq + pop;
    const sx = 1 + sq * 0.6 - pop * 0.6;

    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(sx, sy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = PROP.limbThick * H;

    // All one flat colour — overlaps merge into a clean silhouette.
    this._chain(ctx, [P.shB, P.elB, P.haB]);
    this._chain(ctx, [P.hiB, P.knB, P.ftB]);
    this._chain(ctx, [P.shA, P.elA, P.haA]);
    this._chain(ctx, [P.hiA, P.knA, P.ftA]);
    this._chain(ctx, [P.chest, P.headBase]);

    ctx.beginPath();
    ctx.moveTo(P.shA[0], P.shA[1]);
    ctx.lineTo(P.shB[0], P.shB[1]);
    ctx.lineTo(P.hiB[0], P.hiB[1]);
    ctx.lineTo(P.hiA[0], P.hiA[1]);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(P.headC[0], P.headC[1], PROP.head * H, 0, TWO_PI);
    ctx.fill();

    ctx.restore();
  }

  _chain(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
}
