import * as THREE from 'three';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { EnvironmentFrameState } from './EnvironmentFrameState';
import type { AtmosphericScatteringState } from './AtmosphericScattering';
import type { EnvironmentalDepthState } from './EnvironmentalDepth';
import { LOW_MIST_MAX_HEIGHT, LOW_MIST_MIN_HEIGHT, type LowMistField } from './LowMistField';

/** World-space height falloff used by the aerial-density integral. */
export const AERIAL_HEIGHT_FALLOFF = 0.045;

/**
 * CPU mirror of the shader's four-point height-density integration, used for deterministic tests.
 * The result is the average relative air density encountered along a camera-to-surface ray.
 */
export function integratedHeightDensity(
  cameraHeight: number,
  surfaceHeight: number,
  falloff = AERIAL_HEIGHT_FALLOFF,
): number {
  const densityAt = (height: number): number => Math.exp(-Math.max(0, height) * Math.max(0, falloff));
  const samples = [0.125, 0.375, 0.625, 0.875] as const;
  let total = 0;
  for (const t of samples) total += densityAt(THREE.MathUtils.lerp(cameraHeight, surfaceHeight, t));
  return total / samples.length;
}

/**
 * Parameters consumed by the screen-space aerial perspective pass.
 *
 * Clear air and spatial low mist now share this one depth-aware integration point: the broad
 * atmosphere handles distance/height extinction, while the low-mist texture says where moisture
 * actually pools near terrain and water. This avoids reintroducing a second screen-wide fog layer.
 */
export function updateAerialPerspectivePass(
  pass: ShaderPass,
  frame: EnvironmentFrameState,
  scattering: AtmosphericScatteringState,
  depthState: EnvironmentalDepthState,
  lowMistField: LowMistField,
  camera: THREE.PerspectiveCamera,
  depthTexture: THREE.DepthTexture | null,
): void {
  const uniforms = pass.uniforms;
  const mist = lowMistField.sample();
  uniforms['tDepth']!.value = depthTexture;
  uniforms['uProjectionInverse']!.value.copy(camera.projectionMatrixInverse);
  uniforms['uCameraWorld']!.value.copy(camera.matrixWorld);
  uniforms['uCameraHeight']!.value = camera.position.y;
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
  uniforms['uHeightFalloff']!.value = AERIAL_HEIGHT_FALLOFF;
  uniforms['uLowMistMap']!.value = mist.texture;
  uniforms['uLowMistBounds']!.value.set(mist.originX, mist.originZ, mist.span, 1 / Math.max(0.001, mist.span));
  uniforms['uLowMistHeightRange']!.value.set(mist.minAnchorY, mist.maxAnchorY);
  uniforms['uLowMistStrength']!.value = THREE.MathUtils.clamp(
    mist.seasonalStrength * depthState.valleyMistMultiplier,
    0,
    1.1,
  );
  const farBlendStart = Math.max(scattering.aerialStartDistance * 4.5, camera.far * 0.16);
  const farBlendEnd = Math.max(farBlendStart + 120, camera.far * 0.5);
  uniforms['uFarBlendStart']!.value = farBlendStart;
  uniforms['uFarBlendEnd']!.value = farBlendEnd;
}

/**
 * Depth-aware aerial perspective. It runs in linear HDR space before bloom/grade/output.
 *
 * The broad atmosphere uses an exponential height-density integral. A second, deliberately shallow
 * world-space field is sampled along the same camera ray for terrain/water mist. That means a high
 * camera can remain in clear air while looking through a ribbon of moisture sitting over a river,
 * inside a basin or among the lower forest canopy. No translucent world sheet is involved.
 */
