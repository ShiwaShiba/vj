import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';

// 立体フィラメント (session 7 — 抜本リデザイン) — 旧「毛筆スタンプ」を廃し、
// 数万本の髪より細い粒子が 3D 流体場をなぞる「立体マーブル / 煙・銀河」へ。
//   ・各粒子は単位立方体 [-1,1]^3 を 2オクターブの 3D simplex ベクトル場で流れる
//   ・正射影＋緩い回転 → 奥行きのある体積。手前(near)ほど明るく・太く、奥は減光
//   ・低 fade 累積 (trail) で無数の細糸が迷路状マーブルに織り上がる
//   ・depth banding (6段) で per-particle の線幅/濃度を 6 stroke にまとめて高速化
//   ・mono 厳守・additive なし (純インク)・落款や墨にじみ等の旧装飾は撤去
//   ・決定論: 粒子の初期/再投入位置は Math.random ではなくハッシュ seed
//     → operator/output 二画面のミラー一致＆リロード再現性 (invariant 順守)
//
// Modes: Streams = 静かに回る体積 / Swarm = 速く密に渦巻く。
const TILT = 0.40;                 // X軸チルト(rad) — 極を中心から外す
const CT = Math.cos(TILT), ST = Math.sin(TILT);
const BANDS = 6;                   // 奥行き量子化 — 1バンド=1 stroke
const MAXN = 32000;                // Particles スライダー上限ぶん事前確保

export class FlowField extends Scene {
  constructor() {
    super('flowField', 'Flow Field');
    this.trail = 0.07; // 余韻: 細糸が累積してマーブルに織り上がる
    this.modes = [{ name: 'Streams' }, { name: 'Swarm' }];
    this.defineParam('count', 18000, 4000, MAXN, 1000, 'Particles'); // 密度
    this.defineParam('freq', 1.6, 0.6, 3.2, 0.1, 'Field Scale');     // 流路サイズ
    this.defineParam('speed', 0.5, 0.1, 1.5, 0.05, 'Flow Speed');
    this.defineParam('detail', 0.5, 0.0, 1.0, 0.05, 'Detail');       // 2オクターブ混合=毛細管化
    this.defineParam('thread', 0.8, 0.4, 2.0, 0.1, 'Thread');        // 線幅 (小=精緻)
    this.defineParam('rotate', 0.16, -0.5, 0.5, 0.02, 'Rotate');     // 体積の回転速度 (0=静止)
    this.defineParam('react', 2.0, 0, 6, 0.5, 'React');              // 音で流速/濃度
    this.noise = new SimplexNoise(7);
    // 3D 粒子状態 (正規化立方体内)。
    this.X = null; this.Y = null; this.Z = null;
    this.PX = null; this.PY = null; this.PZ = null;
    this.life = null; this.sv = null; this._rc = null;
    // 投影キャッシュ (描画用)。
    this.sax = null; this.say = null; this.sbx = null; this.sby = null;
    this.sband = null; this.svalid = null;
    this.n = 0; this._spin = 0; this.t = 0;
    this.level = 0; this.bass = 0; this.treble = 0;
  }

  init(ctx, w, h) { super.init(ctx, w, h); this._spawn(); }
  onResize(w, h) { super.onResize(w, h); } // 座標は正規化済み — 再生成不要

  // 決定論ハッシュ: 整数 n -> [0,1)。Math.random を使わない (invariant)。
  _h(n) {
    n = (n | 0) ^ 0x9e3779b9;
    n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
    n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
  }
  // 粒子 i を立方体内のハッシュ位置へ (再)投入。rc[i] を進めて毎回別の点に。
  _reseed(i) {
    const r = (this._rc[i] = (this._rc[i] + 1) & 0xffff);
    const k = Math.imul(i * 2 + 1, 0x9e3779b1) ^ Math.imul(r, 0x85ebca6b);
    this.X[i] = this.PX[i] = this._h(k + 1) * 2 - 1;
    this.Y[i] = this.PY[i] = this._h(k + 2) * 2 - 1;
    this.Z[i] = this.PZ[i] = this._h(k + 3) * 2 - 1;
    this.life[i] = 0.45 + this._h(k + 4) * 0.95;
    this.sv[i] = this._h(k + 5);
  }
  _spawn() {
    if (!this.X) {
      this.X = new Float32Array(MAXN); this.Y = new Float32Array(MAXN); this.Z = new Float32Array(MAXN);
      this.PX = new Float32Array(MAXN); this.PY = new Float32Array(MAXN); this.PZ = new Float32Array(MAXN);
      this.life = new Float32Array(MAXN); this.sv = new Float32Array(MAXN); this._rc = new Uint16Array(MAXN);
      this.sax = new Float32Array(MAXN); this.say = new Float32Array(MAXN);
      this.sbx = new Float32Array(MAXN); this.sby = new Float32Array(MAXN);
      this.sband = new Uint8Array(MAXN); this.svalid = new Uint8Array(MAXN);
    }
    for (let i = 0; i < MAXN; i++) {
      this._rc[i] = 0; this._reseed(i);
      // 初期の life をばらして再投入のタイミングを散らす (同時消失を防ぐ)。
      this.life[i] = this._h(Math.imul(i + 7, 0x27d4eb2d) + 9) * 1.4;
    }
  }

