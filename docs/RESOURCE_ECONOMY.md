# Foundational material economy

Engine `godbox-sim-0.11.0` extends the existing settlement, knowledge, transportation, forest and campaign systems. Resource quantities are simulation state. Rendering and the Historian observe the results and never run production.

## Implemented slice

Six geographical resources: wild medicinal herbs, timber, stone, copper ore, tin ore and iron ore. Learned processes produce remedies, charcoal, bronze, forged iron, timber frames and dressed stone. Charcoal and metallurgy also produce ash or slag.

```text
Seed + biome/geology -> finite deposit / renewable stand
  -> exploration -> known location -> resource understanding
  -> available workers + safe carrying path + extraction capability
  -> depleted local stock + cargo in transit
  -> capacity-limited settlement inventory
  -> trials using knowledge, workers, inputs and fuel
  -> learned blueprint + useful output
  -> health / equipped tools and weapons / actual construction payments
```

Deposits alone grant nothing. Ore recognition requires material-testing knowledge; exposed material can be collected before deep extraction becomes feasible. Practice and workshops open progressively deeper reserves. Exhausted minerals do not regenerate. Access checks use the existing `WalkabilityLayer`, including fine hydrology, and reject an endpoint that the path planner cannot actually reach. Distance, terrain, roads, weather, health, security and equipped tools affect the work required. Harvested cargo leaves the deposit immediately but arrives at least one month later. Blocked cargo remains in transit.

New initial communities receive only a finite eight-unit timber and three-unit stone kit. Later colonies receive a share of their parent's real stock. There is no recurring wood or mineral production from a settlement cell's abundance value.

## Code boundaries

| Component | Responsibility |
| --- | --- |
| `src/sim/resources/catalog.ts` | Resource, material and blueprint definitions, geological gates, occupations, quantities, heat, efficiency, risk and unlock metadata |
| `WorldResourceSystem.ts` | Seeded world generation, plant seasons and one world-level renewal pass |
| `ResourceSystem.ts` | Monthly orchestration, discovery, controlled extraction sites, labour allocation, carrying paths and local cargo |
| `Processing.ts` | Blueprint prerequisites, shared processing labour, experimental progress, input/fuel spending, output quality and byproducts |
| `Inventory.ts` | Bounded storage, weighted quality, atomic additions/withdrawals and existing bulk-budget accounting |
| `Consumption.ts` | Medicine use, equipment allocation and wear, spoilage, shortages and household consequences |
| Existing `KnowledgeSystem` | Knowledge lineages, experiments, prerequisites, institutions, adoption, decay and diffusion |
| Existing `TransportationSystem` | Construction of trade connections, freight dispatch, movement, blockades and arrival |
| Existing `SettlementDevelopmentSystem` | Site selection, building needs, progressive material payment, reuse and abandonment |

All economic bookkeeping is serialized on settlements: stock quality, resource experience, recipe trials, cargo, demand, imports, equipped goods, shortages and event cooldowns. The resource PRNG has its own simulation-seed fork. Restart reconstructs the system and its navigation cache. The engine version change distinguishes these histories from older simulations.

### Bulk budget compatibility

`settlement.materials` holds specific raw and processed stock. Existing `resources.wood` and `resources.minerals` are projections of **timber and stone**, respectively; ore is never interchangeable with stone. Existing repairs, construction, infrastructure and industry still spend their established budgets. `reconcileBulkStocks` debits those expenditures exactly once and republishes the remaining physical stock. It runs at monthly boundaries and before material transactions. Direct additions to the bulk fields do not mint material.

New material-producing code must use `addMaterial` and consuming code should use `takeMaterial`. `publishBulkStocks` is intended for initialization of explicitly supplied inventories. The generic food, services/goods and wealth channels retain their existing roles.

Storage counts both local stock and reserved incoming cargo. Full stores stop extraction. If capacity is lost while cargo is travelling, the cargo waits for space. Material freight uses the existing four-percent delivery loss and records delivered imports only once.

## Consequences in the existing simulation

