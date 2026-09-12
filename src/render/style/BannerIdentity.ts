import type { Biome, Culture, InstitutionKind, Settlement } from '../../sim/types';
import type { Era } from '../materials/MaterialPalette';

export type BannerShape = 'straight' | 'pointed' | 'swallowtail' | 'stepped' | 'ragged';
export type BannerFieldPattern = 'solid' | 'stripe' | 'split' | 'border' | 'top-band';
export type BannerEmblem = 'sun' | 'tree' | 'river-wave' | 'mountain' | 'antlers' | 'eye' | 'moon' | 'beast' | 'rune';

export interface BannerIdentityInstitution {
  kind: InstitutionKind;
  support: number;
  prestige: number;
}

export interface BannerIdentityPolity {
  id: string;
  arrangement: string;
  dynastyName?: string;
  dynastyHouseholdId?: string;
}

export interface BannerIdentityInput {
  seed: string;
  settlementId: string;
  specialization: Settlement['specialization'];
  biome: Biome;
  river: boolean;
  lake: boolean;
  coast: boolean;
  foundingEra: Era;
  culture?: Culture;
  institutions: readonly BannerIdentityInstitution[];
  polity?: BannerIdentityPolity;
  activeTradeRoutes: number;
}

/**
 * A render-facing heraldic identity. It is intentionally derived from simulation facts rather
 * than random decoration: geography supplies environmental motifs, institutions and values bias
 * the field/emblem, founding era supplies the cloth silhouette, and a ruling dynasty/polity adds
 * a stable house variation. Step 3 can later version these identities through political history.
 */
export interface BannerIdentity {
  id: string;
  primary: string;
  secondary: string;
  accent: string;
  shape: BannerShape;
  fieldPattern: BannerFieldPattern;
  emblem: BannerEmblem;
  fieldVariant: number;
  emblemVariant: number;
  lineageMarks: number;
  lineageKey: string;
  foundingEra: Era;
  rationale: string[];
}

const FALLBACK_STYLE = {
  primary: '#9b5d50',
  secondary: '#3f4044',
  accent: '#c6aa72',
  symbol: 'sun-step' as const,
  pattern: 'chevron' as const,
};

const ENVIRONMENT_TINT: Record<Biome, string> = {
  water: '#315f67',
  wetland: '#4d6d60',
  grassland: '#6d744f',
  forest: '#405f46',
  dryland: '#8a6744',
  highland: '#626057',
  mountain: '#555963',
};

