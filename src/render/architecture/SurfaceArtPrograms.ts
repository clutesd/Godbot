/**
 * Authored construction materials for the SVG surface atlas.
 *
 * Each material a building actually emits gets one seamless square tile in the right half of its
 * atlas. A tile is drawn at true physical scale — one canonical unit is about six metres, so a
 * brick course is 0.0125 and a rubble stone 0.04–0.09 — and repeats over the real geometry in
 * the shader at a fixed texel density, so a roof or a gable return is as crisp as the front.
 *
 * Every tile is seeded per building and per material: neighbouring houses share their culture's
 * bond, coursing and craft vocabulary, but no two lay the same bricks or split the same shingles.
 *
 * Three matched layers are written together, never baked light:
 *   albedo   the material colour of each unit, its mottling, dirt and repairs;
 *   relief   height (0 = deepest joint, 1 = proudest face), which the shader turns into normals
 *            and cavity occlusion under the real sun;
 *   surface  roughness (255 = fully rough).
 */
import type { BuildingArchetype } from './BuildingArchetype';
import type { ArchitecturalPeriod } from './ArchitecturalPeriod';
import { architecturalMaterial, type ArchitecturalMaterialId, type SurfaceProgram } from './MaterialLibrary';
import type { FacadePlan, AtlasCell } from './FacadePlan';
import { SeededRandom } from '../../sim/prng';

interface Craft {
  boards: 'split' | 'hewn' | 'sawn' | 'planed';
  stone: 'cyclopean' | 'rubble' | 'ashlar' | 'boasted' | 'squared' | 'sawn';
  bond: 'stretcher' | 'english' | 'flemish' | 'stack';
  joints: 'lash' | 'peg' | 'strap' | 'rivet' | 'bolt' | 'weld';
  module: number;
}
export const ERA_CRAFT: Record<ArchitecturalPeriod, Craft> = {
  neolithic: { boards: 'split', stone: 'cyclopean', bond: 'stretcher', joints: 'lash', module: .13 },
  bronzeIron: { boards: 'hewn', stone: 'rubble', bond: 'stretcher', joints: 'peg', module: .10 },
  classical: { boards: 'hewn', stone: 'ashlar', bond: 'stretcher', joints: 'peg', module: .075 },
  medieval: { boards: 'hewn', stone: 'boasted', bond: 'english', joints: 'strap', module: .065 },
  earlyModern: { boards: 'sawn', stone: 'squared', bond: 'flemish', joints: 'strap', module: .055 },
  industrial: { boards: 'sawn', stone: 'squared', bond: 'english', joints: 'rivet', module: .045 },
  modern: { boards: 'planed', stone: 'sawn', bond: 'stretcher', joints: 'bolt', module: .05 },
  contemporary: { boards: 'planed', stone: 'sawn', bond: 'stack', joints: 'weld', module: .06 },
};
interface Composition {
  name: string;
  boards: 'vertical' | 'horizontal' | 'crossed' | 'radial';
  bay: number;
  base: number;
  detail: 'domestic' | 'vent' | 'kick' | 'bin' | 'engineering' | 'ceremony' | 'water' | 'parapet';
}
/** Explicit function-specific compositions; adding an archetype requires an artistic decision. */
export const STRUCTURE_ART: Record<BuildingArchetype, Composition> = {
  house: { name: 'sill-and-panel', boards: 'horizontal', bay: .28, base: .10, detail: 'domestic' },
  barn: { name: 'threshing-bays', boards: 'vertical', bay: .34, base: .16, detail: 'vent' },
  byre: { name: 'washed-stock-base', boards: 'horizontal', bay: .23, base: .27, detail: 'kick' },
  stable: { name: 'stall-kickboards', boards: 'vertical', bay: .22, base: .32, detail: 'kick' },
  'animal-pen': { name: 'lashed-hurdles', boards: 'crossed', bay: .19, base: .09, detail: 'kick' },
  granary: { name: 'sealed-grain-chest', boards: 'horizontal', bay: .18, base: .23, detail: 'bin' },
  silo: { name: 'hooped-staves', boards: 'vertical', bay: .16, base: .12, detail: 'bin' },
  workshop: { name: 'bench-and-tool-bays', boards: 'vertical', bay: .26, base: .16, detail: 'engineering' },
  mill: { name: 'wet-wheel-house', boards: 'horizontal', bay: .25, base: .25, detail: 'water' },
  windmill: { name: 'tower-lapboarding', boards: 'horizontal', bay: .20, base: .12, detail: 'engineering' },
  'hand-mill': { name: 'quern-dressed-bed', boards: 'radial', bay: .16, base: .13, detail: 'engineering' },
  sawmill: { name: 'saw-bench-framing', boards: 'crossed', bay: .32, base: .12, detail: 'engineering' },
  'wind-pump': { name: 'pump-tower-gussets', boards: 'crossed', bay: .18, base: .12, detail: 'water' },
  'smock-mill': { name: 'smock-weatherboards', boards: 'horizontal', bay: .14, base: .18, detail: 'engineering' },
  factory: { name: 'pier-and-spandrel', boards: 'vertical', bay: .38, base: .18, detail: 'engineering' },
  market: { name: 'stall-fronts', boards: 'horizontal', bay: .24, base: .13, detail: 'domestic' },
  warehouse: { name: 'loading-bay-fabric', boards: 'vertical', bay: .35, base: .22, detail: 'bin' },
  'civic-hall': { name: 'ordered-public-bays', boards: 'crossed', bay: .30, base: .17, detail: 'ceremony' },
  shrine: { name: 'sanctuary-frieze', boards: 'radial', bay: .21, base: .14, detail: 'ceremony' },
  gatehouse: { name: 'defensive-battered-base', boards: 'vertical', bay: .28, base: .30, detail: 'parapet' },
  bridge: { name: 'bearing-and-spandrel', boards: 'crossed', bay: .29, base: .21, detail: 'water' },
  dock: { name: 'quay-wear-and-cleats', boards: 'horizontal', bay: .27, base: .34, detail: 'water' },
  'boundary-wall': { name: 'coping-and-lifts', boards: 'horizontal', bay: .31, base: .20, detail: 'parapet' },
};

export function surfaceProgramId(plan: FacadePlan, material: ArchitecturalMaterialId): string {
  return `construction-v2/${plan.spec.archetype}/${plan.spec.period}/${material}/${STRUCTURE_ART[plan.spec.archetype].name}`;
}

/** One seamless material tile. `x,y,width,height` is the unpadded square in atlas pixels. */
export interface SurfaceArtCell extends AtlasCell {
  material: ArchitecturalMaterialId;
  program: string;
  /** Physical edge of the repeating square, in canonical building units. */
  tile: number;
  /** Physical depth represented by the full 0..1 relief range. */
  depth: number;
  /** Wrapped bleed around the square, in atlas pixels, so mip filtering never meets a neighbour. */
  pad: number;
  /** The culture's carved and painted ornament, tinted live by the ornament surface's own colour. */
  ornament?: boolean;
  /** Woven canvas and cloth (sails, awnings, hangings), tinted live by the fabric's own colour. */
  textile?: boolean;
}
/** Neutral value the ornament tile is painted around; the shader divides it back out. */
export const ORNAMENT_REFERENCE = 0xb4b4b4;
export const ARTWORK_WIDTH = 2048;
const ATLAS_HEIGHT = 1024;
const TILE_REGION = { x: 1024, y: 0, size: 1024 };

/** Physical repeat and relief depth per construction program: a brick tile is twelve courses. */
const TILE_SCALE: Record<SurfaceProgram, { tile: number; depth: number }> = {
  'brick-coursing': { tile: .15, depth: .0035 },
  'mud-brick': { tile: .24, depth: .005 },
  rubble: { tile: .42, depth: .009 },
  'coursed-stone': { tile: .36, depth: .006 },
  ashlar: { tile: .48, depth: .0035 },
  'slate-course': { tile: .25, depth: .0035 },
  'tile-course': { tile: .24, depth: .007 },
  terracotta: { tile: .3, depth: .0035 },
  thatch: { tile: .36, depth: .011 },
  shingle: { tile: .24, depth: .0045 },
  'log-stack': { tile: .36, depth: .012 },
  'hewn-timber': { tile: .36, depth: .0035 },
  'sawn-board': { tile: .3, depth: .0025 },
  plaster: { tile: .5, depth: .0018 },
  'daub-panel': { tile: .4, depth: .003 },
  'adobe-render': { tile: .5, depth: .003 },
  'concrete-form': { tile: .5, depth: .002 },
  'wrought-metal': { tile: .3, depth: .0025 },
  'cast-metal': { tile: .4, depth: .004 },
  'rolled-steel': { tile: .4, depth: .002 },
  'corrugated-sheet': { tile: .2, depth: .0035 },
  'standing-seam': { tile: .36, depth: .003 },
  'sheet-panel': { tile: .4, depth: .002 },
  glazing: { tile: .4, depth: .001 },
  'curtain-wall': { tile: .4, depth: .001 },
  membrane: { tile: .5, depth: .0015 },
} as Record<SurfaceProgram, { tile: number; depth: number }>;

/** Kept for callers that still reason about a whole-structure drawing domain. */
export function surfaceArtDomain(plan: FacadePlan): { width: number; height: number; bottom: number } {
  const width = Math.max(plan.spec.width, plan.spec.depth, .4);
  return plan.surfaceDomain ?? { width, height: Math.max(plan.wallTop, width * .65, .4), bottom: 0 };
}

/** One tile per actual non-glass material, packed in an even grid in the right half of the atlas. */
export function surfaceArtLayout(plan: FacadePlan): SurfaceArtCell[] {
  const ids = [...new Set([...Object.values(plan.materials), ...(plan.surfaceMaterials ?? [])])]
    .filter((id): id is ArchitecturalMaterialId => !!id && (architecturalMaterial(id as ArchitecturalMaterialId).family !== 'glass'
      || architecturalMaterial(id as ArchitecturalMaterialId).appearance.program === 'curtain-wall')).sort();
  // The wall and roof covering are most of what is seen: each gets a 512 px quadrant. Everything
  // else (frames, trim, fittings, ornament, fabric) shares the lower half in the largest even grid.
  const primary = [plan.materials.wall, plan.materials.roofCovering].filter((id, i, list): id is ArchitecturalMaterialId => !!id && ids.includes(id as ArchitecturalMaterialId) && list.indexOf(id) === i);
  const rest = ids.filter(id => !primary.includes(id));
  const count = rest.length + 2;
  let columns = 1;
  for (let c = 1; c <= count; c++) if (Math.min(1024 / c, 512 / Math.ceil(count / c)) > Math.min(1024 / columns, 512 / Math.ceil(count / columns))) columns = c;
  const pitch = Math.floor(Math.min(1024 / columns, 512 / Math.ceil(count / columns)));
  const placeAt = (x: number, y: number, size: number) => { const pad = Math.round(Math.min(40, size * .1)); return { pad, x: x + pad, y: y + pad, width: size - pad * 2, height: size - pad * 2 }; };
  const slot = (material: ArchitecturalMaterialId, i: number) => {
    const p = primary.indexOf(material);
    if (p >= 0) return placeAt(TILE_REGION.x + p * 512, TILE_REGION.y, 512);
    return placeAt(TILE_REGION.x + (i % columns) * pitch, TILE_REGION.y + 512 + Math.floor(i / columns) * pitch, pitch);
  };
  const place = (i: number) => placeAt(TILE_REGION.x + (i % columns) * pitch, TILE_REGION.y + 512 + Math.floor(i / columns) * pitch, pitch);
  const order = [...primary, ...rest];
  const cells: SurfaceArtCell[] = order.map((material) => {
    const i = rest.indexOf(material);
    const program = architecturalMaterial(material).appearance.program;
    const scale = TILE_SCALE[program] ?? { tile: .4, depth: .003 };
    // A curtain wall repeats once per storey, so spandrels sit on the slabs.
    const tile = program === 'curtain-wall' ? Math.max(.12, plan.storeyHeight || scale.tile) : scale.tile;
    return { material, program: surfaceProgramId(plan, material), tile, depth: scale.depth, ...slot(material, i) };
  });
  // The last cell is the culture ornament, carried on the trim (or wall) material it decorates.
  const host = (plan.materials.trim ?? plan.materials.wall) as ArchitecturalMaterialId;
  cells.push({ material: host, program: `${surfaceProgramId(plan, host)}/ornament-${plan.pattern}`, tile: .16, depth: .003, ornament: true, ...place(rest.length) });
  cells.push({ material: host, program: `${surfaceProgramId(plan, host)}/textile`, tile: .3, depth: .0015, textile: true, ...place(rest.length + 1) });
  return cells;
}

