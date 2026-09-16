# Material authority audit — Step 1A

Status: behavior-preserving audit only. No simulation rules are changed by this step.

Baseline reviewed: `main` at `d071381cc6454a2d44a0f8e0231553f5059bb652`.

## Purpose

Godbox currently has more than one representation of physical material stock. This audit identifies every important production, storage, transfer, consumption, construction and compatibility path and classifies each path before Step 1B changes authority.

The target for Step 1B is intentionally explicit: **`Settlement.localMaterials`, mutated through the `Inventory.ts` API, should become the single physical inventory authority.** Other stock representations may remain as derived compatibility or telemetry state, but they must not independently decide whether a settlement physically owns a material.

## Authority classes

| Class | Meaning |
| --- | --- |
| **AUTHORITATIVE** | Owns a real simulation fact and may mutate it. There must be only one physical stock authority after Step 1B. |
| **DERIVED / COMPATIBILITY** | May mirror or aggregate authoritative state for old systems, UI, scoring or staged migration. It must not mint material. |
| **DERIVED / TELEMETRY** | Records demand, quality, pressure, provenance, readiness or historical bookkeeping. It does not own physical quantity. |
| **MIGRATION DEBT** | A second authority or bridge that can disagree with the intended source of truth and must be removed, redirected or reduced to compatibility behavior. |
| **READ ONLY** | Observes inventory for presentation, history, discovery gates or decisions without changing stock. |

## Current state inventory map

### 1. `Settlement.localMaterials`

**Current classification: AUTHORITATIVE for the established resource economy.**  
**Step 1B target: sole physical material authority.**

Declared as `LocalMaterialInventory = Record<string, number>` in `src/sim/types.ts`.

Primary mutation API: `src/sim/resources/Inventory.ts`

- `addMaterial(...)` reconciles bulk compatibility state, respects storage capacity, updates quality metadata, writes `localMaterials`, then republishes bulk projections.
- `takeMaterial(...)` reconciles bulk compatibility state, removes from `localMaterials`, then republishes bulk projections.
- `publishBulkStocks(...)` projects `localMaterials.timber` to `resources.wood` and `localMaterials.stone` to `resources.minerals`.
- `reconcileBulkStocks(...)` converts spending performed by legacy bulk consumers back into exact deductions from `localMaterials.timber` / `localMaterials.stone` exactly once.

Established writers and consumers:

- `src/sim/resources/ResourceSystem.ts`
  - physical deposit extraction and delivery
  - material cargo arrival
  - deep-extraction fuel spending
  - storage-aware material flow
- `src/sim/resources/Processing.ts`
  - consumes recipe inputs through `takeMaterial`
  - produces recipe outputs/byproducts through `addMaterial`
- `src/sim/resources/Consumption.ts`
  - medicine, tools, arms, spoilage and household/economic material use through `takeMaterial`
- `src/sim/transport/TransportationSystem.ts`
  - existing resource/material freight can dispatch with `takeMaterial` and deliver with `addMaterial`
- `src/sim/Simulation.ts`
  - founding kits use `addMaterial`
  - colony/founding transfers use `takeMaterial` from the parent and `addMaterial` at the child settlement
- `src/sim/development/SettlementDevelopmentSystem.ts`
  - checks specific processed construction goods such as `timber-frame`, `dressed-stone` and `iron-tools`
  - consumes `response.materialCost` through `takeMaterial`

Established read-only users include:

- `src/sim/knowledge/KnowledgeSystem.ts` for physical-sample discovery gates
- `src/sim/resources/SettlementEnvironment.ts` for shortage/environment decisions
- `src/historian/FoundingContinuity.ts` for documentary state
- other presentation/tests that inspect stock without owning it

### 2. `Settlement.resources.wood` and `Settlement.resources.minerals`

**Current classification: DERIVED / COMPATIBILITY.**  
**Step 1B target: remain compatibility projections only.**

These fields are still read/spent by older systems, including construction budgets, repairs, transport construction, military scoring and some knowledge/economy logic.

Critical contract already present in `Inventory.ts`:

- `resources.wood` mirrors physical timber.
- `resources.minerals` mirrors physical stone.
- direct legacy spending may temporarily reduce these aggregate values.
- `reconcileBulkStocks(...)` converts that reduction into one physical `localMaterials` deduction, then republishes the remaining authoritative stock.

