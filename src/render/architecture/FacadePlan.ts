/** Canonical elevation contract shared by wall voids, joinery, frame members and SVG artwork.
 * Dimensions come exclusively from the resolved production grammar/spec. */
import { architecturalMasses, massPoint } from './ArchitectureMasses';
import type { BuildingGrammar } from '../assets/BuildingGrammar';
import type { BuildingSpec } from './BuildingSpec';
import { architecturalMaterial, type ArchitecturalMaterialId } from './MaterialLibrary';

export interface FacadeOpening {
  kind: 'door' | 'window';
  purpose?: 'entrance' | 'daylight' | 'wagon' | 'stock' | 'stall' | 'loading' | 'vent'; u: number; y: number; w: number; h: number;
  row: number; index: number;
}
export interface ElevationPlan {
  name: 'front' | 'rear' | 'right' | 'left';
  mass?: 'hall' | 'left-range' | 'right-range';
  originX: number; originZ: number; tangentX: number; tangentZ: number;
  normalX: number; normalZ: number; length: number;
  openings: readonly FacadeOpening[];
}
/** Structural members the frame emits proud of an elevation, in that elevation's (u, y) frame. */
export interface FacadeMembers {
  /** Vertical posts/pilasters: centre `u` and face width `w`, full wall height. */
  posts: readonly { u: number; w: number; corner: boolean }[];
}
export interface FacadePlan {
  version: 2;
  /** Materials actually emitted by equipment, annexes and inherited fabric as well as the shell. */
  surfaceMaterials?: readonly ArchitecturalMaterialId[];
  surfaceDomain?: { width: number; height: number; bottom: number };
  spec: BuildingSpec;
  elevations: readonly ElevationPlan[];
  /** One entry per elevation, same order. */
  members: readonly FacadeMembers[];
  /** Horizontal frame beams (sill/floor/head), as elevation-local centre heights above `floor`. */
  beams: readonly { y: number; h: number }[];
  /** Ornamental string courses (the culture pattern band), elevation-local centre and height. */
  bands: readonly { y: number; h: number }[];
  floor: number; wallTop: number;
  storeyHeight: number; storeys: number;
  roof: { geometry: readonly { batchKey: string; triangles: number; bounds: readonly number[] }[]; top: number; resolved: BuildingSpec['roof'] };
  materials: BuildingSpec['materials'];
  openingStyle: BuildingGrammar['openings'];
  pattern: BuildingGrammar['pattern'];
  postThickness: number;
  wallThickness: number;
  /** Openings are recessed into the wall by this depth (the reveal), measured from the face. */
  revealDepth: number;
}

export function wallFrames(halfWidth: number, halfDepth: number): Omit<ElevationPlan, 'openings'>[] {
  return [
    { name: 'front', originX: 0, originZ: halfDepth, tangentX: 1, tangentZ: 0, normalX: 0, normalZ: 1, length: halfWidth * 2 },
    { name: 'rear', originX: 0, originZ: -halfDepth, tangentX: -1, tangentZ: 0, normalX: 0, normalZ: -1, length: halfWidth * 2 },
    { name: 'right', originX: halfWidth, originZ: 0, tangentX: 0, tangentZ: -1, normalX: 1, normalZ: 0, length: halfDepth * 2 },
    { name: 'left', originX: -halfWidth, originZ: 0, tangentX: 0, tangentZ: 1, normalX: -1, normalZ: 0, length: halfDepth * 2 },
  ];
}

/**
 * Whether a composed building takes the hybrid SVG facade.
 *
 * Decided from the grammar alone so the composer can shape geometry for it (recessed reveals,
 * painted string courses) before the plan exists. Single-mass masonry workshop cores only:
 * annexes, mixed-generation fabric and open sheds keep their procedural surfaces.
 */
export function hybridFacadeEligible(grammar: BuildingGrammar, coreMaterial?: unknown): boolean {
  const spec = grammar.spec;
  return !!spec && spec.archetype === 'workshop' && !coreMaterial && spec.openness < 0.35
    && grammar.massing === 'single' && !spec.dwellingVariant
    && ['stone', 'ceramic'].includes(architecturalMaterial(spec.materials.wall).family);
}