- Foragers, builders, artisans, keepers and carriers have finite monthly resource-work shares. Processing and extraction consume a shared budget. Food gathering, ordinary craft, repairs and construction retain the other shares.
- Practical ore samples gate smelting and iron-working discoveries. Actual exploration, gathering and repeated processing add domain experimentation. Failed recipe trials spend samples; sufficient research plus a successful trial establishes a reproducible blueprint. Lost practical knowledge prevents using even a retained blueprint.
- Medicine is consumed to improve people/city health; it does not manufacture food. Forged output is allocated once to tools or arms, which subsequently wear out. Tools improve gathering and farming. Warfare increases equipment wear.
- Metal weapons and bows in the derived military profile require equipped goods. Bronze provides an alternative to iron. The existing campaign and combat systems remain authoritative.
- Timber structures require learned framing and frames; masonry and metal construction likewise require their learned processes and specific processed stock. Construction consumes these progressively. Apothecary, carpenter, foundry and smithy names reflect supplies and practiced recipes through existing building responses.
- Specific resource freight runs over existing commissioned connections. War between its endpoints blocks cargo. Deliveries share recipe experience and deposit locations as well as the existing knowledge/cultural exchange. Resource demand influences rivalry; known foreign deposits can become campaign objectives, and a resource-war settlement can transfer a site's control.
- Mining reduces local fertility and adds pollution. Logging withdraws from `WorldCell.wood`; the existing `WeatherSystem` owns its slow regrowth. The vegetation renderer clears a deterministic subset of forest slots and uses its existing tree lifecycle to show young recovery. There is no separate fast-growing timber stock.
- Worked and abandoned sites are shown as ground-level work piles. Persistent buildings, forest recovery, freight and resource events provide the rest of the visible history. Discovery, first successful recipes, site establishment/abandonment, depletion, imports and shortages are eligible Historian/archive events.

## Extension contract and limits

Add a raw `ResourceDefinition` with ecological/geological conditions, capacity, recognition/extraction knowledge and labour requirements. Add processed outputs to `MATERIAL_CATALOG`, then a `RecipeDefinition` with explicit inputs, knowledge, infrastructure, fuel/heat, labour, research work, risk and outputs. Recipes also support required institutions and minimum industrial intensity. New knowledge retains the existing prerequisite network and may require all or any of a set of physical samples. Add an explicit economic consumer/building response for a new output's use; merely defining a material must never grant a capability.

This pass implements early gathering and metallurgy. It does **not** implement steel, coal, petroleum, industrial chemistry, nuclear materials, tree-species allocation, geological prospecting surveys, dedicated resource-site building projects, third-party naval blockades, raids/loot, recycling, price markets or cohort-scale industrial extraction. Advanced industry and advanced military/atomic applications retain their existing models; their future material recipes must also wire physical inputs into those consumers. Adding a uranium entry alone must not grant nuclear capability. The present fields support the required knowledge, heat, power/factory and institutional gates for that later work.

Extraction is a bounded settlement-scale stand/deposit model; individual decorative trees are not inventory objects. Resource work sites are recorded geographical sites, while dedicated quarries, lumber camps and mines can later be implemented as commissioned structures through the existing development/transport systems.

## Validation

The 38 resource tests cover generation/geological gates, seeded discovery, prerequisites, transport-before-storage, conservation, controlled/unreachable sites, storage, weighted quality, independent regeneration, season/snow effects, forest loss, ore samples, recipe failures/prerequisites, shared labour, institution/industry extension gates, dormant knowledge, medicine, metallurgy, paid building consequences, physical freight, renderer immutability and complete replay/restart.

The acceptance scenarios run from empty material inventories through discovery and medicine use, and from physical timber/copper/tin/iron through charcoal, bronze, iron production and equipped tools. A 20-year unmodified-world smoke run (`material-smoke`, size 28, population 160) developed different local stocks and work sites, with charcoal and timber-framing learned in all four living settlements. That world generated no tin, demonstrating that bronze access is not guaranteed by age.

Build, typecheck and lint pass. Four unrelated full-suite failures were reproduced against clean commit `fb37ae5` in an isolated worktree: blizzard snow-versus-mixed classification, flower draw-call count, people destination placement, and historian city-view pacing. Resource-related fixtures now explicitly provide physical stock/equipment, and the blizzard production test measures harvested timber in transit instead of an abstract wood increment. The archive compatibility fixture pins its original engine version and verifies that this material-rule change produces a different history fingerprint; all ten archive tests pass.
