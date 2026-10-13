import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AssetBuilder, type AssetConfig } from '../src/render/assets/AssetBuilder';
import { facadeAtlasLayout, FACADE_ATLAS_SIZE, type FacadePlan } from '../src/render/architecture/FacadePlan';
import { facadeArtwork, facadeTextureKey } from '../src/render/architecture/FacadeSvg';
import { FacadeTextureCache, projectFacadeCoordinates } from '../src/render/architecture/FacadeTextures';
import { BUILD_STAGE } from '../src/render/assets/BuildStages';
import { PERIOD_DRIVE, type ArchitecturalPeriod } from '../src/render/architecture/ArchitecturalPeriod';
import { MATERIAL_SCENARIOS, scenarioEvidence } from '../src/dev/architectureBrowserModel';

const culture = { primary: '#6d7f84', secondary: '#3d4a4e', accent: '#c6a86b', symbol: 'mountain-knot' as const, pattern: 'terrace' as const, nameSyllables: ['kar'] };
function config(stage = 7, seed = 'hybrid-workshop', period: ArchitecturalPeriod = 'medieval'): AssetConfig {
  const drive = PERIOD_DRIVE[period], evidence = scenarioEvidence(MATERIAL_SCENARIOS.find(s => s.id === 'stone')!, period);
  return { seed, culture, era: drive.era, variant: `workshop#${stage}`, prosperity: 0.45, customData: { buildStage: stage },
    development: { need: 'manufacturing', form: 'workshop', name: 'Workshop', level: drive.level,
      material: evidence.material ?? 'masonry', cultureId: 'highland', style: culture, services: {}, reasons: [],
      capabilities: evidence.capabilities, materialCost: evidence.materialCost,
      cost: { food: 0, wood: 0, minerals: 0, goods: 0, wealth: 0 }, labor: 0 } };
}
function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh) result.push(o); }); return result;
}

