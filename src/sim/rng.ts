/**
 * Seeded, deterministic RNG.
 *
 * Design principle 7.1: determinism is a requirement, not an optimisation.
 * Nothing in src/sim may ever call Math.random(). Same seed + same inputs
 * must produce byte-identical results at any timescale.
 *
 * mulberry32 — 32-bit state, excellent distribution for our purposes, and
 * trivially serialisable (a single integer), which lets us snapshot and
 * restore a run.
 */
export interface Rng {
  /** Uniform float in [0, 1) */
  next(): number;
  /** Integer in [1, sides] — a die roll */
  roll(sides: number): number;
  /** True with probability p */
  chance(p: number): boolean;
  /** Uniform float in [min, max) */
  range(min: number, max: number): number;
  /** Standard normal, via Box–Muller */
  normal(): number;
  /** Pick one element */
  pick<T>(xs: readonly T[]): T;
  /** Current internal state — for snapshotting */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  // A zero state is degenerate for mulberry32; nudge it.
  if (s === 0) s = 0x9e3779b9;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    roll: (sides) => Math.floor(next() * sides) + 1,
    chance: (p) => next() < p,
    range: (min, max) => min + next() * (max - min),
    normal() {
      // Box–Muller. u1 must be > 0 for the log.
      let u1 = next();
      while (u1 === 0) u1 = next();
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    pick(xs) {
      return xs[Math.floor(next() * xs.length)];
    },
    state: () => s,
  };
}

/**
 * Derive an independent child stream from a parent seed and a label.
 *
 * Why: if weather, failures, and human error all draw from one stream, adding
 * a single extra weather draw shifts every downstream failure roll and the run
 * becomes incomparable. Separate streams per concern keep a change local, which
 * is what makes paired A/B runs (docs/03 §7) valid.
 */
export function deriveSeed(seed: number, label: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = (Math.imul(h ^ label.charCodeAt(i), 0x01000193) + 0x9e3779b9) >>> 0;
  }
  return h >>> 0;
}
