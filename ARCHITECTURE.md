# GODBOX architecture

## Authority boundary

`Simulation` is the sole authority for world state and historical events. It owns the simulation PRNG and advances only in whole monthly ticks. Rendering, scene selection, pacing, archives, subtitles, and audio may read its public state; none may mutate it or consume its random stream.

```text
SimulationState + HistoricalEvent[]
              |
              v
          Historian <---- completed RunArchive records
              |                       |
              | ObservationCandidate  | aggregate context
              v                       |
 CameraDirector + PresentationDirector|
              |                       |
              v                       |
    renderer / subtitle / audio <-----+
```

GODBOX has three separate clocks. Authoritative simulation time is the monthly tick sequence. Historical process time is encoded in causal state and explicit durations such as adoption, construction, consolidation, and decline. Presentation time is the wall-clock rate at which `PresentationDirector` asks the main loop for those monthly ticks. Given the same engine version, seed, and historical configuration, changing a shot length or time preset changes when viewers see history, never the history produced.

`PresentationDirector` is a deterministic, read-only adaptive layer. It eases among personal, momentous, significant, ordinary, and accelerated-quiet rates. Event urgency applies only when the current observation cites that event, and quiet acceleration ramps up after a configured interval rather than jumping immediately. On top of that sits adaptive temporal resolution: a structural-complexity estimate (active wars, recent milestones, polities, industry, machine capability) lets quiet, simple worlds advance through deep time up to `presentation.deepTimeAcceleration` times faster, while complex eras receive finer observer time and smaller per-frame tick budgets (`tickBudget`). Simulation rules never vary with pacing. `CameraDirector` keeps shots persistent enough to establish geography and ordinary life before an interruption.

An observation spans a configured horizon of roughly three hundred thousand years by default; there is no linear mapping between simulated and wall-clock time. The observer command line (press `/`) supports `/restart` (a new random seed), `/restart seed` (replay the current seed from Year 0), and `/restart <seed>` (a specified seed). A restart archives the current run as completed and rebuilds the run in place: `Simulation.restart()` reconstructs the PRNG streams, world, people, settlements, knowledge, institutions, relations, wars, polities, history, statistics, caches, and every subsystem, so nothing leaks between runs and the same seed and configuration replay identically.

Discovery is condition-driven rather than calendar-driven. Prerequisites (prior knowledge, population, density, surplus, specialists, materials, trade contact, institutions, infrastructure) gate eligibility at partial familiarity; the per-year probability then ramps with measured mastery of the prerequisite chain and with a difficulty-scaled critical mass of accumulated domain experimentation, so breakthroughs begin very unlikely and become likely only inside long-prepared conditions. Invention is separated from use: idea -> experimentation -> local adoption -> diffusion along trade, migration, and conquest -> widespread adoption (a `technology-widespread` milestone once half of living settlements practice it) -> infrastructure-backed transformation. Civilization-scale capability in the advanced systems is weighted by how far adoption has diffused, so a lone breakthrough never instantly modernizes the world. Knowledge decays, goes dormant, is lost, and is rediscovered; collapse and extinction remain ordinary outcomes, and a very old world is not guaranteed to be modern.

Time presets are deliberately narrower than world presets:

```text
world preset -> authoritative initial conditions and historical pressures
time preset  -> camera shot lengths + presentation months per wall-clock second
```

Headless and batch runners bypass wall-clock presentation pacing and step the same `Simulation` directly.

## Historical persistence

The foundational material economy is described in [RESOURCE_ECONOMY.md](docs/RESOURCE_ECONOMY.md). World generation sites deposits from biome/geology; settlements discover them, assign finite labour, carry harvested stock along validated paths, and consume physical inputs in learned processes. The material ledger backs existing wood/stone budgets, so construction, repairs and infrastructure share the same finite supply. Ore samples also gate the existing knowledge network. Logging uses the existing authoritative woodland stock and weather-driven recovery; renderer tree lifecycles show the consequence. Resource freight extends the existing transport model, and equipped materials feed the derived military profile without replacing campaigns.

Knowledge records carry separate discovery, adoption, and transformation months. Adoption requires accumulated theory and reproducible practice; transformation also requires supporting institutions, infrastructure, and surplus. Industry advances through durable intermediate stages before becoming active, and atomic capability requires transformed fission knowledge plus mature industrial, power, and research foundations.

