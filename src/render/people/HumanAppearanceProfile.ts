import * as THREE from 'three';
import type { Culture, Person } from '../../sim/types';
import type { Era } from '../materials/MaterialPalette';
import { roleVisualFamilyFor, type RoleVisualFamily } from './RoleVisualProfile';

/**
 * HumanAppearanceProfile.ts
 *
 * One deterministic place that turns existing simulation facts — age, sex, role, culture, garment
 * class, material quality, wealth, prestige and era — into the complete visual description of a
 * person: proportions, palette, wardrobe components and a resting posture signature.
 *
 * Nothing here reads or writes simulation authority. It is a pure function of data the simulation
 * already owns, so identical seeds always produce identical populations. Variation is *constrained*:
 * every channel is clamped into a band that keeps a culture recognisably related while no two
 * individuals share a silhouette.
 */

export type GarmentTop = 'bare-chest' | 'wrap' | 'tunic' | 'shirt' | 'robe' | 'bodice' | 'coat-shirt' | 'work-jacket' | 'suit';
export type GarmentBottom = 'loincloth' | 'short-skirt' | 'long-skirt' | 'trousers' | 'breeches' | 'work-trousers';
export type GarmentOuter = 'none' | 'apron' | 'vest' | 'sash' | 'mantle' | 'cloak' | 'harness' | 'cuirass' | 'long-coat';
export type HeadCover = 'none' | 'wrap' | 'brim' | 'cap' | 'helmet' | 'hood' | 'headdress';
export type HairStyle = 'cropped' | 'short' | 'tousled' | 'bun' | 'long' | 'braid' | 'topknot' | 'bald';
export type Footwear = 'bare' | 'sandal' | 'shoe' | 'boot' | 'tall-boot';

/** Per-person geometry modifiers applied as cheap vertex-shader scales on shared meshes. */
export interface HumanProportions {
  /** Lateral scale of the shoulder girdle. Male adults > female adults > children. */
  shoulderScale: number;
  /** Lateral scale of the pelvis. The shoulder/hip ratio is the primary body-type read. */
  hipScale: number;
  /** Depth and width of the midsection; carries build and childhood roundness. */
  bellyScale: number;
  /** Multiplier on limb cross-section. Thin limbs are the classic procedural tell. */
  limbThickness: number;
  /** Head size relative to an adult head. Children read as children mostly through this. */
  headScale: number;
  /** Multiplier on upper+lower leg length. Short legs plus a big head is a child. */
  legLength: number;
  /** Multiplier on upper+lower arm length. */
  armLength: number;
  /** Forward lean carried permanently in the spine. Elders and labourers carry more. */
  slouch: number;
  /** Neck length multiplier; shortens with age and heavy build. */
  neckScale: number;
}

/** Deterministic resting-pose personality. Never invents psychology: only role/age/state driven. */
export interface HumanPosture {
  /** Half-distance between feet, in body units. Guards and labourers stand wider. */
  stanceWidth: number;
  /** Outward abduction of the resting upper arms. Bulk and build push the arms out. */
  armRest: number;
  /** Asymmetric shoulder height. Removes the universal level-shouldered mannequin read. */
  shoulderDrop: number;
  /** Small persistent head tilt/roll. */
  headTilt: number;
  /** Which foot leads at rest, and by how much. */
  weightShift: number;
  /** Stride length scale; children take short quick steps, tall adults longer ones. */
  strideStyle: number;
}

export interface HumanPalette {
  skin: string;
  /** Slightly deeper tone for shadowed/creased skin, used by the surface shader. */
  skinShade: number;
  hair: string;
  /** Primary garment body colour. */
  garment: string;
  /** Secondary layer: sleeves, lining, under-tunic. */
  garmentSecondary: string;
  trousers: string;
  footwear: string;
  /** Belt/strap/leather colour. */
  leather: string;
  /** Culture-coherent trim, used sparingly for status and identity. */
  accent: string;
}

