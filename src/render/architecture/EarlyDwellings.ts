import { BUILD_STAGE } from '../assets/BuildStages';
import type { Vec3 } from '../assets/GeometryBuilder';
import type { SurfaceKey } from '../materials/MaterialPalette';
import type { BuildingSpec } from './BuildingSpec';
import { emitEquipment, structureFrame, type GeometrySink } from './StructureGeometry';
import { SeededRandom } from '../../sim/prng';

/** Early houses have their own wall and roof topology; all pieces retain construction stages. */
export function emitEarlyDwelling(sink: GeometrySink, spec: BuildingSpec, surfaces: {
  wallSurface: SurfaceKey; roofSurface: SurfaceKey; postSurface: SurfaceKey;
}, base: number, wallTop: number, simplified = false): number {
  const variant = spec.dwellingVariant!;
  const round = variant.family === 'round-hut';
  const w = spec.width / 2, d = spec.depth / 2;
  const height = wallTop - base;
  const t = Math.min(spec.wallThickness, 0.055);
  const wall = sink.at(surfaces.wallSurface, BUILD_STAGE.WALLS);
  const posts = sink.at(surfaces.postSurface, BUILD_STAGE.FRAME);
  const roof = sink.at(surfaces.roofSurface, BUILD_STAGE.ROOF);
  const roofTimber = simplified ? undefined : sink.at(surfaces.postSurface, BUILD_STAGE.ROOF);
  const footing = sink.at('stone', BUILD_STAGE.FOUNDATION);
  const shadow = sink.at('shadow', BUILD_STAGE.FITOUT);
  const top = wallTop + spec.depth * spec.roof.pitch * 0.5;
  const doorW = Math.min(0.22, spec.width * 0.25);
  const doorH = height * 0.82;
  const stakes = sink.at(surfaces.postSurface, BUILD_STAGE.SITE);
  const point = (angle: number, y: number, scale = 1): Vec3 => ({
    x: Math.sin(angle) * w * scale, y, z: Math.cos(angle) * d * scale,
  });
  for (let i = 0; i < (round ? 8 : 4); i++) {
    const p = round ? point(i / 8 * Math.PI * 2, 0.025) : { x: i < 2 ? -w : w, y: 0.025, z: i % 2 ? -d : d };
    stakes?.addBox(p.x, p.y, p.z, t * 0.4, 0.05, t * 0.4);
  }

  if (round) {
    const count = simplified ? 12 : 24;
    const entryAngle = Math.asin(doorW / (2 * w));
    const angles = [...Array.from({ length: count }, (_, i) => (i + 0.5) / count * Math.PI * 2),
      entryAngle, Math.PI * 2 - entryAngle].sort((a, b) => a - b);
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i]!;
      const b = i === angles.length - 1 ? angles[0]! + Math.PI * 2 : angles[i + 1]!;
      const p = point(a, base), q = point(b, base);
      const middle = (a + b) / 2;
      const at = point(middle, base);
      const entry = at.z > 0 && Math.abs(at.x) < doorW * 0.5;
      footing?.addBeam(point(a, base * 0.5), point(b, base * 0.5), t * 1.8, Math.max(0.025, base));
      wall?.addBeam({ ...p, y: entry ? base + doorH + (height - doorH) / 2 : base + height / 2 },
        { ...q, y: entry ? base + doorH + (height - doorH) / 2 : base + height / 2 },
        t, entry ? height - doorH : height);
      if (i % 3 === 0) posts?.addBeam(p, { ...p, y: wallTop }, t * 0.65, t * 0.65);
      roofTimber?.addBeam({ ...p, y: wallTop - t }, { x: 0, y: top - t, z: 0 }, t * 0.45, t * 0.45);
      // Thick thatch courses form a genuinely circular cone over a cylindrical wall.
      const courses = simplified ? 1 : 5;
      for (let ring = 0; ring < courses; ring++) {
        const low = ring / courses, high = (ring + 1) / courses;
        const scale = (u: number) => (1 + spec.roof.overhang) * (1 - u);
        roof?.addQuad(point(b, wallTop + (top - wallTop) * low, scale(low)),
          point(a, wallTop + (top - wallTop) * low, scale(low)),
          point(a, wallTop + (top - wallTop) * high, scale(high)),
          point(b, wallTop + (top - wallTop) * high, scale(high)));
      }
    }
  } else {
    // Side entrance, closely spaced roof-bearing frames and short/end-hipped hall variants.
    for (const z of [-d, d]) {
      const segments = Math.max(4, spec.bays * 2);
      for (let i = 0; i < segments; i++) {
        const left = -w + spec.width * i / segments;
        const right = -w + spec.width * (i + 1) / segments;
        const cuts = z > 0 ? [left, -doorW / 2, doorW / 2, right].filter(x => x >= left && x <= right) : [left, right];
        cuts.sort((a, b) => a - b);
        for (let j = 0; j < cuts.length - 1; j++) {
          const x = (cuts[j]! + cuts[j + 1]!) / 2;
          const entry = z > 0 && Math.abs(x) < doorW / 2;
          const h = entry ? height - doorH : height;
          wall?.addBox(x, entry ? base + doorH + h / 2 : base + h / 2, z, cuts[j + 1]! - cuts[j]!, h, t);
        }
      }
      footing?.addBox(0, base / 2, z, spec.width, Math.max(0.025, base), t * 1.7);
    }
    for (const x of [-w, w]) {
      wall?.addBox(x, base + height / 2, 0, t, height, spec.depth);
      footing?.addBox(x, base / 2, 0, t * 1.7, Math.max(0.025, base), spec.depth);
    }
    const ridgeEnd = variant.hippedEnds ? w - d * 0.65 : w;
    const roofAt = (x: number, z: number): Vec3 => {
      const u = Math.min(1, Math.abs(z) / (d * (1 + spec.roof.overhang)));
      const end = variant.hippedEnds ? Math.max(0, (Math.abs(x) - ridgeEnd) / (w * (1 + spec.roof.overhang) - ridgeEnd)) : 0;
      const fall = Math.max(u, end);
      return { x, z, y: wallTop + (top - wallTop) * (variant.curvedRoof ? Math.cos(fall * Math.PI / 2) : 1 - fall) };
    };
    const roofW = w * (1 + spec.roof.overhang);
    const ventW = spec.width * 0.12, ventD = spec.depth * 0.07;
    const xs = [-roofW, -ridgeEnd, -ventW, ventW, ridgeEnd, roofW].sort((a, b) => a - b);
    const zs = [-d * (1 + spec.roof.overhang), -d * 0.6, -d * 0.25, -ventD, ventD, d * 0.25, d * 0.6, d * (1 + spec.roof.overhang)];
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xs[i]!, x1 = xs[i + 1]!, z0 = zs[j]!, z1 = zs[j + 1]!;
      if (variant.smokeOpening && x0 >= -ventW && x1 <= ventW && z0 >= -ventD && z1 <= ventD) continue;
      roof?.addQuad(roofAt(x0, z0), roofAt(x0, z1), roofAt(x1, z1), roofAt(x1, z0));
    }
    if (variant.smokeOpening) {
      for (const z of [-ventD, ventD]) roofTimber?.addBeam(roofAt(-ventW, z), roofAt(ventW, z), t * 0.7, t * 0.7);
      for (const x of [-ventW, ventW]) roofTimber?.addBeam(roofAt(x, -ventD), roofAt(x, ventD), t * 0.7, t * 0.7);
    }
    for (let i = 0; i <= spec.bays; i++) {
      const x = -w + spec.width * i / spec.bays;
      for (const z of [-d, d]) {
        posts?.addBox(x, base + height / 2, z, t, height, t);
        const ridgeZ = variant.smokeOpening && Math.abs(x) <= ventW ? Math.sign(z) * ventD : 0;
        const ridge = roofAt(x, ridgeZ);
        roofTimber?.addBeam({ x, y: wallTop - t, z }, { ...ridge, y: ridge.y - t }, t * 0.65, t * 0.65);
      }
      posts?.addBox(x, wallTop - t, 0, t * 0.7, t, spec.depth);
    }
    for (const x of [-w, w]) {
      // Closed gable ends, subdivided to follow the curved profile where present.
      for (let i = 0; i < zs.length - 1; i++) {
        const z0 = Math.max(-d, zs[i]!), z1 = Math.min(d, zs[i + 1]!);
        if (z1 <= z0) continue;
        const vertices = [{ x, y: wallTop, z: z0 }, roofAt(x, z0), roofAt(x, z1), { x, y: wallTop, z: z1 }];
        if (x < 0) vertices.reverse();
        wall?.addQuad(vertices[0]!, vertices[1]!, vertices[2]!, vertices[3]!);
      }
    }
  }

  // A real opening, timber jambs and threshold; no modern glazed window on these forms.
  for (const x of [-doorW / 2, doorW / 2]) posts?.addBox(x, base + doorH / 2, d, t, doorH, t * 1.5);
  posts?.addBox(0, base + doorH, d, doorW + t, t, t * 1.5);
  shadow?.addBox(0, base + 0.008, d - t, doorW, 0.012, t * 3);
  const reach = variant.entry === 'porch' ? spec.depth * 0.3 : spec.depth * 0.12;
  const entryY = base + doorH + t;
  if (variant.entry !== 'recess') {
    const porchW = doorW * (variant.entry === 'porch' ? 1.8 : 1.25);
    roof?.addBeam({ x: 0, y: entryY + reach * 0.3, z: d - t },
      { x: 0, y: entryY, z: d + reach }, porchW, 0.025);
    if (variant.entry === 'porch') for (const x of [-porchW / 2, porchW / 2]) {
      posts?.addBox(x, base + (entryY - base) / 2, d + reach, t, entryY - base, t);
      posts?.addBeam({ x, y: entryY - reach * 0.5, z: d + reach }, { x, y: entryY, z: d + reach * 0.55 }, t * 0.55, t * 0.55);
    }
  } else {
    for (const x of [-doorW / 2, doorW / 2]) wall?.addBox(x, base + doorH / 2, d - reach / 2, t, doorH, reach);
    posts?.addBox(0, base + doorH, d - reach, doorW, t, t);
  }
  if (variant.store || variant.aisle) {
    const aw = spec.width * (round ? 0.28 : 0.78), ad = spec.depth * (round ? 0.4 : 0.28);
    const ax = round ? w * 0.85 : -w * 0.12, az = -d - ad * 0.35;
    const ah = height * 0.7;
    for (const z of [az - ad / 2, az + ad / 2]) wall?.addBox(ax, base + ah / 2, z, aw, ah, t);
    for (const x of [ax - aw / 2, ax + aw / 2]) {
      wall?.addBox(x, base + ah / 2, az, t, ah, ad);
      for (const z of [az - ad / 2, az + ad / 2]) posts?.addBox(x, base + ah / 2, z, t, ah, t);
    }
    roof?.addBeam({ x: ax, y: base + ah, z: az - ad * 0.65 },
      { x: ax, y: base + ah + ad * 0.4, z: az + ad * 0.65 }, aw * 1.12, 0.025);
  }
  if (variant.pen) {
    const rails = sink.at(surfaces.postSurface, BUILD_STAGE.FITOUT);
    const x0 = w * 0.2, x1 = w, z0 = -d, z1 = -d - spec.depth * 0.4;
    for (const [a, b] of [[{ x: x0, z: z0 }, { x: x0, z: z1 }], [{ x: x0, z: z1 }, { x: x1, z: z1 }], [{ x: x1, z: z1 }, { x: x1, z: z0 }]]) {
      for (const y of [0.07, 0.14]) rails?.addBeam({ ...a!, y: base + y }, { ...b!, y: base + y }, t * 0.5, t * 0.5);
      for (let i = 0; i <= 3; i++) rails?.addBox(a!.x + (b!.x - a!.x) * i / 3, base + 0.09,
        a!.z + (b!.z - a!.z) * i / 3, t * 0.65, 0.18, t * 0.65);
    }
  }
  if (!simplified) emitEquipment({ sink, spec, frame: structureFrame(spec, base, wallTop, top), random: new SeededRandom(`${spec.seed}:dwelling-equipment`) });
  return top;
}