Important compatibility consumers:

- `src/sim/weather/WeatherConsequences.ts` repair work spends wood/mineral aggregates directly.
- `src/sim/development/SettlementDevelopmentSystem.ts` still uses aggregate resource costs alongside specific physical material costs.
- `src/sim/transport/TransportationSystem.ts` retains a legacy bulk-material construction path when typed transport inputs are unavailable.
- `src/sim/war/MilitaryCapability.ts` reads aggregate resource availability as part of broad capability scoring.
- `src/sim/Simulation.ts` uses aggregate balances for economy/demand calculations.

**Rule for 1B:** these fields may remain for compatibility, but no new feature should treat them as an independent physical inventory.

### 3. `Settlement.materials`

Defined by `src/sim/resources/MaterialEconomy.ts` as a typed `MaterialInventoryState` with its own `stock`, production, consumption and lifetime-flow accounting.

**Current classification: MIGRATION DEBT — second physical authority.**  
**Step 1B target: remove physical authority.**

This ledger is independent from `localMaterials`; adding timber to one does not inherently add it to the other.

Current writers/owners:

- `src/sim/resources/MaterialEconomy.ts`
  - `ensureMaterialInventory(...)`
  - `recordMaterialExtraction(...)`
  - `advanceMaterialProcessing(...)`
- `src/sim/resources/SettlementResourceExtraction.ts`
  - creates/feeds this inventory from a second extraction path
- `src/sim/resources/MaterialUse.ts`
  - consumes operating inputs directly from this ledger
  - consumes construction bill-of-materials through `consumeConstructionMaterials(...)`
- `src/sim/resources/MaterialLogistics.ts`
  - dispatches and delivers freight by directly mutating `materials.stock`

Current readers:

- `src/sim/development/SettlementDevelopmentSystem.ts`
  - `hasMaterialAuthority(...)`
  - `materialAmount(...)`
  - `materialRequirementCoverage(...)`
  - `maxMaterialProgressIncrement(...)`
- `src/sim/resources/MaterialLogistics.ts`
  - project shortages, source reserves and shipment selection
- military/advanced consumers that use `materialUse` readiness derived from this ledger

This is the central Step 1A finding: **Godbox has two separately mutable physical material inventories.**

### 4. `Settlement.materialEconomy`

**Current classification: DERIVED / TELEMETRY, with authoritative metadata but not authoritative quantity.**

Owned primarily by `src/sim/resources/Inventory.ts` / `ResourceSystem.ts`.

It tracks information such as:

- quality
- recipe experience/research
- in-transit cargo
- demand/imports/deliveries
- tool/arms state
- energy demand/supply
- shortage duration
- the bulk compatibility snapshot

This object should survive Step 1B. It provides valuable economic metadata around `localMaterials`; it should not become a second quantity ledger.

### 5. `Settlement.materialUse`

**Current classification: DERIVED / TELEMETRY.**

Owned by `src/sim/resources/MaterialUse.ts`.

It records material demand, supplied/unmet quantities, coverage, pressure, critical inputs and readiness by operating domain.

The model itself is useful. The problem is that its current consumption and availability calculations are tied to `Settlement.materials`. Step 1B should preserve the pressure/readiness model while swapping the stock adapter to the canonical inventory.

### 6. `Settlement.materialLogistics`

**Current classification: DERIVED / TELEMETRY for dependency history; MIGRATION DEBT for its physical transfer path.**

`src/sim/resources/MaterialLogistics.ts` correctly records strategic dependency history, import/export totals and transit loss. That metadata is worth preserving.

However, `dispatchMaterialShipment(...)` and `deliverMaterialShipment(...)` currently mutate `Settlement.materials.stock` directly. Step 1B should route physical dispatch/delivery through the canonical inventory API while retaining dependency bookkeeping.

### 7. `monthlyBalance.wood` / `monthlyBalance.minerals`

**Current classification: DERIVED / COMPATIBILITY demand signal.**

These values are used by the legacy/bridge extraction path to infer raw-material demand. They are not physical stock and must never become stock authority.

## End-to-end flow audit

### Founding and colonization

Current physical flow:

`Simulation -> addMaterial -> localMaterials -> publishBulkStocks -> resources.wood/minerals`

