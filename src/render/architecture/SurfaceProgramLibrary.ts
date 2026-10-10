/**
 * SurfaceProgramLibrary.ts
 *
 * Procedural construction patterns for the architectural material library.
 *
 * Every pattern here is a fragment-stage program injected into a shared MeshStandardMaterial by
 * `installProceduralSurface`. There are no textures and no per-building image data: brick
 * coursing, log stacking, slate laps, form-board marks and standing seams are all evaluated in
 * the canonical building frame, so they are stable under instancing, deterministic, free of
 * memory cost, and never swim with the camera.
 *
 * The 26 patterns are produced by roughly a dozen parameterised generators rather than 26
 * bespoke bodies. That is the point: a coursed masonry pattern with a 75mm course and tight
 * joints *is* brickwork, and the same generator with a 400mm course and ragged joints *is*
 * rubble. Adding a material usually means adding a row to the material library, not a shader.
 *
 * Feature sizes are written in metres and converted once, because one canonical building unit is
 * roughly six metres and hand-converted constants are how this kind of code rots.
 */

import type { ProceduralSurfaceProgram } from '../materials/SurfaceDetail';
import type { SurfaceProgram } from './MaterialLibrary';
import { GRAMMAR_UNIT_METRES as UNIT_METRES } from '../assets/StructureFit';

/** A length in metres, as a GLSL literal in canonical building units. */
const m = (metres: number): string => (metres / UNIT_METRES).toFixed(6);

const n = (value: number): string => value.toFixed(4);

// ---------------------------------------------------------------------------- generators

interface CoursedMasonryOptions {
  /** Course (bed joint) height in metres. */
  course: number;
  /** Nominal block length in metres. */
  block: number;
  /** Extra random length added per course, in metres. 0 for a regular bond. */
  blockJitter?: number;
  /** Joint width as a fraction of the course period. */
  joint: number;
  /** Albedo variation between individual blocks. */
  faceVariation: number;
  /** Fine surface pitting amount. */
  pitting?: number;
  /** Per-course horizontal offset, as a fraction of block length. 0.5 is a stretcher bond. */
  stagger?: number;
  relief: number;
  wear: number;
  /** Joints that round and wash out rather than cutting sharply — earthen mortar. */
  soft?: boolean;
}

/**
 * Blocks laid in horizontal courses with mortar joints.
 *
 * Covers the whole masonry family: ragged fieldstone through to tight ashlar and fine brickwork.
 * The joint is a continuous function of position so it is safe to differentiate for relief.
 */
function coursedMasonry(options: CoursedMasonryOptions): ProceduralSurfaceProgram {
  const jitter = options.blockJitter ?? 0;
  const pitting = options.pitting ?? 0.06;
  const stagger = options.stagger ?? 0.5;
  const softness = options.soft ? 1.9 : 1;
  return {
    grain: false,
    wear: options.wear,
    relief: options.relief,
    body: /* glsl */ `
  float gbCourse = gbUV.y / ${m(options.course)};
  float gbCourseIndex = floor(gbCourse);
  float gbBlockLength = ${m(options.block)} + gbHash(vec2(gbCourseIndex, 3.0)) * ${m(jitter)};
  float gbBlock = (gbUV.x + gbCourseIndex * ${n(stagger)} * gbBlockLength
    + gbHash(vec2(gbCourseIndex, 7.0)) * ${m(jitter)}) / gbBlockLength;
  float gbBed = gbSeam(gbCourse, ${n(Math.min(0.48, options.joint * softness))});
  float gbPerp = gbSeam(gbBlock, ${n(Math.min(0.48, options.joint * 0.72 * softness))});
  float gbJoint = max(gbBed, gbPerp);
  float gbFace = gbHash(vec2(floor(gbBlock), gbCourseIndex) + 0.5) - 0.5;
  float gbPit = gbFbm(gbUV * 34.0) - 0.5;
  gbTone = 1.0 + gbFace * ${n(options.faceVariation)} + gbPit * ${n(pitting)} - gbJoint * 0.22;
  gbRough = 1.0 + gbJoint * 0.12 + gbPit * ${n(pitting)};
  gbHeight = -gbJoint + gbPit * 0.2;
`,
  };
}

