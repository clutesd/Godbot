export type TickPhase =
  | 'weather'
  | 'environment'
  | 'survival-planning'
  | 'resources'
  | 'economy'
  | 'knowledge-month'
  | 'transport-trade'
  | 'survival-resolution'
  | 'people'
  | 'wars'
  | 'migration'
  | 'annual-society'
  | 'advanced-month'
  | 'advanced-year'
  | 'bookkeeping'
  | 'history-trim';

export interface TickPhaseStats {
  count: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  lastMs: number;
}

export interface TickPerformanceSnapshot {
  enabled: boolean;
  sampleWindow: number;
  tickCount: number;
  total: TickPhaseStats;
  annual: TickPhaseStats;
  ordinary: TickPhaseStats;
  phases: Partial<Record<TickPhase, TickPhaseStats>>;
  slowestTicks: Array<{ month: number; annual: boolean; totalMs: number; phases: Partial<Record<TickPhase, number>> }>;
}

interface TickSample {
  month: number;
  annual: boolean;
  totalMs: number;
  phases: Partial<Record<TickPhase, number>>;
}

const now = (): number => globalThis.performance?.now?.() ?? Date.now();
const rounded = (value: number): number => Number(value.toFixed(3));

function stats(values: readonly number[]): TickPhaseStats {
  if (values.length === 0) return { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0, lastMs: 0 };
  const ordered = [...values].sort((a, b) => a - b);
  const p95Index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * 0.95) - 1));
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    meanMs: rounded(total / values.length),
    p95Ms: rounded(ordered[p95Index] ?? 0),
    maxMs: rounded(ordered[ordered.length - 1] ?? 0),
    lastMs: rounded(values[values.length - 1] ?? 0),
  };
}

/**
 * Bounded, diagnostic-only timing for authoritative monthly ticks.
 * It never changes tick order, simulation inputs, random draws, pacing, or state.
 */
export class TickProfiler {
  private enabled = false;
  private readonly samples: TickSample[] = [];
  private phases: Partial<Record<TickPhase, number>> = {};

  constructor(private readonly sampleWindow = 360) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.phases = {};
  }

  get isEnabled(): boolean { return this.enabled; }

  reset(): void {
    this.samples.length = 0;
    this.phases = {};
  }

  start(): number {
    return this.enabled ? now() : 0;
  }

  record(phase: TickPhase, startedAt: number): void {
    if (!this.enabled) return;
    const elapsed = Math.max(0, now() - startedAt);
    this.phases[phase] = (this.phases[phase] ?? 0) + elapsed;
  }

  finish(month: number, annual: boolean, startedAt: number): void {
    if (!this.enabled) return;
    this.samples.push({ month, annual, totalMs: Math.max(0, now() - startedAt), phases: this.phases });
    this.phases = {};
    if (this.samples.length > this.sampleWindow) this.samples.splice(0, this.samples.length - this.sampleWindow);
  }

  snapshot(): TickPerformanceSnapshot {
    const totalValues = this.samples.map((sample) => sample.totalMs);
    const annualValues = this.samples.filter((sample) => sample.annual).map((sample) => sample.totalMs);
    const ordinaryValues = this.samples.filter((sample) => !sample.annual).map((sample) => sample.totalMs);
    const phases: Partial<Record<TickPhase, TickPhaseStats>> = {};
    const phaseNames: TickPhase[] = [
      'weather', 'environment', 'survival-planning', 'resources', 'economy', 'knowledge-month',
      'transport-trade', 'survival-resolution', 'people', 'wars', 'migration', 'annual-society',
      'advanced-month', 'advanced-year', 'bookkeeping', 'history-trim',
    ];
    for (const phase of phaseNames) {
      const values = this.samples.map((sample) => sample.phases[phase]).filter((value): value is number => value !== undefined);
      if (values.length > 0) phases[phase] = stats(values);
    }
    return {
      enabled: this.enabled,
      sampleWindow: this.sampleWindow,
      tickCount: this.samples.length,
      total: stats(totalValues),
      annual: stats(annualValues),
      ordinary: stats(ordinaryValues),
      phases,
      slowestTicks: [...this.samples]
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, 8)
        .map((sample) => ({
          month: sample.month,
          annual: sample.annual,
          totalMs: rounded(sample.totalMs),
          phases: Object.fromEntries(Object.entries(sample.phases).map(([phase, value]) => [phase, rounded(value ?? 0)])) as Partial<Record<TickPhase, number>>,
        })),
    };
  }
}
