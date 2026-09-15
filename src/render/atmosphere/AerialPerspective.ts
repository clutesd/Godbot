import * as THREE from 'three';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { EnvironmentFrameState } from './EnvironmentFrameState';
import type { AtmosphericScatteringState } from './AtmosphericScattering';
import type { EnvironmentalDepthState } from './EnvironmentalDepth';
import {
  LOW_MIST_MAX_HEIGHT,
  LOW_MIST_MIN_HEIGHT,
  lowMistDiurnalStrength,
  lowMistWindRetention,
  type LowMistField,
} from './LowMistField';

/** World-space height falloff used by the aerial-density integral. */
export const AERIAL_HEIGHT_FALLOFF = 0.045;

const EMPTY_LOW_MIST_TEXTURE = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 255]),
  1,
  1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
EMPTY_LOW_MIST_TEXTURE.needsUpdate = true;
const EMPTY_LOW_MIST_FLOW_TEXTURE = new THREE.DataTexture(
  new Uint8Array([128, 128, 0, 255]),
  1,
  1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
EMPTY_LOW_MIST_FLOW_TEXTURE.needsUpdate = true;

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
 * Clear air and living low mist share one depth-aware integration point. Geography says where mist
 * may exist; time of day, wind, terrain flow and light determine how those banks behave this frame.
 */
export function updateAerialPerspectivePass(
  pass: ShaderPass,
  frame: EnvironmentFrameState,
  scattering: AtmosphericScatteringState,
  depthState: EnvironmentalDepthState,
  lowMistField: LowMistField | undefined,
  camera: THREE.PerspectiveCamera,
  depthTexture: THREE.DepthTexture | null,
): void {
  const uniforms = pass.uniforms;
  const mist = lowMistField?.sample();
  uniforms['tDepth']!.value = depthTexture;
  uniforms['uProjectionInverse']!.value.copy(camera.projectionMatrixInverse);
  uniforms['uCameraWorld']!.value.copy(camera.matrixWorld);
  uniforms['uCameraHeight']!.value = camera.position.y;
  uniforms['uSunDirection']!.value.copy(frame.sunDirection);
  uniforms['uSkyFill']!.value.copy(frame.skyFillColor);
  uniforms['uFogColor']!.value.copy(frame.sourceFogColor);
  uniforms['uSunColor']!.value.copy(frame.sunColor);
  uniforms['uMoonColor']!.value.copy(frame.moonColor);
  uniforms['uDensity']!.value = scattering.aerialDensity;
  uniforms['uStrength']!.value = scattering.aerialStrength;
  uniforms['uStartDistance']!.value = scattering.aerialStartDistance;
  uniforms['uForwardScatter']!.value = scattering.aerialForwardScatter;
  uniforms['uNightBlend']!.value = scattering.nightBlend;
  uniforms['uObscuration']!.value = scattering.obscuration;
  uniforms['uHeightFalloff']!.value = AERIAL_HEIGHT_FALLOFF;
  uniforms['uLowMistMap']!.value = mist?.texture ?? EMPTY_LOW_MIST_TEXTURE;
  uniforms['uLowMistFlowMap']!.value = mist?.flowTexture ?? EMPTY_LOW_MIST_FLOW_TEXTURE;

  const diurnal = lowMistDiurnalStrength(frame.solarElevation, frame.daylight, frame.atmosphericObscuration);
  const windRetention = lowMistWindRetention(mist?.windStrength ?? 0.12);
  const lowSun = frame.daylight * (1 - THREE.MathUtils.smoothstep(Math.max(0, frame.solarElevation), 0.12, 0.62));
  const sunGlow = THREE.MathUtils.clamp(
    (lowSun * 0.72 + frame.twilight * 0.32) * (1 - frame.atmosphericObscuration * 0.48),
    0,
    1,
  );
  const moonGlow = THREE.MathUtils.clamp(scattering.nightBlend * (0.13 + frame.moonIntensity * 0.24), 0, 0.42);
  uniforms['uMistSunGlow']!.value = sunGlow;
  uniforms['uMistMoonGlow']!.value = moonGlow;
  uniforms['uMistLayerScale']!.value = THREE.MathUtils.lerp(0.58, 1, diurnal);

  if (mist) {
    uniforms['uLowMistBounds']!.value.set(mist.originX, mist.originZ, mist.span, 1 / Math.max(0.001, mist.span));
    uniforms['uLowMistHeightRange']!.value.set(mist.minAnchorY, mist.maxAnchorY);
    uniforms['uLowMistStrength']!.value = THREE.MathUtils.clamp(
      mist.seasonalStrength * depthState.valleyMistMultiplier * diurnal * windRetention,
      0,
      1.05,
    );
    uniforms['uMistDrift']!.value.set(mist.driftX, mist.driftZ);
    uniforms['uMistTime']!.value = mist.motionTime;
    uniforms['uMistWindStrength']!.value = mist.windStrength;
  } else {
    uniforms['uLowMistBounds']!.value.set(-1, -1, 2, 0.5);
    uniforms['uLowMistHeightRange']!.value.set(0, 1);
    uniforms['uLowMistStrength']!.value = 0;
    uniforms['uMistDrift']!.value.set(0, 0);
    uniforms['uMistTime']!.value = 0;
    uniforms['uMistWindStrength']!.value = 0;
  }

  const farBlendStart = Math.max(scattering.aerialStartDistance * 4.5, camera.far * 0.16);
  const farBlendEnd = Math.max(farBlendStart + 120, camera.far * 0.5);
  uniforms['uFarBlendStart']!.value = farBlendStart;
  uniforms['uFarBlendEnd']!.value = farBlendEnd;
}

/**
 * Depth-aware aerial perspective. It runs in linear HDR space before bloom/grade/output.
 *
 * The broad atmosphere uses an exponential height-density integral. Low mist remains a shallow
 * geographically anchored layer, but its internal density rolls with wind, receives a downhill
 * gravity bias, burns back under a high clear sun and picks up restrained low-angle light.
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
    uMoonColor: { value: new THREE.Color('#9fb4e4') },
    uDensity: { value: 0.0048 },
    uStrength: { value: 0.48 },
    uStartDistance: { value: 22 },
    uForwardScatter: { value: 0.16 },
    uNightBlend: { value: 0 },
    uObscuration: { value: 0 },
    uHeightFalloff: { value: AERIAL_HEIGHT_FALLOFF },
    uFarBlendStart: { value: 144 },
    uFarBlendEnd: { value: 450 },
    uLowMistMap: { value: EMPTY_LOW_MIST_TEXTURE },
    uLowMistFlowMap: { value: EMPTY_LOW_MIST_FLOW_TEXTURE },
    uLowMistBounds: { value: new THREE.Vector4(-1, -1, 2, 0.5) },
    uLowMistHeightRange: { value: new THREE.Vector2(0, 1) },
    uLowMistStrength: { value: 0 },
    uMistDrift: { value: new THREE.Vector2() },
    uMistTime: { value: 0 },
    uMistWindStrength: { value: 0 },
    uMistLayerScale: { value: 1 },
    uMistSunGlow: { value: 0 },
    uMistMoonGlow: { value: 0 },
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
    uniform sampler2D uLowMistFlowMap;
    uniform mat4 uProjectionInverse;
    uniform mat4 uCameraWorld;
    uniform float uCameraHeight;
    uniform vec3 uSunDirection;
    uniform vec3 uSkyFill;
    uniform vec3 uFogColor;
    uniform vec3 uSunColor;
    uniform vec3 uMoonColor;
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
    uniform vec2 uMistDrift;
    uniform float uMistTime;
    uniform float uMistWindStrength;
    uniform float uMistLayerScale;
    uniform float uMistSunGlow;
    uniform float uMistMoonGlow;
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

    float mistBankPattern(vec2 worldXZ, vec2 downhill, float spill) {
      vec2 windSpace = worldXZ - uMistDrift;
      vec2 gravitySpace = worldXZ - downhill * uMistTime * (0.004 + spill * 0.017);
      float speed = 0.012 + uMistWindStrength * 0.032;
      float broad = sin(dot(windSpace, vec2(0.082, 0.047)) + uMistTime * speed);
      float cross = sin(dot(gravitySpace, vec2(-0.043, 0.099)) - uMistTime * 0.013);
      float fine = sin(dot(windSpace + gravitySpace * 0.35, vec2(0.151, -0.071)) + uMistTime * 0.021);
      float pattern = broad * 0.54 + cross * 0.31 + fine * 0.15;
      return mix(0.56, 1.17, smoothstep(-0.58, 0.66, pattern));
    }

    float lowMistDensityAt(vec3 worldPoint) {
      vec2 uv = (worldPoint.xz - uLowMistBounds.xy) * uLowMistBounds.w;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
      vec4 field = texture2D(uLowMistMap, uv);
      vec4 flow = texture2D(uLowMistFlowMap, uv);
      vec2 downhill = flow.rg * 2.0 - 1.0;
      float downhillLength = length(downhill);
      downhill = downhillLength > 0.08 ? downhill / downhillLength : vec2(0.0);
      float spill = flow.b;

      // A restrained upstream sample lets source density leave a faint downhill tail while the
      // terrain anchor remains local. This is the visual equivalent of a bank spilling through a
      // saddle, not a free-scrolling fog texture crossing mountains.
      vec2 upstreamUv = clamp(uv - downhill * spill * 0.012, vec2(0.0), vec2(1.0));
      float upstream = texture2D(uLowMistMap, upstreamUv).r;
      float sourceDensity = max(field.r, upstream * spill * 0.38);

      float anchorY = mix(uLowMistHeightRange.x, uLowMistHeightRange.y, field.g);
      float layerHeight = mix(${LOW_MIST_MIN_HEIGHT.toFixed(2)}, ${LOW_MIST_MAX_HEIGHT.toFixed(2)}, field.b) * uMistLayerScale;
      float relativeY = worldPoint.y - anchorY;
      float aboveSurface = smoothstep(-0.55, 0.18, relativeY);
      float belowCeiling = 1.0 - smoothstep(layerHeight * 0.42, layerHeight, relativeY);
      float banks = mistBankPattern(worldPoint.xz, downhill, spill);
      return sourceDensity * aboveSurface * belowCeiling * banks;
    }

    float integratedLowMist(vec3 cameraWorld, vec3 surfaceWorld) {
      // Weighted stratification keeps the integration cheap while still resolving a shallow bank
      // near the surface on very high documentary shots. Weights approximate represented intervals.
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

      float lowMist = integratedLowMist(cameraWorld, worldPosition);
      float mistOpticalDepth = distanceToSurface * 0.021 * lowMist * uLowMistStrength;
      float mistAmount = clamp(1.0 - exp(-mistOpticalDepth), 0.0, 0.27 + uObscuration * 0.04);
      float mistSunScatter = pow(mu, 5.0) * uMistSunGlow;
      float mistMoonScatter = uMistMoonGlow * (0.45 + grazingView * 0.35);
      vec3 mistColor = mix(uFogColor, uSkyFill, 0.6);
      mistColor = mix(mistColor, uSunColor, clamp(mistSunScatter * 0.28, 0.0, 0.22));
      mistColor = mix(mistColor, uMoonColor, clamp(mistMoonScatter * 0.16, 0.0, 0.1));
      color = mix(color, mistColor, mistAmount);

      gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
    }
  `,
};