/** Atlas UV rectangle (x, y, w, h) of a tile's square, after WebGL's vertical flip. */
export function surfaceTileRect(cell: SurfaceArtCell): [number, number, number, number] {
  return [cell.x / ARTWORK_WIDTH, (ATLAS_HEIGHT - cell.y - cell.height) / ATLAS_HEIGHT, cell.width / ARTWORK_WIDTH, cell.height / ATLAS_HEIGHT];
}

// ------------------------------------------------------------------------------------ painting

type Layer = 'albedo' | 'relief' | 'surface';
type RGB = readonly [number, number, number];
const rgbOf = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const c255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const css = (c: RGB): string => `#${c.map(v => c255(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
/** Value and a small warm/cool shift, as kiln, quarry or seasoning varies a unit. */
const vary = (a: RGB, r: SeededRandom, value: number, hue: number): RGB => {
  const k = 1 + r.range(-value, value), h = r.range(-hue, hue);
  return [a[0] * k * (1 + h), a[1] * k, a[2] * k * (1 - h)];
};
const g = (v: number): string => { const k = c255(v); return `rgb(${k},${k},${k})`; };
const n = (v: number): string => (Math.round(v * 100000) / 100000).toString();

interface Paint { a?: RGB | string | null; r?: number | null; s?: number | null; o?: number; ro?: number }

/** Three layers drawn in lock-step in tile units (x along the grain or course, y down). */
class TileArt {
  a: string[] = [];
  r: string[] = [];
  s: string[] = [];
  /** The bed beneath the units (mortar, base coat), drawn for every wrapped copy before any unit. */
  readonly groundLayers = { a: [] as string[], r: [] as string[], s: [] as string[] };
  private readonly unitLayers = { a: this.a, r: this.r, s: this.s };
  constructor(readonly T: number, readonly rnd: SeededRandom) {}
  ground(draw: () => void): void {
    this.a = this.groundLayers.a; this.r = this.groundLayers.r; this.s = this.groundLayers.s;
    try { draw(); } finally { this.a = this.unitLayers.a; this.r = this.unitLayers.r; this.s = this.unitLayers.s; }
  }
  private put(el: (paint: string) => string, p: Paint, stroke: boolean): void {
    const attr = (value: string, opacity?: number): string => `${stroke ? 'stroke' : 'fill'}="${value}"${opacity !== undefined && opacity < 1 ? ` opacity="${n(opacity)}"` : ''}`;
    if (p.a) this.a.push(el(attr(typeof p.a === 'string' ? p.a : css(p.a), p.o)));
    if (p.r !== undefined && p.r !== null) this.r.push(el(attr(g(p.r * 255), p.ro ?? p.o)));
    if (p.s !== undefined && p.s !== null) this.s.push(el(attr(g(p.s * 255), p.ro ?? p.o)));
  }
  path(d: string, p: Paint): void { this.put(paint => `<path d="${d}" ${paint}/>`, p, false); }
  line(d: string, width: number, p: Paint): void {
    this.put(paint => `<path d="${d}" fill="none" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round" ${paint}/>`, p, true);
  }
  rect(x: number, y: number, w: number, h: number, p: Paint, round = 0): void {
    if (w <= 0 || h <= 0) return;
    if (x === 0 && y === 0 && w === this.T && h === this.T && this.a !== this.groundLayers.a) { this.ground(() => this.rect(x, y, w, h, p, round)); return; }
    this.put(paint => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${round ? ` rx="${n(round)}"` : ''} ${paint}/>`, p, false);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, p: Paint, rotate = 0): void {
    this.put(paint => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"${rotate ? ` transform="rotate(${n(rotate)} ${n(cx)} ${n(cy)})"` : ''} ${paint}/>`, p, false);
  }
  /** A unit drawn with a gradient fill in one layer: the gradient id must exist in that layer's defs. */
  raw(a?: string, r?: string, s?: string): void { if (a) this.a.push(a); if (r) this.r.push(r); if (s) this.s.push(s); }
  /** Elements drawn inside are blurred broadly: clouds of colour and undulation, never outlines. */
  soft(draw: () => void, amount: 'wide' | 'mid' = 'wide'): void {
    this.raw(`<g filter="url(#${amount})">`, `<g filter="url(#${amount})">`, `<g filter="url(#${amount})">`);
    draw();
    this.raw('</g>', '</g>', '</g>');
  }
  /** Soft irregular blotches: weathering, mottling and repairs that are never a stamped pattern. */
  blotch(cx: number, cy: number, radius: number, p: Paint, lobes = 7, squash = 1): void {
    const pts: [number, number][] = [];
    for (let i = 0; i < lobes; i++) {
      const t = i / lobes * Math.PI * 2, k = radius * this.rnd.range(.6, 1.25);
      pts.push([cx + Math.cos(t) * k, cy + Math.sin(t) * k * squash]);
    }
    this.path(smoothClosed(pts), p);
  }
}

/** A closed Catmull-Rom-like curve through the points, as quadratic midpoint splines. */
function smoothClosed(pts: readonly (readonly [number, number])[]): string {
  const m = (i: number): [number, number] => {
    const a = pts[(i + pts.length) % pts.length]!, b = pts[(i + 1) % pts.length]!;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  let d = `M${n(m(0)[0])} ${n(m(0)[1])}`;
  for (let i = 1; i <= pts.length; i++) { const p = pts[i % pts.length]!, q = m(i); d += `Q${n(p[0])} ${n(p[1])} ${n(q[0])} ${n(q[1])}`; }
  return `${d}Z`;
}
function poly(pts: readonly (readonly [number, number])[]): string { return `M${pts.map(p => `${n(p[0])} ${n(p[1])}`).join('L')}Z`; }

/** An irregular, slightly chipped quadrilateral unit: never a perfect rectangle. */
function unitOutline(r: SeededRandom, x0: number, y0: number, x1: number, y1: number, chip: number): [number, number][] {
  const w = x1 - x0, h = y1 - y0, c = Math.min(w, h) * chip;
  const j = (k: number): number => r.range(-k, k);
  return [
    [x0 + r.range(0, c), y0 + j(c * .25)], [x0 + w * r.range(.35, .65), y0 + j(c * .3)], [x1 - r.range(0, c), y0 + j(c * .25)],
    [x1 + j(c * .25), y0 + r.range(0, c)], [x1 + j(c * .25), y1 - r.range(0, c)],
    [x1 - r.range(0, c), y1 + j(c * .25)], [x0 + w * r.range(.35, .65), y1 + j(c * .3)], [x0 + r.range(0, c), y1 + j(c * .25)],
    [x0 + j(c * .25), y1 - r.range(0, c)], [x0 + j(c * .25), y0 + r.range(0, c)],
  ];
}

interface Context {
  plan: FacadePlan;
  cell: SurfaceArtCell;
  color: RGB;
  craft: Craft;
  design: Composition;
  wear: number;
  maintenance: number;
  moisture: number;
  roughness: number;
  material: ArchitecturalMaterialId;
}


// ----------------------------------------------------------------------------------- masonry

function mortarFor(ctx: Context, sandy: RGB = [196, 186, 166]): RGB {
  const era = ctx.plan.spec.period;
  const lime = mix(sandy, ctx.color, .18);
  const cement: RGB = [150, 148, 142];
  const base = era === 'modern' || era === 'contemporary' ? cement : era === 'industrial' ? mix(lime, cement, .45) : lime;
  return mix(base, [92, 86, 76], ctx.wear * .35);
}

/** Fired brick: kiln-varied units in the era's bond, struck lime or cement joints, chipped arrises. */
function brick(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const courses = 12, c = T / courses, joint = c * .14;
  const bond = ctx.craft.bond;
  // Lime pointing in brickwork weathers to a dull grey that stays below the brick's own value.
  const mortar = mix(mortarFor(ctx), [118, 110, 100], .3);
  t.rect(0, 0, T, T, { a: mortar, r: .22, s: .97 });
  // Mortar texture: sand grains and the trowel's struck line.
  t.ground(() => { for (let i = 0; i < 260; i++) t.rect(rnd.range(0, T), rnd.range(0, T), c * .05, c * .05, { a: mul(mortar, rnd.range(.8, 1.12)), o: .7 }); });
  const stretcher = bond === 'flemish' ? T / 4.5 : T / 4, header = stretcher / 2;
  const burnt: RGB = mix(ctx.color, [62, 44, 42], .55);
  for (let row = 0; row < courses; row++) {
    const y0 = row * c;
    const units: { x: number; w: number; header: boolean }[] = [];
    if (bond === 'stack') for (let x = 0; x < T - 1e-6; x += stretcher) units.push({ x, w: stretcher, header: false });
    else if (bond === 'english' && row % 2) for (let x = -header / 2; x < T - 1e-6; x += header) units.push({ x, w: header, header: true });
    else if (bond === 'flemish') {
      const offset = row % 2 ? stretcher / 2 - header / 2 - stretcher : 0;
      for (let x = offset, k = 0; x < T - 1e-6; k++) { const h = k % 2 === 1; units.push({ x, w: h ? header : stretcher, header: h }); x += h ? header : stretcher; }
    } else for (let x = row % 2 ? -stretcher / 2 : 0; x < T - 1e-6; x += stretcher) units.push({ x, w: stretcher, header: false });
    for (const u of units) {
      const x0 = u.x + joint / 2, x1 = u.x + u.w - joint / 2, y1 = y0 + c - joint / 2, yy0 = y0 + joint / 2;
      let tone = vary(ctx.color, rnd, .1, .05);
      const roll = rnd.float();
      if (u.header && bond === 'flemish') tone = mix(tone, burnt, rnd.range(.45, .8));
      else if (roll < .07) tone = mix(tone, burnt, rnd.range(.35, .7));
      else if (roll < .13) tone = mix(tone, [214, 168, 130], rnd.range(.2, .45));
      const d = poly(unitOutline(rnd, x0, yy0, x1, y1, .1));
      const proud = rnd.range(.74, .86);
      t.path(d, { a: tone, r: proud, s: ctx.roughness + rnd.range(-.06, .05) });
      // Firing gradient: one end of a clamp-fired brick sat nearer the fire.
      if (rnd.chance(.4)) {
        const end = rnd.chance(.5) ? x0 : x1 - (x1 - x0) * .4;
        t.rect(end, yy0, (x1 - x0) * .4, y1 - yy0, { a: burnt, o: rnd.range(.12, .3) });
      }
      // Sand-struck face: inclusions, lime nodules and iron spots.
      for (let k = 0; k < 5; k++) {
        const dark = rnd.chance(.6);
        t.ellipse(rnd.range(x0, x1), rnd.range(yy0, y1), c * rnd.range(.03, .07), c * rnd.range(.03, .06),
          { a: dark ? mul(tone, .62) : mix(tone, [232, 220, 196], .5), o: .75, r: dark ? proud - .12 : null });
      }
      // A chipped arris exposes the mortar bed behind.
      if (rnd.chance(.16)) {
        const cx = rnd.chance(.5) ? x0 : x1, cy = rnd.chance(.5) ? yy0 : y1, s = c * rnd.range(.15, .3);
        t.path(poly([[cx, cy], [cx + (cx === x0 ? s : -s), cy], [cx, cy + (cy === yy0 ? s * .8 : -s * .8)]]), { a: mul(tone, .78), r: .45, s: .95 });
      }
    }
  }
  // Soot and lime run-off settle along the bed joints rather than over the faces.
  if (ctx.plan.spec.period === 'industrial') for (let i = 0; i < 6; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.06, .14), { a: [40, 34, 32], o: .1 + ctx.wear * .12 }, 8, .45);
}

