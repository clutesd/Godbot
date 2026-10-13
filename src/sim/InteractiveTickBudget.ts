/**
 * Main-thread budget for interactive history catch-up.
 * It never skips or reorders simulation months: it only decides whether another atomic month
 * should begin in the current rendered frame or remain in the accumulator for a later frame.
 */
/** Smallest per-frame share a sliced month receives, so progress never depends on headroom alone. */
const MINIMUM_SLICE_MS = 1.5;

export class InteractiveTickBudget {
  private estimateMs = 1;
  private frameEstimateMs = 0;
  private firstTickDeferrals = 0;

  constructor(
    readonly frameBudgetMs = 4,
    private readonly safetyMultiplier = 1.2,
    private readonly targetFrameMs = 1000 / 60,
    private readonly frameGuardMs = 1.5,
    private readonly maxFirstTickDeferrals = 2,
  ) {}

  get estimatedTickMs(): number { return this.estimateMs; }
  get estimatedFrameMs(): number { return this.frameEstimateMs; }

  deadline(nowMs: number): number {
    const available = this.frameEstimateMs > 0
      ? Math.max(0.75, this.targetFrameMs - this.frameEstimateMs - this.frameGuardMs)
      : this.frameBudgetMs;
    return nowMs + Math.min(this.frameBudgetMs, available);
  }

  /**
   * Deadline for time-sliced months. History gets the larger of the frame's spare headroom and the
   * work its pacing actually needs this frame (expected month cost x months due per frame, doubled
   * at most while backlog is being repaid), capped by `frameBudgetMs`. A renderer that already
   * overruns its frame therefore cannot starve history, and history can never take a large stall:
   * the month's cost is spread evenly over the frames it spans instead of landing on one.
   */
  sliceDeadline(nowMs: number, monthsPerSecond: number, frameSeconds: number, backlogMonths: number): number {
    const headroom = this.frameEstimateMs > 0
      ? this.targetFrameMs - this.frameEstimateMs - this.frameGuardMs
      : this.frameBudgetMs;
    const paced = this.estimateMs * Math.max(0, monthsPerSecond) * Math.max(0, frameSeconds)
      * (1 + Math.min(1, Math.max(0, backlogMonths)));
    return nowMs + Math.min(this.frameBudgetMs, Math.max(MINIMUM_SLICE_MS, headroom, paced));
  }

  canStart(nowMs: number, deadlineMs: number, completedTicks: number): boolean {
    const predicted = Math.max(0.25, this.estimateMs * this.safetyMultiplier);
    if (completedTicks === 0) {
      const projectedFrame = this.frameEstimateMs + predicted + this.frameGuardMs;
      if (this.frameEstimateMs > 0 && projectedFrame > this.targetFrameMs && this.firstTickDeferrals < this.maxFirstTickDeferrals) {
        this.firstTickDeferrals += 1;
        return false;
      }
      // Never starve authoritative history. After a short smoothness deferral, one atomic month is
      // allowed through even under sustained load; all remaining catch-up stays budgeted.
      this.firstTickDeferrals = 0;
      return true;
    }
    return nowMs + predicted <= deadlineMs;
  }

  observe(elapsedMs: number): void {
    if (!(elapsedMs >= 0) || !Number.isFinite(elapsedMs)) return;
    const bounded = Math.min(100, Math.max(0.05, elapsedMs));
    // React quickly to a spike so the next frame does not compound it, then recover gradually.
    const weight = bounded > this.estimateMs ? 0.45 : 0.12;
    this.estimateMs += (bounded - this.estimateMs) * weight;
  }

  /**
   * Observe non-simulation main-thread work from a completed frame. This does not alter simulation
   * state; it only decides how aggressively accumulated months may be scheduled on following frames.
   */
  observeFrame(elapsedMs: number): void {
    if (!(elapsedMs >= 0) || !Number.isFinite(elapsedMs)) return;
    const bounded = Math.min(100, Math.max(0.05, elapsedMs));
    if (this.frameEstimateMs === 0) {
      this.frameEstimateMs = bounded;
      return;
    }
    const weight = bounded > this.frameEstimateMs ? 0.28 : 0.08;
    this.frameEstimateMs += (bounded - this.frameEstimateMs) * weight;
  }
}
