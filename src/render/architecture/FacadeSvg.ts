/**
 * Layered, resolution-independent elevation artwork for hybrid facades.
 *
 * One deterministic composition is drawn into three matched layers, so every painted stone has a
 * colour, a depth and a sheen that agree with each other:
 *
 *   albedo   the material colour, with dirt, lichen and age — never painted light or shadow;
 *   relief   height above the wall plane (128 = plane), which the shader turns into a normal and a
 *            cavity term, so joints, chamfers and carving respond to the real sun;
 *   surface  roughness (255 = fully rough), so wet-looking iron, worn sills and dusty mortar differ.
 *
 * No architecture is decided here. Openings, frame members, string courses and the reveal depth
 * all come from the FacadePlan the geometry was built from, and coursing is shared by all four
 * elevations so quoins interlock at every corner. Every random choice derives from the spec seed.
 */
import { SeededRandom } from '../../sim/prng';
import { ARTWORK_WIDTH, ERA_CRAFT, STRUCTURE_ART, surfaceArtLayout, surfacePanel } from './SurfaceArtPrograms';
import { architecturalMaterial, type ArchitecturalMaterialId } from './MaterialLibrary';
import { FACADE_ATLAS_SIZE, FACADE_ATLAS_BLEED, facadeAtlasLayout, glazingFrameWidth, type AtlasCell, type ElevationPlan, type FacadeOpening, type FacadePlan } from './FacadePlan';

export { FACADE_ATLAS_SIZE } from './FacadePlan';

export interface FacadeArtwork {
  albedo: string;
  relief: string;
  surface: string;
  /** Coverage of composed elements (black) over the material field (white). */
  mask: string;
  /** Where opening contents were painted (white); wall fabric ignores them. */
  openings: string;
  /** Atlas pixels per canonical building unit. */
  density: number;
}

// ------------------------------------------------------------------------------- colour

