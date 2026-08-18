/**
 * The management tool, and the baseline it is measured against.
 *
 * This closes Gap B and makes Gap C measurable.
 *
 * In both hackathon builds the "AI recommendation engine" is threshold triggers
 * whose applyAction is `{ type: "ADVANCE_HOUR" }` for 10 of 11 recommendations —
 * an explicit placeholder. The tool could observe but never act, and there was no
 * baseline to compare against, so "effective" was unmeasurable.
 *
 * Here there are two policies of equal standing:
 *
 *   manual — a plausible unaided operator. Assigns the first available airframe,
 *            does maintenance only when something breaks, reorders only on
 *            stockout. Not a straw man: it is what a busy human actually does
 *            under load.
 *   tool   — the decision-support policy. Same action API, same information, no
 *            privileged access to state. It just plans better.
 *
 * Design principle §7.4: the tool may only do what a human operator could do.
 * If it could reach into the world directly, any measured advantage would be
 * meaningless.
 */
import type { Rng } from "./rng";
import { AIRCRAFT_SPECS, CREW, RELIABILITY, SERVICE_INTERVAL_HOURS, TEMPO } from "./params";
import { nominal } from "./dist";
import { facilityCanHandle } from "./tables";
import type { Advice, Aircraft, Mission, SimState } from "./types";
import { isMissionCapable } from "./types";

export function applyPolicy(state: SimState, rng: Rng): void {
  // Advice is generated for BOTH policies, so the manual run can display exactly
  // what it is choosing to ignore. That side-by-side is the demo.
  state.advice = generateAdvice(state);

  if (state.config.policy === "tool") {
    toolPolicy(state, rng);
  } else {
    manualPolicy(state, rng);
  }
}

// ── shared helpers ─────────────────────────────────────────────────────────

function candidatesFor(state: SimState, m: Mission): Aircraft[] {
  return state.aircraft.filter((a) => a.type === m.requiredType && a.status === "ready" && a.missionId === null);
}

function assign(state: SimState, m: Mission, picks: Aircraft[]): void {
  for (const ac of picks) {
    ac.status = "allocated";
    ac.missionId = m.id;
    m.assigned.push(ac.id);
  }
  if (m.assigned.length >= m.requiredCount) m.status = "assigned";
}

function pendingMissions(state: SimState): Mission[] {
  return state.missions.filter((m) => m.status === "pending" || (m.status === "assigned" && m.assigned.length < m.requiredCount));
}

/** Priority order used by the tool. QRA is time-critical, AEW is long-lead. */
const MISSION_PRIORITY: Record<Mission["type"], number> = {
  QRA: 0,
  AEW: 1,
  DCA: 2,
  AI_ST: 3,
  ESCORT: 4,
  RECCE: 5,
};

// ── baseline ───────────────────────────────────────────────────────────────

function manualPolicy(state: SimState, _rng: Rng): void {
  // First-come-first-served over missions in the order they arrived, and the
  // first matching airframe in fleet order. No look-ahead of any kind.
  for (const m of state.missions) {
    if (m.status !== "pending" && !(m.status === "assigned" && m.assigned.length < m.requiredCount)) continue;
    const need = m.requiredCount - m.assigned.length;
    const picks = candidatesFor(state, m).slice(0, need);
    if (picks.length > 0) assign(state, m, picks);
  }

  // Reactive resupply only: order when a part hits zero, which is already too late
  // because the lead time is days.
  for (const p of state.spares) {
    if (p.qty === 0 && p.inbound.length === 0) {
      p.inbound.push(state.hours + 5 * 24);
    }
  }

  // No preventive maintenance. Aircraft fly until the airframe is out of service
  // hours, and then the service lands at whatever moment is least convenient.
}

// ── the tool ───────────────────────────────────────────────────────────────

