import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { resolveBuildingSpec, buildingSpecSignature, validateBuildingSpec } from '../src/render/architecture/BuildingSpec';
import { grammarFromBuildingSpec } from '../src/render/architecture/SpecGrammarBridge';
import { functionalElevations } from '../src/render/architecture/FacadePlan';
import { composeBuilding, BUILD_STAGE } from '../src/render/assets/BuildingComposer';
import { CultureStyleProfileFactory } from '../src/render/style/CultureStyleProfile';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { specContextFor, periodResponse, TEST_CULTURE } from './helpers/architecturePeriods';
import { archetypeExistsIn } from '../src/render/architecture/BuildingArchetype';
import type { ArchitecturalPeriod } from '../src/render/architecture/ArchitecturalPeriod';
import { functionalSilhouette } from '../src/render/architecture/FunctionalBuildings';
const archetypes = ['house', 'barn', 'byre', 'stable', 'granary'] as const;
const periods: ArchitecturalPeriod[] = ['bronzeIron', 'medieval', 'industrial', 'contemporary'];
function fixture(archetype: typeof archetypes[number], period: ArchitecturalPeriod) {
    const context = specContextFor({ archetype, period, role: 'house', seed: `physical:${archetype}`,
        development: periodResponse({ period, need: archetype === 'house' ? 'housing' : 'food', form: archetype === 'house' ? 'dwelling' : 'store' }) });
    const spec = resolveBuildingSpec(context);
    const profile = CultureStyleProfileFactory.createFromCulture('physical', TEST_CULTURE);
    const grammar = grammarFromBuildingSpec(profile, spec, spec.role);
    const palette = new MaterialPalette({ culture: TEST_CULTURE, era: spec.era });
    const group = composeBuilding(grammar, palette, spec.seed, BUILD_STAGE.FINISH).group;
    return { spec, grammar, group, context, palette };
}
describe('functional production architecture', () => {
    it('cuts full-depth openings through the actual composed meshes across periods', () => {
        for (const period of periods)
            for (const archetype of archetypes) {
                if (!archetypeExistsIn(archetype, period))
                    continue;
                const { spec, group, palette } = fixture(archetype, period);
                if (!spec.architecture) {
                    palette.dispose();
                    continue;
                }
                group.updateMatrixWorld(true);
                group.traverse(o => { if (o instanceof THREE.Mesh) expect(o.geometry.userData['assemblyPieces'].reduce((n: number, p: {count: number}) => n+p.count, 0)).toBe(o.geometry.index!.count); });
                const faces = functionalElevations(spec, spec.width / 2, spec.depth / 2, spec.storeyHeight * spec.floors);
                const opaque: THREE.Mesh[] = [];
                group.traverse(o => { if (o instanceof THREE.Mesh && !o.name.includes('glass'))
                    opaque.push(o); });
                for (const face of faces)
                    for (const opening of face.openings)
                        for (const du of [-.2, 0, .2])
                            for (const dy of [-.2, 0, .2]) {
                                const at = new THREE.Vector3(face.originX + face.tangentX * (opening.u + opening.w * du), spec.plinthHeight + opening.y + opening.h * dy, face.originZ + face.tangentZ * (opening.u + opening.w * du));
                                const outward = new THREE.Vector3(face.normalX, 0, face.normalZ);
                                const ray = new THREE.Raycaster(at.clone().addScaledVector(outward, .015), outward.negate(), 0, spec.wallThickness + .02);
                                expect(ray.intersectObjects(opaque).length, `${archetype}/${period}/${face.name}/${opening.purpose} sample ${du},${dy}: ${ray.intersectObjects(opaque).map(h => h.object.name + ':' + h.point.toArray()).join(';')}`).toBe(0);
                            }
                // Positive control: an intact wall point really stops a ray.
                const f = faces[0]!;
                const ray = new THREE.Raycaster(new THREE.Vector3(f.length * .46, spec.plinthHeight + spec.storeyHeight * .5, f.originZ + .02), new THREE.Vector3(0, 0, -1), 0, spec.wallThickness + .04);
                expect(ray.intersectObjects(opaque).length).toBeGreaterThan(0);
                expect(group.children.some(o => o.name === 'shadow')).toBe(false);
                palette.dispose();
            }
    });
    it('resolves functional access, distinct sections and historical grain storage', () => {
        const builds = archetypes.map(a => fixture(a, 'medieval'));
        expect(new Set(builds.map(b => b.spec.architecture!.plan)).size).toBe(5);
        const [house, barn, byre, stable, granary] = builds;
        expect(barn!.spec.architecture!.section).toBe('aisled');
        expect(byre!.spec.architecture!.section).toBe('lean-to');
        expect(stable!.spec.architecture!.section).toBe('hipped');
        expect(house!.spec.storeyHeight).toBeGreaterThan(byre!.spec.storeyHeight);
        const openings = (b: typeof builds[number]) => functionalElevations(b.spec, b.spec.width / 2, b.spec.depth / 2, b.spec.storeyHeight * b.spec.floors);
        expect(openings(barn!)[0]!.openings.find(o => o.purpose === 'wagon')!.w / barn!.spec.width).toBeCloseTo(.35);
        expect(openings(barn!)[1]!.openings.some(o => o.purpose === 'wagon')).toBe(true);
        expect(openings(stable!)[0]!.openings.filter(o => o.purpose === 'stall').length).toBe(stable!.spec.architecture!.bays);
        expect(openings(granary!)[0]!.openings.some(o => o.purpose === 'loading')).toBe(true);
        for (const b of builds) {
            expect(validateBuildingSpec(b.spec)).toEqual([]);
            b.palette.dispose();
        }
        const raised = fixture('granary', 'bronzeIron'), bulk = fixture('granary', 'contemporary');
        expect(raised.spec.architecture!.raisedFloor).toBe(true);
        expect(bulk.spec.architecture!.section).toBe('flat');
        expect(bulk.spec.floors).toBeGreaterThan(raised.spec.floors);
        raised.palette.dispose();
        bulk.palette.dispose();
    });
    it('keeps barn circulation clear through both wagon doors and between aisle columns', () => {
        const { spec, group, palette } = fixture('barn', 'medieval');
        group.updateMatrixWorld(true);
        const opaque: THREE.Mesh[] = [];
        group.traverse(o => { if (o instanceof THREE.Mesh)
            opaque.push(o); });
        for (const x of [-spec.width * .1, 0, spec.width * .1]) {
            const ray = new THREE.Raycaster(new THREE.Vector3(x, spec.plinthHeight + spec.storeyHeight * .4, spec.depth), new THREE.Vector3(0, 0, -1), 0, spec.depth * 2);
            expect(ray.intersectObjects(opaque).length, ray.intersectObjects(opaque).map(h => h.object.name + ':' + h.point.toArray()).join(';')).toBe(0);
        }
        palette.dispose();
    });
    it('measures distinct roof sections in the production triangles', () => {
        const topAt = (group: THREE.Group, x: number, z: number) => {
            group.updateMatrixWorld(true);
            const ray = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
            return ray.intersectObjects(group.children, true)[0]!.point.y;
        };
        const barn = fixture('barn', 'medieval'), byre = fixture('byre', 'medieval'), stable = fixture('stable', 'medieval'), granary = fixture('granary', 'contemporary');
        const barnWall = barn.spec.plinthHeight + barn.spec.storeyHeight;
        const rise = barn.spec.depth / 2 * barn.spec.roof.pitch;
        const gableRay=new THREE.Raycaster(new THREE.Vector3(barn.spec.width/2+.03,barnWall+rise*.4,0),new THREE.Vector3(-1,0,0),0,.1);
        expect(gableRay.intersectObjects(barn.group.children,true).length).toBeGreaterThan(0);
        expect(topAt(barn.group, 0, 0) - barnWall).toBeCloseTo(rise, 2);
        expect(topAt(barn.group, 0, barn.spec.depth * .26) - barnWall).toBeCloseTo(rise * .28, 2);
        expect(topAt(byre.group, 0, -byre.spec.depth * .35)).toBeGreaterThan(topAt(byre.group, 0, byre.spec.depth * .35));
        const stableHallZ=stable.spec.architecture!.composition==='stable-yard'?-stable.spec.depth*.33:0;
        expect(topAt(stable.group, stable.spec.width * .46, stableHallZ)).toBeLessThan(topAt(stable.group, 0, stableHallZ));
        expect(topAt(granary.group, 0, -granary.spec.depth * .3)).toBeCloseTo(topAt(granary.group, 0, granary.spec.depth * .3), 3);
        for (const b of [barn, byre, stable, granary])
            b.palette.dispose();
    });
    it('keeps early dwelling entrances clear of radial and longhouse posts', () => {
        for (const period of ['neolithic', 'bronzeIron'] as const)
            for (let i = 0; i < 8; i++) {
                const context = specContextFor({ archetype: 'house', role: 'house', period, seed: `entry:${i}` });
                const spec = resolveBuildingSpec(context);
                const profile = CultureStyleProfileFactory.createFromCulture('early-entry', TEST_CULTURE);
                const grammar = grammarFromBuildingSpec(profile, spec, spec.role);
                const palette = new MaterialPalette({ culture: TEST_CULTURE, era: spec.era });
                const group = composeBuilding(grammar, palette, spec.seed, BUILD_STAGE.FINISH).group;
                group.updateMatrixWorld(true);
                const ray = new THREE.Raycaster(new THREE.Vector3(0, spec.plinthHeight + spec.storeyHeight * .4, spec.depth), new THREE.Vector3(0, 0, -1), 0, spec.depth * .6);
                expect(ray.intersectObjects(group.children, true).length, `${period}/${i}`).toBe(0);
                palette.dispose();
            }
    });
    it('keeps construction stages, deterministic specs, cache identity and LOD silhouettes', () => {
        for (const archetype of archetypes) {
            const { spec, grammar, context, palette } = fixture(archetype, 'medieval');
            expect(resolveBuildingSpec(context)).toEqual(spec);
            const modified = { ...spec, architecture: { ...spec.architecture!, bays: spec.architecture!.bays + 1 } };
            expect(buildingSpecSignature(modified)).not.toBe(buildingSpecSignature(spec));
            const frame = composeBuilding(grammar, palette, spec.seed, BUILD_STAGE.FRAME).group;
            const roof = composeBuilding(grammar, palette, spec.seed, BUILD_STAGE.ROOF).group;
            expect(frame.children.some(o => o.userData['surface'] === 'roof-tile')).toBe(false);
            expect(new THREE.Box3().setFromObject(roof).max.y).toBeGreaterThan(new THREE.Box3().setFromObject(frame).max.y);
            const far = functionalSilhouette(grammar, palette.getArchitecturalMaterial(spec.materials.wall));
            const farBox = new THREE.Box3().setFromObject(far);
            expect(farBox.max.y).toBeCloseTo(new THREE.Box3().setFromObject(roof).max.y, 2);
            palette.dispose();
        }
    });
});