/** Sun-dried mud brick: thick mud joints, eroded arrises, straw temper. */
function mudBrick(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const courses = 12, c = T / courses, len = T / 4, joint = c * .2;
  const mortar = mix(ctx.color, [120, 96, 70], .3);
  t.rect(0, 0, T, T, { a: mortar, r: .25, s: .99 });
  for (let row = 0; row < courses; row++) for (let x = row % 2 ? -len / 2 : 0; x < T; x += len) {
    const tone = vary(ctx.color, rnd, .07, .04);
    const pts = unitOutline(rnd, x + joint / 2, row * c + joint / 2, x + len - joint / 2, (row + 1) * c - joint / 2, .25);
    t.path(smoothClosed(pts), { a: tone, r: rnd.range(.68, .8), s: .97 });
    for (let k = 0; k < 7; k++) {
      const sx = rnd.range(x + joint, x + len - joint), sy = rnd.range(row * c + joint, (row + 1) * c - joint), a = rnd.range(-.6, .6), l = c * rnd.range(.2, .5);
      t.line(`M${n(sx)} ${n(sy)}l${n(Math.cos(a) * l)} ${n(Math.sin(a) * l)}`, c * .035, { a: [206, 178, 110], o: .7, r: .8 });
    }
    // Rain-eroded hollows.
    if (rnd.chance(.3)) t.blotch(rnd.range(x, x + len), row * c + c * .5, c * .3, { a: mul(tone, .88), r: .55, o: .8 }, 6, .6);
  }
  // Mud wash surviving in patches over the coursing.
  for (let i = 0; i < 4; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.06, .15), { a: mix(ctx.color, [210, 190, 160], .25), r: .78, s: .99, o: .85 }, 9, .7);
}

const FIELD_SUITE: readonly { tone: RGB; weight: number }[] = [
  { tone: [141, 138, 131], weight: 5 }, { tone: [160, 142, 112], weight: 3 }, { tone: [112, 118, 122], weight: 3 },
  { tone: [146, 116, 90], weight: 1.4 }, { tone: [172, 165, 150], weight: 1.6 },
];

/** Partition a tile height into courses that sum exactly to it, so rows wrap seamlessly. */
function courses(rnd: SeededRandom, T: number, mean: number, spread: number): number[] {
  const raw: number[] = [];
  let total = 0;
  while (total < T - mean * .5) { const h = mean * rnd.range(1 - spread, 1 + spread); raw.push(h); total += h; }
  return raw.map(h => h * T / total);
}
/** Partition one row's width into unit lengths that sum exactly to it. */
function lengths(rnd: SeededRandom, T: number, min: number, max: number): number[] {
  const raw: number[] = [];
  let total = 0;
  while (total < T - min * .6) { const l = rnd.range(min, max); raw.push(l); total += l; }
  return raw.map(l => l * T / total);
}

/** Rubble brought to rough courses: interlocking angular field stones whose beds wander, pinned
 * with spalls and bedded in recessed lime. Course lines are periodic curves, so rows wrap. */
function rubble(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const cyclopean = ctx.craft.stone === 'cyclopean';
  const mortar = mortarFor(ctx, [184, 176, 158]);
  // Dry-laid cyclopean work shows dark voids rather than a lime bed.
  t.rect(0, 0, T, T, { a: cyclopean ? mix(mul(mortar, .62), [96, 84, 66], .4) : mortar, r: cyclopean ? .12 : .05, s: 1 });
  if (!cyclopean) t.ground(() => { for (let i = 0; i < 220; i++) t.ellipse(rnd.range(0, T), rnd.range(0, T), T * .0035, T * .0028, { a: mul(mortar, rnd.range(.78, 1.1)), o: .8, r: rnd.range(.04, .2) }); });
  const heights = courses(rnd, T, cyclopean ? .085 : .055, .3);
  // Each bed line is a periodic wander around its nominal height, except the first: rubble is
  // brought to a level bed at every lift, and that straight joint lets the renderer shift whole
  // lifts sideways so a long wall never shows the same stones twice.
  const beds = heights.map((_, k) => {
    const terms = [1, 2, 3, 5].map(f => ({ f, a: k === 0 ? 0 : rnd.range(-1, 1) * heights[k]! * .12 / f, p: rnd.range(0, Math.PI * 2) }));
    return terms;
  });
  const baseY = heights.reduce<number[]>((list, h) => [...list, list[list.length - 1]! + h], [0]);
  const bed = (k: number, x: number): number => {
    const wrapped = k % heights.length, shift = Math.floor(k / heights.length) * T;
    return baseY[wrapped]! + shift + beds[wrapped]!.reduce((s, b) => s + b.a * Math.sin(b.f * x / T * Math.PI * 2 + b.p), 0);
  };
  const gap = cyclopean ? .0026 : .0042;
  for (let row = 0; row < heights.length; row++) {
    const h = heights[row]!;
    const widths = lengths(rnd, T, h * (cyclopean ? 1 : 1.1), h * (cyclopean ? 2 : 2.8));
    let x = rnd.range(0, T);
    const seps = widths.map(w => { const s = { x, top: x + rnd.range(-h, h) * .22, bottom: x + rnd.range(-h, h) * .22 }; x += w; return s; });
    seps.push({ ...seps[0]!, x: seps[0]!.x + T, top: seps[0]!.top + T, bottom: seps[0]!.bottom + T });
    for (let i = 0; i < widths.length; i++) {
      const a = seps[i]!, b = seps[i + 1]!;
      // A coursed stone, or two thinner stones galleted together in one lift.
      const split = !cyclopean && rnd.chance(.22);
      const mid = rnd.range(.4, .6);
      const parts = split ? [[0, mid], [mid, 1]] : [[0, 1]];
      for (const [f0, f1] of parts) {
        const edge = (x0: number, x1: number, k: number, f: number): [number, number][] => {
          const pts: [number, number][] = [];
          for (let s = 0; s <= 4; s++) { const px = x0 + (x1 - x0) * s / 4; pts.push([px, bed(row, px) + (bed(row + 1, px) - bed(row, px)) * f]); }
          void k; return pts;
        };
        const lerp = (s: { top: number; bottom: number }, f: number): number => s.top + (s.bottom - s.top) * f;
        const top = edge(lerp(a, f0!), lerp(b, f0!), row, f0!);
        const bottom = edge(lerp(a, f1!), lerp(b, f1!), row, f1!).reverse();
        stone(t, ctx, [...top, ...bottom], gap);
      }
      // A pinning spall wedged into the perpend.
      if (!cyclopean && rnd.chance(.28)) {
        const px = b.top + (b.bottom - b.top) * .5, py = bed(row, px) + h * rnd.range(.3, .7), s = h * rnd.range(.1, .16);
        t.path(smoothClosed([[px - s, py], [px, py - s * .6], [px + s * .9, py], [px, py + s * .5]]), { a: mul(stoneTone(ctx, rnd), .82), r: .5, s: .92 });
      }
    }
  }
}

function stoneTone(ctx: Context, rnd: SeededRandom): RGB {
  const suite = FIELD_SUITE[rnd.weightedIndex(FIELD_SUITE.map(s => s.weight))]!.tone;
  return vary(mix(ctx.color, suite, .5), rnd, .1, .04);
}

/** One field stone: the cell polygon pulled in to leave a bed, with hand-knocked angular corners. */
function stone(t: TileArt, ctx: Context, outline: [number, number][], gap: number): void {
  const rnd = t.rnd;
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cy = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  const pts = outline.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1, pull = gap * rnd.range(.8, 1.6);
    return [x - dx / len * pull + rnd.range(-gap, gap) * .3, y - dy / len * pull + rnd.range(-gap, gap) * .3] as [number, number];
  });
  // Knock off a corner or two, and keep the rest of the arrises sharp.
  const d = rnd.chance(.5) ? smoothClosed(pts) : poly(pts);
  const tone = stoneTone(ctx, rnd);
  const w = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0])), h = Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
  t.path(d, { a: tone, r: rnd.range(.66, .78), s: ctx.roughness + rnd.range(-.08, .04) });
  // Split faces are not flat: a couple of facets at slightly different heights.
  for (let k = 0; k < 2; k++) t.blotch(cx + rnd.range(-w, w) * .2, cy + rnd.range(-h, h) * .15, Math.min(w, h) * rnd.range(.25, .4),
    { a: mul(tone, rnd.range(.94, 1.06)), o: .45, r: rnd.range(.74, .8), ro: .6 }, 5, rnd.range(.5, .9));
  t.path(d, { a: 'url(#rind)', o: .35 + ctx.wear * .35 });
  if (rnd.chance(.22)) {
    const y = cy + h * rnd.range(-.25, .25);
    t.line(`M${n(cx - w * .38)} ${n(y)}Q${n(cx)} ${n(y + h * rnd.range(-.12, .12))} ${n(cx + w * .38)} ${n(y + h * rnd.range(-.08, .08))}`, h * .025, { a: mul(tone, .72), o: .55, r: .5 });
  }
  for (let i = 0; i < 4; i++) {
    const s = Math.min(w, h) * rnd.range(.015, .03);
    t.ellipse(cx + w * rnd.range(-.35, .35), cy + h * rnd.range(-.3, .3), s, s * .8, { a: rnd.chance(.7) ? mul(tone, .82) : mix(tone, [232, 226, 214], .18), o: .5 });
  }
  lichen(t, ctx, cx, cy, Math.min(w, h) * .35);
}

/** Crustose lichen favours damp, old, unwashed stone; maintenance scrubs it off. */
function lichen(t: TileArt, ctx: Context, cx: number, cy: number, radius: number): void {
  const rnd = t.rnd;
  const chance = (.08 + ctx.wear * .35) * (.4 + ctx.moisture) * (1.1 - ctx.maintenance * .6);
  if (!rnd.chance(chance)) return;
  const colors: RGB[] = [[176, 164, 102], [150, 156, 124], [184, 178, 156], [138, 144, 88]];
  const color = rnd.pick(colors);
  for (let k = 0, count = rnd.int(3, 8); k < count; k++) {
    const r = radius * rnd.range(.12, .35);
    t.blotch(cx + rnd.range(-radius, radius), cy + rnd.range(-radius, radius) * .6, r, { a: color, o: rnd.range(.3, .55), r: .78, s: 1 }, 7, 1);
  }
}

/** Squared stone in coursed beds: tooled faces, fine lime joints and the odd chipped arris. */
function coursedStone(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const mortar = mortarFor(ctx);
  t.rect(0, 0, T, T, { a: mortar, r: .18, s: .98 });
  const sandstone = ctx.material === 'sandstone', limestone = ctx.material === 'limestone';
  const rows = courses(rnd, T, Math.max(.042, ctx.craft.module * .85), .28);
  const joint = .0022;
  let y = 0;
  for (const h of rows) {
    const xs = lengths(rnd, T, h * 1.4, h * 3.2);
    let x = rnd.range(0, h);
    for (const w of xs) {
      const x0 = x + joint, y0 = y + joint, x1 = x + w - joint, y1 = y + h - joint;
      const tone = vary(ctx.color, rnd, .08, .04);
      const d = poly(unitOutline(rnd, x0, y0, x1, y1, .07));
      t.path(d, { a: tone, r: rnd.range(.74, .84), s: ctx.roughness + rnd.range(-.05, .04) });
      t.path(d, { a: 'url(#rind)', o: .3 + ctx.wear * .3 });
      tooling(t, ctx, x0, y0, x1, y1, tone);
      if (sandstone) for (let k = 0; k < 4; k++) {
        const ly = y0 + (y1 - y0) * rnd.range(.1, .9);
        t.line(`M${n(x0)} ${n(ly)}Q${n((x0 + x1) / 2)} ${n(ly + (y1 - y0) * rnd.range(-.1, .1))} ${n(x1)} ${n(ly + (y1 - y0) * rnd.range(-.05, .05))}`, (y1 - y0) * rnd.range(.02, .08),
          { a: rnd.chance(.5) ? mix(tone, [150, 90, 52], .4) : mix(tone, [222, 196, 158], .4), o: .55 });
      }
      if (limestone) for (let k = 0; k < 5; k++) t.ellipse(rnd.range(x0, x1), rnd.range(y0, y1), h * .025, h * .018, { a: mul(tone, .78), o: .6, r: .6 });
      if (rnd.chance(.14)) {
        const cx = rnd.chance(.5) ? x0 : x1, cy = rnd.chance(.5) ? y0 : y1, s = h * rnd.range(.12, .25);
        t.path(poly([[cx, cy], [cx + (cx === x0 ? s : -s), cy], [cx, cy + (cy === y0 ? s : -s)]]), { a: mix(tone, [228, 220, 204], .3), r: .5, s: .97 });
      }
      if (rnd.chance(.025)) masonMark(t, (x0 + x1) / 2, (y0 + y1) / 2, h * .14, tone);
      lichen(t, ctx, (x0 + x1) / 2, (y0 + y1) / 2, h * .4);
      x += w;
    }
    y += h;
  }
}

