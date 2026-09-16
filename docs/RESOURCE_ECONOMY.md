# Foundational material economy

Engine `godbox-sim-0.11.0` introduced the physical resource economy. Step 1 of the material-authority repair now gives that economy one quantity source: **`Settlement.localMaterials`, mutated through `Inventory.ts`**. Rendering and the Historian observe results and never run production.

## Physical flow

```text
Seed + biome/geology -> finite deposit / renewable stand
  -> exploration -> known location -> resource understanding
  -> available workers + safe carrying path + extraction capability
  -> depleted world stock + cargo / gathering work
  -> bounded Settlement.localMaterials inventory
  -> knowledge + workers + inputs + fuel
  -> processed material / useful output
  -> operating use, freight, roads and construction
```

Deposits alone grant nothing. Ore recognition requires material knowledge; exposed material can be collected before deep extraction becomes feasible. Practice and workshops open progressively deeper reserves. Exhausted minerals do not regenerate. Access checks use the existing walkability and terrain systems. Distance, terrain, roads, weather, health, security and equipped tools affect work.

New initial communities receive a finite timber/stone kit. Later colonies receive a share of their parent's real stock. There is no recurring physical wood or mineral stock created merely from a settlement cell's abstract abundance value.

## Authority contract

### Canonical physical quantity

`Settlement.localMaterials` is the only physical material quantity authority.

All new physical additions and withdrawals must go through `src/sim/resources/Inventory.ts` (`addMaterial`, `takeMaterial`, and the bulk reconciliation helpers) unless a lower-level operation is explicitly part of that inventory implementation.

`Inventory.ts` owns:

- bounded storage and storage room;
- weighted material quality metadata;
- exact material additions and withdrawals;
- projection of canonical timber/stone into legacy bulk `resources.wood` / `resources.minerals`;
- exact-once reconciliation when an older bulk consumer spends those projections.

### `Settlement.materials`

`Settlement.materials` is retained temporarily for typed flow/lifetime telemetry and archive/API compatibility. After `ensureMaterialInventory(...)`, its `stock` field is **the same object as `Settlement.localMaterials`**, not a second ledger.

Old saves are normalized conservatively. If no canonical physical stock exists, historical typed stock can be migrated. If canonical stock already exists, only material kinds that were unique to the old typed pipeline are migrated; overlapping timber, stone, ores, charcoal and bronze are not summed because older builds could have recorded them in both systems.

No gameplay system may treat `materials.stock` as an independent source of physical truth.

### Bulk budget compatibility

`resources.wood` and `resources.minerals` remain compatibility projections of canonical **timber** and **stone**. Ore is never interchangeable with stone. Older repairs, construction and infrastructure code may still spend the aggregate fields; `reconcileBulkStocks(...)` charges that spending against canonical physical stock exactly once and republishes the remainder.

Direct increases to bulk wood/minerals do not mint physical material.

## Resource and processing boundaries

| Component | Responsibility |
| --- | --- |
| `resources/catalog.ts` | Generic ResourceSystem definitions and discoverable recipes |
| `WorldResourceSystem.ts` | Seeded world deposits/stands and world-level renewal |
| `ResourceSystem.ts` | Primary monthly discovery, extraction, labour, carrying and generic processing orchestration |
| `Processing.ts` | Generic recipe prerequisites, labour, input/fuel spending and outputs |
| `Inventory.ts` | Sole physical quantity mutation boundary and storage/bulk compatibility |
| `Consumption.ts` | Generic medicine/equipment/spoilage/household material consequences |
| `MaterialEconomy.ts` | Typed material vocabulary, telemetry, archive adapter and advanced recipes not yet represented by the generic catalog |
| `SettlementResourceExtraction.ts` | Supplemental extraction only for material kinds not yet owned by ResourceSystem |
| `MaterialUse.ts` | Operating demand, scarcity/readiness and construction material bills, all against canonical stock |
| `MaterialLogistics.ts` | Strategic material shipment selection and dependency telemetry; dispatch/delivery use canonical inventory |
| `TransportationSystem.ts` | Network construction and freight movement |
| `SettlementDevelopmentSystem.ts` | Building need, placement, progressive construction payment, reuse and abandonment |

