# Military capability foundation

Step 1 separates **what a society can field** from the existing campaign-resolution rules. Campaign movement, battle cadence, casualties, morale, leadership and peace rules remain unchanged in this pass.

## Principle

Military equipment is derived from lived capability rather than the calendar. `deriveMilitaryProfile()` reads a settlement's non-dormant practical knowledge together with resources, workshops, factories, roads, rail, electrical infrastructure, industrial intensity, food security, prosperity and political/institutional capacity. The result is a mobilization-time `MilitaryCapabilityProfile`.

A campaign snapshots both profiles when it is created. Later discoveries can change the equipment available to a future campaign without retroactively rewriting the historical equipment of a war already under way.

## Capability progression

The progression is deliberately a dependency network rather than an era unlock table:

- Controlled fire, wood and composite stone tools support clubs, stone spears and torches.
- Stone composites, leverage, wood and organization support bows and shields.
- Iron working, mineral access, workshops and precision tools support metal weapons and armour.
- Leverage, wheel/axle knowledge, materials, workshops and administration support siege engines.
- Chemical knowledge, precision tools, metallurgy and workshop capacity support early gunpowder weapons; stronger mechanical and production capacity supports cannon.
- Industrial chemistry, standardized parts, precision manufacturing, factories, goods and concentrated power support rifles, grenades, artillery and automatic weapons.
- Internal combustion, roads, industry and goods support motorized military mobility.
- Aviation requires flight capability plus propulsion, precision manufacturing and an industrial base.
- Guided missiles require rocketry, computation, long-range communications, precision manufacturing, electrical power and sufficient production capacity.

Knowing how to build something is therefore not enough. An advanced but materially exhausted settlement may retain the knowledge of modern weapons while being unable to field or replace them at scale.

## Power dependency

The profile identifies a dominant military power base: muscle/fire, workshop, mechanical, combustion, electrical, or advanced grid. Early armies remain primarily food-, labour-, wood- and mineral-dependent. More advanced forces become increasingly dependent on factories, concentrated energy, infrastructure, goods and communications.

This is intentionally important for future passes: technological sophistication should eventually create both military advantages and new logistical vulnerabilities.

## Profile

Each side records normalized capability for melee combat, ranged combat, protection, siege, firearms, artillery, mobility, communications, air power, missiles, production, energy, sustainment and institutional support, plus a recognizable equipment list and broad military regime.

The campaign stores these profiles as `militaryA` and `militaryB` on its mobilization snapshot. `militaryProfileForWar()` is the stable read path for renderer/historian code, while `militaryEventContext()` flattens the profile into primitive historical-event metadata when war event code wants to record the evidence.

## Pass boundary

Step 1 intentionally does **not** make rifles, artillery or missiles more lethal yet. The existing `technologyA/B` battle modifier remains in place so this foundation does not silently rebalance a war system that already works well. Step 2 should consume the richer profile to change lethality, protection, range, siege behavior, logistics and technological mismatch. Step 3 should make those capabilities visually legible in the WarRenderer and Watcher presentation.
