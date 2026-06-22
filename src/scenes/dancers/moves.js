// A dance "move" is a table of sinusoid params per joint:
//   angle = b + A*energy*sin(w * 2pi * beatPhase + p)
// `alt` adds a half-cycle phase offset to the B-side limbs for alternation.
// `quantize` snaps oscillations to steps (robot look).
// All angles are radians, measured from "straight down" (0). +up ≈ ±π.

export const MOVES = [
  {
    name: 'Bounce',
    bounce: 0.06, sway: 0.04, squash: 0.12, alt: true,
    spine: { b: 0, A: 0.08, w: 1, p: 0 },
    head: { b: 0, A: 0.10, w: 2, p: 0 },
    arm: { b: 0.5, A: 0.5, w: 1, p: 0 },
    elbow: { b: 0.5, A: 0.3, w: 1, p: 1 },
    leg: { b: 0.12, A: 0.18, w: 1, p: 0 },
    knee: { b: 0.25, A: 0.25, w: 2, p: 0 },
  },
  {
    name: 'Twist',
    bounce: 0.03, sway: 0.10, squash: 0.06, alt: false,
    spine: { b: 0, A: 0.26, w: 1, p: 0 },
    head: { b: 0, A: 0.15, w: 1, p: 0.5 },
    arm: { b: 1.1, A: 0.4, w: 1, p: Math.PI / 2 },
    elbow: { b: 0.6, A: 0.2, w: 1, p: 0 },
    leg: { b: 0.16, A: 0.10, w: 1, p: 0 },
    knee: { b: 0.20, A: 0.15, w: 2, p: 0 },
  },
  {
    name: 'Jack',
    bounce: 0.10, sway: 0, squash: 0.14, alt: false,
    spine: { b: 0, A: 0.03, w: 1, p: 0 },
    head: { b: 0, A: 0.05, w: 2, p: 0 },
    arm: { b: 0.6, A: 1.4, w: 1, p: 0 },
    elbow: { b: 0.1, A: 0.1, w: 1, p: 0 },
    leg: { b: 0.05, A: 0.45, w: 1, p: 0 },
    knee: { b: 0.1, A: 0.15, w: 1, p: 0 },
  },
  {
    name: 'Wave',
    bounce: 0.04, sway: 0.05, squash: 0.08, alt: true,
    spine: { b: 0, A: 0.10, w: 1, p: 0 },
    head: { b: 0, A: 0.12, w: 2, p: 0 },
    arm: { b: 1.4, A: 0.7, w: 1, p: 0 },
    elbow: { b: 0.8, A: 0.4, w: 1, p: 1.2 },
    leg: { b: 0.10, A: 0.12, w: 1, p: 0 },
    knee: { b: 0.20, A: 0.20, w: 2, p: 0 },
  },
  {
    name: 'Robot',
    bounce: 0.02, sway: 0.03, squash: 0.02, alt: true, quantize: 4,
    spine: { b: 0, A: 0.05, w: 1, p: 0 },
    head: { b: 0, A: 0.0, w: 1, p: 0 },
    arm: { b: 0.8, A: 0.8, w: 1, p: 0 },
    elbow: { b: 1.0, A: 0.6, w: 1, p: 0 },
    leg: { b: 0.10, A: 0.12, w: 1, p: 0 },
    knee: { b: 0.20, A: 0.20, w: 1, p: 0 },
  },
  {
    name: 'Disco',
    bounce: 0.05, sway: 0.06, squash: 0.08, alt: true,
    spine: { b: 0, A: 0.12, w: 1, p: 0 },
    head: { b: 0, A: 0.10, w: 1, p: 0 },
    arm: { b: 1.6, A: 0.9, w: 0.5, p: 0 },
    elbow: { b: 0.3, A: 0.2, w: 0.5, p: 0 },
    leg: { b: 0.14, A: 0.20, w: 1, p: 0 },
    knee: { b: 0.25, A: 0.20, w: 2, p: 0 },
  },
];
