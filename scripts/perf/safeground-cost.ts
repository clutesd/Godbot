/**
 * Reproduces the workload of tests/people.test.ts's 80-year safe-ground cases outside vitest, to
 * show whether that test's 60s limit is being exceeded by tick cost alone. Diagnostic only.
 */
import { performance } from 'node:perf_hooks';
import { Simulation } from '../../src/sim/Simulation';
import { WalkabilityLayer } from '../../src/sim/people/WalkabilityLayer';

for (const seed of ['people-river', 'people-islands', 'people-highlands']) {
  const simulation = new Simulation({ seed, startingPopulation: 200, settlementCount: [4, 4] });
  const walkability = new WalkabilityLayer(simulation.state.world);
  const startedAt = performance.now();
  simulation.step(80 * 12);
  const stepSeconds = (performance.now() - startedAt) / 1000;

  // The assertions the test makes, so a genuine invariant break is visible too.
  let unsafeStanding = 0, invalidRoutes = 0, checked = 0;
  for (const person of simulation.state.people) {
    if (['boat', 'ferry'].includes(person.navigation?.crossingMode ?? '')) continue;
    checked += 1;
    if (!walkability.isWalkable(person.position)) unsafeStanding += 1;
    const navigation = person.navigation;
    const remainingRoute = navigation?.traveling
      ? [person.position, ...navigation.waypoints.slice(navigation.waypointIndex)]
      : navigation?.waypoints ?? [];
    if (!walkability.routeIsValid(remainingRoute)) invalidRoutes += 1;
  }
  console.log(`${seed.padEnd(18)} step ${stepSeconds.toFixed(1)}s`
    + ` ${stepSeconds > 60 ? 'OVER' : 'under'} the 60s test limit`
    + ` | people ${simulation.state.people.length} checked ${checked}`
    + ` | unsafeStanding ${unsafeStanding} invalidRoutes ${invalidRoutes}`);
}
