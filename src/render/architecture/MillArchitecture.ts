/**
 * MillArchitecture.ts
 *
 * The mill family, designed around its machinery.
 *
 * A mill is not a workshop with a wheel bolted on. The process decides the building: water has to
 * be brought to a wheel and carried away, the wheel's power has to reach the stones through gearing
 * that needs room to turn, grain has to go up and flour has to come down, and a windmill's whole
 * body exists to hold its sails up into the wind and turn them to meet it. So each subtype here is
 * drafted from its drive train outward — race, wheel, gearing, stones, hoist — and the walls and
 * roof are what shelters that, not the other way round.
 *
 * Every subtype has its own silhouette:
 *
 * - quern shelter        an open lean-to over a stone pedestal and a hand-turned quern
 * - rotary quern house   a round thatched house with a porch quern on a sweep pole
 * - rural gristmill      a stone hut perched over a stream, fed by a steep wooden chute
 * - watermill            a gabled mill house beside its race, breast wheel, sluice and millpond
 * - early industrial     a tall narrow mill with an overshot wheel fed by a launder on trestles
 * - mechanized mill      a long brick block, engine house, rope-drive fan, boiler house and stack
 * - processing plant     a concrete silo battery, headhouse and conveyor gallery
 * - water sawmill        an open saw shed with a crank-driven frame saw and log carriage
 * - sash sawmill         a stone undercroft with a gang saw on the open floor above
 * - steam sawmill        a long open shed, circular saw, belt drive, engine and wigwam burner
 * - post mill            a weatherboarded buck turning on a single post above an open trestle
 * - smock mill           an octagonal timber smock on a brick base with a reefing stage
 * - tower mill           a tapering masonry tower with an ogee cap and fantail
 * - polder wind pump     a thatched cone with a scoop wheel lifting water between two levels
 * - lattice wind pump    a steel tower, multi-blade wheel, tail vane and pump rod
 *
 * Every moving part is a rotor on its machine's drive train (see MillMotion), and every one has its
 * operating clearance reserved: sail tips clear the ground, the stage and the tower batter; wheels
 * clear their race walls and the house; cranks and sashes clear their floors.
 *
 * Materials still come from the spec. A tower mill is brick or stone because the resolver said so;
 * this module only decides where that material goes.
 */

import { BUILD_STAGE } from '../assets/BuildStages';
import type { Vec3 } from '../assets/GeometryBuilder';
import { SeededRandom } from '../../sim/prng';
import type { BuildingSpec } from './BuildingSpec';
import type { FunctionalEquipment } from './BuildingArchetype';
import { archetypeStageFor } from './BuildingArchetype';
import type { ArchitecturalPeriod } from './ArchitecturalPeriod';
import { architecturalMaterial } from './MaterialLibrary';
import type { GeometrySink } from './StructureGeometry';
import { MillKit, v, type Builder } from './MillKit';

const { SITE, FOUNDATION, FRAME, WALLS, ROOF, UTILITIES, FITOUT, FINISH } = BUILD_STAGE;

/** What a mill composition reports back, matching the dedicated-structure contract. */
export interface MillComposition {
  height: number;
  extentX: number;
  extentZ: number;
  /** Which subtype was drafted, for inspection. */
  subtype: MillSubtype;
}

export type MillSubtype =
  | 'quern-shelter' | 'quern-house' | 'rural-gristmill' | 'watermill' | 'early-industrial-mill'
  | 'mechanized-mill' | 'processing-plant' | 'water-sawmill' | 'sash-sawmill' | 'steam-sawmill'
  | 'post-mill' | 'smock-mill' | 'tower-mill' | 'polder-wind-pump' | 'lattice-wind-pump';

/** Archetypes this module owns. Each has a lineage of subtypes in BuildingArchetype. */
export const MILL_ARCHETYPES = ['mill', 'windmill', 'hand-mill', 'sawmill', 'wind-pump', 'smock-mill'] as const;

interface Draft {
  k: MillKit;
  spec: BuildingSpec;
  random: SeededRandom;
  has: (item: FunctionalEquipment) => boolean;
  /** Wall material family, which decides framing details such as exposed timber bracing. */
  timberWalls: boolean;
}

/** The subtype a spec drafts as: its archetype and the period whose lineage entry it uses. */
export function millSubtype(spec: BuildingSpec): MillSubtype {
  const definedIn: ArchitecturalPeriod = archetypeStageFor(spec.archetype, spec.period)?.definedIn ?? spec.period;
  switch (spec.archetype) {
    case 'hand-mill': return definedIn === 'neolithic' ? 'quern-shelter' : 'quern-house';
    case 'windmill': return definedIn === 'medieval' ? 'post-mill' : 'tower-mill';
    case 'smock-mill': return 'smock-mill';
    case 'wind-pump': return definedIn === 'earlyModern' ? 'polder-wind-pump' : 'lattice-wind-pump';
    case 'sawmill': return definedIn === 'classical' ? 'water-sawmill' : definedIn === 'earlyModern' ? 'sash-sawmill' : 'steam-sawmill';
    default:
      switch (definedIn) {
        case 'classical': return 'rural-gristmill';
        case 'medieval': return 'watermill';
        case 'earlyModern': return 'early-industrial-mill';
        case 'industrial': return 'mechanized-mill';
        default: return 'processing-plant';
      }
  }
}

export function composeMill(sink: GeometrySink, spec: BuildingSpec, seed: string): MillComposition {
  const k = new MillKit(sink);
  const family = architecturalMaterial(spec.materials.wall).family;
  const draft: Draft = {
    k, spec,
    random: new SeededRandom(`${seed}:mill`),
    has: item => spec.equipment.includes(item),
    timberWalls: family === 'timber' || family === 'organic',
  };
  const subtype = millSubtype(spec);
  DRAFTERS[subtype](draft);
  const b = k.bounds;
  const s = k.scale;
  const reach = (min: number, max: number): number => Math.max(Math.abs(min), Math.abs(max)) * 2 * s;
  return {
    subtype,
    height: Math.max(0.1, b.max.y * s),
    extentX: Number.isFinite(b.groundMin.x) ? reach(b.groundMin.x, b.groundMax.x) : spec.width,
    extentZ: Number.isFinite(b.groundMin.z) ? reach(b.groundMin.z, b.groundMax.z) : spec.depth,
  };
}

const DRAFTERS: Record<MillSubtype, (d: Draft) => void> = {
  'quern-shelter': quernShelter,
  'quern-house': quernHouse,
  'rural-gristmill': ruralGristmill,
  watermill,
  'early-industrial-mill': earlyIndustrialMill,
  'mechanized-mill': mechanizedMill,
  'processing-plant': processingPlant,
  'water-sawmill': d => sawmill(d, 'water'),
  'sash-sawmill': d => sawmill(d, 'sash'),
  'steam-sawmill': steamSawmill,
  'post-mill': postMill,
  'smock-mill': smockMill,
  'tower-mill': towerMill,
  'polder-wind-pump': polderWindPump,
  'lattice-wind-pump': latticeWindPump,
};

// ---------------------------------------------------------------------------- shared site pieces

/** A trodden working yard. Everything a mill does happens on beaten ground. */
function yard(d: Draft, x: number, z: number, sx: number, sz: number): void {
  d.k.block(d.k.at('ground', SITE), x, 0, z, sx, 0.04, sz);
}

function sackPile(d: Draft, x: number, z: number, count: number): void {
  const b = d.k.at('canvas', FINISH);
  for (let index = 0; index < count; index += 1) {
    const layer = Math.floor(index / 3);
    d.k.sack(b, x + ((index % 3) - 1) * 0.5, layer * 0.3, z + (layer % 2) * 0.2, d.random.range(-0.2, 0.2));
  }
}

function barrels(d: Draft, x: number, z: number, count: number): void {
  const b = d.k.at('timber', FINISH);
  for (let index = 0; index < count; index += 1) {
    const bx = x + (index % 2) * 0.7, bz = z + Math.floor(index / 2) * 0.7;
    d.k.cyl(b, v(bx, 0, bz), v(bx, 0.9, bz), 0.32, 0.32, 10);
  }
}

/** A spare runner stone leaning on a wall, waiting to be dressed. Every working mill has one. */
function spareStone(d: Draft, x: number, z: number, radius: number): void {
  d.k.cyl(d.k.at('stone', FINISH), v(x, radius, z), v(x + 0.28, radius + 0.04, z), radius, radius, 14);
}

/** A stone-lined race: water between two walls, running along Z. */
function race(d: Draft, x0: number, x1: number, z0: number, z1: number, waterY: number, wallH: number): void {
  const stone = d.k.at('stone', FOUNDATION);
  for (const x of [x0, x1]) d.k.block(stone, x, -0.4, (z0 + z1) / 2, 0.45, wallH + 0.4, z1 - z0);
  d.k.water(d.k.at('water', FOUNDATION), x0 + 0.22, x1 - 0.22, z0, z1, waterY);
}

/** A sluice: two posts, a head beam, a gate board raised to let water through, and its windlass. */
function sluice(d: Draft, x0: number, x1: number, z: number, top: number, gateBottom: number): void {
  const timber = d.k.at('timber', UTILITIES);
  for (const x of [x0, x1]) d.k.bar(timber, v(x, -0.2, z), v(x, top, z), 0.24);
  d.k.bar(timber, v(x0 - 0.2, top, z), v(x1 + 0.2, top, z), 0.24);
  d.k.block(timber, (x0 + x1) / 2, gateBottom, z, x1 - x0 - 0.3, 1.0, 0.12);
  // The rack rod the gate is wound up by, and the hand wheel that winds it.
  d.k.bar(timber, v((x0 + x1) / 2, gateBottom + 1.0, z), v((x0 + x1) / 2, top + 0.6, z), 0.08);
  d.k.rim(d.k.at('metal', UTILITIES), v((x0 + x1) / 2, top + 0.35, z + 0.25), 'z', 0.35, 0.05, 12);
}

/** A gabled house body: walls on a plinth, gable ends and a pitched roof. Returns the eave height. */
function gabledHouse(
  d: Draft, cx: number, cz: number, width: number, depth: number, wallTop: number,
  rise: number, overhang: number, ridge: 'x' | 'z', plinth = 0.4,
): void {
  const { k } = d;
  k.block(k.at('stone', FOUNDATION), cx, -0.4, cz, width + 0.3, plinth + 0.4, depth + 0.3);
  k.block(k.at('brick', WALLS), cx, plinth, cz, width, wallTop - plinth, depth);
  k.gableEnds(k.at('brick', WALLS), cx, wallTop, cz, width, depth, rise, ridge);
  k.gableRoof(k.at('roof-tile', ROOF), cx, wallTop, cz, width, depth, rise, overhang, ridge);
}

/** Exposed studs and braces on a timber-framed elevation facing +Z or -Z. */
function framedElevation(d: Draft, x0: number, x1: number, z: number, y0: number, y1: number): void {
  if (!d.timberWalls) return;
  const b = d.k.at('timber', WALLS);
  const out = Math.sign(z) * 0.04;
  const studs = Math.max(2, Math.round((x1 - x0) / 1.2));
  for (let index = 0; index <= studs; index += 1) {
    const x = x0 + ((x1 - x0) * index) / studs;
    d.k.bar(b, v(x, y0, z + out), v(x, y1, z + out), 0.16, 0.08);
  }
  d.k.bar(b, v(x0, (y0 + y1) / 2, z + out), v(x1, (y0 + y1) / 2, z + out), 0.14, 0.08);
  d.k.bar(b, v(x0, y0, z + out), v(x0 + (x1 - x0) * 0.3, y1, z + out), 0.14, 0.08);
  d.k.bar(b, v(x1, y0, z + out), v(x1 - (x1 - x0) * 0.3, y1, z + out), 0.14, 0.08);
}

/**
 * A lucam: the projecting hoist housing at the eaves, with its beam, rope, and a sack climbing it.
 *
 * The sack rides the water train at a very low ratio, so it rises and falls slowly as the wheel
 * turns — the visible end of the mill's power, lifting grain to the top floor.
 */
