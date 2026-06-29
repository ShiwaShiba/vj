import { TURB } from './turbProfile.data.js';
import { unpackUint8 } from './pmCodec.js';

// Decode the baked video turbulence profile. density is dim*dim, normalized 0..1.
export function decodeTurbProfile() {
  const bytes = unpackUint8(TURB.density);
  const density = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) density[i] = bytes[i] / 255;
  return {
    dim: TURB.dim, density,
    flowAngle: TURB.flowAngle, coherence: TURB.coherence,
    scale: TURB.scale, streakLen: TURB.streakLen,
    mean: TURB.mean, contrast: TURB.contrast,
  };
}
