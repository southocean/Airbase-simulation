# Data Requirements — what realism needs, and where to get it

The team's stated goal is to "model as accurately to reality as possible". This document lists what the simulation needs, rates how obtainable each item is, and names concrete sources.

## The honest constraint up front

Real sortie-generation rates, turnaround times, failure rates, and dispersed-basing doctrine for the Swedish Air Force are **operationally sensitive and largely not public**. Any figure found on the open web for these will be an enthusiast estimate, not a measurement.

That leads to a three-tier strategy, which should be visible in the code itself:

| Tier | Source | Use |
|---|---|---|
| **A — Measured** | Public authoritative datasets (weather, geography, astronomy, published specs) | Use directly. Cite in `@source`. |
| **B — Elicited** | Saab / Försvarsmakten SMEs, the original simulation deck, internal exercise records | The only real path for operational parameters. Requires asking. |
| **C — Assumed** | Reasoned analogues from open literature, marked as guesses | Use as placeholder, tag `@source ASSUMED`, expose as a tunable. |

The critical design consequence: **make every Tier C value a tunable with a plausible range, not a constant.** Then when an SME says "no, turnaround is 25 minutes not 45", it is a config edit, and you can show sensitivity to that uncertainty rather than pretending it away.

---

## 1. Weather — Tier A, fully obtainable

This is the single biggest realism win available, because the data is free, high-quality, and Swedish.

**What the model needs, per hour, per base location:**

- Ceiling (cloud base, ft AGL) and cloud cover (octas)
- Horizontal visibility (m)
- Wind direction, mean speed, gust speed (→ derive **crosswind component** against each runway heading)
- Precipitation type and rate (rain / snow / freezing)
- Temperature, dew point (→ **icing risk**, de-icing demand)
- Runway surface state (dry / wet / snow / ice → braking action)
- QNH pressure

**Sources:**

- **SMHI Open Data API** (`opendata.smhi.se`) — free, no key, official Swedish meteorological institute. Provides observations from actual stations and forecast grids. Also publishes **1991–2020 climate normals**, which is what you want for generating statistically realistic synthetic months.
- **METAR/TAF for Swedish airfields** — real aerodrome observations in a compact standard format; ideal for validating a synthetic weather generator. Available via aviation weather services; ESSA/ESGG/ESSB etc. as reference stations.
- **ERA5 reanalysis** (Copernicus/ECMWF) — free hourly gridded historical weather back to 1940. Best option for "replay a real Baltic winter week".
- **Copernicus / EUMETSAT** — satellite cloud products if you want the map overlay driven by real fields.

**Recommended approach:** build a **stochastic weather generator** calibrated to SMHI normals for the base latitudes, with the option to replay a real ERA5 week. This gives both statistical realism across many runs and a concrete demonstrable scenario. Seasonal choice matters enormously in Sweden — a January scenario and a July scenario are different problems.

**Engine couplings to implement (all currently missing):**

| Weather | Effect |
|---|---|
| Crosswind > limit | Launch/recovery blocked on that runway heading |
| Ceiling/visibility below minima | Mission-type dependent gating (VFR vs IFR vs precision approach) |
| Icing conditions | De-icing step added to turnaround; consumes fluid + crew time |
| Snow accumulation | Runway clearance task; competes for ground equipment |
| Low temperature | Longer prep, reduced outdoor crew endurance, battery/hydraulic effects |
| Wind/visibility | Degraded EO/IR detection; drone launch limits (drones have far lower wind limits) |
| Heavy precipitation | Radar attenuation |
| Road base + wet/icy surface | Reduced usability — key for the Road2Air dispersal concept |

## 2. Day/night and solar geometry — Tier A, trivially obtainable

Needs no dataset at all — it is deterministic astronomy computed from date, time, latitude, longitude.

- **Sunrise / sunset / civil, nautical, astronomical twilight**
- Solar elevation and azimuth
- Moon phase and illumination (matters for night visual detection)