function lucam(d: Draft, x: number, frontZ: number, wallTop: number, lowY: number, drive: 'water-wheel' | 'engine'): void {
  const { k } = d;
  const bottom = wallTop - 1.7;
  k.block(k.at('brick', WALLS), x, bottom, frontZ + 0.6, 1.8, 2.2, 1.2);
  k.gableRoof(k.at('roof-tile', ROOF), x, bottom + 2.2, frontZ + 0.6, 1.8, 1.4, 0.8, 0.15, 'z');
  k.gableEnds(k.at('brick', WALLS), x, bottom + 2.2, frontZ + 0.6, 1.8, 1.2, 0.8, 'z');
  const timber = k.at('timber', UTILITIES);
  k.bar(timber, v(x, bottom + 1.9, frontZ - 0.4), v(x, bottom + 1.9, frontZ + 1.7), 0.2);
  k.bar(k.at('canvas', UTILITIES), v(x, bottom + 1.8, frontZ + 1.55), v(x, lowY + 0.9, frontZ + 1.55), 0.04);
  if (!d.has('loading-platform') && !d.has('grain-bin')) return;
  const high = bottom - 0.4;
  const centre = (high + lowY) / 2;
  const sack = k.rotor('Sack on hoist', v(x, centre, frontZ + 1.55), 'canvas', FINISH, {
    axis: 'y', drive, motion: 'reciprocate', stroke: (high - lowY) / 2, ratio: drive === 'engine' ? 0.04 : 0.09,
  });
  k.sack(sack, x, centre - 0.37, frontZ + 1.55, 0, true);
}

// ---------------------------------------------------------------------------- hand mills

/** The quern: bed stone fixed, runner turning on it, with a handle — or a sweep pole — to turn it by. */
function quern(d: Draft, x: number, bedTop: number, z: number, pole?: Vec3): void {
  const { k } = d;
  if (!d.has('millstone')) return;
  k.cyl(k.at('stone', FITOUT), v(x, bedTop - 0.14, z), v(x, bedTop, z), 0.38, 0.36, 16);
  const pivot = v(x, bedTop, z);
  const spec = { axis: 'y' as const, drive: 'manual' as const };
  const runner = k.rotor('Quern runner', pivot, 'stone', FITOUT, spec);
  k.cyl(runner, v(x, bedTop + 0.01, z), v(x, bedTop + 0.13, z), 0.35, 0.31, 16);
  // A notch in the rim, so a turning stone visibly turns.
  k.box(runner, x - 0.3, bedTop + 0.08, z, 0.1, 0.1, 0.1);
  const handle = k.rotor('Quern runner', pivot, 'timber', FITOUT, spec);
  k.bar(handle, v(x - 0.12, bedTop + 0.15, z), v(x + 0.12, bedTop + 0.15, z), 0.05);
  if (pole) {
    // The sweep: a long pole from the handle hole up to a socket in the beam over the stone's
    // centre, so one person walking round turns the stone with a long, easy lever.
    k.bar(handle, v(x + 0.26, bedTop + 0.12, z), pole, 0.06);
  } else {
    // A stout upright handle with a turned grip: the one thing that says 'turn me by hand'.
    k.bar(handle, v(x + 0.26, bedTop + 0.1, z), v(x + 0.26, bedTop + 0.62, z), 0.1);
    k.cyl(handle, v(x + 0.26, bedTop + 0.62, z), v(x + 0.26, bedTop + 0.74, z), 0.08, 0.06, 8);
  }
  k.sweep(pivot, 0.4, 'y');
  // Flour gathers in a ring around the bed stone.
  k.cyl(k.at('canvas', FINISH), v(x, bedTop - 0.16, z), v(x, bedTop - 0.13, z), 0.55, 0.5, 14);
}

function quernShelter(d: Draft): void {
  const { k } = d;
  yard(d, 0, 0.5, 6.4, 5.6);
  const posts = k.at('timber', FRAME);
  for (const x of [-1.7, 1.7]) {
    k.bar(posts, v(x, -0.2, 1.5), v(x, 2.3, 1.5), 0.18);
    k.bar(posts, v(x, -0.2, -1.4), v(x, 1.45, -1.4), 0.18);
  }
  k.bar(posts, v(-2.0, 2.25, 1.5), v(2.0, 2.25, 1.5), 0.16);
  k.bar(posts, v(-2.0, 1.4, -1.4), v(2.0, 1.4, -1.4), 0.16);
  for (const x of [-1.7, -0.55, 0.55, 1.7]) k.bar(posts, v(x, 2.38, 1.95), v(x, 1.28, -1.85), 0.1);
  k.shedRoof(k.at('roof-thatch', ROOF), -2.15, 2.15, 2.05, 2.5, -1.95, 1.3, 0.24);
  // Woven windbreaks on the back and the weather side; the front stays open to the light.
  k.block(k.at('brick', WALLS), 0, 0, -1.45, 3.5, 1.35, 0.12);
  k.block(k.at('brick', WALLS), -1.78, 0, -0.45, 0.12, 1.15, 1.9);
  // The quern stands on a stone pedestal at working height for someone kneeling beside it.
  k.cyl(k.at('stone', FOUNDATION), v(0, -0.1, 0.35), v(0, 0.42, 0.35), 0.62, 0.52, 12);
  quern(d, 0, 0.56, 0.35);
  // The older way of grinding, still kept: a saddle quern and its rubbing stone.
  k.box(k.at('stone', FINISH), 1.15, 0.12, 0.9, 0.9, 0.22, 0.5, 0.4);
  k.box(k.at('stone', FINISH), 1.1, 0.29, 0.95, 0.3, 0.12, 0.16, 0.4);
  const basket = k.at('roof-thatch', FINISH);
  k.cyl(basket, v(-0.9, 0, 0.9), v(-0.9, 0.5, 0.9), 0.3, 0.38, 10);
  k.cyl(basket, v(-1.3, 0, 0.1), v(-1.3, 0.42, 0.1), 0.26, 0.33, 10);
  sackPile(d, 0.8, -0.8, 2);
  // Firewood against the windbreak.
  for (let index = 0; index < 5; index += 1) k.bar(k.at('timber', FINISH), v(-1.5 + index * 0.18, 0, -1.25), v(-1.45 + index * 0.18, 1.0, -1.32), 0.1);
}

function quernHouse(d: Draft): void {
  const { k } = d;
  yard(d, 0, 1.2, 8.0, 8.4);
  // A round house of wattle and daub, its doorway to the porch.
  const wall = k.at('brick', WALLS);
  const segments = 18;
  for (let index = 0; index < segments; index += 1) {
    const angle = ((index + 0.5) / segments) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.cos(angle), Math.sin(angle))) < 0.36) continue;
    const x = Math.cos(angle) * 2.6, z = Math.sin(angle) * 2.6;
    k.block(wall, x, -0.1, z, 0.95, 1.9, 0.28, -angle + Math.PI / 2);
  }
  k.cyl(k.at('roof-thatch', ROOF), v(0, 1.65, 0), v(0, 5.2, 0), 3.4, 0.08, 18, true);
  // The porch: an open lean-to where the light is good enough to mill by.
  const posts = k.at('timber', FRAME);
  for (const x of [-1.7, 1.7]) {
    k.bar(posts, v(x, -0.2, 4.7), v(x, 2.15, 4.7), 0.18);
    k.bar(posts, v(x, -0.2, 2.5), v(x, 2.5, 2.5), 0.18);
  }
  k.bar(posts, v(-1.9, 2.1, 4.7), v(1.9, 2.1, 4.7), 0.16);
  k.bar(posts, v(-1.9, 2.45, 2.5), v(1.9, 2.45, 2.5), 0.16);
  // The beam over the quern, carrying the socket the sweep pole turns in.
  k.bar(posts, v(-1.9, 2.3, 3.6), v(1.9, 2.3, 3.6), 0.16);
  k.box(posts, 0, 2.19, 3.6, 0.22, 0.12, 0.22);
  k.shedRoof(k.at('roof-thatch', ROOF), -2.1, 2.1, 2.3, 2.75, 5.0, 2.05, 0.22);
  // The quern table: a stout timber stand that puts the stone at a standing worker's hands.
  const table = k.at('timber', FITOUT);
  k.block(table, 0, 0.62, 3.6, 1.2, 0.12, 1.2);
  for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) k.block(table, dx, 0, 3.6 + dz, 0.12, 0.62, 0.12);
  quern(d, 0, 0.88, 3.6, v(0, 2.12, 3.6));
  // Storage: big earthenware jars by the door, and a drying frame for the grain.
  const jar = k.at('brick', FINISH);
  for (const [x, z] of [[2.4, 3.0], [2.8, 3.6]] as const) {
    k.cyl(jar, v(x, 0, z), v(x, 0.5, z), 0.26, 0.38, 10);
    k.cyl(jar, v(x, 0.5, z), v(x, 0.9, z), 0.38, 0.18, 10);
  }
  const rack = k.at('timber', FINISH);
  for (const x of [-3.6, -2.4]) k.bar(rack, v(x, 0, 2.6), v(x, 1.6, 2.6), 0.1);
  for (const y of [0.8, 1.2, 1.55]) k.bar(rack, v(-3.7, y, 2.6), v(-2.3, y, 2.6), 0.06);
  k.sheet(k.at('roof-thatch', FINISH), [v(-3.6, 1.55, 2.62), v(-2.4, 1.55, 2.62), v(-2.4, 0.9, 2.62), v(-3.6, 0.9, 2.62)]);
  sackPile(d, -1.2, 5.3, 3);
}

// ---------------------------------------------------------------------------- watermills

/**
 * The rural gristmill: a horizontal-wheeled mill.
 *
 * The oldest water mill there is, and nothing else looks like it — a small stone room perched over
 * a stream on its own undercroft, with a steep wooden chute driving a paddle wheel that lies flat
 * in the water and turns the runner stone directly above it on a single shaft. No gears at all.
 */
function ruralGristmill(d: Draft): void {
  const { k } = d;
  const floorY = 1.5;
  const wallTop = floorY + 2.3;
  // The stream runs north–south under the mill.
  k.water(k.at('water', SITE), -1.0, 1.0, -10, 8, 0.06);
  yard(d, 4.2, 0, 4.6, 9);
  yard(d, -4.0, -1, 3.8, 9);
  const stone = k.at('stone', FOUNDATION);
  for (const x of [-1.25, 1.25]) k.block(stone, x, -0.3, -0.5, 0.35, 1.1, 9.0);
  // The undercroft: side walls on each bank, and piers with a lintel over the stream.
  for (const x of [-2.3, 2.3]) k.block(stone, x, -0.3, 0, 0.6, floorY + 0.3, 4.2);
  for (const z of [-2.0, 2.0]) {
    for (const x of [-1.85, 1.85]) k.block(stone, x, -0.3, z, 0.8, floorY + 0.3, 0.5);
    k.block(stone, 0, 1.05, z, 2.9, floorY - 1.05, 0.5);
  }
  k.block(k.at('timber', FRAME), 0, floorY - 0.08, 0, 4.8, 0.16, 4.4);
  // The mill room: thick stone walls with a door to the east bank.
  const wall = k.at('brick', WALLS);
  const h = wallTop - floorY;
  k.block(wall, 0, floorY, -2.0, 4.6, h, 0.45);
  k.block(wall, 0, floorY, 2.0, 4.6, h, 0.45);
  k.block(wall, -2.1, floorY, 0, 0.45, h, 3.6);
  k.block(wall, 2.1, floorY, -1.1, 0.45, h, 1.4);
  k.block(wall, 2.1, floorY, 1.4, 0.45, h, 0.8);
  k.block(wall, 2.1, floorY + 1.85, 0.4, 0.45, h - 1.85, 1.2);
  k.door(k.at('timber', FITOUT), k.at('shadow', FITOUT), v(2.33, floorY, 0.4), v(1, 0, 0), 0.95, 1.8);
  k.window(k.at('shadow', FITOUT), k.at('timber', FITOUT), v(0.8, floorY + 1.4, 2.23), v(0, 0, 1), 0.6, 0.6);
  k.gableEnds(wall, 0, wallTop, 0, 4.6, 4.45, 1.5, 'z');
  k.gableRoof(k.at('roof-tile', ROOF), 0, wallTop, 0, 4.6, 4.45, 1.5, 0.35, 'z');
  // Steps up from the east bank.
  k.stair(k.at('stone', FOUNDATION), v(4.1, 0, 0.4), v(2.6, floorY, 0.4), 1.0);

  // The headrace: a raised stone tank upstream, and the steep chute that drives the wheel.
  if (d.has('waterwheel')) {
    k.block(stone, 0, -0.3, -8.6, 2.6, 2.8, 1.8);
    k.water(k.at('water', FOUNDATION), -1.1, 1.1, -9.4, -7.8, 2.52);
    const chute = k.at('timber', UTILITIES);
    const top = v(0, 2.45, -7.7), bottom = v(0.45, 0.82, -1.0);
    k.bar(chute, top, bottom, 0.5, 0.08, v(0, 1, 0));
    for (const side of [-0.28, 0.28]) k.bar(chute, v(top.x + side, top.y + 0.15, top.z), v(bottom.x + side, bottom.y + 0.15, bottom.z), 0.06, 0.32);
    k.bar(chute, v(-0.5, -0.2, -4.8), v(-0.4, 1.9, -4.8), 0.14);
    k.bar(chute, v(0.7, -0.2, -4.8), v(0.6, 1.9, -4.8), 0.14);
    k.bar(chute, v(-0.6, 1.8, -4.8), v(0.8, 1.8, -4.8), 0.12);
    k.sheet(k.at('water', UTILITIES), [v(-0.18, 2.52, -7.7), v(0.18, 2.52, -7.7), v(0.63, 0.9, -1.0), v(0.27, 0.9, -1.0)]);
    k.block(k.at('stone', FOUNDATION), 0, -0.2, 0, 0.5, 0.45, 0.5);

    // The wheel, shaft and runner stone are one rotor: a horizontal mill has no gearing to show.
    const pivot = v(0, 0.55, 0);
    const spec = { axis: 'y' as const, drive: 'water-wheel' as const };
    const wheel = k.rotor('Horizontal wheel', pivot, 'timber', UTILITIES, spec);
    k.cyl(wheel, v(0, 0.3, 0), v(0, 0.8, 0), 0.2, 0.2, 10);
    for (let index = 0; index < 14; index += 1) {
      const angle = (index / 14) * Math.PI * 2;
      const dir = v(Math.cos(angle), 0, Math.sin(angle));
      const tangent = v(-Math.sin(angle), 0, Math.cos(angle));
      // Spoon paddles, cupped and pitched to take the jet from the chute.
      k.obox(wheel, v(dir.x * 0.62, 0.55, dir.z * 0.62), dir, v(tangent.x * 0.5, 0.86, tangent.z * 0.5), 0.8, 0.36, 0.05);
    }
    k.cyl(wheel, v(0, 0.8, 0), v(0, floorY + 0.35, 0), 0.07, 0.07, 8);
    k.sweep(pivot, 1.05, 'y');
    if (d.has('millstone')) {
      const runner = k.rotor('Horizontal wheel', pivot, 'stone', FITOUT, spec);
      k.cyl(k.at('stone', FITOUT), v(0, floorY, 0), v(0, floorY + 0.2, 0), 0.62, 0.6, 16);
      k.cyl(runner, v(0, floorY + 0.21, 0), v(0, floorY + 0.4, 0), 0.6, 0.56, 16);
      const hopper = k.at('timber', FITOUT);
      k.cyl(hopper, v(0, floorY + 0.75, 0), v(0, floorY + 1.3, 0), 0.12, 0.45, 4);
      for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) k.bar(hopper, v(dx, floorY, dz), v(dx * 0.6, floorY + 1.2, dz * 0.6), 0.06);
    }
  }
  sackPile(d, 3.6, 1.6, 4);
  spareStone(d, 2.75, -1.3, 0.55);
  // A cart track down to the stream.
  d.k.block(d.k.at('ground', SITE), 5.8, 0, 3.0, 1.8, 0.05, 6.0);
}

