import * as THREE from 'three';

/** World-anchored soil detail; roadUV carries lateral position and distance in world units.
 * A separate attribute avoids dependence on Three's optional texture UV defines. */
export function roadSurfaceMaterial(color: THREE.ColorRepresentation = '#a08a69', vertexColors = false): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, vertexColors, roughness: 0.96,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -1 });
  material.name = 'Weathered earth and aggregate';
  material.customProgramCacheKey = () => 'road-surface-v1';
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 roadUV;
varying vec3 vRoad;
varying vec2 vRoadGround;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vRoad = roadUV;
vRoadGround = position.xz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRoad;
varying vec2 vRoadGround;
float roadHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float roadNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(roadHash(i), roadHash(i+vec2(1,0)), f.x),
    mix(roadHash(i+vec2(0,1)), roadHash(i+vec2(1,1)), f.x), f.y);
}`).replace('#include <color_fragment>', `#include <color_fragment>
float broad = roadNoise(vRoadGround * 4.0);
float grit = roadNoise(vRoadGround * 95.0);
float detailFade = 1.0 - smoothstep(0.015, 0.09, length(fwidth(vRoadGround)));
float edge = abs(vRoad.x * 2.0 - 1.0);
float brokenEdge = edge + (roadNoise(vRoadGround * 28.0) - 0.5) * 0.16;
float coverage = 1.0 - smoothstep(0.70, 1.0, brokenEdge);
float cart = smoothstep(2.8, 4.0, vRoad.z);
float rutDistance = (edge - 0.46) * 10.0;
float rut = exp(-rutDistance * rutDistance) * cart;
float center = (1.0 - smoothstep(0.05, 0.30, edge)) * cart;
float stones = smoothstep(0.63, 0.79, grit) * detailFade;
float engineered = smoothstep(4.1, 5.0, vRoad.z);
vec2 paving = vec2(vRoad.y * 14.0, vRoad.x * 5.0);
paving.x += mod(floor(paving.y), 2.0) * 0.5;
vec2 jointDistance = min(fract(paving), 1.0 - fract(paving));
vec2 jointAA = max(fwidth(paving), vec2(0.01));
vec2 blockInterior = smoothstep(vec2(0.035), vec2(0.035) + jointAA, jointDistance);
float mortar = (1.0 - blockInterior.x * blockInterior.y) * engineered * detailFade;
diffuseColor.rgb *= 0.88 + broad * 0.25 + (grit - 0.5) * 0.20 * detailFade;
diffuseColor.rgb *= 1.0 - rut * 0.22;
diffuseColor.rgb *= 1.0 - mortar * 0.24;
diffuseColor.rgb += vec3(0.10, 0.085, 0.055) * stones;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.87, 0.64), center * 0.28);
diffuseColor.a *= coverage;
`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - rut * 0.14 + (grit - 0.5) * 0.08, 0.72, 1.0);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
// Derivative relief keeps grit responsive to light without a texture allocation.
float roadRelief = ((grit - 0.5) * 0.0012 - rut * 0.002 - mortar * 0.001) * detailFade;
vec3 roadDx = dFdx(-vViewPosition), roadDy = dFdy(-vViewPosition);
vec3 roadR1 = cross(roadDy, normal), roadR2 = cross(normal, roadDx);
float roadDet = dot(roadDx, roadR1);
normal = normalize(abs(roadDet) * normal - sign(roadDet) *
  (dFdx(roadRelief) * roadR1 + dFdy(roadRelief) * roadR2) + normal * 1e-10);
`);
  };
  return material;
}
