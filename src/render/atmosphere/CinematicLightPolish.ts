import * as THREE from 'three';
import type { EnvironmentFrameState } from './EnvironmentFrameState';

export interface CinematicLightPolishState {
  shadowLift: number;
  coolShadow: number;
  warmRestraint: number;
  saturation: number;
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
  aoKernelRadius: number;
  aoMaxDistance: number;
  waterSkyBlend: number;
  waterRoughnessBias: number;
  cloudOpacity: number;
  smokeOpacityScale: number;
}

export interface CinematicGradeUniforms {
  shadowLift: { value: number };
  coolShadow: { value: number };
  warmRestraint: { value: number };
  saturation: { value: number };
}

const clamp01 = (value: number): number => THREE.MathUtils.clamp(value, 0, 1);
const smoothstep = (min: number, max: number, value: number): number => {
  const t = clamp01((value - min) / Math.max(0.0001, max - min));
  return t * t * (3 - 2 * t);
};

/** Final art direction from the one authoritative environment frame. */
export function resolveCinematicLightPolish(frame: EnvironmentFrameState): CinematicLightPolishState {
  const daylight = clamp01(frame.daylight);
  const twilight = clamp01(frame.twilight);
  const obscuration = clamp01(frame.atmosphericObscuration);
  const night = 1 - daylight;
  const lowSun = daylight * (1 - smoothstep(0.12, 0.58, Math.max(0, frame.solarElevation)));

  return {
    shadowLift: 0.016 + lowSun * 0.032 + night * 0.018 + obscuration * 0.008,
    coolShadow: 0.012 + lowSun * 0.034 + night * 0.022,
    warmRestraint: lowSun * 0.34 + obscuration * 0.05,
    saturation: THREE.MathUtils.clamp(1.025 - lowSun * 0.035 - obscuration * 0.05 + daylight * 0.012, 0.94, 1.05),

    bloomStrength: 0.055 + night * 0.18 + twilight * 0.035,
    bloomThreshold: 1.24 - night * 0.19 - twilight * 0.035,
    bloomRadius: 0.34 + night * 0.12,

    aoKernelRadius: 1.65 + daylight * 0.55,
    aoMaxDistance: 0.028 + daylight * 0.012,

    waterSkyBlend: 0.08 + night * 0.22 + twilight * 0.08,
    waterRoughnessBias: obscuration * 0.085 + night * 0.015,
    cloudOpacity: THREE.MathUtils.clamp(0.18 + obscuration * 0.18 + twilight * 0.035, 0.16, 0.42),
    smokeOpacityScale: 0.84 + obscuration * 0.14 + night * 0.08,
  };
}

interface WaterMaterialBaseline {
  color: THREE.Color;
  roughness: number;
  clearcoatRoughness: number;
  vertexColors: boolean;
}

interface WaterMaterialRecord extends WaterMaterialBaseline {
  material: THREE.MeshPhysicalMaterial;
}

interface SmokeMaterialRecord {
  material: THREE.MeshStandardMaterial;
  color: THREE.Color;
  opacity: number;
}

const WATER_BASELINE_KEY = 'godboxCinematicWaterBaseline';

/**
 * Applies restrained material polish from the shared environment frame.
 *
 * Inland water can be destroyed/recreated when hydrology revisions occur. Water bindings are
 * therefore refreshed from the live scene and baseline material values are stored on the material
 * itself. A new water material receives polish immediately; an existing one never compounds tint or
 * roughness from previous frames.
 */
