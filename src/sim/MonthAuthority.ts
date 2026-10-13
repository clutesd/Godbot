/**
 * Which simulation states currently hold a month that has begun but not yet committed.
 *
 * The browser advances history in time slices so one expensive month never blocks a rendered
 * frame. While a month is in flight `state.month` already names the new month, but most of its
 * consequences have not happened yet. Presentation caches that refresh "once per month" key on
 * `committedMonth(state)` instead, so they rebuild against the finished month rather than
 * capturing a half-advanced one and then holding it for the whole month.
 *
 * Kept outside SimulationState so it can never enter archives, fingerprints or history.
 */
const inFlight = new WeakSet<object>();

export function setMonthInFlight(state: object, active: boolean): void {
  if (active) inFlight.add(state);
  else inFlight.delete(state);
}

export function monthInFlight(state: object): boolean {
  return inFlight.has(state);
}

/** The most recent month whose consequences are complete. */
export function committedMonth(state: { readonly month: number }): number {
  return inFlight.has(state) ? state.month - 1 : state.month;
}
