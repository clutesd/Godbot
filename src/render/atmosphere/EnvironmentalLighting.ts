import * as THREE from 'three';

export interface EnvironmentalLightingInput {
  /** Normalized solar elevation inferred from the authoritative sun transform (-1..1). */
  sunElevation: number;
  /** Renderer ecology night signal (0 day, 1 deep night). */
  night: number;
  /** Current exponential fog density; severe weather is allowed to soften direct light. */
  fogDensity: number;
}

export interface EnvironmentalLightingState {
  solarElevation: number;
  daylight: number;
  twilight: number;
  weatherSoftening: number;
  sunIntensity: number;
  moonIntensity: number;
  hemisphereIntensity: number;
  exposure: number;
  sunColor: THREE.Color;
  moonColor: THREE.Color;
  skyFillColor: THREE.Color;
  groundFillColor: THREE.Color;
}

const SUN_LOW = new THREE.Color('#ff9857');
const SUN_HIGH = new THREE.Color('#fff1d2');
const MOON_LOW = new THREE.Color('#7890c5');
const MOON_HIGH = new THREE.Color('#aebfe4');
const SKY_NIGHT = new THREE.Color('#26344e');
const SKY_TWILIGHT = new THREE.Color('#718bab');
const SKY_DAY = new THREE.Color('#9cc2dc');
const GROUND_NIGHT = new THREE.Color('#25252d');
const GROUND_DAY = new THREE.Color('#515048');

/**
 * One coherent outdoor-lighting model for GODBOX.
 *
 * The existing renderer remains authoritative for celestial motion, weather, season and sky
 * presentation. This resolver turns those already-existing signals into a single calibrated light
 * state so the sun, moon, sky fill and exposure cannot drift into independently tuned values.
 * Keeping the resolver pure also makes the art direction deterministic and regression-testable.
 */
export function resolveEnvironmentalLighting(input: EnvironmentalLightingInput): EnvironmentalLightingState {
  const solarElevation = THREE.MathUtils.clamp(input.sunElevation, -1, 1);
  const night = THREE.MathUtils.clamp(input.night, 0, 1);
  const geometricDay = smoothstep(-0.08, 0.2, solarElevation);
  const daylight = THREE.MathUtils.clamp(Math.max(geometricDay, 1 - night), 0, 1);
  const twilight = THREE.MathUtils.clamp(1 - Math.abs(solarElevation - 0.02) / 0.34, 0, 1) * (0.4 + night * 0.6);
  const solarHeight = smoothstep(0.08, 0.72, solarElevation);
  const goldenHour = (1 - solarHeight) * daylight;
  const weatherSoftening = smoothstep(0.009, 0.043, Math.max(0, input.fogDensity));

  // Direct light is the scene's principal sculpting force. Weather softens it but never erases
  // directional form entirely, otherwise mountains and buildings collapse back into flat ambient.
  const sunIntensity = (0.035 + daylight * (2.45 + solarHeight * 1.35)) * (1 - weatherSoftening * 0.52);

  // Sky fill intentionally sits well below the previous broad daylight fill. This leaves readable
  // cool shadows while retaining enough indirect light for stylised materials and tiny people.
  const hemisphereIntensity = 0.12
    + daylight * (0.44 + solarHeight * 0.22)
    + twilight * 0.12
    + weatherSoftening * daylight * 0.08;

  const moonIntensity = 0.055 + night * (0.38 + (1 - weatherSoftening) * 0.08);

  const sunColor = SUN_LOW.clone().lerp(SUN_HIGH, smoothstep(0.18, 0.7, solarElevation));
  const moonColor = MOON_LOW.clone().lerp(MOON_HIGH, 1 - weatherSoftening * 0.45);

  const skyFillColor = SKY_NIGHT.clone()
    .lerp(SKY_TWILIGHT, THREE.MathUtils.clamp(twilight + daylight * 0.22, 0, 1))
    .lerp(SKY_DAY, smoothstep(0.22, 0.85, daylight) * (0.65 + solarHeight * 0.35));
  // Overcast skies become a little more neutral, avoiding candy-blue shadows during storms.
  skyFillColor.lerp(new THREE.Color('#a7b4bc'), weatherSoftening * daylight * 0.28);

  const groundFillColor = GROUND_NIGHT.clone().lerp(GROUND_DAY, daylight * 0.86);

  // ACES exposure is deliberately restrained in bright daylight to preserve snow/cloud detail,
  // with a gentle lift toward twilight/night. There is no aggressive auto-exposure pumping.
  const exposure = THREE.MathUtils.clamp(
    1.015 + goldenHour * 0.055 + night * 0.09 + weatherSoftening * 0.025,
    0.98,
    1.17,
  );

  return {
    solarElevation,
    daylight,
    twilight,
    weatherSoftening,
    sunIntensity,
    moonIntensity,
    hemisphereIntensity,
    exposure,
    sunColor,
    moonColor,
    skyFillColor,
    groundFillColor,
  };
}

/**
 * Applies the pure lighting model to the already-created scene lights. The rig discovers the
 * renderer's existing sun/moon/hemisphere once, then exposes the resolved state through
 * `scene.userData.environmentLighting` so later atmosphere, water and material passes can consume
 * the same truth instead of inventing parallel time-of-day curves.
 */
export class EnvironmentalLightingRig {
  private readonly sun?: THREE.DirectionalLight;
  private readonly moon?: THREE.DirectionalLight;
  private readonly hemisphere?: THREE.HemisphereLight;

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

  update(night: number): EnvironmentalLightingState | undefined {
    if (!this.sun || !this.moon || !this.hemisphere) return undefined;
    const length = Math.max(0.0001, this.sun.position.length());
    const fogDensity = this.scene.fog instanceof THREE.FogExp2 ? this.scene.fog.density : 0;
    const state = resolveEnvironmentalLighting({
      sunElevation: this.sun.position.y / length,
      night,
      fogDensity,
    });

    this.sun.color.copy(state.sunColor);
    this.sun.intensity = state.sunIntensity;
    this.moon.color.copy(state.moonColor);
    this.moon.intensity = state.moonIntensity;
    this.hemisphere.color.copy(state.skyFillColor);
    this.hemisphere.groundColor.copy(state.groundFillColor);
    this.hemisphere.intensity = state.hemisphereIntensity;
    this.renderer.toneMappingExposure = state.exposure;

    this.scene.userData['environmentLighting'] = {
      solarElevation: state.solarElevation,
      daylight: state.daylight,
      twilight: state.twilight,
      weatherSoftening: state.weatherSoftening,
      sunIntensity: state.sunIntensity,
      moonIntensity: state.moonIntensity,
      hemisphereIntensity: state.hemisphereIntensity,
      exposure: state.exposure,
      sunColor: `#${state.sunColor.getHexString()}`,
      skyFillColor: `#${state.skyFillColor.getHexString()}`,
    };
    return state;
  }
}

function smoothstep(min: number, max: number, value: number): number {
  if (max <= min) return value >= max ? 1 : 0;
  const t = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}
