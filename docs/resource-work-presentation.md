# Resource work presentation

## Authority

Extraction → `ResourceWorkAssignment` → contributing occupations → real routed residents →
safe pedestrian ground → worksite presentation. Rendering never writes production, inventory,
person positions, tree mortality, path wear, or land modifications.

`ResourceWorkPresentation.ts` owns the resource family, tool, cadence, material palette,
bounded intensity and deterministic worker variation. `ResourceWorkScene` derives one shared
layout used by the worker overlay and `ResourceSiteRenderer`. Bindings require a matching
settlement and destination, positive occupation labour, and a healthy, undisplaced person
currently gathering. Travel and emergency behaviour retain precedence.

## Visual grammar

- Timber: two-handed axe strokes, anticipation, contact, quick recovery and periodic rests;
  end-grain logs, cut sections, stump and branch slash. A nearby existing natural tree is
  preferred; its trunk radius determines contact placement. When no suitable standing tree
  is available, workers process documentary cut logs at the safe site edge.
- Stone and minerals: pick strokes, recovery and inspection crouches; an exposed face,
  contact rubble, baskets and a bounded pile. Copper, iron, coal, clay and uranium use muted
  material-specific colours.
- Plants: crouch, reach, pluck, inspect, basket and stand; small safe steps around the patch,
  tied stems, harvesting baskets and drying racks.

The existing settlement era controls tool finish and log-stack organization. No machinery,
vehicles, hauled cargo or settlement inventory visualization is introduced.

Worker motion uses absolute presentation time plus seed, person ID and site ID. Two arm
segments reach the same tool shaft; articulated knees preserve the foot anchors. Visual
approach decelerates and facing eases before work blends in. Real tree strikes use the spare
component of the existing tree instance attribute for a tiny deflection, shared by colour
and shadow shaders. Feedback clears every frame and cannot fell a tree.

## Bounds and lifetime

- At most 64 active assignment layouts; four work stations per physical destination.
- Eight persistent site instance pools, with the largest capped at 1,024 instances.
- Four worker overlay pools: at most 256 workers, 2,048 limb segments and 768 contact chips.
- Scene plans and worker bindings refresh at monthly ledger updates, outside the frame loop.
- Site uploads occur only when consumed visual facts change; an identical new month reuses
  the layout and GPU buffers. Trees retain their existing LOD rebuild schedule.
- Per-frame work samples motion only for represented residents and updates bounded instance
  buffers. Tree feedback touches only struck instances.
- Empty ledgers remove temporary work and worker bindings. Existing logging/quarry/mine scars,
  path wear, abandoned deposits and vegetation succession retain their original authority.

Unsafe station candidates are rejected, never piled onto a single fallback. Both simulation
walkability and rendered-ground checks validate approaches and local work. No suitable nearby
edge means no active presentation at that site. Multiple settlements working the same physical
destination share its station budget; the strongest current assignment supplies its visible props.

## Validation and preview

`tests/resource-work-visual-contract.test.ts` covers classification, identity variation,
contact spacing, locomotion and emergency priority, occupation eligibility, safe edge placement,
ledger cleanup, scar preservation, pool bounds, changing-month resource reuse, unchanged-month
upload reuse and non-destructive tree feedback. Existing extraction, routing, people and
vegetation tests cover the underlying systems.

Run `npm run dev` and open `/tests/resource-work-preview.html` for the controlled interactive
fixture. It uses production profiles, site geometry and worker rigs, with resource, time, camera
distance and ledger-clear controls. It is excluded from the production entry point.

`npx tsx tests/resource-work-contact-sheet.ts` writes projected production triangles to
`output/resource-work/contact-sheet.json` for offline inspection. This checks geometry and
poses; it does not substitute for a GPU/shader or cinematic-camera review in a live browser.
