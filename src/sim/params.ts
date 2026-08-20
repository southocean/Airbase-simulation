/**
 * Tunable parameters.
 *
 * Design principle 7.2: every number is sourced, or visibly marked as a guess.
 * A model that cannot distinguish its measured inputs from its guesses cannot be
 * defended in front of a customer.
 *
 * Provenance tags used throughout:
 *   @source DECK    — Saab internal simulation deck (via context.md). Authoritative.
 *   @source TIER-A  — public authoritative data.
 *   @source TIER-C  — reasoned analogue from open literature. A guess with a rationale.
 *   @source ASSUMED — placeholder. Needs SME elicitation (docs/03 §5).
 *
 * The UI surfaces these tags, so anyone reading a result can see how much of it
 * rests on real data. Most of it currently does not, and that is the honest state
 * of the art until the elicitation in docs/03 §5 happens.
 */
import type { Dist } from "./dist";

export type Provenance = "DECK" | "TIER-A" | "TIER-C" | "ASSUMED";

export type AircraftTypeId = "GripenE" | "GripenF_EA" | "GlobalEye";

export interface AircraftSpec {
  id: AircraftTypeId;
  label: string;
  /** Crew required to fly */
  seats: number;
  /** Nominal sortie duration, hours */
  sortieHours: Dist;
  /** Turnaround: refuel + rearm + walkaround, minutes (dry, daylight, no faults) */
  prepMinutes: Dist;
  /** Post-flight reception check, minutes */
  receptionMinutes: Dist;
  /** Fuel uplift per sortie, m³ */
  fuelM3: number;
  /** Munitions units consumed per strike-type sortie */
  munitionsPerSortie: number;
  /** Maintenance man-hours per flight hour */
  mmhPerFh: number;
  /** Cruise speed, knots. Presentation only — the sim models time, not distance. */
  cruiseKts: number;
  /** Typical operating radius, km. Bounds how far a mission track reaches. */
  radiusKm: number;
  /** Crosswind limit, knots */
  crosswindLimitKts: number;
  /** Minimum ceiling, ft, and visibility, m, for a normal launch */
  minCeilingFt: number;
  minVisibilityM: number;
  provenance: Provenance;
}

/**
 * Aircraft specs.
 *
 * @source TIER-A for airframe envelope — Saab publishes dimensions, thrust and
 *         ferry range for Gripen E and GlobalEye.
 * @source ASSUMED for every sustainment number below (prep, reception, MMH/FH,
 *         fuel uplift). These are the numbers that actually drive the model and
 *         they are NOT public. Gripen was explicitly designed for short
 *         turnaround by conscript-level ground crew in dispersed basing, so it
 *         should sit at the favourable end of any fast-jet analogue range — that
 *         assumption is stated here rather than buried.
 * @source TIER-C for MMH/FH ranges — open sustainment literature (RAND agile
 *         combat employment studies, JDMS sortie-generation modelling).
 */
export const AIRCRAFT_SPECS: Record<AircraftTypeId, AircraftSpec> = {
  GripenE: {
    id: "GripenE",
    label: "JAS 39E Gripen",
    seats: 1,
    sortieHours: { kind: "lognormal", median: 1.4, sigma: 0.28 },
    prepMinutes: { kind: "pert", min: 22, mode: 34, max: 70 },
    receptionMinutes: { kind: "pert", min: 12, mode: 20, max: 45 },
    fuelM3: 3.4,
    munitionsPerSortie: 2,
    mmhPerFh: 8.5,
    cruiseKts: 470,
    radiusKm: 700,
    crosswindLimitKts: 25,
    minCeilingFt: 400,
    minVisibilityM: 1200,
    provenance: "ASSUMED",
  },
  GripenF_EA: {
    id: "GripenF_EA",
    label: "JAS 39F EA",
    seats: 2,
    sortieHours: { kind: "lognormal", median: 1.7, sigma: 0.3 },
    prepMinutes: { kind: "pert", min: 26, mode: 40, max: 80 },
    receptionMinutes: { kind: "pert", min: 14, mode: 24, max: 50 },
    fuelM3: 3.8,
    munitionsPerSortie: 2,
    mmhPerFh: 11,
    cruiseKts: 450,
    radiusKm: 650,
    crosswindLimitKts: 25,
    minCeilingFt: 400,
    minVisibilityM: 1200,
    provenance: "ASSUMED",
  },
  GlobalEye: {
    id: "GlobalEye",
    label: "GlobalEye AEW&C",
    seats: 2,
    sortieHours: { kind: "lognormal", median: 8.0, sigma: 0.18 },
    prepMinutes: { kind: "pert", min: 40, mode: 62, max: 120 },
    receptionMinutes: { kind: "pert", min: 25, mode: 40, max: 75 },
    fuelM3: 9.5,
    munitionsPerSortie: 0,
    mmhPerFh: 6,
    cruiseKts: 350,
    radiusKm: 900,
    crosswindLimitKts: 30,
    minCeilingFt: 300,
    minVisibilityM: 800,
    provenance: "ASSUMED",
  },
};

