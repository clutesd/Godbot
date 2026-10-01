import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { decorate, sculpt, ZONE_ACCENT, ZONE_CLOTH, ZONE_HAIR, ZONE_LEATHER, ZONE_METAL, type Section } from './HumanSculpt';
import type { HumanWardrobe } from './HumanAppearanceProfile';

/**
 * HumanWardrobeAtlas.ts
 *
 * A deterministic modular wardrobe. Every garment component the population can wear lives in one
 * merged geometry, tagged with a part id. Each person selects up to four parts; the vertex shader
 * collapses the rest. The result is one instanced draw call for all torso clothing across the whole
 * settlement and a second for everything worn on the head, with no per-person meshes or materials.
 *
 * Components are authored to contribute *silhouette*: hems flare, mantles break the shoulder line,
 * aprons and packs change the body outline. Hem length and flare are per-person, so one hem part
 * covers loincloths, short tunics, breeches, long skirts and full robes.
 */

export const GARMENT_PART = {
  none: 0,
  hem: 1,
  apron: 2,
  vest: 3,
  cuirass: 4,
  sash: 5,
  mantle: 6,
  cloak: 7,
  belt: 8,
  harness: 9,
  collar: 10,
  pack: 11,
  shoulders: 12,
} as const;

export const HEAD_PART = {
  none: 0,
  hairCap: 1,
  hairLong: 2,
  hairBun: 3,
  hairBraid: 4,
  hairTopknot: 5,
  cap: 6,
  brim: 7,
  helmet: 8,
  hood: 9,
  wrap: 10,
  headdress: 11,
} as const;

/** Clothing never needs the limb coverage axis, so every atlas vertex is simply "fully clothed". */
const CLOTHED = 1;

function hemSections(): readonly Section[] {
  return [
    [-0.100, 0.098, 0.084, -0.004],
    [-0.060, 0.092, 0.076, -0.006],
    [-0.020, 0.084, 0.064, -0.006],
    [0.012, 0.078, 0.056, -0.005],
    [0.042, 0.071, 0.049, -0.003],
  ];
}

