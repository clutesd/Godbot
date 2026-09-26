import { describe, expect, it } from 'vitest';
import { Historian } from '../src/historian/Historian';
import { isEarlyDocumentary, isHumanObservation } from '../src/historian/EarlyDocumentary';
import { Simulation } from '../src/sim/Simulation';

describe('early documentary direction', () => {
  it.each([1, 24, 60])('keeps quiet founding month %s human without touching simulation state', month => {
    const sim = new Simulation({ seed: `early-documentary-${month}`, startMode: 'arrival' });
    sim.advanceArrival(80);
    sim.beginHistory();
    sim.state.month = month;
    const before = JSON.stringify(sim.state);
    const a = new Historian(sim.config), b = new Historian(sim.config);
    const scenes = Array.from({ length: 60 }, () => a.chooseScene(sim.state));
    expect(scenes.filter(isHumanObservation).length).toBeGreaterThanOrEqual(42);
    expect(new Set(scenes.filter(isHumanObservation).map(scene => scene.subjectId)).size).toBeGreaterThan(4);
    expect(Array.from({ length: 60 }, () => b.chooseScene(sim.state).id)).toEqual(scenes.map(scene => scene.id));
    expect(JSON.stringify(sim.state)).toBe(before);
    expect(isEarlyDocumentary(sim.state)).toBe(true);
    sim.state.month = 61;
    expect(isEarlyDocumentary(sim.state)).toBe(false);
  });
});
