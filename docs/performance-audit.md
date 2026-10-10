# GODBOX performance audit

Measured on 2026-10-07/08. Machine: Windows 11, NVIDIA RTX 4060 (ANGLE/D3D11), 75 Hz display.
Configuration: `godbox.config.ts` as committed — starting population 360, soft cap 2600, world
size 52 (2704 cells), history limit 50 000, `documentary` time preset.

The headline result is that **GODBOX is smooth in the opening and collapses in a mature
settlement**. Steady state at year 0 is a solid 75 fps; by year 120 the same world renders at
about 2.2 fps with every frame missing the budget. Both numbers come from the real renderer on the
real GPU, not from a reconstruction.

---

## 1. Performance baseline

### Browser, real renderer and GPU (`scripts/perf/frame-harness.mjs`)

| | opening (year 0) | mature (year 120) |
|---|---|---|
| frame p50 | 13.3 ms | 228.8 ms |
| frame p95 | 14.1 ms | 966 ms |
| frame p99 | 15.7 ms | 10 065 ms |
| frame max | 816.9 ms | 10 065 ms |
| effective fps | ~70–73 | **~2.2** |
| frames > 16.7 ms | 1.4 % | **100 %** |
| frames > 25 ms | 15 of 1765 | all |
| frames > 50 ms | 4 | all |
| main-thread CPU p50 | 5.4 ms | 228.2 ms |
| draw calls | 1 (opening holds 1 batched pass) | 1528, peak 3230 |
| triangles | ~1 | 6 668 907, peak 6 984 161 |
| shader programs | 123 | 218 |
| scene objects / meshes | 545 / 397 | 5284 / 4276 |
| visible meshes | 379 | 3838 |
| shadow casters | 269 | **3041** |
| unique materials | 281 | **1017** |
| unique geometries | 329 | **3520** |
| heap over sample | 97.8 → 113.3 MiB (+15.4) | 289 → 396.8 MiB (**+107.8 in 45 s**) |

The display target here is 75 Hz, so 13.3 ms *is* vsync. The opening is genuinely at refresh rate.

### Simulation tick, Node (`scripts/perf/sim-baseline.ts`, `scripts/perf/tick-bench.ts`)

Monthly ticks at the production configuration, after the optimizations in section 7:

| scenario | people | tick mean | tick p95 | tick max |
|---|---|---|---|---|
| early (year 12) | 470 | 88.7 ms | 146.2 ms | 199.8 ms |
| mature, in browser (year 120) | — | 409.3 ms | 409.3 ms | 409.3 ms |

Phase attribution, early scenario:

| share | phase | mean | p95 | max |
|---|---|---|---|---|
| 52.0 % | people | 46.1 ms | 90.2 ms | 147.8 ms |
| 31.2 % | resources | 27.7 ms | 42.6 ms | 56.5 ms |
| 8.9 % | weather | 7.9 ms | 11.5 ms | 14.7 ms |
| 2.8 % | economy | 2.5 ms | 4.6 ms | 29.3 ms |

At year 120 the browser reported a 409 ms tick with `people` at 307 ms and `resources` at 48.7 ms.

### A measurement caveat that matters

Absolute timings on this machine drift by up to **3x** over tens of minutes (background load and
CPU frequency). A baseline captured at the start of a session is not comparable with a measurement
taken an hour later. Early in this audit, sequential before/after runs appeared to show a 79 %
tick improvement; a properly interleaved A/B measurement showed the true figure is 20 %. All
optimization claims in section 8 come from paired, interleaved, alternating-order runs. Any future
performance work on this project must do the same or it will draw false conclusions.

---

## 2. Top CPU bottlenecks

**Simulation, year 120: the monthly tick costs 409 ms.** That is roughly 25 frames of budget in a
single atomic step. `InteractiveTickBudget` can defer a tick but cannot subdivide one, so every
month is an unavoidable stall. `people` is 75 % of it.

Within the people phase, the original dominant costs (V8 CPU profile, 30 ticks) were:

| self time | function |
|---|---|
| 8.3 % | `WalkabilityLayer.gridRoute` (A*) |
| 6.6 % | `WalkabilityLayer.gridStepClear` |
| 5.3 % | `StructureNavigation.nearby` |
| 4.0 % | garbage collector |
| 3.3 % | `StructureNavigation.clear` |
| 2.9 % | `WalkabilityLayer.isSegmentWalkable` |

