/**
 * DedicatedStructures.ts
 *
 * The structures that are not buildings.
 *
 * A bridge and a perimeter wall have no storeys, no roof and no interior, and composing them as
 * a walled box with the roof switched off produces a box, not a crossing. These therefore replace
 * the building shell entirely. A quay is the intermediate case: it *is* partly a building, so it
 * keeps its shed and gains the works that make it a quay. A memorial is the other extreme: a
 * ceremonial composition with no shell at all, driven by who is buried there rather than by a
 * structural specification.
 *
 * This module is the single owner of every exception. Geometry that cannot be expressed by the
 * shared structural vocabulary belongs here and nowhere else — the composer's job is to call it
 * through one guarded branch, not to grow a special case per archetype. DEDICATED_COMPOSITIONS is
 * the registry the catalogue reads, so a composition with no archetype behind it is a validation
 * failure rather than quietly unreachable code.
 *
 * Within an exception the structural family still decides everything. A medieval stone bridge is
 * an arcade of arch rings on cutwater piers; a timber one is a trestle; an industrial one is a
 * riveted truss. None of that is per-archetype special-casing — it is the same material and span
 * logic the rest of the architecture system uses, applied to a form that is not a house.
 */

import * as THREE from 'three';
import { BUILD_STAGE } from '../assets/BuildStages';
import { squareRing } from '../assets/GeometryBuilder';
import type { SurfaceKey } from '../materials/MaterialPalette';
import { SeededRandom } from '../../sim/prng';
import type { MemorialSite } from '../../sim/development/types';
import type { BuildingArchetype } from './BuildingArchetype';
import type { BuildingSpec } from './BuildingSpec';
import { architecturalMaterial } from './MaterialLibrary';
import { emitEquipment, structureFrame, type GeometrySink } from './StructureGeometry';
import { composeMill } from './MillArchitecture';

/** What a dedicated composition reports back, matching the composer's own return shape. */
export interface DedicatedComposition {
  height: number;
  extentX: number;
  extentZ: number;
  /**
   * The built mass the renderer fits to a plot, when it differs from the reserved site extent.
   * Only compositions whose site genuinely exceeds their building declare it — a mill and its
   * water engineering. Left out, the composer measures the mass from the geometry instead.
   */
  massX?: number;
  massZ?: number;
}

/** How a span is carried, derived from what the structure is actually made of. */
type SpanSystem = 'log' | 'trestle' | 'arch' | 'truss' | 'girder';

/**
 * The span system a structure's own materials imply.
 *
 * Span capacity is already in the material library, so this reads it rather than keying on era:
 * a settlement that builds in dressed stone gets arches, one with rolled steel gets a truss.
 */
function spanSystemFor(spec: BuildingSpec): SpanSystem {
  const frame = architecturalMaterial(spec.materials.frame);
  const family = frame.family;
  if (family === 'metal' && frame.structure.span >= 0.8) return 'truss';
  if (family === 'binder' && spec.materials.frame === 'reinforced-concrete') return 'girder';
  if (family === 'stone' || family === 'ceramic') return 'arch';
  if (family === 'metal') return 'truss';
  // Timber: a worked frame makes a trestle, the roughest construction only a log beam.
  return frame.structure.span >= 0.38 ? 'trestle' : 'log';
}

export function bridgeSpanSystem(spec: BuildingSpec): SpanSystem {
  return spanSystemFor(spec);
}

// ---------------------------------------------------------------------------- bridge

/**
 * A crossing.
 *
 * Abutments at both banks, intermediate supports whose count follows the frame's real span
 * capacity, the span system itself, a deck, and a parapet or railing in the trim material.
 */
