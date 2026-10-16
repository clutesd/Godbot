# Founding shelter pace and construction integrity

Measured with `scripts/founding-seeds.ts` over 60 simulated months, nine seeds, five landings each. "First protection" is the landing pod's own shelter (capacity 4 of 22, day zero). "First shelter" is the first month in which paid construction raises usable capacity above the pod (a roof at 75% of its bill).

## Before and after

Before (same three seeds the regression guard uses, repository state at `bbaca4ab`): first shelter 3-19 months, winter coverage as low as 16-17% in two camps, one camp with no permanent dwelling by month 60. Two woodland camps took 11 and 19 months to roof while 8 timber stands lay four to five cells away.

After: Across 45 camps: first shelter median 4 months (max 8; 40 at month 4 or sooner, 42 within 6, all within 8); winter coverage median 86% (min 51%); permanent dwelling median month 27 (max 50; 1 camp without one by month 60).

| Seed | Landing | First shelter (month) | Winter coverage (month 10) | First permanent dwelling (month) | Founders yr1 → yr5 | Failures flagged |
|---|---|---|---|---|---|---|
| alpha-river | Seed | 4 | 90% | 25 | 21 → 21 | — |
| alpha-river | Forge | 5 | 94% | 50 | 20 → 19 | — |
| alpha-river | Lifeline | 7 | 55% | 38 | 22 → 22 | undernutrition |
| alpha-river | Covenant | 4 | 90% | 30 | 21 → 21 | — |
| alpha-river | Horizon | 4 | 90% | 32 | 22 → 22 | — |
| basalt-coast | Seed | 4 | 90% | 22 | 22 → 21 | — |
| basalt-coast | Forge | 4 | 86% | 26 | 21 → 21 | — |
| basalt-coast | Lifeline | 4 | 86% | 39 | 22 → 22 | — |
| basalt-coast | Covenant | 4 | 90% | 25 | 22 → 21 | — |
| basalt-coast | Horizon | 7 | 54% | 35 | 21 → 19 | — |
| delta-hill | Seed | 4 | 90% | 47 | 22 → 21 | — |
| delta-hill | Forge | 4 | 90% | 23 | 22 → 22 | undernutrition |
| delta-hill | Lifeline | 4 | 90% | 25 | 22 → 22 | — |
| delta-hill | Covenant | 4 | 90% | 29 | 22 → 22 | — |
| delta-hill | Horizon | 4 | 83% | 42 | 22 → 22 | — |
| founding-cold-frontier | Seed | 4 | 86% | 27 | 22 → 22 | — |
| founding-cold-frontier | Forge | 4 | 90% | 27 | 22 → 21 | — |
| founding-cold-frontier | Lifeline | 4 | 83% | 41 | 22 → 20 | undernutrition |
| founding-cold-frontier | Covenant | 4 | 95% | none by 60 | 20 → 18 | undernutrition; hut 88% built, famine |
| founding-cold-frontier | Horizon | 4 | 95% | 29 | 21 → 21 | — |
| founding-loop-audit | Seed | 4 | 86% | 21 | 22 → 21 | — |
| founding-loop-audit | Forge | 4 | 86% | 24 | 22 → 22 | — |
| founding-loop-audit | Lifeline | 4 | 90% | 23 | 22 → 22 | — |
| founding-loop-audit | Covenant | 4 | 86% | 49 | 22 → 20 | undernutrition |
| founding-loop-audit | Horizon | 4 | 90% | 21 | 21 → 21 | — |
| founding-sample-a | Seed | 4 | 86% | 23 | 22 → 22 | — |
| founding-sample-a | Forge | 4 | 86% | 23 | 22 → 22 | — |
| founding-sample-a | Lifeline | 4 | 86% | 22 | 22 → 21 | — |
| founding-sample-a | Covenant | 4 | 90% | 27 | 22 → 22 | — |
| founding-sample-a | Horizon | 4 | 90% | 37 | 22 → 22 | — |
| founding-sample-b | Seed | 4 | 86% | 24 | 22 → 21 | — |
| founding-sample-b | Forge | 4 | 86% | 26 | 22 → 22 | — |
| founding-sample-b | Lifeline | 4 | 90% | 19 | 21 → 21 | — |
| founding-sample-b | Covenant | 8 | 51% | 37 | 22 → 21 | — |
| founding-sample-b | Horizon | 4 | 86% | 21 | 22 → 20 | — |
| founding-woodland | Seed | 4 | 90% | 22 | 22 → 21 | — |
| founding-woodland | Forge | 4 | 86% | 40 | 22 → 20 | — |
| founding-woodland | Lifeline | 4 | 79% | 26 | 22 → 22 | undernutrition |
| founding-woodland | Covenant | 4 | 90% | 25 | 21 → 21 | — |
| founding-woodland | Horizon | 5 | 74% | 37 | 22 → 22 | — |
| north-steppe | Seed | 4 | 86% | 44 | 21 → 20 | undernutrition |
| north-steppe | Forge | 4 | 83% | 43 | 22 → 22 | — |
| north-steppe | Lifeline | 4 | 86% | 36 | 22 → 22 | — |
| north-steppe | Covenant | 4 | 90% | 25 | 22 → 22 | — |
| north-steppe | Horizon | 4 | 86% | 27 | 21 → 19 | — |