/** Window-only artwork can dress later glass without repainting a metal, concrete or inherited wall. */
export function hybridGlazingEligible(grammar: BuildingGrammar): boolean {
  const spec = grammar.spec;
  return !!spec && (!spec.architecture?.composition || spec.architecture.composition==='single') && !!spec.openings.facade && !!spec.materials.glazing
    && architecturalMaterial(spec.materials.glazing).family === 'glass';
}

/** Fitted casing width, shared by the physical stiles/transoms and every painted pane edge. */
export function glazingFrameWidth(opening: Pick<FacadeOpening, 'w' | 'h'>, style: BuildingSpec['openings']['facade']): number {
  return Math.min(opening.w * 0.045, opening.h * 0.045, style === 'divided' ? 0.0045 : 0.003);
}

/** Depth of fitted joinery inside a closed masonry wall; shared by geometry and projection. */
export function facadeRevealDepth(grammar: BuildingGrammar, coreMaterial?: unknown): number {
  return hybridFacadeEligible(grammar, coreMaterial)
    ? Math.min(0.025, (grammar.wallThickness ?? 0.035) * 0.4) : 0;
}

/**
 * Frame rhythm. The single source for where `emitFrame` raises posts and runs beams, so the
 * painted elevation dresses exactly the members that stand proud of it.
 */
export function frameLayout(grammar: BuildingGrammar, halfWidth: number, halfDepth: number): {
  bayX: number[]; sideZ: number[]; beamYs: number[]; thickness: number;
} {
  const thickness = grammar.postThickness;
  const bayX: number[] = [];
  for (let index = 0; index <= grammar.bays; index += 1) bayX.push(-halfWidth + (grammar.width * index) / grammar.bays);
  // Support density is a family property: a timber frame is a thicket of members, a steel portal
  // frame is four stanchions and a clear span.
  const densityScale = grammar.supportDensity !== undefined ? 0.55 + grammar.supportDensity * 1.0 : 1;
  const sidePosts = Math.max(1, Math.round(grammar.bays * (grammar.depth / grammar.width) * densityScale));
  const sideZ: number[] = [];
  for (let index = 1; index < sidePosts; index += 1) sideZ.push(-halfDepth + (grammar.depth * index) / sidePosts);
  // Sill, mid-rail and head beams give the frame its horizontals (relative to the plinth top).
  const body = grammar.wallHeight * grammar.storeys;
  const beamYs = [thickness * 0.6, body - thickness * 0.6];
  if (grammar.storeys > 1) beamYs.splice(1, 0, grammar.wallHeight);
  return { bayX, sideZ, beamYs, thickness };
}

/** Members proud of each elevation, translated into that elevation's own u axis. */
export function facadeMembers(grammar: BuildingGrammar, halfWidth: number, halfDepth: number): FacadeMembers[] {
  // Functional frames sit within the envelope; there are no proud facade pilasters to paint.
  if (grammar.spec?.architecture) {
    if (grammar.spec.architecture.composition && grammar.spec.architecture.composition!=='single') return architecturalMasses(grammar).flatMap(m=>facadeMembers({...grammar,...m.grammar},m.grammar.width/2,m.grammar.depth/2));
    return facadeElevations(grammar,halfWidth,halfDepth,grammar.wallHeight*grammar.storeys).map(face=>({posts:functionalFramePosts(grammar.spec!,face,grammar.width/grammar.spec!.width)}));
  }
  const { bayX, sideZ, thickness } = frameLayout(grammar, halfWidth, halfDepth);
  const long = bayX.map(x => ({ x, corner: Math.abs(Math.abs(x) - halfWidth) < 1e-6 }));
  return wallFrames(halfWidth, halfDepth).map(face => {
    const along = face.tangentX !== 0
      ? long.map(p => ({ u: p.x * face.tangentX, w: thickness * (p.corner ? 1.3 : 1), corner: p.corner }))
      : [...sideZ.map(z => ({ u: z * face.tangentZ, w: thickness, corner: false })),
        // The long-elevation corner posts also stand at each end of the short elevations.
        { u: -halfDepth, w: thickness * 1.3, corner: true }, { u: halfDepth, w: thickness * 1.3, corner: true }];
    return { posts: along.sort((a, b) => a.u - b.u) };
  });
}