export function composeBridge(sink: GeometrySink, spec: BuildingSpec, seed: string): DedicatedComposition {
  const random = new SeededRandom(`${seed}:bridge`);
  const length = spec.width;
  const halfLength = length / 2;
  const width = Math.max(0.28, spec.depth);
  const halfWidth = width / 2;
  const t = Math.max(0.02, spec.wallThickness);
  const system = spanSystemFor(spec);

  // Deck height follows the span system: an arch has to rise, a girder does not.
  const deckY = Math.max(0.16, spec.storeyHeight * (system === 'arch' ? 0.95 : 0.7));
  const FOUND = BUILD_STAGE.FOUNDATION;
  const FRAME = BUILD_STAGE.FRAME;
  const DECK = BUILD_STAGE.WALLS;
  const RAIL = BUILD_STAGE.FITOUT;

  const pier = (x: number, height: number): void => {
    // Cutwaters: the wedge that splits the current, and the clearest read of a river pier.
    sink.at('stone', FOUND)?.addBox(x, height * 0.5, 0, t * 3.4, height, width * 1.05);
    sink.at('stone', FOUND)?.addBox(x, height * 0.42, width * 0.6, t * 2.4, height * 0.84, width * 0.2);
    sink.at('stone', FOUND)?.addBox(x, height * 0.42, -width * 0.6, t * 2.4, height * 0.84, width * 0.2);
  };

  // Abutments at each bank, which is where a bridge meets the ground.
  for (const side of [-1, 1]) {
    sink.at('stone', FOUND)?.addBox(side * (halfLength + t * 2), deckY * 0.5, 0, t * 5, deckY, width * 1.2);
  }

  // How many intermediate supports the frame material needs to cross this.
  const reach = Math.max(0.3, architecturalMaterial(spec.materials.frame).structure.span * 1.9);
  const spans = Math.max(1, Math.ceil(length / reach));
  const supports: number[] = [];
  for (let index = 1; index < spans; index += 1) supports.push(-halfLength + (length * index) / spans);

  switch (system) {
    case 'log': {
      // Two trunks and a brushwood deck. No piers: it is laid, not built.
      for (const dz of [-halfWidth * 0.5, halfWidth * 0.5]) {
        sink.at('timber', FRAME)?.addBox(0, deckY - t, dz, length, t * 2, t * 2);
      }
      break;
    }
    case 'trestle': {
      // Braced timber trestles under a beam deck.
      for (const x of supports) {
        for (const dz of [-halfWidth * 0.8, halfWidth * 0.8]) {
          sink.at('timber', FRAME)?.addBox(x, deckY * 0.5, dz, t * 1.3, deckY, t * 1.3);
        }
        sink.at('timber', FRAME)?.addBox(x, deckY * 0.9, 0, t * 1.1, t * 1.1, width * 1.6);
        for (const dz of [-1, 1]) {
          sink.at('timber', FRAME)?.addBeam(
            { x, y: 0, z: dz * halfWidth * 0.8 },
            { x: x + t * 3, y: deckY * 0.85, z: 0 }, t * 0.8, t * 0.8);
        }
      }
      for (const dz of [-halfWidth * 0.7, halfWidth * 0.7]) {
        sink.at('timber', FRAME)?.addBox(0, deckY - t * 0.8, dz, length, t * 1.5, t * 1.5);
      }
      break;
    }
    case 'arch': {
      // Semicircular rings between the piers: the span *is* the structure.
      for (const x of supports) pier(x, deckY * 0.72);
      const edges = [-halfLength, ...supports, halfLength];
      for (let index = 0; index < edges.length - 1; index += 1) {
        const from = edges[index]!;
        const to = edges[index + 1]!;
        const span = to - from;
        const centre = (from + to) / 2;
        const rise = Math.min(deckY * 0.62, span * 0.42);
        // Voussoirs stepped round the ring, which reads as masonry rather than as a tube.
        const segments = Math.max(7, Math.round(span / Math.max(0.05, t * 2)));
        for (let step = 0; step <= segments; step += 1) {
          const angle = Math.PI * (step / segments);
          const vx = centre - Math.cos(angle) * (span / 2 - t);
          const vy = deckY - rise + Math.sin(angle) * rise;
          sink.at('stone', FRAME)?.addBox(vx, vy, 0, t * 1.5, t * 1.5, width * 1.02, -angle);
        }
        // Spandrel fill above the ring haunches.
        for (const dx of [-1, 1]) {
          sink.at('stone', DECK)?.addBox(centre + dx * span * 0.36, deckY - rise * 0.28, 0,
            span * 0.24, rise * 0.56, width);
        }
      }
      break;
    }
    case 'truss': {
      // Through-truss sides with verticals and alternating diagonals.
      for (const x of supports) pier(x, deckY * 0.8);
      const trussHeight = Math.max(deckY * 0.8, spec.storeyHeight * 0.9);
      const panels = Math.max(4, Math.round(length / Math.max(0.1, t * 9)));
      for (const dz of [-halfWidth, halfWidth]) {
        sink.at('metal', FRAME)?.addBox(0, deckY + trussHeight, dz, length, t * 1.3, t * 1.1);
        sink.at('metal', FRAME)?.addBox(0, deckY, dz, length, t * 1.3, t * 1.1);
        for (let index = 0; index <= panels; index += 1) {
          const x = -halfLength + (length * index) / panels;
          sink.at('metal', FRAME)?.addBox(x, deckY + trussHeight * 0.5, dz, t * 1.1, trussHeight, t * 1.1);
          if (index === panels) continue;
          const nextX = -halfLength + (length * (index + 1)) / panels;
          const rising = index % 2 === 0;
          sink.at('metal', FRAME)?.addBeam(
            { x, y: rising ? deckY : deckY + trussHeight, z: dz },
            { x: nextX, y: rising ? deckY + trussHeight : deckY, z: dz },
            t * 0.9, t * 0.9);
        }
      }
      // Portal bracing over the deck at both ends.
      for (const side of [-1, 1]) {
        sink.at('metal', FRAME)?.addBox(side * halfLength, deckY + trussHeight, 0, t * 1.4, t * 1.4, width * 2);
      }
      break;
    }
    case 'girder': {
      // Deep plate girders on blade piers: a modern span reads as a continuous beam.
      for (const x of supports) {
        sink.at('panel', FOUND)?.addBox(x, deckY * 0.5, 0, t * 2.6, deckY, width * 0.5);
      }
      for (const dz of [-halfWidth * 0.8, halfWidth * 0.8]) {
        sink.at('panel', FRAME)?.addBox(0, deckY - t * 2, dz, length, t * 4, t * 1.6);
      }
      break;
    }
  }

  // The deck, in the floor-bearing material, and its edge.
  const deckSurface = system === 'arch' ? 'stone' : system === 'log' || system === 'trestle' ? 'timber' : 'panel';
  sink.at(deckSurface, DECK)?.addBox(0, deckY + t * 0.5, 0, length + t * 4, t, width * 2);

  // Parapet or railing: masonry gets a solid wall, everything else gets posts and a rail.
  if (system === 'arch' || system === 'girder') {
    for (const dz of [-1, 1]) {
      sink.at(system === 'arch' ? 'stone' : 'panel', RAIL)?.addBox(
        0, deckY + t * 2.2, dz * (width + t), length + t * 4, t * 3.4, t * 1.2);
    }
  } else {
    for (const dz of [-1, 1]) {
      const z = dz * (width + t);
      sink.at('timber', RAIL)?.addBox(0, deckY + t * 3.2, z, length, t * 0.9, t * 0.9);
      for (let x = -halfLength + t * 3; x <= halfLength; x += t * 7) {
        sink.at('timber', RAIL)?.addBox(x, deckY + t * 1.8, z, t * 0.8, t * 3.4, t * 0.8);
      }
    }
  }

  // Approach ramps, so the deck does not simply stop in mid-air.
  for (const side of [-1, 1]) {
    sink.at('ground', FOUND)?.addBox(side * (halfLength + t * 6), deckY * 0.45, 0, t * 9, deckY * 0.9, width * 1.3);
  }
  random.float();

  const trussExtra = system === 'truss' ? Math.max(deckY * 0.8, spec.storeyHeight * 0.9) : 0;
  return {
    height: deckY + t * 4 + trussExtra,
    extentX: length + t * 14,
    extentZ: width * 2 + t * 4,
  };
}

