import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sculpt, sculptForward, ZONE_SKIN, type Section } from './HumanSculpt';

/**
 * HumanAnatomy.ts
 *
 * The body itself. Every part is authored against one shared skeleton contract so the existing
 * two-link rig, reach solver, grounding and instancing keep working untouched:
 *
 *   crown        0.940   (COSMIC_CROWN_HEIGHT)
 *   head centre  0.865   (torso origin + 0.425)
 *   shoulder     0.710   (torso local +-0.12, 0.27)
 *   torso origin 0.440
 *   hip          0.450
 *   knee         0.225
 *   sole         0.000
 *
 * Arms and legs are two rigid segments. The hand is part of the forearm mesh and the foot is part
 * of the shin mesh, so a complete person with hands and feet still costs exactly the six instanced
 * draws the renderer already issued. Clothing coverage is a per-vertex axis, not extra geometry:
 * the surface shader slides the sleeve, trouser and boot boundaries per person.
 */

/** Total shoulder-to-fingertip and hip-to-sole length, used to normalise the clothing axis. */
const LIMB_AXIS = 0.45;

const armCover = (origin: number) => (y: number) =>
  THREE.MathUtils.clamp((origin - y) / LIMB_AXIS, 0, 1);

/** Softens the armpit, groin, neck and inner-joint creases that otherwise read as flat seams. */
const crease = (start: number, end: number, depth: number) => (y: number) =>
  1 - depth * THREE.MathUtils.smoothstep(y, start, end);

// ---------------------------------------------------------------------------------------------
// Torso
// ---------------------------------------------------------------------------------------------

/**
 * Seat, pelvis, lumbar curve, waist, ribcage, pectoral mass, deltoid shelf, trapezius slope and a
 * real neck. The sagittal channel carries the spinal S-curve, which is most of what separates a
 * human torso from a barrel.
 */
const TORSO: readonly Section[] = [
  [-0.058, 0.030, 0.026, -0.004],
  [-0.040, 0.062, 0.050, -0.011],
  [-0.018, 0.075, 0.055, -0.009],
  [0.002, 0.076, 0.052, -0.006],
  [0.028, 0.068, 0.045, -0.002],
  [0.058, 0.056, 0.038, 0.000],
  [0.085, 0.058, 0.040, 0.002],
  [0.118, 0.067, 0.045, 0.004],
  [0.152, 0.080, 0.052, 0.005],
  [0.190, 0.091, 0.057, 0.004],
  [0.222, 0.098, 0.057, 0.002],
  [0.252, 0.107, 0.052, -0.001],
  [0.274, 0.100, 0.044, -0.004],
  [0.296, 0.062, 0.034, -0.005],
  [0.322, 0.030, 0.026, -0.004],
  [0.352, 0.028, 0.025, -0.006],
  [0.369, 0.026, 0.024, -0.007],
];

/** The torso clothing axis runs from the neck down to the hem, so necklines slide along it. */
const torsoCover = (y: number) => THREE.MathUtils.clamp((0.369 - y) / 0.427, 0, 1);

