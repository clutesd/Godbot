import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { BUILD_STAGE } from '../src/render/assets/BuildStages';
import { BROWSER_CATALOGUE } from '../src/dev/architectureBrowserModel';
import { constructionArtConfig } from '../src/dev/constructionArtCases';
import type { FacadePlan } from '../src/render/architecture/FacadePlan';
import { architecturalMaterial } from '../src/render/architecture/MaterialLibrary';

describe('physical facade and SVG alignment', () => {
  for (const scenario of ['brick', 'glazed-masonry']) it(`keeps factory lights exposed through posts, pilasters and friezes (${scenario})`, () => {
    const builder = new AssetBuilder('facade-alignment');
    try {
      const entry = BROWSER_CATALOGUE.find(e => e.id === 'factory')!;
      const root = builder.getAsset('building', constructionArtConfig(entry, 'industrial', scenario)).mesh;
      const plan = root.userData['facadePlan'] as FacadePlan;
      const levels = root instanceof THREE.LOD ? root.levels.slice(0, 3).map(l => l.object) : [root];
      let samples = 0;
      for (const level of levels) {
        level.updateMatrixWorld(true);
        for (const face of plan.elevations) for (const opening of face.openings.filter(o => o.kind === 'window')) {
          let obstructed = 0;
          for (const du of [-.18, .18]) for (const dy of [-.18, .18]) {
            const normal = new THREE.Vector3(face.normalX, 0, face.normalZ);
            const point = new THREE.Vector3(face.originX + face.tangentX * (opening.u + opening.w * du),
              plan.floor + opening.y + opening.h * dy, face.originZ + face.tangentZ * (opening.u + opening.w * du));
            const ray = new THREE.Raycaster(point.addScaledVector(normal, .2), normal.negate(), 0, .2 + plan.wallThickness);
            const blocked = ray.intersectObject(level, true).filter(hit => {
              const mesh = hit.object as THREE.Mesh;
              if (['glazing', 'shadow', 'glow'].includes(String(mesh.userData['surface'])) || String(mesh.userData['surface']).startsWith('roof-')) return false;
              // Check the facade fabric, excluding independent porch posts standing ahead of it.
              const outward = (hit.point.x - face.originX) * face.normalX + (hit.point.z - face.originZ) * face.normalZ;
              if (outward > Math.max(plan.wallThickness, plan.postThickness * 1.5) + 1e-5) return false;
              // Full-detail batches also contain fitted window bars and door leaves.
              const piece = mesh.geometry.userData['assemblyPieces']?.find((p: { start: number; count: number }) =>
                hit.faceIndex! * 3 >= p.start && hit.faceIndex! * 3 < p.start + p.count);
              return !piece || piece.stage <= BUILD_STAGE.WALLS;
            });
            if (blocked.length) obstructed++;
            samples++;
          }
          // An independent porch post may cross a light; a frame or wall must not seal the bay.
          expect(obstructed, `${scenario}/${level.name}/${face.name}/${opening.row}/${opening.index}`).toBeLessThanOrEqual(1);
        }
      }
      expect(samples).toBeGreaterThan(100);
    } finally { builder.dispose(); }
  });

  it('projects the granary doorway dressing onto its physical stone casing', () => {
    const builder = new AssetBuilder('facade-alignment');
    try {
      const root = builder.getAsset('building', constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === 'granary')!, 'medieval', 'stone')).mesh;
      const full = root instanceof THREE.LOD ? root.levels[0]!.object : root;
      const plan = root.userData['facadePlan'] as FacadePlan, face = plan.elevations[0]!;
      const door = face.openings.find(o => o.kind === 'door')!;
      const normal = new THREE.Vector3(face.normalX, 0, face.normalZ);
      full.updateMatrixWorld(true);
      for (const side of [-1, 1]) {
        const u = door.u + side * (door.w / 2 + .01);
        const ray = new THREE.Raycaster(new THREE.Vector3(face.originX + face.tangentX * u, plan.floor + door.y + .02,
          face.originZ + face.tangentZ * u).addScaledVector(normal, .2), normal.clone().negate(), 0, .3);
        const hit = ray.intersectObject(full, true).find(h => h.object.userData['surface'] === 'stone')!;
        expect(hit).toBeDefined();
        const mesh = hit.object as THREE.Mesh;
        expect(mesh.name).toBe(plan.materials.trim);
        const projection = mesh.geometry.getAttribute('aFacadeUv');
        expect(projection).toBeDefined();
        for (const vertex of [hit.face!.a, hit.face!.b, hit.face!.c]) expect(projection.getZ(vertex)).toBe(1);
      }
    } finally { builder.dispose(); }
  });

  it('keeps stone elevation artwork off timber fittings', () => {
    const builder = new AssetBuilder('facade-alignment');
    try {
      const root = builder.getAsset('building', constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === 'granary')!, 'medieval', 'timber')).mesh;
      const full = root instanceof THREE.LOD ? root.levels[0]!.object : root;
      const plan = root.userData['facadePlan'] as FacadePlan;
      let fittings = 0;
      full.traverse(object => {
        if (!(object instanceof THREE.Mesh) || object.name !== plan.materials.trim || object.name === plan.materials.wall
          || architecturalMaterial(plan.materials.trim).family !== 'timber') return;
        expect(object.geometry.hasAttribute('aFacadeTile')).toBe(true);
        expect(object.geometry.hasAttribute('aFacadeUv')).toBe(false);
        fittings++;
      });
      expect(fittings).toBeGreaterThan(0);
    } finally { builder.dispose(); }
  });
});
