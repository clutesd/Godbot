# Wildlife presentation and harvest integration

Elk, bears, foxes, squirrels, birds and fish share `src/sim/wildlife/WildlifeLifecycle.ts`.
Their habitat slots advance through young, adult, elder and dead stages using world weather
months, independently of camera time. Young animals grow to adult size. After a species-specific
vacancy period, the slot recruits a new generation with a new identity. This is bounded habitat
recruitment, not a parentage, food-web or carrying-capacity simulation. The breeding flag marks
the spring window for future reproduction rules.

Land mammals use terrain-validated routes, alternating travel and foraging; bears also rest.
Instanced vertex animation moves feet and tails and lowers feeding heads without extra draw calls.
Squirrels have short darting routes, hopping movement and curled tails. Birds mix flapping and
gliding; fish keep their school formations with lifecycle-dependent size.

## Hunting and fishing boundary

`LandWildlifeRenderer.harvestTargets(elapsed)`, `AmbientBirds.harvestTargets()` and
`AquaticLifeRenderer.harvestTargets()` expose generation IDs, species, life stage and positions.
Bird and fish snapshots describe the latest update; bird targets cover the local rendered set.
Each adapter exposes a `harvest` ledger. Calling `harvest.harvest(target, method, actor, range)`
validates adult/elder eligibility, range, finite coordinates and the hunting/fishing method,
rejects duplicate consumption and returns food/hide yields. Consumed generations disappear on
the next update. Failed requests do not deplete a target. A later generation is eligible again.

This is a foundation API, not yet an autonomous hunter/fisher job or player interaction.
The future authoritative simulation must resolve a fresh target by ID before calling harvest,
own the ledger, credit the returned resources once, and persist its `snapshot()` alongside the
world seed. The ledger constructor restores those IDs. Current renderer-owned ledgers are
session-local and are not connected to save/load or settlement inventories. Habitat slot
lifecycles are deterministic and need no per-frame state. Do not treat caller-supplied target
positions or stages as authoritative multiplayer input.

## Verification

Run the lifecycle, land wildlife, ambient bird, aquatic life and scenic camera Vitest suites.
`/tests/wildlife-preview.html` is a production-mesh review fixture with a simulation-month slider.
It shows the four terrestrial species at their real relative scale.
