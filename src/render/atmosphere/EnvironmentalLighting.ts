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

// Low sun is deliberately amber rather than orange. The first real Step-2 captures showed that
// saturated #ff98xx light could paint whole mountain faces copper while the opposite faces fell to
// black. Warmth now comes from separation between direct sun and cool sky fill, not from a filter.
const SUN_LOW = new THREE.Color('#ffc184');
const SUN_HIGH = new THREE.Color('#fff5df');
const MOON_LOW = new THREE.Color('#7f96c8');
const MOON_HIGH = new THREE.Color('#b4c5e7');
const SKY_NIGHT = new THREE.Color('#30405d');
const SKY_TWILIGHT = new THREE.Color('#8298b2');
const SKY_DAY = new THREE.Color('#a6c6da');
const GROUND_NIGHT = new THREE.Color('#2d2d34');
const GROUND_DAY = new THREE.Color('#5a584f');

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

  // Direct sun remains the principal sculpting force, but the ratio is calibrated for GODBOX's
  // steep low-poly terrain. The old ~5:1 midday and much harsher low-sun separation produced near-
  // black valleys and clipped copper faces. Around 3:1 midday preserves modelling without losing
  // readable shadow information.
  const sunIntensity = (0.035 + daylight * (1.72 + solarHeight * 1.18)) * (1 - weatherSoftening * 0.42);

  // Sky fill is intentionally cool and substantial enough to keep snow, people and settlement
  // silhouettes readable on the unlit side of mountains. It still remains clearly subordinate to
  // direct sun at normal daylight elevations.
  const hemisphereIntensity = 0.17
    + daylight * (0.53 + solarHeight * 0.18)
    + twilight * 0.16
    + weatherSoftening * daylight * 0.1;

  const moonIntensity = 0.055 + night * (0.34 + (1 - weatherSoftening) * 0.08);

  const sunColor = SUN_LOW.clone().lerp(SUN_HIGH, smoothstep(0.16, 0.68, solarElevation));
  const moonColor = MOON_LOW.clone().lerp(MOON_HIGH, 1 - weatherSoftening * 0.45);

  const skyFillColor = SKY_NIGHT.clone()
    .lerp(SKY_TWILIGHT, THREE.MathUtils.clamp(twilight + daylight * 0.24, 0, 1))
    .lerp(SKY_DAY, smoothstep(0.22, 0.85, daylight) * (0.64 + solarHeight * 0.36));
  // Overcast skies become a little more neutral, avoiding candy-blue shadows during storms.
  skyFillColor.lerp(new THREE.Color('#adb9bf'), weatherSoftening * daylight * 0.27);

  const groundFillColor = GROUND_NIGHT.clone().lerp(GROUND_DAY, daylight * 0.88);

  // ACES still owns highlight compression. Exposure therefore stays very stable: the scene should
  // not pulse as the documentary camera crosses bright snow, nor compensate for golden hour by
  // bleaching it. Shadow readability is handled by actual fill light and the Step-3 toe lift.
  const exposure = THREE.MathUtils.clamp(
    1.0 + goldenHour * 0.025 + night * 0.08 + weatherSoftening * 0.012,
    0.98,
    1.1,
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
