# Project Analysis — the two hackathon builds, and the gap to the vision

## 1. Shared origin

Both projects descend from one source document: `context.md`, which is **byte-identical in both repos**. It is an extraction of a Saab internal slide deck describing an in-house *manual board game* used to teach airbase management — the "spelvarv" (game turn) simulation.

That deck is the real spec. It defines:

- **System boundary** — the airbase system supports flying units; *combat aircraft are explicitly not part of the airbase system*. Aircraft are external assets the base services.
- **A 14-step turn loop** ("Aktiviteter per spelvarv") from *interpret ATO* → *allocate* → *order preparation* → *execute* → *report* → *increment time*.
- **Base network** — Huvudbas / Sidobas / Reservbas, dispersed (Flygbasgrupp).
- **A stochastic outcome table** ("Utfall") — d6-driven repair outcomes with repair time, required facility, and required capability level.
- **A UE (exchange unit) closed-loop supply cycle** — 5 days base↔RESMAT, 30 days MRO loop, 1 hour cannibalization.
- **A 7-day escalation scenario** — FRED → KRIS → KRIG with CM and TBM threat days.

Both codebases implement this deck faithfully in `src/data/config/`. Those files are the highest-value asset in either repo.

## 2. What each project is

### v1 — Road2Air (`SAAB-Smart-Airbase-with-Road2Air`)

**~23,000 LOC. Turn-based.**

A faithful digitisation of the board game. The operator steps through the 14 phases explicitly; each phase gates which actions are legal (`PHASE_DEFINITIONS.allowedActions`), and a "NÄSTA FAS / BEKRÄFTA ATO / BEORDRA KLARGÖRING" button advances the loop.

There is **no clock at all** — `src/types/game.ts` contains no `isRunning`, no `gameSpeed`, no `TICK`. Time advances only when the operator advances a phase.

Scope: 3 bases, ATO editor + CSV import, Gantt view, aircraft pipeline, maintenance bays, personnel, spare parts, a simple Sweden-outline map, AAR page.

### v2 — Smart Stridsledning (`Saab-stridsledning-hackathon`)

**~52,700 LOC. Real-time.**

Same airbase core, but reframed as a tactical **command-and-control** product. The turn loop was replaced by a continuous clock (`useGameClock` → `TICK` action) with a speed selector at **1x / 60x / 360x / 3600x**, plus a hidden `clockMultiplier` for scripted demos.

Added on top of v1:

- **MapLibre theatre map** as the primary surface (`src/pages/Map.tsx` grew 343 → 2,871 lines)
- **Multi-unit model** — aircraft, drone, air_defense, ground_vehicle, radar, naval, as first-class `Unit` types with NATO SIDC symbology via `milsymbol`
- **Movement & patrol engine** — deterministic racetrack orbits, per-minute fuel drain
- **Drone engine** with waypoints, endurance, auto-recall on low fuel
- **Radar engine** — emitting/not-emitting, sweep, radar shadow, detection
- **Intel & fog of war** — enemy bases/entities, sensor coverage, last-known positions
- **Plan mode** — propose a picture before committing, with an AI-style review modal
- **Logistics analysis** page + order modal (`src/core/logistics.ts`, 43 KB)
- **Baltic-incursion scripted demo** (Shift+Alt+S or F9)
- **Role selection** — Vingchef, Flygbaskommendant, FOB-Chef, Luftvärnscontroller, Stridsledare, Underrättelseofficer (currently framing only; one shared `GameProvider`)

## 3. Is v2 a strict superset? — Almost.

Every one of v1's 168 files exists in v2. **`src/data/config/phases.ts` is byte-identical**, so the 14-phase turn-loop *data* survives — but its *driver* was removed:

| File | v1 | v2 | What was lost |
|---|---|---|---|
| `components/game/PhasePanel.tsx` | 174 | 99 | `AllocationSummary` + `ExecutionSummary` phase views deleted; panel no longer switches on `turnPhase` |
| `components/game/TurnPhaseTracker.tsx` | 123 | 107 | `onAdvancePhase` prop + the advance button removed |
| `pages/Index.tsx` | 807 | 802 | `TurnPhaseTracker` import and `advanceTurn` wiring dropped |
| `pages/map/SwedenOutline.tsx` | 84 | 74 | superseded by real MapLibre basemap |

