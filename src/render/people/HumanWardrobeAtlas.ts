import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { decorate, sculpt, ZONE_ALLOY, ZONE_CREST, ZONE_DRAPE, ZONE_STONE, type Section } from './HumanSculpt';
import type { HumanWardrobe } from './HumanAppearanceProfile';

/**
 * HumanWardrobeAtlas.ts
 *
 * A deterministic modular adornment set. Every component the species can wear lives in one merged
 * geometry, tagged with a part id. Each person selects up to six parts; the vertex shader collapses
 * the rest. The result is one instanced draw call for all body adornment across the whole
 * settlement and a second for everything worn on the head, with no per-person meshes or materials.
 *
 * The vocabulary is architectural rather than tailored: engraved collars, gorgets, chest and hip
 * plates, shoulder structures, waist rings, split ceremonial falls, back drapes and crowns. Cloth
 * exists, but only as a dark woven fall that hangs from a cast waist piece. Nothing here is a
 * tunic, a skirt, a bodice or a hat, because nothing on this species ever was.
 *
 * Components are authored to contribute *silhouette*: falls lengthen and flare per person,
 * shoulder structures break the deltoid line, and the waist piece is the one element every era of
 * every culture keeps, which is what makes an industrial citizen read as descended from a
 * primitive one rather than replaced by them.
 */

export const GARMENT_PART = {
  none: 0,
  /** The hip wrap. Always part 1: the vertex shader lengthens and flares exactly this part. */
  wrap: 1,
  /** The long tapered front panel of a ceremonial fall. */
  frontFall: 2,
  /** Paired hip panels — the split fall. */
  sidePanels: 3,
  /** Cast waist ring: the species' most persistent single form. */
  waistRing: 4,
  /** A front pelvic plate worn over the waist ring. */
  hipPlate: 5,
  /** Engraved neck collar, flaring from the shoulders to the throat. */
  collar: 6,
  /** A broad yoke over the clavicles. */
  gorget: 7,
  /** Pectoral plate. */
  chestPlate: 8,
  /** Geometric strap harness. */
  harness: 9,
  /** Light shoulder structures. */
  guards: 10,
  /** Heavy angular shoulder caps. */
  pauldrons: 11,
  /** Long woven drape down the back. */
  backFall: 12,
  /** Working strap and pouch. */
  toolHarness: 13,
  /** Role equipment carried on the back. */
  pack: 14,
  /** The tall ceremonial yoke of a high ritual life. */
  regalia: 15,
  /** Chunky carved stone neck piece, for societies that cannot yet cast. */
  stoneCollar: 16,
} as const;

export const HEAD_PART = {
  none: 0,
  crestRidged: 1,
  crestSwept: 2,
  crestFanned: 3,
  crestCoiled: 4,
  crestPlated: 5,
  templeBars: 6,
  headRing: 7,
  crown: 8,
  highCrown: 9,
  veilFall: 10,
  templeSeal: 11,
} as const;

/** Adornment never needs the limb coverage axis, so every atlas vertex sits at the distal end. */
const WORN = 1;

// ---------------------------------------------------------------------------------------------
// Body adornment
// ---------------------------------------------------------------------------------------------

/** The hip wrap, authored at its shortest. humanGarment lengthens and flares it per person. */
const WRAP: readonly Section[] = [
  [-0.116, 0.012, 0.006, 0.060],
  [-0.076, 0.021, 0.008, 0.064],
  [-0.020, 0.028, 0.009, 0.061],
  [0.032, 0.030, 0.008, 0.050],
  [0.058, 0.024, 0.006, 0.042],
];

/** The long tapered front panel. The clearest single silhouette element the species wears. */
const FRONT_FALL: readonly Section[] = [
  [-0.300, 0.0070, 0.0060, 0.0480],
  [-0.250, 0.0140, 0.0068, 0.0510],
  [-0.190, 0.0200, 0.0074, 0.0530],
  [-0.120, 0.0245, 0.0080, 0.0535],
  [-0.050, 0.0272, 0.0084, 0.0520],
  [0.010, 0.0285, 0.0088, 0.0480],
  [0.046, 0.0255, 0.0082, 0.0425],
];

