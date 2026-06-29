// Pure, deterministic choreography for PurposeMaker. No Date/random.
// One station = gather -> hold -> disperse -> gap. Sequence R -> L -> Both, looping.
// Seamless: cohesion is 0 with zero slope at every station boundary (gap before next gather).
export const DURATIONS = { gather: 2.6, hold: 2.4, disperse: 2.2, gap: 0.5 };
export const STATION = DURATIONS.gather + DURATIONS.hold + DURATIONS.disperse + DURATIONS.gap; // 7.7
export const STATION_SEQ = ['R', 'L', 'Both'];
export const CYCLE = STATION * STATION_SEQ.length; // 23.1

export function smoother(t) {
  if (t <= 0) return 0; if (t >= 1) return 1;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// local cohesion 0..1 over one station's local time
function localCohesion(local) {
  const { gather, hold, disperse } = DURATIONS;
  if (local < gather) return { c: smoother(local / gather), phase: 'gather' };
  if (local < gather + hold) return { c: 1, phase: 'hold' };
  if (local < gather + hold + disperse) return { c: 1 - smoother((local - gather - hold) / disperse), phase: 'disperse' };
  return { c: 0, phase: 'gap' };
}

export function cohesionAt(time, opts) {
  const pace = (opts && opts.pace) || 1;
  const T = time / pace;
  let t = T % CYCLE; if (t < 0) t += CYCLE;
  const idx = Math.min(STATION_SEQ.length - 1, (t / STATION) | 0);
  const station = STATION_SEQ[idx];
  const { c, phase } = localCohesion(t - idx * STATION);
  const cR = station === 'L' ? 0 : c;
  const cL = station === 'R' ? 0 : c;
  return { station, cR, cL, phase };
}
