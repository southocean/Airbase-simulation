# Airbase Simulation

A simulation of a Swedish dispersed airbase, built so that an **airbase management tool can be layered on top of it and measured**.

```bash
npm install && npm run dev
```

```bash
npm test
```

`npm test` prints the effectiveness benchmark: 60 paired runs with effect sizes and t-statistics.

---

## Why this repo exists

Two hackathon projects already built the *management tool* side of this problem:

| Repo | Site | Role |
|---|---|---|
| `SAAB-Smart-Airbase-with-Road2Air` | [link](https://hungnguyenforworks-lgtm.github.io/SAAB-Smart-Airbase-with-Road2Air/) | v1 — turn-based ATO/resource planner ("Road2Air") |
| `Saab-stridsledning-hackathon` | [link](https://j-henriksson.github.io/Saab-stridsledning-hackathon/) | v2 — real-time tactical C2 + map ("Smart Stridsledning") |

Both are **tool-first**: an operator UI with a light stochastic model behind it. Neither contains a simulation that can stand on its own and act as a measurement harness. This repo is the missing half — **the simulated world** — plus the harness that turns "our tool helps" into a number.

Read [`docs/01-PROJECT-ANALYSIS.md`](docs/01-PROJECT-ANALYSIS.md) for the full comparison of the two builds and the eight gaps to the team's vision. [`docs/02-DESIGN-PRINCIPLES.md`](docs/02-DESIGN-PRINCIPLES.md) is the shared design system. [`docs/03-DATA-REQUIREMENTS.md`](docs/03-DATA-REQUIREMENTS.md) covers what data realism needs and where to get it.

## What this demo does

A single Swedish air base (Såtenäs coordinates, used for solar geometry), 18 aircraft — 12 Gripen E, 4 Gripen F/EA, 2 GlobalEye — running an ATO-driven sortie cycle in mid-January.

### The aircraft cycle

The nine-state lifecycle from hackathon v2, which is a genuinely good model and is reused verbatim:

```
ready → allocated → in_preparation → awaiting_launch → on_mission
      → returning → recovering → ready
                              ↘ under_maintenance / unavailable
```

Each transition is constrained by something real: prep slots, maintenance bays by facility level, on-shift crew by trade, fuel, munitions, and spare parts with distributed lead times.

### Environment that actually does something

Weather and light are not decoration here. Every one of these is a coupling that **does not exist at all** in either hackathon build (a search for `weather|wind|cloud` across their `src/core`, `src/types` and `src/data/config` returns nothing):

| Environment | Effect on the base |
|---|---|
| Crosswind vs runway heading | Launches and recoveries held above limit |
| Ceiling / visibility | Below minima blocks launch; returning aircraft hold |
| Icing risk (−12…+2 °C, moisture) | Adds a de-icing task to turnaround |
| Snow accumulation | Closes the runway for a clearance task |
| Temperature | Prep-time multiplier, up to ×1.55 at −20 °C |
| Darkness | Prep-time multiplier ×1.22, error rate ×1.7 |
| Crew fatigue | Error rate up to ×3.2 |

Weather is a stochastic generator with AR(1) persistence and seasonal means shaped to Swedish climate normals. Day/night is real solar geometry — at 58.4°N mid-January gives ~7.1 h of daylight (sunrise 08:46, sunset 15:51), late June ~18.3 h. Season is switchable in the UI and it genuinely changes the problem.

### Error classes

The hackathon builds model one error class (aircraft technical failure) with invented rates. This models five:

1. **Technical failure in flight** — exponential hazard per flight hour, scaled by airframe wear
2. **Human error in preparation** — driven by crew fatigue and darkness
3. **Ground support equipment failure** — takes a prep slot out of action
4. **Resupply delay / short delivery** — lead time is a distribution, not the deck's flat 5 days
5. **Deferred-defect debt** — see below

Battle damage and infrastructure damage are declared in `params.ts` but left for a scenario layer.

### Deferred defects

The Saab deck's Utfall (outcome) d6 tables are the most authoritative data in the whole model, and they are reproduced exactly. But two thirds of their rows are "serviceable" outcomes, and a literal reading discards them — the work, the part and the bay time all go unmodelled.

Here they go onto a **deferred-defect list**, as a real fleet does under an MEL regime. The aircraft keeps flying, but the work is still owed. Carry three, or carry one past 72 hours, and the airframe is grounded whether or not the operator chose the moment.

This turns out to be where a planner can actually beat a reactive operator, and it is the mechanism behind the numbers below.

### Time control

Fixed step of **1 simulated minute**. The timescale (1× / 60× / 600× / 3600× / 10800×) controls how many steps run per frame — never the step size. So the same seed produces byte-identical results at any speed, which is asserted in the test suite. Pause, single-hour step, and +1/+6/+24/+72 h jumps are all available.

## The measurement

Two policies of equal standing, run in **lockstep from the same seed** so both see the identical weather and identical dice:

- **manual** — a plausible unaided operator: first available airframe, maintenance only when something forces a stop, reorder at zero. Not a straw man; it is what a busy human does under load.
- **tool** — same actions, same information, no privileged access to state. It prioritises by deadline, takes shortest jobs first in the maintenance queue, spends idle bay capacity on the deferred list, and reorders at a reorder point.

### Results — 60 paired seeds, 7 days, KRIS tempo, huvudbas, winter

| Metric | Manual | Tool | Δ | t | Tool better in |
|---|---|---|---|---|---|
| Forced groundings | 14.2 | 7.2 | **−49 %** | 14.9 | 58/60 |
| Avoidable wait (a/c-h) | 378 | 284 | **−25 %** | 4.4 | 45/60 |
| Deferred backlog left open | 14.8 | 13.1 | −11 % | 4.0 | 42/60 |
| Mean available aircraft | 12.48 | 12.93 | **+3.6 %** | 3.5 | 44/60 |
| ATO fulfilment | 92.2 % | 92.8 % | +0.7 pp | 1.6 | 31/60 |

**The honest reading**, which matters more than the headline:

- Four of five metrics clear |t| > 3. The effect is real, not an artifact.
- **ATO fulfilment does not.** At ~92 % there is almost no headroom, so the tool's benefit shows up as a *more predictable* fleet rather than more sorties. If the pitch is "more sorties", this simulation does not currently support it; if the pitch is "fewer surprises and better availability", it does.
- Per-seed spread stays wide — "better in 44/60" means **a single demo run can still go the wrong way**. Never demo one run as proof.
- Under KRIG tempo (26 sorties/day) the advantage largely disappears: when demand exceeds capacity, scheduling cannot create capacity. That is a genuine finding about where the tool's value lies, and worth knowing before promising it.

Several earlier versions of the tool policy measured **worse** than the baseline — greedy preventive maintenance starved the corrective queue, and refusing to commit marginal airframes only ever lost sorties. Both are recorded in comments in `policy.ts` because they are the useful part: the harness caught them, which is precisely what it is for.

## Data honesty

Every parameter carries a provenance tag, surfaced in the UI rather than buried:

| Tag | Meaning | Covers |
|---|---|---|
| `DECK` | Saab's own simulation deck — authoritative | Utfall tables, UE cycle, base capacities, 7-day scenario |
| `TIER-A` | Public authoritative data | Solar geometry, weather climatology shape, airframe envelope |
| `TIER-C` | Reasoned analogue from open literature | MMH/FH, human error rates, delivery precision, defect rates |
| `ASSUMED` | Placeholder needing SME elicitation | Prep/reception times, failure intensities, environment effects |

Most of the numbers that actually drive results are `ASSUMED` or `TIER-C`. That is the honest state of the art until the expert elicitation described in `docs/03` §5 happens, and the model says so on screen instead of implying false precision.

One interpretation is worth flagging explicitly: the deck's Utfall table is rolled once per 24 h game turn. Read literally as "roll per sortie" it grounds a five-bay base within a day. So the table is used for what its columns describe — *classifying* a defect — while separate rates decide *whether* one occurred. `context.md` itself flags the deck's headings as needing SME confirmation, and this is exactly such a point.

## Architecture

```
src/sim/          headless, deterministic, no React — runs in a test or a script
  rng.ts          seeded PRNG, separate stream per concern
  dist.ts         distributions (lognormal, PERT) — never point values
  solar.ts        real solar geometry
  weather.ts      stochastic weather with AR(1) persistence
  tables.ts       the deck's Utfall d6 tables
  params.ts       every tunable, each with a provenance tag
  engine.ts       fixed-step step(), the world
  policy.ts       the tool and the baseline
  runner.ts       paired A/B harness + headless batch
src/ui/           React; samples sim state, never drives it
```

The one-way dependency matters: `sim` knows nothing about `ui`, and `policy` acts on the world only through the same actions a human has. If the tool could reach into state directly, any measured advantage would be meaningless.

## Known limitations

- One base. Dispersion and rebasing between huvudbas/sidobas/reservbas are not modelled, though base type changes capacity.
- No map. Deliberate — this repo is about the base as a system; v2 already has the tactical picture.
- Missions are generated at a tempo rate rather than imported from a real ATO. CSV ATO import exists in both hackathon builds and could be reused.
- The tool is a good heuristic policy, not an optimiser. An oracle policy with perfect information would give an upper bound and let you say "the tool captures X % of what is achievable" — a stronger claim than the current one.
- Weather is synthetic. SMHI Open Data is free and needs no key; wiring the real feed is a follow-up and the model shape is already right for it.
