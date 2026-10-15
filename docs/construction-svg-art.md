# Construction SVG art: tiles, composition and evidence

## What the artwork now is

Every production building gets one 2048×1024 atlas, rasterised from SVG into matched albedo, relief and roughness layers. These upload as two textures: albedo, and a packed data texture holding roughness (R), composition mask (G), opening contents (B) and relief (A, stored as 0.5–1). The atlas has two parts.

**Seamless material tiles (right half).** Each material a building actually emits gets one square tile, drawn at true physical scale. One canonical unit is about six metres, so a brick course is 0.0125 units and a rubble stone 0.04–0.09 units. The shader repeats the tile over the real geometry using physical plane coordinates: `aFacadeTile` holds u and v along the face plus height above ground. Roof slopes course along the eaves, and timber turns its tile so the grain follows each member's long axis (read from `aSurfaceDetail`). The wall and roof covering get 512 px cells. Other materials, the culture-ornament tile and the canvas/cloth tile share the lower half. Each tile is seeded per building and per material, so neighbours share their era's bond, coursing and craft without laying the same stones. Tiles wrap by drawing a ground pass and a unit pass into all nine neighbouring copies, so units cross the repeat edge cleanly.

Programs (`SurfaceArtPrograms.ts`):

| Group | Programs |
|---|---|
| Brick | Stretcher, English, Flemish and stack bonds; kiln and firing variation; clinker headers; chipped arrises; recessed aged pointing; industrial soot |
| Mud brick, adobe | Thick mud joints, straw temper, rain-eroded hollows, surviving wash, exposed coursing |
| Rubble, fieldstone | Interlocking angular stones on wandering periodic beds; galleted lifts; pinning spalls; deep lime; dry cyclopean voids |
| Coursed stone, ashlar | Era tooling (boasted, pitch-faced, sawn); drafted margins; claw marks; sandstone bedding; limestone fossils; granite speckle; rare mason's marks |
| Roofs | Riven slate with ragged butts and replacements; split shingles silvering with wear; S-section pantiles; combed thatch courses with butt ends; moss |
| Timber | Adze-hewn faces with checks, pegs and knots; sawn and planed boards (lapped or flush) with kerf marks and nail lines; log courses with bark and chinking |
| Finishes | Lime render and stucco (float undulation, limewash clouds, crazing, spalls exposing substrate); wattle and daub (straw, cracks along the hurdle, exposed wattle); board- or panel-formed concrete (tie cones, bloom) |
| Metal | Corrugated sheet with laps, fixings and run-off; standing seam with oil-canning and verdigris; rolled plate (riveted, bolted or welded by era); cast panels; wrought bar; aluminium cassettes; bituminous membrane |
| Glass | Curtain wall: storey-aligned mullions, transoms, opaque spandrels, varied units; the shader makes the framing opaque |
| Ornament | The culture pattern (fret, scroll, zigzag, lozenge chain, interlace), carved and painted, tinted live by the culture accent |
| Fabric | Canvas and cloth (sails, awnings): weave, sewn cloths, patches, weather staining |

**Elevation composition (left half).** Opening-aligned dressings, surrounds, arches, hood moulds, quoins, string courses, doors, glazing and weathering (sill run-off, rising damp, eaves grime, lichen, soot). A coverage mask in the surface layer's green channel lets the wall's own tile show wherever nothing is composed. Weathering painted there multiplies the tile. Opening contents (glass, doors, fittings) are recorded in the blue channel and shown only on glazing meshes, so wall fabric never displays a window that the geometry does not have. Painted stone dressings are drawn only on stone walls. Timber frames are real geometry and carry their own grain-aligned tile.

**Shader.** The shader samples tiles with `textureGrad` from continuous coordinates, so there are no mip seams, and fades each tile to its own mean once more than about 20 texels fall in one pixel. Continuous finishes (plaster, daub, adobe) blend two offset samples, so a distinctive feature cannot repeat. The shader also adds what a tile cannot carry: low-frequency tonal and hue drift, vertical run-off streaks, splash and rising damp near the ground, and moss on up-facing surfaces. Heights are converted to physical units for normal perturbation and cavity occlusion. The production colour, culture tint and baked occlusion still govern the result: the art is multiplied by `diffuse / material reference`.