Classification: **AUTHORITATIVE and correct target architecture.**

Conflict: no equivalent quantity is guaranteed to appear in `Settlement.materials`, so a newly founded settlement can physically own timber/stone in the resource economy while the second ledger remains empty.

### World extraction

Primary resource-economy flow:

`WorldResourceSystem / ResourceSystem -> deposit depletion -> cargo -> addMaterial -> localMaterials`

Classification: **AUTHORITATIVE and correct target architecture.**

Parallel bridge flow:

`SettlementDevelopmentSystem -> SettlementResourceExtraction -> ensureMaterialInventory / recordMaterialExtraction -> Settlement.materials`

Classification: **MIGRATION DEBT.**

Both paths can use the shared resource labour budget, meaning they are not simply harmless duplicated reporting layers.

### Processing

Established recipe system:

`Processing.ts -> takeMaterial(inputs) -> addMaterial(outputs) -> localMaterials`

Classification: **AUTHORITATIVE.**

Parallel typed processing:

`MaterialEconomy.ts -> advanceMaterialProcessing -> materials.stock`

Classification: **MIGRATION DEBT.**

### Storage

`Inventory.ts -> storageCapacity / storageRoom / storedVolume -> localMaterials + in-transit resource cargo`

Classification: **AUTHORITATIVE.**

`Settlement.materials` has no equivalent integration with the mature bounded-storage model.

### Freight

Established resource freight:

`TransportationSystem -> takeMaterial(source) -> trip -> addMaterial(target)`

Classification: **AUTHORITATIVE.**

Parallel typed freight:

`MaterialLogistics -> materials.stock(source) -> trip -> materials.stock(target)`

Classification: **MIGRATION DEBT for stock mutation; retain dependency telemetry.**

### Knowledge/sample gates

`KnowledgeSystem -> localMaterials`

Classification: **READ ONLY against authoritative stock.**

This is important because scientific discovery can already observe a different physical reality than typed construction if the two inventories diverge.

### Construction selection and commissioning

`SettlementDevelopmentSystem` currently mixes three stock concepts:

1. aggregate compatibility stock (`resources.wood/minerals/goods/wealth`)
2. established physical stock (`localMaterials` for processed recipe outputs/materialCost)
3. second typed physical stock (`Settlement.materials` through MaterialUse helpers)

Current project-start gates include:

- generic aggregate cost affordability
- builder availability
- `materialRequirementCoverage(...)` against `Settlement.materials`
- `response.materialCost` availability against `localMaterials`
- placement validity

Classification: **MIGRATION DEBT / SPLIT AUTHORITY.**

This is a direct source of false negatives: one physical ledger may say the settlement can build while the other says it cannot.

### Construction progress

A running project can currently spend through all of the following paths:

- `consumeConstructionMaterials(...)` -> `Settlement.materials`
- `response.cost` -> aggregate `resources.*`
- `response.materialCost` -> `takeMaterial(...)` -> `localMaterials`
- later `reconcileBulkStocks(...)` may translate aggregate timber/stone spending into additional `localMaterials` deductions

Classification: **MIGRATION DEBT / MULTIPLE PAYMENT AUTHORITIES.**

Not every charge is necessarily semantically duplicated — generic goods/wealth can remain separate — but physical fabric must have one canonical bill and one canonical physical deduction path.

### Repairs

`WeatherConsequences -> resources.wood/minerals -> later reconcileBulkStocks -> localMaterials`

Classification: **DERIVED / COMPATIBILITY, currently acceptable if reconciliation remains exact.**

This should not be migrated casually during 1B; preserving the one-time reconciliation invariant is more important than removing all legacy aggregate consumers at once.

## Concrete conflict matrix

| Scenario | `localMaterials` | `resources.*` | `materials.stock` | Result today |
| --- | --- | --- | --- | --- |
| Founding kit added | increases | projected from local | may remain empty | construction typed gate can disagree with founding inventory |
| Deposit cargo arrives | increases | projected from local | unchanged by primary ResourceSystem | visible economy can own stock that typed gate cannot see |
| Established recipe succeeds | processed output increases | timber/stone projection only where applicable | unchanged by established recipe | recipe/knowledge state can diverge from typed material availability |
| Typed bridge extraction runs | unchanged by that bridge | may already represent local stock | increases | second inventory can evolve independently |
| Resource freight arrives | increases | republished | unchanged | transport systems can disagree |
| Typed material freight arrives | unchanged | unchanged | increases | imported material can exist only in second ledger |
| Construction progresses | local may decrease | aggregates decrease/reconcile | typed stock may also decrease | one project can touch multiple independent physical authorities |

