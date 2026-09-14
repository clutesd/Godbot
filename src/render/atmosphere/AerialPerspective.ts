import * as THREE from 'three';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { EnvironmentFrameState } from './EnvironmentFrameState';
import type { AtmosphericScatteringState } from './AtmosphericScattering';

/**
 * Parameters consumed by the screen-space aerial perspective pass.
 *
 * The sky shader makes the atmosphere visible when the camera sees the horizon. GODBOX spends a
 * large amount of time looking down into settlements, however, so the same scattering has to exist
 * between the camera and terrain as well. This pass is deliberately modest: it starts beyond the
 * immediate settlement, preserves nearby contrast, and uses the depth buffer rather than fake
 * full-screen fog.
 */
export function updateAerialPerspectivePass(
  pass: ShaderPass,
  frame: EnvironmentFrameState,
  scattering: AtmosphericScatteringState,
  camera: THREE.PerspectiveCamera,
  depthTexture: THREE.DepthTexture | null,
): void {
  const uniforms = pass.uniforms;
  uniforms['tDepth']!.value = depthTexture;
  uniforms['uProjectionInverse']!.value.copy(camera.projectionMatrixInverse);
  uniforms['uCameraWorld']!.value.copy(camera.matrixWorld);
  uniforms['uSunDirection']!.value.copy(frame.sunDirection);
  uniforms['uSkyFill']!.value.copy(frame.skyFillColor);
  uniforms['uFogColor']!.value.copy(frame.sourceFogColor);
  uniforms['uSunColor']!.value.copy(frame.sunColor);
  uniforms['uDensity']!.value = scattering.aerialDensity;
  uniforms['uStrength']!.value = scattering.aerialStrength;
  uniforms['uStartDistance']!.value = scattering.aerialStartDistance;
  uniforms['uForwardScatter']!.value = scattering.aerialForwardScatter;
  uniforms['uNightBlend']!.value = scattering.nightBlend;
  uniforms['uObscuration']!.value = scattering.obscuration;
}

/**
 * Depth-aware aerial perspective. It runs in linear HDR space before bloom/grade/output.
 *
 * We reconstruct the world ray and hit position from the scene depth buffer, apply Beer-Lambert
 * style distance extinction, then add a small directional in-scatter term toward the sun. Sky
 * pixels are untouched because the dome already owns their scattering model.
 */
export const AERIAL_PERSPECTIVE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uProjectionInverse: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
    uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSkyFill: { value: new THREE.Color('#9dbdd3') },
    uFogColor: { value: new THREE.Color('#93a5a4') },
    uSunColor: { value: new THREE.Color('#fff2dc') },
    uDensity: { value: 0.0048 },
    uStrength: { value: 0.48 },
    uStartDistance: { value: 15 },
    uForwardScatter: { value: 0.16 },
    uNightBlend: { value: 0 },
    uObscuration: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform mat4 uProjectionInverse;
    uniform mat4 uCameraWorld;
    uniform vec3 uSunDirection;
    uniform vec3 uSkyFill;
    uniform vec3 uFogColor;
    uniform vec3 uSunColor;
    uniform float uDensity;
    uniform float uStrength;
    uniform float uStartDistance;
    uniform float uForwardScatter;
    uniform float uNightBlend;
    uniform float uObscuration;
    varying vec2 vUv;

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).x;

      // Depth remains 1 for the non-depth-writing sky dome. Leaving those pixels alone prevents
      // the aerial pass from double-scattering the sky and keeps the solar halo crisp.
      if (depth >= 0.99998) {
        gl_FragColor = source;
        return;
      }

      vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 viewPosition = uProjectionInverse * clip;
      viewPosition /= max(viewPosition.w, 0.00001);
      float distanceToSurface = length(viewPosition.xyz);
      vec3 worldPosition = (uCameraWorld * vec4(viewPosition.xyz, 1.0)).xyz;
      vec3 worldDirection = normalize((uCameraWorld * vec4(normalize(viewPosition.xyz), 0.0)).xyz);

      float pathLength = max(0.0, distanceToSurface - uStartDistance);
      float extinction = 1.0 - exp(-pathLength * uDensity);

      // Low-lying air carries more visible aerosol. The broad transition is intentional: it gives
      // valleys depth without drawing a visible horizontal fog plane across mountains.
      float lowAir = 1.0 - smoothstep(10.0, 52.0, worldPosition.y);
      float grazingView = pow(1.0 - abs(worldDirection.y), 1.35);
      float amount = extinction * uStrength * (0.72 + lowAir * 0.24 + grazingView * 0.15);
      amount *= 1.0 + uObscuration * 0.24;
      amount = clamp(amount, 0.0, 0.34 + uObscuration * 0.12);

      // Forward scattering is strongest looking toward the sun, especially through low air. This
      // creates illuminated atmosphere rather than a uniform grey veil.
      float mu = max(dot(worldDirection, normalize(uSunDirection)), 0.0);
      float forward = pow(mu, 9.0) * uForwardScatter * (0.55 + lowAir * 0.45);
      forward *= 1.0 - uObscuration * 0.58;

      vec3 neutralAir = mix(uFogColor, uSkyFill, 0.68);
      // At night the air remains cool and readable; direct warm in-scatter disappears naturally.
      neutralAir = mix(neutralAir, uSkyFill * 0.72, uNightBlend * 0.62);
      vec3 airColor = mix(neutralAir, uSunColor, clamp(forward, 0.0, 0.34));

      // Beer-Lambert inspired transmission. We deliberately do not lift the entire toe: only actual
      // distance through atmosphere is affected, so nearby night scenes keep their black point.
      vec3 color = mix(source.rgb, airColor, amount);
      gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
    }
  `,
};