// ---------------------------------------------------------------------------- boundary wall

/**
 * A perimeter.
 *
 * A run of wall with a gate in it, built the way the settlement builds: close-set stakes, a
 * mortared curtain with a wall walk and merlons, or a panel fence on posts.
 */
export function composeBoundaryWall(sink: GeometrySink, spec: BuildingSpec, seed: string): DedicatedComposition {
  const random = new SeededRandom(`${seed}:boundary`);
  const length = spec.width;
  const halfLength = length / 2;
  const t = Math.max(0.02, spec.wallThickness);
  const height = Math.max(0.2, spec.storeyHeight);
  const family = architecturalMaterial(spec.materials.wall).family;
  const palisade = family === 'timber' || family === 'organic';
  const masonry = family === 'stone' || family === 'ceramic' || family === 'binder';

  const FOUND = BUILD_STAGE.FOUNDATION;
  const BUILD = BUILD_STAGE.WALLS;
  const TOP = BUILD_STAGE.ROOF;

  // The gate opening is left out of the run rather than drawn over it.
  const gateWidth = Math.max(t * 6, length * 0.16);
  const gateFrom = -gateWidth / 2;
  const gateTo = gateWidth / 2;

  // Footing trench along the whole line, including under the gate threshold.
  sink.at('stone', FOUND)?.addBox(0, t * 0.6, 0, length, t * 1.2, t * 2.6);

  if (palisade) {
    // Close-set sharpened stakes with two horizontal wales behind them.
    const step = t * 1.15;
    for (let x = -halfLength; x <= halfLength; x += step) {
      if (x > gateFrom && x < gateTo) continue;
      const jitter = random.range(-0.012, 0.012);
      sink.at('timber', BUILD)?.addBox(x, height * 0.5 + jitter, 0, t, height, t);
      sink.at('timber', TOP)?.addBox(x, height + t * 0.6 + jitter, 0, t * 0.7, t * 1.2, t * 0.7);
    }
    for (const y of [height * 0.35, height * 0.75]) {
      for (const segment of [[-halfLength, gateFrom], [gateTo, halfLength]] as const) {
        const run = segment[1] - segment[0];
        if (run <= 0) continue;
        sink.at('timber', BUILD)?.addBox((segment[0] + segment[1]) / 2, y, -t * 0.9, run, t * 0.7, t * 0.6);
      }
    }
  } else {
    // A built wall: two segments either side of the gate, in the wall material.
    const surface = masonry ? 'stone' : 'panel';
    for (const segment of [[-halfLength, gateFrom], [gateTo, halfLength]] as const) {
      const run = segment[1] - segment[0];
      if (run <= 0) continue;
      const centre = (segment[0] + segment[1]) / 2;
      sink.at(surface, BUILD)?.addBox(centre, height * 0.5, 0, run, height, t * 2.2);
      if (masonry) {
        // A wall walk behind the parapet, and merlons along it.
        sink.at(surface, TOP)?.addBox(centre, height + t * 0.4, -t * 1.6, run, t * 0.8, t * 2.4);
        const step = Math.max(t * 3, run / Math.max(2, Math.round(run / (t * 4))));
        for (let x = segment[0] + step * 0.5; x < segment[1]; x += step) {
          sink.at(surface, TOP)?.addBox(x, height + t * 1.4, 0, step * 0.55, t * 2, t * 2.2);
        }
      } else {
        // A panel fence shows its posts and its top rail.
        for (let x = segment[0]; x <= segment[1]; x += t * 8) {
          sink.at('metal', BUILD)?.addBox(x, height * 0.5, 0, t * 1.2, height * 1.06, t * 1.2);
        }
        sink.at('metal', TOP)?.addBox(centre, height * 1.02, 0, run, t * 0.8, t * 1.4);
      }
    }
  }

  // Gate piers and a lintel, which is what makes the gap read as a gate rather than a breach.
  const pierSurface = palisade ? 'timber' : masonry ? 'stone' : 'metal';
  for (const x of [gateFrom, gateTo]) {
    sink.at(pierSurface, BUILD)?.addBox(x, height * 0.56, 0, t * 2, height * 1.12, t * 2.6);
  }
  sink.at(pierSurface, BUILD)?.addBox(0, height * 1.12, 0, gateWidth + t * 2, t * 1.4, t * 2.6);

  const extentZ = Math.max(t * 6, spec.depth);
  return { height: height * 1.2 + t * 2, extentX: length + t * 4, extentZ };
}

