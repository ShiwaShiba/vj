// Pure, deterministic choreography for PurposeMaker. No Date/random.
// One station = gather -> hold -> disperse -> gap. Sequence R -> L -> Both, looping.
// Seamless: cohesion is 0 with zero slope at every station boundary (gap before next gather).
// Slow, contemplative timing (ユーザー確定): the hand takes ~10s to emerge, holds, then a slow
// 逆展開. One station = 19s; the scene's R,L,R,L,Both sequence loops every ~95s.
export const DURATIONS = { gather: 10, hold: 3, disperse: 5, gap: 1 };
export const STATION = DURATIONS.gather + DURATIONS.hold + DURATIONS.disperse + DURATIONS.gap; // 19
export const STATION_SEQ = ['R', 'L', 'Both']; // module default (unchanged)
export const CYCLE = STATION * STATION_SEQ.length; // 23.1 (unchanged)
// Loop length for an arbitrary station sequence (the scene uses ['R','L','R','L','Both'] => 38.5s).
export function cycleOf(seq) { return STATION * seq.length; }

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

// Returns the build-progress signal `c` (=g in the form coupling), the active station and its
// R/L split, the phase, the station index, and the next station (for gap-staging). `opts.seq`
// overrides the default sequence so the scene can run R,L,R,L,Both (or any arrangement).
export function cohesionAt(time, opts) {
  const pace = (opts && opts.pace) || 1;
  const seq = (opts && opts.seq) || STATION_SEQ;
  const cycle = STATION * seq.length;
  let t = (time / pace) % cycle; if (t < 0) t += cycle;
  const idx = Math.min(seq.length - 1, (t / STATION) | 0);
  const station = seq[idx];
  const { c, phase } = localCohesion(t - idx * STATION);
  const cR = station === 'L' ? 0 : c;
  const cL = station === 'R' ? 0 : c;
  return { station, c, cR, cL, phase, idx, next: seq[(idx + 1) % seq.length] };
}
