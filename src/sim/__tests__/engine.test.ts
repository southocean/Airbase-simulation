import { describe, expect, it } from "vitest";
import { createSim, DEFAULT_CONFIG } from "../init";
import { step, STEP_HOURS, fulfilment, meanAvailability } from "../engine";
import { createPairedRun, runBatch, stepPaired } from "../runner";
import { solarState } from "../solar";
import { createRng, deriveSeed } from "../rng";
import type { SimState } from "../types";

/** A compact fingerprint of everything that should be reproducible. */
function fingerprint(s: SimState): string {
  return JSON.stringify({
    h: s.hours.toFixed(6),
    sorties: s.kpi.sortiesFlown,
    tasked: s.kpi.sortiesTasked,
    failed: s.kpi.missionsFailed,
    wait: s.kpi.avoidableWaitHours.toFixed(6),
    errs: s.kpi.humanErrors,
    tech: s.kpi.technicalFailures,
    gse: s.kpi.gseFailures,
    stock: s.kpi.stockouts,
    wx: [s.weather.tempC, s.weather.windKts, s.weather.ceilingFt].map((x) => x.toFixed(4)),
    ac: s.aircraft.map((a) => `${a.tail}:${a.status}:${a.flightHours.toFixed(3)}`),
  });
}

const HOURS = 48;
const STEPS = Math.round(HOURS / STEP_HOURS);

