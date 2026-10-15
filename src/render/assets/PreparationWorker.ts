/** One owner-scoped worker. Jobs are sent one at a time so scene bursts do not clone an unbounded backlog. */
export class PreparationWorker {
  static factory?: () => Worker;
  private worker?: Worker;
  private queue: { payload: unknown; transfer: Transferable[]; valid?: () => boolean; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  private active?: (typeof this.queue)[number];
  private stopped = false;
  private timeout?: ReturnType<typeof setTimeout>;
  static available(): boolean { return typeof window !== 'undefined' && !!this.factory && typeof Worker !== 'undefined'; }
  run<T>(payload: unknown, transfer: Transferable[] = [], valid?: () => boolean): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('Preparation worker is closed'));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ payload, transfer, valid, resolve: value => resolve(value as T), reject });
      this.pump();
    });
  }
  private pump(): void {
    this.prune();
    if (this.active || !this.queue.length || this.stopped) return;
    try {
      if (!this.worker) {
        this.worker = PreparationWorker.factory!();
        this.worker.onmessage = event => {
          clearTimeout(this.timeout);
          const job = this.active;
          this.active = undefined;
          if (event.data.error) job?.reject(new Error(event.data.error)); else job?.resolve(event.data.result);
          this.pump();
        };
        this.worker.onerror = event => { event.preventDefault(); this.fail(new Error(event.message || 'Preparation worker failed')); };
        this.worker.onmessageerror = () => this.fail(new Error('Preparation worker response could not be read'));
      }
      this.active = this.queue.shift()!;
      this.worker.postMessage(this.active.payload, this.active.transfer);
      this.timeout = setTimeout(() => this.fail(new Error('Preparation worker timed out')), 120000);
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }
  prune(): void {
    this.queue = this.queue.filter(job => {
      if (!job.valid || job.valid()) return true;
      const error = new Error('Preparation superseded'); error.name = 'AbortError';
      for (const transferable of job.transfer) if (typeof ImageBitmap !== 'undefined' && transferable instanceof ImageBitmap) transferable.close();
      job.reject(error); return false;
    });
  }
  private fail(error: Error): void {
    this.stopped = true;
    clearTimeout(this.timeout);
    this.worker?.terminate();
    const jobs = [...(this.active ? [this.active] : []), ...this.queue.splice(0)];
    this.active = undefined;
    for (const job of jobs) {
      for (const transferable of job.transfer) if (typeof ImageBitmap !== 'undefined' && transferable instanceof ImageBitmap) transferable.close();
      job.reject(error);
    }
  }
  dispose(): void { this.fail(new Error('Preparation cancelled')); }
}
