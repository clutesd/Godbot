import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GODBOX_CONFIG } from '../godbox.config';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import { CameraDirector } from '../src/render/CameraDirector';
import { surfaceHeightAt } from '../src/sim/terrain/SurfaceGeometry';
import { OpeningHandoff } from '../src/sim/founding/OpeningHandoff';

it.each(['none', 'all', 'release'] as const)('plays through to month one with blocked routes=%s', blocked => {
  const sim = new Simulation({ ...GODBOX_CONFIG, seed: 'arrival-day-preview', startMode: 'arrival', autoRun: true });
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.01, 500);
  const historian = new Historian(sim.config);
  let selectedSceneId = '';
  const chooseScene = historian.chooseScene.bind(historian);
  vi.spyOn(historian, 'chooseScene').mockImplementation((...args) => {
    const scene = chooseScene(...args);
    selectedSceneId = scene.id;
    return scene;
  });
  const director = new CameraDirector(camera, sim.config, historian, undefined, undefined,
    () => sim.foundingOrientationRunning && (blocked === 'all'
      || blocked === 'release' && selectedSceneId.startsWith('founding-release:')) ? 1 : 0);
  const handoff = new OpeningHandoff(sim);
  const scenes = new Set<string>();
  for (let frame = 0; frame < 2400 && sim.state.month === 0; frame += 1) {
    handoff.commitFirstTick(sim);
    sim.advanceArrival(0.1);
    director.update(0.1, frame / 10, sim.state, (x, z) => surfaceHeightAt(sim.state.world, x, z));
    if (director.observation.sceneId) scenes.add(director.observation.sceneId);
    handoff.beginIfReady(sim, director.foundingPresentationComplete());
  }
  expect({ phase: sim.state.arrival?.phase, scenes: [...scenes], month: sim.state.month }).toMatchObject({ phase: 'HISTORY_RUNNING', month: 1 });
  expect(handoff.pendingFirstTick).toBe(false);
  expect(handoff.commitFirstTick(sim)).toBe(false);
  if (blocked === 'none') {
    expect([...scenes].some(id => id.startsWith('founding:'))).toBe(true);
    expect([...scenes].filter(id => id.startsWith('founding-cast:introduction:'))).toHaveLength(2);
    expect([...scenes].some(id => id.startsWith('founding-release:'))).toBe(true);
  } else {
    expect([...scenes].some(id => id.startsWith('founding-release:'))).toBe(false);
    expect(historian.statements.some(statement => statement.id.startsWith('founding-release-'))).toBe(false);
    if (blocked === 'all') expect(scenes.size).toBe(0);
  }
}, 60_000);