type RGB = readonly [number, number, number];
const rgbOf = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const css = (c: RGB): string => `#${c.map(v => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const grey = (v: number): string => css([v, v, v]);

const LICHEN: readonly RGB[] = [[196, 168, 82], [160, 168, 132], [205, 196, 170]];

// ------------------------------------------------------------------------------- drawing kit

const f = (v: number): string => String(Math.round(v * 10) / 10);
type Paint = string | { fill?: string; opacity?: number; stroke?: string; width?: number; extra?: string } | undefined;

/** Three SVG layers written in lock-step, plus a coverage mask of the composed elements.
 * Where the mask stays white the wall's own seamless material tile shows through, multiplied by
 * whatever weathering this elevation painted there. */
class LayerSet {
  readonly albedo: string[] = [];
  readonly relief: string[] = [];
  readonly surface: string[] = [];
  readonly mask: string[] = [];
  /** Opening contents (glass, doors, fittings): only real glazing geometry may show these. */
  readonly openings: string[] = [];

  path(d: string, albedo: Paint, relief?: Paint, surface?: Paint): void {
    if (albedo) this.albedo.push(this.element(d, albedo));
    if (relief) this.relief.push(this.element(d, relief));
    if (surface) this.surface.push(this.element(d, surface));
    if (composed(albedo)) {
      const p = typeof albedo === 'string' ? { fill: '#000' } : { ...albedo!, fill: albedo!.fill ? '#000' : undefined, stroke: albedo!.stroke ? '#000' : undefined, opacity: undefined };
      this.mask.push(this.element(d, p));
    }
  }

  /** Raw markup; group and clip structure is mirrored into the mask so clipping stays balanced. */
  raw(albedo?: string, relief?: string, surface?: string, mask?: string): void {
    if (albedo) this.albedo.push(albedo);
    if (relief) this.relief.push(relief);
    if (surface) this.surface.push(surface);
    const structure = mask ?? (albedo ?? relief ?? surface ?? '').match(/<clipPath[\s\S]*?<\/clipPath>|<g(?:\s[^>]*)?>|<\/g>/g)?.join('');
    if (structure) this.mask.push(structure);
  }

  private element(d: string, paint: Exclude<Paint, undefined>): string {
    if (typeof paint === 'string') return `<path d="${d}" fill="${paint}"/>`;
    const fill = paint.fill ?? 'none';
    return `<path d="${d}" fill="${fill}"${paint.opacity !== undefined ? ` opacity="${paint.opacity.toFixed(3)}"` : ''}${paint.stroke ? ` stroke="${paint.stroke}" stroke-width="${f(paint.width ?? 1)}" stroke-linejoin="round" stroke-linecap="round"` : ''}${paint.extra ? ` ${paint.extra}` : ''}/>`;
  }
}

/** Opaque construction (stones, timbers, joinery, glass) as opposed to translucent weathering. */
function composed(paint: Paint): boolean {
  if (!paint) return false;
  if (typeof paint === 'string') return true;
  if (paint.opacity !== undefined && paint.opacity < 0.9) return false;
  if (paint.fill?.startsWith('url(#') && !paint.fill.startsWith('url(#pane')) return false;
  return !!(paint.fill || paint.stroke);
}

/** Drawing context for one elevation: elevation units in, atlas pixels out. */
interface Elevation {
  plan: FacadePlan;
  face: ElevationPlan;
  index: number;
  cell: AtlasCell;
  s: number;
  L: number;
  H: number;
  bleed: number;
  rnd: SeededRandom;
  out: LayerSet;
  lifts: readonly number[];
  palette: Palette;
  weather: Weather;
}

interface Palette {
  mortar: RGB;
  field: RGB;
  dressed: RGB;
  render: RGB;
  wood: RGB;
  iron: RGB;
  interior: RGB;
  lead: RGB;
  quarry: RGB;
  fieldFamily: 'rubble' | 'coursed' | 'ashlar' | 'brick';
}

interface Weather {
  wear: number;
  maintenance: number;
  moisture: number;
  /** 0..1 how much of the elevation faces the prevailing weather (rear/north catches most). */
  exposure: number;
  soot: number;
}

const X = (e: Elevation, u: number): number => e.cell.x + (u + e.L / 2) * e.s;
const Y = (e: Elevation, y: number): number => e.cell.y + (e.H - y) * e.s;
/** Rectangle in elevation units (u0..u1, y0..y1, y up) as an SVG path in atlas pixels. */
function rectD(e: Elevation, u0: number, y0: number, u1: number, y1: number): string {
  const x = X(e, Math.min(u0, u1)), y = Y(e, Math.max(y0, y1));
  return `M${f(x)} ${f(y)}h${f(Math.abs(u1 - u0) * e.s)}v${f(Math.abs(y1 - y0) * e.s)}h${f(-Math.abs(u1 - u0) * e.s)}Z`;
}
function polyD(e: Elevation, points: readonly (readonly [number, number])[]): string {
  return `M${points.map(([u, y]) => `${f(X(e, u))} ${f(Y(e, y))}`).join('L')}Z`;
}

/** A hand-dressed block outline: square-ish, with chipped arrises rather than a perfect rectangle. */
function blockOutline(e: Elevation, u0: number, y0: number, u1: number, y1: number, rough: number): [number, number][] {
  const r = e.rnd, w = u1 - u0, h = y1 - y0;
  const cut = Math.min(w, h) * rough;
  const j = (amount: number): number => r.range(-amount, amount);
  const points: [number, number][] = [
    [u0 + r.range(0, cut), y0 + j(cut * 0.3)], [u1 - r.range(0, cut), y0 + j(cut * 0.3)],
    [u1 + j(cut * 0.3), y0 + r.range(0, cut)], [u1 + j(cut * 0.3), y1 - r.range(0, cut)],
    [u1 - r.range(0, cut), y1 + j(cut * 0.3)], [u0 + r.range(0, cut), y1 + j(cut * 0.3)],
    [u0 + j(cut * 0.3), y1 - r.range(0, cut)], [u0 + j(cut * 0.3), y0 + r.range(0, cut)],
  ];
  // Rubble faces bulge and dip along their long sides as well.
  if (rough > 0.2 && w > h * 1.6) {
    points.splice(1, 0, [u0 + w * r.range(0.35, 0.65), y0 + j(h * 0.12)]);
    points.splice(6, 0, [u0 + w * r.range(0.35, 0.65), y1 + j(h * 0.12)]);
  }
  return points;
}

// ------------------------------------------------------------------------------- masonry

/** Coursing lifts shared by every elevation, so quoins and courses meet at the corners. */
function liftSchedule(plan: FacadePlan, family: Palette['fieldFamily']): number[] {
  const r = new SeededRandom(`${plan.spec.seed}:facade-v2:lifts`);
  const H = plan.wallTop - plan.floor;
  const lifts = [0];
  const base = family === 'brick' ? 0.027 : ERA_CRAFT[plan.spec.period].module * (STRUCTURE_ART[plan.spec.archetype].detail === 'ceremony' ? 1.15 : 1);
  while (lifts[lifts.length - 1]! < H + 0.08) lifts.push(lifts[lifts.length - 1]! + base * (family === 'ashlar' ? 1 : r.range(0.82, 1.2)));
  return lifts;
}

interface AshlarOptions {
  chamfer?: boolean;
  /** Mason's mark probability. */
  mark?: number;
  tone?: RGB;
  proud?: number;
}

/** A squared, tooled block of the trim stone, bedded in its own mortar joint. */
function ashlar(e: Elevation, u0: number, y0: number, u1: number, y1: number, options: AshlarOptions = {}): void {
  const { out, rnd } = e;
  const joint = 0.0032;
  out.path(rectD(e, u0 - joint, y0 - joint, u1 + joint, y1 + joint), css(e.palette.mortar), grey(72), grey(245));
  const tone = options.tone ?? scale(e.palette.dressed, rnd.range(0.92, 1.07));
  const d = polyD(e, blockOutline(e, u0, y0, u1, y1, 0.06));
  const proud = options.proud ?? rnd.range(176, 190);
  out.path(d, css(tone), grey(proud), grey(rnd.range(188, 205)));
  out.path(d, { fill: 'url(#edge)', opacity: 0.35 + e.weather.wear * 0.3 }, { fill: 'url(#bevel)' });
  // Boasted finish: fine parallel diagonal tooling across the face.
  const w = u1 - u0, h = y1 - y0;
  const step = 0.0045, slant = rnd.chance(0.5) ? 1 : -1;
  let strokes = '';
  for (let t = step; t < w; t += step) strokes += `M${f(X(e, u0 + t))} ${f(Y(e, y0 + h * 0.08))}l${f(slant * h * 0.25 * e.s)} ${f(-h * 0.84 * e.s)}`;
  if (strokes) out.raw(`<path d="${strokes}" stroke="${css(scale(tone, 0.82))}" stroke-width="0.5" opacity="0.35" fill="none"/>`,
    `<path d="${strokes}" stroke="${grey(proud - 22)}" stroke-width="0.7" opacity="0.6" fill="none"/>`);
  if (options.chamfer) {
    // A chamfered arris, sunk along the opening edge.
    out.path(rectD(e, u0, y1 - h * 0.12, u1, y1), undefined, { fill: grey(proud - 30), opacity: 0.6 });
  }
  if (rnd.chance((options.mark ?? 0.1) * 0.3)) masonMark(e, u0 + w * rnd.range(0.3, 0.7), y0 + h * rnd.range(0.35, 0.65), Math.min(w, h) * 0.22, tone);
}

/** Banker marks: a few chiselled strokes identifying who dressed the stone. */
function masonMark(e: Elevation, u: number, y: number, size: number, tone: RGB): void {
  const r = e.rnd;
  const shapes = [
    [[-1, -1], [1, 1], [-1, 1], [1, -1]], // cross
    [[-1, -1], [0, 1], [1, -1]], // chevron
    [[-1, 1], [1, 1], [0, -1], [-1, 1]], // triangle
    [[0, -1], [0, 1], [-1, 0.2], [0, 1], [1, 0.2]], // arrow
  ];
  const shape = r.pick(shapes);
  const d = `M${shape.map(([a, b]) => `${f(X(e, u + a! * size))} ${f(Y(e, y + b! * size))}`).join('L')}`;
  e.out.path(d, { stroke: css(scale(tone, 0.68)), width: 0.8, opacity: 0.7 }, { stroke: grey(120), width: 1.2 });
}

// ------------------------------------------------------------------------------- composition

type ArchKind = 'round' | 'pointed' | 'ogee' | 'segmental' | 'shouldered';
function archKindFor(plan: FacadePlan): ArchKind {
  switch (plan.pattern) {
    case 'terrace': return 'shouldered';
    case 'wave': return 'round';
    case 'chevron': return 'pointed';
    case 'diamond': return 'ogee';
    default: return 'segmental';
  }
}

/** Intrados of an arch springing at `y` across u0..u1, as a polyline from left to right. */
function intrados(kind: ArchKind, u0: number, u1: number, y: number): [number, number][] {
  const w = u1 - u0, mid = (u0 + u1) / 2, steps = 14, points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    switch (kind) {
      case 'round': { const a = Math.PI * (1 - t); points.push([mid + Math.cos(a) * w / 2, y + Math.sin(a) * w / 2]); break; }
      case 'segmental': { const rise = w * 0.22, r = (w * w / 4 + rise * rise) / (2 * rise), half = Math.asin(w / 2 / r);
        const a = Math.PI / 2 + half - 2 * half * t; points.push([mid + Math.cos(a) * r, y + Math.sin(a) * r - (r - rise)]); break; }
      case 'pointed': {
        // Equilateral two-centred arch: each half is struck from the opposite springing point.
        if (t <= 0.5) { const a = Math.PI - Math.PI / 3 * (t * 2); points.push([u1 + Math.cos(a) * w, y + Math.sin(a) * w]); }
        else { const a = Math.PI / 3 * (1 - (t - 0.5) * 2); points.push([u0 + Math.cos(a) * w, y + Math.sin(a) * w]); }
        break;
      }
      case 'ogee': {
        // Convex haunch reversing into a concave tip: one cubic per half, mirrored.
        const rise = w * 0.78, s = t <= 0.5 ? t * 2 : (1 - t) * 2, k = 1 - s;
        const bu = k * k * k * 0 + 3 * k * k * s * 0 + 3 * k * s * s * 0.5 + s * s * s * 0.5;
        const bv = 3 * k * k * s * 0.55 + 3 * k * s * s * 0.45 + s * s * s;
        points.push([t <= 0.5 ? u0 + w * bu : u1 - w * bu, y + rise * bv]);
        break;
      }
      case 'shouldered': break;
    }
  }
  if (kind === 'shouldered') {
    const step = w * 0.22, rise = w * 0.32;
    return [[u0, y], [u0, y + rise * 0.45], [u0 + step, y + rise * 0.45], [u0 + step, y + rise], [u1 - step, y + rise], [u1 - step, y + rise * 0.45], [u1, y + rise * 0.45], [u1, y]];
  }
  return points;
}

/** An arch ring of voussoirs over u0..u1 and the recessed tympanum it frames. */
function archHead(e: Elevation, u0: number, u1: number, y: number, ring: number, carved: boolean): number {
  const kind = archKindFor(e.plan);
  const inner = intrados(kind, u0, u1, y);
  const top = Math.max(...inner.map(p => p[1]));
  const { out, rnd } = e;
  if (kind === 'shouldered') {
    // Caernarfon-type shouldered head: two corbels carrying a flat lintel. Real masonry, no voussoirs.
    const step = (u1 - u0) * 0.22;
    for (const [a, b] of [[u0 - ring * 0.6, u0 + step], [u1 - step, u1 + ring * 0.6]] as const) ashlar(e, a, y, b, inner[2]![1], { chamfer: true, mark: 0 });
    ashlar(e, u0 - ring * 0.4, top, u1 + ring * 0.4, top + ring, { mark: 0.2 });
    out.path(polyD(e, inner), css(scale(e.palette.dressed, 0.8)), grey(110), grey(220));
    return top + ring;
  }
  // Extrados: the intrados pushed out along its own normals.
  const outer = inner.map((p, i) => {
    const a = inner[Math.max(0, i - 1)]!, b = inner[Math.min(inner.length - 1, i + 1)]!;
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
    if (ny < 0) { nx = -nx; ny = -ny; }
    return [p[0] + nx * ring, p[1] + ny * ring] as [number, number];
  });
  const stones = Math.max(5, Math.round((inner.length - 1) / 2) | 1);
  const per = (inner.length - 1) / stones;
  out.path(polyD(e, [...outer, ...[...inner].reverse()].map(([a, b]) => [a, b] as const)), css(e.palette.mortar), grey(72), grey(245));
  for (let k = 0; k < stones; k++) {
    const a = Math.round(k * per), b = Math.round((k + 1) * per);
    const key = k === Math.floor(stones / 2);
    const shrink = 0.0028;
    const pts: [number, number][] = [];
    for (let i = a; i <= b; i++) pts.push(lerpTo(inner[i]!, outer[i]!, shrink / ring));
    for (let i = b; i >= a; i--) pts.push(lerpTo(outer[i]!, inner[i]!, (shrink + (key ? -ring * 0.12 : 0)) / ring));
    const tone = scale(e.palette.dressed, rnd.range(0.92, 1.08));
    const d = polyD(e, pts);
    out.path(d, css(tone), grey(key ? 196 : 182), grey(195));
    out.path(d, { fill: 'url(#edge)', opacity: 0.4 + e.weather.wear * 0.3 }, { fill: 'url(#bevel)' });
  }
  // Chamfer along the intrados.
  out.path(`M${inner.map(([a, b]) => `${f(X(e, a))} ${f(Y(e, b))}`).join('L')}`, undefined, { stroke: grey(120), width: Math.max(1, ring * e.s * 0.18) });
  // Recessed tympanum: the field between the square opening and the arch, sunk and darkened by grime.
  const tympanum = polyD(e, inner);
  out.path(tympanum, css(scale(e.palette.dressed, 0.78)), grey(104), grey(225));
  out.path(tympanum, { fill: 'url(#edge)', opacity: 0.7 });
  if (carved) carveMotif(e, (u0 + u1) / 2, y + (top - y) * 0.42, Math.min(u1 - u0, top - y) * 0.32);
  return Math.max(...outer.map(p => p[1]));
}

const lerpTo = (a: readonly [number, number], b: readonly [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The culture's emblem cut into a tympanum: sunk background, raised figure, in relief only. */
function carveMotif(e: Elevation, u: number, y: number, size: number): void {
  const d = (points: readonly (readonly [number, number])[]): string => polyD(e, points.map(([a, b]) => [u + a * size, y + b * size] as const));
  const sunk = { fill: grey(84) }, raised = { fill: grey(150) };
  const shade = { fill: css(scale(e.palette.dressed, 0.66)), opacity: 0.55 };
  let figure: (readonly [number, number])[][];
  switch (e.plan.pattern) {
    case 'terrace': figure = [[[-1, -0.6], [1, -0.6], [1, -0.2], [0.6, -0.2], [0.6, 0.2], [0.2, 0.2], [0.2, 0.6], [-0.2, 0.6], [-0.2, 0.2], [-0.6, 0.2], [-0.6, -0.2], [-1, -0.2]]]; break;
    case 'wave': figure = [[[-1, -0.2], [-0.5, 0.5], [0, -0.2], [0.5, 0.5], [1, -0.2], [1, -0.5], [0.5, 0.15], [0, -0.55], [-0.5, 0.15], [-1, -0.5]]]; break;
    case 'chevron': figure = [[[-1, -0.6], [0, 0.4], [1, -0.6], [1, -0.2], [0, 0.8], [-1, -0.2]]]; break;
    case 'diamond': figure = [[[0, -0.9], [0.7, 0], [0, 0.9], [-0.7, 0]], [[0, -0.45], [0.33, 0], [0, 0.45], [-0.33, 0]]]; break;
    default: figure = [[[-0.9, -0.9], [0.9, 0.9], [0.9, 0.5], [-0.5, -0.9]], [[0.9, -0.9], [-0.9, 0.9], [-0.9, 0.5], [0.5, -0.9]]];
  }
  e.out.path(d([[-1.15, -1], [1.15, -1], [1.15, 1], [-1.15, 1]]), { fill: css(scale(e.palette.dressed, 0.86)), opacity: 0.5 }, sunk);
  figure.forEach((points, i) => e.out.path(d(points), i % 2 ? shade : { fill: css(e.palette.dressed), opacity: 0.85 }, i % 2 ? sunk : raised));
}

/** A carved string course: the culture's pattern band, dressed into the masonry it belongs to. */
function stringCourse(e: Elevation, y: number, h: number, carved: boolean): void {
  const { out, rnd } = e;
  const u0 = -e.L / 2 - e.bleed, u1 = e.L / 2 + e.bleed;
  let u = u0;
  while (u < u1) {
    const length = rnd.range(0.12, 0.22);
    ashlar(e, u, y - h / 2, Math.min(u1, u + length), y + h / 2, { mark: 0.04 });
    u += length;
  }
  // Weathered top bed and a drip under it, in relief.
  out.path(rectD(e, u0, y + h * 0.36, u1, y + h / 2), undefined, { fill: grey(208), opacity: 0.7 });
  out.path(rectD(e, u0, y - h / 2, u1, y - h * 0.36), { fill: css(scale(e.palette.dressed, 0.7)), opacity: 0.5 }, { fill: grey(118), opacity: 0.8 });
  if (!carved) return;
  const unit = h * 1.35, count = Math.ceil((u1 - u0) / unit);
  for (let i = 0; i < count; i++) carveBandFigure(e, u0 + (i + 0.5) * unit, y, h * 0.3, unit);
}

function carveBandFigure(e: Elevation, u: number, y: number, s: number, unit: number): void {
  const d = (points: readonly (readonly [number, number])[]): string => polyD(e, points.map(([a, b]) => [u + a * s, y + b * s] as const));
  const sunk = { fill: grey(118) };
  const dark = { fill: css(scale(e.palette.dressed, 0.72)), opacity: 0.45 };
  const span = unit / s / 2;
  switch (e.plan.pattern) {
    case 'terrace': // stepped fret
      e.out.path(d([[-span, -0.9], [-span * 0.2, -0.9], [-span * 0.2, 0.1], [span * 0.4, 0.1], [span * 0.4, 0.9], [span, 0.9], [span, 0.45], [span * 0.75, 0.45], [span * 0.75, -0.35], [span * 0.05, -0.35], [span * 0.05, -0.45], [-span, -0.45]]), dark, sunk); break;
    case 'wave': // running scroll
      e.out.path(d([[-span, -0.6], [-span * 0.3, 0.8], [span * 0.2, 0.2], [span * 0.6, -0.6], [span, -0.6], [span, -0.2], [span * 0.55, 0.65], [-span * 0.1, 0.95], [-span * 0.55, 0.1], [-span, 0.0]]), dark, sunk); break;
    case 'chevron': // Norman zigzag
      e.out.path(d([[-span, -0.9], [0, 0.6], [span, -0.9], [span, -0.3], [0, 1.0], [-span, -0.3]]), dark, sunk); break;
    case 'diamond': // lozenge chain
      e.out.path(d([[0, -0.9], [span * 0.8, 0], [0, 0.9], [-span * 0.8, 0]]), dark, sunk);
      e.out.path(d([[0, -0.4], [span * 0.35, 0], [0, 0.4], [-span * 0.35, 0]]), { fill: css(e.palette.dressed), opacity: 0.6 }, { fill: grey(176) }); break;
    default: // interlace
      e.out.path(d([[-span, -0.7], [span, 0.7], [span, 0.25], [-span, -0.95]]), dark, sunk);
      e.out.path(d([[-span, 0.7], [span, -0.7], [span, -0.25], [-span, 0.95]]), dark, sunk);
  }
}

/** Oak members follow the composed frame, with continuous grain and pegged joints. */
function timberMember(e: Elevation, u0: number, y0: number, u1: number, y1: number): void {
  const d = rectD(e, u0, y0, u1, y1), vertical = y1 - y0 > u1 - u0;
  const tone = scale(e.palette.wood, e.rnd.range(0.82, 1.05));
  e.out.path(d, css(tone), grey(168), grey(212));
  let grain = '';
  for (let i = 0; i < 9; i++) {
    const t = (i + e.rnd.range(0.15, 0.85)) / 9;
    const u = u0 + (u1 - u0) * t, y = y0 + (y1 - y0) * t;
    grain += vertical
      ? `M${f(X(e, u))} ${f(Y(e, y0))}Q${f(X(e, u + 0.0015))} ${f(Y(e, (y0 + y1) / 2))} ${f(X(e, u))} ${f(Y(e, y1))}`
      : `M${f(X(e, u0))} ${f(Y(e, y))}Q${f(X(e, (u0 + u1) / 2))} ${f(Y(e, y + 0.0015))} ${f(X(e, u1))} ${f(Y(e, y))}`;
  }
  e.out.path(grain, { stroke: css(scale(tone, 0.6)), width: 0.65, opacity: 0.6 }, { stroke: grey(152), width: 0.7 });
  const pegU = (u0 + u1) / 2;
  for (const y of [y0 + 0.009, y1 - 0.009]) e.out.raw(
    `<circle cx="${f(X(e, pegU))}" cy="${f(Y(e, y))}" r="${f(e.s * 0.002)}" fill="${css(scale(tone, 0.6))}"/>`);
}

/** Long-and-short dressed blocks up a pilaster or a quoin, one block per coursing lift. */
function dressedPost(e: Elevation, u: number, w: number, corner: 'start' | 'end' | undefined): void {
  const cornerIndex = corner === undefined ? -1 : CORNER_OF[e.face.name][corner];
  for (let lift = 0; lift < e.lifts.length - 1; lift++) {
    const y0 = e.lifts[lift]!, y1 = Math.min(e.lifts[lift + 1]!, e.H + e.bleed);
    if (y0 > e.H + e.bleed) break;
    let a = u - w / 2, b = u + w / 2;
    if (corner) {
      // The long face of a quoin alternates between the two elevations that share the corner.
      const long = (lift + cornerIndex) % 2 === (corner === 'end' ? 0 : 1);
      const reach = long ? 0.07 : 0.03;
      if (corner === 'start') b = u + w / 2 + reach; else a = u - w / 2 - reach;
    }
    ashlar(e, a, y0, b, y1, { mark: 0.08 });
  }
}

const CORNER_OF: Record<ElevationPlan['name'], { start: number; end: number }> = {
  front: { start: 0, end: 1 }, right: { start: 1, end: 2 }, rear: { start: 2, end: 3 }, left: { start: 3, end: 0 },
};

/** Dressed jambs, sill and arched head around an opening; returns the top of the surround. */
function openingSurround(e: Elevation, o: FacadeOpening): number {
  const u0 = o.u - o.w / 2, u1 = o.u + o.w / 2, y0 = o.y - o.h / 2, y1 = o.y + o.h / 2;
  const family = architecturalMaterial(e.plan.materials.wall).family;
  // Brick and earth walls are carried by their own tile and real reveals; only stone walls get
  // dressed stone surrounds painted around their openings.
  if (family !== 'stone') {
    const frame = architecturalMaterial(e.plan.materials.frame).family;
    const w = Math.min(.012,o.w*.12);
    if(frame === 'timber') {
      timberMember(e,u0-w,y0,u0,y1+w); timberMember(e,u1,y0,u1+w,y1+w);
      timberMember(e,u0-w,y1,u1+w,y1+w);
      if(o.kind==='window') timberMember(e,u0-w,y0-w,u1+w,y0);
    }
    return y1+w;
  }
  const jamb = o.kind === 'door' ? 0.045 : 0.03;
  for (let lift = 0; lift < e.lifts.length - 1; lift++) {
    const a = Math.max(y0, e.lifts[lift]!), b = Math.min(y1, e.lifts[lift + 1]!);
    if (b - a < 0.006) continue;
    const long = lift % 2 === 0;
    ashlar(e, u0 - jamb * (long ? 1.25 : 0.8), a, u0, b, { chamfer: false, mark: 0.15 });
    ashlar(e, u1, a, u1 + jamb * (long ? 0.8 : 1.25), b, { chamfer: false, mark: 0.15 });
  }
  if (o.kind === 'window') {
    // Projecting sill with a weathered, sloped top.
    ashlar(e, u0 - jamb * 1.1, y0 - 0.022, u1 + jamb * 1.1, y0, { proud: 196 });
    e.out.path(rectD(e, u0 - jamb * 1.1, y0 - 0.004, u1 + jamb * 1.1, y0), undefined, { fill: grey(214) });
  } else {
    // Worn threshold step: the stone dished by centuries of boots.
    e.out.path(rectD(e, u0 - 0.01, -e.bleed, u1 + 0.01, 0.004), css(scale(e.palette.dressed, 0.86)), grey(168), grey(170));
  }
  if (!e.plan.spec.openings.arched || ['neolithic','bronzeIron','modern','contemporary'].includes(e.plan.spec.period)) {
    ashlar(e, u0 - jamb, y1, u1 + jamb, y1 + Math.min(0.018, o.h * 0.12), { mark: 0.05 });
    return y1 + 0.018;
  }
  const carved = e.plan.spec.culture.ornament > 0.28 && (o.kind === 'door' || e.rnd.chance(0.3));
  if (o.kind === 'door') {
    // Lintel, then a relieving arch over a carved tympanum.
    const lintelTop = y1 + 0.03;
    ashlar(e, u0 - jamb * 1.2, y1, u1 + jamb * 1.2, lintelTop, { mark: 0.3 });
    const top = archHead(e, u0 - jamb * 0.2, u1 + jamb * 0.2, lintelTop, 0.034, carved);
    hoodMould(e, u0 - jamb * 0.2, u1 + jamb * 0.2, lintelTop, 0.034);
    return top;
  }
  const top = archHead(e, u0, u1, y1, 0.026, carved && o.w > 0.05);
  hoodMould(e, u0, u1, y1, 0.026);
  return top;
}

/** A label mould over the arch, ending in carved stops; sheds rain off the opening below. */
function hoodMould(e: Elevation, u0: number, u1: number, y: number, ring: number): void {
  const kind = archKindFor(e.plan);
  if (kind === 'shouldered') return;
  const inner = intrados(kind, u0 - ring * 1.35, u1 + ring * 1.35, y);
  const line = `M${inner.map(([a, b]) => `${f(X(e, a))} ${f(Y(e, b))}`).join('L')}`;
  const width = Math.max(1.2, ring * 0.32 * e.s);
  e.out.path(line, { stroke: css(scale(e.palette.dressed, 0.95)), width }, { stroke: grey(205), width }, { stroke: grey(196), width });
  e.out.path(line, { stroke: css(scale(e.palette.dressed, 0.62)), width: width * 0.3, opacity: 0.6, extra: `transform="translate(0 ${f(width * 0.45)})"` },
    { stroke: grey(100), width: width * 0.35, extra: `transform="translate(0 ${f(width * 0.5)})"` });
  for (const [a, b] of [inner[0]!, inner[inner.length - 1]!]) {
    e.out.path(polyD(e, [[a - ring * 0.25, b - ring * 0.7], [a + ring * 0.25, b - ring * 0.7], [a + ring * 0.25, b], [a - ring * 0.25, b]]),
      css(scale(e.palette.dressed, 0.9)), grey(200), grey(196));
  }
}

/** Individually bedded sheets: putty on divided sashes, slim steel factory lights, sealed modern panes.
 * Colour describes glass and interior fabric; reflected sky comes from the live lighting shader. */
function fittedGlass(e: Elevation, o: FacadeOpening): void {
  const { out, rnd } = e;
  const style = e.plan.spec.openings.facade!;
  const historic = style === 'divided', factory = style === 'factory';
  const u0 = o.u - o.w / 2, u1 = o.u + o.w / 2, y0 = o.y - o.h / 2, y1 = o.y + o.h / 2;
  const frame = glazingFrameWidth(o, style);
  const rows = e.plan.spec.openings.divisions ?? 1, cols = rows > 1 ? 2 : 1;
  const trim = rgbOf(architecturalMaterial(e.plan.materials.trim ?? e.plan.materials.frame).appearance.color);
  const joinery = historic ? mix(trim, [214, 211, 193], 0.68) : factory ? [58, 65, 66] as RGB : mix(trim, [91, 105, 113], 0.5);
  out.raw(`<g data-glazing="${style}">`, `<g data-glazing="${style}">`, `<g data-glazing="${style}">`);
  out.path(rectD(e, u0, y0, u1, y1), css(joinery), grey(151), grey(historic ? 181 : 97));
  const paneW = o.w / cols, paneH = o.h / rows;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const a = u0 + col * paneW + (col ? frame * 0.3 : frame);
    const b = u0 + (col + 1) * paneW - (col < cols - 1 ? frame * 0.3 : frame);
    const c = y0 + row * paneH + (row ? frame * 0.3 : frame);
    const d = y0 + (row + 1) * paneH - (row < rows - 1 ? frame * 0.3 : frame);
    const tint = mix(historic ? [109, 145, 145] : [88, 135, 153], e.palette.interior, rnd.range(0.1, 0.3));
    const id = `pane-${e.index}-${o.row}-${o.index}-${row}-${col}`;
    // Slight sheet-to-sheet absorption variation, never identical blue stickers.
    out.raw(`<linearGradient id="${id}" x2="0" y2="1"><stop stop-color="${css(scale(tint, 1.12))}"/><stop offset="0.58" stop-color="${css(tint)}"/><stop offset="1" stop-color="${css(scale(tint, 0.79))}"/></linearGradient>`);
    out.path(rectD(e, a, c, b, d), `url(#${id})`, grey(historic ? rnd.range(116, 122) : 120), grey(historic ? rnd.range(28, 44) : rnd.range(15, 27)));
    // Recessed room silhouettes: occasional linen roller blinds, darkness behind upper lights.
    // Each decision is local to a sheet; industrial rooms remain visibly utilitarian.
    if (!factory && rnd.chance(historic ? 0.42 : 0.28)) {
      const drop = (d - c) * rnd.range(0.15, 0.52);
      const linen = mix(tint, [174, 162, 136], historic ? 0.5 : 0.34);
      out.path(rectD(e, a, d - drop, b, d), { fill: css(linen), opacity: 0.7 });
      out.path(rectD(e, a, d - drop, b, d - drop + Math.min(frame * 0.2, drop * 0.1)), { fill: css(scale(linen, 0.65)), opacity: 0.6 });
    }
    // Putty fillets / insulating-unit spacers hug each pane, leaving the clear field untouched.
    const gasket = historic ? css(mix(joinery, [221, 214, 193], 0.5)) : '#263d43';
    const edgeWidth = Math.max(0.55, frame * e.s * 0.22);
    out.path(rectD(e, a, c, b, d), { stroke: gasket, width: edgeWidth }, { stroke: grey(144), width: edgeWidth }, { stroke: grey(historic ? 177 : 78), width: edgeWidth });
    // Fine deposits gather on the bottom edge; no plaster/grain relief over glass.
    if (e.weather.wear > 0.12) out.path(rectD(e, a, c, b, c + (d - c) * 0.025), { fill: '#7c897b', opacity: e.weather.wear * 0.28 }, undefined, { fill: grey(92), opacity: e.weather.wear * 0.4 });
  }
  // Meeting rail and latch, scaled to joinery rather than a medieval door's ironwork.
  if (historic) {
    const rail = y0 + o.h * Math.ceil(rows / 2) / rows;
    out.path(rectD(e, o.u - frame * 0.7, rail, o.u + frame * 0.7, rail + frame * 0.35), '#8e876b', grey(184), grey(85));
  }
  out.raw('</g>', '</g>', '</g>');
}

