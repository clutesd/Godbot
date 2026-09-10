import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** HDR luminance selection: ordinary diffuse surfaces stay below the bloom threshold.
 * The DOM/UI never enters this chain. No duplicate scene or per-object material swapping. */
export class EcologyPostProcessing {
  private readonly composer?: EffectComposer;
  private readonly bloom?: UnrealBloomPass;
  private readonly output?: OutputPass;
  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera, private readonly quality: 0 | 1 | 2) {
    if (quality === 0) return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.45, 1.15);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }
  resize(width: number, height: number): void {
    this.composer?.setSize(width, height);
    const scale = this.renderer.getPixelRatio() * (this.quality === 1 ? 0.5 : 1);
    // UnrealBloom's first mip halves this again: quarter- or half-resolution bloom.
    this.bloom?.setSize(Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale)));
  }
  render(night: number): void {
    if (!this.composer) { this.renderer.render(this.scene, this.camera); return; }
    if (this.bloom) this.bloom.strength = 0.08 + night * 0.23;
    this.composer.render();
  }
  dispose(): void { this.bloom?.dispose(); this.output?.dispose(); this.composer?.dispose(); }
}
