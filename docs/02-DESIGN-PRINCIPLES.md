# Design Principles

Distilled from the two hackathon builds so that anything added here reads as part of the same product family. Both repos share one design system; this is that system made explicit, plus the rules the simulation should add.

## 1. Brand foundation

The palette is Saab's official brand palette, used verbatim. Do not invent new hues.

| Token | Hex | HSL | Role |
|---|---|---|---|
| Navy | `#0C234C` | `220 63% 18%` | primary, chrome, sidebar, headers |
| Red | `#D9192E` | `353 74% 47%` | secondary, destructive, critical status |
| Silver | `#D7DEE1` | `200 12% 86%` | sidebar foreground, muted text on dark |
| Gold | `#D7AB3A` | `42 64% 53%` | accent, active state, time display, warnings |

Derived semantic tokens (already defined in `src/index.css`):

- `--success` / `--status-green` = `152 60% 32%`
- `--status-amber` = gold
- `--status-red` = red
- `--status-blue` / `--info` = `220 63% 38-40%`
- `--background` = `216 18% 95%` (light, cool grey — **the app is light-mode-first**)

**Rule:** every colour goes through an HSL CSS variable. Components consume `hsl(var(--token))`. This is why `tailwind.config.ts` maps every Tailwind colour to a variable rather than a literal.

One honest inconsistency to fix going forward: v2 components frequently inline literal HSL strings (`style={{ color: "hsl(42 64% 62%)" }}`) instead of using the tokens. Match the *values*, but prefer the token.

## 2. Typography

Two families, strictly assigned:

- **JetBrains Mono** — body default, all data, all numbers, all labels, status chips, IDs, tail numbers, clock. Set on `body`.
- **Inter** — headings only (`h1`–`h6`), bold, `tracking-tight`.

Conventions observed throughout:

- Labels and chips are **UPPERCASE**, mono, `10px`, bold, wide tracking.
- Numeric readouts use `tabular-nums` so digits do not jitter as they count.
- The clock is the largest type on screen (`text-3xl`, `font-black`, gold) with seconds de-emphasised at `text-lg`, `opacity-60`. Time is treated as a first-class instrument.
- Swedish is the interface language. Domain terms stay Swedish: *Spelvarv, Klargöring, Underhåll, Bränsle, Resurser, Huvudbas, Sidobas, Reservbas, Vapensmed, Flygmekaniker, Plundring*. Keep it. It is a large part of why the product feels authentic.

## 3. Visual language — "military instrument, not military cosplay"

The builds establish a restrained tactical aesthetic. Signature devices, all defined as utilities in `src/index.css`:

- `.card-premium` — subtle two-layer navy-tinted shadow, gradient white-to-off-white, 1px border. The default surface.
- `.card-navy-header` — navy gradient strip with a 50 %-opacity gold bottom border. How a card announces itself.
- `.tactical-grid` — 20px grid at 4 % navy opacity. Background texture.
- `.scanline` — 2px repeating lines at 2.5 % navy. Used very sparingly.
- `.glow-navy/red/gold/green` — `0 4px 24px` coloured glows at 25–35 % opacity.
- `.pulse-red` — 2 s ease-in-out infinite, reserved for genuinely critical state.
- `--radius: 0.5rem`, with `rounded-lg` on interactive elements.
- Body has two 4 %-opacity radial gradients (navy top-left, gold bottom-right).

**The governing restraint:** effects sit at 4–8 % opacity for texture and 15–35 % for meaning. Nothing is neon. The look is a well-made instrument panel in daylight, not a sci-fi HUD.

## 4. Status colour semantics

One consistent four-state vocabulary across fleet, resources, bays, and map:

| State | Colour | Meaning |
|---|---|---|
| Green | `152 60% 32%` | mission-capable, nominal, in stock |
| Amber/Gold | `42 64% 53%` | degraded, approaching threshold, in maintenance, warning |
| Red | `353 74% 47%` | not mission-capable, stockout, critical |
| Blue | `220 63% 38%` | informational, airborne/active, neutral activity |

Applied as a triple — text, background at ~6–8 % opacity, border at ~20 % opacity — e.g. `background: hsl(152 60% 32% / 0.06)`, `border: 1px solid hsl(152 60% 32% / 0.2)`. Reuse that exact recipe; it is the most-repeated pattern in the codebase.

## 5. Interaction principles (inferred from both builds)

