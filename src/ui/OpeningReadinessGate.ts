export interface OpeningReadinessOptions {
  settleFrame: () => void;
  nextFrame: () => Promise<void>;
  onReady: () => void;
  reveal: () => void;
  delay: (milliseconds: number) => Promise<void>;
  reducedMotion?: boolean;
  settleFrames?: number;
  revealLeadMs?: number;
}

export const DEFAULT_OPENING_SETTLE_FRAMES = 3;
export const DEFAULT_OPENING_REVEAL_LEAD_MS = 550;

/**
 * Final presentation barrier between "the world exists" and "the documentary starts".
 *
 * The caller must complete world construction, archive setup and shader warmup before entering this
 * gate. The gate renders stationary zero-time frames, paints the ready state, then begins the
 * opening fade before observer time is allowed to advance.
 */
export async function runOpeningReadinessGate(options: OpeningReadinessOptions): Promise<void> {
  const settleFrames = Math.max(1, Math.floor(options.settleFrames ?? DEFAULT_OPENING_SETTLE_FRAMES));
  for (let frame = 0; frame < settleFrames; frame += 1) {
    options.settleFrame();
    await options.nextFrame();
  }

  options.onReady();
  // Guarantee the ready state itself is painted before the overlay begins to leave.
  await options.nextFrame();
  options.reveal();

  const revealLeadMs = options.reducedMotion
    ? 0
    : Math.max(0, options.revealLeadMs ?? DEFAULT_OPENING_REVEAL_LEAD_MS);
  if (revealLeadMs > 0) await options.delay(revealLeadMs);
}
