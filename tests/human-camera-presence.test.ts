import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CameraDirector, cameraFramingFor, cameraClearanceFor, cameraFlightProfileFor, resolveHumanSightline, structureSightlineObstruction } from '../src/render/CameraDirector';
import { Historian } from '../src/historian/Historian';
import { Simulation } from '../src/sim/Simulation';

describe('human documentary camera', () => {
  it('keeps settlement approaches below an aerial angle and uses a low local flight', () => {
    for (const kind of ['settlement-approach', 'institution-exterior', 'infrastructure-scene'] as const) {
      const framing = cameraFramingFor(kind);
      expect(framing.height[1] / framing.radius[0]).toBeLessThan(0.8);
      expect(cameraClearanceFor(kind).lens).toBeLessThan(framing.height[0]);
      const flight = cameraFlightProfileFor(kind, 8);
      expect(flight.cruiseClearance).toBeLessThan(3);
      expect(flight.minApproachRadius).toBeGreaterThan(8);
    }
  });

  it('acquires the rendered person before composing the flight endpoint', () => {
    const sim = new Simulation({ seed: 'rendered-camera-subject', startMode: 'established', startingPopulation: 72 });
    sim.state.arrival = undefined;
    sim.state.history = [];
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];
    const person = sim.state.people.find(p => p.alive)!;
    const historian = new Historian(sim.config);
    const candidate = historian.chooseScene(sim.state);
    vi.spyOn(historian, 'chooseScene').mockReturnValue({ ...candidate, id: 'rendered-person',
      subjectId: person.id, kind: 'worker-follow', position: { x: 40, z: 40 } });
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
    const director = new CameraDirector(camera, sim.config, historian, () => ({ x: 0, z: 0, footY: 0 }));
    const before = JSON.stringify(sim.state);
    director.update(1 / 60, 0, sim.state, () => 0);
    expect(Math.hypot(camera.position.x, camera.position.z)).toBeLessThan(3);
    expect(camera.position.y).toBeLessThan(1);
    camera.updateMatrixWorld();
    const screen = new THREE.Vector3(0, 0.12, 0).project(camera);
    expect(Math.abs(screen.x)).toBeLessThan(0.1);
    expect(Math.abs(screen.y)).toBeLessThan(0.1);
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it('protects both people from a foreground building while retaining a medium shot', () => {
    const sim = new Simulation({ seed: 'documentary-human-cadence', startMode: 'established', startingPopulation: 72, settlementCount: [2, 2], world: { size: 20 } });
    for (const cell of sim.state.world.cells) cell.wood = 0;
    for (const settlement of sim.state.settlements) settlement.structurePlots = [];
    sim.state.settlements[0]!.structurePlots = [{ id: 'occluder', worldX: 1, worldZ: 0, width: 0.5, depth: 1,
      height: 2, radius: 0.55, condition: 1, foundedMonth: 0 }];
    const subjects = [new THREE.Vector3(0, 0.17, -0.3), new THREE.Vector3(0, 0.17, 0.3)];
    const focus = new THREE.Vector3(0, 0.17, 0), authored = new THREE.Vector3(3, 0.8, 0);
    const before = subjects.map(p => structureSightlineObstruction(sim.state, authored, p, () => 0));
    const selected = resolveHumanSightline(sim.state, authored, focus, subjects, () => 0);
    expect(before.some(score => score > 0.2)).toBe(true);
    for (const subject of subjects) expect(structureSightlineObstruction(sim.state, selected, subject, () => 0)).toBeLessThan(0.02);
    expect(Math.hypot(selected.x, selected.z)).toBeCloseTo(3, 8);
  });

  it('holds meaningful two-shots, re-establishes context, and replays identically across calendar rates', () => {
    const runs = [0, 0.1, 2, 100].map(rate => {
      const sim = new Simulation({ seed: 'documentary-human-cadence', startMode: 'established', startingPopulation: 72, settlementCount: [2, 2], world: { size: 20 } });
      sim.state.arrival = undefined; sim.state.history = [];
      for (const cell of sim.state.world.cells) cell.wood = 0;
      for (const settlement of sim.state.settlements) settlement.structurePlots = [];
      const a = sim.state.people[0]!, b = sim.state.people[1]!;
      const historian = new Historian(sim.config);
      const community = historian.chooseScene(sim.state);
      vi.spyOn(historian, 'chooseScene').mockReturnValue({ ...community, id: 'review-community',
        kind: 'settlement-approach', position: { x: 0, z: 0 } });
      const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
      const director = new CameraDirector(camera, sim.config, historian, id => ({
        x: id === a.id ? -0.25 : 0.25, z: 0, footY: 0, partnerId: id === a.id ? b.id : a.id,
        socialMeaning: 0.9, socialTone: 'mentoring',
      }), () => [a.id, b.id]);
      const observations: string[] = [], positions: number[][] = [];
      const initialMonth = sim.state.month, before = JSON.stringify(sim.state);
      for (let frame = 0; frame < 60 * 30; frame++) {
        sim.state.month = Math.floor(frame / 30 * rate);
        director.update(1 / 30, frame / 30, sim.state, () => 0);
        observations.push(director.current()!.id);
        if (frame % 30 === 0) positions.push(camera.position.toArray());
      }
      sim.state.month = initialMonth;
      expect(JSON.stringify(sim.state)).toBe(before);
      expect(observations[0]).toMatch(/^human:/);
      expect(new Set(observations.slice(0, 12 * 30)).size).toBe(1);
      expect(observations).toContain('review-community');
      return { observations, positions };
    });
    for (const run of runs) expect(run).toEqual(runs[0]);
  });
});
