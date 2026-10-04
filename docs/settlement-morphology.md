# Movement-led settlement morphology

The pass starts from `main` at `976030bf`. Three independent template mechanisms previously
overrode movement history: semantic layout street spokes, rendered ceremonial axes, and
industrial-era district waypoints. Plot placement also rewarded wear under a building rather
than accessible ground beside circulation. The monthly traffic observer missed ordinary trips
which started and finished inside a tick.

## Authorities

- `PathEvolution` remains the authority for persistent wear and promotion from desire paths to
  engineered roads. Its capability and material gates remain intact.
- `ResourceSiteRenderer` presents that history. Street presentation and semantic layouts no
  longer add district roads or ceremonial axes. The old transport spoke planner and its prototype
  suppression patch are removed. Paid trade connections and facility service projects remain.
- `FootTraffic` observes completed monthly trips through their retained routes, validates each
  leg, and counts a touched cell once per trip. Boat trips, emergency moves, statistical populations
  and unexplained long displacements remain excluded. It does not choose navigation routes.
- `MovementFrontage` is a bounded, read-only local survey of the same edges and widths used by
  the movement renderer. It introduces no persistent network or simulation state.
- `StructurePlots` increasingly scores accessible path frontage as a settlement grows, leaves
  worn corridors open, and considers commissioned transport access and worked deposits. Terrain,
  fine water, floodwater, fields, utility clearances and existing plots still constrain reservation.
  Short access across water, agriculture or other footprints does not count. Founding compounds
  can grow before persistent paths exist. Reservations never stamp new road wear.
- Semantic destinations use occupied sites and busy movement junctions; the people layout cache
  refreshes monthly and after transport/development revisions. District anchors are not compulsory
  waypoints at any technology level. BuildingSpec, physical entrance authority and construction
  accounting are unchanged.

There is no simulation authority for paid civic axes, plazas or street widening yet. Their synthetic
presentation is therefore disabled. A future extension must commission such works through existing
construction, institutional capability and shared labour/material budgets; era or culture alone
must not grant them. Gathering destinations represent informal activity, not free paving.

## Validation

131 targeted tests pass: 127 across the 17 morphology, path, placement, BuildingSpec, transport,
energy, identity, architecture, rendering-budget and tick/routing-performance suites, plus four
focused people-navigation tests including seeded replay. Production build, type checking and
lint of the touched core modules, tests and preview script pass.

The six failures in `settlement-development.test.ts` were reproduced on an isolated unchanged
checkout of `976030bf`. The 80-year people-navigation soak timed out on both baseline and modified
checkouts; those long runs were stopped, so this pass does not claim complete soak validation.
The old live-foot-traffic failure was reproduced on baseline and is fixed by observing completed
monthly trips. No full-suite pass is claimed.

Run `node --import tsx scripts/preview-settlement-morphology.ts` to regenerate
`output/settlement-morphology.svg`. The three plan views use identical technology, seed and plot
requests with different controlled movement/shore histories. They show reserved footprints,
recorded circulation and informal gathering destinations. They are acceptance fixtures rather
than screenshots of naturally simulated long-term growth.