/** The dressing the era's masons used: boasted diagonals, punched pitching, or sawn smoothness. */
function tooling(t: TileArt, ctx: Context, x0: number, y0: number, x1: number, y1: number, tone: RGB): void {
  const rnd = t.rnd, h = y1 - y0;
  const style = ctx.craft.stone;
  if (style === 'sawn') {
    if (rnd.chance(.5)) t.blotch((x0 + x1) / 2, (y0 + y1) / 2, h * .35, { a: mul(tone, 1.04), o: .4 }, 8, .6);
    return;
  }
  let d = '';
  const step = style === 'boasted' ? h * .1 : h * .16;
  const slant = style === 'boasted' ? h * .45 : 0;
  for (let x = x0 + step * .6; x < x1 - step * .3; x += step * rnd.range(.8, 1.2)) d += `M${n(x)} ${n(y0 + h * .1)}l${n(slant)} ${n(h * .8)}`;
  if (style === 'squared' || style === 'cyclopean' || style === 'rubble') {
    // Pitch-faced: a punched field inside a drafted margin.
    t.rect(x0 + h * .1, y0 + h * .1, x1 - x0 - h * .2, h * .8, { r: .9, ro: .55 }, h * .1);
    for (let k = 0; k < 10; k++) t.ellipse(rnd.range(x0 + h * .15, x1 - h * .15), rnd.range(y0 + h * .15, y1 - h * .15), h * .05, h * .04, { a: mul(tone, .86), o: .45, r: .7 });
  }
  if (d) t.line(d, h * .025, { a: mul(tone, .85), o: .35, r: .7, ro: .5 });
}

function masonMark(t: TileArt, x: number, y: number, s: number, tone: RGB): void {
  const shapes = ['M-1 -1L1 1M-1 1L1 -1', 'M-1 1L0 -1L1 1', 'M0 1L0 -1M-.8 -.2L0 -1L.8 -.2', 'M-1 0L1 0M0 -1L0 1M-.6 -.6L.6 .6'];
  const d = t.rnd.pick(shapes).replace(/-?\d*\.?\d+/g, v => n(Number(v)));
  t.raw(`<path d="${d}" transform="translate(${n(x)} ${n(y)}) scale(${n(s)})" fill="none" stroke="${css(mul(tone, .6))}" stroke-width="${n(.14)}" opacity=".4"/>`,
    `<path d="${d}" transform="translate(${n(x)} ${n(y)}) scale(${n(s)})" fill="none" stroke="${g(120)}" stroke-width="${n(.22)}"/>`);
}

/** Ashlar: large equal-height courses, hairline joints, drafted margins and fine claw tooling. */
function ashlar(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const granite = ctx.material === 'granite';
  const mortar = mix(ctx.color, [210, 202, 186], .45);
  t.rect(0, 0, T, T, { a: mortar, r: .38, s: .95 });
  const rowsN = 8, h = T / rowsN, joint = .0011;
  for (let row = 0; row < rowsN; row++) {
    const y0 = row * h;
    const xs = lengths(rnd, T, h * 1.6, h * 2.8);
    let x = row % 2 ? xs[0]! * .5 : 0;
    for (const w of xs) {
      const tone = vary(ctx.color, rnd, .05, .025);
      const x0 = x + joint, x1 = x + w - joint, a = y0 + joint, b = y0 + h - joint;
      t.rect(x0, a, x1 - x0, b - a, { a: tone, r: .8, s: ctx.roughness + rnd.range(-.05, .03) });
      // Drafted margin around a fractionally proud face.
      const m = h * .07;
      t.rect(x0 + m, a + m, x1 - x0 - m * 2, b - a - m * 2, { a: mul(tone, rnd.range(.97, 1.03)), r: .86 });
      let claw = '';
      const slant = rnd.chance(.5) ? 1 : -1;
      for (let k = x0 + m; k < x1 - m; k += h * .05) claw += `M${n(k)} ${n(a + m)}l${n(slant * h * .18)} ${n(b - a - m * 2)}`;
      t.line(claw, h * .01, { a: mul(tone, .9), o: .25, r: .82, ro: .6 });
      if (granite) for (let k = 0; k < 40; k++) {
        const dark = rnd.chance(.6);
        t.rect(rnd.range(x0, x1), rnd.range(a, b), h * .02, h * .018, { a: dark ? [40, 40, 44] : rnd.chance(.4) ? [196, 160, 150] : [220, 220, 216], o: .75 });
      }
      else if (rnd.chance(.35)) {
        // A faint vein or bed in the block.
        const vy = rnd.range(a, b);
        t.line(`M${n(x0)} ${n(vy)}C${n(x0 + (x1 - x0) * .3)} ${n(vy + h * .2)} ${n(x0 + (x1 - x0) * .6)} ${n(vy - h * .2)} ${n(x1)} ${n(vy + h * .05)}`, h * .02, { a: mul(tone, .85), o: .4 });
      }
      if (rnd.chance(.03)) masonMark(t, (x0 + x1) / 2, (a + b) / 2, h * .1, tone);
      lichen(t, ctx, (x0 + x1) / 2, (a + b) / 2, h * .35);
      x += w;
    }
  }
}

// ----------------------------------------------------------------------------------- roofs

/** Overlapping units shared by slate, shingle and tile: each course's butt laps the one below. */
function lappedCourses(t: TileArt, ctx: Context, rowsN: number, unitRange: [number, number],
  unit: (x0: number, y0: number, x1: number, y1: number, row: number) => void): void {
  const { T, rnd } = t, h = T / rowsN;
  for (let row = 0; row < rowsN; row++) {
    const y0 = row * h;
    const xs = lengths(rnd, T, T * unitRange[0], T * unitRange[1]);
    let x = row % 2 ? xs[0]! * .5 : rnd.range(0, xs[0]! * .3);
    for (const w of xs) { unit(x, y0, x + w, y0 + h, row); x += w; }
  }
  void ctx;
}

/** Riven slate: dark split sheets, ragged dressed butts, the odd replacement in a different quarry's colour. */
function slate(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  t.rect(0, 0, T, T, { a: mul(ctx.color, .55), r: .05, s: .8 });
  const replaced = mix(ctx.color, [96, 86, 104], .5);
  lappedCourses(t, ctx, 8, [.13, .2], (x0, y0, x1, y1) => {
    const gap = (x1 - x0) * .03;
    const tone = rnd.chance(.06 + (1 - ctx.maintenance) * .06) ? vary(replaced, rnd, .06, .05) : vary(ctx.color, rnd, .09, .05);
    // Head under the course above, ragged dressed tail at the butt.
    const butt: [number, number][] = [];
    for (let k = 0; k <= 5; k++) butt.push([x1 - gap - (x1 - x0 - gap * 2) * k / 5, y1 + rnd.range(-.0012, .0012)]);
    const pts: [number, number][] = [[x0 + gap, y0 - (y1 - y0) * .6], [x1 - gap, y0 - (y1 - y0) * .6], ...butt];
    if (rnd.chance(.12)) pts.splice(pts.length - 1, 1, [x0 + gap + (x1 - x0) * .12, y1], [x0 + gap, y1 - (y1 - y0) * .2]);
    const d = poly(pts);
    t.path(d, { a: tone, s: ctx.roughness + rnd.range(-.12, .06) });
    t.raw(undefined, `<path d="${d}" fill="url(#lap)"/>`);
    // Riven cleavage lines and a lighter, weathered tail.
    let lines = '';
    for (let k = 0; k < 3; k++) { const lx = rnd.range(x0, x1); lines += `M${n(lx)} ${n(y0)}l${n(rnd.range(-.002, .002))} ${n(y1 - y0)}`; }
    t.line(lines, .0006, { a: mul(tone, 1.18), o: .35, r: .6, ro: .25 });
    t.rect(x0 + gap, y1 - (y1 - y0) * .25, x1 - x0 - gap * 2, (y1 - y0) * .25, { a: mix(tone, [150, 150, 150], .25), o: .3 + ctx.wear * .2 });
    t.line(`M${n(x0 + gap)} ${n(y1)}H${n(x1 - gap)}`, .0012, { a: mul(tone, .45), o: .8 });
    if (rnd.chance(.2 * ctx.moisture + ctx.wear * .1)) t.blotch(x0 + (x1 - x0) * rnd.range(.2, .8), y1 - (y1 - y0) * .15, (y1 - y0) * .25, { a: [104, 116, 70], o: .6, r: .75 }, 6, .5);
  });
}

/** Riven or sawn wooden shingles: split grain, keyway gaps, silvering where the weather reaches. */
function shingle(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  t.rect(0, 0, T, T, { a: mul(ctx.color, .55), r: 0, s: 1 });
  const silver: RGB = [142, 138, 128];
  const riven = ['split', 'hewn'].includes(ctx.craft.boards);
  lappedCourses(t, ctx, 8, [.07, .15], (x0, y0, x1, y1) => {
    const gap = .0007;
    const base = vary(mix(ctx.color, silver, Math.min(.85, ctx.wear * .9 + rnd.range(-.05, .08))), rnd, .065, .035);
    const butt = y1 + (riven ? rnd.range(-.002, .0015) : 0);
    const d = poly([[x0 + gap, y0 - (y1 - y0) * .7], [x1 - gap, y0 - (y1 - y0) * .7], [x1 - gap, butt + (riven ? rnd.range(-.001, .001) : 0)], [x0 + gap, butt]]);
    t.path(d, { a: base, s: .92 + rnd.range(-.04, .04) });
    t.raw(undefined, `<path d="${d}" fill="url(#lap)"/>`);
    // Grain runs down the shingle; riven ones show deep split ridges.
    let grain = '';
    for (let k = 0; k < (riven ? 9 : 6); k++) {
      const gx = rnd.range(x0 + gap * 2, x1 - gap * 2);
      grain += `M${n(gx)} ${n(y0)}Q${n(gx + rnd.range(-.0015, .0015))} ${n((y0 + butt) / 2)} ${n(gx + rnd.range(-.001, .001))} ${n(butt)}`;
    }
    t.line(grain, .0005, { a: mul(base, .66), o: .55, r: riven ? .42 : .6, ro: .6 });
    if (rnd.chance(.12)) {
      // A split down the length, opened by years of wetting and drying.
      const sx = rnd.range(x0 + (x1 - x0) * .25, x1 - (x1 - x0) * .25);
      t.line(`M${n(sx)} ${n(butt)}l${n(rnd.range(-.001, .001))} ${n(-(y1 - y0) * rnd.range(.4, .9))}`, .0012, { a: mul(base, .3), r: 0, s: 1 });
    }
    t.line(`M${n(x0 + gap)} ${n(butt)}H${n(x1 - gap)}`, .001, { a: mul(base, .5), o: .7 });
    // The exposed tail weathers more than the lapped head.
    t.rect(x0 + gap, y1 - (y1 - y0) * .35, x1 - x0 - gap * 2, (y1 - y0) * .35, { a: mix(base, silver, .35), o: .25 + ctx.wear * .3 });
    if (rnd.chance(.15 * ctx.moisture + ctx.wear * .12)) t.blotch(x0 + (x1 - x0) * rnd.range(.2, .8), y1 - (y1 - y0) * .2, (y1 - y0) * .22, { a: [86, 104, 58], o: .7, r: .7 }, 6, .5);
  });
}

