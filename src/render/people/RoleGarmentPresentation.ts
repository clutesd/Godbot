import * as THREE from 'three';

/**
 * The role garment is a tiny presentation-only shell around the upper torso. It exists because a
 * physically lit humanoid only a handful of pixels tall can lose almost all chroma in shade even
 * when its source colour is correct. The shell uses an unlit material, but its global brightness is
 * driven by daylight so it reads as dyed cloth rather than a UI marker or night-time glow.
 */
export const ROLE_GARMENT_DAY_BRIGHTNESS = 0.82;
export const ROLE_GARMENT_NIGHT_BRIGHTNESS = 0.075;

const clamp01 = (value: number): number => THREE.MathUtils.clamp(value, 0, 1);

export function roleGarmentBrightnessForDaylight(daylight: number): number {
  const d = clamp01(daylight);
  // Preserve the first useful daylight quickly, then ease toward full colour in bright conditions.
  const t = THREE.MathUtils.smoothstep(d, 0.04, 0.72);
  return THREE.MathUtils.lerp(ROLE_GARMENT_NIGHT_BRIGHTNESS, ROLE_GARMENT_DAY_BRIGHTNESS, t);
}

export function createRoleGarmentMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setScalar(ROLE_GARMENT_DAY_BRIGHTNESS),
    vertexColors: true,
    toneMapped: true,
    fog: true,
  });
  material.name = 'godbox-role-garment';
  material.userData['roleReadable'] = true;
  return material;
}

export function updateRoleGarmentMaterial(material: THREE.MeshBasicMaterial, daylight: number): void {
  material.color.setScalar(roleGarmentBrightnessForDaylight(daylight));
}