/** String-course heights for the culture pattern band, elevation-local. */
export function patternBandLevels(grammar: BuildingGrammar, bodyHeight: number): { y: number; h: number }[] {
  return Array.from({ length: grammar.patternBands }, (_, band) => {
    const t = grammar.patternBands === 1 ? 0.72 : 0.3 + (band / Math.max(1, grammar.patternBands - 1)) * 0.55;
    return { y: bodyHeight * t, h: Math.min(0.13, bodyHeight * 0.2) };
  });
}

/**
 * Door width.
 *
 * A structural family's opening dare is the strongest functional cue a building has: a cart
 * entrance in a steel shed and a doorway in a rubble wall are not the same hole. Shared with the
 * `doorWidth` hint other systems use to walk people to an entrance, so the two never disagree.
 */
export function doorWidthFor(grammar: BuildingGrammar): number {
  if (grammar.spec?.architecture) return functionalElevations(grammar.spec, grammar.width / 2, grammar.depth / 2, grammar.wallHeight * grammar.storeys)[0]!.openings.find(o => o.kind === 'door')!.w;
  if (grammar.spec?.dwellingVariant) return Math.min(0.22, grammar.width * 0.25);
  if (grammar.spec?.openings.facade) return Math.min(grammar.width * 0.3, grammar.spec.storeyHeight * grammar.width / grammar.spec.width * 0.65);
  if (grammar.openingWidth === undefined) return Math.min(grammar.width * 0.3, 0.34);
  return Math.min(grammar.width * 0.46, Math.max(0.16, grammar.openingWidth * 2.1));
}

export function doorHeightFor(grammar: BuildingGrammar, bodyHeight: number): number {
  if (grammar.spec?.architecture) return functionalElevations(grammar.spec, grammar.width/2, grammar.depth/2, bodyHeight)[0]!.openings.find(o=>o.kind==='door')!.h;
  if (grammar.spec?.openings.facade) return bodyHeight / grammar.windowRows * 0.82;
  return grammar.openingHeight !== undefined
    ? Math.min(bodyHeight * 0.82, Math.max(0.16, grammar.openingHeight * 2.4))
    : Math.min(bodyHeight * 0.78, 0.6);
}

export function windowDimensions(grammar: BuildingGrammar, bodyHeight: number): { width: number; height: number } {
  if (grammar.spec?.openings.facade) return { width: grammar.openingWidth!, height: Math.min(grammar.openingHeight!, bodyHeight / grammar.windowRows * 0.94) };
  const perRow = grammar.spec?.openings.columns ?? Math.max(1, grammar.bays - 1);
  const width = grammar.openingWidth !== undefined
    ? Math.max(0.02, Math.min(grammar.openingWidth, (grammar.width / (perRow + 1)) * 0.8))
    : Math.min(grammar.width / (perRow + 1) * 0.5, 0.2) * (grammar.openings === 'slit' ? 0.4 : 1);
  const height = grammar.openingHeight !== undefined
    ? Math.max(0.03, Math.min(grammar.openingHeight, bodyHeight * 0.62))
    : grammar.openings === 'slit' ? Math.min(bodyHeight * 0.4, 0.26) : Math.min(bodyHeight * 0.3, 0.22);
  return { width, height };
}

/** The sole opening layout: both the cut wall and the fitted opening read this array. */
export function facadeElevations(grammar: BuildingGrammar, halfW: number, halfD: number, height: number): ElevationPlan[] {
  if (grammar.spec?.architecture) return functionalElevations(grammar.spec, halfW, halfD, height);
  const doorWidth = doorWidthFor(grammar), doorHeight = doorHeightFor(grammar, height);
  const perRow = grammar.spec?.openings.columns ?? Math.max(1, grammar.bays - 1);
  const { width: w, height: h } = windowDimensions(grammar, height);
  return wallFrames(halfW, halfD).map((face, faceIndex) => {
    const openings: FacadeOpening[] = faceIndex === 0
      ? [{ kind: 'door', u: 0, y: doorHeight / 2, w: doorWidth, h: doorHeight, row: 0, index: 0 }] : [];
    const count = faceIndex >= 2 ? Math.max(1, Math.round(perRow * grammar.depth / grammar.width)) : perRow;
    if (grammar.openings !== 'flap') for (let row = 0; row < grammar.windowRows; row++) for (let index = 0; index < count; index++) {
      const u = -face.length / 2 + face.length * (grammar.spec?.openings.facade ? (index + 0.5) / count : (index + 1) / (count + 1));
      if (faceIndex === 0 && row === 0 && Math.abs(u) < doorWidth) continue;
      const y = grammar.spec?.openings.facade ? height * (row + 0.52) / grammar.windowRows
        : height * ((row + 1) / (grammar.windowRows + 1) + 0.08);
      openings.push({ kind: 'window', u, y, w, h, row, index });
    }
    return { ...face, openings };
  });
}

