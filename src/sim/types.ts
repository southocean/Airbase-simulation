/**
 * Simulation state types.
 *
 * Note the shape: this is a plain data tree with no React, no DOM, no imports
 * from the UI. That is Gap A — both hackathon builds keep state in a React
 * reducer coupled to rendering, which makes headless and batch runs impossible.
 */
import type { AircraftTypeId } from "./params";
import type { FacilityType, MaintenanceKind, SparePartId } from "./tables";
import type { Weather } from "./weather";
import type { SolarState } from "./solar";
import type { Msg } from "@/i18n";

/** The nine-state aircraft lifecycle, carried over from hackathon v2 —
 *  a genuinely good model and worth reusing verbatim. */
export type AircraftStatus =
  | "ready"
  | "allocated"
  | "in_preparation"
  | "awaiting_launch"
  | "on_mission"
  | "returning"
  | "recovering"
  | "under_maintenance"
  | "unavailable";

export const MISSION_CAPABLE: AircraftStatus[] = ["ready", "allocated", "in_preparation", "awaiting_launch"];
export const AIRBORNE: AircraftStatus[] = ["on_mission", "returning"];
export const IN_MAINTENANCE: AircraftStatus[] = ["under_maintenance", "unavailable"];

export function isMissionCapable(s: AircraftStatus): boolean {
  return MISSION_CAPABLE.includes(s);
}
export function isAirborne(s: AircraftStatus): boolean {
  return AIRBORNE.includes(s);
}
export function isInMaintenance(s: AircraftStatus): boolean {
  return IN_MAINTENANCE.includes(s);
}

export interface MaintenanceJob {
  kind: MaintenanceKind;
  label: string;
  facility: FacilityType;
  capability: string;
  /** Total hours of work required */
  totalHours: number;
  /** Hours of work completed */
  doneHours: number;
  /** T++ percentage that was rolled on */
  extraPct: number;
  sparePart?: SparePartId;
  /** True once a bay and (if needed) the spare part have been secured */
  active: boolean;
  /** Why the job is not progressing, if it is not */
  blockedBy?: "bay" | "part" | "crew";
  /** Sim-hour the job was raised — used for avoidable-wait accounting */
  raisedAtHours: number;
  /** For a deferred defect: the sim-hour by which it must be cleared. */
  deferUntilHours?: number;
}

export interface Aircraft {
  id: string;
  tail: string;
  type: AircraftTypeId;
  status: AircraftStatus;
  /** Airframe health 0–100 */
  health: number;
  /** Cumulative flight hours */
  flightHours: number;
  /** Hours remaining until the 100 h scheduled service */
  hoursToService: number;
  /** Fuel state 0–1 */
  fuel: number;
  /** Munitions loaded */
  munitions: number;
  /** Sim-hour at which the current activity completes */
  activityEndsAt: number | null;
  /** Sim-hour at which it began. Needed to know how far through it is, which the
   *  UI previously had to guess from a nominal duration. */
  activityStartedAt: number | null;
  /** Current activity as a structured message. */
  activity: Msg | null;
  /** Which prep slot / bay index is held, if any */
  slot: number | null;
  bay: number | null;
  job: MaintenanceJob | null;
  /** Mission this airframe is committed to */
  missionId: string | null;
  /** Sim-hour of last landing — drives turnaround KPI */
  lastLandingAt: number | null;
  /** Accumulated hours spent waiting for a resource that a better plan would
   *  have had ready. This is the tool's primary target metric. */
  /** Defects found but not grounding: the aircraft keeps flying with them, as a
   *  real fleet does under a deferred-defect / MEL regime. They still consume a
   *  bay and a part when eventually cleared, and if they pile up or time out the
   *  airframe is grounded whether the operator planned for it or not. */
  deferredDefects: MaintenanceJob[];
  avoidableWaitHours: number;
  sorties: number;
}

export interface Mission {
  id: string;
  label: string;
  type: "QRA" | "DCA" | "RECCE" | "AEW" | "AI_ST" | "ESCORT";
  requiredType: AircraftTypeId;
  requiredCount: number;
  /** Sim-hour the mission is tasked for */
  taskedAtHours: number;
  /** Latest acceptable launch, sim-hours */
  deadlineHours: number;
  assigned: string[];
  status: "pending" | "assigned" | "launched" | "complete" | "failed";
  /** Set when the mission could not be met, with the reason */
  failReason?: string;
}

