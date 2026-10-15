import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BUILDING_ARCHETYPES, buildingArchetype, archetypeExistsIn } from '../src/render/architecture/BuildingArchetype';
import { periodResponse, TEST_CULTURE, PERIOD_DRIVE } from '../tests/helpers/architecturePeriods';
const phase = process.argv[2] ?? 'after';
const builder = new AssetBuilder('function-first-audit');
const panels = [];
for (const period of ['bronzeIron', 'medieval', 'industrial', 'contemporary'] as const) {
    for (const archetype of BUILDING_ARCHETYPES.filter(a => buildingArchetype(a).status === 'active' && archetypeExistsIn(a, period))) {
        const development = periodResponse({ period, need: archetype === 'house' ? 'housing' : 'food', form: 'store' });
        const asset = builder.getAsset('building', { seed: `audit:${archetype}`, archetype, era: PERIOD_DRIVE[period].era, culture: TEST_CULTURE, development });
        const root = asset.mesh instanceof THREE.LOD ? asset.mesh.levels[0]!.object : asset.mesh;
        root.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(root), center = bounds.getCenter(new THREE.Vector3());
        const span = Math.max(...bounds.getSize(new THREE.Vector3()).toArray()) * 1.5;
        const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, .01, 100);
        camera.position.copy(center).add(new THREE.Vector3(4, 2.6, 5));
        camera.lookAt(center);
        camera.updateMatrixWorld();
        const shapes: {
            xy: number[];
            depths: number[];
            z: number;
            color: string;
        }[] = [];
        root.traverse(o => {
            if (!(o instanceof THREE.Mesh))
                return;
            const p = o.geometry.getAttribute('position'), idx = o.geometry.index;
            const pieces = o.geometry.userData['assemblyPieces'] as {
                start: number;
                count: number;
                stage: number;
            }[] | undefined;
            for (let i = 0; i < (idx?.count ?? p.count); i += 3) {
                // Completed structural shell only: omit equipment, props and surface artwork.
                if (pieces && !pieces.some(piece => i >= piece.start && i < piece.start + piece.count && piece.stage <= 4))
                    continue;
                if (o.userData['surface'] === 'shadow')
                    continue;
                const pts = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(i + j) : i + j).applyMatrix4(o.matrixWorld));
                const n = pts[1]!.clone().sub(pts[0]!).cross(pts[2]!.clone().sub(pts[0]!)).normalize();
                if (n.dot(camera.position.clone().sub(pts[0]!)) <= 0)
                    continue;
                const shade = Math.round(135 + 85 * Math.max(0, n.dot(new THREE.Vector3(-.4, 1, .6).normalize())));
                const pr = pts.map(v => v.project(camera));
                shapes.push({ xy: pr.flatMap(v => [(v.x + 1) * 140, (1 - v.y) * 140]), depths: pr.map(v => v.z), z: pr.reduce((s, v) => s + v.z, 0) / 3, color: `rgb(${shade},${shade},${shade})` });
            }
        });
        shapes.sort((a, b) => b.z - a.z);
        const metrics = (object: THREE.Object3D) => { let vertices=0, meshes=0; object.traverse(o=>{if(o instanceof THREE.Mesh){vertices+=o.geometry.getAttribute('position').count;meshes++;}}); return {vertices,meshes}; };
        panels.push({ period, archetype, shapes, detail: metrics(root), lods: asset.mesh instanceof THREE.LOD ? asset.mesh.levels.slice(1).map(l=>metrics(l.object)) : [] });
    }
}
mkdirSync('output/architecture-audit', { recursive: true });
writeFileSync(`output/architecture-audit/${phase}.json`, JSON.stringify(panels));
builder.dispose();