/** Pantiles: S-section clay units laid in interlocking courses, rounded rolls catching the sun. */
function clayTile(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  t.rect(0, 0, T, T, { a: mul(ctx.color, .5), r: 0, s: .9 });
  const rowsN = 8, colsN = 6, h = T / rowsN, w = T / colsN;
  for (let row = 0; row < rowsN; row++) for (let col = 0; col < colsN; col++) {
    const x0 = col * w + (row % 2 ? w * .02 : 0), y0 = row * h;
    const tone = vary(ctx.color, rnd, .09, .05);
    const d = poly([[x0, y0 - h * .5], [x0 + w, y0 - h * .5], [x0 + w, y0 + h], [x0, y0 + h]]);
    t.path(d, { a: tone, s: ctx.roughness + rnd.range(-.08, .05) });
    // Section: a broad pan rising into a rounded roll at one edge.
    t.raw(undefined, `<rect x="${n(x0)}" y="${n(y0 - h * .5)}" width="${n(w)}" height="${n(h * 1.5)}" fill="url(#pantile)"/>`);
    t.raw(undefined, `<rect x="${n(x0)}" y="${n(y0 - h * .5)}" width="${n(w)}" height="${n(h * 1.5)}" fill="url(#lapfade)"/>`);
    t.rect(x0 + w * .7, y0, w * .25, h, { a: mul(tone, 1.08), o: .4 });
    t.rect(x0, y0 + h * .82, w, h * .18, { a: mul(tone, .78), o: .35 + ctx.wear * .2 });
    if (rnd.chance(.15 + ctx.wear * .2)) t.blotch(x0 + w * rnd.range(.1, .6), y0 + h * .75, h * .2, { a: rnd.chance(.5) ? [176, 168, 120] : [92, 102, 62], o: .6, r: .65 }, 6, .6);
  }
}

/** Long-straw or reed thatch: combed courses, butt ends dressed into a shaggy surface, hazel spars. */
function thatch(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const aged = mix(ctx.color, [120, 112, 96], Math.min(.8, ctx.wear * .9));
  t.rect(0, 0, T, T, { a: mul(aged, .45), r: .05, s: 1 });
  const rowsN = 6, h = T / rowsN;
  for (let row = 0; row < rowsN; row++) {
    const y0 = row * h;
    // Strokes bucketed by tone, so a few thousand straws cost a few dozen elements.
    const buckets: string[][] = [[], [], [], [], []];
    const height: string[][] = [[], [], []];
    for (let x = -h * .2; x < T + h * .2; x += .0011) {
      const top = y0 - h * rnd.range(.6, 1), bottom = y0 + h * rnd.range(.85, 1.08), lean = rnd.range(-.004, .004);
      const seg = `M${n(x)} ${n(top)}Q${n(x + lean * .5)} ${n((top + bottom) / 2)} ${n(x + lean)} ${n(bottom)}`;
      buckets[rnd.int(0, 5)]!.push(seg);
      height[rnd.int(0, 3)]!.push(seg);
    }
    buckets.forEach((segs, i) => t.raw(`<path d="${segs.join('')}" fill="none" stroke="${css(mul(aged, .62 + i * .12))}" stroke-width=".0016" stroke-linecap="round"/>`));
    height.forEach((segs, i) => t.raw(undefined, `<path d="${segs.join('')}" fill="none" stroke="url(#straw${i})" stroke-width=".0016"/>`,
      `<path d="${segs.join('')}" fill="none" stroke="${g(235 + i * 8)}" stroke-width=".0016"/>`));
    // Butt ends: a dense, darker, shadow-free fringe of cut stems at the course foot.
    let ends = '';
    for (let x = 0; x < T; x += .0018) ends += `M${n(x)} ${n(y0 + h * rnd.range(.86, 1.02))}h.0012`;
    t.raw(`<path d="${ends}" stroke="${css(mul(aged, .55))}" stroke-width=".0022" fill="none"/>`,
      `<path d="${ends}" stroke="${g(200)}" stroke-width=".0024" fill="none"/>`);
  }
  // Moss and weathering gather in hollows; patched areas are brighter new straw.
  t.soft(() => { for (let i = 0; i < 3 + ctx.wear * 8; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.04, .1), { a: [88, 96, 58], o: (.15 + ctx.wear * .35) * (.5 + ctx.moisture * .6) }, 8, .6); });
  if ((1 - ctx.maintenance) < .7 && rnd.chance(.5)) t.blotch(rnd.range(0, T), rnd.range(0, T), T * .12, { a: mix(ctx.color, [214, 184, 116], .5), o: .45 }, 9, .5);
}

// ----------------------------------------------------------------------------------- timber

/** Annual-ring figure: many fine, nearly parallel lines that drift slowly, in two tones, with an
 * occasional cathedral arch where the saw cut through the growth rings. */
function grain(t: TileArt, x0: number, y0: number, x1: number, y1: number, tone: RGB, density: number, wave: number): void {
  const rnd = t.rnd, h = y1 - y0;
  const dark: string[] = [], light: string[] = [];
  const lines = Math.max(4, density * 2);
  for (let k = 0; k < lines; k++) {
    let y = y0 + h * (k + rnd.range(.1, .9)) / lines, x = x0 - rnd.range(0, .02);
    let d = `M${n(x)} ${n(y)}`;
    while (x < x1) {
      const step = rnd.range(.04, .1), nx = x + step, ny = Math.min(y1, Math.max(y0, y + rnd.range(-wave, wave) * .5));
      d += `Q${n(x + step / 2)} ${n((y + ny) / 2 + rnd.range(-wave, wave) * .4)} ${n(nx)} ${n(ny)}`;
      x = nx; y = ny;
    }
    (rnd.chance(.6) ? dark : light).push(d);
  }
  const w = Math.max(.00025, h / lines * .22);
  t.line(dark.join(''), w, { a: mul(tone, .8), o: .45, r: .6, ro: .3 });
  t.line(light.join(''), w * .8, { a: mul(tone, 1.1), o: .35 });
  if (rnd.chance(.35)) {
    const cx = rnd.range(x0, x1), cy = y0 + h * rnd.range(.3, .7);
    let arch = '';
    for (let k = 1; k <= 5; k++) { const l = h * .18 * k; arch += `M${n(cx - l * 3)} ${n(cy - h * .045 * k)}Q${n(cx + l * 2.5)} ${n(cy)} ${n(cx - l * 3)} ${n(cy + h * .045 * k)}`; }
    t.line(arch, w, { a: mul(tone, .78), o: .4 });
  }
}

function knot(t: TileArt, x: number, y: number, s: number, tone: RGB): void {
  t.ellipse(x, y, s * 1.8, s, { a: mul(tone, .55), r: .6, o: .9 });
  t.ellipse(x, y, s * .8, s * .45, { a: mul(tone, .38), r: .4 });
  t.ellipse(x, y, s * 3.2, s * 1.5, { a: mul(tone, .8), o: .35 });
}

/** Adze- or axe-hewn faces: scalloped tool marks across the grain, drying checks and knots. */
function hewnTimber(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const planks = ctx.material === 'rough-hewn-timber';
  const rows = planks ? lengths(rnd, T, .04, .07) : [T];
  let y = 0;
  t.rect(0, 0, T, T, { a: mul(ctx.color, .45), r: 0, s: 1 });
  for (const h of rows) {
    const gap = planks ? .0012 : 0;
    const tone = vary(mix(ctx.color, [128, 124, 116], ctx.wear * .45), rnd, .08, .05);
    t.rect(0, y + gap, T, h - gap * 2, { a: tone, r: .72, s: ctx.roughness });
    // Long colour streaks follow the grain.
    for (let k = 0; k < 3; k++) t.rect(0, y + h * rnd.range(0, .85), T, h * rnd.range(.05, .2), { a: mul(tone, rnd.range(.86, 1.12)), o: .4 });
    grain(t, 0, y + gap, T, y + h - gap, tone, Math.round(h * 160), h * .03);
    // Adze scallops: overlapping shallow scoops in rows across the face.
    for (let x = rnd.range(0, .02); x < T; x += rnd.range(.012, .02)) {
      const cy = y + h * rnd.range(.2, .8);
      t.ellipse(x, cy, rnd.range(.006, .01), h * rnd.range(.25, .45), { r: .6, ro: .45, a: mul(tone, .93), o: .3 });
    }
    // Drying checks: long dark splits along the grain.
    for (let k = 0; k < (planks ? 1 : 3); k++) if (rnd.chance(.7)) {
      const cx = rnd.range(0, T), cy = y + h * rnd.range(.2, .8), len = rnd.range(.04, .14);
      t.line(`M${n(cx)} ${n(cy)}q${n(len / 2)} ${n(rnd.range(-.002, .002))} ${n(len)} ${n(rnd.range(-.002, .002))}`, .0011, { a: mul(tone, .3), r: .05, s: 1 });
    }
    if (rnd.chance(.6)) knot(t, rnd.range(0, T), y + h * rnd.range(.25, .75), Math.min(h * .12, .005), tone);
    // Pegs and treenails in the frame, at the joints' spacing.
    if (!planks) for (let k = 0; k < 2; k++) {
      const px = rnd.range(0, T), py = rnd.range(h * .25, h * .75);
      t.ellipse(px, py, .0035, .0035, { a: mul(tone, .78), r: .82 });
      t.ellipse(px, py, .0035, .0035, { a: mul(tone, .5), o: .5 }, 0);
    }
    y += h;
  }
}

/** Sawn or planed boards: lapped weatherboards or flush boards, saw marks and nail lines. */
function sawnBoard(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const finished = ctx.material === 'finished-wood';
  const lapped = !finished && ctx.design.boards === 'horizontal';
  const rows = lengths(rnd, T, finished ? .022 : .028, finished ? .03 : .04);
  t.rect(0, 0, T, T, { a: mul(ctx.color, .4), r: 0, s: 1 });
  let y = 0;
  for (const h of rows) {
    const tone = vary(mix(ctx.color, [132, 128, 120], ctx.wear * (finished ? .2 : .5)), rnd, finished ? .05 : .08, .04);
    // Butt joints: boards end within the repeat.
    const pieces = lengths(rnd, T, .12, .3);
    let x = rnd.range(0, .1);
    for (const w of pieces) {
      const bt = vary(tone, rnd, .04, .02);
      t.rect(x + .0008, y + .0008, w - .0016, h - .0016, { a: bt, r: lapped ? null : .76, s: finished ? .62 : ctx.roughness });
      if (lapped) t.raw(undefined, `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#lap)"/>`);
      grain(t, x, y, x + w, y + h, bt, Math.round(h * 220), h * .02);
      if (ctx.craft.boards === 'sawn') {
        // Circular or pit-saw kerf marks across the board.
        let saw = '';
        for (let s = x + rnd.range(0, .006); s < x + w; s += .006) saw += ctx.plan.spec.period === 'industrial' || ctx.plan.spec.period === 'modern'
          ? `M${n(s)} ${n(y)}q${n(.004)} ${n(h / 2)} 0 ${n(h)}` : `M${n(s)} ${n(y)}l${n(.0015)} ${n(h)}`;
        t.line(saw, .0005, { a: mul(bt, .85), o: .3, r: .65, ro: .3 });
      }
      for (const nx of [x + .006, x + w - .006]) t.ellipse(nx, y + h * .5, .0012, .0012, { a: [62, 54, 48], r: .85, s: .4 });
      x += w;
    }
    if (rnd.chance(.25)) knot(t, rnd.range(0, T), y + h * .5, h * .12, tone);
    y += h;
  }
  // Paint, where the era painted boards, survives in flakes rather than as a fresh coat.
  if (finished && ctx.wear > .25) for (let i = 0; i < 6; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * .03, { a: mul(ctx.color, 1.25), o: .35 }, 6, .4);
}

