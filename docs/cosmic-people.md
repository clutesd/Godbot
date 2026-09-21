# Cosmic people

The species silhouette follows the clean obsidian turnaround reference: an elongated faceless
cranium, narrow jaw, continuous neck, quiet shoulders, narrow waist, compact pelvis and tapered
limbs. The signature is a thin vertical facial seam and a circular chest/back core with a vertical
axis. The existing role glyph sits inside that shared core; colour is concentrated in the inlays.

## Production assets

`CosmicPeople.ts` generates closed elliptical-section meshes with monotone Hermite profiles and
smooth normals. The torso has 736 triangles, head 1,056, and each complete resting arm/leg 460.
The head carries a surface identifier so the shared body shader adds its antialiased facial seam
without another mesh, texture, draw call or light. Its warm-white seam has a tiny central inflection.
It follows all existing head transforms. Crown height remains 0.94 in model space, approximately
0.300 world units for the canonical adult; simulation/world scale is unchanged.

The opaque standard material uses low diffuse reflectance, 0.26 roughness and 0.12 metalness.
One shared procedural 128-face-resolution PMREM reflection field supplies broad, controlled
highlights. It is generated once, used by both the population and physical-work limbs, and disposed
with the renderer. It neither changes scene lights nor adds character lights. Day/night changes
reflection strength through the existing daylight path. There are no per-person textures/materials.

Sparse stars occupy two object-space fields with different view-dependent depth offsets. Derivatives
fade them below pixel resolution. Nebula energy, ambient emission and broad Fresnel energy are
substantially reduced. Most of the body remains nearly black. An interior-strength uniform allows
reviewing the silhouette, reflections and luminous inlays with stars/nebulae disabled.

`CosmicRoleAccents` remains one instanced batch. The inlay copies the exact torso triangles, avoiding
resampling intersections and broken rings at oblique views. Analytic ring, axis and glyph masks
share that surface, with thin shoulder/back seams and restrained elder/civic coronas. The complete
accent batch costs 988 triangles per instance. Decoration retains normal depth testing and cannot
intercept picking. All twelve role families, colours and glyphs remain available.

## Assembly and animation

`GodboxRenderer` keeps the existing instanced architecture, animation controller and work selection.
The head anchor and visual hip pivots accommodate the new proportions. Arms inherit torso lean and
twist at the shoulder; ordinary tools follow the actual hand transform. Headwear is a thin rear
circlet that leaves the facial seam exposed. Resting limbs include sculpted hands and feet.

`ResourceWorkerRenderer` uses rounded overlapping segments, the same obsidian material/reflections,
and torso-transformed shoulders during physical work. Small soles occupy two additional instances
inside its existing limb batch, so no draw calls are added. Tool/contact targets, action sampling,
work phases, carrying authority, platform elevation and animation timing are unchanged. No camera,
navigation, occupancy, collision, AI, historian or simulation implementation is changed.

## Visual review

Run `npm run dev`, then open `/tests/cosmic-people-preview.html`:

- Portrait and front/side/back turnaround; selected role or the complete role lineup.
- Documentary, street and settlement distances.
- Day, overcast, twilight, moonlight and night; grass, dark and bright terrain.
- Raw rendering or the production postprocessing pipeline, with an interior-off control.
- Idle, walking, carrying, building/farming/gathering clips and production timber/mining/plant rigs.
- Pause and quarter-second stepping for work phases.

`/tests/resource-work-preview.html` also uses the production geometry, reflection field and shoulder
attachments. The live arrival scene was inspected with actual GODBOX postprocessing at close,
normal and distant views in day/night. Review corrected oversized head proportions, neck/shoulder
joins, clipped core inlays, bulky headwear, tool thickness and working soles. No JavaScript or WebGL
shader errors occurred in the review captures.

The all-detail fixture retained **11 scene draws** at 12, 384 and 1,536 people, including shadows.
Submitted triangles were **99,170 / 3,173,378 / 12,693,506**. This is a deliberate geometry increase
for close-camera quality; no per-role/per-person draw growth was introduced. Local headless browser
frame intervals were about 15 ms at the two stress sizes, not a portable GPU performance guarantee.
The production renderer retains its existing visible-person/detail budgets.

Fine glyphs naturally collapse to core/face light at settlement distance. Full glyph recognition is
not claimed for a person only a few pixels tall. Hands and work joints remain economical procedural
forms, not a skinned anatomical model.

## Validation

- TypeScript typecheck and production build pass (existing bundle-size/dynamic-import warnings).
- ESLint passes with `npm run lint -- --ignore-pattern 'output/**'`. Plain `npm run lint` also enters
  the pre-existing untracked `output/cosmic-baseline` repository and fails on conflicting TS roots;
  that unrelated archive is preserved and excluded from the commit.
- 172 tests pass across eleven focused files: cosmic geometry/role/material contracts, work shoulder
  attachment, people presentation/animation, instance colours, physical actions, resource work,
  campaign presentation, cinematic presentation, arrival rendering, local activities and assembly.
- Geometry tests cover finite positions/normals, closed topology, triangle bounds, crown/sole
  anchors and neck overlap. Work attachment tests verify posed shoulder endpoints without changing
  contact behaviour.

Generated screenshots and logs use the `output/obsidian-` prefix and are intentionally untracked.
