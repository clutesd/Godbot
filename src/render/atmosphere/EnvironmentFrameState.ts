import * as THREE from 'three';
import {
  resolveEnvironmentalLighting,
  type EnvironmentalLightingInput,
  type EnvironmentalLightingState,
} from './EnvironmentalLighting';

export interface EnvironmentFrameInput extends EnvironmentalLightingInput {
  /** Final normalized sun direction from the authoritative celestial transform. */
  sunDirection?: THREE.Vector3;
  /** Fog after simulation/weather/catastrophe presentation has authored this frame. */
  sourceFogColor: THREE.Color;
  /** Exposure authored before the final renderer pass. Used only as an event dimmer when fog confirms it. */
  sourceExposure: number;
  /** Background authored by the day/night presentation before final environmental resolution. */
  sourceBackground: THREE.Color;
}

/**
 * The single final environmental truth consumed by every renderer-side lighting/depth/material pass.
 *
 * Legacy presentation code may still author source signals earlier in the frame, but none of those
 * writes are final once this object exists. This state owns the final sun/moon/fill/exposure palette,
 * the authoritative sun direction, and carries authored fog/background forward as explicit inputs
 * instead of letting independent systems silently overwrite each other in execution-order-dependent ways.
 */
export interface EnvironmentFrameState extends EnvironmentalLightingState {
  sunDirection: THREE.Vector3;
  eventDimmer: number;
  atmosphericObscuration: number;
  sourceFogDensity: number;
  sourceFogColor: THREE.Color;
  backgroundColor: THREE.Color;
}

const LEGACY_NEUTRAL_EXPOSURE = 1.12;

/** Pure, deterministic final-frame resolver. */
export function resolveEnvironmentFrame(input: EnvironmentFrameInput): EnvironmentFrameState {
  const base = resolveEnvironmentalLighting(input);
  const sourceFogDensity = Math.max(0, input.fogDensity);

  // Catastrophe presentation historically authored both denser fog and lower exposure before the
  // post pass. Requiring *both* signals prevents ordinary preview exposure or blizzard fog from
  // being misread as an event. The resolved frame then owns the final exposure instead of simply
  // clobbering that information, which was the old ordering bug.
  const hasAtmosphericEvent = sourceFogDensity > 0.0115 && input.sourceExposure < 1.105;
  const authoredExposureScale = hasAtmosphericEvent
    ? THREE.MathUtils.clamp(input.sourceExposure / LEGACY_NEUTRAL_EXPOSURE, 0.68, 1)
    : 1;
  const eventDimmer = 1 - authoredExposureScale;
  const atmosphericObscuration = THREE.MathUtils.clamp(
    Math.max(base.weatherSoftening, eventDimmer * 1.35),
    0,
    1,
  );

  const sunIntensity = base.sunIntensity * (1 - eventDimmer * 0.34);
  const moonIntensity = base.moonIntensity * (1 - atmosphericObscuration * 0.12);
  const hemisphereIntensity = base.hemisphereIntensity * (1 - eventDimmer * 0.08);
  const exposure = THREE.MathUtils.clamp(base.exposure * authoredExposureScale, 0.7, 1.1);

  // Preserve event/weather tint as an authored source, but keep the coherent sky model dominant.
  // This is deliberately a restrained blend: atmosphere should influence the light, not recolour
  // the whole world with a filter.
  const eventTint = THREE.MathUtils.clamp(eventDimmer * 1.8 + base.weatherSoftening * 0.09, 0, 0.48);
  const skyFillColor = base.skyFillColor.clone().lerp(input.sourceFogColor, eventTint);
  const groundFillColor = base.groundFillColor.clone().lerp(input.sourceFogColor, eventDimmer * 0.16);
  const backgroundColor = input.sourceBackground.clone().lerp(skyFillColor, 0.05 + atmosphericObscuration * 0.035);
  const fallbackDirection = new THREE.Vector3(
    Math.sqrt(Math.max(0, 1 - base.solarElevation * base.solarElevation)),
    base.solarElevation,
    0,
  ).normalize();
  const sunDirection = input.sunDirection?.lengthSq()
    ? input.sunDirection.clone().normalize()
    : fallbackDirection;

  return {
    ...base,
    sunDirection,
    sunIntensity,
    moonIntensity,
    hemisphereIntensity,
    exposure,
    skyFillColor,
    groundFillColor,
    eventDimmer,
    atmosphericObscuration,
    sourceFogDensity,
    sourceFogColor: input.sourceFogColor.clone(),
    backgroundColor,
  };
}

