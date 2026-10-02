# Industrial landscape — machinery, crews and stalls

This pass closes three gaps between what the simulation knows and what the diorama shows:

1. a civilization could hold precision manufacturing, mechanical power and electricity and still
   own no machine shop, because `machinery` was a reserved family with zero tiers;
2. the works on screen were staffed by figures the renderer invented, while the represented
   residents it already had were routed only to the generic `industrial-site` district;
3. market stalls had tables and goods but no one behind them, because `market` is a conversational
   destination and every attendee was arranged into a social pod facing inward.

Nothing in this pass invents production, labour, stock or trade. Every visible person, machine and
counter is a projection of state some existing authority already owns.

## Machinery family

`FacilityCatalog` now implements the third family on the same data-driven ladder as wood and
metallurgy:

| Tier | Works | Recipes | Power | Heat |
| --- | --- | --- | --- | --- |
| 1 | millwright and machine workshop | `machine-parts` | shaft or electric, 55% by hand | forge |
| 2 | machine shop | `machine-parts` | shaft or electric, 20% by hand | forge |
| 3 | precision engine works | `machine-parts`, `engine-assembly` | electric | furnace |

Two recipes and two materials were added to `RECIPE_CATALOG`/`MATERIAL_CATALOG`, and
`machine-parts` and `engine` joined `PROCESSED_MATERIAL_KINDS`, so the typed economy, freight and
inter-settlement logistics carry them like any other processed good:

- `machine-parts` — 2 iron + 0.5 timber + charcoal heat → 1.5 parts, with slag. Needs practised
  precision tools and rotary machinery.
- `engine-assembly` — 3 parts + 2 steel + 0.5 copper → 1 engine. Needs mechanical power and
  precision manufacturing, and only a tier-3 works runs it.

The family's trigger materials are worked metal (`iron`, `bronze`, `copper`), so machinery can only
be founded downstream of metallurgy. Research work applies as it does to every catalog recipe: the
first cycles are trials that consume stock and yield nothing until the blueprint is reproducible.

### Where the demand comes from

An industry with no customer idles at its production target, so machine goods were given real
consumers, always as a *preference with a substitute* so no new deadlock can appear:

- `MaterialUse` pays industrial machine wear from `['machine-parts', 'steel', 'iron', 'bronze']`
  and prime-mover overhaul (scaled by delivered power) from `['engine', 'machine-parts', 'steel']`.
- tier-2 and tier-3 maintenance bills in every family prefer `machine-parts` over raw metal.

Because `processTarget` reads both the material economy's demand and `materialUse` pressure, an
industrial settlement pulls on its machine shop instead of filling a yard and stopping.

## Real people at real machines

`sim/people/FacilityWorkRouting.ts` casts a small documentary crew from the facility's own labour
accounting, the same way `ResourceWorkRouting` casts extraction workers:

- crew size is `round(labour.used + labour.haul / 2)`, capped at 6 per works and 14 per settlement,
  so **a works that spent no worker-months this month has nobody at it**;
- duties (`process`, `maintenance`, `haul`) are only offered when the authority paid for them:
  hauling needs freight or haul labour, maintenance needs worn machinery;
- a duty may only be filled by someone whose occupation actually contributed to that works;
- anyone already standing at a real extraction site is not eligible.

`PeopleSystem` routes an assigned resident to the works itself — destination id
`facility-work:<family>:<duty>:<facilityId>`, point at the facility — instead of the settlement's
generic manufacturing plot, and the stale-site rules that already protected extraction commutes now
cover works commutes too.

On the presentation side, `render/industry/FacilityWorkstations.ts` defines stations next to the
machines `IndustryRenderer` actually draws, in the same facility-local frame: saw pit, saw carriage,
log deck, conveyor, gantry, kiln door, charcoal clamp, bellows, anvil, casting bed, trip hammer,
converter, rolling mill, crane cab, machine bench, lathe, assembly floor, engine test bed, plus the
shared inspection point, maintenance panel, loading bay and stock yard. A station is offered only
when its condition is true in state (hot furnace, delivered power, freight that moved, worn
machinery) and only where the pedestrian layer accepts the ground. `FacilityCrewScene` binds routed
residents to those stations, one each, holding a station between frames.

`IndustryRenderer` no longer builds crew figures at all. An empty works now means an idle works.

## Vendors and customers at market stalls

The settlement renderer publishes the market tables it actually placed (position and rotation).
`render/people/MarketStallPresentation.ts` assigns:

- traders and merchants whose activity is `trade` to the counter side of the nearest free table,
  facing it;
- other attendees to the frontage on the open side, at most two per table, preferring served
  tables.

An assigned post feeds `LocalActivityPresentation` as a `LocalWorkstation`: it replaces the generic
frontage focus with the table or machine being worked, selects a vendor, customer or station
routine, and marks the post *attended*. An attended post neither offers nor accepts an exclusive
social scene and never joins a conversational pod — the vendor stays with their goods and turns to
whoever is across the counter. Everyone else at the market keeps the existing pod grammar.

## Industrial diagnostics

`sim/processing/FacilityDiagnostics.ts` answers "is this world failing to industrialize for a real
reason?" without opening a save. `facilityFoundingBlocker` and `facilityUpgradeBlocker` are now
exported from `FacilitySystem` and used by both the planner and the report, so an explanation can
never disagree with the decision it explains. Knowledge blockers name the missing capability
(`knowledge:rotary-machinery`).

`SimulationSummary.industryDiagnostics` carries one line per settlement and family, and
`npm run sim -- --format human` prints them:

```
Settlement A: metallurgy tier 1 of 3 — blocked from tier 2 by rotary machinery
Settlement B: wood processing tier 2 of 3 — blocked from tier 3 by not saturated, running at 61% of capacity
Settlement C: machinery — no facility, blocked by no raw material
No family implementation: ceramics, chemicals, electrical equipment, strategic processing, textiles
```

## Deliberate boundary

This pass does **not**:

- allow more than one facility per family per settlement (the planner still upgrades the first one,
  so an industrial precinct is still one plant per family);
- implement ceramics, textiles, chemicals, electrical equipment or strategic processing;
- add geometry for the machinery family beyond the generic works body — the machinery stations are
  placed against that body, and the family's own machine shed is still to be modelled;
- change the energy system's generator costs, so engines are consumed as upkeep rather than being
  required to build a power plant.
