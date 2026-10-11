import * as THREE from 'three';

const LAVA_STATE_KEY = 'lava';
interface LavaState { time: { value: number }; activity: { value: number } }

/**
 * Flowing lava on ribbons whose `flowUV` is (across 0..1, distance along in world units, fraction
 * of the flow's length 0..1). The melt front reaches further down the channel as `uActivity`
 * rises: at rest the channels read as cooled crust while the separate lake keeps its faint glow;
 * mid-eruption incandescent seams travel between crust plates. Uniforms live in userData so they can be
 * updated without holding the compiled shader.
 */
export function lavaMaterial(lake = false): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: '#51443b', roughness: 0.92, metalness: 0.02, emissive: '#000000',
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.name = 'Flowing lava';
  material.customProgramCacheKey = () => `lava-flow-v3-${lake ? 'lake' : 'channel'}`;
  const state: LavaState = { time: { value: 0 }, activity: { value: 0.2 } };
  material.userData[LAVA_STATE_KEY] = state;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = state.time;
    shader.uniforms.uActivity = state.activity;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 flowUV;\nvarying vec3 vFlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFlow = flowUV;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uActivity;
varying vec3 vFlow;
float lavaHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lavaNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lavaHash(i), lavaHash(i + vec2(1.0, 0.0)), f.x),
    mix(lavaHash(i + vec2(0.0, 1.0)), lavaHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float speed = 0.35 + uActivity * 1.6;
vec2 drift = ${lake ? 'vFlow.xy * 3.0 + vec2(sin(uTime * 0.12), cos(uTime * 0.09)) * 0.6' : 'vec2(vFlow.x * 2.2, vFlow.y * 0.9 - uTime * speed)'};
float plates = lavaNoise(drift) * 0.65 + lavaNoise(drift * 2.7 + 7.0) * 0.35;
float reach = clamp((uActivity - 0.46) / 0.54, 0.0, 1.0);
float front = ${lake ? '0.22 + uActivity * 0.78' : '(1.0 - smoothstep(reach - 0.08, reach, vFlow.z)) * smoothstep(0.0, 0.08, reach)'};
float edge = ${lake ? '1.0 - smoothstep(0.5, 1.0, length(vFlow.xy))' : '1.0 - smoothstep(0.22, 0.5, abs(vFlow.x - 0.5))'};
float crust = smoothstep(0.32, 0.62, plates);
float melt = clamp(front * edge * (1.0 - crust * 0.94), 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb * (0.55 + plates * 0.9), vec3(0.06, 0.02, 0.01), melt);
${lake ? '' : 'if (abs(vFlow.x - 0.5) > 0.40 + lavaNoise(vec2(vFlow.y * 3.0, 1.0)) * 0.1) discard;'} `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec3 hot = mix(vec3(0.9, 0.055, 0.002), vec3(1.0, 0.42, 0.055), clamp(melt * melt, 0.0, 1.0));
totalEmissiveRadiance = hot * melt * (1.2 + uActivity * 1.8);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.55, melt);`);
  };
  // Rock and molten surfaces are opaque: they must occlude smoke and their own far bank.
  material.transparent = false;
  material.depthWrite = true;
  return material;
}

export function updateLavaMaterial(material: THREE.MeshStandardMaterial, elapsed: number, activity: number): void {
  const state = material.userData[LAVA_STATE_KEY] as LavaState | undefined;
  if (!state) return;
  state.time.value = elapsed;
  state.activity.value = activity;
}
