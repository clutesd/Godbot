import * as THREE from 'three';
import type { Culture, Person } from '../../sim/types';
import type { Era } from '../materials/MaterialPalette';
import { roleVisualFamilyFor, type RoleVisualFamily } from './RoleVisualProfile';
import { GODBOX_HEADS, humanCultureGrammar, type GodboxHead, type HumanCultureGrammar } from './HumanIdentity';
import { COSMIC_ROLES } from './CosmicPeople';

/**
 * HumanAppearanceProfile.ts
 *
 * One deterministic place that turns existing simulation facts — age, sex, role, culture, garment
 * class, material quality, wealth, prestige and era — into the complete visual description of one
 * inhabitant: proportions, obsidian palette, luminous identity, adornment and a resting posture.
 *
 * The species is not human and the vocabulary here reflects that. There are no skin tones, no hair
 * colours and no tailored clothing. A body is volcanic glass with a finish; what it carries is cast,
 * carved or woven adornment, and who it is comes through luminous channel geometry rather than
 * through dyed cloth.
 *
 * Nothing here reads or writes simulation authority. It is a pure function of data the simulation
 * already owns, so identical seeds always produce identical populations. Variation is *constrained*:
 * every channel is clamped into a band that keeps a culture recognisably related while no two
 * individuals share a silhouette.
 */

/** Upper-body structure. Engraved and architectural, never a shirt. */
export type ChestPiece = 'none' | 'collar' | 'gorget' | 'yoke' | 'chest-plate' | 'harness' | 'regalia';
/** The waist is the one piece the species wears in every era; only its refinement changes. */
export type WaistPiece = 'cord' | 'ring' | 'hip-plate' | 'ceremonial-belt';
/** Shoulder and back structure: the fastest read of standing and role at documentary range. */
export type ShoulderPiece = 'none' | 'guards' | 'pauldrons' | 'back-fall' | 'tool-harness' | 'side-panels';
/** Worn over the crest. Temple bars, rings and small crowns, never a hat. */
export type HeadPiece = 'none' | 'temple-bars' | 'head-ring' | 'crown' | 'high-crown' | 'veil-fall';
/** The sculpted obsidian crest that occupies the place hair would. It is part of the body, not worn. */
export type CrestStyle = 'ridged' | 'swept' | 'fanned' | 'coiled' | 'plated' | 'shorn';
/** How far the fall hanging from the waist reaches. */
export type DrapeForm = 'none' | 'hip-wrap' | 'front-fall' | 'split-fall' | 'long-fall';

/** Per-person geometry modifiers applied as cheap vertex-shader scales on shared meshes. */
export interface HumanProportions {
  /** Lateral scale of the shoulder girdle. Male adults > female adults > adolescents > children. */
  shoulderScale: number;
  ribcageScale: number;
  /** Lateral scale of the pelvis. The shoulder/hip ratio is the primary body-type read. */
  hipScale: number;
  /** Depth and width of the midsection; carries build and childhood roundness. */
  bellyScale: number;
  /** Multiplier on limb cross-section. The species is lean; this stays below human norms. */
  limbThickness: number;
  /** Head size relative to an adult head. Children read as children mostly through this. */
  headScale: number;
  /** Multiplier on upper+lower leg length. Short legs plus a big head is a child. */
  legLength: number;
  /** Multiplier on upper+lower arm length. */
  armLength: number;
  /** Forward lean carried permanently in the spine. Elders and labourers carry more. */
  slouch: number;
  /** Neck length multiplier. The species carries a longer neck than a human at every age. */
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
  /**
   * Which leg carries the body at rest, and how committed that is. Signed; never near zero,
   * because a person standing with their weight exactly between both feet is a mannequin.
   */
  weightShift: number;
  /** Roll of the pelvis toward the loaded leg. The hip line is the first cue of a relaxed stance. */
  pelvisTilt: number;
  /** How far one arm hangs forward of the other. Two identical arms is the second cue of a mannequin. */
  armLead: number;
  /** Stride length scale; children take short quick steps, tall adults longer ones. */
  strideStyle: number;
}