/**
 * The watermill: a gabled mill house beside its own race.
 *
 * Water is held in a millpond behind an earthen dam, let through a sluice into a stone-walled race,
 * and drives a breast wheel against the west gable. The wheel's axle runs through the wall to a pit
 * wheel and wallower in an open machinery bay, where the upright shaft carries the power up to the
 * stones. Grain comes in from the cart at the loading platform and goes up by the lucam hoist.
 */
function watermill(d: Draft): void {
  const { k } = d;
  const floors = Math.max(2, Math.min(3, d.spec.floors));
  const plinth = 0.3, ground = 3.2, upper = 2.6;
  const wallTop = plinth + ground + (floors - 1) * upper;
  const halfX = 4, halfZ = 3;
  yard(d, 1.5, 3.5, 13, 9);
  // Ground floor: walled except for the open machinery bay at the west end.
  const wall = k.at('brick', WALLS);
  k.block(k.at('stone', FOUNDATION), 0, -0.4, 0, halfX * 2 + 0.3, plinth + 0.4, halfZ * 2 + 0.3);
  k.block(wall, 0.8, plinth, 0, 6.4, ground, halfZ * 2);
  k.block(wall, -3.2, plinth, -halfZ + 0.2, 1.6, ground, 0.4);
  k.block(wall, -halfX + 0.2, plinth, -1.2, 0.4, ground, 3.6);
  k.block(wall, -halfX + 0.2, plinth + 2.6, 1.8, 0.4, ground - 2.6, 2.4);
  const frame = k.at('timber', FRAME);
  k.bar(frame, v(-halfX + 0.2, plinth, halfZ - 0.1), v(-halfX + 0.2, plinth + ground, halfZ - 0.1), 0.3);
  k.bar(frame, v(-halfX, plinth + ground - 0.1, halfZ - 0.1), v(-2.4, plinth + ground - 0.1, halfZ - 0.1), 0.3);
  // Upper floors and roof over the whole house.
  k.block(wall, 0, plinth + ground, 0, halfX * 2, wallTop - plinth - ground, halfZ * 2);
  k.gableEnds(wall, 0, wallTop, 0, halfX * 2, halfZ * 2, 3.0, 'x');
  k.gableRoof(k.at('roof-tile', ROOF), 0, wallTop, 0, halfX * 2, halfZ * 2, 3.0, 0.4, 'x');
  framedElevation(d, -halfX, halfX, halfZ, plinth + ground, wallTop);
  framedElevation(d, -halfX, halfX, -halfZ, plinth + ground, wallTop);
  const dark = k.at('shadow', FITOUT), trim = k.at('timber', FITOUT);
  for (let floor = 1; floor < floors; floor += 1) {
    const y = plinth + ground + (floor - 1) * upper + 1.3;
    for (const x of [-2.6, 2.6]) {
      k.window(dark, trim, v(x, y, halfZ), v(0, 0, 1), 0.8, 1.0);
      k.window(dark, trim, v(x, y, -halfZ), v(0, 0, -1), 0.8, 1.0);
    }
  }
  k.window(dark, trim, v(2.8, plinth + 1.6, halfZ), v(0, 0, 1), 0.9, 1.0);
  k.door(trim, dark, v(0.4, plinth, halfZ), v(0, 0, 1), 1.7, 2.1);

  // Loading platform at cart height, with its steps, under the lucam.
  if (d.has('loading-platform')) {
    k.block(k.at('stone', FOUNDATION), 0.4, 0, halfZ + 0.8, 3.2, 0.75, 1.6);
    k.block(k.at('timber', FITOUT), 0.4, 0.75, halfZ + 0.8, 3.3, 0.08, 1.7);
    k.stair(k.at('stone', FOUNDATION), v(2.8, 0, halfZ + 0.8), v(2.0, 0.75, halfZ + 0.8), 1.0);
  }
  lucam(d, 0.4, halfZ, wallTop, 1.0, 'water-wheel');

  // The race, sluice and millpond on the west.
  const wheelX = -5.45, wheelY = 1.9, radius = 2.4, width = 1.3;
  race(d, -6.55, -4.4, -6.0, 6.5, 0.15, 1.1);
  k.block(k.at('stone', FOUNDATION), -5.5, -0.4, -2.2, 1.8, 0.9, 1.0);
  sluice(d, -6.4, -4.55, -6.2, 2.3, 0.75);
  k.water(k.at('water', SITE), -11, -2.6, -16, -6.6, 0.42);
  const bank = k.at('ground', FOUNDATION);
  k.block(bank, -9.0, -0.3, -6.3, 5.0, 1.0, 1.2);
  k.block(bank, -2.4, -0.3, -6.3, 3.6, 1.0, 1.2);
  k.block(k.at('stone', FOUNDATION), -5.5, -0.3, -6.3, 2.6, 1.0, 0.5);

  if (d.has('waterwheel')) {
    const pivot = v(wheelX, wheelY, 0);
    const wheel = k.rotor('Water wheel', pivot, 'timber', UTILITIES, { axis: 'x', drive: 'water-wheel' });
    k.waterWheel(wheel, pivot, radius, width, 'breast');
    // The axle runs through the gable into the machinery bay and carries the pit wheel.
    k.cyl(wheel, v(wheelX + width / 2, wheelY, 0), v(-3.15, wheelY, 0), 0.26, 0.26, 8);
    k.gear(wheel, v(-3.3, wheelY, 0), 'x', 0.95, 0.24, 36);
    k.sweep(pivot, radius, 'x');
    // Wallower and upright shaft: horizontal gear meshing on top of the pit wheel.
    const wallowerPivot = v(-2.8, wheelY + 1.1, 0);
    const upright = k.rotor('Wallower and upright shaft', wallowerPivot, 'timber', UTILITIES, {
      axis: 'y', drive: 'water-wheel', ratio: 0.95 / 0.5,
    });
    k.gear(upright, wallowerPivot, 'y', 0.5, 0.2, 14);
    k.cyl(upright, v(-2.8, plinth + 0.2, 0), v(-2.8, plinth + ground + 0.1, 0), 0.16, 0.16, 8);
    k.block(k.at('stone', FITOUT), -2.8, plinth, 0, 0.5, 0.2, 0.5);
    // Bearing blocks the axle runs in.
    k.block(k.at('stone', FOUNDATION), -4.4, 0.3, 0, 0.7, wheelY - 0.55, 0.7);
  }
  if (d.has('millstone')) {
    // A pair of stones on the ground floor, by the door, under their hopper.
    const stone = k.at('stone', FITOUT);
    k.cyl(stone, v(1.8, plinth, -1.2), v(1.8, plinth + 0.6, -1.2), 0.9, 0.9, 8);
    k.cyl(stone, v(1.8, plinth + 0.6, -1.2), v(1.8, plinth + 0.9, -1.2), 0.75, 0.72, 16);
  }
  // Tailrace and yard dressing.
  k.water(k.at('water', SITE), -6.3, -4.6, 6.5, 11, 0.12);
  k.cart(k.at('timber', FINISH), 4.2, halfZ + 3.0, 0.3, k.at('canvas', FINISH));
  sackPile(d, -1.0, halfZ + 1.0, 5);
  barrels(d, 4.6, -1.8, 3);
  spareStone(d, halfX + 0.3, 1.5, 0.75);
}

/**
 * The early industrial mill: tall, narrow and fed from above.
 *
 * An overshot wheel takes water at its top from a launder carried on timber trestles from a header
 * pond, so the whole site reads as a line of water running high in the air to a big wheel. The mill
 * rises four storeys with a stack of taking-in doors under its lucam, and the wheel drives through
 * an external pit gear and pinion into the mill, so the gearing is in plain sight.
 */
