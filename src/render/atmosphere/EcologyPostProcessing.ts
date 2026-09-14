import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AERIAL_PERSPECTIVE_SHADER, updateAerialPerspectivePass } from './AerialPerspective';
import { DirectionalAtmosphereRig } from './AtmosphericScattering';
import { EnvironmentFrameRig } from './EnvironmentFrameState';
import { EnvironmentalDepthRig } from './EnvironmentalDepth';
import type { LowMistField } from './LowMistField';
import {
  CINEMATIC_LIGHT_GRADE_SHADER,
  CinematicMaterialPolish,
  resolveCinematicLightPolish,
} from './CinematicLightPolish';

/**
 * Final GODBOX image pipeline.
 *
 * Every renderer-side environmental consumer receives one EnvironmentFrameState. Clear-air aerial
 * perspective and terrain/water-aware low mist now resolve in the same depth-aware pass, so local
 * moisture can create visible layers without turning the whole camera volume grey.
 */
export class EcologyPostProcessing {
  private readonly composer?: EffectComposer;
  private readonly aerialPerspective?: ShaderPass;
  private readonly ssao?: SSAOPass;
  private readonly bloom?: UnrealBloomPass;
  private readonly grade?: ShaderPass;
  private readonly output?: OutputPass;
  private readonly environmentFrame: EnvironmentFrameRig;
  private readonly directionalAtmosphere: DirectionalAtmosphereRig;
  private readonly environmentalDepth: EnvironmentalDepthRig;
  private readonly materialPolish: CinematicMaterialPolish;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera, private readonly quality: 0 | 1 | 2,
    private readonly lowMistField: LowMistField) {
    this.environmentFrame = new EnvironmentFrameRig(renderer, scene);
    this.directionalAtmosphere = new DirectionalAtmosphereRig(scene);
    this.environmentalDepth = new EnvironmentalDepthRig(scene, camera);
    this.materialPolish = new CinematicMaterialPolish(scene);
    if (quality === 0) return;

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    // The first atmospheric pass only affected the sky dome, which made it nearly invisible in the
    // supplied top-down mobile shots. Retain scene depth so air can exist between camera and world.
    target.depthBuffer = true;
    target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    target.depthTexture.format = THREE.DepthFormat;

    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    // This must immediately follow RenderPass because that target owns the authoritative scene
    // depth for the frame. Later full-screen passes only need the already-scattered colour.
    this.aerialPerspective = new ShaderPass(AERIAL_PERSPECTIVE_SHADER);
    this.composer.addPass(this.aerialPerspective);

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
      const scattering = this.directionalAtmosphere.update(frame);
      const depthState = this.environmentalDepth.update(frame);
      const polish = resolveCinematicLightPolish(frame);
      this.materialPolish.update(frame, polish);

      if (this.aerialPerspective && this.composer && scattering) {
        // RenderPass writes into the composer's current read buffer. Bind that exact depth texture
        // before the pass chain executes; EffectComposer may swap buffers between frames.
        updateAerialPerspectivePass(
          this.aerialPerspective,
          frame,
          scattering,
          depthState,
          this.lowMistField,
          this.camera,
          this.composer.readBuffer.depthTexture,
        );
      }

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
    this.aerialPerspective?.dispose();
    this.ssao?.dispose();
    this.bloom?.dispose();
    this.grade?.dispose();
    this.output?.dispose();
    this.composer?.dispose();
  }
}
