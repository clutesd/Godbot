import * as THREE from 'three';
import type { EnvironmentalLightingState } from './EnvironmentalLighting';

export interface EnvironmentalDepthInput {
  daylight: number;
  twilight: number;
  weatherSoftening: number;
  baseFogDensity: number;
  cameraHeight: number;
}

export interface EnvironmentalDepthState {
  fogDensity: number;
  fogSkyBlend: number;
  valleyMistMultiplier: number;
  shadowHalfSpan: number;
  shadowNear: number;
  shadowFar: number;
  shadowBias: number;
  shadowNormalBias: number;
}

/**
 * Resolve the world-depth presentation from the same environmental state that drives sunlight.
 * This deliberately stays conservative: the objective is stronger scale separation and grounding,
 * not a theatrical fog filter. Severe weather can thicken the atmosphere, but clear scenes retain
 * crisp foreground detail and only gain enough haze to push distant ridges back.
 */
export function resolveEnvironmentalDepth(input: EnvironmentalDepthInput): EnvironmentalDepthState {
  const daylight = THREE.MathUtils.clamp(input.daylight, 0, 1);
  const twilight = THREE.MathUtils.clamp(input.twilight, 0, 1);
  const weather = THREE.MathUtils.clamp(input.weatherSoftening, 0, 1);
  const baseFog = Math.max(0, input.baseFogDensity);
  const cameraHeight = Math.max(0, input.cameraHeight);

  const clearAirFloor = 0.00035 + Math.min(0.00055, cameraHeight * 0.000006);
  const fogDensity = Math.min(0.075,
    baseFog * (0.9 + weather * 0.13 + (1 - daylight) * 0.045) + clearAirFloor,
  );
  const fogSkyBlend = THREE.MathUtils.clamp(0.16 + weather * 0.22 + twilight * 0.08, 0.12, 0.46);
  const valleyMistMultiplier = THREE.MathUtils.clamp(
    0.72 + twilight * 0.22 + weather * 0.28 + (1 - daylight) * 0.08,
    0.68,
    1.22,
  );

  // The old fixed +/-75 world-unit frustum spread 2048 shadow texels over far more terrain than
  // most documentary shots needed. Camera-aware coverage materially improves local texel density
  // while preserving enough context for wide landscape shots.
  const shadowHalfSpan = THREE.MathUtils.clamp(38 + cameraHeight * 0.26, 42, 64);

  return {
    fogDensity,
    fogSkyBlend,
    valleyMistMultiplier,
    shadowHalfSpan,
    shadowNear: 1,
    shadowFar: 190,
    shadowBias: -0.00055,
    shadowNormalBias: 0.022,
  };
}

/**
 * Renderer-only depth rig. It tightens and follows the sun's shadow camera around the current shot,
 * harmonizes exponential distance fog with the lighting palette, and modulates the existing
 * terrain-derived valley mist. It never mutates simulation state.
 */