## Step 1B authority contract

Step 1B should be considered complete only when all of these invariants are true.

1. **One quantity owner** — every raw or processed physical material quantity exists canonically in `localMaterials`.
2. **One mutation boundary** — production, delivery and consumption mutate physical stock through `Inventory.ts` functions (or a single successor API built on the same state).
3. **No direct runtime stock forks** — production code must not maintain a second independently mutable material quantity map.
4. **Bulk fields are projections** — `resources.wood` and `resources.minerals` remain compatibility views of timber and stone, not minting paths.
5. **One construction fabric bill** — project material coverage, progress limits and physical consumption all query and spend the same inventory.
6. **Exact progressive spending** — a project at fraction `p` has consumed exactly fraction `p` of its frozen physical bill, subject only to explicitly modeled substitutions.
7. **Freight conservation** — dispatch removes canonical stock once; arrival adds the delivered fraction once; losses are recorded but never materialized.
8. **Derived pressure stays derived** — `materialUse` may compute scarcity/readiness but cannot own stock.
9. **Dependency history stays metadata** — `materialLogistics` may retain import/export/provenance records without becoming a quantity ledger.
10. **Legacy spending reconciles once** — compatibility consumers that still reduce `resources.wood/minerals` must translate that spending to canonical stock exactly once.
11. **Knowledge sees the same world as construction** — sample gates and construction gates must observe identical physical quantities.
12. **No negative or phantom stock** — all mutation APIs clamp/validate conservation and tests prove replay-safe results.

## Step 1B migration boundaries

### Keep and strengthen

- `src/sim/resources/Inventory.ts`
- `Settlement.localMaterials`
- storage capacity and quality bookkeeping
- ResourceSystem extraction and cargo flow
- Processing/Consumption use of `addMaterial` / `takeMaterial`
- existing resource freight through TransportationSystem
- `materialEconomy` metadata
- `materialUse` pressure/readiness semantics
- `materialLogistics` dependency/provenance semantics

### Redirect to canonical inventory

- `MaterialUse.availableForRequirement(...)`
- `materialRequirementCoverage(...)`
- `maxMaterialProgressIncrement(...)`
- `consumeConstructionMaterials(...)`
- `MaterialLogistics` source reserve, project need, dispatch and delivery
- construction material selection currently using `materialAmount(...)`

### Retire as physical authority

- runtime ownership of quantity in `Settlement.materials`
- `hasMaterialAuthority(...)` as a switch between two physical realities
- direct `materials.stock[...]` mutation
- the duplicate extraction/processing bridge insofar as it exists only to feed `Settlement.materials`

Compatibility loading for old archives may still need an adapter; archive migration must not silently mint the sum of both historical ledgers.

## Test gaps exposed by 1A

The current suites prove the two subsystems separately but do not prove one integrated physical authority in an unmodified generated world.

Required follow-up coverage:

- generated-world founding stock is visible to construction without manual second-ledger provisioning
- ResourceSystem extraction becomes construction-usable stock
- recipe output becomes construction-usable stock
- freight delivery becomes construction-usable stock
- a structure consumes its exact frozen physical bill exactly once
- bulk repair spending reconciles exactly once after the authority migration
- no runtime test needs to call `ensureMaterialInventory(...)` merely to make ordinary construction work
- long-run production has no living settlement simultaneously reporting adequate canonical stock and `0` construction material coverage for the same requirement

## 1A conclusion

The architecture already contains a strong candidate for a single source of truth: `localMaterials` plus `Inventory.ts`. It is integrated with founding stock, extraction, storage, processing, freight, consumption, knowledge gates and bulk compatibility.

`Settlement.materials` is not just a cache; it is an independently mutable second physical economy used by MaterialUse, MaterialLogistics and part of construction. That split is the authority defect to remove in Step 1B.

**Step 1A intentionally makes no behavioral changes.** The next safe action is Step 1B: move construction/material-use availability and consumption onto the canonical inventory while preserving compatibility projections, telemetry and archive safety.