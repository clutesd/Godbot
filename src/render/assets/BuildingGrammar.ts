/**
 * BuildingGrammar.ts
 *
 * The architectural language of GODBOX.
 *
 * A grammar is resolved deterministically from (culture profile, era, role, variation seed)
 * and fully describes how a structure is massed, framed, roofed, patterned and ornamented.
 * Composition never invents form on its own — it only reads this grammar, which is what keeps
 * a foundry legibly descended from the hut that stood on the same ground centuries earlier.
 */

import type { Era } from '../materials/MaterialPalette';
import type { CultureStyleProfile, MotifFamily, PatternStyle } from '../style/CultureStyleProfile';
import { SeededRandom } from '../../sim/prng';

export type BuildingRole =
  | 'shelter'
  | 'lean-to'
  | 'ritual-marker'
  | 'store-pit'
  | 'hut'
  | 'house'
  | 'compound'
  | 'granary'
  | 'shrine'
  | 'market'
  | 'workshop'
  | 'hall'
  | 'warehouse'
  | 'gate-tower'
  | 'factory'
  | 'foundry'
  | 'research'
  | 'energy';

export type RoofFamily =
  | 'hide-cone'
  | 'lean-slope'
  | 'thatch-hip'
  | 'tile-hip'
  | 'tile-gable'
  | 'tile-layered'
  | 'stepped-terrace'
  | 'shell-dome'
  | 'saw-tooth'
  | 'canopy-shell';

export type PostStyle = 'poles' | 'timber' | 'stone' | 'steel' | 'composite';
export type OpeningStyle = 'flap' | 'slit' | 'shutter' | 'lattice' | 'glazed' | 'panel';
export type VerandaStyle = 'none' | 'front' | 'wrap';
export type BannerStyle = 'none' | 'pennant' | 'cloth' | 'standard';
export type EnclosureStyle = 'none' | 'stakes' | 'yard' | 'court';
export type WallLayer = 'hide' | 'thatch' | 'daub' | 'plaster' | 'stone' | 'brick' | 'panel';

export interface BuildingGrammar {
  role: BuildingRole;
  era: Era;
  /** Canonical footprint. The renderer scales this to the reserved placement footprint. */
  width: number;
  depth: number;
  wallHeight: number;
  storeys: number;
  /** Structural bays across the entrance elevation — the timber framing rhythm. */
  bays: number;
  plinthHeight: number;
  plinthInset: number;
  postStyle: PostStyle;
  postThickness: number;
  wallLayer: WallLayer;
  roofFamily: RoofFamily;
  roofTiers: number;
  roofPitch: number;
  eaveOverhang: number;
  eaveUpturn: number;
  roofConcavity: number;
  rafterTails: number;
  ridgeFinials: boolean;
  motif: MotifFamily;
  pattern: PatternStyle;
  /** Number of geometric façade bands wrapped around the body. */
  patternBands: number;
  patternDensity: number;
  openings: OpeningStyle;
  windowRows: number;
  veranda: VerandaStyle;
  railing: boolean;
  stairs: boolean;
  banner: BannerStyle;
  lanterns: number;
  gateway: boolean;
  forecourt: boolean;
  enclosure: EnclosureStyle;
  chimneys: number;
  vents: number;
  massing: 'single' | 'wing' | 'twin' | 'court';
  /** 0..1 civic ornament level: brackets, finials, motif inlay, ceremonial framing. */
  ornament: number;
  /** 0..1 strength of emissive windows and lanterns at night. */
  emissive: number;
  /** 0..1 heat/energy glow for forges, foundries, reactors. */
  forgeGlow: number;
}

const ERA_RANK: Record<Era, number> = {
  primitive: 0,
  early: 1,
  village: 2,
  preIndustrial: 3,
  industrial: 4,
  advanced: 5,
};

export function eraRank(era: Era): number {
  return ERA_RANK[era];
}

const PRIMITIVE_ROLES: BuildingRole[] = ['shelter', 'lean-to', 'ritual-marker', 'store-pit'];

