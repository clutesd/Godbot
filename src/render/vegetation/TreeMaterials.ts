import * as THREE from 'three';
import type { TreeFamily } from './TreeLibrary';

export const CAMERA_CANOPY_DISSOLVE = {
  fullDistance: 2.8,
  clearDistance: 11.5,
  innerAngle: 0.075,
  outerAngle: 0.22,
  maxDissolve: 0.9,
} as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep01 = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/**
 * CPU mirror of the foliage shader envelope, used by tests and tuning tools.
 * `tangentAngle` is view-space radial offset / forward depth, so the response is resolution and FOV stable.
 */
export function cameraCanopyDissolveStrength(distance: number, tangentAngle: number): number {
  const distanceSpan = CAMERA_CANOPY_DISSOLVE.clearDistance - CAMERA_CANOPY_DISSOLVE.fullDistance;
  const angleSpan = CAMERA_CANOPY_DISSOLVE.outerAngle - CAMERA_CANOPY_DISSOLVE.innerAngle;
  const near = 1 - smoothstep01((distance - CAMERA_CANOPY_DISSOLVE.fullDistance) / Math.max(0.001, distanceSpan));
  const centered = 1 - smoothstep01((tangentAngle - CAMERA_CANOPY_DISSOLVE.innerAngle) / Math.max(0.001, angleSpan));
  return clamp01(near * centered * CAMERA_CANOPY_DISSOLVE.maxDissolve);
}

/** Shared colour/shadow deformation. Attributes are owned by each existing instance bucket. */
export function bindTreeMaterial(mesh: THREE.InstancedMesh, kind: 'bark' | 'foliage', family: TreeFamily, height: number): THREE.InstancedBufferAttribute {
  const state = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 4), 4);
  state.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('treeState', state);
  const material = mesh.material as THREE.MeshStandardMaterial;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const distance = new THREE.MeshDistanceMaterial();
  const bark = kind === 'bark';
  const declarations = `varying vec3 treeLocal; varying vec4 treeCondition;`;
  const fracture = `
    float fractureY = treeHeight * treeCondition.x + treeHeight * 0.008 *
      (sin(treeLocal.x * 173.0 + treeCondition.z) + sin(treeLocal.z * 131.0));
    if (treeCondition.x < 0.999 && treeLocal.y > fractureY) discard;
  `;
  const canopyDissolve = `
    // Presentation-only foreground clearing. vViewPosition is already supplied by MeshStandardMaterial:
    // it lets foliage yield around the centre of the lens without deleting trees or touching bark.
    float canopyViewDistance = length(vViewPosition);
    float canopyViewAngle = length(vViewPosition.xy) / max(abs(vViewPosition.z), 0.001);
    float canopyNear = 1.0 - smoothstep(${CAMERA_CANOPY_DISSOLVE.fullDistance.toFixed(3)}, ${CAMERA_CANOPY_DISSOLVE.clearDistance.toFixed(3)}, canopyViewDistance);
    float canopyCentered = 1.0 - smoothstep(${CAMERA_CANOPY_DISSOLVE.innerAngle.toFixed(3)}, ${CAMERA_CANOPY_DISSOLVE.outerAngle.toFixed(3)}, canopyViewAngle);
    float canopyFade = canopyNear * canopyCentered * ${CAMERA_CANOPY_DISSOLVE.maxDissolve.toFixed(3)};
    vec3 canopyCell = floor((treeLocal / max(treeHeight, 0.001)) * 41.0);
    float canopyDither = fract(sin(dot(canopyCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (canopyDither < canopyFade) discard;
  `;
  for (const target of [material, depth, distance]) {
    target.onBeforeCompile = shader => {
      shader.uniforms['treeHeight'] = { value: height };
      shader.vertexShader = `attribute vec4 treeState; ${bark ? '' : 'attribute vec3 canopyAnchor;'}
        ${declarations}\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        treeLocal = position; treeCondition = treeState;
        ${bark ? '' : 'transformed += (canopyAnchor - position) * (1.0 - treeState.x);'}
        // The root stays anchored. Real worker contact gives this existing tree a tiny deflection;
        // w is transient presentation feedback, cleared each frame, never a damage counter.
        transformed.x += treeState.w * max(0.0, transformed.y) * 0.004;
      `);
      shader.fragmentShader = `uniform float treeHeight; ${declarations}\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        ${bark ? fracture : `if (treeCondition.x < 0.001) discard;${target === material ? canopyDissolve : ''}`}
      `);
      if (bark && target === material) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
          #include <color_fragment>
          vec3 p = treeLocal / max(treeHeight, 0.001);
          float grainPhase = p.x * 146.0 + p.z * 119.0 + sin(p.y * 17.0) * 0.7 + treeCondition.z;
          float grainAA = 1.0 - smoothstep(0.7, 2.5, fwidth(grainPhase));
          float grain = sin(grainPhase) * grainAA;
          ${family === 'birch' ? `
            // Broken, antialiased lenticels along the pale bole; no textures or emissive lift.
            float bandPhase = p.y * 155.0 + sin(p.x * 32.0 + p.z * 21.0) + treeCondition.z;
            float bandAA = 1.0 - smoothstep(0.7, 2.5, fwidth(bandPhase));
            float marks = smoothstep(0.78, 0.96, sin(bandPhase)) * bandAA
              * smoothstep(-0.2, 0.5, sin(p.x * 91.0 - p.z * 73.0 + p.y * 23.0));
            diffuseColor.rgb *= 1.0 - marks * 0.56;
          ` : `
            diffuseColor.rgb *= 0.96 + grain * 0.065;
          `}
          float weathering = treeCondition.y;
          float woodValue = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(woodValue) * vec3(1.13, 1.1, 1.04), weathering * 0.82);
          diffuseColor.rgb *= 1.0 - weathering * 0.12;
          // A restrained exposed-wood rim communicates a fracture rather than a shortened tree.
          float rim = (1.0 - smoothstep(0.002, treeHeight * 0.018, fractureY - treeLocal.y))
            * (1.0 - step(0.999, treeCondition.x));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.23, 0.14), rim * 0.65);
        `);
      }
    };
    target.customProgramCacheKey = () => `tree-v3:${kind}:${bark && family === 'birch' ? 'birch' : 'standard'}:${target.type}`;
  }
  mesh.customDepthMaterial = depth;
  mesh.customDistanceMaterial = distance;
  // The existing renderer disposes the main material; keep shadow resource lifetime identical.
  material.addEventListener('dispose', () => { depth.dispose(); distance.dispose(); });
  return state;
}
