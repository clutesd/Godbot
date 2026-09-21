# Human life presentation

The simulation still owns identity, occupation, activity, navigation, position and every outcome.
`LocalActivityPresentation` is renderer-owned state for people already at their destination. It
does not advance history or write to people, settlements, resources or relationships.

## Confirmed causes

- `PeopleSystem.update` returns without assigning a new destination when destination and schedule
  phase match. Resource workers also retain their site across commute/work phase changes.
- `PeopleVisualStateStore` completes its journey and measures zero displacement on subsequent frames.
- `PeoplePresentation` assigns stable, deterministic group positions. Those positions had no local
  activity clock, so ordinary occupations could stay on the same spot indefinitely.
- `PhysicalWorkScene`, farm actions and resource-work motion already provide stronger, independently
  timed contact/recovery/reposition sequences. They retain ownership of those workers.
- Ordinary idle clips were largely breathing; the renderer also ignored their spine rotation.
- Stationary navigation could explicitly request walking. Logical patrol/travel/flee/migrate could
  also select locomotion without displacement. Animation phase offsets existed but were unused.

## Implementation

### Documentary timebase

Human presentation deliberately does **not** map walking or routine actions to the displayed day.
The documentary preset's ordinary pace is 2 simulated months per real second; a literal 30-day
month would make one simulated day last only about 0.017 real seconds. Driving footsteps, meals or
work cycles from that calendar would make the population flicker between actions rather than look
alive.

`PeopleSystem` therefore remains monthly authority: it records the broad destination/activity facts
used by history. The removed `dailyPlan` / `dailyKey` projection API is not part of production
presentation. Ordinary within-settlement home/work/market trips are treated as sub-monthly facts:
the monthly sample resolves the resident at that phase's destination while retaining the consumed
route for the renderer. This prevents an ordinary walk to work from occupying several historical
months while still letting the viewer watch that route unfold over presentation seconds. Emergency
travel and migration remain genuinely in-progress authoritative journeys.

`LocalActivityPresentation` is the sole micro-life layer and advances from renderer `deltaSeconds`.
Its work, conversation, inspection, rest and reposition beats are documentary samples of ordinary
life, not claims that each displayed calendar day was individually animated. Specialized physical
work still retains its existing stronger choreography.

Authoritative journey interpolation may use the observed real-time spacing between monthly
retargets as a *catch-up ceiling* so a visible walker does not fall permanently behind history.
That estimate never drives local routine timing and local moves never train it.

Each eligible visible resident keeps a small routine, a few cached safe points, a destination,
an interaction focus and an arrival/action timer. The entry beat is deliberately brief: after
settling and orienting, a resident holds the arrival state for only 0.4–1.2 deterministic real
seconds before beginning the first purposeful local action. The later task, conversation, ritual,
rest and pause beats retain their longer multi-second holds so the settlement stays calm rather
than becoming constant motion. Existing visual interpolation runs between decisions. No crowd
physics or additional pathfinder is involved, and mesh instancing and visible-person budgets are
unchanged.

Workshop, market, plaza, civic, knowledge, industrial, shrine, home and patrol routines have distinct
task/inspection/interaction/pause sequences. Work-area points are relative to the current grouping
and nearby matching building geometry. Without a suitable building, the layer uses observation
and pauses rather than inventing a workstation. Conversations select actual visible members of
the same destination and face their previous-frame visual positions. Later cycles can choose a
different neighbour. This does not create or modify a simulation relationship.

Local targets stay within two world units of authoritative position. Candidate points and each
connecting segment reuse resource-work walkability and terrain checks, plus radial clearance and
rotated building footprints. Invalid candidates are discarded. Blocked corridors cause waiting;
a stopped journey can retry after a pause. Geometry changes invalidate cached points, while an
equivalent geometry rebuild preserves routine timing.

Semantic authority changes such as destination, occupation, role, household or actual activity
replace the current local intent on the next rendered frame. Ordinary monthly position/target
corrections, waypoint churn and non-interrupting schedule-phase changes do not restart the
micro-life routine. A sampled ordinary commute temporarily suspends the previous local routine
instead of deleting it; the authoritative route remains visible, and the next destination phase
does not replay the first-appearance arrival hold. Genuine in-progress travel, emergency,
displacement, migration, unsafe weather, inactivity and existing farming/construction/resource
work still take precedence.

