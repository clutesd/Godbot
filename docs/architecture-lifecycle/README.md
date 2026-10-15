# Architecture lifecycle and progression repair

Three unassisted 400-year runs per side (seeds `alpha-river`, `basalt-coast`, `north-steppe`; 360 founders; default settings). The observer (`src/dev/architectureReachability.ts`) only reads state. It resolves every completed, active plot through the production `developmentBuildingRole` → `developmentPresentationEra` → `resolveBuildingSpec` path. It resolves prime movers through the EnergyRenderer context, bridges from completed transport segments, and visibility from the renderer's own display sample (`selectDisplayedPlots`). An archetype counts as built only when a completed, active structure resolves to it. Fixtures and the architecture browser are never counted.

```
npx tsx scripts/architecture-reachability.ts <seed> 400 output/architecture-reachability/after/<seed>.json
node scripts/summarize-architecture-reachability.mjs output/architecture-reachability/after
npx tsx scripts/architecture-lifecycle-preview.ts && python scripts/render-architecture-lifecycle-preview.py
```

Determinism: two runs of the same seed (80 years) produced byte-identical records.

## 23-archetype reachability matrix

"First built" gives the year per seed (alpha / basalt / north); "—" means never built. Every built structure was also inside the display sample in the same year, except bridges, of which none were ever built.

| Archetype | Construction authority | Required knowledge / materials / environment | Before | After | Status | Exact blocker if unreached |
|---|---|---|---|---|---|---|
| house | Development, housing | none; L2 engineered; L3 civic-administration ≥0.35 and population ≥100 (new) | 1/1/1 | 1/1/1 | PASS | Modern/contemporary stage needs precision-manufacturing, electrical-generation or automation practised by the builders. No seed reached those. |
| barn | Development, food field | fertile land, farmers | 1/1/1 | 1/1/1 | PASS | |
| byre | Development, food field | animal-husbandry | —/—/— | 50/65/143 | **FIXED** | Was: husbandry never recorded on the field response |
| stable | Development, food field | animal-husbandry, bronzeIron+ | —/—/— | 76/63/173 | **FIXED** | same |
| animal-pen | Development, food field | animal-husbandry | —/—/— | 35/64/140 | **FIXED** | same |
| granary | Development, food store | none | 7/8/8 | 8/8/9 | PASS | |
| silo | Development, food store L3 | mechanical-power ≥0.4, ≥5 farmers, food surplus, industrial-period technique | — | — | Pathway repaired; not reached | No settlement practised mechanical-power in 400 years. Before the repair it was impossible: stores were capped at L2 and level-only era capped every non-works building at preIndustrial. |
| workshop | Development, manufacturing | pottery-firing or metal-smelting, artisans | 12/15/4 | 1/11/4 | PASS | |
| mill | EnergySystem waterwheel | wheel-axle + simple-gearing (or rotary-machinery), accessible river flow >0.08 | — | — | Not reached; environment + knowledge | simple-gearing was practised only in basalt-coast (y335), and its site has no usable river flow, so a windmill was chosen. Path proven in `mill-energy-integration.test.ts` (fixture, not counted). |
| windmill | EnergySystem windmill | wheel-axle + simple-gearing; timber 7, textile 1 | —/—/105 | —/340/— | PASS | Built and ran: 1,404 plant-months (basalt-coast). north-steppe lost simple-gearing in the diverged history. |
| hand-mill | Development, food store L1 | cereal fields, no simple-gearing (records `hand-milled-grain`) | — | —/62/50 | **NEW ROUTE** | |
| sawmill | Wood facility tier 2 | rotary-machinery ≥0.3, or simple-gearing ≥0.35 + metal-smelting ≥0.3; workshops ≥0.3; paid blades | — | — | Route added; not reached | Only saw-pits were built. basalt-coast met the knowledge gates late (y320–335). These runs did not capture which tier-2 gate (workshop capacity or bill) failed afterwards. Previously, even a built sawmill would have rendered as a factory. |
| wind-pump | EnergySystem windmill at a water works | wheel-axle + simple-gearing; built water works; surface-water shortfall or drought (new water-lift demand) | — | —/351/— | **NEW ROUTE** PASS | Ran 583 plant-months and lifted water into the works. |
| smock-mill | EnergySystem windmill | timber/earth site whose recorded technique is earlyModern+ | — | — | Route added; not reached | The basalt-coast windmills stand on plots built with medieval-period technique. |
| factory | Development works (L3 manufacturing/energy/water), facility tier 3 | L3 gates: ≥5 builders, artisans+keepers ≥8, prosperity ≥0.5, plus per-need knowledge | 363/—/— | — | Not reached after | L3 works were reached once before (an alpha-river sanitation works, y363); that history diverged. No seed met precision-manufacturing or electrical-generation. |
| market | Development, trade gathering | trade routes | 53/15/27 | 42/13/20 | PASS | |
| warehouse | Development, trade/transport store | ≥12 lifetime freight imports, inland | started y67 / — / — | 113/—/— | PASS (alpha) | |
| civic-hall | Development, government/knowledge/health | council or capital; keepers | 56/49/38 | 86/54/245 | PASS | |
| shrine | Development, religion | temple institution or religiousTendency ≥0.65 | — | 148/—/— | PASS (alpha) | basalt-coast attempted 368 times and was blocked each time on wood/minerals. north-steppe was blocked by no-valid-plot (101) and resources. |
| gatehouse | Development, security tower | militarism or conflict | 81/44/105 | 62/47/95 | PASS | |
| bridge | TransportationSystem (`subsystem`) | completed bridge segment; drawn by TransportStructures, now published as the bridge archetype and lineage stage | — | — | Not reached | 0 bridge segments in any run, before or after. `improved-roads` was never practised, and transport responses were unavailable 78–392 times. |
| dock | Development, trade/transport store | waterfront + freight | — | 276/—/— | PASS (alpha) | |
| boundary-wall | Development, security perimeter (new) | fully developed (L3) garrison + conflict >0.45 | — | — | Route added; not reached | Highest security tower level reached was 2. |

