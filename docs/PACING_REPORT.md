# Historical pacing audit

Date: 2026-09-07  
Baseline engine: `godbox-sim-0.3.0`  
Revised engine: `godbox-sim-0.4.0`

This pass separates three concerns that had previously been entangled:

- **simulation time**: the authoritative deterministic sequence of monthly ticks;
- **historical process time**: causal durations for adoption, construction, political consolidation, decline, and industrial change;
- **presentation time**: wall-clock camera and playback cadence, which is read-only and may be changed without changing history.

## Method

The historical comparison uses eight deterministic 1,800-year runs named `pacing-baseline-01` through `pacing-baseline-08`, a starting population of 360, and the default world pressures. Lifetimes and intervals are medians over the applicable entities or events. A major event has significance `>= 0.7`. Throughput is machine- and load-dependent and is included only as a regression signal.

The presentation comparison replays a deterministic 300-year Historian trace. The baseline trace reconstructs the previous presentation formula and settings; the revised trace runs `Historian` and `PresentationDirector` with the `documentary` preset. It is an instrumentation trace rather than a video capture, so it measures the selected shot sequence and requested authoritative tick rate without renderer overhead.

Run the maintained audit with:

```bash
npm run pacing -- --runs 8 --years 1800 --view-years 300 --seed-prefix pacing-baseline --pace documentary
```

## Historical results

| Measure | Before | After | Reading |
| --- | ---: | ---: | --- |
| Headless throughput | 3,256 months/s | 2,266 months/s | Additional lifecycle state; still about 189 simulated years/s |
| Major discovery gap | 6 years | 6 years | Raw insight cadence remains lively |
| Major technology-transition gap | Not distinct from discovery | 4 years | Cross-settlement milestones can cluster; lifecycle lags below are the more meaningful measure |
| Discovery to adoption | Not represented | 21 years | Discovery no longer implies immediate social use |
| Adoption to transformation | Not represented | 28 years | Institutional and infrastructure support must accumulate |
| Industrial staging | Not represented | 82.5 years | Four stages advance only while urban and material support persist |
| Settlement lifetime | 160 years | 173.5 years | Abandonment now requires a 12-year decline |
| Polity lifetime | 55.42 years | 69.92 years | Annual assessment, consolidation, stability, and dynastic continuity reduce churn |
| Polity lifetime, upper quartile | Not recorded | 117.67 years | Durable regimes survive multiple generations |
| Wars per century | 3.31 | 0.23 | Stable shared polities resist internal war; causal pressure is required |
| Median war duration | 1.17 years | 1.17 years | Authoritative duration is unchanged; presentation now gives it more wall-clock time |
| Settlement to town | 276.25 years | 310 years | Urban change is gradual and varies substantially by settlement |
| Town to industrial transformation | -2.42 years | 43.88 years | Industry can no longer complete before the town phase |
| Settlement to industrial transformation | 308 years | 434.5 years | Infrastructure and staged machinery extend the transition |
| Industrial to atomic threshold | 710 years | 473 years | Still a multi-century separation; atomic gating is capability-based rather than a timer |
| Generations per broad era | 9.06 | 11.78 | A 27-year configured generation is used for the audit |
| Major events per century | 85.5 | 59.5 | Lifecycle evidence is richer while repeated transmissions and war churn lose "major" priority |

Adoption, transformation, industrial stage, and succession events make causal evidence more explicit. Repetition penalties, beat selection, grounded event focus, shot minimums, and adaptive speed control decide which of those records reaches the documentary.

In the revised matched sample, all eight runs industrialized and five reached the atomic threshold. This is model QA, not a claim about real-world likelihood.

### Revised distribution detail

The maintained audit emits the full JSON distribution. The central spread below is `P25 / median / P75` with the number of observations in parentheses.

| Measure | Revised distribution |
| --- | ---: |
| Major discovery gap | `2 / 6 / 17` years (`n=498`) |
| Major technology-transition gap | `0 / 4 / 10` years (`n=721`) |
| Discovery to adoption | `18 / 21 / 24` years (`n=461`) |
| Adoption to transformation | `25 / 28 / 31` years (`n=696`) |
| Industrial staging | `47 / 82.5 / 114.25` years (`n=28`) |
| Settlement lifetime | `113.25 / 173.5 / 343.75` years (`n=166`) |
| Polity lifetime | `50.92 / 69.92 / 117.67` years (`n=166`) |
| Wars per century, by run | `0.08 / 0.19 / 0.33` (`n=8`) |
| War duration | `1.17 / 1.17 / 1.17` years (`n=33`) |
| Settlement to town | `12.13 / 310 / 405.25` years (`n=36`) |
| Town to industry | `43.42 / 43.88 / 141.81` years (`n=28`) |
| Settlement to industry | `377.75 / 434.5 / 542.75` years (`n=28`) |
| Industry to atomic threshold | `437 / 473 / 535` years (`n=5`) |
| Generations per broad era | `4.33 / 11.78 / 16.52` (`n=24`) |
| Major events per century | `14.75 / 59.5 / 107` (`n=144`) |

## Presentation results