// ------------------------------------------------------------------------------- atlas layout

export const FACADE_ATLAS_SIZE = 1024;
/** Painted bleed around every elevation, in atlas pixels, so mip filtering never reaches a neighbour. */
export const FACADE_ATLAS_BLEED = 12;

export interface AtlasCell {
  /** Top-left of the elevation's own (unbled) rectangle, in atlas pixels (SVG space, y down). */
  x: number; y: number; width: number; height: number;
}

/**
 * Packs the four elevations at one uniform texel density.
 *
 * Every wall on the building is painted at the same pixels-per-unit, so a course, a joint or a
 * chisel stroke is the same size on every side and nothing smears across a corner. Tries one to
 * four elevations per row and keeps whichever arrangement gives the most pixels per unit.
 */
export function facadeAtlasLayout(plan: Pick<FacadePlan, 'elevations' | 'floor' | 'wallTop'>): { density: number; cells: AtlasCell[] } {
  const height = plan.wallTop - plan.floor;
  const size = FACADE_ATLAS_SIZE, pad = FACADE_ATLAS_BLEED * 2;
  let best = { density: 0, perRow: 2 };
  for (let perRow = 1; perRow <= 4; perRow++) {
    const rows = Math.ceil(plan.elevations.length / perRow);
    let widest = 0;
    for (let row = 0; row < rows; row++) {
      const lengths = plan.elevations.slice(row * perRow, row * perRow + perRow).map(e => e.length);
      widest = Math.max(widest, lengths.reduce((s, l) => s + l, 0));
    }
    const columns = Math.min(perRow, plan.elevations.length);
    const density = Math.min((size - pad * columns) / widest, (size - pad * rows) / (height * rows));
    if (density > best.density) best = { density, perRow };
  }
  const density = Math.floor(best.density * 100) / 100;
  const cells: AtlasCell[] = [];
  let x = 0, y = 0;
  plan.elevations.forEach((face, index) => {
    if (index > 0 && index % best.perRow === 0) { x = 0; y += height * density + pad; }
    cells.push({ x: x + pad / 2, y: y + pad / 2, width: face.length * density, height: height * density });
    x += face.length * density + pad;
  });
  return { density, cells };
}