interface PlateCourseOptions {
  /** Exposed course height (the gauge) in metres. */
  course: number;
  /** Plate width across the slope in metres. */
  plate: number;
  /** Strength of the shadow line at each lap. */
  lip: number;
  /** Albedo variation between plates. */
  variation: number;
  /** A rounded barrel per plate — pantiles and clay tiles rather than flat slate. */
  barrel?: boolean;
  relief: number;
  wear: number;
  /**
   * Roof shells are lofted rings, so courses follow height and plates follow arc length.
   * Wall cladding uses the ordinary face-local frame instead.
   */
  roofFrame?: boolean;
}

/** Overlapping plates: slate, wood shingle, clay tile, pantile. */
function plateCourse(options: PlateCourseOptions): ProceduralSurfaceProgram {
  const along = options.roofFrame ? 'vGbLocal.y' : 'gbUV.y';
  const across = options.roofFrame ? 'gbArc' : 'gbUV.x';
  const barrel = options.barrel
    ? `float gbBarrel = 1.0 - gbSeam(gbPlate, 0.55);`
    : `float gbBarrel = 0.0;`;
  return {
    grain: false,
    wear: options.wear,
    relief: options.relief,
    body: /* glsl */ `
  float gbCourse = (${along}) / ${m(options.course)};
  float gbPlate = (${across}) / ${m(options.plate)};
  float gbLap = gbSeam(gbCourse, 0.36);
  ${barrel}
  float gbShade = gbHash(vec2(floor(gbPlate), floor(gbCourse))) - 0.5;
  float gbSide = gbSeam(gbPlate, 0.08);
  gbTone = 1.0 + gbShade * ${n(options.variation)} - gbLap * ${n(options.lip)} + gbBarrel * 0.07 - gbSide * 0.1;
  gbRough = 1.0 + gbLap * 0.1 + abs(gbShade) * 0.08;
  gbHeight = gbLap * 0.7 - gbBarrel * 0.5 - gbSide * 0.3;
`,
  };
}

interface RenderedSurfaceOptions {
  /** Broad mottling scale — larger is a coarser, more hand-applied render. */
  mottle: number;
  /** Rain streaking on vertical faces. */
  streak: number;
  /** Rising-damp darkening at the base of the wall. */
  damp: number;
  /** Horizontal form-board lines and tie holes — shuttered concrete. */
  formBoard?: number;
  /** Faint panel edges showing through a thin render — daub over wattle. */
  panel?: number;
  relief: number;
  wear: number;
}

/** Applied monolithic surfaces: lime plaster, earthen render, adobe, shuttered concrete. */
function renderedSurface(options: RenderedSurfaceOptions): ProceduralSurfaceProgram {
  const form = options.formBoard
    ? /* glsl */ `
  float gbBoard = gbSeam(gbUV.y / ${m(0.22)}, 0.055);
  float gbTie = gbSeam(gbUV.x / ${m(0.9)}, 0.03) * gbSeam(gbUV.y / ${m(0.9)}, 0.03);
  gbTone -= gbBoard * ${n(options.formBoard * 0.12)} + gbTie * ${n(options.formBoard * 0.3)};
  gbRough += gbBoard * 0.05;
  gbHeight -= gbBoard * 0.35 + gbTie * 0.8;`
    : '';
  const panel = options.panel
    ? /* glsl */ `
  float gbBayEdge = max(gbSeam(gbUV.x / ${m(1.4)}, 0.04), gbSeam(gbUV.y / ${m(1.9)}, 0.04));
  gbTone -= gbBayEdge * ${n(options.panel * 0.14)};
  gbHeight -= gbBayEdge * ${n(options.panel * 0.5)};`
    : '';
  return {
    grain: false,
    wear: options.wear,
    relief: options.relief,
    body: /* glsl */ `
  float gbMottle = gbFbm(gbUV * ${n(options.mottle)}) * 0.68 + gbFbm(gbUV * ${n(options.mottle * 3.3)}) * 0.32;
  float gbStreak = gbFbm(vec2(gbUV.x * 48.0, gbUV.y * 3.4));
  float gbDamp = smoothstep(0.2, 0.0, vGbLocal.y);
  float gbRain = (1.0 - gbUpFace) * gbStreak;
  gbTone = 1.0 + (gbMottle - 0.5) * 0.16 - gbRain * ${n(options.streak)} - gbDamp * ${n(options.damp)};
  gbRough = 1.0 + (gbMottle - 0.5) * 0.12 + gbDamp * 0.08;
  gbHeight = (gbMottle - 0.5) * 0.7;
${form}
${panel}
`,
  };
}

