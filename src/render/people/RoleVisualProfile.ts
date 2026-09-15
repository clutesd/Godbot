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
 * These are world colours rather than UI colours, but they intentionally sit one value step above
 * the surrounding terrain palette. Step 1 failed when role hues were technically different yet all
 * landed in the same dark perceptual bucket after lighting. The stronger separation here gives the
 * renderer enough chroma/value to survive normal atmospheric and tone-mapping losses.
 */
export const ROLE_VISUAL_PROFILES: Readonly<Record<RoleVisualFamily, RoleVisualProfile>> = {
  earth: { cue: '#86aa50', roleWeight: 0.8, minSaturation: 0.38, minLightness: 0.39, maxLightness: 0.66 },
  water: { cue: '#4d98ad', roleWeight: 0.8, minSaturation: 0.38, minLightness: 0.4, maxLightness: 0.66 },
  labor: { cue: '#bf7639', roleWeight: 0.8, minSaturation: 0.4, minLightness: 0.4, maxLightness: 0.66 },
  trade: { cue: '#cb9738', roleWeight: 0.8, minSaturation: 0.42, minLightness: 0.42, maxLightness: 0.68 },
  guard: { cue: '#7e8fa6', roleWeight: 0.8, minSaturation: 0.28, minLightness: 0.41, maxLightness: 0.66 },
  ritual: { cue: '#b26493', roleWeight: 0.8, minSaturation: 0.38, minLightness: 0.41, maxLightness: 0.68 },
  civic: { cue: '#7e68a5', roleWeight: 0.8, minSaturation: 0.34, minLightness: 0.41, maxLightness: 0.66 },
  knowledge: { cue: '#5789bf', roleWeight: 0.8, minSaturation: 0.36, minLightness: 0.41, maxLightness: 0.68 },
  industry: { cue: '#708b93', roleWeight: 0.8, minSaturation: 0.28, minLightness: 0.4, maxLightness: 0.65 },
  // Children/elders/legacy fixtures should still read primarily as members of their culture.
  ordinary: { cue: '#946c58', roleWeight: 0.56, minSaturation: 0.26, minLightness: 0.38, maxLightness: 0.66 },
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
  /** Override for secondary details such as hats or the dedicated readable garment layer. */
  roleWeight?: number;
  /** 0..1 clothing/material quality. It may shade a role but never erase it. */
  materialQuality?: number;
}

/**
 * Builds a role-readable clothing colour without inventing simulation state.
 *
 * Role is intentionally dominant for ordinary torso/limb clothing. Cultural colour remains
 * visible as a tint. Value/chroma floors are intentionally conservative because the final renderer
 * now owns a separate readable garment layer; this function should not need neon colours to work.
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

  // Wealth/material quality can add texture to the palette but must never push a job into darkness.
  const qualityShift = (materialQuality - 0.5) * 0.06;
  color.setHSL(
    hsl.h,
    Math.max(profile.minSaturation, hsl.s),
    THREE.MathUtils.clamp(hsl.l + qualityShift, profile.minLightness, profile.maxLightness),
  );
  return color;
}