/** Round logs with chinking: a cylinder profile per course, bark remnants and checking. */
function logStack(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const rowsN = 8, h = T / rowsN;
  t.rect(0, 0, T, T, { a: mix(ctx.color, [176, 160, 132], .55), r: 0, s: 1 });
  for (let row = 0; row < rowsN; row++) {
    const y0 = row * h, tone = vary(mix(ctx.color, [120, 116, 108], ctx.wear * .5), rnd, .08, .05);
    t.rect(0, y0 + h * .06, T, h * .88, { a: tone, s: ctx.roughness }, h * .3);
    t.raw(undefined, `<rect x="0" y="${n(y0 + h * .06)}" width="${n(T)}" height="${n(h * .88)}" fill="url(#cyl)"/>`);
    grain(t, 0, y0 + h * .15, T, y0 + h * .85, tone, 6, h * .03);
    for (let k = 0; k < 3; k++) if (rnd.chance(.5)) {
      // Bark left in the hollows, dark and rough.
      t.blotch(rnd.range(0, T), y0 + h * rnd.range(.2, .8), h * .18, { a: [70, 56, 44], o: .8, s: 1, r: .55 }, 7, .5);
    }
    if (rnd.chance(.8)) {
      const cx = rnd.range(0, T), len = rnd.range(.05, .15);
      t.line(`M${n(cx)} ${n(y0 + h * .45)}l${n(len)} ${n(rnd.range(-.002, .002))}`, .0015, { a: mul(tone, .35), r: .1 });
    }
    if (rnd.chance(.5)) knot(t, rnd.range(0, T), y0 + h * .5, h * .1, tone);
    // Chinking: mud, moss or lime between the logs.
    t.rect(0, y0 - h * .05, T, h * .1, { a: mix(mortarFor(ctx), [120, 112, 80], .3), r: .25, s: 1, o: .9 });
  }
}

// ----------------------------------------------------------------------------------- finishes

/** Lime render and stucco: an undulating hand-floated surface, uneven limewash coats, hairline
 * crazing, and spalled or patched areas exposing the wall behind. */
function plaster(t: TileArt, ctx: Context, earthen = false): void {
  const { T, rnd } = t;
  const base = ctx.color;
  t.rect(0, 0, T, T, { a: base, r: .6, s: ctx.roughness });
  // Float undulation: many soft, overlapping hollows and swells, blurred into a gentle relief.
  t.soft(() => { for (let i = 0; i < 90; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.015, .045),
    { r: rnd.chance(.5) ? rnd.range(.7, .82) : rnd.range(.38, .5), ro: .6 }, 7, rnd.range(.5, 1)); }, 'mid');
  // Limewash builds up unevenly: broad clouds of brighter and duller coats.
  t.soft(() => { for (let i = 0; i < 26; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.04, .12),
    { a: rnd.chance(.5) ? mix(base, [242, 238, 226], rnd.range(.1, .25)) : mix(base, mul(base, .84), rnd.range(.4, .8)), o: rnd.range(.25, .45) }, 9, rnd.range(.5, 1)); });
  // Fine aggregate and pin holes.
  for (let i = 0; i < 380; i++) {
    const dark = rnd.chance(.5);
    t.ellipse(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.001, .0022), T * .0012, { a: dark ? mul(base, .8) : mix(base, [250, 246, 236], .4), o: .55, r: dark ? .4 : .7 });
  }
  // Hairline crazing: short, branching, broken cracks.
  const crazing = Math.round(2 + ctx.wear * 7);
  for (let i = 0; i < crazing; i++) {
    let x = rnd.range(0, T), y = rnd.range(0, T), a = rnd.range(0, Math.PI * 2);
    for (let k = 0; k < 4; k++) {
      let d = `M${n(x)} ${n(y)}`;
      for (let s = 0; s < 3; s++) { a += rnd.range(-.7, .7); x += Math.cos(a) * T * .01; y += Math.sin(a) * T * .01; d += `L${n(x)} ${n(y)}`; }
      t.line(d, T * .0011, { a: mul(base, .58), o: rnd.range(.35, .7), r: .32 });
      if (rnd.chance(.4)) a += rnd.chance(.5) ? 1.2 : -1.2;
    }
  }
  // Spalled patches reveal the substrate; later repairs show as a different lime.
  const spalls = Math.round((1 - ctx.maintenance) * 1.2 + ctx.wear * 1.5);
  for (let i = 0; i < spalls; i++) {
    const cx = rnd.range(0, T), cy = rnd.range(0, T), r = T * rnd.range(.03, .06);
    t.blotch(cx, cy, r * 1.15, { a: mul(base, .86), r: .5 }, 11, .7);
    t.blotch(cx, cy, r, { a: earthen ? mix(base, [126, 100, 72], .55) : mix(base, [146, 128, 104], .6), r: .25, s: 1 }, 11, .7);
    if (!earthen) for (let k = 0; k < 3; k++) {
      const sx = cx + rnd.range(-r, r) * .5, sy = cy + rnd.range(-r, r) * .4;
      t.path(poly(unitOutline(rnd, sx - r * .3, sy - r * .15, sx + r * .3, sy + r * .15, .3)), { a: rnd.chance(.5) ? [150, 142, 128] : [160, 96, 70], r: .42, o: .95 });
    }
  }
  if (rnd.chance(.45)) t.soft(() => t.blotch(rnd.range(0, T), rnd.range(0, T), T * .08, { a: mix(base, [238, 234, 222], .18), r: .64, o: .7 }, 8, .8), 'mid');
}

/** Wattle and daub: straw-tempered clay over woven rods, limewashed, cracking along the hurdle. */
function daub(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  plaster(t, ctx, true);
  // Straw temper shows through the wash.
  let straw = '';
  for (let i = 0; i < 220; i++) { const x = rnd.range(0, T), y = rnd.range(0, T), a = rnd.range(0, Math.PI), l = rnd.range(.003, .009); straw += `M${n(x)} ${n(y)}l${n(Math.cos(a) * l)} ${n(Math.sin(a) * l)}`; }
  t.line(straw, .0007, { a: [190, 160, 96], o: .5, r: .62, ro: .4 });
  // Shrinkage cracks follow the hidden wattle rods: horizontal runs between vertical staves.
  const rods = T / 7;
  for (let k = 0; k < 7; k++) if (rnd.chance(.4 + ctx.wear * .4)) {
    const y = k * rods + rnd.range(-rods * .1, rods * .1), x0 = rnd.range(0, T * .6);
    t.line(`M${n(x0)} ${n(y)}q${n(.015)} ${n(rnd.range(-.004, .004))} ${n(rnd.range(.02, .06))} ${n(rnd.range(-.003, .003))}`, .0006, { a: mul(ctx.color, .62), r: .3, o: .5 });
  }
  // Where daub has fallen away, the woven hazel shows.
  if (rnd.chance(.35 + ctx.wear * .4 - ctx.maintenance * .2)) {
    const cx = rnd.range(T * .2, T * .8), cy = rnd.range(T * .2, T * .8), r = T * .07;
    t.blotch(cx, cy, r, { a: [86, 70, 50], r: .2, s: 1 }, 8, .8);
    for (let k = -2; k <= 2; k++) t.line(`M${n(cx - r)} ${n(cy + k * r * .3)}q${n(r / 2)} ${n(r * .1 * (k % 2 ? 1 : -1))} ${n(r * 2)} 0`, r * .18, { a: [150, 118, 78], r: .5, s: .9, o: .9 });
  }
}

/** Adobe render: hand-smoothed mud, rain-cut runnels, and coursed blocks where it has eroded. */
function adobe(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  plaster(t, ctx, true);
  for (let i = 0; i < 10; i++) {
    const x = rnd.range(0, T), y = rnd.range(0, T * .6), len = rnd.range(.05, .2);
    t.line(`M${n(x)} ${n(y)}q${n(rnd.range(-.004, .004))} ${n(len / 2)} ${n(rnd.range(-.006, .006))} ${n(len)}`, .0025, { a: mul(ctx.color, .86), o: .5, r: .35 });
  }
  if (rnd.chance(.5 + ctx.wear * .4)) {
    const cx = rnd.range(0, T), cy = rnd.range(T * .5, T), w = T * .16, h = T * .08;
    t.blotch(cx, cy, w * .6, { a: mix(ctx.color, [120, 92, 60], .4), r: .3 }, 9, .5);
    for (let k = 0; k < 3; k++) t.rect(cx - w / 2 + k * w / 3, cy - h * .3, w / 3 - .002, h * .4, { a: vary(mix(ctx.color, [150, 116, 80], .3), rnd, .06, .03), r: .45, o: .85 });
  }
}

/** Concrete: board-formed or panel-formed lifts, tie-cone holes, bug holes and lime bloom. */
function concrete(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const boardForm = ctx.plan.spec.period === 'industrial' || ctx.plan.spec.period === 'modern';
  t.rect(0, 0, T, T, { a: ctx.color, r: .55, s: ctx.roughness });
  t.soft(() => { for (let i = 0; i < 14; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.05, .14), { a: mul(ctx.color, rnd.range(.9, 1.08)), o: .35 }, 9, .7); });
  if (boardForm) {
    const boards = lengths(rnd, T, .022, .03);
    let y = 0;
    for (const h of boards) {
      t.rect(0, y, T, h, { a: mul(ctx.color, rnd.range(.95, 1.05)), o: .5, r: rnd.range(.5, .6) });
      grain(t, 0, y, T, y + h, mul(ctx.color, 1.03), 4, h * .02);
      t.line(`M0 ${n(y)}H${n(T)}`, .0008, { a: mul(ctx.color, .8), o: .6, r: .4 });
      y += h;
    }
  } else {
    // Contemporary: smooth panel formwork with a tie-cone grid and crisp panel joints.
    t.line(`M0 ${n(T / 2)}H${n(T)}M${n(T / 2)} 0V${n(T)}M0 0H${n(T)}M0 0V${n(T)}`, .0012, { a: mul(ctx.color, .8), o: .7, r: .35 });
  }
  for (let x = T / 8; x < T; x += T / 4) for (let y = T / 8; y < T; y += T / 4) {
    t.ellipse(x, y, .0028, .0028, { a: mul(ctx.color, .6), r: .2, s: .8 });
    t.ellipse(x, y, .0014, .0014, { a: [76, 64, 54], r: .1 });
  }
  for (let i = 0; i < 120; i++) t.ellipse(rnd.range(0, T), rnd.range(0, T), .0009, .0008, { a: mul(ctx.color, .55), o: .8, r: .35 });
  // Lime bloom and run-off weep from the lower edge of a few tie holes and lift joints.
  t.soft(() => { for (let i = 0; i < 3 + ctx.wear * 4; i++) {
    const x = T / 8 + rnd.int(0, 4) * T / 4, y = T / 8 + rnd.int(0, 4) * T / 4, len = rnd.range(.02, .07);
    t.path(poly([[x - .0015, y], [x + .0015, y], [x + .003, y + len], [x - .003, y + len]]), { a: rnd.chance(.5) ? [214, 212, 202] : mul(ctx.color, .78), o: .2 + ctx.wear * .2 });
  } }, 'mid');
}

// ----------------------------------------------------------------------------------- metal

function rust(t: TileArt, ctx: Context, x: number, y: number, len: number, copper: boolean): void {
  const rnd = t.rnd, tint: RGB = copper ? [92, 150, 122] : [128, 70, 38];
  // Run-off spreads and fades as it falls: a soft tapering stain, never a painted stripe.
  t.soft(() => {
    t.path(poly([[x - .0015, y], [x + .0015, y], [x + .003 + rnd.range(0, .002), y + len], [x - .002 - rnd.range(0, .002), y + len * rnd.range(.7, 1)]]),
      { a: tint, o: (.15 + ctx.wear * .3) * rnd.range(.5, 1), s: .9 });
    t.ellipse(x, y + .002, .0025, .002, { a: mul(tint, .8), o: .4 + ctx.wear * .3 });
  }, 'mid');
}