export interface HumanWardrobe {
  top: GarmentTop;
  bottom: GarmentBottom;
  outer: GarmentOuter;
  head: HeadCover;
  hair: HairStyle;
  footwear: Footwear;
  belt: boolean;
  /** 0..1 how far sleeves run down the arm. 0 = sleeveless, 1 = to the wrist. */
  sleeveCoverage: number;
  /** 0..1 how far the leg covering runs from hip to ankle. */
  legCoverage: number;
  /** 0..1 how far footwear climbs the calf. */
  bootCoverage: number;
  /** 0..1 neckline: how much of the upper chest the garment covers. */
  necklineCoverage: number;
}

export interface HumanLook {
  proportions: HumanProportions;
  posture: HumanPosture;
  palette: HumanPalette;
  wardrobe: HumanWardrobe;
  family: RoleVisualFamily;
  /** 0 (newborn) .. 1 (fully grown). */
  maturity: number;
  /** 0..1 frailty from advanced age. */
  seniority: number;
  /** 0..1 visible material standing, from household wealth, prestige and material quality. */
  standing: number;
  /** Stable per-person seed in 0..1, for any further constrained jitter. */
  seed: number;
}

export interface HumanLookContext {
  culture?: Culture;
  era?: Era;
  /** 0..1 settlement prosperity, when the caller has it. */
  prosperity?: number;
  /** 0..1 cold climate pressure, when the caller has it. More layers, more coverage. */
  cold?: number;
}

const ERA_RANK: Readonly<Record<Era, number>> = {
  primitive: 0, early: 1, village: 2, preIndustrial: 3, industrial: 4, advanced: 5,
};

/** Pale to deep. Culture selects a neighbourhood; individuals vary inside it. */
const SKIN_RAMP = ['#f4d8c4', '#ecc4a6', '#dca97f', '#c08c5e', '#a16c42', '#80502e', '#5f3a22'] as const;
const HAIR_RAMP = ['#17110d', '#2a1c13', '#44291a', '#64401f', '#8a5f2c', '#b08a4c', '#cdb37d'] as const;
const GREY_HAIR = '#b9b4ab';

/** Neutral, undyed fibre. Every era keeps access to it, so no culture becomes a colour block. */
const NEUTRALS = ['#b3a68c', '#9c8f78', '#857a66', '#c3b79e', '#6f665a', '#a89878'] as const;
const LEATHERS = ['#5b3f2a', '#6d4c31', '#4a3324', '#7b5a3a', '#3b2a1e'] as const;

