export interface FramePacingSnapshot {
  readonly sampleCount: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly hitches20Ms: number;
  readonly hitches33Ms: number;
  readonly arrival: {
    readonly frames: number;
    readonly maxMs: number;
    readonly hitches20Ms: number;
    readonly hitches33Ms: number;
  };
}

/**
 * Development telemetry for perceived smoothness. The hot path is allocation-free; sorting only
 * occurs when diagnostics are explicitly requested.
 */
export class FramePacingProfiler {
  private readonly samples: Float32Array;
  private cursor = 0;
  private count = 0;
  private hitches20 = 0;
  private hitches33 = 0;
  private maxMs = 0;
  private arrivalFrames = 0;
  private arrivalMaxMs = 0;
  private arrivalHitches20 = 0;
  private arrivalHitches33 = 0;

  constructor(capacity = 600) {
    this.samples = new Float32Array(Math.max(60, Math.floor(capacity)));
  }

  observe(frameMs: number, arrival: boolean): void {
    if (!Number.isFinite(frameMs) || frameMs < 0) return;
    const value = Math.min(250, frameMs);
    this.samples[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.samples.length;
    this.count = Math.min(this.samples.length, this.count + 1);
    this.maxMs = Math.max(this.maxMs, value);
    if (value > 20) this.hitches20 += 1;
    if (value > 33.34) this.hitches33 += 1;

    if (arrival) {
      this.arrivalFrames += 1;
      this.arrivalMaxMs = Math.max(this.arrivalMaxMs, value);
      if (value > 20) this.arrivalHitches20 += 1;
      if (value > 33.34) this.arrivalHitches33 += 1;
    }
  }

  snapshot(): FramePacingSnapshot {
    const values = Array.from(this.samples.subarray(0, this.count)).sort((a, b) => a - b);
    const percentile = (p: number): number => {
      if (!values.length) return 0;
      const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
      return Number(values[index]!.toFixed(2));
    };
    return {
      sampleCount: this.count,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: Number(this.maxMs.toFixed(2)),
      hitches20Ms: this.hitches20,
      hitches33Ms: this.hitches33,
      arrival: {
        frames: this.arrivalFrames,
        maxMs: Number(this.arrivalMaxMs.toFixed(2)),
        hitches20Ms: this.arrivalHitches20,
        hitches33Ms: this.arrivalHitches33,
      },
    };
  }

  reset(): void {
    this.samples.fill(0);
    this.cursor = 0;
    this.count = 0;
    this.hitches20 = 0;
    this.hitches33 = 0;
    this.maxMs = 0;
    this.arrivalFrames = 0;
    this.arrivalMaxMs = 0;
    this.arrivalHitches20 = 0;
    this.arrivalHitches33 = 0;
  }
}