function earlyIndustrialMill(d: Draft): void {
  const { k } = d;
  const floors = Math.max(3, Math.min(4, d.spec.floors));
  const plinth = 0.4, storey = 2.8;
  const wallTop = plinth + floors * storey;
  const halfX = 5, halfZ = 3.6;
  yard(d, 1.5, 3.0, 15, 11);
  gabledHouse(d, 0, 0, halfX * 2, halfZ * 2, wallTop, 2.6, 0.35, 'x', plinth);
  const stone = k.at('stone', WALLS);
  for (let floor = 1; floor < floors; floor += 1) {
    k.block(stone, 0, plinth + floor * storey - 0.08, 0, halfX * 2 + 0.12, 0.16, halfZ * 2 + 0.12);
  }
  const dark = k.at('shadow', FITOUT), trim = k.at('stone', FITOUT);
  for (let floor = 0; floor < floors; floor += 1) {
    const y = plinth + floor * storey + 1.5;
    for (const x of [-3.4, -1.7, 1.7, 3.4]) {
      k.window(dark, trim, v(x, y, halfZ), v(0, 0, 1), 0.85, 1.3);
      k.window(dark, trim, v(x, y, -halfZ), v(0, 0, -1), 0.85, 1.3);
    }
    for (const z of [-1.4, 1.4]) k.window(dark, trim, v(halfX, y, z), v(1, 0, 0), 0.85, 1.3);
    // Taking-in doors stacked under the lucam, one per floor.
    if (floor > 0) k.door(k.at('timber', FITOUT), dark, v(0, plinth + floor * storey, halfZ), v(0, 0, 1), 1.2, 1.9);
  }
  k.door(k.at('timber', FITOUT), dark, v(0, plinth, halfZ), v(0, 0, 1), 1.6, 2.2);
  lucam(d, 0, halfZ, wallTop, 1.1, 'water-wheel');
  // A chimney for the miller's stove on the east gable.
  k.block(k.at('brick', WALLS), halfX - 0.6, wallTop, 0, 0.7, 3.6, 0.7);

  // An external stair up the east gable to the first-floor door.
  const stairs = k.at('timber', FITOUT);
  k.stair(stairs, v(halfX + 0.7, 0, 3.0), v(halfX + 0.7, plinth + storey, -0.7), 1.0);
  k.block(stairs, halfX + 0.7, plinth + storey - 0.1, -1.5, 1.4, 0.12, 1.6);
  for (const z of [-2.2, -0.8]) k.bar(stairs, v(halfX + 1.3, 0, z), v(halfX + 1.3, plinth + storey, z), 0.14);
  k.railing(stairs, [v(halfX + 1.2, plinth + storey, -2.3), v(halfX + 1.2, plinth + storey, -0.7), v(halfX + 1.2, 0, 3.0)]);
  k.door(k.at('timber', FITOUT), dark, v(halfX, plinth + storey, -1.5), v(1, 0, 0), 1.0, 1.9);
  if (d.has('loading-platform')) {
    k.block(k.at('stone', FOUNDATION), 0, 0, halfZ + 0.9, 3.6, 0.8, 1.8);
    k.stair(k.at('stone', FOUNDATION), v(2.8, 0, halfZ + 0.9), v(1.9, 0.8, halfZ + 0.9), 1.0);
  }

  // Header pond, launder on trestles, and the overshot wheel in its pit.
  const wheelX = -7.4, radius = 3.0, width = 1.6, wheelY = 2.9;
  const launderY = wheelY + radius + 0.35;
  k.block(k.at('ground', FOUNDATION), -7.4, -0.3, -17.5, 8.0, launderY + 0.2, 4.0);
  k.block(k.at('stone', FOUNDATION), -7.4, -0.3, -15.4, 8.0, launderY + 0.3, 0.4);
  k.water(k.at('water', FOUNDATION), -11, -3.8, -19.3, -15.7, launderY - 0.05);
  const launder = k.at('timber', UTILITIES);
  const z0 = -15.4, z1 = 0.3;
  k.block(launder, wheelX, launderY - 0.1, (z0 + z1) / 2, width - 0.1, 0.1, z1 - z0);
  for (const side of [-width / 2 + 0.05, width / 2 - 0.05]) k.block(launder, wheelX + side, launderY - 0.1, (z0 + z1) / 2, 0.08, 0.6, z1 - z0);
  for (const z of [-3.5, -7.2, -10.9, -14.4]) {
    for (const side of [-1.1, 1.1]) k.bar(launder, v(wheelX + side, -0.3, z), v(wheelX + side * 0.6, launderY - 0.12, z), 0.24);
    k.bar(launder, v(wheelX - 1.0, launderY * 0.5, z), v(wheelX + 1.0, launderY * 0.5, z), 0.18);
    k.bar(launder, v(wheelX - 1.0, 0.4, z), v(wheelX + 0.75, launderY - 0.3, z), 0.14);
  }
  if (d.has('waterwheel')) {
    const water = k.at('water', UTILITIES);
    k.water(water, wheelX - 0.7, wheelX + 0.7, z0, z1, launderY + 0.2);
    // Water spilling from the launder end into the buckets just past the top of the wheel.
    k.sheet(water, [v(wheelX - 0.6, launderY + 0.15, z1), v(wheelX + 0.6, launderY + 0.15, z1), v(wheelX + 0.6, wheelY + radius - 0.3, z1 + 0.9), v(wheelX - 0.6, wheelY + radius - 0.3, z1 + 0.9)]);
  }
  race(d, -9.0, -5.6, -3.4, 3.6, 0.15, 1.5);
  k.water(k.at('water', SITE), -8.7, -5.9, 3.6, 10, 0.12);
  if (d.has('waterwheel')) {
    const pivot = v(wheelX, wheelY, 0);
    const wheel = k.rotor('Overshot wheel', pivot, 'timber', UTILITIES, { axis: 'x', drive: 'water-wheel' });
    k.waterWheel(wheel, pivot, radius, width, 'overshot');
    const iron = k.rotor('Overshot wheel', pivot, 'metal', UTILITIES, { axis: 'x', drive: 'water-wheel' });
    // An iron pit gear on the axle outside the wall, meshing with a pinion on the lay shaft above.
    k.cyl(iron, v(wheelX + width / 2, wheelY, 0), v(-5.7, wheelY, 0), 0.22, 0.22, 8);
    k.gear(iron, v(-6.1, wheelY, 0), 'x', 2.1, 0.22, 60);
    const pinionPivot = v(-6.1, wheelY + 2.1 + 0.5, 0);
    const pinion = k.rotor('Lay shaft pinion', pinionPivot, 'metal', UTILITIES, { axis: 'x', drive: 'water-wheel', ratio: -2.1 / 0.5 });
    k.gear(pinion, pinionPivot, 'x', 0.5, 0.22, 15);
    k.cyl(pinion, v(-6.4, pinionPivot.y, 0), v(-halfX + 0.1, pinionPivot.y, 0), 0.12, 0.12, 8);
    k.sweep(pivot, radius, 'x');
  }
  k.cart(k.at('timber', FINISH), 3.8, halfZ + 3.4, -0.4, k.at('canvas', FINISH));
  sackPile(d, -1.6, halfZ + 1.2, 6);
  barrels(d, halfX + 2.0, 1.4, 4);
}

/**
 * The mechanized industrial mill: steam, ropes and rows of windows.
 *
 * Power no longer comes from the site at all. An engine house holds a horizontal steam engine whose
 * piston drives a great grooved flywheel, and from the flywheel a fan of ropes rises through the
 * rope race to a pulley on every floor's line shaft. The boiler house and its stack stand beside
 * the engine; the mill itself is a long brick block of identical bays with a water tank on its
 * stair tower and a rail siding along its loading front.
 */
function mechanizedMill(d: Draft): void {
  const { k } = d;
  const floors = Math.max(4, Math.min(5, d.spec.floors));
  const plinth = 0.6, storey = 3.2;
  const wallTop = plinth + floors * storey;
  const x0 = -12, x1 = 8, halfZ = 5;
  yard(d, 1.5, 4.0, 40, 22);
  gabledHouse(d, (x0 + x1) / 2, 0, x1 - x0, halfZ * 2, wallTop, 1.6, 0.3, 'x', plinth);
  const brick = k.at('brick', WALLS);
  // Pilasters between every bay, a corbelled cornice, and floor bands.
  for (let x = x0; x <= x1 + 1e-6; x += 4) {
    for (const z of [-halfZ, halfZ]) k.block(brick, x, plinth, z + Math.sign(z) * 0.12, 0.6, wallTop - plinth, 0.25);
  }
  k.block(brick, (x0 + x1) / 2, wallTop - 0.35, 0, x1 - x0 + 0.5, 0.35, halfZ * 2 + 0.5);
  const dark = k.at('shadow', FITOUT), sill = k.at('stone', FITOUT);
  for (let floor = 0; floor < floors; floor += 1) {
    const y = plinth + floor * storey + 1.7;
    for (let x = x0 + 2; x < x1; x += 4) {
      k.window(dark, sill, v(x, y, halfZ + 0.05), v(0, 0, 1), 1.6, 2.0);
      k.window(dark, sill, v(x, y, -halfZ - 0.05), v(0, 0, -1), 1.6, 2.0);
    }
  }
  // Stair-and-hoist tower on the front, rising above the roof with a water tank on top.
  const towerX = -2, towerTop = wallTop + 3.2;
  k.block(brick, towerX, plinth, halfZ + 1.0, 4.0, towerTop - plinth, 2.2);
  k.cyl(k.at('metal', ROOF), v(towerX, towerTop, halfZ + 1.0), v(towerX, towerTop + 2.2, halfZ + 1.0), 1.6, 1.6, 14);
  k.cyl(k.at('roof-tile', ROOF), v(towerX, towerTop + 2.2, halfZ + 1.0), v(towerX, towerTop + 2.9, halfZ + 1.0), 1.7, 0.1, 14);
  for (let floor = 0; floor < floors; floor += 1) {
    k.door(k.at('timber', FITOUT), dark, v(towerX, plinth + floor * storey + (floor === 0 ? 0 : 0.6), halfZ + 2.1), v(0, 0, 1), 1.4, 2.0);
  }
  // A canopy over the loading front, and the rail siding beneath it.
  const iron = k.at('metal', UTILITIES);
  k.block(k.at('roof-metal', FINISH), (x0 + x1) / 2 + 3, 4.2, halfZ + 2.8, 12, 0.12, 3.2);
  for (const x of [-4, 2, 8]) k.bar(iron, v(x + 3, plinth + 3.6, halfZ + 0.2), v(x + 3, 4.2, halfZ + 4.2), 0.14);
  if (d.has('rail-track')) {
    for (const dz of [-0.72, 0.72]) k.block(iron, 0, 0.04, halfZ + 6.5 + dz, 40, 0.12, 0.12);
    for (let x = -19; x <= 19; x += 1.2) k.block(k.at('timber', FOUNDATION), x, 0, halfZ + 6.5, 0.3, 0.08, 2.4);
    for (const x of [-3, 4]) {
      k.block(k.at('timber', FINISH), x, 1.0, halfZ + 6.5, 5.5, 2.0, 2.4);
      for (const dx of [-1.8, 1.8]) for (const dz of [-1.1, 1.1]) k.disc(iron, v(x + dx, 0.5, halfZ + 6.5 + dz), 'z', 0.45, 0.15, 10);
    }
  }

  // Engine house at the east end: tall, with a great arched opening onto the flywheel.
  const ex0 = x1, ex1 = x1 + 6.5, engineTop = wallTop - 2;
  k.block(k.at('stone', FOUNDATION), (ex0 + ex1) / 2, -0.4, 0, ex1 - ex0 + 0.3, 1.0, 9.0);
  k.block(brick, (ex0 + ex1) / 2, 0.6, -4.3, ex1 - ex0, engineTop - 0.6, 0.5);
  k.block(brick, ex1 - 0.25, 0.6, 0, 0.5, engineTop - 0.6, 9.0);
  for (const x of [ex0 + 0.4, ex1 - 0.4]) k.block(brick, x, 0.6, 4.3, 0.8, engineTop - 0.6, 0.5);
  k.block(brick, (ex0 + ex1) / 2, engineTop - 2.0, 4.3, ex1 - ex0, 2.0, 0.5);
  // Glazing bars across the opening, so the engine is seen through a screen, not a hole.
  for (let x = ex0 + 1.1; x < ex1 - 0.6; x += 0.9) k.bar(iron, v(x, 0.6, 4.4), v(x, engineTop - 2.0, 4.4), 0.06);
  for (let y = 2.6; y < engineTop - 2; y += 1.8) k.bar(iron, v(ex0 + 0.8, y, 4.4), v(ex1 - 0.8, y, 4.4), 0.05);
  k.gableEnds(brick, (ex0 + ex1) / 2, engineTop, 0, ex1 - ex0, 9.0, 1.8, 'x');
  k.gableRoof(k.at('roof-tile', ROOF), (ex0 + ex1) / 2, engineTop, 0, ex1 - ex0, 9.0, 1.8, 0.3, 'x');

  // Boiler house and stack beyond it.
  k.block(brick, ex1 + 4.5, 0, -0.5, 8.5, 4.4, 7.0);
  k.gableRoof(k.at('roof-metal', ROOF), ex1 + 4.5, 4.4, -0.5, 8.5, 7.0, 1.2, 0.2, 'x');
  for (const z of [-2.0, 1.0]) k.cyl(k.at('metal', FITOUT), v(ex1 + 8.8, 1.3, z), v(ex1 + 9.2, 1.3, z), 1.1, 1.1, 12);
  k.cyl(k.at('ground', FINISH), v(ex1 + 11, 0, 3.4), v(ex1 + 11, 1.4, 3.4), 2.0, 0.3, 9);
  if (d.has('chimney')) {
    const sx = ex1 + 6.5, sz = -6.0;
    k.block(brick, sx, -0.3, sz, 3.2, 3.6, 3.2);
    k.cyl(brick, v(sx, 3.3, sz), v(sx, 30, sz), 1.35, 0.85, 14);
    k.cyl(k.at('stone', FINISH), v(sx, 29, sz), v(sx, 30.6, sz), 1.15, 1.15, 14);
  }

  if (d.has('line-shaft')) {
    // The engine train: flywheel and crank, piston, ropes, and a pulley on every floor.
    const flyX = ex0 + 1.8, flyY = 3.6, flyR = 3.1;
    k.block(k.at('stone', FOUNDATION), flyX, -0.3, 0, 1.0, flyY - 0.3, 1.6);
    const flyPivot = v(flyX, flyY, 0);
    const fly = k.rotor('Flywheel', flyPivot, 'metal', UTILITIES, { axis: 'x', drive: 'engine' });
    k.rim(fly, flyPivot, 'x', flyR, 0.32, 32);
    for (const dx of [-0.2, 0.2]) k.rim(fly, v(flyX + dx, flyY, 0), 'x', flyR + 0.06, 0.06, 32);
    for (let arm = 0; arm < 8; arm += 1) k.bar(fly, flyPivot, k.onCircle(flyPivot, 'x', flyR, (arm / 8) * Math.PI * 2), 0.22, 0.14, v(1, 0, 0));
    k.disc(fly, flyPivot, 'x', 0.5, 0.6, 12);
    k.cyl(fly, v(flyX - 0.5, flyY, 0), v(flyX + 2.4, flyY, 0), 0.18, 0.18, 8);
    // Crank disc at the end of the shaft.
    k.disc(fly, v(flyX + 2.4, flyY, 0), 'x', 0.7, 0.18, 12);
    k.sweep(flyPivot, flyR, 'x');
    // A horizontal cylinder bedded on stone, its piston rod driving toward the crank.
    const cylinderZ = -2.9;
    k.block(k.at('stone', FITOUT), flyX + 2.4, 0.6, -1.9, 1.2, 1.4, 4.4);
    k.cyl(iron, v(flyX + 2.4, flyY - 0.4, cylinderZ - 1.0), v(flyX + 2.4, flyY - 0.4, cylinderZ + 0.6), 0.65, 0.65, 14);
    const piston = k.rotor('Piston rod and crosshead', v(flyX + 2.4, flyY - 0.4, -1.5), 'metal', UTILITIES, {
      axis: 'z', drive: 'engine', motion: 'reciprocate', stroke: 0.65,
    });
    k.bar(piston, v(flyX + 2.4, flyY - 0.4, cylinderZ + 0.6), v(flyX + 2.4, flyY - 0.4, -0.9), 0.1);
    k.box(piston, flyX + 2.4, flyY - 0.4, -0.9, 0.4, 0.4, 0.4);
    // The governor: two balls spinning on a spindle above the cylinder.
    const governorPivot = v(flyX + 2.4, flyY + 1.0, cylinderZ - 0.2);
    const governor = k.rotor('Governor', governorPivot, 'metal', FITOUT, { axis: 'y', drive: 'engine', ratio: 2 });
    k.bar(governor, governorPivot, v(governorPivot.x, governorPivot.y + 0.9, governorPivot.z), 0.06);
    for (const side of [-1, 1]) {
      const ball = v(governorPivot.x + side * 0.35, governorPivot.y + 0.55, governorPivot.z);
      k.bar(governor, v(governorPivot.x, governorPivot.y + 0.9, governorPivot.z), ball, 0.04);
      k.cyl(governor, v(ball.x, ball.y - 0.12, ball.z), v(ball.x, ball.y + 0.12, ball.z), 0.12, 0.12, 8);
    }
    // The rope race: a fan of ropes from the flywheel rim to a pulley on each floor's line shaft.
    const ropes = k.at('canvas', UTILITIES);
    const pulleyR = 0.75;
    for (let floor = 1; floor < floors; floor += 1) {
      const py = plinth + floor * storey + 2.3;
      const pivot = v(flyX, py, 0);
      const pulley = k.rotor(`Line shaft pulley ${floor}`, pivot, 'metal', UTILITIES, { axis: 'x', drive: 'engine', ratio: flyR / pulleyR });
      k.gear(pulley, pivot, 'x', pulleyR, 0.5, 18);
      k.cyl(pulley, v(x1 - 0.3, py, 0), v(flyX + 0.4, py, 0), 0.12, 0.12, 8);
      for (const side of [-1, 1]) {
        const dx = (floor - floors / 2) * 0.09;
        k.bar(ropes, v(flyX + dx, flyY, side * flyR), v(flyX + dx, py, side * pulleyR), 0.04);
      }
    }
  }
  sackPile(d, -8, halfZ + 2.6, 6);
  barrels(d, 10, 6.0, 4);
}

