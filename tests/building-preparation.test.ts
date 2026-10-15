import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PreparationWorker } from '../src/render/assets/PreparationWorker';
import { ProgressiveBuildingLod } from '../src/render/assets/ProgressiveBuildingLod';
import { AssetBuilder } from '../src/render/assets/AssetBuilder';
import { packBuilding, unpackBuilding } from '../src/render/assets/PreparedBuilding';
import { MaterialPalette } from '../src/render/materials/MaterialPalette';
import { BROWSER_CATALOGUE } from '../src/dev/architectureBrowserModel';
import { constructionArtConfig } from '../src/dev/constructionArtCases';
import { isArchitecturalMaterial } from '../src/render/architecture/MaterialLibrary';
import type { SurfaceKey } from '../src/render/materials/MaterialPalette';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); PreparationWorker.factory = undefined; });

describe('background building preparation', () => {
  it('keeps early scene clones visible and installs shared tiers without drawing overlapping levels', () => {
    const source = new ProgressiveBuildingLod();
    const full = new THREE.Group(); full.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    source.addLevel(full, 0); source.autoUpdate = false;
    const early = source.clone(true);
    const tiers = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
    tiers.forEach(tier => tier.add(new THREE.Mesh(new THREE.BoxGeometry(), (full.children[0] as THREE.Mesh).material)));
    source.install(tiers, [20, 42, 96], .08);
    const late = source.clone(true);
    for (const lod of [source, early, late]) {
      expect(lod.levels.map(l => l.distance)).toEqual([0, 20, 42, 96]);
      expect(lod.levels.map(l => l.object.visible)).toEqual([true, false, false, false]);
      expect((lod.levels[1]!.object.children[0] as THREE.Mesh).geometry).toBe((tiers[0]!.children[0] as THREE.Mesh).geometry);
      const camera = new THREE.PerspectiveCamera(); camera.position.z = 50; camera.updateMatrixWorld(); lod.updateMatrixWorld(); lod.update(camera);
      expect(lod.levels.map(l => l.object.visible)).toEqual([false, false, true, false]);
    }
  });

  for (const archetype of ['granary', 'windmill'] as const) it(`round-trips ${archetype} buffers, construction pieces and moving-part metadata`, () => {
    const builder = new AssetBuilder('prepared-round-trip', { backgroundPreparation: false });
    const config = constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === archetype)!, 'medieval', 'stone');
    const palette = new MaterialPalette({ culture: config.culture, era: config.era });
    try {
      const source = builder.getAsset('building', config).mesh;
      const restored = unpackBuilding(structuredClone(packBuilding(source)), palette);
      const meshes = (root: THREE.Object3D) => { const result: THREE.Mesh[] = []; root.traverse(o => { if (o instanceof THREE.Mesh) result.push(o); }); return result; };
      const before = meshes(source), after = meshes(restored);
      expect(restored.userData).toEqual(source.userData);
      expect(after.length).toBe(before.length);
      after.forEach((mesh, i) => {
        const original = before[i]!;
        expect(mesh.name).toBe(original.name);
        expect(mesh.geometry.index!.array).toEqual(original.geometry.index!.array);
        expect(mesh.geometry.userData).toEqual(original.geometry.userData);
        expect(mesh.geometry.boundingBox).toEqual(original.geometry.boundingBox);
        for (const [name, attribute] of Object.entries(original.geometry.attributes)) {
          expect(mesh.geometry.getAttribute(name).array).toEqual(attribute.array);
          expect(mesh.geometry.getAttribute(name).normalized).toBe(attribute.normalized);
        }
        expect(mesh.material).toBe(isArchitecturalMaterial(mesh.name) ? palette.getArchitecturalMaterial(mesh.name) : palette.getSurfaceMaterial(mesh.name as SurfaceKey));
      });
    } finally { builder.dispose(); palette.dispose(); }
  });

  it('serializes queued requests and cancels callers on disposal', async () => {
    const posted: unknown[] = [];
    const fake = { postMessage: (payload: unknown) => posted.push(payload), terminate: vi.fn(), onmessage: undefined as ((event: MessageEvent) => void) | undefined };
    PreparationWorker.factory = () => fake as unknown as Worker;
    const worker = new PreparationWorker();
    const a = worker.run<number>({ kind: 'one' }), b = worker.run<number>({ kind: 'two' });
    expect(posted).toHaveLength(1);
    fake.onmessage!({ data: { result: 7 } } as MessageEvent);
    expect(await a).toBe(7); expect(posted).toHaveLength(2);
    const rejected = expect(b).rejects.toThrow('cancelled');
    worker.dispose(); await rejected; expect(fake.terminate).toHaveBeenCalledOnce();
  });

  it('deduplicates complete builds, snapshots mutable inputs and adopts the worker result into the cache', async () => {
    const original = new AssetBuilder('prepared-source', { backgroundPreparation: false });
    const config = constructionArtConfig(BROWSER_CATALOGUE.find(e => e.id === 'granary')!, 'medieval', 'stone');
    const snapshot = structuredClone(config);
    const data = structuredClone(packBuilding(original.getAsset('building', snapshot).mesh));
    vi.stubGlobal('window', {}); vi.stubGlobal('Worker', class {});
    const posted: { config: typeof config }[] = [];
    const fake = { postMessage: (payload: { config: typeof config }) => posted.push(payload), terminate: vi.fn(), onmessage: undefined as ((event: MessageEvent) => void) | undefined };
    PreparationWorker.factory = () => fake as unknown as Worker;
    const builder = new AssetBuilder('prepared-owner');
    try {
      const a = builder.prepareBuilding(config), b = builder.prepareBuilding(config);
      expect(a).toBe(b); expect(posted).toHaveLength(1); expect(builder.hasBuilding(snapshot)).toBe(false);
      config.seed = 'mutated-after-enqueue';
      expect(posted[0]!.config.seed).toBe(snapshot.seed);
      fake.onmessage!({ data: { result: data } } as MessageEvent);
      await a;
      expect(builder.hasBuilding(snapshot)).toBe(true);
      const ready = builder.getAsset('building', snapshot).mesh;
      expect(ready.userData['structureComponentSignature']).toBe(data.userData['structureComponentSignature']);
      expect((ready as THREE.LOD).levels).toHaveLength(4);
      await builder.prepareBuilding(snapshot); expect(posted).toHaveLength(1);
    } finally { builder.dispose(); original.dispose(); }
  });

  it('drops superseded queued work without interrupting the current job or the next valid request', async () => {
    const posted: unknown[] = [];
    const fake = { postMessage: (payload: unknown) => posted.push(payload), terminate: vi.fn(), onmessage: undefined as ((event: MessageEvent) => void) | undefined };
    PreparationWorker.factory = () => fake as unknown as Worker;
    const worker = new PreparationWorker();
    let valid = true;
    const current = worker.run('current');
    const stale = worker.run('stale', [], () => valid);
    const cancelled = expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    const next = worker.run('next');
    valid = false; worker.prune(); await cancelled;
    fake.onmessage!({ data: { result: 'done' } } as MessageEvent); await current;
    expect(posted).toEqual(['current', 'next']);
    fake.onmessage!({ data: { result: 'done' } } as MessageEvent); await next;
    worker.dispose();
  });
});
