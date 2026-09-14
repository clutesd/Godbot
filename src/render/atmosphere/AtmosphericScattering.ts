import * as THREE from 'three';
import type { EnvironmentFrameState } from './EnvironmentFrameState';

export interface AtmosphericScatteringState {
  rayleighStrength: number;
  mieStrength: number;
  mieG: number;
  horizonStrength: number;
  warmHorizonStrength: number;
  sunDiskStrength: number;
  sunHaloStrength: number;
  aerialDensity: number;
  aerialStrength: number;
  aerialStartDistance: number;
  aerialForwardScatter: number;
  nightBlend: number;
  obscuration: number;
}

const clamp01 = (value: number): number => THREE.MathUtils.clamp(value, 0, 1);
const smoothstep = (min: number, max: number, value: number): number => {
  const t = clamp01((value - min) / Math.max(0.0001, max - min));
  return t * t * (3 - 2 * t);
};

/**
 * Deterministic atmospheric art direction for the stylised GODBOX world.
 *
 * This remains intentionally lighter than a full spectral atmosphere solver, but it now covers
 * both halves of what the screenshots need: directional sky scattering *and* the coefficients used
 * by depth-aware aerial perspective over terrain. The immediate settlement remains crisp while
 * distant land, water and forest sit inside illuminated air.
 */
export function resolveAtmosphericScattering(frame: EnvironmentFrameState): AtmosphericScatteringState {
  const daylight = clamp01(frame.daylight);
  const twilight = clamp01(frame.twilight);
  const obscuration = clamp01(frame.atmosphericObscuration);
  const sunAboveHorizon = smoothstep(-0.04, 0.08, frame.solarElevation);
  const lowSun = daylight * (1 - smoothstep(0.14, 0.62, Math.max(0, frame.solarElevation)));
  const nightBlend = 1 - daylight;

  return {
    // Night should remain genuinely dark. Rayleigh rises with daylight and keeps only enough energy
    // at night for the atmosphere not to disappear as a flat black void.
    rayleighStrength: THREE.MathUtils.clamp(0.055 + daylight * 0.43 + twilight * 0.095, 0.045, 0.62),
    // Low sun carries the strongest forward aerosol response, but dense weather suppresses the
    // directional lobe rather than making the sky brighter.
    mieStrength: THREE.MathUtils.clamp((0.035 + lowSun * 0.19 + twilight * 0.065) * (1 - obscuration * 0.5), 0.018, 0.285),
    mieG: THREE.MathUtils.clamp(0.73 + lowSun * 0.075, 0.71, 0.815),
    horizonStrength: THREE.MathUtils.clamp(0.13 + daylight * 0.17 + lowSun * 0.14 + obscuration * 0.07, 0.12, 0.45),
    warmHorizonStrength: THREE.MathUtils.clamp((lowSun * 0.48 + twilight * 0.17) * (1 - obscuration * 0.44), 0, 0.52),
    sunDiskStrength: daylight * sunAboveHorizon * (1 - obscuration * 0.78),
    sunHaloStrength: (0.045 + lowSun * 0.22 + twilight * 0.07) * sunAboveHorizon * (1 - obscuration * 0.62),

    // Aerial perspective now integrates density through height in screen space. Keep enough optical
    // density for distant geography, but protect a larger clear-air bubble around the documentary
    // camera. Dense weather is allowed to pull the onset back toward the viewer.
    aerialDensity: THREE.MathUtils.clamp(
      0.0038 + daylight * 0.0015 + lowSun * 0.001 + obscuration * 0.0045,
      0.0032,
      0.0108,
    ),
    aerialStrength: THREE.MathUtils.clamp(
      0.27 + daylight * 0.25 + twilight * 0.045 + obscuration * 0.075 - nightBlend * 0.11,
      0.16,
      0.62,
    ),
    aerialStartDistance: THREE.MathUtils.clamp(22 + nightBlend * 6 - obscuration * 8, 13, 28),
    aerialForwardScatter: THREE.MathUtils.clamp(
      (0.07 + lowSun * 0.24 + twilight * 0.08) * (1 - obscuration * 0.55),
      0.035,
      0.34,
    ),
    nightBlend,
    obscuration,
  };
}

export type AtmosphericSkyMaterial = THREE.ShaderMaterial & {
  userData: THREE.ShaderMaterial['userData'] & { godboxAtmosphericSky?: boolean };
};