So in v2 the turn loop is **vestigial** — the phase definitions are still there and `TurnPhaseTracker` still renders "SPELVARV n", but nothing advances it and no phase gates any action.

### Recommendation on repos

**Clone v2 only.** It carries everything of substance. Salvage from v1 only if the phased-planning discipline matters to you:

- the two deleted `PhasePanel` sub-views (~110 lines)
- `TurnPhaseTracker`'s advance-phase affordance
- the `allowedActions` gating concept in `data/config/phases.ts` (data already present in v2)

That is a genuinely interesting design tension, not just dead code — see §5, Gap F.

## 4. What both projects actually model

| Modelled | Fidelity |
|---|---|
| Aircraft 9-state lifecycle (`ready → allocated → in_preparation → awaiting_launch → on_mission → returning → recovering → under_maintenance → unavailable`) | **Good** |
| Utfall d6 repair tables (A: prep/BIT, B: reception) with facility + capability requirements | **Good** — straight from the deck |
| Spare parts with quantity, reserved, lead time, resupply days, turnaround | **Good** |
| Maintenance bays as a hard capacity constraint | **Good** — actually enforced in the reducer |
| Personnel by role, crew-per-aircraft (8 mech + 3 tech + 2 armourer = 13) | **Reasonable** |
| Random failure: 7 h MTBF grace, then 5 % yellow / 1 % red per turn | **Placeholder numbers** |
| Prep / recovery / fuel / ammo load times per aircraft type | **Plausible guesses**, undocumented |
| Fuel as a single 0–100 % scalar per base | **Weak** — not volume, not by grade |
| Base zones (runway, prep slot, front/rear maint, parking, fuel, ammo, logistics) | **Data scaffolding** — capacities defined, mostly unenforced |
| Seeded RNG for deterministic replay | **Exists** (`createRng`) but **unused** — production path calls `Math.random()` |

## 5. The gap between these projects and the team's vision

### Gap A — There is no simulation to apply the tool to

Both projects are a **UI with a model behind it**, not a model with a UI in front of it. The state lives in one React reducer (`src/core/engine.ts`, 1,997 lines in v2) coupled to component rendering. There is no headless engine, so you cannot:

- run the sim without the browser
- run it faster than real time in batch
- run it 1,000 times to get distributions instead of anecdotes

**Needed:** extract a headless, deterministic, dependency-free simulation core. `createRng` already exists — make the whole engine take a seed and never call `Math.random()`.

### Gap B — The management tool cannot actually manage

This is the most important finding. In `src/core/recommendations.ts`, of 11 generated recommendations, **10 have `applyAction: { type: "ADVANCE_HOUR" }` — an explicit placeholder**. Only one (`START_MAINTENANCE`) does real work.

So "Apply recommendation" mostly advances the clock by an hour. The tool observes and advises; it cannot act. The thing whose effectiveness you want to demonstrate is, right now, a set of hardcoded `if (fuel < 30)` thresholds wired to a no-op.

**Needed:** every recommendation must map to a real, executable state transition, and the tool needs a genuine optimiser (allocation / scheduling), not threshold triggers.

### Gap C — No baseline, so "effective" is unmeasurable

Searching v2 for baseline / counterfactual / A-B comparison returns **zero hits**. The AAR page has no sortie-generation rate, no mission-fulfilment rate, no readiness-over-time metric.

You cannot show a tool is effective without running the same seeded scenario twice — once with the tool, once without — and comparing. This is the single highest-value thing to build, and it is cheap once Gap A is closed.

**Needed:** a KPI set (sortie generation rate, ATO fulfilment %, mean time to mission-capable, aircraft-hours lost to avoidable waiting, resource stockout events, bay utilisation) plus a paired-run harness along the lines of `run(seed, policy)` where policy is manual or tool-assisted.

### Gap D — Weather is decoration, not physics

v2 has `CloudLayer.tsx` (Perlin noise), `WindLayer.tsx` (400 particles), `AuroraOverlay`, `WTALayer`. They look great. But a search for weather, wind, cloud, or crosswind across `src/core`, `src/types`, and `src/data/config` returns **no matches at all**.