/** Leaded lights behind a recessed lancet: quarries, cames, saddle bars and a dark interior. */
function leadedLight(e: Elevation, o: FacadeOpening): void {
  const fitting = e.plan.materials.glazing ? architecturalMaterial(e.plan.materials.glazing) : undefined;
  if (fitting?.family !== 'glass') {
    // An opaque timber/paper fitting is not a glass sheet, even when its era can know glass.
    const u0 = o.u - o.w / 2, u1 = o.u + o.w / 2, y0 = o.y - o.h / 2, y1 = o.y + o.h / 2;
    e.out.raw('<g data-fitting="opaque">', '<g data-fitting="opaque">', '<g data-fitting="opaque">');
    if (fitting?.family === 'timber') timberMember(e, u0, y0, u1, y1);
    else e.out.path(rectD(e, u0, y0, u1, y1), css(fitting ? rgbOf(fitting.appearance.color) : e.palette.interior), grey(142), grey(225));
    e.out.raw('</g>', '</g>', '</g>');
    return;
  }
  if (e.plan.spec.openings.facade) { fittedGlass(e, o); return; }
  const { out, rnd } = e;
  const u0 = o.u - o.w / 2, u1 = o.u + o.w / 2, y0 = o.y - o.h / 2, y1 = o.y + o.h / 2;
  out.path(rectD(e, u0 - 0.004, y0 - 0.004, u1 + 0.004, y1 + 0.004), css(e.palette.interior), grey(40), grey(255));
  const frame = 0.0045;
  // Oak frame set in the reveal.
  out.path(rectD(e, u0, y0, u1, y1), css(scale(e.palette.wood, 0.7)), grey(150), grey(215));
  const iu0 = u0 + frame, iu1 = u1 - frame, iy0 = y0 + frame, iy1 = y1 - frame;
  // Each quarry is a slightly different sheet: crown glass varies in thickness and tint.
  const q = Math.max(0.011, (iu1 - iu0) / 3);
  const rows = Math.ceil((iy1 - iy0) / q) + 1, cols = Math.ceil((iu1 - iu0) / q) + 1;
  out.raw(`<clipPath id="q${e.index}-${o.row}-${o.index}"><path d="${rectD(e, iu0, iy0, iu1, iy1)}"/></clipPath><g clip-path="url(#q${e.index}-${o.row}-${o.index})">`,
    `<clipPath id="qr${e.index}-${o.row}-${o.index}"><path d="${rectD(e, iu0, iy0, iu1, iy1)}"/></clipPath><g clip-path="url(#qr${e.index}-${o.row}-${o.index})">`,
    `<clipPath id="qs${e.index}-${o.row}-${o.index}"><path d="${rectD(e, iu0, iy0, iu1, iy1)}"/></clipPath><g clip-path="url(#qs${e.index}-${o.row}-${o.index})">`);
  for (let r = -1; r < rows; r++) for (let c = -1; c < cols; c++) {
    const cu = iu0 + c * q + (r % 2 ? q / 2 : 0), cy = iy0 + r * q * 0.62;
    const pane = mix(e.palette.quarry, e.palette.interior, rnd.range(0.25, 0.7));
    out.path(polyD(e, [[cu, cy - q * 0.62], [cu + q / 2, cy], [cu, cy + q * 0.62], [cu - q / 2, cy]]), css(pane), grey(rnd.range(108, 124)), grey(rnd.range(30, 60)));
  }
  let cames = '';
  for (let k = -cols - rows; k < cols + rows; k++) {
    const a = iu0 + k * q / 2;
    cames += `M${f(X(e, a))} ${f(Y(e, iy0))}L${f(X(e, a + (iy1 - iy0) / 1.24))} ${f(Y(e, iy1))}M${f(X(e, a))} ${f(Y(e, iy1))}L${f(X(e, a + (iy1 - iy0) / 1.24))} ${f(Y(e, iy0))}`;
  }
  const came = Math.max(0.7, 0.0012 * e.s);
  out.raw(`<path d="${cames}" stroke="${css(e.palette.lead)}" stroke-width="${f(came)}" fill="none"/></g>`,
    `<path d="${cames}" stroke="${grey(150)}" stroke-width="${f(came)}" fill="none"/></g>`,
    `<path d="${cames}" stroke="${grey(150)}" stroke-width="${f(came)}" fill="none"/></g>`);
  // Wrought-iron saddle bars across the light.
  for (let k = 1; k < 3; k++) {
    const by = iy0 + (iy1 - iy0) * k / 3;
    out.path(rectD(e, u0, by - 0.0012, u1, by + 0.0012), css(e.palette.iron), grey(172), grey(150));
  }
  out.path(rectD(e, o.u - 0.0011, y0, o.u + 0.0011, y1), css(e.palette.iron), grey(172), grey(150));
}

