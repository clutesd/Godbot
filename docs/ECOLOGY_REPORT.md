# Living ecology visual uplift

The renderer now reveals a second ecological layer at dusk: instanced luminous fungi, small flowers and trunk colonies, wind-influenced forest motes, and moving plankton fields in physical water. Daytime gains emerald, blue-green, sage and occasional violet foliage without replacing seasonal colour or tree lifecycles.

## Integration

- `EcologyField` reads the existing biome, moisture, wood, weather, season, settlement pollution, structure fire/scorch and advanced ecological pressure. A small RGBA habitat texture is shared by flora, particles and water. It updates at the existing 0.4-second vegetation cadence. No simulation state or simulation PRNG is consumed or modified.
- `BioluminescentFlora` joins the existing vegetation renderer and anchors colonies to its actual tree placements. Existing clearing footprints, tree mortality/recovery, canonical water heights and camera distance control visibility. Three instanced geometries share one material; pollen, spores and fireflies use one GPU-animated point cloud. The former generic CPU-updated ambient cloud is replaced, while seasonal falling leaves, birds, weather, smoke and other effects remain.
- `WaterEcology` extends the existing ocean/inland `MeshPhysicalMaterial` shaders. It preserves hydrology, freezing, rapids, waterfalls, recession wetness and physical light response. Animated normals and clearcoat sit above seeded, advected sparse point fields and noise-warped filaments. Terrain depth anchors coastal activity; local water depth and ice govern inland activity. Rain, waves, wind and river current excite existing microbial light. Boat-specific wake impulses are not added in this pass.
- `EcologyPostProcessing` adds HDR luminance-threshold bloom before the output tone-mapping pass. It does not render the world twice or swap scene materials. Ordinary diffuse surfaces generally remain below the threshold; water highlights and actual emissive sources can bloom. The DOM overlay never enters post-processing.
- `TreePhenology`, `UnderstoryField`, `TerrainDecor` and the terrain palette gain coordinated colour variation. Blossom, autumn, winter, climate, age and existing health behaviour remain in place.

Bioluminescence fades smoothly to zero in daylight. Regional refuges cover about 2% of seeded five-cell regions; they become exceptional only when their actual habitat is healthy and warm enough. Drought, loss of wood, cold, snow, tree damage, fire, pollution and ecological collapse suppress the layer. Recovery of those inputs restores it at the same seeded sites. The new populations are visual ecological projections, not a new authoritative algae/fungi simulation.

Archive fingerprints retain their previous shape. Changing the four new visual controls does not orphan an existing observation, and resume applies those controls to the archived world. Two 240-month simulation runs produced identical full-state SHA-256 hashes before and after the uplift (`witness-the-saffron-river` and `ecology-fire-replay`, 48 initial people, two settlements, size 20). The string-only hash typing repair preserves legacy fire randomness; the added fire-event population default matches the existing event recorder's default.

## Budgets and quality

Set these under `render` in `godbox.config.ts`:

| Setting | Default | Behaviour |
| --- | --- | --- |
| `bioluminescenceDensity` | `1` | Up to 1,800 planned colonies; hard cap 3,600; `0` disables flora |
| `particleDensity` | `1` | Up to 1,400 motes; hard cap 2,800; `0` disables motes |
| `waterComplexity` | `2` | `0`: physical water only; `1`: one sparse point field and shore response; `2`: second point field and fine filaments |
| `bloomQuality` | `1` | `0`: direct rendering; `1`: first bloom mip at quarter resolution; `2`: first mip at half resolution, relative to drawing-buffer size |

Flora retires between 55 and 100 world units; motes fade between 45 and 90 view-space units. Water radiance fades in the distant landscape. Per-frame ecological animation updates time, light and wind uniforms, not thousands of object positions. The existing particle-independent vegetation LOD/structural updates remain CPU work. Bloom adds 14 screen-space draws (bright extraction, ten progressively smaller blur passes, composite, additive blend and output). Its cost is separately disableable.