## What was wrong, and what changed

1. **Timber the camp never looked for.** Surface timber and stone were visible only within two cells of the landing. A camp whose woods lay four or more cells away waited on a ~3%/month discovery roll (16+ months in the worst case) with 0 timber and a project reserved. Camps that are short of a material they need now range out to six cells (`SCOUTING_REACH_CELLS`), spending the same exploration labour, and still must cut and carry the material. (`ResourceSystem.discover`)
2. **Idle building time.** While a roof was stalled on materials the camp reserved its build labour and wasted it. A stalled roof now spends 80% of its establishment time gathering, and returns to the site once stock covers the next stage. (`allocateEstablishmentLabour`)
3. **Month-long haul for a headload.** Gatherers on survival work carried timber on foot but the load waited the multi-month caravan transit; distance is already charged through the yield rate. Foot-carried survival loads now arrive next month; network cargo is unchanged. (`ResourceSystem.gather`)
4. **Earth shelters promised on land with no usable stone.** A mineral-rich cell chose earth-and-stone walls although no stone was reachable by any walkable route; the untouched project then sat at 0% for six months. The plan now requires stone in stock or quarryable within reach, and an untouched earth shelter is reconsidered after two idle months (a permanent hut keeps the six-month patience). (`planEstablishment`, `replanStalledShelter`)
5. **One input hogging the gathering party.** With several inputs short, the first-worked deposit absorbed all the time. The party is now divided in proportion to each input's unmet bill.
6. **Flooded sites and silent stalls.** A hut at 98% on a site under floodwater waited indefinitely beside 5.8 timber. A founding project idle on a flooded site for 12 months is now abandoned (paid fabric lost) and the camp re-sites; a finished-but-invalid site reports `invalid-site` instead of stalling silently.
7. **Trade routes stuck on a footpath.** A road survey that failed on the day a route opened was never retried, because the annual upgrade pass only considered rail and water. Active footpath-only routes now retry the road (existing 120-month retry window), and the footpath survey is recorded (`footpathSurveyedMonth`).

## What is deliberately unchanged

Hardship stays real. Nothing is granted: every roof is paid with cut timber (a regression test checks timber spent never exceeds timber extracted), labour and fibre. A camp whose woods are closed to it makes no progress, names `missing:timber`, and resumes when access returns (`tests/founding-shelter-pace.test.ts`).

## Remaining issues

- A one-month step makes month 4 the practical floor for a 22-person camp: hand-cut timber yields about 0.07 per labour-month and a lean-to bill is 1.2. Shortening it further means changing extraction yields, which would move the whole early economy.
- Food-poor landings still starve (e.g. cold-frontier "Covenant": food 0 from month 28, 11 residents at year 5). That is the food economy, not shelter; it was already flagged `undernutrition` before this work.
- Slow tail: three camps (alpha-river "Lifeline", basalt-coast "Horizon", sample-b "Covenant") take 7-8 months; they build earth shelters whose 1.8-stone bill is quarried by hand.
- Soak: `tests/simulation.test.ts` "allows migration while geography can prevent early trade infrastructure" fails at clean HEAD as well (6 trades at HEAD, 15 here, expected 0). The premise (no trade on that seed) is stale; left for its own change.