/** A ledged and boarded oak door with strap hinges, clout nails and a ring pull. */
function boardedDoor(e: Elevation, o: FacadeOpening): void {
  const { out, rnd } = e;
  const u0 = o.u - o.w / 2, u1 = o.u + o.w / 2, y0 = o.y - o.h / 2, y1 = o.y + o.h / 2;
  out.path(rectD(e, u0 - 0.004, y0, u1 + 0.004, y1 + 0.004), css(e.palette.interior), grey(40), grey(255));
  const boards = Math.max(4, Math.round(o.w / 0.028));
  const bw = o.w / boards;
  for (let b = 0; b < boards; b++) {
    const a = u0 + b * bw;
    const tone = scale(e.palette.wood, rnd.range(0.84, 1.12));
    const d = rectD(e, a + 0.0008, y0, a + bw - 0.0008, y1);
    out.path(d, css(tone), grey(rnd.range(150, 162)), grey(rnd.range(200, 222)));
    out.path(d, { fill: 'url(#grain)', opacity: 0.55 }, { fill: 'url(#board)' });
    // Grain lines and the odd knot.
    let grain = '';
    for (let g = 0; g < 4; g++) {
      const gx = X(e, a + bw * rnd.range(0.15, 0.85));
      grain += `M${f(gx)} ${f(Y(e, y0))}q${f(rnd.range(-1.5, 1.5))} ${f(-o.h * e.s * 0.5)} ${f(rnd.range(-1, 1))} ${f(-o.h * e.s)}`;
    }
    out.raw(`<path d="${grain}" stroke="${css(scale(tone, 0.7))}" stroke-width="0.6" opacity="0.5" fill="none"/>`,
      `<path d="${grain}" stroke="${grey(140)}" stroke-width="0.6" opacity="0.5" fill="none"/>`);
    if (rnd.chance(0.35)) {
      const ky = y0 + o.h * rnd.range(0.2, 0.85), ku = a + bw * 0.5;
      out.path(polyD(e, [[ku - bw * 0.18, ky], [ku, ky + bw * 0.4], [ku + bw * 0.18, ky], [ku, ky - bw * 0.4]]), css(scale(tone, 0.55)), grey(135));
    }
  }
  // Rot and splash darken the foot of the door.
  out.path(rectD(e, u0, y0, u1, y0 + o.h * 0.14), { fill: 'url(#damp)', opacity: 0.4 + e.weather.wear * 0.5 });
  if (!e.plan.materials.hardware || architecturalMaterial(e.plan.materials.hardware).family !== 'metal') {
    for(const row of [.25,.75]) timberMember(e,u0,y0+o.h*row-.004,u1,y0+o.h*row+.004);
    // Wooden latch and pegged ledges precede forged fittings.
    timberMember(e,u0+o.w*.65,y0+o.h*.45,u0+o.w*.9,y0+o.h*.45+.006);
    return;
  }
  // Strap hinges with scrolled ends, nailed through every board.
  for (const strap of [0.18, 0.5, 0.82]) {
    const sy = y0 + o.h * strap, sh = 0.0055;
    const end = u0 + o.w * 0.86;
    out.path(polyD(e, [[u0 - 0.004, sy - sh], [end, sy - sh * 0.6], [end + sh * 1.6, sy], [end, sy + sh * 0.6], [u0 - 0.004, sy + sh]]),
      css(e.palette.iron), grey(196), grey(128));
    // Rust bleeds down from every strap.
    out.path(rectD(e, end - 0.01, sy - sh - 0.01 - e.weather.wear * 0.02, end + 0.003, sy - sh), { fill: 'url(#rust)', opacity: 0.25 + e.weather.wear * 0.4 });
    for (let n = 0; n < boards; n++) {
      const nu = u0 + bw * (n + 0.5);
      out.path(polyD(e, [[nu - 0.0018, sy], [nu, sy + 0.0018], [nu + 0.0018, sy], [nu, sy - 0.0018]]), css(scale(e.palette.iron, 1.5)), grey(214), grey(110));
    }
  }
  // Clout-nail rows on the ledges behind.
  for (const row of [0.34, 0.66]) for (let n = 0; n < boards; n++) {
    const nu = u0 + bw * (n + 0.5), ny = y0 + o.h * row;
    out.path(polyD(e, [[nu - 0.0014, ny], [nu, ny + 0.0014], [nu + 0.0014, ny], [nu, ny - 0.0014]]), css(scale(e.palette.iron, 1.3)), grey(200), grey(120));
  }
  // Ring pull on a round escutcheon.
  const ru = u0 + o.w * 0.78, ry = y0 + o.h * 0.46;
  out.raw(`<circle cx="${f(X(e, ru))}" cy="${f(Y(e, ry))}" r="${f(0.007 * e.s)}" fill="${css(e.palette.iron)}"/><circle cx="${f(X(e, ru))}" cy="${f(Y(e, ry - 0.011))}" r="${f(0.009 * e.s)}" fill="none" stroke="${css(scale(e.palette.iron, 1.2))}" stroke-width="${f(0.0022 * e.s)}"/>`,
    `<circle cx="${f(X(e, ru))}" cy="${f(Y(e, ry))}" r="${f(0.007 * e.s)}" fill="${grey(200)}"/><circle cx="${f(X(e, ru))}" cy="${f(Y(e, ry - 0.011))}" r="${f(0.009 * e.s)}" fill="none" stroke="${grey(220)}" stroke-width="${f(0.0022 * e.s)}"/>`,
    `<circle cx="${f(X(e, ru))}" cy="${f(Y(e, ry - 0.011))}" r="${f(0.009 * e.s)}" fill="none" stroke="${grey(90)}" stroke-width="${f(0.0022 * e.s)}"/>`);
}

