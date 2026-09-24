import type { Simulation } from '../Simulation';

/**
 * Owns the tiny but critical boundary between the final Arrival-Day presentation frame and
 * authoritative monthly history. The camera may signal that the film is complete, but only this
 * handoff asks Simulation to cross the gate and only the following live frame may commit Month 1.
 *
 * Keeping this state explicit prevents a half-live "Day 0" where the ordinary HUD is visible but
 * no monthly tick has yet happened. It also repairs a resumed archive saved in the narrow window
 * after HISTORY_RUNNING was persisted at Month 0.
 */
export class OpeningHandoff {
  private firstTickPending: boolean;

  constructor(simulation: Simulation) {
    this.firstTickPending = Boolean(
      simulation.state.arrival
      && simulation.historyRunning
      && simulation.state.month === 0
      && simulation.config.autoRun,
    );
  }

  get pendingFirstTick(): boolean {
    return this.firstTickPending;
  }

  /** Crosses the authority gate exactly once after the camera's final release shot has completed. */
  beginIfReady(simulation: Simulation, presentationComplete: boolean): boolean {
    if (!presentationComplete || !simulation.foundingOrientationRunning) return false;
    if (!simulation.beginHistory()) return false;
    this.firstTickPending = simulation.config.autoRun;
    return true;
  }

  /**
   * Commits the first authoritative month on the frame after the gate opens. Ordinary scheduling
   * takes over immediately afterward, so this never changes simulation order or long-run pacing.
   */
  commitFirstTick(simulation: Simulation): boolean {
    if (!this.firstTickPending) return false;
    if (!simulation.historyRunning || !simulation.config.autoRun) return false;
    this.firstTickPending = false;
    if (simulation.state.month > 0) return false;
    simulation.step(1);
    return true;
  }

  /** The ordinary historical HUD stays hidden until Month 1 has actually been committed. */
  presentationActive(simulation: Simulation): boolean {
    return simulation.foundingOrientationRunning || this.firstTickPending;
  }
}
