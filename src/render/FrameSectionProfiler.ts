/**
 * Attribution for long frames.
 *
 * `FramePacingProfiler` answers "how bad is the pacing"; this answers "which system caused that
 * 300 ms frame". Sections are marked in renderer order, and whenever a frame exceeds the hitch
 * threshold its full per-section breakdown is retained, so a future regression can be traced to a
 * named subsystem instead of re-profiled from scratch.
 *
 * The hot path is allocation-free: section costs accumulate into a fixed Float64Array and retained
 * breakdowns reuse rows of a bounded ring buffer. Sorting and object creation happen only when
 * diagnostics are requested.
 */

export const FRAME_SECTIONS = [
  'construction-sync',
  'arrival-policy',
  'presentation-state',
  'day-night',
  'people',
  'settlement-presentation',
  'construction-presentation',
  'ambient-presentation',
  'energy-industry',
  'water-sky-vegetation',
  'maintenance',
  'camera',
  'war',
  'weather',
  'render',
] as const;

export type FrameSection = (typeof FRAME_SECTIONS)[number];

const SECTION_COUNT = FRAME_SECTIONS.length;

export interface LongFrameRecord {
  readonly frameMs: number;
  readonly atSeconds: number;
  /** Section costs in milliseconds, largest first, omitting negligible sections. */
  readonly sections: ReadonlyArray<{ readonly section: FrameSection; readonly ms: number }>;
}

export interface FrameSectionSnapshot {
  readonly enabled: boolean;
  readonly frames: number;
  readonly hitchThresholdMs: number;
  readonly longFrames: number;
  /** Mean and worst cost per section across all observed frames. */
  readonly sections: ReadonlyArray<{
    readonly section: FrameSection;
    readonly meanMs: number;
    readonly maxMs: number;
    readonly shareOfFrame: number;
  }>;
  /** The worst retained frames, each with its own attribution. */
  readonly worst: readonly LongFrameRecord[];
}

export class FrameSectionProfiler {
  private readonly current = new Float64Array(SECTION_COUNT);
  private readonly totals = new Float64Array(SECTION_COUNT);
  private readonly maxima = new Float64Array(SECTION_COUNT);
  /** Ring buffer of retained long-frame breakdowns: [frameMs, atSeconds, ...sections]. */
  private readonly retained: Float64Array;
  private readonly retainedStride = SECTION_COUNT + 2;
  private retainedCount = 0;
  private retainedCursor = 0;
  private frames = 0;
  private longFrames = 0;
  private frameTotalMs = 0;
  private lastMarkAt = 0;
  private enabled = false;

  constructor(private readonly hitchThresholdMs = 25, retainedCapacity = 32) {
    this.retained = new Float64Array(Math.max(4, retainedCapacity) * this.retainedStride);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get active(): boolean {
    return this.enabled;
  }

  /** Call once at the top of the renderer frame. */
  begin(nowMs: number): void {
    if (!this.enabled) return;
    this.current.fill(0);
    this.lastMarkAt = nowMs;
  }

  /**
   * Attributes everything since the previous mark to `section`. Sections whose work does not run on
   * a given frame simply stay at zero for that frame.
   */
  mark(section: FrameSection, nowMs: number): void {
    if (!this.enabled) return;
    const index = FRAME_SECTIONS.indexOf(section);
    if (index < 0) return;
    this.current[index] = (this.current[index] ?? 0) + (nowMs - this.lastMarkAt);
    this.lastMarkAt = nowMs;
  }

  /** Call once at the end of the renderer frame, with the frame's measured cost. */
  end(frameMs: number, atSeconds: number): void {
    if (!this.enabled || !Number.isFinite(frameMs)) return;
    this.frames += 1;
    this.frameTotalMs += frameMs;
    for (let index = 0; index < SECTION_COUNT; index++) {
      const value = this.current[index] ?? 0;
      this.totals[index] = (this.totals[index] ?? 0) + value;
      if (value > (this.maxima[index] ?? 0)) this.maxima[index] = value;
    }
    if (frameMs <= this.hitchThresholdMs) return;
    this.longFrames += 1;
    const base = this.retainedCursor * this.retainedStride;
    this.retained[base] = frameMs;
    this.retained[base + 1] = atSeconds;
    for (let index = 0; index < SECTION_COUNT; index++) this.retained[base + 2 + index] = this.current[index] ?? 0;
    this.retainedCursor = (this.retainedCursor + 1) % (this.retained.length / this.retainedStride);
    this.retainedCount = Math.min(this.retained.length / this.retainedStride, this.retainedCount + 1);
  }

  snapshot(): FrameSectionSnapshot {
    const rounded = (value: number): number => Number(value.toFixed(3));
    const sections = FRAME_SECTIONS.map((section, index) => ({
      section,
      meanMs: rounded(this.frames ? (this.totals[index] ?? 0) / this.frames : 0),
      maxMs: rounded(this.maxima[index] ?? 0),
      shareOfFrame: this.frameTotalMs > 0 ? Number(((this.totals[index] ?? 0) / this.frameTotalMs).toFixed(4)) : 0,
    })).sort((a, b) => b.shareOfFrame - a.shareOfFrame);

    const worst: LongFrameRecord[] = [];
    for (let slot = 0; slot < this.retainedCount; slot++) {
      const base = slot * this.retainedStride;
      const breakdown: Array<{ section: FrameSection; ms: number }> = [];
      for (let index = 0; index < SECTION_COUNT; index++) {
        const ms = this.retained[base + 2 + index] ?? 0;
        if (ms >= 0.2) breakdown.push({ section: FRAME_SECTIONS[index]!, ms: rounded(ms) });
      }
      breakdown.sort((a, b) => b.ms - a.ms);
      worst.push({
        frameMs: rounded(this.retained[base] ?? 0),
        atSeconds: rounded(this.retained[base + 1] ?? 0),
        sections: breakdown,
      });
    }
    worst.sort((a, b) => b.frameMs - a.frameMs);

    return {
      enabled: this.enabled,
      frames: this.frames,
      hitchThresholdMs: this.hitchThresholdMs,
      longFrames: this.longFrames,
      sections,
      worst,
    };
  }

  reset(): void {
    this.current.fill(0);
    this.totals.fill(0);
    this.maxima.fill(0);
    this.retained.fill(0);
    this.retainedCount = 0;
    this.retainedCursor = 0;
    this.frames = 0;
    this.longFrames = 0;
    this.frameTotalMs = 0;
  }
}
