import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { Historian } from '../src/historian/Historian';
import { CameraDirector } from '../src/render/CameraDirector';
import type { HistoricalEvent } from '../src/sim/types';

function fixture() {
  const sim = new Simulation({ seed: 'watcher-continuity', startMode: 'established', startingPopulation: 24,
    settlementCount: [2, 2], world: { size: 20 } });
  sim.state.arrival = undefined;
  sim.state.history = [];
  sim.state.month = 100;
  for (const cell of sim.state.world.cells) cell.wood = 0;
  for (const s of sim.state.settlements) s.structurePlots = [];
  return sim;
}

describe('ongoing documentary observation', () => {
  it('keeps acquiring different subjects and narrating current evidence throughout a ten-minute quiet run', () => {
    const sim = fixture();
    const historian = new Historian(sim.config);
    const camera = new THREE.PerspectiveCamera(38, 1.6, 0.01, 200);
    const director = new CameraDirector(camera, sim.config, historian);
    const windows = Array.from({ length: 5 }, () => new Set<string>());
    const narrated = new Set<number>();
    let previousRevision = -1;
    let maxGap = 0, lastAcquisition = 0;
    const initial = JSON.stringify(sim.state);
    for (let frame = 0; frame < 600 * 10; frame++) {
      const t = frame / 10;
      director.update(0.1, t, sim.state, () => 0);
      if (director.observation.revision !== previousRevision && director.observation.sceneId) {
        previousRevision = director.observation.revision;
        windows[Math.min(4, Math.floor(t / 120))]!.add(director.current()!.subjectId);
        maxGap = Math.max(maxGap, t - lastAcquisition);
        lastAcquisition = t;
        if (director.observation.narrationVisible) narrated.add(Math.floor(t / 120));
      }
    }
    expect(windows.every(w => w.size >= 3)).toBe(true);
    expect(maxGap).toBeLessThan(65);
    expect(narrated.size).toBeGreaterThan(0);
    expect(JSON.stringify(sim.state)).toBe(initial);
  });

  it('yields an unreachable mandatory milestone to other subjects without claiming to have witnessed it', () => {
    const sim = fixture();
    const blocked: HistoricalEvent = { id: 'unreachable-shelter', type: 'infrastructure-built', month: sim.state.month,
      location: { x: 80, z: 80 }, actors: ['world'], causes: [], context: { need: 'housing', temporary: true },
      summary: 'A shelter is recorded beyond the accessible camp.', outcome: 'Recorded shelter', tags: [],
      affectedPopulation: 12, magnitude: 0.8, significance: 0.8 };
    sim.state.history.push(blocked);
    const historian = new Historian(sim.config);
    const camera = new THREE.PerspectiveCamera(38, 1.6, 0.01, 200);
    const director = new CameraDirector(camera, sim.config, historian, undefined, undefined,
      point => Math.hypot(point.x - 80, point.z - 80) < 18 ? 1 : 0);
    for (let frame = 0; frame < 180 * 10; frame++) director.update(0.1, frame / 10, sim.state, () => 0);
    expect(director.sceneTransitions.some(s => s.sceneId.includes(blocked.id) && s.phase === 'released')).toBe(true);
    expect(director.sceneTransitions.filter(s => s.phase === 'acquired').length).toBeGreaterThan(3);
    expect(historian.statements.some(s => s.sourceEventIds.includes(blocked.id))).toBe(false);
    expect(director.sceneTransitions.filter(s => s.sceneId.includes(blocked.id) && s.phase === 'traveling').length).toBeLessThan(6);
  });

  it('compares settlement readouts with the last shown caption, not an unspoken sequence beat', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const settlement = sim.state.settlements[0]!;
    const current = () => historian.candidates(sim.state).find(c => c.id === `settlement:${settlement.id}`)!;
    historian.acquireScene(current(), sim.state, false);
    sim.state.month++;
    settlement.buildings++;
    expect(current().statement.text).not.toContain('last narrated view');
    historian.acquireScene(current(), sim.state, true);
    const narratedMonth = sim.state.month;
    sim.state.month++;
    settlement.buildings += 2;
    expect(current().statement.text).toContain(`last narrated view in month ${narratedMonth}`);
    expect(current().statement.text).toContain('building count rose by 2');
  });

  it('refreshes queued people and population claims, and retires a subject who has died', () => {
    const sim = fixture(), historian = new Historian(sim.config);
    const candidates = historian.candidates(sim.state);
    const person = candidates.find(c => c.id.startsWith('person:'))!;
    const settlement = candidates.find(c => c.id.startsWith('settlement:'))!;
    const actor = sim.state.people.find(p => p.id === person.subjectId)!;
    sim.state.month++;
    actor.activity = 'rest';
    actor.ageMonths += 12;
    const refreshed = historian.refreshScene(person, sim.state)!;
    expect(refreshed.statement.month).toBe(sim.state.month);
    expect(refreshed.statement.text).toContain('resting');
    expect(historian.validateStatement(historian.refreshScene(settlement, sim.state)!.statement, sim.state)).toBe(true);
    actor.alive = false;
    expect(historian.refreshScene(person, sim.state)).toBeUndefined();
  });
});
