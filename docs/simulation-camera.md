# People-first documentary direction

People are the protagonists; the world is what their lives leave behind.

The path is Simulation history ? Historian proposal ? CinematicSequencePlanner / CameraDirector reservation ? physical camera flight ? acquisition ? renderer performance ? release. `Historian.chooseScene` has no authority to record a witnessed statement. `acquireScene` commits narrative memory and founding cursors only when the lens arrives. Headless editorial callers must explicitly acknowledge observations.

First fire (per camp), first shelter, first permanent building, first resource/material discovery, first death and first burial bypass significance and recency limits. Completed infrastructure context distinguishes shelter, permanence and burial from proposed work. These records survive history trimming. The director retries unacquired milestones and holds acquired milestones before considering another story. First Fire's renderer performance starts on acquisition.

Construction, discovery and grief seek a living participant or local witness before framing the object. Human event sequences start with detail; terrain-following travel supplies geographic context between stories. Physical flights retain swept terrain/building/vessel safety, continuous gaze and bounded motion. Manual authority stays exclusive.

Trees are presentation-soft. Renderer tree shaders suppress the foreground gaze corridor with a spatially feathered dither, without modifying ecology, placement or shadows. Trees do not enter production hard-collision probes. Terrain, buildings and vessels still do. Arrival's safety correction is limited to local slides and terrain clearance rather than orbit searches.

Arrival establishes the world, acquires the first pod, continuously descends, witnesses landing and emergence, and stays with the hero group for the ground-level handoff. Beat changes do not reset pose, velocity or FOV. The subsequent founding overview, human introductions and release remain behind the existing history authority barrier. Failed travel cannot declare the release complete.

## Obstacle awareness and bad-frame handling

The renderer owns what is actually drawn; `CameraObstacleField` is its read-only description for the
camera: building bodies with a wider roof cap (overhangs), active scaffolds, landmarks, advanced
infrastructure, landed vessels and work props, rebuilt only when those visuals change. Foliage stays
*soft*: it counts toward how much of a frame is dominated but is never a hard collision. Nothing here
touches simulation state or randomness, and identical inputs replay identically.

- **Anchors.** Structure shots frame a readable exterior anchor (entrance, façade, work yard,
  machinery, roofline) that faces the approaching lens, with a standoff derived from the footprint
  plus overhang. Work yards lean toward the nearest builder. Recently used buildings are avoided.
- **Routing.** Flights bend around footprints instead of cutting corners, may only aim straight at
  the destination when that line is clear, and hop to a clear, uncovered spot when repeatedly blocked.
  A destination with no readable composition gives up after ~2.5 s of no progress.
- **Bad-frame watchdog.** A held shot is assessed ~5x a second (frame dominance by foreground
  geometry, subject occlusion, standing under an eave, tiny repeated corrections without composition
  gain). Strong frames are never touched and keep their breathing. A frame that stays bad gets one
  nearby reframe (orbit / back off / lift, reachable by a safe sweep); if that fails, or the frame
  fails again, the shot is retired and the next one is reached by ordinary continuous flight. The
  retired subject sits out a few Historian selections; a retired milestone gets one more attempt from
  a different angle.
- **Motion with purpose.** Optional trucking/drifting on medium and human shots eases out once the
  composition has been strong for a moment; it returns if the frame degrades.
- **Sequencing.** Scale changes step (wide → settlement → building → person) instead of hopping to
  extremes, the Historian avoids returning to the same place at the same scale, and the same place is
  not filmed from the same side twice in a row.

## Continued observation during live history

The edit stays adaptive after the founding years. Settlement, institution, road and polity repetition
penalties are bounded; lifetime viewing counts cannot permanently erase these subjects from attention.
After six acquired shots without audible narration, an eligible settlement offers a current readout of
population, food security and building count, with measured differences from its last narrated view.
Unchanged evidence can remain silent. Speech memory and readout baselines advance only when the
caption is actually shown, including sequence beats that otherwise suppress narration.

Queued shots refresh their evidence before departure and again when the lens arrives. Missing people,
completed projects and obsolete revisions yield to current history. Current population claims are
recomputed rather than archived with a stale month. Social scenes also require their presented partner
to remain present on acquisition. Ordinary transit clears the released caption; a destination is never
narrated before physical acquisition. Live captions receive up to 28 seconds of reading time, while
Arrival retains its authored timing.

An unreachable major event or mandatory milestone remains pending. Failed flights interrupt their
queued sequence and impose a presentation-time retry cooldown of 30 seconds per failed attempt,
capped at three minutes. Other subjects remain eligible while it waits. A failed route neither
acknowledges that event nor changes simulation authority. Existing continuous flight, swept safety,
manual control and the founding authority gate continue to own physical movement.

Regression coverage includes a ten-minute quiet viewing run, an inaccessible mandatory milestone,
a three-minute run through real monthly simulation updates with the production Watcher layers, live
evidence refresh, transit captions and truthful short-interval historical callbacks.

## Camera runtime cost

The camera and Historian keep incremental milestone indexes. Held frames and clock-only changes
perform no archive traversal; appended events are inspected once. Replacing or trimming the archive
rebuilds the index, including capped compaction that preserves the array's identity and length.
Published event records are immutable. Tests exercise all of these invalidation boundaries with a
50,000-record history and preserve the same first-milestone order as the uncached implementation.

At acquisition, people, settlement, institution and route scenes refresh their own candidate family
instead of generating every historical event, campaign, prediction and landscape proposal again.
Current provenance validation and documentary memory decoration still apply.

Run `npm run profile:camera` for a repeatable CPU audit with 240 people, 50,000 synthetic archived
records, monthly appends and 1,800 measured frames after warm-up. It reports median, p95, p99,
maximum and month-change timing in milliseconds. This isolates camera/Historian CPU work with flat
sampling and frozen people; it does not measure simulation ticks, rendered obstacles, WebGL, GPU
cost or frame time on a user's device. Timing is diagnostic, while traversal bounds and movement
continuity are enforced by regression tests.


### Watcher caption delivery and voice

At physical camera arrival, the watcher composes its final caption from the refreshed statement, including scenes chosen directly by the sequence planner. Composition restores the statement's factual base first, so revisiting or refreshing it cannot duplicate commentary. A resolved prediction is marked as remarked only when its caption is actually narrated.

Lead with the observed event or current subject. Add at most one historical connection: prefer a recorded cause, distinguish shared-place or shared-actor context from causation, and describe first occurrences as the earliest *surviving record*. Do not infer generations of technology, destruction, or continuity from an event type alone. Settlement follow-ups compare with the last narrated view and report changed measures; a quiet view states stability once rather than repeating three unchanged statistics. These changes run at scene selection and arrival, not on held camera frames.
