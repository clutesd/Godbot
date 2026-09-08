# GODBOX prototype development report

Date: 2026-09-06  
Engine: `godbox-sim-0.3.0`  
Purpose: simulation and prototype QA, not a scientific model of real civilizations.

## Executive finding

The final default-config sample is deterministic, stable, and meaningfully branched. All 20 runs industrialized, but only seven crossed the atomic threshold. Those seven did not follow one automatic ladder: three ended `PLANETARY STABLE`, two `INTERPLANETARY`, one `POST-BIOLOGICAL`, and one `UNKNOWN`. This corrects an earlier calibration in which every atomic civilization also became interplanetary and post-biological.

The main remaining modeling concern is convergence before industrialization. Industrialization occurred in every 1,500-year run, and the median polity count converged to one by year 500. Conflict has a much healthier median than the pre-audit model, but one high-conflict tail case remains.

## Method

The final batch used the authoritative headless `Simulation`, the `default` preset, starting population 360, 1,500 simulated years, and seeds `public-qa-final-0001` through `public-qa-final-0020`. Each run recorded a snapshot every 50 years. The same input tuple reproduces each history.

The sample is intentionally modest. Percentages below are QA frequencies within these 20 runs only. They must not be read as estimates about real history or extraterrestrial life.

## Outcomes and milestones

| Measure | Final sample |
| --- | ---: |
| `STAGNANT` | 13 / 20 (65%) |
| `PLANETARY STABLE` | 3 / 20 (15%) |
| `INTERPLANETARY` | 2 / 20 (10%) |
| `POST-BIOLOGICAL` | 1 / 20 (5%) |
| `UNKNOWN` | 1 / 20 (5%) |
| Extinct or collapsed | 0 / 20 |
| Industrialized | 20 / 20 (100%) |
| Atomic threshold | 7 / 20 (35%) |
| Nuclear weapons | 0 / 20 |
| Nuclear use / major exchange | 0 / 20 |
| First orbit | 7 / 20 (35%) |
| Off-world settlement | 6 / 20 (30%) |
| Self-sustaining second body | 4 / 20 (20%) |

Industrialization arrived at a median year 317 (observed range 259-523). Atomic threshold timing had a median of year 882 (range 662-968). Machine-intelligence transition had a median year 949 among the seven runs that reached it. Off-world settlement had a median year 1,119; interplanetary transition had a median year 1,175.5.

Median observed survival after the atomic threshold was 618 years. The default sample contained no weapon program reaching deployment, so it cannot support a default-config estimate of nuclear use. A separate deterministic extended smoke run, `final-calibration-0001` at 2,000 years, produced two nuclear states and one limited use without a major exchange. This verifies reachability, not frequency.

## Population and institutional trajectories

| Year | Population median (min-max) | Median settlements | Median polities | Median active routes | Median active wars at snapshot |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 360 (360-360) | 6 | 6 | 0 | 0 |
| 250 | 242 (151-355) | 6 | 2 | 10 | 0 |
| 500 | 244 (112-416) | 4 | 1 | 6 | 0 |
| 750 | 239.5 (112-2,945) | 3.5 | 1 | 3.5 | 0 |
| 1,000 | 227.5 (96-140,584) | 2 | 1 | 1 | 0 |
| 1,250 | 227.5 (80-7,140,667) | 2 | 1 | 1 | 0 |
| 1,500 | 230.5 (80-11,271,306) | 3 | 1 | 2.5 | 0 |

The population distribution becomes deliberately bimodal after modern statistical transition: stagnant individual-scale societies remain in the low hundreds, while advanced cohort societies reach large aggregate populations. Modern settlement formation now uses represented city population rather than the bounded documentary cast, producing a final settlement range of 2-8 instead of the earlier artificial floor of exactly two.

The active-war column is a point-in-time snapshot every 250 years and therefore misses many short wars. Cumulative conflict is better represented by the wars-per-millennium distribution below.

## Operational distributions

| Measure | Median | Range |
| --- | ---: | ---: |
| Final represented population | 230.5 | 80-11,271,306 |
| Final settlements | 3 | 2-8 |
| Final polities | 1 | 1-5 |
| Wars per millennium | 27.67 | 2.67-164.67 |
| Monthly route trade actions per year | 78.36 | 37.53-172.84 |
| Discoveries per century | 4.37 | 3.40-6.93 |

“Trade actions” counts monthly resource transfers on active routes, not individual commercial transactions. It is useful for comparing simulation activity across seeds, not as an economic real-world unit.

