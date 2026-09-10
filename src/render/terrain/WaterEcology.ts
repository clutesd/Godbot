import * as THREE from 'three';
import type { WorldState } from '../../sim/types';
import { elevationToY } from '../../sim/terrain/SurfaceGeometry';
import { ECOLOGY_GLSL, ecologyUniforms, type EcologyField } from '../ecology/EcologyField';

/** Shader extension on the existing physical water materials; hydrology still owns the mesh.
 * One shared terrain texture gives the ocean the same shoreline as the authoritative heightfield. */
export class WaterEcology {
  private readonly terrain: THREE.DataTexture;
  private readonly bounds: THREE.Vector4;
  constructor(private readonly world: WorldState, private readonly ecology: EcologyField, private readonly complexity: 0 | 1 | 2) {
    const field = world.terrain;
    const heights = Float32Array.from(field.height, h => elevationToY(h, world.seaLevel));
    this.terrain = new THREE.DataTexture(heights, field.resolution, field.resolution, THREE.RedFormat, THREE.FloatType);
    this.terrain.minFilter = this.terrain.magFilter = THREE.LinearFilter;
    this.terrain.needsUpdate = true;
    this.bounds = new THREE.Vector4(field.originX - field.step / 2, field.originZ - field.step / 2,
      field.resolution * field.step, field.resolution * field.step);
  }

  refreshTerrain(): void {
    const data = this.terrain.image.data as Float32Array;
    for (let i = 0; i < data.length; i++) data[i] = elevationToY(this.world.terrain.height[i]!, this.world.seaLevel);
    this.terrain.needsUpdate = true;
  }