/** Create the shared sky shader used by SkyAtmosphere. */
export function createAtmosphericSkyMaterial(zenith: THREE.Color, horizon: THREE.Color): AtmosphericSkyMaterial {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
    uniforms: {
      uZenith: { value: zenith.clone() },
      uHorizon: { value: horizon.clone() },
      uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color('#fff1d6') },
      uSkyFill: { value: new THREE.Color('#a6c6da') },
      uRayleigh: { value: 0.45 },
      uMie: { value: 0.1 },
      uMieG: { value: 0.76 },
      uHorizonStrength: { value: 0.25 },
      uWarmHorizon: { value: 0 },
      uSunDisk: { value: 0.8 },
      uSunHalo: { value: 0.14 },
      uDaylight: { value: 1 },
      uTwilight: { value: 0 },
      uNightBlend: { value: 0 },
      uObscuration: { value: 0 },
    },
    vertexShader: `
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform vec3 uSkyFill;
      uniform float uRayleigh;
      uniform float uMie;
      uniform float uMieG;
      uniform float uHorizonStrength;
      uniform float uWarmHorizon;
      uniform float uSunDisk;
      uniform float uSunHalo;
      uniform float uDaylight;
      uniform float uTwilight;
      uniform float uNightBlend;
      uniform float uObscuration;
      varying vec3 vSkyDirection;

      const float PI = 3.141592653589793;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      void main() {
        vec3 dir = normalize(vSkyDirection);
        vec3 sunDir = normalize(uSunDirection);
        float height = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        float horizonMask = pow(clamp(1.0 - abs(dir.y), 0.0, 1.0), 1.65);
        float gradientT = smoothstep(0.42, 0.95, height);
        vec3 baseSky = mix(uHorizon, uZenith, gradientT);

        float mu = clamp(dot(dir, sunDir), -1.0, 1.0);
        float rayleighPhase = 0.0596831 * (1.0 + mu * mu);
        float g = uMieG;
        float mieDenom = max(0.001, 1.0 + g * g - 2.0 * g * mu);
        float miePhase = (1.0 - g * g) / (4.0 * PI * pow(mieDenom, 1.5));

        // Open sky stays cool; near the horizon the longer optical path shifts energy toward the
        // authored horizon palette instead of simply whitening it.
        vec3 rayleighColor = mix(uSkyFill, vec3(0.42, 0.64, 0.94), 0.22 + height * 0.12);
        float opticalPath = mix(0.72, 1.22, horizonMask);
        vec3 scattered = rayleighColor * rayleighPhase * uRayleigh * opticalPath;
        scattered += uSunColor * miePhase * uMie * (0.42 + horizonMask * 0.72);

        float sunSide = smoothstep(-0.08, 0.72, mu);
        vec3 warmHorizon = mix(uHorizon, uSunColor, uWarmHorizon * sunSide * 0.58);
        vec3 horizonAir = mix(uHorizon, warmHorizon, horizonMask);
        vec3 color = mix(baseSky + scattered, horizonAir, horizonMask * uHorizonStrength);

        // The solar disc is close to the real angular size instead of the oversized first-pass
        // billboard. Two halo lobes create a natural aureole without lens-flare aesthetics.
        float disk = smoothstep(0.99991, 0.999975, mu) * uSunDisk;
        float innerHalo = pow(max(mu, 0.0), 96.0) * uSunHalo;
        float outerHalo = pow(max(mu, 0.0), 24.0) * uSunHalo * 0.16;
        color += uSunColor * (disk * 1.42 + innerHalo + outerHalo);

        // Weather removes directional structure before it removes colour. Night retains the
        // authored palette but strongly reduces scattering energy so blacks remain intentional.
        vec3 overcast = mix(uHorizon, uSkyFill, 0.5);
        color = mix(color, overcast, uObscuration * 0.14);
        color *= 1.0 - uNightBlend * 0.13;

        // Tiny blue-noise-like dither prevents mobile gradient banding without visible grain.
        color += (hash12(gl_FragCoord.xy) - 0.5) / 700.0;
        gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }) as AtmosphericSkyMaterial;
  material.userData['godboxAtmosphericSky'] = true;
  return material;
}

export function setAtmosphericSkyPalette(material: AtmosphericSkyMaterial, zenith: THREE.Color, horizon: THREE.Color): void {
  material.uniforms['uZenith']!.value.copy(zenith);
  material.uniforms['uHorizon']!.value.copy(horizon);
}

/**
 * Applies directional scattering to the existing sky dome from the one authoritative frame state.
 * No simulation state is touched and no additional scene lights are introduced.
 */
export class DirectionalAtmosphereRig {
  private readonly material?: AtmosphericSkyMaterial;

  constructor(scene: THREE.Scene) {
    const sky = scene.getObjectByName('sky');
    if (sky instanceof THREE.Mesh && sky.material instanceof THREE.ShaderMaterial && sky.material.userData['godboxAtmosphericSky']) {
      this.material = sky.material as AtmosphericSkyMaterial;
    }
  }

  update(frame: EnvironmentFrameState): AtmosphericScatteringState | undefined {
    if (!this.material) return undefined;
    const state = resolveAtmosphericScattering(frame);
    const uniforms = this.material.uniforms;
    uniforms['uSunDirection']!.value.copy(frame.sunDirection);
    uniforms['uSunColor']!.value.copy(frame.sunColor);
    uniforms['uSkyFill']!.value.copy(frame.skyFillColor);
    uniforms['uRayleigh']!.value = state.rayleighStrength;
    uniforms['uMie']!.value = state.mieStrength;
    uniforms['uMieG']!.value = state.mieG;
    uniforms['uHorizonStrength']!.value = state.horizonStrength;
    uniforms['uWarmHorizon']!.value = state.warmHorizonStrength;
    uniforms['uSunDisk']!.value = state.sunDiskStrength;
    uniforms['uSunHalo']!.value = state.sunHaloStrength;
    uniforms['uDaylight']!.value = frame.daylight;
    uniforms['uTwilight']!.value = frame.twilight;
    uniforms['uNightBlend']!.value = state.nightBlend;
    uniforms['uObscuration']!.value = state.obscuration;

    this.material.userData['atmosphericScattering'] = {
      rayleighStrength: state.rayleighStrength,
      mieStrength: state.mieStrength,
      horizonStrength: state.horizonStrength,
      warmHorizonStrength: state.warmHorizonStrength,
      sunDiskStrength: state.sunDiskStrength,
      sunHaloStrength: state.sunHaloStrength,
      aerialDensity: state.aerialDensity,
      aerialStrength: state.aerialStrength,
    };
    return state;
  }
}
