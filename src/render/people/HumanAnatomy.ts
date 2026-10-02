import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sculpt, sculptForward, ZONE_OBSIDIAN, type Section } from './HumanSculpt';

/**
 * HumanAnatomy.ts
 *
 * The body itself: a humanoid of living obsidian. Every part is authored against one shared
 * skeleton contract so the existing two-link rig, reach solver, grounding and instancing keep
 * working untouched:
 *
 *   crown        0.940   (COSMIC_CROWN_HEIGHT)
 *   head centre  0.865   (torso origin + 0.425)
 *   shoulder     0.710   (torso local +-0.12, 0.27)
 *   torso origin 0.440
 *   hip          0.450
 *   knee         0.225
 *   sole         0.000
 *
 * The proportions inside that contract are not human. The skull is smaller and higher, the neck
 * longer, the waist tighter, the limbs leaner and the hands and feet narrower, so the figure reads
 * as elongated and sculptural at documentary range without any anchor moving. Power comes from
 * proportion and material, never from inflated muscle.
 *
 * ## Joint continuity
 *
 * A body assembled from rigid segments betrays itself at the joints, and that is the single thing
 * that makes a procedural character read as parts rather than as a creature. The fix here is
 * geometric rather than a skinned-mesh rewrite: every segment that meets another ends in a rounded
 * cap centred exactly on the rig pivot, at the same radius as the part it meets.
 *
 *   shoulder   upper arm y = 0,       a deltoid ball buried in the torso's shelf
 *   elbow      upper arm y = -0.19    and forearm y = 0,    matched radius 0.0228
 *   knee       thigh y = -0.225       and shin y = 0,       matched radius 0.0300
 *   hip        thigh y = 0,           a ball buried in the pelvis
 *   neck       the head carries a narrow column that slides inside the torso's own neck
 *
 * Two co-centred rounded caps stay interpenetrating at every angle the rig can produce, so a bent
 * elbow or a flexed knee shows continuous mass instead of opening a seam. Baked occlusion at those
 * joints is deliberately shallow and placed above the cap, because a dark ring at a seam does
 * nothing but advertise the seam.
 *
 * Arms and legs remain two rigid segments. The hand is part of the forearm mesh and the foot is
 * part of the shin mesh, so a complete person still costs exactly the six instanced draws the
 * renderer already issued. Adornment is a per-vertex axis, not extra geometry: the surface shader
 * slides rings, cuffs and anklets along it per person.
 */

/** Total shoulder-to-fingertip and hip-to-sole length, used to normalise the adornment axis. */
const LIMB_AXIS = 0.45;

const armCover = (origin: number) => (y: number) =>
  THREE.MathUtils.clamp((origin - y) / LIMB_AXIS, 0, 1);

/**
 * Softens an inner crease without darkening the joint cap itself. Joint shading has to deepen the
 * fold a limb makes, never outline where one mesh stops and the next starts.
 */
const crease = (start: number, end: number, depth: number) => (y: number) =>
  1 - depth * THREE.MathUtils.smoothstep(y, start, end);

// ---------------------------------------------------------------------------------------------
// Torso
// ---------------------------------------------------------------------------------------------

/**
 * Seat, pelvis, lumbar curve, a genuinely narrow waist, a ribcage that opens into pectoral mass,
 * a rounded deltoid shelf that closes over the arm joint, and a long neck. The sagittal channel
 * carries the spinal S-curve, which is most of what separates a torso from a barrel; the shoulder
 * shelf is what separates this species from a human, because it is wider, rounder and set higher
 * than a human trapezius allows.
 */
const TORSO: readonly Section[] = [
  [-0.058, 0.0300, 0.0268, -0.0060],
  [-0.044, 0.0560, 0.0470, -0.0112],
  [-0.026, 0.0744, 0.0548, -0.0118],
  [-0.008, 0.0792, 0.0534, -0.0092],
  [0.012, 0.0748, 0.0476, -0.0054],
  [0.034, 0.0618, 0.0396, -0.0012],
  [0.056, 0.0540, 0.0352, 0.0022],
  [0.076, 0.0512, 0.0338, 0.0042],
  [0.100, 0.0552, 0.0372, 0.0052],
  [0.128, 0.0644, 0.0434, 0.0058],
  [0.158, 0.0762, 0.0502, 0.0058],
  [0.190, 0.0882, 0.0552, 0.0050],
  [0.218, 0.1050, 0.0582, 0.0030],
  [0.240, 0.1150, 0.0612, 0.0000],
  [0.262, 0.1255, 0.0630, -0.0030],
  [0.282, 0.1220, 0.0580, -0.0048],
  [0.298, 0.0905, 0.0452, -0.0052],
  [0.314, 0.0480, 0.0298, -0.0042],
  [0.332, 0.0280, 0.0240, -0.0050],
  [0.352, 0.0260, 0.0230, -0.0060],
  [0.369, 0.0250, 0.0220, -0.0070],
];