describe('production hybrid workshop', () => {
  it('routes an authoritative manufacturing response and publishes four coherent elevations and the real roof batches', () => {
    const builder = new AssetBuilder('hybrid-tests');
    try {
      const asset = builder.getAsset('building', config());
      const plan = asset.mesh.userData['facadePlan'] as FacadePlan;
      expect(plan.spec.archetype).toBe('workshop');
      expect(plan.elevations.map(e => e.name)).toEqual(['front', 'rear', 'right', 'left']);
      expect(asset.mesh.userData['facadeStatus']).toBe('hybrid');
      expect(plan.elevations.flatMap(e => e.openings).filter(o => o.kind === 'door')).toHaveLength(1);
      for (const face of plan.elevations) for (const opening of face.openings) {
        expect(Math.abs(opening.u) + opening.w / 2).toBeLessThan(face.length / 2);
        expect(opening.y + opening.h / 2).toBeLessThanOrEqual(plan.wallTop - plan.floor);
      }
      for (const roof of plan.roof.geometry) {
        const source = meshes(asset.mesh).find(m => m.userData['batchKey'] === roof.batchKey)!;
        expect(source.geometry.index!.count / 3).toBe(roof.triangles);
        expect(roof.bounds).toHaveLength(6);
      }
      expect(plan.roof.geometry.length).toBeGreaterThan(0);
      expect(builder.getAsset('building', config()).mesh).toBe(asset.mesh);
      expect(builder.facadeTextures.stats().entries).toBe(1);
    } finally { builder.dispose(); }
  });

  it('uses the specified half-span roof rise, physical eaves and real equipment instead of facade heat markers', () => {
    const builder = new AssetBuilder('hybrid-tests');
    try {
      const root = builder.getAsset('building', config()).mesh;
      const plan = root.userData['facadePlan'] as FacadePlan;
      expect(plan.roof.resolved.tiers).toBe(1);
      expect(plan.roof.top - plan.wallTop).toBeCloseTo(plan.spec.roof.span * 0.5 * plan.spec.roof.pitch, 6);
      const reachZ = Math.max(...plan.roof.geometry.flatMap(batch => [Math.abs(batch.bounds[2]!), Math.abs(batch.bounds[5]!)]));
      expect(reachZ - plan.spec.depth / 2).toBeCloseTo(plan.spec.roof.overhang, 1);
      expect(plan.postThickness / plan.storeyHeight).toBeLessThanOrEqual(0.12);
      const roofFrame = meshes(root).filter(mesh => mesh.name === plan.spec.materials.roofStructure);
      expect(roofFrame.some(mesh => mesh.geometry.userData['assemblyPieces'].some((piece: { stage: number }) => piece.stage === BUILD_STAGE.ROOF))).toBe(true);
      const hearths = meshes(root).filter(mesh => mesh.userData['surface'] === 'forge');
      expect(hearths.length).toBeGreaterThan(0);
      for (const hearth of hearths) {
        for (const piece of hearth.geometry.userData['assemblyPieces']) expect(piece.stage).toBe(BUILD_STAGE.FITOUT);
      }
    } finally { builder.dispose(); }
  });

  it('leaves batching, indexed topology, assembly pieces, LOD and shadows intact during before/after', () => {
    const builder = new AssetBuilder('hybrid-tests');
    try {
      const asset = builder.getAsset('building', config());
      const before = meshes(asset.mesh).map(m => ({ geometry: m.geometry.uuid, indices: Array.from(m.geometry.index!.array),
        pieces: m.geometry.userData['assemblyPieces'], cast: m.castShadow, receive: m.receiveShadow }));
      builder.facadeTextures.setEnabled(false); builder.facadeTextures.setEnabled(true);
      expect(meshes(asset.mesh).map(m => ({ geometry: m.geometry.uuid, indices: Array.from(m.geometry.index!.array),
        pieces: m.geometry.userData['assemblyPieces'], cast: m.castShadow, receive: m.receiveShadow }))).toEqual(before);
      expect(asset.mesh).toBeInstanceOf(THREE.LOD);
      const lod = asset.mesh as THREE.LOD;
      expect(lod.levels.map(l => l.distance)).toEqual([0, 20, 42]);
      expect(meshes(lod.levels[1]!.object).every(m => !m.geometry.hasAttribute('aFacadeUv'))).toBe(true);
      const source = meshes(lod.levels[0]!.object).find(m => m.geometry.hasAttribute('aFacadeUv'))!;
      for (const mesh of meshes(lod.levels[0]!.object)) {
        if (mesh.name === 'dressed-stone') expect((mesh.material as THREE.Material).name).not.toContain(':svg-timber');
      }
      const bound = source.material;
      builder.facadeTextures.apply(lod.levels[0]!.object as THREE.Group);
      expect(source.material).toBe(bound);
      builder.facadeTextures.withProceduralMaterials(lod, () => { expect(source.material).not.toBe(bound); });
      expect(source.material).toBe(bound);
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      source.material = source.material as THREE.MeshStandardMaterial;
      source.material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      expect(shader.vertexShader).toContain('aSurfaceDetail');
      expect(shader.fragmentShader).toContain('gbAmbientAccess');
      expect(shader.fragmentShader).toContain('gbFacadeAtlas');
      expect(shader.fragmentShader).toContain('gbFacadeRelief');
      expect(shader.fragmentShader).toContain('gbFacadeSurface');
      expect(shader.fragmentShader.match(/float gbHeight =/g)).toHaveLength(1);
    } finally { builder.dispose(); }
  });

  it('projects oriented elevation coordinates and excludes inward and ground faces', () => {
    const builder = new AssetBuilder('hybrid-tests');
    try {
      const plan = builder.getAsset('building', config()).mesh.userData['facadePlan'] as FacadePlan;
      const geometry = new THREE.BufferGeometry();
      const positions: number[] = [], normals: number[] = [];
      for (const face of plan.elevations) {
        positions.push(face.originX, plan.floor + (plan.wallTop - plan.floor) / 2, face.originZ);
        normals.push(face.normalX, 0, face.normalZ);
      }
      positions.push(0, 0, 0, 0, plan.wallTop, 0); normals.push(0, 1, 0, 0, 0, -1);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      projectFacadeCoordinates(geometry, plan);
      const uv = geometry.getAttribute('aFacadeUv');
      const { cells } = facadeAtlasLayout(plan);
      for (let i = 0; i < 4; i++) {
        expect(uv.getX(i)).toBeCloseTo((cells[i]!.x + cells[i]!.width / 2) / FACADE_ATLAS_SIZE);
        expect(uv.getY(i)).toBeCloseTo(1 - (cells[i]!.y + cells[i]!.height / 2) / FACADE_ATLAS_SIZE);
        expect(uv.getZ(i)).toBe(1);
      }
      expect(uv.getZ(4)).toBe(0); expect(uv.getZ(5)).toBe(0);
      geometry.dispose();
    } finally { builder.dispose(); }
  });

  it('gates all eight construction stages and remains deterministic across historical periods', () => {
    const builder = new AssetBuilder('hybrid-tests');
    try {
      for (let stage = 0; stage <= BUILD_STAGE.FINISH; stage++) {
        const asset = builder.getAsset('building', config(stage));
        expect(asset.mesh.userData['buildingSpec'].stage).toBe(stage);
        if (stage < BUILD_STAGE.WALLS) expect(asset.mesh.userData['facadeStatus']).toBeUndefined();
        const plan = asset.mesh.userData['facadePlan'] as FacadePlan;
        const svg = facadeArtwork(plan).albedo;
        expect(svg).toBe(facadeArtwork(plan).albedo);
        expect(svg).not.toMatch(/NaN|Infinity|<script|<image|href=/);
        for (const mesh of meshes(asset.mesh)) for (const piece of mesh.geometry.userData['assemblyPieces'] ?? []) expect(piece.stage).toBeLessThanOrEqual(stage);
        expect(facadeTextureKey(plan)).not.toContain('familyRanking');
      }
      expect(builder.facadeTextures.stats().entries).toBe(1);
      const keys = ['medieval', 'earlyModern', 'industrial'].map(period => {
        const plan = builder.getAsset('building', config(7, 'history', period as ArchitecturalPeriod)).mesh.userData['facadePlan'] as FacadePlan;
        return facadeTextureKey(plan);
      });
      expect(new Set(keys).size).toBe(3);
    } finally { builder.dispose(); }
  });

  it('keeps physical texel density uniform and rejects triangles crossing the facade boundary', () => {
    const builder = new AssetBuilder('hybrid-tests');
    try {
      const plan = builder.getAsset('building', config()).mesh.userData['facadePlan'] as FacadePlan;
      const { density, cells } = facadeAtlasLayout(plan);
      cells.forEach((cell, i) => {
        expect(cell.width / plan.elevations[i]!.length).toBeCloseTo(density);
        expect(cell.x - 12).toBeGreaterThanOrEqual(0);
        expect(cell.x + cell.width + 12).toBeLessThanOrEqual(FACADE_ATLAS_SIZE);
        expect(cell.y + cell.height + 12).toBeLessThanOrEqual(FACADE_ATLAS_SIZE);
      });
      const face = plan.elevations[0]!;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        face.originX, plan.floor + 0.02, face.originZ,
        face.originX + 0.01, plan.floor + 0.02, face.originZ,
        face.originX, plan.floor - 0.02, face.originZ,
      ], 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      geometry.setIndex([0, 1, 2]);
      projectFacadeCoordinates(geometry, plan);
      expect([0, 1, 2].map(i => geometry.getAttribute('aFacadeUv').getZ(i))).toEqual([0, 0, 0]);
      geometry.dispose();
      const art = facadeArtwork(plan);
      for (const layer of [art.albedo, art.relief, art.surface]) {
        expect(layer).toMatch(/^<svg/);
        expect(layer).not.toMatch(/NaN|Infinity|<script|<image|href=/);
      }
      expect(art.albedo).not.toBe(art.relief);
      expect(art.relief).not.toBe(art.surface);
    } finally { builder.dispose(); }
  });

  it('dresses real later glazing across production archetypes without repainting their structural fabric', () => {
    for (const period of ['earlyModern', 'industrial', 'modern', 'contemporary'] as const) {
      for (const archetype of ['house', 'civic-hall', 'market', 'workshop', 'factory'] as const) {
        if (period === 'earlyModern' && archetype === 'factory') continue;
        const builder = new AssetBuilder(`glazing-${period}-${archetype}`);
        try {
          const input = config(7, 'glazing-lineage', period);
          input.archetype = archetype;
          const evidence = scenarioEvidence(MATERIAL_SCENARIOS.find(s => s.id === (period === 'modern' || period === 'contemporary' ? 'composite' : 'glazed-masonry'))!, period);
          Object.assign(input.development!, evidence);
          const root = builder.getAsset('building', input).mesh;
          const plan = root.userData['facadePlan'] as FacadePlan;
          expect(plan.spec.archetype).toBe(archetype);
          expect(['glass', 'curtain-glass']).toContain(plan.materials.glazing);
          expect(plan.spec.openings.facade).toBeDefined();
          const painted = meshes(root).filter(m => m.geometry.hasAttribute('aFacadeUv'));
          expect(painted.length).toBeGreaterThan(0);
          if (root.userData['facadeStatus'] === 'hybrid-glazing') {
            for (const mesh of painted) {
              expect(['glass', 'curtain-glass']).toContain(mesh.name);
              const positions = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('aFacadeUv');
              for (let i = 0; i < uv.count; i++) if (uv.getZ(i) > 0) {
                expect(plan.elevations.some(face => {
                  const u = (positions.getX(i) - face.originX) * face.tangentX + (positions.getZ(i) - face.originZ) * face.tangentZ;
                  return face.openings.some(o => o.kind === 'window' && Math.abs(u - o.u) <= o.w / 2 + 1e-5
                    && Math.abs(positions.getY(i) - plan.floor - o.y) <= o.h / 2 + 1e-5);
                })).toBe(true);
              }
            }
          }
          // Raised culture bands must never occlude the clear window field.
          for (const motif of meshes(root).filter(m => m.userData['surface'] === 'motif')) {
            const p = motif.geometry.getAttribute('position'), index = motif.geometry.index!;
            for (const piece of motif.geometry.userData['assemblyPieces'] ?? []) {
              if (piece.stage !== BUILD_STAGE.WALLS) continue;
              for (let i = piece.start; i < piece.start + piece.count; i += 3) {
                const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
                const x = ids.reduce((a, v) => a + p.getX(v), 0) / 3, y = ids.reduce((a, v) => a + p.getY(v), 0) / 3;
                const z = ids.reduce((a, v) => a + p.getZ(v), 0) / 3;
                for (const face of plan.elevations) {
                  const outward = (x - face.originX) * face.normalX + (z - face.originZ) * face.normalZ;
                  if (outward < 0 || outward > 0.01) continue;
                  const u = (x - face.originX) * face.tangentX + (z - face.originZ) * face.tangentZ;
                  expect(face.openings.some(o => Math.abs(u - o.u) < o.w / 2 - 1e-5 && Math.abs(y - plan.floor - o.y) < o.h / 2 - 1e-5)).toBe(false);
                }
              }
            }
          }
          const art = facadeArtwork(plan);
          expect(art.albedo).toContain(`data-glazing="${plan.spec.openings.facade}"`);
          expect(art.albedo).toBe(facadeArtwork(plan).albedo);
          expect(art.albedo).not.toMatch(/NaN|Infinity|<script|<image/);
          const mesh = painted[0]!, material = mesh.material as THREE.MeshStandardMaterial;
          const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
          material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
          expect(shader.fragmentShader).toContain('gbGlassFresnel');
          expect(shader.fragmentShader).toContain('max(0.055,');
          builder.facadeTextures.withProceduralMaterials(root, () => { (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.73; });
          expect(shader.uniforms['gbFacadeNight']!.value).toBe(0.73);
          expect((shader.uniforms['gbFacadeEmission']!.value as THREE.Color).getHex()).not.toBe(0);
          expect(shader.fragmentShader).toContain('totalEmissiveRadiance = gbFacadeEmission * gbFacadeNight;');
          const changed = { ...plan, spec: { ...plan.spec, openings: { ...plan.spec.openings, divisions: 7 } } };
          expect(facadeTextureKey(changed)).not.toBe(facadeTextureKey(plan));
        } finally { builder.dispose(); }
      }
    }
  });

  it('publishes the scaled modern market precinct plan used by its real composition path', () => {
    const builder = new AssetBuilder('glazed-precinct');
    try {
      const input = config(7, 'hybrid-workshop:market', 'modern');
      input.archetype = 'market';
      input.development!.form = 'gathering';
      Object.assign(input.development!, scenarioEvidence(MATERIAL_SCENARIOS.find(s => s.id === 'composite')!, 'modern'));
      const root = builder.getAsset('building', input).mesh;
      const plan = root.userData['facadePlan'] as FacadePlan;
      expect(root.userData['openPrecinct']).toBe(true);
      expect(plan.spec.archetype).toBe('market');
      expect((plan.wallTop - plan.floor) / (plan.spec.storeyHeight * plan.storeys)).toBeCloseTo(Number(root.userData['bodyWidth']) / plan.spec.width);
      expect(root.userData['facadeStatus']).toBe('hybrid-glazing');
      expect(meshes(root).some(m => m.geometry.hasAttribute('aFacadeUv'))).toBe(true);
    } finally { builder.dispose(); }
  });

  it('does not invent glass without capability evidence or install panes before fitout', () => {
    const builder = new AssetBuilder('glazing-authority');
    try {
      const opaque = builder.getAsset('building', config(7, 'no-glass', 'earlyModern')).mesh;
      const plan = opaque.userData['facadePlan'] as FacadePlan;
      expect(['glass', 'curtain-glass']).not.toContain(plan.materials.glazing);
      expect(opaque.userData['facadeGlazingEligible']).toBe(false);
      expect(facadeArtwork(plan).albedo).toContain('data-fitting="opaque"');
      expect(facadeArtwork(plan).albedo).not.toContain('data-glazing=');
      for (const stage of [BUILD_STAGE.FRAME, BUILD_STAGE.WALLS, BUILD_STAGE.ROOF]) {
        const input = config(stage, 'glass-stage', 'modern');
        Object.assign(input.development!, scenarioEvidence(MATERIAL_SCENARIOS.find(s => s.id === 'composite')!, 'modern'));
        const root = builder.getAsset('building', input).mesh;
        expect(meshes(root).some(m => ['glass', 'curtain-glass'].includes(m.name)
          && m.geometry.userData['assemblyPieces'].some((p: { stage: number }) => p.stage === BUILD_STAGE.FITOUT))).toBe(false);
      }
    } finally { builder.dispose(); }
  });

  it('bounds admission and disposes owned textures/materials without touching the source palette', () => {
    const builder = new AssetBuilder('hybrid-tests');
    const cache = new FacadeTextureCache(0);
    try {
      const asset = builder.getAsset('building', config());
      const root = (asset.mesh as THREE.LOD).levels[0]!.object as THREE.Group;
      cache.apply(root);
      expect(root.userData['facadeStatus']).toBe('budget-fallback');
      expect(cache.stats().entries).toBe(0);
      const owned = meshes(root).filter(m => (m.material as THREE.Material).name.includes(':svg-'));
      let disposed = 0;
      for (const mesh of owned) (mesh.material as THREE.Material).addEventListener('dispose', () => disposed++);
      builder.facadeTextures.dispose();
      expect(disposed).toBeGreaterThan(0);
      expect(builder.facadeTextures.stats().entries).toBe(0);
    } finally { builder.dispose(); cache.dispose(); }
  });
});