**Sources:** standard solar position algorithms (NOAA solar calculator equations, or the SPA algorithm); JS libraries such as `suncalc` implement this in a few KB. **Swedish latitudes make this dramatic:** around 59–68°N, Stockholm gets ~6 h of daylight in late December and ~18.5 h in June; north of the Arctic Circle you get polar night and midnight sun outright. A 7-day scenario in January is a fundamentally different sustainment problem from one in June.

**Engine couplings to implement (all currently missing):**

- Personnel shift rosters and crew duty/rest limits keyed to light state
- Crew fatigue and error-rate multiplier on night shifts
- Visual detection range collapse at night; IR/radar relative advantage
- Mission-type suitability (night attack, night recovery proficiency)
- Lighting requirements at dispersed sites — and the emissions-control tension that creates

## 3. Geography and infrastructure — Tier A for terrain, Tier B/C for bases

**Obtainable now:**

- **Lantmäteriet** — Swedish national mapping agency; open elevation and topographic data
- **Copernicus DEM / SRTM** — free elevation for terrain masking, radar line-of-sight, and radar shadow (v2 already has a `RadarShadowOverlay` that could be driven by real terrain)
- **OpenStreetMap** — roads, runways, taxiways; the practical source for candidate **road-base** stretches, which is exactly the Road2Air concept
- **AIP Sverige (LFV)** — the public Aeronautical Information Publication: real runway headings, lengths, surfaces, declared distances, and approach minima for Swedish civil/joint airfields. This is the correct authoritative source for runway geometry.
- **OurAirports / ICAO code datasets** — coordinates and basic runway data in bulk

**Not obtainable — must be Tier B/C:** actual dispersed-base network layout, hardened shelter counts, fuel farm capacities, war-reserve stock locations. Model these as **fictional-but-plausible** bases (as both existing repos do with MOB / FOB_N / FOB_S) and be explicit that they are notional. That is the right call for an unclassified demo anyway.

## 4. Aircraft performance — Tier A for envelope, Tier B for sustainment

**Obtainable:** Saab's own public product material for Gripen E and GlobalEye gives dimensions, thrust, hardpoint counts, ferry range, and marketing-level performance. Jane's and similar reference works add more. Enough to make range rings, transit times, and endurance plausible.

**Not obtainable publicly:**

- Fuel burn per mission profile (the number you actually need)
- Real turnaround times per configuration
- Weapon load times
- Maintenance man-hours per flight hour (**MMH/FH**) — the single most important sustainment number in the entire model
- Mean time between failures by subsystem

**Where to get defensible analogues (Tier C):** open sustainment and airbase-resilience literature. Publicly available analyses from **RAND** on agile combat employment, sortie generation, and airbase operations, and academic work in the *Journal of Defense Modeling and Simulation* and INFORMS/military-OR literature on sortie generation modelling, give published MMH/FH ranges and turnaround distributions for comparable fast jets. Cite these openly as analogues. Gripen was explicitly designed for short turnaround by conscript-level ground crew in dispersed basing, so it should sit at the favourable end of any analogue range — state that assumption rather than burying it.

## 5. Reliability and error rates — the biggest gap, mostly Tier B/C

Currently the model has **one** error class (aircraft technical failure) with invented rates. Realism needs at least seven, each with its own distribution:

| # | Error class | Currently | Data approach |
|---|---|---|---|
| 1 | Aircraft technical failure | Utfall d6 + invented 5 %/1 % | Utfall table is Tier B (from the deck) and genuine — **keep it**. Replace the invented per-hour rates with a Weibull/exponential hazard model calibrated to open MMH/FH literature. |
| 2 | **Human error** — misload, wrong config, procedural slip | **absent** | Tier A analogue: aviation maintenance human-factors literature (MEDA, HFACS-ME taxonomies) gives published error-rate ranges. Fold in a fatigue multiplier driven by §2. |
| 3 | **Ground support equipment failure** | **absent** | Tier C: reliability engineering conventions; treat as exponential with SME-set MTBF. Matters because GSE is a shared constrained resource. |
| 4 | **Resupply delay / misdelivery** | lead time is a fixed constant | Tier A analogue: civilian logistics on-time-delivery distributions. Replace the constant `resupplyDays` with a distribution and add a shortfall probability. The deck's 5-day / 30-day UE loop is the mean, not the truth. |
| 5 | **Communication / C2 failure and decision latency** | **absent** | Tier B. The deck explicitly calls out decision latency as something to model. Cheap to add and directly relevant to proving the tool's value: a faster decision loop *is* the tool's benefit. |
| 6 | **Battle damage** (CM day 4, TBM day 5) | scenario flags exist, no effects | Tier C: open weaponeering-style damage functions; model as probabilistic damage to runway, shelters, fuel, and parked aircraft. |
| 7 | **Infrastructure damage / runway repair** | **absent** | Tier C: published rapid runway repair timelines; couple to a minimum operating strip concept. |

