# Weather Consequences

## Authority and cadence

`Simulation.stepMonth` advances `WeatherSystem` before economy and people. `SimulationState.weather` and `WorldState.weather` reference the same object. Weather uses its own seeded RNG; presentation never advances it. The environment integration extends that same system with condition-gated tornado paths, persistent consequences and seasonal presentation. It does not add a second weather grid or clock. Engine version is `godbox-sim-0.7.0`.

Regional fronts now affect their actual footprints. Background conditions use cached regional seeded variation and the existing climate moisture; transient soil wetness cannot create self-sustaining rain. Seasonal temperature is derived from the existing normalized temperature field (freezing threshold 0.38, seasonal amplitude 0.16), not degrees Celsius. Snow/rain phase is resolved locally even within one front.

## Environmental effects

- Rain adds to existing `WorldCell.moisture`, with evaporation and relaxation toward the generated climate baseline. Soil moisture feeds crop output and drought-related settlement climate stress.
- Snowpack stores normalized water equivalent. Snow only accumulates at or below the seasonal freezing threshold. Warmth melts it gradually; liquid snowmelt follows the same soil/runoff path as rainfall.
- `DynamicHydrology`, in the existing hydrology module, retains generated drainage order, downstream links, and contributing areas. Monthly runoff is routed downstream, smoothed into a bounded reservoir, and applied to the canonical `TerrainField.waterLevel` and `flow` arrays.
- Sustained runoff above the flood threshold expands water only across connected ground below the water surface. It updates `WorldCell.water` and cached flood depth/risk. Dry weather drains reservoirs and restores the original occupancy. This is a normalized catchment-response approximation, not a volumetric fluid solver.
- Ordinary precipitation stays below the flooding threshold. Fertility is not permanently incremented after every shower.
- Severe wind performs one probabilistic regional woodland damage check per cell per weather tick. Damage reduces the existing wood resource; a stable subset of vulnerable tree instances uses fallen/deadwood presentation followed by regrowth. Woodland resources gradually recover toward generated capacity after two years without severe windthrow. No per-tree physics or render-driven damage rolls occur.

## Civilization response

Snow and mud increase existing movement costs; deep snow can temporarily close minor routes. Both short and full waypoint steps validate water safety. Route caches reuse safe paths, cache failures only for the current environment revision, and remain bounded. People caught on newly unsafe ground are relocated using the existing nearest-safe-ground recovery, then seek shelter during dangerous local weather. This is a coarse evacuation response, not individual flood rescue physics.

Crop output depends on soil moisture, snowpack, flood depth and localized tornado crop disturbance. The legacy shared RNG draw is retained to avoid gratuitously shifting society's random stream. Construction pauses on inundated settlement ground. The current transportation network owns surveyed segment geometry. Snow adds mode-dependent freight movement costs and blocks walking at depth 1, roads at 1.2 and rail at 1.45; maintenance capabilities reduce speed penalties. Tornado damage reduces actual completed segment work, closing the segment until the existing resource-funded construction system repairs it.

No runtime fire, lake-freezing, or structural flood-damage system is added. Flood occupancy reaches existing placement checks; existing buildings can be temporarily inundated without being erased. Tornado structural damage is persistent, however: simulation-owned plots retain identity, location and condition after the storm. Builders spend wood and minerals on gradual repairs before new construction; there is no repair on the strike month. Damaged capacity reduces production. Deep snow, structural strikes, transport loss and completed structural recovery produce grounded historical events; ordinary weather stays silent.

## Presentation and cost

One shared weather texture receives target values when the simulation environment revision changes; displayed snow eases toward those targets without changing simulation state. Terrain, tagged settlement surfaces, roofs and roads use upward-facing snow masks without geometry rebuilding. Instanced foliage shares the weather texture. The old permanent mountain snow tint is removed: coverage now comes from accumulated pack. Seasonal canopy and tint are derived from the existing month, local climate and temperature, with deterministic tree offsets. Conifer/alpine and warm or dry climate exceptions retain their canopy. Tornado scars are indexed by cell at the existing low-frequency vegetation LOD cadence.

