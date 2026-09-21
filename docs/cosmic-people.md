# Cosmic people

People now share an obsidian, faceless species identity, with sparse internal stars, a restrained
blue/violet nebula and a thin luminous rim. Role colour is confined to cores, shoulder trims,
mantle seams, halos and the rim. No simulation files or historical/UI records were changed.

## Architecture

Previously `GodboxRenderer` constructed nine instanced batches: capsule bodies, heads, arms,
legs, tools, headwear, cargo, notable mantles and a coloured upper-torso clothing shell. The body
parts shared a standard material. `Person.role` already supplied 34 professions/social roles;
`appearance`, age and historical tier supplied proportions, props and prominence. Separate
bounded `ResourceWorkerRenderer` pools replaced limbs during physical work. Campaigns used
their own formation proxies. No individual character owned a unique body material or texture.

`RoleVisualProfile.ts` now provides an exhaustive `PersonRole` family table and safe unknown-role
fallback. `CosmicPeople.ts` owns species dimensions, reusable body/head geometry, deterministic
ID variation, the body material, and the configurable role accents. The former clothing shell
is replaced by one `CosmicRoleAccents` batch containing front/back cores, shoulder trims, optional
mantle seams and a halo. An instance style vector selects an analytic glyph and accessory scales.
No texture assets or per-person materials are allocated. The obsolete garment module was removed.

The body shader extends Three's standard material, keeping lighting, shadows, fog and tone mapping.
It uses object-space star cells and a low-frequency nebula term, not time-varying noise. Screen
derivatives filter stars away below pixel resolution. Instance colour affects the rim, never the
black body. Night adjustment changes shared uniforms/material brightness; there are no character
lights, transparency sorting, HDR accent colours, or additional bloom passes.

The canonical adult crown is about **0.300 world units**, versus **0.269** previously: about **12%
taller**. A larger initial proposal failed the smallest-building scale test and was reduced.
Existing age and appearance proportions remain inputs. ID hashing adds height ±2.5%, build ±4%,
star phase, nebula variation and accent brightness. Navigation, collision, destinations, animation
clips, activity authority and movement timing remain unchanged. Cores share the torso matrix;
the smaller head now follows the existing spine transform. Generic hand-held props use scaled
hand offsets rather than the former fixed world-space offsets. Articulated work retains its
existing joint/contact solver with the shared cosmic material. Campaign proxies use cosmic bodies
and soldier cores; freight proxies use the same obsidian material.

## Role vocabulary

| Existing roles | Accent | Core | Silhouette |
| --- | --- | --- | --- |
| farmer, gatherer, hunter | leaf green `#a4cf71` | seed/oval | narrow shoulders |
| fisher, sailor, dock-worker | cyan `#63cce2` | crescent | narrow shoulders |
| builder, laborer, miner, craft-worker | amber `#e9b65b` | diamond | broad shoulders |
| trader, merchant, transporter, logistics-worker | copper `#ef9062` | double bar | short mantle seams |
| guard, soldier | vermilion `#ef6353` | chevron | strongest shoulders |
| priest, ritual-specialist | rose `#d68ac9` | hourglass | long mantle seams |
| administrator, manager | pale gold `#e3d487` | triangle | broad shoulders, small halo |
| scholar, scientist, researcher | violet `#ae96ed` | vertical bar | narrow shoulders, long mantle seams |
| factory-worker, engineer, machinist, railway-worker, energy-technician, machine-systems-specialist, space-worker | blue `#759ee7` | square | reinforced shoulders |
| healer, medical-worker | mint `#a2e7d0` | cross | short mantle seams |
| elder | ivory `#ede6cd` | crown | halo, mantle seams |
| child, absent or unknown role | silver `#b2bdcc` | circle | minimal shoulders |

Culture still influences existing props and notable mantle rim colour. Future wealth, culture,
injury and equipment styling can be independent channels alongside role; none is inferred here.

## Budget and review

The main population retains **nine mesh batches**, with no draw-call growth per person or role.
The existing density-dependent visible-person budget and 32-notable mantle cap remain intact.
Cores/accessories cost 140 triangles per represented person; inactive accessory triangles collapse
in the vertex shader. Campaigns add one core batch per company, bounded by the existing four
campaign/two-company limit (at most eight additional draws). Working limbs reuse their existing
batches and add no draws. Geometry/material disposal remains tied to the renderer lifetime.

The standalone asset fixture measured **11 total scene draws**, including ground and shadow draws,
at 12, 384 and 1,536 people. Submitted triangles were 7,682 / 245,762 / 983,042 respectively. This
verifies bounded draw calls, not a universal frame-rate claim; GPU time on low-end hardware remains
a useful follow-up measurement. Stars and analytic masks add bounded fragment work over the old
standard material.

Browser review used 1600×1000 screenshots at close, normal street (roughly 9 radius / 6 height),
and settlement overview (25 radius / 19 height), in day/night and on grass, bright and dark terrain.
The live arrival scene was also reviewed through GODBOX's actual postprocessing at all three
distances. No WebGL shader or JavaScript errors occurred. The colour and core cues survive normal
street distance; black silhouettes remain distinct on bright ground, while a thin rim separates
them at night. Fine stars disappear before they become static. At overview scale, colour is the
remaining cue; full glyph recognition is not claimed for characters only a few pixels tall.

Walk, carry, build, gather and rest clips were inspected in the role fixture. Timber cutting,
mining and plant gathering were inspected with the production articulated worker fixture.
Review led to tighter shoulders, a stronger night rim, lower-profile headwear, corrected neck
attachment during leaning and scaled prop offsets. No camera rules, terrain occlusion rules or
depth tests were bypassed in the production renderer. Decorative cores cannot intercept raycasts.

Reproduce with `npm run dev`, then open:

- `/tests/cosmic-people-preview.html` — all 12 families, three cameras, light/terrain/activity controls.
- `/tests/cosmic-people-preview.html?population=384` (or `1536`) — asset stress scene.
- `/tests/resource-work-preview.html` — real articulated work/contact presentation.

The simplified rig still has the existing limitations: no foot IK, coarse hands, occasional crowd
overlap and normal building/tree occlusion. Campaign figures are formation proxies without person
IDs, so they share a fixed cosmic seed. A richer cultural/status/equipment layer and hardware GPU
timings are sensible future additions. No simulation-scale increase is required for these visuals.

## Validation

- Final focused run: **142/142 passing across nine files**, covering people construction/presentation,
  physical actions, resource work, building scale, role fallback/palette, deterministic appearance,
  instancing configuration, and campaign rendering without simulation mutation.
- TypeScript and production build pass. Vite reports its existing large-bundle and ineffective
  dynamic-import warnings. ESLint passes for every changed TypeScript file.
- A broader run during implementation recorded **805 passes / 20 failures**. Fourteen assertion
  failures reproduced on a clean archive of starting commit `3ee8da7` (environment extraction,
  historian predictions, resource economy, settlement development and settlement render budgets).
  The historian assertion required running its whole describe block to reproduce, because those
  tests share mutable fixture state.
  Five long-running simulation/history/knowledge tests timed out. One campaign assertion was
  observed while the running suite overlapped edits; all three campaign tests subsequently passed,
  including the final focused run. The broad run is **not claimed as clean**. No unrelated simulation
  or historian fixes were folded into this visual pass.
- Local evidence: `output/cosmic-focused-tests.json`, `output/cosmic-full-tests.json`,
  `output/cosmic-baseline-tests.json`, `output/cosmic-baseline-historian.json`, and `output/cosmic-*.png`. Generated evidence is excluded
  from the commit; the review fixtures are included.