/** Square holes left by the scaffold putlogs, in regular lifts — a medieval wall's construction record. */
function putlogHoles(e: Elevation, blocked: (u: number, y: number, pad: number) => boolean): void {
  const step = 0.21, gap = 0.27;
  for (let y = 0.2; y < e.H - 0.08; y += step) {
    const lift = e.lifts.reduce((best, l) => Math.abs(l - y) < Math.abs(best - y) ? l : best, e.lifts[0]!);
    for (let u = -e.L / 2 + gap * 0.6; u < e.L / 2 - 0.05; u += gap) {
      if (blocked(u, lift, 0.04) || e.rnd.chance(0.25)) continue;
      const s = 0.012;
      e.out.path(rectD(e, u - s / 2, lift, u + s / 2, lift + s), css(scale(e.palette.interior, 1.4)), grey(30), grey(255));
      e.out.path(rectD(e, u - s, lift - 0.03 - e.weather.wear * 0.03, u + s, lift), { fill: 'url(#streak)', opacity: 0.25 + e.weather.wear * 0.3 });
    }
  }
}

function weatherElevation(e: Elevation, openings: readonly FacadeOpening[]): void {
  const { out, rnd, weather } = e;
  const u0 = -e.L / 2 - e.bleed, u1 = e.L / 2 + e.bleed;
  // Rain streaks: water runs off every sill and string course, leaving clean and dirty tracks.
  for (const o of openings) {
    if (o.kind !== 'window') continue;
    const y0 = o.y - o.h / 2 - 0.022;
    for (const edge of [o.u - o.w / 2 - 0.02, o.u + o.w / 2 + 0.02, o.u]) {
      const length = 0.06 + weather.wear * 0.22 + weather.moisture * 0.08;
      out.path(rectD(e, edge - 0.006, y0 - length, edge + 0.006, y0), { fill: 'url(#streak)', opacity: 0.18 + weather.wear * 0.4 });
    }
  }
  for (let i = 0, n = Math.round(e.L * (6 + weather.wear * 18)); i < n; i++) {
    const u = rnd.range(u0, u1), top = e.H - rnd.range(0, 0.1), length = rnd.range(0.05, 0.35) * (0.4 + weather.wear);
    out.path(rectD(e, u - 0.004, top - length, u + 0.004, top), { fill: 'url(#streak)', opacity: 0.1 + weather.wear * 0.25 });
  }
  // Splash zone and rising damp at the foot of the wall.
  out.path(rectD(e, u0, -e.bleed, u1, 0.09 + weather.moisture * 0.06), { fill: 'url(#damp)', opacity: 0.35 + weather.wear * 0.4 + weather.moisture * 0.2 });
  for (let i = 0, n = Math.round(e.L * 160 * (0.3 + weather.wear)); i < n; i++) {
    const u = rnd.range(u0, u1), y = rnd.range(0, 0.07) ** 1.6 * 9;
    const s = rnd.range(0.0012, 0.003);
    out.path(polyD(e, [[u - s, y], [u, y + s], [u + s, y], [u, y - s]]), { fill: '#4a4136', opacity: rnd.range(0.2, 0.5) });
  }
  // Green algal film where the ground stays wet.
  if (weather.moisture > 0.4) out.path(rectD(e, u0, -e.bleed, u1, 0.05), { fill: 'url(#algae)', opacity: (weather.moisture - 0.3) * 0.7 });
  // Grime gathers in the dry shadow under the eaves.
  out.path(rectD(e, u0, e.H - 0.09, u1, e.H + e.bleed), { fill: 'url(#eave)', opacity: 0.32 + weather.wear * 0.3 });
  // Lichen colonies favour the weather side and old, unwashed stone.
  const colonies = Math.round(e.L * e.H * 90 * weather.exposure * (0.15 + weather.wear) * (0.4 + weather.moisture));
  for (let i = 0; i < colonies; i++) {
    const cu = rnd.range(u0, u1), cy = e.H * rnd.range(0.05, 0.95) ** 0.7;
    const color = LICHEN[rnd.int(0, LICHEN.length)]!;
    for (let k = 0, m = rnd.int(3, 9); k < m; k++) {
      const r = rnd.range(0.002, 0.007);
      out.raw(`<circle cx="${f(X(e, cu + rnd.range(-0.012, 0.012)))}" cy="${f(Y(e, cy + rnd.range(-0.01, 0.01)))}" r="${f(r * e.s)}" fill="${css(color)}" opacity="${rnd.range(0.45, 0.8).toFixed(2)}"/>`,
        undefined, `<circle cx="${f(X(e, cu))}" cy="${f(Y(e, cy))}" r="${f(r * e.s * 1.4)}" fill="${grey(250)}" opacity="0.6"/>`);
    }
  }
  // Soot from the forge breathes out of the door head and up the wall.
  if (weather.soot > 0 && e.face.name === 'front') {
    const door = openings.find(o => o.kind === 'door');
    if (door) {
      const top = door.y + door.h / 2;
      out.path(rectD(e, door.u - door.w * 1.1, top, door.u + door.w * 1.1, Math.min(e.H + e.bleed, top + 0.3)), { fill: 'url(#soot)', opacity: 0.25 + weather.soot * 0.35 });
    }
  }
}