function hashOf(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/** Independent, repeatable 0..1 channels from one identity. Channels never correlate by accident. */
function channel(id: string, name: string): number {
  return hashOf(`${id}#${name}`) / 0xffffffff;
}

function pick<T>(list: readonly T[], value: number): T {
  return list[Math.min(list.length - 1, Math.floor(value * list.length))]!;
}

const rampColor = new THREE.Color();
const mixColor = new THREE.Color();

/** Continuous sampling of a discrete ramp so cultures blend instead of snapping between tones. */
function sampleRamp(ramp: readonly string[], position: number): string {
  const scaled = THREE.MathUtils.clamp(position, 0, 1) * (ramp.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(ramp.length - 1, low + 1);
  rampColor.set(ramp[low]!).lerp(mixColor.set(ramp[high]!), scaled - low);
  return `#${rampColor.getHexString()}`;
}

const shiftColor = new THREE.Color();
const hslBuffer = { h: 0, s: 0, l: 0 };

/** Bounded hue/saturation/lightness jitter. Keeps a culture's cloth related without cloning it. */
function shift(base: string, hue: number, saturation: number, lightness: number): string {
  shiftColor.set(base);
  shiftColor.getHSL(hslBuffer);
  shiftColor.setHSL(
    (hslBuffer.h + hue + 1) % 1,
    THREE.MathUtils.clamp(hslBuffer.s * saturation, 0, 0.72),
    THREE.MathUtils.clamp(hslBuffer.l + lightness, 0.07, 0.86),
  );
  return `#${shiftColor.getHexString()}`;
}

export function humanMaturity(ageMonths: number): number {
  return THREE.MathUtils.clamp(ageMonths / (17 * 12), 0, 1);
}

export function humanSeniority(ageMonths: number): number {
  return THREE.MathUtils.clamp((ageMonths - 56 * 12) / (34 * 12), 0, 1);
}

function proportionsFor(person: Person, seed: number, maturity: number, seniority: number,
  family: RoleVisualFamily): HumanProportions {
  // Growth is not uniform scaling. Infants are head-heavy with short limbs and a round middle;
  // the head barely grows after early childhood while the limbs keep lengthening.
  const growth = Math.pow(maturity, 0.78);
  const male = person.sex === 'male';
  const build = person.appearance?.buildScale ?? 1;
  const jitterA = channel(person.id, 'shoulder') - 0.5;
  const jitterB = channel(person.id, 'hip') - 0.5;
  const jitterC = channel(person.id, 'limb') - 0.5;
  const jitterD = channel(person.id, 'legs') - 0.5;

  const sexShoulder = THREE.MathUtils.lerp(1, male ? 1.075 : 0.945, growth);
  const sexHip = THREE.MathUtils.lerp(1, male ? 0.955 : 1.085, growth);
  // Sustained physical work broadens the upper body; sedentary roles do not.
  const labour = family === 'labor' || family === 'industry' ? 0.05 : family === 'guard' ? 0.065
    : family === 'knowledge' || family === 'civic' ? -0.03 : 0;

  return {
    shoulderScale: THREE.MathUtils.lerp(0.74, 1, growth) * sexShoulder
      * (1 + labour * growth) * (1 + jitterA * 0.09) * THREE.MathUtils.lerp(1, 0.94, seniority),
    hipScale: THREE.MathUtils.lerp(0.9, 1, growth) * sexHip * (1 + jitterB * 0.08),
    bellyScale: THREE.MathUtils.lerp(1.17, 1, Math.pow(maturity, 1.35))
      * (0.93 + (build - 1) * 1.35 + channel(person.id, 'belly') * 0.13)
      * THREE.MathUtils.lerp(1, 1.07, seniority),
    limbThickness: THREE.MathUtils.lerp(0.84, 1, growth)
      * (0.93 + (build - 1) * 1.1 + jitterC * 0.13)
      * (1 + labour * 1.4 * growth) * THREE.MathUtils.lerp(1, 0.9, seniority),
    // A 2-year-old's head is roughly a quarter of its standing height; an adult's is an eighth.
    headScale: THREE.MathUtils.lerp(1.42, 1, Math.pow(maturity, 0.62)) * (1 + (seed - 0.5) * 0.055),
    legLength: THREE.MathUtils.lerp(0.8, 1, Math.pow(maturity, 0.86)) * (1 + jitterD * 0.055),
    armLength: THREE.MathUtils.lerp(0.85, 1, Math.pow(maturity, 0.9)) * (1 + (jitterD + jitterC) * 0.03),
    slouch: seniority * 0.09 + (family === 'labor' ? 0.016 : 0)
      + (1 - maturity) * -0.012 + (channel(person.id, 'slouch') - 0.5) * 0.02,
    neckScale: THREE.MathUtils.lerp(0.78, 1, growth) * (1 - seniority * 0.12)
      * (1 - (build - 1) * 0.5) * (1 + (channel(person.id, 'neck') - 0.5) * 0.08),
  };
}

function postureFor(person: Person, maturity: number, seniority: number,
  family: RoleVisualFamily, proportions: HumanProportions): HumanPosture {
  const alert = family === 'guard';
  const child = maturity < 0.85;
  const sideways = channel(person.id, 'weight') - 0.5;
  return {
    stanceWidth: (alert ? 0.062 : family === 'labor' || family === 'industry' ? 0.055 : 0.046)
      * THREE.MathUtils.lerp(0.86, 1, maturity)
      * (1 + (channel(person.id, 'stance') - 0.5) * 0.3) * proportions.hipScale,
    // Bulkier torsos and broader shoulders physically push the arms outward.
    armRest: 0.052 + (proportions.limbThickness - 1) * 0.3 + (proportions.shoulderScale - 1) * 0.22
      + (alert ? 0.03 : 0) + (channel(person.id, 'arms') - 0.5) * 0.028,
    shoulderDrop: (channel(person.id, 'drop') - 0.5) * (alert ? 0.012 : 0.03),
    headTilt: (channel(person.id, 'tilt') - 0.5) * (child ? 0.075 : 0.042),
    weightShift: sideways * (alert ? 0.3 : child ? 1 : 0.8),
    strideStyle: THREE.MathUtils.lerp(0.82, 1, maturity) * (1 - seniority * 0.2)
      * (0.93 + channel(person.id, 'stride') * 0.14) * (0.96 + proportions.legLength * 0.04),
  };
}

function paletteFor(person: Person, context: HumanLookContext, maturity: number, seniority: number,
  standing: number, family: RoleVisualFamily, eraRank: number): HumanPalette {
  const cultureId = person.cultureId || 'culture';
  // One culture occupies a narrow band of the tone ramp, so its people read as related.
  const cultureTone = channel(cultureId, 'tone');
  const personTone = THREE.MathUtils.clamp(
    cultureTone + (channel(person.id, 'tone') - 0.5) * 0.22, 0, 1);
  const skin = sampleRamp(SKIN_RAMP, personTone);

  const hairBase = sampleRamp(HAIR_RAMP,
    THREE.MathUtils.clamp(channel(cultureId, 'hair') * 0.62 + channel(person.id, 'hair') * 0.42, 0, 1));
  shiftColor.set(hairBase).lerp(mixColor.set(GREY_HAIR), Math.pow(seniority, 0.7) * 0.85);
  const hair = `#${shiftColor.getHexString()}`;

  const style = context.culture?.style;
  const quality = person.appearance?.materialQuality ?? 0.5;
  // Dye is expensive. Poor and early populations wear undyed fibre; prosperity buys saturation.
  const dyeAccess = THREE.MathUtils.clamp(
    0.22 + eraRank * 0.1 + quality * 0.34 + standing * 0.3 + (context.prosperity ?? 0.4) * 0.22, 0, 1);
  const undyed = channel(person.id, 'undyed') > dyeAccess;

  const cultureSource = channel(person.id, 'cloth') < 0.55 ? style?.primary : style?.secondary;
  const base = undyed || !cultureSource
    ? pick(NEUTRALS, channel(person.id, 'neutral'))
    : cultureSource;
  // Industrial cloth is darker and more uniform; advanced fabric reads cleaner and cooler.
  const eraLight = eraRank >= 4 ? -0.08 : eraRank <= 1 ? 0.02 : 0;
  const eraSaturation = eraRank >= 5 ? 0.78 : eraRank === 4 ? 0.7 : eraRank <= 1 ? 0.62 : 0.86;
  const garment = shift(base, (channel(person.id, 'hue') - 0.5) * 0.05,
    eraSaturation * (0.55 + dyeAccess * 0.6),
    eraLight + (channel(person.id, 'light') - 0.5) * 0.16 + standing * 0.03);

  const secondarySource = undyed || !style
    ? pick(NEUTRALS, channel(person.id, 'neutral2'))
    : channel(person.id, 'cloth2') < 0.5 ? style.secondary : style.primary;
  const garmentSecondary = shift(secondarySource, (channel(person.id, 'hue2') - 0.5) * 0.06,
    eraSaturation * (0.45 + dyeAccess * 0.5),
    eraLight + (channel(person.id, 'light2') - 0.5) * 0.18);

  const trousers = shift(channel(person.id, 'legsource') < 0.6
    ? pick(NEUTRALS, channel(person.id, 'neutral3')) : garment,
  0, 0.7, -0.07 + (channel(person.id, 'light3') - 0.5) * 0.12);

  const leather = pick(LEATHERS, channel(person.id, 'leather'));
  const footwear = shift(leather, 0, 1, (channel(person.id, 'boot') - 0.5) * 0.1);

  return {
    skin,
    // Weathered outdoor work and age both deepen creases and exposed skin.
    skinShade: THREE.MathUtils.clamp(0.4 + seniority * 0.3
      + (family === 'earth' || family === 'water' || family === 'labor' ? 0.14 : 0)
      - maturity * 0.08 + (channel(person.id, 'shade') - 0.5) * 0.16, 0, 1),
    hair,
    garment,
    garmentSecondary,
    trousers,
    footwear,
    leather,
    accent: style?.accent ?? '#d9a748',
  };
}

/** Role-and-era wardrobe grammar. The same role keeps recurring motifs as technology advances. */
function wardrobeFor(person: Person, context: HumanLookContext, maturity: number, seniority: number,
  standing: number, family: RoleVisualFamily, eraRank: number): HumanWardrobe {
  const garmentClass = person.appearance?.garment ?? 'simple';
  const headwear = person.appearance?.headwear ?? 'none';
  const cold = context.cold ?? 0.3;
  const child = maturity < 0.82;
  const female = person.sex === 'female';
  const variant = channel(person.id, 'wardrobe');

  let top: GarmentTop;
  if (garmentClass === 'ceremonial') top = 'robe';
  else if (garmentClass === 'uniform') top = eraRank >= 4 ? 'suit' : 'coat-shirt';
  else if (garmentClass === 'technical') top = 'work-jacket';
  else if (garmentClass === 'layered') top = eraRank >= 3 ? 'coat-shirt' : 'robe';
  else if (garmentClass === 'workwear') top = eraRank >= 3 ? 'work-jacket' : 'tunic';
  else if (eraRank === 0) top = variant < 0.4 ? 'wrap' : 'tunic';
  else if (eraRank >= 4) top = 'shirt';
  else top = female && variant > 0.62 ? 'bodice' : 'tunic';
  // Very early, very hot, very poor manual labour is the one place bare shoulders belong.
  if (eraRank === 0 && cold < 0.25 && family === 'labor' && !female && variant > 0.84) top = 'bare-chest';

  let bottom: GarmentBottom;
  if (eraRank === 0) bottom = female ? 'long-skirt' : variant < 0.55 ? 'loincloth' : 'short-skirt';
  else if (eraRank <= 2) bottom = female ? 'long-skirt' : variant < 0.4 ? 'short-skirt' : 'breeches';
  else if (eraRank === 3) bottom = female && variant < 0.7 ? 'long-skirt' : 'breeches';
  else bottom = garmentClass === 'workwear' || garmentClass === 'technical' ? 'work-trousers' : 'trousers';
  if (top === 'robe') bottom = 'long-skirt';

  let outer: GarmentOuter = 'none';
  if (family === 'guard') outer = eraRank >= 2 && eraRank < 4 ? 'cuirass' : 'harness';
  else if (family === 'ritual') outer = 'mantle';
  else if (family === 'elder' || family === 'civic') outer = eraRank >= 4 ? 'long-coat' : 'mantle';
  else if (family === 'knowledge') outer = eraRank >= 4 ? 'long-coat' : 'sash';
  else if (family === 'labor' || family === 'industry' || family === 'healing') outer = 'apron';
  else if (family === 'trade') outer = variant < 0.5 ? 'vest' : 'sash';
  else if (cold > 0.62 && eraRank >= 2) outer = 'cloak';
  else if (standing > 0.66) outer = 'vest';
  if (child && !(outer === 'apron' && variant > 0.6)) outer = 'none';

  let head: HeadCover = 'none';
  if (headwear === 'helmet' || family === 'guard' && eraRank >= 2) head = 'helmet';
  else if (headwear === 'brim') head = 'brim';
  else if (headwear === 'cap') head = 'cap';
  else if (headwear === 'wrap') head = 'wrap';
  else if (family === 'ritual' && standing > 0.5) head = 'headdress';
  else if (cold > 0.7) head = 'hood';
  else if (family === 'earth' && eraRank >= 1 && variant > 0.45) head = 'brim';
  else if (family === 'industry' && eraRank >= 4) head = 'cap';

  const balding = person.sex === 'male' && seniority > 0.35 && channel(person.id, 'bald') < seniority * 0.55;
  const hair: HairStyle = balding ? 'bald'
    : child ? (variant < 0.5 ? 'short' : 'tousled')
      : female
        ? pick(['long', 'bun', 'braid', 'long', 'bun'] as const, channel(person.id, 'hairstyle'))
        : pick(['short', 'cropped', 'tousled', 'topknot', 'short'] as const, channel(person.id, 'hairstyle'));

  const footwear: Footwear = family === 'guard' ? (eraRank >= 2 ? 'tall-boot' : 'boot')
    : eraRank === 0 ? (channel(person.id, 'shoes') < 0.55 ? 'bare' : 'sandal')
      : eraRank <= 2 ? (child && variant < 0.4 ? 'bare' : variant < 0.45 ? 'sandal' : 'shoe')
        : family === 'labor' || family === 'industry' || family === 'water' ? 'boot' : 'shoe';

  const sleeveBase = top === 'bare-chest' ? 0 : top === 'wrap' ? 0.18
    : top === 'tunic' ? 0.45 : top === 'bodice' ? 0.3 : top === 'robe' ? 0.92 : 0.86;
  const legBase = bottom === 'loincloth' ? 0.22 : bottom === 'short-skirt' ? 0.4
    : bottom === 'breeches' ? 0.62 : bottom === 'long-skirt' ? 0.9 : 0.95;

  return {
    top, bottom, outer, head, hair, footwear,
    belt: outer !== 'cuirass' && (eraRank >= 1 || channel(person.id, 'belt') > 0.4)
      && top !== 'bare-chest' && top !== 'wrap',
    sleeveCoverage: THREE.MathUtils.clamp(sleeveBase + cold * 0.22
      + (channel(person.id, 'sleeve') - 0.5) * 0.18, 0, 1),
    legCoverage: THREE.MathUtils.clamp(legBase + cold * 0.1
      + (channel(person.id, 'leg') - 0.5) * 0.1, 0, 1),
    bootCoverage: footwear === 'bare' ? 0 : footwear === 'sandal' ? 0.055
      : footwear === 'shoe' ? 0.12 : footwear === 'boot' ? 0.3 : 0.46,
    necklineCoverage: THREE.MathUtils.clamp(
      (top === 'bare-chest' ? 0.1 : top === 'wrap' ? 0.5 : top === 'robe' || top === 'suit' ? 0.95 : 0.78)
      + (channel(person.id, 'neckline') - 0.5) * 0.12, 0, 1),
  };
}

/**
 * The complete visual description of one person. Pure, allocation-light and deterministic: the
 * same person and context always resolve to the same look, so a replayed seed looks identical.
 */
export function humanLookFor(person: Person, context: HumanLookContext = {}): HumanLook {
  const seed = channel(person.id, 'seed');
  const maturity = humanMaturity(person.ageMonths);
  const seniority = humanSeniority(person.ageMonths);
  const family = roleVisualFamilyFor(person.role);
  const eraRank = ERA_RANK[context.era ?? 'village'];
  const standing = THREE.MathUtils.clamp(
    (person.socialPosition?.householdWealth ?? 0.4) * 0.4
    + (person.appearance?.materialQuality ?? 0.5) * 0.3
    + THREE.MathUtils.clamp(person.prestige / 100, 0, 1) * 0.3, 0, 1);
  const proportions = proportionsFor(person, seed, maturity, seniority, family);
  return {
    proportions,
    posture: postureFor(person, maturity, seniority, family, proportions),
    palette: paletteFor(person, context, maturity, seniority, standing, family, eraRank),
    wardrobe: wardrobeFor(person, context, maturity, seniority, standing, family, eraRank),
    family, maturity, seniority, standing, seed,
  };
}