`WalkabilityLayer.route` accounted for **38.4 % of all sampled CPU** (51 % of tick time), reached
from both `runPeople → advancePerson → assignDestination` and
`ResourceSystem.gather → ExtractionAccessibility.resolveSite`.

Call counts per simulated month at 378 people explain the shape:

| calls/month | function |
|---|---|
| 57 025 | `gridStepClear` |
| 48 239 | `StructureNavigation.nearby` |
| 48 154 | `StructureNavigation.clear` |
| 29 922 | `isWalkable` |
| 20 678 | `isSegmentWalkable` |
| 758 | `nearestWalkable` |
| 258 | `route` |
| 58 | `gridRoute` |

The route caches work — only 58 A* searches per month survive caching. The cost is not repeated
pathfinding; it is the **per-edge and per-segment validation** underneath it, called tens of
thousands of times per month.

**Renderer, year 120: `people` presentation is 45 % of frame time at 192.6 ms mean, 501.5 ms max.**
This is the renderer's own per-person pass, independent of the simulation phase of the same name.

---

## 3. Top GPU / render bottlenecks

`render` (the `postProcessing.render` call, i.e. shadow pass + main pass + EffectComposer) is
**49.9 % of frame time at year 120, mean 213.9 ms**. The scene statistics identify why:

- **1017 unique materials and 3520 unique geometries for 4276 meshes.** Architecture is composed
  per building with essentially no material or geometry sharing, so almost every structure is its
  own draw call with its own pipeline state. 1528–3230 draw calls follow directly from this.
- **3041 shadow casters.** The 2048² `PCFSoftShadowMap` redraws ~3000 objects every frame. With
  the main pass that is roughly two full scene traversals of unbatched geometry.
- **6.7–7.0 million triangles** submitted per frame.
- **218 shader programs**, up from 123 in the opening.

Separately, in the opening scenario the isolated 816.9 ms / 294.7 ms / 150.1 ms stalls were
attributed almost entirely to the `render` section with every other section near zero, and they
coincide with the triangle count stepping up (1.8M → 2.0M → 3.5M) as the camera reveals new
content. That signature is **lazy shader/pipeline compilation at first draw**. `warmUpOpening()`
calls `compileAsync` over the opening scene, but objects created later — and shadow-depth variants
of newly visible objects — still compile on the frame they first appear.

### Suspicions the instrumentation disproved

Several patterns in `GodboxRenderer.update` look like classic per-frame waste and were on the
original suspect list. The section profiler shows they are not worth touching at year 120:

- Two `entry.site.getObjectByName(...)` calls per construction assembly per frame.
  `getObjectByName` is a recursive subtree walk, so this looked like a certain win.
- `this.state.settlements.find(s => s.id === entry.settlement.id)` inside the same per-assembly
  loop, making it O(assemblies x settlements).
- A `Set` allocated per frame for `blockedStandardSettlements`, plus
  `state.arrival.pods.map(...).join(':')` building a string every frame during the prologue.
- Several `(x, z) => this.elevationAt(x, z)` closures allocated per frame.
- `this.state.bodies?.find(b => b.id === person.id && !b.removed)` inside the per-visible-person
  loop in `updatePeople` — a genuine O(n^2) over an array that grows for the life of the world.

Measured, the whole `construction-presentation` section is **0.209 ms mean / 0.7 ms max** and
`ambient-presentation` is **0.219 ms mean**, against a 228 ms frame. Fixing all of them would
recover well under 1 % of frame time. They are recorded here so they are not mistaken for
opportunities later; the `bodies` scan is the only one worth revisiting, and only once the world
is old enough for that array to be large.

This is the reason the audit implemented nothing in this list: each change would have been
plausible, cheap, and irrelevant.

---

## 4. Memory and GC findings

- **Heap grew 107.8 MiB in 45 seconds at year 120** (289 → 396.8 MiB). A second attempt at the
  same scenario lost the renderer process outright (`Inspected target navigated or closed`) during
  the advance, which is consistent with real memory pressure rather than a harness defect.