interface TimberBoardOptions {
  /** Board or baulk width in metres. */
  plank: number;
  /** Grain ring frequency. */
  ring: number;
  /** Shadow depth at each board joint. */
  joint: number;
  /** Irregular adze-worked faces rather than a sawn one. */
  hewn?: boolean;
  relief: number;
  wear: number;
}

/** Worked timber, along the grain: hewn baulks and sawn boards. */
function timberBoard(options: TimberBoardOptions): ProceduralSurfaceProgram {
  const hewn = options.hewn
    ? `  float gbAdze = gbFbm(vec2(gbUV.x * 26.0, gbUV.y * 9.0)) - 0.5;
  gbTone += gbAdze * 0.11;
  gbHeight += gbAdze * 0.55;`
    : '';
  return {
    grain: true,
    wear: options.wear,
    relief: options.relief,
    body: /* glsl */ `
  float gbPlank = gbUV.y / ${m(options.plank)};
  float gbJoint = gbSeam(gbPlank, 0.13);
  float gbRing = gbFbm(vec2(gbUV.x * ${n(options.ring)}, floor(gbPlank) * 5.3 + gbUV.y * 74.0));
  float gbEnd = gbFbm(gbUV * 95.0);
  gbTone = 1.0 + (gbRing - 0.5) * 0.2 - gbJoint * ${n(options.joint)};
  gbTone = mix(gbTone, 1.0 + (gbEnd - 0.5) * 0.24, gbEndGrain);
  gbRough = 1.0 + gbJoint * 0.1 + (gbRing - 0.5) * 0.1;
  gbHeight = -gbJoint + (gbRing - 0.5) * 0.35;
${hewn}
`,
  };
}

/**
 * Horizontally stacked round logs with chinking between them.
 *
 * The relief is deliberately strong: the rounded course profile is the whole read of a log
 * building at a distance, and it is what distinguishes it from a boarded one.
 */
function logStack(logDiameter: number): ProceduralSurfaceProgram {
  return {
    grain: true,
    wear: 0.1,
    relief: 0.02,
    body: /* glsl */ `
  float gbLog = gbUV.y / ${m(logDiameter)};
  float gbRound = cos(fract(gbLog) * 6.2831853) * 0.5 + 0.5;
  float gbChink = gbSeam(gbLog, 0.2);
  float gbBody = gbHash(vec2(floor(gbLog), 11.0)) - 0.5;
  float gbGrainNoise = gbFbm(vec2(gbUV.x * 9.0, floor(gbLog) * 4.1)) - 0.5;
  gbTone = 1.0 + gbBody * 0.1 + gbGrainNoise * 0.14 - gbChink * 0.34 + (gbRound - 0.5) * 0.14;
  gbTone = mix(gbTone, 1.0 + gbGrainNoise * 0.3, gbEndGrain);
  gbRough = 1.0 + gbChink * 0.16;
  gbHeight = (gbRound - 0.5) * 1.6 - gbChink * 1.1;
`,
  };
}

/** Bundled reed or straw in overlapping courses, with a thick cut lip at each one. */
function thatchLayer(course: number, roofFrame: boolean): ProceduralSurfaceProgram {
  const along = roofFrame ? 'vGbLocal.y' : 'gbUV.y';
  const across = roofFrame ? 'gbArc' : 'gbUV.x';
  return {
    grain: false,
    wear: 0.18,
    relief: 0.012,
    body: /* glsl */ `
  float gbCourse = (${along}) / ${m(course)};
  float gbLip = gbSeam(gbCourse, 0.42);
  float gbStrand = gbFbm(vec2((${across}) * 130.0, floor(gbCourse) * 9.1));
  float gbClump = gbFbm(vec2((${across}) * 13.0, gbCourse * 0.8));
  gbTone = 1.0 + (gbStrand - 0.5) * 0.17 + (gbClump - 0.5) * 0.13 - gbLip * 0.16;
  gbRough = 1.0 + (gbStrand - 0.5) * 0.1;
  gbHeight = gbLip * 0.8 + (gbStrand - 0.5) * 0.5;
`,
  };
}