## Diversity and causality audit

The histories are not merely renamed copies. The final runs differ in geography, early population survival, knowledge loss and recovery, industrial timing, city regrowth, polity persistence, conflict load, atomic reach, development priorities, orbital settlement, self-sufficiency, machine adoption, and observability.

The most important corrected failures were:

- Battle narration previously reported requested casualties even when fewer combatants were actually killed. Events now record realized deaths in context, totals, magnitude, and prose.
- Nuclear and natural-catastrophe captions could report a pre-mitigation loss fraction while the state applied off-world protection. Captions now use realized demographic loss.
- Off-world population could grow without a carrying bound and exceed plausible represented population by orders of magnitude. Growth is now logistic against capacity derived from lunar activity, resource independence, and peak population.
- Atomic development previously implied interplanetary and post-biological outcomes in every advanced run. Culture-derived space, machine, welfare, and defense priorities now create inspectable branch conditions.
- Modern cities could be abandoned because only a small documentary cast remained. Settlement viability now reads represented population after statistical transition.
- War initiation was causally parameterized but too permissive. The threshold and realization rate were reduced while preserving hostility, grievance, territory, militarism, trade, trust, alliances, and mobilization as causes.

No outcome is directly selected by a preset or random roll. Random draws still resolve discovery, conflict, risk, and transition uncertainty after state-derived readiness or pressure exists.

## Performance profile

The pre-optimization `profile-baseline` run required about 12.9 seconds for 1,500 years on this machine. With settlement/person/route indexes and cached knowledge occupation counts, the equivalent staged run fell to about 8.0 seconds before later model changes. Its first 250-year block fell from 5.9 seconds to about 2.5 seconds.

A CPU sample located the main costs in `runPeople`, trade knowledge diffusion, discovery requirement checks, movement/activity, index rebuilding, and garbage collection. The following changes were made:

- settlement-to-people, person-ID, and settlement-to-route indexes replace repeated full-array scans;
- knowledge population and occupation counts are reused within a tick;
- duplicate post-advanced index rebuilds run annually rather than monthly;
- event history remains bounded and Historian statements and predictions are capped;
- batch trajectories are sampled in 50-year chunks rather than retaining every month.

The final 20-run batch had a median runtime of 4,982.65 ms per 1,500-year run and median throughput of 3,652 months/second. Runtime varies with the number of persistent people, routes, events, and settlements, so this is a workload measurement, not a universal benchmark.

Renderer review found per-frame color construction, reverse history copies, continuous structural signature work, and missing disposal. The renderer now caches culture colors and recent event scans, throttles structural settlement/route/war checks, bounds pixel ratio and visual density, reduces shadow-map cost, and disposes WebGL resources. The production build separates the initial application (56.44 kB gzip) from the renderer/Three.js chunk (148.66 kB gzip). The raw renderer chunk remains above Vite's 500 kB warning threshold because it includes Three.js.

No connected browser was available during the final pass, so GPU frame time, camera motion, clipping, and the actual composed frames could not be observed with browser instrumentation. Source-level render optimizations and production compilation passed, but an actual visual/GPU capture remains required before calling presentation QA complete.

## Systems that still need watching

- Industrialization is too consistent at a 1,500-year horizon: 20/20 is useful for reaching the experiment, but indicates convergence in the premodern knowledge/economy graph.
- Political integration remains strong: the median polity count is one from year 500 onward, although the final range reaches five.
- Conflict has a reasonable median but a pathological high tail of 164.67 wars per millennium. That seed should be used for future conflict-fatigue and Historian repetition tests.
- The final default sample under-samples nuclear weapons and use. Larger batches and the fragmented-politics preset are needed before tuning strategic risk.
- No final-sample extinction occurred. Extinction and collapse remain tested and reachable, but rare-outcome frequency is not established here.
- Population is intentionally multi-resolution, which creates a sharp statistical scale change. Reports and overlays must continue to say “represented population.”

## Verification represented by this report

- deterministic multi-seed headless smoke runs;
- two final 20-run, 1,500-year reproductions with matching simulation outcomes;
- 50-year trajectory capture and endpoint distributions;
- CPU sampling and before/after acceleration measurements;
- archive, Historian grounding, audio, simulation, knowledge, society, and advanced-system unit/regression tests;
- lint, TypeScript build, and production bundle checks.

The missing item is an instrumented visual browser pass, as noted above.