  bind(mesh: THREE.Mesh | undefined, ocean: boolean): void {
    if (!mesh) return;
    const material = mesh.material as THREE.MeshPhysicalMaterial;
    const original = material.onBeforeCompile;
    const originalKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      original.call(material, shader, renderer);
      Object.assign(shader.uniforms, ecologyUniforms(this.ecology), {
        ecologyTerrain: { value: this.terrain }, ecologyTerrainBounds: { value: this.bounds },
        ecologySeaY: { value: elevationToY(this.world.seaLevel, this.world.seaLevel) },
        ecologySeed: { value: this.ecology.seedPhase },
      });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEcologyWaterWorld;')
        .replace('#include <project_vertex>', 'vEcologyWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        #define ECOLOGY_WATER_COMPLEXITY ${this.complexity}
        ${ECOLOGY_GLSL}
        ${WATER_LIFE_GLSL}
        varying vec3 vEcologyWaterWorld;
        uniform sampler2D ecologyTerrain;
        uniform vec4 ecologyTerrainBounds;
        uniform float ecologySeaY;
      `);
      const depth = ocean ? `
        vec2 terrainUV = (vEcologyWaterWorld.xz - ecologyTerrainBounds.xy) / ecologyTerrainBounds.zw;
        float inTerrain = step(0.0, terrainUV.x) * step(terrainUV.x, 1.0) * step(0.0, terrainUV.y) * step(terrainUV.y, 1.0);
        float bioDepth = mix(20.0, max(0.0, ecologySeaY - texture2D(ecologyTerrain, terrainUV).r), inTerrain);
        float bioIce = 0.0;
        float bioRain = waterRain;
        float bioStorm = waterStorm;
        vec2 bioFlow = ecologyWind * 0.08;
      ` : `float bioDepth = vWaterDepth;
        float bioIce = vWaterIce;
        float bioRain = vWaterRain;
        float bioStorm = vWaterStorm;
        vec2 bioFlow = vWaterFlowDirection * vWaterFlow * 0.2 + ecologyWind * 0.035;
      `;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${depth}`);
      // Append after the original color/ice calculation, not before it.
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008, 0.025, 0.064), ecologyNight * (1.0 - bioIce) * 0.86);
        #include <roughnessmap_fragment>`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec2 waterP = vEcologyWaterWorld.xz;
        float waveT = ecologyTime;
        vec2 slope = vec2(cos(waterP.x * 1.65 + waterP.y * 0.45 - waveT * 0.9),
          sin(waterP.y * 1.9 - waterP.x * 0.32 + waveT * 0.65)) * (0.065 + bioStorm * 0.1);
        slope += vec2(sin(waterP.y * 7.3 + waveT * 1.8), cos(waterP.x * 8.1 - waveT * 1.6)) * (0.015 + bioRain * 0.025);
        vec3 rippleNormal = normalize((viewMatrix * vec4(normalize(vec3(-slope.x, 1.0, -slope.y)), 0.0)).xyz);
        normal = normalize(mix(normal, rippleNormal, 0.88 * (1.0 - bioIce)));
        nonPerturbedNormal = normal;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #if ECOLOGY_WATER_COMPLEXITY > 0
        if (ecologyNight > 0.001) {
          vec4 habitat = habitatAt(vEcologyWaterWorld.xz);
          float distanceFade = 1.0 - smoothstep(110.0, 280.0, length(vViewPosition));
          float life = habitat.g * (1.0 + habitat.b * 2.5) * (1.0 - bioIce) * ecologyNight * distanceFade;
          ${ocean ? '' : 'life *= 1.0 - step(1.5, vWaterKind) * 0.92;'}
          totalEmissiveRadiance += livingWater(vEcologyWaterWorld.xz, bioDepth, bioFlow, bioRain, bioStorm) * life;
        }
        #endif
        // A subdued blue sky reflection remains between the emissive organisms; physical light
        // specular/clearcoat above it still responds to the animated normals and real scene lights.
        float skyFresnel = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += mix(vec3(0.13, 0.22, 0.28), vec3(0.008, 0.022, 0.065), ecologyNight)
          * skyFresnel * (1.0 - bioIce);
      `);
    };
    material.customProgramCacheKey = () => `${originalKey}-ecology-v1-${this.complexity}`;
    material.needsUpdate = true;
  }
  dispose(): void { this.terrain.dispose(); }
}

const WATER_LIFE_GLSL = `
uniform float ecologySeed;
float bioHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + ecologySeed);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bioNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bioHash(i), bioHash(i + vec2(1, 0)), f.x),
    mix(bioHash(i + vec2(0, 1)), bioHash(i + vec2(1, 1)), f.x), f.y);
}
vec3 planktonPoints(vec2 p, float abundance, float t) {
  vec2 id = floor(p);
  float h = bioHash(id);
  vec2 centre = vec2(0.22) + 0.56 * vec2(bioHash(id + 9.2), bioHash(id + 17.7));
  float d = length(fract(p) - centre);
  float aa = max(0.008, fwidth(d));
  float core = 1.0 - smoothstep(0.025, 0.025 + aa, d);
  core *= min(1.0, 0.045 / aa);
  float halo = exp(-d * d * 110.0) * 0.24;
  float colonyActive = smoothstep(1.0 - abundance, 1.0 - abundance + 0.06, h);
  float breath = 0.55 + 0.45 * sin(t * 0.4 + h * 53.0);
  vec3 colour = mix(vec3(0.045, 0.7, 1.9), vec3(0.55, 0.16, 1.3), bioHash(id + 3.4));
  colour = mix(colour, vec3(1.8, 0.88, 0.28), step(0.975, bioHash(id + 5.6)));
  return colour * (core * 8.0 + halo) * colonyActive * breath;
}
vec3 livingWater(vec2 p, float depth, vec2 flow, float rain, float storm) {
  float t = ecologyTime;
  vec2 current = p - flow * t;
  vec2 warp = vec2(bioNoise(current * 0.035 + t * 0.009), bioNoise(current * 0.041 - t * 0.007 + 51.0));
  vec2 q = current + (warp - 0.5) * 9.0;
  float colonies = bioNoise(q * 0.11);
  float colonyPatch = smoothstep(0.38, 0.76, colonies);
  float shore = (1.0 - smoothstep(0.07, 2.8, depth)) * smoothstep(0.0, 0.08, depth);
  // Advected sparse cells and curved noise bands: no screen-space/static star texture.
  vec3 light = planktonPoints(q * 1.9, 0.07 + colonyPatch * 0.28 + shore * 0.15, t);
  #if ECOLOGY_WATER_COMPLEXITY > 1
    light += planktonPoints(q * 4.3 + vec2(12.0, t * 0.015), 0.035 + colonyPatch * 0.14, t + 17.0) * 0.48;
    float thread = abs(sin(q.x * 0.44 + q.y * 0.29 + bioNoise(q * 0.09 + 14.0) * 10.0 - t * 0.06));
    float filament = (1.0 - smoothstep(0.025, 0.09 + fwidth(thread), thread)) * colonyPatch;
    light += mix(vec3(0.025, 0.3, 0.85), vec3(0.3, 0.05, 0.65), warp.y) * filament * 1.2;
  #endif
  float wave = pow(0.5 + 0.5 * sin(p.x * 1.1 + p.y * 0.75 - t * 0.85 + warp.x * 5.0), 6.0);
  float shoreColony = shore * smoothstep(0.3, 0.65, bioNoise(p * 0.16));
  light += vec3(0.018, 0.85, 1.8) * shoreColony * (0.14 + wave * 1.7);
  // Rain/current/wave disturbances excite existing plankton; they cannot create life in dead water.
  float rainPulse = pow(max(0.0, sin(p.x * 5.3 + t * 3.1) * sin(p.y * 5.9 - t * 2.7)), 8.0) * rain;
  return light * (0.8 + shore * 0.8 + wave * storm * 0.55) + vec3(0.05, 0.9, 1.5) * rainPulse * colonyPatch;
}
`;