/**
 * The processing plant: concrete silos, a headhouse, and a conveyor gallery to the mill.
 *
 * Grain is stored and moved in bulk. The silo battery is the silhouette; the mill becomes a
 * flat-roofed block of ribbon windows, and the machinery that shows is the conveyor and the
 * roof ventilators turning over the milling floors.
 */
function processingPlant(d: Draft): void {
  const { k } = d;
  yard(d, 0, 2, 40, 22);
  const concrete = k.at('brick', WALLS);
  // Silo battery: two rows of four, with a headhouse along the top.
  const siloTop = 24;
  for (let row = 0; row < 2; row += 1) {
    for (let index = 0; index < 4; index += 1) {
      const x = -16 + index * 4.6, z = -2.3 + row * 4.6;
      k.cyl(concrete, v(x, -0.3, z), v(x, siloTop, z), 2.3, 2.3, 16);
    }
  }
  k.block(concrete, -9.1, siloTop, 0, 16, 3.2, 4.4);
  k.block(concrete, -2.8, -0.3, 0, 3.4, siloTop + 7.5, 3.4);
  // The mill block, flat-roofed, with ribbon windows.
  k.block(k.at('stone', FOUNDATION), 9, -0.3, 0, 16.4, 0.6, 12.4);
  k.block(concrete, 9, 0.3, 0, 16, 16, 12);
  const dark = k.at('shadow', FITOUT);
  for (let floor = 0; floor < 4; floor += 1) {
    const y = 0.3 + floor * 4 + 2.4;
    k.block(dark, 9, y - 0.7, 6.02, 14.6, 1.4, 0.1);
    k.block(dark, 9, y - 0.7, -6.02, 14.6, 1.4, 0.1);
  }
  k.block(concrete, 9, 16.3, 0, 16.4, 0.6, 12.4);
  // The conveyor gallery from the headhouse to the mill roof.
  const gallery = k.at('panel', UTILITIES);
  k.obox(gallery, v(3.6, 21.4, 0), v(1, -0.48, 0), v(0, 1, 0), 12.4, 2.2, 2.2);
  if (d.has('conveyor')) {
    for (const [x, z] of [[5, -3], [13, 3]] as const) {
      const pivot = v(x, 17.2, z);
      const fan = k.rotor(`Roof ventilator ${x}`, pivot, 'metal', FINISH, { axis: 'y', drive: 'engine', ratio: 0.8 });
      k.cyl(k.at('metal', FINISH), v(x, 16.6, z), v(x, 17.0, z), 0.9, 0.9, 12);
      for (let blade = 0; blade < 6; blade += 1) {
        const angle = (blade / 6) * Math.PI * 2;
        k.obox(fan, v(x + Math.cos(angle) * 0.5, 17.4, z + Math.sin(angle) * 0.5), v(Math.cos(angle), 0, Math.sin(angle)), v(-Math.sin(angle) * 0.5, 1, Math.cos(angle) * 0.5), 0.8, 0.7, 0.04);
      }
      k.cyl(fan, v(x, 17.75, z), v(x, 18.1, z), 0.95, 0.2, 12);
    }
  }
  // Truck intake shed.
  k.block(k.at('roof-metal', ROOF), -9, 5.2, 7.6, 10, 0.2, 5.0);
  for (const x of [-13.6, -4.4]) for (const z of [5.4, 9.8]) k.bar(k.at('metal', FRAME), v(x, 0, z), v(x, 5.2, z), 0.24);
}

// ---------------------------------------------------------------------------- sawmills

/**
 * A water-powered frame saw: the wheel's crank lifts and drops a framed blade, and a slow log
 * carriage feeds the log through it. Classical shed on the ground; early-modern on a stone
 * undercroft with the saw floor open above it and a slipway to haul logs up.
 */
function sawmill(d: Draft, kind: 'water' | 'sash'): void {
  const { k } = d;
  const deck = kind === 'sash' ? 3.4 : 1.1;
  const x0 = kind === 'sash' ? -6 : -5.4, x1 = kind === 'sash' ? 7 : 6;
  const halfZ = kind === 'sash' ? 3.0 : 2.6;
  const eave = deck + 3.0;
  yard(d, 2, 1, 26, 13);
  const frame = k.at('timber', FRAME);
  if (kind === 'sash') {
    // A stone undercroft holds the crank pit; arched openings show the drive.
    const stone = k.at('stone', WALLS);
    k.block(stone, (x0 + x1) / 2, -0.4, -halfZ + 0.3, x1 - x0, deck + 0.4, 0.6);
    for (const x of [x0 + 0.4, 0, x1 - 0.4]) k.block(stone, x, -0.4, halfZ - 0.3, 0.8, deck + 0.4, 0.6);
    k.block(stone, (x0 + x1) / 2, deck - 0.6, halfZ - 0.3, x1 - x0, 0.6, 0.6);
    k.block(stone, x1 - 0.3, -0.4, 0, 0.6, deck + 0.4, halfZ * 2);
    k.block(stone, x0 + 0.3, -0.4, -1.6, 0.6, deck + 0.4, halfZ * 2 - 3.2);
  } else {
    for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 4) for (const z of [-halfZ, halfZ]) k.bar(frame, v(x, -0.3, z), v(x, deck, z), 0.26);
  }
  // The saw floor and the open shed over it.
  k.block(k.at('timber', FRAME), (x0 + x1) / 2, deck - 0.14, 0, x1 - x0 + 0.4, 0.14, halfZ * 2 + 0.4);
  for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 4) {
    for (const z of [-halfZ, halfZ]) {
      k.bar(frame, v(x, deck, z), v(x, eave, z), 0.24);
      k.bar(frame, v(x, eave - 0.9, z), v(x + Math.sign(-x || 1) * 0.6, eave, z), 0.12);
    }
    k.bar(frame, v(x, eave, -halfZ - 0.2), v(x, eave, halfZ + 0.2), 0.2);
  }
  for (const z of [-halfZ, halfZ]) k.bar(frame, v(x0 - 0.2, eave, z), v(x1 + 0.2, eave, z), 0.2);
  k.gableRoof(k.at('roof-tile', ROOF), (x0 + x1) / 2, eave, 0, x1 - x0, halfZ * 2, 2.0, 0.6, 'x');
  // A half-height board wall on the weather side only: the rest stays open for light and logs.
  k.block(k.at('brick', WALLS), (x0 + x1) / 2, deck, -halfZ, x1 - x0, 1.2, 0.1);

  // The wheel and race on the west, crank at the end of its axle under the saw.
  const radius = kind === 'sash' ? 2.3 : 1.7, width = 1.0;
  const wheelX = x0 - 1.4, wheelY = kind === 'sash' ? 2.3 : 1.6;
  const crankX = x0 + 1.4, crankR = 0.42;
  race(d, wheelX - 0.95, wheelX + 0.95, -6, 6, 0.15, 1.0);
  k.water(k.at('water', SITE), wheelX - 0.7, wheelX + 0.7, 6, 10, 0.12);
  sluice(d, wheelX - 0.8, wheelX + 0.8, -5.6, 1.9, 0.7);
  const sawX = crankX, sawY = deck;
  if (d.has('waterwheel')) {
    const pivot = v(wheelX, wheelY, 0);
    const spec = { axis: 'x' as const, drive: 'water-wheel' as const };
    const wheel = k.rotor('Saw wheel', pivot, 'timber', UTILITIES, spec);
    k.waterWheel(wheel, pivot, radius, width, 'undershot');
    k.cyl(wheel, v(wheelX + width / 2, wheelY, 0), v(crankX + 0.2, wheelY, 0), 0.22, 0.22, 8);
    k.disc(wheel, v(crankX, wheelY, 0), 'x', crankR + 0.12, 0.16, 12);
    const crankPin = k.rotor('Saw wheel', pivot, 'metal', UTILITIES, spec);
    k.bar(crankPin, v(crankX - 0.1, wheelY + crankR, 0), v(crankX + 0.15, wheelY + crankR, 0), 0.1);
    k.sweep(pivot, radius, 'x');
    for (const x of [wheelX + width / 2 + 0.6, crankX - 0.5]) k.block(k.at('timber', FRAME), x, -0.3, 0, 0.4, wheelY - 0.1, 0.5);
  }
  if (d.has('saw-carriage')) {
    // Guides the sash rides in, standing either side of the log line.
    const guide = k.at('timber', FITOUT);
    for (const z of [-0.55, 0.55]) {
      k.bar(guide, v(sawX - 0.5, sawY, z), v(sawX - 0.5, sawY + 2.6, z), 0.18);
      k.bar(guide, v(sawX + 0.5, sawY, z), v(sawX + 0.5, sawY + 2.6, z), 0.18);
    }
    k.bar(guide, v(sawX - 0.6, sawY + 2.6, -0.65), v(sawX + 0.6, sawY + 2.6, 0.65), 0.14);
    k.bar(guide, v(sawX - 0.6, sawY + 2.6, 0.65), v(sawX + 0.6, sawY + 2.6, -0.65), 0.14);
    // The sash: a frame carrying the blade(s), lifted by a pitman rod from the crank.
    const sashBase = v(sawX, sawY + 1.2, 0);
    const sash = k.rotor('Saw sash', sashBase, 'timber', FITOUT, {
      axis: 'y', drive: 'water-wheel', motion: 'reciprocate', stroke: crankR, phase: Math.PI / 2,
    });
    for (const dx of [-0.38, 0.38]) k.bar(sash, v(sawX + dx, sawY + 0.25, 0), v(sawX + dx, sawY + 2.1, 0), 0.12);
    for (const y of [sawY + 0.25, sawY + 2.1]) k.bar(sash, v(sawX - 0.42, y, 0), v(sawX + 0.42, y, 0), 0.12);
    const blades = k.rotor('Saw sash', sashBase, 'metal', FITOUT, {
      axis: 'y', drive: 'water-wheel', motion: 'reciprocate', stroke: crankR, phase: Math.PI / 2,
    });
    const count = kind === 'sash' ? 3 : 1;
    for (let index = 0; index < count; index += 1) {
      const dz = (index - (count - 1) / 2) * 0.12;
      k.box(blades, sawX, sawY + 1.17, dz, 0.2, 1.8, 0.015);
    }
    // The pitman: down through a slot in the floor to the crank pin.
    k.bar(blades, v(sawX, sawY + 0.25, 0), v(sawX, wheelY + crankR, 0), 0.08);
    // The log carriage on its rails, fed slowly through the blade by a ratchet off the sash.
    const rails = k.at('metal', FITOUT);
    for (const z of [-0.45, 0.45]) k.block(rails, (sawX + x1) / 2, sawY, z, x1 - sawX + 1.5, 0.06, 0.08);
    const carriagePivot = v(sawX + 2.6, sawY + 0.1, 0);
    const carriage = k.rotor('Log carriage', carriagePivot, 'timber', FITOUT, {
      axis: 'x', drive: 'water-wheel', motion: 'reciprocate', stroke: 1.4, ratio: 0.04,
    });
    k.block(carriage, sawX + 2.6, sawY + 0.06, 0, 4.4, 0.2, 1.1);
    k.cyl(carriage, v(sawX + 0.6, sawY + 0.6, 0), v(sawX + 4.6, sawY + 0.6, 0), 0.34, 0.3, 10);
    // Sawdust heaps under the blade.
    k.cyl(k.at('canvas', FINISH), v(sawX, 0, 1.6), v(sawX, 0.5, 1.6), 1.1, 0.1, 10);
  }
  // Log yard: a pile, skids up to the saw floor, and sawn boards drying under the eaves.
  k.logPile(k.at('timber', FINISH), x1 + 4.5, -1.5, 5.0, 4, Math.PI / 2);
  if (kind === 'sash') {
    // The slipway the logs are hauled up, and the capstan that hauls them.
    k.bar(frame, v(x1 + 6, 0, 0.8), v(x1 + 0.2, deck, 0.8), 0.24);
    k.bar(frame, v(x1 + 6, 0, -0.8), v(x1 + 0.2, deck, -0.8), 0.24);
    k.cyl(k.at('timber', FITOUT), v(x1 - 0.8, deck, -1.8), v(x1 - 0.8, deck + 1.0, -1.8), 0.3, 0.3, 8);
    k.bar(k.at('timber', FITOUT), v(x1 - 1.9, deck + 0.85, -1.8), v(x1 + 0.3, deck + 0.85, -1.8), 0.08);
  } else {
    for (const z of [-0.7, 0.7]) k.bar(frame, v(x1 + 3, 0, z), v(x1 + 0.2, deck, z), 0.2);
  }
  k.boardStack(k.at('timber', FINISH), (x0 + x1) / 2, halfZ + 2.2, 5.0, 1.4, 6);
  k.boardStack(k.at('timber', FINISH), (x0 + x1) / 2 + 3.5, halfZ + 2.2, 4.2, 1.2, 4);
  for (let index = 0; index < 4; index += 1) k.bar(k.at('timber', FINISH), v(x0 - 0.5 + index * 0.4, 0, -halfZ - 1.0), v(x0 - 0.4 + index * 0.4, 2.6, -halfZ - 1.4), 0.24, 0.08);
}

