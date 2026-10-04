/**
 * StructureGeometry.ts
 *
 * The geometry that makes a BuildingSpec visible.
 *
 * The composer already turns a grammar into a massed, roofed, opened building. What it could not
 * express were the decisions that distinguish one construction system from another: how a wall is
 * actually assembled, what it stands on, how much of the plan is open, what hangs off the side of
 * it, and what work happens inside. Those are emitted here, from the spec, on top of the shell.
 *
 * Everything is additive. A structure with no spec gets none of it and composes exactly as it did
 * before. Everything also honours the construction lifecycle: footings at FOUNDATION, assembly
 * character with the WALLS, services at UTILITIES, working equipment at FITOUT, dressing at
 * FINISH — so a half-built barn is a half-built barn rather than a complete one with holes.
 */

import { BUILD_STAGE } from '../assets/BuildStages';
import type { GeometryBuilder, Vec3 } from '../assets/GeometryBuilder';
import type { SurfaceKey } from '../materials/MaterialPalette';
import { SeededRandom } from '../../sim/prng';
import type { BuildingSpec } from './BuildingSpec';
import type { FoundationStyle, WallAssembly } from './StructuralFamily';
import type { FunctionalEquipment } from './BuildingArchetype';
import type { RotorSpec } from './MillMotion';

/**
 * What the geometry emitters need from the composer's canvas.
 *
 * A structural interface rather than the class itself, so this module does not depend on the
 * composer and the composer can therefore depend on this one.
 */
export interface GeometrySink {
  at(surface: SurfaceKey, requiredStage: number): GeometryBuilder | undefined;
  stain(builder: GeometryBuilder | undefined, extra: number): void;
  clean(builder: GeometryBuilder | undefined): void;
  /**
   * A part that turns about `pivot` on `axis`, so the motion system can drive it. Optional: a sink
   * without it gets the same geometry as static parts, which is all a test fake needs.
   */
  rotor?(name: string, pivot: Vec3, surface: SurfaceKey, requiredStage: number, spec: RotorSpec): GeometryBuilder | undefined;
}

/** A moving part's builder, or the static one when the sink cannot animate. */
export function rotorBuilder(
  sink: GeometrySink, name: string, pivot: Vec3, surface: SurfaceKey, stage: number, spec: RotorSpec,
): GeometryBuilder | undefined {
  return sink.rotor ? sink.rotor(name, pivot, surface, stage, spec) : sink.at(surface, stage);
}

/** The plot frame every emitter works in: canonical origin, +Y up, entrance facing +Z. */
export interface StructureFrame {
  halfWidth: number;
  halfDepth: number;
  /** Top of the plinth — the floor level. */
  plinthTop: number;
  /** Top of the walls, where the roof starts. */
  wallTop: number;
  /** Structural bay centre lines across the entrance elevation. */
  bayLines: readonly number[];
  /** Apex of the roof, where one is known. Equipment that sits on the roof reads it from here. */
  roofTop: number;
}

export function structureFrame(spec: BuildingSpec, plinthTop: number, wallTop: number, roofTop?: number): StructureFrame {
  const halfWidth = spec.width / 2;
  const halfDepth = spec.depth / 2;
  const bays = Math.max(1, spec.bays);
  const bayLines: number[] = [];
  for (let index = 0; index <= bays; index += 1) bayLines.push(-halfWidth + (spec.width * index) / bays);
  // Without a measured roof, assume one rising half a body above the walls, which is what the older
  // equipment placement was written against.
  return { halfWidth, halfDepth, plinthTop, wallTop, bayLines, roofTop: roofTop ?? wallTop + (wallTop - plinthTop) * 1.25 };
}

// ---------------------------------------------------------------------------- foundations

/**
 * What the structure stands on.
 *
 * The visible difference between a sill beam laid on pads and a concrete raft is one of the
 * clearest reads of construction technology at close range, and it costs a handful of boxes.
 */