// ---------------------------------------------------------------------------- animal pen

/**
 * An open enclosure.
 *
 * An animal pen is not a building with the roof switched off — it is a fence, a gate and a yard,
 * with at most a small shelter in one corner. The shared composer has no notion of "mostly
 * absent", so this replaces the shell outright the same way a bridge or a boundary wall does, and
 * leans on the structure's own equipment list (`pen-gate`, `water-trough`, `manger`, `bedding`)
 * for everything inside the fence rather than drawing any of that again.
 */
export function composeAnimalPen(sink: GeometrySink, spec: BuildingSpec, seed: string): DedicatedComposition {
  const random = new SeededRandom(`${seed}:animal-pen`);
  const halfWidth = spec.width / 2;
  const halfDepth = spec.depth / 2;
  const t = Math.max(0.016, spec.wallThickness);
  // Stock fencing, not a defensive wall: a fraction of a storey is already taller than any animal
  // needs to be kept in.
  const fenceHeight = Math.max(0.1, spec.storeyHeight * 0.5);
  const family = architecturalMaterial(spec.materials.wall).family;
  const palisade = family === 'timber' || family === 'organic';
  const masonry = family === 'stone' || family === 'ceramic' || family === 'binder';
  const postSurface: SurfaceKey = palisade ? 'timber' : masonry ? 'stone' : 'metal';

  const BUILD = BUILD_STAGE.WALLS;

  // The gate gap matches the width the 'pen-gate' equipment item itself draws its leaf across, so
  // the fence run and the gate leaf line up without this module knowing the leaf's own geometry.
  const gateWidth = Math.max(t * 6, spec.width * 0.4);
  const gateFrom = -gateWidth / 2;
  const gateTo = gateWidth / 2;

  // A trodden yard rather than a raised foundation — the ground itself is the floor.
  sink.at('ground', BUILD_STAGE.FOUNDATION)?.addBox(0, 0.01, 0, spec.width * 1.04, 0.02, spec.depth * 1.04);

  const runSegment = (axis: 'x' | 'z', fixed: number, from: number, to: number): void => {
    const run = to - from;
    if (run <= 0) return;
    const centre = (from + to) / 2;
    const at = (pos: number): { x: number; z: number } =>
      axis === 'x' ? { x: pos, z: fixed } : { x: fixed, z: pos };

    if (masonry) {
      const { x, z } = at(centre);
      sink.at('stone', BUILD)?.addBox(
        x, fenceHeight * 0.5, z,
        axis === 'x' ? run : t * 2, fenceHeight, axis === 'x' ? t * 2 : run,
      );
      return;
    }

    // Palisade or panel fence: posts along the run, with one or two horizontal rails.
    const step = palisade ? t * 1.3 : t * 9;
    for (let pos = from; pos <= to + 1e-6; pos += step) {
      const jitter = palisade ? random.range(-0.012, 0.012) : 0;
      const { x, z } = at(pos);
      sink.at(postSurface, BUILD)?.addBox(x, fenceHeight * 0.5 + jitter, z, t, fenceHeight, t);
    }
    const { x, z } = at(centre);
    const rails = palisade ? [fenceHeight * 0.35, fenceHeight * 0.74] : [fenceHeight * 0.92];
    for (const y of rails) {
      sink.at(postSurface, BUILD)?.addBox(
        x, y, z,
        axis === 'x' ? run : t * 0.6, t * 0.5, axis === 'x' ? t * 0.6 : run,
      );
    }
  };

  // Entrance face carries the gate gap; the other three sides are a closed run.
  runSegment('z', halfDepth, -halfWidth, gateFrom);
  runSegment('z', halfDepth, gateTo, halfWidth);
  runSegment('z', -halfDepth, -halfWidth, halfWidth);
  runSegment('x', halfWidth, -halfDepth, halfDepth);
  runSegment('x', -halfWidth, -halfDepth, halfDepth);

  // An optional small shelter in one corner, kept subordinate to the yard: a roof on posts, no
  // walls of its own, so the fence and the open ground still read as the structure.
  let shelterHeight = 0;
  if (spec.annexes > 0) {
    const sx = spec.width * 0.32;
    const sz = spec.depth * 0.32;
    const cx = halfWidth - sx * 0.6;
    const cz = -halfDepth + sz * 0.6;
    const postHeight = fenceHeight * 1.7;
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        sink.at('timber', BUILD_STAGE.FRAME)?.addBox(
          cx + dx * sx * 0.42, postHeight * 0.5, cz + dz * sz * 0.42, t * 1.1, postHeight, t * 1.1,
        );
      }
    }
    sink.at('thatch', BUILD_STAGE.ROOF)?.addBox(cx, postHeight + t * 0.5, cz, sx, t * 1.1, sz);
    shelterHeight = postHeight + t;
  }

  // Everything that happens inside the fence — gate leaf, troughs, mangers, bedding — is the
  // structure's own equipment, reused verbatim. `fence-line` is excluded because the perimeter
  // above already is the real fence; forwarding it too would draw a second, disconnected run.
  const frame = structureFrame(spec, 0, fenceHeight);
  emitEquipment({
    sink,
    spec: { ...spec, equipment: spec.equipment.filter(item => item !== 'fence-line') },
    frame,
    random,
  });

  return {
    height: Math.max(fenceHeight, shelterHeight),
    extentX: spec.width + t * 4,
    extentZ: spec.depth + t * 4,
  };
}