export interface CrewGroup {
  id: "mech" | "tech" | "arms";
  label: string;
  total: number;
  /** Currently committed to a task */
  busy: number;
  /** 0–1; drives the human-error multiplier */
  fatigue: number;
  /** Which shift is on duty */
  onShift: 1 | 2;
}

export interface SparePartStock {
  id: SparePartId;
  label: string;
  qty: number;
  max: number;
  /** Orders in transit: sim-hour of arrival */
  inbound: number[];
  /** Times a job was blocked waiting for this part */
  stockouts: number;
}

export interface BayState {
  index: number;
  level: FacilityType;
  occupiedBy: string | null;
}

export interface SlotState {
  index: number;
  occupiedBy: string | null;
  /** GSE at this slot is down until this sim-hour */
  gseDownUntil: number | null;
}

export interface SimEvent {
  id: number;
  atHours: number;
  severity: "info" | "ok" | "warning" | "critical";
  /** Which subsystem raised it — lets the UI filter */
  channel: "mission" | "maintenance" | "weather" | "logistics" | "crew" | "tool";
  /** Structured message — the core emits keys, the UI renders language. */
  msg: Msg;
}

export interface Kpi {
  simHours: number;
  sortiesFlown: number;
  sortiesTasked: number;
  missionsComplete: number;
  missionsFailed: number;
  /** Time-weighted mean number of mission-capable aircraft */
  availabilityIntegral: number;
  /** Sum of avoidable waiting across the fleet, aircraft-hours */
  avoidableWaitHours: number;
  /** Sum of turnaround times observed, and the count, for a mean */
  turnaroundSum: number;
  turnaroundCount: number;
  stockouts: number;
  /** Sim-hours during which at least one bay was occupied, per bay */
  bayBusyHours: number;
  bayCapacityHours: number;
  weatherHoldHours: number;
  humanErrors: number;
  technicalFailures: number;
  gseFailures: number;
  /** Deferred defects that forced a grounding at a moment nobody chose. */
  forcedGroundings: number;
  /** Deferred defects cleared deliberately in idle capacity. */
  plannedClearances: number;
  /** Snapshots for charting */
  history: KpiSample[];
}

export interface KpiSample {
  hours: number;
  missionCapable: number;
  airborne: number;
  inMaintenance: number;
  sortiesFlown: number;
  fulfilment: number;
  avoidableWaitHours: number;
}

export type PolicyId = "manual" | "tool";

export interface SimConfig {
  seed: number;
  /** Day of year the run starts on — season matters enormously at 58°N */
  startDayOfYear: number;
  startHour: number;
  latDeg: number;
  lonDeg: number;
  /** Runway heading in degrees, for crosswind computation */
  runwayHeadingDeg: number;
  baseType: "huvudbas" | "sidobas" | "reservbas";
  tempo: "FRED" | "KRIS" | "KRIG";
  policy: PolicyId;
  fleet: { type: AircraftTypeId; count: number }[];
}

export interface SimState {
  config: SimConfig;
  /** Elapsed simulation hours since start. The single source of time truth. */
  hours: number;
  dayOfYear: number;
  /** Local hour of day, 0–24 */
  hourOfDay: number;
  aircraft: Aircraft[];
  missions: Mission[];
  crew: CrewGroup[];
  spares: SparePartStock[];
  bays: BayState[];
  slots: SlotState[];
  /** Bulk resources */
  fuelM3: number;
  fuelMaxM3: number;
  munitions: number;
  munitionsMax: number;
  weather: Weather;
  solar: SolarState;
  /** Runway is closed for clearance until this sim-hour */
  runwayClosedUntil: number | null;
  /** True while gusts exceed the crosswind limit */
  weatherHold: boolean;
  events: SimEvent[];
  kpi: Kpi;
  /** Recommendations the tool would make right now (populated for both policies
   *  so the manual run can display what it is choosing to ignore) */
  advice: Advice[];
  nextEventId: number;
  nextMissionId: number;
  /** Opaque RNG stream states, kept so the whole sim is snapshot-serialisable */
  rngStates: Record<string, number>;
}

export interface Advice {
  id: string;
  title: Msg;
  detail: Msg;
  /** Benefit and trade-off are mandatory — design principle §5.2, the strongest
   *  idea in either hackathon build. Never surface advice without its cost. */
  benefit: Msg;
  tradeoff: Msg;
  priority: "low" | "medium" | "high" | "critical";
  channel: "maintenance" | "logistics" | "crew" | "mission" | "weather";
  /** True if the tool policy actually acted on this during the run */
  acted: boolean;
}