function garmentParts(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];

  // Hem: the single most important clothing silhouette. Per-person length and flare turn this one
  // part into a loincloth, a working tunic, breeches, a long skirt or a floor-length robe.
  parts.push(sculpt(hemSections(), {
    radial: 14, samples: 2, zone: ZONE_CLOTH, cover: () => CLOTHED, part: GARMENT_PART.hem,
    occlusion: (y) => 1 - 0.16 * (1 - THREE.MathUtils.smoothstep(y, -0.09, 0.0)),
  }));

  // Apron: a front panel that reads instantly as working clothing at medium distance.
  parts.push(sculpt([
    [-0.170, 0.056, 0.009, 0.040],
    [-0.110, 0.066, 0.011, 0.044],
    [-0.040, 0.069, 0.013, 0.048],
    [0.012, 0.062, 0.013, 0.049],
    [0.056, 0.038, 0.011, 0.046],
  ], { radial: 10, zone: ZONE_CLOTH, cover: () => CLOTHED, part: GARMENT_PART.apron }));

  // Vest: a shorter, narrower chest layer that leaves the shoulders and sleeves visible.
  parts.push(sculpt([
    [0.070, 0.062, 0.044, 0.002],
    [0.120, 0.072, 0.050, 0.004],
    [0.180, 0.084, 0.060, 0.004],
    [0.232, 0.090, 0.060, 0.002],
    [0.262, 0.088, 0.053, -0.001],
  ], { radial: 12, zone: ZONE_CLOTH, cover: () => CLOTHED, part: GARMENT_PART.vest }));

  // Cuirass: the same chest volume in plate, with a shoulder lip that widens the silhouette.
  parts.push(sculpt([
    [0.085, 0.069, 0.049, 0.002],
    [0.140, 0.081, 0.055, 0.004],
    [0.200, 0.099, 0.063, 0.004],
    [0.246, 0.109, 0.063, 0.002],
    [0.272, 0.107, 0.055, -0.001],
    [0.286, 0.090, 0.046, -0.003],
  ], { radial: 12, zone: ZONE_METAL, cover: () => CLOTHED, part: GARMENT_PART.cuirass }));

  // Sash: a narrow culture-coloured diagonal. Cheap, and the clearest status read at distance.
  parts.push(decorate(new THREE.BoxGeometry(0.030, 0.30, 0.014)
    .rotateZ(0.42).translate(0.012, 0.155, 0.040),
  { zone: ZONE_ACCENT, cover: CLOTHED, part: GARMENT_PART.sash }));

  // Mantle: a shoulder cape. Breaks the shoulder line, which is how authority reads in silhouette.
  parts.push(decorate(new THREE.CylinderGeometry(0.096, 0.158, 0.185, 14, 1, false)
    .translate(0, 0.198, -0.004),
  { zone: ZONE_CLOTH, cover: CLOTHED, part: GARMENT_PART.mantle, occlusion: 0.9 }));

  // Cloak: a long back drape, deliberately only behind the body so arms stay readable.
  parts.push(decorate(new THREE.CylinderGeometry(0.102, 0.150, 0.52, 12, 1, false, Math.PI * 0.42, Math.PI * 1.16)
    .translate(0, 0.036, -0.006),
  { zone: ZONE_CLOTH, cover: CLOTHED, part: GARMENT_PART.cloak, occlusion: 0.88 }));

  parts.push(decorate(new THREE.TorusGeometry(0.070, 0.0105, 5, 16)
    .rotateX(Math.PI / 2).translate(0, 0.050, 0),
  { zone: ZONE_LEATHER, cover: CLOTHED, part: GARMENT_PART.belt }));

  for (const side of [-1, 1]) {
    parts.push(decorate(new THREE.BoxGeometry(0.026, 0.170, 0.011)
      .rotateZ(side * 0.2).translate(side * 0.040, 0.182, 0.040),
    { zone: ZONE_LEATHER, cover: CLOTHED, part: GARMENT_PART.harness }));
    parts.push(decorate(new THREE.SphereGeometry(0.030, 8, 6)
      .scale(1, 0.62, 0.85).translate(side * 0.092, 0.262, -0.004),
    { zone: ZONE_CLOTH, cover: CLOTHED, part: GARMENT_PART.shoulders, occlusion: 0.94 }));
  }

  parts.push(decorate(new THREE.TorusGeometry(0.034, 0.011, 5, 12)
    .rotateX(Math.PI / 2).translate(0, 0.292, -0.004),
  { zone: ZONE_CLOTH, cover: CLOTHED, part: GARMENT_PART.collar }));

  parts.push(decorate(new THREE.BoxGeometry(0.092, 0.100, 0.052)
    .translate(0, 0.170, -0.072),
  { zone: ZONE_LEATHER, cover: CLOTHED, part: GARMENT_PART.pack, occlusion: 0.9 }));

  return parts;
}

