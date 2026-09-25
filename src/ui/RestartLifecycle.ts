export interface AtomicRestartOptions {
  seed: string;
  retireCurrent: () => void;
  beginFresh: (seed: string) => Promise<void>;
  setBusy: (busy: boolean) => void;
  onFailure: (error: unknown) => void;
}

/**
 * Browser-level restart contract: retire the old observation synchronously, then construct a fresh
 * Arrival observation. Long-running archive work belongs behind retireCurrent and must never be
 * awaited here.
 */
export async function performAtomicRestart(options: AtomicRestartOptions): Promise<void> {
  options.setBusy(true);
  try {
    options.retireCurrent();
    await options.beginFresh(options.seed);
  } catch (error) {
    options.onFailure(error);
    throw error;
  } finally {
    options.setBusy(false);
  }
}
