# Functional-identity / silhouette audit

Branch: `refactor/buildingspec-authority-20261003`. A content and grammar pass over the existing
`BuildingSpec` archetype gallery — no new structure families, no change to `BuildingSpec`'s
resolver contract, no renderer branches. Scope and rationale are in
`.claude/plans` (the approved plan for this pass); this document records what actually changed and
what the comparison looks like archetype by archetype.

## What changed

| Change | File(s) | Why |
| --- | --- | --- |
| `ArchetypeStage.doorBay` | `BuildingArchetype.ts`, `BuildingSpec.ts` | A barn/byre/stable/pen door is now ~2.2x wider with one opening per bay, instead of resolving to the same width as a house window of the same family and differing only in count. |
| `windshaft` equipment rebuilt as a real 4-arm sail cross | `StructureGeometry.ts` | Was a single dead stub beam attached to no archetype. Now a hub-and-arm lattice (same radial technique as `waterwheel`), entirely from `addBeam` so it stays correctly oriented without leaning on box rotation. |
| New dedicated composition kind `'enclosure'`, `composeAnimalPen` | `DedicatedStructures.ts` | animal-pen now bypasses the shared box+roof shell entirely: a real 4-sided perimeter fence with a gate gap, the structure's own equipment (`pen-gate`, `water-trough`, `manger`, `bedding`) reused verbatim, and an optional subordinate lean-to shelter. |
| `animal-pen` status `planned` → `active`; `farmBuilding()` rebalanced to a 4-way split | `BuildingArchetype.ts`, `ArchetypeRouting.ts` | It had no routing rule at all before this — "planned" meant literally unreachable. It is also the only one of the four livestock buildings whose lineage starts in the neolithic. |
| New archetype `windmill` (post mill / tower mill stages) | `BuildingArchetype.ts`, `ArchetypeRouting.ts` | No circular/tapering tower or rotating-part geometry exists anywhere in the renderer, so a true rotating-sail windmill was out of scope. A narrow-tall silhouette, conical cap and sail-cross equipment give it a genuinely different read from a watermill using only existing primitives — the same trick the silo already uses for bulk-storage identity. Routed via a seeded, waterfront-gated split in the `energy` case, mirroring `farmBuilding`'s pattern. |
| Industrial mill equipment: dropped `machine-tool`, pulled `silo-chute` forward from the modern stage | `BuildingArchetype.ts` | "Industrial mill looks like a dressed workshop" was a real finding — both shared the lathe/machine-tool read. `silo-chute`'s existing vertical-bin-and-chute geometry gives it a grain-elevator/headhouse silhouette instead. |
| `byre` and `stable` each gained an explicit `earlyModern` stage (`low-gable`, `hipped`) | `BuildingArchetype.ts` | Both previously had no `earlyModern` entry and inherited their `medieval` stage, which is `gable` for both — identical to barn's own `earlyModern` `gable` roof. This is also the period a typical rich/capable settlement actually resolves to (see below), so it mattered more than the `medieval`-only "High-roof threshing barn" signature. |
| Civic-hall `medieval` roof: `steep-gable` → `hipped` | `BuildingArchetype.ts` | Collided with the shrine's own `medieval` `steep-gable` "Stone church" at similar scale. |

## The period-resolution finding

