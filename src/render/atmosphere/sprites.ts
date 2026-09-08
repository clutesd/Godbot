import * as THREE from 'three';

let softSprite: THREE.Texture | undefined;

/**
 * A soft round sprite. Every point cloud in the scene needs one; the default square point reads
 * as a pane of glass floating in front of the landscape.
 */
export function softPointTexture(): THREE.Texture {
  if (softSprite) return softSprite;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  softSprite = new THREE.CanvasTexture(canvas);
  softSprite.colorSpace = THREE.SRGBColorSpace;
  return softSprite;
}