/** Rolled sheet with ribs along the rolling direction, lapped and fixed across it. */
function ribbedSheet(rib: number, lap: number, refined: number): ProceduralSurfaceProgram {
  return {
    grain: true,
    wear: 0.08,
    relief: 0.009,
    body: /* glsl */ `
  float gbRibPhase = gbUV.y / ${m(rib)};
  float gbRib = cos(fract(gbRibPhase) * 6.2831853) * 0.5 + 0.5;
  float gbLap = gbSeam(gbUV.x / ${m(lap)}, 0.05);
  float gbFixing = gbLap * step(0.74, fract(gbUV.y / ${m(rib * 3.0)}));
  float gbOxide = gbFbm(gbUV * 13.0);
  gbTone = 1.0 + (gbRib - 0.5) * 0.13 - gbLap * 0.18 - gbOxide * 0.12 * gbWear + gbFixing * 0.07;
  gbRough = 1.0 + gbLap * 0.12 + gbOxide * (0.3 + 0.6 * gbWear) * ${n(0.6 - refined * 0.3)};
  gbHeight = (gbRib - 0.5) * 1.3 - gbLap * 0.7 + gbFixing * 0.5;
`,
  };
}

/** Flat sheet joined by raised standing seams running down the slope. */
function seamedSheet(seam: number, lap: number, refined: number): ProceduralSurfaceProgram {
  return {
    grain: false,
    wear: 0.08,
    relief: 0.007,
    body: /* glsl */ `
  float gbStanding = gbSeam(gbArc / ${m(seam)}, 0.1);
  float gbCrossLap = gbSeam(vGbLocal.y / ${m(lap)}, 0.05);
  float gbOxide = gbFbm(vec2(gbArc * 9.0, vGbLocal.y * 9.0));
  float gbSheet = gbHash(vec2(floor(gbArc / ${m(seam)}), floor(vGbLocal.y / ${m(lap)}))) - 0.5;
  gbTone = 1.0 + gbStanding * 0.08 + gbSheet * 0.035 - gbCrossLap * 0.16 - gbOxide * 0.11 * gbWear;
  gbRough = 1.0 + gbCrossLap * 0.12 + gbOxide * (0.25 + 0.5 * gbWear) * ${n(0.6 - refined * 0.3)};
  gbHeight = gbStanding * 1.1 - gbCrossLap * 0.55;
`,
  };
}

/** Large machined cladding panels with recessed gasket joints. */
function panelGrid(panelWidth: number, panelHeight: number, gasket: number): ProceduralSurfaceProgram {
  return {
    grain: true,
    wear: 0.04,
    relief: 0.005,
    body: /* glsl */ `
  vec2 gbPanel = gbUV / vec2(${m(panelWidth)}, ${m(panelHeight)});
  float gbGasket = max(gbSeam(gbPanel.x, ${n(gasket)}), gbSeam(gbPanel.y, ${n(gasket)}));
  float gbSheet = gbHash(floor(gbPanel)) - 0.5;
  float gbFleck = gbFbm(gbUV * 44.0) - 0.5;
  gbTone = 1.0 + gbSheet * 0.045 + gbFleck * 0.04 - gbGasket * 0.26;
  gbRough = 1.0 + gbGasket * 0.2 + gbFleck * 0.06;
  gbHeight = -gbGasket;
`,
  };
}

/** Mill-rolled structural sections: flange shadowing and riveted or bolted connections. */
function rolledSteel(refined: number): ProceduralSurfaceProgram {
  return {
    grain: true,
    wear: 0.06,
    relief: 0.006,
    body: /* glsl */ `
  float gbFlange = gbSeam(gbUV.y / ${m(0.3)}, 0.18);
  float gbBoltRow = gbSeam(gbUV.y / ${m(0.3)}, 0.42);
  float gbBolt = gbBoltRow * step(0.78, fract(gbUV.x / ${m(0.12)}));
  float gbMill = gbFbm(vec2(gbUV.x * 7.0, gbUV.y * 31.0)) - 0.5;
  float gbOxide = gbFbm(gbUV * 15.0);
  gbTone = 1.0 + gbMill * 0.07 - gbFlange * 0.12 + gbBolt * 0.1 - gbOxide * 0.1 * gbWear;
  gbRough = 1.0 + gbFlange * 0.08 + gbOxide * (0.2 + 0.5 * gbWear) * ${n(0.55 - refined * 0.25)};
  gbHeight = -gbFlange * 0.5 + gbBolt * 0.9 + gbMill * 0.2;
`,
  };
}