/** Roles that only make sense once the civilisation can build them. */
const ROLE_MIN_ERA: Partial<Record<BuildingRole, Era>> = {
  hut: 'early',
  house: 'early',
  compound: 'early',
  granary: 'early',
  shrine: 'early',
  market: 'village',
  workshop: 'village',
  hall: 'village',
  warehouse: 'preIndustrial',
  'gate-tower': 'preIndustrial',
  factory: 'industrial',
  foundry: 'industrial',
  research: 'advanced',
  energy: 'advanced',
};

/** Fall back to the closest ancestor of a role the era can actually support. */
export function clampRoleToEra(role: BuildingRole, era: Era): BuildingRole {
  const rank = eraRank(era);
  if (rank === 0) return PRIMITIVE_ROLES.includes(role) ? role : 'shelter';
  const minimum = ROLE_MIN_ERA[role];
  if (!minimum || eraRank(minimum) <= rank) {
    return PRIMITIVE_ROLES.includes(role) ? 'house' : role;
  }
  switch (role) {
    case 'research':
      return rank >= 3 ? 'hall' : 'workshop';
    case 'energy':
      return rank >= 4 ? 'factory' : 'workshop';
    case 'factory':
    case 'foundry':
      return rank >= 2 ? 'workshop' : 'hut';
    case 'warehouse':
      return rank >= 2 ? 'granary' : 'hut';
    case 'gate-tower':
      return rank >= 2 ? 'shrine' : 'hut';
    default:
      return 'hut';
  }
}

function roofFamilyFor(profile: CultureStyleProfile, era: Era, role: BuildingRole): RoofFamily {
  if (era === 'primitive') {
    if (role === 'lean-to') return 'lean-slope';
    if (role === 'store-pit') return 'thatch-hip';
    return 'hide-cone';
  }
  if (role === 'factory' || role === 'foundry') return 'saw-tooth';
  if (role === 'energy' || role === 'research') return 'canopy-shell';
  if (era === 'early') return 'thatch-hip';
  switch (profile.roofLanguage) {
    case 'layered-asian':
      return 'tile-layered';
    case 'gable-geometric':
      return 'tile-gable';
    case 'dome-organic':
      return 'shell-dome';
    case 'pyramid-stepped':
      return role === 'shrine' || role === 'hall' ? 'stepped-terrace' : 'tile-hip';
  }
}

function wallLayerFor(era: Era, role: BuildingRole): WallLayer {
  if (era === 'primitive') return role === 'store-pit' ? 'thatch' : 'hide';
  if (era === 'early') return 'daub';
  if (era === 'village') return 'plaster';
  if (era === 'preIndustrial') return role === 'hall' || role === 'shrine' ? 'stone' : 'plaster';
  if (era === 'industrial') return role === 'house' || role === 'shrine' ? 'plaster' : 'brick';
  return role === 'house' || role === 'shrine' ? 'plaster' : 'panel';
}

function postStyleFor(era: Era, role: BuildingRole): PostStyle {
  switch (era) {
    case 'primitive':
      return 'poles';
    case 'early':
    case 'village':
      return 'timber';
    case 'preIndustrial':
      return role === 'hall' || role === 'gate-tower' ? 'stone' : 'timber';
    case 'industrial':
      return role === 'house' || role === 'shrine' ? 'timber' : 'steel';
    case 'advanced':
      return role === 'house' || role === 'shrine' ? 'timber' : 'composite';
  }
}

function openingsFor(era: Era, role: BuildingRole): OpeningStyle {
  if (era === 'primitive') return 'flap';
  if (era === 'early') return role === 'granary' ? 'slit' : 'shutter';
  if (era === 'village') return 'lattice';
  if (era === 'preIndustrial') return role === 'warehouse' ? 'shutter' : 'lattice';
  if (era === 'industrial') return role === 'house' || role === 'shrine' ? 'lattice' : 'glazed';
  return role === 'house' || role === 'shrine' ? 'lattice' : 'panel';
}

interface RoleShape {
  width: number;
  depth: number;
  wallHeight: number;
  storeys: number;
  bays: number;
  ornament: number;
  massing: BuildingGrammar['massing'];
}