**Zero coupling to the engine.** Weather cannot delay a sortie, close a runway, ground a drone, degrade a sensor, or slow outdoor maintenance.

**Needed:** a real weather state (ceiling, visibility, wind vector, precipitation, icing, temperature) that the engine *reads* — gating launches, extending turnaround, degrading radar/EO detection, and affecting road-base usability.

### Gap E — Day/night does not exist

Searching v2 for night, dusk, dawn, daylight, or sunrise returns **no matches**. The clock tracks `day/hour/minute/second`, and the map has no solar term at all.

For Sweden this is a big miss: at 60°N, December daylight is roughly 6 hours and June roughly 19 hours. Day/night should drive personnel shifts, night-vision/IR advantage, sortie rate, and visual detection.

**Needed:** solar position from date + latitude → light state; couple to crew fatigue, shift rosters, detection modifiers, and mission-type suitability.

### Gap F — Real-time exists, but "real time" is ambiguous

v2 *does* have real-time plus timescale (1x / 60x / 360x / 3600x), so the team's ask is partly met. Two problems remain:

1. The tick is wall-clock driven (`setInterval`), so the sim is **not reproducible** — frame timing changes results. A headless core with fixed-step integration fixes this.
2. At 3600x (1 s = 1 h) the 60 fps cap means large state jumps per tick; discrete events (a 2 h repair, a 45 min prep) can be stepped over rather than landing on their exact completion time.

**Needed:** an event-queue / discrete-event core with fixed-step advancement, where the render loop merely *samples* sim state. Then 1x and 3600x produce identical outcomes for the same seed — which is also a precondition for Gap C.

There is also a design tension worth resolving deliberately: v1's phase gating encoded *planning discipline* (you must interpret the ATO before you allocate). v2 threw that away for fluidity. The simulation does not need turn phases, but the **tool** probably does — a planning cycle is what makes its advice legible.

### Gap G — Error rates are invented

The team wants error rates folded in. The Utfall tables are genuine (from the deck), but `MTBF_GRACE_HOURS = 7`, `YELLOW_FAILURE_RATE = 0.05`, `RED_FAILURE_RATE = 0.01`, and every duration in `durations.ts` are guesses. `context.md` itself lists these as unknown.

Worse, there is only **one** error class: aircraft technical failure. Missing entirely: human error (misload, wrong configuration, paperwork), ground-equipment failure, resupply delay or misdelivery, communication failure, battle damage from the CM/TBM threat days, and runway/infrastructure damage.

**Needed:** an explicit, sourced, per-mechanism error model with distributions (not point values), so results can carry confidence intervals. See `03-DATA-REQUIREMENTS.md`.

### Gap H — Scope creep away from the airbase

v2 drifted from *airbase management* toward *tactical C2* — naval units, enemy analysis, threat rings, incursion detection, a Baltic intercept demo. Impressive, and good for hackathon demos, but it is a different product. The deck is explicit that the airbase system is about *supporting* flying units.

**Recommendation:** this simulation should re-centre on the base — turnaround, sustainment, dispersion, resource endurance. Borrow v2's map and unit model as *presentation*, but let the airbase be the system under test.

## 6. Summary table

| The vision | v1 | v2 | Verdict |
|---|---|---|---|
| Simulate the airbase | partial, turn-based | partial, real-time | **no headless sim exists** |
| Apply management tool on top | advisory only | advisory only | **tool cannot act (10 of 11 no-ops)** |
| Show how effective it is | absent | absent | **no baseline, no KPIs — biggest gap** |
| Model close to reality | deck-faithful structure | same + more units | structure good, **parameters invented** |
| Fold in error rates | Utfall d6 only | Utfall d6 only | **one error class of seven** |
| Simulate weather | absent | cosmetic overlays only | **zero engine coupling** |
| Day/night cycle | absent | absent | **entirely absent** |
| Real-time + timescale control | absent (turn-based) | present: 1x/60x/360x/3600x | **met, but non-reproducible** |

**The one-line takeaway:** the existing projects built the cockpit. This repo has to build the aircraft — and, critically, the wind tunnel that proves the cockpit is worth having.