/** Sand-cast skin: pitted, with a parting line and a slightly soft arris. */
function castMetal(): ProceduralSurfaceProgram {
  return {
    grain: true,
    wear: 0.07,
    relief: 0.007,
    body: /* glsl */ `
  float gbSkin = gbFbm(gbUV * 58.0) - 0.5;
  float gbCoarse = gbFbm(gbUV * 17.0) - 0.5;
  float gbParting = gbSeam(gbUV.y / ${m(0.45)}, 0.03);
  float gbOxide = gbFbm(gbUV * 11.0);
  gbTone = 1.0 + gbCoarse * 0.08 + gbSkin * 0.06 + gbParting * 0.06 - gbOxide * 0.12 * gbWear;
  gbRough = 1.0 + abs(gbSkin) * 0.22 + gbOxide * 0.3 * gbWear;
  gbHeight = gbSkin * 0.55 + gbCoarse * 0.5 + gbParting * 0.5;
`,
  };
}

/** Hand-worked iron: hammer facets, drawn tapers, uneven but not pitted. */
function wroughtMetal(): ProceduralSurfaceProgram {
  return {
    grain: true,
    wear: 0.1,
    relief: 0.005,
    body: /* glsl */ `
  float gbHammer = gbFbm(vec2(gbUV.x * 34.0, gbUV.y * 34.0)) - 0.5;
  float gbDraw = gbFbm(vec2(gbUV.x * 5.0, gbUV.y * 42.0)) - 0.5;
  float gbScale = gbFbm(gbUV * 19.0);
  gbTone = 1.0 + gbHammer * 0.1 + gbDraw * 0.07 - gbScale * 0.14 * gbWear;
  gbRough = 1.0 + abs(gbHammer) * 0.16 + gbScale * 0.34 * gbWear;
  gbHeight = gbHammer * 0.9 + gbDraw * 0.3;
`,
  };
}

/**
 * Glazing: panes divided by glazing bars.
 *
 * Small panes with heavy bars read as leaded or muntined glass; large panes with slender bars
 * read as a curtain wall. The faint banding is reflected sky, which is what makes glass look
 * like glass at a distance rather than like a flat grey panel.
 */
function glazingPanel(pane: number, bar: number, reflect: number): ProceduralSurfaceProgram {
  return {
    grain: false,
    wear: 0.03,
    relief: 0.004,
    body: /* glsl */ `
  vec2 gbPane = gbUV / ${m(pane)};
  float gbBar = max(gbSeam(gbPane.x, ${n(bar)}), gbSeam(gbPane.y, ${n(bar)}));
  float gbBand = gbFbm(vec2(gbUV.x * 2.0, gbUV.y * 11.0));
  float gbGrime = gbFbm(gbUV * 23.0);
  gbTone = 1.0 - gbBar * 0.42 + (gbBand - 0.5) * ${n(reflect)} - gbGrime * 0.08 * gbWear;
  gbRough = 1.0 + gbBar * 0.9 + gbGrime * 0.18 * gbWear;
  gbHeight = -gbBar * 1.1;
`,
  };
}

/** Bituminous membrane in lapped rolls, with a mineral-dressed surface. */
function membraneRoll(roll: number): ProceduralSurfaceProgram {
  return {
    grain: false,
    wear: 0.08,
    relief: 0.004,
    body: /* glsl */ `
  float gbRoll = gbSeam(gbUV.x / ${m(roll)}, 0.045);
  float gbGrit = gbFbm(gbUV * 120.0) - 0.5;
  float gbPond = gbFbm(gbUV * 6.0) - 0.5;
  gbTone = 1.0 + gbGrit * 0.1 + gbPond * 0.07 - gbRoll * 0.14;
  gbRough = 1.0 + abs(gbGrit) * 0.2;
  gbHeight = gbRoll * 0.6 + gbGrit * 0.3;
`,
  };
}

// ---------------------------------------------------------------------------- mapping

/**
 * The procedural program for one construction pattern.
 *
 * `refinement` is 0..1 derived from the architectural period: later periods have tighter joints,
 * flatter sheet and less oxidation, because their processes were more controlled. It modulates
 * the pattern rather than replacing it, so a brick wall is recognisably brick in every century.
 */
