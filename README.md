# Airbase Simulation

A high-fidelity simulation of a Swedish dispersed airbase system, built so that an
**airbase management / decision-support tool can be layered on top of it and measured**.

## Why this repo exists

Two hackathon projects already built the *management tool* side of this problem:

| Repo | Site | Role |
|---|---|---|
| `SAAB-Smart-Airbase-with-Road2Air` | [link](https://hungnguyenforworks-lgtm.github.io/SAAB-Smart-Airbase-with-Road2Air/) | Hackathon v1 — turn-based ATO/resource planner ("Road2Air") |
| `Saab-stridsledning-hackathon` | [link](https://j-henriksson.github.io/Saab-stridsledning-hackathon/) | Hackathon v2 — real-time tactical C2 + map ("Smart Stridsledning") |

Both are **tool-first**: they present an operator UI and a light stochastic model
behind it. Neither contains a simulation that could stand on its own and be used as
a *measurement harness*.

This repo is the missing half: **the simulated world**. The tool then runs against
it, and its effectiveness becomes a number rather than a claim.

## Status

**Analysis only. No code yet — deliberately.**

Read the docs in order:

1. [`docs/01-PROJECT-ANALYSIS.md`](docs/01-PROJECT-ANALYSIS.md) — what the two projects are, how they differ, and the gap to the team's vision
2. [`docs/02-DESIGN-PRINCIPLES.md`](docs/02-DESIGN-PRINCIPLES.md) — the visual + interaction system, so this reads as part of the same family
3. [`docs/03-DATA-REQUIREMENTS.md`](docs/03-DATA-REQUIREMENTS.md) — what data realism needs, and where to actually get it

## The core idea

> Simulate the airbase honestly. Then apply the management tool on top of it and
> show, with a controlled baseline, how much better the base performs.

That last clause is the whole point, and it is the thing neither existing project
can currently do.