function paletteFor(plan: FacadePlan): Palette {
  const wall = architecturalMaterial(plan.materials.wall), trim = architecturalMaterial(plan.materials.trim ?? plan.materials.frame);
  const program = wall.appearance.program;
  const fieldFamily: Palette['fieldFamily'] = program === 'rubble' ? 'rubble' : program === 'ashlar' ? 'ashlar'
    : wall.family === 'ceramic' ? 'brick' : 'coursed';
  const field = rgbOf(wall.appearance.color);
  const dressed = trim.family === 'stone' || trim.family === 'ceramic' ? rgbOf(trim.appearance.color) : mix(field, [190, 182, 166], 0.4);
  const woodId = (plan.materials.glazing && architecturalMaterial(plan.materials.glazing).family === 'timber' ? plan.materials.glazing : 'finished-wood') as ArchitecturalMaterialId;
  const wood = mix(rgbOf(architecturalMaterial(woodId).appearance.color), [118, 96, 72], 0.35);
  return {
    mortar: mix(mix(field, [205, 196, 178], 0.55), [120, 112, 98], plan.spec.age.wear * 0.5),
    field,
    // Freshly dressed stone reads paler than the field it frames.
    dressed: scale(mix(dressed, [205, 196, 178], 0.18), 1.04),
    render: [214, 206, 190],
    wood,
    iron: [52, 50, 48],
    interior: [26, 23, 20],
    lead: [70, 72, 74],
    quarry: [120, 132, 128],
    fieldFamily,
  };
}

