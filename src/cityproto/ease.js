// Pure scalar easings, t in [0,1] -> [0,1]. The "緩急" vocabulary for the Plan 3
// reveal: flat holds are 溜め (handled by the timeline), eased pulls are 引き.
// No state, no THREE — node-testable.

export const linear = (t) => t;

// ease-in-out: slow start, slow end. The default "引き" feel.
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// decelerate: fast start, gentle settle.
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// gentle symmetric sine — used for the slow reverse dolly (④→① sink).
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// snappy decelerate — for the hero pull-in if wanted.
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

const REGISTRY = { linear, easeInOutCubic, easeOutCubic, easeInOutSine, easeOutQuint };

// Resolve an ease by name (so segments can name their feel as data); unknown -> linear.
export const byName = (name) => REGISTRY[name] || linear;