// ---------------------------------------------------------------------------- quay works

/**
 * The works that make a waterside freight building a quay.
 *
 * Added to the ordinary shell rather than replacing it, because a dock genuinely is part shed:
 * the simulation built a freight store, and it happens to stand on water.
 */
export function emitQuayWorks(sink: GeometrySink, spec: BuildingSpec, plinthTop: number, seed: string): void {
  const random = new SeededRandom(`${seed}:quay`);
  const halfWidth = spec.width / 2;
  const halfDepth = spec.depth / 2;
  const t = Math.max(0.02, spec.wallThickness);
  const family = architecturalMaterial(spec.materials.foundation).family;
  const timberQuay = family === 'timber';

  const FOUND = BUILD_STAGE.FOUNDATION;
  const DECK = BUILD_STAGE.WALLS;

  // The water's edge sits in front of the shed; the quay reaches out over it.
  const edgeZ = halfDepth * 1.5;
  const reach = spec.depth * 0.9;

  if (timberQuay) {
    // A timber jetty on driven piles.
    for (let x = -halfWidth; x <= halfWidth; x += Math.max(0.08, spec.width / 6)) {
      for (const dz of [edgeZ + reach * 0.25, edgeZ + reach * 0.7]) {
        sink.at('timber', FOUND)?.addBox(x, plinthTop * 0.4, dz, t * 1.2, Math.max(0.1, plinthTop * 1.4), t * 1.2);
      }
    }
    sink.at('timber', DECK)?.addBox(0, plinthTop + t * 0.5, edgeZ + reach * 0.5, spec.width * 1.05, t, reach);
  } else {
    // A built quay wall with a coping course.
    sink.at('stone', FOUND)?.addBox(0, plinthTop * 0.5, edgeZ, spec.width * 1.2, Math.max(0.1, plinthTop * 1.3), t * 3);
    sink.at('stone', DECK)?.addBox(0, plinthTop + t * 0.5, edgeZ + reach * 0.3, spec.width * 1.2, t, reach * 0.6);
    sink.at('stone', DECK)?.addBox(0, plinthTop + t * 1.1, edgeZ + reach * 0.6, spec.width * 1.2, t * 0.6, t * 1.6);
  }

  // Open water beyond the edge, so the structure reads as waterside rather than inland.
  sink.at('glow', FOUND)?.addBox(0, 0.012, edgeZ + reach * 1.3, spec.width * 1.8, 0.02, reach * 0.9);

  // Mooring rings along the edge.
  for (const x of [-halfWidth * 0.7, 0, halfWidth * 0.7]) {
    sink.at('metal', BUILD_STAGE.FITOUT)?.addBox(x, plinthTop + t * 1.6, edgeZ + reach * 0.55, t * 1.2, t * 1.6, t * 1.2);
  }
  random.float();
}

