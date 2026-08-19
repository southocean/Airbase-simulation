/**
 * The simulation engine.
 *
 * Headless, deterministic, fixed-step. Closes Gap A and Gap F:
 *
 *  - No React, no DOM, no wall-clock reads. `step()` is a pure-ish function of
 *    (state, dt) that mutates a state tree it owns.
 *  - Fixed STEP_HOURS. The render loop decides HOW MANY steps to run per frame;
 *    it never decides how big a step is. That is what makes 1x and 3600x produce
 *    identical results for the same seed, which is a precondition for the paired
 *    A/B measurement in docs/03 §7.
 *  - RNG streams are separated per concern (see rng.ts) and their states live in
 *    the state tree, so a run is snapshot-serialisable.
 */
import { createRng, type Rng } from "./rng";
import { clamp, hazardProb, sampleDuration } from "./dist";
import {
  AIRCRAFT_SPECS,
  CREW,
  ENV_EFFECTS,
  PERSONNEL_PER_TASK,
  RELIABILITY,
  SERVICE_INTERVAL_HOURS,
  TEMPO,
  type AircraftTypeId,
} from "./params";
import {
  applyExtraTime,
  facilityCanHandle,
  rollUtfallA,
  rollUtfallB,
  WEAPON_LOSS_PCT,
  type FacilityType,

} from "./tables";
import { braking, crosswindKts, stepWeather, type WeatherState } from "./weather";
import { solarState } from "./solar";
import { applyPolicy } from "./policy";
import { msg, type Msg } from "@/i18n";
import type { Aircraft, MaintenanceJob, Mission, SimEvent, SimState } from "./types";
import { isAirborne, isInMaintenance, isMissionCapable } from "./types";

/** Fixed integration step: 1 simulated minute. Every duration in the model is
 *  minutes-or-coarser, so this resolves every event exactly. */
export const STEP_HOURS = 1 / 60;

/** Guard against a huge dt (tab was backgrounded) turning into a freeze. */
export const MAX_STEPS_PER_FRAME = 900;

// ── helpers ────────────────────────────────────────────────────────────────