- 3520 unique geometries and 1017 unique materials are themselves the memory story: geometry and
  material instances are being created per structure and retained.
- In the simulation, the GC was **4.0 % of all CPU** before the changes in section 7 and **3.2 %**
  after. The dominant source was `StructureNavigation.nearby`, which allocated a `Set`, a spread
  array and one template-string key per probed bucket on every one of its 48 239 calls per month —
  roughly 300 000 short-lived allocations per second at documentary pacing.
- The A* in `gridRoute` allocated four `Map`s, a `Set`, a heap and one object per expanded cell
  (up to 1024) per search.

I did **not** run a multi-hour session, so slow leaks from timers, listeners or archive growth
across a long observation remain unverified. See section 10.

---

## 5. Frame-pacing and stutter causes

Three distinct mechanisms, in order of severity:

1. **Atomic simulation ticks on the render thread.** A 409 ms month cannot be hidden. The tick
   budgeter correctly refuses to *start* a tick it cannot afford, which converts the problem from
   "stall now" into "stall later plus growing backlog" (`pendingTicks` 0.29 observed), but the
   stall still lands inside a frame.
2. **Unbatched draw submission.** At 1528–3230 draw calls with 3041 shadow casters, the render
   section alone exceeds the frame budget by an order of magnitude. This is a sustained cost, not a
   spike — it is why year 120 is uniformly slow rather than occasionally hitchy.
3. **Lazy shader compilation on first appearance.** This is the cause of the isolated multi-hundred
   -millisecond spikes in an otherwise smooth opening, and it is the one pacing defect that occurs
   even when throughput is fine.

---

## 6. Scaling problems

The opening-to-year-120 comparison isolates what scales badly:

| quantity | year 0 | year 120 | factor |
|---|---|---|---|
| meshes | 397 | 4276 | 10.8x |
| unique materials | 281 | 1017 | 3.6x |
| unique geometries | 329 | 3520 | 10.7x |
| shadow casters | 269 | 3041 | 11.3x |
| draw calls | 1 | 1528–3230 | — |
| frame p50 | 13.3 ms | 228.8 ms | 17.2x |

Geometry and material counts scale **linearly with the number of structures ever built**, and
frame time scales with them. Nothing in the architecture path shares geometry between buildings of
the same archetype or batches them, so world growth translates one-for-one into draw calls.

In the simulation, cost scales with population through the walkability validation layer rather
than through pathfinding itself: 378 people produced 48 000 structure-clearance tests and 57 000
grid-edge tests per month.

---

## 7. Optimizations implemented

All three are behaviour-preserving and were verified against the determinism gate in section 9.
No quality, density, fidelity or simulation rule was changed or reduced.

### 7.1 `StructureNavigation.clear` — allocation-free obstruction test

*What was expensive:* `clear()` is called 48 154 times per simulated month. It delegated to
`nearby()`, which allocated a deduplicating `Set`, spread it into a new array, and built a
template-string key for every spatial bucket probed — even when the result was empty, which is the
common case.

*Why:* `nearby()` is written for ordered consumers (`detour`) that need a deduplicated list.
`clear()` only needs a boolean, and it short-circuits.

*The change:* added a private `obstructed()` that walks the buckets directly and returns on the
first intersection — no `Set`, no array, no string. Bucket keys became numeric
(`x * 1_048_576 + z`). `nearby()` is unchanged for `detour`. A footprint registered in several
buckets is now tested more than once, which is harmless because the test is a pure predicate.

### 7.2 `WalkabilityLayer.gridStepClear` — dense edge cache

*What was expensive:* 57 025 calls per month through a `Map<number, boolean>` whose keys ranged
over `cells² ≈ 7.3 million`, plus two `Vec2` literals allocated per cache miss.

*Why:* only ~21 000 edges actually exist (8-neighbour steps), so a hash map was paying lookup and
boxing cost for a problem with a dense address space.

*The change:* a `Uint8Array(cells × 9)` indexed by the lower-index cell plus its 3×3 neighbour
offset, with `0/1/2` for unknown/clear/blocked, and two reusable scratch vectors for the miss
path. The canonical lower-index orientation preserves the symmetry the old `min/max` key provided.