Rain/snow share a fixed total budget of 512 particles. Only samples near the active view and within its frustum are activated; off-camera weather has no emitters. Existing inland water geometry refreshes at the structural render cadence only after a simulation revision, reading canonical water levels. Rendering never changes water levels or occupancy. Restart disposes the weather texture and scene-owned particle resources.

Leaf drop uses at most 96 nearby points, only during the seasonal leaf-loss interval. Tornado presentation has four pooled funnels with 192 dust points each. A bounded presentation cache can finish an eight-second traversal of the recorded path after the simulation event leaves current weather state. It never chooses a path or applies damage.

## Snow and seasonal rules

Snowpack is a normalized water-equivalent index capped at 1.5, not meters. Freezing remains 0.38 in the existing normalized temperature scale. Accumulation uses precipitation intensity, duration, coldness, slope retention and blizzard severity. Melt uses positive temperature above freezing, seasonal sunlight and a depth-dependent reduction; meltwater enters the existing runoff and soil calculations. Elevation is already part of the generated temperature field and is not subtracted twice. Cold clear weather retains pack; cold highland cells can remain snowy while warmer lowlands thaw.

Blizzards require heavy snow, precipitation intensity above 0.65, wind above 0.6 and local seasonal temperature below 0.35. Severity multiplies three clamped ramps: intensity `(intensity - 0.65) / 0.35`, wind `(wind - 0.6) / 0.3`, and cold `(0.35 - temperature) / 0.12`. Ordinary snow, weak snowfall, calm storms and marginally freezing precipitation cannot qualify. Severe precipitation fronts now have wind `0.25 + intensity * 0.6`, allowing natural heavy-rain fronts to become blizzards where the existing local temperature resolves them as snow. No additional random draw or disaster spawner is introduced.

Blizzard severity increases accumulation by up to 35 percent, adds to existing movement penalties and reduces exposed food/wood production by up to 25 percent during the storm. Indoor goods production is not directly penalized. Existing snowpack costs and walking/road/rail closure thresholds remain in place; infrastructure and maintenance soften travel penalties. Existing dangerous-weather shelter behavior remains in place.

Snow history is settlement-rate-limited to one exceptional-snow event per 24 months. Pack above 1.1 qualifies as deep snow; blizzard severity above 0.5 with pack above 0.2 qualifies as a disruptive storm. Events record measured snowpack, snow duration, severity and travel penalty. Ordinary snowfall stays silent, and blizzard wording is used only for qualifying storms. No unmeasured isolation, deaths or migration causation are asserted.

Presentation reads blizzard severity near the camera's ground focus. It eases fog toward a maximum additional exponential density of 0.035, increases flake size and wind drift, and uses more of the same 512-particle pool (ordinary snow uses a density factor of 0.55; a maximum blizzard uses 1). Leaving the storm fades its visibility effect. Rounded snow particles, terrain, roof and vegetation snow masks remain cosmetic and never write simulation weather. Rain and snow may coexist in the view across regional temperature boundaries.

`seasonalFoliage` is a pure simulation-side resolver rather than another seasonal simulation. Smooth spring growth and autumn color/leaf-loss curves use local temperature/moisture and seeded identity offsets. Rendering interpolates month transitions and changes canopy size while preserving branches. Agriculture continues to use its existing seasonal production cycle, with additional persistent weather penalties. Calendar labels now agree with the existing winter-at-month-zero convention.

## Tornado formation and damage

Formation requires a thunderstorm with intensity at least 0.72, wind at least 0.55, non-water origin, moisture at least 0.48, temperature at least 0.5 and neighboring temperature contrast at least 0.035. A bounded potential combines those prerequisites with terrain slope. Only then does a dedicated seed/front/month stream sample the rare conditional probability (potential times 0.12). Ordinary rain cannot form a tornado. Climate, season and regional temperature gradients therefore affect frequency.

Each event records its parent front, formation month/location, intensity, width, direction, speed, lifetime in hours and nine contiguous path points. At most four fronts are considered per monthly tick. Swept point-to-segment distance, including structure footprint radius, determines exposure; endpoints alone do not decide a hit. Structural loss scales with squared intensity, exposure and existing stoneworking/workshop resilience. A missed settlement receives no structural damage and no strike story. No abstract population casualties are invented.