function headParts(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];

  // Hair cap: sits behind the brow and slightly back of the skull, so a hairline reads in profile.
  parts.push(sculpt([
    [-0.014, 0.0495, 0.0505, -0.013],
    [0.010, 0.0505, 0.0515, -0.007],
    [0.032, 0.0480, 0.0490, -0.005],
    [0.052, 0.0395, 0.0405, -0.006],
    [0.068, 0.0235, 0.0245, -0.006],
    [0.079, 0.0000, 0.0000, -0.006],
  ], { radial: 12, zone: ZONE_HAIR, cover: () => CLOTHED, part: HEAD_PART.hairCap }));

  // Long hair: a mass down the back of the neck. The biggest silhouette cue on a head.
  parts.push(sculpt([
    [-0.092, 0.030, 0.020, -0.034],
    [-0.062, 0.040, 0.026, -0.030],
    [-0.028, 0.047, 0.032, -0.024],
    [0.006, 0.050, 0.038, -0.018],
    [0.034, 0.048, 0.040, -0.012],
    [0.056, 0.038, 0.034, -0.010],
  ], { radial: 10, zone: ZONE_HAIR, cover: () => CLOTHED, part: HEAD_PART.hairLong, occlusion: () => 0.92 }));

  parts.push(decorate(new THREE.SphereGeometry(0.030, 10, 8)
    .scale(1, 0.92, 0.92).translate(0, 0.050, -0.047),
  { zone: ZONE_HAIR, cover: CLOTHED, part: HEAD_PART.hairBun }));

  parts.push(sculpt([
    [-0.140, 0.008, 0.008, -0.038],
    [-0.100, 0.013, 0.013, -0.040],
    [-0.055, 0.017, 0.017, -0.042],
    [-0.010, 0.020, 0.020, -0.040],
    [0.024, 0.022, 0.022, -0.034],
  ], { radial: 8, zone: ZONE_HAIR, cover: () => CLOTHED, part: HEAD_PART.hairBraid }));

  parts.push(decorate(new THREE.CylinderGeometry(0.014, 0.019, 0.044, 8)
    .translate(0, 0.096, -0.012),
  { zone: ZONE_HAIR, cover: CLOTHED, part: HEAD_PART.hairTopknot }));

  parts.push(sculpt([
    [0.010, 0.0520, 0.0530, -0.004],
    [0.034, 0.0505, 0.0515, -0.004],
    [0.056, 0.0420, 0.0430, -0.005],
    [0.072, 0.0250, 0.0260, -0.005],
    [0.081, 0.0000, 0.0000, -0.005],
  ], { radial: 10, zone: ZONE_CLOTH, cover: () => CLOTHED, part: HEAD_PART.cap }));

  // Brim: the same crown plus a wide flat disc. Reads as field work from any distance.
  parts.push(mergeGeometries([
    sculpt([
      [0.014, 0.0530, 0.0540, -0.003],
      [0.040, 0.0500, 0.0510, -0.004],
      [0.062, 0.0390, 0.0400, -0.004],
      [0.078, 0.0150, 0.0160, -0.004],
      [0.084, 0.0000, 0.0000, -0.004],
    ], { radial: 10, zone: ZONE_CLOTH, cover: () => CLOTHED, part: HEAD_PART.brim }),
    decorate(new THREE.CylinderGeometry(0.092, 0.086, 0.0075, 14)
      .translate(0, 0.016, -0.003),
    { zone: ZONE_CLOTH, cover: CLOTHED, part: HEAD_PART.brim }),
  ])!);

  // Helmet: a metal dome with a nasal bar, so a guard is unmistakable in a crowd.
  parts.push(mergeGeometries([
    sculpt([
      [-0.010, 0.0555, 0.0565, -0.003],
      [0.018, 0.0560, 0.0570, -0.003],
      [0.044, 0.0500, 0.0510, -0.004],
      [0.066, 0.0360, 0.0370, -0.004],
      [0.082, 0.0000, 0.0000, -0.004],
    ], { radial: 10, zone: ZONE_METAL, cover: () => CLOTHED, part: HEAD_PART.helmet }),
    decorate(new THREE.BoxGeometry(0.011, 0.046, 0.010)
      .translate(0, -0.020, 0.050),
    { zone: ZONE_METAL, cover: CLOTHED, part: HEAD_PART.helmet }),
  ])!);

  // Hood: a larger shell that swallows the skull and drops onto the shoulders.
  parts.push(sculpt([
    [-0.064, 0.0520, 0.0470, -0.020],
    [-0.030, 0.0610, 0.0570, -0.014],
    [0.004, 0.0640, 0.0620, -0.010],
    [0.038, 0.0600, 0.0580, -0.010],
    [0.066, 0.0450, 0.0430, -0.010],
    [0.084, 0.0000, 0.0000, -0.010],
  ], { radial: 10, zone: ZONE_CLOTH, cover: () => CLOTHED, part: HEAD_PART.hood, occlusion: () => 0.9 }));

  parts.push(decorate(new THREE.TorusGeometry(0.047, 0.0125, 5, 14)
    .rotateX(Math.PI / 2).translate(0, 0.026, -0.003),
  { zone: ZONE_CLOTH, cover: CLOTHED, part: HEAD_PART.wrap }));

  parts.push(decorate(new THREE.CylinderGeometry(0.030, 0.052, 0.090, 10, 1, false)
    .translate(0, 0.096, -0.004),
  { zone: ZONE_ACCENT, cover: CLOTHED, part: HEAD_PART.headdress }));

  return parts;
}

