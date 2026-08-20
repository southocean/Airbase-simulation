/**
 * Scene geometry and the flight model.
 *
 * The simulation itself has no geometry — it models occupancy and time, which is
 * the honest thing for it to model. Everything here is a *presentation* layer
 * derived from sim state: given an aircraft's status, when its current activity
 * began and when it ends, this computes where it should be drawn.
 *
 * Nothing in here feeds back into the simulation, and none of it consumes the
 * sim's RNG, so determinism is untouched. Two aircraft with the same state at the
 * same time will always be drawn in the same place.
 */
import { AIRCRAFT_SPECS, BASE_CAPACITY } from "@/sim/params";
import type { Aircraft, SimState } from "@/sim/types";

/** World units are metres, with the base at the origin. */
export interface Vec {
  x: number;
  y: number;
}

export interface Runway {
  /** Centre of the runway */
  c: Vec;
  /** Length and width, metres */
  len: number;
  width: number;
  /** True heading of the landing direction, degrees */
  hdg: number;
  /** Unit vector along the runway, in the takeoff direction */
  along: Vec;
  /** Unit vector perpendicular */
  side: Vec;
  /** Runway designators, e.g. "03" / "21" */
  desigA: string;
  desigB: string;
}

export interface Pad {
  c: Vec;
  w: number;
  h: number;
  hdg: number;
}

export interface BaseLayout {
  runways: Runway[];
  /** Turnaround (klargöring) slots */
  slots: Pad[];
  /** Maintenance bays, index-aligned with state.bays */
  bays: Pad[];
  /** Apron parking positions */
  apron: Vec[];
  /** Holding area for airframes grounded and waiting on capacity */
  queue: Vec[];
  /** Taxiway centreline points, for drawing */
  taxi: Vec[][];
  /** Half-extent of the base view, metres */
  viewHalf: number;
}

const RAD = Math.PI / 180;

function rot(v: Vec, deg: number): Vec {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(v: Vec, k: number): Vec {
  return { x: v.x * k, y: v.y * k };
}

export function designator(hdgDeg: number): string {
  const n = Math.round(((hdgDeg % 360) + 360) % 360 / 10);
  return String(n === 0 ? 36 : n).padStart(2, "0");
}

/**
 * Build the airfield.
 *
 * The runway count comes from BASE_CAPACITY, which is deck-derived: a huvudbas
 * has two, a sidobas and a reservbas one. That number had been sitting in the
 * data unread by anything — the scene drew a single runway regardless.
 *
 * Note it is still not an engine *constraint*: the simulation does not limit
 * simultaneous runway operations. Drawing the real count is presentation; making
 * occupancy binding would change the measured results, so it is left as a
 * deliberate separate step.
 */
export function buildLayout(state: SimState): BaseLayout {
  const cap = BASE_CAPACITY[state.config.baseType];
  const hdg = state.config.runwayHeadingDeg;

  // Screen convention: heading 0 = up (−y), 90 = right (+x).
  const along = rot({ x: 0, y: -1 }, hdg);
  const side = { x: -along.y, y: along.x };

  const runways: Runway[] = [];
  const rwyLen = 2400;
  const rwySpacing = 1250;
  for (let i = 0; i < cap.runways; i++) {
    // Parallel runways, offset perpendicular and staggered slightly, which is how
    // a real second strip tends to sit.
    const offset = (i - (cap.runways - 1) / 2) * rwySpacing;
    const stagger = i * 180;
    const c = add(scale(side, offset), scale(along, stagger));
    runways.push({
      c,
      len: i === 0 ? rwyLen : rwyLen * 0.82,
      width: 45,
      hdg,
      along,
      side,
      desigA: designator(hdg),
      desigB: designator(hdg + 180),
      // Parallel runways are lettered L/R in reality; keep it simple and readable.
    });
  }

  // Everything else sits on one side of the primary runway.
  const apronBase = add(runways[0].c, scale(side, -900));

  const slots: Pad[] = [];
  for (let i = 0; i < state.slots.length; i++) {
    const t = (i - (state.slots.length - 1) / 2) * 190;
    slots.push({ c: add(add(apronBase, scale(along, t)), scale(side, 130)), w: 150, h: 110, hdg });
  }

  const bays: Pad[] = [];
  for (let i = 0; i < state.bays.length; i++) {
    const t = (i - (state.bays.length - 1) / 2) * 165;
    bays.push({ c: add(add(apronBase, scale(along, t)), scale(side, -290)), w: 135, h: 115, hdg });
  }

  // Apron parking, sized to the fleet so it works for 12 aircraft or 40.
  const n = state.aircraft.length;
  const perRow = Math.max(6, Math.ceil(Math.sqrt(n * 1.9)));
  const apron: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const t = (col - (perRow - 1) / 2) * 125;
    apron.push(add(add(apronBase, scale(along, t)), scale(side, -560 - row * 115)));
  }

  // Holding area for grounded airframes, offset along the field so it reads as a
  // separate place rather than more parking.
  const queue: Vec[] = [];
  const qBase = add(apronBase, scale(along, rwyLen * 0.5 + 260));
  for (let i = 0; i < 12; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    queue.push(add(add(qBase, scale(along, col * 110)), scale(side, -180 - row * 110)));
  }

  const taxi: Vec[][] = runways.map((r) => [
    add(add(r.c, scale(along, -r.len / 2)), scale(side, -320)),
    add(add(r.c, scale(along, r.len / 2)), scale(side, -320)),
  ]);
  // Link the apron to the primary taxiway.
  taxi.push([add(apronBase, scale(side, 320)), add(apronBase, scale(side, -600))]);

  return { runways, slots, bays, apron, queue, taxi, viewHalf: 2600 + (cap.runways - 1) * 620 };
}

