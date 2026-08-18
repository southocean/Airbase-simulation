/**
 * Paired-run harness — this is Gap C, the whole point of the exercise.
 *
 * Two SimStates are advanced in lockstep from the SAME seed: one under the manual
 * baseline policy, one under the tool policy. Because every RNG stream is seeded
 * and separated per concern, both runs see the identical weather sequence and the
 * identical dice for any given event. The difference in outcome is therefore
 * attributable to the policy, not to luck.
 *
 * That is what makes "the tool is X % better" a measurement rather than a claim.
 */
import { createSim } from "./init";
import { step, STEP_HOURS } from "./engine";
import type { SimConfig, SimState } from "./types";

export interface PairedRun {
  manual: SimState;
  tool: SimState;
  config: SimConfig;
}

export function createPairedRun(config: SimConfig): PairedRun {
  return {
    manual: createSim({ ...config, policy: "manual" }),
    tool: createSim({ ...config, policy: "tool" }),
    config,
  };
}

/** Advance both runs by n fixed steps. */
export function stepPaired(run: PairedRun, steps: number): void {
  for (let i = 0; i < steps; i++) {
    step(run.manual);
    step(run.tool);
  }
}

export { STEP_HOURS };

/**
 * Headless batch: run N seeds to completion and return the per-seed delta.
 *
 * Not wired into the UI — it exists to prove the core really is headless and
 * usable from a script or a test, which is the property both hackathon builds
 * lack. `npm test` exercises it.
 */
export interface BatchResult {
  seed: number;
  manualFulfilment: number;
  toolFulfilment: number;
  manualAvailability: number;
  toolAvailability: number;
  manualAvoidableWait: number;
  toolAvoidableWait: number;
  manualForced: number;
  toolForced: number;
  toolPlanned: number;
  manualDeferredLeft: number;
  toolDeferredLeft: number;
}

export function runBatch(baseConfig: SimConfig, seeds: number[], days: number): BatchResult[] {
  const steps = Math.round((days * 24) / STEP_HOURS);
  return seeds.map((seed) => {
    const run = createPairedRun({ ...baseConfig, seed });
    stepPaired(run, steps);
    const f = (s: SimState) => (s.kpi.sortiesTasked > 0 ? s.kpi.sortiesFlown / s.kpi.sortiesTasked : 1);
    const a = (s: SimState) => (s.hours > 0 ? s.kpi.availabilityIntegral / s.hours : 0);
    return {
      seed,
      manualFulfilment: f(run.manual),
      toolFulfilment: f(run.tool),
      manualAvailability: a(run.manual),
      toolAvailability: a(run.tool),
      manualAvoidableWait: run.manual.kpi.avoidableWaitHours,
      toolAvoidableWait: run.tool.kpi.avoidableWaitHours,
      manualForced: run.manual.kpi.forcedGroundings,
      toolForced: run.tool.kpi.forcedGroundings,
      toolPlanned: run.tool.kpi.plannedClearances,
      manualDeferredLeft: run.manual.aircraft.reduce((s, a) => s + a.deferredDefects.length, 0),
      toolDeferredLeft: run.tool.aircraft.reduce((s, a) => s + a.deferredDefects.length, 0),
    };
  });
}