// ---------------------------------------------------------------------------- memorial

/** Everything the composer needs to finish a memorial group after the geometry is emitted. */
export interface MemorialComposition extends DedicatedComposition {
  /** The fabric surface the site is built in, for the weathering the composer publishes. */
  surface: SurfaceKey;
  weathering: number;
  individualMarkers: number;
  communalMarkers: number;
}

/**
 * A place of remembrance.
 *
 * The one composition driven by the simulation's own record rather than by a BuildingSpec: how
 * many died, how many are named, how old the site is and whether it was consecrated. There is no
 * shell, no storey and no structural family to resolve, which is why the spec is skipped for it
 * entirely. It is a ceremonial focal object, scaled to stay legible at settlement camera
 * distance; the landscape renderer owns the distributed burial markers around it.
 */
export function composeMemorial(
  sink: GeometrySink,
  memorial: MemorialSite,
  toneShift: number,
): MemorialComposition {
  const count = Math.min(12, Math.ceil(Math.log2(1 + memorial.deaths)));
  const named = memorial.people.length;
  const surface: SurfaceKey = memorial.form === 'ancestor-posts'
    ? 'timber'
    : memorial.form === 'earth-mounds' ? 'ground' : 'stone';
  const fabric = sink.at(surface, BUILD_STAGE.FRAME);
  const weathering = Math.min(0.78, memorial.ageBand * 0.15);
  fabric?.setWeathering(weathering, toneShift);

  if (memorial.form === 'earth-mounds') {
    sink.at('ground', BUILD_STAGE.FOUNDATION)?.addFanUp(
      { x: 0, y: 0.12, z: 0.06 },
      squareRing(0.48, 0.32, 0, 1).map(p => ({ x: p.x, y: p.y, z: p.z + 0.06 })),
    );
    for (const x of [-0.24, 0, 0.24]) {
      sink.at('stone', BUILD_STAGE.FRAME)?.addBox(x, 0.1, 0.46, x === 0 ? 0.14 : 0.1, x === 0 ? 0.24 : 0.17, 0.07, x * 0.22);
    }
  } else if (memorial.form === 'ancestor-posts') {
    for (const [x, height] of [[-0.28, 0.58], [0, 0.76], [0.28, 0.62]] as const) {
      sink.at('timber', BUILD_STAGE.FRAME)?.addBox(x, height / 2, 0.12, 0.075, height, 0.075, x * 0.18);
      sink.at('timber', BUILD_STAGE.DETAIL)?.addBox(x, height * 0.72, 0.12, 0.18, 0.045, 0.065, -x * 0.35);
    }
    sink.at('timber', BUILD_STAGE.ROOF)?.addBox(0, 0.61, 0.12, 0.72, 0.07, 0.11);
    sink.at('motif', BUILD_STAGE.DETAIL)?.addBox(0, 0.78, 0.12, 0.13, 0.09, 0.08);
  } else if (memorial.form === 'stone-cairns') {
    for (let layer = 0; layer < 5; layer += 1) {
      const width = 0.58 - layer * 0.085;
      const y = 0.06 + layer * 0.105;
      sink.at('stone', BUILD_STAGE.FRAME)?.addBox(
        (layer % 2 === 0 ? -1 : 1) * 0.018,
        y,
        0.1 + (layer % 2 === 0 ? 0.012 : -0.012),
        width,
        0.105,
        width * 0.72,
        layer * 0.23,
      );
    }
    sink.at('motif', BUILD_STAGE.DETAIL)?.addBox(0, 0.59, 0.1, 0.13, 0.12, 0.1, 0.35);
  } else {
    sink.at('stone', BUILD_STAGE.FOUNDATION)?.addBox(0, 0.05, 0.12, 0.72, 0.1, 0.46);
    sink.at('stone', BUILD_STAGE.FOUNDATION)?.addBox(0, 0.12, 0.12, 0.52, 0.07, 0.34);
    sink.at('stone', BUILD_STAGE.WALLS)?.addBox(0, 0.48, 0.12, 0.27, 0.72, 0.12);
    sink.at('stone', BUILD_STAGE.ROOF)?.addBox(0, 0.85, 0.12, 0.33, 0.06, 0.15);
    for (const x of [-0.31, 0.31]) sink.at('stone', BUILD_STAGE.FRAME)?.addBox(x, 0.25, 0.12, 0.13, 0.36, 0.1, x * 0.12);
    sink.at('motif', BUILD_STAGE.DETAIL)?.addBox(0, 0.55, 0.055, 0.15, 0.22, 0.025);
  }

  if (memorial.events.length) {
    sink.at(surface, BUILD_STAGE.FOUNDATION)?.addBox(0, 0.045, 0.78, 0.72, 0.09, 0.3);
    sink.at(surface, BUILD_STAGE.WALLS)?.addBox(0, 0.3, 0.78, 0.3, 0.5, 0.11);
    sink.at('motif', BUILD_STAGE.DETAIL)?.addBox(0, 0.35, 0.72, 0.14, 0.17, 0.025);
  }
  if (memorial.sacred) {
    for (const x of [-0.32, 0.32]) sink.at('timber', BUILD_STAGE.FRAME)?.addBox(x, 0.34, 0.84, 0.065, 0.68, 0.065);
    sink.at('timber', BUILD_STAGE.ROOF)?.addBox(0, 0.66, 0.84, 0.78, 0.075, 0.22);
    sink.at('motif', BUILD_STAGE.DETAIL)?.addBox(0, 0.74, 0.84, 0.14, 0.07, 0.05);
  }

  return {
    height: memorial.form === 'stelae' ? 0.9 : memorial.sacred ? 0.8 : 0.66,
    extentX: 2.2,
    extentZ: 2.2,
    surface,
    weathering,
    individualMarkers: named,
    communalMarkers: count,
  };
}