describe("determinism", () => {
  it("produces identical results for the same seed", () => {
    const a = createSim(DEFAULT_CONFIG);
    const b = createSim(DEFAULT_CONFIG);
    for (let i = 0; i < STEPS; i++) {
      step(a);
      step(b);
    }
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("produces different results for different seeds", () => {
    const a = createSim({ ...DEFAULT_CONFIG, seed: 1 });
    const b = createSim({ ...DEFAULT_CONFIG, seed: 2 });
    for (let i = 0; i < STEPS; i++) {
      step(a);
      step(b);
    }
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("is independent of how the steps are batched — the timescale cannot change the outcome", () => {
    // This is the Gap F property. In hackathon v2 the tick size came from
    // wall-clock frame timing, so 1x and 3600x diverged. Here the step is fixed
    // and only the NUMBER of steps per frame varies, so batching is irrelevant.
    const one = createSim(DEFAULT_CONFIG);
    for (let i = 0; i < STEPS; i++) step(one);

    const chunked = createSim(DEFAULT_CONFIG);
    let done = 0;
    const sizes = [1, 7, 60, 3, 240, 17];
    let k = 0;
    while (done < STEPS) {
      const n = Math.min(sizes[k++ % sizes.length], STEPS - done);
      for (let i = 0; i < n; i++) step(chunked);
      done += n;
    }

    expect(fingerprint(chunked)).toBe(fingerprint(one));
  });

  it("keeps RNG streams independent so a change in one does not shift the others", () => {
    const s1 = deriveSeed(42, "weather");
    const s2 = deriveSeed(42, "failure");
    expect(s1).not.toBe(s2);
    const r1 = createRng(s1);
    const r2 = createRng(s2);
    expect(r1.next()).not.toBeCloseTo(r2.next(), 6);
  });
});

describe("solar geometry", () => {
  it("gives a short winter day and a long summer day at Swedish latitude", () => {
    const lat = 58.43;
    const lon = 12.71;
    const jan = solarState(15, 12, lat, lon);
    const jun = solarState(172, 12, lat, lon);

    // Mid-January at 58.4°N is roughly 6-7 h of daylight; late June roughly 18.
    expect(jan.dayLengthHours).toBeGreaterThan(5);
    expect(jan.dayLengthHours).toBeLessThan(8);
    expect(jun.dayLengthHours).toBeGreaterThan(17);
    expect(jun.dayLengthHours).toBeLessThan(19.5);
    expect(jun.dayLengthHours).toBeGreaterThan(jan.dayLengthHours);
  });

  it("is dark at winter midnight and light at summer midday", () => {
    expect(solarState(15, 0, 58.43, 12.71).daylight).toBe(0);
    expect(solarState(172, 12, 58.43, 12.71).daylight).toBeGreaterThan(0.9);
  });
});

describe("headless operation", () => {
  it("runs without a DOM and produces sane KPIs", () => {
    const s = createSim(DEFAULT_CONFIG);
    for (let i = 0; i < STEPS; i++) step(s);

    expect(s.hours).toBeCloseTo(HOURS, 3);
    expect(s.kpi.sortiesTasked).toBeGreaterThan(0);
    expect(s.kpi.sortiesFlown).toBeGreaterThan(0);
    expect(fulfilment(s)).toBeGreaterThanOrEqual(0);
    expect(fulfilment(s)).toBeLessThanOrEqual(1.0001);
    expect(meanAvailability(s)).toBeGreaterThan(0);
    expect(meanAvailability(s)).toBeLessThanOrEqual(s.aircraft.length);
    // Weather must actually be moving, not frozen at its initial value.
    expect(s.kpi.history.length).toBeGreaterThan(10);
  });

  it("conserves the fleet — no aircraft appears or vanishes", () => {
    const s = createSim(DEFAULT_CONFIG);
    const n = s.aircraft.length;
    for (let i = 0; i < STEPS; i++) step(s);
    expect(s.aircraft).toHaveLength(n);
    // No airframe may hold a bay and a prep slot at the same time.
    for (const ac of s.aircraft) {
      expect(ac.slot === null || ac.bay === null).toBe(true);
    }
    // Bay occupancy must agree with the aircraft's own record.
    for (const bay of s.bays) {
      if (bay.occupiedBy) {
        const ac = s.aircraft.find((a) => a.id === bay.occupiedBy);
        expect(ac?.bay).toBe(bay.index);
      }
    }
  });
});

describe("paired A/B measurement", () => {
  it("gives both policies the identical world", () => {
    const run = createPairedRun(DEFAULT_CONFIG);
    stepPaired(run, STEPS);
    // Same seed ⇒ same weather sequence, so the environment cannot explain any
    // difference in outcome. That is what makes the comparison a measurement.
    expect(run.manual.weather.tempC).toBeCloseTo(run.tool.weather.tempC, 9);
    expect(run.manual.weather.windKts).toBeCloseTo(run.tool.weather.windKts, 9);
    expect(run.manual.weather.ceilingFt).toBeCloseTo(run.tool.weather.ceilingFt, 9);
    expect(run.manual.solar.daylight).toBeCloseTo(run.tool.solar.daylight, 9);
  });

  it("runs a multi-seed batch headlessly", () => {
    const results = runBatch(DEFAULT_CONFIG, [11, 22, 33], 3);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.toolFulfilment).toBeGreaterThanOrEqual(0);
      expect(r.manualFulfilment).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(r.toolAvoidableWait)).toBe(true);
    }
  });

  it("converts forced groundings into planned work", () => {
    // The tool's effect asserted where it is structural rather than statistical.
    //
    // Outcome metrics (fulfilment, availability, avoidable wait) all move in the
    // tool's favour but by less than the run-to-run spread, so asserting on them
    // would be a coin flip. See the benchmark test for those numbers with their
    // t-statistics, and the README for the honest reading.
    //
    // This, by contrast, is caused directly by the policy: the baseline has no
    // mechanism for clearing a deferred defect on purpose, so every defect that
    // comes due grounds an airframe at a moment nobody chose.
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    const results = runBatch(DEFAULT_CONFIG, seeds, 7);
    const meanForcedManual = results.reduce((s, r) => s + r.manualForced, 0) / results.length;
    const meanForcedTool = results.reduce((s, r) => s + r.toolForced, 0) / results.length;
    const meanPlanned = results.reduce((s, r) => s + r.toolPlanned, 0) / results.length;

    expect(meanPlanned).toBeGreaterThan(0);
    expect(meanForcedTool).toBeLessThan(meanForcedManual);
    // The effect is large enough to be unmistakable, not marginal.
    expect(meanForcedTool).toBeLessThan(meanForcedManual * 0.85);
  });
});
