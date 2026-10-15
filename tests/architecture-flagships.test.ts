import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARCHITECTURE_FLAGSHIPS } from '../src/dev/architectureFlagshipCases';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BUILD_STAGE } from '../src/render/assets/BuildStages';
import { validateBuildingSpec, type BuildingSpec } from '../src/render/architecture/BuildingSpec';
import type { FacadePlan } from '../src/render/architecture/FacadePlan';
import { installPhysicalRoomPlan } from '../src/render/people/PhysicalRoomPlan';
import { indoorSleepingSpots, sleepAreaFloor, type IndoorSleepingArea } from '../src/render/people/IndoorSleepingArea';
import { StructureNavigation } from '../src/sim/people/StructureNavigation';
const fixture = (id: string) => { const builder = new AssetBuilder('flagship-tests'), c = ARCHITECTURE_FLAGSHIPS.find(c => c.id === id)!; const asset = builder.getAsset('building', c.config); const root = asset.mesh instanceof THREE.LOD ? asset.mesh.levels[0]!.object : asset.mesh; root.updateMatrixWorld(true); return { builder, c, asset, root, spec: asset.mesh.userData['buildingSpec'] as BuildingSpec }; };
const meshes = (root: THREE.Object3D) => { const out: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh)
    out.push(o); }); return out; };
