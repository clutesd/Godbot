import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPENING_REVEAL_LEAD_MS,
  DEFAULT_OPENING_SETTLE_FRAMES,
  runOpeningReadinessGate,
} from '../src/ui/OpeningReadinessGate';

describe('cinematic opening readiness gate', () => {
  it('settles zero-time presentation frames before painting ready and revealing the world', async () => {
    const order: string[] = [];

    await runOpeningReadinessGate({
      settleFrame: () => { order.push('settle'); },
      nextFrame: async () => { order.push('paint'); },
      onReady: () => { order.push('ready'); },
      reveal: () => { order.push('reveal'); },
      delay: async milliseconds => { order.push(`delay:${milliseconds}`); },
    });

    expect(order).toEqual([
      ...Array.from({ length: DEFAULT_OPENING_SETTLE_FRAMES }, () => ['settle', 'paint']).flat(),
      'ready',
      'paint',
      'reveal',
      `delay:${DEFAULT_OPENING_REVEAL_LEAD_MS}`,
    ]);
  });

  it('keeps reduced-motion startup deterministic without an artificial reveal delay', async () => {
    const delay = vi.fn();

    await runOpeningReadinessGate({
      settleFrame: () => undefined,
      nextFrame: async () => undefined,
      onReady: () => undefined,
      reveal: () => undefined,
      delay,
      reducedMotion: true,
    });

    expect(delay).not.toHaveBeenCalled();
  });

  it('never allows a zero-frame settle configuration', async () => {
    const settleFrame = vi.fn();

    await runOpeningReadinessGate({
      settleFrame,
      nextFrame: async () => undefined,
      onReady: () => undefined,
      reveal: () => undefined,
      delay: async () => undefined,
      settleFrames: 0,
      revealLeadMs: 0,
    });

    expect(settleFrame).toHaveBeenCalledTimes(1);
  });
});
