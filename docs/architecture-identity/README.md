# GODBOX functional architecture review

This change replaces the shared shell for houses, barns, byres, stables and granaries with physical programs resolved inside BuildingSpec. Early round huts and longhouses retain their dedicated topology, with obstructing entrance posts corrected. Other active archetypes remain on their existing production paths and appear in the comparison sheets as controls.

## Production audit and changes

| Component | Finding | Production change |
| --- | --- | --- |
| BuildingSpec | Historical stages supplied dimensions and equipment, but no physical circulation or section contract. | Resolves rooms, threshing aisle, feeding passage, stall range or grain floors; roof section, structural bay count and raised floor. Includes the program in the deterministic cache signature. Material selection, available technology, family/load limits and climate resolution remain authoritative. |
| BuildingComposer | One mass, frame, roof and opening sequence preceded additive structural overlays. | Routes the five programs to FunctionalBuildings before the shared shell. Does not layer generic bracing, string courses, frontage or crowns over these buildings. |
| FacadePlan | Shared window grids and central doors treated agricultural and domestic uses alike. | Supplies program-specific access and light/ventilation cuts. Published facade plans describe the same elevations used by the wall emitter, including entry position and size. Inset frames are not advertised as proud facade members. |
| StructureGeometry | Additive logs, piers or bracing could refill shell voids. | Adds a full-depth cut-wall primitive. Functional buildings use this primitive without the legacy wall overlay, while retaining the foundation and equipment library. |
| SpecGrammarBridge | Purpose presentation could reintroduce ornament and generic massing. | Keeps compatibility metadata while suppressing structural facade bands and duplicate massing for physical programs. SVG remains optional surface artwork; it does not determine a roof, plan or opening. |
| AssetBuilder | Generic LOD masses could erase the new identity. | Uses the physical program for mid LOD, and an indexed extrusion of its roof section for far LOD. Retains cache, LOD thresholds, material batching and contact shading. |

Houses have floor-aligned daylight openings and a connected entrance passage. Barns have opposed wagon doors, an unobstructed threshing route, aisle supports and side lofts. Byres have a low asymmetric roof, end access and a feeding passage. Stables have individual stall doors, corresponding partitions, high ventilation and a cut-back hipped ridge after the earliest period. Granaries have compact storage volumes, loading hatches, small high vents, access steps, raised early floors and later stacked storage floors.

Wall voids have full wall thickness. Jambs and lintels follow their cuts. Nonglass materials assigned to the glazing role are not emitted as opaque window backing panels. Available glass produces recessed glazing; door leaves sit alongside their clear openings. Loft edges, columns, bins and louvers were adjusted after mesh raycasts found access or ventilation conflicts. Rafters, ties and purlins provide a restrained load path instead of decorative bracing on every bay.

Foundation forms still consume the resolved foundation style and material. Joinery and roof members consume the trim and roof-structure assignments. Construction pieces keep canonical stages and assembly ranges, with door latches fitted during finishing. Equipment that duplicates physical stalls, ventilation, access or lofts is integrated into those physical systems; the remaining equipment retains its library emission.

## Visual evidence

These are depth-buffered software renders of the production AssetBuilder triangles, not illustrations. Every surface uses the same neutral gray, with directional shading. The structural-shell filter excludes fitted equipment, yard props, glazing and artwork. Views are unlabeled and each cell is fitted independently, so apparent size between cells is not a world-scale comparison. Baseline geometry came from an isolated copy of the original HEAD architecture sources. Seeds, historical inputs, camera direction and rendering method are held constant.

Priority sheets: **top row before, bottom row after**. Both rows run left to right: house, barn, byre, stable, granary.

- [Bronze / Iron Age comparison](comparison-bronzeIron.png)
- [Medieval comparison](comparison-medieval.png)
- [Industrial comparison](comparison-industrial.png)
- [Contemporary comparison](comparison-contemporary.png)

All active archetypes are rendered at each representative period in which they exist: 62 cases per revision. The separate indexes identify cells in row-major order without adding labels to the renders.

| Period | Before | After |
| --- | --- | --- |
| Bronze / Iron Age | [All active](before-bronzeIron-all.png) | [All active](after-bronzeIron-all.png) |
| Medieval | [All active](before-medieval-all.png) | [All active](after-medieval-all.png) |
| Industrial | [All active](before-industrial-all.png) | [All active](after-industrial-all.png) |
| Contemporary | [All active](before-contemporary-all.png) | [All active](after-contemporary-all.png) |

[Baseline cell index](before-index.json) · [Reworked cell index](after-index.json)

Regenerate current geometry with `npx tsx scripts/architecture-function-preview.ts after`, then `python scripts/render-architecture-function-preview.py after`. The rasterizer requires Pillow and NumPy. Render JSON and generated sheets go to `output/architecture-audit/`; the reviewed sheets are retained here.

## Verification

The new functional-architecture regressions sample nine rays per opening through the actual opaque production meshes, with an intact-wall positive control. They check the complete barn wagon route, early dwelling entry clearance, geometric roof profiles, functional door/hatch layouts, historical raised storage, spec validation, deterministic resolution, cache identity, construction progression and LOD roof heights. Existing construction assembly, material, integration, routing, browser, shading and performance tests remain part of validation. These checks do not claim recognition from vertex-count differences.

`npm run build` and `npm run lint` pass. The focused production run passes **216 tests across 13 files**, including construction assembly and LOD contact shading. The full non-soak run reports **2,053 passed, 13 failed and 11 skipped**. Twelve failures were reproduced with the original architecture sources: arms demand, construction runtime/workface, founding establishment, opening progression, persistent trade and stalled-shelter replanning. The remaining failure was the newly added exterior-gable closure check, corrected afterward by fixing face winding. The final focused run rechecks that fix and the complete production architecture/construction set. [Full-run record](full-test-summary.json) retains the failures rather than presenting the full suite as green.

The 19 new-program cases in the neutral comparison matrix have at most **6,154 full-detail vertices / 6 meshes**, **1,180 mid-LOD vertices**, and **58 far-LOD vertices**. These are measured complete production assets, including fittings omitted from the neutral shell view. The retained Bronze / Iron Age longhouse path has its existing 1,914-vertex mid/far LODs and is outside those new-program maxima. [Per-case render metrics](render-metrics.json) include every active control and this inherited case.

## Remaining limitations

This is the first production tranche, not a conversion of the entire catalogue. Other active archetypes still use their established generic or dedicated compositions. Regional courtyard plans, joined farm ranges, bank-barn slope access and heritage-driven additions need further physical programs; the new house path currently uses a room block. Heritage and age remain in the spec and shader pipeline, but mixed-generation annex geometry is not yet represented by these new programs. Cultural variation is strongest in early dwellings, material sourcing and climate response; the five new sections do not constitute a comprehensive regional architectural catalogue.

Far LODs intentionally retain closed silhouette masses rather than wall apertures. Loading hatches are geometrically open and higher granary floors exist, but interior stairs, hoists and detailed animal-handling circulation remain simplified. Neutral software views validate geometry and proportions; they do not replace an in-world WebGL lighting and camera review. Existing bundle-size and mixed static/dynamic-import warnings remain in the production build.