Local activity bases use a dead-band/hysteresis follower. Small monthly social-layout or authority
jitter is ignored. Once drift becomes meaningful, the local frontage follows far enough to return
inside a stable release radius without resetting the current action, timer or cycle. This keeps
work and social behaviour spatially relevant without making characters chase every monthly layout
correction. State is pruned with the visible-person budget and cleared on renderer disposal.

Local steps accelerate/decelerate and turn before leaving planted feet. Ordinary authoritative
travel now eases too; specialized physical-work approach curves remain intact. Locomotion phase
advances by measured distance and survives pauses. Gait, carrying arms, modest age variation and
bounded idle gestures use per-person deterministic timing. Zero displacement suppresses gait,
including residual legs from an animation transition. Replay is deterministic for the same
authority, visibility, camera-detail tier and frame-delta sequence.

## Review scene

Run `npm run dev`, then open **http://localhost:5173/human-life-review.html**.

The developer-only scene supplies explicit fixture authority for 36 people in twelve areas:
home, market, plaza, field, workshop, shrine, civic, knowledge, industrial, patrol, resource and
construction. It uses production activity/movement/animation and physical-work systems with the
same instanced body proportions as the main renderer. The scene does not call simulation steps.

1. Choose an area and leave the camera at **Normal street shot**; use **Close inspection** for limbs.
2. Press **Hold authority for 60 seconds**. The status should continue to say **authority unchanged**
   while residents move, work, interact, observe and pause. Construction stays at 30% paid progress;
   farm output and the resource ledger stay constant.
3. Enable target markers to inspect local bounds. The displayed resident action identifies its
   phase and conversation partner when present.
4. Press **Emergency override** to cancel routines immediately. Once emergency travel has finished,
   stationary people should stop cycling their legs. **Restore activities** restores fixture authority.
5. Orbit or zoom out to inspect simultaneous movement and stillness across the town.

## Validation and remaining limitations

`tests/local-activity.test.ts` covers frozen-authority motion, brief bounded arrival timing, replay,
timing offsets, authority immutability, interruption, safe paths/footprints, geometry invalidation,
blocked-trip recovery, visibility cleanup, actual-displacement gait, carrying, acceleration and
bounded idles. `tests/documentary-human-cadence.test.ts` additionally runs the real simulation
monthly PeopleSystem at the documentary preset's ordinary 2 months/second while resolving local
presentation at 60 FPS for 20 presentation seconds. A matched unrendered simulation proves that
presentation remains byte-for-byte non-authoritative. Existing
people/physical-action/resource/construction suites cover the retained stronger work systems.

Validation for this pass:

- Final focused run: **163/163 tests passed across nine files**, including **37 new local-activity tests**.
- After the final cadence-estimator correction, the local-activity and people suites passed again
  (**62/62 tests**). Lint, TypeScript and production build passed; the build still warns about the
  existing large bundle and ineffective dynamic import.
- The broader run recorded **797 passes and 18 failures**. One failure was an obsolete assertion
  that a stationary resource traveler should walk; that assertion was updated and the suite passed.
  All other **17 failures**, including three timeouts, reproduced on an isolated checkout of original
  commit `3f3fcb89`. They concern environment extraction, historian predictions/determinism, resource
  economy, settlement development/render budgeting and simulation determinism. No simulation fixes
  were folded into this presentation pass.
- JSON reports: `output/human-life-focused-tests.json`, `output/human-life-full-tests.json`, and
  `output/human-life-baseline-tests.json`.

Browser visual inspection could not be completed in this session: Computer Use stopped because
it could not verify the active Windows browser URL. The fixture is typechecked; its visual quality
and normal-camera readability still need an on-screen review.

The procedural rig has no foot IK or planted-foot solver, so compressed long journeys can still
slide. Generic occupations share coarse work gestures and building-relative exterior points;
there are no authored indoor desk, machine or workbench contact sockets. Head turns are limited
by the simple head silhouette. Conversations use bounded point selection, not collision avoidance
or mutual turn-taking, so dense groups can still overlap. Large or obstructed sites may have no
safe local candidates and intentionally remain in stationary presentation.
