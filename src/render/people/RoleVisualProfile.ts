import * as THREE from 'three';
import type { PersonRole } from '../../sim/types';

/**
 * A deliberately small visual vocabulary for occupation readability.
 *
 * Specific jobs stay simulation-authoritative; the renderer reduces them to a handful of
 * colour families that remain learnable at documentary-camera distance. Culture still tints
 * clothing, but occupation carries the stronger signal so a workforce reads before a viewer
 * can make out tools or headwear.
 */
export type RoleVisualFamily =
  | 'earth'
  | 'water'
  | 'labor'
  | 'trade'
  | 'guard'
  | 'ritual'
  | 'civic'
  | 'knowledge'
  | 'industry'
  | 'ordinary';

interface RoleVisualProfile {
  cue: string;
  /** Share of the final clothing colour owned by role rather than culture. */
  roleWeight: number;
  /** Readability floors after role/culture mixing. */
  minSaturation: number;
  minLightness: number;
  maxLightness: number;
}

/**
 * Muted enough to belong in the world, separated enough to be learned at a glance.
 * None of these are UI/neon colours: they are clothing dyes and workwear families.
 */
export const ROLE_VISUAL_PROFILES: Readonly<Record<RoleVisualFamily, RoleVisualProfile>> = {
  earth: { cue: '#789847', roleWeight: 0.72, minSaturation: 0.34, minLightness: 0.34, maxLightness: 0.62 },
  water: { cue: '#43899d', roleWeight: 0.72, minSaturation: 0.34, minLightness: 0.35, maxLightness: 0.62 },
  labor: { cue: '#ad6c32', roleWeight: 0.72, minSaturation: 0.36, minLightness: 0.35, maxLightness: 0.62 },
  trade: { cue: '#bd8a32', roleWeight: 0.72, minSaturation: 0.38, minLightness: 0.37, maxLightness: 0.64 },
  guard: { cue: '#737f92', roleWeight: 0.72, minSaturation: 0.25, minLightness: 0.38, maxLightness: 0.62 },
  ritual: { cue: '#a35b88', roleWeight: 0.72, minSaturation: 0.34, minLightness: 0.38, maxLightness: 0.64 },
  civic: { cue: '#735f94', roleWeight: 0.72, minSaturation: 0.3, minLightness: 0.37, maxLightness: 0.62 },
  knowledge: { cue: '#4f7fae', roleWeight: 0.72, minSaturation: 0.32, minLightness: 0.38, maxLightness: 0.64 },
  industry: { cue: '#657f85', roleWeight: 0.72, minSaturation: 0.24, minLightness: 0.37, maxLightness: 0.6 },
  // Children/elders/legacy fixtures should still read primarily as members of their culture.
  ordinary: { cue: '#8b6654', roleWeight: 0.5, minSaturation: 0.24, minLightness: 0.36, maxLightness: 0.64 },
};

export function roleVisualFamilyFor(role: PersonRole | undefined): RoleVisualFamily {
  if (role === 'farmer' || role === 'gatherer' || role === 'hunter') return 'earth';
  if (role === 'fisher' || role === 'sailor' || role === 'dock-worker') return 'water';
  if (role === 'builder' || role === 'laborer' || role === 'miner' || role === 'craft-worker') return 'labor';
  if (role === 'trader' || role === 'merchant' || role === 'transporter' || role === 'logistics-worker') return 'trade';
  if (role === 'guard' || role === 'soldier') return 'guard';
  if (role === 'priest' || role === 'ritual-specialist') return 'ritual';
  if (role === 'administrator' || role === 'manager') return 'civic';
  if (role && ['scholar', 'scientist', 'researcher', 'medical-worker', 'healer'].includes(role)) return 'knowledge';
  if (role && ['factory-worker', 'engineer', 'machinist', 'railway-worker', 'energy-technician', 'machine-systems-specialist', 'space-worker'].includes(role)) return 'industry';
  return 'ordinary';
}

export interface RoleVisualColorOptions {
  /** Override for secondary details such as hats; torso clothing should use the profile default. */
  roleWeight?: number;
  /** 0..1 clothing/material quality. It may shade a role but never erase it. */
  materialQuality?: number;
}

/**
 * Builds a role-readable clothing colour without inventing simulation state.
 *
 * Role is intentionally dominant for ordinary torso/limb clothing. Cultural colour remains
 * visible as a tint, while HSL floors keep dusk, dark cultural palettes and low material quality
 * from turning every represented person into the same black silhouette.
 */
export function roleVisualColor(
  role: PersonRole | undefined,
  culturalColor: THREE.ColorRepresentation,
  options: RoleVisualColorOptions = {},
): THREE.Color {
  const profile = ROLE_VISUAL_PROFILES[roleVisualFamilyFor(role)];
  const roleWeight = THREE.MathUtils.clamp(options.roleWeight ?? profile.roleWeight, 0, 1);
  const materialQuality = THREE.MathUtils.clamp(options.materialQuality ?? 0.5, 0, 1);

  const color = new THREE.Color(culturalColor).lerp(new THREE.Color(profile.cue), roleWeight);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);

  // Wealth/material quality can move value a little, but never enough to destroy occupational ID.
  const qualityShift = (materialQuality - 0.5) * 0.1;
  color.setHSL(
    hsl.h,
    Math.max(profile.minSaturation, hsl.s),
    THREE.MathUtils.clamp(hsl.l + qualityShift, profile.minLightness, profile.maxLightness),
  );
  return color;
}
