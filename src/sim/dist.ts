/**
 * Distributions.
 *
 * Design principle 7.3: realism means a distribution, not a point value.
 * Every duration and rate in params.ts is declared as one of these so that
 * outputs carry spread — a single run is an anecdote, the deliverable is a
 * distribution over many runs.
 */
import type { Rng } from "./rng";

export type Dist =
  /** Fixed value — use only where the value genuinely is fixed (e.g. a policy limit). */
  | { kind: "fixed"; value: number }
  /** Symmetric uniform spread around a centre. */
  | { kind: "uniform"; min: number; max: number }
  /** Right-skewed: most jobs take about `median`, a few take much longer.
   *  The correct default shape for maintenance and turnaround tasks. */
  | { kind: "lognormal"; median: number; sigma: number }
  /** Three-point expert estimate (optimistic / most likely / pessimistic).
   *  The output shape of structured elicitation — see docs/03 §5. */
  | { kind: "pert"; min: number; mode: number; max: number; lambda?: number };

export function sample(d: Dist, rng: Rng): number {
  switch (d.kind) {
    case "fixed":
      return d.value;
    case "uniform":
      return rng.range(d.min, d.max);
    case "lognormal":
      return d.median * Math.exp(d.sigma * rng.normal());
    case "pert": {
      // PERT ≈ Beta on [min,max] with mean (min + λ·mode + max)/(λ+2).
      // Sampled via two Gammas; λ=4 is the standard PERT weight.
      const lambda = d.lambda ?? 4;
      const mean = (d.min + lambda * d.mode + d.max) / (lambda + 2);
      const range = d.max - d.min;
      if (range <= 0) return d.mode;
      // Method-of-moments alpha/beta for the standard PERT parameterisation.
      const alpha = ((mean - d.min) * (2 * d.mode - d.min - d.max)) / ((d.mode - mean) * range) || 1;
      const beta = (alpha * (d.max - mean)) / (mean - d.min) || 1;
      const x = sampleBeta(Math.max(alpha, 0.1), Math.max(beta, 0.1), rng);
      return d.min + x * range;
    }
  }
}

/** Non-negative sample, for durations that must never go below a floor. */
export function sampleDuration(d: Dist, rng: Rng, floor = 1): number {
  return Math.max(floor, sample(d, rng));
}

/** Nominal (expected) value — used by the management tool for planning,
 *  so the advisor plans on means while the world rolls actual outcomes. */
export function nominal(d: Dist): number {
  switch (d.kind) {
    case "fixed":
      return d.value;
    case "uniform":
      return (d.min + d.max) / 2;
    case "lognormal":
      return d.median;
    case "pert":
      return (d.min + (d.lambda ?? 4) * d.mode + d.max) / ((d.lambda ?? 4) + 2);
  }
}

function sampleBeta(a: number, b: number, rng: Rng): number {
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  return x + y === 0 ? 0.5 : x / (x + y);
}

/** Marsaglia–Tsang gamma sampler (shape a, scale 1). */
function sampleGamma(a: number, rng: Rng): number {
  if (a < 1) {
    // Boost-and-correct for shape < 1.
    let u = rng.next();
    while (u === 0) u = rng.next();
    return sampleGamma(a + 1, rng) * Math.pow(u, 1 / a);
  }
  const d = a - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 200; i++) {
    const z = rng.normal();
    const v = 1 + c * z;
    if (v <= 0) continue;
    const v3 = v * v * v;
    let u = rng.next();
    while (u === 0) u = rng.next();
    if (Math.log(u) < 0.5 * z * z + d - d * v3 + d * Math.log(v3)) return d * v3;
  }
  return d; // fallback; effectively unreachable
}

/** Exponential hazard: probability of at least one event in `hours`. */
export function hazardProb(ratePerHour: number, hours: number): number {
  return 1 - Math.exp(-ratePerHour * hours);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}