| Measure | Before | Documentary preset |
| --- | ---: | ---: |
| Observed historical rate | 103.45 years/min | 9.96 years/min |
| Average shot | 17.4 seconds | 23.17 seconds |
| Ordinary-life viewing share | 30.5% | 28.6% |
| City-life viewing share | 0% | 11.3% |
| Major-event viewing share | 10.9% | 15.0% |
| Accelerated-quiet viewing share | 58.6% | 45.2% |

The revised trace is about 10.4 times slower overall. A median 1.17-year war viewed at the momentous target of 1.5 years per real minute occupies roughly 47 seconds before shot and event selection effects. Quiet passages ramp over 45 seconds instead of jumping immediately to their maximum speed.

The documentary targets are:

| Context | Simulated years per real minute |
| --- | ---: |
| Personal life | 4 |
| Momentous event | 1.5 |
| Significant transition | 3 |
| Ordinary life | 10 |
| Sustained quiet, maximum | 30 |

The measured overall 9.96 years/minute is lower than the quiet maximum because the trace deliberately spends time with people, cities, institutions, and recorded events.

## Implementation notes

- Time presets are config-only and cannot alter historical process rates.
- `PresentationDirector` is read-only and uses no simulation random draws.
- Knowledge stores discovery, adoption, and transformation months.
- Industry stores its current stage and stage start, allowing the Historian and renderer to acknowledge intermediate change.
- Polities store lifecycle phase, stability, leader, dynasty, and succession count.
- Buildings accumulate authoritative construction work over simulated months; renderer-owned stage transitions make completion visible without becoming simulation authority.
- Seasonal vegetation and atmosphere change from the authoritative calendar while ordinary people, trade, work, institutions, and long peaceful periods remain eligible subjects.
- The browser exposes `window.__godboxPacing()` for live presentation telemetry in diagnostics.

All numbers are deterministic for the named engine, seed, and configuration. Changing only the time preset leaves `Simulation.summary()` and `HistoricalEvent[]` byte-for-byte equivalent in the automated test.

## Deep-time revision (2026-09-07, second pass)

The observation horizon moves from 1,800 years to roughly 300,000 years, with no linear map between simulated and wall-clock time. The progression model was re-audited so that calendar time creates opportunities but never unlocks technology by itself.

Model changes:

- Discovery eligibility gates prerequisite knowledge at partial familiarity; the per-year probability then ramps with measured prerequisite mastery (`0.05 + 0.95 * maturity^1.6`) and with a difficulty-scaled critical mass of accumulated domain experimentation (`(experiment / (difficulty * 3))^2`). Experimentation now accumulates over generations (annual decay `0.985`, previously `0.94`) and is consumed by discovery.
- `rail-transport` additionally requires precision tools, engineered roads (`roads >= 0.3`), workshop capacity (`workshops >= 0.3`), at least two active trade routes (transport demand), food security, prosperity, and an organizing institution. `electric-grid` and `internal-combustion` gained infrastructure/urbanization requirements.
- Newly discovered capabilities start at practice `0.12` (previously `0.2`), so local adoption is earned through years of practice; adoption, widespread diffusion (`technology-widespread`, emitted once a majority of living settlements practice a major knowledge), and infrastructure-backed transformation remain distinct milestones.
- Civilization-scale capability in the advanced systems is diffusion-weighted: peak settlement mastery counts for `35%` until adoption spreads, scaling to full strength only as adopted settlements approach the whole living world. A lone breakthrough no longer modernizes the planet.
- Construction cadence (`historicalPace.infrastructureStep`) slowed from `0.035` to `0.014` per year, so roads, workshops, archives, and rail accumulate over generations.
- `Simulation.restart(seed?)` rebuilds the run in place with no leakage; the observer command line (`/restart`, `/restart seed`, `/restart <seed>`) archives the current run and begins Year 0.
- `PresentationDirector` adds adaptive temporal resolution: structural complexity (wars, recent milestones, polities, industry, machine capability) modulates quiet-scene deep-time acceleration up to `presentation.deepTimeAcceleration` and the per-frame tick budget. History is trimmed by significance when bounded, so deep-time records keep milestones instead of birth/death churn.
- New time presets: `fast-test` (identical rules, unbounded pacing), `fast`, `normal`, `long-observation`.

Maintained audit after the revision (`--runs 4 --years 1500 --pace batch/headless --seed-prefix pacing-deep`):

| Measure | Previous pass | This pass | Reading |
| --- | ---: | ---: | --- |
| Major discovery gap | 6 years | 7 years | Discovery cadence remains lively once conditions accumulate |
| Settlement to industrial transformation | 434.5 years | 426 years | The staged industrial assessment, not the calendar, still decides |
| Industrial to atomic threshold | 473 years | 767 years | Diffusion-weighted capability slows the late cascade |
| Discovery to adoption | 21 years | 23 years | Ideas mature before use |
| Atomic threshold reach | 5/8 runs | 3/4 runs | Reaching the atomic age is an outcome, not a schedule |

Single-seed spread checks (`ochre-moon`, `witness-the-saffron-river`, `indigo-rain`, 1,500 years) produced `PLANETARY STABLE`, `INTERPLANETARY`, and `PLANETARY STABLE` outcomes with first railways in years 446-683 and heavy knowledge loss/recovery churn (including a rediscovery of controlled fire in year 712 of one run). Long quiet stretches and regression are ordinary; the old world is not automatically modern.