/** @source DECK p.11 — scheduled service interval, and service types A/B/C in days. */
export const SERVICE_INTERVAL_HOURS = 100;
export const SERVICE_TYPES = { A: 5, B: 8, C: 20 } as const;

/** @source DECK p.15 — UE (exchange unit) closed-loop cycle. */
export const UE_CYCLE = {
  baseToResmatDays: 5,
  mroLoopDays: 30,
  cannibalizationHours: 1,
} as const;

/**
 * Reliability / error model.
 *
 * Gap G: the hackathon builds have ONE error class (aircraft technical failure)
 * with invented rates. Seven are needed. These five are implemented; battle damage
 * and infrastructure damage are declared but left for the scenario layer.
 */
export const RELIABILITY = {
  /**
   * Probability that a defect is found at all — at startup BIT, and at reception.
   *
   * This gate matters, and it is an interpretation, so it is stated openly.
   * The deck's Utfall table is rolled once per game turn (a 24 h planning period)
   * and its columns are status / fault type / corrective time / capability /
   * facility. Read literally as "roll per sortie", every single preparation and
   * every single landing would produce a maintenance job, which saturates a
   * five-bay base within a day and is not how a fast-jet fleet behaves.
   *
   * So the table is used for what its columns actually describe — CLASSIFYING a
   * defect (what broke, how long, which facility, which capability) — while these
   * rates decide WHETHER one occurred. context.md flags the deck's headings as
   * needing SME confirmation, and this is exactly such a point.
   *
   * @source TIER-C — break-rate / defect-per-sortie ranges from open fast-jet
   *         sustainment literature. Confirm with an SME before quoting results.
   */
  defectProbPrep: 0.09,
  defectProbReception: 0.2,

  /** @source ASSUMED — hackathon builds used a hard 7 h "grace period" before any
   *  failure was possible, which is not how hazard works. Replaced with a proper
   *  exponential hazard rate per flight hour. */
  technicalFailurePerFlightHour: 0.055,
  /** Fraction of technical failures that are NMC-critical rather than a quick fix.
   *  @source ASSUMED — derived from the hackathon 5 %/1 % yellow/red split. */
  criticalFraction: 0.17,

  /** How much more failure-prone an airframe is at its service limit than fresh
   *  out of service. Applied linearly against remaining service hours.
   *  @source TIER-C — bathtub-curve wear-out behaviour; magnitude is a guess. */
  wearFailureMult: 1.4,

  /** Human error on a prep task, per task, at zero fatigue and full daylight.
   *  @source TIER-C — aviation maintenance human-factors literature (MEDA / HFACS-ME
   *  taxonomies) publishes error-rate ranges for ramp and line maintenance. */
  humanErrorBase: 0.018,
  /** Multiplier at maximum fatigue. @source TIER-C — shift-work / fatigue-risk literature. */
  humanErrorFatigueMult: 3.2,
  /** Multiplier in full darkness. @source ASSUMED. */
  humanErrorNightMult: 1.7,

  /** Ground support equipment failure, per prep task. @source ASSUMED. */
  gseFailurePerTask: 0.012,
  /** GSE repair time, hours. @source ASSUMED. */
  gseRepairHours: { kind: "lognormal", median: 1.5, sigma: 0.5 } as Dist,

  /** Probability a resupply delivery is late or short. @source TIER-C — civilian
   *  logistics on-time-delivery distributions. The deck's 5-day figure is a mean,
   *  not a guarantee, so lead time is a distribution here. */
  resupplyLateProb: 0.22,
  resupplyLeadDays: { kind: "pert", min: 3.5, mode: 5, max: 14 } as Dist,
} as const;