/** The material identity of one person. Six channels, all mineral or luminous — none of them skin. */
export interface HumanPalette {
  /** Deep volcanic glass. Cultures occupy neighbouring tints of the same dark band. */
  obsidian: string;
  /** 0 raw and volcanic .. 1 ceremonial mirror polish. Era, standing and wear. */
  finish: number;
  /** Cast adornment alloy: hammered native metal through bronze to refined gold and pale alloys. */
  alloy: string;
  /** Woven drape. Always dark; this species does not wear bright cloth. */
  drape: string;
  /** The luminous inlay colour. Every culture sits inside one amber species band. */
  luminous: string;
  /** Emissive gain. Children glow softly, ritual and high-standing lives burn a little brighter. */
  luminance: number;
}

/** What a person carries on the body. Adornment and markings, never garments. */
export interface HumanWardrobe {
  chest: ChestPiece;
  waist: WaistPiece;
  shoulder: ShoulderPiece;
  head: HeadPiece;
  crest: CrestStyle;
  drape: DrapeForm;
  /** Role equipment slung on the back. */
  pack: boolean;
  /** 0..1 position along the upper-arm axis of a cast ring. 0 = none. */
  armRing: number;
  /** 0..1 position along the forearm axis of a wrist band or guard. 0 = none. */
  wristBand: number;
  /** 0..1 position along the thigh axis of a cast band. 0 = none. */
  thighBand: number;
  /** 0..1 position along the shin axis of an anklet. 0 = none. */
  anklet: number;
  /** How far a band stands proud of the limb, as a fraction of limb radius. */
  bandSwell: number;
  /** 0..1 how much of the luminous marking set this individual carries. */
  markingDensity: number;
}

export interface HumanLook {
  head: GodboxHead;
  cultureGrammar: HumanCultureGrammar;
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
  /** 0..1 cold climate pressure, when the caller has it. More drape, more coverage. */
  cold?: number;
}

const ERA_RANK: Readonly<Record<Era, number>> = {
  primitive: 0, early: 1, village: 2, preIndustrial: 3, industrial: 4, advanced: 5,
};

/**
 * Volcanic glass. One base for the entire species; a culture only rotates its cast and shifts its
 * depth by a few percent, because the whole point is that an inhabitant of any civilisation is
 * unmistakably the same creature as an inhabitant of every other.
 */
const OBSIDIAN_GLASS = '#07090c';

/** The alloy the species casts, by what its technology can actually work. */
const ALLOY_ERAS: readonly (readonly string[])[] = [
  ['#6b5839', '#7a6240', '#5e5340'],
  ['#8a6c33', '#96763a', '#7d6536'],
  ['#a8812f', '#b48c39', '#9c7a35'],
  ['#c69434', '#d2a243', '#b98b31'],
  ['#d8a640', '#e3b655', '#c9983c'],
  ['#e5c268', '#cfb98a', '#edd184'],
];

/** The amber every culture's luminance is pulled toward. One species, one kind of light. */
const SPECIES_LIGHT = '#ffae42';

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
const shiftColor = new THREE.Color();
const hslBuffer = { h: 0, s: 0, l: 0 };

