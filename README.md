# GODBOX

> You do not play GODBOX. You witness it.

> History is the protagonist.

GODBOX is a deterministic, autonomous civilization experiment presented as a living documentary diorama. It starts without a button, follows a configured world through a finite observation, archives what happened, and begins another observation when configured to do so. There is no player economy, victory condition, or traditional game HUD. The deliberate intervention surface is configuration.

## Start

Use Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the URL printed by Vite. The opening identifies the observation, world, and seed; the simulation then runs without interaction.

Release and simulation checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run sim -- --seed example --years 1000 --format human
npm run sim -- --seeds river,steppe,archipelago --years 600 --config scarcity --format human
npm run batch -- --runs 20 --years 1500 --config default --seed-prefix qa --format human
npm run pacing -- --runs 5 --years 1800 --view-years 300 --pace documentary
```

`sim` and `batch` emit JSON by default. Add `--format human` for a compact audit. Both accept `--population` and `--pace`; `batch` also accepts `--runs` and `--seed-prefix`. The pacing audit reports historical intervals, lifecycle durations, headless throughput, and a deterministic viewing trace.

## Design philosophy

Simulation state is authoritative. Presentation may decide where to look and how quickly to watch, but it cannot change an outcome. Randomness resolves uncertainty after causes are present; it is not itself a historical cause. War, migration, discovery, famine, state integration, collapse, atomic development, and off-world expansion all arise from inspectable prior state.

The world is the interface. The default overlay is limited to identity, observation, date, inferred era, represented population, current subject, grounded Historian text, and provenance class. There are no normal-operation menus or controls beyond the observer command line. Diagnostic UI is configuration-gated.

## Observer commands

Press `/` to open the command line, then Enter to run. Commands never nudge history mid-run; they only choose which world is witnessed.

| Command | Effect |
| --- | --- |
| `/restart` | Archive this world and begin a fresh observation under a new random seed |
| `/restart seed` | Replay the current seed from Year 0 (identical deterministic history) |
| `/restart <seed>` | Archive this world and begin Year 0 under the specified seed |

A restart fully resets simulation state, history, population, settlements, discoveries, resources, environment, caches, and derived state; nothing leaks from the prior run. The previous run is archived as completed first.

## Configuration and presets

Edit [`godbox.config.ts`](./godbox.config.ts) and restart. Defaults and types live in [`src/config.ts`](./src/config.ts). Configuration covers:

- base seed, population, settlements, geography, resources, sea level, and climate;
- monthly tick budget, history bound, and individual-agent soft cap;
- contact, trade, conflict, political integration, and fragmentation rates;
- knowledge discovery, diffusion, loss, and industrialization difficulty;
- advanced development, risk, population ceiling, and classification horizons;
- shot duration, camera transitions, adaptive documentary pacing, and visual density;
- observation duration, autosave recovery, automatic next run, and intermission;
- local audio layers, volume, crossfades, voice ducking, and silent mode.

Set `GODBOX_PRESET` in [`godbox.config.ts`](./godbox.config.ts). Local overrides are merged on top. Presets change conditions only; none inserts an event or selects an outcome.

| Preset | Exact changes from default |
| --- | --- |
| `default` | None |
| `abundant-world` | Resource abundance `1.35` |
| `scarcity` | Resource abundance `0.68` |
| `archipelago` | Sea level `0.48`; initial settlements `6-8` |
| `unstable-climate` | Climate variability `1.45` |
| `fragmented-politics` | Political integration `0.45`; fragmentation `1.8` |
| `highly-connected-world` | Contact `1.35`; trade connectivity `1.45`; knowledge diffusion `1.3` |

The world preset definitions are in [`src/presets.ts`](./src/presets.ts), and the same names work with `sim --config` and `batch --config`.

Set `GODBOX_TIME_PRESET` separately to choose how the same authoritative history is watched. Time presets only change camera and presentation cadence; they do not change discovery, political, demographic, conflict, or construction rates.

| Time preset | Intended use | Quiet / ordinary / significant / momentous years per real minute |
| --- | --- | --- |
| `slow-observer` | Patient close observation | `12.5 / 4 / 1.5 / 0.8` |
| `documentary` | Default unattended viewing | `30 / 10 / 3 / 1.5` |
| `default` / `normal` | Baseline documentary pacing | `36 / 12 / 3.6 / 1.8` |
| `long-observation` | Deep-time witnessing over weeks | `20 / 6 / 1.5 / 0.75` |
| `fast` | Quick visual survey | `480 / 150 / 40 / 20` |
| `accelerated-experiment` | Visual scanning | `240 / 90 / 20 / 10` |
| `fast-test` | Automated checks; identical rules, maximal pacing | Unbounded by presentation time |
| `batch/headless` | Non-visual experiments | Unbounded by presentation time |

All modes advance the same monthly simulation. The presentation director eases between rates, slows for personal lives and consequential events, and reaches quiet speed only after a sustained uneventful interval. Quiet, structurally simple stretches (few settlements, no wars or institutions forming) accelerate further through deep time, up to `presentation.deepTimeAcceleration`; eventful eras automatically receive finer steps. The default horizon is roughly 300,000 simulated years, and a world that old is not guaranteed to be modern: stagnation, collapse, rediscovery, and extinction are ordinary outcomes. See [`docs/PACING_REPORT.md`](./docs/PACING_REPORT.md) for the measured pass.

## Architecture

```text
configuration
    |
    v
