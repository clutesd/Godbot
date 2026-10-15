/** Functional thresholds, exposed carpentry and loading gear. Every member has a job. */
import * as THREE from 'three';
import type { BuildingGrammar } from '../assets/BuildingGrammar';
import type { SurfaceKey } from '../materials/MaterialPalette';
import type { Vec3 } from '../assets/GeometryBuilder';
import { BUILD_STAGE } from '../assets/BuildStages';
import { emitCutElevation, type GeometrySink } from './StructureGeometry';
import { functionalFramePosts, type ElevationPlan } from './FacadePlan';
export function emitArchitecturalDetails(sink: GeometrySink, grammar: BuildingGrammar, surfaces: {
    roofSurface: SurfaceKey;
    postSurface: SurfaceKey;
}, faces: readonly ElevationPlan[], simplified: boolean): void {
    const spec = grammar.spec!, program = spec.architecture!;
    const scale = grammar.width / spec.width, t = spec.wallThickness * scale;
    const m = Math.min(t * .6, grammar.wallHeight * .07), floor = grammar.plinthHeight;
    const height = grammar.wallHeight * grammar.storeys;
    const frame = sink.at(surfaces.postSurface, BUILD_STAGE.FRAME, spec.materials.frame);
    const roof = sink.at(surfaces.roofSurface, BUILD_STAGE.ROOF, spec.materials.roofCovering);
    const timber = sink.at(surfaces.postSurface, BUILD_STAGE.ROOF, spec.materials.roofStructure);
    if (!simplified && spec.frameExposure > .45 && ['infilled-frame', 'clad-frame'].includes(spec.wallAssembly)) {
        for (const face of faces) {
            const at = (u: number, y: number): Vec3 => ({ x: face.originX + face.tangentX * u + face.normalX * m * .2, y: floor + y, z: face.originZ + face.tangentZ * u + face.normalZ * m * .2 });
            for (const post of functionalFramePosts(spec, face, scale))
                frame?.addBeam(at(post.u, 0), at(post.u, height), post.w, post.w);
            for (let storey = 1; storey <= grammar.storeys; storey++)
                frame?.addBeam(at(-face.length / 2, storey * grammar.wallHeight - m * .5), at(face.length / 2, storey * grammar.wallHeight - m * .5), m, m * .8);
            // Cut sill beams around doors, just like the wall; no timber runs across the threshold.
            const sillFace = { ...face, originX: face.originX + face.normalX * m * .2, originZ: face.originZ + face.normalZ * m * .2,
                openings: face.openings.filter(o => o.kind === 'door').map(o => ({ ...o, y: m * .5, h: m })) };
            emitCutElevation(frame, sillFace, floor, m, m);
        }
    }
    const entry = faces.find(f => f.name === 'front')?.openings.find(o => o.kind === 'door');
    if (program.entryPorch && entry) {
        const half = entry.w * .61, back = grammar.depth / 2 - t * .1, front = grammar.depth / 2 + grammar.depth * .24;
        const eave = floor + height * .9, ridge = eave + half * spec.roof.pitch * .5;
        const p = (x: number, y: number, z: number): Vec3 => ({ x: entry.u + x, y, z });
        const skin = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
            roof?.addQuad(a, b, c, d);
            roof?.addQuad({ ...d, y: d.y - m * .4 }, { ...c, y: c.y - m * .4 }, { ...b, y: b.y - m * .4 }, { ...a, y: a.y - m * .4 });
        };
        skin(p(-half, eave, back), p(0, ridge, back), p(0, ridge, front), p(-half, eave, front));
        skin(p(0, ridge, back), p(half, eave, back), p(half, eave, front), p(0, ridge, front));
        for (const x of [-half, half]) {
            frame?.addBeam(p(x, floor, front - m), p(x, eave, front - m), m, m);
            timber?.addBeam(p(x, eave - m, back), p(x, eave - m, front), m, m);
            if (!simplified) {
                // Short knee braces at the two porch corners resolve the cantilever, with no facade lattice.
                timber?.addBeam(p(x, eave - height * .12, front - m), p(x, eave - m, front - height * .18), m * .6, m * .6);
            }
        }
        timber?.addBeam(p(-half, eave - m, front), p(half, eave - m, front), m, m);
        timber?.addBeam(p(0, ridge - m, back), p(0, ridge - m, front), m, m);
    }
    if (program.galleryDepth) {
        const face = faces.find(f => f.name === 'front')!;
        const projection = program.galleryDepth * scale, eave = floor + height * .88;
        const point = (u: number, out: number, y: number): Vec3 => ({ x: face.originX + face.tangentX * u + face.normalX * out, y, z: face.originZ + face.tangentZ * u + face.normalZ * out });
        const a = point(-face.length / 2, -t * .1, eave + m), b = point(face.length / 2, -t * .1, eave + m), c = point(face.length / 2, projection, eave), d = point(-face.length / 2, projection, eave);
        roof?.addQuad(d, c, b, a);
        roof?.addQuad({ ...a, y: a.y - m * .4 }, { ...b, y: b.y - m * .4 }, { ...c, y: c.y - m * .4 }, { ...d, y: d.y - m * .4 });
        timber?.addBeam(point(-face.length / 2, projection, eave - m), point(face.length / 2, projection, eave - m), m, m);
        const columns = simplified ? 2 : Math.min(4, Math.max(2, Math.ceil(face.length / (spec.baySpacing * 2)) + 1));
        for (let i = 0; i < columns; i++) {
            const u = -face.length / 2 + m + (face.length - m * 2) * i / (columns - 1);
            frame?.addBeam(point(u, projection, floor), point(u, projection, eave), m, m);
        }
    }
    if (program.loadingHoist && !simplified) {
        const loading = faces[0]!.openings.filter(o => o.purpose === 'loading').at(-1);
        if (loading) {
            const gear = sink.at('timber', BUILD_STAGE.UTILITIES, spec.materials.frame);
            const z = grammar.depth / 2, y = floor + loading.y + loading.h / 2 + m * 2;
            const out = grammar.depth * .24;
            gear?.addBeam({ x: 0, y, z: z - t * 2 }, { x: 0, y, z: z + out }, m, m);
            gear?.addBeam({ x: 0, y: y - loading.h * .55, z }, { x: 0, y: y - m, z: z + out * .7 }, m * .7, m * .7);
            // A timber sheave precedes metal hardware. Rope is omitted when the bill has no rope role.
            gear?.addBox(0, y - m * 1.3, z + out * .88, m * 1.6, m * 1.6, m * .7);
            const platform = sink.at('timber', BUILD_STAGE.FITOUT, spec.materials.trim);
            const h = floor + loading.y - loading.h / 2;
            platform?.addBox(0, h - m * .5, z + out * .3, loading.w * 1.25, m, out * .6);
            for (const side of [-1, 1])
                gear?.addBeam({ x: side * loading.w * .45, y: h - out * .35, z }, { x: side * loading.w * .45, y: h - m, z: z + out * .5 }, m * .6, m * .6);
        }
    }
}
/** Cheap indexed porch roof at distance; its silhouette stays attached to the same doorway. */
export function porchSilhouette(grammar: BuildingGrammar, material: THREE.Material): THREE.Object3D | undefined {
    if (!grammar.spec?.architecture?.entryPorch)
        return;
    const spec = grammar.spec, half = grammar.width * .35 * .61;
    const floor = grammar.plinthHeight, height = grammar.wallHeight * grammar.storeys;
    const eave = floor + height * .9, ridge = eave + half * spec.roof.pitch * .5, z0 = grammar.depth / 2, z1 = z0 + grammar.depth * .24;
    const points = [[-half, eave, z0], [0, ridge, z0], [half, eave, z0], [-half, eave, z1], [0, ridge, z1], [half, eave, z1]];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setIndex([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
}