// ---------------------------------------------------------------------------- registry

/** What kind of non-building a dedicated composition produces. Reported by the catalogue. */
export type DedicatedGeometryKind = 'span' | 'perimeter' | 'enclosure' | 'machine';

type DedicatedComposer = (sink: GeometrySink, spec: BuildingSpec, seed: string) => DedicatedComposition;

/**
 * Every archetype whose composition replaces the building shell outright.
 *
 * A registry rather than a switch: the catalogue reads it to report each structure's geometry
 * path, and validateStructureCatalogue fails if an entry here names an archetype that does not
 * exist. Adding a dedicated structure is one entry plus one composer function, and nothing
 * outside this module needs to learn about it.
 */
const DEDICATED_COMPOSITIONS: Partial<Record<BuildingArchetype, { kind: DedicatedGeometryKind; compose: DedicatedComposer }>> = {
  bridge: { kind: 'span', compose: composeBridge },
  'boundary-wall': { kind: 'perimeter', compose: composeBoundaryWall },
  'animal-pen': { kind: 'enclosure', compose: composeAnimalPen },
  // Machine buildings: drafted around their drive train, not dressed onto a workshop shell.
  mill: { kind: 'machine', compose: composeMill },
  windmill: { kind: 'machine', compose: composeMill },
  'hand-mill': { kind: 'machine', compose: composeMill },
  sawmill: { kind: 'machine', compose: composeMill },
  'wind-pump': { kind: 'machine', compose: composeMill },
  'smock-mill': { kind: 'machine', compose: composeMill },
};