export const AERIAL_PERSPECTIVE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uProjectionInverse: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
    uCameraHeight: { value: 40 },
    uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSkyFill: { value: new THREE.Color('#9dbdd3') },
    uFogColor: { value: new THREE.Color('#93a5a4') },
    uSunColor: { value: new THREE.Color('#fff2dc') },
    uDensity: { value: 0.0048 },
    uStrength: { value: 0.48 },
    uStartDistance: { value: 22 },
    uForwardScatter: { value: 0.16 },
    uNightBlend: { value: 0 },
    uObscuration: { value: 0 },
    uHeightFalloff: { value: AERIAL_HEIGHT_FALLOFF },
    uFarBlendStart: { value: 144 },
    uFarBlendEnd: { value: 450 },
    uLowMistMap: { value: null },
    uLowMistBounds: { value: new THREE.Vector4(-100, -100, 200, 0.005) },
    uLowMistHeightRange: { value: new THREE.Vector2(0, 40) },
    uLowMistStrength: { value: 0 },
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
    uniform sampler2D uLowMistMap;
    uniform mat4 uProjectionInverse;
    uniform mat4 uCameraWorld;
    uniform float uCameraHeight;
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
    uniform float uHeightFalloff;
    uniform float uFarBlendStart;
    uniform float uFarBlendEnd;
    uniform vec4 uLowMistBounds;
    uniform vec2 uLowMistHeightRange;
    uniform float uLowMistStrength;
    varying vec2 vUv;

    float densityAtHeight(float worldY) {
      return exp(-max(worldY, 0.0) * uHeightFalloff);
    }

    float integratedRayDensity(float cameraY, float surfaceY) {
      float d0 = densityAtHeight(mix(cameraY, surfaceY, 0.125));
      float d1 = densityAtHeight(mix(cameraY, surfaceY, 0.375));
      float d2 = densityAtHeight(mix(cameraY, surfaceY, 0.625));
      float d3 = densityAtHeight(mix(cameraY, surfaceY, 0.875));
      return (d0 + d1 + d2 + d3) * 0.25;
    }

    float lowMistDensityAt(vec3 worldPoint) {
      vec2 uv = (worldPoint.xz - uLowMistBounds.xy) * uLowMistBounds.w;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
      vec4 field = texture2D(uLowMistMap, uv);
      float anchorY = mix(uLowMistHeightRange.x, uLowMistHeightRange.y, field.g);
      float layerHeight = mix(${LOW_MIST_MIN_HEIGHT.toFixed(2)}, ${LOW_MIST_MAX_HEIGHT.toFixed(2)}, field.b);
      float relativeY = worldPoint.y - anchorY;
      float aboveSurface = smoothstep(-0.55, 0.18, relativeY);
      float belowCeiling = 1.0 - smoothstep(layerHeight * 0.42, layerHeight, relativeY);
      return field.r * aboveSurface * belowCeiling;
    }

    float integratedLowMist(vec3 cameraWorld, vec3 surfaceWorld) {
      // Weighted stratification keeps the integration cheap while still resolving a shallow bank
      // near the surface on very high documentary shots. Weights approximate the represented ray
      // intervals so the near-surface sample does not make tall camera rays artificially opaque.
      float d0 = lowMistDensityAt(mix(cameraWorld, surfaceWorld, 0.10));
      float d1 = lowMistDensityAt(mix(cameraWorld, surfaceWorld, 0.30));
      float d2 = lowMistDensityAt(mix(cameraWorld, surfaceWorld, 0.50));
      float d3 = lowMistDensityAt(mix(cameraWorld, surfaceWorld, 0.70));
      float d4 = lowMistDensityAt(mix(cameraWorld, surfaceWorld, 0.86));
      float d5 = lowMistDensityAt(mix(cameraWorld, surfaceWorld, 0.96));
      return d0 * 0.20 + d1 * 0.20 + d2 * 0.20 + d3 * 0.20 + d4 * 0.12 + d5 * 0.08;
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).x;

      if (depth >= 0.99998) {
        gl_FragColor = source;
        return;
      }

      vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 viewPosition = uProjectionInverse * clip;
      viewPosition /= max(viewPosition.w, 0.00001);
      float distanceToSurface = length(viewPosition.xyz);
      vec3 worldPosition = (uCameraWorld * vec4(viewPosition.xyz, 1.0)).xyz;
      vec3 cameraWorld = uCameraWorld[3].xyz;
      vec3 worldDirection = normalize((uCameraWorld * vec4(normalize(viewPosition.xyz), 0.0)).xyz);

      float pathLength = max(0.0, distanceToSurface - uStartDistance);
      float heightDensity = integratedRayDensity(uCameraHeight, worldPosition.y);
      float surfaceDensity = densityAtHeight(worldPosition.y);

      // Clear air follows the height integral. Severe weather deliberately lifts some extinction
      // above the valley layer so blizzards/smoke can still obscure an elevated camera.
      float effectiveDensity = heightDensity + (1.0 - heightDensity) * uObscuration * 0.58;
      float extinction = 1.0 - exp(-pathLength * uDensity * effectiveDensity);
      float grazingView = pow(1.0 - abs(worldDirection.y), 1.35);
      float amount = extinction * uStrength * (0.78 + heightDensity * 0.14 + grazingView * 0.08);
      amount *= 1.0 + uObscuration * 0.2;

      float farBlend = smoothstep(uFarBlendStart, uFarBlendEnd, distanceToSurface);
      float horizonPath = farBlend * (0.5 + grazingView * 0.5) * (0.58 + effectiveDensity * 0.42);
      amount += horizonPath * (0.13 + uObscuration * 0.08);
      amount = clamp(amount, 0.0, 0.48 + uObscuration * 0.16);

      float mu = max(dot(worldDirection, normalize(uSunDirection)), 0.0);
      float forward = pow(mu, 9.0) * uForwardScatter * (0.42 + surfaceDensity * 0.3 + heightDensity * 0.28);
      forward *= 1.0 - uObscuration * 0.58;

      vec3 neutralAir = mix(uFogColor, uSkyFill, 0.7);
      neutralAir = mix(neutralAir, uSkyFill, farBlend * (0.12 + grazingView * 0.12));
      neutralAir = mix(neutralAir, uSkyFill * 0.72, uNightBlend * 0.62);
      vec3 airColor = mix(neutralAir, uSunColor, clamp(forward, 0.0, 0.32));
      vec3 color = mix(source.rgb, airColor, amount);

      // Mist is a separate shallow optical-depth term, but it shares the same air palette and ray.
      // It can therefore sit over water or thread through trees without bleaching clear mountaintops.
      float lowMist = integratedLowMist(cameraWorld, worldPosition);
      float mistOpticalDepth = distanceToSurface * 0.022 * lowMist * uLowMistStrength;
      float mistAmount = clamp(1.0 - exp(-mistOpticalDepth), 0.0, 0.28 + uObscuration * 0.04);
      vec3 mistColor = mix(uFogColor, uSkyFill, 0.58);
      mistColor = mix(mistColor, uSunColor, clamp(forward * 0.12, 0.0, 0.06));
      color = mix(color, mistColor, mistAmount);

      gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
    }
  `,
};