// ── flight model ────────────────────────────────────────────────────────────

export interface Track {
  pos: Vec;
  /** Heading, degrees */
  hdg: number;
  /** 0 = on the ground, 1 = at cruise. Drives icon size and shadow. */
  climb: number;
  /** Distance from the base, metres */
  range: number;
  /** True while rolling on a runway */
  onRunway: boolean;
}

/** Stable per-aircraft pseudo-random value in [0,1). Not the sim's RNG. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const TAKEOFF_ROLL_H = 1.2 / 60;
/** Range at which the return leg hands over to final approach, metres. */
const APPROACH_RANGE = 28_000;

function runwayFor(ac: Aircraft, layout: BaseLayout): Runway {
  const idx = Math.floor(hash01(ac.id) * layout.runways.length);
  return layout.runways[Math.min(idx, layout.runways.length - 1)];
}

/**
 * Where is this aircraft, and pointing where?
 *
 * Airborne aircraft depart along a stable outbound bearing, run out to their
 * operating radius, and come back — they do not orbit in view, which was the
 * previous behaviour and looked like a screensaver. Most of a sortie is spent
 * far outside both the base view and the minimap, which is correct: the base is
 * a few kilometres across and a Gripen sortie covers hundreds.
 */
export function trackFor(ac: Aircraft, state: SimState, layout: BaseLayout): Track {
  const spec = AIRCRAFT_SPECS[ac.type];
  const rwy = runwayFor(ac, layout);
  const speedMs = spec.cruiseKts * 0.5144;

  // Outbound bearing: stable per aircraft and mission, spread around the compass
  // but biased away from the runway axis so departures fan out.
  const seed = hash01(ac.id + (ac.missionId ?? "idle"));
  const bearing = (rwy.hdg + (seed - 0.5) * 150 + 360) % 360;

  const startedAt = ac.activityStartedAt;
  const endsAt = ac.activityEndsAt;

  if (ac.status === "on_mission" && startedAt !== null && endsAt !== null) {
    const t = state.hours - startedAt;
    const dur = Math.max(endsAt - startedAt, TAKEOFF_ROLL_H * 3);

    if (t < TAKEOFF_ROLL_H) {
      // Ground roll: accelerate from the threshold toward the far end.
      const f = t / TAKEOFF_ROLL_H;
      const along = -rwy.len / 2 + rwy.len * (f * f);
      return {
        pos: add(rwy.c, scale(rwy.along, along)),
        hdg: rwy.hdg,
        climb: 0,
        range: Math.hypot(rwy.c.x, rwy.c.y),
        onRunway: true,
      };
    }

    const tt = t - TAKEOFF_ROLL_H;
    const half = Math.max((dur - TAKEOFF_ROLL_H) / 2, 1 / 60);
    const rMax = Math.min(speedMs * half * 3600, spec.radiusKm * 1000);
    const range = tt <= half
      ? rMax * (tt / half)
      : APPROACH_RANGE + (rMax - APPROACH_RANGE) * Math.max(0, 1 - (tt - half) / half);

    // A slow lateral wander so the track is not a dead-straight line out and back.
    const wander = Math.sin(tt * 1.6 + seed * 6.283) * 9;
    const brg = tt <= half ? bearing + wander : bearing + 180 + wander;
    const dir = rot({ x: 0, y: -1 }, bearing);
    const climbOut = Math.min(1, range / 12_000);

    return {
      pos: add(rwy.c, scale(dir, range)),
      // Outbound points away from base, inbound points back toward it.
      hdg: tt <= half ? (bearing + wander + 360) % 360 : (brg + 360) % 360,
      climb: climbOut,
      range,
      onRunway: false,
    };
  }

  if (ac.status === "returning" && startedAt !== null && endsAt !== null) {
    const dur = Math.max(endsAt - startedAt, 1 / 60);
    const f = Math.max(0, Math.min(1, (state.hours - startedAt) / dur));
    // Final approach: run in along the landing direction, descending.
    const range = APPROACH_RANGE * (1 - f);
    const dir = scale(rwy.along, -1);
    return {
      pos: add(add(rwy.c, scale(rwy.along, -rwy.len / 2)), scale(dir, range)),
      hdg: rwy.hdg,
      climb: Math.min(1, range / 12_000),
      range,
      onRunway: range < 60,
    };
  }

  if (ac.status === "recovering" && startedAt !== null && endsAt !== null) {
    const dur = Math.max(endsAt - startedAt, 1 / 60);
    const f = Math.max(0, Math.min(1, (state.hours - startedAt) / dur));
    if (f < 0.25) {
      // Landing roll-out, then clear the runway.
      const g = f / 0.25;
      const along = -rwy.len / 2 + rwy.len * 0.85 * g;
      return {
        pos: add(rwy.c, scale(rwy.along, along)),
        hdg: rwy.hdg,
        climb: 0,
        range: 0,
        onRunway: true,
      };
    }
    // Taxi to the reception spot on the apron side.
    const exit = add(add(rwy.c, scale(rwy.along, rwy.len * 0.3)), scale(rwy.side, -320));
    return { pos: exit, hdg: (rwy.hdg + 90) % 360, climb: 0, range: 0, onRunway: false };
  }

  if (ac.status === "awaiting_launch") {
    // Holding short at the threshold.
    const pos = add(add(rwy.c, scale(rwy.along, -rwy.len / 2 - 60)), scale(rwy.side, -120));
    return { pos, hdg: rwy.hdg, climb: 0, range: 0, onRunway: false };
  }

  if (ac.status === "in_preparation" && ac.slot !== null && layout.slots[ac.slot]) {
    return { pos: layout.slots[ac.slot].c, hdg: (rwy.hdg + 90) % 360, climb: 0, range: 0, onRunway: false };
  }

  if (ac.status === "under_maintenance" && ac.bay !== null && layout.bays[ac.bay]) {
    return { pos: layout.bays[ac.bay].c, hdg: (rwy.hdg + 90) % 360, climb: 0, range: 0, onRunway: false };
  }

  // Parked: apron or the holding area, index assigned by the caller via slotIndex.
  return { pos: layout.apron[0] ?? { x: 0, y: 0 }, hdg: rwy.hdg, climb: 0, range: 0, onRunway: false };
}

/** True when an aircraft has a real airborne track rather than a parking spot. */
export function isFlying(ac: Aircraft): boolean {
  return ac.status === "on_mission" || ac.status === "returning";
}
