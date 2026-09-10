import * as THREE from 'three';

let softSprite: THREE.Texture | undefined;

/**
 * A soft round sprite. Every point cloud in the scene needs one; the default square point reads
 * as a pane of glass floating in front of the landscape.
 */
export function softPointTexture(): THREE.Texture {
  if (softSprite) return softSprite;
  const size = 64;
  // Same radial stops as the canvas version, without a DOM dependency in headless renderer tests.
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
    const alpha = radius < 0.45 ? 1 - radius / 0.45 * 0.3 : Math.max(0, (1 - radius) / 0.55 * 0.7);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(alpha * 255);
  }
  softSprite = new THREE.DataTexture(pixels, size, size);
  softSprite.minFilter = softSprite.magFilter = THREE.LinearFilter;
  softSprite.needsUpdate = true;
  softSprite.colorSpace = THREE.SRGBColorSpace;
  return softSprite;
}