/** Bounded hue/saturation/lightness jitter inside one band. */
function shift(base: string, hue: number, saturation: number, lightness: number,
  maxSaturation = 0.72, minLight = 0.02, maxLight = 0.9): string {
  shiftColor.set(base);
  shiftColor.getHSL(hslBuffer);
  shiftColor.setHSL(
    (hslBuffer.h + hue + 1) % 1,
    THREE.MathUtils.clamp(hslBuffer.s * saturation, 0, maxSaturation),
    THREE.MathUtils.clamp(hslBuffer.l + lightness, minLight, maxLight),
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
  // the skull barely grows after early childhood while the limbs keep lengthening. That is the
  // whole difference between a child and an adult rendered at 70%.
  const growth = Math.pow(maturity, 0.78);
  const male = person.sex === 'male';
  const build = person.appearance?.buildScale ?? 1;
  const jitterA = channel(person.id, 'shoulder') - 0.5;
  const jitterB = channel(person.id, 'hip') - 0.5;
  const jitterC = channel(person.id, 'limb') - 0.5;
  const jitterD = channel(person.id, 'legs') - 0.5;

  // Dimorphism is carried by the shoulder-to-hip ratio and nothing else. Both adults are capable,
  // both are the same species, and neither silhouette is exaggerated.
  const sexShoulder = THREE.MathUtils.lerp(1, male ? 1.13 : 0.90, growth);
  const sexHip = THREE.MathUtils.lerp(1, male ? 0.92 : 1.13, growth);
  // Sustained physical work broadens the upper body; sedentary roles do not.
  const labour = family === 'labor' || family === 'industry' ? 0.08 : family === 'guard' ? 0.11
    : family === 'knowledge' || family === 'civic' ? -0.028 : 0;

  return {
    shoulderScale: THREE.MathUtils.lerp(0.72, 1, growth) * sexShoulder
      * (1 + labour * growth) * (1 + jitterA * 0.22) * THREE.MathUtils.lerp(1, 0.94, seniority),
    ribcageScale: (male ? 1.05 : 0.96) * (1 + labour * growth) * (0.92 + channel(person.id, 'ribs') * 0.16),
    hipScale: THREE.MathUtils.lerp(0.92, 1, growth) * sexHip * (1 + jitterB * 0.17),
    bellyScale: THREE.MathUtils.lerp(1.19, 1, Math.pow(maturity, 1.35))
      * (0.93 + (build - 1) * 1.2 + channel(person.id, 'belly') * 0.11)
      * THREE.MathUtils.lerp(1, 1.06, seniority),
    // Lean by design. The species reads powerful through proportion and material, not through mass.
    limbThickness: THREE.MathUtils.lerp(0.74, 1, growth)
      * (0.90 + (build - 1) * 0.95 + jitterC * 0.28 * maturity * maturity)
      * (1 + labour * 1.3 * growth) * THREE.MathUtils.lerp(1, 0.9, seniority),
    // A small child's head is roughly a sixth of its standing height, an adolescent's a seventh
    // and an adult's nearer a ninth. The fall-off is close to linear in age for exactly that
    // reason: anything faster and a thirteen-year-old is already proportioned like an adult.
    headScale: THREE.MathUtils.lerp(1.46, 1, maturity) * (1 + (seed - 0.5) * 0.05),
    legLength: THREE.MathUtils.lerp(0.77, 1, Math.pow(maturity, 0.86)) * (1 + jitterD * 0.16),
    armLength: THREE.MathUtils.lerp(0.82, 1, Math.pow(maturity, 0.9)) * (1 + (channel(person.id, 'reach') - 0.5) * 0.18),
    slouch: seniority * 0.09 + (family === 'labor' ? 0.016 : 0)
      + (1 - maturity) * -0.012 + (channel(person.id, 'slouch') - 0.5) * 0.02,
    // The long neck is a species trait, present from childhood, not an adult refinement.
    neckScale: THREE.MathUtils.lerp(0.86, 1.08, growth) * (1 - seniority * 0.1)
      * (1 - (build - 1) * 0.45) * (1 + (channel(person.id, 'neck') - 0.5) * 0.07),
  };
}

function postureFor(person: Person, maturity: number, seniority: number,
  family: RoleVisualFamily, proportions: HumanProportions): HumanPosture {
  const alert = family === 'guard';
  const child = maturity < 0.85;
  const sideways = channel(person.id, 'weight') - 0.5;
  return {
    stanceWidth: (alert ? 0.060 : family === 'labor' || family === 'industry' ? 0.053 : 0.044)
      * THREE.MathUtils.lerp(0.86, 1, maturity)
      * (1 + (channel(person.id, 'stance') - 0.5) * 0.3) * proportions.hipScale,
    // Bulkier torsos and broader shoulders physically push the arms outward.
    armRest: 0.050 + (proportions.limbThickness - 1) * 0.3 + (proportions.shoulderScale - 1) * 0.22
      + (alert ? 0.028 : 0) + (channel(person.id, 'arms') - 0.5) * 0.026,
    // The shoulder line answers the hip line. A guard at attention is the one body that does not.
    shoulderDrop: (alert ? (channel(person.id, 'drop') - 0.5) * 0.012
      : -Math.sign(sideways || 1) * (0.012 + Math.abs(sideways) * 0.026)),
    headTilt: (channel(person.id, 'tilt') - 0.5) * (child ? 0.075 : 0.042),
    // Committed, not centred: magnitude is pushed away from zero so nobody stands square.
    weightShift: Math.sign(sideways || 1) * (alert ? 0.22 + Math.abs(sideways) * 0.3
      : (child ? 0.5 : 0.42) + Math.abs(sideways) * (child ? 1.0 : 0.9)),
    pelvisTilt: (alert ? 0.012 : 0.034) * Math.sign(sideways || 1)
      * (0.6 + Math.abs(sideways) * 0.8),
    armLead: (channel(person.id, 'lead') - 0.5) * (alert ? 0.03 : 0.11),
    strideStyle: THREE.MathUtils.lerp(0.82, 1, maturity) * (1 - seniority * 0.2)
      * (0.93 + channel(person.id, 'stride') * 0.14) * (0.96 + proportions.legLength * 0.04),
  };
}

function paletteFor(person: Person, context: HumanLookContext, maturity: number, seniority: number,
  standing: number, family: RoleVisualFamily, eraRank: number): HumanPalette {
  const cultureId = person.cultureId || 'culture';
  const style = context.culture?.style;
  const quality = person.appearance?.materialQuality ?? 0.5;

  // Body. A culture occupies one cast of volcanic glass — warmer, cooler, greener — and its
  // people vary only in depth within it. The saturation ceiling is what keeps every one of those
  // casts reading as dark mineral rather than as a tinted plastic.
  const obsidian = shift(OBSIDIAN_GLASS,
    (channel(cultureId, 'tint') - 0.5) * 0.9 + (channel(person.id, 'glass') - 0.5) * 0.03,
    0.6 + channel(cultureId, 'tintsat') * 0.9 + (channel(person.id, 'glasssat') - 0.5) * 0.25,
    (channel(cultureId, 'tintdepth') - 0.5) * 0.008
    + (channel(person.id, 'glasslight') - 0.5) * 0.006 - seniority * 0.003,
    0.08, 0.012, 0.052);

  // Finish. Technology polishes glass; labour scuffs it; age dulls it. This is the single channel
  // that most separates a primitive settlement from an advanced one at a glance.
  const finish = THREE.MathUtils.clamp(
    0.13 + eraRank * 0.145
    + standing * 0.18 + quality * 0.12
    + (family === 'labor' || family === 'earth' || family === 'industry' ? -0.1 : 0)
    + (family === 'ritual' || family === 'civic' ? 0.07 : 0)
    + THREE.MathUtils.lerp(0.05, 0, maturity) - seniority * 0.14
    + (channel(person.id, 'finish') - 0.5) * 0.12, 0.06, 0.86);

  // Alloy. What the civilisation can cast, shifted a little per person so a crowd is not one metal.
  const alloyBand = ALLOY_ERAS[Math.min(ALLOY_ERAS.length - 1, eraRank)]!;
  const alloy = shift(pick(alloyBand, channel(person.id, 'alloy')),
    (channel(person.id, 'alloyhue') - 0.5) * 0.03, 1,
    (channel(person.id, 'alloylight') - 0.5) * 0.07 + standing * 0.04, 0.78, 0.12, 0.84);

  // Drape. Dark woven cloth that sits against the body without competing with it.
  const drapeSource = style
    ? (channel(person.id, 'drape') < 0.5 ? style.primary : style.secondary)
    : OBSIDIAN_GLASS;
  rampColor.set(drapeSource).lerp(mixColor.set(obsidian), 0.72);
  const drape = shift(`#${rampColor.getHexString()}`, 0, 0.62,
    (channel(person.id, 'drapelight') - 0.5) * 0.03 + eraRank * 0.004, 0.22, 0.022, 0.10);

  // Luminance. Culture steers the hue, but every culture is pulled back into the species' amber,
  // so four strangers from four civilisations still light up as one kind of creature.
  // Role adds a last small shift on top, reusing the existing deterministic role light rather
  // than inventing a second identity system beside it.
  rampColor.set(style?.accent ?? SPECIES_LIGHT).lerp(mixColor.set(SPECIES_LIGHT), 0.6)
    .lerp(mixColor.set(COSMIC_ROLES[family].color), 0.18);
  const luminous = shift(`#${rampColor.getHexString()}`,
    (channel(person.id, 'light') - 0.5) * 0.016, 1.04,
    (channel(person.id, 'lightval') - 0.5) * 0.05, 0.9, 0.5, 0.82);

  return {
    obsidian,
    finish,
    alloy,
    drape,
    luminous,
    luminance: THREE.MathUtils.clamp(
      0.92 + THREE.MathUtils.lerp(-0.2, 0, Math.pow(maturity, 0.7))
      + standing * 0.16 + seniority * 0.12
      + (family === 'ritual' ? 0.18 : family === 'guard' ? 0.08 : 0)
      + (eraRank >= 4 ? 0.1 : 0)
      + (channel(person.id, 'gain') - 0.5) * 0.14, 0.55, 1.55),
  };
}

/**
 * Role-and-era adornment grammar. The same role keeps recurring forms as technology advances: a
 * guard's shoulder structure becomes a cast pauldron, a ritual life's temple bars become a crown.
 * Lineage is the point — an advanced civilisation must still look descended from its ancestors.
 */
function wardrobeFor(person: Person, context: HumanLookContext, maturity: number, seniority: number,
  standing: number, family: RoleVisualFamily, eraRank: number): HumanWardrobe {
  const grammar = humanCultureGrammar(context.culture);
  const garmentClass = person.appearance?.garment ?? 'simple';
  const headwear = person.appearance?.headwear ?? 'none';
  const cold = context.cold ?? 0.3;
  const child = maturity < 0.52;
  const adolescent = !child && maturity < 0.92;
  const variant = channel(person.id, 'adorn');
  const dressed = standing * 0.5 + (context.prosperity ?? 0.4) * 0.25 + eraRank * 0.08;

  // ----- chest ---------------------------------------------------------------------------------
  let chest: ChestPiece;
  if (child) chest = 'none';
  else if (garmentClass === 'ceremonial') chest = eraRank >= 3 ? 'regalia' : 'yoke';
  else if (family === 'guard') chest = eraRank >= 3 ? 'chest-plate' : 'harness';
  else if (garmentClass === 'uniform') chest = eraRank >= 4 ? 'chest-plate' : 'gorget';
  else if (family === 'ritual') chest = 'yoke';
  else if (garmentClass === 'technical' || family === 'industry') chest = 'harness';
  else if (adolescent) chest = variant > 0.72 ? 'collar' : 'none';
  else if (eraRank === 0) chest = variant > 0.66 ? 'collar' : 'none';
  else if (eraRank <= 2) chest = variant > 0.3 ? 'collar' : 'none';
  else chest = dressed > 0.55 ? 'gorget' : 'collar';

  // ----- waist ---------------------------------------------------------------------------------
  let waist: WaistPiece = child ? (eraRank === 0 ? 'cord' : 'ring')
    : garmentClass === 'ceremonial' && eraRank >= 2 ? 'ceremonial-belt'
      : eraRank === 0 ? 'cord'
        : eraRank <= 2 ? (dressed > 0.5 ? 'ring' : 'cord')
          : dressed > 0.68 && !adolescent ? 'hip-plate' : 'ring';

  // ----- shoulder and back ---------------------------------------------------------------------
  let shoulder: ShoulderPiece = 'none';
  if (child) shoulder = 'none';
  else if (family === 'guard') shoulder = eraRank >= 3 ? 'pauldrons' : 'guards';
  else if (family === 'ritual' || garmentClass === 'ceremonial') shoulder = 'back-fall';
  else if (family === 'elder' || family === 'civic') shoulder = eraRank >= 3 ? 'back-fall' : 'side-panels';
  else if ((family === 'labor' || family === 'industry' || family === 'healing')
    && variant > 0.45) shoulder = 'tool-harness';
  else if (family === 'knowledge') shoulder = 'side-panels';
  else if (cold > 0.62 && eraRank >= 2) shoulder = 'back-fall';
  else if (standing > 0.68 && !adolescent) shoulder = 'guards';

  // ----- head ----------------------------------------------------------------------------------
  let head: HeadPiece;
  if (child) head = 'none';
  else if (headwear === 'helmet' || (family === 'guard' && eraRank >= 2)) head = 'high-crown';
  else if (family === 'ritual' && standing > 0.45) head = eraRank >= 3 ? 'crown' : 'temple-bars';
  else if (family === 'elder' || family === 'civic') head = standing > 0.5 ? 'crown' : 'head-ring';
  else if (headwear === 'wrap' || cold > 0.7) head = 'veil-fall';
  else if (headwear === 'brim' || headwear === 'cap') head = 'head-ring';
  else if (adolescent) head = variant > 0.82 ? 'head-ring' : 'none';
  else head = dressed > 0.6 ? 'head-ring' : variant > 0.78 ? 'temple-bars' : 'none';

  // ----- crest ---------------------------------------------------------------------------------
  // The crest is anatomy, so it varies by individual and culture rather than by fashion. Elders
  // wear theirs down to a shorn ridge; the young carry the fuller forms.
  const crest: CrestStyle = seniority > 0.55 && channel(person.id, 'wear') < seniority * 0.7 ? 'shorn'
    : family === 'guard' && eraRank >= 3 ? 'plated'
      : channel(person.id, 'crest') < 0.76 ? grammar.crest : grammar.alternateCrest;

  // ----- drape ---------------------------------------------------------------------------------
  // Every age wears the hip wrap; length and split are where standing and ceremony appear.
  let drape: DrapeForm;
  if (garmentClass === 'ceremonial' || family === 'ritual') drape = 'long-fall';
  else if (child) drape = 'hip-wrap';
  else if (eraRank === 0) drape = adolescent || variant < 0.55 ? 'hip-wrap' : 'front-fall';
  else if (dressed > 0.62 || cold > 0.65) drape = 'split-fall';
  else drape = adolescent && variant < 0.5 ? 'hip-wrap' : 'front-fall';

  // Recurring culture forms remain subordinate to age and role equipment.
  if (!child && family !== 'guard') {
    if (chest === 'collar' || chest === 'yoke') chest = grammar.collar;
    if (family === 'ritual' || family === 'civic') shoulder = grammar.shoulder;
    if (standing > 0.38 && waist !== 'cord') waist = grammar.waist;
    if (family === 'knowledge' || family === 'ritual') drape = grammar.drape;
  }
  const bands = adolescent ? 0.55 : child ? 0.2 : 1;
  return {
    chest, waist, shoulder, head, crest, drape,
    pack: !child && (family === 'trade' || family === 'labor'
      || (family === 'knowledge' && eraRank >= 3)) && variant > 0.35,
    // Band positions are axis coordinates, resolved against the limb the band sits on. A ring is
    // material and silhouette, never geometry, so a whole population can wear different ones free.
    armRing: bands > 0.4 && (dressed > 0.3 || family === 'guard' || family === 'ritual')
      ? 0.365 + (channel(person.id, 'ring') - 0.5) * 0.05 : 0,
    wristBand: bands > 0.4 && (dressed > 0.22 || family === 'guard')
      ? (family === 'guard' && eraRank >= 2 ? 0.66 : 0.782) : 0,
    thighBand: !child && family === 'ritual' && eraRank >= 2 ? 0.22 : 0,
    anklet: bands > 0.15 && (eraRank >= 1 || dressed > 0.35) ? 0.895 : 0,
    bandSwell: 0.08 + grammar.metal * 0.04 + standing * 0.07 + (family === 'guard' ? 0.05 : 0),
    // Luminous markings are the species' own; children carry fewer, and a long life accrues more.
    markingDensity: THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(0.42, 1, Math.pow(maturity, 0.75))
      + standing * 0.16 + seniority * 0.1
      + (family === 'ritual' ? 0.14 : 0)
      + (eraRank === 0 ? -0.1 : eraRank >= 4 ? 0.08 : 0)
      + (channel(person.id, 'marks') - 0.5) * 0.12, 0.3, 1.2),
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
    head: GODBOX_HEADS[Math.min(GODBOX_HEADS.length - 1, Math.floor(channel(person.id, 'head-archetype') * GODBOX_HEADS.length))]!,
    cultureGrammar: humanCultureGrammar(context.culture),
    proportions,
    posture: postureFor(person, maturity, seniority, family, proportions),
    palette: paletteFor(person, context, maturity, seniority, standing, family, eraRank),
    wardrobe: wardrobeFor(person, context, maturity, seniority, standing, family, eraRank),
    family, maturity, seniority, standing, seed,
  };
}
