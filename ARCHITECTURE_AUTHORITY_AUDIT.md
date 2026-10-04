# BuildingSpec authority audit

Branch: `refactor/buildingspec-authority-20261003`. Work continues in the existing checkout; no reset, stash, merge or architecture replacement was performed.

## 1-2. Production entry points and authority

| Entry point | Canonical path |
| --- | --- |
| GodboxRenderer.createPlacedBuilding | Persistent development plots and ambient fabric -> AssetBuilder -> BuildingSpec |
| GodboxRenderer.addLandmark | Registered landmark -> AssetBuilder -> BuildingSpec |
| GodboxRenderer.createActiveConstructionSite | All projects, founding included -> completed future AssetBuilder target -> ConstructionAssembly |
| GodboxRenderer.addRoutePortals, station shelter | Carrier/storage shelter -> warehouse AssetBuilder target -> BuildingSpec |
| GodboxRenderer.addMarket, stall shelter | Small exchange shelter -> market AssetBuilder target -> BuildingSpec |
| GodboxRendererEnhanced station and harbour shelters | Shared AssetBuilder via productionBuildingShell |
| GodboxRenderer.addSpecializationDressing caravan rests | Shared AssetBuilder warehouse shelter |
| EnergyRenderer mill, generator, powerhouse, boiler and turbine shells | Shared AssetBuilder; true finished members for construction |
| IndustryRenderer lumber/rolling shells and processing upgrades | Shared AssetBuilder; declared future tier and actual components for construction |
| architectureBrowser, constructionReview, humanLifeReview | Production AssetBuilder assets |
| StructureVisualValidation and founding preview/tests | Production AssetBuilder assets |

Within AssetBuilder, ArchetypeRouting and explicit BuildingArchetype lineage resolve BuildingSpec before SpecGrammarBridge. Composer geometry, DedicatedStructures, StructureGeometry, component manifests, materials, LOD and construction consume that resolved architecture. Farmstead edge stores and gathering precinct structures use the ordinary composer, with spec metadata published.

## 3. Retired survival renderer

`src/render/founding/SurvivalStructure.ts` is deleted. All direct test and preview consumers were migrated. There are no live calls to createSurvivalStructure, createActiveSurvivalConstructionSite or shelterGroundAt. The names remain only in documentation/comments and a regression guard.

## 4. Founding adaptations

| Adaptation | BuildingSpec representation |
| --- | --- |
| lean-to | House lineage; low single storey, shed roof, open enclosure, reduced footprint/plinth/openings |
| earth-shelter | House lineage; packed-earth foundation, low plinth/storey, closed enclosure, reduced openings, steep protective roof |
| hut | Small enclosed house lineage, one storey, no annexes |
| cache | Small granary/storage lineage, one storey, hipped roof, no windows or annexes |

DevelopmentResponse carries adaptation/purpose/form. No adaptation owns a renderer. Early civic, exchange, carrier, watch and landing shelters have explicit Neolithic stages. Early energy workshops stay workshops until the classical mill lineage is available; Neolithic husbandry selects barns/byres rather than lifting a stable to a later period. Founding construction starts from prepared ground, reveals actual target members on founder contacts, and never exceeds paid progress. Construction fitting uses the same bounded development scale as completed placement. Asset cache keys include authoritative capability evidence and the response material bill, including completed plots with no active project.

## 5. Remaining BuildingRole usage

Roles remain for simulation/placement, district/cache keys, default archetype routing when no program is supplied, sleeping/diagnostic labels, and compatibility fixtures. They cannot independently change spec-driven composer geometry. Domestic structural detail, ceremonial footing steps, tower component classification and production scaffold material now consume spec identity. Active construction requests only the complete future target, avoiding an unused stage-specific asset. Sleeping-area eligibility reads published archetype identity and actual housing service.

Role shape and era clamping remain in the compatibility-only BuildingGrammar resolver. AssetBuilder invokes it only for explicitly non-building memorial compositions, whose markers have no building shell/storeys. Direct legacy composer/grammar tests still exercise compatibility fixtures. Production buildings always resolve a spec.

## 6. Browser coverage

Production Inputs has 18 roles, four founding adaptations, 11 earliest Neolithic active lineages (house, barn, byre, granary, workshop, market, warehouse, civic-hall, shrine, gatehouse, dock), 25 simulation need/form combinations and 15 active archetypes. Every object uses AssetBuilder. Inspector exposes purpose, form, adaptation, family, foundation, all assigned materials, selected construction stage and the complete resolved BuildingSpec. A Structure program selector combines explicit archetypes with authoritative purpose/form cases to inspect subsystem subsidiary buildings. Timeline starts at earliest legitimate lineage stage. Gallery and Street remain available.

Visual UI QA could not run: browser inventory is empty and the Windows Computer Use native pipe is unavailable. Coverage, routing and production geometry were checked through code and tests; no screenshot inspection is claimed.

## 7. Validation

The final combined architecture/construction/subsystem suite passed: 20 files / 227 tests. It includes routing, spec, geometry, integration, materials, visual budgets, components, worksites, founding contact assembly, all-role/program/adaptation authority and subsystem future-component convergence. Related identity/generation/heritage/transport/founding-presentation checks also passed: five files / 26 tests.

Expanded founding coverage passed 280 of 281 tests; its single founding-continuity narration failure reproduces identically on current main (nine passing / one failing in that file).

Typecheck, lint and build pass. Vite reports its existing large-chunk advisory.

## 8. Full regression comparison

Final unchanged-tree run completed: **198 files, 1,657 tests: 1,612 passed and 45 failed in 16 files**. Current main completed: **196 files, 1,647 tests: 1,600 passed and 47 failed in 16 files**. All 45 final branch failures match main by file and full test name; there are **zero branch-only failures**. Two tests failed on main but passed here: people role/destination determinism and the multi-generation demographic distribution check. These passes are recorded as run variability, not attributed to an architecture fix.

Shared failing files: advanced, archive, demography, documentary-human-cadence, foot-traffic, founding-continuity, local-activity, people-presentation, people, processing-facilities, restart, role-visual-profile, settlement-development, simulation, society and weather. The initial branch run overlapped edits; its four transient architecture failures are absent from the final full run and pass the final focused suite.

Failure evidence is retained under output/architecture-authority. No unrelated simulation, camera or local-activity failure was changed.

## 9. Remaining architectural bypasses

No separate survival-building authority remains. Hand-authored base/enhanced stations, market/harbour/caravan shelters, energy houses/halls and processing sheds were migrated. Pressure vessels, turbine/boiler casings and dams remain machinery/infrastructure. Non-building systems still own transport deck/gate infrastructure, processional gates, wells/windlasses, cargo/equipment, burial markers, walls and construction scaffolding. These are open infrastructure or working presentation, not independent inhabited building shells. The architecture compatibility resolver remains isolated to the explicit non-building memorial case and fixtures described above.

No merge was performed.