Simulation - authoritative monthly state and HistoricalEvent[]
    |          people -> cohorts/cities/states at modern scale
    |          world, economy, migration, trade, politics, war
    |          knowledge, industry, atomic risk, machine, space
    |
    +----> RunArchive -> IndexedDB -> completed-run context
    |
    `----> Historian -> PresentationDirector / CameraDirector / AudioDirector
                                      |
                                      v
                                Three.js diorama
```

[`src/sim/Simulation.ts`](./src/sim/Simulation.ts) owns state, the simulation PRNG, and event creation. Rendering, pacing, the Historian, audio, and archive are readers. The Node runners use the same `Simulation` class as the browser. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for authority and grounding contracts.

## Determinism and observation lifecycle

A history is identified by `(engineVersion, seed, configuration)`. Simulation, Historian, and renderer have separate seeded streams, so a camera choice cannot consume a simulation random draw. `Math.random()` is prohibited in simulation code.

The first observation uses the configured base seed. Later observations derive stable seeds such as `base:observation-0002`, while sharing a seed-independent experiment fingerprint. Every ten simulated years, and whenever the page is hidden, GODBOX saves a schema-versioned record. Reload recovery reconstructs the exact simulation by replaying its configuration to the last archived month. At extinction or the configured horizon, the record is marked complete before an optional automatic reload starts the next observation.

## Simulation layers

Early history uses persistent named people with households, parents, partners, children, age, health, occupation, traits, prestige, and continuous movement. Each person also has an era-supported role, household-specific home, workplace identity, daily schedule, semantic destination, subtle social position, and culture-linked appearance. Pedestrians use terrain-validated routes between homes, paths, fields, markets, shrines, civic places, docks, workshops, construction sites, and later industrial or research districts; water crossings require an explicit bridge, ferry, boat, or rail mode. Settlements hold resources, infrastructure, culture shares, political power, institutions, and knowledge. Trade routes move goods, knowledge, and culture; relations retain trust, hostility, dependency, grievances, territorial tension, and alliances. Wars require sufficient combined pressure and record mobilization, supply, terrain, leadership, morale, technology, actual casualties, and resolution.

Industrial-scale societies transition to statistical population without discarding documentary lives. Cohorts, city aggregates, polity/state aggregates, sectors, advanced institutions, and a bounded cast of persistent people represent mass society. The cast does not add population. Modern settlement formation uses represented city population, not the size of the documentary cast.

## Knowledge and industrialization

[`src/sim/knowledge/catalog.ts`](./src/sim/knowledge/catalog.ts) is a prerequisite graph of understandings, practices, and capabilities rather than an era counter. Discovery readiness combines foundations, alternate lineages, geography, resources, occupations, institutions, experimentation, pressure, and culture. Theory and reproducible practice are separate. Knowledge can diffuse through trade, migration, or conquest; it can become dormant, be lost with specialists or archives, survive as fragments, and be rediscovered with lineage provenance.

