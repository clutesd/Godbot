import { describe, expect, it } from 'vitest';
import { Historian } from '../src/historian/Historian';
import {
  cameraClearanceFor,
  cameraClearanceForScene,
  cameraFlightProfileFor,
  scenicFlightProfileFor,
  scenicObservationFor,
  shouldScheduleScenicFlight,
} from '../src/render/CameraDirector';
import { Simulation } from '../src/sim/Simulation';

describe('scenic low-flight camera grammar', () => {
  it('keeps scenic motifs low, deliberate, and slower than ordinary wide travel', () => {
    const valley = scenicFlightProfileFor('scenic:valley:0:cell');
    const forest = scenicFlightProfileFor('scenic:forest:0:cell');
    const wildlife = scenicFlightProfileFor('scenic:wildlife:0:elk');

    expect(valley?.height).toBeLessThan(3);
    expect(forest?.height).toBeLessThan(valley!.height);
    expect(wildlife?.height).toBeLessThan(forest!.height);
    expect(valley?.routeLength).toBeGreaterThan(forest!.routeLength);

    const scenicTransfer = cameraFlightProfileFor('landscape-pause', 40, 'scenic:valley:0:cell');
    const ordinaryTransfer = cameraFlightProfileFor('landscape-pause', 40, 'ordinary-landscape');
    expect(scenicTransfer.limits.maxSpeed).toBeLessThan(ordinaryTransfer.limits.maxSpeed);
    expect(scenicTransfer.cruiseClearance).toBeLessThan(ordinaryTransfer.cruiseClearance);

    const ordinaryClearance = cameraClearanceFor('landscape-pause');
    const scenicClearance = cameraClearanceForScene('landscape-pause', 'scenic:forest:0:cell');
    expect(ordinaryClearance.lens).toBeGreaterThan(scenicClearance.lens);
    expect(ordinaryClearance.sightline).toBeGreaterThan(scenicClearance.sightline);
  });

  it('spaces beauty shots between documentary beats and never displaces priority scenes', () => {
    expect(shouldScheduleScenicFlight(1, undefined, 'ordinary:one')).toBe(false);
    expect(shouldScheduleScenicFlight(2, undefined, 'ordinary:two')).toBe(true);
    expect(shouldScheduleScenicFlight(4, 'major-event', 'ordinary:three')).toBe(false);
    expect(shouldScheduleScenicFlight(4, undefined, 'human:a:b')).toBe(false);
    expect(shouldScheduleScenicFlight(4, undefined, 'founding:overview:event')).toBe(false);
    expect(shouldScheduleScenicFlight(4, undefined, 'scenic:valley:0:cell')).toBe(false);
  });

  it('can frame rendered wildlife without turning presentation state into history authority', () => {
    const simulation = new Simulation({
      seed: 'scenic-wildlife-camera',
      startMode: 'established',
      startingPopulation: 24,
      settlementCount: [2, 2],
      world: { size: 20 },
    });
    simulation.state.arrival = undefined;
    const historian = new Historian(simulation.config);
    const fallback = historian.chooseScene(simulation.state);
    const before = JSON.stringify(simulation.state);

    const scenic = scenicObservationFor(simulation.state, fallback, 1, [{
      id: 'elk-camera-subject',
      species: 'elk',
      x: 4,
      z: -3,
      yaw: 0.4,
      moving: true,
    }]);

    expect(scenic).toBeDefined();
    expect(scenic?.id.startsWith('scenic:wildlife:')).toBe(true);
    expect(scenic?.kind).toBe('landscape-pause');
    expect(scenic?.position).toEqual({ x: 4, z: -3 });
    expect(scenic?.audioCategory).toBe('ambient-wilderness');
    expect(scenic?.event).toBeUndefined();
    expect(scenic?.statement.sourceEntityIds).toEqual([]);
    expect(JSON.stringify(simulation.state)).toBe(before);
  });
});