**Production fixes found in the running game.**
- `WeatherRenderer.bindScene` replaced the compile hook and cache key of every non-foliage `weatherSurface` material. Building materials bound by weather therefore compiled as plain standard materials, losing both the procedural surface detail and the SVG artwork: game buildings rendered flat even though the architecture viewer looked right. It now chains the previous hook and key for every surface; a regression test covers this.
- Geometry that shares a decorated material without tile coordinates (deterioration debris) used to sample one constant texel. Tile coordinates now carry `w = 0`, and missing attributes (WebGL default `w = 1`) keep the production shading.

**Budget.** Atlas resolution follows screen demand: an atlas is sized so its finest tile maps about one texel to one screen pixel at the nearest visible clone. The power-of-two size is capped by `facadeResolution` and the 96 MiB estimate. New buildings start at 256 until a camera sees them.

## Evidence

Run the dev server with `npm run dev -- --port 5183 --strictPort`, then:

```powershell
node scripts/perf/svg-art-review.mjs output/svg-art-review/x house-medieval-timber,factory-industrial-brick --views overview,face,eye,detail,oblique [--light raking|overcast|night] [--seed s]
node scripts/perf/svg-art-review.mjs output/svg-art-review/x --street medieval:house+barn+granary --count 16 --bench
scripts/perf/svg-tile-shot.sh output/svg-art-review/tiles.png granary medieval stone   # 2×2 tile contact sheet
npx tsx scripts/perf/svg-art-coverage.ts 8                                           # painted triangle share
npx tsx scripts/perf/svg-art-size.ts                                                 # SVG size and generation time
node scripts/perf/svg-art-game.mjs output/svg-art-review/game                         # inside the running game
```

Every sheet is SVG-off | SVG-on with identical geometry, lights and camera. `output/svg-art-review/index.html` collects the matched renders:

- the representative matrix (all 23 archetypes × earliest, middle and latest valid period, 74 cases);
- raking, overcast and moonlight variants;
- close-range machinery;
- curtain walls;
- three seeds of one house;
- settlement streets;
- in-game captures;
- the pre-pass baseline.

Measured on Edge/ANGLE/D3D11 with an RTX 4060:

| Measure | Result |
|---|---|
| Coverage | 93.9% of production triangles carry artwork across 151 sampled evidence cases, up from 70% when ornament and fabric were excluded. Remaining: contact shadows 4.2%, site ground 1.6%, glows, water and forge, all intentional |
| Draw calls and topology | Unchanged by the toggle: 105 calls / 43,244 triangles for 16 buildings; 237 / 114,580 for 64 |
| Frame time | Warm medians 0.2–0.6 ms either way; p95 ≤ 2.3 ms (SVG-off) and ≤ 1.2 ms (SVG-on) |
| Atlas memory | 6.9 MiB estimated for the 16-building street and 5.4 MiB for 64 at settlement distance; 19–27 uploaded textures. One full-resolution atlas is now about 22 MiB, so three near-camera buildings get 1024 inside the 96 MiB budget (previously one) |
| Cold rasterisation | ~330 ms median per building, 2.2–2.3 s worst case, two concurrent jobs. The previous 64-variant run needed 70 s for raster readiness |
| In-game (seed `svg-art-game`, year 50, `svg-art-game.mjs`) | 55 atlases ready, 0 failed, 0 budget fallbacks, 89 MiB estimated with the camera inside the settlement. Off/on frames are captured with the game loop frozen. Timber planks, knots and coursed foundations show on real under-construction houses |
| SVG size | 11–43 ms to generate; up to ~0.9 MB per layer for a large civic hall |
| Tests | `npm test` passes 2,157; 11 simulation tests (arms demand, construction runtime, founding, society, stalled shelter, opening progression) fail identically on the starting commit `a4cb6a94` |
| Build | TypeScript, production build and changed-file lint pass |

## What visibly improved

- **Scale.** Brick was twice life size, and every material panel was stretched over a whole building. Every material now repeats at true scale and full density on every face, roof and machine part. SVG-off brick and corrugated metal show heavy moiré; SVG-on reads as coursed brickwork and clean cladding.
- **Masonry.** Rubble, coursed stone and ashlar have individually shaped, tooled and weathered units with recessed joints that respond to raking light. Stone buildings carry dressed surrounds and quoins over the field.
- **Timber and roofs.** Grain follows posts, braces and boards. Shingles, slate, pantiles and thatch have lapped courses and wear.
- **Materials and colour.** `clay-tile` was defined as slate blue-grey, so every tiled roof read as slate. It is now fired clay red.
- **Contemporary glass and culture.** Contemporary glass towers read as unitised curtain walls with storey spandrels. Culture ornament (21% of triangles, previously flat) shows the civilization's own carved pattern.
- **Individuality and history.** Seeds change stone layout, palette, repairs, putlog holes and marks within the era vocabulary. Age drives silvering, lichen, moss, spalls, crazing and run-off.