/** Different access and light requirements, expressed as actual wall voids. */
export function functionalElevations(spec: BuildingSpec, halfW: number, halfD: number, height: number): ElevationPlan[] {
  const program = spec.architecture!;
  if (program.composition && program.composition !== 'single') {
    const masses = architecturalMasses({spec,width:halfW*2,depth:halfD*2,wallHeight:height/spec.floors});
    return masses.flatMap(mass => functionalElevations(mass.grammar.spec!, mass.grammar.width/2, mass.grammar.depth/2, mass.grammar.wallHeight).map(face => {
      const origin=massPoint(mass,{x:face.originX,y:0,z:face.originZ});
      const tangent=massPoint({...mass,x:0,z:0},{x:face.tangentX,y:0,z:face.tangentZ});
      const normal=massPoint({...mass,x:0,z:0},{x:face.normalX,y:0,z:face.normalZ});
      return {...face,mass:mass.name,originX:origin.x,originZ:origin.z,tangentX:tangent.x,tangentZ:tangent.z,normalX:normal.x,normalZ:normal.z};
    }));
  }
  const scale = halfW * 2 / spec.width;
  const storey = height / spec.floors;
  return wallFrames(halfW, halfD).filter(face=>face.name!==program.attachedEnd).map(original => {
    const face = original.name==='front' && program.courtFrontWidth ? {...original,length:program.courtFrontWidth*scale} : original;
    const openings: FacadeOpening[] = [];
    const add = (purpose: NonNullable<FacadeOpening['purpose']>, u: number, y: number, w: number, h: number, row = 0) => {
      const inset = Math.max(spec.wallThickness * scale * 1.3, face.length * .035);
      w = Math.min(w, face.length - inset * 2);
      u = Math.max(-face.length / 2 + inset + w / 2, Math.min(face.length / 2 - inset - w / 2, u));
      h = Math.min(h, height * .94);
      openings.push({kind: ['entrance','wagon','stock','stall'].includes(purpose) ? 'door' : 'window', purpose, u, y, w, h, row, index: openings.length});
    };
    const front = face.name === 'front', rear = face.name === 'rear';
    const density = Math.sqrt(Math.min(1.2, spec.climate.openingDensity));
    switch (program.plan) {
      case 'rooms': {
        const dw = Math.min(face.length * (program.courtFrontWidth ? .32 : .2), storey * .55);
        if (front) add('entrance', -face.length * .2, storey * .39, dw, storey * .78);
        const count = front || rear ? 2 : 1;
        for (let row = 0; row < spec.floors; row++) for (let i = 0; i < count; i++) {
          const u = face.length * ((i + .5) / count - .5);
          if (front && row === 0 && i === 0) continue;
          add('daylight', u, storey * (row + .57), Math.min(face.length * .19, storey * .42) * density, storey * .38 * density, row);
        }
        break;
      }
      case 'work-hall':
        if (front) {
          add('entrance', -face.length * .2, storey * .4, face.length * .3, storey * .8);
          add('daylight', face.length * .25, storey * .57, face.length * .24 * density, storey * .4 * density);
        } else if (rear) add('entrance', 0, storey * .36, face.length * .16, storey * .72);
        else for (const u of [-.28, .28]) add('daylight', face.length * u, storey * .65, face.length * .2 * density, storey * .34 * density);
        for (let row = 1; row < spec.floors; row++) for (const u of [-.26, .26]) add('daylight', face.length * u, storey * (row + .57), Math.min(face.length * .2, storey * .48) * density, storey * .4 * density, row);
        break;
      case 'threshing-aisle':
        if (front || rear) add('wagon', 0, height * .41, face.length * .35, height * .82);
        else for (const u of [-.3,.3]) add('vent', face.length * u, height * .78, face.length * .09, height * .14);
        break;
      case 'feeding-passage':
        if (face.name === 'left' || face.name === 'right') add('stock', -face.length * .15, height * .39, face.length * .35, height * .78);
        else for (let i=0; i<program.bays; i++) add('vent', face.length * ((i+.5)/program.bays-.5), height * .82, face.length / program.bays * .35, height * .12);
        // Front service door keeps the published access anchor useful.
        if (front) add('entrance', -face.length * .32, height * .34, face.length * .12, height * .68);
        break;
      case 'stall-range':
        if (front) for (let i=0; i<program.bays; i++) add('stall', face.length * ((i+.5)/program.bays-.5), height * .38, face.length / program.bays * .58, height * .76);
        else if (rear) for (let i=0; i<program.bays; i++) add('vent', face.length * ((i+.5)/program.bays-.5), height * .73, face.length / program.bays * .3, height * .2);
        else add('vent', 0, height * .76, face.length * .2, height * .17);
        break;
      case 'grain-floors':
        if (front) {
          add('entrance', 0, storey * .36, face.length * .3, storey * .72);
          if (spec.floors===1) add('loading', 0, storey*.86, face.length*.28, storey*.15);
          for (let row=1; row<spec.floors; row++) add('loading', 0, storey * (row+.42), face.length * .32, storey * .54, row);
        } else for (let row=0; row<spec.floors; row++) for (const u of [-.26,.26]) add('vent', face.length * u, storey * (row+.76), face.length * .08, storey * .14, row);
        break;
    }
    return {...face, openings};
  });
}

/** Actual exposed principal posts; shared by the frame emitter and optional facade artwork. */
export function functionalFramePosts(spec: BuildingSpec, face: ElevationPlan, scale: number): {u:number;w:number;corner:boolean}[] {
  if(spec.frameExposure<=.45 || !['infilled-frame','clad-frame'].includes(spec.wallAssembly))return [];
  const t=spec.wallThickness*scale,m=Math.min(t*.6,spec.storeyHeight*scale*.07);
  const posts=[{u:-face.length/2+t*.5,w:m,corner:true},{u:face.length/2-t*.5,w:m,corner:true}];
  if(!face.openings.some(o=>Math.abs(o.u)<o.w/2+m))posts.push({u:0,w:m,corner:false});
  return posts;
}
