import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { EnvironmentalLightingRig } from './EnvironmentalLighting';
import { EnvironmentalDepthRig } from './EnvironmentalDepth';
import {
  CINEMATIC_LIGHT_GRADE_SHADER,
  CinematicMaterialPolish,
  resolveCinematicLightPolish,
} from './CinematicLightPolish';

/**
 * Final GODBOX image pipeline.
 *
 * Lighting and atmospheric depth remain renderer state and run at every quality tier. Higher tiers
 * additionally receive contact-sized AO, restrained emissive bloom and a tiny HDR-space grade that
 * protects shadow information without replacing ACES or turning the world into a colour filter.
 * The DOM/UI never enters this chain.
 */
export class EcologyPostProcessing {
  private readonly composer?: EffectComposer;
  private readonly ssao?: SSAOPass;
  private readonly bloom?: UnrealBloomPass;
  private readonly grade?: ShaderPass;
  private readonly output?: OutputPass;
  private readonly environmentalLighting: EnvironmentalLightingRig;
  private readonly environmentalDepth: EnvironmentalDepthRig;
  private readonly materialPolish: CinematicMaterialPolish;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera, private readonly quality: 0 | 1 | 2) {
    // These three rigs are scene presentation, not optional effects. Even the lowest render preset
    // therefore keeps the same sun/sky/material art direction; only SSAO/bloom/grade are omitted.
    this.environmentalLighting = new EnvironmentalLightingRig(renderer, scene);
    this.environmentalDepth = new EnvironmentalDepthRig(scene, camera);
    this.materialPolish = new CinematicMaterialPolish(scene);
    if (quality === 0) return;

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    if (quality === 2) {
      this.ssao = new SSAOPass(scene, camera, 1, 1, 16);
      // Initial values are immediately replaced from the cinematic resolver on the first frame.
      // Keeping them contact-sized here also makes static preview tools sane before render().
      this.ssao.kernelRadius = 2.1;
      this.ssao.minDistance = 0.0012;
      this.ssao.maxDistance = 0.04;
      this.composer.addPass(this.ssao);
    }

    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.08, 0.4, 1.18);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(CINEMATIC_LIGHT_GRADE_SHADER);
    this.composer.addPass(this.grade);

    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  resize(width: number, height: number): void {
    this.composer?.setSize(width, height);
    if (this.ssao) {
      const aoScale = this.renderer.getPixelRatio() * 0.65;
      this.ssao.setSize(Math.max(2, Math.round(width * aoScale)), Math.max(2, Math.round(height * aoScale)));
    }
    const scale = this.renderer.getPixelRatio() * (this.quality === 1 ? 0.5 : 1);
    this.bloom?.setSize(Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale)));
  }

  render(night: number): void {
    const lighting = this.environmentalLighting.update(night);
    if (lighting) {
      this.environmentalDepth.update(lighting);
      const polish = resolveCinematicLightPolish(lighting);
      this.materialPolish.update(lighting, polish);

      if (this.ssao) {
        // AO now stays at the scale of contact shadows. The first Step-2 screenshots showed broad
        // kernels reading as black painted patches on steep terrain, particularly at golden hour.
        this.ssao.kernelRadius = polish.aoKernelRadius;
        this.ssao.minDistance = 0.001;
        this.ssao.maxDistance = polish.aoMaxDistance;
      }

      if (this.bloom) {
        this.bloom.strength = polish.bloomStrength;
        this.bloom.threshold = polish.bloomThreshold;
        this.bloom.radius = polish.bloomRadius;
      }

      if (this.grade) {
        this.grade.uniforms['shadowLift']!.value = polish.shadowLift;
        this.grade.uniforms['coolShadow']!.value = polish.coolShadow;
        this.grade.uniforms['warmRestraint']!.value = polish.warmRestraint;
        this.grade.uniforms['saturation']!.value = polish.saturation;
      }
    }

    if (!this.composer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render();
  }

  dispose(): void {
    this.ssao?.dispose();
    this.bloom?.dispose();
    this.grade?.dispose();
    this.output?.dispose();
    this.composer?.dispose();
  }
}