1. **Data density over whitespace.** These are operator tools. Panels are tight, `10–11px` mono, many values visible at once. Do not "clean up" by hiding numbers.
2. **Every recommendation states benefit *and* trade-off.** The `Recommendation` type carries `expectedBenefit`, `tradeoff`, `affectedAssets`, `affectedMissions`, `priority`, `explanation`. Never surface advice without its cost. This is the strongest design idea in either project — keep it and make it mandatory.
3. **Explain, then recommend, then let the operator act.** Advice never auto-applies.
4. **Modal confirmation for consequential state changes.** `MaintenanceConfirmModal`, `HangarFullModal`, `LastBayWarningModal`, `RunwayCheckModal`, `LandingReceptionModal` — irreversible or capacity-breaching actions get a dedicated modal that shows what is about to be consumed.
5. **The event log is the spine.** Everything that happens writes an event. It is the audit trail and the AAR source.
6. **Map as cockpit, dashboards as depth.** v2's default route redirects to `/map`; per-base detail lives at `/dashboard/:baseId`. Spatial overview first, drill down second.
7. **Feedback is immediate but reversible.** `sonner` toasts for acknowledgement; pause is always one click away.
8. **Micro-transitions only.** `duration-100`, `active:scale-95`, `hover:opacity-90`. Nothing takes longer than ~150 ms.

## 6. Technical conventions to match

Inherited from v2 — stay on these so code can move between repos:

- **Vite + React 18 + TypeScript**, path alias `@/` → `src/`
- **Tailwind CSS** with the HSL-variable theme, plus `tailwindcss-animate`
- **shadcn/ui** on Radix primitives (`components.json` present in both)
- **lucide-react** for icons, **recharts** for charts, **framer-motion** for motion
- **MapLibre GL** via `react-map-gl/maplibre`; **milsymbol** for NATO SIDC symbology; **@turf/turf** for geo maths
- **Single reducer state** via `GameProvider` context, actions as discriminated unions
- **vitest** for unit tests, **playwright** for e2e
- Deployed via **GitHub Pages** (`.github/workflows/deploy.yml`)

Directory shape worth preserving:

```
src/core/        pure logic — engine, stochastics, validators, units/, drones/, intel/
src/data/config/ tunable parameters — probabilities, durations, capacities, phases, scenario
src/types/       shared type definitions
src/pages/map/   one file per map layer or detail panel
src/components/  game/ | dashboard/ | ui/
```

`src/data/config/` as a dedicated home for every tunable number is the single best structural decision in these repos. **Hold that line absolutely** — see §7.

## 7. Principles the simulation must add

The existing design system covers presentation. A simulation needs four more principles, each of which addresses a gap in `01-PROJECT-ANALYSIS.md`.

### 7.1 Determinism is a design requirement, not an optimisation

Same seed plus same inputs must give byte-identical results, at any timescale. No `Math.random()` anywhere in `src/core`. No wall-clock reads in simulation logic. `createRng` already exists in `stochastics.ts` — thread it through everything.

Consequence: 1x and 3600x must produce the same outcome. The render loop *samples* sim state; it never drives it.

### 7.2 Every number is sourced, or visibly marked as a guess

`src/data/config/` files must carry provenance per value:

```ts
/** @source Saab deck p.11 "Utfall" table */
/** @source ASSUMED — placeholder, needs SME confirmation */
/** @source SMHI Norrköping 1991–2020 normals */
```

Non-negotiable, because the team's goal is realism and the current numbers are mostly invented. A model that cannot distinguish its measured inputs from its guesses cannot be defended in front of a customer.

### 7.3 Distributions, not point values

Realism means `{ dist: "lognormal", median: 45, sigma: 0.3 }`, not `45`. Every duration and error rate should be a distribution so that outputs come with spread. A single run is an anecdote; the deliverable is a distribution over many runs.

### 7.4 Separate the world from the advisor

Two clean layers with a one-way dependency:

```
simulation core  (the world — knows nothing about the tool)
        ↑ reads state, ↓ issues actions
management tool  (the advisor/optimiser — a policy over the same action API)
        ↑
presentation     (React, map, panels)
```

The tool must only be able to do what a human operator could do, through the same action API. If the tool can reach into state directly, any measured advantage is meaningless.

**Corollary — the null policy is a first-class feature.** There must be a `manual`/`no-tool` baseline policy of equal standing, or Gap C never closes.

## 8. Quick reference: doing it right

| Do | Do not |
|---|---|
| `hsl(var(--status-red))` | `#ff0000`, or a new red |
| Mono for all data and numbers | Inter for numbers |
| UPPERCASE 10px mono labels | Sentence-case body labels on chips |
| Swedish domain terms | Translating *Klargöring* to "Preparation" |
| Benefit + trade-off on every recommendation | Bare advice |
| New tunables in `src/data/config/` with `@source` | Magic numbers in engine logic |
| Seeded RNG through the engine | `Math.random()` in `src/core` |
| Modal before consuming a last resource | Silent state change |
| 4–8 % opacity texture, 15–35 % meaning | Neon, heavy glows, sci-fi HUD |