export function createHumanTorsoGeometry(): THREE.BufferGeometry {
  return sculpt(TORSO, {
    radial: 16, samples: 2, zone: ZONE_SKIN, cover: torsoCover,
    occlusion: (y, angle) => {
      // The neck well and the seat crease are the two places light genuinely does not reach.
      const neck = 1 - 0.26 * THREE.MathUtils.smoothstep(y, 0.27, 0.345);
      const seat = 1 - 0.18 * (1 - THREE.MathUtils.smoothstep(y, -0.05, 0.0)) * (0.4 + 0.6 * Math.max(0, -Math.cos(angle)));
      const armpit = 1 - 0.2 * THREE.MathUtils.smoothstep(y, 0.2, 0.26)
        * (1 - THREE.MathUtils.smoothstep(y, 0.26, 0.3)) * Math.abs(Math.sin(angle));
      return neck * seat * armpit;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------------------------

/**
 * Chin, jawline, cheekbones, eye line, brow ridge, forehead and cranium. The sagittal channel
 * pushes the chin forward and sets the skull back, which is what makes a profile read as a face
 * rather than a ball. Nose, brow ridges and ears are merged as separate closed parts.
 */
const HEAD: readonly Section[] = [
  [-0.079, 0.016, 0.019, 0.011],
  [-0.068, 0.024, 0.028, 0.009],
  [-0.052, 0.034, 0.036, 0.004],
  [-0.034, 0.041, 0.042, 0.002],
  [-0.016, 0.047, 0.047, 0.000],
  [-0.004, 0.048, 0.049, -0.001],
  [0.008, 0.048, 0.050, -0.001],
  [0.022, 0.047, 0.048, -0.003],
  [0.040, 0.043, 0.044, -0.005],
  [0.058, 0.032, 0.033, -0.006],
  [0.070, 0.017, 0.018, -0.006],
  [0.075, 0.000, 0.000, -0.006],
];

const NOSE: readonly Section[] = [
  [-0.031, 0.005, 0.006, 0.049],
  [-0.024, 0.009, 0.010, 0.052],
  [-0.014, 0.008, 0.010, 0.055],
  [0.000, 0.006, 0.007, 0.051],
  [0.013, 0.004, 0.004, 0.047],
];

const EAR: readonly Section[] = [
  [-0.021, 0.003, 0.006, 0],
  [-0.010, 0.005, 0.010, 0],
  [0.004, 0.005, 0.011, 0],
  [0.015, 0.003, 0.007, 0],
];

const BROW: readonly Section[] = [
  [-0.005, 0.009, 0.004, 0],
  [0.002, 0.012, 0.006, 0],
  [0.008, 0.008, 0.004, 0],
];

/**
 * One head mesh for the whole population. Individual head shape comes from the per-instance
 * proportion attributes, not from extra geometry, so heads vary without extra draws.
 */
export function createHumanHeadGeometry(): THREE.BufferGeometry {
  const parts = [
    sculpt(HEAD, {
      radial: 16, samples: 2, zone: ZONE_SKIN, surface: 1, cover: () => 1,
      // The jaw shadow and the eye sockets are what give a stylised head its structure.
      occlusion: (y, angle) => (1 - 0.2 * (1 - THREE.MathUtils.smoothstep(y, -0.07, -0.04)))
        * (1 - 0.3 * Math.max(0, Math.cos(angle)) * Math.exp(-(((y + 0.001) / 0.014) ** 2))),
    }),
    sculpt(NOSE, { radial: 8, zone: ZONE_SKIN, surface: 1, cover: () => 1 }),
  ];
  for (const side of [-1, 1]) {
    parts.push(sculpt(EAR, { radial: 6, zone: ZONE_SKIN, surface: 1, cover: () => 1 })
      .translate(side * 0.046, -0.004, -0.006));
    parts.push(sculpt(BROW, { radial: 6, zone: ZONE_SKIN, surface: 1, cover: () => 1 })
      .translate(side * 0.019, 0.006, 0.042));
  }
  const head = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  head.computeVertexNormals();
  return head;
}

// ---------------------------------------------------------------------------------------------
// Arms
// ---------------------------------------------------------------------------------------------

/** Deltoid cap, biceps belly and a narrowing elbow. The cap overlaps the torso shoulder shelf. */
const UPPER_ARM: readonly Section[] = [
  [-0.196, 0.016, 0.018, -0.001],
  [-0.178, 0.019, 0.021, -0.001],
  [-0.150, 0.021, 0.022, -0.001],
  [-0.110, 0.024, 0.025, 0.000],
  [-0.070, 0.027, 0.028, 0.001],
  [-0.030, 0.030, 0.031, 0.000],
  [0.000, 0.031, 0.032, 0.000],
  [0.012, 0.024, 0.025, 0.000],
  [0.017, 0.000, 0.000, 0.000],
];

/** Forearm mass near the elbow narrowing to a real wrist. */
const FOREARM: readonly Section[] = [
  [-0.168, 0.0120, 0.0115, 0.002],
  [-0.140, 0.0160, 0.0160, 0.001],
  [-0.100, 0.0210, 0.0210, 0.000],
  [-0.060, 0.0240, 0.0240, 0.000],
  [-0.025, 0.0250, 0.0260, -0.001],
  [0.000, 0.0220, 0.0240, -0.001],
  [0.009, 0.0000, 0.0000, -0.001],
];

/**
 * A deliberately simplified hand: a flattened palm block, a knuckle line and a fused finger mass,
 * oriented edge-on with the palm facing the thigh, which is how a relaxed arm actually hangs.
 */
const HAND: readonly Section[] = [
  [-0.2520, 0.0090, 0.0150, 0.0020],
  [-0.2400, 0.0110, 0.0210, 0.0030],
  [-0.2200, 0.0115, 0.0250, 0.0030],
  [-0.2000, 0.0120, 0.0270, 0.0020],
  [-0.1860, 0.0125, 0.0260, 0.0010],
  [-0.1720, 0.0120, 0.0210, 0.0010],
  [-0.1600, 0.0110, 0.0140, 0.0010],
];

/** The thumb sits forward rather than sideways, so one mesh serves both hands un-mirrored. */
const THUMB: readonly Section[] = [
  [-0.2060, 0.0055, 0.0055, 0.030],
  [-0.1960, 0.0075, 0.0075, 0.034],
  [-0.1820, 0.0080, 0.0080, 0.032],
  [-0.1700, 0.0055, 0.0055, 0.026],
];

export function createHumanUpperArmGeometry(): THREE.BufferGeometry {
  return sculpt(UPPER_ARM, {
    radial: 10, zone: ZONE_SKIN, cover: armCover(0),
    occlusion: (y) => crease(-0.02, 0.014, 0.3)(y),
  });
}

export function createHumanForearmGeometry(): THREE.BufferGeometry {
  const parts = [
    sculpt(FOREARM, {
      radial: 10, zone: ZONE_SKIN, cover: armCover(0.19),
      occlusion: crease(-0.015, 0.008, 0.18),
    }),
    sculpt(HAND, { radial: 8, zone: ZONE_SKIN, cover: armCover(0.19), occlusion: () => 0.96 }),
    sculpt(THUMB, { radial: 6, zone: ZONE_SKIN, cover: armCover(0.19), occlusion: () => 0.9 }),
  ];
  const arm = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  arm.computeVertexNormals();
  return arm;
}

// ---------------------------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------------------------

const THIGH: readonly Section[] = [
  [-0.225, 0.030, 0.031, 0.000],
  [-0.195, 0.032, 0.033, 0.002],
  [-0.150, 0.036, 0.038, 0.003],
  [-0.100, 0.040, 0.043, 0.002],
  [-0.055, 0.043, 0.047, 0.000],
  [-0.020, 0.044, 0.048, -0.002],
  [0.012, 0.040, 0.044, -0.004],
  [0.030, 0.000, 0.000, -0.004],
];

/** Knee, calf belly set slightly behind the axis, then a narrow ankle. */
const SHIN: readonly Section[] = [
  [-0.196, 0.0165, 0.018, 0.002],
  [-0.170, 0.0190, 0.021, 0.001],
  [-0.130, 0.0250, 0.027, -0.002],
  [-0.090, 0.0290, 0.032, -0.005],
  [-0.055, 0.0300, 0.033, -0.004],
  [-0.020, 0.0290, 0.031, -0.001],
  [0.000, 0.0270, 0.029, 0.001],
  [0.009, 0.0000, 0.000, 0.001],
];

/** Heel to toe, swept forward. Half-depth becomes foot height, so the sole stays perfectly flat. */
const SOLE_Y = -0.225;
const FOOT: readonly Section[] = ([
  [-0.040, 0.022, 0.0300],
  [-0.020, 0.030, 0.0360],
  [0.010, 0.033, 0.0300],
  [0.050, 0.034, 0.0220],
  [0.090, 0.030, 0.0150],
  [0.112, 0.018, 0.0100],
] as const).map(([along, halfWidth, halfHeight]) =>
  // sculptForward maps the sagittal channel to -y, so this pins every section's underside to the sole.
  [along, halfWidth, halfHeight, -(SOLE_Y + halfHeight)] as Section);

export function createHumanThighGeometry(): THREE.BufferGeometry {
  return sculpt(THIGH, {
    radial: 10, zone: ZONE_SKIN, cover: armCover(0),
    occlusion: (y, angle) => crease(-0.02, 0.02, 0.28)(y)
      * (1 - 0.14 * Math.max(0, -Math.sin(angle))),
  });
}

export function createHumanShinGeometry(): THREE.BufferGeometry {
  const parts = [
    sculpt(SHIN, {
      radial: 10, zone: ZONE_SKIN, cover: armCover(0.225),
      occlusion: crease(-0.015, 0.009, 0.2),
    }),
    // The foot is always the distal end of the limb, so footwear always finds it first.
    sculptForward(FOOT, { radial: 10, zone: ZONE_SKIN, cover: () => 0.99, occlusion: () => 0.95 }),
  ];
  const leg = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  leg.computeVertexNormals();
  return leg;
}

// ---------------------------------------------------------------------------------------------
// Whole-limb forms, kept for callers that pose a limb as one piece
// ---------------------------------------------------------------------------------------------

function joinSegments(upper: THREE.BufferGeometry, lower: THREE.BufferGeometry,
  offset: number): THREE.BufferGeometry {
  const shifted = lower.clone().translate(0, offset, 0);
  const merged = mergeGeometries([upper, shifted])!;
  shifted.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Shoulder to fingertip in one mesh. */
export function createHumanArmGeometry(): THREE.BufferGeometry {
  const upper = createHumanUpperArmGeometry(), lower = createHumanForearmGeometry();
  const arm = joinSegments(upper, lower, -0.19);
  upper.dispose(); lower.dispose();
  return arm;
}

/** Hip to sole in one mesh. The sole lands exactly 0.45 below the hip. */
export function createHumanLegGeometry(): THREE.BufferGeometry {
  const upper = createHumanThighGeometry(), lower = createHumanShinGeometry();
  const leg = joinSegments(upper, lower, -0.225);
  upper.dispose(); lower.dispose();
  return leg;
}

/** Rounded double-ended segment for the articulated physical-work solver. Endpoints unchanged. */
export function createHumanWorkLimbGeometry(): THREE.BufferGeometry {
  return sculpt([
    [-0.62, 0, 0, 0], [-0.56, 0.018, 0.018, 0], [-0.48, 0.025, 0.026, 0],
    [-0.2, 0.033, 0.034, 0], [0.25, 0.025, 0.025, 0],
    [0.5, 0.024, 0.024, 0], [0.58, 0.012, 0.012, 0], [0.62, 0, 0, 0],
  ], {
    radial: 10, zone: ZONE_SKIN,
    cover: (y) => THREE.MathUtils.clamp((y + 0.62) / 1.24, 0, 1),
  });
}