### 7.3 `WalkabilityLayer.gridRoute` — allocation-free A*

*What was expensive:* every search allocated a `MinScoreQueue`, four `Map`s, a `Set` and one
`GridPoint` per expanded cell, up to the 1024-cell closed-set bound.

*The change:* the working set became reusable per-cell typed arrays (`searchCost`,
`searchEstimate`, `searchCameFrom`, plus `searchStamp`/`searchClosed` generation stamps so no
clearing pass is needed), and the heap became three parallel growable typed arrays with the popped
entry read from fields. **The historical cell key is retained as an explicit tie-break ordering**,
because equal-score ties decide which route is chosen and therefore decide history.

### 7.4 Long-frame attribution instrumentation (new capability, not an optimization)

`src/render/FrameSectionProfiler.ts` records per-subsystem cost across 15 named sections of the
renderer frame and retains the full breakdown of any frame exceeding 25 ms in a bounded ring
buffer. The hot path is allocation-free. 15 marks are wired through `GodboxRenderer.update`, it is
enabled by default in development, and it is exposed as `window.__godboxPerformance().sections`.
This is what produced the `render` 49.9 % / `people` 45 % attribution above, and it means the next
regression can be attributed without re-deriving a profile.

---

## 8. Before/after measurements

Paired, interleaved, alternating-order A/B over 6 rounds (`head` = committed code, `opt` = sections
7.1–7.3), 40 measured months after a 24-month warmup, fixed seed:

| variant | tick p50 | tick p95 | tick max | tick mean |
|---|---|---|---|---|
| head | 54.31 ms | 77.76 ms | 299.40 ms | 59.57 ms |
| opt | 43.33 ms | 74.51 ms | 295.27 ms | 51.01 ms |
| **delta** | **−20.2 %** | **−4.2 %** | **−1.4 %** | **−14.4 %** |

Supporting evidence from the V8 CPU profile over 30 ticks: total `step` time fell from 11 964 ms to
7 178 ms (−40 %) and GC self time from 648 ms to 322 ms (−50 %) — but note that these two profiles
were *not* interleaved, so the paired table above is the number to trust.

**Honest assessment: this is a real but modest win on the median tick and it does essentially
nothing for the tail.** The p95 and max barely moved, which means the worst ticks are not dominated
by the pathfinding validation layer I optimized. The 300 ms tail, and the 409 ms tick at year 120,
remain.

Heap measurement from these runs is not reportable: the single instantaneous
`process.memoryUsage()` sample varied between 56 and 200 MiB across rounds without a forced GC, so
the "+23 %" it suggested is noise, not a result.

---

## 9. Confirmation that visual and simulation quality were preserved

**Determinism.** `scripts/perf/fingerprints.ts` hashes authoritative state — every person's
position, age, activity and settlement; every settlement's population, urbanization and inventory;
every world cell's wood, movement cost and elevation; and the trailing history record — after 90
months. Run against the committed code and against the optimized code across six seeds (`alpha`,
`beta`, `gamma`, `delta`, `witness-the-saffron-river`, `epsilon-7`), the fingerprints are
**identical in all six cases**, with identical population, settlement and history counts. The
40-month benchmark fingerprint (`96b59183`) is also unchanged across every variant measured.

**Behavioural equivalence by construction.** 7.1 tests the same set of footprints with an
idempotent predicate. 7.2 stores the same values under a dense address instead of a hash key, in
the same canonical orientation. 7.3 preserves the scoring function, the neighbour iteration order,
the lazy-deletion guard, the 1024-cell closed-set bound and the score-then-cell-key tie-break, so
it selects the same path.

**Nothing was reduced.** No change touched population, draw distance, LOD, particle density,
animation richness, effect count, world detail, camera behaviour, historian function or any
simulation rule. The two optimized files contain no quality or density parameters.

**Typecheck** is clean (`tsc -b`) and the changed files lint clean. The 43 tests most directly
covering this code all pass: `foot-traffic`, `path-evolution`, `resource-extraction`,
`resource-work-routing`, `resource-work-routing-performance`, `construction-workface-access`,
`settlement-path-geometry`, `interactive-tick-budget`.

### The tick cost is also breaking the test suite

