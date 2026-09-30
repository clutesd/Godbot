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
