import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { PreparationWorker } from '../src/render/assets/PreparationWorker';
import { FacadeTextureCache } from '../src/render/architecture/FacadeTextures';
import { BROWSER_CATALOGUE } from '../src/dev/architectureBrowserModel';
import { constructionArtConfig } from '../src/dev/constructionArtCases';

const owners: { dispose(): void }[] = [];
afterEach(() => {
  owners.splice(0).forEach(owner => owner.dispose());
  PreparationWorker.factory = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function setup() {
  const builder = new AssetBuilder('svg-recovery', { backgroundPreparation: false }); owners.push(builder);
  const config = constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === 'granary')!, 'medieval', 'stone');
  const source = builder.getAsset('building', config).mesh;
  const root = new THREE.Group(); root.userData = { ...source.userData };
  const decode = vi.fn(async () => {});
  vi.stubGlobal('window', {}); vi.stubGlobal('Worker', class {});
  vi.stubGlobal('OffscreenCanvas', class {}); vi.stubGlobal('createImageBitmap', vi.fn());
  vi.stubGlobal('Image', class {
    naturalWidth = 128; naturalHeight = 64; src = ''; decode = decode; removeAttribute() {}
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    fillRect: vi.fn(), drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(128 * 64 * 4) }), putImageData: vi.fn(),
  }) }) });
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const fake = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null, onmessageerror: null as (() => void) | null };
  PreparationWorker.factory = () => fake as unknown as Worker;
  const cache = new FacadeTextureCache(4, 64); owners.push(cache);
  cache.apply(root); cache.warmArtwork();
  return { cache, fake, decode, revoke };
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

describe('SVG worker recovery', () => {
  it.each(['response', 'crash', 'message', 'timeout'] as const)('recovers through browser decoding after a bounded %s failure', async failure => {
    vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { cache, fake, decode, revoke } = setup();
    expect(fake.postMessage).toHaveBeenCalledOnce();
    if (failure === 'response') fake.onmessage!({ data: { error: 'raster failed' } } as MessageEvent);
    if (failure === 'crash') fake.onerror!({ preventDefault() {}, message: 'crashed' } as ErrorEvent);
    if (failure === 'message') fake.onmessageerror!();
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(120000);
    await flush();
    expect(cache.stats()).toMatchObject({ ready: 1, failed: 0, pending: 0 });
    expect(decode).toHaveBeenCalledTimes(5); expect(revoke).toHaveBeenCalledTimes(5);
    expect(fake.postMessage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels pending rasterization on disposal without decoding or retaining entries', async () => {
    const { cache, fake, decode } = setup();
    cache.dispose(); await flush();
    expect(fake.terminate).toHaveBeenCalledOnce(); expect(decode).not.toHaveBeenCalled();
    expect(cache.stats()).toMatchObject({ entries: 0, pending: 0 });
  });
  it('closes late bitmap results after disposal', async () => {
    const { cache, fake, decode } = setup();
    const images = [{ close: vi.fn() }, { close: vi.fn() }];
    fake.onmessage!({ data: { result: images } } as MessageEvent);
    cache.dispose(); await flush();
    images.forEach(image => expect(image.close).toHaveBeenCalledOnce());
    expect(decode).not.toHaveBeenCalled(); expect(cache.stats().entries).toBe(0);
  });
  it('reports browser decoding failure and still releases its object URL', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cache, fake, decode, revoke } = setup();
    decode.mockRejectedValue(new Error('decoder unavailable'));
    fake.onmessage!({ data: { error: 'worker unavailable' } } as MessageEvent); await flush();
    expect(cache.stats()).toMatchObject({ ready: 0, failed: 1, pending: 0 });
    expect(revoke).toHaveBeenCalledOnce();
  });
});
