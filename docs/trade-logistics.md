# Trade and logistics

Trade extends `MaterialLogistics`, `TransportationSystem`, the canonical inventories,
`WalkabilityLayer`, `TransportNetwork`, settlement development, and the shared Historian
milestone queue. There is no second economy or presentation-owned freight simulation.

## Economic decisions

Contact creates corridors only when real operating/construction shortages meet a partner's
surplus. Source reserves, destination storage, distance, trust, and geography constrain
exchange. Canonical materials take priority; food relief uses the existing food stock.
Wood/mineral aggregate projections are never independently shipped. Existing geographic
extraction and production determine specialization and the goods available for export.

Goods leave the source when loaded. A trip retains origin, destination, cargo, quantity,
vehicle, path, progress, and loading/travel/unloading phases. Only unloading credits the
destination. Accepted quantity and explicit transit/storage losses sum to dispatched cargo.
Throughput and economic rewards use accepted goods, including when destination storage
fills during the journey. Boats account for inland port access in handling time.

## Progression

* Hand carriers can use a safe pedestrian route before engineered roads exist.
* Two successful deliveries support traveling merchants and visible market stalls.
* Husbandry permits pack animals; wheel practice permits hand carts on completed roads.
* Repeated trade plus wheels and husbandry permits animal-drawn caravans.
* Freight wears the existing landscape paths. Ordinary corridor construction needs proven
  usage; a technology- and material-funded bridge can use verified cross-river demand to
  avoid a construction/trade deadlock.
* Accepted imports favor warehouses within existing settlement development. Sustained
  throughput earns caravan staging areas and major-route milestones.
* Rail investment requires transformed rail knowledge, adopted iron working and mechanical
  power at both ends, workshops, rail infrastructure, at least eight deliveries, and recent
  freight. Operation requires a completed connected network/stations and continuing demand.
* Motor freight requires adopted combustion and precision manufacturing, factories, roads
  at both endpoints, operating energy, charcoal, metal, and substantial freight demand.
  Dispatch consumes fuel and maintenance metal. Charcoal represents the available catalog's
  gasifier fuel; this pass does not invent an independent petroleum economy.

There are no calendar-era unlocks. Small consignments retain carriers even where motor
freight is possible. In-flight vehicles retain their mode. Each existing corridor owns one
active trip; this is a bounded aggregate consignment model, not an individual vehicle fleet.

## Geography and presentation

Walkability, surveyed grades, navigable water, funded bridges, network completion, snow,
and road maintenance constrain movement. Disrupted pedestrian freight detours from its
actual position. Network freight can replace its remaining route while preserving its
current segment and physical progress. Unreachable or blockaded freight waits with cargo
still in transit; new dispatches can use other working routes.

The existing renderer shows baskets, pack animals, wheeled carts, multi-wagon caravans,
boats, rail engines, and trucks. Shared cargo geometry draws inventory-backed goods on
vehicles and market tables. Existing people routines provide market vendors/customers;
stall decoration does not create extra simulated citizens. Rendering never transfers goods.

First merchant, market, caravan, major route, rail connection, and motor freight events feed
the same first-milestone history/camera selection used by other civilization milestones.

## Verification

Focused transport tests cover real departures and deliveries, capacity, rejected deliveries,
idempotence, bridges, boats, blocked networks, detours, determinism, and independent technology,
energy, road, demand, and manufacturing gates. Presentation tests cover cargo identity,
read-only geometry creation, and milestone deduplication. The production accounting regression
test protects reconciliation before batch sizing.

Broader validation also found existing settlement-development and presentation fixture
failures. A separate pre-change baseline reproduced those failures; focused results and build
logs are recorded in the workspace. No claim of a clean repository-wide suite is made.

The final focused run passed 64 tests across eight files (`trade-verified-results.txt`).
The final production build and targeted lint passed. The broad suite was stopped after
subsequent fixes invalidated its in-progress module snapshots. A separate pre-change
baseline reproduced 13 failures across five settlement/presentation test files; these
are not represented as passing or silently excluded from a claimed full-suite result.