The initial source audit found an existing 3,000-tree planning budget, up to 2,800 flowers, a 520-point ambient CPU loop, shared physical water materials and no post-processing. The repeatable size-32, summer, fixed-camera audit below measures the actual vegetation allocation with the ecological layer off/on; it is not an FPS benchmark or a whole-scene measurement.

| Vegetation audit | Ecology off | Ecology on |
| --- | ---: | ---: |
| Trees / visible flowers | 1,069 / 2,400 | 1,069 / 2,400 |
| Reported scene draws | 64 | 68 |
| Triangles | 1,062,966 | 1,170,293 |
| Allocated materials | 94 | 96 |
| Allocated geometries | 94 | 98 |
| Visible new flora / motes | 0 / 0 | 1,477 / 1,400 |

The new layer adds 107,327 triangles in this scene (about 10.1%) and four scene draws. Replacing the old ambient point cloud removes one main-scene draw and its per-frame CPU position upload. Inland environmental channels now share four interleaved `vec4` bindings, keeping the complete shader to seven active attribute slots instead of exceeding WebGL's minimum sixteen-slot limit. Named channel views remain inspectable without duplicating GPU storage. Water uses the existing two physical surface materials plus a shared terrain texture; the ecology adds two scene materials total.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run build`: pass. Vite retains its advisory about chunks larger than 500 kB.
- Added ecology tests cover daylight transitions, habitat loss/recovery, seeded refuges, state immutability, population budgets, clearing and distance culling. Additional tests check packed water channels, legacy fire hashes and compatibility with an archive fingerprint captured from untouched commit `bbf372f`.
- All water tests pass, including the two tests previously blocked by the canvas-based soft-sprite helper. That helper now generates the same radial gradient stops in a DOM-independent data texture.
- Full suite: 244 passed, three failed in the last full run. The subsequent archive compatibility change was verified with all 14 archive/PRNG tests passing. The three remaining failures reproduce on untouched `bbf372f`: `people.test.ts:120` (destination anchor distance), `weather.test.ts:60` (mixed versus snow expectation), and `vegetation-render.test.ts:77` (three flower draws expected despite the existing three understory draws). Their assertions and simulation behaviour were left unchanged.
- **22 generated GLSL variants compile and link** with the offline Khronos compiler: ocean, inland water and waterfall materials at all three water settings, flora and motes, each through direct and HDR output paths, with scene-light/shadow defines. Active attribute counts range from two to eight. See [the recorded audit](./ecology-shader-audit.json). The compiler's old reserved `average` helper name is renamed only in its generated copy of Three's code.
- **Visual/GPU acceptance remains outstanding.** The browser-control tool exposed no browser, and automatic approval review blocked an isolated headless-browser launch with “blocked by policy.” No GPU timings, actual browser shader-driver results or screenshots are claimed.

The development-only preview uses the production modules and keeps the same camera/seed across daylight and weather modes:

```text
http://localhost:5173/tests/ecology-preview.html?mode=night
http://localhost:5173/tests/ecology-preview.html?mode=day
http://localhost:5173/tests/ecology-preview.html?mode=twilight
http://localhost:5173/tests/ecology-preview.html?mode=storm
http://localhost:5173/tests/ecology-preview.html?mode=winter
http://localhost:5173/tests/ecology-preview.html?mode=damage
```

Add `&close` for forest-floor framing, `&quality=0` or `&quality=1` for scalability checks, `&baseline` for the existing water/vegetation path, `&still` for a fixed animation time, and `&report` to inspect draw counts and errors. The scene never reads or writes the user's observation archive. Its baseline switch disables the new ecology/shader/bloom layers; it does not restore the previous foliage palette.

To repeat the offline shader audit, set `GLSLANG_VALIDATOR` to a local Khronos `glslangValidator` executable and run `npx tsx tests/compile-ecology-shaders.ts`. Without that variable, the script only exports generated shader sources and allocation reports to `node_modules/.tmp/ecology-shaders`; it does not claim compilation. The validator is a development audit tool, not a runtime dependency.