## No duplicate extraction

The generic `ResourceSystem` is the sole authority for timber, stone and its metal-ore resources. The older settlement extraction pass no longer harvests or depletes those resources and no longer rewrites their monthly aggregate production balance.

The supplemental pass remains only because the generic resource catalog does not yet natively cover every advanced material dependency. It currently provides demand-bounded access to legacy world resources such as plant fiber, medicinal flora, clay, coal and uranium ore where appropriate. These resources are written directly into canonical `localMaterials` and share the same monthly resource-labour budget.

That pass must remain supplemental. A resource added to the generic `ResourceSystem` should be removed from the supplemental extractor in the same change.

## No duplicate processing

The generic recipe system owns transformations already defined in `resources/catalog.ts`, including charcoal and bronze casting. The advanced typed processor must not run a second version of the same transformation.

`MaterialEconomy.ts` therefore retains only advanced transformations that the generic catalog does not yet provide, such as lumber, brick, refined metals, steel, medicine and textile. Those recipes:

- read canonical inputs;
- consume inputs through `takeMaterial`;
- produce outputs through `addMaterial`;
- use the shared resource labour budget;
- run at most once per settlement/month;
- preserve flow/lifetime telemetry;
- obey the static mass-conservation recipe validation.

Because validated recipe output mass does not exceed input mass and inputs leave storage before outputs arrive, a valid processing batch cannot require more net storage than the material it consumes.

## Construction and infrastructure

Construction material availability, construction progress limits and progressive physical consumption all read the canonical inventory. A stale historical `materials.stock` value cannot veto a real pile of timber, stone, textile or metal in `localMaterials`.

Construction may still have generic food/goods/wealth or bulk compatibility costs in addition to its physical bill. These channels represent different constraints; they must not create a second copy of the physical material.

Movement-shaped engineered roads consume canonical stone/brick directly. They do not require the legacy typed telemetry object to exist before recognizing real physical stock.

Transport capital and older compatibility consumers can still use the typed compatibility API, but once initialized its stock is the canonical object. Their reads/writes therefore cannot diverge into a second inventory.

## Freight

Strategic typed freight selects source surplus and target shortages from canonical physical stock. Dispatch removes cargo immediately through `takeMaterial`, making it unavailable to the source while in transit. Delivery adds only accepted cargo through `addMaterial`; dependency/import/export/loss records remain telemetry.

Generic material freight likewise uses the existing canonical inventory path. War, route validity and transport state continue to determine whether cargo can move.

## Simulation consequences

- Resource work is labour-bounded rather than free production.
- Knowledge and geography determine which raw materials can be recognized and exploited.
- Processing competes for the same finite workers used elsewhere in the economy.
- Material shortages can reduce infrastructure, industry, healthcare and military readiness.
- Construction cannot progress beyond the fraction supported by its remaining physical bill.
- Freight can relieve a real shortage because sender, cargo and receiver now refer to the same stock authority.
- Knowledge/sample gates and the Historian observe the same physical inventory that construction consumes.
- World extraction, processing, trade, roads and buildings can no longer disagree merely because they looked at different material ledgers.

## Extension contract

When adding a new resource or material:

1. Prefer adding it to the generic `ResourceSystem` catalog and generic recipe system.
2. Add an explicit consumer or construction/economic use; defining a material alone must not grant capability.
3. Route physical additions/withdrawals through `Inventory.ts`.
4. If a temporary supplemental extractor/processor is required, it must use canonical inventory and shared labour, and it must be removed when the generic system gains equivalent coverage.
5. Never add another independently mutable material stock.

Petroleum, fuel markets, recycling, price formation, dedicated industrial resource-site projects and fully developed nuclear-fuel chains remain future work. Coal/uranium presence by itself grants no advanced capability; knowledge, infrastructure, processing and institutional gates remain necessary.

## Step 1 invariant

For any material `m`, the simulation must have one answer to the question:

> How much of `m` does this settlement physically own right now?

That answer is `settlement.localMaterials[m] ?? 0`.

Everything else is a projection, compatibility alias, demand/readiness signal, quality/provenance record, flow history or presentation layer.