Distinct archetypes built across the three seeds: **9 before, 16 after**. All 23 archetypes now have a legitimate construction pathway in code. The seven still unreached are blocked by knowledge the simulation never reached in 400 years, or by geography (mill). None are blocked by code that rejects the building.

## What was broken and what changed

**Shrinking**
- `GodboxRenderer` multiplied `scale.y` by `0.12 + 0.88·condition` and tilted decaying buildings. Removed. `StructuralDeterioration.ts` now runs construction backwards on the building's own `assemblyPieces`: finish and fit-out go first, then roofing, then upper wall courses, with fallen fabric left at the foot. The banded plot condition drives surface wear through the spec's age state. Scale and transform never change.
- `StructureDestruction` squashed war-damaged buildings that were left standing. They now keep full size and receive localized damage; only a building that actually falls is animated down.
- `structureFit` matured against the *current* level, so repurposing a level-3 hall to a level-1 use shrank it by 12%. It now uses `peakStructureLevel`, recorded by the sim as `peakLevel`.
- Upgrades could be smaller on the same plot, for two reasons: the next level resolved to a narrower later-period stage, or a wider plan was fitted down uniformly. Upgrades now grow from the previous generation's envelope: the spec envelope plus a composed-mass correction, resolved recursively through history. `upgradeFit` additionally keeps the fit at or above the previous generation's. The sim extends the plot when the ground is clear.
- Adaptive reuse keeps the larger standing shell (`StructureDevelopment.fabric`) until something at least as large replaces it.

**Progression and simulation authority**
- `developmentPresentationEra` derived era from level alone. Every L1 building was neolithic, and nothing short of a works got past preIndustrial. Responses now record the construction techniques their builders practised (`technology`), frozen with the building. Era is the higher of the level floor and the technique (`technologyEra`).
- Housing was capped at L2 and food stores at L2, which made dense housing courts and silos impossible. Both now have a genuine L3 gate.
- Farm responses never recorded `animal-husbandry`, so byres, stables and pens were unreachable.
- Hand mill, sawmill, wind pump, smock mill and boundary wall are routed from recorded facts: `hand-milled-grain`, the wood facility tier, the windmill's site and fabric, and `perimeter-defence`. The bridge is declared `subsystem` and its production renderer publishes the archetype.
- Energy: plant choice ignored fodder, so an animal gin always beat wind and water mills. Gins are now re-equipped (paid) when a better shaft machine is buildable. Water works gained a real water-lift shaft load, and the water it lifts feeds `builtService`.
- Plot search only looked a few units from existing plots. A second, wider pass runs only when the first finds nothing. Gentle mountain ground (slope ≤0.3) is buildable; the slope, relief, water and contract tests are unchanged.
- When construction is blocked on wood or stone, spare artisan, carrier and keeper resource time can cut timber and quarry stone at reduced efficiency. The project's remaining bill counts in the extraction target.
- The render budget showed the oldest plots first, ruins included, which hid every later building. It now shows the newest of each distinct program, a spread of housing generations, then standing fabric alternating newest and oldest, and ruins last.

Blocked annual attempts for `no-valid-plot` fell from 1,946 / 2,061 / 2,322 to 1,145 / 1,476 / 1,917. Settlements now display up to five architectural periods side by side (e.g. `kemihara`: neolithic → earlyModern); before, the maximum was four, and that was in one town.

## Still constraining progression (not fixed here)

All three civilizations still stagnate: none practises mechanical-power, rotary-machinery or anything electrical within 400 years, and most settlements remain `early`. The measured cause is material starvation. Every settlement holds roughly 0 timber and 0 stone from about year 60, because extraction (1–2 timber/month for a town of 150) barely covers cooking fuel. Wood and mineral shortages remain the dominant blockers (2,000–4,700 blocked attempts per seed). The extra quarrying labour helps only marginally. Rebalancing extraction yields, labour shares and fuel use is an economy-wide change beyond this repair. It is the next lever for silo, factory, sawmill, smock mill, wall and modern housing.

## Visual evidence

Each row shares one camera scale, and labels give the rendered extents.

- `condition-before-after.png`: before, height falls 1.76 → 0.41; after, height and plan are kept and decay is shown by lost components.
- `housing-upgrades-before-after.png` and `manufacturing-upgrades-before-after.png`: before, a level-3 house was smaller than level 2; after, extents grow at every level.
- `pathways-before-after.png`: the same simulation responses, before and after the routing and era repair.

## Tests

- `tests/architecture-lifecycle.test.ts` (50): dimensions held under every condition band, monotone decay, the shared cache is never damaged, upgrade ladders never shrink on smallest and largest plots, repurposing keeps the shell, technology era, silo gates, catalogue validation, new routes, display sample.
- `tests/architecture-progression-sim.test.ts` (8): L3 housing and store gates, perimeter gate, frozen technique, husbandry, water-lift demand, a paid wind pump at a water works, a paid gin-to-windmill re-equip.
- Full suite: 2,119 passed, 11 failed, 11 skipped. All 11 failures are pre-existing: they also fail when the simulation files touched here are restored to HEAD (construction-runtime ×2, construction-workface-access, arms-demand ×2, founding-establishment ×3, opening-progression, society, stalled-shelter-replanning). With HEAD files, stalled-shelter-replanning failed one more case than it does now. Typecheck, lint on touched files and production build pass.