A settlement with full industrial-era capabilities (`mechanical-power`, `precision-tools`, etc.)
resolves to at least `earlyModern` almost regardless of era string or development level, because
observed capability evidence only ever raises the period floor. In practice this means barn,
byre and stable collide far more often at `earlyModern` than at the `medieval` stage most of the
hand-written archetype comments were written around ("the stage that most needs its own
silhouette"). Fixing the collision at `earlyModern` — not just relying on the existing `medieval`
signature stages — was the change that actually mattered for a typical production settlement.

## Comparison: before / after

Measured by `tests/architecture-geometry.test.ts`'s "Previously-confusable archetypes stay apart"
suite — for each pair, how many of {footprint aspect bucket (width vs. overall height, not width
vs. depth), roof archetype, crown feature, dedicated-vs-generic geometry, openness bucket,
equipment family} differ, never counting size or material alone.

| Pair | Before | After | Cue(s) now carrying it |
| --- | --- | --- | --- |
| barn / byre | equipment only (1 axis) | roof + equipment (2 axes) | byre's new `low-gable` earlyModern roof vs. barn's `gable` |
| byre / stable | equipment only (1 axis) | roof + equipment (2 axes) | stable's new `hipped` earlyModern roof vs. byre's `low-gable` |
| barn / stable | equipment only (1 axis) | roof + equipment (2 axes) | `gable` vs. `hipped` |
| mill / windmill | did not exist | aspect + roof + equipment (3 axes) | narrow-tall tower vs. wide-low range, `conical` vs. `gable`/`steep-gable`, sail cross vs. waterwheel |
| mill / workshop (industrial) | roof + equipment, but equipment overlapped on `machine-tool`/`line-shaft` | roof + a non-overlapping equipment family (grain elevator vs. machine shop) | `silo-chute` instead of `machine-tool` |
| civic-hall / shrine (classical) | openness + crown only, both `pediment` | unchanged — recorded as acceptable | shrine's always-`spire` crown vs. civic-hall's `lantern-cupola`/`none`; peristyle (0.52 openness, all-round) vs. basilica frontage (0.3, front-only) |
| silo / granary | aspect + roof already distinct | unchanged | narrow-tall bulk storage vs. granary's squarer, lower proportions |
| animal-pen / barn | equipment + size only | geometry (dedicated vs. generic) + aspect + openness + equipment (4 axes) | animal-pen no longer composes as a box with a roof at all |

## Remaining weak class

**Civic-hall vs. shrine at the `classical` period** stays the one pair this pass did not change
the roof topology for — both resolve `pediment`. It is still distinguishable (crown feature,
colonnade extent/openness), but if a reviewer judges that marginal, the next move would be giving
civic-hall's classical "Basilica" stage a different roof archetype (e.g. `hipped`) rather than
sharing `pediment` with the peristyle temple. Not done here because civic-hall's classical stage is
arguably correct as pedimented civic architecture (real basilicas were pedimented), and changing it
risked losing a historically accurate form for a marginal gain; flagged for a human call instead of
decided unilaterally.

**Silo and workshop were audited and left unchanged.** Silo was already distinguished from granary
by aspect ratio and roof; workshop's existing seven-stage lineage already satisfies "compact craft
building early, larger-span machine shop later." Both are covered by the geometry/confusable-pair
tests so a future regression would be caught, but no new content was written for either.

## Important caveat

This audit — and the tests behind it — verify *structural* distinctness: the data the geometry is
built from (proportions, roof archetype, crown feature, openness, equipment family, dedicated vs.
generic composition path). They do not verify the final rendered image. The task's own acceptance
test ("hide every label, name the building") requires a human looking at the live gallery
(`src/dev/architectureBrowser.ts`) or a screenshot pass — neither of which this pass performed. The
tests are the closest automatable proxy, not a substitute for that look.

## Validation

- Focused architecture suite: `tests/architecture-spec.test.ts`, `tests/architecture-geometry.test.ts`,
  `tests/architecture-integration.test.ts`, `tests/architecture-routing.test.ts`,
  `tests/buildingspec-authority.test.ts`, `tests/architecture-browser-qa.test.ts`,
  `tests/architecture.test.ts`, `tests/architecture-materials.test.ts`,
  `tests/production-subsystem-buildings.test.ts` — **9 files, 167 tests, all passing.**
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run build` — succeeds (pre-existing large-chunk advisory only, unrelated to this pass).
- A broader full-repo test run was attempted as extra due diligence beyond what this task asked
  for; it exceeded a 30-minute background budget with no usable partial output and was not
  re-attempted, since the task's own validation scope ("run focused architecture tests, typecheck,
  lint and build") was already satisfied above. The changes here touch only
  `src/render/architecture/*`, `src/render/assets/BuildingComposer.ts`'s existing generic dedicated-
  composition dispatch (no edit needed there), and the architecture test files, so the blast radius
  outside the focused suite is expected to be small, but this was not independently re-verified
  against the full suite.
- No commit, no merge — changes are in the working tree only.
