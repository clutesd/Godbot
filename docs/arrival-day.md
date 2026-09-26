# Arrival Day

## Implementation

Restart and every new browser observation use `startMode: 'arrival'`. The lower-level simulation retains `startMode: 'established'` as its default for existing scientific/headless experiments and their matched-seed baselines. `Simulation.restart()` always enters arrival, including when the old run used an established start. Restart without an argument now correctly retains the current seed after a previous seeded restart.

The simulation rebuilds the world and all subsystems and asserts that month, people, settlements, cultures, institutions, polities, wars, relations, human modifications, extraction, transportation and history are pristine. No established bootstrap runs on the arrival path. The renderer is disposed and rebuilt by the browser restart hook; the archive is a fresh record with no prior-run narrative context. Previously completed observations remain separate archive records.

`FoundingArrivalDirector` owns the explicit phases. Animation seconds are independent of simulation months; `step()` itself refuses advancement before `HISTORY_RUNNING`. Fixed 100ms event ordering makes playback, preview jumps and archive reconstruction deterministic. There are no arrival timers or additional animation loops.

| Time | State and composition |
| --- | --- |
| 0-4s | Brief pristine-world establishing view |
| 5-12.6s | Staggered vessel entries; follow the first descent |
| 17-26s | Individually braked touchdowns at authoritative coordinates |
| 18.7-32s | Real founders emerge; move toward the first gathering |
| 27-34s | Human-scale hold without inter-site flights |
| 34-38s | Title over the people, without a world-scale pullback |
| 38s | One `ARRIVAL_DAY` event at month zero; frozen orientation begins |

The physical film is 38 seconds (previously 78). Orientation, two portraits and release add
25.4 seconds of authored holds; safety-constrained travel can add time. Monthly history remains
gated until release completes. All five landings keep deterministic ordering and original descent
durations; entries begin eight seconds sooner. Older archived timestamps remain supported.

The scene uses compact faceted capsules, heat shields, four landing feet, hinged hatches and small colored seams. Each trail has a narrow core and broad haze sampled from the same curved trajectory as its hull. Fixed-size ribbons and dust pools fade and are disposed after the sequence; only five hulls persist. Dust color reflects cold, wet, wooded or dry terrain. No blast crater or wide deforestation is introduced. Landed hull footprints exclude nearby vegetation and future building plots.

The existing camera director handles arrival framing and retains its current position/look target for the handoff. Terrain clearance is sampled along the sightline. Arrival sunlight advances slowly so people remain readable, and continues from that phase afterward. Text is timed Watcher narration; this change does not generate a new voice recording.

### Post-title editorial contract

The post-title orientation stays beside the first gathering and states the premise briefly. Two
deterministic founder portraits introduce human stakes. The final 5.2-second release follows the
last founder and uses the renderer's actual interaction target when available, keeping people and
activity in view instead of pulling back into trees. Cast selection grants no simulation advantage.
The spring, terrain/forest safety, flight controller and explicit history authority barrier remain
in place. Community geography returns through normal history rather than a five-site tour.

The first-year continuity layer begins only after that release. Community revisits are spaced across authoritative months so the opening cannot collapse back into a second five-card carousel. From that point onward, founding context is part of normal documentary history rather than the Arrival Day cinematic.


## Founding reality

Five deterministic sites must pass dry fine-terrain footprint checks, local slope/height variation checks, walkable exit checks and a separation of 17% of world width (minimum eight world units). Selection weights habitability, fertility, distance and biome variety. An unsupported tiny/pathological world fails explicitly instead of silently placing a pod in water.

Each vessel has stable IDs, color, profile, ground position, landing time, 22 passenger IDs, a camp link and a condition field for future salvage/heritage work. Descents terminate exactly at those positions. `Person.foundingOrigin` retains vessel, group and original coordinates after normal migration begins. Landing sites are reserved against later construction.

The five profiles bias agriculture/biology, materials/mechanics, medicine/biology, records/manufacturing and navigation/transport. Adults receive varied expertise; no future occupation or political trajectory is scripted. Inherited advanced ideas have theory 0.58 and practice 0.02, with no adoption date or infrastructure. The existing capability gates, research, careers and resource systems remain authoritative.

Each camp starts with zero structures, roads, workshops, institutions and industry. Its finite manifest provides 100 food, six goods, eight timber units from packing spars and three stone units of mineral ballast. Supplies enter ordinary inventories once. There is no replenishment service, futuristic production or automatic shelter. Construction uses the existing labour/material development system; early hardship remains possible.

`ARRIVAL_DAY` stores year/month/day zero, pod and group identities, landing coordinates, people and knowledge profiles. It is retained despite bounded history and captured by the RunArchive. The archive also persists the arrival state and restores it before monthly replay. An empty pre-arrival world is not classified as extinct.

## Watcher opening candidates

1. **Chosen — The first record:** “No kingdoms yet stood here. No roads crossed the land. Five vessels crossed the silent sky. They carried memory, knowledge, fear — and the first seeds of history. What follows will belong to them.” Final title: **ARRIVAL DAY**. Its opening lines establish observable absence, its middle gives the vessels human significance, and its ending leaves agency with the people.
2. **The unwritten world:** “The rivers had no names. The mountains kept no record. Then five lights appeared. Within them were people who would name things, remember things, and change them.”
3. **What they brought:** “They brought no kingdoms. Only what they could carry: knowledge, old fears, and one another. Beneath them lay a world without a human past.”
4. **The first witnesses:** “Before the first boundary, before the first road, this land belonged to weather and growing things. Five vessels descended. From here, there would be witnesses.”
5. **A beginning without promises:** “Five vessels found the ground. No promise waited for them. They carried enough to begin. What they would keep, lose, or become was still unknown.”

## Review and verification

Run `npm run dev`, then open `/tests/arrival-preview.html`. The preview uses the production app with seed `arrival-day-preview`, starts paused, and keeps its archive in memory. Choose a moment and click Inspect; use Play/pause or quarter-second steps. Rewinding recreates the entire run, which also exercises restart cleanup. Debug controls are absent from normal presentation and production builds.

Targeted tests cover pristine reset, clock gating, five safe sites across five seeds, staggered landings, actual Person origins, finite supplies, knowledge/capability separation, archive retention, repeated restart, deterministic playback, bounded effects and persistent hulls. Renderer geometry tests do not substitute for judging the live compositions. Browser visual review remains necessary when a browser surface is available.