/**
 * The steam sawmill: a long open shed where a circular saw runs off belts from an engine.
 *
 * Every link of the drive is visible: the engine's flywheel belts down to a line shaft under the
 * saw floor, the shaft belts up to the saw arbor, the blade spins, and the carriage runs the log
 * back and forth past it. Out in the yard, a tall wigwam burner takes the slabs and sawdust.
 */
function steamSawmill(d: Draft): void {
  const { k } = d;
  const deck = 1.2, eave = deck + 4.0;
  const x0 = -11, x1 = 11, halfZ = 4;
  yard(d, 2, 1, 40, 18);
  const frame = k.at('timber', FRAME);
  k.block(k.at('timber', FRAME), 0, deck - 0.16, 0, x1 - x0, 0.16, halfZ * 2);
  for (let x = x0; x <= x1 + 1e-6; x += 2.75) {
    for (const z of [-halfZ, halfZ]) {
      k.bar(frame, v(x, -0.3, z), v(x, eave, z), 0.28);
      k.bar(frame, v(x, eave - 1.0, z), v(x + 0.7, eave, z), 0.12);
    }
    k.bar(frame, v(x, deck - 0.2, -halfZ), v(x, deck - 0.2, halfZ), 0.24);
  }
  // Monitor roof: a raised clerestory along the ridge to light and vent the saw floor.
  k.gableRoof(k.at('roof-metal', ROOF), 0, eave, 0, x1 - x0, halfZ * 2, 1.4, 0.5, 'x');
  k.block(k.at('brick', ROOF), 0, eave + 1.1, 0, x1 - x0 - 2, 1.0, 2.2);
  k.gableRoof(k.at('roof-metal', ROOF), 0, eave + 2.1, 0, x1 - x0 - 2, 2.2, 0.6, 0.3, 'x');
  k.block(k.at('brick', WALLS), 0, deck, -halfZ, x1 - x0, 1.4, 0.12);

  // Engine house on the east with its boiler and stack.
  const brick = k.at('brick', WALLS);
  const ex = x1 + 4.0;
  k.block(brick, ex, -0.3, -2.5, 6, 6.3, 0.5);
  k.block(brick, ex + 2.75, -0.3, 0, 0.5, 6.3, 5.5);
  k.block(brick, ex, 4.4, 2.5, 6, 1.6, 0.5);
  for (const x of [ex - 2.75, ex + 2.5]) k.block(brick, x, -0.3, 2.5, 0.5, 6.3, 0.5);
  k.gableRoof(k.at('roof-metal', ROOF), ex, 6.0, 0, 6, 5.5, 1.2, 0.2, 'x');
  k.cyl(k.at('metal', FITOUT), v(ex + 5.0, 1.2, -1.6), v(ex + 9.0, 1.2, -1.6), 1.1, 1.1, 12);
  if (d.has('chimney')) {
    k.block(brick, ex + 8.2, -0.3, -3.6, 2.0, 2.0, 2.0);
    k.cyl(brick, v(ex + 8.2, 1.7, -3.6), v(ex + 8.2, 17, -3.6), 0.8, 0.55, 12);
  }
  // The wigwam burner: an iron cone with a mesh crown, fed by a conveyor of slabs and dust.
  const bx = -x0 + 9;
  k.cyl(k.at('metal', WALLS), v(bx, -0.2, -6), v(bx, 9, -6), 3.2, 1.2, 16, false);
  k.cyl(k.at('shadow', ROOF), v(bx, 9, -6), v(bx, 10.6, -6), 1.2, 0.5, 16);
  k.bar(k.at('metal', UTILITIES), v(x1 - 1, deck + 0.4, -3), v(bx - 1.6, 6.8, -5.4), 0.6, 0.4);

  const iron = k.at('metal', UTILITIES);
  const belts = k.at('shadow', UTILITIES);
  const flyPivot = v(ex, 2.1, 0.6), flyR = 1.9;
  const shaftY = deck - 0.75, arborY = deck + 0.9, sawX = -2;
  if (d.has('line-shaft')) {
    const fly = k.rotor('Engine flywheel', flyPivot, 'metal', UTILITIES, { axis: 'z', drive: 'engine' });
    k.rim(fly, flyPivot, 'z', flyR, 0.24, 28);
    for (let arm = 0; arm < 6; arm += 1) k.bar(fly, flyPivot, k.onCircle(flyPivot, 'z', flyR, (arm / 6) * Math.PI * 2), 0.18, 0.12, v(0, 0, 1));
    k.disc(fly, flyPivot, 'z', 0.4, 0.5, 10);
    k.sweep(flyPivot, flyR, 'z');
    k.cyl(iron, v(ex - 0.5, 1.6, -2.0), v(ex + 1.4, 1.6, -2.0), 0.55, 0.55, 12);
    const piston = k.rotor('Engine piston rod', v(ex + 0.4, 1.6, -0.6), 'metal', UTILITIES, { axis: 'x', drive: 'engine', motion: 'reciprocate', stroke: 0.45 });
    k.bar(piston, v(ex + 1.4, 1.6, -0.6), v(ex - 0.4, 1.6, -0.6), 0.1);
    // Line shaft under the saw floor, running the length of the mill.
    const shaftPivot = v(0, shaftY, 0.6);
    const shaft = k.rotor('Line shaft', shaftPivot, 'metal', UTILITIES, { axis: 'z', drive: 'engine', ratio: flyR / 0.6 });
    k.disc(shaft, v(x1 - 0.6, shaftY, 0.6), 'z', 0.6, 0.4, 12);
    k.disc(shaft, v(sawX, shaftY, 0.6), 'z', 0.75, 0.35, 12);
    k.bar(shaft, v(x1 - 0.6, shaftY, 0.2), v(x1 - 0.6, shaftY, 1.0), 0.18);
    // Belts: flywheel to shaft pulley, shaft pulley up to the saw arbor.
    for (const dy of [-1, 1]) {
      k.bar(belts, v(ex, 2.1 + dy * flyR, 0.6), v(x1 - 0.6, shaftY + dy * 0.6, 0.6), 0.04, 0.3, v(0, 0, 1));
      k.bar(belts, v(sawX + dy * 0.75, shaftY, 0.6), v(sawX + dy * 0.25, arborY, 0.6), 0.04, 0.26, v(0, 0, 1));
    }
  }
  if (d.has('saw-carriage')) {
    // The circular saw on its arbor, spinning in the plane of the log.
    const arborPivot = v(sawX, arborY, 0.6);
    const arbor = k.rotor('Circular saw', arborPivot, 'metal', FITOUT, { axis: 'z', drive: 'engine', ratio: (flyR / 0.6) * (0.75 / 0.25) * 0.4 });
    k.disc(arbor, v(sawX, arborY, 0.3), 'z', 1.0, 0.02, 28);
    for (let tooth = 0; tooth < 28; tooth += 1) {
      const p = k.onCircle(v(sawX, arborY, 0.3), 'z', 1.04, (tooth / 28) * Math.PI * 2);
      k.box(arbor, p.x, p.y, p.z, 0.07, 0.07, 0.03);
    }
    k.disc(arbor, arborPivot, 'z', 0.25, 0.3, 10);
    k.block(k.at('metal', FITOUT), sawX, deck, 0.9, 1.4, arborY - deck - 0.2, 0.5);
    // Carriage track and the carriage running the log past the blade.
    const rails = k.at('metal', FITOUT);
    for (const z of [-0.7, -0.1]) k.block(rails, 0, deck, z, x1 - x0 - 1, 0.06, 0.1);
    const carriage = k.rotor('Log carriage', v(sawX + 3, deck + 0.2, -0.4), 'timber', FITOUT, {
      axis: 'x', drive: 'engine', motion: 'reciprocate', stroke: 3.2, ratio: 0.06,
    });
    k.block(carriage, sawX + 3, deck + 0.05, -0.4, 5.2, 0.3, 1.1);
    for (const x of [sawX + 1.2, sawX + 4.8]) k.block(carriage, x, deck + 0.35, -0.85, 0.3, 0.9, 0.3);
    k.cyl(carriage, v(sawX + 0.6, deck + 0.85, -0.4), v(sawX + 5.4, deck + 0.85, -0.4), 0.45, 0.4, 10);
  }
  // Log deck with skidways from the yard, lumber stacks and the slab pile.
  for (const z of [-2.5, 0, 2.5]) k.bar(frame, v(x0 - 5, 0, z), v(x0, deck, z), 0.24);
  k.logPile(k.at('timber', FINISH), x0 - 7, 0, 6, 4, Math.PI / 2);
  k.logPile(k.at('timber', FINISH), x0 - 7, -7, 6, 3, Math.PI / 2);
  for (let index = 0; index < 4; index += 1) k.boardStack(k.at('timber', FINISH), -8 + index * 4.6, halfZ + 3.0, 4.0, 1.6, 7 + (index % 2) * 2);
  k.cyl(k.at('canvas', FINISH), v(x1 + 1.5, 0, 5), v(x1 + 1.5, 1.2, 5), 2.2, 0.2, 10);
}