Discovery is only the beginning of a capability's history. Major knowledge must accumulate theory and reproducible practice before it emits an adoption milestone. Civilization-scale transformation requires deeper practical mastery, supporting institutions, infrastructure, and economic surplus. Those stages are stored on the knowledge record and remain deterministic.

Industrialization requires converging machinery, material or chemical practice, precise manufacturing, transport, capital, food, labor, and institutions. It proceeds through experimental engines, specialist workshops, commercial machinery, and transport integration before industrial transformation. Roads, ports, bridges, workshops, archives, rail, power, and factories consume real surplus. Atomic capability additionally requires transformed fission knowledge, a mature industrial base, power infrastructure, and a research network.

## Technological adolescence and the Fermi experiment

[`src/sim/advanced/AdvancedCivilizationSystem.ts`](./src/sim/advanced/AdvancedCivilizationSystem.ts) extends the causal graph through modern medicine, communications, aviation, atomic physics, computation, biotechnology, automation, machine intelligence, and nearby space.

Atomic knowledge is not an automatic weapon. State programs respond to rivalry, real wars, security dilemmas, scientific capacity, regulation, public trust, doctrine, and coordination. Strategic state remains abstract: arsenal scale, survivability, warning reliability, command reliability, restraint, crisis, disarmament, limited use, and major exchange. GODBOX contains no weapon-construction or tactical-targeting model.

Advanced development priorities are persistent consequences of cultural dimensions. Long-term orientation and openness can favor space; hierarchy, trade orientation, and cooperation affect machine adoption; cooperation and trust affect welfare; militarism and fragmentation affect defense. These priorities separate atomic, orbital, interplanetary, and post-biological paths instead of scripting one inevitable technology ladder.

Existential risks expose hazard, vulnerability, mitigation, and annual probability. A seeded draw may realize a risk only after those terms create exposure. The civilization can formulate culture-shaped Fermi hypotheses when its astronomy and communications support the question. Those hypotheses change SETI, broadcast caution, and space investment; they are in-world beliefs, not answers from the simulator.

Horizon classifications are `EXTINCT`, `COLLAPSED`, `STAGNANT`, `PLANETARY STABLE`, `INTERPLANETARY`, `POST-BIOLOGICAL`, and `UNKNOWN`. Stability and collapse require sustained conditions. Interplanetary status requires an independently sustainable second body, not merely an orbital launch or colony.

## Historian

[`src/historian/Historian.ts`](./src/historian/Historian.ts) selects ordinary life, travel, institutions, landscapes, discoveries, conflict, aftermath, and long-run context. A beat pattern and repetition penalties prevent magnitude-only editing. Camera shots have minimum interrupt ages, eased travel, terrain clearance, varied framing, and long transitions. A consequential event slows presentation only when the current observation is actually grounded in that event; unrelated activity elsewhere cannot hold every ordinary-life shot at crisis speed.

Every statement is internally labeled `recorded-fact`, `derived-statistic`, or `probabilistic-inference`. It carries source event, entity, and archive IDs plus typed claims. Display validation rejects future evidence, missing entities, invented wars or discoveries, incorrect population scopes, and unsupported archive comparisons. Predictions are explicitly uncertain and later resolved. Cross-run wording remains descriptive and never turns correlation into causation.

## Archive and batch runner

[`src/historian/RunArchive.ts`](./src/historian/RunArchive.ts) stores deterministic identity, base and observation seeds, fingerprints, full configuration, initial conditions, major entities and events, demographic milestones, conflicts, institutions, selected people, Historian statements, predictions, and outcomes. IndexedDB is the durable browser store; an in-memory fallback keeps the observation running if persistence is unavailable. Older schemas migrate on read, and unknown future schemas are rejected.

Completed records feed cautious cross-run counts and medians. Ongoing or failed records never contaminate completed-run statistics.

[`src/experiment/BatchExperiment.ts`](./src/experiment/BatchExperiment.ts) samples population, settlement and polity trajectories every 50 years and reports runtime, conflict and trade rates, discovery timing, industrialization, atomic milestones, post-atomic survival, space outcomes, and descriptive associations. These numbers are simulation QA, not scientific claims about real civilizations. The current audited sample is documented in [`docs/DEVELOPMENT_REPORT.md`](./docs/DEVELOPMENT_REPORT.md).