const SIDE_PANEL: readonly Section[] = [
  [-0.215, 0.0085, 0.0090, 0],
  [-0.160, 0.0170, 0.0110, 0],
  [-0.100, 0.0245, 0.0128, 0],
  [-0.035, 0.0290, 0.0140, 0],
  [0.025, 0.0300, 0.0145, 0],
  [0.052, 0.0255, 0.0130, 0],
];



const HIP_PLATE: readonly Section[] = [
  [0.014, 0.0205, 0.0082, 0.0498],
  [0.034, 0.0345, 0.0096, 0.0506],
  [0.054, 0.0392, 0.0102, 0.0488],
  [0.074, 0.0340, 0.0094, 0.0452],
  [0.088, 0.0195, 0.0080, 0.0412],
];

const COLLAR: readonly Section[] = [
  [0.300, 0.0640, 0.0455, -0.004],
  [0.312, 0.0492, 0.0372, -0.005],
  [0.326, 0.0392, 0.0318, -0.005],
  [0.340, 0.0346, 0.0290, -0.006],
];

const GORGET: readonly Section[] = [
  [0.228, 0.1150, 0.0632, 0.002],
  [0.250, 0.1300, 0.0670, 0.000],
  [0.270, 0.1290, 0.0612, -0.002],
  [0.292, 0.1080, 0.0480, -0.004],
  [0.312, 0.0600, 0.0385, -0.004],
];

/**
 * The high ceremonial yoke. It is stepped rather than conical on purpose: an unbroken taper from
 * shoulder to throat reads as a lampshade, while a shoulder ring, a step, and a separate collar
 * read as three cast pieces assembled by a civilisation that knows what it is doing.
 */
const REGALIA: readonly Section[] = [
  [0.224, 0.1180, 0.0640, 0.002],
  [0.248, 0.1370, 0.0690, 0.000],
  [0.270, 0.1350, 0.0626, -0.002],
  [0.286, 0.1180, 0.0530, -0.003],
  [0.300, 0.0900, 0.0470, -0.004],
  [0.312, 0.0680, 0.0410, -0.005],
  [0.332, 0.0600, 0.0375, -0.006],
  [0.350, 0.0460, 0.0318, -0.006],
];

const BACK_FALL: readonly Section[] = [
  [-0.270, 0.0190, 0.0085, -0.0640],
  [-0.190, 0.0340, 0.0100, -0.0625],
  [-0.110, 0.0440, 0.0112, -0.0600],
  [-0.030, 0.0510, 0.0120, -0.0580],
  [0.050, 0.0550, 0.0124, -0.0580],
  [0.130, 0.0570, 0.0124, -0.0630],
  [0.205, 0.0530, 0.0118, -0.0710],
  [0.262, 0.0410, 0.0104, -0.0780],
];

const STONE_COLLAR: readonly Section[] = [
  [0.294, 0.0880, 0.0620, -0.003],
  [0.312, 0.0690, 0.0500, -0.004],
  [0.332, 0.0500, 0.0400, -0.005],
];

