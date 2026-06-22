import { clamp, lerp } from '../lib/math.js';

// Asymmetric exponential smoothing: rise quickly, fall slowly.
// This is the single most important tuning for visuals that "feel good".
export function expSmooth(current, target, attack, release) {
  const k = target > current ? attack : release;
  return lerp(current, target, k);
}

// Stateful envelope follower with adjustable attack/release.
export class EnvelopeFollower {
  constructor(attack = 0.5, release = 0.12) {
    this.value = 0;
    this.attack = attack;
    this.release = release;
  }
  push(target) {
    this.value = expSmooth(this.value, clamp(target, 0, 1), this.attack, this.release);
    return this.value;
  }
}