/**
 * Final renderer-side environmental authority.
 *
 * Earlier systems are treated as source-signal authors only. This rig samples those signals once,
 * resolves one EnvironmentFrameState, applies all final light/exposure/background values, and then
 * publishes the exact same object for fog, materials and post-processing to consume.
 */
export class EnvironmentFrameRig {
  private readonly sun?: THREE.DirectionalLight;
  private readonly moon?: THREE.DirectionalLight;
  private readonly hemisphere?: THREE.HemisphereLight;
  private readonly fallbackFog = new THREE.Color('#93a5a4');
  private readonly fallbackBackground = new THREE.Color('#899b91');

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene) {
    const directionals: THREE.DirectionalLight[] = [];
    let hemisphere: THREE.HemisphereLight | undefined;
    scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) directionals.push(object);
      else if (!hemisphere && object instanceof THREE.HemisphereLight) hemisphere = object;
    });
    directionals.sort((a, b) => b.intensity - a.intensity);
    this.sun = directionals[0];
    this.moon = directionals[1];
    this.hemisphere = hemisphere;
    if (this.sun && !this.sun.name) this.sun.name = 'environment-sun';
    if (this.moon && !this.moon.name) this.moon.name = 'environment-moon';
    if (this.hemisphere && !this.hemisphere.name) this.hemisphere.name = 'environment-sky-fill';
  }

  update(night: number): EnvironmentFrameState | undefined {
    if (!this.sun || !this.moon || !this.hemisphere) return undefined;

    const sunLength = Math.max(0.0001, this.sun.position.length());
    const fog = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog : undefined;
    const sourceFogColor = fog?.color.clone() ?? this.fallbackFog.clone();
    const sourceBackground = this.scene.background instanceof THREE.Color
      ? this.scene.background.clone()
      : this.fallbackBackground.clone();
    // GodboxRenderer authors the celestial vector around world origin before the shadow-focus pass.
    // Keep that direction independent from the directional-light target, which is intentionally
    // moved by EnvironmentalDepthRig to improve shadow-map precision around the active camera shot.
    const sunDirection = this.sun.position.clone().normalize();

    const frame = resolveEnvironmentFrame({
      sunElevation: this.sun.position.y / sunLength,
      sunDirection,
      night,
      fogDensity: fog?.density ?? 0,
      sourceFogColor,
      sourceExposure: this.renderer.toneMappingExposure,
      sourceBackground,
    });

    this.sun.color.copy(frame.sunColor);
    this.sun.intensity = frame.sunIntensity;
    this.moon.color.copy(frame.moonColor);
    this.moon.intensity = frame.moonIntensity;
    this.hemisphere.color.copy(frame.skyFillColor);
    this.hemisphere.groundColor.copy(frame.groundFillColor);
    this.hemisphere.intensity = frame.hemisphereIntensity;
    this.renderer.toneMappingExposure = frame.exposure;
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(frame.backgroundColor);

    // Publish one object, not a collection of unrelated knobs. The old environmentLighting payload
    // is retained as a small compatibility mirror for diagnostics, but all modern consumers receive
    // the full authoritative frame object.
    this.scene.userData['environmentFrame'] = frame;
    this.scene.userData['environmentLighting'] = {
      solarElevation: frame.solarElevation,
      daylight: frame.daylight,
      twilight: frame.twilight,
      weatherSoftening: frame.weatherSoftening,
      sunIntensity: frame.sunIntensity,
      moonIntensity: frame.moonIntensity,
      hemisphereIntensity: frame.hemisphereIntensity,
      exposure: frame.exposure,
      sunColor: `#${frame.sunColor.getHexString()}`,
      skyFillColor: `#${frame.skyFillColor.getHexString()}`,
      sunDirection: frame.sunDirection.toArray(),
      eventDimmer: frame.eventDimmer,
    };
    return frame;
  }
}
