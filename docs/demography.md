# Demographic authority and validation

The explicit population remains `Simulation.state.people`. Arrival adds only the pod manifest; subsequent people enter through births (or the existing, population-neutral statistical representative pathway). Deaths still pass through `killPeople`. Rendering does not control demographics.

## Diagnosed feedbacks

* Arrival previously sampled only ages 18–50, with random sexes and no partnerships. A substantial fraction of women therefore arrived near the end of the reproductive interval; all families waited for the first annual pairing pass. There were no children to replace ageing workers.
* Arrival specialization replaced inherited knowledge records with practice 0.02, including stronger seasonal observation. Specialization now preserves the maximum inherited practice/theory.
* Low **reserves** reduced health even when the monthly food ledger recorded full meals. Accumulated deprivation then reduced health again, and health mortality was added to starvation mortality. Current intake now governs nutritional recovery; overlapping health and survival hazards use their maximum. Independent age, pollution, food and cold pressures remain consequential.
* Any persistent ration deficit accumulated indefinitely. A 12% ration could eventually carry the same maximum deprivation as complete starvation. Nutritional debt now decays by 8% monthly, with additional recovery when intake is complete. Mild persistent deficits stay mild; complete starvation still reaches the maximum annual food hazard of 0.32.
* Emergency food responses left an idle interval even after missed meals; helpers could not cultivate alongside existing farmers without a separate crop-selection capability. Actual agricultural labour now supports supervised cultivation. Hardship prompts quarterly reconsideration and more reassignment from the existing civilian budget.
* Resource discovery required a professional forager, despite reserved gathering labour in other occupations. Emergency gatherers can now discover reachable surface resources, paying time at reduced efficiency for exploration. Actual shelter/fuel demand takes priority over unrelated zero-stock materials.
* A roof becoming usable at 75% completion could sharply reduce construction effort before walls were finished. Finishing retains a modest priority, still reduced by competing food urgency. Planned founder groups also bring at least one farmer, forager and builder; these are existing adults, with no extra expertise or labour.
* Migration selected independent working-age people, potentially removing much of a small settlement's workforce while leaving children behind. Selection now uses whole households, a bounded ordinary departure share and remaining-adult checks. Severe deprivation, exposure or conflict permits larger departures. Routes are planned once per person and a household moves only when all routes are feasible, including refuge after abandonment.

## Family model

Each 22-person Arrival manifest contains five established couples, six children/teens, four young single adults and two older knowledge holders. Ages vary deterministically by pod, with plausible parent–child age gaps. Some couples arrive pregnant. Arrival frame sizes do not alter this cohort or its family links.

New conceptions require a living, co-resident partner and respond to age, both partners' health, nutritional debt, food security, conflict, carrying capacity and the existing population soft cap. Pregnancy lasts nine months. After a birth there are at least eighteen months before another conception, giving a minimum 27-month birth interval. Severe hardship can end a pregnancy; six months of recovery follow. A father's death does not erase an existing pregnancy or the child's parentage. The abstraction does not model individual obstetric complications or genetic inheritance.

The healthy peak conception probability is 0.065/month before contextual reductions; after gestation and recovery this corresponds roughly to births every three to four years. It is a conception probability, not a monthly newborn roll. Partnership formation is considered quarterly, beginning in Month 1. Founder households exist at Year Zero.

## Reproduce validation

```sh
npm run demography
npm run demography -- another-seed
npx vitest run tests/demography.test.ts
npx vitest run tests/founding-establishment.test.ts tests/pressures.test.ts tests/human-capital.test.ts tests/simulation.test.ts
npm test -- --maxWorkers=2
npm run build
npm run lint
```

`scripts/demographic-seeds.ts` runs the complete simulation for forty years over six fixed seeds and emits JSON lines. Its exported function accepts a longer horizon and an optional test scenario. Checkpoints at years 5, 10, 20, 30 and 40 report births, deaths, net population, deaths by cause, child deaths, children reaching adulthood, founder retention and living settlements. It captures monthly events before old events are pruned. `foundersYear1`, `foundersYear5` and `residentsYear5` have distributional regression floors, rather than remaining unused telemetry.

Tests cover 100 manifest seeds; reciprocal family links and parent age gaps; early births; gestation and birth spacing; deterministic Arrival/replay; exact population accounting; whole-household migration; nutrition versus reserves; overlapping injury; bounded rationing; moderate interruption followed by recovery without replenishment; forty-year replacement; and two deliberately barren, cold worlds that must go extinct. Viable-seed tests require a majority to sustain descendants, not every settlement to survive. Existing establishment, resource-conservation and catastrophe tests remain authoritative.

These thresholds are regression bounds for a game abstraction, not empirical calibration to a particular historical society. Forty-year replacement does not itself establish that every viable seed will industrialize; later development still depends on the existing knowledge, resource, institutional and conflict systems.