export function proceduralProgramFor(program: SurfaceProgram, refinement: number): ProceduralSurfaceProgram {
  const refined = Math.max(0, Math.min(1, refinement));
  switch (program) {
    // ----- masonry -----
    case 'rubble':
      // Uncoursed, wildly varied block sizes, thick ragged mortar.
      return coursedMasonry({ course: 0.34, block: 0.46, blockJitter: 0.42, joint: 0.2, faceVariation: 0.16, pitting: 0.1, stagger: 0.37, relief: 0.016, wear: 0.12 });
    case 'coursed-stone':
      return coursedMasonry({ course: 0.3, block: 0.62, blockJitter: 0.22, joint: 0.12, faceVariation: 0.12, pitting: 0.07, relief: 0.011, wear: 0.1 });
    case 'ashlar':
      // Fine joints, near-uniform faces: the surface reads as mass, not as units.
      return coursedMasonry({ course: 0.42, block: 0.88, blockJitter: 0.06, joint: 0.045 - refined * 0.015, faceVariation: 0.05, pitting: 0.03, relief: 0.005, wear: 0.06 });
    case 'brick-coursing':
      return coursedMasonry({ course: 0.0755, block: 0.225, joint: 0.17 - refined * 0.04, faceVariation: 0.15, pitting: 0.05, relief: 0.0055, wear: 0.09 });
    case 'mud-brick':
      // Soft, washed-out joints and eroded arrises.
      return coursedMasonry({ course: 0.11, block: 0.3, blockJitter: 0.05, joint: 0.2, faceVariation: 0.1, pitting: 0.12, relief: 0.008, wear: 0.2, soft: true });

    // ----- plates -----
    case 'slate-course':
      return plateCourse({ course: 0.14, plate: 0.26, lip: 0.17, variation: 0.11, relief: 0.006, wear: 0.1, roofFrame: true });
    case 'shingle':
      return plateCourse({ course: 0.13, plate: 0.17, lip: 0.2, variation: 0.17, relief: 0.008, wear: 0.16, roofFrame: true });
    case 'tile-course':
      return plateCourse({ course: 0.19, plate: 0.23, lip: 0.16, variation: 0.12, barrel: true, relief: 0.009, wear: 0.12, roofFrame: true });
    case 'terracotta':
      // A deeper pantile roll than a flat clay tile.
      return plateCourse({ course: 0.22, plate: 0.3, lip: 0.15, variation: 0.1, barrel: true, relief: 0.012, wear: 0.1, roofFrame: true });
    case 'thatch':
      return thatchLayer(0.33, true);

    // ----- rendered -----
    case 'plaster':
      return renderedSurface({ mottle: 11, streak: 0.07, damp: 0.11, relief: 0.006, wear: 0.1 });
    case 'adobe-render':
      return renderedSurface({ mottle: 7, streak: 0.1, damp: 0.16, relief: 0.011, wear: 0.2 });
    case 'daub-panel':
      return renderedSurface({ mottle: 9, streak: 0.09, damp: 0.14, panel: 1, relief: 0.009, wear: 0.2 });
    case 'concrete-form':
      return renderedSurface({ mottle: 5, streak: 0.09, damp: 0.1, formBoard: 1, relief: 0.007, wear: 0.12 });

    // ----- timber -----
    case 'hewn-timber':
      return timberBoard({ plank: 0.26, ring: 7, joint: 0.3, hewn: true, relief: 0.006, wear: 0.09 });
    case 'sawn-board':
      return timberBoard({ plank: 0.18, ring: 9, joint: 0.34, relief: 0.004, wear: 0.07 });
    case 'log-stack':
      return logStack(0.28);

    // ----- metal -----
    case 'corrugated-sheet':
      return ribbedSheet(0.076, 0.76, refined);
    case 'standing-seam':
      return seamedSheet(0.46, 2.4, refined);
    case 'sheet-panel':
      return panelGrid(1.25, 0.9, 0.05);
    case 'rolled-steel':
      return rolledSteel(refined);
    case 'cast-metal':
      return castMetal();
    case 'wrought-metal':
      return wroughtMetal();

    // ----- glazing and membrane -----
    case 'glazing':
      // Small panes in substantial bars: the window reads as divided.
      return glazingPanel(0.4, 0.075, 0.1);
    case 'curtain-wall':
      // Storey-height panes in slender mullions, with strong sky banding.
      return glazingPanel(1.4, 0.022, 0.16);
    case 'membrane':
      return membraneRoll(1.0);
  }
}

/**
 * Stable GPU program identity for a pattern at a refinement step.
 *
 * Refinement is bucketed rather than continuous so the whole world shares a handful of compiled
 * programs per pattern instead of one per building.
 */
export function surfaceProgramCacheKey(program: SurfaceProgram, refinement: number): string {
  return `godbox-arch:${program}:${refinementBucket(refinement)}`;
}

/** Four refinement steps is enough to read as process improvement without multiplying programs. */
export function refinementBucket(refinement: number): number {
  return Math.max(0, Math.min(3, Math.round(Math.max(0, Math.min(1, refinement)) * 3)));
}
