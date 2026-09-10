# Military capability, combat and presentation

The war model separates **what a society can field**, **what that capability does in a campaign**, and **how the Watcher can see and remember it**. Equipment remains a consequence of lived knowledge and material capacity rather than a calendar-era unlock.

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

## Step 3: a visible language of war

`MilitaryVisualLanguage.ts` maps each frozen capability profile to a bounded documentary visual style. Improvised forces appear as irregular warbands; organized melee and siege forces tighten into ranks; gunpowder forces form firing lines; industrial forces become more dispersed; modern forces read as combined-arms formations. This is not an era skin. The renderer checks the equipment actually present in the mobilization snapshot.

Individual figures now carry recognizable capability cues. Spears, bows, firearms and automatic weapons use different silhouettes and ready positions. Shields and armour appear only when the force can field them. Formation spacing and rank depth also change with doctrine, so a modern formation no longer looks like an ancient formation with a different colour.

Heavy capability is represented separately from the documentary infantry count. Cannon/artillery and motor vehicles accompany forces that can field them. `BattleSpectacle.ts` adds a tightly budgeted layer of smoke, muzzle flashes, tracer-like fire, aircraft passes and guided-missile arcs. The effects are deterministic from render time, obey reduced-motion mode, and never write to simulation state.

The goal is legibility rather than literal one-to-one scale: a few vehicles or aircraft stand for a capability that may represent a much larger force. This keeps long-running worlds performant while making the changing character of warfare visible from the camera distances GODBOX actually uses.

## The Watcher remembers military change

`WarStory.ts` now reads the same frozen mobilization evidence as the renderer. Declarations can contrast the military systems each side brings to war. Battles can describe whether the fighting is close, ranged, bombardment, combined-arms or stand-off, and major capability mismatches can be described without pretending the sides are military equals.

First-use narration is evidence-bounded. The Watcher only calls something the first recorded wartime appearance of a capability when the current campaign actually contains it and no earlier campaign in the record did. Historical event narration still filters against the event month, so later discoveries and later wars cannot leak backward into an older chapter.

## Integration with the established war system

The existing campaign state machine remains authoritative: mobilization, surveyed dry-ground marching, blocked corridors, battle, retreat/occupation/negotiation, truces, terrain, morale, leadership and actual casualty removal still operate through the established resolver. Step 2 wraps those calculations with operational capability; Step 3 only presents their consequences.

War events produced during a campaign are enriched with the mobilized equipment/regime plus engagement mode, range, lethality, exposure, mismatch, prepared works and breach evidence. A major capability mismatch creates a bounded one-time campaign dispatch, giving the Historian factual evidence to present rather than inferring weaponry from the current year.

## Deliberate boundaries

The conventional campaign model still owns physical contact and routes. `stand-off` describes the character and reach of a technologically advanced engagement once a war is in contact; it does not let a conventional campaign ignore an otherwise impassable world route. Nuclear use remains owned by the existing advanced strategic system. Those boundaries avoid silently turning missiles into teleporting armies or duplicating the nuclear model.

Step 3 also remains deliberately representative rather than cinematic destruction simulation. Aircraft and missile visuals communicate capability; they do not independently damage buildings or people. Any future structural destruction pass should consume explicit simulation events so the visual layer never invents casualties or damage.

## Verification

The focused war validation workflow now lints the simulation, renderer and Watcher war paths and runs the established campaign, military-capability, military-combat and military-presentation regression suites. Coverage includes near-peer early combat, nonlinear technological mismatch, defensive works and breach, supported versus collapsed modern logistics, mobility differences, real campaign integration, frozen mobilization evidence, formation/support selection, renderer state purity, first-use narration and preservation of the established campaign lifecycle.

Project-wide TypeScript validation and the production Vite build are also run as audit steps. The Step 3 branch passed the focused suite, project-wide typecheck and production build before integration.