const ERA_SHAPE: Record<Era, BannerShape> = {
  primitive: 'ragged',
  early: 'pointed',
  village: 'swallowtail',
  preIndustrial: 'stepped',
  industrial: 'straight',
  advanced: 'straight',
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '').trim();
  const expanded = normalized.length === 3
    ? normalized.split('').map(character => `${character}${character}`).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const parsed = Number.parseInt(expanded, 16);
  if (!Number.isFinite(parsed)) return [128, 128, 128];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function mixHex(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const t = clamp01(amount);
  const channel = (start: number, end: number): string => Math.round(start + (end - start) * t).toString(16).padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

function institutionStrength(institutions: readonly BannerIdentityInstitution[], kind: InstitutionKind): number {
  let strongest = 0;
  for (const institution of institutions) {
    if (institution.kind !== kind) continue;
    strongest = Math.max(strongest, clamp01(institution.support) * 0.45 + clamp01(institution.prestige) * 0.55);
  }
  return strongest;
}

function strongestInstitution(institutions: readonly BannerIdentityInstitution[]): BannerIdentityInstitution | undefined {
  return [...institutions].sort((a, b) =>
    (b.support * 0.45 + b.prestige * 0.55) - (a.support * 0.45 + a.prestige * 0.55))[0];
}

function highestScore<T extends string>(scores: Record<T, number>): T {
  return (Object.entries(scores) as Array<[T, number]>).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

function readableInstitution(kind: InstitutionKind): string {
  return kind.replaceAll('-', ' ');
}

export function generateBannerIdentity(input: BannerIdentityInput): BannerIdentity {
  const culture = input.culture;
  const style = culture?.style ?? FALLBACK_STYLE;
  const dimensions = culture?.dimensions ?? {
    cooperation: 0.5,
    hierarchy: 0.5,
    militarism: 0.5,
    tradeOrientation: 0.5,
    curiosity: 0.5,
    religiousTendency: 0.5,
    institutionalTrust: 0.5,
    outsiderOpenness: 0.5,
    longTermOrientation: 0.5,
  };

  const lineageKey = input.polity?.dynastyName
    ?? input.polity?.dynastyHouseholdId
    ?? input.polity?.id
    ?? culture?.id
    ?? input.settlementId;
  const lineageUnit = hashUnit(`${input.seed}:${lineageKey}:lineage`);
  const environmentTint = ENVIRONMENT_TINT[input.biome];
  const primary = mixHex(style.primary, environmentTint, 0.16);
  const lineageTint = lineageUnit < 0.34 ? style.accent : lineageUnit < 0.67 ? style.secondary : environmentTint;
  const secondary = mixHex(style.secondary, lineageTint, 0.14);
  const accent = mixHex(style.accent, '#d9cfb8', 0.16);

  const temple = institutionStrength(input.institutions, 'temple');
  const merchants = institutionStrength(input.institutions, 'merchant-association');
  const militaryOrder = institutionStrength(input.institutions, 'military-order');
  const knowledgeKeepers = institutionStrength(input.institutions, 'knowledge-keepers');
  const council = institutionStrength(input.institutions, 'council');
  const craft = institutionStrength(input.institutions, 'craft-circle');
  const waterLinked = input.river || input.lake || input.coast || input.biome === 'water' || input.biome === 'wetland';

  const emblemScores: Record<BannerEmblem, number> = {
    sun: 0.12,
    tree: 0.12,
    'river-wave': 0.12,
    mountain: 0.12,
    antlers: 0.1,
    eye: 0.1,
    moon: 0.1,
    beast: 0.08,
    rune: 0.1,
  };

  if (waterLinked) emblemScores['river-wave'] += 0.72;
  if (input.biome === 'forest') emblemScores.tree += 0.72;
  if (input.biome === 'highland' || input.biome === 'mountain') emblemScores.mountain += 0.72;
  if (input.biome === 'dryland') emblemScores.sun += 0.58;
  if (input.biome === 'grassland') emblemScores.sun += 0.18;

  emblemScores.antlers += dimensions.militarism * 0.38 + militaryOrder * 0.42;
  emblemScores.beast += dimensions.militarism * 0.22 + dimensions.hierarchy * 0.14 + militaryOrder * 0.18;
  emblemScores.eye += dimensions.curiosity * 0.26 + dimensions.longTermOrientation * 0.14 + knowledgeKeepers * 0.4;
  emblemScores.rune += dimensions.longTermOrientation * 0.26 + dimensions.institutionalTrust * 0.12 + knowledgeKeepers * 0.26 + craft * 0.12;
  emblemScores.moon += dimensions.religiousTendency * 0.34 + temple * 0.42;
  emblemScores.sun += dimensions.religiousTendency * 0.12 + temple * 0.12;
  emblemScores['river-wave'] += dimensions.tradeOrientation * 0.22 + merchants * 0.34 + Math.min(3, input.activeTradeRoutes) * 0.07;

  if (input.specialization === 'forestry') emblemScores.tree += 0.2;
  else if (input.specialization === 'mining') emblemScores.mountain += 0.18;
  else if (input.specialization === 'agriculture') emblemScores.sun += 0.14;
  else if (input.specialization === 'exchange') emblemScores['river-wave'] += 0.2;
  else if (input.specialization === 'craft') emblemScores.rune += 0.18;

  switch (style.symbol) {
    case 'sun-step': emblemScores.sun += 0.28; break;
    case 'river-eye':
      emblemScores.eye += 0.2;
      emblemScores['river-wave'] += 0.14;
      break;
    case 'woven-moon': emblemScores.moon += 0.3; break;
    case 'mountain-knot': emblemScores.mountain += 0.3; break;
    case 'seed-spiral':
      emblemScores.tree += 0.18;
      emblemScores.rune += 0.14;
      break;
  }

  if (input.polity?.dynastyName || input.polity?.dynastyHouseholdId) {
    if (lineageUnit < 0.5) emblemScores.beast += 0.28;
    else emblemScores.rune += 0.28;
  }
  const emblem = highestScore(emblemScores);

  const fieldScores: Record<BannerFieldPattern, number> = {
    solid: 0.34,
    stripe: dimensions.tradeOrientation * 0.42 + merchants * 0.42 + Math.min(3, input.activeTradeRoutes) * 0.08,
    split: dimensions.militarism * 0.42 + militaryOrder * 0.42 + dimensions.hierarchy * 0.12,
    border: dimensions.cooperation * 0.26 + dimensions.institutionalTrust * 0.3 + council * 0.38,
    'top-band': dimensions.hierarchy * 0.38 + dimensions.religiousTendency * 0.2 + temple * 0.34,
  };
  switch (style.pattern) {
    case 'wave': fieldScores.stripe += 0.16; break;
    case 'chevron': fieldScores.split += 0.12; break;
    case 'diamond': fieldScores.border += 0.14; break;
    case 'crossweave': fieldScores.border += 0.16; break;
    case 'terrace': fieldScores['top-band'] += 0.16; break;
  }
  const fieldPattern = highestScore(fieldScores);

  const shape = ERA_SHAPE[input.foundingEra];
  const fieldVariant = Math.min(3, Math.floor(hashUnit(`${input.seed}:${input.settlementId}:${lineageKey}:field`) * 4));
  const emblemVariant = Math.min(3, Math.floor(hashUnit(`${input.seed}:${input.settlementId}:${lineageKey}:emblem`) * 4));
  const lineageMarks = 1 + Math.min(2, Math.floor(hashUnit(`${input.seed}:${lineageKey}:marks`) * 3));

  const rationale: string[] = [`${input.foundingEra} founding tradition -> ${shape} silhouette`];
  if (waterLinked) rationale.push('river/coast/wetland geography -> water heraldry');
  else if (input.biome === 'forest') rationale.push('forest homeland -> tree heraldry');
  else if (input.biome === 'highland' || input.biome === 'mountain') rationale.push('highland homeland -> mountain heraldry');
  else if (input.biome === 'dryland') rationale.push('dryland homeland -> solar heraldry');

  const strongest = strongestInstitution(input.institutions);
  if (strongest && strongest.support * 0.45 + strongest.prestige * 0.55 >= 0.48) {
    rationale.push(`${readableInstitution(strongest.kind)} influence -> civic heraldic emphasis`);
  }
  const values = [
    ['militarism', dimensions.militarism],
    ['trade', dimensions.tradeOrientation],
    ['religion', dimensions.religiousTendency],
    ['curiosity', dimensions.curiosity],
    ['hierarchy', dimensions.hierarchy],
    ['cooperation', dimensions.cooperation],
  ] as const;
  const strongestValue = [...values].sort((a, b) => b[1] - a[1])[0];
  if (strongestValue && strongestValue[1] >= 0.58) rationale.push(`${strongestValue[0]} value -> ${fieldPattern} field / ${emblem} emblem`);
  if (input.polity?.dynastyName) rationale.push(`${input.polity.dynastyName} lineage -> house marks and emblem variation`);
  else if (input.polity?.dynastyHouseholdId) rationale.push('ruling household -> house marks and emblem variation');
  if (input.activeTradeRoutes > 0) rationale.push(`${input.activeTradeRoutes} active trade route${input.activeTradeRoutes === 1 ? '' : 's'} -> exchange influence`);

  const id = [primary, secondary, accent, shape, fieldPattern, emblem, fieldVariant, emblemVariant, lineageMarks, lineageKey].join(':');
  return { id, primary, secondary, accent, shape, fieldPattern, emblem, fieldVariant, emblemVariant, lineageMarks, lineageKey, foundingEra: input.foundingEra, rationale };
}