// ---------------------------------------------------------------------------- windmills

/** Sails on a hub, as a rotor riding on a yawing cap or buck. */
function sailCross(
  d: Draft, hub: { x: number; y: number; z: number }, radius: number, count: number,
  style: 'common' | 'patent' | 'multiblade', parent: string | undefined, name = 'Sails',
): void {
  if (!d.has('windshaft')) return;
  const spec = { axis: 'z' as const, drive: 'wind-sails' as const, ...(parent ? { parent } : {}) };
  const pivot = v(hub.x, hub.y, hub.z);
  const frame = d.k.rotor(name, pivot, style === 'multiblade' ? 'metal' : 'timber', FITOUT, spec);
  const cloth = d.k.rotor(name, pivot, style === 'multiblade' ? 'metal' : 'canvas', FITOUT, spec);
  d.k.sails(frame, cloth, pivot, radius, count, style);
  d.k.sweep(pivot, radius, 'z');
}

/**
 * The post mill: the whole mill turns on one post.
 *
 * A weatherboarded box — the buck — sits on a single oak post braced by quarter bars on two crossed
 * trees resting on brick piers. The miller pushes the tailpole round to face the sails into the
 * wind, so the buck, its ladder and its tailpole all yaw together, and the sails ride on it.
 */
function postMill(d: Draft): void {
  const { k } = d;
  yard(d, 0, 0, 15, 15);
  const piers = k.at('stone', FOUNDATION);
  for (const [x, z] of [[2.7, 0], [-2.7, 0], [0, 2.7], [0, -2.7]] as const) k.block(piers, x, -0.3, z, 0.9, 1.0, 0.9);
  const trestle = k.at('timber', FRAME);
  k.bar(trestle, v(-3.0, 0.85, 0), v(3.0, 0.85, 0), 0.36);
  k.bar(trestle, v(0, 1.2, -3.0), v(0, 1.2, 3.0), 0.36);
  k.bar(trestle, v(0, 0.7, 0), v(0, 3.9, 0), 0.6);
  for (const [x, z] of [[2.6, 0], [-2.6, 0], [0, 2.6], [0, -2.6]] as const) {
    k.bar(trestle, v(x, z === 0 ? 1.05 : 1.4, z), v(x * 0.08, 3.1, z * 0.08), 0.28);
  }
  // The buck: everything above the crown tree turns about the post.
  const pivot = v(0, 3.9, 0);
  const buckSpec = { axis: 'y' as const, drive: 'wind-sails' as const, motion: 'yaw' as const };
  const body = k.rotor('Buck', pivot, 'brick', WALLS, buckSpec);
  const wood = k.rotor('Buck', pivot, 'timber', WALLS, buckSpec);
  const roof = k.rotor('Buck', pivot, 'roof-tile', WALLS, buckSpec);
  const dark = k.rotor('Buck', pivot, 'shadow', WALLS, buckSpec);
  const bw = 3.4, bd = 4.8, bottom = 3.9, top = 8.6;
  k.block(wood, 0, bottom - 0.3, 0, 1.0, 0.3, bd + 0.4);
  k.block(body, 0, bottom, 0, bw, top - bottom, bd);
  // Weatherboarding: horizontal laps on the sides, reading at distance as ribbed timber.
  for (let y = bottom + 0.35; y < top; y += 0.35) {
    for (const x of [-bw / 2 - 0.03, bw / 2 + 0.03]) k.block(wood, x, y - 0.03, 0, 0.04, 0.05, bd);
  }
  k.gableEnds(body, 0, top, 0, bw, bd, 1.2, 'z');
  k.gableRoof(roof, 0, top, 0, bw, bd, 1.2, 0.2, 'z');
  k.window(dark, wood, v(bw / 2, bottom + 2.6, -0.8), v(1, 0, 0), 0.5, 0.6);
  // The breast, and the windshaft running out of it to the sails.
  k.block(wood, 0, top - 2.6, bd / 2 + 0.1, bw + 0.2, 2.2, 0.2);
  // The rear door, its porch, the ladder down, and the tailpole the miller winds the mill by.
  k.block(wood, 0, bottom + 0.4, -bd / 2 - 0.6, 1.6, 0.12, 1.2);
  k.door(wood, dark, v(0, bottom + 0.5, -bd / 2), v(0, 0, -1), 0.9, 1.8);
  k.ladder(wood, v(0, bottom + 0.5, -bd / 2 - 1.2), v(0, 0.05, -bd / 2 - 4.6), 0.8);
  k.bar(wood, v(0, bottom - 0.2, -bd / 2), v(0, 0.5, -bd / 2 - 5.6), 0.24);
  k.disc(wood, v(0, 0.55, -bd / 2 - 5.6), 'x', 0.5, 0.12, 10);
  k.sweep(v(0, 0, 0), bd / 2 + 5.8, 'y');
  const hub = v(0, top - 1.5, bd / 2 + 0.75);
  const radius = Math.min(7.6, hub.y - 0.7);
  if (d.has('windshaft')) k.cyl(wood, v(0, hub.y, bd / 2 - 0.5), v(0, hub.y, hub.z), 0.24, 0.24, 8);
  sailCross(d, hub, radius, 4, 'common', 'Buck');
  // A post mill grinds where it stands: sacks at the ladder foot, a cart backed up to them.
  sackPile(d, 2.4, -4.2, 4);
  k.cart(k.at('timber', FINISH), -3.6, -5.0, 0.6, k.at('canvas', FINISH));
}

/** A tapered octagon or round body, as stations of (height, radius). */
function taperedBody(d: Draft, b: Builder, from: number, to: number, r0: number, r1: number, segments: number): void {
  d.k.cyl(b, v(0, from, 0), v(0, to, 0), r0, r1, segments, false, segments === 8 ? Math.PI / 8 : 0);
}

/**
 * The smock mill: a timber tower on a brick base, with a reefing stage.
 *
 * Octagonal and boarded like a countryman's smock, standing on a two-storey brick base so its
 * sails clear the ground. The miller reefs the sails from the stage that runs round the top of the
 * base, and turns the cap with a tailpole and winding wheel that reach down to it.
 */
function smockMill(d: Draft): void {
  const { k } = d;
  yard(d, 0, 0, 16, 16);
  const baseTop = 5.0, stageR = 5.2, smockTop = 13.6, r0 = 3.7, r1 = 2.3;
  taperedBody(d, k.at('stone', FOUNDATION), -0.4, baseTop, 4.2, 4.0, 8);
  k.cyl(k.at('stone', WALLS), v(0, baseTop - 0.3, 0), v(0, baseTop, 0), 4.3, 4.3, 8, true, Math.PI / 8);
  // Stage: an octagonal deck with its brackets and railing.
  const timber = k.at('timber', FRAME);
  k.cyl(timber, v(0, baseTop, 0), v(0, baseTop + 0.22, 0), stageR, stageR, 8, true, Math.PI / 8);
  for (let index = 0; index < 8; index += 1) {
    const angle = Math.PI / 8 + (index / 8) * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    k.bar(timber, v(c * 4.0, baseTop - 1.6, s * 4.0), v(c * (stageR - 0.2), baseTop, s * (stageR - 0.2)), 0.16);
  }
  const rail: Vec3[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const angle = Math.PI / 8 + (index / 8) * Math.PI * 2;
    rail.push(v(Math.cos(angle) * (stageR - 0.15), baseTop + 0.22, Math.sin(angle) * (stageR - 0.15)));
  }
  k.railing(k.at('timber', FITOUT), rail);
  // The smock: boarded octagon with its corner posts.
  taperedBody(d, k.at('brick', WALLS), baseTop + 0.2, smockTop, r0, r1, 8);
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    k.bar(k.at('timber', WALLS), v(c * (r0 + 0.08), baseTop + 0.2, s * (r0 + 0.08)), v(c * (r1 + 0.08), smockTop, s * (r1 + 0.08)), 0.22);
  }
  for (let y = baseTop + 0.8; y < smockTop; y += 1.1) {
    const r = r0 + (r1 - r0) * ((y - baseTop) / (smockTop - baseTop)) + 0.04;
    k.rim(k.at('timber', WALLS), v(0, y, 0), 'y', r, 0.05, 8);
  }
  const dark = k.at('shadow', FITOUT), trim = k.at('timber', FITOUT);
  k.door(trim, dark, v(0, 0, 4.15), v(0, 0, 1), 1.2, 2.1);
  k.door(trim, dark, v(0, baseTop + 0.22, r0 - 0.05), v(0, 0, 1), 0.9, 1.9);
  k.window(dark, trim, v(-2.6, 2.6, 3.0), v(-0.7, 0, 0.7), 0.6, 0.8);
  k.window(dark, trim, v(0, 9.5, 3.15), v(0, 0, 1), 0.5, 0.7);
  // The cap: a boat-shaped thatched roof on a curb, turned by its tailpole.
  const capPivot = v(0, smockTop, 0);
  const capSpec = { axis: 'y' as const, drive: 'wind-sails' as const, motion: 'yaw' as const };
  const curb = k.rotor('Cap', capPivot, 'timber', ROOF, capSpec);
  const thatch = k.rotor('Cap', capPivot, 'roof-thatch', ROOF, capSpec);
  k.cyl(curb, v(0, smockTop, 0), v(0, smockTop + 0.4, 0), r1 + 0.25, r1 + 0.25, 8, true, Math.PI / 8);
  k.gableRoof(thatch, 0, smockTop + 0.4, 0, 3.4, 5.4, 2.4, 0.3, 'z', 0.4);
  k.gableEnds(curb, 0, smockTop + 0.4, 0, 3.4, 5.0, 2.4, 'z');
  // Tailpole and winding wheel, reaching down to the stage.
  k.bar(curb, v(0, smockTop + 0.3, -2.6), v(0, baseTop + 1.6, -stageR + 0.3), 0.22);
  for (const side of [-1, 1]) k.bar(curb, v(side * 1.2, smockTop + 0.2, -2.0), v(0, baseTop + 3.0, -stageR + 1.0), 0.12);
  k.disc(curb, v(0, baseTop + 1.4, -stageR + 0.3), 'z', 0.7, 0.12, 12);
  // Hub far enough forward that the lowest sail clears the smock batter and the stage rail.
  const hubY = smockTop + 1.1;
  const radius = hubY - (baseTop + 1.4 + 0.8);
  const tipY = hubY - radius;
  const smockRAtTip = r0 + (r1 - r0) * Math.max(0, (tipY - baseTop) / (smockTop - baseTop));
  const hub = v(0, hubY, Math.max(2.9, smockRAtTip + 0.6));
  k.cyl(curb, v(0, hubY, 1.2), v(0, hubY, hub.z), 0.24, 0.24, 8);
  sailCross(d, hub, radius, 4, 'common', 'Cap');
  sackPile(d, 2.6, 5.4, 4);
  k.cart(k.at('timber', FINISH), -4.0, 6.0, 0.4, k.at('canvas', FINISH));
}

/**
 * The tower mill: a masonry tower with a turning cap.
 *
 * Round, tapering and tall enough to clear the ground with long patent sails. Only the cap turns,
 * and a fantail on its back winds it into the wind without anyone at the tailpole — the detail
 * that makes a tower mill self-tending, and the fastest way to tell one from a smock at a glance.
 */
