# People, Purpose, and Placement Reliability Pass

## Outcome

GODBOX inhabitants now have deterministic homes, roles, workplaces, schedules, destinations, terrain-safe routes, social/appearance cues, and readable activity. Buildings and advanced infrastructure use stable, full-footprint placement validation. Construction exists as both a reserved physical site and a work destination.

## Placement reliability

- `PlacementContract` samples a footprint at its center and two perimeter rings. A non-water-tolerant structure is rejected if any sample is water, outside the world, or beyond its average/worst-slope limits.
- `PlacementFootprint` revalidates public building registrations, uses entity-derived IDs, treats identical re-registration as idempotent, and rejects persistent-coordinate drift.
- Ordinary buildings try deterministic district positions and a wider settlement fallback. If no valid plot exists, the renderer stops adding buildings instead of forcing one into invalid terrain.
- Landmarks, reactors, machine lattices, orbital masts, route gates, stations, and power poles are grounded and terrain-checked. Docks remain the explicit shoreline/water exception.
- An active construction project reserves one validated future building footprint and displays foundation/scaffold progress there. Ruins retain their footprint through their lifecycle.

## People categories and destinations

Roles progress with the society rather than appearing from a timeless global list. The supported set covers children and elders; gatherers, hunters, farmers, fishers, laborers, builders, craft workers, ritual specialists, traders, miners, soldiers and guards; administrators, scholars, healers, priests, sailors and transporters; then factory workers, engineers, machinists, railway and dock workers, merchants and managers; finally scientists, researchers, energy and medical workers, logistics and machine-systems specialists, and space workers.

Each persistent person receives:

- a household-specific home and stable workplace identity;
- a deterministic daily phase: home, commute, work, meal, social/ritual, and return;
- a semantic destination chosen from home, field, workshop, construction site, market, shrine, civic/knowledge/industrial districts, dock, patrol point, plaza, or safe area;
- era, economy, settlement specialization, occupation, age, and personality-sensitive role selection;
- culture-linked garment/pattern/color cues, bounded height/build/posture, headwear, carried item, and subtle wealth/status quality.

Builders and laborers use a current construction site when one is active. Traders and merchants use markets, farmers use fields, ritual roles use shrines, sailors and dock workers use docks, and industrial/advanced specialists appear only after supporting development exists.

## Route safety and movement

`WalkabilityLayer` is deterministic and cached. It rejects water, peaks, canyons, excessive slope/movement cost, and out-of-bounds cells. Preferred streets and district anchors guide trips, while A* reconnects any unsafe segment. Route waypoints and every accepted movement step are rechecked; failures snap to the nearest walkable ground and replan. Bridges, ferries, boats, and rail are explicit crossing modes, and only explicit boat migration may occupy deep water.

The simulation and renderer share `SettlementLayoutPlan`, so destinations align with the visible settlement without moving architectural authority into the simulation.

## Rendering and performance

People remain instanced. The visible cast is deterministically sampled by ID and capped at `max(48, 384 * visualDensity)`. Near people receive articulated activity animation, headwear, tools/cargo, role color, culture accents, and body/age variation. Far people retain a body/head silhouette and skip detailed animation updates. Movement routes and settlement layouts are cached; searches and placement attempts are bounded.

## Verification

Automated coverage includes deterministic role/destination/appearance generation, household/workplace grounding, three terrain-heavy seeds, pedestrian water/route rejection over long runs, construction/market/field/shrine destinations, industrial role gating, visible-person budgets, full-footprint water/slope rejection, overlap rules, stable persistent placement, ruin lifecycle, and terrain-normal integrity.

Final verification passed:

- `npm run lint`
- `npm run typecheck`
- `npm test` — 14 files and 90 tests passed; the people suite covers eight focused cases and the placement suite runs nine contract audits per terrain seed
- `npm run build`
- `git diff --check`

Vite continues to report that the lazy-loaded renderer chunk is larger than its default 500 kB advisory threshold. This is a packaging warning, not a failed build; people remain instanced, sampled, and distance-LOD-gated at runtime.

## Remaining limitation

The in-app browser backend was not attached in this environment, so the requested screenshot-based visual tour of primitive, developed, industrial, construction, market, shrine, dock, and water-correction scenes could not be performed here. Scene-specific placement reports and the automated invariants still cover their underlying state and geometry contracts, but an interactive visual QA pass remains advisable when a browser session is available.