function toolPolicy(state: SimState, rng: Rng): void {
  // 1. Work missions in priority-then-deadline order, not arrival order.
  const queue = pendingMissions(state).sort(
    (a, b) => MISSION_PRIORITY[a.type] - MISSION_PRIORITY[b.type] || a.deadlineHours - b.deadlineHours,
  );

  for (const m of queue) {
    const need = m.requiredCount - m.assigned.length;
    if (need <= 0) continue;

    const spec = AIRCRAFT_SPECS[m.requiredType];
    const expectedSortie = nominal(spec.sortieHours);

    // 2. Rank, but never exclude on service margin alone.
    //
    //    An earlier version filtered out airframes with less service life than the
    //    sortie needed. That looked prudent and measured WORSE: declining to
    //    assign can only ever lower sortie output, because a prepared airframe is
    //    never wasted — it launches as soon as the field opens, for whatever
    //    tasking is live. So the margin is a *sorting* preference, not a veto.
    //
    //    Airframes with least remaining life are spent LAST, which keeps the fleet
    //    de-phased and pushes the 100 h limits apart in time.
    const ranked = candidatesFor(state, m).sort((a, b) => {
      const aSafe = a.hoursToService > expectedSortie + 0.5 ? 1 : 0;
      const bSafe = b.hoursToService > expectedSortie + 0.5 ? 1 : 0;
      if (aSafe !== bSafe) return bSafe - aSafe;
      const healthDelta = b.health - a.health;
      if (Math.abs(healthDelta) > 6) return healthDelta;
      return b.hoursToService - a.hoursToService;
    });

    const timeLeft = m.deadlineHours - state.hours;
    const prepHours = nominal(spec.prepMinutes) / 60;

    // 3. Do not burn airframes on a mission the weather will not let launch
    //    before its deadline. Holding them ready is strictly better.
    if (state.weatherHold && timeLeft < prepHours * 1.2) continue;

    const picks = ranked.slice(0, need);
    if (picks.length > 0) assign(state, m, picks);
  }

  // 4. Spend idle bay capacity on the deferred-defect list.
  //
  //    This is the tool's strongest lever and the most realistic one. Every
  //    airframe is carrying findings it is legally allowed to fly with, and each
  //    one is a debt: carry three, or carry one too long, and the airframe is
  //    grounded at a moment the scenario chooses rather than one you chose. A
  //    reactive operator never touches them until that happens. Clearing the most
  //    urgent one while a bay is idle costs nothing that was otherwise being used.
  const idleBays = state.bays.filter((b) => b.occupiedBy === null).length;
  const groundedWaiting = state.aircraft.filter(
    (a) => a.status === "unavailable" && a.job && !a.job.active,
  ).length;

  if (idleBays >= 1 && groundedWaiting === 0) {
    const worstFirst = state.aircraft
      .filter((a) => a.status === "ready" && a.missionId === null && a.deferredDefects.length > 0)
      .sort((a, b) => {
        // Most defects first, then nearest deadline — the airframe closest to
        // being grounded by its own paperwork.
        if (b.deferredDefects.length !== a.deferredDefects.length) {
          return b.deferredDefects.length - a.deferredDefects.length;
        }
        const da = Math.min(...a.deferredDefects.map((d) => d.deferUntilHours ?? Infinity));
        const db = Math.min(...b.deferredDefects.map((d) => d.deferUntilHours ?? Infinity));
        return da - db;
      });

    // Only act when there is fleet slack, so clearing a defect never costs a sortie.
    const readySpare = state.aircraft.filter((a) => a.status === "ready" && a.missionId === null).length;
    const demandNow = pendingMissions(state).reduce((s, m) => s + (m.requiredCount - m.assigned.length), 0);
    if (worstFirst.length > 0 && readySpare - demandNow >= 2) {
      for (const target of worstFirst) {
        const sorted = [...target.deferredDefects].sort(
          (a, b) => (a.deferUntilHours ?? 0) - (b.deferUntilHours ?? 0),
        );
        // Only pull work forward that can START now: a bay of the right level must
        // be free, and the part must be on the shelf. Committing an airframe to a
        // job it then queues for is worse than leaving it flying — it converts a
        // serviceable aircraft into one sitting in avoidable wait, which is the
        // exact metric this policy is meant to reduce.
        const startable = sorted.find((d) => {
          const bayFree = state.bays.some((b) => b.occupiedBy === null && facilityCanHandle(b.level, d.facility));
          if (!bayFree) return false;
          if (!d.sparePart) return true;
          const part = state.spares.find((p) => p.id === d.sparePart);
          return !!part && part.qty > 0;
        });
        if (!startable) continue;

        target.deferredDefects = target.deferredDefects.filter((d) => d !== startable);
        target.job = { ...startable, deferUntilHours: undefined, active: false, raisedAtHours: state.hours };
        target.status = "unavailable";
        target.activity = `Planerad åtgärd: ${startable.label}`;
        state.kpi.plannedClearances++;
        break;
      }
    }
  }

  // 5. Preventive maintenance in genuine slack.
  //
  //    The guards here are the whole difficulty. A scheduled service occupies a
  //    workshop bay for the best part of a day, so doing it greedily starves the
  //    corrective queue and makes the fleet WORSE than leaving it alone — an
  //    earlier version of this policy did exactly that and lost to the baseline.
  //    Preventive work is only correct when there is spare bay capacity that
  //    corrective work is not waiting for.
  const freeBays = state.bays.filter((b) => b.occupiedBy === null).length;
  const correctiveWaiting = state.aircraft.filter(
    (a) => a.status === "unavailable" && a.job && a.job.kind !== "scheduled_service",
  ).length;
  const pmInProgress = state.aircraft.filter((a) => a.job?.kind === "scheduled_service").length;
  const uncoveredDemand = pendingMissions(state).reduce((s, m) => s + (m.requiredCount - m.assigned.length), 0);
  const readyCount = state.aircraft.filter((a) => a.status === "ready" && a.missionId === null).length;
  const slack = readyCount - uncoveredDemand;

  const bayHeadroomOk = freeBays >= 2 && correctiveWaiting === 0;
  if (bayHeadroomOk && pmInProgress === 0 && slack >= 2) {
    // Only take an airframe that has too little life left to be worth launching
    // anyway. It is going to be grounded on its next landing regardless, so this
    // costs no sortie — it simply converts a forced 14 h unplanned service at a
    // moment the scenario picks into a chosen 8 h planned one in a service bay.
    // That trade is the tool's real edge, and it is free.
    const shortestSortie = Math.min(
      ...state.config.fleet.map((g) => nominal(AIRCRAFT_SPECS[g.type].sortieHours)),
    );
    const dueSoon = state.aircraft
      .filter((a) => a.status === "ready" && a.missionId === null && a.hoursToService <= shortestSortie + 0.5)
      .sort((a, b) => a.hoursToService - b.hoursToService)[0];
    if (dueSoon) {
      // A compressed A-service. @source ASSUMED — the deck gives service type A
      // as 5 days, which is a rear-echelon figure; this models a forward partial.
      const serviceHours = 8;
      dueSoon.job = {
        kind: "scheduled_service",
        label: "Planerad service (A)",
        facility: "service_bay",
        capability: "AU Steg 1",
        totalHours: serviceHours,
        doneHours: 0,
        extraPct: 0,
        active: false,
        raisedAtHours: state.hours,
      };
      dueSoon.status = "unavailable";
      dueSoon.activity = "Inplanerad service";
    }
  }

  // 6. Reorder spares on a reorder point, not on stockout. With a multi-day lead
  //    time, ordering at zero guarantees a grounding.
  for (const p of state.spares) {
    const reorderPoint = Math.max(2, Math.ceil(p.max * 0.4));
    const onOrder = p.inbound.length;
    if (p.qty + onOrder <= reorderPoint) {
      const lead = 5 * 24;
      p.inbound.push(state.hours + lead);
    }
  }

  void rng;
}

