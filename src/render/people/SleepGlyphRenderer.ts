import * as THREE from 'three';
import { stableRestUnit } from './RestChoreography';

export function sleepGlyphSample(seconds: number, seed: number, index: number, reducedMotion: boolean) {
  const phase = reducedMotion ? 0.45 : ((seconds / 4.8 + seed + index / 3) % 1 + 1) % 1;
  return { rise: reducedMotion ? index * 0.055 : phase * 0.32,
    drift: reducedMotion ? index * 0.035 : Math.sin(phase * Math.PI * 0.8) * 0.12,
    scale: 0.065 + phase * 0.055,
    opacity: reducedMotion ? (index === 0 ? 0.55 : 0) : Math.sin(Math.PI * phase) ** 2 * 0.65 };
}

/** Fixed pool; head anchors come from the actual reclining pose, never the standing body. */
export class SleepGlyphRenderer {
  readonly group = new THREE.Group();
  private readonly texture: THREE.CanvasTexture;
  private readonly sprites: THREE.Sprite[] = [];
  private count = 0;
  private seconds = 0;
  private reducedMotion = false;
  private readonly camera = new THREE.Vector3();

  constructor() {
    this.group.name = 'Sleeping breath Zs';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'italic 600 88px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 5; ctx.strokeStyle = '#344653'; ctx.fillStyle = '#d7e5ef';
    ctx.strokeText('z', 64, 60); ctx.fillText('z', 64, 60);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 24; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture,
        transparent: true, depthTest: true, depthWrite: false, toneMapped: false }));
      sprite.visible = false;
      this.sprites.push(sprite); this.group.add(sprite);
    }
  }

  beginFrame(seconds: number, camera: THREE.Vector3, reducedMotion: boolean, suppressed: boolean): void {
    this.count = 0; this.seconds = seconds; this.camera.copy(camera); this.reducedMotion = reducedMotion;
    this.group.visible = !suppressed;
    for (const sprite of this.sprites) sprite.visible = false;
  }

  draw(id: string, x: number, y: number, z: number, size: number, blend: number): void {
    const distance = Math.hypot(x - this.camera.x, y - this.camera.y, z - this.camera.z);
    if (distance >= 16 || blend <= 0.8 || this.count + 3 > this.sprites.length) return;
    const visibility = Math.min(1, (16 - distance) / 4) * Math.min(1, (blend - 0.8) / 0.2);
    const seed = stableRestUnit(`${id}:sleep-breath`);
    for (let i = 0; i < 3; i++) {
      const sprite = this.sprites[this.count++]!;
      const sample = sleepGlyphSample(this.seconds, seed, i, this.reducedMotion);
      sprite.visible = true;
      sprite.position.set(x + sample.drift * size, y + (0.15 + sample.rise) * size, z);
      sprite.scale.setScalar(sample.scale * size);
      sprite.material.opacity = sample.opacity * visibility;
    }
  }

  dispose(): void {
    for (const sprite of this.sprites) sprite.material.dispose();
    this.texture.dispose(); this.group.clear();
  }
}