describe('flagship production architecture', () => {
    it('resolves review inputs without forcing forbidden fabric or losing physical assembly pieces', () => {
        for (const c of ARCHITECTURE_FLAGSHIPS) {
            const f = fixture(c.id);
            expect(f.spec.period).toBe(c.period);
            expect(f.spec.provenance.periodLifted).toBe(false);
            expect(validateBuildingSpec(f.spec, c.config.development?.capabilities)).toEqual([]);
            for (const mesh of meshes(f.root))
                if (mesh.geometry.userData['assemblyPieces'])
                    expect(mesh.geometry.userData['assemblyPieces'].reduce((s: number, p: {
                        count: number;
                    }) => s + p.count, 0), c.id + '/' + mesh.name).toBe(mesh.geometry.index!.count);
            f.builder.dispose();
        }
    });
    it('keeps the courtyard open to the sky in full geometry and both LODs', () => {
        for (const id of ['court-house', 'stable-yard']) {
            const f = fixture(id);
            expect(f.spec.architecture!.composition).not.toBe('single');
            for (const level of (f.asset.mesh as THREE.LOD).levels) {
                level.object.updateMatrixWorld(true);
                const ray = new THREE.Raycaster(new THREE.Vector3(0, 20, f.spec.depth * .12), new THREE.Vector3(0, -1, 0), 0, 20 - f.spec.plinthHeight - .02);
                expect(ray.intersectObjects(meshes(level.object)).length).toBe(0);
            }
            const faces = (f.asset.mesh.userData['facadePlan'] as FacadePlan).elevations;
            expect(new Set(faces.map(face => face.mass)).size).toBe(3);
            expect(faces.filter(face => face.mass === 'hall' && face.name === 'front')[0]!.length).toBeCloseTo(f.spec.width * .44);
            f.builder.dispose();
        }
    });
    it('cuts a real street gable light and seats its reveals beneath the roof covering', () => {
        const f = fixture('town-house'), spec = f.spec;
        expect(spec.architecture!.roofAxis).toBe('z');
        expect(spec.architecture!.gableLight).toBe(true);
        const y = spec.plinthHeight + spec.storeyHeight * spec.floors + spec.roof.span * .5 * spec.roof.pitch * .52;
        const solid = meshes(f.root).filter(m => m.userData['surface'] !== 'glazing');
        const ray = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, y, spec.depth / 2 + .02), new THREE.Vector3(0, 0, -1), 0, spec.wallThickness + .04).intersectObjects(solid);
        expect(ray(0).length).toBe(0);
        expect(ray(spec.width * .16).length).toBeGreaterThan(0);
        f.builder.dispose();
    });
    it('provides covered wagon access and mounts the granary hoist over its actual loading hatch', () => {
        const barn = fixture('threshing-barn');
        const ray = new THREE.Raycaster(new THREE.Vector3(0, 20, barn.spec.depth * .65), new THREE.Vector3(0, -1, 0));
        const roof = ray.intersectObjects(meshes(barn.root))[0]!.point.y;
        expect(roof).toBeGreaterThan(barn.spec.plinthHeight + barn.spec.storeyHeight * .82);
        const through = new THREE.Raycaster(new THREE.Vector3(0, barn.spec.plinthHeight + barn.spec.storeyHeight * .4, barn.spec.depth), new THREE.Vector3(0, 0, -1), 0, barn.spec.depth * 2);
        expect(through.intersectObjects(meshes(barn.root)).length).toBe(0);
        barn.builder.dispose();
        const grain = fixture('grain-store');
        expect(grain.spec.architecture!.loadingHoist).toBe(true);
        const parts = meshes(grain.root).flatMap(m => m.geometry.userData['assemblyPieces'] ?? []);
        expect(parts.some(p => p.stage === BUILD_STAGE.UTILITIES && p.max.z > grain.spec.depth * .65 && p.min.y > grain.spec.storeyHeight)).toBe(true);
        grain.builder.dispose();
    });
    it('keeps close, middle and skyline costs within the existing building budgets', () => {
        for (const c of ARCHITECTURE_FLAGSHIPS.filter(c => c.id !== 'smock-mill')) {
            const f = fixture(c.id), lod = f.asset.mesh as THREE.LOD;
            const vertices = (r: THREE.Object3D) => meshes(r).reduce((s, m) => s + m.geometry.getAttribute('position').count, 0);
            expect(vertices(lod.levels[0]!.object), c.id).toBeLessThan(60000);
            expect(meshes(lod.levels[0]!.object).length, c.id).toBeLessThanOrEqual(12);
            expect(vertices(lod.levels[1]!.object), c.id).toBeLessThan(1200);
            expect(vertices(lod.levels[2]!.object), c.id).toBeLessThan(100);
            f.builder.dispose();
        }
    });
    it('keeps bedding under room roofs and routes sleepers through physical courtyard doors', () => {
        const f = fixture('court-house'), fit = 3.6, plan = f.asset.mesh.userData['facadePlan'] as FacadePlan;
        const area: IndoorSleepingArea = { key: 'court', worldX: 0, worldZ: 0, rotationY: 0, width: f.spec.width * fit, depth: f.spec.depth * fit, doorWidth: f.asset.mesh.userData['doorWidth'] * fit, floorY: f.spec.plinthHeight * fit, plotWidth: f.spec.width * fit, plotDepth: f.spec.depth * fit };
        installPhysicalRoomPlan(area, plan, fit, f.asset.mesh.userData['roofedRanges'], f.asset.mesh.userData['interiorWalls']);
        const beds = indoorSleepingSpots(area);
        expect(beds.length).toBeGreaterThan(0);
        expect(sleepAreaFloor(area, { x: 0, z: area.depth * .12 }, 0)).toBe(0);
        const nav = new StructureNavigation();
        nav.set([{ ...area }]);
        const safe = (a: {
            x: number;
            z: number;
        }, b = a) => nav.clear(a, b, area);
        const outside = { x: 0, z: area.depth / 2 + .5 };
        for (const bed of beds) {
            const p = bed.destination;
            const ray = new THREE.Raycaster(new THREE.Vector3(p.x / fit, 20, p.z / fit), new THREE.Vector3(0, -1, 0), 0, 20 - f.spec.plinthHeight - .02);
            expect(ray.intersectObjects(meshes(f.root)).length).toBeGreaterThan(0);
            expect(safe(p)).toBe(true);
            const path = nav.detour(outside, p, safe, area);
            expect(path.length, bed.key).toBeGreaterThan(0);
            let prev = outside;
            for (const next of path) {
                expect(safe(prev, next)).toBe(true);
                prev = next;
            }
        }
        f.builder.dispose();
    });
});