/** Six cast scales separated by real open joints, with a low inner bevel. */
function segmentedWaist(): THREE.BufferGeometry {
  const vertices: number[] = [], indices: number[] = [], uv: number[] = [];
  for (let sector = 0; sector < 6; sector++) {
    const base = vertices.length / 3;
    for (let top = 0; top < 2; top++) for (let outer = 0; outer < 2; outer++) for (let end = 0; end < 2; end++) {
      const a = sector * Math.PI / 3 + (end ? 0.49 : -0.49);
      const rx = outer ? (top ? 0.062 : 0.067) : 0.056;
      const rz = outer ? (top ? 0.043 : 0.046) : 0.037;
      vertices.push(Math.sin(a) * rx, top ? 0.076 : 0.043, Math.cos(a) * rz + 0.002);
      uv.push(end, top);
    }
    for (const [a,b,c,d] of [[0,1,3,2], [4,6,7,5], [0,4,5,1], [2,3,7,6], [0,2,6,4], [1,5,7,3]]) {
      indices.push(base+a!, base+b!, base+c!, base+a!, base+c!, base+d!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return decorate(geometry, { zone: ZONE_ALLOY, cover: WORN, part: GARMENT_PART.waistRing });
}

function garmentParts(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];

  // Three lapped petals leave the hip/leg silhouette open instead of making a skirt tube.
  for (const yaw of [0, 2.18, -2.18]) parts.push(sculpt(WRAP, {
    radial: 6, zone: ZONE_DRAPE, cover: () => WORN, part: GARMENT_PART.wrap,
    occlusion: () => 0.92,
  }).rotateY(yaw));

  parts.push(sculpt(FRONT_FALL, {
    radial: 8, zone: ZONE_DRAPE, cover: () => WORN, part: GARMENT_PART.frontFall,
    occlusion: () => 0.97,
  }));

  for (const side of [-1, 1]) {
    parts.push(sculpt(SIDE_PANEL, {
      radial: 6, zone: ZONE_DRAPE, cover: () => WORN, part: GARMENT_PART.sidePanels,
      occlusion: () => 0.94,
    }).translate(side * 0.082, 0, 0.010));
  }

  parts.push(segmentedWaist());

  parts.push(sculpt(HIP_PLATE, {
    radial: 8, zone: ZONE_ALLOY, cover: () => WORN, part: GARMENT_PART.hipPlate,
  }));

  parts.push(sculpt(COLLAR, {
    radial: 12, zone: ZONE_ALLOY, cover: () => WORN, part: GARMENT_PART.collar,
    occlusion: (y) => 1 - 0.14 * THREE.MathUtils.smoothstep(y, 0.32, 0.352),
  }));

  parts.push(sculpt(GORGET, {
    radial: 12, zone: ZONE_ALLOY, cover: () => WORN, part: GARMENT_PART.gorget,
    occlusion: () => 0.96,
  }));

  parts.push(sculpt(REGALIA, {
    radial: 10, zone: ZONE_ALLOY, cover: () => WORN, part: GARMENT_PART.regalia,
    occlusion: () => 0.95,
  }));

  parts.push(sculpt(STONE_COLLAR, {
    radial: 10, zone: ZONE_STONE, cover: () => WORN, part: GARMENT_PART.stoneCollar,
    occlusion: () => 0.93,
  }));

  // Pectoral plate: a front-facing shell, so the back of the torso stays bare obsidian.
  parts.push(decorate(new THREE.CylinderGeometry(0.1035, 0.0945, 0.125, 12, 1, true,
    -Math.PI * 0.33, Math.PI * 0.66).translate(0, 0.200, 0.002),
  { zone: ZONE_ALLOY, cover: WORN, part: GARMENT_PART.chestPlate, occlusion: 0.97 }));

  // Harness: two cast straps crossing the sternum. Geometry, not webbing.
  for (const side of [-1, 1]) {
    parts.push(decorate(new THREE.BoxGeometry(0.0145, 0.175, 0.011)
      .rotateZ(side * 0.30).translate(side * 0.036, 0.192, 0.057),
    { zone: ZONE_ALLOY, cover: WORN, part: GARMENT_PART.harness }));
    // Shoulder structures. Light guards break the deltoid line; pauldrons replace it.
    parts.push(sculpt([
      [-0.010, 0.013, 0.026, 0], [0, 0.030, 0.039, 0], [0.009, 0.020, 0.030, -0.004],
    ], { radial: 6, zone: ZONE_ALLOY, cover: () => WORN, part: GARMENT_PART.guards })
      .rotateZ(side * 0.34).translate(side * 0.115, 0.284, -0.002));
    parts.push(sculpt([
      [-0.028, 0.023, 0.027, 0], [-0.012, 0.035, 0.045, 0],
      [0.010, 0.032, 0.039, -0.003], [0.020, 0.015, 0.027, -0.006],
    ], { radial: 6, zone: ZONE_ALLOY, cover: () => WORN, part: GARMENT_PART.pauldrons })
      .rotateZ(side * 0.40).translate(side * 0.115, 0.272, -0.002));
    // Working strap: the one piece an ordinary labourer owns beyond the waist.
    parts.push(decorate(new THREE.BoxGeometry(0.0135, 0.150, 0.009)
      .rotateZ(side * 0.30).translate(side * 0.032, 0.184, 0.056),
    { zone: ZONE_STONE, cover: WORN, part: GARMENT_PART.toolHarness }));
  }

  // Back fall: a shaped drape hung off the shoulders behind the body only, so the arms stay
  // readable. Its width swells below the shoulder blades and gathers again at the hem, which is
  // what makes hanging cloth read as cloth rather than as a board.
  parts.push(sculpt(BACK_FALL, {
    radial: 8, zone: ZONE_DRAPE, cover: () => WORN, part: GARMENT_PART.backFall,
    occlusion: () => 0.88,
  }));

  parts.push(decorate(new THREE.BoxGeometry(0.086, 0.094, 0.048)
    .translate(0, 0.170, -0.070),
  { zone: ZONE_DRAPE, cover: WORN, part: GARMENT_PART.pack, occlusion: 0.9 }));

  return parts;
}

// ---------------------------------------------------------------------------------------------
// Head: crest and structure
// ---------------------------------------------------------------------------------------------

/** A ridged cap swept back off the brow. The commonest crest, and the species' default read. */
const CREST_RIDGED: readonly Section[] = [
  [-0.012, 0.0272, 0.0292, -0.0300],
  [0.010, 0.0392, 0.0430, -0.0210],
  [0.030, 0.0434, 0.0476, -0.0160],
  [0.046, 0.0432, 0.0470, -0.0150],
  [0.060, 0.0384, 0.0414, -0.0155],
  [0.072, 0.0254, 0.0274, -0.0165],
  [0.080, 0.0000, 0.0000, -0.0170],
];

/** Swept back and down the nape: the biggest silhouette cue a head can carry. */
const CREST_SWEPT: readonly Section[] = [
  [-0.062, 0.0240, 0.0165, -0.0400],
  [-0.032, 0.0330, 0.0238, -0.0365],
  [-0.004, 0.0414, 0.0364, -0.0255],
  [0.024, 0.0442, 0.0458, -0.0150],
  [0.048, 0.0400, 0.0430, -0.0140],
  [0.066, 0.0304, 0.0328, -0.0150],
  [0.077, 0.0150, 0.0164, -0.0158],
  [0.082, 0.0000, 0.0000, -0.0162],
];

/** Raised and fanned above the crown. */
const CREST_FANNED: readonly Section[] = [
  [-0.008, 0.0290, 0.0314, -0.0285],
  [0.016, 0.0414, 0.0452, -0.0180],
  [0.040, 0.0456, 0.0470, -0.0145],
  [0.064, 0.0430, 0.0404, -0.0185],
  [0.082, 0.0330, 0.0296, -0.0230],
  [0.095, 0.0176, 0.0158, -0.0262],
  [0.101, 0.0000, 0.0000, -0.0272],
];

/** A compact coiled mass gathered at the back of the skull. */
const CREST_COILED: readonly Section[] = [
  [-0.026, 0.0286, 0.0208, -0.0430],
  [0.000, 0.0384, 0.0330, -0.0350],
  [0.026, 0.0438, 0.0434, -0.0195],
  [0.048, 0.0420, 0.0424, -0.0155],
  [0.064, 0.0326, 0.0346, -0.0158],
  [0.075, 0.0168, 0.0180, -0.0162],
  [0.080, 0.0000, 0.0000, -0.0162],
];

/** Tight and segmented: a worked crest, for guards and for civilisations that engineer everything. */
const CREST_PLATED: readonly Section[] = [
  [-0.002, 0.0320, 0.0352, -0.0250],
  [0.020, 0.0420, 0.0458, -0.0160],
  [0.040, 0.0438, 0.0472, -0.0130],
  [0.058, 0.0400, 0.0426, -0.0130],
  [0.071, 0.0268, 0.0286, -0.0140],
  [0.079, 0.0000, 0.0000, -0.0145],
];

const HEAD_RING: readonly Section[] = [
  [0.018, 0.0452, 0.0484, -0.009],
  [0.030, 0.0464, 0.0496, -0.009],
  [0.042, 0.0446, 0.0478, -0.010],
];

const CROWN: readonly Section[] = [
  [0.034, 0.0448, 0.0478, -0.010],
  [0.050, 0.0432, 0.0458, -0.011],
  [0.068, 0.0372, 0.0390, -0.012],
  [0.086, 0.0250, 0.0258, -0.013],
  [0.096, 0.0150, 0.0155, -0.013],
];

const HIGH_CROWN: readonly Section[] = [
  [0.030, 0.0458, 0.0488, -0.010],
  [0.056, 0.0440, 0.0466, -0.012],
  [0.084, 0.0400, 0.0420, -0.014],
  [0.112, 0.0330, 0.0340, -0.016],
  [0.138, 0.0210, 0.0215, -0.018],
  [0.150, 0.0000, 0.0000, -0.019],
];

const VEIL_FALL: readonly Section[] = [
  [-0.120, 0.0405, 0.0300, -0.0420],
  [-0.080, 0.0455, 0.0350, -0.0380],
  [-0.040, 0.0490, 0.0400, -0.0320],
  [0.004, 0.0505, 0.0460, -0.0220],
  [0.034, 0.0480, 0.0490, -0.0130],
  [0.054, 0.0380, 0.0410, -0.0125],
];

function headParts(): THREE.BufferGeometry[] {
  const crest = (sections: readonly Section[], part: number) => sculpt(sections, {
    radial: 10, zone: ZONE_CREST, cover: () => WORN, part,
    occlusion: (y) => 1 - 0.1 * (1 - THREE.MathUtils.smoothstep(y, -0.04, 0.02)),
  });
  const parts: THREE.BufferGeometry[] = [
    crest(CREST_RIDGED, HEAD_PART.crestRidged),
    crest(CREST_SWEPT, HEAD_PART.crestSwept),
    crest(CREST_FANNED, HEAD_PART.crestFanned),
    crest(CREST_COILED, HEAD_PART.crestCoiled),
    crest(CREST_PLATED, HEAD_PART.crestPlated),
    sculpt(HEAD_RING, { radial: 10, zone: ZONE_ALLOY, cover: () => WORN, part: HEAD_PART.headRing }),
    sculpt(CROWN, { radial: 10, zone: ZONE_ALLOY, cover: () => WORN, part: HEAD_PART.crown }),
    sculpt(HIGH_CROWN, { radial: 10, zone: ZONE_ALLOY, cover: () => WORN, part: HEAD_PART.highCrown }),
    sculpt(VEIL_FALL, {
      radial: 8, zone: ZONE_DRAPE, cover: () => WORN, part: HEAD_PART.veilFall,
      occlusion: () => 0.9,
    }),
  ];
  for (const side of [-1, 1]) {
    // Temple bars: the smallest adornment the species makes, and the one it never stopped making.
    parts.push(decorate(new THREE.BoxGeometry(0.0075, 0.030, 0.0115)
      .rotateX(0.2).translate(side * 0.0462, 0.0135, 0.0120),
    { zone: ZONE_ALLOY, cover: WORN, part: HEAD_PART.templeBars }));
  }
  // Close observation reveals a small worked clasp beneath the temple structure.
  parts.push(sculpt([
    [-0.014, 0.0020, 0.0030, 0], [-0.006, 0.0040, 0.0040, 0],
    [0.002, 0.0028, 0.0032, 0],
  ], { radial: 6, zone: ZONE_ALLOY, cover: () => WORN, part: HEAD_PART.templeSeal })
    .translate(-0.048, 0, 0.006));
  return parts;
}

export function createHumanMantleGeometry(): THREE.BufferGeometry {
  return sculpt(BACK_FALL, { radial: 8, zone: ZONE_DRAPE, cover: () => WORN, occlusion: () => 0.88 })
    .translate(0, -0.26, 0);
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

/**
 * Up to six body components, ordered so the dominant silhouette element is never dropped. Four
 * ride `humanParts`; the last two are packed into one spare float, because the vertex shader can
 * unpack a pair for a few instructions and that is far cheaper than another instanced attribute.
 */
export function garmentPartsFor(wardrobe: HumanWardrobe, out: number[] = [0, 0, 0, 0]): number[] {
  out[0] = wardrobe.drape === 'none' ? GARMENT_PART.none : GARMENT_PART.wrap;
  out[1] = wardrobe.chest === 'collar' ? GARMENT_PART.collar
    : wardrobe.chest === 'gorget' ? GARMENT_PART.gorget
      : wardrobe.chest === 'yoke' ? GARMENT_PART.gorget
        : wardrobe.chest === 'chest-plate' ? GARMENT_PART.chestPlate
          : wardrobe.chest === 'harness' ? GARMENT_PART.harness
            : wardrobe.chest === 'regalia' ? GARMENT_PART.regalia
              : GARMENT_PART.none;
  out[2] = wardrobe.shoulder === 'guards' ? GARMENT_PART.guards
    : wardrobe.shoulder === 'pauldrons' ? GARMENT_PART.pauldrons
      : wardrobe.shoulder === 'back-fall' ? GARMENT_PART.backFall
        : wardrobe.shoulder === 'tool-harness' ? GARMENT_PART.toolHarness
          : wardrobe.shoulder === 'side-panels' ? GARMENT_PART.sidePanels
            : GARMENT_PART.none;
  out[3] = wardrobe.waist === 'cord' ? GARMENT_PART.none
    : wardrobe.waist === 'hip-plate' ? GARMENT_PART.hipPlate
      : GARMENT_PART.waistRing;
  return out;
}

/** The two overflow components, packed into a single float as `low + high * 32`. */
export function garmentOverflowFor(wardrobe: HumanWardrobe): number {
  const fall = wardrobe.drape === 'front-fall' || wardrobe.drape === 'long-fall'
    ? GARMENT_PART.frontFall
    : wardrobe.drape === 'split-fall' && wardrobe.shoulder !== 'side-panels'
      ? GARMENT_PART.sidePanels : GARMENT_PART.none;
  // A society that cannot cast still wears a neck piece; it is simply carved instead.
  const second = wardrobe.pack ? GARMENT_PART.pack
    : wardrobe.waist === 'hip-plate' ? GARMENT_PART.waistRing : GARMENT_PART.none;
  return fall + second * 32;
}

/** Crest first, then whatever structure is worn over it. */
export function headPartsFor(wardrobe: HumanWardrobe, out: number[] = [0, 0, 0, 0]): number[] {
  out[0] = wardrobe.crest === 'shorn' ? HEAD_PART.none
    : wardrobe.crest === 'swept' ? HEAD_PART.crestSwept
      : wardrobe.crest === 'fanned' ? HEAD_PART.crestFanned
        : wardrobe.crest === 'coiled' ? HEAD_PART.crestCoiled
          : wardrobe.crest === 'plated' ? HEAD_PART.crestPlated
            : HEAD_PART.crestRidged;
  out[1] = wardrobe.head === 'head-ring' ? HEAD_PART.headRing
    : wardrobe.head === 'crown' ? HEAD_PART.crown
      : wardrobe.head === 'high-crown' ? HEAD_PART.highCrown
        : wardrobe.head === 'veil-fall' ? HEAD_PART.veilFall
          : HEAD_PART.none;
  out[2] = wardrobe.head === 'temple-bars' || wardrobe.head === 'crown'
    || wardrobe.head === 'high-crown' ? HEAD_PART.templeBars : HEAD_PART.none;
  out[3] = wardrobe.head === 'crown' || wardrobe.head === 'high-crown'
    ? HEAD_PART.headRing : HEAD_PART.none;
  return out;
}

/** Fall length and lateral flare in body units, from the chosen drape form. */
export function hemFitFor(wardrobe: HumanWardrobe): { length: number; flare: number } {
  switch (wardrobe.drape) {
    case 'none': return { length: 0.001, flare: 1 };
    case 'hip-wrap': return { length: 0.62, flare: 0.92 };
    case 'front-fall': return { length: 0.80, flare: 0.95 };
    case 'split-fall': return { length: 1.05, flare: 1.02 };
    default: return { length: 1.95, flare: 1.06 };
  }
}
