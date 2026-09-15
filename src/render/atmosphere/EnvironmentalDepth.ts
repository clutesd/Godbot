import * as THREE from 'three';
import type { EnvironmentFrameState } from './EnvironmentFrameState';

export interface EnvironmentalDepthInput {
  daylight: number;
  twilight: number;
  atmosphericObscuration: number;
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

/** Legacy authored clear-weather fog density. Values above this are meaningful weather/event fog. */
const AUTHORED_CLEAR_FOG = 0.0072;
/**
 * Perceptual visibility correction for the spatial mist field.
 *
 * The low-mist source texture is already highly selective and the shader samples only a shallow
 * near-surface layer. The original depth multiplier was tuned as though it were the final opacity,
 * so several additional attenuation stages made valid mist almost disappear in documentary shots.
 * Keep geography/season/time-of-day authoritative and amplify only the resulting local mist signal.
 */
export const LOW_MIST_VISIBILITY_GAIN = 3.6;

/**
 * Resolve world depth from the same final EnvironmentFrameState that owns the lights/exposure.
 *
 * FogExp2 is deliberately only a light near-air safety layer now. Medium/far atmospheric depth is
 * owned by the height-aware aerial-perspective pass, so an elevated documentary camera no longer
 * fills the entire scene with grey simply because it is high above the terrain. Severe authored
 * weather remains capable of producing genuinely poor visibility through the excess-fog path.
 */
export function resolveEnvironmentalDepth(input: EnvironmentalDepthInput): EnvironmentalDepthState {
  const daylight = THREE.MathUtils.clamp(input.daylight, 0, 1);
  const twilight = THREE.MathUtils.clamp(input.twilight, 0, 1);
  const obscuration = THREE.MathUtils.clamp(input.atmosphericObscuration, 0, 1);
  const baseFog = Math.max(0, input.baseFogDensity);
  const cameraHeight = Math.max(0, input.cameraHeight);

  // The old clear-weather value (0.0072) erased roughly forty percent of contrast by ~100 world
  // units before the aerial-perspective pass even ran. Retain only a very light clear-air floor.
  // Crucially, this term no longer increases with camera height: altitude should expose clearer air,
  // not make an overhead documentary shot milkier.
  const authoredClearComponent = Math.min(baseFog, AUTHORED_CLEAR_FOG);
  const clearAirDensity = 0.00045
    + authoredClearComponent * 0.12
    + (1 - daylight) * 0.00012;

  // Anything above the ordinary authored baseline is real weather/event obscuration. Preserve a
  // steep response here so blizzards, smoke and catastrophe can still collapse visibility without
  // forcing every normal morning to look like the camera is inside a cloud.
  const excessFog = Math.max(0, baseFog - AUTHORED_CLEAR_FOG);
  const severeWeatherDensity = excessFog * (0.72 + obscuration * 0.12);
  const obscurationFloor = obscuration * 0.0014;
  const fogDensity = Math.min(0.055, clearAirDensity + severeWeatherDensity + obscurationFloor);

  const fogSkyBlend = THREE.MathUtils.clamp(0.13 + obscuration * 0.24 + twilight * 0.07, 0.1, 0.44);

  // Geography still decides *where* mist exists, and the LowMistField/AerialPerspective pipeline
  // still decides season, time-of-day, wind and local density. This scalar is now explicitly a
  // perceptual visibility correction: it compensates for shallow-layer/ray attenuation without
  // increasing screen-wide FogExp2 or allowing mist onto dry ridges.
  const authoredMistVisibility = 0.5 + twilight * 0.18 + obscuration * 0.35 + (1 - daylight) * 0.08;
  const valleyMistMultiplier = THREE.MathUtils.clamp(
    authoredMistVisibility * LOW_MIST_VISIBILITY_GAIN,
    1.55,
    3.9,
  );

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
 * Renderer-only depth rig. It no longer reads mutable light/fog values to derive a second truth;
 * every decision comes from the authoritative EnvironmentFrameState resolved earlier this frame.
 */
export class EnvironmentalDepthRig {
  private readonly sun?: THREE.DirectionalLight;
  private readonly forward = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly celestialOffset = new THREE.Vector3();
  private readonly lastAdjustedSunPosition = new THREE.Vector3();
  private hasAdjustedSun = false;

  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.Camera) {
    const shadowLights: THREE.DirectionalLight[] = [];
    scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight && object.castShadow) shadowLights.push(object);
    });
    shadowLights.sort((a, b) => b.intensity - a.intensity);
    this.sun = shadowLights[0];
    if (this.sun && !this.sun.target.parent) this.scene.add(this.sun.target);
  }

  update(frame: EnvironmentFrameState): EnvironmentalDepthState {
    const fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : undefined;
    const state = resolveEnvironmentalDepth({
      daylight: frame.daylight,
      twilight: frame.twilight,
      atmosphericObscuration: frame.atmosphericObscuration,
      baseFogDensity: frame.sourceFogDensity,
      cameraHeight: this.camera.position.y,
    });

    if (fog) {
      fog.density = state.fogDensity;
      // Preserve authored event/weather colour as part of the frame, then harmonize it with the
      // coherent sky. This avoids the old order-dependent chain of repeated lerps.
      fog.color.copy(frame.sourceFogColor).lerp(frame.skyFillColor, state.fogSkyBlend);
    }

    this.updateShadowFocus(state);

    this.scene.userData['environmentDepth'] = {
      fogDensity: state.fogDensity,
      valleyMistMultiplier: state.valleyMistMultiplier,
      shadowHalfSpan: state.shadowHalfSpan,
      shadowBias: state.shadowBias,
      shadowNormalBias: state.shadowNormalBias,
      atmosphericObscuration: frame.atmosphericObscuration,
    };
    return state;
  }

  private updateShadowFocus(state: EnvironmentalDepthState): void {
    if (!this.sun) return;

    this.camera.getWorldDirection(this.forward);
    const forwardY = this.forward.y;
    let focusDistance = THREE.MathUtils.clamp(22 + this.camera.position.y * 0.45, 24, 58);
    if (forwardY < -0.08 && this.camera.position.y > 0) {
      focusDistance = THREE.MathUtils.clamp(-this.camera.position.y / forwardY, 18, 72);
    }
    this.focus.copy(this.camera.position).addScaledVector(this.forward, focusDistance);
    this.focus.y = 0;
    const snap = 2;
    this.focus.x = Math.round(this.focus.x / snap) * snap;
    this.focus.z = Math.round(this.focus.z / snap) * snap;

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