## Landscape

The world is not a heightmap sampled once from a noise function. [`src/sim/terrain/`](./src/sim/terrain/) synthesises it in layers and then lets water rework it, and the renderer meshes the result as one continuous surface.

**Terrain generation.** [`Heightfield.ts`](./src/sim/terrain/Heightfield.ts) evaluates a high-resolution field at three samples per simulation cell. Each sample stacks spatial scales: a domain-warped continental mass with a noise-wobbled coastline; ridged relief confined to long tectonic belts, which is what produces chains rather than isolated lumps; rarer isolated massifs; quantised plateau terraces; hill and surface grain; and narrow canyon belts incised into dry high ground. The result is remapped onto fixed elevation quantiles, so every seed yields a comparable amount of ocean, lowland, hill country and mountain regardless of how the noise landed. Talus erosion then rounds shoulders and builds scree aprons while leaving ridge crests sharp, and depositional smoothing flattens the low ground into basins a civilisation would actually farm.

**Hydrology.** [`Hydrology.ts`](./src/sim/terrain/Hydrology.ts) runs a priority flood from the map border. Anything the water cannot escape becomes a filled basin — that is where lakes are. Flow is then routed D8 down the filled surface and accumulated from the highest sample to the sea, so discharge is real upstream area rather than a river-shaped noise band. Channels above a discharge threshold are incised into their own valleys, a second pass re-routes on the carved terrain, and a descent pass guarantees every channel bed falls along its own flow path. Waterfalls are marked where a channel drops sharply relative to its step length. Rivers therefore start high, join, widen downstream, and always reach a lake or the sea.

**Biomes and landmarks.** Simulation cells sample the field for elevation, slope, local relief, discharge and exposed rock. Moisture follows the land: rivers and lakes water their surroundings and steep high ground sheds its rain, so biome transitions have a geographic reason. A `Landform` — shore, lowland, basin, valley, hill, plateau, ridge, peak, canyon — is recorded alongside the biome and feeds settlement siting. [`Landmarks.ts`](./src/sim/terrain/Landmarks.ts) selects a small deterministic set of rare natural features (great peak, pass, falls, sacred lake, deep canyon, cliff cape, river mouth); settlements score higher near them and the Historian frames scenic shots on them by name.

**Terrain and civilisation.** Settlement siting reads flat ground, fresh water, harbours, landform and landmark proximity rather than a habitability number alone. Floodplains beside strong rivers are the fertile ground; slope raises movement cost; coastal towns far apart along one coastline trade by sea.

**Surface.** [`TerrainSurface.ts`](./src/render/terrain/TerrainSurface.ts) is the single authority on where the ground is — mesh, foundations, vegetation, routes and camera all sample it, which is why nothing floats. It emits one continuous vertex-coloured mesh with smooth normals and an alternating quad diagonal, replacing the per-cell boxes that made the world read as a grid. Surface blending is driven by slope, altitude, moisture, hydrology and exposed rock, so beaches form where flat land meets the sea, silt follows the rivers, warm strata and cold stone appear on the faces, and snow caps only the summits. High ground gets an eased vertical lift so peaks read as mountains while valleys stay buildable.

**Water.** [`WaterSystem.ts`](./src/render/terrain/WaterSystem.ts) draws the ocean as one sheet beyond the fog horizon, and meshes lakes and rivers from the filled basins. Channels are dilated by discharge into ribbons and faded out at the banks, so a river reads as a river instead of a chain of blue rectangles. The strongest falls get foam and a mist cloud at their base.

**Forests.** [`ForestPlanner.ts`](./src/render/vegetation/ForestPlanner.ts) derives density from woodland resource, moisture, slope and treeline, then carves cores, edges and clearings with a low-frequency patch field. Species follow the land: alpine and conifer with altitude and cold, riverbank along the watercourses, dry-climate trees where moisture fails, broadleaf otherwise. Blossom groves are deliberately scarce — a rare wild grove mask, plus an orchard mask in a ring around each settlement so approaches are lined rather than smothered. Rare ancient trees are wider, older and survive the clearing a city makes around them. Cities eat the woodland inside their built radius and abandoned ground grows back.