Settlements accumulate building work over simulated months and remain alive through a prolonged decline window before abandonment. Polities have formation, consolidation, maturity, stress, and decline phases; stability derives from legitimacy, administration, prosperity, internal trade, and conflict. Leadership and dynastic households persist across ordinary years, while integration, succession, fracture, and war remain event-driven consequences.

## Terrain boundary

Terrain is simulation state, not scenery. `generateWorld` synthesises a high-resolution `TerrainField` at three samples per simulation cell, runs erosion and hydrology over it, and stores it on `WorldState` alongside the coarse `WorldCell` grid and the deterministic `WorldLandmark` set. Both resolutions come from the same seeded streams, so a replay produces the same coastline, the same rivers and the same peak.

```text
seed -> layered heightfield -> erosion -> hydrology (fill, route, carve, re-route)
                                            |
                     +----------------------+----------------------+
                     v                                             v
        WorldCell grid (simulation reasons here)        TerrainField (renderer meshes this)
```

The renderer never invents ground. `TerrainSurface.heightAt` is the single height authority for the terrain mesh, building foundations, vegetation, routes, decor and camera clearance; anything that positions itself in the world asks it. Its render-only additions — the eased alpine lift and the surface grain — are inside that one function, so visual exaggeration can change without anything drifting off the ground.

Slope, relief, discharge and rockiness are recorded on `WorldCell`, which is what lets settlement siting, movement cost, fertility and biome moisture respond to geography instead of to a separate decorative layer. Placement contracts and terrain queries continue to read the cell grid; the field is a rendering and hydrology detail beneath them.

## Multi-resolution population boundary

Population changes representation without changing authority. Early societies use explicit, persistent `Person` agents. Industrial societies increase the causal weight of settlements and institutions. Once industrial activity and a modern scientific/communication foundation converge, `AdvancedCivilizationState.scale` becomes `modern-statistical` and the authoritative population moves to cohorts, city aggregates, polity/state aggregates, sectors, and advanced institutions.

Named people remain a bounded documentary sample. When that sample ages out, `Simulation` deterministically samples new persistent lives from the extant city distribution. Sampling does not add represented population or resources. Birth, death, catastrophe, archive, Historian, renderer, and summary code use explicit counts before the transition and represented counts afterward. City totals are normalized to the represented population, preserving continuity across the boundary.

```text
explicit people + households
           |
           | industry + modern foundation
           v
represented population
  +-- age/biological cohorts
  +-- city aggregates
  +-- polity/state aggregates
  +-- sectors and institutions
  `-- bounded persistent people (documentary sample only)
