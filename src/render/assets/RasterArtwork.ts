import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasmUrl from '@resvg/resvg-wasm/index_bg.wasm?url';
import { facadeArtwork } from '../architecture/FacadeSvg';
import type { FacadePlan } from '../architecture/FacadePlan';

let initialized: Promise<void> | undefined;

/** Entire SVG decode and channel packing stays inside the art worker. */
export async function rasterArtwork(plan: FacadePlan, size: number): Promise<ImageBitmap[]> {
  await (initialized ??= initWasm(fetch(wasmUrl)));
  const artwork = facadeArtwork(plan), width = size * 2;
  const render = (layer: 'albedo' | 'surface' | 'relief' | 'mask' | 'openings'): Uint8ClampedArray<ArrayBuffer> => {
    const renderer = new Resvg(artwork[layer], { font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: width } });
    try {
      const image = renderer.render();
      try {
        if (image.width !== width || image.height !== size) throw new Error('SVG raster resolution mismatch');
        return new Uint8ClampedArray(image.pixels);
      } finally { image.free(); }
    } finally { renderer.free(); }
  };
  const pixels = render('surface');
  for (const layer of ['relief', 'mask', 'openings'] as const) {
    const source = render(layer);
    for (let i = 0; i < pixels.length; i += 4) {
      if (layer === 'relief') pixels[i + 3] = 128 + (source[i]! >> 1);
      else if (layer === 'mask') pixels[i + 1] = source[i + 1]!;
      else pixels[i + 2] = source[i]!;
    }
  }
  const canvas = new OffscreenCanvas(width, size), context = canvas.getContext('2d')!;
  const options: ImageBitmapOptions = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  context.putImageData(new ImageData(pixels, width, size), 0, 0);
  const surface = await createImageBitmap(canvas, options);
  try {
    context.putImageData(new ImageData(render('albedo'), width, size), 0, 0);
    const albedo = await createImageBitmap(canvas, options);
    return [albedo, surface];
  } catch (error) { surface.close(); throw error; }
}
