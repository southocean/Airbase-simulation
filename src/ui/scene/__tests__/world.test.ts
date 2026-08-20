import { describe, expect, it } from "vitest";
import { createSim, DEFAULT_CONFIG } from "@/sim/init";
import { step, STEP_HOURS } from "@/sim/engine";
import { AIRCRAFT_SPECS } from "@/sim/params";
import type { SimState } from "@/sim/types";
import { buildLayout, designator, isFlying, trackFor } from "../world";

/** Advance until `pred` holds, or give up. */
function advanceUntil(s: SimState, pred: (s: SimState) => boolean, maxHours = 72): boolean {
  const steps = Math.round(maxHours / STEP_HOURS);
  for (let i = 0; i < steps; i++) {
    step(s);
    if (pred(s)) return true;
  }
  return false;
}

describe("airfield layout", () => {
  it("draws the runway count the deck specifies for each base type", () => {
    // This number lived in BASE_CAPACITY unread by anything for several revisions:
    // the scene drew one runway regardless of base type.
    const main = buildLayout(createSim({ ...DEFAULT_CONFIG, baseType: "huvudbas" }));
    const sat = buildLayout(createSim({ ...DEFAULT_CONFIG, baseType: "sidobas" }));
    const res = buildLayout(createSim({ ...DEFAULT_CONFIG, baseType: "reservbas" }));
    expect(main.runways).toHaveLength(2);
    expect(sat.runways).toHaveLength(1);
    expect(res.runways).toHaveLength(1);
  });

  it("gives every slot, bay and aircraft a distinct place", () => {
    const s = createSim(DEFAULT_CONFIG);
    const l = buildLayout(s);
    expect(l.slots).toHaveLength(s.slots.length);
    expect(l.bays).toHaveLength(s.bays.length);
    expect(l.apron).toHaveLength(s.aircraft.length);

    const key = (p: { x: number; y: number }) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`;
    const spots = [...l.slots.map((p) => p.c), ...l.bays.map((p) => p.c), ...l.apron];
    expect(new Set(spots.map(key)).size).toBe(spots.length);
  });

  it("labels runways with reciprocal designators", () => {
    expect(designator(30)).toBe("03");
    expect(designator(210)).toBe("21");
    expect(designator(0)).toBe("36");
    expect(designator(360)).toBe("36");
  });
});

describe("flight model", () => {
  it("takes aircraft out of the base area and brings them back", () => {
    const s = createSim(DEFAULT_CONFIG);
    const layout = buildLayout(s);

    const found = advanceUntil(s, (x) => x.aircraft.some((a) => a.status === "on_mission"));
    expect(found).toBe(true);

    const ac = s.aircraft.find((a) => a.status === "on_mission")!;
    const start = ac.activityStartedAt!;
    const end = ac.activityEndsAt!;
    expect(end).toBeGreaterThan(start);

    // Sample the whole sortie by evaluating the track at synthetic times. The
    // track is a pure function of state, so this needs no further stepping.
    const ranges: number[] = [];
    for (let f = 0; f <= 1.0001; f += 0.02) {
      const probe: SimState = { ...s, hours: start + (end - start) * f };
      ranges.push(trackFor(ac, probe, layout).range);
    }

    const peak = Math.max(...ranges);
    const peakAt = ranges.indexOf(peak) / (ranges.length - 1);

    // Starts on the field, goes a long way out, comes back.
    expect(ranges[0]).toBeLessThan(3_000);
    expect(peak).toBeGreaterThan(layout.viewHalf * 5);
    expect(peakAt).toBeGreaterThan(0.3);
    expect(peakAt).toBeLessThan(0.7);
    expect(ranges[ranges.length - 1]).toBeLessThan(peak * 0.6);

    // It must actually leave the drawn base view, rather than orbiting inside it.
    expect(ranges.some((r) => r > layout.viewHalf)).toBe(true);
  });

  it("sends fast jets beyond the minimap, so they genuinely go off both maps", () => {
    // The minimap covers 320 km. A Gripen sortie is well over an hour at ~470 kt,
    // so a realistic track has to leave it — that is the point of despawning.
    const spec = AIRCRAFT_SPECS.GripenE;
    const halfSortieH = 1.4 / 2;
    const reach = Math.min(spec.cruiseKts * 1.852 * halfSortieH, spec.radiusKm);
    expect(reach * 1000).toBeGreaterThan(320_000);
  });

  it("reverses heading between the outbound and inbound legs", () => {
    const s = createSim(DEFAULT_CONFIG);
    const layout = buildLayout(s);
    expect(advanceUntil(s, (x) => x.aircraft.some((a) => a.status === "on_mission"))).toBe(true);
    const ac = s.aircraft.find((a) => a.status === "on_mission")!;
    const start = ac.activityStartedAt!;
    const end = ac.activityEndsAt!;

    const out = trackFor(ac, { ...s, hours: start + (end - start) * 0.3 }, layout).hdg;
    const back = trackFor(ac, { ...s, hours: start + (end - start) * 0.8 }, layout).hdg;
    // Absolute angular separation, normalised to [0, 180].
    const separation = Math.abs(((((out - back) % 360) + 540) % 360) - 180);
    // A reversal is ~180°. Allow 40° of slack for the lateral wander on each leg.
    expect(separation).toBeGreaterThan(140);
  });

  it("puts aircraft on a runway during the takeoff roll and nowhere near one when parked", () => {
    const s = createSim(DEFAULT_CONFIG);
    const layout = buildLayout(s);
    expect(advanceUntil(s, (x) => x.aircraft.some((a) => a.status === "on_mission"))).toBe(true);
    const ac = s.aircraft.find((a) => a.status === "on_mission")!;
    const justLaunched = trackFor(ac, { ...s, hours: ac.activityStartedAt! + 0.2 / 60 }, layout);
    expect(justLaunched.onRunway).toBe(true);
    expect(justLaunched.climb).toBe(0);

    const parked = s.aircraft.find((a) => a.status === "ready");
    if (parked) {
      const tr = trackFor(parked, s, layout);
      expect(tr.onRunway).toBe(false);
      expect(tr.climb).toBe(0);
    }
  });

  it("is a pure function of state — same state, same position", () => {
    const s = createSim(DEFAULT_CONFIG);
    const layout = buildLayout(s);
    advanceUntil(s, (x) => x.aircraft.some((a) => isFlying(a)));
    for (const ac of s.aircraft) {
      const a = trackFor(ac, s, layout);
      const b = trackFor(ac, s, layout);
      expect(a.pos.x).toBe(b.pos.x);
      expect(a.pos.y).toBe(b.pos.y);
      expect(a.hdg).toBe(b.hdg);
    }
  });
});
