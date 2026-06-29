// base64 ⇄ typed-array codec. Works in Node 18+ and browsers (atob/btoa globals).
// Used by the offline bake tools (encode) and the runtime decoders (decode).
const CHUNK = 0x8000; // chunk fromCharCode/charCodeAt to avoid call-stack limits

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

export function packInt16(values) {
  const n = values.length;
  const buf = new Uint8Array(n * 2);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < n; i++) dv.setInt16(i * 2, values[i] | 0, true);
  return bytesToB64(buf);
}

export function unpackInt16(b64) {
  const bytes = b64ToBytes(b64);
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

export function packUint8(values) {
  return bytesToB64(values instanceof Uint8Array ? values : Uint8Array.from(values));
}

export function unpackUint8(b64) {
  return b64ToBytes(b64);
}
