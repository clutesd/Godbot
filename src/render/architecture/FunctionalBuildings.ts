import * as THREE from 'three';
import { architecturalMaterial } from './MaterialLibrary';
import { SeededRandom } from '../../sim/prng';
/** Production composition of room, threshing, feeding, stall and grain programs. */
import type { BuildingGrammar } from '../assets/BuildingGrammar';
import type { SurfaceKey } from '../materials/MaterialPalette';
import { architecturalMasses, interiorPartitions, massPoint } from './ArchitectureMasses';
import { emitArchitecturalDetails, porchSilhouette } from './ArchitecturalDetails';
import { emitFunctionalRoof } from './FunctionalRoof';
import { GeometryBuilder } from '../assets/GeometryBuilder';
import { BUILD_STAGE } from '../assets/BuildStages';
import { functionalElevations, functionalDressingWidth, openingDressingRects } from './FacadePlan';
import { emitCutElevation, emitEquipment, emitFoundation, structureFrame, type GeometrySink } from './StructureGeometry';
export function emitFunctionalBuilding(sink: GeometrySink, grammar: BuildingGrammar, surfaces: {
    wallSurface: SurfaceKey;
    roofSurface: SurfaceKey;
    postSurface: SurfaceKey;
}, simplified = false): number {
    const spec = grammar.spec!, program = spec.architecture!;
    if (program.composition && program.composition !== 'single') {
        let roofTop = 0;
        for (const mass of architecturalMasses(grammar)) {
            const parts = new Map<string, {
                builder: GeometryBuilder;
                surface: SurfaceKey;
                stage: number;
                material?: Parameters<GeometrySink['at']>[2];
            }>();
            const local: GeometrySink = { at: (surface, stage, material) => {
                    const key = `${surface}:${stage}:${material ?? ''}`;
                    let part = parts.get(key);
                    if (!part) {
                        const builder = new GeometryBuilder();
                        builder.setSectioning(simplified ? 100 : grammar.width);
                        part = { builder, surface, stage, material };
                        parts.set(key, part);
                    }
                    return part.builder;
                }, stain: () => { }, clean: () => { } };
            roofTop = Math.max(roofTop, emitFunctionalBuilding(local, { ...grammar, ...mass.grammar }, surfaces, simplified));
            for (const part of parts.values())
                sink.at(part.surface, part.stage, part.material)?.append(part.builder, p => massPoint(mass, p));
        }
        return roofTop;
    }
    const w = grammar.width / 2, d = grammar.depth / 2, floor = grammar.plinthHeight;
    const height = grammar.wallHeight * grammar.storeys, top = floor + height;
    const scale = grammar.width / spec.width, t = spec.wallThickness * scale;
    const member = functionalDressingWidth(t, grammar.wallHeight);
    const wall = sink.at(surfaces.wallSurface, BUILD_STAGE.WALLS, spec.materials.infill ?? spec.materials.wall);
    const frame = sink.at(surfaces.postSurface, BUILD_STAGE.FRAME);
    const foundation = sink.at('stone', BUILD_STAGE.FOUNDATION, spec.materials.foundation);
    const stoneDressings = architecturalMaterial(spec.materials.trim).family === 'stone';
    // A dressed-stone trim role describes the casing, not a stone door leaf or shutter.
    const joineryMaterial = stoneDressings
      ? [spec.materials.frame, spec.materials.roofStructure, spec.materials.glazing].find(id => id && architecturalMaterial(id).family === 'timber') ?? spec.materials.frame
      : spec.materials.trim;
    const joinery = sink.at('timber', BUILD_STAGE.FITOUT, joineryMaterial);
    const casing = stoneDressings ? sink.at('stone', BUILD_STAGE.WALLS, spec.materials.trim) : joinery;
    const elevations = functionalElevations(spec, w, d, height);
    // A raised store has discrete piers; a heavy wall has a continuous footing.
    if (program.raisedFloor) {
        for (const x of [-w + t, w - t])
            for (const z of [-d + t, d - t]) {
                foundation?.addBox(x, floor / 2, z, t * 1.7, floor, t * 1.7);
                foundation?.addBox(x, floor - .018, z, t * 2.3, .036, t * 2.3);
            }
    }
    else if (simplified)
        foundation?.addBox(0, floor / 2, 0, grammar.width, floor, grammar.depth);
    else
        emitFoundation(sink, { ...spec, width: grammar.width, depth: grammar.depth, wallThickness: t }, { ...structureFrame({ ...spec, width: grammar.width, depth: grammar.depth }, floor, top), plinthProjection: Math.min(t * .7, grammar.depth * .06) });
    frame?.addBox(0, floor, 0, grammar.width, .018 * scale, grammar.depth);
    for (const face of elevations) {
        const envelope = simplified && face.name !== 'front' ? { ...face, openings: face.openings.filter(o => o.kind === 'door' || o.purpose === 'loading') } : face;
        emitCutElevation(wall, envelope, floor, height, t, simplified);
        // Recessed jambs and lintels follow the cut, rather than drawing a second facade.
        if (!simplified)
            for (const o of face.openings) {
                const box = (u: number, y: number, a: number, b: number) => {
                    const outward = stoneDressings ? member * .15 : -t * .35;
                    casing?.addBox(face.originX + face.tangentX * u + face.normalX * outward, floor + y, face.originZ + face.tangentZ * u + face.normalZ * outward, face.tangentX ? a : member, b, face.tangentZ ? a : member);
                };
                for (const rect of openingDressingRects(o, member, stoneDressings))
                    box((rect.u0 + rect.u1) / 2, (rect.y0 + rect.y1) / 2, rect.u1 - rect.u0, rect.y1 - rect.y0);
                // Door leaves are swung alongside the jamb; the clear route stays open.
                if (o.kind === 'door' || o.purpose === 'loading') {
                    const u = o.u - o.w / 2;
                    joinery?.addBox(face.originX + face.tangentX * u + face.normalX * o.w * .22, floor + o.y, face.originZ + face.tangentZ * u + face.normalZ * o.w * .22, face.tangentX ? member : o.w * .44, o.h * .94, face.tangentZ ? member : o.w * .44);
                }
                if (o.purpose === 'daylight' && (!spec.materials.glazing || architecturalMaterial(spec.materials.glazing).family !== 'glass')) {
                    // Open shutters occupy the jambs, leaving the real window void clear.
                    for (const side of [-1, 1]) {
                        const u = o.u + side * o.w * .5;
                        joinery?.addBox(face.originX + face.tangentX * u + face.normalX * o.w * .2, floor + o.y, face.originZ + face.tangentZ * u + face.normalZ * o.w * .2, face.tangentX ? member * .35 : o.w * .4, o.h * .96, face.tangentZ ? member * .35 : o.w * .4);
                    }
                }
                if (o.kind === 'door') {
                    const latch = sink.at('timber', BUILD_STAGE.FINISH, joineryMaterial);
                    const u = o.u - o.w / 2;
                    latch?.addBox(face.originX + face.tangentX * u + face.normalX * o.w * .3, floor + o.y, face.originZ + face.tangentZ * u + face.normalZ * o.w * .3, member * .7, member * .7, member * .7);
                }
                if (o.purpose === 'daylight' && spec.materials.glazing && architecturalMaterial(spec.materials.glazing).family === 'glass') {
                    const glass = sink.at('glazing', BUILD_STAGE.FITOUT);
                    glass?.addBox(face.originX + face.tangentX * o.u - face.normalX * t * .55, floor + o.y, face.originZ + face.tangentZ * o.u - face.normalZ * t * .55, face.tangentX ? o.w * .96 : member * .12, o.h * .96, face.tangentZ ? o.w * .96 : member * .12);
                }
            }
    }
    // Access steps actually reach the resolved elevated floor, including raised grain stores.
    const entry = elevations[0]!.openings.find(o => o.kind === 'door')!;
    if (floor > .025 && !simplified) {
        const steps = Math.max(1, Math.min(8, Math.ceil(floor / (grammar.wallHeight * .16))));
        for (let i = 0; i < steps; i++)
            foundation?.addBox(entry.u, floor * (i + 1) / steps / 2, d + (steps - i) * .055 * scale, entry.w * 1.12, floor * (i + 1) / steps, .11 * scale);
    }
    const roofTop = emitFunctionalRoof(sink, grammar, surfaces, elevations, simplified);
    const rise = roofTop - top;
    emitArchitecturalDetails(sink, grammar, surfaces, elevations, simplified);
    // Permanent partitions define the working plan without furnishings or external props.
    if (!simplified) {
        if (program.plan === 'stall-range')
            for (let i = 1; i < program.bays; i++) {
                const stallWidth = program.courtFrontWidth ?? grammar.width;
                const x = -stallWidth / 2 + stallWidth * i / program.bays;
                wall?.addBox(x, floor + height * .28, d * .27, member, height * .56, d * 1.2);
            }
        if (program.plan === 'feeding-passage') {
            // Low feeding curb and recessed longitudinal drainage channel leave end access clear.
            wall?.addBox(0, floor + height * .07, -d * .22, grammar.width - t * 2, height * .14, member);
        }
        if (program.plan === 'rooms') {
            // Short partition leaves a connected entrance passage rather than sealing the plan.
            for (const partition of interiorPartitions(grammar))
                wall?.addBox(partition.x, floor + partition.height / 2, partition.z, partition.width, partition.height, partition.depth);
        }
        if (program.plan === 'grain-floors' || program.plan === 'rooms' || program.plan === 'work-hall')
            for (let i = 1; i < grammar.storeys; i++)
                frame?.addBox(0, floor + grammar.wallHeight * i, 0, grammar.width - t * 2, member, grammar.depth - t * 2);
    }
    if (!simplified) {
        // Existing equipment authority survives, limited to fittings that cannot cover facade voids.
        const scaled = { ...spec, width: grammar.width, depth: grammar.depth, wallThickness: t,
            equipment: spec.equipment.filter(item => !['grain-bin', 'hay-loft', 'stall-divider', 'manger', 'ridge-vent', 'louver-vent', 'chimney', 'side-ramp', 'loading-platform', ...(program.plan === 'work-hall' ? ['counter', 'crate-stack'] : [])].includes(item)) };
        if (program.plan === 'work-hall') {
            if (spec.equipment.includes('counter'))
                joinery?.addBox(grammar.width * .25, floor + grammar.wallHeight * .15, d - grammar.depth * .18,
                    grammar.width * .28, grammar.wallHeight * .3, t * 1.6);
            if (spec.equipment.includes('crate-stack')) for (let i = 0; i < 3; i++)
                sink.at('timber', BUILD_STAGE.FINISH)?.addBox(grammar.width * .32, floor + grammar.wallHeight * (.08 + i * .07), d + grammar.depth * .08,
                    grammar.width * .1, grammar.wallHeight * .14, grammar.depth * .12);
        }
        if (spec.equipment.includes('grain-bin'))
            for (const side of [-1, 1])
                joinery?.addBox(side * (w - t * 1.8 - w * .125), floor + grammar.wallHeight * .2, -d * .4, w * .25, grammar.wallHeight * .4, d * .38);
        if (spec.equipment.includes('hay-loft'))
            for (const side of [-1, 1])
                joinery?.addBox(side * (w - t * 1.8 - w * .25), floor + height * .7, 0, w * .5, member, grammar.depth - t * 3);
        if (spec.equipment.includes('manger'))
            joinery?.addBox(0, floor + height * .18, -d * .65, grammar.width - t * 3, height * .15, t);
        if (spec.equipment.includes('chimney'))
            sink.at('stone', BUILD_STAGE.UTILITIES)?.addBox(w * .65, top + rise * .4, -d * .38, member * 2, rise * .9 + height * .22, member * 2);
        if (spec.equipment.includes('louver-vent')) {
            const louver = sink.at('timber', BUILD_STAGE.UTILITIES);
            for (const face of elevations)
                for (const o of face.openings.filter(o => o.purpose === 'vent'))
                    for (const sign of [-1, 1]) {
                        louver?.addBox(face.originX + face.tangentX * o.u - face.normalX * t * .4, floor + o.y + sign * o.h * .38, face.originZ + face.tangentZ * o.u - face.normalZ * t * .4, face.tangentX ? o.w : member * .25, member * .25, face.tangentZ ? o.w : member * .25);
                    }
        }
        emitEquipment({ sink, spec: scaled, frame: structureFrame(scaled, floor, top, top + rise), random: new SeededRandom(spec.seed + ':working-fittings') });
    }
    return roofTop;
}
/** Indexed section extrusion for the distant skyline; retains the physical roof profile. */
export function functionalSilhouette(grammar: BuildingGrammar, material: THREE.Material, roofMaterial: THREE.Material = material): THREE.Group {
    const spec = grammar.spec!, section = spec.architecture!.section;
    if (spec.architecture!.composition && spec.architecture!.composition !== 'single') {
        const group = new THREE.Group();
        for (const mass of architecturalMasses(grammar)) {
            const child = functionalSilhouette({ ...grammar, ...mass.grammar, plinthHeight: 0, wallHeight: mass.grammar.wallHeight + grammar.plinthHeight }, material, roofMaterial);
            child.position.set(mass.x, 0, mass.z);
            child.rotation.y = mass.yaw;
            group.add(child);
        }
        return group;
    }
    if (spec.architecture!.roofAxis === 'z') {
        const rotated = functionalSilhouette({ ...grammar, width: grammar.depth, depth: grammar.width, spec: { ...spec, architecture: { ...spec.architecture!, roofAxis: 'x' } } }, material, roofMaterial);
        rotated.rotation.y = Math.PI / 2;
        return rotated;
    }
    const w = grammar.width / 2, d = grammar.depth / 2, floor = grammar.plinthHeight;
    const wallTop = floor + grammar.wallHeight * grammar.storeys;
    const top = wallTop + (section === 'flat' && spec.parapet ? Math.max(Math.min(spec.wallThickness * .65, grammar.wallHeight * .065), grammar.wallHeight * grammar.storeys * .055) : 0);
    const r = section === 'flat' ? 0 : d * spec.roof.pitch;
    const over = Math.min(spec.roof.overhang * grammar.width / spec.width, d * .24);
    const profile: [
        number,
        number
    ][] = section === 'lean-to' ? [[-d - over, top + r + over * r / (d * 2)], [d + over, top - over * r / (d * 2)]]
        : section === 'flat' ? [[-d, top], [d, top]]
            : section === 'aisled' ? [[-d, top], [-d * .52, top + r * .28], [0, top + r], [d * .52, top + r * .28], [d, top]]
                : [[-d, top], [0, top + r], [d, top]];
    const polygon: [
        number,
        number
    ][] = [[-d, floor], [d, floor], ...profile.slice().reverse()];
    if (section === 'hipped') {
        const vertices = [[-w, floor, -d], [w, floor, -d], [w, floor, d], [-w, floor, d], [-w, top, -d], [w, top, -d], [w, top, d], [-w, top, d], [-w * .58, top + r, 0], [w * .58, top + r, 0]];
        const indices = [0, 2, 1, 0, 3, 2, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7, 4, 5, 9, 4, 9, 8, 6, 7, 8, 6, 8, 9, 7, 4, 8, 5, 6, 9];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
        geometry.setIndex(indices);
        geometry.addGroup(0, 30, 0);
        geometry.addGroup(30, indices.length - 30, 1);
        geometry.computeVertexNormals();
        const group = new THREE.Group();
        group.add(new THREE.Mesh(geometry, [material, roofMaterial]));
        if (floor > 0) {
            const base = new THREE.Mesh(new THREE.BoxGeometry(grammar.width, floor, grammar.depth), material);
            base.position.y = floor / 2;
            group.add(base);
        }
        return group;
    }
    const positions: number[] = [], indices: number[] = [], roofIndices: number[] = [], n = polygon.length;
    for (const x of [-w, w])
        for (const [z, y] of polygon)
            positions.push(x, y, z);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        (i >= 2 && i < n - 1 ? roofIndices : indices).push(i, j, j + n, i, j + n, i + n);
    }
    for (let i = 1; i < n - 1; i++)
        indices.push(0, i + 1, i, n, n + i, n + i + 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex([...indices, ...roofIndices]);
    geometry.addGroup(0, indices.length, 0);
    geometry.addGroup(indices.length, roofIndices.length, 1);
    geometry.computeVertexNormals();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, [material, roofMaterial]));
    if (!spec.architecture!.raisedFloor && floor > 0) {
        const base = new THREE.Mesh(new THREE.BoxGeometry(grammar.width, floor, grammar.depth), material);
        base.position.y = floor / 2;
        group.add(base);
    }
    if (spec.architecture!.raisedFloor)
        for (const x of [-w * .75, w * .75]) {
            const pier = new THREE.Mesh(new THREE.BoxGeometry(grammar.width * .12, floor, grammar.depth * .65), material);
            pier.position.set(x, floor / 2, 0);
            group.add(pier);
        }
    const porch = porchSilhouette(grammar, roofMaterial);
    if (porch)
        group.add(porch);
    return group;
}