function roleShape(role: BuildingRole): RoleShape {
  switch (role) {
    case 'shelter':
      return { width: 0.86, depth: 0.86, wallHeight: 0.2, storeys: 1, bays: 1, ornament: 0.05, massing: 'single' };
    case 'lean-to':
      return { width: 0.9, depth: 0.66, wallHeight: 0.16, storeys: 1, bays: 1, ornament: 0.02, massing: 'single' };
    case 'ritual-marker':
      return { width: 0.5, depth: 0.5, wallHeight: 0.22, storeys: 1, bays: 1, ornament: 0.42, massing: 'single' };
    case 'store-pit':
      return { width: 0.56, depth: 0.56, wallHeight: 0.3, storeys: 1, bays: 1, ornament: 0.04, massing: 'single' };
    case 'hut':
      return { width: 0.92, depth: 0.8, wallHeight: 0.52, storeys: 1, bays: 2, ornament: 0.14, massing: 'single' };
    case 'house':
      return { width: 1.08, depth: 0.86, wallHeight: 0.68, storeys: 1, bays: 3, ornament: 0.3, massing: 'single' };
    case 'compound':
      return { width: 1.14, depth: 0.94, wallHeight: 0.64, storeys: 1, bays: 3, ornament: 0.32, massing: 'wing' };
    case 'granary':
      return { width: 0.62, depth: 0.62, wallHeight: 0.86, storeys: 1, bays: 1, ornament: 0.22, massing: 'single' };
    case 'shrine':
      return { width: 0.98, depth: 0.98, wallHeight: 0.62, storeys: 1, bays: 3, ornament: 0.92, massing: 'single' };
    case 'market':
      return { width: 1.3, depth: 0.9, wallHeight: 0.42, storeys: 1, bays: 4, ornament: 0.46, massing: 'single' };
    case 'workshop':
      return { width: 1.16, depth: 0.92, wallHeight: 0.62, storeys: 1, bays: 3, ornament: 0.2, massing: 'wing' };
    case 'hall':
      return { width: 1.55, depth: 1.15, wallHeight: 0.95, storeys: 2, bays: 5, ornament: 0.85, massing: 'court' };
    case 'warehouse':
      return { width: 1.6, depth: 1.05, wallHeight: 0.88, storeys: 1, bays: 5, ornament: 0.18, massing: 'single' };
    case 'gate-tower':
      return { width: 0.82, depth: 0.82, wallHeight: 1.35, storeys: 3, bays: 2, ornament: 0.74, massing: 'single' };
    case 'factory':
      return { width: 1.72, depth: 1.16, wallHeight: 1.05, storeys: 2, bays: 6, ornament: 0.26, massing: 'wing' };
    case 'foundry':
      return { width: 1.62, depth: 1.2, wallHeight: 1.18, storeys: 2, bays: 5, ornament: 0.3, massing: 'wing' };
    case 'research':
      return { width: 1.7, depth: 1.24, wallHeight: 1.1, storeys: 2, bays: 6, ornament: 0.6, massing: 'court' };
    case 'energy':
      return { width: 1.5, depth: 1.5, wallHeight: 1.0, storeys: 2, bays: 4, ornament: 0.66, massing: 'twin' };
  }
}