  update(dt, audio, palette, clock) {
    this.t = clock.time;
    this.level = audio.level; this.bass = audio.bass; this.treble = audio.treble;
    const quality = clock.quality || 1;
    const n = Math.min(MAXN, Math.max(2000, Math.round(this.p('count') * quality)));
    this.n = n;
    const swarm = this.modeIndex ? 1 : 0;
    const f = this.p('freq');
    const zt = this.t * 0.05 * (1 + 0.6 * swarm);     // 場のゆっくりした時間進化
    const react = this.p('react');
    const baseSp = this.p('speed') * (swarm ? 1.5 : 1);
    const sp = baseSp * (1 + react * 0.25 * (this.level + this.bass)) * dt; // 音で流速
    const oct = this.p('detail');
    this._spin = this.t * this.p('rotate') * (swarm ? 1.3 : 1);
    const f3 = f * 3;
    const noise = this.noise;
    for (let i = 0; i < n; i++) {
      this.PX[i] = this.X[i]; this.PY[i] = this.Y[i]; this.PZ[i] = this.Z[i];
      const x = this.X[i], y = this.Y[i], z = this.Z[i];
      // 一次の 3D ベクトル場 (3 サンプルで vx,vy,vz)。
      let vx = noise.noise3D(x * f + 0.0, y * f + 0.0, z * f + zt);
      let vy = noise.noise3D(x * f + 5.2, y * f + 9.1, z * f + zt + 2.3);
      let vz = noise.noise3D(x * f + 2.7, y * f + 4.4, z * f + zt + 7.8);
      // 二次オクターブ — 毛細管的な細かい捻れ。
      if (oct > 0.001) {
        vx += oct * noise.noise3D(x * f3 + 11, y * f3, z * f3 + zt);
        vy += oct * noise.noise3D(x * f3, y * f3 + 13, z * f3 + zt);
        vz += oct * noise.noise3D(x * f3, y * f3, z * f3 + zt + 5);
      }
      const m = sp * (0.55 + 0.6 * this.sv[i]);        // per-particle 速度差
      this.X[i] = x + vx * m; this.Y[i] = y + vy * m; this.Z[i] = z + vz * m;
      this.life[i] -= dt * (swarm ? 0.42 : 0.30);
      if (this.life[i] <= 0 ||
        this.X[i] < -1.15 || this.X[i] > 1.15 ||
        this.Y[i] < -1.15 || this.Y[i] > 1.15 ||
        this.Z[i] < -1.15 || this.Z[i] > 1.15) {
        this._reseed(i);
      }
    }
  }

  draw(ctx, alpha) {
    const n = this.n || 0;
    if (!n) return;
    const W = this.w, H = this.h;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.46;
    const spin = this._spin, ca = Math.cos(spin), sa = Math.sin(spin);
    const maxSeg = R * R * 0.5; // 投入直後/巻き戻りの長飛びを除外
    // 投影 → 画面座標・奥行きバンド・有効フラグをキャッシュ。
    for (let i = 0; i < n; i++) {
      const ax = this.PX[i], ay = this.PY[i], az = this.PZ[i];
      const arx = ax * ca + az * sa, arz = -ax * sa + az * ca;
      const aty = ay * CT - arz * ST;
      const asx = cx + arx * R, asy = cy - aty * R;
      const bx = this.X[i], by = this.Y[i], bz = this.Z[i];
      const brx = bx * ca + bz * sa, brz = -bx * sa + bz * ca;
      const bty = by * CT - brz * ST, btz = by * ST + brz * CT;
      const bsx = cx + brx * R, bsy = cy - bty * R;
      const dx = bsx - asx, dy = bsy - asy;
      if (dx * dx + dy * dy > maxSeg) { this.svalid[i] = 0; continue; }
      this.sax[i] = asx; this.say[i] = asy; this.sbx[i] = bsx; this.sby[i] = bsy;
      let d = btz * 0.5 + 0.5; if (d < 0) d = 0; else if (d > 1) d = 1; // 0 奥 .. 1 手前
      let band = (d * BANDS) | 0; if (band >= BANDS) band = BANDS - 1;
      this.sband[i] = band; this.svalid[i] = 1;
    }
    // mono インク色 (palette.fg)。
    const fg = (this.palette && this.palette.fg) || [240, 240, 240];
    const fr = Math.round(fg[0]), fgc = Math.round(fg[1]), fb = Math.round(fg[2]);
    const thread = this.p('thread');
    const aMul = (1 + this.bass * 0.35) * alpha; // 低音で少し濃く
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // 奥行きバンドごとに 1 stroke — 手前ほど太く明るい。
    for (let b = 0; b < BANDS; b++) {
      const dc = (b + 0.5) / BANDS;
      ctx.lineWidth = thread * (0.45 + 1.0 * dc);
      ctx.strokeStyle = `rgba(${fr},${fgc},${fb},${(0.07 + 0.5 * dc) * aMul})`;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (this.svalid[i] && this.sband[i] === b) {
          ctx.moveTo(this.sax[i], this.say[i]);
          ctx.lineTo(this.sbx[i], this.sby[i]);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
