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
const TILT = 0.40;                 // X軸の基準チルト(rad) — 回転0でも奥行きを残す
const ROT2 = 0.618;                // 第2軸(X)の速度比 — 黄金比で非反復 tumble
const BANDS = 8;                   // 明度量子化 — 1バンド=1 stroke
const MAXN = 32000;                // Particles スライダー上限ぶん事前確保
const CONV_PULL = 0.98;            // 画面内(x,y)の引き込み強さ (1=中心2%まで) — ギュッと
const CONV_PULL_Z = 0.96;          // 奥行きもほぼ同等に引く → 高密度な球体核
const CONV_SWIRL = 2.0;            // 収束時のスワール量(rad) — 内側ほど速い渦
const QUIVER = 0.05;               // 微生物の細動: 微小トレモロ振幅(world)
const QFREQ = 22.0;                // 細動の速さ(rad/s)
const PULSE_AMT = 0.18;            // キック鼓動の最大膨張率
const RESEED_JUMP = 0.25;          // ワールド空間で再投入(瞬間移動)とみなす二乗距離

// smootherstep (Perlin) — 等速をなくす滑らかな S 字 0→1。
function smoother(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10); }

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
    this.modeGroups = [
      { key: 'pulse', label: 'Pulse', options: ['OFF', 'ON'], index: 0 },      // キック/低音で鼓動
      { key: 'converge', label: 'Converge', options: ['OFF', 'ON'], index: 0 }, // 不定期に中心収束
    ];
    this.noise = new SimplexNoise(7);
    // 3D 粒子状態 (正規化立方体内)。
    this.X = null; this.Y = null; this.Z = null;
    this.PX = null; this.PY = null; this.PZ = null;
    this.life = null; this.L0 = null; this.sv = null; this.lev = null; this._rc = null;
    // 投影キャッシュ (描画用)。
    this.sax = null; this.say = null; this.sbx = null; this.sby = null;
    this.sband = null; this.svalid = null;
    this.n = 0; this._spin = 0; this._spin2 = 0; this.t = 0;
    this.level = 0; this.bass = 0; this.treble = 0; this.beatHold = 0;
    this._conv = 0; this._convPrev = 0; // 中心収束エンベロープ xy (前フレームも保持)
    this._convZ = 0; this._convZPrev = 0; // 奥行き用 (解放時に先行して開く)
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
    const L = 0.45 + this._h(k + 4) * 0.95;
    this.life[i] = this.L0[i] = L;      // L0 = 出生時の寿命 (明滅エンベロープの基準)
    this.sv[i] = this._h(k + 5);        // フリッカー位相
    this.lev[i] = 0.55 + this._h(k + 6) * 0.45; // 個体ごとの明度差
  }
  _spawn() {
    if (!this.X) {
      this.X = new Float32Array(MAXN); this.Y = new Float32Array(MAXN); this.Z = new Float32Array(MAXN);
      this.PX = new Float32Array(MAXN); this.PY = new Float32Array(MAXN); this.PZ = new Float32Array(MAXN);
      this.life = new Float32Array(MAXN); this.L0 = new Float32Array(MAXN);
      this.sv = new Float32Array(MAXN); this.lev = new Float32Array(MAXN); this._rc = new Uint16Array(MAXN);
      this.sax = new Float32Array(MAXN); this.say = new Float32Array(MAXN);
      this.sbx = new Float32Array(MAXN); this.sby = new Float32Array(MAXN);
      this.sband = new Uint8Array(MAXN); this.svalid = new Uint8Array(MAXN);
    }
    for (let i = 0; i < MAXN; i++) {
      this._rc[i] = 0; this._reseed(i);
      // 初期の life をばらして再投入のタイミングを散らす (同時消失を防ぐ)。
      this.life[i] = this.L0[i] = this._h(Math.imul(i + 7, 0x27d4eb2d) + 9) * 1.4 + 0.05;
    }
  }

  update(dt, audio, palette, clock) {
    this.t = clock.time;
    this.level = audio.level; this.bass = audio.bass; this.treble = audio.treble;
    this.beatHold = audio.beatHold || 0;
    // 不定期な中心収束: clock.beats 駆動の決定論エンベロープ (Math.random 不使用)。
    // 収束(中心ほど減速=力溜め) → 数秒キープ → じわっと開花(両端velocity0=継ぎ目なし)。
    this._convPrev = this._conv; this._convZPrev = this._convZ;
    if (this.mg('converge') === 1) {
      const bf = clock.beats + (clock.beatPhase || 0);
      const ev = bf * 0.021 + 0.5 * Math.sin(bf * 0.020) + 0.3 * Math.sin(bf * 0.0095 + 1.7);
      const ph = ev - Math.floor(ev);
      const W0 = 0.62, C0 = 0.22, C1 = 0.50; // 収束 / HOLD / 開花 の境界(イベント内比率)
      if (ph > W0) {
        const u = (ph - W0) / (1 - W0);
        if (u < C0) {
          this._conv = this._convZ = smoother(u / C0); // 静かに集まり中心で減速(両端velocity0)
        } else if (u < C1) {
          this._conv = this._convZ = 1;                        // 数秒キープ(細動で生きてる)
        } else {
          const r = (u - C1) / (1 - C1);
          this._conv = 1 - smoother(r);                        // じわっと開花(速度0で戻る)
          this._convZ = 1 - smoother(r < 0.74 ? r / 0.74 : 1); // 奥行きが先に開く(奥側から)
        }
      } else {
        this._conv = this._convZ = 0;
      }
    } else {
      this._conv = this._convZ = 0;
    }
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
    const rot = this.p('rotate') * (swarm ? 1.3 : 1);
    this._spin = this.t * rot;             // 第1軸 (Y)
    this._spin2 = this.t * rot * ROT2;     // 第2軸 (X) — 非反復 tumble
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
    const cx = W / 2, cy = H / 2;
    // Pulse(鼓動): キック/低音で投影半径が膨張→減衰。
    const pulse = this.mg('pulse') === 1 ? (1 + this.beatHold * PULSE_AMT + this.bass * 0.05) : 1;
    const R = Math.min(W, H) * 0.46 * pulse;
    // Converge(収束): 一律スケールでなく、中心へ寄せつつ内側ほど速いスワール(渦)で
    // 巻き込む真の3D funnel。奥行きは緩く引いて紡錘核に。prev/cur で曲がった spiral streak。
    const cvP = this._convPrev, cvC = this._conv;
    const cvzP = this._convZPrev, cvzC = this._convZ;
    const converging = cvP > 0.0002 || cvC > 0.0002;
    const sxyP = 1 - cvP * CONV_PULL, szP = 1 - cvzP * CONV_PULL_Z, swP = cvP * CONV_SWIRL;
    const sxyC = 1 - cvC * CONV_PULL, szC = 1 - cvzC * CONV_PULL_Z, swC = cvC * CONV_SWIRL;
    // 二軸回転: Y軸=_spin, X軸=TILT+_spin2 (黄金比で非反復に tumble)。
    const ay1 = this._spin, cY = Math.cos(ay1), sY = Math.sin(ay1);
    const ax1 = TILT + this._spin2, cX = Math.cos(ax1), sX = Math.sin(ax1);
    const flickT = this.t * 5.0; // フリッカー速度
    // 収束核は固定点でなく、ゆっくり徘徊する「生きた標的」へ寄せる (有機的)。
    let tgx = 0, tgy = 0, tgz = 0, qt = 0;
    if (converging) {
      const da = this.t * 0.15;
      tgx = 0.16 * this.noise.noise3D(da, 1.3, 0.0);
      tgy = 0.16 * this.noise.noise3D(2.1, da, 4.0);
      tgz = 0.11 * this.noise.noise3D(0.7, 5.2, da + 7.0);
      qt = this.t * QFREQ;
    }
    // 投影 → 画面座標・統合明度バンド・有効フラグをキャッシュ。
    for (let i = 0; i < n; i++) {
      // ワールド空間の移動量で再投入(瞬間移動)を判定 — 収束 streak は除外しない。
      const wdx = this.X[i] - this.PX[i], wdy = this.Y[i] - this.PY[i], wdz = this.Z[i] - this.PZ[i];
      if (wdx * wdx + wdy * wdy + wdz * wdz > RESEED_JUMP) { this.svalid[i] = 0; continue; }
      let ax = this.PX[i], ay = this.PY[i], az = this.PZ[i];
      let bx = this.X[i], by = this.Y[i], bz = this.Z[i];
      if (converging) {
        // 徘徊標的(tg)相対で、内側ほど速い渦＋非一様な引き込み (z は緩く=紡錘核)。
        let rx = ax - tgx, rz = az - tgz, rr = Math.sqrt(rx * rx + rz * rz) + 0.35;
        let an = swP / rr, c2 = Math.cos(an), s2 = Math.sin(an);
        ax = tgx + (rx * c2 + rz * s2) * sxyP; az = tgz + (-rx * s2 + rz * c2) * szP; ay = tgy + (ay - tgy) * sxyP;
        rx = bx - tgx; rz = bz - tgz; rr = Math.sqrt(rx * rx + rz * rz) + 0.35;
        an = swC / rr; c2 = Math.cos(an); s2 = Math.sin(an);
        bx = tgx + (rx * c2 + rz * s2) * sxyC; bz = tgz + (-rx * s2 + rz * c2) * szC; by = tgy + (by - tgy) * sxyC;
        // 微生物の細動: 速く微小なトレモロ — 圧縮(conv)されるほど震える。
        const phi = this.sv[i] * TWO_PI;
        const j1 = Math.sin(qt + phi), j2 = Math.sin(qt * 1.27 + phi * 1.6 + 2.0), j3 = Math.sin(qt * 0.9 + phi * 0.7);
        ax += cvP * QUIVER * j1; az += cvP * QUIVER * j2; ay += cvP * QUIVER * 0.6 * j3;
        bx += cvC * QUIVER * j1; bz += cvC * QUIVER * j2; by += cvC * QUIVER * 0.6 * j3;
      }
      const arx = ax * cY + az * sY, arz = -ax * sY + az * cY;
      const aty = ay * cX - arz * sX;
      const asx = cx + arx * R, asy = cy - aty * R;
      const brx = bx * cY + bz * sY, brz = -bx * sY + bz * cY;
      const bty = by * cX - brz * sX, btz = by * sX + brz * cX;
      const bsx = cx + brx * R, bsy = cy - bty * R;
      this.sax[i] = asx; this.say[i] = asy; this.sbx[i] = bsx; this.sby[i] = bsy;
      // 奥行き (0 奥 .. 1 手前)。
      let d = btz * 0.5 + 0.5; if (d < 0) d = 0; else if (d > 1) d = 1;
      const depthF = 0.25 + 0.75 * d; // 奥も僅かに残す
      // 寿命エンベロープ: 生まれ(淡)→中盤(濃)→死(消) — 奥から来て無くなる質感。
      let frac = this.L0[i] > 0 ? this.life[i] / this.L0[i] : 0;
      if (frac < 0) frac = 0; else if (frac > 1) frac = 1;
      let env = (frac < 0.25 ? frac / 0.25 : 1) * ((1 - frac) < 0.10 ? (1 - frac) / 0.10 : 1);
      // 個体明度差＋微細フリッカー。
      const flick = 0.82 + 0.18 * Math.sin(flickT + this.sv[i] * TWO_PI);
      let bv = depthF * env * this.lev[i] * flick;
      if (bv < 0) bv = 0; else if (bv > 1) bv = 1;
      let band = (bv * BANDS) | 0; if (band >= BANDS) band = BANDS - 1;
      this.sband[i] = band; this.svalid[i] = 1;
    }
    // mono インク色 (palette.fg)。
    const fg = (this.palette && this.palette.fg) || [240, 240, 240];
    const fr = Math.round(fg[0]), fgc = Math.round(fg[1]), fb = Math.round(fg[2]);
    const thread = this.p('thread');
    const aMul = (1 + this.bass * 0.35 + this._conv * 0.45) * alpha; // 低音＋収束(高密度球)で濃く
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // 統合明度バンドごとに 1 stroke — 明るい糸ほど太い (手前/生きてる)。
    for (let b = 0; b < BANDS; b++) {
      const bc = (b + 0.5) / BANDS;
      ctx.lineWidth = thread * (0.4 + 1.1 * bc);
      ctx.strokeStyle = `rgba(${fr},${fgc},${fb},${(0.05 + 0.6 * bc) * aMul})`;
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
