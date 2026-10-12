import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ShaderReadinessGate } from '../src/render/ShaderReadinessGate';

type FakeProgram = { ready: boolean; isReady(): boolean };

/**
 * Minimal renderer double. `compile` links one program variant per (material, object kind), so an
 * already-ready material drawn by a different kind of object needs a new variant, as in three.
 */
function fakeRenderer(parallelCompile = true) {
  const properties = new WeakMap<object, { programs?: Map<string, FakeProgram> }>();
  const created: FakeProgram[] = [];
  const renderer = {
    extensions: { has: (name: string) => parallelCompile && name === 'KHR_parallel_shader_compile' },
    target: null as unknown,
    compiledInto: [] as unknown[],
    info: { programs: [] as Array<{ usedTimes: number }> },
    getRenderTarget() { return this.target; },
    setRenderTarget(target: unknown) { this.target = target; },
    properties: { get: (material: object) => { let state = properties.get(material); if (!state) properties.set(material, state = {}); return state; } },
    compile(root: THREE.Object3D) {
      renderer.compiledInto.push(renderer.target);
      root.traverse(object => {
        const material = (object as THREE.Mesh).material as THREE.Material | undefined;
        if (!material) return;
        const state = renderer.properties.get(material);
        state.programs ??= new Map();
        const key = (object as THREE.InstancedMesh).isInstancedMesh ? 'instanced' : 'plain';
        if (!state.programs.has(key)) {
          const program: FakeProgram = { ready: false, isReady() { return this.ready; } };
          state.programs.set(key, program);
          created.push(program);
        }
      });
    },
  };
  const finishAll = () => { for (const program of created) program.ready = true; };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, fake: renderer, finishAll };
}

const camera = new THREE.PerspectiveCamera();

describe('shader readiness gate', () => {
  it('keeps a newly added object off every camera layer until its shaders report ready', () => {
    const { renderer, finishAll } = fakeRenderer();
    const gate = new ShaderReadinessGate(renderer);
    const scene = new THREE.Scene();
    const building = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(building);

    gate.gate(scene, camera);
    expect(building.layers.test(camera.layers)).toBe(false);
    expect(gate.waiting).toBe(1);

    gate.gate(scene, camera);
    expect(building.layers.test(camera.layers)).toBe(false);

    finishAll();
    gate.gate(scene, camera);
    expect(building.layers.test(camera.layers)).toBe(true);
    expect(gate.waiting).toBe(0);
  });

  it('never delays an object whose program variant is already linked and ready', () => {
    const { renderer, finishAll } = fakeRenderer();
    const gate = new ShaderReadinessGate(renderer);
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    gate.gate(scene, camera);
    finishAll();
    gate.gate(scene, camera);

    const sibling = new THREE.Mesh(new THREE.BoxGeometry(), material);
    scene.add(sibling);
    gate.gate(scene, camera);
    expect(sibling.layers.mask).toBe(1);
  });

  it('gates a ready material drawn by a new kind of object, which needs another variant', () => {
    const { renderer } = fakeRenderer();
    const gate = new ShaderReadinessGate(renderer);
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial();
    const plain = new THREE.Mesh(new THREE.BoxGeometry(), material);
    scene.add(plain);
    gate.gate(scene, camera);
    (renderer.properties.get(material) as { programs: Map<string, FakeProgram> }).programs.get('plain')!.ready = true;
    gate.gate(scene, camera);
    expect(plain.layers.mask).toBe(1);

    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 4);
    scene.add(instanced);
    gate.gate(scene, camera);
    expect(instanced.layers.test(camera.layers)).toBe(false);
  });

  it('compiles against the render target the frame draws into, then restores the binding', () => {
    const { renderer, fake } = fakeRenderer();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const composerBuffer = { offscreen: true } as unknown as THREE.WebGLRenderTarget;
    new ShaderReadinessGate(renderer).gate(scene, camera, composerBuffer);
    expect(fake.compiledInto).toEqual([composerBuffer]);
    expect(fake.target).toBeNull();
  });

  it('gates an object at most once, even if its material keeps being replaced', () => {
    const { renderer, finishAll } = fakeRenderer();
    const gate = new ShaderReadinessGate(renderer);
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    gate.gate(scene, camera);
    finishAll();
    gate.gate(scene, camera);
    mesh.material = new THREE.MeshStandardMaterial();
    gate.gate(scene, camera);
    expect(mesh.layers.test(camera.layers)).toBe(true);
  });

  it('reveals anything still waiting after the safety timeout', () => {
    const { renderer } = fakeRenderer();
    let now = 0;
    const gate = new ShaderReadinessGate(renderer, () => now);
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    gate.gate(scene, camera);
    now = 9_999;
    gate.gate(scene, camera);
    expect(mesh.layers.test(camera.layers)).toBe(false);
    now = 10_000;
    gate.gate(scene, camera);
    expect(mesh.layers.test(camera.layers)).toBe(true);
    expect(gate.timedOut).toBe(1);
  });

  it('pins every linked program once, so disposing its last material cannot destroy it', () => {
    const { renderer, fake } = fakeRenderer(false);
    fake.info.programs.push({ usedTimes: 1 }, { usedTimes: 3 });
    const gate = new ShaderReadinessGate(renderer);
    const scene = new THREE.Scene();
    gate.gate(scene, camera);
    gate.gate(scene, camera);
    expect(fake.info.programs.map(p => p.usedTimes)).toEqual([2, 4]);
    fake.info.programs.push({ usedTimes: 1 });
    gate.gate(scene, camera);
    expect(fake.info.programs.map(p => p.usedTimes)).toEqual([2, 4, 2]);
  });

  it('stays inert without non-blocking readiness queries, and restores everything on release', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    new ShaderReadinessGate(fakeRenderer(false).renderer).gate(scene, camera);
    expect(mesh.layers.mask).toBe(1);

    const gate = new ShaderReadinessGate(fakeRenderer().renderer);
    gate.gate(scene, camera);
    expect(mesh.layers.mask).not.toBe(1);
    gate.releaseAll();
    expect(mesh.layers.mask).toBe(1);
  });
});