function towerMill(d: Draft): void {
  const { k } = d;
  yard(d, 0, 0.5, 16, 17);
  const towerTop = 14.5, r0 = 4.0, r1 = 2.7;
  k.cyl(k.at('stone', FOUNDATION), v(0, -0.4, 0), v(0, 0.6, 0), r0 + 0.3, r0 + 0.25, 16);
  taperedBody(d, k.at('brick', WALLS), 0.6, towerTop, r0, r1, 16);
  const radiusAt = (y: number): number => r0 + (r1 - r0) * Math.max(0, Math.min(1, (y - 0.6) / (towerTop - 0.6)));
  const dark = k.at('shadow', FITOUT), trim = k.at('stone', FITOUT);
  for (const [y, angle] of [[4.2, 0.3], [7.6, 2.2], [11.0, -0.6], [7.6, -2.5]] as const) {
    const r = radiusAt(y);
    k.window(dark, trim, v(Math.sin(angle) * r, y, Math.cos(angle) * r), v(Math.sin(angle), 0, Math.cos(angle)), 0.6, 0.9);
  }
  for (const angle of [0, Math.PI]) {
    const r = radiusAt(0.6);
    k.door(k.at('timber', FITOUT), dark, v(Math.sin(angle) * r, 0.6, Math.cos(angle) * r), v(Math.sin(angle), 0, Math.cos(angle)), 1.1, 2.2);
  }
  // The cap: an ogee dome on a curb, with its fantail staging at the back.
  const capPivot = v(0, towerTop, 0);
  const capSpec = { axis: 'y' as const, drive: 'wind-sails' as const, motion: 'yaw' as const };
  const curb = k.rotor('Cap', capPivot, 'timber', ROOF, capSpec);
  const skin = k.rotor('Cap', capPivot, 'roof-tile', ROOF, capSpec);
  k.cyl(curb, v(0, towerTop, 0), v(0, towerTop + 0.35, 0), r1 + 0.3, r1 + 0.3, 16);
  k.lathe(skin, 0, 0, [[towerTop + 0.35, r1 + 0.2], [towerTop + 0.9, r1 + 0.35], [towerTop + 1.7, r1 + 0.05], [towerTop + 2.5, r1 - 0.8], [towerTop + 3.1, 1.0], [towerTop + 3.45, 0.35]]);
  k.cyl(curb, v(0, towerTop + 3.4, 0), v(0, towerTop + 4.2, 0), 0.12, 0.05, 8);
  const fanCentre = v(0, towerTop + 2.4, -r1 - 2.6);
  for (const side of [-1, 1]) {
    k.bar(curb, v(side * 1.2, towerTop + 0.3, -r1 + 0.2), v(side * 0.3, fanCentre.y, fanCentre.z), 0.14);
    k.bar(curb, v(side * 1.2, towerTop + 0.3, -r1 + 0.2), v(side * 0.3, towerTop + 0.4, fanCentre.z + 0.3), 0.12);
  }
  // The fantail turns square to the sails; it rides on the cap with the same wind.
  const fanSpec = { axis: 'x' as const, drive: 'wind-sails' as const, parent: 'Cap', ratio: 2.4 };
  const fan = k.rotor('Fantail', fanCentre, 'canvas', FITOUT, fanSpec);
  const fanFrame = k.rotor('Fantail', fanCentre, 'timber', FITOUT, fanSpec);
  for (let blade = 0; blade < 8; blade += 1) {
    const angle = (blade / 8) * Math.PI * 2;
    const dir = v(0, Math.cos(angle), Math.sin(angle));
    k.bar(fanFrame, fanCentre, v(fanCentre.x, fanCentre.y + dir.y * 1.4, fanCentre.z + dir.z * 1.4), 0.06);
    k.obox(fan, v(fanCentre.x, fanCentre.y + dir.y * 0.9, fanCentre.z + dir.z * 0.9), dir, v(0.6, -dir.z, dir.y), 1.0, 0.45, 0.03);
  }
  // Sails: long patent sails, or occasionally five or six, which some districts favoured.
  const count = d.random.float() < 0.18 ? 5 : d.random.float() < 0.1 ? 6 : 4;
  const hubY = towerTop + 1.5;
  const radius = Math.min(11, hubY - 1.6);
  const hub = v(0, hubY, Math.max(r1 + 1.0, radiusAt(hubY - radius) + 0.7));
  k.cyl(curb, v(0, hubY, r1 - 0.4), v(0, hubY, hub.z), 0.26, 0.26, 8);
  sailCross(d, hub, radius, count, 'patent', 'Cap');
  if (d.has('grain-bin')) {
    // A brick store at the foot, its roof lean against the tower.
    k.block(k.at('brick', WALLS), -r0 - 1.8, 0, -1.0, 3.2, 2.6, 4.0);
    k.shedRoof(k.at('roof-tile', ROOF), -r0 - 3.5, -r0 + 0.1, -1.0, 3.6, -1.0, 3.6);
    k.gableRoof(k.at('roof-tile', ROOF), -r0 - 1.8, 2.6, -1.0, 3.2, 4.0, 0.8, 0.2, 'x');
  }
  sackPile(d, 2.4, 4.6, 5);
  k.cart(k.at('timber', FINISH), 4.6, 2.2, -0.8, k.at('canvas', FINISH));
}

// ---------------------------------------------------------------------------- wind pumps

/**
 * The polder wind pump: a thatched drainage mill lifting water with a scoop wheel.
 *
 * A steep thatched cone carries a small turning cap and sails; on its flank a scoop wheel in a
 * brick race lifts water from the low ditch into the high channel behind the dyke. The sails drive
 * the wheel through gearing inside the cone, so the wheel turns whenever the sails do.
 */
function polderWindPump(d: Draft): void {
  const { k } = d;
  yard(d, 1, 0, 12, 12);
  // Low ditch on the west, high channel on the east behind a dyke bank.
  k.water(k.at('water', SITE), -10, -5.4, -9, 9, 0.08);
  k.block(k.at('ground', FOUNDATION), 7.2, -0.3, 0, 3.0, 1.3, 18);
  k.water(k.at('water', SITE), 8.8, 11.5, -9, 9, 0.85);
  const bodyTop = 7.6, r0 = 2.8, r1 = 0.95;
  k.cyl(k.at('stone', FOUNDATION), v(0, -0.4, 0), v(0, 0.6, 0), r0 + 0.25, r0 + 0.2, 8, true, Math.PI / 8);
  taperedBody(d, k.at('roof-thatch', WALLS), 0.6, bodyTop, r0, r1, 8);
  k.door(k.at('timber', FITOUT), k.at('shadow', FITOUT), v(0, 0.6, r0 - 0.2), v(0, 0, 1), 0.9, 1.7);
  // The cap: a small gabled buck turning on the cone's top.
  const capPivot = v(0, bodyTop, 0);
  const capSpec = { axis: 'y' as const, drive: 'wind-sails' as const, motion: 'yaw' as const };
  const cap = k.rotor('Cap', capPivot, 'timber', ROOF, capSpec);
  const capRoof = k.rotor('Cap', capPivot, 'roof-thatch', ROOF, capSpec);
  k.block(cap, 0, bodyTop, 0, 1.8, 1.6, 2.4);
  k.gableRoof(capRoof, 0, bodyTop + 1.6, 0, 1.8, 2.4, 0.9, 0.2, 'z');
  k.bar(cap, v(0, bodyTop + 0.3, -1.2), v(0, 0.6, -5.2), 0.18);
  k.sweep(v(0, 0, 0), 5.3, 'y');
  const hubY = bodyTop + 0.9;
  const radius = hubY - 1.4;
  const coneRAtTip = r0 + (r1 - r0) * Math.max(0, ((hubY - radius) - 0.6) / (bodyTop - 0.6));
  const hub = v(0, hubY, Math.max(1.6, coneRAtTip + 0.6));
  k.cyl(cap, v(0, hubY, 1.0), v(0, hubY, hub.z), 0.18, 0.18, 8);
  sailCross(d, hub, radius, 4, 'common', 'Cap');
  // The scoop wheel race on the west flank, between the ditch and the channel.
  const wheelX = -4.4, wheelY = 1.0, wheelR = 2.0;
  const brick = k.at('stone', FOUNDATION);
  for (const z of [-0.7, 0.7]) k.block(brick, wheelX, -0.4, z, 3.0, 1.6, 0.35);
  k.water(k.at('water', FOUNDATION), wheelX - 1.5, wheelX + 1.5, -0.5, 0.5, 0.2);
  if (d.has('pump-rod') || d.has('windshaft')) {
    const pivot = v(wheelX, wheelY, 0);
    const wheel = k.rotor('Scoop wheel', pivot, 'timber', UTILITIES, { axis: 'z', drive: 'wind-sails', ratio: 0.35 });
    for (const dz of [-0.3, 0.3]) {
      k.rim(wheel, v(wheelX, wheelY, dz), 'z', wheelR, 0.1, 22);
      for (let arm = 0; arm < 6; arm += 1) k.bar(wheel, v(wheelX, wheelY, dz), k.onCircle(v(wheelX, wheelY, dz), 'z', wheelR, (arm / 6) * Math.PI * 2), 0.1, 0.1, v(0, 0, 1));
    }
    for (let scoop = 0; scoop < 20; scoop += 1) {
      const angle = (scoop / 20) * Math.PI * 2;
      k.bar(wheel, k.onCircle(pivot, 'z', wheelR * 0.75, angle), k.onCircle(pivot, 'z', wheelR * 1.1, angle + 0.1), 0.6, 0.05, v(0, 0, 1));
    }
    k.cyl(wheel, v(wheelX, wheelY, -0.6), v(wheelX, wheelY, 0.6), 0.16, 0.16, 8);
    k.sweep(pivot, wheelR * 1.1, 'z');
    // The wheel's shaft runs east into the cone, where the sails' upright drives it.
    k.block(k.at('timber', UTILITIES), wheelX + 1.8, wheelY - 0.2, 0, 1.6, 0.4, 0.4);
  }
  k.boardStack(k.at('timber', FINISH), 3.2, 3.6, 2.4, 0.8, 3);
}

/**
 * The lattice wind pump: a steel farm windmill.
 *
 * No building at all, just a tapering lattice tower, a fan of steel blades kept into the wind by a
 * tail vane, and a pump rod stroking up and down the tower's centre to a well head and its tank.
 */
function latticeWindPump(d: Draft): void {
  const { k } = d;
  yard(d, 1.2, 0, 9, 8);
  const top = 10.5, base = 1.5, head = 0.45;
  const steel = k.at('metal', FRAME);
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const;
  for (const [sx, sz] of corners) {
    k.block(k.at('stone', FOUNDATION), sx * base, -0.3, sz * base, 0.6, 0.6, 0.6);
    k.bar(steel, v(sx * base, 0.2, sz * base), v(sx * head, top, sz * head), 0.12);
  }
  const at = (y: number, sx: number, sz: number): Vec3 => {
    const half = base + (head - base) * ((y - 0.2) / (top - 0.2));
    return v(sx * half, y, sz * half);
  };
  for (let level = 0; level < 4; level += 1) {
    const y0 = 0.2 + level * 2.5, y1 = y0 + 2.5;
    for (let index = 0; index < 4; index += 1) {
      const [ax, az] = corners[index]!, [bx, bz] = corners[(index + 1) % 4]!;
      k.bar(steel, at(y1, ax, az), at(y1, bx, bz), 0.06);
      k.bar(steel, at(y0, ax, az), at(y1, bx, bz), 0.04);
      k.bar(steel, at(y0, bx, bz), at(y1, ax, az), 0.04);
    }
  }
  // A small platform and ladder for greasing the head.
  k.block(k.at('timber', FITOUT), 0, top - 0.6, 0, 1.6, 0.08, 1.6);
  k.ladder(steel, at(0.2, 1, 1), at(top - 0.6, 1, 1), 0.4);
  // The head: gearbox, tail boom and vane, turning to keep the wheel square to the wind.
  const headPivot = v(0, top, 0);
  const headSpec = { axis: 'y' as const, drive: 'wind-sails' as const, motion: 'yaw' as const };
  const gearbox = k.rotor('Pump head', headPivot, 'metal', ROOF, headSpec);
  k.block(gearbox, 0, top, 0.1, 0.5, 0.55, 1.1);
  k.bar(gearbox, v(0, top + 0.3, -0.4), v(0, top + 0.55, -3.4), 0.08);
  k.obox(gearbox, v(0, top + 0.8, -3.2), v(0, 0, 1), v(0, 1, 0), 1.6, 1.2, 0.04);
  const hub = v(0, top + 0.3, 1.0);
  sailCross(d, hub, 1.9, 18, 'multiblade', 'Pump head', 'Wheel');
  // The pump rod: stroking up and down the centre of the tower to the well head below.
  if (d.has('pump-rod')) {
    const rodPivot = v(0, top / 2, 0);
    const rod = k.rotor('Pump rod', rodPivot, 'metal', UTILITIES, { axis: 'y', drive: 'wind-sails', motion: 'reciprocate', stroke: 0.2, ratio: 1 / 3 });
    k.bar(rod, v(0, 1.4, 0), v(0, top - 0.1, 0), 0.05);
    const pump = k.at('metal', UTILITIES);
    k.cyl(pump, v(0, 0, 0), v(0, 1.3, 0), 0.16, 0.14, 8);
    k.bar(pump, v(0, 0.95, 0), v(1.3, 0.85, 0), 0.08);
  }
  // Stock tank and trough.
  const tank = k.at('metal', FINISH);
  k.cyl(tank, v(2.9, 0, 0), v(2.9, 0.75, 0), 1.5, 1.5, 18, false);
  k.water(k.at('water', FINISH), 1.6, 4.2, -1.1, 1.1, 0.68);
  k.block(k.at('timber', FINISH), 2.9, 0, 2.3, 2.4, 0.45, 0.6);
}
