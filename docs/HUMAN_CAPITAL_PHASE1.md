# Simulation integrity and acquired human capability

Implementation baseline: `db2da02` (engine 0.12.0). New histories use engine 0.13.0.

## Audit against the current tree

The September 7 test audit predates the current province-resource economy, typed construction materials, movement-shaped roads, social graph, personal memory, and historical-importance work. This implementation follows those systems rather than replacing them.

Concrete defects found:

- `AdvancedCivilizationSystem.applyShock` directly changed `alive`, bypassing widowhood, memories, history, archives and notable retirement.
- `runPeople` skipped inactive homes before ageing or mortality.
- Historical importance used a retained-array offset. Memory attempted index recovery but could replay old events after eviction of its cursor anchor.
- Runtime institutions/political transitions emitted different names from importance's consumers.
- Normal battles had commander actors and coordinates but no settlement locality for memory witnesses.
- Urban-industrial totals could remain stale. Statistical cities repeatedly followed named residents' shares, and statistical carrying capacity depended on sample size.
- Food/economy production used named people while material consumption and military strength sometimes used city citizens. Army provisioning converted citizens back into sample units.
- Province resources and the older catchment/material processing pipeline each allocated the same workers. Infrastructure and ordinary construction also had independent work budgets.

Baseline checks also reproduced an unrelated drought-yield clamp and city-interest pacing failure. The clamp erased negative water-yield effects; city interest alone incorrectly reduced ordinary viewing speed. Both received local fixes. Three existing lint errors received mechanical fixes.

The migration test's engineered-road assertion was stale: `installMovementRoadAuthority` replaces early planned circulation with actual footpath/track wear. The test now requires repeated, owned path wear and developed tracks; it retains the original seed, horizon, migration and zero-trade assertions.

## Authority boundaries

| Authority | Owner and contract |
| --- | --- |
| Explicit deaths | `people/PersonLifecycle.ts`: idempotent batch lifecycle, one event per person |
| Event identity | `History.ts`: monotonically increasing sequence, independent of retained position |
| Citizens | `Population.ts`: living explicit residents until statistical abstraction; city aggregates thereafter |
| Named modern people | Documentary lives, never implicit weights over thousands of citizens |
| Monthly work | `people/HumanCapital.ts`: one allocation snapshot, separate consumable material and infrastructure budgets |
| Knowledge | Existing discovery → practice → adoption → infrastructure records remain authoritative |
| Personal capability | Bounded acquired expertise on the person; health and work availability affect its deployment |
| Presentation | Reads career, expertise, teaching provenance and historical state; never supplies skill or citizen totals |

`Simulation.population` remains the explicit living-person count. `representedPopulation` and `settlementRepresentedPopulation` are the citizen APIs. Their optional residents argument accepts an already indexed living-resident bucket. Living displaced people count globally even while outside active city totals.

At statistical transition, current residents seed city workforce profiles once. Thereafter occupational shares, effective capacity and expert concentration are retained per citizen, scaled by city population and aggregate health. Replenishment, death, occupation changes or movement of documentary people do not re-sample these profiles. Carrying capacity uses inhabited land, buildings and sectors. City founding explicitly transfers a demographic share; ordinary named migration transfers no implicit citizens. Documentary births/deaths have separate counters. Documentary foot traffic no longer constructs aggregate infrastructure.

## Lifecycle and displacement

Ordinary mortality groups deaths by cause, warfare batches combat deaths, and advanced shocks call the same lifecycle. It clears reciprocal partnerships, records exact birth/death timing and expertise, creates surviving-family and relationship memories before graph pruning, updates household membership, retires notables and notifies Simulation's indexes. Parent/child IDs remain as genealogy. Repeated death requests do not repeat events or statistics.

Floods, tornadoes and structure fire currently damage structures/environment; exposed people can suffer health effects through the existing people path and subsequently die through ordinary mortality. They do not independently assign `alive = false`.

An inactive home sets `displacedSinceMonth`. Survivors keep ageing, lose health while stranded, remain subject to age/health mortality, and retry reachable refuge every quarter. Failed passage does not kill or remove them. Successful refuge changes the existing person and indexes, clears displacement and records migration.

## Personal data model

- `expertise`: at most three `{ domain, competence, lastPractisedMonth, teacherId? }` entries, using the existing `KnowledgeDomain` taxonomy. Competence is in [0, 1].
- `career`: `{ startedMonth, lastReconsideredMonth, reason, inactiveMonths }`.
- `SocialRelationship.teaching`: one compact `{ mentorId, learnerId, domain, progress, lastTaughtMonth }` record.
- `displacedSinceMonth` and `diedMonth` are lifecycle state, not presentation flags.

Default productive domains are agriculture (farmers/foragers), mechanics (builders), materials (artisans), transport (carriers), and records (keepers). Existing healer/medical, energy-technician and factory roles practise medicine, energy and manufacturing respectively. No new parallel skill taxonomy was introduced.

## Practice and careers

Quarterly practice follows a diminishing-return curve:

`new competence = old + (1 - old) × (1 - exp(-0.008 × elapsed months × effort × availability))`

Healthy sustained practice approaches strong competence over a decade and mastery over multiple decades. Inactive expertise begins very slow decay after ten unused years. A job label never grants competence. Builders without projects or damage receive only a small routine-maintenance practice allowance; settlements with no buildings provide none. Unconnected carriers receive reduced local-transport practice. Health affects current work independently of stored competence.

Birthdays no longer redraw occupation. Adulthood, retirement and return after prolonged inactivity can reconsider a career through the existing seeded occupation selector. Era-specific roles, supported workplaces, appearance and social position can still refresh. A supported workplace persists when the role remains compatible. Migration changes the home and refreshes identity on arrival without erasing expertise.