`syncStructurePlots` supplies persistent simulation-owned footprints consumed by the renderer. Allocation is event-driven by target size, bounded to 96 slots per settlement and checked against terrain/water and other plots. Damage records do not depend on visual density. Existing aggregate building counts remain slot counts; condition represents usable capacity and drives production loss and repair. Shrinking/tilting the corresponding building geometry presents damage and ruins in place.

Tornado paths also affect sampled cell woodland/crops and intersecting transport geometry. Crop penalties recover at 15 percent per month. Forest disturbance retains at most 128 recent path scars for up to 30 years, presenting three years of fallen wood followed by regrowth. Long-term resource recovery uses the existing wood field, not simulated individual trees. Historical events record actual damaged/destroyed structure or transport counts and resource-funded recovery duration.

## Deliberate simplifications

- Tornado lifetime is sub-month; the whole physical path resolves on a monthly tick, while presentation can play it afterward. People are not killed based on a representative rendering or a monthly position sample.
- Agricultural exposure is a nine-sample cell approximation, matching the existing cell-based production model rather than introducing individual field inventories.
- Snow does not have separate roof loads, drifting physics, individual flakes, ice safety or meltwater fluid dynamics. Snow masks tint surfaces rather than increasing mesh thickness.
- Seasonal leaf loss scales the existing canopy geometry; it does not simulate individual branches/leaves. Decorative settlement blossom assets are not part of the instanced ecological forest and retain their existing appearance.
- Persistent structural health and repair are simplified. Plots that cannot meet terrain constraints are not forced onto unsafe ground. Very large settlements retain aggregate buildings beyond the bounded spatial slots.
- Infrastructure effects use actual road/rail/bridge segments. Utilities do not yet have authoritative component footprints, so no arbitrary utility-grid damage is assigned.
- Forest scar history is bounded; under an unusually dense series of storms, the oldest visual scar can be evicted before its full 30-year interval. Historical event storage follows the existing history limit.
- Blizzard cold and duration resolve at the existing monthly cadence, not an hourly sustained-wind model. The local fog approximation is not a volumetric atmospheric solver. Early/late snowfall has no separate anomaly baseline or dedicated narration. Food-crisis records include measured snow and crop disturbance when present; causal migration attribution is not added.

Tests cover tick-driven rain, cold accumulation, warm rejection/thaw, meltwater runoff, snow travel closure/reopening, connected flood expansion/recession, wind damage rarity, sheltering, ordinary-weather settlement safety, deterministic replay, and bounded off-camera-independent visuals.

## Prior validation (before this integration)

Weather-specific and existing navigation checks pass. Desktop (1440x900) rain and mobile (390x844) snow were inspected in the browser, with nonblank canvas pixels, moving particles, bounded particle counts, and no shader errors. The production build and lint pass.

The full regression suite is not green: its latest full serial run passed 118 tests and exceeded six existing long-run timeouts, without reporting assertion failures. Subsequent shallow-snow traversal changes passed the focused weather/navigation checks but century-scale simulation tests still exceeded their 5-20 second budgets. Test timeouts were not increased. Further performance work is required before treating long-run throughput as validated.

## Integration verification (2026-09-07)

