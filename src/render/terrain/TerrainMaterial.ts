import * as THREE from 'three';

/** World-anchored mineral strata and soil grain, without textures or additional draw calls. */
export function createTerrainMaterial(seaLevelY: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0, vertexColors: true });
  material.customProgramCacheKey = () => 'terrain-geology-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms['terrainSeaLevel'] = { value: seaLevelY };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vTerrainPosition;
varying vec3 vTerrainNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTerrainPosition = (modelMatrix * vec4(position, 1.0)).xyz;
vTerrainNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float terrainSeaLevel;
varying vec3 vTerrainPosition;
varying vec3 vTerrainNormal;
float terrainHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float terrainNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(terrainHash(i), terrainHash(i + vec3(1,0,0)), f.x),
                 mix(terrainHash(i + vec3(0,1,0)), terrainHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(terrainHash(i + vec3(0,0,1)), terrainHash(i + vec3(1,0,1)), f.x),
                 mix(terrainHash(i + vec3(0,1,1)), terrainHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 terrainP = vTerrainPosition;
float terrainFootprint = max(length(dFdx(terrainP)), length(dFdy(terrainP)));
float terrainClose = 1.0 - smoothstep(0.12, 0.8, terrainFootprint);
float terrainMacro = terrainNoise(terrainP * 0.42);
float terrainGrain = terrainNoise(terrainP * 5.0);
float terrainCliff = 1.0 - smoothstep(0.48, 0.88, normalize(vTerrainNormal).y);
float terrainDry = smoothstep(terrainSeaLevel - 0.1, terrainSeaLevel + 0.4, terrainP.y);
// Tilted, interrupted bedding follows the rock in three dimensions, including vertical faces.
float terrainPhase = terrainP.y * 3.1 + terrainP.x * 0.23 + terrainP.z * 0.16 + terrainMacro * 6.5;
float terrainBand = sin(terrainPhase) * (1.0 - smoothstep(0.4, 2.5, fwidth(terrainPhase)));
float terrainRelief = ((terrainGrain - 0.5) * 0.012 + terrainBand * terrainCliff * 0.006) * terrainClose * terrainDry;
diffuseColor.rgb *= 1.0 + (terrainMacro - 0.5) * 0.16
  + ((terrainGrain - 0.5) * 0.09 + terrainBand * terrainCliff * 0.045) * terrainClose * terrainDry;
`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
// Screen derivatives produce small mineral relief without displacing the authoritative surface.
vec3 terrainDx = dFdx(-vViewPosition), terrainDy = dFdy(-vViewPosition);
vec3 terrainR1 = cross(terrainDy, normal), terrainR2 = cross(normal, terrainDx);
float terrainDet = dot(terrainDx, terrainR1);
if (abs(terrainDet) > 1e-8) {
  vec3 terrainGradient = sign(terrainDet) * (dFdx(terrainRelief) * terrainR1 + dFdy(terrainRelief) * terrainR2);
  normal = normalize(abs(terrainDet) * normal - terrainGradient);
}
`);
  };
  return material;
}
