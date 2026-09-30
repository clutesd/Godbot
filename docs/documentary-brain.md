# Documentary observation pipeline

The simulation owns facts, events, causes and randomness. The presentation layer owns attention.

1. `CameraDirector.update` calls `Historian.observe`. `DocumentaryMemory` samples once per simulation month, copying scalar person, settlement and project evidence. Selection also samples, so headless users retain the same behavior. Differences reveal relationship/household changes, migration, occupation changes, deaths, construction progress/blockage/stalling/disappearance, and food/pollution changes. Construction rate comparisons account for elapsed months. An initial snapshot is a baseline, not a fictional change.
2. `Historian.candidates` combines these developments with the existing event, campaign, person, institution, settlement, route and landscape candidates. Existing provenance validation remains the gate. Important events outside the original type allowlist can qualify through significance. People representing each local activity remain eligible beyond the founding years.
3. Editorial ranking combines existing consequence/activity/scale scores with first-event novelty, unseen-event importance, explicit causal follow-up, and human activity. Viewing an event reduces its repeat priority without suppressing a later event involving the same subject. Thread revisions preserve unshown changes; candidate enumeration does not consume them. Unresolved subjects can return after twelve months with silent follow-up intent.
4. Requests include subject, importance, reason, thread, activity, scale, purpose, narration policy and completion explanation. Recorded causal edges supply provenance and a shared thread; proximity alone is never described as causation. Existing campaign and founding systems remain in place.
5. The camera retains the existing flight, visibility, settling and action-completion systems. Development anchors are protected from unrelated social substitution and sequence padding. An activity change/death or project ending releases the shot after a minimum viewing window. Duration ceilings still apply.
6. Existing sequence narration and HUD/audio visibility honor silent requests. Exact repeated evidence is silenced. The Watcher no longer inserts generic quiet-year or cosmic commentary; its event callbacks remain, including short-lag explicit causes.

## Evidence boundaries

Changes describe the interval between observations, not an invented exact occurrence time. Food and pollution are explicitly labeled bands. A vanished project is not automatically declared completed or failed: only its absence is known. Existing simulation event summaries provide richer historical explanations. Animals and geography retain the existing scenic pipeline; no unsupported animal intentions or environmental causal claims are generated.

Memory is owned by each Historian and consumes no simulation randomness. Generic development memory lasts for that Historian's lifetime; existing founding-character archive restoration is unchanged. Generic thread snapshots are not currently serialized across application reloads. Sampling cannot recover transient state changes that occur between observed months unless the simulation records them as events.

## Validation

`tests/documentary-memory.test.ts` covers change detection, project progress/rate/blockage/disappearance, environmental deltas, event significance and explicit causality, non-consuming enumeration, long-interval continuity, quiet mature years, repetition silence, deterministic selection, frozen evidence and identical subsequent simulation evolution. Existing historian, early-documentary and cinematic-sequence tests exercise compatibility with retained systems.

## Event-led documentary continuity

Travel captions express route intent using known names/geography and at most one copied,
physically acquired record at the destination. They never copy the destination's current
population/activity or announce an unacquired event. The bounded place callback is held by
`DocumentaryMemory`, not a second narrative store. Transit has no acquired scene ID and does
not consume event attention. Current-population captions expire when their observation month passes; other non-event
captions carry an explicit observation date and historical event captions remain historical evidence.

Watcher interpretation uses the event's authored outcome and an actual earlier record.
Explicit event IDs in `causes` allow causal language. Shared knowledge, place or participants
allow only a temporal comparison. Same-month callbacks require the predecessor to occur
before the anchor in the authoritative history. World awakening is not a generic callback
for every later development. War and the authored first-fire/opening voices retain their
existing interpretation. Added evidence is excerpted to fit an 78-word reading budget;
long pre-existing base captions are not rewritten. `validateStatement` is unchanged.

An event anchor is the first physical destination in its package. The remaining roles follow
the existing grammar, using relevant residents, institutions, the recorded place, or explicit
predecessors/consequences; an unrelated event cannot qualify merely by proximity. Packages
have at most two planned narrated beats and six shots. Event packages yield after a reveal,
at exhaustion/invalidation, or to a new event of significance at least 0.95. Ordinary packages
remain interruptible. The camera still owns arrival refresh, safety and cooldown decisions.
Acquisition invalidates the cached major-event winner so a paused backlog can progress.

`tests/documentary-experience.test.ts` exercises the installed production layers for ten
minutes with deterministic frame time. It budgets empty fallback travel (<5%), unexplained
silence (<75 seconds), subject/text repetition, acquisition and narration of a paused important
event backlog, coherent human-scale reveals, future-evidence rejection, event-specific callbacks
across fourteen categories, and repeatable live-history camera/caption traces. The live Watcher
regression validates every displayed statement each frame and compares watched simulation
outcomes with an unwatched control. The cinematic CI workflow runs these checks.

Limits: unrecorded causality remains unknown; unreadable destinations can still be deferred
by camera safety. Documentary memory remains session-local. CPU audits do not measure GPU
cost or certify the aesthetic quality of a rendered multi-minute film.
