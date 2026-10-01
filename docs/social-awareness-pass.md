# Social awareness and encounter continuity

This pass strengthens the existing renderer-owned local activity, physical movement and social
gesture systems. Simulation people, relationships, population, navigation, construction progress,
history and random streams retain their existing authority. The checkout already contained
settlement/building work; those changes were preserved.

## Problems addressed

- Independent invitations could compete for one listener. Previous-frame reservations now retain
  established pairs, resolve competing invitations deterministically using relationship strength
  and trust, and allow one exclusive pair per conversational pod (or work group without pods).
  Bystanders retain the existing group-listener behavior.
- A two-second general cooldown allowed the same pair to restart repeatedly. Each visible person
  remembers up to four partners for 28–40 presentation seconds. Memory survives activity changes
  and interruptions, including emergency overrides and sampled commutes, and is pruned with visibility.
- Social readiness relied on action labels. Actual visual spacing, stopping and mutual orientation
  now gate encounter time and gestures. Greetings use their existing contact-specific spacing.
  Blocked approaches time out after 12 continuous seconds; all encounters have a 45-second ceiling.
  Ending an encounter returns to the existing purposeful local routine.
- Caregivers could select a moving child at a different destination but invalidate that attention
  on the next frame. Acquisition and sustained attention now use consistent perception rules.
- Idle perception and local yielding scanned the visible population. Production now supplies a
  capped 24-person query from the existing visual spatial index. Ambient acquisition is staggered
  at 0.35–0.7-second intervals. Bucket ordering makes capped selection independent of render order.

## Shared surroundings

`WorldAttentionPresentation` reads active structure fires and unfinished construction projects
with an actual authoritative crew. Cues are rebuilt with the existing population/visibility refresh.
People within four world units of a fire or 2.4 units of a worksite can notice it inside a bounded
view cone. Construction interest depends on existing curiosity; builders retain their physical
work choreography. Intervening rotated building footprints block attention.

The layer samples at staggered intervals, examines at most 16 cues per acquisition, and eases the
head before a small stationary torso response. Walking keeps its route and facing. Work contact,
rest, ceremonies and explicit social exchanges retain pose precedence. Recent incident IDs are
remembered, and separate holds and gaps avoid continuous staring or synchronized crowd reactions.
Removed evidence releases attention; persistent fire evidence can be checked again after 45 seconds.

The Historian camera consumes the existing social-interest signal only once a reciprocal pair is
ready. Neither the attention layer nor camera interest creates historical events or relationships.

## Verification and review

Tests cover deterministic invitation arbitration, relationship selection, pair cooldowns,
mutual orientation and spacing, interrupted/resumed routines, blocked encounter timeout,
pod caps, moving-child attention, bounded spatial queries, source-grounded construction cues,
reaction distance, view cones, occlusion, staggered onset, incident memory and visibility cleanup.
The documentary cadence integration compares rendered and unrendered simulations byte for byte.
Retained physical construction/material and animation suites are included in the focused run.

Final validation: **248/248 tests pass in 15 files**; `npm run build` (including TypeScript),
`npm run lint`, and `git diff --check` pass. The build retains its large-bundle and mixed
static/dynamic import warnings. Machine-readable results are in
`output/social-awareness-final-regression.json`. An additional run including `people.test.ts`
was stopped after several minutes in the long population/terrain coverage; it did not produce
a completed report. The full repository suite was not run to completion.

Run `npm run dev`, then open `/human-life-review.html`. Plaza, Workshop and Knowledge show
conversation and work transitions. Enable Documentary camera, hold authority, and use Emergency
override/Restore activities to inspect interruption. The new review-fire button adds/removes
explicit fixture fire evidence at Workshop; it tests gaze without drawing flames or advancing
simulation authority. The fixture uses simplified geometry and does not reproduce every production
contact gesture. For final acceptance, watch the ordinary simulation with labels hidden.

Live visual acceptance is still outstanding: this session had no connected browser, and the native
computer-use helper reported an unavailable pipe. Numerical checks do not establish human-scale
cinematic quality or GPU performance. This focused pass does not add new responses for animals,
carts, battles, discoveries or migrants, nor replace existing locomotion, worksite or crowd navigation.
