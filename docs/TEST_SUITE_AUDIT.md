# Test suite audit (2026-09-07)

## Result

- Baseline reproduced: 22 files, 161 tests, 15 failures (four assertions and eleven timeouts), 100.52 seconds.
- Final `npm test`: 22 files passed, 164 tests passed, zero failures, 110.45 seconds.
- `npm run typecheck` and `npm run lint` passed.
- Existing assertions, seeds, simulation horizons, and deterministic comparisons are retained. Three regression tests were added. No features or rendering changes were introduced.
- Corrected historical rules use `godbox-sim-0.7.1`, distinguishing new run/configuration fingerprints from 0.7.0 histories. Deterministic equivalence is within an engine version, not across the behavior fixes.
- The repository had no commits at audit time. Regression mechanisms were reproduced from the current code and fixtures; their introducing commits could not be identified.

## Logic fixes

### Rail discovery

`KnowledgeSystem.requirementsMet` counted an active trade route only when its optional transport path was populated. The knowledge fixtures supplied active connections and every catalog prerequisite, but were rejected by this extra representation dependency. The prerequisite now counts active connections. Transportation still owns surveying, construction, physical route validity, and actual freight delivery. The existing partial-familiarity and mastery-ramp tests pass without changes to their enabling stacks or assertions.

### Migration and geography

Migration selected the most appealing destination before testing pedestrian reachability and never considered a reachable alternative. For the failing seed, some moves occurred but the expected mixed-culture settlement never formed. After the existing pressure/probability decision, destinations are now checked in appeal order for a reachable pedestrian approach. Each migrant still needs a complete valid route to their actual destination. No boat/train capability is inferred from a label, and the fixture still requires zero trade routes and zero trades.

### Knowledge exchange

Delivered freight could reinforce existing knowledge while `expose` returned no event and `knowledgeExchanges` stayed zero. Sustained reinforcement now uses the same weighted teaching-exposure units and significance threshold as new-record diffusion. An actual positive mastery gain is required. Zero-gain contact produces no exchange, and the existing delivery gate remains intact. A regression test covers reinforcement, gradual accumulation, and zero-gain accounting.

## Profiling and optimization

Node CPU profiles were captured for 960 monthly ticks, the 300-year stability seed, and archive replay. Hotspots included pedestrian A*, repeated stable-ground searches, fine/coarse terrain checks, route surveys, weather cell updates, and hydrology. Archive construction itself took about 14 ms; original/replay simulation stepping took approximately 3.27/2.97 seconds in that measurement. Serialization was not the cause of the replay timeout.

Implementation changes:

- Hoist traversal helpers out of per-segment calls, removing repeated closure/name-wrapper allocation.
- Reuse resolved coarse cells in fine-water checks; retain the exact fine and coarse supercover traversal checks.
- Cache deterministic stable-ground searches with a 2,048-entry bound. Track inspected regions so unrelated barrier changes do not discard local searches. Return defensive copies.
- Label pedestrian connected components lazily for the current barrier revision. Disconnected pairs avoid repeated weighted A* searches. Reachable pairs retain the original search and 1,024-expansion bound; component work is bounded by the world grid.
- Invalidate pedestrian connectivity when fine water or coarse traversability changes. Regression tests cover cached disconnection, recession, blocked ground, and safe recovery.
- Keep completed-network path caches when a weather revision leaves the usable graph unchanged. Construction changes and flooding still invalidate paths immediately.
- Reject impossible survey endpoints and unlicensed fine-water crossings before allocating dense edge samples.
- Reuse weather scratch descriptors, cache the monthly seasonal cosine, reject distant fronts cheaply, and assign weather fields directly. Public weather queries still sample their exact coordinates.

No weather/hydrology ticks were skipped, no simulation cadence was tied to presentation, and no additional random draws were added for caches. A whole-state SHA-256 comparison after the logic fixes and before/after optimizations matched exactly over 960 ticks. The measured isolated workload improved from 5.86 seconds to 3.87 seconds, about 34%. Final replay, restart, and presentation tests independently verify determinism.

## Test runtime budgets

Default file concurrency caused substantial CPU contention: for example, the water-routing test passed in the focused slice but exceeded 30 seconds in a full run. Vitest now uses at most two workers. This trades some aggregate wall time for predictable per-test execution; the final suite is not claimed to be faster than the baseline suite.

Only these six budgets changed after profiling and implementation optimization:

| Test | Previous | Current | Evidence |
| --- | ---: | ---: | --- |
| Archive replay | 5 s | 15 s | Two complete 35-year simulations; still 5.4 s isolated after optimization |
| Specified-seed restart | 5 s | 15 s | Initialization/reset and two 30-year runs; still 6.6 s isolated |
| Presentation preset independence | 15 s | 60 s | Two full 180-year histories; about 42 s in a measured two-worker run |
| 300-year stability | 20 s | 50 s | 3,600 monthly updates; about 38 s in a measured two-worker run |
| Generational continuity | 5 s | 10 s | 80-year run measured at 5.3 s with two workers |
| Migration/geography | 5 s | 10 s | 80-year run measured at 5.9 s with two workers |

All other budgets are unchanged, including people determinism, water-safe routing, knowledge reproducibility, current-seed restart, and archive persistence. Tests were not disabled or shortened. Temporary profiles from this audit were removed; pre-existing audit files were left untouched.