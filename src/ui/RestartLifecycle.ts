export interface AtomicRestartOptions {
  seed: string;
  /** Paint an opaque transition before releasing the old scene. */
  coverCurrent?: () => Promise<void>;
  retireCurrent: () => void;
  beginFresh: (seed: string) => Promise<void>;
  setBusy: (busy: boolean) => void;
  onFailure: (error: unknown) => void;
}

/**
 * Browser-level restart contract: cover the scene, retire it synchronously, then construct a fresh
 * Arrival observation. Long-running archive work belongs behind retireCurrent and must never be
 * awaited here.
 */
export async function performAtomicRestart(options: AtomicRestartOptions): Promise<void> {
  options.setBusy(true);
  try {
    if (options.coverCurrent) await options.coverCurrent();
    options.retireCurrent();
    await options.beginFresh(options.seed);
  } catch (error) {
    options.onFailure(error);
    throw error;
  } finally {
    options.setBusy(false);
  }
}