```

## Purposeful inhabitants

`PeopleSystem` is the authoritative bridge between a persistent person's household and the visible settlement. It deterministically derives an era-valid role, a workplace identity, subtle social position and appearance cues, then assigns a daily phase and a semantic destination such as home, field, workshop, market, shrine, civic office, construction site, dock, factory, research site, or patrol point. Children and elders remain household-centered; industrial and advanced jobs cannot appear before their supporting economy and capabilities exist.

The simulation and renderer consume the same neutral `SettlementLayoutPlan`, so a simulated market trip and the market district on screen refer to the same place without making render geometry authoritative. `WalkabilityLayer` validates spawn points and every pedestrian route against the world grid, rejects water, peaks, canyons, and excessive movement cost, and deterministically detours around unsafe segments. Water travel is permitted only when a migration or route explicitly selects a bridge, ferry, boat, or rail crossing mode. A failed route leaves the person at the nearest safe point and schedules a replan; it never licenses a shortcut through water.

The renderer shows a stable, ID-sampled documentary cast capped by visual density. Near figures receive role colors, culture accents, body/age variation, headwear, carried items, articulated limbs, and activity animation; distant figures retain only their silhouette. Builders visibly gather around the currently reserved construction footprint, while other workers cluster at the semantic district their role uses.

## Advanced capability and risk boundary

The knowledge catalog remains a prerequisite network, not an era counter. `AdvancedCivilizationSystem` reads practical mastery and existing political/economic state, then updates atomic applications, strategic posture, machine deployment, nearby space infrastructure, in-world Fermi beliefs, environment, and outcome classification. It writes only typed state and event drafts; `Simulation` remains the event authority.

Persistent development priorities separate advanced paths. Space, machine adoption, welfare, and defense targets are derived from cultural dimensions and governance rather than randomly assigned or selected by an outcome table. They modify investment and deployment, while concrete knowledge and institutional prerequisites remain mandatory.

Each existential pressure exposes `hazard`, `vulnerability`, `mitigation`, and `annualProbability`. Technology can increase multiple terms in different directions. Natural hazards have low base exposure, while consequences depend on health, governance, aerospace capability, infrastructure, and off-world redundancy. Nuclear escalation additionally depends on real arsenals, hostility/crisis, survivability, warning, command/control, and restraint. No subsystem contains detailed weapon construction or tactical targeting.

Outcomes are sustained state classifications rather than arbitrary endings. Collapse requires prolonged loss of recoverable capability, planetary stability requires centuries of post-atomic resilience, interplanetary status requires an independently sustainable second body, and post-biological/unknown outcomes require specific capability, deployment, biological-share, and observability conditions.

## Historian grounding

A `HistorianStatement` carries an epistemic status and source IDs. Recorded facts require an event or entity. Derived statistics require events, entities, or completed archive records. Probabilistic inferences require current entity evidence and are stored as predictions with a horizon and later resolution.

Before a candidate may be shown, validation checks observation time, source-event time, entity existence, archive provenance, population scope, war identity, discovery identity, and claimed event type. If a line cannot pass, it is removed from the candidate pool.

Scene scores retain their components so selection remains inspectable. A documentary beat pattern and repetition penalties prevent pure magnitude chasing and keep ordinary people in view. Newly recorded high-significance events can request a focused cut after a minimum shot age, preserving responsiveness without frantic editing.

## Durable records

`RunRecordBuilder` incrementally retains major events and selected people rather than every tick. Each record includes a deterministic world name, observation number, seed, full config, config fingerprint, engine version, initial conditions, major entities, demographic milestones, categorized event IDs, conflicts, institutions, Historian output, predictions, and outcome totals.

`HistorianArchiveStore` writes schema-versioned records to IndexedDB and keeps an in-memory copy for graceful fallback. Reads migrate older record shapes and reject data from unknown future schemas. Cross-run calculations use completed records only and include industrialization, atomic timing, weapon and nuclear-war frequencies, post-atomic survival, interplanetary results, and the full outcome taxonomy. Correlations remain descriptive, are suppressed below four runs, and return no result when variance is insufficient.

An observation has a configured finite horizon. Ongoing records share a seed-independent experiment fingerprint and retain their derived observation seed. Reload recovery creates the same simulation and deterministically replays it to the last archived month. Completion is persisted before automatic handoff derives the next observation seed. Archive writes are serialized to prevent accelerated ticks from racing IndexedDB transactions.

The separate batch experiment boundary runs the same headless `Simulation` with enumerated seeds. It produces full JSON evidence, outcome/frequency summaries, milestone distributions, and carefully worded descriptive associations. It does not use IndexedDB, rendering, or the Historian PRNG.

## Audio boundary

`AudioDirector` consumes a category, inferred era, and optional voice asset ID from the selected scene. Independent ambience and era-music beds crossfade smoothly; optional event one-shots and local Historian voice assets sit above them, with configured bed ducking while narration plays. The local manifest is intentionally empty by default. Missing files or browser playback restrictions never block the simulation or subtitles.

## Built-environment boundary

Buildings visualize simulation state; they are never simulation authority. The simulation knows a settlement has infrastructure, urbanization, industry, and a building count. It does not know what a roof is. Everything architectural is derived in the render layer and may be discarded and rebuilt without affecting history.

```text
Settlement state (buildings, infrastructure, industry, urbanization)
        |
        | eraForSettlement + district zoning + role assignment
        v
BuildingPlacement  (persistent plot: position, footprint, role, founding era)
        |
        | resolveBuildingGrammar(culture profile, era, role, seed)
        v
BuildingGrammar    (massing, roof family, motif, ornament, openings, ...)
        |
        | composeBuilding(grammar, palette, seed, stage)
        v