export function resolveBuildingGrammar(
  profile: CultureStyleProfile,
  era: Era,
  requestedRole: BuildingRole,
  seed: string,
): BuildingGrammar {
  const role = clampRoleToEra(requestedRole, era);
  const random = new SeededRandom(seed);
  const shape = roleShape(role);
  const rank = eraRank(era);
  const inheritance = profile.getEraInheritance(era);
  const trim = profile.getTrimDensity(era);
  const roofFamily = roofFamilyFor(profile, era, role);
  const ceremonial = role === 'shrine' || role === 'hall' || role === 'gate-tower' || role === 'ritual-marker';
  const industrialRole = role === 'factory' || role === 'foundry' || role === 'warehouse';
  const scale = inheritance.scaleFactor;

  const ornament = Math.min(1, shape.ornament * (0.55 + trim * 0.75) + (ceremonial ? 0.18 : 0));
  const layeredFamily = roofFamily === 'tile-layered' || roofFamily === 'stepped-terrace';
  const roofTiers = era === 'primitive'
    ? 1
    : Math.max(1, Math.round(
      1
      + (layeredFamily ? 1 : 0)
      + (ceremonial ? Math.min(2, Math.floor(rank / 2)) : 0)
      + (role === 'gate-tower' ? 1 : 0),
    ));

  return {
    role,
    era,
    width: shape.width * scale * random.range(0.93, 1.08),
    depth: shape.depth * scale * random.range(0.93, 1.08),
    wallHeight: shape.wallHeight * (0.85 + rank * 0.06) * random.range(0.94, 1.07),
    storeys: shape.storeys,
    bays: Math.max(1, shape.bays + (rank >= 3 && !ceremonial ? 1 : 0)),
    plinthHeight: era === 'primitive' ? 0 : (0.05 + rank * 0.016) * (ceremonial ? 2.1 : 1),
    plinthInset: ceremonial ? -0.12 : -0.05,
    postStyle: postStyleFor(era, role),
    postThickness: era === 'primitive' ? 0.035 : 0.045 + rank * 0.006 + (ceremonial ? 0.02 : 0),
    wallLayer: wallLayerFor(era, role),
    roofFamily,
    roofTiers,
    roofPitch: roofFamily === 'saw-tooth'
      ? 0.24
      : roofFamily === 'canopy-shell'
        ? 0.3
        : roofFamily === 'hide-cone'
          ? 0.78
          : (0.42 + (ceremonial ? 0.12 : 0)) * random.range(0.94, 1.08),
    eaveOverhang: era === 'primitive' ? 0.06 : profile.getEaveOverhang(era) * (ceremonial ? 1.22 : 1),
    eaveUpturn: profile.getEaveUpturn(ornament),
    roofConcavity: profile.getRoofCurvatureValue(),
    rafterTails: era === 'primitive' ? 0 : Math.round(3 + trim * 6 + rank),
    ridgeFinials: rank >= 1 && ornament > 0.2,
    motif: profile.motifFamily,
    pattern: profile.patternStyle,
    patternBands: era === 'primitive' ? 0 : Math.min(3, Math.round(trim * 2.4 + (ceremonial ? 1 : 0))),
    patternDensity: 0.4 + trim * 0.7,
    openings: openingsFor(era, role),
    windowRows: Math.max(1, Math.min(shape.storeys + (rank >= 4 ? 1 : 0), 3)),
    veranda: era === 'primitive' || role === 'granary' || industrialRole
      ? 'none'
      : ceremonial || (rank >= 2 && profile.roofLanguage === 'layered-asian')
        ? 'wrap'
        : 'front',
    railing: rank >= 2 && !industrialRole,
    stairs: rank >= 1 && !industrialRole,
    banner: ceremonial ? 'standard' : rank >= 2 && ornament > 0.3 ? 'cloth' : rank >= 1 ? 'pennant' : 'none',
    lanterns: era === 'primitive' ? 0 : Math.round(ornament * 3 + (rank >= 2 ? 1 : 0)),
    gateway: ceremonial && rank >= 1,
    forecourt: ceremonial && rank >= 2,
    enclosure: role === 'compound'
      ? 'yard'
      : ceremonial && rank >= 2
        ? 'court'
        : era === 'primitive' && role === 'shelter'
          ? 'stakes'
          : 'none',
    chimneys: role === 'foundry' ? 3 : role === 'factory' ? 2 : role === 'workshop' && rank >= 3 ? 1 : 0,
    vents: role === 'energy' || role === 'research' ? 3 : industrialRole ? 2 : 0,
    massing: shape.massing,
    ornament,
    emissive: rank <= 1 ? 0.25 : rank === 2 ? 0.5 : rank === 3 ? 0.68 : rank === 4 ? 0.85 : 1,
    forgeGlow: role === 'foundry' ? 1 : role === 'factory' ? 0.55 : role === 'energy' ? 0.9 : role === 'workshop' ? 0.35 : 0,
  };
}