## Effective labour and consumers

For an available worker, base effective capacity is:

`health × (0.8 + 0.55 × relevant competence)`

Children, displaced people and people currently migrating contribute no civilian work. Elders have a reduced work allowance but can still teach. Mobilization reserves a bounded civilian share separately from combat strength.

The resource share of each occupation is inherited from the current material system: forager 50%, builder 35%, artisan 60%, keeper/carrier 50%, elder 25%. Two percent is reserved for contact/teaching. The rest supports ordinary production. Ten percent of the builders' remaining share supports infrastructure; industrial settlements reserve half the artisans' ordinary share for industrial throughput.

- Food production and generic goods use the ordinary share.
- Weather repair and settlement construction share builder capacity; construction waits when repairs take priority.
- Province extraction, recipes, material consumption, catchment extraction and typed material processing spend the **same** remaining resource budget.
- Transport projects and knowledge-driven infrastructure spend a shared infrastructure budget.
- Industrial processing is capped by its allocated effective workforce as well as real inputs.
- Knowledge experimentation observes relevant productive-domain capacity. Practical knowledge gains also depend on living practitioner availability and expert concentration. These signals do not allocate another workforce.

The food yields were recalibrated when health and exclusive allocation became binding, preserving viable seeded demography without removing either constraint. Skills supply one bounded capacity contribution; technology, land, stock, institutions and weather retain their existing roles.

## Directed teaching and continuity

Teaching requires at least six months of relationship history, recent contact, adequate trust/strength, a shared active settlement, acceptable food/conflict conditions, an available teacher with competence ≥0.6, and a learner in a relevant occupation. The competence gap must exceed 0.12. A teacher handles at most two learners per quarterly pass; each learner gets one lesson. Only the learner gains competence.

Repeated gains accumulate on the directed relationship. At 0.1 cumulative progress, the learner's domain slot records the teacher, and memory/historian consumers can describe a genuine lineage. A nominal mentor edge alone produces neither competence nor a lineage memory. Successful teachers can earn a modest historical contribution signal without making every worker notable.

Death removes the expert's contribution; migration moves it with the same person; a trained successor retains their own acquired competence. Knowledge records and archives are not erased merely because their best practitioner dies.

## Observable examples

For a healthy artisan in a peaceful, non-industrial settlement, competence 0 gives 0.8 effective worker-months; competence 0.9 gives 1.295. The latter supplies 0.777 resource worker-months against the novice's 0.48, with the same citizen count. A mature artisan can therefore execute more material work when stocks, recipes and access permit it.

Suppose a workshop has one master at competence 0.9 and one learner at 0.1. Losing the master removes 90% of its living expert concentration. If repeated teaching raises the learner to 0.6 first, the same death removes 60%; the successor retains the remaining practical tradition. Moving the master instead removes their source contribution and adds it at the destination once they are available to work. Neither case clones the person or moves thousands of statistical citizens.

## Performance and changed systems

Expertise and provenance are bounded. Practice/teaching are quarterly and O(P + R) with bounded domain work. A monthly allocation snapshot avoids rebuilding per-person domain reductions for every consumer. Existing settlement resident indexes are reused. Death memory uses relationship adjacency; social influence application and historical importance avoid repeated full-edge scans. History consumers use sequence-based suffix lookup; archives subscribe at emission so trimming cannot erase an unseen death.

Changed systems: Simulation, AdvancedCivilizationSystem, Population/History (new), PersonLifecycle/HumanCapital (new), PeopleSystem, SocialDynamicsSystem, HistoricalImportance, PersonalMemorySystem, KnowledgeSystem, ResourceSystem, MaterialEconomy, SettlementResourceExtraction, SettlementDevelopmentSystem, WaterCivilization, TransportationSystem, MilitaryCombatRuntime, FootTraffic, historian/archive/presentation readers, types and engine version.

## Phase 2 / Phase 3 boundaries

- Phase 2: institutional recruitment, workplace-specific apprenticeship capacity, explicit teaching continuity after graph turnover, specialized research teams and stronger preservation/workshop integration. Current practice is periodic and role/condition based, not individual recipe execution.
- Phase 3: evolving demographic/workforce cohorts, aggregate skill reproduction/attrition, age composition, actual military service and demographic migration. Statistical workforce profiles are deliberately retained, not yet a cohort simulator. Named modern lives remain documentary and cannot independently train or destroy a city's aggregate workforce.
- Aggregate natural demography currently models net growth; gross cohort birth/death accounting remains Phase 3. Active political office holders can still affect institutions through the existing political model; this pass removes documentary population/workforce weighting, not political agency.
- Durable archives retain important records beyond the simulation's bounded working history. Extremely long archive storage will eventually need paging/retention policy independently of event-cursor correctness.

Validation results are recorded in the completion report after the final suite and focused regression checks.


## Runtime budget reconciliation

The untouched `db2da02` worktree reproduced all five timeout failures with one Vitest worker. No assertion, seed, horizon or terrain validation was removed. Updated test-specific budgets cover the measured workloads:

| Test | Baseline measured | Old budget | New budget |
| --- | ---: | ---: | ---: |
| Presentation speed independence, two 80-year histories | 20.759 s | 20 s | 40 s |
| Presentation presets, two 180-year histories | 68.162 s | 60 s | 90 s |
| Three 80-year pedestrian terrain histories | 41.813 s | 20 s | 60 s |
| Restart/current seed, three 25-year histories | 13.519 s | 5 s | 20 s |
| Restart/history isolation, 30 + 5 years | 7.006 s | 5 s | 12 s |

Profiling the new implementation identified repeated human-capital reductions; the productive phase now shares one snapshot instead. No hydrology or navigation cadence was reduced to make these tests pass.