export function emitFoundation(sink: GeometrySink, spec: BuildingSpec, frame: StructureFrame): void {
  const { halfWidth, halfDepth } = frame;
  const stone = sink.at('stone', BUILD_STAGE.FOUNDATION);
  const timber = sink.at('timber', BUILD_STAGE.FOUNDATION);
  const panel = sink.at('panel', BUILD_STAGE.FOUNDATION);
  const ground = sink.at('ground', BUILD_STAGE.FOUNDATION);
  const style: FoundationStyle = spec.foundation;
  const thickness = Math.max(0.018, spec.wallThickness);

  switch (style) {
    case 'none':
      return;

    case 'packed-earth':
      // A rammed earth pad, barely raised, spreading slightly past the wall.
      ground?.addBox(0, 0.012, 0, spec.width * 1.1, 0.024, spec.depth * 1.1);
      return;

    case 'stone-footing': {
      // Discrete pad stones under each post, which is what a timber frame actually sits on.
      for (const x of frame.bayLines) {
        for (const z of [halfDepth, -halfDepth]) {
          stone?.addBox(x, 0.03, z, thickness * 2.2, 0.06, thickness * 2.2);
        }
      }
      return;
    }

    case 'sill-beam': {
      // A continuous timber sill on pads: the frame never touches the ground.
      for (const z of [halfDepth, -halfDepth]) {
        timber?.addBox(0, 0.05, z, spec.width + thickness, 0.05, thickness * 1.2);
      }
      for (const x of [halfWidth, -halfWidth]) {
        timber?.addBox(x, 0.05, 0, thickness * 1.2, 0.05, spec.depth + thickness);
      }
      for (const x of frame.bayLines) {
        for (const z of [halfDepth, -halfDepth]) stone?.addBox(x, 0.015, z, thickness * 1.8, 0.03, thickness * 1.8);
      }
      return;
    }

    case 'masonry-plinth': {
      // A projecting plinth course with a weathered top edge.
      const height = Math.max(0.03, frame.plinthTop);
      stone?.addBox(0, height * 0.5, 0, spec.width + thickness * 2.2, height, spec.depth + thickness * 2.2);
      stone?.addBox(0, height + 0.012, 0, spec.width + thickness * 1.2, 0.024, spec.depth + thickness * 1.2);
      return;
    }

    case 'brick-footing': {
      // Two stepped courses corbelling out below the wall.
      const height = Math.max(0.03, frame.plinthTop);
      for (let step = 0; step < 2; step += 1) {
        const spread = thickness * (2.2 - step * 0.9);
        sink.at('brick', BUILD_STAGE.FOUNDATION)?.addBox(
          0, height * (0.25 + step * 0.4), 0,
          spec.width + spread, height * 0.5, spec.depth + spread,
        );
      }
      return;
    }

    case 'concrete-pad': {
      // A ground slab with a chamfered edge, flush with the yard.
      panel?.addBox(0, 0.022, 0, spec.width * 1.06, 0.044, spec.depth * 1.06);
      return;
    }

    case 'concrete-raft': {
      // A wider raft with a low upstand kerb — the building sits inside its own edge.
      panel?.addBox(0, 0.03, 0, spec.width * 1.14, 0.06, spec.depth * 1.14);
      for (const z of [halfDepth * 1.07, -halfDepth * 1.07]) {
        panel?.addBox(0, 0.075, z, spec.width * 1.14, 0.03, 0.03);
      }
      return;
    }

    case 'pile-cap': {
      // Pile heads and the cap beams spanning them: the only honest way to read a tall frame.
      for (const x of frame.bayLines) {
        for (const z of [halfDepth, -halfDepth]) {
          panel?.addBox(x, 0.045, z, thickness * 2.6, 0.09, thickness * 2.6);
        }
      }
      for (const z of [halfDepth, -halfDepth]) {
        panel?.addBox(0, 0.1, z, spec.width + thickness, 0.035, thickness * 1.6);
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------- wall assembly

/**
 * The character of the wall itself.
 *
 * The composer builds the wall as a field of units; this adds what makes that field read as a
 * *particular* construction: projecting log ends, corner quoins, pilaster piers, cladding ribs,
 * expressed floor bands, a curtain-wall mullion grid, or the batter of a thick earthen wall.
 */
export function emitWallAssembly(sink: GeometrySink, spec: BuildingSpec, frame: StructureFrame): void {
  const { halfWidth, halfDepth, plinthTop, wallTop } = frame;
  const height = wallTop - plinthTop;
  if (height <= 0) return;
  const thickness = Math.max(0.014, spec.wallThickness);
  const assembly: WallAssembly = spec.wallAssembly;

  switch (assembly) {
    case 'hide-and-brush':
      return;

    case 'stacked-log': {
      // Log ends cross and project at every corner. This, more than colour, is what says "log".
      const wall = sink.at('timber', BUILD_STAGE.WALLS);
      const courses = Math.max(3, Math.round(height / Math.max(0.03, thickness)));
      for (let course = 0; course < courses; course += 1) {
        const y = plinthTop + (course + 0.5) * (height / courses);
        const along = course % 2 === 0;
        const overhang = thickness * 1.7;
        if (along) {
          for (const z of [halfDepth, -halfDepth]) {
            wall?.addBox(0, y, z, spec.width + overhang * 2, thickness, thickness);
          }
        } else {
          for (const x of [halfWidth, -halfWidth]) {
            wall?.addBox(x, y, 0, thickness, thickness, spec.depth + overhang * 2);
          }
        }
      }
      return;
    }

    case 'infilled-frame': {
      // Diagonal bracing in every bay, which is the whole point of an exposed frame.
      const posts = sink.at('timber', BUILD_STAGE.FRAME);
      const reach = Math.min(0.42, spec.frameExposure);
      for (let index = 0; index < frame.bayLines.length - 1; index += 1) {
        const x0 = frame.bayLines[index]!;
        const x1 = frame.bayLines[index + 1]!;
        const rise = plinthTop + height * reach;
        for (const z of [halfDepth, -halfDepth]) {
          posts?.addBeam({ x: x0, y: plinthTop, z }, { x: (x0 + x1) / 2, y: rise, z }, thickness * 0.8, thickness * 0.8);
          posts?.addBeam({ x: x1, y: plinthTop, z }, { x: (x0 + x1) / 2, y: rise, z }, thickness * 0.8, thickness * 0.8);
        }
      }
      return;
    }

    case 'monolithic-earth': {
      // A battered wall: visibly thicker at the base, tapering as it rises.
      const wall = sink.at('daub', BUILD_STAGE.WALLS);
      const bands = 3;
      for (let band = 0; band < bands; band += 1) {
        const spread = thickness * (1.5 - band * 0.45);
        const y = plinthTop + height * ((band + 0.5) / bands);
        wall?.addBox(0, y, halfDepth + spread * 0.5, spec.width + spread, height / bands, spread);
        wall?.addBox(0, y, -halfDepth - spread * 0.5, spec.width + spread, height / bands, spread);
      }
      return;
    }

    case 'coursed-masonry': {
      // Dressed quoins at the corners, the one refinement a rubble wall always gets.
      const quoin = sink.at('stone', BUILD_STAGE.WALLS);
      const courses = Math.max(3, Math.round(height / Math.max(0.05, thickness * 1.6)));
      for (let course = 0; course < courses; course += 1) {
        const y = plinthTop + (course + 0.5) * (height / courses);
        const long = course % 2 === 0;
        for (const x of [halfWidth, -halfWidth]) {
          for (const z of [halfDepth, -halfDepth]) {
            quoin?.addBox(
              x - Math.sign(x) * thickness * (long ? 0.9 : 0.45),
              y,
              z - Math.sign(z) * thickness * (long ? 0.45 : 0.9),
              thickness * (long ? 1.8 : 0.9), height / courses, thickness * (long ? 0.9 : 1.8),
            );
          }
        }
      }
      return;
    }

    case 'load-bearing-brick': {
      // Shallow pilaster piers between the openings, carrying the floor loads down.
      const pier = sink.at('brick', BUILD_STAGE.WALLS);
      for (const x of frame.bayLines) {
        for (const z of [halfDepth, -halfDepth]) {
          pier?.addBox(x, plinthTop + height * 0.5, z + Math.sign(z) * thickness * 0.4,
            thickness * 1.6, height, thickness * 0.8);
        }
      }
      // A corbelled eaves band, the usual brick cornice.
      pier?.addBox(0, wallTop - thickness * 0.5, 0, spec.width + thickness * 1.3, thickness * 0.8, spec.depth + thickness * 1.3);
      return;
    }

    case 'clad-frame': {
      // Vertical cladding ribs on a light sheet skin — an industrial shed's whole texture.
      const skin = sink.at('panel', BUILD_STAGE.WALLS);
      const spacing = Math.max(0.05, spec.baySpacing / 4);
      for (let x = -halfWidth + spacing * 0.5; x < halfWidth; x += spacing) {
        for (const z of [halfDepth, -halfDepth]) {
          skin?.addBox(x, plinthTop + height * 0.5, z + Math.sign(z) * thickness * 0.6,
            thickness * 0.7, height, thickness * 0.8);
        }
      }
      return;
    }

    case 'cast-monolith': {
      // Expressed floor bands: a cast frame shows its storeys on the outside.
      const band = sink.at('panel', BUILD_STAGE.WALLS);
      const storeys = Math.max(1, spec.floors);
      for (let floor = 1; floor <= storeys; floor += 1) {
        const y = plinthTop + (height * floor) / storeys;
        band?.addBox(0, y, 0, spec.width + thickness * 1.5, thickness * 1.1, spec.depth + thickness * 1.5);
      }
      return;
    }

    case 'glazed-curtain': {
      // A mullion grid with spandrel bands at every floor — the curtain wall is the elevation.
      const mullion = sink.at('metal', BUILD_STAGE.WALLS);
      const spacing = Math.max(0.05, spec.baySpacing / 3);
      for (let x = -halfWidth; x <= halfWidth + 1e-6; x += spacing) {
        for (const z of [halfDepth, -halfDepth]) {
          mullion?.addBox(x, plinthTop + height * 0.5, z, thickness * 1.1, height, thickness * 1.4);
        }
      }
      const storeys = Math.max(1, spec.floors);
      for (let floor = 0; floor <= storeys; floor += 1) {
        const y = plinthTop + (height * floor) / storeys;
        mullion?.addBox(0, y, 0, spec.width + thickness, thickness * 1.3, spec.depth + thickness);
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------- openness

/**
 * The part of the plan that is not walled.
 *
 * A market, a pen, a dock shed and an open-sided barn are all defined by what they *lack*: a
 * post-and-lintel line stands where a wall would be. This emits those open bays, so openness is
 * a visible structural fact rather than a number in the spec.
 */
export function emitOpenBays(sink: GeometrySink, spec: BuildingSpec, frame: StructureFrame): void {
  if (spec.openness < 0.12) return;
  const { halfDepth, plinthTop, wallTop } = frame;
  const posts = sink.at('timber', BUILD_STAGE.FRAME);
  const lintel = sink.at('timber', BUILD_STAGE.FRAME);
  const thickness = Math.max(0.02, spec.wallThickness * 1.4);
  const height = wallTop - plinthTop;
  if (height <= 0) return;

  // Open bays start at the entrance face and spread round as openness rises.
  const bays = frame.bayLines.length - 1;
  const openCount = Math.max(1, Math.round(bays * Math.min(1, spec.openness)));
  const first = Math.max(0, Math.floor((bays - openCount) / 2));

  for (let index = first; index < Math.min(bays, first + openCount); index += 1) {
    const x0 = frame.bayLines[index]!;
    const x1 = frame.bayLines[index + 1]!;
    for (const x of [x0, x1]) {
      posts?.addBox(x, plinthTop + height * 0.5, halfDepth, thickness, height, thickness);
    }
    lintel?.addBox((x0 + x1) / 2, wallTop - thickness * 0.6, halfDepth, x1 - x0 + thickness, thickness * 0.9, thickness);
    // A knee brace at each head, which is what keeps an open frame from racking.
    const brace = Math.min(0.2, (x1 - x0) * 0.3);
    for (const x of [x0, x1]) {
      posts?.addBeam(
        { x, y: wallTop - height * 0.26, z: halfDepth },
        { x: x + (x === x0 ? brace : -brace), y: wallTop - thickness, z: halfDepth },
        thickness * 0.6, thickness * 0.6,
      );
    }
  }

  // A fully open structure — a pen, a market ground — carries the same line on the back face.
  if (spec.openness > 0.6) {
    for (let index = first; index < Math.min(bays, first + openCount); index += 1) {
      const x0 = frame.bayLines[index]!;
      const x1 = frame.bayLines[index + 1]!;
      for (const x of [x0, x1]) posts?.addBox(x, plinthTop + height * 0.5, -halfDepth, thickness, height, thickness);
      lintel?.addBox((x0 + x1) / 2, wallTop - thickness * 0.6, -halfDepth, x1 - x0 + thickness, thickness * 0.9, thickness);
    }
  }
}

// ---------------------------------------------------------------------------- annexes

/**
 * Subordinate volumes: lean-tos, service wings, the shed somebody added later.
 *
 * Annex count comes from the archetype stage and from recorded expansion history, so a building
 * that the simulation says grew actually looks like it grew.
 */
export function emitAnnexes(sink: GeometrySink, spec: BuildingSpec, frame: StructureFrame, random: SeededRandom): void {
  if (spec.annexes <= 0) return;
  const { halfWidth, halfDepth, plinthTop, wallTop } = frame;
  const wall = sink.at('daub', BUILD_STAGE.WALLS);
  const roof = sink.at('roof-metal', BUILD_STAGE.ROOF);
  const posts = sink.at('timber', BUILD_STAGE.FRAME);
  const bodyHeight = wallTop - plinthTop;
  if (bodyHeight <= 0) return;

  // Sides first, then the rear: a lean-to goes where it does not block the entrance.
  const slots: { x: number; z: number; alongX: boolean }[] = [
    { x: halfWidth, z: 0, alongX: false },
    { x: -halfWidth, z: 0, alongX: false },
    { x: 0, z: -halfDepth, alongX: true },
  ];
  // A breast wheel stands on the west wall in its own race. A lean-to built there would wrap the
  // wheel and bury it, so the west side is kept clear and any annex goes to the rear instead.
  if (spec.equipment.includes('waterwheel')) slots.splice(1, 1);

  const count = Math.min(spec.annexes, slots.length);
  for (let index = 0; index < count; index += 1) {
    const slot = slots[index]!;
    const depth = (slot.alongX ? spec.depth : spec.width) * random.range(0.26, 0.38);
    const run = (slot.alongX ? spec.width : spec.depth) * random.range(0.52, 0.78);
    const high = bodyHeight * random.range(0.46, 0.62);
    const low = high * 0.62;
    const outward = depth * 0.5;

    const cx = slot.alongX ? slot.x : slot.x + Math.sign(slot.x) * outward;
    const cz = slot.alongX ? slot.z - outward : slot.z;
    const sizeX = slot.alongX ? run : depth;
    const sizeZ = slot.alongX ? depth : run;

    wall?.addBox(cx, plinthTop + low * 0.5, cz, sizeX, low, sizeZ);
    // A mono-pitch roof falling away from the main wall: the defining lean-to silhouette.
    const near = slot.alongX
      ? [{ x: cx - sizeX / 2, y: plinthTop + high, z: cz + sizeZ / 2 }, { x: cx + sizeX / 2, y: plinthTop + high, z: cz + sizeZ / 2 }]
      : [{ x: cx - Math.sign(slot.x) * sizeX / 2, y: plinthTop + high, z: cz - sizeZ / 2 }, { x: cx - Math.sign(slot.x) * sizeX / 2, y: plinthTop + high, z: cz + sizeZ / 2 }];
    const far = slot.alongX
      ? [{ x: cx + sizeX / 2, y: plinthTop + low, z: cz - sizeZ / 2 }, { x: cx - sizeX / 2, y: plinthTop + low, z: cz - sizeZ / 2 }]
      : [{ x: cx + Math.sign(slot.x) * sizeX / 2, y: plinthTop + low, z: cz + sizeZ / 2 }, { x: cx + Math.sign(slot.x) * sizeX / 2, y: plinthTop + low, z: cz - sizeZ / 2 }];
    roof?.addQuad(near[0]!, near[1]!, far[0]!, far[1]!);

    // Props under the open outer edge.
    for (const corner of far) {
      posts?.addBox(corner.x, plinthTop + low * 0.5, corner.z, spec.wallThickness * 1.2, low, spec.wallThickness * 1.2);
    }
  }
}

// ---------------------------------------------------------------------------- equipment

interface EquipmentContext {
  sink: GeometrySink;
  spec: BuildingSpec;
  frame: StructureFrame;
  random: SeededRandom;
}

/** A small box helper that keeps the equipment bodies readable. */
function box(
  sink: GeometrySink, surface: SurfaceKey, stage: number,
  x: number, y: number, z: number, sx: number, sy: number, sz: number, rotationY = 0,
): void {
  sink.at(surface, stage)?.addBox(x, y, z, sx, sy, sz, rotationY);
}

/** A solid round stone: a short cylinder lofted from two rings and capped top and bottom. */
function disc(builder: GeometryBuilder | undefined, cx: number, y: number, cz: number, radius: number, thickness: number, segments = 14): void {
  if (!builder) return;
  const ring = (height: number): Vec3[] => Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: height, z: cz + Math.sin(angle) * radius };
  });
  const lower = ring(y);
  const upper = ring(y + thickness);
  builder.addLoft(lower, upper);
  builder.addFanUp({ x: cx, y: y + thickness, z: cz }, upper);
  builder.addFanDown({ x: cx, y, z: cz }, lower);
}

function beam(sink: GeometrySink, surface: SurfaceKey, stage: number, from: Vec3, to: Vec3, width: number): void {
  sink.at(surface, stage)?.addBeam(from, to, width, width);
}

/**
 * Working equipment: the fittings and machinery that say what happens inside.
 *
 * This is the layer that distinguishes a barn from a byre from a stable when all three are the
 * same timber frame: one has a threshing floor and a loft, one has mangers and stalls, one has
 * hitch rails and a tack room. Equipment is specified by the archetype stage and resolved by the
 * spec, so none of it is invented here.
 */
export function emitEquipment(context: EquipmentContext): void {
  const { spec } = context;
  for (const item of spec.equipment) emitEquipmentItem(context, item);
}

function emitEquipmentItem(context: EquipmentContext, item: FunctionalEquipment): void {
  const { sink, spec, frame, random } = context;
  const { halfWidth, halfDepth, plinthTop, wallTop } = frame;
  const t = Math.max(0.016, spec.wallThickness);
  const FIT = BUILD_STAGE.FITOUT;
  const UTIL = BUILD_STAGE.UTILITIES;
  const FIN = BUILD_STAGE.FINISH;
  const inner = halfDepth - t * 2;
  const height = wallTop - plinthTop;

  switch (item) {
    // ----- agriculture and livestock -----
    case 'hay-loft': {
      // A half-depth loft floor high in the roof space, with its access opening.
      const y = plinthTop + height * 0.72;
      box(sink, 'timber', FIT, 0, y, -halfDepth * 0.42, spec.width * 0.86, t * 0.8, spec.depth * 0.5);
      for (const x of [-spec.width * 0.3, spec.width * 0.3]) {
        box(sink, 'timber', FIT, x, plinthTop + height * 0.36, -halfDepth * 0.42, t * 1.2, height * 0.72, t * 1.2);
      }
      break;
    }
    case 'threshing-floor':
      // A hard boarded floor on the through-draught between the two big doors.
      box(sink, 'timber', FIT, 0, plinthTop + 0.008, 0, spec.width * 0.42, 0.016, spec.depth * 0.9);
      break;
    case 'grain-bin':
      for (let index = 0; index < 3; index += 1) {
        const x = -halfWidth * 0.6 + index * halfWidth * 0.6;
        box(sink, 'timber', FIT, x, plinthTop + height * 0.22, -inner * 0.6, spec.width * 0.17, height * 0.44, spec.depth * 0.22);
      }
      break;
    case 'manger':
      for (const z of [inner * 0.72, -inner * 0.72]) {
        box(sink, 'timber', FIT, 0, plinthTop + height * 0.17, z, spec.width * 0.82, height * 0.14, t * 2.4);
        box(sink, 'thatch', FIT, 0, plinthTop + height * 0.25, z, spec.width * 0.74, height * 0.05, t * 1.6);
      }
      break;
    case 'stall-divider': {
      const stalls = Math.max(2, Math.round(spec.width / 0.22));
      for (let index = 1; index < stalls; index += 1) {
        const x = -halfWidth + (spec.width * index) / stalls;
        box(sink, 'timber', FIT, x, plinthTop + height * 0.28, inner * 0.42, t * 0.8, height * 0.56, spec.depth * 0.42);
      }
      break;
    }
    case 'water-trough':
      box(sink, 'stone', FIT, halfWidth * 0.68, plinthTop + 0.035, halfDepth * 1.18, spec.width * 0.3, 0.07, t * 3);
      box(sink, 'water', FIT, halfWidth * 0.68, plinthTop + 0.062, halfDepth * 1.18, spec.width * 0.26, 0.012, t * 2.2);
      break;
    case 'hitch-rail':
      for (const x of [-spec.width * 0.26, spec.width * 0.26]) {
        box(sink, 'timber', FIN, x, plinthTop + height * 0.16, halfDepth * 1.3, t, height * 0.32, t);
      }
      box(sink, 'timber', FIN, 0, plinthTop + height * 0.27, halfDepth * 1.3, spec.width * 0.6, t * 0.7, t * 0.7);
      break;
    case 'bedding':
      box(sink, 'thatch', FIN, 0, plinthTop + 0.01, inner * 0.3, spec.width * 0.7, 0.02, spec.depth * 0.42);
      break;
    case 'pen-gate':
      for (const x of [-spec.width * 0.2, spec.width * 0.2]) {
        box(sink, 'timber', FIT, x, plinthTop + height * 0.17, halfDepth * 1.02, t, height * 0.34, t);
      }
      for (const y of [0.11, 0.22]) {
        box(sink, 'timber', FIT, 0, plinthTop + height * y, halfDepth * 1.02, spec.width * 0.4, t * 0.55, t * 0.5);
      }
      break;
    case 'fence-line': {
      // A post-and-rail run enclosing the yard in front of the structure.
      const run = spec.width * 1.5;
      for (let x = -run / 2; x <= run / 2 + 1e-6; x += run / 8) {
        box(sink, 'timber', FIN, x, 0.09, halfDepth * 1.7, t * 0.7, 0.18, t * 0.7);
      }
      for (const y of [0.07, 0.14]) box(sink, 'timber', FIN, 0, y, halfDepth * 1.7, run, t * 0.45, t * 0.4);
      break;
    }
    case 'wagon-apron':
      box(sink, 'ground', BUILD_STAGE.FOUNDATION, 0, 0.01, halfDepth * 1.5, spec.width * 1.1, 0.02, spec.depth * 0.6);
      break;

    // ----- handling -----
    case 'loading-platform':
      // A raised deck at floor level with its edge kerb: the building meets a cart here.
      box(sink, 'stone', BUILD_STAGE.FOUNDATION, 0, plinthTop * 0.5, halfDepth * 1.28, spec.width * 0.74, Math.max(0.04, plinthTop), spec.depth * 0.3);
      box(sink, 'timber', FIT, 0, plinthTop + 0.012, halfDepth * 1.28, spec.width * 0.74, 0.024, spec.depth * 0.3);
      break;
    case 'side-ramp':
      // An earth ramp to the upper floor: the thing that makes a bank barn a bank barn.
      box(sink, 'ground', BUILD_STAGE.FOUNDATION, halfWidth * 1.3, plinthTop * 0.6, 0, spec.width * 0.4, Math.max(0.05, plinthTop * 1.2), spec.depth * 0.5);
      break;
    case 'crate-stack':
      for (let index = 0; index < 3; index += 1) {
        const x = -halfWidth * 0.8 + index * 0.14;
        box(sink, 'timber', FIN, x, plinthTop + 0.05 + index * 0.02, halfDepth * 1.42, 0.1, 0.1, 0.1, random.range(-0.3, 0.3));
      }
      break;
    case 'cart-stand':
      box(sink, 'timber', FIN, -halfWidth * 1.1, plinthTop + 0.07, halfDepth * 1.1, 0.28, 0.035, 0.17);
      for (const dx of [-0.09, 0.09]) {
        box(sink, 'metal', FIN, -halfWidth * 1.1 + dx, plinthTop + 0.035, halfDepth * 1.1, 0.07, 0.07, 0.02);
      }
      break;
    case 'rail-track': {
      const run = spec.width * 1.6;
      for (const dz of [-0.05, 0.05]) {
        box(sink, 'metal', UTIL, 0, 0.012, halfDepth * 1.62 + dz, run, 0.012, 0.014);
      }
      for (let x = -run / 2; x <= run / 2; x += 0.1) {
        box(sink, 'timber', UTIL, x, 0.006, halfDepth * 1.62, 0.024, 0.01, 0.15);
      }
      break;
    }

    // ----- production -----
    case 'workbench':
      box(sink, 'timber', FIT, -halfWidth * 0.5, plinthTop + height * 0.2, -inner * 0.5, spec.width * 0.34, t * 0.9, spec.depth * 0.14);
      for (const dx of [-spec.width * 0.14, spec.width * 0.14]) {
        box(sink, 'timber', FIT, -halfWidth * 0.5 + dx, plinthTop + height * 0.1, -inner * 0.5, t * 0.8, height * 0.2, t * 0.8);
      }
      break;
    case 'forge':
      box(sink, 'stone', FIT, halfWidth * 0.52, plinthTop + height * 0.14, -inner * 0.52, spec.width * 0.2, height * 0.28, spec.depth * 0.18);
      box(sink, 'forge', FIT, halfWidth * 0.52, plinthTop + height * 0.2, -inner * 0.4, spec.width * 0.1, height * 0.08, 0.012);
      break;
    case 'kiln':
      // A beehive kiln: a battered masonry drum with a stoking mouth.
      box(sink, 'brick', FIT, -halfWidth * 0.62, plinthTop + height * 0.2, -inner * 0.55, spec.width * 0.22, height * 0.4, spec.depth * 0.22);
      box(sink, 'brick', FIT, -halfWidth * 0.62, plinthTop + height * 0.42, -inner * 0.55, spec.width * 0.14, height * 0.1, spec.depth * 0.14);
      box(sink, 'forge', FIT, -halfWidth * 0.62, plinthTop + height * 0.1, -inner * 0.42, spec.width * 0.08, height * 0.07, 0.012);
      break;
    case 'millstone':
      // The stone bed and runner, the heart of any mill. Both are round: a millstone is a disc.
      disc(sink.at('stone', FIT), 0, plinthTop + height * 0.1, -inner * 0.3, spec.width * 0.3, height * 0.08);
      disc(sink.at('stone', FIT), 0, plinthTop + height * 0.17, -inner * 0.3, spec.width * 0.24, height * 0.06);
      box(sink, 'timber', FIT, 0, plinthTop + height * 0.3, -inner * 0.3, t, height * 0.26, t);
      break;
    case 'waterwheel': {
      // A breast wheel on the gable wall, in its race. Nothing else reads as a watermill.
      const radius = Math.min(spec.depth * 0.42, height * 0.52);
      const cx = -halfWidth - radius * 0.42;
      const cy = plinthTop + radius * 0.75;
      // The wheel turns on its axle, which runs across the race: the X axis through the hub. Its
      // spokes, rim and paddles are one rotor so the motion system turns the whole wheel at once.
      const pivot = { x: cx, y: cy, z: 0 };
      const wheel = rotorBuilder(sink, 'Waterwheel', pivot, 'timber', UTIL, { axis: 'x', drive: 'water-wheel' });
      const spokes = 10;
      for (let index = 0; index < spokes; index += 1) {
        const angle = (index / spokes) * Math.PI * 2;
        const to = { x: cx, y: cy + Math.sin(angle) * radius, z: Math.cos(angle) * radius };
        wheel?.addBeam(pivot, to, t * 0.55, t * 0.55);
        // Paddle boards on the rim.
        wheel?.addBox(cx, cy + Math.sin(angle) * radius, Math.cos(angle) * radius, t * 2.6, t * 1.4, t * 1.1, angle);
      }
      rotorBuilder(sink, 'Waterwheel axle', pivot, 'metal', UTIL, { axis: 'x', drive: 'water-wheel' })?.addBox(cx, cy, 0, radius * 0.3, t * 1.1, t * 1.1);
      // The race the wheel sits in.
      box(sink, 'stone', BUILD_STAGE.FOUNDATION, cx, 0.03, 0, radius * 1.3, 0.06, radius * 1.1);
      box(sink, 'water', UTIL, cx, 0.05, 0, radius * 1.1, 0.014, radius * 0.8);
      break;
    }
    case 'windshaft': {
      // A sail cross on the cap, hub-and-arm just like the waterwheel's own radial pattern but
      // four long arms instead of ten short spokes — the one cue that makes a windmill read as a
      // windmill rather than a narrow tower with a pointed roof. Built entirely from beams, whose
      // orientation follows their own endpoints, so the lattice stays correctly planar without
      // leaning on addBox's Y-only rotation.
      // The whole cross is one rotor about the hub, which is where the motion system spins it.
      // Set 40% of the way up the cap, so the cross turns in the cap's upper body rather than floating
      // above a tall roof or sinking into a squat one.
      const hub = { x: 0, y: wallTop + (frame.roofTop - wallTop) * 0.4, z: halfDepth * 0.1 };
      const sails = rotorBuilder(sink, 'Windshaft sail cross', hub, 'timber', UTIL, { axis: 'z', drive: 'wind-sails' });
      const reach = Math.max(spec.width, spec.depth) * 1.4;
      for (let arm = 0; arm < 4; arm += 1) {
        const angle = (arm / 4) * Math.PI * 2 + Math.PI / 4;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        const perpX = -dirY;
        const perpY = dirX;
        const tip = { x: hub.x + dirX * reach, y: hub.y + dirY * reach, z: hub.z };
        sails?.addBeam(hub, tip, t * 0.7, t * 0.7);
        // A lattice bar across each sail, which is what reads as canvas-on-a-frame rather than a
        // bare spoke.
        const mid = { x: hub.x + dirX * reach * 0.68, y: hub.y + dirY * reach * 0.68, z: hub.z };
        const half = reach * 0.22;
        sails?.addBeam(
          { x: mid.x - perpX * half, y: mid.y - perpY * half, z: mid.z },
          { x: mid.x + perpX * half, y: mid.y + perpY * half, z: mid.z },
          t * 0.45, t * 0.45);
      }
      sails?.addBox(hub.x, hub.y, hub.z, t * 1.6, t * 1.6, t * 1.6);
      break;
    }
    case 'pump-rod': {
      // The drive rod that carries the sail's crank down the body to a cylinder at the foot: how a
      // wind pump lifted water rather than turning a stone.
      beam(sink, 'timber', UTIL, { x: 0, y: wallTop + height * 0.3, z: 0 }, { x: 0, y: plinthTop + height * 0.12, z: 0 }, t * 0.9);
      box(sink, 'metal', UTIL, 0, plinthTop + height * 0.1, 0, spec.width * 0.16, t * 1.2, spec.width * 0.16);
      box(sink, 'metal', UTIL, 0, wallTop + height * 0.3, 0, t * 2.4, t * 0.5, t * 0.5);
      break;
    }
    case 'saw-carriage': {
      // A log carriage on rails along the depth, with the saw frame and blade standing over it.
      // The carriage is the shop's long axis: it is what makes a sawmill a sawmill from outside.
      const run = spec.depth * 0.8;
      for (const x of [-spec.width * 0.12, spec.width * 0.12]) {
        box(sink, 'metal', UTIL, x, plinthTop + 0.02, 0, t * 0.6, 0.03, run);
      }
      box(sink, 'timber', FIT, 0, plinthTop + 0.07, 0, spec.width * 0.26, 0.05, run * 0.9);
      for (const x of [-spec.width * 0.13, spec.width * 0.13]) {
        box(sink, 'metal', FIT, x, plinthTop + height * 0.36, 0, t * 0.6, height * 0.7, t * 0.6);
      }
      box(sink, 'metal', FIT, 0, plinthTop + height * 0.7, 0, spec.width * 0.3, t * 0.6, t * 0.6);
      // The blade: a thin plate standing across the bed.
      box(sink, 'metal', FIT, 0, plinthTop + height * 0.4, 0, 0.012, height * 0.5, spec.width * 0.2);
      break;
    }
    case 'line-shaft': {
      // An overhead shaft on hangers with its pulleys: how a powered shop was powered.
      const y = plinthTop + height * 0.78;
      box(sink, 'metal', UTIL, 0, y, 0, spec.width * 0.88, t * 0.6, t * 0.6);
      for (let index = 0; index < 4; index += 1) {
        const x = -halfWidth * 0.68 + index * (spec.width * 0.34);
        box(sink, 'metal', UTIL, x, y, 0, t * 0.5, t * 1.7, t * 1.7);
        box(sink, 'metal', UTIL, x, y + t * 1.4, 0, t * 0.5, t * 1.4, t * 0.5);
      }
      break;
    }
    case 'machine-tool':
      for (let index = 0; index < 2; index += 1) {
        const x = -halfWidth * 0.45 + index * halfWidth * 0.9;
        box(sink, 'metal', FIT, x, plinthTop + height * 0.14, inner * 0.18, spec.width * 0.17, height * 0.28, spec.depth * 0.16);
        box(sink, 'metal', FIT, x, plinthTop + height * 0.3, inner * 0.18, spec.width * 0.08, height * 0.08, spec.depth * 0.08);
      }
      break;
    case 'conveyor': {
      const y = plinthTop + height * 0.3;
      box(sink, 'metal', FIT, 0, y, inner * 0.55, spec.width * 0.9, t * 1.2, spec.depth * 0.14);
      for (let index = 0; index < 5; index += 1) {
        const x = -halfWidth * 0.8 + index * (spec.width * 0.4);
        box(sink, 'metal', FIT, x, y - height * 0.15, inner * 0.55, t * 0.6, height * 0.3, t * 0.6);
      }
      break;
    }
    case 'gantry-crane': {
      // A portal gantry spanning the bay, with its trolley.
      const y = wallTop - t * 2;
      for (const x of [-halfWidth * 0.86, halfWidth * 0.86]) {
        box(sink, 'metal', UTIL, x, plinthTop + (y - plinthTop) * 0.5, 0, t * 1.4, y - plinthTop, t * 1.4);
      }
      box(sink, 'metal', UTIL, 0, y, 0, spec.width * 1.76, t * 1.6, t * 1.8);
      box(sink, 'metal', UTIL, spec.width * 0.1, y - t * 1.6, 0, spec.width * 0.14, t * 1.8, spec.depth * 0.12);
      break;
    }
    case 'silo-chute': {
      // A vertical bin with its discharge chute: grain leaves a silo sideways and downward.
      const cx = halfWidth + spec.width * 0.17;
      box(sink, 'panel', UTIL, cx, plinthTop + height * 0.55, 0, spec.width * 0.28, height * 1.1, spec.width * 0.28);
      box(sink, 'panel', UTIL, cx, plinthTop + height * 1.14, 0, spec.width * 0.2, height * 0.08, spec.width * 0.2);
      beam(sink, 'metal', UTIL,
        { x: cx, y: plinthTop + height * 0.2, z: 0 },
        { x: cx - spec.width * 0.3, y: plinthTop + height * 0.06, z: halfDepth * 0.7 }, t * 1.3);
      break;
    }
    case 'pipework': {
      const y = plinthTop + height * 0.62;
      box(sink, 'metal', UTIL, 0, y, halfDepth * 1.08, spec.width * 0.8, t * 1.1, t * 1.1);
      for (const x of [-spec.width * 0.3, spec.width * 0.3]) {
        box(sink, 'metal', UTIL, x, plinthTop + height * 0.3, halfDepth * 1.08, t * 1.1, height * 0.64, t * 1.1);
      }
      break;
    }
    case 'transformer':
      box(sink, 'metal', UTIL, -halfWidth * 1.22, plinthTop + height * 0.16, -halfDepth * 0.5, spec.width * 0.2, height * 0.32, spec.depth * 0.2);
      for (const dx of [-0.03, 0.03]) {
        box(sink, 'metal', UTIL, -halfWidth * 1.22 + dx, plinthTop + height * 0.36, -halfDepth * 0.5, 0.02, height * 0.08, 0.02);
      }
      break;

    // ----- exchange -----
    case 'market-stall': {
      const stalls = Math.max(2, Math.round(spec.width / 0.34));
      for (let index = 0; index < stalls; index += 1) {
        const x = -halfWidth + (spec.width * (index + 0.5)) / stalls;
        box(sink, 'timber', FIT, x, plinthTop + height * 0.16, halfDepth * 1.22, spec.width / stalls * 0.7, height * 0.04, spec.depth * 0.2);
        for (const dx of [-0.4, 0.4]) {
          box(sink, 'timber', FIT, x + (spec.width / stalls) * dx, plinthTop + height * 0.1, halfDepth * 1.22, t * 0.7, height * 0.2, t * 0.7);
        }
        box(sink, 'cloth', FIN, x, plinthTop + height * 0.34, halfDepth * 1.22, spec.width / stalls * 0.82, 0.012, spec.depth * 0.24);
      }
      break;
    }
    case 'awning':
      box(sink, 'cloth', FIN, 0, wallTop - height * 0.12, halfDepth * 1.2, spec.width * 0.9, 0.012, spec.depth * 0.26);
      break;
    case 'counter':
      box(sink, 'timber', FIT, 0, plinthTop + height * 0.16, halfDepth * 0.82, spec.width * 0.66, height * 0.32, t * 2.6);
      break;
    case 'arcade': {
      // A columned walk along the entrance face — the market's and the basilica's real front.
      const columns = Math.max(3, frame.bayLines.length);
      const reach = halfDepth + spec.depth * 0.2;
      for (let index = 0; index < columns; index += 1) {
        const x = -halfWidth + (spec.width * index) / (columns - 1);
        box(sink, 'stone', BUILD_STAGE.FRAME, x, plinthTop + height * 0.46, reach, t * 2.1, height * 0.92, t * 2.1);
        box(sink, 'stone', BUILD_STAGE.FRAME, x, plinthTop + height * 0.94, reach, t * 2.8, height * 0.06, t * 2.8);
        box(sink, 'stone', BUILD_STAGE.FOUNDATION, x, plinthTop * 0.5 + 0.01, reach, t * 2.9, Math.max(0.02, plinthTop), t * 2.9);
      }
      box(sink, 'stone', BUILD_STAGE.FRAME, 0, plinthTop + height, reach, spec.width + t * 3, height * 0.08, t * 2.6);
      break;
    }

    // ----- maritime -----
    case 'quay-bollard':
      for (const x of [-halfWidth * 0.6, 0, halfWidth * 0.6]) {
        box(sink, 'metal', FIN, x, plinthTop + 0.035, halfDepth * 1.4, 0.05, 0.07, 0.05);
      }
      break;
    case 'slipway':
      box(sink, 'stone', BUILD_STAGE.FOUNDATION, 0, 0.02, halfDepth * 1.8, spec.width * 0.5, 0.04, spec.depth * 0.9);
      break;

    // ----- defence -----
    case 'gate-leaf':
      for (const side of [-1, 1]) {
        box(sink, 'timber', FIT, side * spec.width * 0.14, plinthTop + height * 0.3, halfDepth * 1.02,
          spec.width * 0.26, height * 0.6, t * 0.7);
      }
      break;
    case 'portcullis':
      box(sink, 'metal', FIT, 0, plinthTop + height * 0.34, halfDepth * 0.92, spec.width * 0.42, height * 0.66, t * 0.5);
      for (let x = -spec.width * 0.2; x <= spec.width * 0.2; x += spec.width * 0.07) {
        box(sink, 'metal', FIT, x, plinthTop + height * 0.34, halfDepth * 0.94, t * 0.3, height * 0.66, t * 0.3);
      }
      break;
    case 'battlement': {
      // Merlons and embrasures round the wall head.
      const step = Math.max(0.08, spec.width / 7);
      for (let x = -halfWidth + step * 0.5; x < halfWidth; x += step) {
        for (const z of [halfDepth, -halfDepth]) {
          box(sink, 'stone', BUILD_STAGE.ROOF, x, wallTop + height * 0.07, z, step * 0.55, height * 0.14, t * 1.4);
        }
      }
      break;
    }
    case 'watch-platform': {
      const y = wallTop + height * 0.04;
      box(sink, 'timber', BUILD_STAGE.ROOF, 0, y, -halfDepth * 0.5, spec.width * 0.4, t * 0.9, spec.depth * 0.3);
      for (const dx of [-spec.width * 0.17, spec.width * 0.17]) {
        box(sink, 'timber', BUILD_STAGE.ROOF, dx, y + height * 0.08, -halfDepth * 0.5, t * 0.7, height * 0.16, t * 0.7);
      }
      break;
    }

    // ----- services -----
    case 'hearth':
      box(sink, 'stone', FIT, 0, plinthTop + 0.02, -inner * 0.45, spec.width * 0.2, 0.04, spec.width * 0.2);
      box(sink, 'forge', FIT, 0, plinthTop + 0.045, -inner * 0.45, spec.width * 0.1, 0.012, spec.width * 0.1);
      break;
    case 'ridge-vent':
      box(sink, 'metal', UTIL, 0, wallTop + height * 0.02, 0, spec.width * 0.5, height * 0.05, t * 2.2);
      break;
    case 'louver-vent':
      for (const z of [halfDepth, -halfDepth]) {
        for (const x of [-spec.width * 0.28, spec.width * 0.28]) {
          box(sink, 'metal', UTIL, x, wallTop - height * 0.14, z, spec.width * 0.12, height * 0.1, t * 0.6);
        }
      }
      break;

    // Equipment with no distinct geometry of its own: already expressed by the shell, the
    // grammar's chimney/vent counts, or another listed item.
    case 'chimney':
      break;
  }
}

// ---------------------------------------------------------------------------- entry point

/**
 * Emit everything the spec adds on top of the composed shell.
 *
 * Called once per structure, after the shell exists, so assembly character and equipment sit on
 * a building that is already massed and roofed.
 */
export function emitSpecGeometry(
  sink: GeometrySink,
  spec: BuildingSpec,
  plinthTop: number,
  wallTop: number,
  seed: string,
  roofTop?: number,
): void {
  const frame = structureFrame(spec, plinthTop, wallTop, roofTop);
  const random = new SeededRandom(`${seed}:spec-geometry`);
  emitFoundation(sink, spec, frame);
  emitWallAssembly(sink, spec, frame);
  emitOpenBays(sink, spec, frame);
  emitAnnexes(sink, spec, frame, random);
  emitEquipment({ sink, spec, frame, random });
}