/**
 * Weather and light coupling. Every one of these is a coupling that does not
 * exist at all in either hackathon build.
 *
 * @source ASSUMED throughout — plausible operational effects, magnitudes unverified.
 */
export const ENV_EFFECTS = {
  /** Prep time multiplier at -20 °C (cold-soak, gloves, de-icing prep). */
  coldPrepMultAt20Below: 1.55,
  /** Prep time multiplier in full darkness. */
  nightPrepMult: 1.22,
  /** Extra minutes for de-icing when icing risk is high. */
  deiceMinutes: { kind: "pert", min: 8, mode: 16, max: 40 } as Dist,
  /** Icing risk above this triggers a de-icing task. */
  deiceThreshold: 0.35,
  /** Runway contamination (mm) above which a clearance task is required. */
  runwayClearThresholdMm: 12,
  /** Runway clearance duration, hours — blocks all movement. */
  runwayClearHours: { kind: "pert", min: 0.4, mode: 0.8, max: 2.2 } as Dist,
  /** Gust above this fraction of the crosswind limit and launches hold. */
  crosswindHoldFactor: 1.0,
} as const;

/** Crew shift model. @source ASSUMED — a plain two-shift rotation. */
export const CREW = {
  shiftHours: 12,
  /** Fatigue accrued per hour on shift, normalised so a full shift ≈ 1.0. */
  fatiguePerHourOnShift: 1 / 12,
  /** Fatigue recovered per hour off shift. */
  recoveryPerHourOff: 1 / 8,
  /** Fatigue above this and the tool will recommend a shift change. */
  fatigueWarnThreshold: 0.75,
} as const;

/** @source DECK pp.2–3, 10 — personnel required per activity. */
export const PERSONNEL_PER_TASK = {
  prep: { mech: 2, tech: 1, arms: 1 },
  maintenance_quick: { mech: 1, tech: 1, arms: 0 },
  maintenance_complex: { mech: 2, tech: 2, arms: 0 },
  reception: { mech: 1, tech: 0, arms: 0 },
} as const;

/** @source DECK p.4 — base types and their zone capacities. */
export const BASE_CAPACITY = {
  huvudbas: { prepSlots: 4, serviceBay: 2, minorWorkshop: 2, majorWorkshop: 1, runways: 2 },
  sidobas: { prepSlots: 2, serviceBay: 1, minorWorkshop: 1, majorWorkshop: 0, runways: 1 },
  reservbas: { prepSlots: 1, serviceBay: 1, minorWorkshop: 0, majorWorkshop: 0, runways: 1 },
} as const;

/** Scenario tempo → daily sortie demand multiplier. @source DECK p.5 (7-day scenario). */
export const TEMPO = {
  FRED: { label: "FRED", sortieDemandPerDay: 6, munitionsUse: 0.1 },
  KRIS: { label: "KRIS", sortieDemandPerDay: 14, munitionsUse: 0.5 },
  KRIG: { label: "KRIG", sortieDemandPerDay: 26, munitionsUse: 1.0 },
} as const;

export type TempoId = keyof typeof TEMPO;

/** Provenance summary, surfaced in the UI so the honesty is visible, not buried. */
export const PROVENANCE_SUMMARY: { tag: Provenance; label: string; note: string }[] = [
  { tag: "DECK", label: "Saab-underlag", note: "Utfallstabeller, UE-cykel, baskapacitet, scenario" },
  { tag: "TIER-A", label: "Öppna data", note: "Väderklimatologi (SMHI-form), solgeometri, flygplansprestanda" },
  { tag: "TIER-C", label: "Analogi", note: "MMH/FH, mänskliga fel, leveransprecision" },
  { tag: "ASSUMED", label: "Antagande", note: "Klargöringstider, felintensitet, miljöeffekter — kräver SME" },
];
