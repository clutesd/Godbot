/** Roof carpentry, weather edges and genuinely open attic lights in the resolved roof frame. */
import type { BuildingGrammar } from '../assets/BuildingGrammar';
import type { SurfaceKey } from '../materials/MaterialPalette';
import type { Vec3 } from '../assets/GeometryBuilder';
import { BUILD_STAGE } from '../assets/BuildStages';
import { architecturalMaterial } from './MaterialLibrary';
import type { GeometrySink } from './StructureGeometry';
import type { ElevationPlan } from './FacadePlan';
export function emitFunctionalRoof(sink: GeometrySink, grammar: BuildingGrammar, surfaces: {
    wallSurface: SurfaceKey;
    roofSurface: SurfaceKey;
    postSurface: SurfaceKey;
}, elevations: readonly ElevationPlan[], simplified: boolean): number {
    const spec = grammar.spec!, program = spec.architecture!;
    const axisZ = program.roofAxis === 'z';
    const w = (axisZ ? grammar.depth : grammar.width) / 2, d = (axisZ ? grammar.width : grammar.depth) / 2;
    const floor = grammar.plinthHeight, height = grammar.wallHeight * grammar.storeys, top = floor + height;
    const scale = grammar.width / spec.width, t = spec.wallThickness * scale;
    const member = Math.min(t * .65, grammar.wallHeight * .065);
    const rise = program.section === 'flat' ? 0 : d * spec.roof.pitch;
    const over = Math.min(spec.roof.overhang * scale, d * .24);
    const wall = sink.at(surfaces.wallSurface, BUILD_STAGE.WALLS, spec.materials.infill ?? spec.materials.wall);
    const roof = sink.at(surfaces.roofSurface, BUILD_STAGE.ROOF);
    const frame = sink.at(surfaces.postSurface, BUILD_STAGE.FRAME, spec.materials.frame);
    const timber = sink.at(surfaces.postSurface, BUILD_STAGE.ROOF, spec.materials.roofStructure);
    const p = (x: number, z: number, y: number): Vec3 => axisZ ? { x: z, y: top + y, z: -x } : { x, y: top + y, z };
    const profile: [
        number,
        number
    ][] = program.section === 'lean-to' ? [[-d, rise], [d, 0]]
        : program.section === 'flat' ? [[-d, 0], [d, 0]]
            : program.section === 'aisled' ? [[-d, 0], [-d * .52, rise * .28], [0, rise], [d * .52, rise * .28], [d, 0]]
                : [[-d, 0], [0, rise], [d, 0]];
    const covering = architecturalMaterial(spec.materials.roofCovering);
    const thickness = covering.family === 'organic' ? Math.min(grammar.wallHeight * .09, .045 * scale) : Math.max(.004 * scale, member * .4);
    const skin = (a: Vec3, b: Vec3, c: Vec3, e: Vec3) => {
        const ring = [a, b, c, e], lower = ring.map(v => ({ ...v, y: v.y - thickness }));
        roof?.addQuad(a, b, c, e);
        roof?.addQuad(lower[3]!, lower[2]!, lower[1]!, lower[0]!);
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            roof?.addQuad(ring[i]!, lower[i]!, lower[j]!, ring[j]!);
        }
    };
    const light = program.gableLight && !simplified ? { w: d * .28, y: rise * .52, h: rise * .25 } : undefined;
    // Extruded gable segments are cut around the attic light, including its actual inner reveals.
    const cheek = (side: number, z0: number, z1: number, h0: number, h1: number) => {
        if (Math.max(h0, h1) < 1e-7)
            return;
        const roofAt = (z: number) => Math.max(0, h0 + (h1 - h0) * (z - z0) / (z1 - z0) - thickness * 1.25);
        const cuts = [z0, z1];
        if (light) {
            cuts.push(-light.w / 2, light.w / 2);
            if (Math.abs(h1 - h0) > 1e-8)
                for (const y of [light.y - light.h / 2, light.y + light.h / 2])
                    cuts.push(z0 + (y - h0) * (z1 - z0) / (h1 - h0));
        }
        const us = [...new Set(cuts.filter(z => z >= z0 && z <= z1))].sort((a, b) => a - b);
        for (let i = 0; i < us.length - 1; i++) {
            const a = us[i]!, b = us[i + 1]!, mid = (a + b) / 2;
            const bands = light && Math.abs(mid) < light.w / 2 ? [[0, light.y - light.h / 2], [light.y + light.h / 2, Infinity]] : [[0, Infinity]];
            for (const [lo, hi] of bands) {
                const ha = Math.min(roofAt(a), hi!), hb = Math.min(roofAt(b), hi!);
                if (Math.max(ha, hb) <= lo! + 1e-7)
                    continue;
                const ring = [p(side * w, a, lo!), p(side * w, b, lo!), p(side * w, b, Math.max(lo!, hb)), p(side * w, a, Math.max(lo!, ha))];
                if (side > 0)
                    ring.reverse();
                const inner = ring.map(v => axisZ ? ({ ...v, z: v.z + side * t }) : ({ ...v, x: v.x - side * t }));
                wall?.addQuad(ring[0]!, ring[1]!, ring[2]!, ring[3]!);
                if (simplified)
                    continue;
                wall?.addQuad(inner[3]!, inner[2]!, inner[1]!, inner[0]!);
                for (let j = 0; j < 4; j++) {
                    const k = (j + 1) % 4;
                    wall?.addQuad(ring[j]!, inner[j]!, inner[k]!, ring[k]!);
                }
            }
        }
    };
    if (program.section === 'hipped') {
        const ridge = w * .58;
        skin(p(-w - over, -d - over, 0), p(-ridge, 0, rise), p(ridge, 0, rise), p(w + over, -d - over, 0));
        skin(p(w + over, d + over, 0), p(ridge, 0, rise), p(-ridge, 0, rise), p(-w - over, d + over, 0));
        skin(p(-w - over, d + over, 0), p(-ridge, 0, rise), p(-w - over, -d - over, 0), p(-w - over, -d - over, 0));
        skin(p(w + over, -d - over, 0), p(ridge, 0, rise), p(w + over, d + over, 0), p(w + over, d + over, 0));
    }
    else {
        for (let i = 0; i < profile.length - 1; i++) {
            const [z0, y0] = profile[i]!, [z1, y1] = profile[i + 1]!;
            const a = z0 === -d ? z0 - over : z0, b = z1 === d ? z1 + over : z1, slope = (y1 - y0) / (z1 - z0);
            skin(p(-w - over, a, y0 + (a - z0) * slope), p(-w - over, b, y1 + (b - z1) * slope), p(w + over, b, y1 + (b - z1) * slope), p(w + over, a, y0 + (a - z0) * slope));
            for (const side of [-1, 1])
                cheek(side, z0, z1, y0, y1);
        }
    }
    if (program.section === 'flat' && spec.parapet) {
        const edge = Math.max(member, height * .055);
        for (const z of [-d, d])
            wall?.addBox(0, top + edge / 2, z, grammar.width, edge, t);
        for (const x of [-w, w])
            wall?.addBox(x, top + edge / 2, 0, t, edge, grammar.depth);
    }
    if (!simplified) {
        if (program.section !== 'flat' && program.section !== 'lean-to') {
            const end = program.section === 'hipped' ? w * .58 : w - t;
            timber?.addBeam(p(-end, 0, rise - member), p(end, 0, rise - member), member, member);
            if (program.section === 'aisled')
                for (const z of [-d * .52, d * .52])
                    timber?.addBeam(p(-w + t, z, rise * .28 - member), p(w - t, z, rise * .28 - member), member, member);
        }
        // Eave fascia and gable verge protect the roof edges; they are carpentry, not decoration.
        for (const z of [-d - over, d + over]) {
            const segment = z < 0 ? profile.slice(0, 2) : profile.slice(-2);
            const slope = (segment[1]![1] - segment[0]![1]) / (segment[1]![0] - segment[0]![0]);
            const y = z < 0 ? profile[0]![1] - over * slope : profile.at(-1)![1] + over * slope;
            timber?.addBeam(p(-w - over, z, y - thickness), p(w + over, z, y - thickness), member * .65, member);
        }
        for (let bay = 0; bay <= grammar.bays; bay++) {
            const x = -w + t + (w * 2 - t * 2) * bay / grammar.bays;
            frame?.addBeam(p(x, -d + t, -member), p(x, d - t, -member), member, member);
            for (const z of program.section === 'aisled' ? [-d * .52, d * .52] : [-d + t, d - t]) {
                const y = program.section === 'aisled' ? rise * .28 : program.section === 'lean-to' && z < 0 ? rise : 0;
                const from = p(x, z, -height), to = p(x, z, y);
                const blocked = elevations.some(face => {
                    const normal = (from.x - face.originX) * face.normalX + (from.z - face.originZ) * face.normalZ;
                    const u = (from.x - face.originX) * face.tangentX + (from.z - face.originZ) * face.tangentZ;
                    return Math.abs(normal) < t * 1.15 && face.openings.some(o => Math.abs(u - o.u) < o.w / 2 + member);
                });
                if (!blocked && !(program.plan === 'threshing-aisle' && Math.abs(from.x) < grammar.width * .22))
                    frame?.addBeam(from, to, member, member);
            }
            const local = program.section === 'hipped' ? rise * Math.min(1, (w - Math.abs(x)) / (w * .42)) : rise;
            const hipZ = d * (1 - local / Math.max(.001, rise));
            const rafters: [
                number,
                number
            ][] = program.section === 'hipped' ? [[-d, 0], [-hipZ, local], [hipZ, local], [d, 0]] : profile;
            for (let i = 0; i < rafters.length - 1; i++)
                timber?.addBeam(p(x, rafters[i]![0], rafters[i]![1] - member), p(x, rafters[i + 1]![0], rafters[i + 1]![1] - member), member * .7, member * .7);
        }
        if (light) {
            const trim = sink.at('timber', BUILD_STAGE.FITOUT, spec.materials.trim);
            for (const side of [-1, 1]) {
                const x = side * (w - t * .35);
                for (const sign of [-1, 1]) {
                    trim?.addBeam(p(x, sign * (light.w / 2 + member / 2), light.y - light.h / 2), p(x, sign * (light.w / 2 + member / 2), light.y + light.h / 2), member, member);
                    trim?.addBeam(p(x, -light.w / 2, light.y + sign * (light.h / 2 + member / 2)), p(x, light.w / 2, light.y + sign * (light.h / 2 + member / 2)), member, member);
                }
                if (spec.materials.glazing && architecturalMaterial(spec.materials.glazing).family === 'glass') {
                    const at = p(side * (w - t * .6), 0, light.y);
                    sink.at('glazing', BUILD_STAGE.FITOUT, spec.materials.glazing)?.addBox(at.x, at.y, at.z, axisZ ? light.w : member * .15, light.h, axisZ ? member * .15 : light.w);
                }
            }
        }
    }
    return top + rise + (program.section === 'lean-to' ? over * rise / (d * 2) : 0) + (program.section === 'flat' && spec.parapet ? Math.max(member, height * .055) : 0);
}
