# Historian and Watcher review

The narration had a solid evidence model, but did not yet read like a first-rate documentary. Old founding milestones could stay eligible indefinitely, visits to a town could suppress the novelty of a genuinely new discovery, and ordinary captions often read like lists of database fields. Some callbacks connected unrelated events merely because they shared a place. The improvements make the chronicle more current, human and coherent; template variety and the quality of simulation-authored event summaries still limit the prose.

## What changed

- Old firsts leave the news queue. Unheard major developments have a longer reporting window, and catch-up chapters present dated highlights. Fresh consequential events can outrank an unfinished founding milestone.
- History is captured independently of camera attention. The archive subscribes when events are emitted and covers nonroutine categories, including learning, diffusion, institutions, construction and battles. Routine births and deaths remain selectively retained.
- A silent shot does not consume event narration. Proposals, travel and sequence planning cannot claim to have witnessed their destination. Captions refresh when the camera arrives.
- Callbacks use explicit causes or a recent matching subject. A first-observation callback is used once, rather than becoming a refrain. Settlement changes compare with the last narrated view.
- Person captions start with visible action and add one meaningful connection: a named teacher, retained learning, a strongest skill or a career milestone. The age introduction is consumed only by narration. Founder callbacks and endings are shorter, with simulation implementation language removed.
- Historical lookup and type counts use an incremental index. Sequence planning reuses the editorial pass that selected its anchor; later acquisitions still refresh live facts.

For example, a caption can say “Their teacher, [name], has died; what they learned about farming remains with them.” This requires an actual named teacher in the person's expertise lineage and retained competence. It does not invent an emotion, motive or successful outcome.

## Existing integrations

The production configuration installs the Watcher, founding chapters, recurring cast, character memory and life arcs around the Historian. These are local, deterministic presentation layers. There is no external language-model API, remote narration service or live text-to-speech integration.

The camera receives ranked scenes, plans a short sequence, travels to the subject and checks whether the composition is readable. Physical acquisition commits the observation and decides whether its caption is shown. The presentation director adjusts the clock around witnessed developments. The browser archive stores events, statements, predictions and character observations in IndexedDB, with an in-memory fallback. Archived runs also support descriptive comparisons across worlds.

Audio reacts to committed observation revisions and supports local music, ambience, event cues, recorded voice assets and ducking. The current manifest contains Arrival Day music and the Moonlit Drift era loop. Voice assets, ambience beds and event cues are empty, so the dynamic narration is currently text.

## CPU measurements

These are synthetic local benchmarks, not browser end-to-end frame measurements. They exclude simulation ticks, WebGL and GPU work.

| Scenario | Before | After |
| --- | ---: | ---: |
| Production narration layers: 240 people, 50,000 records, 48 recent significant events; median scene selection | 98.502 ms | 9.149 ms |
| Same editorial stress case, p95 | 137.550 ms | 13.150 ms |
| Quiet base camera/Historian: 240 people, 50,000 birth records, monthly appends; median frame | 0.019 ms | 0.018 ms |
| Same quiet camera case, p95 | 0.088 ms | 0.086 ms |
| Same quiet camera case, maximum measured frame | 10.444 ms | 7.631 ms |

Editorial selections are occasional and more expensive than ordinary camera updates. History indexing rebuilds after retention, replacement or replay rewind; the first read and rebuilds can still cost more than the warmed measurements. Monthly observation is guarded against sampling a partially committed simulation tick. These results do not establish the cost of crowded battles or rendering.

Reproduce with `npm run profile:narration` and `npm run profile:camera`. The narration benchmark checks statement provenance and verifies that narration did not mutate simulation state.

## Validation

The combined narration, founding, camera, sequence and milestone suite passed 173 of 174 tests. The remaining founding-continuity test also fails in isolation: it expects a physically completed shelter after three simulation months and stops before testing its narration. Production build/type checking and lint for the changed narration/camera/test files pass. Repository-wide lint reports eight errors in other files.

The new regression cases cover incremental reads, retention/replacement, future evidence and rewind, actors appended within the same month, named teaching lineage, missing teacher IDs, silent introductions, abandoned towns, fresh-event camera priority and reuse/invalidation of planning evidence. Earlier chronicle tests cover 400-year-old firsts, dated reporting, chapter coverage and archive capture before retention.
