/**
 * Main-thread budget for interactive history catch-up.
 * It never skips or reorders simulation months: it only decides whether another atomic month
 * should begin in the current rendered frame or remain in the accumulator for a later frame.
 */
export class InteractiveTickBudget {
  private estimateMs = 1;

  constructor(
    readonly frameBudgetMs = 4,
    private readonly safetyMultiplier = 1.2,
  ) {}

  get estimatedTickMs(): number { return this.estimateMs; }

  deadline(nowMs: number): number {
    return nowMs + this.frameBudgetMs;
  }

  canStart(nowMs: number, deadlineMs: number, completedTicks: number): boolean {
    if (completedTicks === 0) return true;
    const predicted = Math.max(0.25, this.estimateMs * this.safetyMultiplier);
    return nowMs + predicted <= deadlineMs;
  }

  observe(elapsedMs: number): void {
    if (!(elapsedMs >= 0) || !Number.isFinite(elapsedMs)) return;
    const bounded = Math.min(100, Math.max(0.05, elapsedMs));
    // React quickly to a spike so the next frame does not compound it, then recover gradually.
    const weight = bounded > this.estimateMs ? 0.45 : 0.12;
    this.estimateMs += (bounded - this.estimateMs) * weight;
  }
}
