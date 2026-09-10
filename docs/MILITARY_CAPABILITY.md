# Military capability and combat

The war model separates **what a society can field** from **what that capability does in a campaign**. Equipment is still a consequence of lived knowledge and material capacity rather than a calendar-era unlock, but Step 2 now makes those differences mechanically consequential.

## Capability foundation

`deriveMilitaryProfile()` reads a settlement's non-dormant practical knowledge together with resources, workshops, factories, roads, rail, electrical infrastructure, industrial intensity, food security, prosperity and political/institutional capacity. The result is a mobilization-time `MilitaryCapabilityProfile`.

A campaign snapshots both profiles when it is created. Later discoveries can change the equipment available to a future campaign without retroactively rewriting the historical equipment of a war already under way.

The dependency network supports a progression from controlled fire, composite stone tools, clubs, spears and torches through bows, shields, metal weapons, armour and siege engines; chemical knowledge and precision work support gunpowder and cannon; industrial chemistry, standardized parts, precision manufacturing, factories and concentrated power support rifles, grenades, artillery and automatic weapons; internal combustion and transport infrastructure support motorized mobility; aviation and advanced manufacturing support air power; rocketry, computation, long-range communications, precision manufacturing and electrical power support guided missiles.

Knowing how to build something is not enough. An advanced but materially exhausted settlement may retain the knowledge of modern weapons while being unable to field, fuel, repair or replace them at scale.

## Step 2: battlefield consequences

`MilitaryCombat.ts` turns the mobilization snapshot into bounded combat characteristics instead of reducing all military development to one small linear technology bonus. It derives effective range, lethality, exposure, replacement capacity, logistics burden, movement speed, prepared defensive works, breach capability and an engagement mode (`close`, `ranged`, `bombardment`, `combined-arms` or `stand-off`).

Protection, mobility, communications and superior reach reduce exposure. Firearms, artillery, air power and missiles raise lethality and reach. Siege equipment, artillery, air power and missiles progressively erode the defender's prepared-works advantage rather than deleting defense outright. Roads, powered transport and communications shorten campaign movement while keeping primitive columns close to the established pace.

Technological mismatch is deliberately nonlinear and bounded. Large gaps in regime and capability can materially alter battlefield effectiveness and casualty pressure, so a modern force against an improvised one is not represented as a trivial percentage modifier. The cap prevents one deterministic score from guaranteeing annihilation; manpower, terrain, supply, morale, organization, leadership and chance remain relevant.

## Logistics and power dependency

Early formations remain mostly dependent on food, labour, wood, minerals and workshops. Sophisticated forces acquire increasing dependence on production, goods, concentrated energy, infrastructure and communications.

A force's equipment is frozen at mobilization, but its operational supply is checked against the settlement's current support system. Destroying or exhausting factories, power, goods and production therefore degrades an advanced force even though the society still remembers how its equipment works. More complex forces also accumulate additional exhaustion when replacement capacity falls.

The existing economy has no dedicated liquid-fuel or ammunition stock. Step 2 therefore uses goods, minerals and wealth as documentary proxies for ammunition, fuel, maintenance and replacement parts instead of inventing an isolated resource system. A future economic expansion can replace those proxies without changing the military capability API.

## Integration with the established war system

The existing campaign state machine remains authoritative: mobilization, surveyed dry-ground marching, blocked corridors, battle, retreat/occupation/negotiation, truces, terrain, morale, leadership and actual casualty removal still operate through the established resolver. Step 2 wraps those calculations with operational capability so the richer military profile changes battlefield strength and casualty pressure without replacing the campaign model users already recognize.

War events produced during a campaign are enriched with the mobilized equipment/regime plus engagement mode, range, lethality, exposure, mismatch, prepared works and breach evidence. A major capability mismatch also creates a bounded one-time campaign dispatch, giving the Historian and Step-3 renderer factual evidence to present rather than inferring weaponry from the current year.

## Deliberate boundaries

Step 2 remains a conventional campaign model. `stand-off` describes the character and reach of a technologically advanced engagement once a war is in contact; it does not yet let a conventional campaign ignore an otherwise impassable world route. Nuclear use remains owned by the existing advanced strategic system. Those boundaries avoid silently turning missiles into teleporting armies or duplicating the nuclear model.

Step 3 should make this now-causal military history visible: era-appropriate formations, weapons, siege equipment, gun smoke, artillery, vehicles, aircraft and missile effects, while the Watcher narrates first uses and major changes in the character of warfare.

## Verification

The focused war validation workflow lints the war subsystem and runs the established campaign tests together with military-capability and military-combat regression tests. Coverage includes near-peer early combat, nonlinear technological mismatch, defensive works and breach, supported versus collapsed modern logistics, mobility differences, real campaign integration, frozen mobilization evidence and preservation of the existing campaign lifecycle.
