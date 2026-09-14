import * as THREE from 'three';
import type { EnvironmentFrameState } from './EnvironmentFrameState';

export interface AtmosphericScatteringState {
  rayleighStrength: number;
  mieStrength: number;
  mieG: number;
  horizonStrength: number;
  sunDiskStrength: number;
  sunHaloStrength: number;
  nightBlend: number;
  obscuration: number;
}

const clamp01 = (value: number): number => THREE.MathUtils.clamp(value, 0, 1);
const smoothstep = (min: number, max: number, value: number): number => {
  const t = clamp01((value - min) / Math.max(0.0001, max - min));
  return t * t * (3 - 2 * t);
};

/**
 * Cheap, deterministic sky-scattering art direction for the stylised GODBOX world.
 *
 * This is intentionally not a full physical atmosphere solver. It captures the perceptually
 * important pieces — Rayleigh-style sky colour, Mie forward scattering, horizon extinction and a
 * restrained solar disc/halo — from the authoritative EnvironmentFrameState without introducing a
 * second weather/day-night system.
 */
export function resolveAtmosphericScattering(frame: EnvironmentFrameState): AtmosphericScatteringState {
  const daylight = clamp01(frame.daylight);
  const twilight = clamp01(frame.twilight);
  const obscuration = clamp01(frame.atmosphericObscuration);
  const sunAboveHorizon = smoothstep(-0.04, 0.09, frame.solarElevation);
  const lowSun = daylight * (1 - smoothstep(0.14, 0.62, Math.max(0, frame.solarElevation)));
  const nightBlend = 1 - daylight;

  return {
    rayleighStrength: THREE.MathUtils.clamp(0.22 + daylight * 0.42 + twilight * 0.08, 0.18, 0.72),
    mieStrength: THREE.MathUtils.clamp((0.05 + lowSun * 0.22 + twilight * 0.08) * (1 - obscuration * 0.42), 0.025, 0.34),
    mieG: THREE.MathUtils.clamp(0.72 + lowSun * 0.09, 0.7, 0.84),
    horizonStrength: THREE.MathUtils.clamp(0.16 + daylight * 0.18 + lowSun * 0.17 + obscuration * 0.08, 0.14, 0.52),
    sunDiskStrength: daylight * sunAboveHorizon * (1 - obscuration * 0.72),
    sunHaloStrength: (0.08 + lowSun * 0.32 + twilight * 0.12) * sunAboveHorizon * (1 - obscuration * 0.55),
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
      uRayleigh: { value: 0.5 },
      uMie: { value: 0.12 },
      uMieG: { value: 0.76 },
      uHorizonStrength: { value: 0.28 },
      uSunDisk: { value: 0.8 },
      uSunHalo: { value: 0.18 },
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
      uniform float uSunDisk;
      uniform float uSunHalo;
      uniform float uNightBlend;
      uniform float uObscuration;
      varying vec3 vSkyDirection;

      const float PI = 3.141592653589793;

      void main() {
        vec3 dir = normalize(vSkyDirection);
        vec3 sunDir = normalize(uSunDirection);
        float height = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        float horizonMask = pow(1.0 - abs(dir.y), 2.4);
        float gradientT = smoothstep(0.43, 0.94, height);
        vec3 baseSky = mix(uHorizon, uZenith, gradientT);

        float mu = clamp(dot(dir, sunDir), -1.0, 1.0);
        float rayleighPhase = 0.0596831 * (1.0 + mu * mu);
        float g = uMieG;
        float mieDenom = max(0.0008, 1.0 + g * g - 2.0 * g * mu);
        float miePhase = (1.0 - g * g) / (4.0 * PI * pow(mieDenom, 1.5));

        // Rayleigh contributes cool open-sky energy; Mie is tightly forward-scattered around sun.
        vec3 rayleighColor = mix(uSkyFill, vec3(0.46, 0.68, 1.0), 0.32);
        vec3 scattered = rayleighColor * rayleighPhase * uRayleigh * (0.72 + height * 0.55);
        scattered += uSunColor * miePhase * uMie * (0.55 + horizonMask * 0.65);

        // Horizon extinction softens the sky near terrain silhouettes without becoming white fog.
        vec3 horizonAir = mix(uHorizon, uSunColor, max(mu, 0.0) * 0.12);
        vec3 color = mix(baseSky + scattered, horizonAir, horizonMask * uHorizonStrength);

        // A tiny physically-inspired sun disc and broader halo. Values are deliberately restrained
        // so GODBOX remains painterly rather than becoming a lens-flare demo.
        float disk = smoothstep(0.99942, 0.99986, mu) * uSunDisk;
        float halo = pow(max(mu, 0.0), 42.0) * uSunHalo;
        color += uSunColor * (disk * 1.55 + halo);

        // Dense weather/catastrophe atmosphere reduces directional contrast rather than recolouring
        // the whole sky. Night also keeps a small residual scattering contribution for moonlit air.
        color = mix(color, mix(uHorizon, uSkyFill, 0.45), uObscuration * 0.12);
        color *= 1.0 - uNightBlend * 0.08;

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
    uniforms['uSunDisk']!.value = state.sunDiskStrength;
    uniforms['uSunHalo']!.value = state.sunHaloStrength;
    uniforms['uNightBlend']!.value = state.nightBlend;
    uniforms['uObscuration']!.value = state.obscuration;

    this.material.userData['atmosphericScattering'] = {
      rayleighStrength: state.rayleighStrength,
      mieStrength: state.mieStrength,
      horizonStrength: state.horizonStrength,
      sunDiskStrength: state.sunDiskStrength,
      sunHaloStrength: state.sunHaloStrength,
    };
    return state;
  }
}