- Focused weather, seasonal, tornado, renderer and forest-lifecycle tests: 30 passed. Coverage includes suitable precipitation, snow persistence/thaw, seasonal exceptions, tornado prerequisites, deterministic paths, swept hits/misses, resilience, unfunded/funded repairs, real monthly strike history, and complete state equality under headless versus renderer-updated stepping.
- Browser canvas inspection: 1440x900 snow scene and 390x844 tornado scene were nonblank (34 and 91 distinct colors in central 32x32 pixel samples). Captures showed roof/terrain snow, adjacent clear ground, bare deciduous branches and an on-path funnel. Funnel position changed five world units between sampled frames. A follow-up refined the solid funnel into a transparent dust spiral. Integrated browser viewport resetting required direct canvas captures; full responsive overlay acceptance is not claimed.
- `npm run lint`: passed, exit 0.
- `npm run typecheck`: passed, exit 0.
- `npm run build`: passed, exit 0; Vite reports the existing large-renderer-chunk warning.
- Initial full `npm test`: 135 passed, 18 failed (153 total), exit 1, 133.61 seconds. Four assertion failures concerned railway discovery and surveyed trade availability; fourteen tests timed out. No timeouts were raised and no unrelated transport/knowledge expectations were changed by this pass.
- Final full `npm test`: 139 passed, 16 failed (155 total), 15 files passed and 7 failed, exit 1, 132.69 seconds. Thirteen failures are timeouts across archive, restart, people, historian, knowledge and simulation tests. Three assertions fail: railway enabling-stack eligibility, railway discovery probability, and trade-driven knowledge exchange. The two added weather history/authority cases pass. Final lint, explicit typecheck and production build all pass (exit 0); the renderer bundle remains above Vite's 500 kB warning threshold.
- Long-run throughput and a fully green repository suite remain unverified. Concurrent transport changes were present in the worktree; the full-suite failures should not be assumed to be either pre-existing or caused by weather without an isolated baseline.

## Winter integration verification (2026-09-07, engine 0.7.0)

This focused pass extends the existing snow system rather than replacing it. Changed implementation files are `src/sim/weather/WeatherSystem.ts` (severe-front winds and blizzard gates), `src/sim/Simulation.ts` (exposed production and grounded winter history), `src/render/atmosphere/WeatherRenderer.ts` (local blizzard presentation), `src/render/GodboxRenderer.ts` (fog integration), and `src/config.ts` (engine version). Tests were expanded in `tests/weather.test.ts` and `tests/weather-render.test.ts`; the existing seasonal foliage and infrastructure checks were retained.

- Focused check: `npx vitest run tests/weather-render.test.ts tests/seasonal-weather.test.ts tests/weather.test.ts`: 26 passed, three files passed, exit 0, 2.37 seconds. Tests cover intensity/duration accumulation, warm rain, cold persistence, gradual thaw and runoff, colder terrain retention, blizzard prerequisite rejection, real monthly front conversion, disruption and event rate limiting, camera-local particle density, snow material transitions and complete headless/viewed state equality through a seeded winter.
- Browser: isolated fixtures use the authoritative weather system, not a visual snow toggle. Desktop 1440x900 and mobile 390x844 captures show snowy ground, roof surfaces, forest canopies, nearby rain regions and blizzard haze. Desktop central 64x64 pixels contained 1,011 distinct colors; mobile central 32x32 pixels contained 70. Particle positions changed between frames. Weather state remained byte-for-byte unchanged by rendering, the pool stayed below 512, and shader diagnostics reported zero failures. The existing Three.js shadow-map deprecation warning remains. These checks verify the 3D scene, not a new UI or every naturally occurring winter.
- `npm run lint`: passed, exit 0.
- `npm run typecheck`: initially caught nullable texture data in the new test; after the test assertion was corrected, passed, exit 0.
- `npm test`: failed, exit 1. 146 passed and 15 failed (161 total); 15 files passed and seven failed; 113.58 seconds. Eleven failures were timeouts: archive (2), restart (2), people (2), historian (2), knowledge (1), simulation (2). Four assertion failures were railway enabling-stack eligibility, railway discovery probability, trade-driven knowledge exchange, and mixed culture shares after migration. No test timeouts or unrelated assertions were changed. Failure attribution requires an isolated baseline; a fully green suite and century-scale throughput are not claimed.
- `npm run build`: passed, exit 0. Vite transformed 67 modules; the renderer chunk is 717.94 kB (190.42 kB gzip), retaining the warning for chunks over 500 kB.

Performance remains bounded: no new climate grid, per-surface snow geometry, per-tree simulation, or world-scale flake state. Monthly snow rules remain O(existing cells), production/history adds O(settlements), and storm effects reuse the existing 512-particle pool and shared weather texture. Texture target updates follow environment revisions; its existing O(cells) display interpolation remains per frame. This is an architectural cost bound, not a measured long-run throughput improvement.