**Trees.** [`TreeLibrary.ts`](./src/render/vegetation/TreeLibrary.ts) grows each variant from a species table — clear trunk, taper, fork count, branch spread, droop, decay, crown spread and lift — breadth-first under a hard segment budget, so a tree keeps a complete silhouette when the budget runs out. Crowns are assembled from many irregular jittered clumps at the branch tips rather than one sphere. Seven families with three deterministic variants each are shared through instancing.

**Atmosphere.** [`SkyAtmosphere.ts`](./src/render/atmosphere/SkyAtmosphere.ts) adds a gradient sky dome recoloured by the day/night cycle, a high cloud layer, and a translucent mist sheet whose alpha is driven by how far the terrain sits below the mist ceiling, so fog pools in the valleys and thins on the slopes above.

**Terrain performance.** The terrain is one draw call. Vegetation uses two instanced detail tiers whose membership is re-sorted by camera distance a few times a second: a detailed tier inside 40 units and a reduced tier beyond it, both capped per species-variant bucket. Rocks, scree and ground cover are one instanced mesh each with attempt-bounded rejection sampling. A representative frame at 1440x810 runs ~75 FPS with ~1,600 trees, ~410 draw calls and ~700k scene triangles.

## Rendering and performance

The Three.js renderer uses one continuous mesh for terrain and instancing for people, vegetation, and terrain decor. The visible documentary cast is a stable ID-based sample capped at `max(48, 384 * visualDensity)`; detailed limb, tool, headwear, cargo, and activity animation updates are distance-gated while distant people retain a readable silhouette. Structural settlement, route, and war rebuild checks run at a lower configured frequency than animation. Culture/color lookups and event scans are cached, temporary frame allocations are avoided, particle and building density are capped, pixel ratio is bounded, and all scene resources are disposed on unload. The initial application loads separately from the renderer chunk so the opening can appear before the visual engine is evaluated.

Japanese-influenced composition and roof silhouettes combine with African textile/mosaic-inspired palette and motif logic. Cultural symbols persist across banners, archives, industry, reactors, machine lattices, and orbital masts; advanced cities are descendants of their own material past rather than generic cyberpunk sets.

Simulation acceleration uses bounded persistent people followed by cohorts, cached settlement/person/route indexes, cached knowledge occupation counts, bounded event history, and sampled batch trajectories. Presentation accelerates quiet and later-era passages but gives significant transitions room to breathe. Seasonal vegetation and atmosphere, day/night lighting, gradual structure transitions, and mixed-age districts keep ordinary time visible between turning points. Presentation speed never changes the tick sequence.

## Built environment

Structures are not modeled meshes. They are resolved from an architectural grammar and then composed into geometry, so the same rules produce a hide shelter and the foundry that eventually stands on the same ground.

**Style grammar.** [`src/render/assets/BuildingGrammar.ts`](./src/render/assets/BuildingGrammar.ts) resolves a `BuildingGrammar` from `(culture style profile, era, role, variation seed)`. The grammar fully describes massing, storeys, structural bay rhythm, plinth and stairs, post style, wall layer, roof family, tiering, pitch, eave overhang and upturn, roof curvature, rafter tails, motif and pattern banding, opening style, veranda, banner, lanterns, gateway, forecourt, enclosure, chimneys, vents, ornament level, and emissive/forge intensity. Composition never invents form; it only reads the grammar. Culture style drives roof language, eave depth, trim density, motif family, and pattern style, so each civilization keeps a recognizable architectural hand.

**Roles and era clamping.** A plot is assigned the structure it is *destined* to hold. `clampRoleToEra` then renders whatever the era can actually build, so a future foundry stands as a workshop for centuries and as a hut before that. This is what makes industrial and advanced architecture read as a descendant rather than a replacement.

