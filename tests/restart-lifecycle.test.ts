import { describe, expect, it, vi } from 'vitest';
import { performAtomicRestart } from '../src/ui/RestartLifecycle';

describe('atomic browser restart lifecycle', () => {
  it('retires the old observation before constructing the fresh Arrival world', async () => {
    const order: string[] = [];
    const busy: boolean[] = [];

    await performAtomicRestart({
      seed: 'new-world',
      retireCurrent: () => { order.push('retire'); },
      beginFresh: async (seed) => { order.push(`begin:${seed}`); },
      setBusy: value => { busy.push(value); },
      onFailure: vi.fn(),
    });

    expect(order).toEqual(['retire', 'begin:new-world']);
    expect(busy).toEqual([true, false]);
  });

  it('does not wait for background archive finalization before beginning the new world', async () => {
    const order: string[] = [];
    let releaseArchive!: () => void;
    const archive = new Promise<void>(resolve => { releaseArchive = resolve; });

    await performAtomicRestart({
      seed: 'arrival-now',
      retireCurrent: () => {
        order.push('retire');
        void archive.then(() => { order.push('archive-finished'); });
      },
      beginFresh: async () => { order.push('begin-fresh'); },
      setBusy: () => undefined,
      onFailure: vi.fn(),
    });

    expect(order).toEqual(['retire', 'begin-fresh']);
    releaseArchive();
    await archive;
    await Promise.resolve();
    expect(order).toEqual(['retire', 'begin-fresh', 'archive-finished']);
  });

  it('reports construction failures and always releases the busy state', async () => {
    const failure = new Error('renderer warmup failed');
    const busy: boolean[] = [];
    const onFailure = vi.fn();

    await expect(performAtomicRestart({
      seed: 'broken-world',
      retireCurrent: () => undefined,
      beginFresh: async () => { throw failure; },
      setBusy: value => { busy.push(value); },
      onFailure,
    })).rejects.toThrow('renderer warmup failed');

    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(busy).toEqual([true, false]);
  });
});