// ── advice generation ──────────────────────────────────────────────────────

/**
 * Every recommendation carries a benefit AND a trade-off. That requirement comes
 * from the hackathon builds' Recommendation type and is the strongest design idea
 * in either of them — advice without its cost is not decision support.
 */
export function generateAdvice(state: SimState): Advice[] {
  const out: Advice[] = [];
  const push = (a: Omit<Advice, "acted">) => out.push({ ...a, acted: state.config.policy === "tool" });

  // Service margin
  const dueSoon = state.aircraft.filter((a) => isMissionCapable(a.status) && a.hoursToService < 10);
  if (dueSoon.length > 0) {
    push({
      id: "svc",
      title: `${dueSoon.length} flygplan nära 100 h-service`,
      detail: `${dueSoon.slice(0, 4).map((a) => `${a.tail} (${a.hoursToService.toFixed(1)} h)`).join(", ")}. Planera in service i lucka istället för att förlora dem mitt i ett uppdrag.`,
      benefit: "Undviker oplanerad grundning vid fel tidpunkt",
      tradeoff: `Flygplanet otillgängligt ~${(5 * 24 * 0.18).toFixed(0)} h under service`,
      priority: dueSoon.some((a) => a.hoursToService < 4) ? "critical" : "high",
      channel: "maintenance",
    });
  }

  // Spares below reorder point
  for (const p of state.spares) {
    const reorderPoint = Math.max(2, Math.ceil(p.max * 0.4));
    if (p.qty + p.inbound.length <= reorderPoint) {
      push({
        id: `part-${p.id}`,
        title: `${p.label} under beställningspunkt`,
        detail: `${p.qty}/${p.max} i lager, ${p.inbound.length} på väg. Ledtid är dagar — beställning vid noll ger garanterat stopp.`,
        benefit: "Undviker underhållsstopp i väntan på reservdel",
        tradeoff: "Binder lagerkapital och transportkapacitet",
        priority: p.qty === 0 ? "critical" : "high",
        channel: "logistics",
      });
    }
  }

  // Blocked jobs — the avoidable-wait driver
  const blocked = state.aircraft.filter((a) => a.status === "unavailable" && a.job?.blockedBy);
  if (blocked.length > 0) {
    const byReason = blocked.reduce<Record<string, number>>((acc, a) => {
      const r = a.job!.blockedBy!;
      acc[r] = (acc[r] ?? 0) + 1;
      return acc;
    }, {});
    push({
      id: "blocked",
      title: `${blocked.length} flygplan väntar på resurs`,
      detail: Object.entries(byReason)
        .map(([r, n]) => `${n} × ${r === "bay" ? "underhållsplats" : r === "part" ? "reservdel" : "personal"}`)
        .join(", ") + ". Prioritera korta LRU-jobb för att frigöra kapacitet.",
      benefit: "Minskar undvikbar väntetid direkt",
      tradeoff: "Skjuter upp tyngre jobb",
      priority: "high",
      channel: "maintenance",
    });
  }

  // Crew fatigue
  const tired = state.crew.filter((c) => c.fatigue > CREW.fatigueWarnThreshold);
  if (tired.length > 0) {
    push({
      id: "fatigue",
      title: `Hög belastning: ${tired.map((c) => c.label).join(", ")}`,
      detail: `Utmattning ${(tired[0].fatigue * 100).toFixed(0)} %. Felsannolikheten vid klargöring är nu ${errorMultiplier(state).toFixed(1)}× normalvärdet — skiftbyte rekommenderas.`,
      benefit: "Lägre andel handhavandefel och omarbete",
      tradeoff: "Kortvarigt lägre klargöringstakt under överlämning",
      priority: "medium",
      channel: "crew",
    });
  }

  // Weather hold
  if (state.weatherHold) {
    push({
      id: "wx",
      title: "Väderminima ej uppfyllda",
      detail: "Håll tilldelade flygplan i beredskap istället för att binda dem i klargöring som hinner kallna innan vädret släpper.",
      benefit: "Bevarar klargöringskapacitet till fönstret öppnar",
      tradeoff: "Längre svarstid när vädret väl tillåter start",
      priority: "high",
      channel: "weather",
    });
  }

  // Fuel endurance at current tempo
  const burnPerDay = TEMPO[state.config.tempo].sortieDemandPerDay * AIRCRAFT_SPECS.GripenE.fuelM3;
  const daysLeft = burnPerDay > 0 ? state.fuelM3 / burnPerDay : 99;
  if (daysLeft < 2.5) {
    push({
      id: "fuel",
      title: `Bränsleuthållighet ${daysLeft.toFixed(1)} dygn`,
      detail: `${state.fuelM3.toFixed(0)} m³ kvar vid nuvarande insatstakt (${state.config.tempo}).`,
      benefit: "Undviker att uppdrag faller på bränslebrist",
      tradeoff: "Kräver transportresurser som konkurrerar med reservdelar",
      priority: daysLeft < 1.2 ? "critical" : "high",
      channel: "logistics",
    });
  }

  // Unassignable demand
  const unmet = pendingMissions(state).filter((m) => candidatesFor(state, m).length < m.requiredCount - m.assigned.length);
  if (unmet.length > 0) {
    push({
      id: "unmet",
      title: `${unmet.length} ATO-rader utan tillräckligt underlag`,
      detail: unmet.slice(0, 3).map((m) => `${m.label} behöver ${m.requiredCount - m.assigned.length} × ${m.requiredType}`).join("; "),
      benefit: "Tidig varning ger tid att omfördela eller omplanera",
      tradeoff: "Kan kräva att lägre prioriterade uppdrag stryks",
      priority: "critical",
      channel: "mission",
    });
  }

  return out.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.priority] - order[b.priority];
  });
}

/** How much more likely a prep error is right now than at rested/daylight baseline.
 *  Mirrors humanErrorProb() in engine.ts, expressed as a multiplier for display. */
export function errorMultiplier(state: SimState): number {
  const crewFatigue = state.crew.reduce((s, c) => s + c.fatigue, 0) / state.crew.length;
  const fatigueMult = 1 + (RELIABILITY.humanErrorFatigueMult - 1) * crewFatigue;
  const nightMult = 1 + (RELIABILITY.humanErrorNightMult - 1) * (1 - state.solar.daylight);
  return fatigueMult * nightMult;
}

/** Only used for display: how many service hours the fleet has banked. */
export function fleetServiceMargin(state: SimState): number {
  return state.aircraft.reduce((s, a) => s + a.hoursToService, 0) / (state.aircraft.length * SERVICE_INTERVAL_HOURS);
}