function weatherFor(plan: FacadePlan, face: ElevationPlan): Weather {
  const zone = plan.spec.climate.zone;
  const moisture = zone === 'wet' ? 0.85 : zone === 'tropical' ? 0.8 : zone === 'snowy' ? 0.6 : zone === 'cold' ? 0.45 : zone === 'arid' ? 0.08 : 0.4;
  const exposure = face.name === 'rear' ? 1 : face.name === 'left' ? 0.75 : face.name === 'right' ? 0.55 : 0.4;
  const equipment = plan.spec.equipment as readonly string[];
  const soot = equipment.includes('forge') ? 0.9 : equipment.includes('kiln') || equipment.includes('furnace') ? 0.6 : equipment.includes('hearth') ? 0.25 : 0;
  return { wear: plan.spec.age.wear * (1 - plan.spec.age.maintenance * 0.3), maintenance: plan.spec.age.maintenance, moisture, exposure, soot };
}

function elevationArtwork(plan: FacadePlan, face: ElevationPlan, index: number, cell: AtlasCell, density: number, out: LayerSet,
  lifts: readonly number[], palette: Palette): void {
  const e: Elevation = {
    plan, face, index, cell, s: density, L: face.length, H: plan.wallTop - plan.floor, bleed: FACADE_ATLAS_BLEED / density,
    rnd: new SeededRandom(`${plan.spec.seed}:facade-v2:${face.name}`), out, lifts, palette, weather: weatherFor(plan, face),
  };
  const clip = `<clipPath id="c${index}"><rect x="${f(cell.x - FACADE_ATLAS_BLEED)}" y="${f(cell.y - FACADE_ATLAS_BLEED)}" width="${f(cell.width + FACADE_ATLAS_BLEED * 2)}" height="${f(cell.height + FACADE_ATLAS_BLEED * 2)}"/></clipPath><g clip-path="url(#c${index})">`;
  out.raw(clip, clip, clip);
  // The field itself is the wall material's seamless tile (unmasked); here it is only a neutral
  // multiplier that the weathering below darkens and tints.
  const field = rectD(e, -e.L / 2 - e.bleed, -e.bleed, e.L / 2 + e.bleed, e.H + e.bleed);
  out.raw(`<path d="${field}" fill="#ffffff"/>`, `<path d="${field}" fill="${grey(128)}"/>`, `<path d="${field}" fill="${grey(245)}"/>`, '');
  const wall = architecturalMaterial(plan.materials.wall);

  // Dressed members: frame beams become plinth, floor band and eaves course; posts become
  // pilasters and long-and-short quoins; the culture band becomes a carved string course.
  const ornament = plan.spec.culture.ornament;
  const timberFrame = architecturalMaterial(plan.materials.frame).family === 'timber';
  // Timber frames are real geometry; their own grain-aligned tile textures them, so the
  // elevation leaves the members as field rather than painting a flat stand-in under them.
  plan.beams.forEach((beam, i) => {
    if (timberFrame) return;
    if (architecturalMaterial(plan.materials.frame).family !== 'stone') return;
    if (i === 0) {
      // Chamfered plinth course: one block high, from ground to the sill beam's top.
      let u = -e.L / 2 - e.bleed;
      while (u < e.L / 2 + e.bleed) { const l = e.rnd.range(0.14, 0.24); ashlar(e, u, -e.bleed, u + l, beam.y + beam.h / 2, { proud: 196, mark: 0.05 }); u += l; }
      e.out.path(rectD(e, -e.L / 2 - e.bleed, beam.y + beam.h * 0.25, e.L / 2 + e.bleed, beam.y + beam.h / 2), undefined, { fill: grey(150), opacity: 0.7 });
    } else stringCourse(e, beam.y, beam.h, false);
  });
  for (const band of plan.bands) {
    if(timberFrame) continue;
    if(architecturalMaterial(plan.materials.frame).family === 'stone') stringCourse(e, band.y, Math.min(band.h * 0.5, 0.06), ornament > 0.22);
  }
  const members = plan.members[index]!;
  for (const post of members.posts) {
    const corner = !post.corner ? undefined : post.u < 0 ? 'start' : 'end';
    if (timberFrame) continue;
    if(architecturalMaterial(plan.materials.frame).family === 'stone') dressedPost(e, post.u, post.w, corner);
  }
  for (const o of face.openings) openingSurround(e, o);
  for (const o of face.openings) if (o.kind === 'window') leadedLight(e, o); else boardedDoor(e, o);
  for (const o of face.openings) out.openings.push(`<path d="${rectD(e, o.u - o.w / 2 - 0.002, o.y - o.h / 2 - 0.002, o.u + o.w / 2 + 0.002, o.y + o.h / 2 + 0.002)}" fill="#fff"/>`);
  const blocked = (u: number, y: number, pad: number): boolean =>
    face.openings.some(o => Math.abs(u - o.u) < o.w / 2 + pad + 0.03 && y > o.y - o.h / 2 - pad - 0.03 && y < o.y + o.h / 2 + o.w + pad)
    || members.posts.some(p => Math.abs(u - p.u) < p.w / 2 + pad + 0.07)
    || [...plan.beams, ...plan.bands].some(b => Math.abs(y - b.y) < b.h / 2 + pad);
  if (['classical','medieval','earlyModern'].includes(plan.spec.period) && ['stone','ceramic'].includes(wall.family) && !plan.spec.openings.facade) putlogHoles(e, blocked);
  weatherElevation(e, face.openings);
  out.raw('</g>', '</g>', '</g>');
}