/** Corrugated sheet: true sinusoidal section, side laps, fixings on the crowns, streaking from each. */
function corrugated(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const pitch = T / 16;
  t.rect(0, 0, T, T, { a: ctx.color, s: ctx.roughness });
  for (let x = 0; x < T - 1e-6; x += pitch) t.raw(undefined, `<rect x="${n(x)}" y="0" width="${n(pitch)}" height="${n(T)}" fill="url(#corr)"/>`,
    `<rect x="${n(x)}" y="0" width="${n(pitch)}" height="${n(T)}" fill="url(#corrRough)"/>`);
  // Galvanising spangle and oxidation drifts.
  t.soft(() => { for (let i = 0; i < 16; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.04, .1), { a: mul(ctx.color, rnd.range(.88, 1.1)), o: .35 }, 9, rnd.range(.6, 1.6)); });
  const sheetW = T / 2;
  for (let x = 0; x < T; x += sheetW) t.line(`M${n(x)} 0V${n(T)}`, pitch * .15, { a: mul(ctx.color, .7), o: .7, r: .1 });
  for (const y of [T * .1, T * .6]) for (let x = pitch / 2; x < T; x += pitch * 2) {
    t.ellipse(x, y, .0016, .0016, { a: [70, 70, 72], r: 1, s: .5 });
    if (rnd.chance(.12 + ctx.wear * .35)) rust(t, ctx, x, y, rnd.range(.015, .06), false);
  }
  t.rect(0, T * .9, T, T * .1, { a: [126, 82, 48], o: ctx.wear * .45 });
}

/** Standing-seam or copper pans: raised ribs, oil-canning ripples and run-off patina. */
function standingSeam(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const copper = ctx.material === 'copper';
  const pan = T / 5;
  t.rect(0, 0, T, T, { a: ctx.color, r: .45, s: ctx.roughness });
  for (let x = 0; x < T - 1e-6; x += pan) {
    t.rect(x, 0, pan, T, { a: vary(ctx.color, rnd, .04, .02), o: .8 });
    // Oil-canning: broad, shallow buckles in each pan.
    for (let k = 0; k < 3; k++) t.blotch(x + pan / 2, rnd.range(0, T), pan * .35, { r: rnd.chance(.5) ? .52 : .38, ro: .5 }, 7, 2.2);
    t.rect(x - .0012, 0, .0024, T, { a: mul(ctx.color, 1.12), r: 1, s: ctx.roughness * .8 });
    t.rect(x + .0012, 0, .0012, T, { a: mul(ctx.color, .7), r: .7 });
  }
  if (copper) {
    // Verdigris forms where water runs and lingers.
    for (let i = 0; i < 18; i++) {
      const x = rnd.range(0, T), y = rnd.range(0, T), len = rnd.range(.04, .14);
      t.path(poly([[x, y], [x + .004, y], [x + .007, y + len], [x - .002, y + len]]), { a: [86, 152, 126], o: .3 + ctx.wear * .5, s: .95 });
    }
  } else for (let i = 0; i < 5; i++) rust(t, ctx, rnd.range(0, T), rnd.range(0, T), rnd.range(.02, .08), false);
}

/** Rolled steel plate: riveted lap seams (industrial), bolted splices or welds, mill scale and rust. */
function rolledSteel(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  t.rect(0, 0, T, T, { a: ctx.color, r: .5, s: ctx.roughness });
  t.soft(() => { for (let i = 0; i < 20; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.03, .09), { a: mul(ctx.color, rnd.range(.82, 1.1)), o: .4, s: ctx.roughness + .1, ro: .4 }, 8, .8); });
  const plateW = T / 2, plateH = T / 3;
  for (let y = 0; y < T - 1e-6; y += plateH) {
    t.rect(0, y, T, .0035, { a: mul(ctx.color, .9), r: .7 });
    t.line(`M0 ${n(y)}H${n(T)}`, .0008, { a: mul(ctx.color, .5), r: .2 });
    if (ctx.craft.joints === 'rivet') for (let x = .006; x < T; x += .009) {
      t.ellipse(x, y + .0018, .0014, .0014, { a: mul(ctx.color, 1.05), r: 1, s: ctx.roughness * .9 });
      if (rnd.chance(.12 + ctx.wear * .2)) rust(t, ctx, x, y + .003, rnd.range(.01, .04), false);
    } else if (ctx.craft.joints === 'weld') {
      let bead = '';
      for (let x = 0; x < T; x += .0018) bead += `M${n(x)} ${n(y - .0008)}q.0009 .0016 .0018 0`;
      t.line(bead, .0009, { a: mul(ctx.color, .82), r: .85 });
    } else for (let x = .01; x < T; x += .04) t.rect(x - .0018, y - .0006, .0036, .0036, { a: mul(ctx.color, .8), r: .95 }, .0006);
  }
  for (let x = 0; x < T; x += plateW) t.line(`M${n(x)} 0V${n(T)}`, .0008, { a: mul(ctx.color, .55), r: .25 });
  for (let i = 0; i < 4 + ctx.wear * 10; i++) rust(t, ctx, rnd.range(0, T), rnd.range(0, T), rnd.range(.01, .06), false);
}

/** Cast iron: moulded panels with beaded borders and bolted flanges, paint wearing to oxide. */
function castMetal(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  t.rect(0, 0, T, T, { a: ctx.color, r: .35, s: ctx.roughness });
  const cols = 2, rows = 3, w = T / cols, h = T / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = i * w, y = j * h;
    t.rect(x + .004, y + .004, w - .008, h - .008, { a: mul(ctx.color, 1.04), r: .75 }, .003);
    t.rect(x + .012, y + .012, w - .024, h - .024, { a: mul(ctx.color, .94), r: .55 }, .002);
    for (const [bx, by] of [[x + .008, y + .008], [x + w - .008, y + .008], [x + .008, y + h - .008], [x + w - .008, y + h - .008]] as const)
      t.ellipse(bx, by, .0022, .0022, { a: mul(ctx.color, 1.1), r: 1, s: ctx.roughness * .8 });
    t.ellipse(x + w / 2, y + h / 2, w * .1, w * .1, { a: mul(ctx.color, 1.05), r: .85 });
    t.ellipse(x + w / 2, y + h / 2, w * .05, w * .05, { a: mul(ctx.color, .9), r: .6 });
  }
  for (let i = 0; i < 4 + ctx.wear * 8; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * .02, { a: [120, 66, 38], o: .4 + ctx.wear * .3, s: .95 }, 6, 1.4);
}

/** Wrought iron: hammered bar texture, forged straps and hot rivets. */
function wroughtMetal(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  t.rect(0, 0, T, T, { a: ctx.color, r: .5, s: ctx.roughness });
  for (let i = 0; i < 140; i++) t.ellipse(rnd.range(0, T), rnd.range(0, T), .004, .003, { a: mul(ctx.color, rnd.range(.85, 1.15)), o: .45, r: rnd.range(.42, .58) }, rnd.range(0, 180));
  for (let y = T / 6; y < T; y += T / 3) {
    t.rect(0, y, T, .012, { a: mul(ctx.color, 1.05), r: .8 });
    for (let x = .015; x < T; x += .05) t.ellipse(x, y + .006, .0025, .0025, { a: mul(ctx.color, 1.15), r: 1 });
  }
  for (let i = 0; i < 3 + ctx.wear * 6; i++) rust(t, ctx, rnd.range(0, T), rnd.range(0, T), rnd.range(.01, .05), false);
}

/** Aluminium cassette panels: gasketed joints, brushed grain, fixings at the corners. */
function sheetPanel(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  t.rect(0, 0, T, T, { a: mul(ctx.color, .3), r: 0, s: .8 });
  for (let x = 0; x < T - 1e-6; x += T / 2) for (let y = 0; y < T - 1e-6; y += T / 4) {
    const tone = vary(ctx.color, rnd, .025, .01);
    t.rect(x + .0016, y + .0016, T / 2 - .0032, T / 4 - .0032, { a: tone, r: .75, s: ctx.roughness + rnd.range(-.05, .05) });
    let brush = '';
    for (let k = 0; k < 18; k++) { const by = y + rnd.range(.003, T / 4 - .003); brush += `M${n(x + .003)} ${n(by)}H${n(x + T / 2 - .003)}`; }
    t.line(brush, .0004, { a: mul(tone, 1.06), o: .4, s: ctx.roughness - .08, ro: .5 });
  }
}

/** Bituminous membrane: lapped roll strips, mineral granules, blisters and ponding stains. */
function membrane(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  t.rect(0, 0, T, T, { a: ctx.color, r: .5, s: ctx.roughness });
  for (let i = 0; i < 400; i++) t.rect(rnd.range(0, T), rnd.range(0, T), .0012, .0012, { a: mul(ctx.color, rnd.range(.7, 1.4)), o: .7 });
  for (let x = 0; x < T - 1e-6; x += T / 3) { t.rect(x, 0, .006, T, { a: mul(ctx.color, .88), r: .7 }); t.line(`M${n(x + .006)} 0V${n(T)}`, .0008, { a: mul(ctx.color, .6), r: .45 }); }
  t.soft(() => { for (let i = 0; i < 3; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.06, .12), { a: [92, 90, 80], o: .3 }, 9, .8); });
  for (let i = 0; i < 4; i++) t.ellipse(rnd.range(0, T), rnd.range(0, T), .006, .004, { r: .75 });
}

/** Moulded architectural terracotta: pressed blocks with sunk panels, beads and the odd rosette. */
function terracotta(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  t.rect(0, 0, T, T, { a: mix(ctx.color, [210, 196, 176], .5), r: .3, s: .95 });
  const rowsN = 5, h = T / rowsN;
  for (let row = 0; row < rowsN; row++) {
    const xs = lengths(rnd, T, h * 1.6, h * 2.4);
    let x = row % 2 ? xs[0]! / 2 : 0;
    for (const w of xs) {
      const tone = vary(ctx.color, rnd, .06, .04), x0 = x + .0012, y0 = row * h + .0012, x1 = x + w - .0012, y1 = (row + 1) * h - .0012;
      t.rect(x0, y0, x1 - x0, y1 - y0, { a: tone, r: .8, s: ctx.roughness });
      const m = h * .14;
      t.rect(x0 + m, y0 + m, x1 - x0 - m * 2, y1 - y0 - m * 2, { a: mul(tone, .93), r: .62 }, h * .05);
      t.rect(x0 + m * 1.6, y0 + m * 1.6, x1 - x0 - m * 3.2, y1 - y0 - m * 3.2, { a: mul(tone, 1.03), r: .7 }, h * .04);
      if (rnd.chance(.4)) for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        t.ellipse(cx + Math.cos(a) * h * .14, cy + Math.sin(a) * h * .14, h * .07, h * .035, { a: mul(tone, 1.06), r: .86 }, a * 180 / Math.PI);
      }
      x += w;
    }
  }
}

/** The culture's ornament, carved in shallow relief and painted: a fret, scroll, zigzag, lozenge
 * chain or interlace in two bands, with paint worn back at the arrises and dirt in the sinkings.
 * Painted in neutral values so the live ornament colour (culture accent) tints it. */
function ornament(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const ground: RGB = [140, 140, 140], figure: RGB = [196, 196, 196];
  t.rect(0, 0, T, T, { a: ground, r: .42, s: .8 });
  const rows = 2, h = T / rows, units = 4, w = T / units;
  for (let row = 0; row < rows; row++) {
    const y0 = row * h;
    // Fillets frame each band.
    t.rect(0, y0, T, h * .08, { a: mul(figure, .94), r: .85, s: .7 });
    t.rect(0, y0 + h * .92, T, h * .08, { a: mul(figure, .94), r: .85, s: .7 });
    for (let k = 0; k < units; k++) {
      const x = k * w + (row % 2 ? w / 2 : 0), cy = y0 + h / 2, a = h * .3;
      const at = (pts: [number, number][]): [number, number][] => pts.map(([u, v]) => [x + u * w, cy + v * a]);
      let shapes: string[];
      switch (ctx.plan.pattern) {
        case 'terrace': shapes = [poly(at([[.05, .9], [.05, -.2], [.35, -.2], [.35, -.9], [.95, -.9], [.95, -.55], [.55, -.55], [.55, .15], [.25, .15], [.25, .9]]))]; break;
        case 'wave': shapes = [smoothClosed(at([[0, .6], [.2, -.6], [.45, -.8], [.6, -.2], [.45, .2], [.35, 0], [.5, .9], [.95, .6], [.8, .9]]))]; break;
        case 'chevron': shapes = [poly(at([[0, .8], [.5, -.6], [1, .8], [1, .3], [.5, -1.1], [0, .3]]))]; break;
        case 'diamond': shapes = [poly(at([[.5, -1], [.95, 0], [.5, 1], [.05, 0]])), poly(at([[.5, -.45], [.72, 0], [.5, .45], [.28, 0]]))]; break;
        default: shapes = [poly(at([[0, -.8], [1, .6], [1, .95], [0, -.45]])), poly(at([[0, .8], [1, -.6], [1, -.95], [0, .45]]))];
      }
      shapes.forEach((d, i) => {
        const inner = ctx.plan.pattern === 'diamond' && i === 1;
        t.path(d, { a: inner ? ground : vary(figure, rnd, .03, .01), r: inner ? .45 : .82, s: inner ? .8 : .55 });
        if (!inner) t.path(d, { a: 'url(#rind)', o: .35 + ctx.wear * .3 });
      });
    }
  }
  // Paint worn back at exposed points; grime gathers in the sinkings.
  t.soft(() => { for (let i = 0; i < 4 + ctx.wear * 10; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.02, .05), { a: [104, 100, 94], o: .25 + ctx.wear * .35 }, 7, .6); }, 'mid');
}

