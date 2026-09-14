import * as THREE from 'three';
import type { EnvironmentalLightingState } from './EnvironmentalLighting';

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

/**
 * Final art-direction layer for the environmental rig.
 *
 * Steps 1 and 2 establish coherent light and depth. This resolver deliberately does not invent a
 * second day/night model: it consumes that shared state and limits the last-mile treatment to
 * highlight restraint, readable cool shadows, restrained bloom/AO and material response.
 */
export function resolveCinematicLightPolish(lighting: EnvironmentalLightingState): CinematicLightPolishState {
  const daylight = clamp01(lighting.daylight);
  const twilight = clamp01(lighting.twilight);
  const weather = clamp01(lighting.weatherSoftening);
  const night = 1 - daylight;
  const lowSun = daylight * (1 - smoothstep(0.12, 0.58, Math.max(0, lighting.solarElevation)));

  return {
    // Lift only the toe of the image. The lift is strongest when long shadows would otherwise
    // collapse into black, and remains small enough that night still reads as night.
    shadowLift: 0.016 + lowSun * 0.032 + night * 0.018 + weather * 0.008,
    coolShadow: 0.012 + lowSun * 0.034 + night * 0.022,
    // Golden hour should feel warm, not orange-filtered. This removes only excess red in the toe.
    warmRestraint: lowSun * 0.34 + weather * 0.06,
    saturation: THREE.MathUtils.clamp(1.025 - lowSun * 0.035 - weather * 0.055 + daylight * 0.012, 0.94, 1.05),

    // Bloom belongs to emissive settlement details, fire and hard glints — not daylight terrain.
    bloomStrength: 0.055 + night * 0.18 + twilight * 0.035,
    bloomThreshold: 1.24 - night * 0.19 - twilight * 0.035,
    bloomRadius: 0.34 + night * 0.12,

    // Step 2 AO was intentionally conservative, but the first real screenshots show that even a
    // broad 4.5-unit kernel can read as black paint at this scale. Keep it strictly contact-sized.
    aoKernelRadius: 1.65 + daylight * 0.55,
    aoMaxDistance: 0.028 + daylight * 0.012,

    waterSkyBlend: 0.08 + night * 0.22 + twilight * 0.08,
    waterRoughnessBias: weather * 0.09 + night * 0.015,
    cloudOpacity: THREE.MathUtils.clamp(0.18 + weather * 0.18 + twilight * 0.035, 0.16, 0.42),
    smokeOpacityScale: 0.84 + weather * 0.14 + night * 0.08,
  };
}

interface WaterMaterialRecord {
  material: THREE.MeshPhysicalMaterial;
  color: THREE.Color;
  roughness: number;
  clearcoatRoughness: number;
  vertexColors: boolean;
}

interface SmokeMaterialRecord {
  material: THREE.MeshStandardMaterial;
  color: THREE.Color;
  opacity: number;
}

/**
 * Applies restrained material-side polish from the shared lighting state. The simulation remains
 * untouched; these are renderer-only responses and all base material values are cached so updates
 * never compound from frame to frame.
 */
export class CinematicMaterialPolish {
  private readonly waterMaterials: WaterMaterialRecord[] = [];
  private readonly smokeMaterials: SmokeMaterialRecord[] = [];
  private readonly cloudMaterial?: THREE.PointsMaterial;
  private readonly cloudBaseColor = new THREE.Color('#eef2f2');
  private readonly workingColor = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {
    const waterGroup = scene.getObjectByName('water');
    waterGroup?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
        this.waterMaterials.push({
          material,
          color: material.color.clone(),
          roughness: material.roughness,
          clearcoatRoughness: material.clearcoatRoughness,
          vertexColors: material.vertexColors,
        });
      }
    });

    const cloudLayer = scene.getObjectByName('cloud-layer');
    if (cloudLayer instanceof THREE.Points && cloudLayer.material instanceof THREE.PointsMaterial) {
      this.cloudMaterial = cloudLayer.material;
      this.cloudBaseColor.copy(cloudLayer.material.color);
    }

    // The settlement/industry smoke pool is an instanced, translucent standard-material
    // icosahedron. Identifying it by those renderer traits avoids coupling this module to the giant
    // GodboxRenderer while still leaving opaque rocks and weather particles alone.
    scene.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh) || !(object.geometry instanceof THREE.IcosahedronGeometry)) return;
      const material = object.material;
      if (!(material instanceof THREE.MeshStandardMaterial) || !material.transparent || material.opacity > 0.35 || material.roughness < 0.95) return;
      this.smokeMaterials.push({ material, color: material.color.clone(), opacity: material.opacity });
    });
  }

  update(lighting: EnvironmentalLightingState, polish: CinematicLightPolishState): void {
    const daylight = clamp01(lighting.daylight);
    const night = 1 - daylight;
    const twilight = clamp01(lighting.twilight);

    this.workingColor.copy(lighting.skyFillColor).lerp(lighting.sunColor, twilight * 0.14);
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
        .lerp(lighting.skyFillColor, 0.34 + night * 0.12)
        .lerp(lighting.sunColor, twilight * 0.18);
      this.cloudMaterial.opacity = polish.cloudOpacity;
    }

    for (const record of this.smokeMaterials) {
      record.material.color.copy(record.color)
        .lerp(lighting.skyFillColor, 0.16 + night * 0.08)
        .lerp(lighting.sunColor, twilight * 0.06);
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
    };
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

      // A tiny cool toe lift preserves form in long shadows without flattening the image.
      color += vec3(0.22, 0.36, 0.58) * shadowLift * shadowMask;
      color.b += coolShadow * shadowMask * 0.06;

      // Restrain only red that exceeds both green and blue; neutral stone, snow and UI-like whites
      // remain untouched while low-angle orange no longer paints half the terrain.
      float warmExcess = max(color.r - max(color.g, color.b), 0.0);
      color.r -= warmExcess * warmRestraint * 0.34;
      color.b += warmExcess * warmRestraint * 0.055;

      float gradedLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(gradedLuma), color, saturation);
      gl_FragColor = vec4(max(color, vec3(0.0)), sampleColor.a);
    }
  `,
};
