# Character presence pass

Implementation preserves the living-obsidian surface family, canonical skeleton, simulation-owned activities and destinations, and instanced population batches.

## Changes

- Six deterministic head plane sets: keel, bastion, lantern, chisel, arch, cairn. Jaw, cranium, cheek, brow, temple, recess and neck vary together. Shared vertex channels carry the selection; there are no per-person meshes or materials.
- Broader adult shoulder/pelvis, ribcage, limb and reach variation; childhood variation is attenuated so growth remains readable.
- Culture forms follow existing mountain/terrace, river/wave, moon/spiral and sun/step style data. Role and age still control equipment and coverage.
- World-space foot contacts, alternating recovery, two-link knee reach, ankle roll, planted-foot yaw, support-side weight transfer, head turn lead, upper-body counterrotation and delayed fall motion.
- Ordinary local travel uses a slower presentation speed appropriate to the 0.3-world-unit adult. Simulation destinations, emergency authority and navigation clearance remain authoritative.
- Offset torso branches and glyphs, unequal limb density and temple marks, standing-dependent status nodes.
- Open overlapping waist panels, six cast waist scales, shaped shoulder shells and a back fall replacing the cone mantle.
- Observed-person eye engraving, temple clasp and at most two soft sole-contact shadows. Population draw batches and existing atlas vertex limits remain intact.
- Headwear now uses the saved head matrix. Previously its position scratch vector had already been overwritten by the hip transform.
- Shadow depth uses the same head deformation, selected adornment and ankle transforms as the visible pass.

## Verification boundary

The supplied screenshot was reviewed. Live visual acceptance is **pending**: browser inventory returned no surfaces and the Windows native capture pipe was unavailable, including after reset. Build and mathematical/contract tests cannot establish visual motion quality, GPU shader compilation or live frame cost.

The next review must use the main Godbox app, not the lineup preview:

| Scene | Acceptance check |
| --- | --- |
| Crowd | Related but distinct skulls, adult silhouettes and culture forms; unchanged citizen batching |
| Close observation | Crown attached during turns, readable recessed eyes, restrained extra clasp and contact shade |
| Conversation | Existing gaze and gesture timing preserved; no foot skating during facing changes |
| Walking | Observe several full strides plus start, turn and stop; hold the camera still and watch sole contacts |
| Adult and child | Growth remains readable; child reach and sole contacts stay connected |
| Worker | Existing tool contact, hand targets and work authority remain intact |
| Night | Amber inlays remain sparse; obsidian planes remain legible |
| Bright daylight | No white/chrome body response; all head planes and adornment shadows agree |

Automated checks: production build and lint pass. Focused character, contact, movement, camera, cadence and instancing checks pass. The optional exhaustive suite was stopped while running long simulation tests; there is no full-suite pass claim. Body/head adornment atlases contain 850/624 vertices, within the existing 980/700 limits.

Compare frame pacing and draw calls at the same seed, population, viewport, camera and lighting. The grounded solver currently yields to explicit work/rest/ceremony choreography and emergency running; those retain their existing specialized motion.