/** The torso adornment axis runs from the neck down to the hip, so collars and belts slide on it. */
const torsoCover = (y: number) => THREE.MathUtils.clamp((0.369 - y) / 0.427, 0, 1);

export function createHumanTorsoGeometry(): THREE.BufferGeometry {
  return sculpt(TORSO, {
    radial: 16, samples: 2, zone: ZONE_OBSIDIAN, cover: torsoCover,
    occlusion: (y, angle) => {
      // The neck well and the seat crease are the two places light genuinely does not reach.
      const neck = 1 - 0.24 * THREE.MathUtils.smoothstep(y, 0.286, 0.352);
      const seat = 1 - 0.17 * (1 - THREE.MathUtils.smoothstep(y, -0.05, 0.0)) * (0.4 + 0.6 * Math.max(0, -Math.cos(angle)));
      const armpit = 1 - 0.2 * THREE.MathUtils.smoothstep(y, 0.2, 0.265)
        * (1 - THREE.MathUtils.smoothstep(y, 0.265, 0.305)) * Math.abs(Math.sin(angle));
      // A shallow lateral groove under the ribcage: the waist has to be felt, not only measured.
      const flank = 1 - 0.1 * THREE.MathUtils.smoothstep(y, 0.02, 0.064)
        * (1 - THREE.MathUtils.smoothstep(y, 0.064, 0.11)) * Math.abs(Math.sin(angle));
      return neck * seat * armpit * flank;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------------------------

/**
 * A high narrow cranium, strong cheek planes, a defined jaw and a tapered chin, carried down into
 * a neck column that slides inside the torso's own neck. There are no ears and no human hairline:
 * the skull is a smooth closed form and the crest atlas works over it. The sagittal channel pushes
 * the chin forward and sweeps the cranium back, which is what makes the profile read as an
 * intelligent skull rather than a ball.
 *
 * The neck column is deliberately narrower than the torso's neck, so the seam between the two
 * meshes stays hidden inside the body however far the head turns.
 */
const HEAD: readonly Section[] = [
  [-0.0920, 0.0182, 0.0176, 0.0030],
  [-0.0820, 0.0194, 0.0192, 0.0048],
  [-0.0730, 0.0204, 0.0212, 0.0078],
  [-0.0660, 0.0238, 0.0278, 0.0126],
  [-0.0580, 0.0288, 0.0320, 0.0122],
  [-0.0500, 0.0326, 0.0340, 0.0088],
  [-0.0410, 0.0368, 0.0374, 0.0038],
  [-0.0310, 0.0416, 0.0414, 0.0012],
  [-0.0190, 0.0450, 0.0444, 0.0002],
  [-0.0100, 0.0452, 0.0458, -0.0012],
  [0.0040, 0.0450, 0.0470, -0.0014],
  [0.0115, 0.0452, 0.0486, 0.0004],
  [0.0180, 0.0446, 0.0484, -0.0004],
  [0.0260, 0.0430, 0.0462, -0.0048],
  [0.0420, 0.0400, 0.0424, -0.0080],
  [0.0580, 0.0316, 0.0334, -0.0092],
  [0.0690, 0.0176, 0.0184, -0.0100],
  [0.0750, 0.0000, 0.0000, -0.0100],
];

/** A short, broad-based ridge. The species has a nose, not a human nose. */
const NOSE: readonly Section[] = [
  [-0.0255, 0.0072, 0.0056, 0.0442],
  [-0.0185, 0.0092, 0.0074, 0.0462],
  [-0.0105, 0.0076, 0.0076, 0.0474],
  [-0.0015, 0.0056, 0.0064, 0.0466],
  [0.0075, 0.0040, 0.0048, 0.0448],
];

/**
 * One head mesh for the whole population. Individual head shape comes from the per-instance
 * proportion attributes, not from extra geometry, so heads vary without extra draws.
 */
export function createHumanHeadGeometry(): THREE.BufferGeometry {
  const parts = [
    sculpt(HEAD, {
      radial: 14, zone: ZONE_OBSIDIAN, surface: 1, cover: () => 1,
      // The jaw shadow and the eye sockets give a stylised head its structure. The neck column is
      // left open, because it lives inside the torso and must not paint a dark ring there.
      occlusion: (y, angle) => (1 - 0.2 * THREE.MathUtils.smoothstep(y, -0.040, -0.068))
        * (1 - 0.34 * Math.max(0, Math.cos(angle)) * Math.exp(-(((y - 0.0004) / 0.0135) ** 2))),
    }),
    sculpt(NOSE, { radial: 6, zone: ZONE_OBSIDIAN, surface: 1, cover: () => 1 }),
  ];
  const head = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  head.computeVertexNormals();
  return head;
}

// ---------------------------------------------------------------------------------------------
// Arms
// ---------------------------------------------------------------------------------------------

/**
 * A deltoid ball on the shoulder pivot, a lean biceps belly, and an elbow ball centred exactly on
 * the rig's elbow at the forearm's own elbow radius. Both ends are rounded caps that bury into the
 * part they meet, which is what removes the segmented look without touching the rig.
 */
const UPPER_ARM: readonly Section[] = [
  [-0.2128, 0.0000, 0.0000, -0.0016],
  [-0.2062, 0.0128, 0.0138, -0.0016],
  [-0.1980, 0.0194, 0.0208, -0.0016],
  [-0.1900, 0.0228, 0.0243, -0.0016],
  [-0.1740, 0.0214, 0.0229, -0.0014],
  [-0.1420, 0.0206, 0.0219, -0.0008],
  [-0.1040, 0.0226, 0.0240, 0.0001],
  [-0.0660, 0.0254, 0.0268, 0.0010],
  [-0.0300, 0.0288, 0.0302, 0.0006],
  [0.0000, 0.0322, 0.0334, 0.0000],
  [0.0130, 0.0294, 0.0306, -0.0004],
  [0.0220, 0.0196, 0.0206, -0.0008],
  [0.0270, 0.0000, 0.0000, -0.0010],
];

/**
 * An elbow ball matching the upper arm's, mass carried on the elbow side, and a genuinely fine
 * wrist. The asymmetric taper is what lets a highlight describe a forearm instead of a tube.
 */
const FOREARM: readonly Section[] = [
  [-0.1860, 0.0086, 0.0084, 0.0029],
  [-0.1720, 0.0110, 0.0106, 0.0027],
  [-0.1480, 0.0146, 0.0146, 0.0018],
  [-0.1180, 0.0190, 0.0196, 0.0006],
  [-0.0860, 0.0218, 0.0232, -0.0004],
  [-0.0560, 0.0234, 0.0250, -0.0012],
  [-0.0300, 0.0236, 0.0254, -0.0014],
  [-0.0120, 0.0232, 0.0249, -0.0012],
  [0.0000, 0.0228, 0.0243, -0.0010],
  [0.0120, 0.0196, 0.0210, -0.0010],
  [0.0200, 0.0122, 0.0132, -0.0010],
  [0.0250, 0.0000, 0.0000, -0.0010],
];

/**
 * The hand as one sculpted mass rather than four thin digits.
 *
 * At documentary range a hand has to read as a hand, and separate procedural fingers at a budget
 * that can afford them read as twigs — the clearest procedural tell on the whole figure. So the
 * palm carries the knuckle line, the finger plane and a real wrist taper in its silhouette, and
 * the surface shader cuts the finger separations into it as grooves, which costs nothing and holds
 * up far better than geometry can at this triangle count.
 */
const PALM: readonly Section[] = [
  [-0.2640, 0.0036, 0.0072, 0.0012],
  [-0.2570, 0.0068, 0.0162, 0.0014],
  [-0.2470, 0.0084, 0.0228, 0.0018],
  [-0.2330, 0.0094, 0.0262, 0.0022],
  [-0.2180, 0.0102, 0.0278, 0.0025],
  [-0.2050, 0.0114, 0.0280, 0.0024],
  [-0.1920, 0.0120, 0.0258, 0.0019],
  [-0.1800, 0.0118, 0.0208, 0.0014],
  [-0.1700, 0.0108, 0.0152, 0.0010],
  [-0.1620, 0.0092, 0.0110, 0.0008],
];

/** The thumb sits forward rather than sideways, so one mesh serves both hands un-mirrored. */
const THUMB: readonly Section[] = [
  [-0.2290, 0.0042, 0.0044, 0.0268],
  [-0.2170, 0.0062, 0.0066, 0.0320],
  [-0.2040, 0.0074, 0.0078, 0.0344],
  [-0.1900, 0.0066, 0.0068, 0.0320],
  [-0.1780, 0.0044, 0.0046, 0.0266],
];

export function createHumanUpperArmGeometry(): THREE.BufferGeometry {
  return sculpt(UPPER_ARM, {
    radial: 10, zone: ZONE_OBSIDIAN, cover: armCover(0),
    // Shallow, and placed above the cap: the fold inside a bent elbow, never an outline of it.
    occlusion: crease(-0.055, -0.016, 0.16),
  });
}

export function createHumanForearmGeometry(): THREE.BufferGeometry {
  const cover = armCover(0.19);
  const parts = [
    sculpt(FOREARM, {
      radial: 10, zone: ZONE_OBSIDIAN, cover,
      occlusion: crease(-0.046, -0.012, 0.12),
    }),
    sculpt(PALM, { radial: 8, zone: ZONE_OBSIDIAN, cover, occlusion: () => 0.96 }),
    sculpt(THUMB, { radial: 6, zone: ZONE_OBSIDIAN, cover, occlusion: () => 0.92 }),
  ];
  const arm = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  arm.computeVertexNormals();
  return arm;
}

// ---------------------------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------------------------

/** A hip ball buried in the pelvis, a glute-to-thigh sweep, and a knee ball on the rig's knee. */
const THIGH: readonly Section[] = [
  [-0.2574, 0.0000, 0.0000, 0.0000],
  [-0.2500, 0.0166, 0.0176, 0.0002],
  [-0.2400, 0.0248, 0.0262, 0.0004],
  [-0.2250, 0.0300, 0.0316, 0.0006],
  [-0.2060, 0.0292, 0.0310, 0.0015],
  [-0.1720, 0.0302, 0.0326, 0.0025],
  [-0.1280, 0.0340, 0.0372, 0.0026],
  [-0.0860, 0.0378, 0.0416, 0.0016],
  [-0.0480, 0.0408, 0.0452, 0.0000],
  [-0.0300, 0.0414, 0.0458, -0.0014],
  [-0.0120, 0.0400, 0.0442, -0.0028],
  [0.0000, 0.0378, 0.0416, -0.0036],
  [0.0160, 0.0330, 0.0362, -0.0046],
  [0.0280, 0.0210, 0.0230, -0.0050],
  [0.0340, 0.0000, 0.0000, -0.0052],
];

/** Knee ball, a calf belly set behind and above the mid-shin, then a fine ankle. */
const SHIN: readonly Section[] = [
  [-0.2066, 0.0000, 0.0000, 0.0032],
  [-0.2026, 0.0086, 0.0094, 0.0032],
  [-0.1960, 0.0128, 0.0142, 0.0031],
  [-0.1820, 0.0162, 0.0182, 0.0022],
  [-0.1520, 0.0208, 0.0240, -0.0010],
  [-0.1180, 0.0252, 0.0294, -0.0046],
  [-0.0880, 0.0270, 0.0312, -0.0052],
  [-0.0560, 0.0274, 0.0308, -0.0034],
  [-0.0280, 0.0284, 0.0302, -0.0008],
  [-0.0100, 0.0296, 0.0310, 0.0006],
  [0.0000, 0.0300, 0.0316, 0.0010],
  [0.0150, 0.0266, 0.0282, 0.0010],
  [0.0270, 0.0164, 0.0176, 0.0008],
  [0.0330, 0.0000, 0.0000, 0.0006],
];

/**
 * Heel, arch, forefoot, toe plane. `lift` raises a section's underside off the ground, so the
 * instep genuinely arches instead of the whole foot sitting on the floor like a wedge, while the
 * heel and the ball of the foot still make exact contact at the sole plane.
 */
const SOLE_Y = -0.225;
const FOOT: readonly Section[] = ([
  [-0.0400, 0.0158, 0.0238, 0.0012],
  [-0.0260, 0.0246, 0.0318, 0.0000],
  [-0.0070, 0.0278, 0.0306, 0.0014],
  [0.0150, 0.0290, 0.0250, 0.0028],
  [0.0380, 0.0302, 0.0196, 0.0024],
  [0.0600, 0.0308, 0.0150, 0.0008],
  [0.0780, 0.0294, 0.0118, 0.0000],
  [0.0920, 0.0248, 0.0094, 0.0000],
  [0.1020, 0.0152, 0.0070, 0.0004],
] as const).map(([along, halfWidth, halfHeight, lift]) =>
  // sculptForward maps the sagittal channel to -y, so this pins each section's underside to the
  // sole plus its own lift: heel and ball touch down, the instep between them does not.
  [along, halfWidth, halfHeight, -(SOLE_Y + halfHeight + lift)] as Section);

export function createHumanThighGeometry(): THREE.BufferGeometry {
  return sculpt(THIGH, {
    radial: 10, zone: ZONE_OBSIDIAN, cover: armCover(0),
    occlusion: (y, angle) => crease(-0.062, -0.020, 0.16)(y)
      * (1 - 0.13 * Math.max(0, -Math.sin(angle))),
  });
}

export function createHumanShinGeometry(): THREE.BufferGeometry {
  const parts = [
    sculpt(SHIN, {
      radial: 10, zone: ZONE_OBSIDIAN, cover: armCover(0.225),
      occlusion: crease(-0.050, -0.014, 0.14),
    }),
    // The foot is always the distal end of the limb, so an anklet always finds the ankle first.
    sculptForward(FOOT, { radial: 10, zone: ZONE_OBSIDIAN, cover: () => 0.99, occlusion: () => 0.94 }),
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
    radial: 10, zone: ZONE_OBSIDIAN,
    cover: (y) => THREE.MathUtils.clamp((y + 0.62) / 1.24, 0, 1),
  });
}