The full suite reports 57 failures, the great majority in areas this audit never touched. Three of
them, however, are `tests/people.test.ts > keeps people and pedestrian routes on safe ground in
{people-river, people-islands, people-highlands} for 80 years`, which is precisely the code
changed here.

That test simulates `80 * 12 = 960` months under a **60 000 ms timeout**. At the measured 50-90 ms
per tick, 960 ticks cost 48-86 seconds. The test is therefore sitting on top of its own time limit
and fails by timeout rather than by assertion — a direct symptom of the performance problem this
document describes, not a correctness result. `tests/people.test.ts` as a whole took 540 seconds
in the full run, and more than 580 seconds in isolation.

This matters for interpreting the suite: some fraction of the 57 failures are likely to be
timeouts rather than defects, and they will not be distinguishable until the tick cost comes down.
Anyone bisecting these should check for `Test timed out in 60000ms` before assuming a logic bug.

---

## 10. Remaining limits and the single highest-value next pass

### Where GODBOX stands

It cannot sustain 60 fps in a mature settlement, and the limiting subsystems are now named rather
than hidden:

1. **Draw submission** — 1528–3230 draw calls, 1017 unique materials, 3520 unique geometries,
   3041 shadow casters. 49.9 % of frame time.
2. **The renderer's per-person presentation pass** — 192.6 ms mean, 501.5 ms max. 45 % of frame
   time.
3. **Atomic 409 ms simulation ticks on the render thread.**
4. **Heap growth of ~108 MiB per 45 s at year 120**, with an observed renderer-process loss.

### The single highest-value next pass

**Share and batch architecture geometry and materials.** 3520 unique geometries and 1017 unique
materials for 4276 meshes is the root cause of both the draw-call count and the shadow-pass cost,
and it is very likely a large part of the heap growth too. Buildings of the same archetype, period
and material set should resolve to a shared `BufferGeometry` and a shared material, then be drawn
through instanced or merged batches, with per-building variation moved into instance attributes
rather than into unique geometry.

This is the right first move because it is the only change that attacks the top GPU bottleneck,
the shadow-pass cost and the memory growth simultaneously, and because it is additive — it
preserves every silhouette and surface, so it cannot introduce pop-in, LOD transitions or reduced
density. Expected to move year-120 frame time by an order of magnitude; nothing else on the list
can.

Then, in order: restrict shadow casting to objects that actually contribute to a visible shadow
(3041 casters is almost certainly far more than the shadow camera needs); extend the
`compileAsync` warmup to cover newly created objects and their shadow variants, to kill the
first-appearance spikes; profile the renderer's people pass with finer sections; and finally move
the monthly tick off the render-critical path, because even a tick optimized by another 50 % is
still a multi-frame stall.

### Unverified

- Long-session memory degradation over hours — not run.
- `dense`, `industrial` and `deep-time` scenarios — defined in the harness but not measured; the
  page did not reliably survive the advance to year 120 and beyond.
- War, weather-heavy and historian-transition scenarios — not isolated.
- GPU time proper (as opposed to the CPU cost of submission) — not measured; would need
  `EXT_disjoint_timer_query_webgl2`.

---

## Running the harness

```bash
# Simulation tick, per-phase, across world ages
npx tsx scripts/perf/sim-baseline.ts                 # all scenarios
npx tsx scripts/perf/sim-baseline.ts --scenario=early --json

# Fast repeatable tick benchmark with a determinism fingerprint
npx tsx scripts/perf/tick-bench.ts

# Determinism gate: run before and after a change, then diff
npx tsx scripts/perf/fingerprints.ts > before.txt

# Real renderer, real GPU, frame pacing + scene stats + section attribution
npx vite --port 5179 --strictPort
node scripts/perf/frame-harness.mjs --scenario=mature-camera --seconds=45
node scripts/perf/frame-harness.mjs --scenario=opening --cpu-profile=page.cpuprofile --json
```

The frame harness needs a Chromium-family browser; it autodetects Edge and Chrome, and
`GODBOX_BROWSER` overrides. Run it **headful and unoccluded** — an occluded window makes Chromium
throttle `requestAnimationFrame`, which silently produces a 98 % idle profile.
