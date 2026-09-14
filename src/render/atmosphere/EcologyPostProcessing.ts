import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { EnvironmentFrameRig } from './EnvironmentFrameState';
import { EnvironmentalDepthRig } from './EnvironmentalDepth';
import {
  CINEMATIC_LIGHT_GRADE_SHADER,
  CinematicMaterialPolish,
  resolveCinematicLightPolish,
} from './CinematicLightPolish';

/**
 * Final GODBOX image pipeline.
 *
 * Every renderer-side environmental consumer now receives one EnvironmentFrameState. Legacy
 * day/night, weather and catastrophe presentation may author source signals earlier in the frame,
 * but this pipeline is the single final authority for lights, exposure, depth and material polish.
 */
export class EcologyPostProcessing {
  private readonly composer?: EffectComposer;
  private readonly ssao?: SSAOPass;
  private readonly bloom?: UnrealBloomPass;
  private readonly grade?: ShaderPass;
  private readonly output?: OutputPass;
  private readonly environmentFrame: EnvironmentFrameRig;
  private readonly environmentalDepth: EnvironmentalDepthRig;
  private readonly materialPolish: CinematicMaterialPolish;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera, private readonly quality: 0 | 1 | 2) {
    this.environmentFrame = new EnvironmentFrameRig(renderer, scene);
    this.environmentalDepth = new EnvironmentalDepthRig(scene, camera);
    this.materialPolish = new CinematicMaterialPolish(scene);
    if (quality === 0) return;

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    if (quality === 2) {
      this.ssao = new SSAOPass(scene, camera, 1, 1, 16);
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
    const frame = this.environmentFrame.update(night);
    if (frame) {
      this.environmentalDepth.update(frame);
      const polish = resolveCinematicLightPolish(frame);
      this.materialPolish.update(frame, polish);

      if (this.ssao) {
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
