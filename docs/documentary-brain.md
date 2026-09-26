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
