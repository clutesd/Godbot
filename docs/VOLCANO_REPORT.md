# Volcano system review

The volcano now shares its downhill lava footprint between simulation and presentation, carries ash with local wind, and leaves recoverable ecological damage. Its long quiet intervals, seeded eruption schedule, permanent background venting, and integration with the historical event stream remain part of the design.

## Material changes

| Finding | Change |
| --- | --- |
| Visual lava paths could climb terrain; damage used an unrelated circular radius. | Seeded channels select draining rim sectors, descend the authoritative terrain, and stop at depressions, permanent water, or world boundaries. Structure damage samples those same channels, their widths, the advancing front, and the structure footprint. |
| The first eruption month caused no damage, while the cooling boundary still did. | Damage begins immediately and applies for exactly the scheduled eruption duration. Repeating a monthly update cannot duplicate consequences or events. Cooling lasts 24 months, including after short eruptions. |
| Ash ignored wind, permanently reduced habitability, and instantly fertilized the entire radius at eruption end. | Wind-stretched fallout deposits a bounded, serializable recovery ledger on dry cells. Only volcanic losses are returned over 120 months, with gradual mineral release. Independent ecological changes are preserved. Structure ash also weathers away. |
| Event records always reported zero affected population. | Eruption events identify exposed settlements and their living population, using city population in statistical mode. Surviving communities record the disaster once when the eruption ends. These counts describe exposure, not deaths. |
| Preserving river samples while raising adjacent terrain created abrupt cone walls. | Cone uplift eases into existing river banks. Site selection prefers a fully dry crater; compact worlds retain a dry-summit fallback. Water beds are preserved. |
| Lava read as uniformly bright rectangular ribbons. | Channels have irregular banks, tapered toes, dark crust plates, moving incandescent seams, and opaque depth-correct surfaces. The crater lake convects independently and rises and expands with eruption activity. |
| Smoke instances blended in arbitrary order and jumped when activity changed. | Stable emission lanes, camera-depth sorting, world-space billboarding, textured billows, a spreading upper plume, and smoothed activity improve continuity. Ember trajectories stop drawing beneath terrain. |

## Determinism and cost

- Flow paths use seeded hashes and immutable terrain/permanent water masks. Monthly flooding and renderer initialization order cannot change simulation outcomes.
- Derived flow geometry is cached per world using a `WeakMap`; recovery metadata is ordinary serializable state. The renderer never advances simulation or consumes its random stream.
- Dormant volcanoes with no recovery work return without scanning cells or structures. Eruptions scan the existing cells and structure plots; recovery visits deposited cells and structure ash.
- Presentation retains fixed budgets of 96 smoke instances and 56 embers, at most three flow meshes, one lava lake, and one point light. Materials and geometries are disposed on teardown.

## Reproduce the review

```sh
npx vitest run tests/volcano.test.ts tests/volcano-render.test.ts
npm run typecheck
npm run lint
npm run build
npx vite --host 127.0.0.1 --port 5181 --strictPort
# In another terminal:
node scripts/perf/volcano-matrix.mjs
```

Open `/tests/volcano-preview.html` on the development server to inspect the production terrain, volcano renderer, and bloom pipeline. The page offers dormant, unrest, erupting, and cooling phases, day/night lighting, and a close view. `?phase=erupting&night&still` is a repeatable capture. The acceptance harness writes screenshots and shader/runtime/GL diagnostics for all eight phase/lighting combinations to `output/volcano/`.

Regression coverage includes exact phase boundaries, duplicate monthly ticks, ten-year recovery, preservation of unrelated damage, water and zero-fertility cells, restored state, render-order independence, downhill termination, advancing damage fronts, rotated ash footprints, presentation isolation, and resource disposal.

Validation on 2026-10-10: all 46 tests in the volcano, volcano-render, terrain, environment-foundation, and environment-interactions suites passed, including 17 volcano-specific tests and a complete eruption through the actual monthly simulation. All eight WebGL captures reported zero shader, runtime, or GL errors. Typecheck, the production build, and lint of the changed files passed.

Repository-wide lint reported eight errors in untouched architecture, audit, and test files. Weather/hydrology checks retained three failing assertions (timber extraction under blizzard conditions, flood risk, and catchment discharge ordering); the same three failures were reproduced with the original cone implementation through an isolated test alias. A broader run also encountered timeouts under concurrent load; the affected weather and developed-world restart tests passed when rerun separately. Its long-running simulation worker was stopped after seven minutes, so full long-run simulation validation remains incomplete. The repository-wide checks should not be described as clean.

## Scope

This remains a bounded simulation model, with three potential effusive channels and wind-driven fallout. It does not model fluid volume, explosive pyroclastic flows, new terrain deposition, evacuation, or direct volcanic casualties. Cooling channels retain visible residual heat after destructive flow stops. World generation changes affect newly generated worlds; historical replay across this change can differ because geography and volcanic consequences changed.