function buildAtlas(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const atlas = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return atlas;
}

export function createGarmentAtlasGeometry(): THREE.BufferGeometry {
  return buildAtlas(garmentParts());
}

export function createHeadAtlasGeometry(): THREE.BufferGeometry {
  return buildAtlas(headParts());
}

/** Up to four torso components, ordered so the dominant silhouette element is never dropped. */
export function garmentPartsFor(wardrobe: HumanWardrobe, out: number[] = [0, 0, 0, 0]): number[] {
  out[0] = GARMENT_PART.hem;
  out[1] = wardrobe.outer === 'apron' ? GARMENT_PART.apron
    : wardrobe.outer === 'vest' ? GARMENT_PART.vest
      : wardrobe.outer === 'cuirass' ? GARMENT_PART.cuirass
        : wardrobe.outer === 'sash' ? GARMENT_PART.sash
          : wardrobe.outer === 'mantle' ? GARMENT_PART.mantle
            : wardrobe.outer === 'cloak' || wardrobe.outer === 'long-coat' ? GARMENT_PART.cloak
              : wardrobe.outer === 'harness' ? GARMENT_PART.harness
                : GARMENT_PART.none;
  out[2] = wardrobe.belt ? GARMENT_PART.belt : GARMENT_PART.none;
  // The fourth slot carries whatever remaining element best separates this person from the crowd.
  out[3] = wardrobe.outer === 'cuirass' || wardrobe.outer === 'harness' ? GARMENT_PART.shoulders
    : wardrobe.top === 'robe' || wardrobe.top === 'suit' ? GARMENT_PART.collar
      : wardrobe.outer === 'long-coat' ? GARMENT_PART.collar
        : GARMENT_PART.none;
  return out;
}

/** Hair first, then whatever is worn over it. Hats never leave a bare scalp underneath. */
export function headPartsFor(wardrobe: HumanWardrobe, out: number[] = [0, 0, 0, 0]): number[] {
  const hidesHair = wardrobe.head === 'helmet' || wardrobe.head === 'hood';
  out[0] = wardrobe.hair === 'bald' || hidesHair ? HEAD_PART.none : HEAD_PART.hairCap;
  out[1] = hidesHair ? HEAD_PART.none
    : wardrobe.hair === 'long' ? HEAD_PART.hairLong
      : wardrobe.hair === 'bun' ? HEAD_PART.hairBun
        : wardrobe.hair === 'braid' ? HEAD_PART.hairBraid
          : wardrobe.hair === 'topknot' ? HEAD_PART.hairTopknot
            : HEAD_PART.none;
  out[2] = wardrobe.head === 'cap' ? HEAD_PART.cap
    : wardrobe.head === 'brim' ? HEAD_PART.brim
      : wardrobe.head === 'helmet' ? HEAD_PART.helmet
        : wardrobe.head === 'hood' ? HEAD_PART.hood
          : wardrobe.head === 'wrap' ? HEAD_PART.wrap
            : wardrobe.head === 'headdress' ? HEAD_PART.headdress
              : HEAD_PART.none;
  out[3] = wardrobe.head === 'headdress' ? HEAD_PART.wrap : HEAD_PART.none;
  return out;
}

/** Hem length and lateral flare in body units, from the chosen lower garment. */
export function hemFitFor(wardrobe: HumanWardrobe): { length: number; flare: number } {
  switch (wardrobe.bottom) {
    case 'loincloth': return { length: 0.42, flare: 0.78 };
    case 'short-skirt': return { length: 0.72, flare: 1.02 };
    case 'breeches': return { length: 0.6, flare: 0.86 };
    case 'long-skirt': return { length: wardrobe.top === 'robe' ? 2.45 : 2.0, flare: 1.14 };
    case 'work-trousers': return { length: 0.5, flare: 0.9 };
    default: return { length: 0.52, flare: 0.88 };
  }
}