function rngFor(state: SimState, stream: string): Rng {
  const rng = createRng(state.rngStates[stream]);
  return {
    ...rng,
    // Persist the stream state back after every draw so determinism survives
    // across steps regardless of how many draws a step happens to make.
    next() {
      const v = rng.next();
      state.rngStates[stream] = rng.state();
      return v;
    },
    roll(sides: number) {
      const v = Math.floor(this.next() * sides) + 1;
      return v;
    },
    chance(p: number) {
      return this.next() < p;
    },
    range(min: number, max: number) {
      return min + this.next() * (max - min);
    },
    normal() {
      let u1 = this.next();
      while (u1 === 0) u1 = this.next();
      const u2 = this.next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    pick<T>(xs: readonly T[]): T {
      return xs[Math.floor(this.next() * xs.length)];
    },
  };
}

export function logEvent(
  state: SimState,
  severity: SimEvent["severity"],
  channel: SimEvent["channel"],
  m: Msg,
): void {
  state.events.unshift({ id: state.nextEventId++, atHours: state.hours, severity, channel, msg: m });
  if (state.events.length > 400) state.events.length = 400;
}

/** Fatigue- and darkness-adjusted human error probability. */
export function humanErrorProb(state: SimState): number {
  const crewFatigue = state.crew.reduce((s, c) => s + c.fatigue, 0) / state.crew.length;
  const fatigueMult = 1 + (RELIABILITY.humanErrorFatigueMult - 1) * crewFatigue;
  const darkness = 1 - state.solar.daylight;
  const nightMult = 1 + (RELIABILITY.humanErrorNightMult - 1) * darkness;
  return RELIABILITY.humanErrorBase * fatigueMult * nightMult;
}

/** Prep-time multiplier from cold and darkness — a real coupling neither
 *  hackathon build has. */
export function prepEnvMultiplier(state: SimState): number {
  const t = state.weather.tempC;
  // Linear from 1.0 at +5 °C to the configured multiplier at -20 °C.
  const coldT = clamp((5 - t) / 25, 0, 1.4);
  const cold = 1 + (ENV_EFFECTS.coldPrepMultAt20Below - 1) * coldT;
  const night = 1 + (ENV_EFFECTS.nightPrepMult - 1) * (1 - state.solar.daylight);
  return cold * night;
}

/** Is the field usable for launch/recovery right now, and why not? */
export function fieldStatus(state: SimState): { open: boolean; reason: Msg | null } {
  if (state.runwayClosedUntil !== null && state.hours < state.runwayClosedUntil) {
    return { open: false, reason: msg("field.runwayClosed") };
  }
  const w = state.weather;
  const xw = crosswindKts(w, state.config.runwayHeadingDeg);
  // Use the most restrictive limit in the fleet so the gate is fleet-wide.
  const limit = Math.min(...state.config.fleet.map((g) => AIRCRAFT_SPECS[g.type].crosswindLimitKts));
  if (xw > limit * ENV_EFFECTS.crosswindHoldFactor) {
    return { open: false, reason: msg("field.crosswind", { xw: xw.toFixed(0), limit }) };
  }
  const minCeil = Math.min(...state.config.fleet.map((g) => AIRCRAFT_SPECS[g.type].minCeilingFt));
  const minVis = Math.min(...state.config.fleet.map((g) => AIRCRAFT_SPECS[g.type].minVisibilityM));
  if (w.ceilingFt < minCeil) return { open: false, reason: msg("field.ceiling", { ft: w.ceilingFt.toFixed(0) }) };
  if (w.visibilityM < minVis) return { open: false, reason: msg("field.visibility", { m: w.visibilityM.toFixed(0) }) };
  return { open: true, reason: null };
}

function crewAvailable(state: SimState, need: { mech: number; tech: number; arms: number }): boolean {
  return state.crew.every((c) => {
    const required = need[c.id];
    // Only the on-shift half of each group is available at a time.
    const onDuty = Math.floor(c.total / 2);
    return c.busy + required <= onDuty;
  });
}

function commitCrew(state: SimState, need: { mech: number; tech: number; arms: number }, sign: 1 | -1): void {
  for (const c of state.crew) c.busy = Math.max(0, c.busy + sign * need[c.id]);
}

function findFreeSlot(state: SimState): number | null {
  const s = state.slots.find((x) => x.occupiedBy === null && !(x.gseDownUntil !== null && state.hours < x.gseDownUntil));
  return s ? s.index : null;
}

function findFreeBay(state: SimState, required: FacilityType): number | null {
  // Prefer the lowest-capability bay that can do the job, so a major workshop is
  // not consumed by a wheel change. This is basic good practice that the manual
  // policy deliberately does NOT do — see policy.ts.
  const order: FacilityType[] = ["service_bay", "minor_workshop", "major_workshop"];
  for (const level of order) {
    if (!facilityCanHandle(level, required)) continue;
    const bay = state.bays.find((b) => b.level === level && b.occupiedBy === null);
    if (bay) return bay.index;
  }
  return null;
}

function findAnyFreeBay(state: SimState, required: FacilityType): number | null {
  const bay = state.bays.find((b) => b.occupiedBy === null && facilityCanHandle(b.level, required));
  return bay ? bay.index : null;
}

export function spec(ac: Aircraft) {
  return AIRCRAFT_SPECS[ac.type];
}

// ── main step ──────────────────────────────────────────────────────────────

export function step(state: SimState): void {
  const dt = STEP_HOURS;

  state.hours += dt;
  state.hourOfDay += dt;
  while (state.hourOfDay >= 24) {
    state.hourOfDay -= 24;
    state.dayOfYear = (state.dayOfYear % 365) + 1;
  }

  stepEnvironment(state, dt);
  stepCrew(state, dt);
  stepLogistics(state, dt);
  stepDemand(state, dt);

  // The policy layer sits BETWEEN the world and the aircraft loop, and may only
  // do what a human operator could do through the same API. Gap B / design §7.4.
  applyPolicy(state, rngFor(state, "duration"));

  stepAircraft(state, dt);
  stepKpi(state, dt);
}

function stepEnvironment(state: SimState, dt: number): void {
  const wRng = rngFor(state, "weather");
  // Reconstruct the latent AR(1) drivers from the stored weather each step. The
  // drivers are kept in the weather module's own state object, which we thread
  // through by storing it on the state tree.
  const ws: WeatherState = {
    w: state.weather,
    zTemp: state.rngStates.__zTemp ?? 0,
    zWind: state.rngStates.__zWind ?? 0,
    zCloud: state.rngStates.__zCloud ?? 0,
    zFront: state.rngStates.__zFront ?? 0,
  };
  const next = stepWeather(ws, state.dayOfYear, state.hourOfDay, dt, wRng);
  const prevPrecip = state.weather.precip;
  state.weather = next.w;
  state.rngStates.__zTemp = next.zTemp;
  state.rngStates.__zWind = next.zWind;
  state.rngStates.__zCloud = next.zCloud;
  state.rngStates.__zFront = next.zFront;

  // Log the onset of precipitation, not every transition between neighbouring
  // types — otherwise a temperature hovering near zero fills the log with
  // sleet/freezing-rain churn and buries the operationally relevant events.
  if (prevPrecip === "none" && next.w.precip !== "none") {
    logEvent(state, "info", "weather", msg("ev.precipStart", { type: `precip.${next.w.precip}`, rate: next.w.precipRate.toFixed(1) }));
  } else if (prevPrecip !== "none" && next.w.precip === "none") {
    logEvent(state, "ok", "weather", msg("ev.precipEnd"));
  }

  state.solar = solarState(state.dayOfYear, state.hourOfDay, state.config.latDeg, state.config.lonDeg);

  // Runway clearance: contamination above threshold closes the field.
  if (
    state.weather.runwayContamMm > ENV_EFFECTS.runwayClearThresholdMm &&
    (state.runwayClosedUntil === null || state.hours >= state.runwayClosedUntil)
  ) {
    const hrs = sampleDuration(ENV_EFFECTS.runwayClearHours, rngFor(state, "duration"), 0.2);
    state.runwayClosedUntil = state.hours + hrs;
    state.weather.runwayContamMm = 0;
    logEvent(
      state,
      "warning",
      "weather",
      msg("ev.runwayClosed", { mins: (hrs * 60).toFixed(0), braking: braking(state.weather).labelKey }),
    );
  }

  const field = fieldStatus(state);
  const wasHold = state.weatherHold;
  state.weatherHold = !field.open;
  if (state.weatherHold && !wasHold) {
    logEvent(state, "warning", "weather", msg("ev.launchBan", { reason: field.reason ? field.reason.k : "" }));
  } else if (!state.weatherHold && wasHold) {
    logEvent(state, "ok", "weather", msg("ev.minimaMet"));
  }
  if (state.weatherHold) state.kpi.weatherHoldHours += dt;
}

function stepCrew(state: SimState, dt: number): void {
  // Two shifts; swap at the shift boundary.
  const shiftIdx = (Math.floor(state.hours / CREW.shiftHours) % 2) + 1;
  for (const c of state.crew) {
    if (c.onShift !== shiftIdx) {
      c.onShift = shiftIdx as 1 | 2;
      c.fatigue = Math.max(0, c.fatigue - 0.55);
      logEvent(state, "info", "crew", msg("ev.shiftChange", { trade: `crew.${c.id}`, n: shiftIdx }));
    }
    // Fatigue accrues with load, not merely with time on shift.
    const onDuty = Math.max(1, Math.floor(c.total / 2));
    const load = clamp(c.busy / onDuty, 0, 1);
    c.fatigue = clamp(c.fatigue + dt * CREW.fatiguePerHourOnShift * (0.35 + 0.65 * load), 0, 1);
  }
}

function stepLogistics(state: SimState, dt: number): void {
  const rng = rngFor(state, "logistics");
  for (const p of state.spares) {
    const arrived = p.inbound.filter((t) => t <= state.hours);
    if (arrived.length > 0) {
      p.inbound = p.inbound.filter((t) => t > state.hours);
      for (const _ of arrived) {
        // Error class 4: a delivery can arrive short.
        if (rng.chance(RELIABILITY.resupplyLateProb * 0.4)) {
          logEvent(state, "warning", "logistics", msg("ev.deliveryShort", { part: `spare.${p.id}` }));
        } else {
          p.qty = Math.min(p.max, p.qty + 1);
          logEvent(state, "ok", "logistics", msg("ev.deliveryOk", { part: `spare.${p.id}`, qty: p.qty, max: p.max }));
        }
      }
    }
  }
  // Fuel and munitions trickle in as scheduled resupply.
  state.fuelM3 = Math.min(state.fuelMaxM3, state.fuelM3 + dt * 2.5);
  state.munitions = Math.min(state.munitionsMax, state.munitions + dt * 0.35);
}

/** Generate ATO demand at the scenario tempo. */
function stepDemand(state: SimState, dt: number): void {
  const rng = rngFor(state, "demand");
  const tempo = TEMPO[state.config.tempo];
  const perHour = tempo.sortieDemandPerDay / 24;
  // Poisson-ish arrival via a per-step Bernoulli.
  if (!rng.chance(perHour * dt)) return;

  const types: { t: Mission["type"]; ac: AircraftTypeId; count: number; window: number }[] = [
    { t: "QRA", ac: "GripenE", count: 2, window: 1.5 },
    { t: "DCA", ac: "GripenE", count: 2, window: 4 },
    { t: "RECCE", ac: "GripenE", count: 1, window: 6 },
    { t: "AI_ST", ac: "GripenE", count: 2, window: 5 },
    { t: "ESCORT", ac: "GripenF_EA", count: 1, window: 5 },
    { t: "AEW", ac: "GlobalEye", count: 1, window: 8 },
  ];
  const pickWeights = state.config.tempo === "FRED" ? [0.4, 0.3, 0.2, 0.0, 0.0, 0.1] : [0.2, 0.25, 0.15, 0.2, 0.1, 0.1];
  let r = rng.next();
  let chosen = types[0];
  for (let i = 0; i < types.length; i++) {
    r -= pickWeights[i];
    if (r <= 0) {
      chosen = types[i];
      break;
    }
  }

  const id = `M${String(state.nextMissionId++).padStart(3, "0")}`;
  state.missions.push({
    id,
    label: `${chosen.t} ${id}`,
    type: chosen.t,
    requiredType: chosen.ac,
    requiredCount: chosen.count,
    taskedAtHours: state.hours,
    deadlineHours: state.hours + chosen.window,
    assigned: [],
    status: "pending",
  });
  state.kpi.sortiesTasked += chosen.count;
  logEvent(state, "info", "mission", msg("ev.newAto", { type: `mission.${chosen.t}`, count: chosen.count, ac: chosen.ac }));
}

function releaseSlot(state: SimState, ac: Aircraft): void {
  if (ac.slot !== null) {
    const s = state.slots[ac.slot];
    if (s && s.occupiedBy === ac.id) s.occupiedBy = null;
    ac.slot = null;
  }
}

function releaseBay(state: SimState, ac: Aircraft): void {
  if (ac.bay !== null) {
    const b = state.bays[ac.bay];
    if (b && b.occupiedBy === ac.id) b.occupiedBy = null;
    ac.bay = null;
  }
}

function raiseJob(
  state: SimState,
  ac: Aircraft,
  job: Omit<MaintenanceJob, "doneHours" | "active" | "raisedAtHours">,
): void {
  ac.job = { ...job, doneHours: 0, active: false, raisedAtHours: state.hours };
  ac.status = "unavailable";
  ac.activity = msg("act.waiting", { what: job.label });
  ac.activityEndsAt = null;
}

/** Turn an Utfall row into a job, rolling the deck's T++ extra-time table. */
function outcome2job(
  outcome: { kind: MaintenanceJob["kind"]; label: string; facility: FacilityType; capability: string; repairHours: number; sparePart?: MaintenanceJob["sparePart"] },
  rng: Rng,
): Omit<MaintenanceJob, "doneHours" | "active" | "raisedAtHours"> {
  const { hours, extraPct } = applyExtraTime(outcome.repairHours, rng);
  return {
    kind: outcome.kind,
    label: outcome.label,
    facility: outcome.facility,
    capability: outcome.capability,
    totalHours: hours,
    extraPct,
    sparePart: outcome.sparePart,
  };
}

/** Maximum deferred defects an airframe may carry before it is grounded. */
export const MAX_DEFERRED = 3;
/** How long a deferred defect may be carried before it must be cleared, hours. */
export const DEFER_WINDOW_HOURS = 72;

/**
 * Record a defect that does not ground the aircraft.
 *
 * Previously the four "serviceable" Utfall outcomes were simply discarded, so
 * two thirds of every defect the deck's own table produces vanished — the work,
 * the spare part and the bay time all went unmodelled. A real fleet carries such
 * findings on a deferred-defect / MEL list: the aircraft keeps flying, but the
 * work is still owed, and the list is a debt that eventually has to be paid.
 *
 * This is what gives opportunistic maintenance something to do, and it is where
 * a planner can actually beat a reactive operator: idle bay capacity spent now
 * prevents a forced grounding later.
 */
function deferDefect(state: SimState, ac: Aircraft, job: Omit<MaintenanceJob, "doneHours" | "active" | "raisedAtHours">): void {
  ac.deferredDefects.push({
    ...job,
    doneHours: 0,
    active: false,
    raisedAtHours: state.hours,
    deferUntilHours: state.hours + DEFER_WINDOW_HOURS,
  });
}

/** Promote the most urgent deferred defect into a grounding job. */
function promoteDeferred(state: SimState, ac: Aircraft, reason: string): void {
  if (ac.deferredDefects.length === 0) return;
  ac.deferredDefects.sort((a, b) => (a.deferUntilHours ?? 0) - (b.deferUntilHours ?? 0));
  const job = ac.deferredDefects.shift()!;
  state.kpi.forcedGroundings++;
  logEvent(state, "warning", "maintenance", msg("ev.deferredDue", { tail: ac.tail, label: job.label, reason }));
  raiseJob(state, ac, job);
}

function beginMaintenance(state: SimState, ac: Aircraft): void {
  const job = ac.job;
  if (!job || job.active) return;

  // The tool policy uses tight bay matching; the manual baseline grabs whatever
  // fits first, which wastes heavy capacity. Both are legal operator behaviour.
  const bayIdx =
    state.config.policy === "tool" ? findFreeBay(state, job.facility) : findAnyFreeBay(state, job.facility);
  if (bayIdx === null) {
    job.blockedBy = "bay";
    return;
  }
  if (job.sparePart) {
    const part = state.spares.find((p) => p.id === job.sparePart);
    if (!part || part.qty <= 0) {
      // Count a stockout once per blocking EVENT, not once per step. beginMaintenance
      // is retried every tick while a job is blocked, so incrementing here
      // unconditionally inflated the counter by ~3600x.
      if (part && job.blockedBy !== "part") {
        part.stockouts++;
        state.kpi.stockouts++;
      }
      job.blockedBy = "part";
      return;
    }
  }
  const need = job.kind === "complex_lru" || job.kind === "direct_repair"
    ? PERSONNEL_PER_TASK.maintenance_complex
    : PERSONNEL_PER_TASK.maintenance_quick;
  if (!crewAvailable(state, need)) {
    job.blockedBy = "crew";
    return;
  }

  if (job.sparePart) {
    const part = state.spares.find((p) => p.id === job.sparePart)!;
    part.qty--;
    // Reorder immediately; lead time is a distribution, not the deck's flat 5 days.
    const lead = sampleDuration(RELIABILITY.resupplyLeadDays, rngFor(state, "logistics"), 1) * 24;
    part.inbound.push(state.hours + lead);
  }

  commitCrew(state, need, 1);
  state.bays[bayIdx].occupiedBy = ac.id;
  ac.bay = bayIdx;
  job.active = true;
  job.blockedBy = undefined;
  ac.status = "under_maintenance";
  ac.activity = msg(job.label);
  ac.activityEndsAt = state.hours + (job.totalHours - job.doneHours);
}

/**
 * Allocate free bays to the aircraft waiting for them.
 *
 * Done as a separate pass so the ORDER is a policy decision rather than an
 * accident of array position.
 *
 * The tool uses shortest-processing-time-first, which is the classic result for
 * minimising mean flow time through a bottleneck: clearing three two-hour jobs
 * returns three airframes to the line before one sixteen-hour job returns any.
 * The baseline takes them in fleet order, which is what happens when nobody is
 * looking at the queue as a queue.
 */
function assignBays(state: SimState): void {
  const blocked = state.aircraft.filter((a) => a.status === "unavailable" && a.job);
  if (blocked.length === 0) return;

  const order =
    state.config.policy === "tool"
      ? [...blocked].sort((a, b) => {
          const ra = a.job!.totalHours - a.job!.doneHours;
          const rb = b.job!.totalHours - b.job!.doneHours;
          return ra - rb;
        })
      : blocked;

  for (const ac of order) beginMaintenance(state, ac);
}

function stepAircraft(state: SimState, dt: number): void {
  assignBays(state);
  const failRng = rngFor(state, "failure");
  const humanRng = rngFor(state, "human");
  const utfallRng = rngFor(state, "utfall");
  const durRng = rngFor(state, "duration");
  const field = fieldStatus(state);

  for (const ac of state.aircraft) {
    switch (ac.status) {
      case "unavailable": {
        // Waiting for a bay / part / crew. This wait is exactly the avoidable
        // loss the management tool is supposed to reduce, so it is metered.
        if (ac.job) {
          ac.avoidableWaitHours += dt;
          state.kpi.avoidableWaitHours += dt;
          ac.activity = msg("act.waiting", {
            what: ac.job.blockedBy === "part" ? "act.part" : ac.job.blockedBy === "crew" ? "act.crew" : "act.bay",
          });
          // Bay acquisition happens in assignBays(), in policy-determined order.
        } else {
          ac.status = "ready";
        }
        break;
      }

      case "under_maintenance": {
        const job = ac.job!;
        job.doneHours += dt;
        if (job.doneHours >= job.totalHours) {
          const need = job.kind === "complex_lru" || job.kind === "direct_repair"
            ? PERSONNEL_PER_TASK.maintenance_complex
            : PERSONNEL_PER_TASK.maintenance_quick;
          commitCrew(state, need, -1);
          releaseBay(state, ac);
          ac.job = null;
          ac.health = Math.min(100, ac.health + 12);
          if (job.kind === "scheduled_service") {
            ac.hoursToService = SERVICE_INTERVAL_HOURS;
            ac.health = Math.min(100, ac.health + 8);
          }
          ac.status = "ready";
          ac.activity = null;
          ac.activityEndsAt = null;
          logEvent(state, "ok", "maintenance", msg("ev.maintDone", { tail: ac.tail, label: job.label, hours: job.totalHours.toFixed(1) }));
        }
        break;
      }

      case "allocated": {
        // Try to get into a prep slot.
        const slotIdx = findFreeSlot(state);
        if (slotIdx === null) {
          ac.avoidableWaitHours += dt;
          state.kpi.avoidableWaitHours += dt;
          ac.activity = msg("act.waiting", { what: "act.prepSlot" });
          break;
        }
        if (!crewAvailable(state, PERSONNEL_PER_TASK.prep)) {
          ac.avoidableWaitHours += dt;
          state.kpi.avoidableWaitHours += dt;
          ac.activity = msg("act.waiting", { what: "act.prepTeam" });
          break;
        }
        const s = spec(ac);
        if (state.fuelM3 < s.fuelM3) {
          ac.avoidableWaitHours += dt;
          state.kpi.avoidableWaitHours += dt;
          ac.activity = msg("act.waiting", { what: "act.fuel" });
          break;
        }

        // Error class 3: ground support equipment can fail at the slot.
        if (humanRng.chance(RELIABILITY.gseFailurePerTask)) {
          const down = sampleDuration(RELIABILITY.gseRepairHours, durRng, 0.2);
          state.slots[slotIdx].gseDownUntil = state.hours + down;
          state.kpi.gseFailures++;
          logEvent(state, "warning", "maintenance", msg("ev.gseFault", { slot: slotIdx + 1, mins: (down * 60).toFixed(0) }));
          break;
        }

        state.slots[slotIdx].occupiedBy = ac.id;
        ac.slot = slotIdx;
        commitCrew(state, PERSONNEL_PER_TASK.prep, 1);

        let mins = sampleDuration(s.prepMinutes, durRng, 8) * prepEnvMultiplier(state);
        // Weather coupling: de-icing is an extra task, not a free pass.
        if (state.weather.icingRisk > ENV_EFFECTS.deiceThreshold) {
          const deice = sampleDuration(ENV_EFFECTS.deiceMinutes, durRng, 4);
          mins += deice;
          logEvent(state, "info", "weather", msg("ev.deice", { tail: ac.tail, mins: deice.toFixed(0), risk: (state.weather.icingRisk * 100).toFixed(0) }));
        }

        state.fuelM3 -= s.fuelM3;
        ac.fuel = 1;
        const munNeed = Math.round(s.munitionsPerSortie * TEMPO[state.config.tempo].munitionsUse);
        if (munNeed > 0 && state.munitions >= munNeed) {
          state.munitions -= munNeed;
          ac.munitions = munNeed;
        }

        ac.status = "in_preparation";
        ac.activity = msg("act.turnaround");
        ac.activityEndsAt = state.hours + mins / 60;
        break;
      }

      case "in_preparation": {
        if (ac.activityEndsAt !== null && state.hours >= ac.activityEndsAt) {
          commitCrew(state, PERSONNEL_PER_TASK.prep, -1);
          releaseSlot(state, ac);

          // Error class 2: human error during prep — misload or missed step.
          if (humanRng.chance(humanErrorProb(state))) {
            state.kpi.humanErrors++;
            const redo = sampleDuration({ kind: "pert", min: 10, mode: 22, max: 55 }, durRng, 5);
            logEvent(state, "warning", "crew", msg("ev.humanError", { tail: ac.tail, mins: redo.toFixed(0) }));
            ac.status = "allocated";
            ac.activity = msg("act.rework");
            break;
          }

          // Startup BIT. A defect is not certain — the gate decides whether one
          // occurred, the deck's Utfall table A then classifies it.
          const hasDefect = utfallRng.chance(RELIABILITY.defectProbPrep);
          const outcome = hasDefect ? rollUtfallA(utfallRng) : null;
          if (outcome && !outcome.serviceable) {
            const { hours, extraPct } = applyExtraTime(outcome.repairHours, utfallRng);
            logEvent(state, "critical", "maintenance", msg("ev.bitFault", { tail: ac.tail, label: outcome.label, hours: hours.toFixed(1), extra: extraPct ? `, T++${extraPct}%` : "" }));
            raiseJob(state, ac, {
              kind: outcome.kind,
              label: outcome.label,
              facility: outcome.facility,
              capability: outcome.capability,
              totalHours: hours,
              extraPct,
              sparePart: outcome.sparePart,
            });
            // The mission loses this airframe.
            if (ac.missionId) {
              const m = state.missions.find((x) => x.id === ac.missionId);
              if (m) m.assigned = m.assigned.filter((x) => x !== ac.id);
              ac.missionId = null;
            }
            break;
          }
          if (outcome) deferDefect(state, ac, outcome2job(outcome, utfallRng));

          ac.status = "awaiting_launch";
          ac.activity = msg("act.readyToLaunch");
          ac.activityEndsAt = null;
        }
        break;
      }

      case "awaiting_launch": {
        if (!field.open) {
          // Held by weather. Not "avoidable" — no plan makes the crosswind go away.
          ac.activity = msg("act.holding", { reason: field.reason ? field.reason.k : "" });
          break;
        }
        const s = spec(ac);
        const dur = sampleDuration(s.sortieHours, durRng, 0.3);
        ac.status = "on_mission";
        ac.activity = msg("act.mission");
        ac.activityEndsAt = state.hours + dur;
        ac.sorties++;
        state.kpi.sortiesFlown++;
        const m = state.missions.find((x) => x.id === ac.missionId);
        if (m && m.status === "assigned") {
          m.status = "launched";
          logEvent(state, "ok", "mission", msg("ev.launched", { label: m.label, n: m.assigned.length }));
        }
        break;
      }

      case "on_mission": {
        if (ac.activityEndsAt !== null && state.hours >= ac.activityEndsAt) {
          ac.status = "returning";
          ac.activity = msg("act.returnFlight");
          ac.activityEndsAt = state.hours + 0.25;
        } else {
          // Error class 1: technical failure in flight, as a proper hazard rate.
          // Wear matters: an airframe near its service limit is more likely to
          // fail, which is what makes keeping the fleet de-phased worth doing.
          const wear = 1 - clamp(ac.hoursToService / SERVICE_INTERVAL_HOURS, 0, 1);
          const rate = RELIABILITY.technicalFailurePerFlightHour * (1 + RELIABILITY.wearFailureMult * wear);
          const p = hazardProb(rate, dt);
          if (failRng.chance(p)) {
            state.kpi.technicalFailures++;
            ac.health = Math.max(20, ac.health - 10);
            logEvent(state, "warning", "maintenance", msg("ev.airFail", { tail: ac.tail }));
            ac.status = "returning";
            ac.activity = msg("act.emergencyReturn");
            ac.activityEndsAt = state.hours + 0.2;
          }
        }
        break;
      }

      case "returning": {
        if (ac.activityEndsAt !== null && state.hours >= ac.activityEndsAt) {
          if (!field.open) {
            // A returning aircraft cannot simply wait — this is the real
            // operational bite of weather, and worth showing explicitly.
            ac.activity = msg("act.awaitingApproach", { reason: field.reason ? field.reason.k : "" });
            break;
          }
          const s = spec(ac);
          const flown = s.sortieHours.kind === "lognormal" ? s.sortieHours.median : 1;
          ac.flightHours += flown;
          ac.hoursToService = Math.max(0, ac.hoursToService - flown);
          ac.health = Math.max(10, ac.health - flown * 0.8);
          ac.fuel = 0.15;
          ac.lastLandingAt = state.hours;
          ac.munitions = 0;
          ac.status = "recovering";
          ac.activity = msg("act.reception");
          ac.activityEndsAt = state.hours + (sampleDuration(s.receptionMinutes, durRng, 6) * prepEnvMultiplier(state)) / 60;

          const m = state.missions.find((x) => x.id === ac.missionId);
          if (m && m.status === "launched") {
            const stillOut = state.aircraft.some((o) => o.missionId === m.id && isAirborne(o.status));
            if (!stillOut) {
              m.status = "complete";
              state.kpi.missionsComplete++;
              logEvent(state, "ok", "mission", msg("ev.complete", { label: m.label }));
            }
          }
          ac.missionId = null;
        }
        break;
      }

      case "recovering": {
        if (ac.activityEndsAt !== null && state.hours >= ac.activityEndsAt) {
          // Reception check. Same structure as BIT: gate, then classify.
          const hasDefect = utfallRng.chance(RELIABILITY.defectProbReception);
          const outcome = hasDefect ? rollUtfallB(utfallRng) : null;
          const weaponLoss = WEAPON_LOSS_PCT[utfallRng.roll(6) - 1];
          if (outcome && !outcome.serviceable) {
            const { hours, extraPct } = applyExtraTime(outcome.repairHours, utfallRng);
            logEvent(state, "warning", "maintenance", msg("ev.reception", { tail: ac.tail, label: outcome.label, hours: hours.toFixed(1) }));
            raiseJob(state, ac, {
              kind: outcome.kind,
              label: outcome.label,
              facility: outcome.facility,
              capability: outcome.capability,
              totalHours: hours,
              extraPct,
              sparePart: outcome.sparePart,
            });
          } else if (outcome) {
            // Serviceable finding: goes on the deferred list, aircraft stays flyable.
            deferDefect(state, ac, outcome2job(outcome, utfallRng));
            ac.status = "ready";
            ac.activity = null;
            ac.activityEndsAt = null;
            if (ac.lastLandingAt !== null) {
              state.kpi.turnaroundSum += state.hours - ac.lastLandingAt;
              state.kpi.turnaroundCount++;
            }
          } else if (ac.hoursToService <= 0) {
            // The 100 h scheduled service is a hard airworthiness limit, not a
            // suggestion. Reaching it grounds the airframe until the service is
            // done, and because it was not planned there is no bay reserved — so
            // it queues behind whatever corrective work is already in progress.
            //
            // This is the consequence that makes preventive maintenance rational.
            // Without it, deferring service is free and no planner can beat a
            // policy that simply flies everything until it drops.
            logEvent(state, "critical", "maintenance", msg("ev.serviceLimit", { tail: ac.tail }));
            raiseJob(state, ac, {
              kind: "scheduled_service",
              label: "Oplanerad service (100 h)",
              facility: "minor_workshop",
              capability: "AU Steg 2/3",
              // Unplanned work takes longer than the same job done in a slot you
              // chose: no kit staged, no crew briefed. @source ASSUMED.
              totalHours: 14,
              extraPct: 0,
            });
          } else {
            ac.status = "ready";
            ac.activity = null;
            ac.activityEndsAt = null;
            if (ac.lastLandingAt !== null) {
              const ta = state.hours - ac.lastLandingAt;
              state.kpi.turnaroundSum += ta;
              state.kpi.turnaroundCount++;
            }
          }
          void weaponLoss;
        }
        break;
      }

      case "ready": {
        // The deferred-defect debt comes due: too many carried at once, or one
        // held past its window, and the airframe is grounded whether or not the
        // operator chose the moment. This is the cost the baseline pays for never
        // using idle bay capacity.
        if (ac.deferredDefects.length >= MAX_DEFERRED) {
          promoteDeferred(state, ac, "ev.deferredMax");
        } else if (ac.deferredDefects.some((d) => (d.deferUntilHours ?? Infinity) <= state.hours)) {
          promoteDeferred(state, ac, "ev.deferredExpired");
        } else {
          ac.activity = ac.deferredDefects.length > 0 ? msg("act.deferredCount", { n: ac.deferredDefects.length }) : null;
        }
        break;
      }
    }
  }
}

function stepKpi(state: SimState, dt: number): void {
  const k = state.kpi;
  k.simHours = state.hours;
  const mc = state.aircraft.filter((a) => isMissionCapable(a.status)).length;
  const air = state.aircraft.filter((a) => isAirborne(a.status)).length;
  const maint = state.aircraft.filter((a) => isInMaintenance(a.status)).length;
  k.availabilityIntegral += mc * dt;
  k.bayBusyHours += state.bays.filter((b) => b.occupiedBy !== null).length * dt;
  k.bayCapacityHours += state.bays.length * dt;

  // Fail missions past their deadline that never launched.
  for (const m of state.missions) {
    if ((m.status === "pending" || m.status === "assigned") && state.hours > m.deadlineHours) {
      m.status = "failed";
      m.failReason = state.weatherHold ? "väder" : "resursbrist";
      k.missionsFailed++;
      for (const id of m.assigned) {
        const ac = state.aircraft.find((a) => a.id === id);
        if (ac && (ac.status === "allocated" || ac.status === "awaiting_launch")) {
          ac.missionId = null;
          if (ac.status === "allocated") ac.status = "ready";
        }
      }
      m.assigned = [];
      logEvent(state, "critical", "mission", msg("ev.failed", { label: m.label, reason: m.failReason === "weather" ? "ev.failWeather" : "ev.failResources" }));
    }
  }

  // Sample the history roughly every 15 sim-minutes.
  const lastSample = k.history[k.history.length - 1];
  if (!lastSample || state.hours - lastSample.hours >= 0.25) {
    k.history.push({
      hours: state.hours,
      missionCapable: mc,
      airborne: air,
      inMaintenance: maint,
      sortiesFlown: k.sortiesFlown,
      fulfilment: k.sortiesTasked > 0 ? k.sortiesFlown / k.sortiesTasked : 1,
      avoidableWaitHours: k.avoidableWaitHours,
    });
    if (k.history.length > 3000) k.history.shift();
  }
}

// ── derived read models for the UI ─────────────────────────────────────────

export function meanTurnaroundHours(state: SimState): number | null {
  return state.kpi.turnaroundCount > 0 ? state.kpi.turnaroundSum / state.kpi.turnaroundCount : null;
}

export function meanAvailability(state: SimState): number {
  return state.hours > 0 ? state.kpi.availabilityIntegral / state.hours : 0;
}

export function fulfilment(state: SimState): number {
  return state.kpi.sortiesTasked > 0 ? state.kpi.sortiesFlown / state.kpi.sortiesTasked : 1;
}

export function sortieRate(state: SimState): number {
  const days = state.hours / 24;
  return days > 0 ? state.kpi.sortiesFlown / days / state.aircraft.length : 0;
}

export function bayUtilisation(state: SimState): number {
  return state.kpi.bayCapacityHours > 0 ? state.kpi.bayBusyHours / state.kpi.bayCapacityHours : 0;
}
