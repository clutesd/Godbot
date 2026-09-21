/**
 * Presentation-only real-time clock for human life.
 *
 * It deliberately has no simulation/calendar input. Historical time may accelerate, slow or stop;
 * visible human choreography continues from render-frame time unless a person's authoritative
 * state explicitly interrupts it.
 */
export interface HumanLifeFrame {
  deltaSeconds: number;
  elapsedSeconds: number;
  frame: number;
}

export const MAX_HUMAN_LIFE_FRAME_SECONDS = 0.1;

export class HumanLifeClock {
  private elapsedSeconds = 0;
  private frame = 0;

  advance(renderDeltaSeconds: number): HumanLifeFrame {
    const finite = Number.isFinite(renderDeltaSeconds) ? renderDeltaSeconds : 0;
    const deltaSeconds = Math.min(MAX_HUMAN_LIFE_FRAME_SECONDS, Math.max(0, finite));
    this.elapsedSeconds += deltaSeconds;
    this.frame += 1;
    return { deltaSeconds, elapsedSeconds: this.elapsedSeconds, frame: this.frame };
  }

  get elapsed(): number { return this.elapsedSeconds; }
  get frames(): number { return this.frame; }

  reset(): void {
    this.elapsedSeconds = 0;
    this.frame = 0;
  }
}
