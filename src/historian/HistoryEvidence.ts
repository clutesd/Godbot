import type { HistoricalEvent } from '../sim/types';

/** Published events are immutable. Index the appended prefix once, rather than scanning
 * the archive for every claim and every candidate. Retention/replay invalidate the prefix. */
export class HistoryEvidence {
  private history?: readonly HistoricalEvent[];
  private length = 0;
  private first?: HistoricalEvent;
  private last?: HistoricalEvent;
  private month = -1;
  private nextFutureMonth = Infinity;
  private readonly events = new Map<string, HistoricalEvent>();
  private readonly counts = new Map<HistoricalEvent['type'], number>();
  private readonly earliest = new Map<HistoricalEvent['type'], HistoricalEvent>();
  revision = 0;

  read(history: readonly HistoricalEvent[], month: number): this {
    const rebuild = history !== this.history || history.length < this.length || month < this.month
      || month >= this.nextFutureMonth
      || this.length > 0 && (history[0] !== this.first || history[this.length - 1] !== this.last);
    if (rebuild) {
      this.length = 0; this.events.clear(); this.counts.clear(); this.earliest.clear();
      this.nextFutureMonth = Infinity;
      this.revision++;
    }
    if (history.length > this.length) this.revision++;
    for (let index = this.length; index < history.length; index++) {
      const event = history[index]!;
      this.events.set(event.id, event);
      if (event.month > month) { this.nextFutureMonth = Math.min(this.nextFutureMonth, event.month); continue; }
      this.counts.set(event.type, (this.counts.get(event.type) ?? 0) + 1);
      const first = this.earliest.get(event.type);
      if (!first || event.month < first.month || event.month === first.month && event.id < first.id) this.earliest.set(event.type, event);
    }
    this.history = history; this.length = history.length;
    this.first = history[0]; this.last = history[history.length - 1]; this.month = month;
    return this;
  }

  event(id: string): HistoricalEvent | undefined { return this.events.get(id); }
  count(type: HistoricalEvent['type']): number { return this.counts.get(type) ?? 0; }
  isFirst(event: HistoricalEvent): boolean { return this.earliest.get(event.type)?.id === event.id; }
}