**Method for all Tier B/C values — structured expert elicitation.** This is a real, citable discipline, not guesswork with extra steps. Ask SMEs for a **three-point estimate** (optimistic / most likely / pessimistic) rather than a single number, fit a PERT/beta distribution, and record who said it and when. The Sheffield elicitation framework (SHELF) or the Delphi method are the standard approaches. This turns "we made it up" into "we elicited it, here is the spread" — which is defensible in front of a customer, and it is exactly what §7.3 of the design principles requires.

## 6. Validation data — how you know the sim is any good

A simulation nobody has validated is a visualisation. Minimum viable validation, in increasing order of strength:

1. **Face validity** — walk an SME through a run; do the bottlenecks feel right?
2. **Structural validity** — does the state machine match the deck's workflow? (Both repos already pass this.)
3. **Behavioural validity** — does sortie generation degrade under resource constraint in the shape doctrine predicts? Compare against the published sortie-generation curves in the open literature.
4. **Historical replay** — the strongest available option: replay a **real Swedish air-force exercise** (Flygvapenövning, or a Baltic-region multinational exercise) whose ATO structure and outcomes the team can access internally. Tier B, but high value.
5. **Cross-model comparison** — compare against the original manual board game. This is free, in-house, and underrated: **run the physical game and the digital sim on the same scenario with the same dice and check they agree.** That is a genuine verification test, and the deck's d6 tables make it directly possible.

## 7. Data needed to prove tool effectiveness — the actual deliverable

None of this exists in either repo, and it needs no external data at all — just instrumentation.

**KPIs to record every tick:**

- Sortie generation rate (sorties/aircraft/day)
- ATO fulfilment: missions flown vs tasked, and on-time percentage
- Mission-capable aircraft over time (and time-weighted average availability)
- Mean time from landing to next mission-capable (turnaround)
- Aircraft-hours lost to *avoidable* waiting (no bay / no part / no crew / no fuel) — the tool's main target
- Resource stockout events and duration
- Maintenance bay and crew utilisation
- Base endurance: days of sustained operations remaining at current burn
- Decision latency: time from event to operator action
- Cannibalisation count (and policy violations on the day it is forbidden)

**The experiment design:**

```
for seed in 1..N:
    result_manual = run(scenario, seed, policy = manual)
    result_tool   = run(scenario, seed, policy = tool_assisted)
    delta[seed]   = result_tool - result_manual
```

Paired runs on identical seeds, N large enough for confidence intervals. Report the distribution of the delta, not one number. Add an **oracle policy** (a perfect-information optimiser, allowed to cheat) as an upper bound, so you can say "the tool captures 70 % of the theoretically available improvement" — a far stronger and more honest claim than "the tool helps".

This is what turns the project from a demo into evidence.

---

## Priority order

If the team can only do some of this:

1. **Instrumentation + paired-run baseline** (§7) — no external data needed, and it is the entire point. Do this first.
2. **Headless deterministic core** — precondition for #1.
3. **Weather + day/night** (§1, §2) — Tier A, free, genuinely Swedish, high visible impact, and the team explicitly asked for it.
4. **Make recommendations actually executable** — currently 10 of 11 are no-ops.
5. **SME elicitation for the operational parameters** (§5) — the long-lead item. Start the conversation early; everything else can proceed with tagged placeholders in the meantime.
6. **Expanded error model** (§5) — needs #5 to be meaningful.
7. **Validation** (§6) — start with the board-game cross-check, which is free.