export class EnvironmentalDepthRig {
  private readonly sun?: THREE.DirectionalLight;
  private readonly mist?: THREE.Mesh;
  private readonly forward = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly celestialOffset = new THREE.Vector3();
  private readonly lastAdjustedSunPosition = new THREE.Vector3();
  private hasAdjustedSun = false;
  private seasonalMistBase = 0.5;
  private lastAppliedMist = Number.NaN;

  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {
    const shadowLights: THREE.DirectionalLight[] = [];
    let mist: THREE.Mesh | undefined;
    scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight && object.castShadow) shadowLights.push(object);
      if (!mist && object instanceof THREE.Mesh && object.name === 'valley-mist') mist = object;
    });
    shadowLights.sort((a, b) => b.intensity - a.intensity);
    this.sun = shadowLights[0];
    this.mist = mist;
    if (this.sun && !this.sun.target.parent) this.scene.add(this.sun.target);
    if (this.mist?.material instanceof THREE.MeshBasicMaterial) {
      this.seasonalMistBase = this.mist.material.opacity;
      this.lastAppliedMist = this.mist.material.opacity;
    }
  }

  update(lighting: EnvironmentalLightingState): EnvironmentalDepthState {
    const fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : undefined;
    const baseFogDensity = fog?.density ?? 0;
    const state = resolveEnvironmentalDepth({
      daylight: lighting.daylight,
      twilight: lighting.twilight,
      weatherSoftening: lighting.weatherSoftening,
      baseFogDensity,
      cameraHeight: this.camera.position.y,
    });

    if (fog) {
      fog.density = state.fogDensity;
      fog.color.lerp(lighting.skyFillColor, state.fogSkyBlend);
    }

    this.updateValleyMist(state, lighting);
    this.updateShadowFocus(state);

    this.scene.userData['environmentDepth'] = {
      fogDensity: state.fogDensity,
      valleyMistMultiplier: state.valleyMistMultiplier,
      shadowHalfSpan: state.shadowHalfSpan,
      shadowBias: state.shadowBias,
      shadowNormalBias: state.shadowNormalBias,
    };
    return state;
  }

  private updateValleyMist(state: EnvironmentalDepthState, lighting: EnvironmentalLightingState): void {
    if (!this.mist || !(this.mist.material instanceof THREE.MeshBasicMaterial)) return;
    const material = this.mist.material;
    // Seasonal presentation updates the mist before this render pass. Detect that external write so
    // our multiplier never compounds and autumn/winter/spring retain their existing identities.
    if (!Number.isNaN(this.lastAppliedMist) && Math.abs(material.opacity - this.lastAppliedMist) > 0.002) {
      this.seasonalMistBase = material.opacity;
    }
    material.opacity = THREE.MathUtils.clamp(this.seasonalMistBase * state.valleyMistMultiplier, 0.08, 0.74);
    material.color.copy(lighting.skyFillColor).lerp(lighting.sunColor, lighting.twilight * 0.08);
    this.lastAppliedMist = material.opacity;
  }

  private updateShadowFocus(state: EnvironmentalDepthState): void {
    if (!this.sun) return;

    this.camera.getWorldDirection(this.forward);
    const forwardY = this.forward.y;
    let focusDistance = THREE.MathUtils.clamp(22 + this.camera.position.y * 0.45, 24, 58);
    // Prefer the camera ray's approximate ground intersection for pitched documentary shots.
    if (forwardY < -0.08 && this.camera.position.y > 0) {
      focusDistance = THREE.MathUtils.clamp(-this.camera.position.y / forwardY, 18, 72);
    }
    this.focus.copy(this.camera.position).addScaledVector(this.forward, focusDistance);
    this.focus.y = 0;
    // Quantization stops tiny camera drift from causing visible shadow-map shimmer.
    const snap = 2;
    this.focus.x = Math.round(this.focus.x / snap) * snap;
    this.focus.z = Math.round(this.focus.z / snap) * snap;

    // GodboxRenderer writes an origin-relative solar position each frame. Static preview tools do
    // not, so detect whether our own adjusted position survived and reuse the cached solar offset.
    if (this.hasAdjustedSun && this.sun.position.distanceToSquared(this.lastAdjustedSunPosition) < 0.0001) {
      // keep cached celestialOffset
    } else {
      this.celestialOffset.copy(this.sun.position);
    }
    if (this.celestialOffset.lengthSq() < 1) this.celestialOffset.set(42, 70, 26);

    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).add(this.celestialOffset);
    this.lastAdjustedSunPosition.copy(this.sun.position);
    this.hasAdjustedSun = true;

    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -state.shadowHalfSpan;
    shadowCamera.right = state.shadowHalfSpan;
    shadowCamera.top = state.shadowHalfSpan;
    shadowCamera.bottom = -state.shadowHalfSpan;
    shadowCamera.near = state.shadowNear;
    shadowCamera.far = state.shadowFar;
    shadowCamera.updateProjectionMatrix();
    this.sun.shadow.bias = state.shadowBias;
    this.sun.shadow.normalBias = state.shadowNormalBias;
    this.sun.shadow.autoUpdate = true;
  }
}
