// Minimal dependency-free PNG decoder: 8-bit, non-interlaced, color types 0/2/6.
// Enough for our committed fixtures. Not a general PNG library.
import { inflateSync } from 'node:zlib';

const CH = { 0: 1, 2: 3, 4: 2, 6: 4 }; // color type -> channels (4=gray+alpha)

export function decodePng(buf) {
  const b = Buffer.from(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
  if (b[0] !== 137 || b[1] !== 80 || b[2] !== 78 || b[3] !== 71) throw new Error('not a PNG');
  let p = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p); const type = b.toString('latin1', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNG supported, got ' + bitDepth);
  const channels = CH[colorType];
  if (!channels) throw new Error('unsupported color type ' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  const prev = new Uint8Array(stride);
  let ip = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[ip++];
    const cur = raw.subarray(ip, ip + stride); ip += stride;
    const line = out.subarray(y * stride, y * stride + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const bb = prev[i];
      const cc = i >= channels ? prev[i - channels] : 0;
      let v = cur[i];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + bb) & 255; break;
        case 3: v = (v + ((a + bb) >> 1)) & 255; break;
        case 4: { const pa = Math.abs(bb - cc), pb = Math.abs(a - cc), pc = Math.abs(a + bb - 2 * cc);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? bb : cc; v = (v + pr) & 255; break; }
        default: throw new Error('bad filter ' + filter);
      }
      line[i] = v;
    }
    prev.set(line);
  }
  return { width, height, channels, data: out };
}

export function toLum({ width, height, channels, data }) {
  const lum = new Float32Array(width * height);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    if (channels >= 3) lum[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    else lum[i] = data[j]; // gray or gray+alpha
  }
  return { w: width, h: height, lum };
}