export class CinematicMaterialPolish {
  private readonly waterMaterials: WaterMaterialRecord[] = [];
  private waterSignature = '';
  private readonly smokeMaterials: SmokeMaterialRecord[] = [];
  private readonly cloudMaterial?: THREE.PointsMaterial;
  private readonly cloudBaseColor = new THREE.Color('#eef2f2');
  private readonly workingColor = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {
    this.refreshWaterMaterials(true);

    const cloudLayer = scene.getObjectByName('cloud-layer');
    if (cloudLayer instanceof THREE.Points && cloudLayer.material instanceof THREE.PointsMaterial) {
      this.cloudMaterial = cloudLayer.material;
      this.cloudBaseColor.copy(cloudLayer.material.color);
    }

    scene.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh) || !(object.geometry instanceof THREE.IcosahedronGeometry)) return;
      const material = object.material;
      if (!(material instanceof THREE.MeshStandardMaterial) || !material.transparent || material.opacity > 0.35 || material.roughness < 0.95) return;
      this.smokeMaterials.push({ material, color: material.color.clone(), opacity: material.opacity });
    });
  }

  update(frame: EnvironmentFrameState, polish: CinematicLightPolishState): void {
    this.refreshWaterMaterials();
    const daylight = clamp01(frame.daylight);
    const night = 1 - daylight;
    const twilight = clamp01(frame.twilight);

    this.workingColor.copy(frame.skyFillColor).lerp(frame.sunColor, twilight * 0.14);
    for (const record of this.waterMaterials) {
      const blend = polish.waterSkyBlend * (record.vertexColors ? 0.34 : 1);
      record.material.color.copy(record.color).lerp(this.workingColor, blend);
      record.material.roughness = THREE.MathUtils.clamp(record.roughness + polish.waterRoughnessBias, 0.12, 0.58);
      record.material.clearcoatRoughness = THREE.MathUtils.clamp(
        record.clearcoatRoughness + polish.waterRoughnessBias * 0.55,
        0.12,
        0.46,
      );
    }

    if (this.cloudMaterial) {
      this.cloudMaterial.color.copy(this.cloudBaseColor)
        .lerp(frame.skyFillColor, 0.34 + night * 0.12)
        .lerp(frame.sunColor, twilight * 0.18);
      this.cloudMaterial.opacity = polish.cloudOpacity;
    }

    for (const record of this.smokeMaterials) {
      record.material.color.copy(record.color)
        .lerp(frame.skyFillColor, 0.16 + night * 0.08)
        .lerp(frame.sunColor, twilight * 0.06);
      record.material.opacity = THREE.MathUtils.clamp(record.opacity * polish.smokeOpacityScale, 0.08, 0.32);
    }

    this.scene.userData['cinematicLightPolish'] = {
      shadowLift: polish.shadowLift,
      coolShadow: polish.coolShadow,
      warmRestraint: polish.warmRestraint,
      saturation: polish.saturation,
      bloomStrength: polish.bloomStrength,
      bloomThreshold: polish.bloomThreshold,
      aoKernelRadius: polish.aoKernelRadius,
      waterSkyBlend: polish.waterSkyBlend,
      environmentFrameEventDimmer: frame.eventDimmer,
    };
  }

  private refreshWaterMaterials(force = false): void {
    const waterGroup = this.scene.getObjectByName('water');
    const live: THREE.MeshPhysicalMaterial[] = [];
    waterGroup?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshPhysicalMaterial && !live.includes(material)) live.push(material);
      }
    });
    const signature = live.map(material => material.uuid).sort().join('|');
    if (!force && signature === this.waterSignature) return;
    this.waterSignature = signature;
    this.waterMaterials.length = 0;

    for (const material of live) {
      let baseline = material.userData[WATER_BASELINE_KEY] as WaterMaterialBaseline | undefined;
      if (!baseline) {
        baseline = {
          color: material.color.clone(),
          roughness: material.roughness,
          clearcoatRoughness: material.clearcoatRoughness,
          vertexColors: material.vertexColors,
        };
        material.userData[WATER_BASELINE_KEY] = baseline;
      }
      this.waterMaterials.push({ material, ...baseline });
    }
  }
}

/** Small HDR-space grade. ACES still owns the final tone curve in OutputPass. */
export const CINEMATIC_LIGHT_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    shadowLift: { value: 0.02 },
    coolShadow: { value: 0.02 },
    warmRestraint: { value: 0 },
    saturation: { value: 1 },
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
    uniform float shadowLift;
    uniform float coolShadow;
    uniform float warmRestraint;
    uniform float saturation;
    varying vec2 vUv;

    void main() {
      vec4 sampleColor = texture2D(tDiffuse, vUv);
      vec3 color = sampleColor.rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float shadowMask = 1.0 - smoothstep(0.07, 0.42, luma);

      color += vec3(0.22, 0.36, 0.58) * shadowLift * shadowMask;
      color.b += coolShadow * shadowMask * 0.06;

      float warmExcess = max(color.r - max(color.g, color.b), 0.0);
      color.r -= warmExcess * warmRestraint * 0.34;
      color.b += warmExcess * warmRestraint * 0.055;

      float gradedLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(gradedLuma), color, saturation);
      gl_FragColor = vec4(max(color, vec3(0.0)), sampleColor.a);
    }
  `,
};