const DEFS = (wear: number): string => `<defs>
<radialGradient id="pillow" cx="50%" cy="46%" r="62%"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="0.62" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.42"/></radialGradient>
<radialGradient id="bevel" cx="50%" cy="50%" r="72%"><stop offset="0.78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.4"/></radialGradient>
<radialGradient id="edge" cx="50%" cy="48%" r="70%"><stop offset="0.5" stop-color="#3a342b" stop-opacity="0"/><stop offset="1" stop-color="#3a342b" stop-opacity="0.38"/></radialGradient>
<linearGradient id="grain" x2="1" y2="0"><stop stop-color="#000" stop-opacity="0.18"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#000" stop-opacity="0.2"/></linearGradient>
<linearGradient id="board" x2="1" y2="0"><stop stop-color="#000" stop-opacity="0.35"/><stop offset="0.2" stop-color="#000" stop-opacity="0"/><stop offset="0.8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
<linearGradient id="damp" x2="0" y2="1"><stop stop-color="#3b352b" stop-opacity="0"/><stop offset="1" stop-color="#3b352b" stop-opacity="${(0.55 + wear * 0.3).toFixed(2)}"/></linearGradient>
<linearGradient id="algae" x2="0" y2="1"><stop stop-color="#4f5a2c" stop-opacity="0"/><stop offset="1" stop-color="#4f5a2c" stop-opacity="0.7"/></linearGradient>
<linearGradient id="eave" x2="0" y2="1"><stop stop-color="#2d2822" stop-opacity="0.85"/><stop offset="1" stop-color="#2d2822" stop-opacity="0"/></linearGradient>
<linearGradient id="streak" x2="0" y2="1"><stop stop-color="#3a3329" stop-opacity="0.7"/><stop offset="1" stop-color="#3a3329" stop-opacity="0"/></linearGradient>
<linearGradient id="rust" x2="0" y2="1"><stop stop-color="#7a4a26" stop-opacity="0.8"/><stop offset="1" stop-color="#7a4a26" stop-opacity="0"/></linearGradient>
<radialGradient id="soot" cx="50%" cy="100%" r="80%"><stop offset="0" stop-color="#1c1915" stop-opacity="0.75"/><stop offset="1" stop-color="#1c1915" stop-opacity="0"/></radialGradient>
</defs>`;

/** The complete elevation atlas for one building: four packed, bled elevations in three layers. */
export function facadeArtwork(plan: FacadePlan): FacadeArtwork {
  const { density, cells } = facadeAtlasLayout(plan);
  const palette = paletteFor(plan);
  const lifts = liftSchedule(plan, palette.fieldFamily);
  const out = new LayerSet();
  plan.elevations.forEach((face, index) => elevationArtwork(plan, face, index, cells[index]!, density, out, lifts, palette));
  const size = FACADE_ATLAS_SIZE;
  const panels = surfaceArtLayout(plan);
  const open = (background: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${ARTWORK_WIDTH}" height="${size}" viewBox="0 0 ${ARTWORK_WIDTH} ${size}">${DEFS(plan.spec.age.wear)}<rect width="${ARTWORK_WIDTH}" height="${size}" fill="${background}"/>`;
  return {
    albedo: `${open('#ffffff')}${out.albedo.join('')}${panels.map(c => surfacePanel(plan, c, 'albedo')).join('')}</svg>`,
    relief: `${open(grey(128))}${out.relief.join('')}${panels.map(c => surfacePanel(plan, c, 'relief')).join('')}</svg>`,
    surface: `${open(grey(240))}${out.surface.join('')}${panels.map(c => surfacePanel(plan, c, 'surface')).join('')}</svg>`,
    // White = the wall's material tile shows through; black = composed elevation element.
    mask: `${open('#ffffff')}${out.mask.join('')}</svg>`,
    openings: `${open('#000000')}${out.openings.join('')}</svg>`,
    density,
  };
}

/** Everything that can change a painted pixel, and nothing that cannot. */
export function facadeTextureKey(plan: FacadePlan): string {
  return JSON.stringify([plan.version, 'art-v8', plan.spec.archetype, plan.surfaceDomain, plan.surfaceMaterials, plan.spec.seed, plan.elevations, plan.members, plan.beams, plan.bands,
    plan.wallTop - plan.floor, plan.materials, plan.openingStyle, plan.pattern, plan.spec.culture, plan.spec.age.wear,
    plan.spec.age.maintenance, plan.spec.climate.zone, plan.spec.equipment, plan.spec.openings, plan.spec.period]);
}