/** The archetype ids with dedicated geometry, for the catalogue's orphan check. */
export const DEDICATED_ARCHETYPES: readonly string[] = Object.keys(DEDICATED_COMPOSITIONS);

export function dedicatedGeometryKind(archetype: BuildingArchetype): DedicatedGeometryKind | undefined {
  return DEDICATED_COMPOSITIONS[archetype]?.kind;
}

/** Archetypes whose composition replaces the building shell outright. */
export function hasDedicatedComposition(spec: BuildingSpec): boolean {
  return DEDICATED_COMPOSITIONS[spec.archetype] !== undefined;
}

/**
 * Compose a structure that is not a building.
 *
 * Returns undefined for anything that should go through the ordinary shell, so the composer can
 * treat this as a single guarded branch.
 */
export function composeDedicated(
  sink: GeometrySink,
  spec: BuildingSpec,
  seed: string,
): DedicatedComposition | undefined {
  return DEDICATED_COMPOSITIONS[spec.archetype]?.compose(sink, spec, seed);
}

/** Measured height of whatever a dedicated composition actually emitted. */
export function measuredHeight(group: THREE.Object3D, fallback: number): number {
  const box = new THREE.Box3().setFromObject(group);
  return Number.isFinite(box.max.y) ? Math.max(fallback, box.max.y) : fallback;
}