## Architectural fidelity pass (2026-10-15)

### Distance tiers are the building, not a stand-in

`src/render/assets/DerivedLod.ts` replaces the massing-box LODs. The old tiers were hand-built
stand-ins: a beige plaster box with a slate pyramid for a red-brick factory, and for functional
buildings an extruded section whose winding showed the inside of the walls. Each tier is now cut
from the building's own composition:

1. The building is composed a second time with construction sectioning off (`composeBuilding(…, sectioned = false)`).
   Faces come out whole rather than cut into build steps, and wall units abut instead of leaving 1.5 mm build joints.
2. Solids narrower than the tier's feature size are dropped: pegs, latches, glazing bars, small fittings.
   The feature size is about 1.5 px at the switching distance. Long members (posts, rails, braces, eaves boards)
   survive at a quarter of that width, because they carry a timber frame's or a gallery's identity.
3. Every plane is re-triangulated from its outline. Faces are welded, interior edges cancel, T-junctions are split,
   and holes are kept, using only original boundary vertices, so tile coordinates, facade UVs and baked occlusion
   stay exact. A plane whose rebuilt area differs by more than 1%, or with any triangle outside its outline,
   keeps its original triangles.
4. Pieces sharing a decorated material are merged, so a tier never issues more draw calls than full detail.
   Identical corners are welded.

| Tier | Distance (world units) | Feature size | Keeps |
|---|---|---|---|
| Full detail | 0+ | all | everything |
| Street | 20+ | 0.016 | walls with real openings and reveals, frames, shutters, roofs, chimneys, porches |
| Settlement | 42+ | 0.04 | the same minus small joinery |
| Skyline (new) | 96+ | 0.07 | closed openings, no undersides, frames and chimneys |

All tiers share the full-detail SVG-decorated materials and atlas (no extra textures or programs), so a tier swap
changes only sub-pixel content: no colour jump, no popping roof. Hysteresis is 8% of each switching distance.
`FacadeTextureCache.inherit` gives derived meshes, and scene clones of them, the same SVG on/off binding.
Mills and other machine buildings keep full geometry at range, as before.

### Structure

- **Masonry bridges** (`composeBridge`). The voussoirs were rotated about the vertical axis, so the "arch ring" was a
  fan of boxes hidden under the deck; it read as dark domes. Piers took only half the deck width, and members were sized
  from a wall thickness that was a fifth of the span. Arches are now near-semicircular segmental vaults with a barrel
  soffit, spandrel walls carried to the deck, and a voussoir ring proud of both elevations with a keystone. Piers stop at
  the springing, with pointed cutwaters and weathered offsets. A projecting string course runs at deck level, and the
  parapet is about 0.8 m with a coping course.
- **Industrial and modern window bands.** The culture pattern band was drawn as gold bars on a black `shadow` strip.
  It is now a moulded masonry frieze: a projecting course between a drip fillet and a bed fillet, in the building's
  stone trim, with the pattern carved proud of it.

### Material repetition

Rubble is now brought to a level bed at every lift, as real rubble walling is. Rubble, coursed stone and ashlar
tiles therefore start every repeat on a straight bed joint, and the facade shader (`gbTileLift`, cache key
`godbox-facade-v10`) slides each lift of tiles sideways by its own hashed amount. Gradients come from the unshifted
coordinate, so there is no mip seam. Long walls no longer show the same marked stones recurring along a course.

### Measurements

Edge/ANGLE/D3D11, RTX 4060, 1100×800 viewport unless noted.