/** Unitised curtain wall: anodised mullions and transoms, an opaque spandrel at each slab, and
 * insulated units that differ slightly in tint and coating. Relief marks the opaque framing. */
function curtainWall(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const frame: RGB = ctx.plan.spec.period === 'contemporary' ? [92, 98, 104] : [70, 74, 78];
  t.rect(0, 0, T, T, { a: ctx.color, r: .45, s: .08 });
  const bays = 3, bw = T / bays, spandrel = T * .2, mullion = Math.max(.003, T * .018);
  for (let b = 0; b < bays; b++) {
    const x0 = b * bw;
    // Vision glass above, a lighter transom light below the head.
    for (const [y0, y1] of [[0, T * .14], [T * .14, T - spandrel]] as const) {
      const pane = vary(mix(ctx.color, [60, 86, 98], rnd.range(0, .35)), rnd, .06, .04);
      t.rect(x0 + mullion / 2, y0 + mullion / 2, bw - mullion, y1 - y0 - mullion, { a: pane, r: .5, s: rnd.range(.03, .08) });
      // Interior: the odd blind or ceiling light seen through the unit.
      if (rnd.chance(.35)) t.rect(x0 + mullion, y0 + mullion, bw - mullion * 2, (y1 - y0) * rnd.range(.1, .4), { a: [176, 170, 156], o: .35, r: .5 });
    }
    // Spandrel: back-painted glass or a metal panel over the slab edge.
    t.rect(x0, T - spandrel, bw, spandrel, { a: mix(frame, ctx.color, .25), r: .78, s: .3 });
    t.rect(x0, 0, mullion, T, { a: frame, r: .95, s: .45 });
  }
  for (const y of [0, T * .14, T - spandrel]) t.rect(0, y - mullion / 2, T, mullion, { a: mul(frame, 1.05), r: .95, s: .45 });
  // Pressure-cap fixings along the mullions.
  for (let b = 0; b < bays; b++) for (let y = T * .05; y < T; y += T * .12) t.ellipse(b * bw + mullion / 2, y, mullion * .2, mullion * .2, { a: mul(frame, .7), r: 1 });
}

/** Canvas and cloth: a visible tabby weave, sewn cloths with doubled seams, bolt-rope edges,
 * patches and weather staining. Neutral values; the fabric's own colour tints it live. */
function textile(t: TileArt, ctx: Context): void {
  const { T, rnd } = t;
  const base: RGB = [180, 180, 180];
  t.rect(0, 0, T, T, { a: base, r: .5, s: .95 });
  // Weave: alternating warp and weft floats, too fine to resolve except as a soft texture.
  const pitch = T / 120;
  let warp = '', weft = '';
  for (let k = 0; k < 120; k++) { warp += `M${n(k * pitch)} 0V${n(T)}`; weft += `M0 ${n(k * pitch)}H${n(T)}`; }
  t.line(warp, pitch * .35, { a: mul(base, 1.06), o: .5, r: .62, ro: .5 });
  t.line(weft, pitch * .35, { a: mul(base, .9), o: .5, r: .4, ro: .5 });
  // Cloths sewn edge to edge: each a slightly different bolt, joined by a doubled seam.
  const cloths = 4, cw = T / cloths;
  for (let c = 0; c < cloths; c++) {
    t.rect(c * cw, 0, cw, T, { a: vary(base, rnd, .05, .03), o: .45 });
    t.rect(c * cw - .0012, 0, .0024, T, { a: mul(base, .92), o: .6, r: .6, s: .9 });
    let stitches = '';
    for (let y = 0; y < T; y += .002) stitches += `M${n(c * cw + .0016)} ${n(y)}v.001M${n(c * cw - .0016)} ${n(y + .001)}v.001`;
    t.line(stitches, .0004, { a: mul(base, .8), o: .35 });
  }
  // Patches and weathering: sails and awnings are mended, not replaced.
  for (let i = 0; i < 1 + ctx.wear * 3; i++) {
    const x = rnd.range(0, T), y = rnd.range(0, T), w = T * rnd.range(.06, .12), h = T * rnd.range(.05, .1);
    t.rect(x, y, w, h, { a: vary(base, rnd, .08, .04), r: .6, s: .9 });
    t.line(`M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`, .0006, { a: mul(base, .7), r: .7, o: .8 });
  }
  t.soft(() => { for (let i = 0; i < 4 + ctx.wear * 8; i++) t.blotch(rnd.range(0, T), rnd.range(0, T), T * rnd.range(.04, .1), { a: [118, 112, 100], o: .15 + ctx.wear * .25 }, 8, rnd.range(.5, 1.5)); });
}

const PAINTERS: Partial<Record<SurfaceProgram, (t: TileArt, ctx: Context) => void>> = {
  'brick-coursing': brick, 'mud-brick': mudBrick, rubble, 'coursed-stone': coursedStone, ashlar,
  'slate-course': slate, 'tile-course': clayTile, terracotta, thatch, shingle,
  'log-stack': logStack, 'hewn-timber': hewnTimber, 'sawn-board': sawnBoard,
  plaster: (t, ctx) => plaster(t, ctx), 'daub-panel': daub, 'adobe-render': adobe, 'concrete-form': concrete,
  'wrought-metal': wroughtMetal, 'cast-metal': castMetal, 'rolled-steel': rolledSteel,
  'corrugated-sheet': corrugated, 'standing-seam': standingSeam, 'sheet-panel': sheetPanel, membrane, 'curtain-wall': curtainWall,
};

/** Shared per-layer definitions; objectBoundingBox gradients fit every unit they fill. */
function defs(layer: Layer, id: string, T: number, px: number, padT: number): string {
  return softFilters + layerDefs(layer, id, T, px, padT);
}
const softFilters = '<filter id="wide" primitiveUnits="objectBoundingBox" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation=".012"/></filter>'
  + '<filter id="mid" primitiveUnits="objectBoundingBox" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation=".004"/></filter>';
function layerDefs(layer: Layer, id: string, T: number, px: number, padT: number): string {
  if (layer === 'albedo') return `<radialGradient id="rind"><stop offset=".55" stop-color="#2e2820" stop-opacity="0"/><stop offset="1" stop-color="#2e2820" stop-opacity=".55"/></radialGradient>`;
  if (layer === 'relief') return `<linearGradient id="lap" x2="0" y2="1"><stop offset=".2" stop-color="${g(60)}"/><stop offset=".93" stop-color="${g(225)}"/><stop offset="1" stop-color="${g(150)}"/></linearGradient>`
    + `<linearGradient id="lapfade" x2="0" y2="1"><stop offset=".25" stop-color="#000" stop-opacity=".55"/><stop offset=".95" stop-color="#000" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="pantile"><stop offset="0" stop-color="${g(90)}"/><stop offset=".45" stop-color="${g(120)}"/><stop offset=".72" stop-color="${g(250)}"/><stop offset=".95" stop-color="${g(110)}"/><stop offset="1" stop-color="${g(80)}"/></linearGradient>`
    + `<linearGradient id="cyl" x2="0" y2="1"><stop offset="0" stop-color="${g(40)}"/><stop offset=".5" stop-color="${g(240)}"/><stop offset="1" stop-color="${g(40)}"/></linearGradient>`
    + `<linearGradient id="corr"><stop offset="0" stop-color="${g(20)}"/><stop offset=".5" stop-color="${g(235)}"/><stop offset="1" stop-color="${g(20)}"/></linearGradient>`
    + [0, 1, 2].map(i => `<linearGradient id="straw${i}" x2="0" y2="1"><stop offset="0" stop-color="${g(30 + i * 20)}"/><stop offset="1" stop-color="${g(200 + i * 20)}"/></linearGradient>`).join('')
    // The nine wrap copies extend across three tiles. Only this tile and its bleed can be seen.
    // Four blur radii outside that viewport retain the convolution without filtering all nine tiles.
    + `<filter id="soft-${id}" filterUnits="userSpaceOnUse" x="${n(-padT - T / px * 4.4)}" y="${n(-padT - T / px * 4.4)}" width="${n(T + padT * 2 + T / px * 8.8)}" height="${n(T + padT * 2 + T / px * 8.8)}"><feGaussianBlur stdDeviation="${n(T / px * 1.1)}"/></filter>`;
  return `<linearGradient id="corrRough"><stop offset="0" stop-color="${g(200)}"/><stop offset=".5" stop-color="${g(120)}"/><stop offset="1" stop-color="${g(200)}"/></linearGradient>`;
}

/** The seamless, physically scaled tile for one material, as one layer's nested SVG. */
export function surfacePanel(plan: FacadePlan, cell: SurfaceArtCell, layer: Layer): string {
  const mat = architecturalMaterial(cell.material);
  const T = cell.tile;
  const rnd = new SeededRandom(`${plan.spec.seed}:${cell.program}`);
  const zone = plan.spec.climate.zone;
  const ctx: Context = { plan, cell, color: rgbOf(mat.appearance.color), craft: ERA_CRAFT[plan.spec.period], design: STRUCTURE_ART[plan.spec.archetype],
    wear: plan.spec.age.wear * (1 - plan.spec.age.maintenance * .3), maintenance: plan.spec.age.maintenance,
    moisture: zone === 'wet' ? .85 : zone === 'tropical' ? .8 : zone === 'snowy' ? .6 : zone === 'cold' ? .45 : zone === 'arid' ? .08 : .4,
    roughness: mat.appearance.roughness, material: cell.material };
  const art = new TileArt(T, rnd);
  const painter = cell.ornament ? ornament : cell.textile ? textile : PAINTERS[mat.appearance.program] ?? ((t: TileArt, c: Context) => plaster(t, c));
  painter(art, ctx);
  const key = layer === 'albedo' ? 'a' : layer === 'relief' ? 'r' : 's';
  const body = art[key], ground = art.groundLayers[key];
  const id = `t${cell.x}-${cell.y}`;
  const padT = cell.pad / cell.width * T;
  const copy = (ref: string): string => [-1, 0, 1].flatMap(i => [-1, 0, 1].map(j => `<use href="#${ref}" x="${n(i * T)}" y="${n(j * T)}"/>`)).join('');
  const copies = copy(`${id}g`) + copy(id);
  const background = layer === 'albedo' ? (cell.ornament || cell.textile ? css(rgbOf(ORNAMENT_REFERENCE)) : css(ctx.color)) : layer === 'relief' ? g(128) : g(mat.appearance.roughness * 255);
  return `<svg x="${cell.x - cell.pad}" y="${cell.y - cell.pad}" width="${cell.width + cell.pad * 2}" height="${cell.height + cell.pad * 2}" viewBox="${n(-padT)} ${n(-padT)} ${n(T + padT * 2)} ${n(T + padT * 2)}" overflow="hidden" data-art-program="${cell.program}">`
    + `<defs>${defs(layer, id, T, cell.width, padT)}<g id="${id}g">${ground.join('')}</g><g id="${id}">${body.join('')}</g></defs>`
    + `<rect x="${n(-padT)}" y="${n(-padT)}" width="${n(T + padT * 2)}" height="${n(T + padT * 2)}" fill="${background}"/>`
    + (layer === 'relief' ? `<g filter="url(#soft-${id})">${copies}</g>` : copies) + '</svg>';
}
