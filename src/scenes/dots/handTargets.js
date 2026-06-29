import { HANDS } from './handTargets.data.js';
import { unpackInt16 } from './pmCodec.js';

// Decode the baked hand point-clouds. u,v are 0..32767 normalized image coords.
export function decodeHandTargets() {
  const dec = (hand) => ({ n: hand.n, u: unpackInt16(hand.u), v: unpackInt16(hand.v) });
  return { A: dec(HANDS.A), B: dec(HANDS.B) };
}