| Measure | Before | After |
|---|---|---|
| Mean tier triangles, 233 matrix cases (full / street / settlement / skyline) | 6,813 / ~200–1,200 boxes / ~26–58 | 7,024 / 3,924 / 2,564 / 1,873 |
| Mean meshes per tier | 6.5 / – / 1–3 | 6.6 / 6.6 / 6.4 / 5.7 |
| LOD build time per unique asset (Node, `scripts/perf/lod-profile.ts`) | not measured (boxes) | ~83 ms, on a ~150 ms asset |
| Street of 24 industrial buildings at settlement range: draw calls / triangles, every building at full detail vs automatic tiers | old tiers: 1–3 calls and 26–418 triangles per building, but beige boxes and inside-out sections | 202 / 283,800 vs 170 / 78,634 (−72% triangles); median 1.2 → 1.0 ms, p95 2.9 → 2.5 ms |
| Street of 24 medieval buildings, same | – | 226 / 135,134 vs 225 / 49,740 (−63%); median 0.9 ms either way, p95 4.4 → 3.5 ms |
| Single-building tiers, calls / triangles (medieval house) | 13/11,530 · 9/418 · 7/58 | 13/11,530 · 13/5,906 · 13/4,226 · 13/3,056 |
| Atlas memory and textures | unchanged: tiers add no textures (51 textures, 2.2 MB of atlases for the 24-building street at range) | same |
| In game (seed `svg-art-game`, year 50, 26 completed buildings, `scripts/perf/lod-game.mjs`): median / p95 whole-frame ms, every building at full detail vs automatic tiers | – | street (6 u) 6.0/8.5 vs 5.3/7.7 · neighbourhood (14 u) 13.1/19.5 vs 7.0/10.2 · settlement (30 u) 8.2/11.3 vs 7.5/9.4 · establishing (60 u) 10.2/17.6 vs 7.1/8.9 · world (120 u) 12.6/22.6 vs 9.7/11.6 |
| In-game tier mix (full / street / settlement / skyline) | – | street view 15/3/8/0 · neighbourhood 10/8/8/0 · settlement 0/18/8/0 · establishing 0/0/18/8 · world 0/0/0/26 |
| Shader compatibility | – | facade program `v10` compiles in game and viewer; 0 console errors, 0 raster failures, 0 budget fallbacks |

In-game frame times are headless and include the whole frame (terrain, foliage, post-processing), so they are noisy.
The game's `renderer.info` only reports the final post-process pass, so in-game triangle counts are not quoted.
The simulation is untouched: every change is presentation-only, so determinism is unaffected.

Evidence: `node scripts/perf/lod-review.mjs output/svg-art-review/lod-after <cases> --views near,settlement --street period:a+b --count 24`
(tier sheets and benchmarks), `node scripts/perf/lod-game.mjs output/svg-art-review/lod-game --months 600 --settle 120`
(in-game), `npx tsx scripts/perf/lod-profile.ts 4` (tier cost across the matrix), `npx tsx scripts/perf/lod-flagships.ts`,
and `node scripts/perf/lod-gallery.mjs` to add them to `output/svg-art-review/index.html`.

## Remaining weaknesses

1. **Draw calls at range.** Distance tiers share full detail's materials, so a distant building still costs about 6 draw calls. The old box LOD cost 1–3. Triangles fall by about 45% (street), 64% (settlement) and 73% (skyline). Further draw-call savings need a per-vertex tile rectangle, so different materials could batch into one call.
2. **Generation cost.** Deriving the three tiers adds ~70–90 ms the first time each unique building asset is built. That is synchronous on the main thread, so a burst of newly completed building types can hitch. Assets are cached per settlement dialect, era, role and variation.
3. **Skyline artefacts.** Openings touching a plane's outline, such as a gable window under the verge, stay open at the skyline tier, and their shutters remain. This is sub-pixel at 96+ units but visible in magnified review shots. Civic halls and markets keep 5–13k skyline triangles.
4. **Close-range softness.** At pedestrian distance within ~0.3 units, tiles magnify (about 700–1,100 texels per unit) and soften. Composed dressings (about 400–600 px/unit) are softer than the tiles, and the pale joints around dressed blocks can halo. This pass did not raise atlas resolution.
5. **Repetition.** Brick, slate, shingle, pantile and thatch still repeat plainly, under drift and streaks. Only levelled-lift masonry gets the per-lift shift.
6. **Coursing on other planes.** Wall tops, decks and quay surfaces reuse the wall coursing (it reads as crazy paving). Sail seams follow the projection frame, not the sail axis.
7. **Brick dressings.** Gauged-brick arches and soldier courses are still to be authored. The culture frieze still shows the motif in the accent colour, and it can read as painted rather than carved.
8. **Remaining geometry defects.** The factory plan still lists openings its geometry lacks (masked out of the artwork).
9. **Hardware coverage.** Only an RTX 4060 was measured. Lower-end GPU, memory-constrained and long-session residency are **unverified**.
10. **In-game evidence.** Civilizations still stagnate early (timber and stone starvation), so the reference seed holds few finished stone, brick or industrial buildings at year 50.