merged per-surface geometry -> shared, cached, instanced clones
```

**Determinism.** A structure's appearance is a pure function of `(seed, culture style, era, role, variation, construction stage)`. No wall-clock time, no world position, no `Math.random()`. The renderer's PRNG stream is forked per plot and is separate from the simulation stream, so a visual choice cannot consume a simulation random draw.

**Placement contract.** A plot registers one persistent footprint through `PlacementContract` and `PlacementFootprint` at founding, sized for the finished structure *and its ceremonial precinct*, never for the primitive ancestor. Validation samples the center plus two perimeter rings, rejects any dry-building footprint that touches water or crosses the world boundary, and enforces both average and worst sampled slope. Public footprint registration repeats the terrain check, IDs are derived from the persistent entity, and a second registration may only be an exact idempotent match. Composition is uniformly scaled to fit inside the reserved footprint, so upgrading never needs new ground and cannot drift or re-layout. Docks, bridges, ferries, and other crossings must opt into their explicit water-tolerant contract.

**Identity over time.** A plot's role and position are assigned once and never change. Era is the only thing that advances, and it advances per plot rather than per settlement, so a town modernizes unevenly and keeps its history visible. A structure's rendered era is clamped so it can never regress below the era it was founded in.

**Presentation, not state.** Construction stages are presentation-time state owned by `VisualStateResolver` and `TransitionTimeline`. Skipping, accelerating, or never showing a construction sequence changes when a viewer sees a building rise; it cannot change whether the simulation considers it built.

## City legibility layer

The semantic plan is shared with `PeopleSystem`; architectural grammar and geometry remain derived decoration in `GodboxRenderer` and never become simulation authority.

**Era, read visually.** Ring spacing tightens with the founding era (camps sprawl at ×1.5, industrial cores pack at ×0.72), destiny roles are era-weighted (`roleForDistrict`), ground craft advances from a packed-earth ring through swept dirt spokes to paved radials, and the civic plaza accretes a speaker's platform (pre-industrial), formal corner markers (industrial), then an illuminated inlay (advanced). Era dressing adds working props per stage: drying racks, the village well, town-wall fragments, freight yards, panel arrays.

**Night identity.** One shared `glow` surface lights windows, lanterns and plaza inlays after dark via the palette night factor. Distributed settlement lighting replaces the old single point light: a flickering fire for camps, warm lantern posts for villages and towns, taller cool street lamps for industrial and advanced cities. Light color, height, count and flicker are era-derived; a global budget (`SETTLEMENT_LIGHT_BUDGET`) divides point lights across living settlements so forward shading cost stays bounded. Sun color warms toward the horizon for a golden-hour band.

**Life signals.** A single instanced smoke pool animates every plume — hearths over roofs (early through industrial), workshop furnaces, kilns, and factory stacks, whose plumes darken with pollution. Sources are collected per settlement visual and flattened by `refreshSmokeSources`; fade is carried by scale so one transparent material serves all puffs.

**Ceremonial axis and landmarks.** From village era onward a deterministic processional axis (seeded per settlement, independent of draw order) runs outward from the plaza: patterned paving, paired stone lanterns, torii gates whose count and length vary per settlement identity. Settlements whose importance (buildings, institutions, routes) crosses a threshold earn one landmark, sited at the end of the axis with its own registered footprint and a role locked at founding: a grand shrine for old towns, a market hall or gatehouse for pre-industrial ones, a works tower or archive hall for industrial ones, an energy or research spire for advanced ones.

**Specialization, read visually.** `settlement.specialization` plants its evidence at the working edge: field rows for agriculture, log stacks and saw trestles for forestry, spoil heaps and head-frames for mining, a smoking kiln and goods yard for craft, and a caravan rest for exchange or any settlement with three or more active routes.

**Craft details.** Buildings gain contact shadows at ground level, laid roof courses on tile and thatch, relief-backed pattern bands, hung timber doors with stone thresholds, and motif door furniture. Routes grade from dirt track to kerbed cobbles as road infrastructure rises; water crossings carry railings and end posts. Terrain color is dithered per cell and fertile ground carries instanced grass tufts. All of it preserves the shared-geometry, per-surface-material budget: the new work is either merged into existing surface builders, pooled in single instanced meshes, or built once per settlement group.