**Composition.** [`src/render/assets/BuildingComposer.ts`](./src/render/assets/BuildingComposer.ts) assembles groundworks, frame, body, openings, roof shells, stacks, and details in a canonical frame — origin on the ground, entrance facing `+Z`. Parts are emitted into per-surface [`GeometryBuilder`](./src/render/assets/GeometryBuilder.ts) buffers and merged, so a fully detailed structure costs one draw call per surface it actually uses rather than one per plank. The composer reports its plan extent so the renderer can fit an entire ceremonial precinct inside its reserved placement footprint.

**Construction lifecycle.** Parts declare the stage at which they appear: `FOUNDATION → FRAME → WALLS → ROOF → DETAIL`. [`VisualStateResolver`](./src/render/presentation/VisualStateResolver.ts) detects foundings and upgrades; [`TransitionTimeline`](./src/render/presentation/TransitionTimeline.ts) plays them out over presentation time; the renderer re-emits a structure as its stage advances, with builder's scaffolding until it tops out. Buildings rise, they do not teleport.

**Mixed-age settlements.** Each plot records the era it was founded in and a deterministic conservatism value. When a settlement modernizes, conservative and ceremonial plots lag behind, so a mature town still shows the shrine and the old houses it grew around instead of being reskinned wholesale.

**Settlement legibility.** Plots are zoned into civic, sacred, market, residential, craft, and industrial districts laid out in rings from a paved civic core, with entrances aimed back at that core. Category is readable from the camera through massing, roof family, ornament level, and material.

**Reliable placement.** Dry structures are accepted only when their full reserved footprint is inside the world, clear of water and incompatible footprints, and within average and maximum slope limits. Persistent entity-derived footprint IDs make rebuilds idempotent and reject coordinate drift. Construction reserves the future building plot before showing its foundation and scaffold, and builders use that same semantic construction destination. Water-tolerant infrastructure is explicit rather than an accidental exception.

**Materials and night.** [`MaterialPalette`](./src/render/materials/MaterialPalette.ts) blends culture color into fixed earthen anchors — terracotta, ochre, plaster, indigo tile, gold, turquoise — so no civilization leaves the shared colourway. One shared material per surface backs every structure. A night factor drives window, lantern, motif, and forge emissives, keeping settlements readable and inhabited after dark.

**Performance.** Geometry is cached per `(culture, era, role, variation, stage)` rather than per instance, so a hundred houses share a handful of buffers; instances are clones over shared geometry and materials. Cached geometry and palette materials are flagged shared and are not disposed when an individual settlement group is rebuilt. Two LOD levels back each structure.

## Adding audio

GODBOX ships silent and does not call an external API at runtime. Add only audio you own or are licensed to use:

```text
public/audio/
  ambient/
  music/
  historian/
  events/
```

Register relative files in [`src/audio/audio.manifest.ts`](./src/audio/audio.manifest.ts):

- `ambience` maps documentary categories to loopable environmental beds;
- `music` maps settlement, urban, recorded, industrial, atomic, machine, and interplanetary eras;
- `events` maps categories to optional one-shots;
- `voiceAssets` maps a Historian statement asset ID to a local narration file.

The director layers ambience and music, crossfades changes, ducks both under narration, handles one-shots, and treats missing or blocked files as silence. Set `audio.enabled: false` for explicit silent mode. Suno or ElevenLabs output can be added as locally owned files; no engine rewrite or runtime service call is needed.

## Deployment

```bash
npm run build
```

Deploy the generated `dist/` directory to any static host. No backend, account, API key, remote database, or remote font is required. Serve through HTTP rather than opening `dist/index.html` directly so module and audio paths resolve correctly. If deploying below a URL subpath, set the matching Vite base and `audio.basePath`.

## Current limitations

- The authoritative tick is monthly; displayed days interpolate documentary time.
- Terrain and water are strategically legible, not geological or hydrological simulations.
- Economy, disease, nuclear strategy, machine capability, and nearby space remain civilization-level abstractions.
- Modern people are a documentary sample of cohorts; GODBOX does not retain a complete genealogy at mass scale.
- Political systems model power arrangements and institutions, not full constitutions, offices, or legal codes.
- Off-world systems cover nearby orbital and planetary resilience, not a galaxy simulation.
- The default 1,800-year horizon can under-sample very rare events. Use larger deterministic batches before drawing QA conclusions.
- Batch statistics describe this model and configuration only. They have no scientific predictive meaning.
