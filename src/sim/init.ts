/**
 * Initial state construction.
 */
import { createRng, deriveSeed } from "./rng";
import { AIRCRAFT_SPECS, BASE_CAPACITY, SERVICE_INTERVAL_HOURS, type AircraftTypeId } from "./params";
import { SPARE_LABEL_KEY, type FacilityType, type SparePartId } from "./tables";
import { initWeather } from "./weather";
import { solarState } from "./solar";
import type { Kpi, SimConfig, SimState } from "./types";

export const DEFAULT_CONFIG: SimConfig = {
  seed: 20260819,
  // Mid-January: ~6.5 h of daylight, cold, high icing risk. The hard case, and
  // a deliberately better demo than a benign July afternoon.
  startDayOfYear: 15,
  startHour: 5,
  // Såtenäs (F 7) — a real Swedish air base location, used only for solar geometry.
  latDeg: 58.43,
  lonDeg: 12.71,
  runwayHeadingDeg: 30,
  baseType: "huvudbas",
  tempo: "KRIS",
  policy: "tool",
  fleet: [
    { type: "GripenE", count: 12 },
    { type: "GripenF_EA", count: 4 },
    { type: "GlobalEye", count: 2 },
  ],
};

const TAIL_PREFIX: Record<AircraftTypeId, string> = {
  GripenE: "39",
  GripenF_EA: "39F",
  GlobalEye: "GE",
};

function emptyKpi(): Kpi {
  return {
    simHours: 0,
    sortiesFlown: 0,
    sortiesTasked: 0,
    missionsComplete: 0,
    missionsFailed: 0,
    availabilityIntegral: 0,
    avoidableWaitHours: 0,
    turnaroundSum: 0,
    turnaroundCount: 0,
    stockouts: 0,
    bayBusyHours: 0,
    bayCapacityHours: 0,
    weatherHoldHours: 0,
    humanErrors: 0,
    technicalFailures: 0,
    gseFailures: 0,
    forcedGroundings: 0,
    plannedClearances: 0,
    history: [],
  };
}

export function createSim(config: SimConfig): SimState {
  const cfg = { ...config };
  const setupRng = createRng(deriveSeed(cfg.seed, "setup"));
  const cap = BASE_CAPACITY[cfg.baseType];

  // Fleet
  const aircraft: SimState["aircraft"] = [];
  let n = 0;
  for (const group of cfg.fleet) {
    for (let i = 0; i < group.count; i++) {
      n++;
      const idx = i + 1;
      // Stagger initial airframe life so the fleet does not all hit the 100 h
      // service at once — a real squadron is deliberately de-phased.
      const flightHours = Math.round(setupRng.range(0, SERVICE_INTERVAL_HOURS * 0.92));
      aircraft.push({
        id: `AC${String(n).padStart(2, "0")}`,
        tail: `${TAIL_PREFIX[group.type]}-${String(idx).padStart(2, "0")}`,
        type: group.type,
        status: "ready",
        health: Math.round(setupRng.range(82, 100)),
        flightHours,
        hoursToService: SERVICE_INTERVAL_HOURS - (flightHours % SERVICE_INTERVAL_HOURS),
        fuel: setupRng.range(0.5, 1),
        munitions: 0,
        activityEndsAt: null,
        activity: null,
        slot: null,
        bay: null,
        job: null,
        missionId: null,
        lastLandingAt: null,
        avoidableWaitHours: 0,
        sorties: 0,
        deferredDefects: [],
      });
    }
  }

  // Maintenance bays by facility level
  const bays: SimState["bays"] = [];
  const pushBays = (level: FacilityType, count: number) => {
    for (let i = 0; i < count; i++) bays.push({ index: bays.length, level, occupiedBy: null });
  };
  pushBays("service_bay", cap.serviceBay);
  pushBays("minor_workshop", cap.minorWorkshop);
  pushBays("major_workshop", cap.majorWorkshop);

  const slots: SimState["slots"] = Array.from({ length: cap.prepSlots }, (_, i) => ({
    index: i,
    occupiedBy: null,
    gseDownUntil: null,
  }));

  const spareIds: SparePartId[] = ["computer", "radar", "hydraulic", "wheel"];
  const spares = spareIds.map((id) => ({
    id,
    label: SPARE_LABEL_KEY[id],
    // Deliberately thin initial stock: the deck (p.15) is explicit that UE is
    // limited and that shortage consequences are the point of the exercise.
    qty: id === "wheel" ? 6 : 3,
    max: id === "wheel" ? 10 : 6,
    inbound: [] as number[],
    stockouts: 0,
  }));

  const crew: SimState["crew"] = [
    { id: "mech", label: "crew.mech", total: 24, busy: 0, fatigue: 0.1, onShift: 1 },
    { id: "tech", label: "crew.tech", total: 10, busy: 0, fatigue: 0.1, onShift: 1 },
    { id: "arms", label: "crew.arms", total: 8, busy: 0, fatigue: 0.1, onShift: 1 },
  ];

  const weatherRng = createRng(deriveSeed(cfg.seed, "weather"));
  const wx = initWeather(cfg.startDayOfYear, weatherRng);

  const totalFuel = cfg.fleet.reduce((s, g) => s + AIRCRAFT_SPECS[g.type].fuelM3 * g.count, 0);

  const state: SimState = {
    config: cfg,
    hours: 0,
    dayOfYear: cfg.startDayOfYear,
    hourOfDay: cfg.startHour,
    aircraft,
    missions: [],
    crew,
    spares,
    bays,
    slots,
    // ~6 sorties' worth of fuel for the whole fleet: enough to operate, thin
    // enough that resupply timing matters.
    fuelM3: totalFuel * 6,
    fuelMaxM3: totalFuel * 8,
    munitions: 60,
    munitionsMax: 90,
    weather: wx.w,
    solar: solarState(cfg.startDayOfYear, cfg.startHour, cfg.latDeg, cfg.lonDeg),
    runwayClosedUntil: null,
    weatherHold: false,
    events: [],
    kpi: emptyKpi(),
    advice: [],
    nextEventId: 1,
    nextMissionId: 1,
    rngStates: {
      weather: wx.zFront === 0 ? weatherRng.state() : weatherRng.state(),
      failure: deriveSeed(cfg.seed, "failure"),
      human: deriveSeed(cfg.seed, "human"),
      utfall: deriveSeed(cfg.seed, "utfall"),
      duration: deriveSeed(cfg.seed, "duration"),
      logistics: deriveSeed(cfg.seed, "logistics"),
      demand: deriveSeed(cfg.seed, "demand"),
    },
  };

  return state;
}
