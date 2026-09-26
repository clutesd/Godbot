# Human movement and awareness pass

The ordinary rig now uses two instanced segments per arm and leg. Shoulder/elbow and hip/knee values reach visible geometry, rather than rotating a complete limb. Local flexion is composed after body yaw, removing the heading-dependent sideways arm swing. Hands and tools follow the forearm endpoint. This adds two shared draw batches per render pass, not per-person skeletons. The existing visible population budget, distant silhouette policy, physical work rigs and seated rest solver remain in use.

Walking advances phase by actual visual displacement. The recovering knee folds while the opposite leg supports the pelvis; arms counter-swing with relaxed elbows. Pelvis lowering compensates for the supporting leg's shortening. Motion amplitude eases during acceleration and stopping, and a stopped stride freezes its phase while settling. State transitions capture the displayed procedural pose before blending. Ordinary stationary crouches also compensate pelvis height, so enabling knees does not push feet through the floor. These are planted-looking steps, not terrain-aware ankle IK or persistent world-space foot locks.

Idle has small seeded asymmetry, breathing and restrained weight shifts. Age changes stride and posture. Sociability scales conversational expression. Speakers use a stable leading hand; listeners keep quieter arms, occasionally nod and look away. The existing reciprocal encounter clock owns turn-taking, including a learner response while the mentor listens. Existing relationships, grief, play, ritual, work and rest authority continue to choose the presentation context.

Passing recognition queries at most 24 candidates from the existing previous-frame spatial buckets. Household members and positive existing relationships can produce a brief glance, then a small delayed torso turn. Cooldown prevents repeated greetings. It never changes route, destination or relationships. Existing physical peer avoidance still owns spacing and path accommodation. Work, local activity and first-fire anchors supply bounded, eased focal head direction. Feet retain locomotion facing while the upper body acknowledges a peer.

No simulation source, authoritative person record, relationship, outcome, knowledge or simulation PRNG was changed.

## Verification

- Final production build and lint pass. Vite still reports its existing bundle-size and mixed static/dynamic import warnings.
- Final focused run: **135 tests pass across 11 files**, covering joint attachment and heading invariance, opposing ankle strides/arms, knee recovery, support height, no outward walking arms, frozen stationary stride, smooth settling, seeded identity, age, carrying, listening/teaching, passing recognition, shared social beats, seated rest, physical movement, and read-only documentary presentation.
- Population regression exercises 1,536 animation states and shared pose buffers. A CPU-only measurement of 60 frames of animation plus four joint chains per person took 170?203 ms total (about 2.8?3.4 ms/frame) on this machine. This excludes GPU drawing, scene traversal, shadows and the rest of the application; it is not a frame-rate guarantee. Segmented limb geometry totals 1,920 triangles per detailed person.
- A complete suite run during implementation finished with 1,124 passes and 20 failures. The newly strengthened mentor assertion failed in that in-progress run and passes in the final fresh focused run. The broader suite is **not green**. Clean baseline commit `5639a20d` reproduces resource deposit rendering assertions, foot-traffic and migration-footpath assertions, settlement material/construction failures, the Arrival Day restart failure and archive replay timeout. Long simulation runs also hit wall-clock budgets; the highlands case passed alone on baseline. No unrelated simulation fixes or timeout relaxations were made.

## Visual review

[Geometry contact sheet](human-joints-review.png) uses the production meshes and joint matrices with simple CPU shading: front/side walking, idle, carrying, teaching, listening and reflection. It was inspected for attachment and silhouette. It does not show production WebGL materials, shadows, cargo or motion in a live settlement.

Both `/human-life-review.html` and `/tests/cosmic-people-preview.html` now use the segmented joint helper. The asset study includes speaking, listening, teaching, tension, mourning, ritual, play and running, plus child/elder age selection through its role control. Start with `npm run dev`; select Front / side / back or Documentary and cycle activities. `?population=1536` exercises the larger population.

No browser was connected in this session, so live WebGL/cinematic acceptance and GPU timing remain unverified. In particular, review foot contact on slopes, work/rest handoffs, tools/cargo, and close camera silhouettes in the running world before treating this as final visual sign-off.
