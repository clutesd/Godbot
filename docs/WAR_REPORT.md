# Witnessed campaigns

Engine: `godbox-sim-0.8.0` · September 10, 2026

## Review

The previous conventional-war model had causal declarations, supply, morale, leadership, terrain advantage, casualties and tribute. Presentation rebuilt small static force markers as progress changed. Every army marched for the same fixed interval, the camera's battle event location differed from the visible front, and the watcher mostly repeated battle summaries. Resolved wars could restart without a recovery interval. Modern conventional casualties removed documentary people instead of represented city population.

## Changes

- Campaigns retain a surveyed dry-ground corridor. Distance and terrain set the march duration; provisions determine monthly advance. Flooded or otherwise impassable corridors halt the campaign, and eight consecutive blocked months end it without invented fighting. This pass models land campaigns; it does not invent naval crossings.
- Home provisions, distance and simultaneous commitments affect supply. Accumulated exhaustion limits the campaign. A depleted army cannot receive tribute merely because it previously held an advantage. Peace enforces a five-year recovery interval between the same settlements.
- Recorded transitions include departure, a blocked passage, severe supply pressure and a reversal of initiative. Each special dispatch occurs at most once per campaign. Battle reports retain their actual losses, running totals, clash number, provisions, morale and location. Disappearance of a settlement closes the war explicitly.
- In modern societies, conventional military capacity uses represented working-age population. Recorded casualties subtract from city and world population exactly once; provisioning stays in the existing economy's resource units. The documentary cast is not an additional casualty pool.
- The watcher follows four chapters: gathering, distance, contested ground and aftermath. Wording reads the event's frozen evidence, so later outcomes never leak into earlier reports. Memories of earlier trade, first contact or peace require a matching prior event and cite its ID. Routine scene selection advances to the latest campaign report; explicit historical focus remains possible.
- Persistent instanced formations march along the actual corridor, with articulated steps, patterned culture-colored standards, waving cloth and temporary muster tents. Dust responds to a newly recorded clash and subsides. Retreating columns head home and aftermath formations fade. A bounded pool shows at most four campaigns and 160 representative figures; these are documentary formations, not literal headcounts. Resources are released on expiry and restart.
- Campaign camera shots follow the same corridor and front. A responsive fieldnote panel appears only for the witnessed war, with chapters, provisions, duration, clashes, losses and current conditions. Reduced-motion preferences suppress marching cycles, cloth animation and dust. Presentation reads simulation state without changing it.

The engine version changes the archive fingerprint, so ongoing records from the prior rules are not silently resumed under a different history.

## Verification

The campaign tests cover deterministic replay, distance-sensitive and supply-sensitive marches, path-corner interpolation, impassable approaches, truce enforcement, real and statistical casualties, settlement disappearance, collapsed-army outcomes, grounded memory, no future narrative evidence, persistent animation, reduced motion and resource cleanup. Existing society and historian integration tests pass.

The full suite reported 216 passing tests and one failure in `tests/people.test.ts` (the shared city-plan destination assertion). That exact failure and numeric result also reproduce in a clean detached checkout of baseline `c6b3fb5`. After the final additions, all 36 campaign, historian, archive and society tests pass. Lint, TypeScript and the production build pass; Vite retains its advisory about bundle chunks over 500 kB.

Audit command: `npm run sim -- --seed witness-the-saffron-river --years 120 --format human` (headless default configuration). Result: 11 declared wars, 4 clashes, 124 surviving represented people, 3 settlements. This is a reproducible seed audit, not a claim that all worlds have this balance.

Browser visual inspection was blocked by the computer-use tool because it could not verify the current browser URL. Browser appearance therefore still needs manual review.

The detached baseline checkout remains at `C:\Users\Colin\AppData\Local\Temp\godbox-war-baseline-20260910` because automatic approval review rejected its cleanup with “blocked by policy.” Its `node_modules` entry is a junction to the main workspace dependencies; it is not a separate installed dependency copy.

## Local visual study

With `npm run dev` running:

- `/tests/war-preview.html` — first clash, with production renderer and fieldnotes.
- `/tests/war-preview.html?stage=march` — marching columns.
- `/tests/war-preview.html?stage=aftermath` — the closing record.
- Add `&mobile=1` (or `?mobile=1` without another query) for an isolated 390px viewport.

These development fixtures use deterministic, controlled geography and real campaign ticks. They do not read or write observation archives or alter the normal autonomous application.
